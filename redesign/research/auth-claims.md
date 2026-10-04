# `getClaims()` instead of `getUser()` per signed-in render (M19.12)

Platform engineer, 2026-10-04, branch `m19-16-routes` (from `origin/main` at `06323b49`). An
investigation only: nothing here changes how a session is verified, and no `getClaims()` call is in
the branch. A reviewer's verdict is required before anything below is adopted.

## 1. Summary

- **Plain `getClaims()` must not replace `getUser()` in this app.** Every gate we have keys a person by
  their Discord id (`discordIdFromUser`, from `user.identities[]`). The access token does not carry
  `identities`. The only Discord id inside it is `user_metadata.provider_id`, and the user can write
  `user_metadata` with `auth.updateUser({ data })`. So swapping the call would mean reading an id the
  user can forge, and any signed-in Discord account could pass as an admin's snowflake.
  `lib/adminAuth.ts` already refuses that field for this reason.
- **The revocation gap is real but narrow here.** Group roles, membership and the player link are read
  from our own tables on every request. Removing or demoting a member therefore takes effect at once
  under either call. What `getClaims()` would keep alive until the token expires (3600 s locally):
  a session signed out elsewhere, a deleted auth user, and a banned auth user. Measured below.
- **The prize is one sequential round trip per signed-in render, about 60 ms at the M19.1 RTT.** On
  the admin and You pages, `getUser` is the first link in a three-link chain (`getUser` → `players` →
  `group_memberships`), about 150 ms of a 216 ms render.
- **"An admin page pays two GoTrue round trips" no longer happens at run time.** Measured: one
  `/auth/v1/user` call per signed-in render on every page, admin included. The layout's
  `currentSessionPlayer` and the admin page's `currentPageSession` each call `getUser()`. Next's
  request memoisation then folds the two identical GETs (same URL, same bearer) into one fetch, and
  the same happens to the two identical `players` reads. That is why the bench counts 1 and 1. A shared
  React `cache()` would make this explicit rather than rely on fetch memoisation, but it saves no time
  today.
- **Recommendation.** Do not adopt `getClaims()` as a drop-in. Two smaller changes get most of the gain
  with no change to what is trusted (section 6). If the owner wants the last round trip, there is one
  safe design, proposed as a new task: a `security definer` lookup keyed by the token's verified `sub`
  and `session_id` that also checks `auth.sessions`. It needs a migration, so it needs a decision row.

## 2. Method

- Local Supabase CLI stack only (CLI 2.75.0, `supabase/config.toml`: `jwt_expiry = 3600`, refresh
  rotation on, reuse interval 10 s, no `signing_keys_path`). Nothing hosted was read or called.
- **Latency.** A scratch script (not committed) created one local email/password user through `psql`.
  GoTrue's admin API refuses both local keys on this CLI; see `lib/testing/authUsers.ts`. It signed the
  user in at the token endpoint and timed 50 warm calls of each variant, each on a fresh client the way
  `createAuthClient` builds one per request.
- **Calls per render.** `next start` on this branch's build, with M19.1's preload
  (`scripts/perf/preload.mjs`, `PERF_SB_DELAY_MS=40`). It used a scratch group (`m1912-*`) and one
  local player who owns it, plus a local auth user with a fabricated `auth.identities` row
  (`provider = 'discord'`). No real Discord session was used and no real group was touched. Each page
  was fetched 4 times signed in and 4 times anonymous, the first discarded. Everything was deleted
  after.
- Library behaviour was read from the installed `@supabase/auth-js` 2.115.0
  (`GoTrueClient.getClaims`, `fetchJwk`).

## 3. (a) Call sites and round trips per render

Every server-side `getUser()` goes through `supabaseSessionUser` (`lib/adminAuth.ts:180`):

| Caller | Used by | Cached |
|---|---|---|
| `currentSessionPlayer` (`lib/viewer.ts:58`) | group layout, Tonight, Board, Games, game, player, You, mode reset, `/download`, landing | React `cache()` |
| `currentPageSession` (`lib/groups/pageSession.ts:33`) | group admin pages (`currentAdminAccess`), `/new`, `/join/<code>`, `/admin/login` | React `cache()` |
| `resolveAdmin` / `resolveMe` / operator / `/api/ops/groups` | every `/api/admin/*`, `/api/me/*`, `/api/groups/*`, `/ops` | once per request |
| `lib/me/discordName.ts` | `That's me` display name | once per request |
| `proxy.ts` | page navigations | `getSession()` only, which goes to GoTrue only to refresh an expired token |

Measured, signed in, at 40 ms simulated RTT (median of 3 warm renders):

| Page | GoTrue `getUser` | `players` reads | Supabase calls | Render |
|---|---|---|---|---|
| `/g/<slug>` (Tonight, idle) | 1 | 1 | 10 | 257 ms |
| `/g/<slug>/admin` | 1 | 1 | 11 | 207 ms |
| `/g/<slug>/leaderboard` | 1 | 1 | 12 | 159 ms |
| `/g/<slug>/you` | 1 | 1 | 12 | 250 ms |
| anonymous, any | 0 | 0 | 0 to 9 | 4 to 137 ms |

Waterfall of one admin render (start..end in ms from the request):

```
r1  +7..72    GET /auth/v1/user            <- GoTrue: ~65 ms (40 simulated + ~25 GoTrue)
r2  +73..116  GET /rest/v1/players         <- by discord_id (both session helpers, memoised to one)
r3  +117..161 GET /rest/v1/group_memberships
r4  +162..210 eight reads of the admin page
```

The You page has the same three-link head. On Tonight, `getUser` runs beside `loadTonight`'s first
round. The viewer chain (`getUser` → `players` → `group_memberships`) still gates the start-press read
(`companion_commands` at +188 ms). Once M19's finding 3 makes the render shorter, that chain becomes
the critical path.

## 4. (b) Signing keys and what `getClaims()` does

What `getClaims()` (auth-js 2.115.0) does:

1. With no token argument, it calls `getSession()`, which reads the cookie. If the access token has
   expired, it refreshes, and that is a GoTrue round trip.
2. It rejects an expired `exp`.
3. If the header's `alg` starts with `HS`, or there is no `kid`, or WebCrypto is missing, it **falls
   back to `getUser(token)`**: the same GoTrue round trip and the same trust as today. An HS256
   project gains nothing and loses nothing.
4. Otherwise it fetches the project's JWKS (`/auth/v1/.well-known/jwks.json`) and verifies the
   signature locally with WebCrypto. The JWKS is cached for 10 minutes in a **module-global** map
   keyed by storage key, so a fresh client per request still hits the cache. A cold instance pays one
   JWKS fetch, which Supabase's edge also caches for 10 minutes.

Local stack, measured:

- JWKS has one key, `EC` / `ES256`. Access tokens are signed `ES256` with a `kid`, so local
  verification works here.
- Access-token claims: `iss, sub, aud, exp, iat, email, phone, app_metadata, user_metadata, role, aal,
  amr, session_id, is_anonymous`. There is **no `identities`**. `app_metadata` holds
  `provider`/`providers` but no provider id.

| Variant (fresh client per call) | p50 | p90 |
|---|---|---|
| `getUser(token)` | 19.46 ms | 21.69 ms |
| `getClaims(token)` (JWKS from the module cache) | 0.16 ms | 0.26 ms |
| `getClaims(token, { jwks })` (JWKS passed in) | 0.15 ms | 0.22 ms |

Locally there is no network, so the 19.5 ms is GoTrue's own work (it reads `auth.users`,
`auth.sessions` and `auth.identities`). Hosted, add the Vercel-to-Supabase RTT. The bench above,
modelling that RTT at 40 ms, put `getUser` at about 65 ms.

**The hosted project was not checked** (local only, by instruction). Supabase's announcements give two
dates: new projects get asymmetric keys by default from 2025-10-01, and some sources say from
2025-05-01. This project's hosted instance was linked in September 2026, so it is probably asymmetric,
but that is unverified. The owner can check without a key: open Dashboard → Project Settings → JWT
Keys, or request `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` (public). An `EC` or `RSA`
key there means local verification works. An empty list means the project is on the legacy HS256
secret, and `getClaims()` would just call `getUser()`.

## 5. (c) The revocation gap

Measured locally on the same token:

| After | `getUser` | `getClaims` |
|---|---|---|
| deleting every `auth.sessions` row of the user (what a global sign-out does) | `Auth session missing!` | valid claims |
| deleting the `auth.users` row | not measured (its sessions go with it) | valid claims |

`getClaims()` trusts a token until its `exp`: 3600 s on the local stack and Supabase's default. The
hosted value is in Dashboard → Authentication → Sessions / JWT expiry and was not checked. This is
what stays open for up to an hour:

- a session signed out on another device, or a cookie copied before sign-out;
- a deleted or banned auth user;
- a Discord identity unlinked from the auth user.

What does **not** stay open, because every gate reads it from our own tables per request with the
service role, whichever call is used:

- removal from a group or a demotion (`group_memberships`);
- an unlinked or re-linked player (`players.discord_id`);
- an operator dropped from `SUPER_ADMIN_USER_IDS` (env, read per request).

The task text frames the gap as "a removed or demoted member keeps access". That does not apply to
this codebase as long as roles are never put into the token.

**The bigger problem is identity, not revocation.** To key a player from the token, the code needs a
Discord id the user cannot write. The token has none. `user_metadata.provider_id` is user-writable,
and adopting it would be an account takeover: claim the owner's snowflake and get the owner's group.
Any adoption must map the verified `sub` (the auth user id) to a player by a server-side fact. There
are three ways:

1. `players.auth_user_id`, written when the player links. This is a schema change plus a backfill
   through `auth.identities`.
2. A custom access-token hook that copies `auth.identities.provider_id` into a signed claim. This is
   hosted Auth config plus a SQL function, and the claim is stale until the next refresh.
3. A `security definer` function, service-role only, given `(sub, session_id)`. It returns the player
   (and optionally the role in a group) only if the `auth.sessions` row still exists and has not
   expired, joining `auth.identities` for the Discord id. One database round trip replaces GoTrue +
   `players` (+ `group_memberships`). It **closes the revocation gap too**, because a deleted session
   row fails the lookup.

## 6. (d) Which reads could use claims, and the recommendation

**Could use verified claims (display only), but only with a server-side `sub` → player map (section
5), never `user_metadata`:**

- the layout's `Admin` tab and account link;
- Tonight's "you" border, the sit-out sentence, and which controls are drawn (Roll, Set mode, Start a
  lobby, role words). Every one of those controls posts to a route that re-verifies.

**Must keep a verified session (`getUser()`, or design 3 above, which checks the session row):**

- every write route: `/api/me/*`, `/api/admin/*`, `/api/groups/*`, `/api/ops/*`;
- every admin and owner check, including the group admin pages (`currentAdminAccess`). Those pages
  render invite codes, the member list and host tokens: member-only data, not display decisions;
- `/ops` and the `SUPER_ADMIN_USER_IDS` reads;
- the member-only reads on Tonight: the lobby password (M14.28) and the start-press read. Also M19.16's
  new status routes, `GET /api/me/lobbies/start/status` and `GET /api/me/recap/status`, which stay on
  `getUser()` (`lib/me/readRoute.ts`).

**Recommendation, in order:**

1. **Do not adopt `getClaims()` as a drop-in.** It reads a forgeable Discord id, or else it cannot
   identify anyone.
2. **No-trust-change win, now (platform or web, small): fold `players` and `group_memberships` into
   one query** in `currentViewerState` and `currentAdminAccess`. Embed the membership for the asked
   group, as `lib/me/readRoute.ts`'s `supabaseMemberLookup` already does for M19.16. This saves one of
   the three sequential links (about 44 ms at 40 ms RTT) on every signed-in admin, You and Tonight
   render, and needs no review because it changes no trust.
3. **Optional, under M19.12's "may land without review" clause: one shared `cache()`d verified user**
   for `currentSessionPlayer` and `currentPageSession`. Today it gains nothing measurable because fetch
   memoisation already folds the duplicate. It is worth doing only if one of them moves out of the RSC
   render, for example into a route handler or `generateMetadata` with different options.
4. **If the owner wants the GoTrue round trip gone, propose a new task: "Verified session lookup".**
   Design 3 above: `getClaims()` (local ES256 verification), then one `security definer` RPC on
   `(sub, session_id, groupId)` returning player and role. That is one database round trip instead of
   three sequential ones, with session revocation still instant. About 105 ms saved per signed-in
   admin or You render at 40 ms RTT. It needs a migration (a `public` function reading `auth.sessions`
   and `auth.identities`, `revoke ... from anon, authenticated`), the owner confirming the hosted
   project's keys are asymmetric (section 4), a decision row, and the reviewer's security pass. It
   falls back to `getUser()` on an HS256 project, so it is safe to ship before the key check, but it
   only pays off after it.

Proposed decision row (for the lead to add only if the owner chooses option 4):

> 2026-10-xx | Signed-in renders verify the session by local JWT verification (`getClaims()`,
> asymmetric project keys) plus one service-role `security definer` lookup on the token's `sub` and
> `session_id` that requires a live `auth.sessions` row and maps `auth.identities` (Discord) to the
> player. `user_metadata` is never an identity. Writes and admin checks use the same lookup, so
> revocation stays immediate. | M19.12 finding

## Sources

- `@supabase/auth-js` 2.115.0, `dist/main/GoTrueClient.js`: `getClaims` (line 5335), `fetchJwk` (line
  5238), `GLOBAL_JWKS` (line 49), `JWKS_TTL = 10 min` (`lib/constants.js`).
- [JWT Signing Keys (Supabase docs)](https://supabase.com/docs/guides/auth/signing-keys)
- [Introducing JWT Signing Keys (Supabase blog)](https://supabase.com/blog/jwt-signing-keys)
- [Supabase Auth: Asymmetric Keys support in 2025](https://github.com/orgs/supabase/discussions/29289)
