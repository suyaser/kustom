# Runbook: the database performance migrations (0039 to 0042)

**Status: ready, not run.** Written 2026-10-04 by `platform-engineer` on branch `db-perf`, from the plan in
`redesign/research/db-performance.md` (section 7). Rehearsed on a throwaway restore with 8,149 games
(`packages/db/scripts/m19-dbperf-throwaway-check.sh`, and the timings below); applied to the local stack with
`supabase migration up --local`. **Nothing hosted has been touched.**

**Who runs it: the user, every step.** No agent applies a migration, deploys, or runs a command with `--hosted`.

## 0. What ships

| Migration | What it does | Old code on the new schema | New code on the old schema |
|---|---|---|---|
| `0039_games_game_mode.sql` | `games.game_mode`, a stored generated column (the string `raw->>'gameMode'`); index `(group_id, started_at desc, lcu_game_id desc)` replaces `games_group_started_at_idx`. **Rewrites `games`** (ACCESS EXCLUSIVE for the duration) | fine (a new column nobody names; the new index serves every old query the old one did) | every reader that selects `game_mode` fails: Tonight, Games, Stats, board ARAM label, rebuild |
| `0040_games_raw_lz4.sql` | `games.raw` compression lz4, then re-stores every value (`raw = raw \|\| '{}'`). **Rewrites every `games` row**; one Realtime UPDATE per row reaches open Tonight pages until M19.11 | fine (transparent) | fine (transparent) |
| `0041_game_facts.sql` | new table `game_facts` (public read, service-role write, not in Realtime) | fine (nothing reads or writes it) | game ingest fails (it writes the row); Stats and the daily game fail (they embed it) |
| `0042_member_game_counts.sql` | index `game_players (group_id, player_id) include (game_id)`; view `group_member_game_counts` (service role only) | fine | Admin Members fails |

Class: **migrations first, then the deploy, then the backfill.** No migration needs the code; the code needs all four.
Between the migrations and the deploy, old code ingests games without a `game_facts` row; after the deploy every
reader treats a missing row as "read this game's raw" (`apps/web/lib/stats/gameFacts.ts`), so the gap is a
slower read for those games, never a wrong number, until the backfill runs.

**Migration numbering.** `0037` (`group_live`, M19.9) is on `main`. `0036` (`kustom-rating`) and `0038`
(`auth-local-claims`) are taken by branches that may not be merged when this runs. If `0039`..`0042` reach
hosted first, a later push of `0036` or `0038` is "older than the newest remote migration" and `supabase db push` refuses it without
`--include-all`. That is expected and safe: none of the four touches what `0036` and `0038` touch. (`0043`, the
batched fold write, needs `0036` and ships with the M18 lane.)

## 1. Expected durations

Measured on the throwaway (8,149 games, the plan's seed with real-size 62 KB blocks, this Mac). The plan puts
hosted at about 1/30 of the seed (roughly 270 games; check with the count in 2.3), and a Micro/Small instance is
slower than this laptop, so read the right-hand column as a range, not a promise.

| Step | 8,149 games (throwaway) | About 300 games (hosted, estimate) |
|---|---|---|
| `0039` (rewrite + index) | 9.8 s | under 1 s |
| `0040` (re-store every raw) | 4.3 s | under 1 s |
| `0041` | 0.14 s | instant |
| `0042` (index + view) | 0.23 s | instant |
| `backfill-game-facts` | 11.6 s (no network) | 5 to 20 s from home (6 batches of 50 blocks, about 3 MB each) |
| `vacuum full games` (optional, section 4) | 1.0 s | under 1 s |

## 2. Before

Off-night (no lobby open, no game in progress): `0039` and `0040` hold an exclusive lock on `games` for their
duration, so an end-of-game post in that window waits (and the companion retries).

- **No Tonight page open while `0040` runs.** Its UPDATE re-stores every `games` row, and until M19.11 takes
  `games` out of the Realtime publication each row is one UPDATE event (about 60 KB with `raw`) to every
  subscribed Tonight page. Close Tonight on every device (or wait until nobody is on it) before pushing.
- **`0042` before the first Admin Members visit on the new code.** Members reads `group_member_game_counts`;
  without the view the page fails. All four migrations go in one push before the deploy, which covers it; if
  the push is split, `0042` must still land before the deploy.

1. **lz4 is available on hosted.** In the Supabase SQL editor (read only):

   ```sql
   select 'lz4' = any(enumvals) as lz4_ok, version()
   from pg_settings where name = 'default_toast_compression';
   ```

   Expect `lz4_ok = true` (the local image, Postgres 17.6, answers `{pglz,lz4}`). If it is `false`, **stop**: `0040`
   would fail and roll back its transaction (harmless, but the push stops there). Skip `0040` by pushing the others
   only after asking the lead.
2. **What is pending.** From `packages/db`:

   ```sh
   supabase migration list --linked
   supabase db push --linked --dry-run
   ```

   Expect `0039`..`0042` pending (plus `0036`..`0038` if those branches merged first). Anything Remote has that
   Local does not: **stop**.
3. **The numbers before**, for the checks after (SQL editor):

   ```sql
   select count(*) as games, pg_size_pretty(pg_total_relation_size('public.games')) as games_size
   from public.games;
   select pg_column_compression(raw) as method, count(*) from public.games group by 1;
   ```

## 3. Run

1. Migrations, all four (they are one push; `0039` and `0040` are the ones that take the lock):

   ```sh
   pnpm db:migrate        # supabase db push to the linked hosted project
   ```

2. Checks (SQL editor), each must hold:

   ```sql
   -- game_mode is the stored mode on every row
   select count(*) as wrong_mode from public.games
   where game_mode is distinct from (case when jsonb_typeof(raw->'gameMode') = 'string' then raw->>'gameMode' end);
   -- 0

   -- every toasted raw is lz4 (small blocks are stored inline and report null)
   select pg_column_compression(raw) as method, count(*) from public.games group by 1;
   -- lz4 (and possibly a few null), no pglz

   -- the index swap
   select indexname from pg_indexes where tablename = 'games' and indexname like 'games_group%';
   -- games_group_started_lcu_idx only

   -- the table and the view exist, and anon cannot read the view
   select count(*) from public.game_facts;                         -- 0 until the backfill
   select count(*) from public.group_member_game_counts;           -- one row per (group, player who played)
   select has_table_privilege('anon', 'public.group_member_game_counts', 'select');   -- false
   select has_table_privilege('anon', 'public.game_facts', 'insert');                 -- false
   ```

3. Deploy the code (merge to `main`; Vercel builds it).
4. Backfill the facts. `apps/web/.env.local` must point at hosted for this one command (or export the two
   variables for it):

   ```sh
   pnpm --filter web backfill-game-facts --hosted --dry-run   # first line: target <ref>.supabase.co (hosted)
   pnpm --filter web backfill-game-facts --hosted
   pnpm --filter web backfill-game-facts --hosted             # again: "total 0 written"
   ```

   The first line names the database by host. Without `--hosted` the command refuses any database that is not
   the local stack, dry runs included. It is idempotent and safe while games are being posted (ingest writes its
   own row; a race only recomputes identical facts).

## 4. After

- **Facts are complete:**

  ```sql
  select count(*) filter (where f.game_id is null) as missing,
         count(*) filter (where f.facts_version < 1) as stale,
         count(*) as games
  from public.games g left join public.game_facts f on f.game_id = g.id;
  -- missing 0, stale 0
  ```

- **Pages:** open Tonight, Games (Rift and ARAM), a game, Stats (Records, Champions, 1v1), a player page, You,
  and Admin Members for `customs`. The Games list ARAM tab shows the same games as before; Admin Members shows
  the same games-played numbers.
- **Disk (optional).** The two rewrites leave dead tuples (the throwaway's `games` grew from 293 MB to 409 MB
  until vacuumed; live lz4 data was 103 MB). Autovacuum makes the space reusable. To hand it back to the disk:

  ```sql
  vacuum (full, analyze) public.games;   -- ACCESS EXCLUSIVE; 1 s on 8,149 games; off-night only
  ```

## 5. If something is wrong

- `0040` failed on lz4: the push stops with `0039` applied and `0040` rolled back. Nothing else is affected. Ask
  the lead before re-pushing.
- A page fails after the deploy: check section 3.2 first (a migration missing on hosted is the only way new code
  fails on these reads).
- Wrong Stats numbers: `game_facts` is derived. `delete from public.game_facts;` then run the backfill again; until
  then readers use raw. Never edit `games.raw` to fix a facts row.
