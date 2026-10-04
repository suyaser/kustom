# Runbook: move the hosted project to asymmetric JWT signing keys

**Status: ready for the owner.** Written 2026-10-04 by `platform-engineer` on branch `auth-local-claims`, from the
Supabase docs as of that date (sources at the end). **Who runs it: the owner, every step.** No agent touches the
hosted project, the dashboard or Vercel.

## Why

Since `0038_session_player.sql` the web app verifies a signed-in request in two steps: `auth.getClaims()` checks
the access token's signature, then one service-role call (`public.session_player`) checks that the session row is
still live and maps the Discord identity to the player and their role. What `getClaims()` costs depends on how the
project signs tokens:

| Project signs with | `getClaims()` does | Cost per signed-in render |
|---|---|---|
| legacy shared secret (HS256) | falls back to `getUser()`: a GoTrue round trip | same as before the change |
| asymmetric key (ES256 / RS256) | verifies locally with the public key (JWKS, cached 10 minutes) | no GoTrue round trip |

So the code ships safely before this runbook (nothing gets slower, nothing breaks), and this runbook is what turns
the speedup on. Measured locally with 40 ms added to every Supabase call: see "Expected effect" at the end.

## 0. Before you start: check where the project is

1. Open `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` in a browser (public, no key; the ref
   is in `packages/db/supabase/.temp/project-ref`).
   - `{"keys":[]}`: the project is on the legacy secret. Do this runbook.
   - a key with `"kty":"EC"` (or `"RSA"`) and a `kid`: it already has an asymmetric key. Open Dashboard → Project
     Settings → **JWT Keys** and check which key is **Current**. If the EC/RSA key is Current, skip to step 4
     (verify). If it is only **Standby**, go to step 3 (rotate).
2. Dashboard → Authentication → Sessions (or Project Settings → JWT Keys): note the **access token expiry**
   (JWT expiry). Default 3600 s. You need it for the wait in step 5.
3. Make sure **0038 is applied on hosted before the code that uses it is deployed** (section "Order with the
   deploy" below). The key migration itself does not depend on 0038 and can be done before or after.

## 1. Confirm the database half on hosted (SQL editor, read only)

The lookup is a `security definer` function owned by `postgres`. Locally `postgres` can read the three auth tables
(checked 2026-10-04: `has_table_privilege` true for `auth.sessions`, `auth.identities`, `auth.users`; `postgres` has
`BYPASSRLS`). Supabase has tightened what `postgres` may do in the `auth` schema over time, so confirm hosted before
you rely on it. In Dashboard → SQL Editor:

```sql
select has_table_privilege('postgres', 'auth.sessions',   'select') as sessions,
       has_table_privilege('postgres', 'auth.identities', 'select') as identities,
       has_table_privilege('postgres', 'auth.users',      'select') as users;
```

All three must be `true`. If any is `false`, stop and tell the lead: `0038` would fail closed (every signed-in
person reads as signed out and every admin route answers 401), so the code must not be deployed.

After `0038` is pushed (`pnpm db:migrate`), check it on hosted with your own session:

```sql
-- owner and settings
select pg_get_userbyid(proowner) as owner, prosecdef, provolatile, proconfig, proacl
from pg_proc where proname = 'session_player';
-- expect: postgres | t | s | {search_path=""} | {postgres=X/postgres,service_role=X/postgres}

-- your newest session answers with your player and role (replace the email)
select sp.*
from auth.users u
join lateral (select id from auth.sessions s where s.user_id = u.id order by s.created_at desc limit 1) s on true
cross join lateral public.session_player(u.id, s.id, (select id from public.groups where slug = 'customs')) sp
where u.email = '<your sign-in email>';
-- expect one row: your Discord id, your player id, puuid, display name, role 'owner'
```

If `proacl` shows `anon` or `authenticated`, stop: the grants did not apply as written.

## 2. Migrate the legacy secret (no effect on anyone yet)

Dashboard → Project Settings → **JWT Keys** → **Migrate JWT secret**.

This imports the existing legacy secret into the signing-keys system (it stays the key that signs tokens) and
creates a new asymmetric key in **Standby** (pick **ECC (P-256)** if asked; it is the recommended default and
what the local stack uses). A standby key is published in the JWKS but signs nothing yet.

- Sessions: untouched. Tokens are still signed with the legacy secret.
- `anon` / `service_role` API keys: keep working (they are JWTs signed by the legacy secret, which is still
  trusted).
- Downtime: none.

Re-open the JWKS URL: it now lists the standby EC key (the legacy HS256 secret is symmetric and is never
published there).

## 3. Rotate to the asymmetric key

Pre-flight (all true for this repo on 2026-10-04): nothing verifies Supabase JWTs with the legacy secret.
The web app uses `getClaims()` / `getUser()`; the companion uses its own bearer tokens against our API; the
Discord bot uses webhooks; there are no Supabase Edge Functions. (`SUPABASE_LOCAL_JWT_SECRET` in `.env.example`
is for the local stack's integration tests only and is unaffected.)

Dashboard → Project Settings → **JWT Keys** → **Rotate keys**.

- The EC key becomes **Current**: every token GoTrue issues from now on (sign-in and every refresh) is ES256 with
  a `kid`.
- The legacy secret moves to **Previously used** and is **still trusted**: every token already issued stays valid
  until it expires, so nobody is signed out. The app verifies those older HS256 tokens through `getUser()` (the
  auth-js fallback) until they age out, then everything is local.
- `anon` / `service_role` API keys: keep working, because the legacy secret is still trusted while it is
  "Previously used". Nothing in Vercel or `.env.local` changes for this step.
- Downtime: none.

## 4. Verify

1. JWKS URL: lists the EC key; Dashboard shows it as **Current**.
2. Sign out and in again at the production site, then on `/g/customs/admin`: the page loads as owner.
3. Optional proof of the speedup, in Vercel → the deployment → Logs, or with the browser's network panel: a
   signed-in render no longer waits on `GET /auth/v1/user`. In the Supabase dashboard → Logs → Auth, `/user`
   requests from the server drop to near zero after an hour (the old tokens' lifetime).
4. Decode a fresh access token's header (browser devtools, the `sb-…-auth-token` cookie, base64 part before the
   first dot): `"alg":"ES256"` and a `"kid"` matching the JWKS.

## 5. Optional, later: retire the legacy secret and the legacy API keys

You do **not** need this for the speedup. Supabase is deprecating the legacy `anon` / `service_role` keys by the
end of 2026, so plan it before then. Revoking the legacy secret requires disabling the legacy API keys first
(they are JWTs signed by it).

1. Dashboard → Project Settings → **API Keys**: create a **publishable** key (`sb_publishable_…`) and a **secret**
   key (`sb_secret_…`) if they are not there.
2. Put them into the **existing** variable names, so no code changes (supabase-js 2.115 accepts both formats;
   `lib/env.ts` only checks the values are non-empty):

   | Where | Variable | New value |
   |---|---|---|
   | Vercel (Production, Preview, Development) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `sb_publishable_…` key |
   | Vercel (Production, Preview, Development) | `SUPABASE_SERVICE_ROLE_KEY` | the `sb_secret_…` key |
   | `apps/web/.env.local` (this Mac; read by `mint-token`, `set-premium --hosted`, `rebuild-ratings --hosted`) | same two | same values |

   `NEXT_PUBLIC_*` is inlined at build time: **redeploy** after changing it (Vercel → Deployments → Redeploy,
   without the build cache). The secret key is refused by Supabase when sent from a browser (it matches the
   User-Agent), which is fine: it is server only here.
3. Smoke test the redeploy: Tonight renders anonymously (publishable key reads), sign in works, an admin action
   works (service role), a companion post lands (service role).
   **Not checked by an agent:** that the Realtime subscriptions on Tonight keep updating with the publishable
   key. Watch one live lobby change before going on.
4. Dashboard → API Keys → **disable** the legacy `anon` and `service_role` keys. Reversible: re-enable them if
   something you missed breaks.
5. Wait at least the access token expiry plus a margin since step 3 (1 h 15 min for the default 3600 s), so no
   live token is still signed by the legacy secret.
6. Dashboard → JWT Keys → the legacy secret (Previously used) → **Revoke**. From now on only the EC key is
   trusted.

## Rollback

Every key action except deletion is reversible.

- After step 3, if anything misbehaves: Dashboard → JWT Keys → move the legacy secret from **Previously used**
  back to **Standby**, then **Rotate keys** to it. New tokens are HS256 again; `getClaims()` goes back to its
  `getUser()` fallback with no code change. Tokens issued in between stay valid while the EC key is "Previously
  used".
- After step 5.4: re-enable the legacy API keys and put the old values back into the env vars (redeploy).
- After step 5.6: a revoked key can be moved back to Standby (Supabase allows it from Previously used or Revoked)
  and rotated to, as above.
- The code needs no rollback for any of this. If `0038` itself must go, that is a code revert first (the gates
  call it), then `drop function public.session_player(uuid, uuid, uuid);` in a new migration.

## Order with the deploy

- `0038` before the code. The gates call `session_player` on every signed-in request; deployed without it, every
  signed-in page reads as signed out and admin routes answer 500. `pnpm db:migrate` first, check section 1, then
  deploy.
- `0038` is numbered after `0036` (branch `kustom-rating`) and `0037` (branch `m19-9-live`). If hosted is
  missing either when you push, `supabase db push` lists them as pending and applies them in order; if `0038`
  lands while `0036`/`0037` are not yet merged, the push needs `--include-all` later to apply the lower numbers.
  `0038` depends on neither.
- The key migration (steps 2 to 4) is independent of both and can happen before or after the deploy.

## What stays open, and for how long (residual windows)

- **A revoked signing key**: a warm server instance keeps the JWKS for up to 10 minutes (auth-js's in-memory
  cache; Supabase's edge caches the JWKS for 10 minutes too), so it still accepts a token signed by a key you just
  revoked for that long. The token must still name a live session row, so this matters only for a leaked private
  key, which Supabase never hands out.
- **Signed out elsewhere, deleted, banned, Discord unlinked, removed from the group, demoted**: immediate, the
  same as before. `session_player` reads `auth.sessions`, `auth.users`, `auth.identities` and
  `group_memberships` on every request.
- **Email and Discord display name**: read from the token, so a change shows after the next refresh (at most the
  access token expiry). Display only; no decision reads them.
- **Session inactivity timeout** (a paid-plan setting, if ever enabled): enforced by GoTrue when the token is
  refreshed, as it was with `getUser()`; `session_player` checks the time-box (`not_after`) itself.

## Expected effect

Measured 2026-10-04 on the local stack (ES256 keys, like hosted after step 3) with 40 ms added to every Supabase
call (`scripts/perf/preload.mjs`, `PERF_SB_DELAY_MS=40`), `next start` builds of `origin/main` (before) and
`auth-local-claims` (after), signed in as the owner of a scratch group, server render time, median of 9 warm
renders:

| Page | Before | After | GoTrue calls | Supabase calls |
|---|---|---|---|---|
| `/g/<slug>` (Tonight, idle) | 262 ms | 149 ms | 1 → 0 | 10 → 9 |
| `/g/<slug>/admin` | 215 ms | 101 ms | 1 → 0 | 11 → 10 |
| `/g/<slug>/you` | 278 ms | 145 ms | 1 → 0 | 12 → 11 |
| `/g/<slug>/leaderboard` | 173 ms | 138 ms | 1 → 0 | 12 → 11 |

Until step 3 is done the hosted project stays close to the "before" column: `getClaims()` falls back to the
GoTrue `/user` call, and the lookup still saves the `players` → `group_memberships` link after it (not measured:
the local stack only signs with ES256).

## Sources

- [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys): Migrate JWT secret, Rotate keys, key
  states, no forced sign-outs, revoke after expiry plus margin, disable legacy API keys before revoking, JWKS
  10-minute caching, reversibility.
- [Understanding API keys](https://supabase.com/docs/guides/api/api-keys): publishable and secret keys, legacy
  keys deprecated by the end of 2026, disabling is reversible, secret keys refused from browsers.
- [JSON Web Token (JWT)](https://supabase.com/docs/guides/auth/jwts): JWKS endpoint, `getClaims()`.
- `@supabase/auth-js` 2.115.0 `GoTrueClient.getClaims` / `fetchJwk`: the HS256 / no-`kid` / unknown-`kid`
  fallback to `getUser()`, `JWKS_TTL` 10 minutes, module-wide cache.
