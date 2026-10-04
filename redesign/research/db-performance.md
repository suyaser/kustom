# Database and data-access performance audit (Kustom 2.0)

Platform engineer, 2026-10-04, branch `db-perf-audit` (from `origin/main` at `06323b49`, which has the three
M19 lanes: `lib/cache/*`, `lib/perf/*`). Audit and plan only: no app code or migration in the repo changed. Every
number below was measured on a **throwaway** Postgres restored from a read-only `pg_dump` of the local stack. The
shared local stack was only read, and nothing hosted was touched.

## 0. The budget, and the verdict

The owner's budget. Every finding is judged against it:

| Metric | Budget |
|---|---|
| TTFB | < 800 ms |
| LCP | < 2,500 ms |
| INP | < 200 ms, and every tap gives visual feedback within 200 ms |

Production runs Vercel functions in Dublin (`dub1`), next to Supabase `eu-west-1`, so a Supabase round trip is
about 1 to 2 ms. The main tables use **2 ms** of simulated RTT; 40 ms columns are kept where they show what the
earlier audits saw. With round trips this cheap, **bytes read and DB time are what cost**, not the number of
waves.

**Today (about 140 games, 35 players per group).** Every page is inside TTFB and LCP. The exceptions:
- **Stats and Champions, the first render after each game end**: 410 to 890 ms, and 957 ms once. Those renders
  read 9 MB of `games.raw`, at exactly the moment everyone is looking.
- **Tonight, the first visit of the day**: 470 ms. The daily game reads 500 raw blobs.

The real miss today is the tap rule. Tab taps show nothing for 193 to 411 ms (M19.15), and controls have their
dead window (M19.3). INP as Chrome measures it is fine (Event Timing max 32 to 40 ms).

**At projected scale (one group with 2,000 games over a year, plus 20 groups of 300).**
- **Stats and Champions break**: 3.4 to 7.7 s TTFB, 10.7 s LCP. The cached value outgrows Next's 2 MB entry
  limit, so they are never cached. Every view reads 127 MB, and the raw read sometimes **hits anon's 3 s
  `statement_timeout`** (the page fails).
- Also over or near budget:
  - the signed-in player page and You: 0.46 to 0.69 s at 2 ms, 0.9 s at 40 ms, reading 8 MB;
  - the Games list: 0.53 s warm, all of it DB time detoasting raw for one string;
  - Tonight's first visit of the day: 0.9 to 2.1 s;
  - the daily-mystery cron: 16 s for 22 groups;
  - `rebuild-ratings`: 18,190 single-row requests and not atomic.

The fix is four migrations and a handful of reader changes, not a redesign. The three that matter most are:

1. `game_facts`, the slim raw projection (0041). Stats reads 10 to 20 times less.
2. lz4 on `games.raw` (0040). No code change: the Games list goes from 527 to 138 ms at 2,000 games.
3. `games.game_mode` (0039). The Games list count and page go from 395 to 1.4 ms in the DB.

## 1. Method

- **Throwaway stack** (`scratchpad/dbperf/up.sh`, the `m14-58-throwaway-check.sh` pattern):
  - `pg_dump -Fc --schema=public --schema=auth` of `supabase_db_customs-night`, restored into a container on
    the same image (`supabase/postgres:17.6.1.166`). The local stack already carries 0036 (Kustom) and
    `group_live`, so the throwaway does too.
  - PostgREST v14.5 (same image, `db-max-rows 1000`, anon `statement_timeout` 3 s, authenticated 8 s) and
    GoTrue, both on a **scratch JWT secret** generated for the throwaway. The local stack's keys were never
    copied.
  - A small Kong stand-in proxy on `127.0.0.1:54430`.
- **Seed** (`seed.mjs` writes CSVs, then `COPY`):
  - `perf-today`: 140 games, 35 players.
  - `perf-year`: 2,000 games over 365 days, 40 players.
  - `perf-g01` to `perf-g20`: 300 games each, 22 players.
  - In total 8,150 games, 81,500 `game_players` rows, 81,400 `lobby_members` rows and 24,400 `splits`.
  - Every game carries a real-size end-of-game block (the 16.17 fixture, 62 KB of text per game), plus a running
    OpenSkill fold, the fold breakdown, lobbies, three splits per lobby and ratings.
- **App**: `next build && next start` of this branch against the throwaway, with the repo's
  `scripts/perf/preload.mjs` (plus response bytes) and `PERF_SB_DELAY_MS` = 2 (prod) or 40 (the M19 bench's
  assumption).
  - Per page: one cold render (empty Next data cache), then warm renders (median).
  - Signed-in pages use a scratch GoTrue user on the throwaway, linked to the group owner through a fake Discord
    identity.
- **SQL**:
  - `pg_stat_statements`, plus `auto_explain` (`log_analyze`, `log_buffers`, threshold 0 for a full walk, then
    25 ms), over every page, an eog ingest, lobby posts, the rebuild and the crons.
  - Hand-written `EXPLAIN (ANALYZE, BUFFERS)` as `anon` for each candidate change.
  - Payloads serialised with `json_agg(...)::text`, the way PostgREST does it.
- **Front end**: Playwright at 375 x 812, touch, DPR 2, 4x CPU, unthrottled, CDP Fast 4G and CDP Slow 4G; LCP,
  CLS, Event Timing, and time from a tab tap to the first DOM change.
- **Not measured**:
  - hosted compute (a Micro or Small instance has less RAM and slower disk than this laptop, so DB-bound numbers
    here are a floor);
  - Vercel's data cache, as opposed to `next start`'s file cache.

## 2. Measurements

### 2.1 Pages: TTFB (ms), queries, KB read from Supabase, 2 ms RTT

| Page | Today: cold / warm | Today KB | 2,000 games: cold / warm | 2,000 games KB (warm) | Over budget? |
|---|---|---|---|---|---|
| Tonight (result screen) | 470 (first of day) / 68 | 345 / 26 | 878 / 40 | 4,208 cold / 54 | Projected, first visit of the day |
| Board, This week / All time / Last week | 41 / 38 / 40 | 26 / 24 / 179 | 31 / 50 / 44 | 43 / 27 / 285 | No |
| Games list, page 1 | 69 / 58 | 464 / 186 | 483 / **527** | 4,079 cold / 181 | Projected (DB time) |
| Games list, page 3 | 77 / 88 | 186 | 565 / **534** | 187 | Projected |
| Game page | 34 / 32 | 78 | 22 / 26 | 78 | No |
| Player page (anon) | 74 / 63 | 608 | 194 / 129 | **7,753** | Bytes grow with history |
| Player page (signed in) | 62 / 64 | 640 | 613 / **691** | **8,190** | Projected |
| You (signed in) | 108 / 77 | 622 | 470 / 458 | **7,903** | Near |
| Stats (Records) | 363 to 890 / 36 | **8,899** | **7,662 / 3,922** | **127,061 every view** | Projected: breaks |
| Stats, Champions | 409 to 957 / 50 | **8,899** | **5,584 / 4,967** | **127,061 every view** | Now, cold after each game; projected: breaks |
| Stats, 1v1 | 94 / 8 | 526 | 561 / 12 | 7,448 cold | No |
| Mode, Mystery | 33, 22 | 0 to 2 | 12, 15 | 0 to 2 | No |
| Admin Members (signed in) | 84 / 71 | 166 | 194 / 181 | **2,131** in 29 requests | No (bytes grow) |
| Admin Games | 264 at 40 ms | 182 | 247 at 40 ms | 260 | No (HTML is 905 KB) |

At 40 ms RTT, the bench's old assumption (from `walk-anon`/`walk-signed`), 2,000 games:
- Stats: 5.4 s cold, 4.7 s warm.
- Champions: 6.9 s cold, 3.7 s warm.
- Tonight cold: 1.26 to 2.07 s.
- Games list: 0.86 s cold, 0.49 s warm.
- You and player page (signed in): 0.85 to 0.93 s.
- Everything at today's scale stays under 640 ms.

### 2.2 Right after a game end

`aftereog.mjs` posts an eog through `/api/companion/game`, then renders each page at once. These renders pay the
cold path, because the eog expires `games:` and `stats:`.

| | Today, 2 ms (3 runs) | 2,000 games, 40 ms |
|---|---|---|
| eog ingest route | 202 to 525 ms | 2,119 to 2,256 ms (48 calls, about 45 sequential) |
| Duplicate eog (idempotent, writes nothing) | | 839 ms |
| Tonight | 56 to 117 ms | 283 ms |
| Games list | 59 to 118 ms (462 KB, calibration) | **1,017 ms** (53 queries, 4 MB) |
| Stats, Champions | **409 to 891 ms** (9 MB each) | 3.7 to 6.9 s |
| 1v1 | | 866 ms |

### 2.3 Write paths and crons (40 ms RTT unless noted)

| Path | 2,000 games | Note |
|---|---|---|
| `rebuild-ratings --group perf-year` (first run, every row moves) | **12.5 s, no RTT added; 18,190 `PATCH` requests** | `WRITE_CONCURRENCY` 25. At 40 ms that is about 30 s of writes alone. Not atomic. Each `PATCH` is one Realtime event (`game_players` is published) |
| The same, nothing moved | 3.5 s, 118 `game_players` pages, 29 MB | |
| 0043 RPC, 18,200 rows in one call (throwaway) | **0.80 s** (8.5 MB body); 0.46 s when nothing moved | One transaction; skips unmoved rows |
| Lobby post (create / 10 members / unchanged) | 1,036 / 1,091 / 574 to 600 ms | 13 sequential calls; data-independent (M19.8) |
| `/api/cron/mystery` (22 groups) | **16.3 s, 410 MB read** | `ensureTodayMystery` reads the last 500 **whole raw blocks** per group (33 MB for `perf-year`); groups run in sequence |
| `/api/cron/leaderboard` | 6.3 s | Board loads for each group, in sequence (grows with groups) |
| `/api/cron/window` | 1.5 s | |

### 2.4 Front end, 375 px, 4x CPU

Today's scale (`perf-today`), LCP in ms:

| Page | Unthrottled | Fast 4G | Slow 4G |
|---|---|---|---|
| Tonight | 668 (cold) | 552 | 960 (CLS **0.177**) |
| Board | 292 | 472 | 880 |
| Games | 320 | 428 | 844 (CLS 0.048) |
| Game | 212 | 416 | 868 |
| Player | 284 | 496 | 908 |
| Stats / Champions / 1v1 | 484 / 688 / 284 | 364 / 376 / 340 | 860 / 880 / 844 |
| You | 204 | 356 | 884 |

At 2,000 games on Fast 4G, LCP follows TTFB:
- Stats **10,704** and Champions **6,812**.
- Tonight (cold) 1,492, Games 832, player 808.
- You and player page signed in: 1,296 and 1,228.

Other front-end results:
- **JS** (gzip, CDP encoded length): Tonight 206 KB, Board 179 KB, Games 175 KB. These are unchanged since the
  first audit.
- **Taps** (`fe.mjs`, unthrottled / Fast 4G). Time from a tab tap to the **first visible change** in the page:
  - Board 282 / 411 ms
  - Games 193 / 229 ms
  - Stats 116 / 169 ms
  - You 69 / 198 ms
  - Tonight 311 / 324 ms

  Nothing changes on screen until the new page arrives: no pressed state, no `loading.tsx`. Event Timing (Chrome's
  INP input) never exceeded 40 ms, so INP passes while the owner's "visual feedback within 200 ms" rule fails on
  Board and Tonight, and on any phone network.
- **CLS on Tonight's result card**: a 0.12 shift at about 2.7 s on Slow 4G (`SECTION ... "The odds were Blue 47
  percent"`, the `BLUE WINS` heading and the MVP line move). That is late content or a font swap after
  hydration. It is outside the three budgets but over the 0.1 "good" line. Owner: web.

## 3. Findings

Scale `T` = today (140 games), `P` = projected (2,000 games). Times are DB or server at 2 ms RTT unless marked.
"Blocks" is against the budget in section 0.

| # | Query / path | Scale | Before | Cause | Fix | Expected after | Risk | Blocks |
|---|---|---|---|---|---|---|---|---|
| 1 | Stats Records and Champions window read: `games?select=...,raw->gameMode,raw->teams,raw->participants,raw->participantIdentities&group_id=eq.X&order=started_at.desc,lcu_game_id.desc`, paged by 1,000 (`lib/stats/load.ts` `loadGamePage`, shape `facts`) | T / P | T: 8.9 MB, 363 to 957 ms cold after each eog. P: 110 MB, 3.9 to 5.0 s for the two pages through PostgREST; one page hit `canceling statement due to statement timeout` (anon 3 s) | (a) The four JSON paths **each** detoast and decompress the whole ~60 KB block: 4 detoasts per row. (b) `order by started_at, lcu_game_id` is not covered by an index, so the planner seq-scans and sorts **with the projected paths in the sort tuples**: `Sort Method: external merge Disk: 158 MB` per page, and page 2 recomputes page 1 | `game_facts` (0041), written at ingest by `rawFactsFromUnknown`; the reader selects `game_facts(facts)` instead of the paths. Covering index (0039) | P: 385 to 425 ms, 11 MB (measured through PostgREST). T: about 25 ms, 0.8 MB | Backfill must run before readers switch (fallback to raw when a row is missing) | **Now** (cold after each game, borderline) and **P (breaks)** |
| 2 | Stats segment cache (`lib/stats/cached.ts`) | P | 2,000 games: cached value 17.5 MB of JSON, 3.2 M chars gzipped and base64, so `oversized` and never cached. 300 games: 2.8 MB / 484 KB, fine. Crosses the 1.8 M-char limit at about 1,100 games | The cached value is the **fold input and output** (`fun` / `halls` hold per-game rows), not what renders (the page HTML is 330 to 660 KB). On `oversized`, `cachedStatsSegment` **computes the segment a second time** (`computeSegment` inside the cache, then again in the fallback): 50 queries and 127 MB per view instead of 25 and 63 MB | Web: cache the trimmed view (top N per hall, what the page prints); drop the second compute | Cached at any size; warm views 0 queries | Parity tests on the rendered text | **P (breaks)** |
| 3 | Games list count and page: `games?select=id&...&or=(raw->>gameMode.is.null,raw->>gameMode.imatch...)` with `count=exact`, then the page with `mode:raw->>gameMode` (`lib/games/list.ts`) | P | 310 ms count + 273 ms page (EXPLAIN: 395 ms, 28,000 buffers) for 30 rows | Filter on `raw->>'gameMode'` detoasts every candidate row's blob | 0039 `games.game_mode` (generated) + filter on it; 0040 lz4 | 1.4 ms in the DB (measured). lz4 alone, **no code change**: page 527 to 138 ms, page 3 534 to 190 ms | Low (generated column, no writer) | P (DB-bound, about 0.5 s) |
| 4 | Every other `raw->gameMode` reader: 20 call sites (calibration, Tonight, last game, your night, player stats `withGameMode`, fearless, board ARAM label, rebuild, rebuild cron, admin games, AI facts, OG, week notes, landing) | T / P | Whole group: 130 ms (P) per read; a 1,000-game page 135 to 153 ms | One full detoast per row for one string | Readers select `game_mode` after 0039 | 0.8 ms | Low | Part of 3, 5 and 6 |
| 5 | Player page and You: `loadPlayerStats` → `readWindow` (`lib/stats/load.ts`) | T / P | T: 0.6 MB. P: **7.7 to 8.2 MB**, 41 to 47 queries (23 `game_players` chunks of 315 KB, games paged with `raw->gameMode`), 0.46 to 0.69 s; 0.9 s at 40 ms | Reads **every** game and `game_players` row of the group to describe one player; not cached (per player and window) | Web: read only the player's games (index `(group_id, player_id)` from 0042: 603 rows in 0.7 ms), then those games' rows; `game_mode` | About 1/3 of the bytes for a player in 30% of games; < 200 ms | Duo and nemesis lines need the other players' rows in the same games: still covered | P |
| 6 | Daily game: `ensureTodayMystery` reads `games?select=id,started_at,duration_s,winning_side,raw&limit=500` (`lib/mystery/ensure.ts:234`), and `lib/mystery/service.ts:462` reads one game | T / P | Tonight's first visit of the day: T 470 ms, 345 KB... P 878 ms, **33 MB** (394 ms for that query). Cron: 16.3 s, 410 MB for 22 groups | Whole raw blocks only to run `rawFactsFromUnknown` and read the mode | Read `game_facts` + `game_mode` | P: about 3 MB, about 60 ms. Cron about 1 s for 22 groups | Low | P; the cron's 60 s limit at about 80 groups |
| 7 | `rebuild-ratings` and `/api/cron/rebuild` writes (`lib/ingest/rebuild.ts` `writeGamePlayerRatings`), and the live fold's 10 sequential claims (`lib/ingest/rating.ts`) | T / P | P: 18,190 `PATCH` requests, 12.5 s locally; not atomic; one Realtime UPDATE per row to every open Tonight (`game_players` is in `supabase_realtime` and Tonight subscribes to it) | No batch update in PostgREST, so one statement per row | 0043 `apply_game_player_ratings(p_group, p_rows, p_only_unrated)` | 0.8 s, one transaction, unmoved rows skipped | The function must track every rating column (0036's Kustom columns included) | P. The **M18 switch rebuild** rewrites every row of every group |
| 8 | Admin Members: every `game_players` row of the group with `games!inner(started_at)`, paged (`lib/admin/groupMembers.ts`) | T / P | T: 166 KB, 10 queries. P: 2.1 MB, 29 queries; each page is a parallel seq scan of `game_players` (no group index) | No group index on `game_players`; counting in TypeScript | 0042 index + `group_member_game_counts` view | 1 request, 40 rows, 4.4 KB, 5 to 36 ms | None (service role only) | No (cost grows) |
| 9 | Calibration (`lib/tonight/calibration.ts`, `lib/games/calibrationCache.ts`): 3 sequential pages of `games` + nested `game_players`, then 3 sequential `splits` pages joined to `lobbies` | P | Games list cold after each eog: 1,017 ms at 40 ms, 483 ms at 2 ms, 4 MB | Group-wide nested read paged in sequence; `splits` has no `group_id` (join through `lobbies`, scanned in `splits_pkey` order) | `game_mode` (0039). Web: parallel pages, narrower columns | About 150 ms cold | Low | P |
| 10 | Tab taps and controls | T | First visible change: Board 282 to 411 ms, Tonight 311 to 324 ms; controls' dead window about 0.7 s (performance.md) | No pending state, no `loading.tsx` | M19.15, M19.3 (web) | < 100 ms | | **Now** (tap rule) |
| 11 | `games.raw` storage | T / P | 293 MB for 8,150 games (pglz) | Default `pglz` | 0040 lz4 | 116 MB; detoast 3.3x faster; inserts 2.5x faster | lz4 must exist on the hosted build (it does on the local image of the same version) | Helps 1, 3, 4, 6 |
| 12 | Realtime publication | T / P | `games` is published **with `raw`**: every eog, ban enrichment and rule check sends about 60 KB to every subscribed Tonight. `game_players` is published: a rebuild is 18,000 events | Publication built before group filters existed | M19.11 (already planned) removes them; until then 0043's skip-unmoved cuts the rebuild storm | | | Phone data, refresh storms |
| 13 | `lobbies` by group and time (Tonight, landing) | P | Uses the global `lobbies_created_at_idx`, then filters the group | No `(group_id, created_at)` index | 0044 | Same at today's scale; stays group-scoped as groups multiply | None | No |
| 14 | `ratings_group_ordinal_idx` | T / P | Used only as a `group_id` prefix (the PK serves it); rewritten on every fold because `ordinal` is generated; dead after the Kustom switch | | 0044 drop | Fewer index writes | None | No |
| 15 | eog ingest | T / P | 48 calls, about 45 sequential: 2.1 s at 40 ms, 0.2 to 0.5 s at 2 ms; reads the 66 KB raw back twice after inserting it | Waterfall; per-player claims | 0043 for the claims; drop the raw re-reads (the route has the body) | About 100 ms at 2 ms | | No (prod RTT) |

What is **not** a problem:
- RLS cost on anon reads: every anon policy is `using (true)`, and views are owner views.
- The board, game page, mode and mystery: under 55 ms at both scales.
- `splits`, `lobby_members`, `ratings`, `game_players(game_id)`: every hot lookup used its index
  (`splits_one_chosen_per_lobby_idx`, `splits_lobby_created_at_idx`, `lobby_members_pkey`, `ratings_pkey`,
  `game_players_pkey`).
- Seq scans on `players`, `groups`, `group_modes` and `fearless_state`: correct choices on tables of a few hundred
  rows.

The candidate indexes in the brief, checked one by one:
- `games(group_id, started_at desc, lcu_game_id)`: yes, 0039.
- `game_players(game_id)`: already the PK's prefix.
- `game_players(player_id, game_id)`: the existing `(player_id)` index serves every player query (about 600 rows
  each); not needed.
- `lobbies(group_id, created_at)`: yes, 0044.
- `ratings(group_id, ...)`: the PK.
- `lobby_members`: the PK.
- `splits(lobby_id, is_chosen)`: the existing partial unique index.

Unused in the walk but needed:
- `splits_roster_key_idx`: the Roll repeat penalty.
- `lobbies_party_created_at_idx`, `lobbies_active_party_idx`: lobby ingest.
- `lobby_members_player_id_idx`: FK cascade.
- `players_is_admin_idx` (16 KB) is legacy, but not worth a migration.

## 4. The raw-blob projection: options compared

`rawFactsFromUnknown` (`apps/web/lib/stats/rawFacts.ts`) reads `teams[].players[]` (an eog block),
`participants` with `participantIdentities` (a match-history detail) and `teams[].bans`. It returns about 26
small fields per player plus the ban list. Measured with the real function over all 8,150 seeded games:
**5.4 KB of JSON per game**, against 62 KB of raw.

| Option | What it is | DB read, 2,000 games | Payload | Disk | Writer | Verdict |
|---|---|---|---|---|---|---|
| Today | Four `raw->` paths | 764 + 1,329 to 3,790 ms (2 pages; external sort 158 MB) | 110 to 122 MB | 293 MB (whole table) | none | Breaks |
| B. `raw` whole, once | One detoast, no paths | 342 to 396 ms (page 1) | about 125 MB | | none | Bytes still kill the function |
| V. View `raw_facts(raw)` | SQL function over raw at read | Same detoast as B, plus the function | Small | 0 | none | **No.** It moves no DB work, only wire bytes, and duplicates the TS logic in SQL |
| G. Stored generated column on `games` | `facts jsonb generated always as (raw_facts(raw)) stored` | About the same as J | Small | +1.2 KB/game **inside the `games` heap** (compressed below the 2 KB TOAST threshold), so every `games` scan gets 10x wider | Self-maintaining, including ban enrichment | **No.** It needs an `IMMUTABLE` SQL or plpgsql port of `rawFactsFromUnknown` (both shapes, the fallbacks, the bot filter): a second implementation to keep in parity. The ADD COLUMN rewrite took 6.9 s on the throwaway |
| J. **`game_facts` table (jsonb), written at ingest by the TS function** | One row per game: `{byPuuid, bans}` exactly as returned | **33 to 40 ms per page in SQL; 385 to 425 ms through PostgREST for both pages** | **11 MB** | **10 MB for 8,150 games** | eog, backfill, ban enrichment + a backfill command | **Chosen.** One implementation (TS), reader change is a select swap, `facts_version` lets a reader change trigger a recompute |
| T1. Typed columns on `game_players` (+ `games.bans`) | 23 columns per player row, the 0014/0015 precedent | 4.7 ms per 1,000 rows | 16.9 MB if all are selected (keys repeat per row), less if narrow | `game_players` heap 17 to 21 MB | ingest + `copy-raw-stats`-style backfill | Good later for **SQL-side** records (pentas, steals). One migration per new field. Not needed now |

Recommendation: **J**. Columns are worth it only for facts we want to aggregate in SQL, and today every fold is
TypeScript. J keeps the facts beside the reader that defines them. If it is ever wanted, T1 can be derived from J
later.

## 5. Aggregates, snapshots, normalisation, and Kustom

- **Read-time aggregates in Postgres beat materialized views here.** With the 0042 index, a per-member count over
  a 2,000-game group is 12 to 36 ms, and 4 ms at 300 games. A materialized view would need a refresh at every
  ingest and rebuild (`refresh ... concurrently` needs a unique index and rewrites the whole result), plus its own
  staleness rules. Use plain views or RPCs for **counts and maxima**, and only those.
  - Rating math and stat folds stay in TypeScript (`packages/core`, `lib/stats`). Postgres only narrows what is
    shipped to them.
- **Per-player per-window aggregates for the board, player page and stats**: not as tables. The board is 27 to 285
  KB at both scales and fine. The player page's problem is reading the whole group (finding 5), not the lack of a
  summary. Stats' problem is raw (finding 1) and what is cached (finding 2).
  - If a fold must survive the 2 MB data-cache limit, the next step is a **Postgres-backed snapshot**:
    `group_snapshots(group_id, kind, source_version, data jsonb)`, written read-through by the same TS fold and
    keyed by the group's games version. Not proposed now: trimming the cached value (finding 2) removes the need.
- **Normalisation.**
  - `games.raw` is the source record and stays; `game_facts` is derived and rebuildable.
  - `game_players` already carries a denormalised `group_id` (0018). It is useful, and 0042 indexes it.
  - `splits` and `lobby_members` have no `group_id`. That matters to Realtime (M19.9 / M19.11 settle it with
    `group_live`) and to calibration's join through `lobbies` (finding 9). Adding `group_id` to `splits` is not
    proposed: calibration is cached, and M19.11 removes the Realtime reason.
  - `ratings.ordinal` is a generated column that only `packages/core` names. 0044 drops its index; the column
    stays until M18.12.
- **Kustom 0036 (branch `kustom-rating`), interactions.** No conflict: these migrations are numbered 0039 and up
  and touch none of 0036's columns, except that 0043 **names** them.
  1. 0043's function lists 0036's nine `game_players` columns, so it must land after 0036.
  2. The M18 switch rebuild rewrites every `game_players` row of every group, which is exactly finding 7. Land
     0043 and switch `writeGamePlayerRatings` to it **before** the switch rebuild. The `kustom-rating` branch still
     has `WRITE_CONCURRENCY` 25 single-row updates.
  3. After the switch, `ratings_group_ordinal_idx` is dead (0044).
  4. The weekly track (`week_r_after` per player per week) reads `game_players` through `games(group_id,
     started_at)`, which 0039's index covers.

## 6. Postgres and Supabase settings

- **Connection pooling from Vercel**: not applicable to app traffic. The app speaks HTTP to PostgREST and GoTrue
  through supabase-js and opens no Postgres connections, so Supavisor is unused. The pools that matter:
  - PostgREST's own pool (sized by compute).
  - Our fan-out into it: `mapChunks` runs 6 at a time per render; the rebuild runs 25 at a time (0043 removes
    that).
  - After a game end, 10 viewers re-render at once and every one misses the same cache: `unstable_cache` does not
    coalesce concurrent misses. Finding 1 is what makes that expensive.
- **Statement timeouts** (role settings on the image; verify hosted is the same):
  - anon 3 s, authenticated 8 s. `service_role` has none of its own and inherits authenticator's 8 s.
  - Finding 1's raw read is the only anon statement measured near 3 s.
  - 0043 sets `statement_timeout = '60s'` on the function, so a large group's rebuild is not cut at 8 s.
- **PostgREST response size**: `db-max-rows` 1000 means every group-wide read pages. There is no hard response
  cap, but a 63 MB JSON body is built in memory by `json_agg` in Postgres, then parsed by Node twice (finding 2).
  The fixes above keep responses under about 11 MB at 2,000 games.
- **work_mem** is 4 MB (the image default), which is why finding 1 spilled 158 MB to disk per page. Do not raise
  it to paper over the raw read; 0041 removes the sort's payload.
- **TOAST compression**: `default_toast_compression` is `pglz`. 0040 sets lz4 on `games.raw` only.
- **Realtime publication** (local stack, read): `games` (with `raw`), `game_players`, `lobbies`, `lobby_members`,
  `splits`, `ratings`, `group_modes`, `fearless_state`, `group_live`. See finding 12; M19.11 is the fix and
  should not wait long after M19.10.

## 7. The plan, ranked by win against the budget

Migrations are numbered after 0036 (`kustom-rating`), 0037 (`m19-9-live`) and 0038 (`auth-local-claims`). Each
was applied on the throwaway in order, and a second apply fails and rolls back (`scratchpad/dbperf/apply.sh`):

| File | Applied in |
|---|---|
| 0039 | 2,957 ms |
| 0040 | 1,916 ms |
| 0041 | 70 ms |
| 0042 | 141 ms |
| 0043 | 76 ms |
| 0044 | 78 ms |

That is on 8,150 games; hosted today is about 1/30 of it.

| Rank | Change | Owner | Size | Budget win | Blocks |
|---|---|---|---|---|---|
| **1** | **0041 `game_facts`** + ingest writes it (eog, backfill, ban enrichment) + `backfill-game-facts` command + readers switch (Stats Records and Champions, mystery ensure and service, `/games` cards, AI facts) with a raw fallback while backfilling | platform: migration, ingest, command. web: readers | M (platform 1 d, web 1 d) | Stats cold after each game: 0.4 to 0.9 s → about 0.05 s (T); 3.9 to 7.7 s → about 0.5 s (P). Mystery: 33 MB → 3 MB | **Now** (Champions cold) + P |
| **2** | **Stats cache stores the rendered view**, not the fold output; no second compute on oversize | web (`lib/stats/cached.ts`, `lib/stats/fun*.ts`) | S to M | Stats warm stays at 0 queries at any history size | P |
| **3** | **0040 lz4** on `games.raw` | platform | S (migration only) | Every raw read 3x faster, with no code change. Games list warm 527 → 138 ms (P). Disk 293 → 116 MB | P |
| **4** | **0039 `game_mode` + covering index**, then the 20 readers select `game_mode` | platform: migration. web: readers (one PR, mechanical) | S + S | Games list count+page 395 → 1.4 ms in the DB. Calibration, player page and Tonight mode reads 130 → 1 ms | P |
| 5 | Player page and You read only the player's games (uses 0042's index) | web (`lib/stats/load.ts` `readWindow` for `loadPlayerStats` and `loadYouVersus`) | S to M | 8 MB → about 2.5 MB; 0.69 → < 0.2 s (P) | P |
| 6 | **0043 `apply_game_player_ratings`**; `rebuild.ts` and `rating.ts` call it | platform | S | Rebuild writes 18,190 requests → 1 call (0.8 s), atomic, no Realtime storm; live fold 10 sequential calls → 1 | P; **required before the M18 switch rebuild** |
| 7 | 0042 index + `group_member_game_counts`; Admin Members reads it | platform: migration. web: `lib/admin/groupMembers.ts` | S | 2.1 MB in 29 requests → 4.4 KB in 1 | No |
| 8 | M19.15 (tab pressed state, `loading.tsx`) and M19.3 (pending until refresh) | web, designer | as planned | Tap feedback 193 to 411 ms → < 100 ms | **Now** (tap rule) |
| 9 | M19.11 (out of the publication) | platform | as planned | No 60 KB raw per eog to every viewer; no event per rebuilt row | |
| 10 | Calibration: parallel pages, `game_mode` | web | S | Games list cold after an eog 0.48 s → about 0.15 s (P) | P |
| 11 | 0044 index hygiene | platform | XS | Group-scoped lobby lookups; one fewer index written per fold | No |
| 12 | eog route: drop the two raw re-reads; claims through 0043 | platform | S | eog 0.2 to 0.5 s → about 0.1 s at 2 ms | No |

Order:
1. Platform first: 0039 + 0040 in one deploy, off-night (both rewrite `games`). Then 0041, 0042 and 0043 together.
   Then the platform code: ingest writes `game_facts`, the backfill command runs, and the rebuild uses 0043.
2. Then web: readers switch to `game_facts` and `game_mode`, the Stats cache stores the view, the player page and
   Members change.
3. 0044 any time after M18's switch.

### 7.1 Proposed SQL (exact; not applied to the shared stack)

`0039_games_game_mode.sql`

```sql
-- 0039: games.game_mode, a stored copy of raw->>'gameMode', and the group list index that also covers the
-- lcu_game_id tie-break every games reader orders by. Generated: `->>` is immutable, nothing writes it, and a
-- raw rewrite (ban enrichment) keeps it right by construction. The ADD COLUMN rewrites games (ACCESS EXCLUSIVE).
begin;

alter table public.games
  add column game_mode text generated always as (raw->>'gameMode') stored;

comment on column public.games.game_mode is
  '0039: raw->>''gameMode'' kept beside the blob so no reader detoasts raw for one string. Generated; never written. Null when the block carried none (old Rift).';

-- (group_id, started_at desc) is a prefix of this one, so it replaces games_group_started_at_idx.
create index games_group_started_lcu_idx
  on public.games (group_id, started_at desc, lcu_game_id desc);
drop index public.games_group_started_at_idx;

commit;
```

`0040_games_raw_lz4.sql`

```sql
-- 0040: games.raw stored with lz4 instead of pglz. SET COMPRESSION affects new values only, so the UPDATE
-- re-stores the existing ones (`raw || '{}'` builds a new datum with identical content). Run off-night: one
-- UPDATE event per games row reaches Realtime until M19.11.
begin;

alter table public.games alter column raw set compression lz4;
update public.games set raw = raw || '{}'::jsonb;

commit;
```

`0041_game_facts.sql`

```sql
-- 0041: game_facts, rawFactsFromUnknown(games.raw) stored at ingest by the TypeScript reader. Derived and
-- rebuildable from raw; facts_version lets a reader change trigger a recompute.
begin;

create table public.game_facts (
  game_id uuid primary key,
  group_id uuid not null references public.groups(id),
  facts_version smallint not null check (facts_version >= 1),
  facts jsonb not null check (jsonb_typeof(facts) = 'object' and facts ? 'byPuuid' and facts ? 'bans'),
  updated_at timestamptz not null default now(),
  constraint game_facts_game_group_fkey foreign key (game_id, group_id)
    references public.games(id, group_id) on delete cascade
);

comment on table public.game_facts is
  '0041: rawFactsFromUnknown(games.raw), stored at ingest by the TypeScript reader. Derived; rebuildable from raw. Never read raw for these facts.';

create index game_facts_group_id_idx on public.game_facts (group_id);

alter table public.game_facts enable row level security;
create policy "game facts are publicly readable" on public.game_facts
  for select to anon, authenticated using (true);
grant select on public.game_facts to anon, authenticated;
grant select, insert, update, delete on public.game_facts to service_role;
-- Not added to supabase_realtime: nothing listens for it.

commit;
```

`0042_member_game_counts.sql`

```sql
-- 0042: a group index on game_players and the per-member aggregate Admin Members needs. A filter on group_id
-- is pushed below the GROUP BY, so `?group_id=eq.<id>` reads one group.
begin;

create index game_players_group_player_idx
  on public.game_players (group_id, player_id) include (game_id);

create view public.group_member_game_counts
  with (security_invoker = true) as
select gp.group_id,
       gp.player_id,
       count(*)::integer as games,
       max(g.started_at) as last_played_at
from public.game_players gp
join public.games g on g.id = gp.game_id and g.group_id = gp.group_id
group by gp.group_id, gp.player_id;

comment on view public.group_member_game_counts is
  '0042: games played and last game per (group, player), for Admin Members. Counts every stored game (rated or not), like the loader it replaces.';

revoke all on public.group_member_game_counts from public, anon, authenticated;
grant select on public.group_member_game_counts to service_role;

commit;
```

`0043_apply_game_player_ratings.sql`

```sql
-- 0043: one statement for a fold's game_players writes (rebuild: p_only_unrated false; live fold: true).
-- Skips rows that did not move. Requires 0036 (Kustom columns).
begin;

create function public.apply_game_player_ratings(
  p_group uuid,
  p_rows jsonb,
  p_only_unrated boolean default false
) returns integer
language plpgsql
security invoker
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'apply_game_player_ratings: p_rows must be a json array';
  end if;

  update public.game_players gp
  set mu_before = r.mu_before,
      sigma_before = r.sigma_before,
      mu_after = r.mu_after,
      sigma_after = r.sigma_after,
      fold_p = r.fold_p,
      base_mu_after = r.base_mu_after,
      award = r.award,
      rated_games_before = r.rated_games_before,
      r_before = r.r_before,
      r_after = r.r_after,
      k = r.k,
      share_rank = r.share_rank,
      week_r_before = r.week_r_before,
      week_r_after = r.week_r_after,
      week_k = r.week_k,
      week_fold_p = r.week_fold_p,
      week_games_before = r.week_games_before
  from jsonb_to_recordset(p_rows) as r(
    game_id uuid, player_id uuid,
    mu_before double precision, sigma_before double precision, mu_after double precision, sigma_after double precision,
    fold_p double precision, base_mu_after double precision, award text, rated_games_before integer,
    r_before double precision, r_after double precision, k double precision, share_rank smallint,
    week_r_before double precision, week_r_after double precision, week_k double precision,
    week_fold_p double precision, week_games_before integer
  )
  where gp.game_id = r.game_id
    and gp.player_id = r.player_id
    and gp.group_id = p_group
    and (not p_only_unrated or (gp.mu_after is null and gp.r_after is null))
    and (gp.mu_before, gp.sigma_before, gp.mu_after, gp.sigma_after, gp.fold_p, gp.base_mu_after, gp.award,
         gp.rated_games_before, gp.r_before, gp.r_after, gp.k, gp.share_rank, gp.week_r_before, gp.week_r_after,
         gp.week_k, gp.week_fold_p, gp.week_games_before)
        is distinct from
        (r.mu_before, r.sigma_before, r.mu_after, r.sigma_after, r.fold_p, r.base_mu_after, r.award,
         r.rated_games_before, r.r_before, r.r_after, r.k, r.share_rank, r.week_r_before, r.week_r_after,
         r.week_k, r.week_fold_p, r.week_games_before);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.apply_game_player_ratings(uuid, jsonb, boolean) is
  '0043: a fold''s game_players rating columns in one statement (rebuild: p_only_unrated false; live fold: true). Returns rows written; unmoved rows are skipped.';

revoke all on function public.apply_game_player_ratings(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apply_game_player_ratings(uuid, jsonb, boolean) to service_role;

commit;
```

`0044_index_hygiene.sql`

```sql
-- 0044: group-scoped lobby lookups; stop maintaining an index nothing orders by.
begin;

create index lobbies_group_created_at_idx on public.lobbies (group_id, created_at desc);
drop index public.lobbies_created_at_idx;

-- The PK (group_id, player_id) serves every group_id lookup; ordinal is never ordered on in SQL.
drop index public.ratings_group_ordinal_idx;

commit;
```

### 7.2 Tests each task needs (platform's rules)

- **0041**:
  - Idempotency: the same eog posted twice, and from two companions, leaves exactly one `game_facts` row with
    the same `facts`.
  - Ban enrichment updates `facts.bans`.
  - The backfill command fills every game, is safe to run twice, and recomputes rows below `facts_version`.
  - Parity: for every fixture, the stored `facts` deep-equals `rawFactsFromUnknown(raw)`.
  - RLS: anon reads; anon cannot write.
  - A zod schema for the stored shape in `packages/db/src/schemas`.
- **0043**:
  - A rebuild through the RPC gives the same numbers as today's row-by-row writer. This is the existing
    out-of-order rebuild test, unchanged.
  - `p_only_unrated` makes a second companion's fold a no-op (row count unchanged).
  - A second rebuild writes 0 rows.
  - anon and authenticated cannot execute it.
- **0039 / 0040**:
  - `game_mode` equals `raw->>'gameMode'` for every row, and still does after a ban enrichment.
  - `pg_column_compression(raw) = 'lz4'` after 0040.
  - The Games list and ARAM filters return the same rows as before (integration).
- **0042**: the view's counts equal today's Admin Members numbers on the seed; anon and authenticated are refused.
- **Throwaway check script**: `packages/db/scripts/m19-dbperf-throwaway-check.sh`, in the 0034 script's pattern.

## 8. What blocks the budget now vs only at projected scale

| Now (about 140 games, prod RTT) | Only at projected scale |
|---|---|
| Tap feedback over 200 ms on tab taps and controls (finding 10; M19.15, M19.3) | Stats and Champions: 3.4 to 7.7 s TTFB, 10.7 s LCP, uncacheable, anon timeouts (findings 1, 2) |
| Stats and Champions, the first render after each game: 409 to 957 ms (finding 1). Borderline on this laptop; worse on a small hosted instance | Signed-in player page and You: 0.46 to 0.69 s at 2 ms, growing linearly (finding 5) |
| | Games list: 0.53 s warm, DB time (findings 3, 4) |
| | Tonight first visit of the day: 0.9 to 2.1 s (finding 6) |
| | Mystery cron: 16 s for 22 groups, the 60 s limit at about 80 groups (finding 6) |
| | Rebuild: 18,000-request writes, not atomic, Realtime storm (finding 7) |

LCP on Fast and Slow 4G is 0.34 to 0.96 s on every page today: comfortably inside 2.5 s. TTFB at prod RTT is
under 120 ms on every warm page today.

## 9. Decisions proposed (for `docs/04-decisions.md`)

1. The raw facts projection is an ingest-written table (`game_facts`, jsonb, `facts_version`), filled by
   `rawFactsFromUnknown` itself. Not a generated column or a view: those need a second (SQL) implementation, or
   move no work.
2. `games.game_mode` is a stored generated column; no reader takes `raw->gameMode` again (extend
   `lib/perf/rawColumns.test.ts` to forbid `raw->` paths outside the one-game readers).
3. `games.raw` uses lz4.
4. Fold writes go through `apply_game_player_ratings`; no per-row `PATCH` loop for ratings.
5. Postgres may aggregate counts and maxima (views or RPCs, service role where not public). Rating and stat math
   stays in TypeScript and is fed narrower reads.
6. (web) A cross-request cache stores what the page renders, not the fold's working set.
