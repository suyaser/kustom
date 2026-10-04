# Runbook: switch to the Kustom rating (M18.10)

Written 2026-10-04 by `platform-engineer`. **Who runs it: the owner, every step.** No agent applies a migration to
hosted, deploys, or runs a hosted rebuild. Commands assume zsh on this Mac, the repo at `/Users/suyaser/lol`, and
the Supabase CLI linked to the hosted project in `packages/db` (as in `ship-2.0.md`).

What it does: OpenSkill stops being the rating. One migration pair, one deploy, one `rebuild-ratings` that refolds
every group's history under the Kustom rating (`docs/02-milestones.md` "M18 Kustom rating"). The OpenSkill
columns stay in the schema, unread, until M18.12, so rollback is the previous build plus its own rebuild.

**Before you start.**

- `ship-2.0.md` is done: production runs 2.0 code and hosted has `0035` (or later) applied.
- The switch build is merged and green: M18.2 (balancer), M18.5 (fold and rebuild), M18.6 (reads), M18.7 (pages),
  M18.9 (words), and this task's `0043` writer. Note its commit as `SWITCH`. Note the commit production runs now
  as `PREVIOUS` (Vercel → Deployments → Production / Current): it is the rollback build.
- **Do not deploy (step 2) until step 1's check printed `service_can` true; without 0043 every game post fails.**
- Pick a quiet time: no lobby live in any group and no game in the last 15 minutes (the rebuild refuses otherwise).
  Steps 2 to 5 take about ten minutes; nobody should play during them.
- **No automated Discord message** at any step: no code sends anything. The switch is announced afterwards, by
  the owner by hand, in the one-time patch notes (owner, 2026-10-04): step 7.

---

## 0. Back up hosted (the restore point)

Docker must be running. Keep the dumps outside the repo.

```sh
export BACKUP=~/kustom-backups/kustom-rating-$(date +%Y%m%d-%H%M)
mkdir -p "$BACKUP" && chmod 700 "$BACKUP"
cd /Users/suyaser/lol/packages/db
supabase db dump --linked --data-only --use-copy -f "$BACKUP/data.sql"
grep -n '^COPY public.game_players \|^COPY public.ratings ' "$BACKUP/data.sql"
```

Both `COPY` lines present, or stop.

## 1. Migrate hosted: `0036`, then `0043`

The two migrations of this switch, in this order:

| Migration | What it does | Current build on it | Switch build without it |
|---|---|---|---|
| `0036_kustom_rating.sql` (M18.4) | Additive, one transaction: the Kustom columns on `game_players` (both tracks), `ratings.r`, nullable `ratings.mu`/`sigma`, `splits.odds_model` (default `openskill`), the five checks. Every existing row reads null | fine: never names a new column | every read and write of the Kustom columns fails |
| `0043_apply_game_player_ratings.sql` (M18.10, audit finding 7) | Additive, one transaction: the function `apply_game_player_ratings(p_group, p_rows, p_only_unrated)`, security definer, `search_path ''`, service role only. Writes a whole fold's `game_players` rows in one statement and skips rows that did not move. Needs `0036` | fine: never calls it | **every game post fails** (the live fold claims through it) and the rebuild fails |

Both must be on hosted **before** the switch deploy (step 2). Neither changes anything the current build reads.

**The numbers between them belong to other runbooks.** `0037_group_live.sql` (M19.9, already on `main`),
`0038` (auth local claims) and `0039`..`0042` (the database performance work: `games.game_mode`, raw lz4,
`game_facts`, the member counts view) ship with their own deploys. None of them is needed by `0036` or `0043`, and
neither of these touches anything they create, so **none of them must precede this switch**, and this switch need
not wait for them. What the order does change is the CLI:

- `supabase db push` refuses to apply a migration numbered below the newest one hosted already has, unless you pass
  `--include-all`. `0037` is on `main`, so if hosted already has `0037` (or any of `0038`..`0042`) when you run
  this, pushing `0036` needs `--include-all`. Likewise, if `0043` lands first, the later `0038`..`0042` pushes need
  it. That is expected and safe here (the files are independent); it is the only reason to pass it.
- `db push` applies **every** pending file in the checkout you run it from. Push from the `SWITCH` checkout and
  read the dry run first: it must list exactly the files you mean to apply.

```sh
cd /Users/suyaser/lol && git checkout <SWITCH> && pnpm install
cd packages/db
supabase migration list --linked          # Remote: up to 0035, plus whichever of 0037..0042 have shipped
supabase db push --linked --dry-run       # must list 0036 and 0043, and nothing else
```

If the dry run lists a file from another runbook (say `0038`) that you are not shipping now, stop: run that runbook
first, or take the list to the lead. If it refuses with "Found local migration files to be
inserted before the last migration on remote database", add `--include-all` to both commands and read the list
again. Then:

```sh
supabase db push --linked                 # (--include-all if the dry run needed it)
supabase migration list --linked          # 0036 and 0043 now in Remote
```

Check (Supabase dashboard → SQL editor, read-only):

```sql
select count(*) filter (where r_after is not null) as kustom_rows, count(*) as rows from public.game_players;
select has_function_privilege('anon', 'public.apply_game_player_ratings(uuid, jsonb, boolean)', 'execute') as anon_can,
       has_function_privilege('service_role', 'public.apply_game_player_ratings(uuid, jsonb, boolean)', 'execute') as service_can;
```

`kustom_rows` 0; `anon_can` false, `service_can` true. The current build is still running and unaffected.

## 2. Deploy the switch build

**Do not deploy until step 1's check printed `service_can` true; without 0043 every game post fails.**

Promote `SWITCH` to production (Vercel). Wait for **Ready**. Go straight on to step 3: until step 4 has run, a
game folded by the new build starts every player's all-time track from 1200 with their old games count (their
`ratings.r` is still null), and the boards read nearly empty Kustom columns.

## 3. Dry run: the gate

From the `SWITCH` checkout, with `apps/web/.env.local` (or the environment) pointing at hosted:

```sh
cd /Users/suyaser/lol
pnpm --filter web rebuild-ratings --dry-run --hosted
```

Read, for every group:

- The first line, `target  <ref>.supabase.co (hosted)`. Anything else: stop.
- `gate  log loss X kustom vs Y stored openskill fold_p over N games (coin 0.693)`: **X ≤ Y** for `customs`
  and for any group with 50 or more rated games. (M18.3's replay: 0.700 vs 0.806 over 109 games.)
- `spearman A over n with 10+ games, B over all m; top 3 T of 3; places moved mean M, max X`: **A ≥ 0.85** for
  the same groups. B, the top 3 and the places moved are read, not gated (M18.3: 0.938 / 0.925, top 3 identical,
  mean 1.6, max 5).
- `board` (new place, old place, new Rating, old Rating) and `last 2 weeks` (each player's old and new per-game
  changes): the side by side research §7.1 asks for. Expect a compressed board (settled Ratings within about
  1100 to 1400) and settled changes around ±8.
- `considered`, `rated`, `skipped`, and no `PROBLEM` line.

**Step 4 runs only if both criteria pass for every gated group.** If either fails: do not run step 4; go to step 6
(rollback) now, save the dry-run output, and take it to the lead. The criteria are not loosened to pass.

A group with fewer than 50 rated games is not gated; its lines are information.

Optional, and recommended: run this same dry run once **before** step 2 (after step 1). It reads only, so it can run
from the `SWITCH` checkout while the previous build is still live; a failing gate then stops the switch before
anything visible changes. The run in this step is still required: it is the one on the data the rebuild will fold.

## 4. The rebuild

Immediately after step 3:

```sh
pnpm --filter web rebuild-ratings --hosted
```

Add `--force` only if it refuses with the 15-minute guard and you have checked that no lobby is live in any group.
Read:

- `target  ... (hosted)` again.
- Per group: `wrote  N game_players rows, M ratings rows (0043: N game_players rows moved in K calls)`. The
  first number and the `0043` number agree. K is the number of chunks: the rebuild writes whole games, at most
  2,000 rows a call, so each call stays inside PostgREST's statement timeout (about 8 s). Every group's `kustom`
  line matches its dry run.
- Exit 0. Exit 2 means games landed during the run ("Run it again"): run the same command again. Exit 1 is a
  refusal or a `PROBLEM`: read it, fix it, run again.
- **If it fails with `canceling statement due to statement timeout`**: run the same command once more, and report
  it to the lead with the output. Each chunk is its own transaction, so the chunks before the failure are written
  and the rest are untouched; the rebuild is idempotent, so the rerun writes only what is left (and the second run
  below writes 0). If the rerun times out too, stop there and go to the lead (the board is part-switched; step 6 is
  the way back if the lead says so).

Then run it a second time. It must say `wrote  0 game_players rows, 0 ratings rows` for every group: the fold is
idempotent, and the database skipped nothing it should have written.

## 5. The checks

1. **The board.** Open `/g/customs`, All time. Its order and Ratings are the dry run's `board` "new" columns (ties
   on Rating may list in either order). The same as SQL, read-only (SQL editor, `'customs'` in place of
   `:'slug'`): `packages/db/scripts/m18-10-checks.sql`, check A.
2. **One game's explanation.** Check B lists the latest game's ten stored rows (side %, K, share rank, award, n,
   printed all-time and weekly change). Open that game on the site and tap one row: the sentence says the same
   percent, the same K (and the first-ten line when n < 10) and the same share.
3. **The week.** Check C: `mismatches` 0 (every player's week points are the sum of that week's printed weekly
   changes). Then open one player's page on This week: the per-game weekly changes add up to the header.

Repeat check A for every other group with games. If anything disagrees, step 6.

Note the run here (the owner): date, the `target` line, and each group's `gate` lines, under M18.10 in
`docs/02-milestones.md` (through the lead).

## 6. Rollback

Only if the gate fails or a check disagrees. In this order:

1. **Redeploy `PREVIOUS`** (Vercel → Deployments → the previous production deployment → Promote).
2. **Per group, run the pre-step** `packages/db/scripts/m18-rollback-prestep.sql`. It nulls the 0036 columns of
   `game_players` and, on a row with no `mu_after`, 0034's breakdown; `ratings.r` stays. Without it the old
   build's rebuild un-rates a skipped game with a write that leaves `r_after` beside a null `fold_p`,
   `game_players_kustom_together` refuses it, and that rebuild aborts.

   **The route: the Supabase SQL editor** (Dashboard → SQL Editor, on the hosted project). First find the ids:

   ```sql
   select id, slug from public.groups order by slug;
   ```

   Then, per group: open `packages/db/scripts/m18-rollback-prestep.sql`, copy its `update` statement (everything
   after the comments), replace `:'group_id'` with the group's id in single quotes
   (`'00000000-0000-0000-0000-000000000001'` for `customs`), and run it. The editor runs it as one statement, so it
   lands whole or not at all. Then check:

   ```sql
   select count(*) from public.game_players
   where group_id = '<id>' and (r_after is not null or week_r_after is not null);
   ```

   It must be 0.

   **Or with psql**, if you prefer the file as is. The URL comes from the Dashboard → **Connect** → **Session
   pooler** connection string (it looks like `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`);
   put the database password in place of `[YOUR-PASSWORD]` (Dashboard → Project Settings → Database, reset it
   there if you do not have it). Check the host before anything runs:

   ```sh
   export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres'
   echo "$DATABASE_URL" | sed -E 's#^[a-z]+://([^:]*):[^@]*@([^:/]+).*#user: \1  host: \2#'
   # must print user: postgres.<ref>  (the ref in packages/db/supabase/.temp/project-ref) and the pooler host
   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
     -v group_id=<groups.id> -f packages/db/scripts/m18-rollback-prestep.sql
   ```

   It prints `UPDATE <n>`; then run the same check query.
3. **Run the old build's rebuild**, from a checkout of `PREVIOUS`:

   ```sh
   cd /Users/suyaser/lol && git worktree add ../lol-previous <PREVIOUS> && cd ../lol-previous
   pnpm install && cp /Users/suyaser/lol/apps/web/.env.local apps/web/.env.local
   pnpm --filter web rebuild-ratings --hosted
   ```

   It refills the OpenSkill columns and 0034's breakdown. `0036` and `0043` stay applied (the old build ignores
   both). A later re-switch is steps 2 to 5 again; it needs no step of its own.

**No patch notes on a rollback**: step 7 never runs after this step.

## 7. The patch notes (after step 5 passes)

Only once every step 5 check has passed for every group, and never on a rollback: **the owner posts the
patch-notes image (the lead renders it) in the group's Discord**, by hand, once per group. Nothing in the app or in
this runbook sends it: there is no automated send and no code for it (owner, 2026-10-04). Links in the post point
at the production domain, `https://kustom-delta.vercel.app` (e.g. `https://kustom-delta.vercel.app/g/customs`).

---

## The local walk (platform-engineer, 2026-10-04)

Walked on the local stack (Supabase CLI, `127.0.0.1:54321`) from branch `m18-10-runbook`. Local is not hosted:
it holds 9 rated `customs` games and 50 players, so no player has 10 games and the Spearman 10+ line reads `-`.
The point is that every step runs and prints what this runbook says.

**Step 1** (local equivalent: `supabase migration up --local`, 0036 already applied):

```
Applying migration 0043_apply_game_player_ratings.sql...
Local database is up to date.
```

`packages/db/scripts/m18-10-throwaway-check.sh` (0043 on a throwaway restore of local; the shared stack only read):

```
ok: 0036 is in the dump
ok: a second apply fails and rolls back
ok: fingerprint a38a285785852d8272351bdf497ed98e unchanged
secdef=true config=search_path="";statement_timeout=60s
ok: execute for public = f
ok: execute for anon = f
ok: execute for authenticated = f
ok: execute for service_role = t
group customs: 90 game_players rows
ok: every stored row of the group handed back as stored writes 0
ok: a whole Kustom write on a real game writes 10, the same rows again 0, a claim on it 0
ok: refused one row of r_after without k (the whole call) (game_players_kustom_together)
ok: refused a row missing a column (every rating column)
ok: refused a duplicate row (appears twice)
ok: refused anon (permission denied for function apply_game_player_ratings)
ok: refused authenticated (permission denied for function apply_game_player_ratings)
ALL CHECKS PASSED
```

(`statement_timeout=60s` is the function's setting as applied. It does not lengthen anything: the caller's
statement timeout, PostgREST's ~8 s on hosted, governs a call, which is why the rebuild writes in chunks.)

**Step 3**, `pnpm --filter web rebuild-ratings --dry-run --group customs`:

```
target        127.0.0.1:54321 (local)

group         customs (00000000-0000-0000-0000-000000000001)
considered    9 games
rated         9
skipped       none
would change  90 game_players rows, 50 ratings rows
players       50 with a rated game
seeds         0 to store for the first time
breakdowns    0 game_players rows to fill for the first time (0034)
kustom        90 game_players rows, 50 ratings rows, 4 weeks
roles         0 inferred pairs moved
biggest move  none
gate          log loss 0.742 kustom vs 0.802 stored openskill fold_p over 9 games (coin 0.693)
              spearman - over 0 with 10+ games, 0.979 over all 50; top 3 -; places moved -
board         new  old  player                 new Rating  old Rating
              1    1    Player1                1226        1396
              2    2    Player0                1226        1396
              3    3    Player2                1226        1396
              4    4    Smolder Boulder        1219        1341
              5    5    Baron Nashor Lover     1218        1312
              6    6    Lux Aeterna            1216        1312
              7    7    Mina                   1216        1312
              8    9    Player4                1216        1312
              9    10   Player3                1216        1312
              10   11   Ali                    1216        1312
last 2 weeks  Ali                    old -112 +138  new -16 +18
              Fil0                   old +112 -138  new +16 -18
              Fil1                   old +112 -138  new +16 -18
dry run: nothing was written
took          205 ms
```

**Step 4**, `pnpm --filter web rebuild-ratings --group customs`, then the same again:

```
target        127.0.0.1:54321 (local)

group         customs (00000000-0000-0000-0000-000000000001)
considered    9 games
rated         9
skipped       none
wrote         90 game_players rows, 50 ratings rows (0043: 90 game_players rows moved in one call)
players       50 with a rated game
seeds         0 stored for the first time
breakdowns    0 game_players rows filled for the first time (0034)
kustom        90 game_players rows, 50 ratings rows, 4 weeks
roles         0 inferred pairs moved
biggest move  none
took          251 ms
```

```
target        127.0.0.1:54321 (local)

group         customs (00000000-0000-0000-0000-000000000001)
considered    9 games
rated         9
skipped       none
wrote         0 game_players rows, 0 ratings rows (0043: 0 game_players rows moved in one call)
players       50 with a rated game
seeds         0 stored for the first time
breakdowns    0 game_players rows filled for the first time (0034)
kustom        90 game_players rows, 50 ratings rows, 4 weeks
roles         0 inferred pairs moved
biggest move  none
took          105 ms
```

After the review's chunking change (whole games, at most 2,000 rows a call), the walk of step 4 was repeated from a
rolled-back `customs` (`ratings.r` was still filled from the first walk, hence 0 ratings rows):

```
wrote         90 game_players rows, 0 ratings rows (0043: 90 game_players rows moved in 1 call)
wrote         0 game_players rows, 0 ratings rows (0043: 0 game_players rows moved in 0 calls)
```

The two blocks above were printed before that change, when the suffix read `moved in one call`.

**Step 5**, `psql -v slug=customs -f packages/db/scripts/m18-10-checks.sql`:

```
 place |       player       | rating | games
-------+--------------------+--------+-------
     1 | Player0            |   1226 |     4
     2 | Player1            |   1226 |     4
     3 | Player2            |   1226 |     4
     4 | Smolder Boulder    |   1219 |     1
     5 | Baron Nashor Lover |   1218 |     1
     6 | Ali                |   1216 |     1
     7 | Lux Aeterna        |   1216 |     1
     8 | Mina               |   1216 |     1
     9 | Player3            |   1216 |     1
    10 | Player4            |   1216 |     1

 player | side | side_pct |  k   | share_rank | award | n | change | week_change
--------+------+----------+------+------------+-------+---+--------+-------------
 Fil0   |  100 |       60 | 30.4 |            | none  | 1 |    -18 |         -18
 Fil1   |  100 |       60 | 30.4 |            | none  | 1 |    -18 |         -18
 Fil2   |  100 |       60 | 30.4 |            | none  | 1 |    -18 |         -18
 Zoe    |  100 |       60 | 30.4 |            | none  | 1 |    -18 |         -18
        |  100 |       60 | 30.4 |            | none  | 1 |    -18 |         -18
 Ali    |  200 |       40 | 30.4 |            | none  | 1 |     18 |          18
 Fil3   |  200 |       40 | 30.4 |            | none  | 1 |     18 |          18
 Fil4   |  200 |       40 | 30.4 |            | none  | 1 |     18 |          18
 Fil5   |  200 |       40 | 30.4 |            | none  | 1 |     18 |          18
 Fil6   |  200 |       40 | 30.4 |            | none  | 1 |     18 |          18

 player_weeks | mismatches
--------------+------------
           50 |          0
```

The Ratings are the dry run's "new" column; the 1216 tie lists by name here and by the board's tie rule in the dry
run. The latest local game has no performance stats (share rank null, award `none`, every share 1.0), and its
players are at n 1, so K is 30.4 (first ten games) and the 60% favourites lost 30.4 × 0.6 = 18.2, printed −18.

**Step 6**, rehearsed on local after the checks: the pre-step for `customs` (`UPDATE 90`), then `PREVIOUS`'s
rebuild, run from an export of `origin/main` at `a4f4e4be` (the OpenSkill build):

```
target        127.0.0.1:54321 (local)

group         customs (00000000-0000-0000-0000-000000000001)
considered    9 games
rated         9
skipped       none
wrote         40 game_players rows, 0 ratings rows
players       50 with a rated game
seeds         0 stored for the first time
breakdowns    0 game_players rows filled for the first time (0034)
roles         0 inferred pairs moved
biggest move  none
took          85 ms
```

Afterwards local `customs` has 90 rows with `mu_after` and `fold_p`, and none with `r_after` or `week_r_after`:
the pre-switch state, which is where the local stack was left.

The owner's hosted run: not yet (record the `target` line and the gate lines here and under M18.10).
