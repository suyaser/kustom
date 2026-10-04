# Engineering audit for Kustom 2.0 (platform view)

Audit only. Nothing in `apps/` or `packages/` was changed, no migration or test was run. Paths are relative to
`/Users/suyaser/lol`. "Hosted" means Supabase project `kustom`. Main is 6 commits ahead of origin
(`18f61b0`..`aab8f82`). Of those, only `0021_invites_and_pairing.sql` is a migration. `0019`/`0020` went in with
pushed commits `b81f030`/`05278f5`. The status table (`docs/02-milestones.md:22`) says `0020` deploys code
first, then `db:migrate`. I did not query hosted, so whether `0020` has actually been applied there is
**unverified**.

---

## 1. Schema, RLS, grants: what the security model actually is

**Short answer: it is "service-role server routes with app-level checks". RLS is used only as a read
firewall for the anon key. No table has an INSERT/UPDATE/DELETE policy, and no policy anywhere uses
`auth.uid()`.**

Evidence:

- `0001_init.sql:407-412` (comment) says: "There are no insert, update or delete policies anywhere: the API
  writes with the service_role key, which bypasses RLS."
- `0001_init.sql:452` runs `revoke insert, update, delete, truncate on all tables in schema public from anon,
  authenticated`. Every write is service role.
- `apps/web/lib/supabase.ts:6-11` is the service client. Its comment: "every write in this project goes through
  a route handler that has already checked a companion token or an admin session".
- `apps/web/lib/supabaseAuth.ts:8-14`: the cookie (anon-key) client exists **only** to verify the session with
  `auth.getUser()`. Every read and write after that goes through the service role.
- Every privileged function is `security definer`, `revoke ... from public, anon, authenticated` and
  `grant execute ... to service_role`. That covers `start_season`/`set_active_season` (`0002:14,62,46-47,93-94`),
  `bootstrap_admin` (`0018:282-311`), `set_group_member_role` (`0020:149-201`), `create_group`,
  `rotate_group_invite`, `redeem_pairing_code` and `pairing_attempt` (`0021:156-395`).

### Table access matrix

| Table / view | anon + authenticated | Writes | Source |
|---|---|---|---|
| `seasons`, `ratings`, `lobbies`, `lobby_members`, `splits`, `games`, `game_players` | SELECT `using (true)`, **all groups, no group predicate** | service role | `0001:414-439` |
| `fearless_state` | SELECT `using (true)` | service role | `0017:52-57` |
| `players` | none (holds `discord_id`) | service role | `0001:453` |
| `players_public` view (security_invoker off) | SELECT | n/a | `0001:353,458` |
| `groups`, `group_memberships` | none | service role / definer fns | `0018:330-334` |
| `groups_public` (id, slug, name), `group_members_public` (group_id, player_id) | SELECT, every group | n/a | `0018:336-353` |
| `companion_tokens`, `companion_commands`, `discord_config` | none | service role | `0001:454-456` |
| `window_posts`, `daily_mystery_*` | none | service role | `0011:78-82`, `0013:100-108` |
| `group_invites`, `pairing_codes`, `pairing_attempts` | none | service role / definer fns | `0021:401-407` |

Consequences for the redesign:

- **Every group's data can be read by anyone holding the anon key.** That includes lobbies, games, ratings
  and splits, plus `lobbies.lobby_password` (`0001:153`, read by the tonight loader at
  `apps/web/lib/tonight/load.ts:132`). `groups_public` lets anyone list every group's slug and name. Group
  "isolation" today means the queries filter by group, not that RLS does. That is fine while groups are public
  scoreboards. It is a real gap if 2.0 wants private groups.
- `seasons` is **global**: it has no `group_id` (`0001:48`), and `games.season_id` defaults to the global
  `active_season_id()` (`0001:70,234`).

## 2. Auth

- **Discord OAuth through Supabase Auth.** `app/auth/signin|callback|signout`. The variables are in
  `.env.example` (`SUPABASE_AUTH_DISCORD_CLIENT_ID/SECRET`). Memory notes say the hosted Discord provider
  still needs enabling. Confirm in the dashboard.
- **Session to person.** `auth.getUser()` (verified, not `getSession`) gives the Discord snowflake from
  `user.identities[].id`, never from user_metadata (`apps/web/lib/adminAuth.ts:148-170`). The snowflake is
  matched to `players.discord_id` with the service role (`adminAuth.ts:186-208`). The `players` row is created
  by pairing (Kustom sends PUUID plus a 6-character code: `0021:282-355`, `lib/groups/pairing.ts`).
- **Group role.** `group_memberships.role in ('member','admin')` (`0018:96`, `packages/db/src/schemas/groups.ts:39`).
  It is resolved per request from the request's `groupId` with the service role (`lib/groups/membership.ts:18-36`).
  - Admin API: `withAdminAuth` (`lib/adminRoute.ts`) reads the body's `groupId`, then `authorizeAdmin`
    (`adminAuth.ts:98-138`) checks `role !== 'admin'` and answers 403 (line 117). It gives 401/400/403 and a
    404 for ids outside the group.
  - Session routes before membership exist (`/api/groups`, `/api/groups/join`, `/api/me/pairing`):
    `lib/groups/sessionRoute.ts`.
  - Pages: `requireAdmin(groupId = ORIGINAL_GROUP_ID)` (`lib/adminPage.ts:23,51`), and
    `currentViewerState(groupId = ORIGINAL_GROUP_ID)` (`lib/viewer.ts:120-131`) for the Admin tab and controls.
    `ORIGINAL_GROUP_ID` still appears in 23 non-test files: the unmoved pages default to `customs`.
- **Companion tokens.** 32 random bytes, stored as SHA-256 (`lib/companionAuth.ts:30-38`). The token carries
  `group_id` (`0020` comment, `companion_tokens.group_id`). The server takes the group from the token, never
  from the body. A token whose player is no longer a member gets 403 (`companionAuth.ts:61,86,169-182`).
- **Super-admin (M13.6).** Not built. Planned as an env list `SUPER_ADMIN_USER_IDS`, read-only.
- **CSRF.** Relies on SameSite=Lax session cookies and admin pages that ship no client JS and use HTML form
  posts with 303 back (`lib/adminRoute.ts` header comment).

## 3. Realtime

- Published: `lobbies, lobby_members, splits, games, game_players, ratings` (`0001:481-487`) and
  `fearless_state` (`0017:59`). Not published: `groups`, `group_memberships`, `group_invites`, `discord_config`.
- Subscriber: `app/_tonight/TonightLive.tsx:35-75,225-245`. The channel is `tonight:<groupId>` and every
  event triggers a re-read (no payload is trusted). The server-side filter `group_id=eq.<id>` applies on
  `lobbies, games, game_players, ratings, fearless_state`. **`lobby_members` and `splits` are unfiltered**
  because they have no `group_id`, so another group's activity causes a harmless re-read.
- Realtime RLS is anon `using (true)`, so any client can subscribe to any group's changes. Same caveat as §1.
- There is no Discord bot. `apps/discord` does not exist. M4.4 voice split was dropped (`02-milestones.md:3154`)
  and M4.5 is deferred. CLAUDE.md's repo map still lists it.

## 4. Data flow and fairness data

```
Kustom (token) -> POST /api/companion/lobby  -> lib/ingest/lobby.ts (state machine lib/lobbyState.ts:63-112)
                -> admin "Roll" POST /api/admin/lobbies/[id]/roll -> lib/admin/roll.ts / lib/ingest/balance.ts:54
                   balance() from @customs/core -> splits rows (top 3, is_chosen) -> emitLobbyBalanced
                -> POST /api/companion/game -> lib/ingest/game.ts -> fold (lib/ingest/fold.ts, rating.ts; rateGame from core)
                   -> emitGameFinished -> lib/discord/post.ts -> webhook from discord_config[group_id]
```

- **Fairness numbers are already computed by core and stored per split.** `packages/core/src/balance/types.ts:41-57`
  defines `gap` (display-rating units), `blueWinProb` (OpenSkill `predictWin`, `rating/index.ts:181`), `score`
  and `offRoleCount`. `explain()` (`balance/explain.ts:55`) produces the one-liner, for example
  `Blue favored 54%. Everyone on a main role. Gap 12. Next best: swap A and B, gap 30.`
  Stored in `splits.blue_win_prob, gap, explanation, off_role_count, score` (`0001:196-215`), kept for all 3
  ranked splits and every reroll.
- **Where it is shown today:**
  - Tonight page: the explanation is quoted verbatim, plus `evennessLine` from core's `evenness` (`lib/tonight/copy.ts:298`).
  - Discord teams embed: `description: input.explanation` (`lib/discord/embeds.ts:312,362`).
  - Result embed: underdog line from `blue_win_prob` (`embeds.ts:831`).
  - Game page `/g/<slug>/games/<id>`: explanation (`lib/og/load.ts:20`).
  - `/games` list: only reads `blue_win_prob` for awards (`lib/stats/load.ts:518`). It does not show the
    explanation or gap.
- **Gaps for "fairness on every split, in history":**
  1. Games with no lobby/split have **no** stored split: backfilled games, and games whose lobby was never
     rolled. They do have `game_players.mu_before/sigma_before` (`0001:269-272`), so core's `predictWin` could
     give a *pre-game* win probability for any rated game. That would be a core-owned helper (core-engineer),
     not route math.
  2. `splits.blue/red` store `{puuid, role}` only, not the ratings used at roll time. A historical "rating gap"
     beyond the stored `gap` integer (per-side totals, per-lane deltas) cannot be reconstructed exactly. It can
     be approximated from `game_players.mu_before`, which is the rating before this game, not at roll time.
  3. The explanation is an English sentence frozen at roll time and "never recomposed" by decision (M3.7). A
     redesign that wants structured chips (win %, gap, reason) must parse it, which is fragile. Better: add
     columns or make it derivable from the existing numeric columns. `explain()`'s first clause is fully
     derivable from `blue_win_prob`.

## 5. Gaps against job #4 (group admin) and the fairness requirement

| Capability | Status |
|---|---|
| Create group (`POST /api/groups`, `create_group`) | built, **not deployed** (`0021` and code unpushed) |
| Invite link + rotate (`group_invites`, `POST /api/admin/invite/rotate`) | built, not deployed |
| Join by link / PUUID pairing (`/api/groups/join`, `/api/me/pairing`, `/api/companion/pair`) | built, not deployed. Kustom side is M13.8, **not built** |
| Promote/demote admin (`POST /api/admin/members/role`, `set_group_member_role`, last-admin 409) | built (M13.4). Deployed only if `0020` is on hosted |
| Per-group Discord webhook + channel ids (`discord_config` PK `group_id`, `POST /api/admin/discord-config`) | built (M13.4). The voice-channel columns are dead (no bot) |
| `/new`, `/join/<code>` pages | scoped M13.13, not built |
| `/g/<slug>/admin/*`, invite card, member list with Make/Remove admin, `/ops` | scoped M13.14, not built (admin is still `/admin` on the original group) |
| Super-admin | scoped M13.6, not built |
| Leaderboard, player and games pages under `/g/<slug>` | scoped M13.10 to M13.12, not built (they read every group or the original group) |
| **`owner` role** | **not scoped** |
| **Remove / kick member** | **not scoped**. Explicitly reserved out of v1 (`02-milestones.md` M13 "Reserved for v1") |
| **Rating reset / seasons per group** | **not scoped, and contradicts a standing decision**: "ratings never reset", seasons read-only (`app/admin/(dashboard)/seasons/page.tsx:15-28`, M5.3 dropped). `seasons` is global |
| Delete group, rename slug, private groups | reserved out of v1 |
| RLS-enforced permissions | **not the pattern**, see below |

### What `owner` would take (one migration plus code, small but it touches invariants)

- Widen `group_memberships_role_check` (`0018:96`, text check, so one `alter`). Update `GROUP_ROLES` in
  `packages/db/src/schemas/groups.ts:39` and regenerate types.
- `set_group_member_role` (`0020:149-201`) hard-codes `in ('member','admin')` and the "last admin" rule. It
  needs a new function: owner cannot be demoted, plus a transfer-ownership function that locks the group row.
- `create_group` (`0021:191`) and `redeem_pairing_code` (`0021:337-343`) make the creator `admin`. They would
  make `owner`. `groups.created_by` (auth uid) already marks the creator, so the backfill is
  `update ... set role='owner' where player is created_by's linked player`. The original group has
  `created_by = null`, so a manual pick is needed.
- App checks are **exact equality** `=== 'admin'`: `adminAuth.ts:117`, `viewer.ts:131`,
  `lib/admin/players.ts:282`, `membership.ts:78`. Each needs an `isAtLeast(role, 'admin')` helper, or every
  owner gets locked out of admin.
- Decision row needed: which powers are owner-only (delete group, transfer, demote admins, Discord webhook?).

### Member removal

Needs a `remove_group_member` definer function: delete the membership, revoke that group's `companion_tokens`,
refuse the owner or the last admin. `companionAuth` already refuses a token whose player is no longer a member
(`companionAuth.ts:182`), so ingest is safe. Ratings and games stay. That is a product call, and v1 reserved it out.

### Per-group rating reset / seasons

The cleanest route avoids touching `seasons`: a per-group "rating epoch" (`groups.ratings_since timestamptz`).
The fold and `rebuild-ratings --group` (already per group) only count games after it. Making `seasons`
per-group means adding `group_id`, a per-group `active_season_id(group)`, removing the `games.season_id`
default, and changing every `season_id` filter in `lib/board`, `lib/stats` and `lib/ingest`. That is a big
change. Either way it reverses the "ratings never reset" decision, so product must sign off first.

### "Enforce with RLS" against the current pattern

**This conflicts.** Today the browser never writes and never reads private tables. The server does both with
the service role after app-level checks, and those checks are unit-tested pure functions. Moving to
RLS-enforced permissions would need:

- (a) A link from `auth.uid()` to `players`. Today the link is `players.discord_id` = snowflake read from
  `auth.identities`, which policies can reach only through a `security definer` helper such as
  `current_player_id()`.
- (b) Policies on `group_memberships`, `group_invites` and `discord_config` keyed on
  `is_group_admin(group_id)`.
- (c) Re-granting DML to `authenticated`, undoing `0001:452`.
- (d) Rewriting the admin routes to use the session client.

Recommended instead: keep service-role routes as the enforcement point, and **add RLS as defence in depth for
reads**:

- `authenticated` can SELECT own memberships.
- Group-admin SELECT on own group's `group_invites` and `group_memberships`, through a definer helper.
- Optionally, group-scoped anon reads if private groups are wanted.

Keep writes going through the existing definer functions. They already hold the concurrency invariants (row
locks for last-admin, invite rotation, pairing) that RLS alone cannot express. Record the decision.

## 6. Risks for a big frontend redesign

- **No Tailwind, no PostCSS.** `apps/web/package.json` has no tailwind, radix, cva or clsx. The design system
  is about 5.2k lines of hand-written Floodlit CSS: `app/tokens.css`, `theme-gaming.css`, `shell.css`,
  `tonight.css`, `board*.css`, `admin/admin.css`. shadcn/ui needs Tailwind (v4 plus `@tailwindcss/postcss`),
  `cn()`, Radix and client components. Adding it beside Floodlit means two token systems. Map Floodlit tokens
  into Tailwind `@theme` first.
- **The admin UI is deliberately zero-JS.** It uses HTML `<form>` posts, `withAdminAuth` answers a form post
  with a 303 back to the page, and CSRF safety relies on that plus SameSite=Lax. shadcn dialogs and menus are
  client components posting JSON. The routes already accept JSON (same envelope), so this is fine, but the
  form/303 path and its tests become dead weight.
- **Big, page-shaped loaders.** `lib/tonight/load.ts` (860 lines), `lib/board/load.ts` (over 1.4k),
  `lib/stats/load.ts`. Pages are server components reading through the **anon** client (`lib/publicClient.ts`).
  Keep the loaders and restyle the views. Rewriting the loaders risks the integration tests (34
  `*.integration.test.ts` files).
- **Copy is pinned by tests.** Copy modules (`lib/tonight/copy.ts` 550 lines, `lib/board/copy.ts`,
  `lib/groups/copy.ts`, `lib/discord/embeds.ts`) have exact-string tests and Discord snapshot tests. There are
  30 `.test.tsx` component tests. A redesign that rewords things will churn many tests, which is expected but
  should be budgeted.
- **Half-migrated routing.** `/g/<slug>` holds only tonight and the game page. The other pages live in
  `app/(site)/` drawing the original group's shell, with nav decided by `lib/nav.ts`'s moved/unmoved table.
  Admin is `/admin` and implicitly `customs`. Finish M13.10 to M13.14 inside the redesign, rather than
  redesigning `(site)` pages that are about to move.
- **Multi-group read leaks in unmoved loaders.** `loadBoard` reads every group when `groupId` is absent (the
  decision row of M13.4). `/leaderboard` and the tonight rail still call it that way. If a second group gets
  created before M13.10, those pages will mix boards.
- **Deploy-order coupling.** `0021` must be applied before the M13.5 code. Confirm `0020` on hosted first
  (`supabase migration list --linked`).
- **Stale doc.** CLAUDE.md lists `apps/discord` (does not exist) and "admin routes use the Supabase session"
  (true). `discord_config` voice columns are unused.
