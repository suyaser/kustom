# apps/web

The Next.js app: the API the companion posts to, the public pages, and `/admin`.

```
app/api/companion/*   bearer companion token, zod-validated (M1.5)
app/api/admin/*       Supabase session + players.is_admin, zod-validated (M1.6)
app/api/cron/sweep    bearer CRON_SECRET: the scheduled half of the 2-hour idle sweep (M2.5)
app/api/cron/leaderboard  bearer CRON_SECRET: posts the nightly board to Discord (M3.5)
app/leaderboard       the season table, ordered by Proven. Anon key, server-rendered (M3.5)
app/p/[puuid]         one player: the two numbers, the Rating history, the last few games (M3.5)
app/admin/*           the admin pages. Server components, plain forms, no client JavaScript
app/auth/*            sign in with Discord, the OAuth callback, sign out
lib/                  auth, the service-role client, ingest, admin reads and writes
proxy.ts              refreshes the admin session cookie (Next 16's name for middleware)
```

```
pnpm --filter web dev         http://localhost:3000
pnpm --filter web test        vitest; the integration tests skip without the local stack
pnpm --filter web build
pnpm --filter web mint-token <puuid> [label]   # /admin/tokens does this with a button now
pnpm --filter web rebuild-ratings [--dry-run] [--force] [--prune] [--season <id>]
                              # M5.2: refold a season from seeds. Run it after a backfill batch;
                              # the guard counts a game that landed in the last 15 minutes, so
                              # straight after a batch it needs --force (or a 15-minute wait).
```

`rebuild-ratings` runs under `tsx`, not plain `node`: it imports `rateGame` from
`@customs/core`, and Node's type stripping cannot resolve that package's extensionless relative
imports. `mint-token` gets away with plain `node` because everything it imports across a package
boundary is a type (`04-decisions.md`).


Environment: copy the `apps/web` block of the repo's `.env.example` into `apps/web/.env.local`.
`supabase status -o env` (from `packages/db`) prints the local URL and keys.

## The companion API

Five routes, all bearer-token gated by `withCompanionAuth` / `withCompanionIdentity`
(`lib/companionRoute.ts`), which resolves the identity from the token **before** it parses the
body. The token decides who the caller is; nothing in a payload does.

```
GET  /api/companion/me      who this token is: { ok, puuid, playerId, displayName }. Writes nothing.
POST /api/companion/lobby   the whole member list, every time it changes. Idempotent on partyId.
                            runs the state machine; answers ranksNeeded[] (M2.4) and recheckInMs (M2.5).
POST /api/companion/game    phase in_progress | eog. Idempotent on gameId; eog runs the rating fold.
POST /api/companion/rank    one queue's rank reading for one puuid.
POST /api/companion/backfill/scan
                            M5.1: { gameIds } -> { approved, unknown }. Whether this player may send
                            match history at all, and which of those ids we do not already have.
```

Request **and** response schemas live in `@customs/db/schemas` (`companion.ts`,
`companionResponses.ts`), not beside the routes, because the companion imports the same
definitions — see "The companion wire contract" in `packages/db/README.md` for the field-by-field
rules and where each value comes from in the client. Refusals before any write: 403 for a lobby or
game the caller was not in, 422 for a non-custom game, a block nobody won (a remake or
`TerminatedInError`) or a duplicated participant, 400 for a body that does not parse.

**Backfill (M5.1).** A game posted with `source: 'backfill'` is the same body walked out of match
history: the participant check has **no** lobby fallback (the token's player must be on the
scoreboard), the game is linked to no lobby, nothing is posted to Discord, and the rating fold does
not run — the answer is `{ rated: false, reason: 'backfill' }` and
`pnpm --filter web rebuild-ratings` is what turns a batch into ratings. Whether a companion may
send them at all is `players.backfill_approved_at`, flipped by an admin on `/admin/players` and
read by the scan route.

Names from a backfill post **fill but never patch**: a match detail reports who somebody was when
the game was played, and the walker reads newest-first, so refreshing from one would roll every
display name back to the oldest game in the batch. `ensurePlayers(..., { fillOnly: true })` creates
a row for a PUUID we have never met — still the commonest good outcome of backfill — and leaves
every existing row's name columns alone.

## The lobby state machine (M2.5)

`lib/lobbyState.ts` holds the transition table and the three numbers — `ROSTER_STABLE_MS`
(10 s), `IDLE_ABANDON_MS` (2 h), `MIN_RATED_DURATION_S` (300 s) — and nothing else does. The
moves it allows are the ones in the M2.5 brief; `moveLobby` is a compare-and-set on `status`,
so two companions posting the same lobby produce one transition. An illegal move
(`finished -> open`) throws rather than quietly doing nothing.

- **Ten seconds with no timer.** The roster's identity is `rosterKey()` over everyone around,
  spectators included. When it changes, `lobby_members` is rewritten *and* the lobby row is
  written, which restarts `updated_at`. When it does not, the lobby row is not touched, and
  `now - updated_at >= 10 s` with ten or more around is the whole rule. The answer's
  `recheckInMs` tells the companion when to knock again with the identical payload.
- **Balancing** is `lib/ingest/balance.ts`: it picks the ten (most games tonight sits, then
  longest since a sit-out, then puuid), builds one `BalancePlayer` each from `lobby_members`,
  `players` and `ratings`, seeds anyone with no rating row from their rank *in memory*, and
  calls `balance()` from `@customs/core`. All three splits are stored with core's explanation
  strings verbatim; `is_chosen` is on rank 1 and a rebalance moves the flag rather than
  deleting anything.
- **The rating fold** is `lib/ingest/rating.ts`: ten `game_players`, five a side, over 300
  seconds, or the game is stored and left unrated. It runs exactly once per game, claimed by
  the `mu_after is null` guard on the first row it writes.
- **Discord** is not here. `lib/ingest/hooks.ts` is the seam; `lib/discord` (below) is what
  listens on it. With that one import removed, everything above behaves identically.
- **The sweep.** An `open` or `balanced` lobby nobody has posted about for two hours becomes
  `abandoned`, and an `in_game` one becomes `dropped` — no game runs two hours, so that row
  lost its end-of-game block (M5.11). It runs at the start of every companion lobby and game
  post, and on demand:

  ```
  curl -H "authorization: Bearer $CRON_SECRET" https://<host>/api/cron/sweep
  ```

  With `CRON_SECRET` unset the route answers 503 and sweeps nothing. A `dropped` lobby keeps
  its frozen roster and is out of the live set, so the party's next post opens a clean cycle
  instead of landing on the stuck row all night; a block that arrives days late still moves it
  `dropped -> finished`.
  An end-of-game block whose party resolves only to an `abandoned` row is stored with
  `lobby_id: null` and still rated: the sweep gave up on that lobby, so linking a real game to
  it would be a lie. A move that claims nothing because the lobby is already terminal is one
  `console.warn` naming the lobby and the move.
- **`CUSTOMS_NIGHT_TZ`** (default `Africa/Cairo`) is the timezone "tonight" is measured in: a
  night runs 06:00 to 06:00 there, so a session that ends at 01:30 is one night.

## Discord (M3.1, M3.3, M3.5)

Three messages, all posted by the API to the webhook URL in `discord_config`. There is no bot here — that is
`apps/discord` in M4 — and nobody types anything to make any of them happen.

```
lib/discord/embeds.ts    pure: teamsEmbed / resultEmbed / leaderboardEmbed -> the webhook JSON. No I/O, no clock.
lib/discord/assemble.ts  rows and hook events -> those inputs. Names are read fresh; `Someone` is the fallback.
lib/discord/webhook.ts   the only I/O: one POST, 5 s, one retry, never throws.
lib/discord/post.ts      postTeamsForEvent / postTeamsForSplit / postResultForGame / postNightlyLeaderboard.
lib/ingest/discord.ts    registers the hooks at module load. The companion routes import it for the side effect.
```

- **On `balanced`**: the teams embed — two inline fields with role, name and display rating in lane order, the
  stored explanation verbatim as the description, `Sitting out` and `Seats` when somebody sits or has to move
  (M2.15's copy), and `Lobby` when the client reported a name. Layout and every string are `docs/05-design.md`,
  "Discord embeds"; the sit-out wording is product's and is not edited here.
- **On `finished`**: the result embed — winner, duration, top damage, and each player's new rating with its
  change. A change is always `displayRating(muAfter) - displayRating(muBefore)` from `displayDelta`
  (`lib/ratingDisplay.ts`), the one helper every surface calls, so Discord and the web page can never print
  different numbers. **No team total of deltas, ever** (`docs/00-product.md`, "The numbers on the screen").
  Only a game the fold rated is posted: a remake, a short surrender or a second companion's re-post is silent.
- **When Discord is down or unconfigured**, nothing else changes: the splits are stored, the fold runs, the
  route answers 200. The post is one POST with a five-second budget, one retry on a 5xx or a network error and
  one wait on a 429; then a log line. `lib/ingest/hooks.ts` is the seam and a hook that throws is caught there.
- **The embed `url`** is the tonight page. It comes from the origin of the request that triggered the
  transition — `NEXT_PUBLIC_SITE_URL` when it is set — and is dropped when that is a localhost host, because a
  link only the person running the server can open is worse than no link. With the variable unset the
  request's own host is trusted, so **pin `NEXT_PUBLIC_SITE_URL` on any deployment you care about**; the link
  is cosmetic, but a companion could otherwise choose what it points at.
- **Configuring it**: `/admin/discord`, one row per guild. The webhook URL is a secret and `discord_config` has
  no read policy at all; the API reads it with the service role and never logs it.
- **Reroll (M3.2)** re-posts with one call: `postTeamsForSplit(client, splitId)` after promoting the split.
- **The nightly board (M3.5)** is the third message and the only one with no trigger inside the app:

  ```
  curl -H "authorization: Bearer $CRON_SECRET" https://<host>/api/cron/leaderboard
  ```

  Whatever calls that decides what time the board lands in the channel; **no cron configuration ships with
  M3.5**. It is one block field, the season's top ten by **Proven** with their game counts, and the short
  still-settling sentence as the footer — the same order and the same numbers `/leaderboard` shows, because it
  is the same `loadBoard`. No season or nobody on the board is `skipped`, not an empty message. Calling it
  twice posts twice; there is no dedupe, which is what makes a scheduler debuggable.

## The public pages (M3.4, M3.5)

`/` (tonight), `/leaderboard` and `/p/[puuid]` are server components read with the **anon key** through RLS
(`lib/publicClient.ts`), so what they can see is exactly what an anonymous phone can see. Names come from
`players_public`; the base `players` table is service-role only. None of them writes anything. Only the tonight
page has a client component, and only for the Realtime subscription.

- **Two numbers, two names, everywhere.** **Proven** is `round(ordinal * 60)` **floored at zero** — the
  primary number on a board row — and **Rating** is `round(mu * 60)`, the number the embeds print beside a
  name. Both come from `lib/ratingDisplay.ts` (`provenRating`, `displayRating`); no page multiplies anything
  by sixty. `ratings.ordinal` is a generated column and the index the season is stored under, but the integer
  on the page comes through core, so SQL and core cannot disagree about where a row sits.
- **The board sorts on `sortKey`, not on the printed Proven.** `ordinal` is negative for anybody whose sigma
  outweighs half their mu — an Iron IV seed is `-160` — so the printed number is floored and the raw ordinal
  (`provenSortKey`) rides along unprinted to keep rows that all display `0` in their true order. The floor is
  monotonic, so the printed column still never goes up as you read down it.
- **A week is the other track** (M7.3). `This week` and `Last week` are folded from scratch at read time —
  each player's stored seed, through that week's rated games, with `rateGameWeekly` (`lib/board/weekly.ts`) —
  and they **sort and print `Rating`**, not Proven: a week is a handful of games, so `- 2σ` is enormous for
  every row and largest for whoever played fewest, and Proven would rank a 4W 4L week above a clean 2W 0L one.
  `sortKey` on a week row is the weekly `mu` itself, **no Proven is printed on a week surface at all**, no row
  carries the `settling` chip, and the note under the board is `WEEK_BOARD_SENTENCE`. The row says which track
  it came from in `BoardRow.track`; nothing is stored, and `lib/ingest/` never imports any of it. `All time`,
  `This month` and `Last month` are the stored fold and are untouched.
- **The `settling` chip (M3.8)** is on a player with fewer than `SETTLING_GAMES` (30) recorded games, and its
  sentence appears **once per page**, never per row. Both live in `lib/board/copy.ts`, and the 30 in the
  sentence is interpolated from the same constant the chip switches off at.
- **`Someone` (M3.10)** is `renderWebName`, at render, for a player with no `display_name` and no `game_name`.
  Nothing is written to `players`, and `Names fill in after someone's first game.` is said once per page while
  any row on it reads `Someone`.
- **A delta is computed where it is rendered**, never carried in a loaded snapshot: `displayDelta` returns
  `-0` for a rating that fell by less than half a point and `JSON.stringify` turns that into `0`.
- `lib/board/load.ts` is both pages' only read path; `lib/board/{order,streak,chart}.ts` are pure and tested.

## The admin area

`/admin` is gated twice, both server-side:

- **Pages** — `app/admin/(dashboard)/layout.tsx` calls `requireAdmin()` (`lib/adminPage.ts`).
  `/admin/login` sits outside that route group, which is why the group exists.
- **Writes** — every `app/api/admin/*` route is wrapped in `withAdminAuth()`
  (`lib/adminRoute.ts`), which answers **401 without a session and 403 for anyone who is not
  `players.is_admin`**, before it looks at the body.

The gate itself is `lib/adminAuth.ts`: the session is exchanged for a verified user with
`auth.getUser()`, the Discord snowflake is read from `user.identities[]` where
`provider === 'discord'`, and that snowflake is matched against `players.discord_id` with the
**service role** (anon and authenticated cannot read `players` at all). `user_metadata` is never
trusted for identity — a signed-in user can write it themselves with `auth.updateUser()`.

Pages read and write through the service-role client, so nothing in the browser holds anything
but the anon key and the session cookie.

The pages are deliberately unstyled beyond `app/admin/admin.css` (system colours, a scrolling
table). M3.0 brings the design system; this area is five people on a laptop and should not
pre-empt it.

## Setting up Discord sign-in

No OAuth app exists yet. Once someone creates one:

1. <https://discord.com/developers/applications> → **New Application** → name it (Kustom).
2. **OAuth2** → **Redirects** → add one per environment. This is Supabase's callback, not ours:
   - local stack: `http://127.0.0.1:54321/auth/v1/callback`
   - hosted: `https://<project-ref>.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and a **Client Secret**.
4. Local: put them in your shell as `SUPABASE_AUTH_DISCORD_CLIENT_ID` and
   `SUPABASE_AUTH_DISCORD_SECRET`, then `pnpm db:stop && pnpm db:start`. The provider block is
   already in `packages/db/supabase/config.toml`; with the variables unset the CLI only warns,
   so everyone else's stack still starts.
   Hosted: Authentication → Providers → Discord, paste them there.
5. Supabase → Authentication → URL Configuration: the **Site URL** is the deployment
   (`https://kustom-delta.vercel.app`), and the redirect allow-list needs **exactly one entry per
   environment, the app's own callback with no query string**:
   - hosted: `https://kustom-delta.vercel.app/auth/callback`
   - local: `http://127.0.0.1:3000/auth/callback` (the local `config.toml` already allows it)

   No wildcard. Supabase matches `redirect_to` against that list as **exact URLs**, so
   `…/auth/callback?next=/admin` matched nothing and the round trip fell back to the Site URL —
   which is how a sign-in on the deployed site landed on somebody's `localhost:3000` (M1.11).
   `/auth/signin` now sends the bare callback URL and remembers where to land in a 10-minute
   HttpOnly `SameSite=Lax` cookie (`lib/authNext.ts`), which `/auth/callback` reads, validates as
   a path on this site and clears. If a `**` wildcard entry was added while that was broken,
   delete it: it is a live open-redirect allowance and nothing needs it any more.

Scopes are Supabase's default, `identify email`. `identify` is what carries the snowflake the
gate matches on; nothing else is needed.

### The first admin

`players.discord_id` is what `/admin` matches a session against, and the first admin is seeded by
**PUUID** (`BOOTSTRAP_ADMIN_PUUID` → `public.bootstrap_admin()`), which leaves them unable to
sign in. Set `BOOTSTRAP_ADMIN_DISCORD_ID` as well, once: the first request that needs it links
that snowflake to the bootstrap PUUID and never touches a link that already exists. After that
first sign-in, everyone else is linked from `/admin/players` and both variables can stay set
(they are idempotent) or be removed.
