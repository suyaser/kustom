# Runbook: ship Kustom 2.0 (M14.27)

**Status: DRAFT.** Written 2026-10-03 by `platform-engineer` from the migrations on `redesign-2.0` up to
`0025`; the three later migrations are filled in (M14.14 `0026_remove_seasons.sql`, M14.18
`0027_ratings_reset.sql`, M14.28 `0028_lobby_password_private.sql`). Do not run this until M14.26 (milestone
review) is done. **Updated 2026-10-04** for everything merged into `redesign-2.0` since: `0029`..`0035` (M14.40,
M14.46, M16.2 premium flag, M15.3 mode of the night, M16.3 AI lines, M14.58 fold breakdown, M15.17 region no-draw),
`ANTHROPIC_API_KEY` and the AI kill switch, the post-push one-offs (3.7), and the M14.61 Discord check (3.9).

**Who runs it: the user, every step.** No agent applies a migration, pushes `main`, changes a Vercel setting or
publishes a release. Commands assume zsh on this Mac, the repo at `/Users/suyaser/lol`, and the Supabase CLI
already linked to the hosted project in `packages/db` (it is: `packages/db/supabase/.temp/project-ref`).

Starting state (lead, 2026-10-03): production runs **M13.4's code** (`05278f5`, on `origin/main`) and hosted has
**`0020` applied** (the user ran `pnpm db:migrate`; verified with `supabase migration list --linked`). What ships,
in one deploy (the user, 2026-10-03): `main`'s unpushed commits (M13.5 + `0021`, M13.9, the backfill-gate removal
`1a5bd27`) and all of `redesign-2.0` (M14, M15, M16 so far; migrations `0022`..`0035`).
Kustom 0.4.0 is skipped (the user, 2026-10-03); the Rust Kustom 1.0 ships on its own track (`docs/runbooks/companion-release.md`).

---

## 0. The facts the order is built from

| Migration | What it does | Old code on the new schema | New code on the old schema | Class |
|---|---|---|---|---|
| `0020` (M13.4) | already applied on hosted, under M13.4 code (both live). Not part of this deploy | | | done |
| `0021` (M13.5) | adds `group_invites`, `pairing_codes`, `pairing_attempts`, five functions; gives every existing group an invite | fine under M13.4 code (nothing reads them) | 500 on the seven create/join/pair routes | **migration first** |
| `0022` (M14.5) | RLS read policies on `group_memberships`, `group_invites`; two helpers | fine | fine (nothing reads through them yet) | either |
| `0023` (M14.11) | role check widens to `owner`; one-owner index; owner backfill; new `bootstrap_admin` makes the `BOOTSTRAP_ADMIN_PUUID` player **owner** of `customs`; **drops `set_group_member_role`**; adds `_v2`, transfer, remove | **M13.4 code breaks for the owner**: its admin gate checks `role = 'admin'` exactly, so the moment `bootstrap_admin` makes you `owner`, M13.4 code shuts you out of every admin route and page; its role toggle 500s (function gone). | owner/role/remove routes 500 | **ship with the code, same window** |
| `0024` (M14.29) | `modes`, `group_modes` (Realtime), `games.mode` + stamping trigger; every stored game backfilled `fearless` | fine (trigger stamps every insert) | Tonight and the fearless pool read fail | **migration first** |
| `0025` (M14.20) | `discord_connect_states`; `discord_config.test_post_at/_error` + clearing trigger | fine | `/admin` Discord reads and the connect callback fail | **migration first** |
| `0026_remove_seasons.sql` (M14.14) | in one transaction, after a guard that aborts unless exactly one season is active: deletes the non-active seasons' `daily_mysteries` (and their clues, sessions, attempts by cascade), `games` (and their `game_players` by cascade) and `ratings`; drops `games.season_id` and its index, rebuilds `ratings_pkey` as `(group_id, player_id)` in the same ALTER that drops `ratings.season_id`; adds `games_group_started_at_idx` and `ratings_group_ordinal_idx`; drops `start_season`, `set_active_season`, `active_season_id()` and `seasons`. RLS, grants, triggers and the Realtime publication unchanged | **all old code breaks** (board, ingest fold, balance, rebuild, Tonight all read seasons) | **new code breaks** (ratings rows are written without `season_id`, upserted on `group_id,player_id`) | **window; point of no return (deletes data)** |
| `0027_ratings_reset.sql` (M14.18) | in one transaction: `groups.ratings_since` (null), `groups_public` gains it, `reset_group_ratings(group, actor, now)` (owner only, under the group row lock; refused while a lobby is live or a game landed in the last 15 minutes) | fine (additive) | fine: the code reads a missing `ratings_since` as "never reset" | either |
| `0028_lobby_password_private.sql` (M14.28) | in one transaction: anon and authenticated lose table-wide SELECT on `lobbies` and get SELECT on every column except `lobby_password` (column privileges). RLS, the read policy and the Realtime publication unchanged; anon Realtime payloads stop carrying the password | **breaks the old Tonight page** (M13.4 code selects `lobby_password` with the anon key: 42501) | fine (2.0 reads the password with the service role, for members only) | **window** |
| `0029_admin_ids_private.sql` (M14.40) (accepted and applied locally 2026-10-03) | in one transaction: anon and authenticated lose table-wide SELECT on `group_modes` and `fearless_state` and get SELECT on every other column (column privileges, the 0028 pattern). `group_modes.set_by` and `fearless_state.reset_by` (players ids that `players_public` turns into an admin's name) stop being public. RLS, the read policies and the Realtime publication unchanged | fine (M13.4 code has no `group_modes`; its fearless read names `reset_at`, checked at `05278f5`) | fine (2.0's anon reads name `mode, updated_at` and `reset_at`; the writes are service role) | either |
| `0030_new_groups_start_normal.sql` (M14.46) (applied locally 2026-10-04) | in one transaction: `group_modes.mode`'s column default `'fearless'` -> `'normal'`, and `groups_insert_mode()` (the trigger that gives a new group its row) inserts `mode = 'normal'` by name. **No existing row is updated**: `customs` and every group created before it keep their mode. `games_stamp_mode()`'s no-row fallback stays `fearless` | fine (M13.4 code has no `group_modes`) | fine: a group created before 0030 lands is born on Fearless, the 0024 behaviour; the app reads a group with no row as Normal (`NEW_GROUP_MODE`) and a failed read as Fearless | either |
| `0031_premium_flag.sql` (M16.2) (applied locally 2026-10-04) | in one transaction: `groups.premium` (false for **every** group, `customs` included), `groups.premium_changed_at` (null; stamped only by the new `groups_stamp_premium_changed_at` trigger when the flag flips), `groups.ai_monthly_cap_usd` (2.00, check 0..100); repeats `revoke all on groups from anon, authenticated`. `groups_public` unchanged | fine (new columns have defaults; the trigger only stamps its own column) | `/ops`, `set-premium` and every AI gate (`lib/premium.ts`) read a missing column and fail | **migration first** (additive) |
| `0032_mode_of_the_night.sql` (M15.3) (applied locally 2026-10-04) | in one transaction: `modes` gains `rated_default` and the rows `class`, `region`, `mirror`; `group_modes` gains `pending_rule`, `pending_class_tag`, `rated_override`, `version`, `pending_set_by` and a check that `mode` is `normal` or `fearless` (validated against existing rows); `lobbies` gains eight `lock_*` columns (anon-granted) and the `lobbies_drop_mode_lock` trigger (balanced -> open clears the lock); `games` gains `rule`, `rule_class_tag`, `rule_region_*`, `rated` (**true** for every existing game), `rule_checked`, `rule_check`; `games_stamp_mode()` now prefers the lobby's `lock_mode`, and its no-row fallback becomes `normal` (was `fearless`; every hosted group has a row from 0024). `pending_set_by` is not granted to anon (0029's rule) | fine: M13.4 inserts games without `mode`, the trigger finds no lock (all null) and falls back to `group_modes` exactly as under 0024; the balanced -> open trigger clears columns that are already null | Roll teams (writes the lock), ingest (`lib/mode/record.ts` stamps `rule`/`rated`), the Mode card and Tonight fail | **migration first** (additive) |
| `0033_ai_lines.sql` (M16.3) (applied locally 2026-10-04) | in one transaction: `groups.ai_lines_enabled` (true), `group_memberships.ai_opt_out` (false); new tables `ai_settings` (one row: `calls_enabled = true`, `global_monthly_cap_usd = 20.00`), `ai_lines` (status machine trigger), `ai_calls` (the spend ledger); functions `ai_month_spend`, `ai_reserve_call` (advisory lock; refuses unless kill switch on, group Premium, lines on, both caps fit), `ai_settle_call`. Every new table: RLS on, no policy, revoked from anon and authenticated; the three functions execute for `service_role` only. Repeats the `groups` revoke and revokes insert/update/delete on `group_memberships` from client roles (already their state since 0018/0022) | fine (M13.4 reads none of it and writes `group_memberships` with the service role) | AI reads, the admin `AI lines` switch and the You page's `Write about me` read fail | **migration first** (additive) |
| `0034_fold_breakdown.sql` (M14.58, M14.59) (applied locally 2026-10-04) | in one transaction: `game_players` gains `fold_p`, `base_mu_after`, `award`, `rated_games_before`, all nullable with no default, plus two checks (the three breakdown columns together or not at all; none outlives `mu_after`). Every existing row reads null until a `rebuild-ratings` **write** fills it (3.7); the web shows `explainLegacyDelta`'s fallback sentence for an unfilled row. No RLS change (`game_players` is already a public read) | fine: M13.4's fold writes `mu_after` without a breakdown, which both checks allow | **game ingest fails**: the live fold (`lib/ingest/rating.ts`) writes `fold_p`/`base_mu_after` in the same update as `mu_after`, so a game posted before 0034 is refused | **migration first** (strictly: 2.0 code must never run without it) |
| `0035_region_no_draw.sql` (M15.17) (applied locally 2026-10-04) | in one transaction: `lobbies.lock_no_draw` (false, anon-granted, check: only with a standing lock) and `games.rule_no_draw` (false, check: only with `rule` null); `lobbies_drop_mode_lock()` replaced to also reset `lock_no_draw` | fine (defaults; M13.4 never names them) | Roll's lock write and ingest's stamp (`lib/mode/lock.ts`, `lib/mode/record.ts`) name the columns and fail | **migration first** (additive) |
| `0036_kustom_rating.sql` (M18.4) | **Not part of this deploy**: the M18 Kustom rating switch, its own runbook `docs/runbooks/kustom-rating.md`, after this one. Additive (Kustom columns, `ratings.r`, `splits.odds_model`) | fine | the switch build fails without it | **migration first** (kustom-rating.md step 1) |
| `0043_apply_game_player_ratings.sql` (M18.10) | **Not part of this deploy**: same runbook. Additive (one function: a fold's `game_players` writes in one statement); needs `0036`; `0037`..`0042` belong to other runbooks and need not precede it | fine | game posts and the rebuild fail | **migration first** (kustom-rating.md step 1) |

All three files were checked on a throwaway restore of local, in order, by
`packages/db/scripts/m14-14-throwaway-check.sh 0026 0027 0028` (plus `m14-18-reset-check.sql` and
`m14-28-password-check.sql`): active-season rows identical by hash before and after, every check passed.
`0034` was checked the same way by `packages/db/scripts/m14-58-throwaway-check.sh` (applies, a second apply fails
cleanly, every existing row null, the checks refuse a partial breakdown, anon still reads through the one policy).
`0029`..`0035` are applied on the local stack (top version `0035`), and every post-check SQL below was run there
read-only on 2026-10-04.

**`0031`..`0035` change nothing about the order.** All five are additive, carry their own `begin; … commit;` (a
failure rolls the whole file back, unlike `0021`..`0025`), and are fine under M13.4 code; 2.0 code needs every one
of them (`0034` most sharply: without it no game can be recorded). They go in the same push, after `0030`.

**Conclusion.** The hosted sequence starts at `0021`. No migration in `0021`..`0035` needs code first. `0023` (it
locks the owner out of M13.4's admin gate) and the seasons drop break the running M13.4 code, and 2.0 code needs
every migration. So there is no gap-free order: **a short quiet window, migrations first, then the code at once.**
Old code runs on the new schema for the length of one Vercel production build (a few minutes). Nothing played in
that gap is lost for good: backfill recovers games.

---

## 1. Pre-flight (days before; nothing here changes production)

### 1.1 Back up hosted

Docker must be running (the CLI runs `pg_dump` in a container). It asks for the database password, or reads
`SUPABASE_DB_PASSWORD`. Keep the dumps **outside the repo**: they hold webhook URLs, token hashes and auth users.

```sh
export BACKUP=~/kustom-backups/ship-2.0-$(date +%Y%m%d-%H%M)
mkdir -p "$BACKUP" && chmod 700 "$BACKUP"
cd /Users/suyaser/lol/packages/db
supabase db dump --linked --role-only -f "$BACKUP/roles.sql"
supabase db dump --linked             -f "$BACKUP/schema.sql"
supabase db dump --linked --data-only --use-copy -f "$BACKUP/data.sql"
ls -la "$BACKUP" && grep -c '^COPY ' "$BACKUP/data.sql"
grep -n '^COPY public.games \|^COPY public.ratings \|^COPY auth.users ' "$BACKUP/data.sql"
```

All three files non-empty and the three `COPY` lines present, or stop. Repeat this dump in the window (3.2): that
one is the restore point. If the project is on a paid plan, also note the time of the latest dashboard backup
(Database → Backups).

### 1.2 Production code

Vercel → Deployments → **Production / Current** should be `05278f5` or a later `origin/main` commit (M13.4). If it
is anything else, stop and report: the order below assumes M13.4 code is live.

### 1.3 What hosted has applied

```sh
cd /Users/suyaser/lol/packages/db
supabase migration list --linked
```

Expected: Local and Remote agree up to and including `0020`; Remote has nothing from `0021` on.
Anything Remote has that Local does not, or a gap below `0019`: **stop** (`db push` would need `--include-all`,
which is not part of this plan). Then see exactly what a push would do, without doing it:

```sh
supabase db push --linked --dry-run
```

It must list `0021` through `0035`, in number order, and nothing else.

### 1.4 The seasons drop counts (M14.14 step 1)

Supabase dashboard → SQL editor, on hosted. Read-only. Save the output beside the backup.

Read-only; the same query is `packages/db/scripts/m14-14-season-drop-counts.sql`.

```sql
with
  a as (select id from public.seasons where is_active),
  dg as (select id from public.games where season_id not in (select id from a)),
  dm as (select id from public.daily_mysteries where game_id in (select id from dg))
select 'active seasons (must be 1)' as what, count(*)::bigint as n from a
union all select 'active season id: ' || coalesce((select id::text from a limit 1), 'NONE'), null
union all select '-- DROP --', null
union all select 'seasons to drop', count(*) from public.seasons where id not in (select id from a)
union all select 'games to drop', count(*) from dg
union all select 'game_players to drop (cascade)', count(*)
  from public.game_players where game_id in (select id from dg)
union all select 'daily_mysteries to drop (restrict; deleted first)', count(*) from dm
union all select 'daily_mystery_clues to drop (cascade)', count(*)
  from public.daily_mystery_clues where challenge_id in (select id from dm)
union all select 'daily_mystery_sessions to drop (cascade)', count(*)
  from public.daily_mystery_sessions where challenge_id in (select id from dm)
union all select 'daily_mystery_attempts to drop (cascade)', count(*)
  from public.daily_mystery_attempts where challenge_id in (select id from dm)
union all select 'ratings to drop', count(*) from public.ratings where season_id not in (select id from a)
union all select '-- KEEP --', null
union all select 'games kept', count(*) from public.games where season_id in (select id from a)
union all select 'game_players kept', count(*)
  from public.game_players gp join public.games g on g.id = gp.game_id where g.season_id in (select id from a)
union all select 'daily_mysteries kept', count(*) from public.daily_mysteries where game_id not in (select id from dg)
union all select 'ratings kept', count(*) from public.ratings where season_id in (select id from a)
union all select 'ratings kept: duplicate (group_id, player_id) keys (must be 0)', count(*) from (
    select 1 from public.ratings where season_id in (select id from a)
    group by group_id, player_id having count(*) > 1
  ) d
union all select 'ratings kept: round(sum(mu) * 1000)', round(coalesce(sum(mu), 0) * 1000)::bigint
  from public.ratings where season_id in (select id from a)
union all select 'ratings kept: round(sum(sigma) * 1000)', round(coalesce(sum(sigma), 0) * 1000)::bigint
  from public.ratings where season_id in (select id from a);
```

`active seasons (must be 1)` must be exactly **1** and `ratings kept: duplicate (group_id, player_id) keys` must
be **0**, or stop and report (0026's guard would abort on the first; the new primary key would fail on the second).
Save the two `round(sum(...) * 1000)` lines: 3.5 compares against them. You approve
the drop counts here; the window re-runs the query and they must match (allowing for games played since).

Also save this snapshot, to compare after the deploy:

```sql
select 'games' t, count(*)::text v from games
union all select 'game_players', count(*)::text from game_players
union all select 'players', count(*)::text from players
union all select 'lobbies', count(*)::text from lobbies
union all select 'live companion tokens', count(*)::text from companion_tokens where revoked_at is null
union all select 'active-season ratings', count(*)::text from ratings
  where season_id = (select id from seasons where is_active)
union all select 'active-season sum(mu)', round(sum(mu)::numeric, 6)::text from ratings
  where season_id = (select id from seasons where is_active)
union all select 'active-season sum(sigma)', round(sum(sigma)::numeric, 6)::text from ratings
  where season_id = (select id from seasons where is_active)
union all select 'customs memberships by role', string_agg(role || '=' || n, ', ') from
  (select role, count(*) n from group_memberships
   where group_id = '00000000-0000-0000-0000-000000000001' group by role) r;
```

### 1.4b Pre-checks that run on the `0020` schema (read-only, SQL editor on hosted)

Only checks that can run **before** the push live here: hosted is at `0020`, so anything a migration in the push
creates (`group_modes` from `0024`, for one) cannot be read yet, and the checks on those are post-only (3.3, 3.5).

**Names free, `0028`'s starting point.** None of these objects can exist yet; this proves nobody made one by hand (a
name clash would abort the file, and with it everything after it in the push). The `0028` line proves the anon key
can still read the password column, so 3.3's `false` afterwards is `0028`'s doing. Every line must read as stated:

```sql
select 'anon reads lobbies.lobby_password (0028 pre-check; must be true)' t,
  has_column_privilege('anon', 'public.lobbies', 'lobby_password', 'select')::text v
union all select 'groups: premium / premium_changed_at / ai_monthly_cap_usd / ai_lines_enabled (must be 0)',
  count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'groups'
    and column_name in ('premium', 'premium_changed_at', 'ai_monthly_cap_usd', 'ai_lines_enabled')
union all select 'group_memberships.ai_opt_out (must be 0)', count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'ai_opt_out'
union all select 'ai_settings / ai_lines / ai_calls (must be null null null)',
  coalesce(to_regclass('public.ai_settings')::text, 'null') || ' ' ||
  coalesce(to_regclass('public.ai_lines')::text, 'null') || ' ' ||
  coalesce(to_regclass('public.ai_calls')::text, 'null')
union all select 'game_players fold breakdown columns (must be 0)', count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'game_players'
    and column_name in ('fold_p', 'base_mu_after', 'award', 'rated_games_before')
union all select 'games rule / rated / rule_no_draw columns (must be 0)', count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'games'
    and column_name in ('rule', 'rated', 'rule_checked', 'rule_check', 'rule_no_draw')
union all select 'lobbies lock_* columns (must be 0)', count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'lobbies' and column_name like 'lock\_%';
```

`0032`'s new check on `group_modes.mode` (only `normal` or `fearless`) is validated against the rows that exist when
it runs. On hosted those rows are made in the same push, by `0024` (every group, default `fearless`), with nothing
writing `group_modes` in between (M13.4 code has no such table), so it cannot fail there. If you ever apply `0032`
on its own, run `select mode, count(*) from group_modes group by mode;` first: anything but `normal` and
`fearless` aborts the file.

**What the hosted rebuild will see (3.6, 3.7a).** `rebuild-ratings` folds **every group** by default, so this is per
group. It finds the active-season games the fold's gate accepts (`apps/web/lib/ingest/fold.ts`'s `gateRatedGame`: a
winner, longer than 300 s, Rift (`CLASSIC` or no mode), five a side, ten rows; every stored game is `rated` after
`0032`, and no group has a `ratings_since` after `0027`; `0026` keeps exactly the active season's games), and the
things that make a rebuild write a ratings row without any rating maths having changed. Save the output beside the
backup; 3.6 reads its dry run against it.

```sql
with
  a as (select id from public.seasons where is_active),
  eg as (
    select g.id, g.group_id, g.lcu_game_id, g.started_at
    from public.games g
    where g.season_id in (select id from a)
      and g.winning_side in (100, 200)
      and g.duration_s > 300
      and (case when jsonb_typeof(g.raw -> 'gameMode') = 'string'
                then upper(trim(g.raw ->> 'gameMode')) else '' end) in ('', 'CLASSIC')
      and (select count(*) filter (where gp.side = 100) from public.game_players gp where gp.game_id = g.id) = 5
      and (select count(*) filter (where gp.side = 200) from public.game_players gp where gp.game_id = g.id) = 5
      and (select count(*) from public.game_players gp where gp.game_id = g.id) = 10
  ),
  ep as (select distinct eg.group_id, gp.player_id
         from eg join public.game_players gp on gp.game_id = eg.id)
select gr.slug,
  (select count(*) from eg where eg.group_id = gr.id) as eligible_games,
  (select count(*) * 10 from eg where eg.group_id = gr.id) as expected_breakdowns_n,
  (select count(*) from eg where eg.group_id = gr.id and exists (
     select 1 from public.game_players gp where gp.game_id = eg.id and gp.mu_after is null)) as eligible_null_mu_after,
  (select string_agg(eg.lcu_game_id::text || ' (' || eg.started_at::date || ')', ', ' order by eg.started_at)
     from eg where eg.group_id = gr.id and exists (
     select 1 from public.game_players gp where gp.game_id = eg.id and gp.mu_after is null)) as which_games,
  (select count(*) from public.ratings r where r.group_id = gr.id
     and r.season_id in (select id from a) and r.seed_mu is null) as ratings_seed_mu_null,
  (select count(*) from ep where ep.group_id = gr.id and not exists (
     select 1 from public.ratings r where r.group_id = gr.id and r.player_id = ep.player_id
       and r.season_id in (select id from a))) as players_with_no_ratings_row
from public.groups gr
order by gr.slug;
```

How to read it (per group):
- `expected_breakdowns_n` is the **N** of 3.6: every row of an eligible game gets a breakdown for the first time.
  Games recorded after the deploy and before 3.6 already carry one from the live fold, so they lower the dry run's N
  by ten each.
- `eligible_null_mu_after` (listed in `which_games`): eligible games stored **unrated**, normally backfills that never
  had a rebuild. The rebuild folds them, so ratings move and the dry run's ratings count is non-zero. Benign, and
  expected exactly when this is non-zero.
- `ratings_seed_mu_null`: ratings rows from before `0012` with no stored seed. The rebuild writes the seed it folded
  from into each, so each counts as a changed ratings row (and in `seeds N to store`) with the same numbers. Benign.
- `players_with_no_ratings_row`: players in eligible games with no ratings row; the rebuild inserts one (a first
  rating and a stored seed). Benign, and it shows as `first ratings for N players` on the biggest-move line.

All three at 0 means the dry run must show **0 ratings rows**. (Run locally on 2026-10-04 with the season filters
removed, since local is past `0026`: `customs` 9 eligible games, N = 90, the same 90 rows M14.58's local rebuild
filled; 0, 0, 0.)

### 1.5 Vercel environment (Production)

Vercel → project → Settings → Environment Variables → **Production**. Every variable in `.env.example` that the web
server reads:

| Variable | Value | New in 2.0? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | hosted project | existing |
| `BOOTSTRAP_ADMIN_PUUID` | **your own PUUID** (see risk R2) | existing, meaning changes: it now picks `customs`'s permanent owner |
| `BOOTSTRAP_ADMIN_DISCORD_ID` | your Discord snowflake, or unset if already linked | existing |
| `NEXT_PUBLIC_SITE_URL` | `https://playkustom.com` | existing; required now (the Discord redirect is derived from it; M14.61: the Discord avatar and result badge are only attached when this origin is `https` and public, so a typo or an `http://` here silently drops every image) |
| `CUSTOMS_NIGHT_TZ` | `Africa/Cairo` or unset | existing |
| `CRON_SECRET` | existing value | existing |
| `SUPER_ADMIN_USER_IDS` | your `auth.users.id` (Supabase → Authentication → Users), comma-separated | **new** (M14.19) |
| `DISCORD_CLIENT_ID` | same as the sign-in app's client id (the hosted Discord provider in the Supabase dashboard) | **new** (M14.20) |
| `DISCORD_CLIENT_SECRET` | same app's secret. Server only, never `NEXT_PUBLIC_` | **new** (M14.20) |
| `DISCORD_REDIRECT_URI` | `https://playkustom.com/api/admin/discord/callback` | **new**, optional but set it so it is exact |
| `ANTHROPIC_API_KEY` | your Anthropic API key (console.anthropic.com → API keys). Server only, never `NEXT_PUBLIC_`. Scope: **Production only**, not Preview or Development, so a preview deploy never spends | **new** (M16.3), optional: unset or blank, every AI path is silently absent (no call, no line, no error) |
| `DEEPSEEK_API_KEY` | your DeepSeek API key (platform.deepseek.com → API keys; top up a few dollars first, it is prepaid). Server only, never `NEXT_PUBLIC_`. Scope: **Production only** | **new** (2026-10-04, Premium AI on DeepSeek); data goes to DeepSeek in the PRC (the user's accepted trade-off) |
| `AI_PROVIDER` | optional: unset, DeepSeek V4 Pro writes the AI lines when `DEEPSEEK_API_KEY` is set (the default since 2026-10-04), else Claude; `deepseek` or `anthropic` pins one provider (only with its own key). Scope: **Production only** | **new** (2026-10-04). A typo or a provider without its key turns AI off quietly; an env change needs a redeploy |

Not on Vercel: `SUPABASE_AUTH_DISCORD_*` (Supabase CLI, local only), `SUPABASE_LOCAL_*` (tests), `CUSTOMS_NIGHT_API_BASE`
(companion build only), `KUSTOM_AI_LIVE` (the one-call live test, never in CI or on Vercel). Remove
`DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` if they are there (no bot).

**AI spend guards (M16.3), set alongside the key:**
- On DeepSeek (`AI_PROVIDER=deepseek`): DeepSeek is prepaid, so the balance you top up is the hard ceiling that
  backs up Kustom's meter (there is no separate monthly limit to set); a few dollars covers months at about $0.25
  per group-month. The meter, the `$2` / `$20` caps and the kill switch below are the same for either provider.
- Anthropic console → Billing / Limits: a **$20 monthly spend limit**. It backs up Kustom's own meter (`$2` per
  group per month, `$20` overall, in `ai_settings` and `groups.ai_monthly_cap_usd`).
- Setting the key spends nothing by itself: after `0031` every group has `premium = false`, and `ai_reserve_call`
  refuses a non-Premium group. Spend starts only when you run `set-premium customs on` (3.7), your call.
- **The kill switch, no deploy** (Supabase SQL editor on hosted): stops every model call for every group at the
  next call. Keep it at hand:

  ```sql
  update public.ai_settings set calls_enabled = false;   -- off
  update public.ai_settings set calls_enabled = true;    -- back on
  select calls_enabled, global_monthly_cap_usd, updated_at from public.ai_settings;
  ```

Env changes only take effect on the next deployment, which is the window's push. Setting them days ahead is safe.

### 1.6 Discord developer portal and Supabase auth

- discord.com/developers/applications → the sign-in application → OAuth2 → Redirects → add
  `https://playkustom.com/api/admin/discord/callback` (character for character). Keep the existing
  Supabase callback `https://<project-ref>.supabase.co/auth/v1/callback`. Save.
- Supabase → Authentication → URL Configuration: Site URL `https://playkustom.com`; redirect list contains
  `https://playkustom.com/auth/callback` (no wildcard). Already true since M1.11; just confirm. Hosted
  Discord sign-in is already on (the user, 2026-10-03).

### 1.6b Two live checks on your machine (M14.10 AC4, M14.20 AC5; before 1.7)

Neither can be checked by an agent: both need your Discord. Run on the local stack (`pnpm db:start`,
`pnpm --filter web dev`, signed in as an admin of a local group). Paste the pass/fail lines back to the lead.

1. **Connect Discord, live.** In the Discord portal, also add `http://localhost:3000/api/admin/discord/callback` to
   Redirects (keep it; it is harmless). On `/g/<slug>/admin` → Discord → **Connect Discord**, pick a scratch channel.
   Pass: Discord's consent screen, back on the admin page as connected, and the test post
   `Kustom is connected. Teams and results will show up here.` in that channel.
   `PASS connect: <date>` or `FAIL connect: <what you saw>`.
2. **`-#` subtext renders.** In that scratch channel, run **Send a test post** (or let a lobby post go through). Pass:
   the balance explanation line under the teams renders small and grey (Discord subtext), not as a literal `-#`.
   `PASS subtext` or `FAIL subtext`. **On FAIL**: the lead flips `EXPLANATION_STYLE` in
   `apps/web/lib/discord/embeds.ts` to `'italic'` (one line, tested both ways) before 1.7.

Do not go on to 1.7 with either line missing.

### 1.7 CI and a preview build of the merge

Locally, on the merge result, without touching `main`:

```sh
cd /Users/suyaser/lol && git status --short   # must be empty
git checkout -B ship-2.0-check main && git merge --no-ff redesign-2.0 -m "Merge redesign-2.0: Kustom 2.0"
pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm lint && pnpm -r test && pnpm --filter web build
git push -u origin ship-2.0-check            # a branch push: CI runs, Vercel builds a Preview, production untouched
```

Then the preview smoke, **read-only**:

- Check which database the Preview environment points at (Vercel env scope). If Preview shares the hosted
  production keys, the preview is **talking to production** on the old schema: pages that need `0021`+ will error,
  and anything you press there writes to production. So: do **not** sign in or press anything on the preview.
- Confirm: CI green on the branch; the Vercel preview build is **Ready**; `/`, `/how`, `/about`, `/download`
  render. Data pages failing on the preview before the migrations is expected, not a blocker.

Delete the branch after the deploy (`git push origin --delete ship-2.0-check`).

### 1.8 Tell the group

Pick the window (2.1), tell hosts to close Kustom for it. Kustom 1.0 (Rust) follows on its own release.

---

## 2. Choosing the window

### 2.1 The window

All of: no lobby open, no game finished in the last 15 minutes, every host's Kustom closed, and no cron due.
Crons (`apps/web/vercel.json`, UTC): leaderboard and window **04:30**; rebuild **04:15** (new in 2.0, M14.63:
folds each group with an unrated backfilled game; it refuses a group with a live lobby or a game in the last 15
minutes, so it cannot collide with the window, but keep the window clear of it anyway); mystery **21:00 and
22:00**. On Hobby a cron fires any time inside its hour, so treat 04:00–05:00 as due. Not the 1st of the month (M13.4 code still makes the monthly post that M14.48 removes; after the push there
is none). The window cron is also where the Sunday post (and, with Premium on, the AI storyline) goes out. A good window: **09:00–18:00 UTC (12:00–21:00 Cairo, summer time) on a day that is not
the 1st**, 45 minutes reserved, needs about 20.

Check nothing is live (SQL editor):

```sql
select status, count(*) from lobbies where status in ('open','balanced','in_game') group by status;
select max(created_at) as last_game_written from games;
```

---

## 3. The window

### 3.1 Confirm the starting point (2 min)

```sh
cd /Users/suyaser/lol/packages/db
supabase migration list --linked
```

Re-run 2.1's two queries (nothing live) and 1.4's drop-count query: the counts match what you approved, plus only
games played since. Re-run 1.4b: every line as stated. If not, stop.

### 3.2 Fresh dump (5 min). This is the restore point.

Run 1.1 again with a new `$BACKUP`. Do not continue without the three files.

### 3.3 Migrations: everything pending, in number order, one push (2 min)

```sh
cd /Users/suyaser/lol && git checkout ship-2.0-check     # the tree that was CI-green in 1.7
cd packages/db
supabase db push --linked --dry-run
supabase db push --linked
```

The dry run must list, in order: `0021`, `0022`, `0023`,
`0024`, `0025`, `0026`, `0027`, `0028`, `0029`, `0030`, `0031`, `0032`, `0033`, `0034`, `0035` (fifteen files,
nothing else):

- **`0026_remove_seasons.sql`** (M14.14). Point of no return: it deletes non-active season rows. The file's guard
  aborts the whole file if there is not exactly one active season. Pre-check: 3.1's re-run of 1.4's counts.
  Post-check: 3.5 (`to_regclass('public.seasons')` is null; the ratings key is `(group_id, player_id)`; counts and
  sums match 1.4).
- **`0027_ratings_reset.sql`** (M14.18). Additive. Post-check: `select id, slug, ratings_since from groups;` (all
  null) and `select ratings_since from groups_public limit 1;` works.
- **`0028_lobby_password_private.sql`** (M14.28). Pre-check: 1.4b's first line (anon reads `lobby_password`:
  **true**), re-run in 3.1. Post-check:
  `select has_column_privilege('anon','public.lobbies','lobby_password','select');` returns **false**, `select has_column_privilege('anon','public.lobbies','lobby_name','select');`
  still returns true, and 3.6's Tonight and REST checks.
- **`0029_admin_ids_private.sql`** (M14.40) (accepted 2026-10-03; the dry run lists it after `0028`). Post-check: `select has_column_privilege('anon','public.group_modes','set_by','select');` returns
  **false**, `select has_column_privilege('anon','public.fearless_state','reset_by','select');` returns **false**,
  and `has_column_privilege('anon','public.group_modes','mode','select')` and
  `has_column_privilege('anon','public.fearless_state','reset_at','select')` return **true**; 3.6's Tonight Mode
  card still shows the group's mode and the fearless ban list still loads.
- **`0030_new_groups_start_normal.sql`** (M14.46) (the dry run lists it after `0029`). No pre-check: it changes
  `group_modes`, which `0024` creates in this same push, so there is nothing to read beforehand. Post-check only:
  `select g.slug, gm.mode from group_modes gm join groups g on g.id = gm.group_id order by g.slug;` reads
  **`fearless` for every group** (`0024` gave each existing group its row on the old default; `0030` updates no
  row), and `select column_default from information_schema.columns where table_schema = 'public' and
  table_name = 'group_modes' and column_name = 'mode';` returns `'normal'::text` (only groups created from now on
  start on Normal).
- **`0031_premium_flag.sql`** (M16.2). Pre-check: 1.4b's `groups` line is 0. Post-check:
  `select slug, premium, premium_changed_at, ai_monthly_cap_usd from groups order by slug;` returns every group
  with `false`, null, `2.00` (Premium is **off** for `customs` too until 3.7), and
  `select has_table_privilege('anon','public.groups','select'), has_table_privilege('authenticated','public.groups','select');`
  returns **false, false**.
- **`0032_mode_of_the_night.sql`** (M15.3). Pre-check: 1.4b's `games` and `lobbies` lines are 0 (and see 1.4b on the
  `group_modes` check). Post-check: `select id, rated_default from modes order by id;` returns five rows, `class f`,
  `fearless t`, `mirror t`, `normal t`, `region f`;
  `select count(*) filter (where not rated) as unrated, count(*) filter (where rule is not null) as with_rule, count(*) from games;`
  returns `0`, `0` and the games count (every stored game stays rated, so the fold is unchanged);
  `select has_column_privilege('anon','public.group_modes','pending_set_by','select'), has_column_privilege('anon','public.lobbies','lock_mode','select');`
  returns **false, true**; `select count(*) filter (where lock_mode is not null) from lobbies;` returns 0.
- **`0033_ai_lines.sql`** (M16.3). Pre-check: 1.4b's `ai_settings / ai_lines / ai_calls` line is `null null null`.
  Post-check: `select id, calls_enabled, global_monthly_cap_usd from ai_settings;` returns exactly one row
  `t | t | 20.00`; this returns five **false**:
  `select has_table_privilege('anon','public.ai_lines','select'), has_table_privilege('authenticated','public.ai_calls','select'), has_table_privilege('anon','public.ai_settings','select'), has_function_privilege('anon','public.ai_reserve_call(uuid,text,numeric,timestamptz,timestamptz,uuid)','execute'), has_function_privilege('authenticated','public.ai_month_spend(uuid,timestamptz,timestamptz)','execute');`
  and `select count(*) filter (where not ai_lines_enabled) from groups;` plus
  `select count(*) filter (where ai_opt_out) from group_memberships;` both return 0.
- **`0034_fold_breakdown.sql`** (M14.58). Pre-check: 1.4b's `game_players` line is 0. Post-check: this returns
  `4` and then `0` filled, with `rated_rows_unfilled` equal to `rated_rows` (nothing filled yet; 3.7 fills them):
  `select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'game_players' and column_name in ('fold_p','base_mu_after','award','rated_games_before');`
  and
  `select count(*) filter (where mu_after is not null and base_mu_after is null) as rated_rows_unfilled, count(*) filter (where base_mu_after is not null) as filled, count(*) filter (where mu_after is not null) as rated_rows from game_players;`
- **`0035_region_no_draw.sql`** (M15.17). Pre-check: 1.4b's `games` and `lobbies` lines are 0. Post-check:
  `select count(*) filter (where lock_no_draw) from lobbies;` and `select count(*) filter (where rule_no_draw) from games;`
  both return 0, and `select has_column_privilege('anon','public.lobbies','lock_no_draw','select');` returns **true**
  (a lock column, granted like 0032's).

Each file is recorded on success; if one fails, the ones before it stay applied and everything after it is not
applied. **The CLI does not wrap a file in a transaction** (it runs it statement by statement; that is why `0026`..`0035`
carry their own `begin; … commit;`). `0021`..`0025` have no wrapper and are already applied locally, so they are not
edited (CLAUDE.md: never edit an applied migration). Which rule applies depends on the file that failed.
**Either way, do not push code.**

- **A failure inside `0021`..`0025` (no transaction).** The file can be left half applied (`0023` worst: it drops
  `set_group_member_role` part-way), and a re-push would run its first statements a second time on top. **Never
  re-push, never hand-patch: restore from 3.2's dump (6.1).**
- **A failure inside `0026`..`0035` (each in one transaction).** The failed file rolled back whole, so the database is
  exactly "every file before it applied, nothing from it on". **Fix forward (6.2):** a corrected copy of the failed
  file (it was never applied, so it may be changed) or a new file, committed on `ship-2.0-check`, CI green, then push
  again; the CLI applies only what is still pending. Then 3.4.

From the first applied file until 3.4 is live, the old code is running on the new schema: expect admin pages,
Tonight and the board to error. Hosts have Kustom closed, so nothing is lost.

### 3.4 Code: merge to `main`, push (immediately; Vercel builds in a few minutes)

```sh
cd /Users/suyaser/lol
git checkout main
git merge --ff-only ship-2.0-check        # main is an ancestor, so this is exactly the CI-green merge commit
git log --oneline -3
git push origin main
```

Vercel deploys `main` to Production. Watch Deployments until **Ready**, and confirm its commit is the merge
commit. If the build fails, see 6.3.

### 3.5 Database checks on the final schema (SQL editor)

```sql
select version from supabase_migrations.schema_migrations order by version desc limit 15;
select g.slug, gm.role, p.puuid from group_memberships gm
  join groups g on g.id = gm.group_id join players p on p.id = gm.player_id
  where gm.role in ('owner','admin') order by g.slug, gm.role;
select group_id, mode from group_modes;
select count(*) filter (where mode is null) as unstamped, count(*) from games;
select group_id, length(code) from group_invites;
```

Expected: the top version is `0035` (and `0021`..`0035` all listed); `customs` has **no owner until the first admin or companion request**
(3.6 makes it), then exactly one, you; every group that existed before the push on `fearless` (0030 changes only
what a group created from now on starts on: `normal`); `unstamped = 0`; every group has a 22-character
invite. Then the post-drop snapshot (0026 removed `seasons`, so there is nothing left to filter on):

```sql
select 'seasons table (must be null)' t, coalesce(to_regclass('public.seasons')::text, 'null') v
union all select 'ratings key', pg_get_constraintdef(oid) from pg_constraint where conname = 'ratings_pkey'
union all select 'games', count(*)::text from games
union all select 'game_players', count(*)::text from game_players
union all select 'players', count(*)::text from players
union all select 'lobbies', count(*)::text from lobbies
union all select 'live companion tokens', count(*)::text from companion_tokens where revoked_at is null
union all select 'ratings', count(*)::text from ratings
union all select 'round(sum(mu) * 1000)', round(sum(mu) * 1000)::text from ratings
union all select 'round(sum(sigma) * 1000)', round(sum(sigma) * 1000)::text from ratings
union all select 'anon reads lobby_password (must be false)',
  has_column_privilege('anon', 'public.lobbies', 'lobby_password', 'select')::text
-- 0029 (accepted 2026-10-03)
union all select 'anon reads group_modes.set_by (must be false)',
  has_column_privilege('anon', 'public.group_modes', 'set_by', 'select')::text
union all select 'anon reads fearless_state.reset_by (must be false)',
  has_column_privilege('anon', 'public.fearless_state', 'reset_by', 'select')::text
-- 0030 (M14.46)
union all select 'new group mode default (must be ''normal''::text)',
  column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'group_modes' and column_name = 'mode'
-- 0031 (M16.2)
union all select 'groups with premium on (must be 0)', count(*)::text from groups where premium
-- 0032 (M15.3)
union all select 'unrated games (must be 0)', count(*)::text from games where not rated
union all select 'anon reads group_modes.pending_set_by (must be false)',
  has_column_privilege('anon', 'public.group_modes', 'pending_set_by', 'select')::text
-- 0033 (M16.3)
union all select 'ai_settings calls_enabled / cap (must be true / 20.00)',
  (select calls_enabled::text || ' / ' || global_monthly_cap_usd::text from ai_settings)
union all select 'anon reads ai_lines (must be false)', has_table_privilege('anon', 'public.ai_lines', 'select')::text
-- 0034 (M14.58): before 3.7's rebuild write, unfilled = every rated row
union all select 'rated game_players with no breakdown', count(*)::text from game_players
  where mu_after is not null and base_mu_after is null
-- 0035 (M15.17)
union all select 'anon reads lobbies.lock_no_draw (must be true)',
  has_column_privilege('anon', 'public.lobbies', 'lock_no_draw', 'select')::text;
```

Expected: `null`; `PRIMARY KEY (group_id, player_id)`; games and game_players = 1.4's `games kept` and
`game_players kept` plus games played since; ratings = 1.4's `ratings kept`, and the two sums = 1.4's
`ratings kept: round(...)` lines (ratings only move when a game is folded, so if games were played since, rely on
3.6's hosted dry run instead: run it with 3.6's inline hosted-key block and `--hosted`, never a bare `pnpm --filter
web rebuild-ratings`, which reads `apps/web/.env.local` and so the local stack; no `--force`; check its `target` line
and read it as 3.6 says);
`false`;
`false`; `false`; `'normal'::text`; `0`; `0`; `false`; `true / 20.00`; `false`; the number of rated
`game_players` rows (3.7 brings it to 0); `true`.

### 3.6 Smoke pass (10 min)

Signed out:
- `/`, `/how`, `/about`, `/download` render. `/download` offers 0.3.x until Kustom 1.0 is released (`companion-release.md`).
- `/g/customs` (Tonight), `/g/customs/leaderboard`, a game page from it, `/g/customs/p/<your puuid>`.
- Old links 308 (`apps/web/next.config.ts`): `/leaderboard` → `/g/customs/leaderboard`, `/p/<puuid>` → `/g/customs/p/<puuid>`. `/admin/seasons` 308s to `/g/customs/admin` (M14.14).
- Tonight signed out (`/g/customs`) renders, and the page source has no lobby password (M14.28). The anon key
  cannot read it: `curl -s "https://<project>.supabase.co/rest/v1/lobbies?select=lobby_password&limit=1" -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"`
  answers `{"code":"42501",...}`; the same with `select=id,lobby_name` answers rows.

Signed in (Discord):
- `/g/customs/admin` opens. Then rerun 3.5's owner query: **exactly one** `owner` row for `customs`, and it is you. None, or somebody else, see R2 (`0023` sets the owner lazily, on the first admin or companion request, from `BOOTSTRAP_ADMIN_PUUID`; it takes no literal and never stops).
- `/g/customs/you` renders.
- Tonight signed in as a member (`/g/customs`) renders; with a lobby open tonight, `Missed the invite?` shows the
  lobby name and its password (M14.28: the password comes from a service-role read, for members only).
- Super-admin: `/ops` (or `GET /api/ops/groups`) lists the groups.

Ratings, with the hosted keys inline (they take precedence over `apps/web/.env.local`; nothing is written).
`--hosted` is required: without it the command refuses any database that is not the local stack, dry runs too, and
reads nothing:

```sh
cd /Users/suyaser/lol
read -rs "SRK?hosted service role key: "; echo
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY="$SRK" \
  pnpm --filter web rebuild-ratings --dry-run --hosted
unset SRK
```

It folds **every group** (no `--group`), one report block per group, and must report no unexpected change in any
of them (this is the dry run M13.3 owes, now on the final schema). **Check the first line before anything else:** it
must read `target        <project-ref>.supabase.co (hosted)`, the host only (no key is ever printed). `127.0.0.1`
or `(local)` there means the inline URL did not take: stop, the report is the local stack's (`customs` has the same
id in both). Then `rated` and N should match 1.4b's hosted query. A refusal for "a game landed in the last 15 minutes" means the window was not quiet;
re-check, do not `--force` a write.

**Reading it after `0034`.** The dry run counts a row that only gains its fold breakdown as a change. With 1.4b's
"what the hosted rebuild will see" query at 0, 0, 0 for a group, that group's block must read exactly (N = that
group's `expected_breakdowns_n`, less ten per game recorded since the deploy):

```
considered    <games>
rated         <eligible games>
skipped       <ARAM, short, not-ten games, or none>
would change  N game_players rows, 0 ratings rows
players       <n> with a rated game
seeds         0 to store for the first time
breakdowns    N game_players rows to fill for the first time (0034)
roles         0 inferred pairs moved
biggest move  none
dry run: nothing was written
```

- The two N are the same number, and equal to 1.4b's N.
- **`roles 0` always on a dry run**: the role recompute runs only on a write (it is after the dry-run return in
  `lib/ingest/rebuild.ts`), so it says nothing here; 3.7a is where roles move.
- **No `PROBLEM` line.** An `orphans` line (ratings rows with no rated game) is reported, not acted on; do not pass
  `--prune`.
- A group with no eligible games reads `would change 0 game_players rows, 0 ratings rows`, `breakdowns 0`.

The benign exceptions, each predicted by 1.4b's query: `eligible_null_mu_after > 0` (unrated backfills) makes the
ratings count non-zero and `biggest move` a real move; `ratings_seed_mu_null > 0` makes `seeds` and the ratings
count non-zero with no move; `players_with_no_ratings_row > 0` adds `(first ratings for N players)`. Anything **not**
predicted by 1.4b (a ratings count with all three at 0, N above 1.4b's, any `PROBLEM`) is an unexpected change: stop
and send the whole output to the lead before 3.7's write (no core rating math changed since `05278f5`; M14.57
retired only the weekly track, M15.3's `rated` is true on every stored game).

Discord (pick one):
- **Connect Discord** on `customs`'s admin Discord page and pick **the channel it already posts to**. Expect the
  test post `Kustom is connected. Teams and results will show up here.` in that channel. This replaces the stored
  webhook with a new one for the same channel; the old webhook stays listed in the channel's integrations and can be
  deleted there.
- Or leave the existing webhook alone and check the lobby post at the first game below.

The window is over. Tell hosts they can open Kustom (3.7 can run after, any time; its rebuild just needs 15 quiet
minutes).

### 3.7 One-offs after the push (yours to run; each is idempotent)

**a. Fill the fold breakdowns (`0034`, M14.58). A hosted write.** Until this runs, every game before the deploy
shows the fallback sentence under its points; games recorded after the deploy get their breakdown from the live
fold. Its game_players and ratings writes are exactly what 3.6's dry run showed. **It also writes one thing the
dry run cannot show:** after the rating writes, every write run calls `recomputeInferredRoles` for **every player**
(all groups), and stores each player's `main_role`, `secondary_role`, `roles_counted`, `roles_inferred_at` that
moved. The dry run returns before that step, so it always prints `roles 0`. Expect the write to print
`roles N inferred pairs moved` with **N > 0**: `0026` deleted the non-active seasons' games, so many players' rated
game sets shrank and their inferred pair is recomputed from what is left. That is the intended result of the seasons
drop, not a fault, and a second run moves 0. Run it only after 3.6's dry run passed, with no lobby live and no game
in the last 15 minutes (no `--force`).

First, a snapshot of the role columns it may change (SQL editor; save the hash, and **Download CSV** of the second
query beside the backup, so any pair can be compared or put back by hand):

```sql
select count(*) as players, count(main_role) as with_main_role, count(roles_inferred_at) as inferred,
  md5(string_agg(id::text || ':' || coalesce(main_role::text, '-') || ':' || coalesce(secondary_role::text, '-')
    || ':' || coalesce(roles_counted::text, '-'), ',' order by id)) as roles_hash
from public.players;
select id, puuid, main_role, secondary_role, roles_counted, roles_inferred_at from public.players order by id;
```

Then:

```sh
cd /Users/suyaser/lol
read -rs "SRK?hosted service role key: "; echo
export NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY="$SRK"
pnpm --filter web rebuild-ratings --hosted              # first line: target <project-ref>.supabase.co (hosted); per group: wrote N game_players rows, <3.6's> ratings rows; breakdowns N filled; roles N moved (N > 0 expected)
pnpm --filter web rebuild-ratings --dry-run --hosted    # second pass: would change 0 / 0, seeds 0, breakdowns 0 to fill, roles 0
unset SRK SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_URL
```

Exit 2 means a game landed mid-run: run the write again. A second **write** run would print `roles 0` (the
recompute writes only rows that move). Re-run the snapshot's first query: the hash can change only if the write
reported roles moved. Then, in the SQL editor:

```sql
select count(*) filter (where mu_after is not null and base_mu_after is null) as rated_rows_unfilled,
       count(*) filter (where base_mu_after is not null) as filled,
       count(*) filter (where mu_after is not null) as rated_rows
from game_players;
```

Expected: `rated_rows_unfilled = 0` and `filled = rated_rows` (locally: 0, 90, 90). Open a game page from before the
deploy and tap a delta: a real sentence (not the fallback) explains it.

**b. Kustom Premium on for `customs` (M16.2 / M16.3). Your call, and the only step that spends money.** The product
decision is that `customs` gets Premium as soon as M16.3 lands; nothing is spent until this runs. Before it:
`ANTHROPIC_API_KEY` is on Vercel **Production** and the deployment from 3.4 carries it (env changes need a
deploy), the Anthropic console has its $20 limit, and you know the kill switch (1.5).

```sh
cd /Users/suyaser/lol
read -rs "SRK?hosted service role key: "; echo
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY="$SRK" \
  pnpm --filter web set-premium customs on --hosted
unset SRK
```

It prints the URL it writes to and the before/after; check the URL is the hosted project. Without `--hosted` it
refuses any non-local URL (on purpose). Running it twice writes nothing. Check:

```sql
select slug, premium, premium_changed_at, ai_monthly_cap_usd, ai_lines_enabled from groups order by slug;
select calls_enabled, global_monthly_cap_usd from ai_settings;
```

Expected: `customs` `true`, a fresh `premium_changed_at`, `2.00`, `true`; every other group `false`; `true`,
`20.00`. `/ops` shows `customs` as Premium (read-only). The first AI recap appears under the next game's result
(and in its Discord post, edited within 15 minutes); the storyline on the next Sunday post. To stop: the kill
switch (every group, at once) or `set-premium customs off --hosted` (this group).

### 3.8 First game on 2.0 (the night after, or a quick custom)

A host opens their **current** Kustom (0.3.x keeps working: pairing without `mode` is overlay, and existing host
tokens are unchanged). Play one custom game, then:

```sql
select id, group_id, mode, rule, rated, rule_no_draw, started_at, created_at from games order by created_at desc limit 1;
select count(*) as players, count(base_mu_after) as with_breakdown, string_agg(distinct award, ',') as awards
  from game_players where game_id = '<that id>';
```

Expected: one new row in `customs`'s group, `mode = 'fearless'` (or `normal` if the Mode card was changed),
`rule` null and `rated = true` unless a rule was set on the Mode card, `rule_no_draw = false`; 10 players, all 10
with a breakdown (the live fold wrote it, `0034`) and awards from `mvp`, `ace`, `none`; the result on the game page
and in Discord, the board moved. If two hosts were in the game, still one row.

### 3.9 Verify after deploy: Discord posts 2.0 on a phone and a desktop (M14.61, 05-design §10.14 item 10)

The last open acceptance of M14.61, and only you can do it: a real post, looked at on a real phone. It needs the
2.0 deployment live, because the avatar (`/og/kustom/avatar?v=2`) and the result badge (`/og/g/<slug>/games/<id>/badge`)
are images Discord fetches from production. Every post is complete without them; the check is that they show.

1. **The images are public.** Both must answer `200` and `content-type: image/png`:
   ```sh
   curl -sI "https://playkustom.com/og/kustom/avatar?v=2" | grep -i '^HTTP\|^content-type'
   curl -sI "https://playkustom.com/og/g/customs/games/<a real customs games.id>/badge" | grep -i '^HTTP\|^content-type'
   ```
   A missing image in a real post later means `NEXT_PUBLIC_SITE_URL` is not `https://playkustom.com` (1.5).
2. **A scratch channel and webhook.** In Discord, a channel only you can see → Edit Channel → Integrations →
   Webhooks → New Webhook → Copy Webhook URL. Not `customs`'s channel, and not through Connect Discord (that would
   replace `customs`'s stored webhook, R6).
3. **Send the three posts** (teams, result, Sunday) from the real builders, with 05-design §10's worked examples
   (the game 4 names, which are the designer's fixtures) and the result's link and badge pointed at a real
   `customs` game so the badge resolves. From the tree that was deployed (the post bodies are built locally; only
   the webhook call leaves the machine, and nothing touches the database):
   ```sh
   cd /Users/suyaser/lol/apps/web
   cat > .scratch-posts.mts <<'EOF'
   const { teamsEmbed, resultEmbed, windowSummaryEmbed } = await import('./lib/discord/embeds');
   const g4 = await import('./lib/testing/discordGame4');
   const id = process.env.REAL_GAME_ID;
   const o = g4.GAME4_ORIGIN;
   const result = id
     ? g4.game4Result({ url: `${o}/g/customs/games/${id}`, badgeUrl: `${o}/og/g/customs/games/${id}/badge` })
     : g4.game4Result();
   for (const p of [teamsEmbed(g4.game4Teams()), resultEmbed(result), windowSummaryEmbed(g4.game4Weekly())]) {
     const r = await fetch(process.env.SCRATCH_WEBHOOK!, {
       method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p),
     });
     console.log(r.status, await r.text());
   }
   EOF
   read -rs "SCRATCH_WEBHOOK?scratch webhook URL: "; echo
   SCRATCH_WEBHOOK="$SCRATCH_WEBHOOK" REAL_GAME_ID=<a real customs games.id> \
     node --conditions=react-server --import tsx .scratch-posts.mts
   rm .scratch-posts.mts; unset SCRATCH_WEBHOOK
   ```
   Expect three `204` lines. (Checked 2026-10-04 without a webhook: the three bodies build, 4, 3 and 1 embeds,
   all far under the 6,000-character message limit.) Optionally, also look at the first real teams and result
   posts in `customs`'s own channel at 3.8, and the next Sunday post there.
4. **Look on a phone (iOS or Android, Discord dark theme) and a desktop.** Screenshot all three on both. Check:
   sender `Kustom` with the Kustom avatar; the group name in the author line; teams as a stack (header, blue side,
   red side, closing block) with the ten-cell 🟦/🟥 odds bar; each seat's Rating and its change on one line, not
   split; masked links (words, not raw URLs) that open the site; the result's `RED WINS`/`BLUE WINS` badge
   thumbnail; nothing cut off or wrapped badly at phone width.
5. Delete the scratch webhook (Integrations → Webhooks). Send the six screenshots to the lead: the designer signs
   §10.14 item 10 (at most two rounds), and M14.61 ticks.

---

## 4. Rollback per step

| Where it went wrong | What still works | Rollback |
|---|---|---|
| Pre-flight (1.x) | everything | nothing ran; fix and retry |
| 3.3 failed **before** the seasons file (inside `0021`..`0025`, no transaction) | M13.4 code partly broken (if `0023` applied, the owner is locked out of M13.4 admin); the failed file may be half applied | do not push code, do not re-push, do not hand-patch. Report, then restore from 3.2's dump (6.1). Nothing was deleted yet and the window was quiet, so the dump loses nothing |
| 3.3 failed **at** the seasons file | as above; the seasons file rolled back whole, nothing deleted | stop. Do not push code. Report. Re-run its pre-check; the guard message says why |
| 3.3 failed **after** the seasons file (`0027`..`0035`) | nothing: old code cannot read the seasonless schema and 2.0 code needs every file (without `0034` no game records). The failed file rolled back whole (each carries `begin; … commit;`) | do not push code. Report the error; fix with a corrected **unapplied** file or a new one in a commit on `ship-2.0-check`, re-run CI, push the migrations again (6.2), then 3.4. Hosts keep Kustom closed until 3.4 is live |
| 3.3 succeeded, 3.4 build fails | old code on new schema: broken | fix forward on `main` (hotfix commit, push). Do **not** use Vercel Instant Rollback: the previous deployment cannot run on the new schema |
| 3.4 live, a page or route broken | the rest of 2.0 | fix forward. Vercel Instant Rollback is **not** a rollback after the seasons file (old code needs `seasons`) |
| Data wrong after the seasons file (3.5 snapshot does not match) | site may look fine | stop writes (hosts close Kustom), report. The only undo is 6.1's restore from 3.2's dump, which loses anything written since |
| 3.7a rebuild write reports ratings rows 3.6 did not show, or exits with a PROBLEM (`roles N > 0` alone is expected, not this row) | the site; ratings as written | stop; send the output to the lead. A role pair that looks wrong can be compared against, or put back from, 3.7a's CSV. The fold is deterministic from the stored games, so the next good run puts the numbers back; 6.1 only if a rating is plainly wrong and the lead agrees |
| AI lines misbehave or spend (after 3.7b) | everything else; AI paths are silent when off | the kill switch (1.5): `update public.ai_settings set calls_enabled = false;`, no deploy. Then `set-premium customs off --hosted` if it is one group. Bad lines: an admin's `Hide` on the line. Removing `ANTHROPIC_API_KEY` also works, but needs a redeploy |
| Discord images missing (3.9) | every post (complete without images) | check `NEXT_PUBLIC_SITE_URL` on Vercel Production is exactly `https://playkustom.com`, redeploy |
| (skipped) 0.4.0 misbehaves (section 5, not run for 2.0) | the server, 0.3.x | delete or mark the GitHub release as pre-release so `/download` and the updater stop offering it; hosts reinstall 0.3.x |

---

## 5. ~~Publish Kustom 0.4.0~~ (skipped; kept as a record)

> **Skipped (the user, 2026-10-03): 0.4.0 is not published.** 2.0 deploys with 0.3.x as the download, and the
> Rust companion (M17) is the next release: the first updater-enabled build, carrying the pairing code and per-group
> tokens 0.4.0 would have shipped. Nothing in this section is run for 2.0; it stays as the record of the 0.4.0 path.
> `/download` keeps offering 0.3.x, and the server keeps accepting 0.3.x (pasted tokens, pairing without `mode`).


0.4.0 sends `mode` on pairing and reads `/api/companion/me`'s `group`; it needs the 2.0 server live. The version is
already `0.4.0` in `apps/companion/package.json`; it bakes in `https://kustom-delta.vercel.app`. `release` is
`build:win` then `publish:gh`. Run them apart so the exe is tested against production before anyone can download it:

```sh
cd /Users/suyaser/lol
gh auth status                                  # logged in with access to suyaser/kustom-releases
pnpm --filter companion build:win               # apps/companion/dist/Kustom.exe + Kustom.exe.sha256
cat apps/companion/dist/Kustom.exe.sha256
```

On the Windows PC: run that `Kustom.exe`, Host mode, sign in on the site, take the six-character code from the admin
pairing card, enter it. Expect your host token filed under `customs`, and a lobby you open shows on `/g/customs`.
Overlay mode: a member's join code pairs with no token. Then:

```sh
pnpm --filter companion publish:gh              # GitHub release v0.4.0 on suyaser/kustom-releases
```

Release notes for 0.4.0 (the GitHub release body, and the message to the group) must include:

> Pairing: on the site, take the six-character code and enter it in Kustom. Kustom's Host card still says
> "Paste a token" (its screens are redesigned later); pasting a token still works. Both work.

Why: the companion UI rewrite is deferred (decision row 2026-10-03), so `/download` describes pairing while 0.4.0's
Host card still offers the old paste screen.

Check `/download` offers 0.4.0 and the sha256 matches the file above. Tell the group to update.

---

## 6. Recovery

### 6.1 Restore (last resort)

For two cases only: data loss after the seasons file, or a failure **inside** one of the untransacted files
`0021`..`0025` (3.3: the file may be half applied, so it is never re-pushed or hand-patched). Restore goes into a
**new** Supabase project, then Vercel is repointed:
restoring into the live project over a changed schema is not reliable.

1. Supabase → New project (same region). Note its connection string.
2. Load the window's dump (3.2):
   ```sh
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file "$BACKUP/roles.sql" --file "$BACKUP/schema.sql" \
     --command 'SET session_replication_role = replica' --file "$BACKUP/data.sql" \
     --dbname '<new project connection string>'
   ```
3. Configure Discord sign-in on the new project (Authentication → Providers, URL Configuration, as 1.6) and add its
   `…supabase.co/auth/v1/callback` in the Discord portal.
4. Vercel Production env: the new URL, anon key, service role key. Vercel → Deployments → the pre-window production
   deployment → **Promote to Production** (old code, old schema: they match again).
5. `supabase link --project-ref <new ref>` in `packages/db`. The restored database is at the pre-window migration
   state, so the next attempt starts from 3.1 again.

Companion tokens, players and games come back with the dump; nothing on hosts' PCs changes (their API base is the
Vercel URL).

### 6.2 Partial push

**Only when the failed file is one of `0026`..`0035`** (each runs in one transaction, so it rolled back whole; a
failure inside `0021`..`0025` is 6.1 instead). `supabase migration list --linked` shows where it stopped. The applied
files stay; the failed file did not apply. Fix forward with a new migration or a corrected copy of the failed
(unapplied) file, committed on `ship-2.0-check`, CI green, and push again. Code goes only after the push completes.

### 6.3 Build failure after the migrations

The schema is already 2.0, the old deployment cannot serve it. Fix on `main`, run the five CI commands locally, push.

---

## 7. The user's own actions (block nothing)

- Register Kustom on the Riot Developer Portal as a League Client API product (developer.riotgames.com, M14.8;
  decision row 2026-10-03). The site's "isn't endorsed" notice ships either way.
- After 0.4.0 is out: delete the old `customs` webhook in Discord if 3.6 replaced it.
- Later cleanup (a future migration, not this deploy): `players.is_admin`, `players.backfill_*` and
  `group_memberships.backfill_*` are unread from M13.4 / `1a5bd27` on.

---

## Risks found while writing this

- **R1. `0023` locks the owner out of M13.4's admin gate.** M13.4 checks `role = 'admin'` exactly, and the new
  `bootstrap_admin` makes you `owner`. So `0023` cannot go ahead of the code: it is in the window, never applied early.
- **R2. `BOOTSTRAP_ADMIN_PUUID` now picks a permanent owner.** The first admin or companion request after `0023`
  makes that PUUID's player the owner of `customs`, and it never changes again except through a transfer. Check the
  Vercel value is your PUUID before the push. If it is unset, `customs` has no owner and keeps M13.4's admin rules.
- **R3. No Vercel rollback after the seasons file.** Old code cannot read the new schema. Fix forward, or restore
  (6.1), which loses everything written since the dump.
- **R4. The preview may share the production database.** 1.7 says do not sign in or press anything there.
- **R5. `db push` cannot stop partway.** Whatever is in the folder goes, so the window pushes from the CI-green
  branch, never a newer checkout.
- **R6. Connect Discord replaces the webhook.** Pick the same channel, or skip it and check the first lobby post.
- **R7. The brief puts this runbook in `docs/01-architecture.md`.** It lives here, and `01-architecture.md`'s
  deploy section should point to it (lead's call).
- **R8. 2.0 code without `0034` records no game.** The live fold writes the breakdown in the same update as
  `mu_after`, so code ahead of the migrations would refuse every game post. The order (migrations, then code) already
  covers it; it is one more reason never to push `main` before 3.3 completes.
- **R9. A failure in `0027`..`0035` leaves nothing running** (row added to section 4). Each is all-or-nothing, so
  the fix is a corrected file and a second push, never a hand patch. 1.4b removes the one foreseeable cause (a name
  already taken).
- **R10. 3.7a is a hosted write by a script, and writes more than its dry run shows.** Its game_players and ratings
  writes are what 3.6's dry run showed; do not run it if that dry run showed a ratings change 1.4b did not predict.
  On top, every write run recomputes every player's inferred roles (`recomputeInferredRoles`), which a dry run
  never reports (`roles 0` always). After `0026` dropped the old seasons' games, `roles N > 0` is expected; 3.7a
  snapshots the four role columns first so any pair can be compared or restored.
- **R11. Premium spends real money** once `customs` is on. Three caps (the Anthropic console's $20, `ai_settings`'s
  $20 global, `$2` per group) and the kill switch bound it; the key is Production-only so previews never spend.
- **R12. Discord images depend on `NEXT_PUBLIC_SITE_URL`.** Not `https` or not public, and every image silently
  drops (by design, the posts stay complete). 3.9 step 1 checks it.
