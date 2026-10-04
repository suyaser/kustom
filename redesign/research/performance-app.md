# App-wide query and prefetch audit (Kustom 2.0)

Web engineer, 2026-10-04, branch `app-perf` (from `origin/main` at `e0b7224d`). Follows
`performance.md` (the Tonight audit) to every other page. Tonight's own files, the roster labels, the
player and game pages' `generateMetadata`, the Games list rows (`tonight-perf`), Stats (`stats-perf`)
and the mode panel (mode QA lane) were out of bounds; what they still cost is listed in section 6 with
its owner.

## 1. Summary

- **Board, Games list and game page now cost half the time.** One render at 40 ms RTT: board 407 to
  283 ms, Games list 457 to 259 ms, game page 502 to 180 ms (signed in 694 to 285 ms). The cause was
  waterfalls, not query count: independent reads ran one after another, and every chunked read
  (`for (chunk of inChunks(..)) await ...`) was one round trip per 90 ids.
- **Entity links no longer prefetch.** Opening the board set off 9 player-page prefetches, each
  running the player page's full loader from `generateMetadata`: 112 Supabase calls in the 5 s after
  load. Now 6. The game page went from 27 to 5.
- **The calibration line is cached across requests.** It is identical for every viewer and reads the
  group's whole history (4 rounds, about 110 KB at 120 games, growing per game) on every Games list
  and game page. It is now an `unstable_cache` entry tagged `games:<groupId>`, dropped by the writers.
- **Guards in CI** (`apps/web/lib/perf/`): per-loader query and wave budgets on a recording fake
  client, the prefetch rule, cheap `generateMetadata`, and no `games.raw` blob in a list loader.
- **The biggest remaining costs are in other lanes**: `/you` and a signed-in player page read 8.4 MB
  of `games.raw` per render (`lib/stats/load.ts`), `/stats` 8.3 MB, and the roster labels' one query per
  clashing name (22 `games` queries on `customs`' board).

## 2. Method

- `instrumentation.ts` (scratch, not committed) wrapped `fetch` to log every Supabase round trip with
  start, end and bytes, and added 40 ms to each (`PERF_SB_DELAY_MS=40`), the Vercel-to-Supabase RTT
  `performance.md` used. Waves (requests that had to wait for an earlier one) are the RTT-free number.
- `next build && next start`, local stack only. Before = `origin/main` built in the same worktree;
  after = `app-perf`. Same data, same machine, same session.
- Data: a scratch group `perf-app` (120 games, 20 members, real-size end-of-game blobs from the
  16.17 fixture, deleted afterwards) and the local `customs` (9 games, 32 members, many same-name
  clashes). Signed-in pages used a scratch Discord-identity session for `perf-app`'s owner (scratch
  `auth.users` row, deleted afterwards). No real group was signed into.
- Per page: three document fetches, the median of the warm two. Browser rows: a 375 px headless
  phone, counting prefetch requests and Supabase calls in the 5 s after `load`.

## 3. Inventory, anonymous (one render, 40 ms RTT)

Queries / waves / server ms / KB read from Supabase.

| Page | Before | After | What is left, and whose |
|---|---|---|---|
| Tonight `/g/perf-app` (result screen) | 39 / 13 / 608 / 269 | 38 / 8 / 446 / 269 | Gains came from shared loaders (board, breakdown, one mode row). The rest is `tonight-perf` |
| Tonight `/g/customs` (idle, real roster) | 45 / 13 / 596 / 40 | 44 / 8 / 391 / 37 | 26 `games` queries: roster labels' first-game read per clashing name (`tonight-perf`) |
| Board, This week | 11 / 9 / 407 / 18 | 11 / 5 / 283 / 18 | Roster labels' 4 sequential waves are now the critical path |
| Board, All time | 9 / 7 / 312 / 5 | 9 / 4 / 220 / 5 | Same |
| Board `/g/customs` | 29 / 10 / 466 / 26 | 29 / 5 / 242 / 26 | 22 `games`: roster first games (`tonight-perf`) |
| Games list | 13 / 9 / 457 / 214 | 8 / 5 / 259 / 107 | Calibration from the cache; page 1 count rides on the page read |
| Games list, filtered to a player | 13 / 9 / 457 / 214 | 9 / 5 / 309 / 107 | One small puuid read resolves the filter |
| Games list, page 3 | 13 / 9 / 458 / 214 | 9 / 6 / 283 / 107 | Count, then range (the 416 rule) |
| Games `/g/customs` | 32 / 10 / 474 / 75 | 26 / 5 / 251 / 61 | Roster first games |
| Game page | 14 / 11 / 502 / 182 | 10 / 3 / 180 / 75 | One row of `raw` (the scoreboard's client facts): allowed |
| Player page | 16 / 6 / 282 / 506 | 15 / 5 / 282 / 491 | `loadPlayerStats` (`stats-perf`) reads every group `game_players` row twice (300 + 100 KB) |
| Stats | 6 / 6 / 505 / 8342 | 6 / 6 / 533 / 8342 | `stats-perf`: full `raw` of every game |
| Mode | 5 / 2 / 95 / 0 | 4 / 2 / 115 / 0 | One `group_modes` row instead of two |
| Mystery | 4 / 3 / 138 / 2 | 4 / 3 / 144 / 2 | Measured before the metadata fix (6, item 11): a prefetch now costs one read-only row, not the page load |
| You (anonymous) | 1 / 1 / 50 / 0 | 1 / 1 / 63 / 0 | |
| Landing, download, how, about, join, new | 0 | 0 | Landing's `unstable_cache` (5 min) |
| OG player card | 12 / 6 / 302 / 88 | 11 / 5 / 274 / 73 | `loadPlayerBoard` improvements; CDN-cached 300 s |
| OG game card | 6 / 4 / 248 / 5 | 6 / 4 / 228 / 5 | CDN-cached |
| OG tonight card | 19 / 6 / 355 / 246 | 19 / 6 / 331 / 246 | Tonight's loader; CDN-cached |

## 4. Inventory, signed in (owner of `perf-app`)

| Page | Before | After | Notes |
|---|---|---|---|
| Tonight | 47 / 14 / 744 / 288 | 46 / 10 / 493 / 287 | The session now starts beside the slug lookup (group layout) |
| Board | 14 / 9 / 421 / 19 | 14 / 5 / 241 / 19 | |
| Games list | 16 / 12 / 626 / 215 | 11 / 5 / 240 / 107 | The list no longer waits for the session: the viewer's puuid is a promise awaited only for the row lines |
| Game page | 17 / 14 / 694 / 183 | 13 / 5 / 285 / 76 | Recap and breakdown beside the game. Still waits for the role read before `loadGame` (see 6) |
| Player page | 20 / 7 / 451 / 8448 | 19 / 6 / 419 / 8433 | 8.1 MB is `loadYouVersus` reading full `raw` (`lib/stats/load.ts`, `stats-perf`) |
| You | 22 / 10 / 511 / 8445 | 21 / 9 / 477 / 8430 | Same 8.1 MB read |
| Mode | 8 / 4 / 214 / 1 | 7 / 3 / 168 / 1 | |
| Admin home | 12 / 6 / 307 / 1 | 12 / 4 / 219 / 1 | Invite read joined the round |
| Admin Members | 11 / 9 / 470 / 140 | 11 / 6 / 302 / 140 | Reads every `game_players` row of the group to count games (see 6) |
| Admin Games | 7 / 6 / 334 / 141 | 7 / 4 / 244 / 141 | Epoch read beside the games. HTML is 560 KB (200 rows, all drawn) |
| Admin Hosts, Discord | 5 / 5 / 262 / 1 | 5 / 4 / 210 / 1 | |
| `/` (signed in, redirects) | 3 / 3 / 162 | 3 / 3 / 167 | |

Signed-in pages pay three sequential auth round trips (GoTrue `getUser`, the `players` row, the
membership). Identical GETs inside one server render are deduplicated by Next's `fetch` memoisation,
so the layout's and the admin gate's two session reads cost one; only reads with **different** URLs
(the two `group_modes` selects, `groups_public` twice with different columns) were real duplicates.

## 5. Prefetch fan-out (phone, 5 s after load)

| Page | Before: prefetches (player / game) / Supabase calls | After |
|---|---|---|
| Board | 26 (9 / 0) / 112 | 10 (0 / 0) / 6 |
| Game page | 14 (2 / 0) / 27 | 10 (0 / 0) / 5 |
| Games list | 22 (0 / 7) / 66 | 20 (0 / 7) / 36 (rows are `tonight-perf`'s; each is cheaper now) |
| Player page | 13 (1 / 0) / 40 | 13 (1 / 0) / 37 (the window chips prefetch this same page; its metadata is `tonight-perf`'s) |
| Stats | 27 (0 / 7) / 65 | 27 (0 / 7) / 37 (`stats-perf`'s links) |
| Tonight | 25 (3 / 1) / 132 | 25 (3 / 1) / 117 (`tonight-perf`'s links) |

## 6. Findings per page, and what changed

Fixed in `app-perf`:

1. **Board** (`lib/board/load.ts`): epoch, then facts/members/ratings, then rows, then awards and
   labels, all in sequence. Now the epoch, members, ratings, awards and labels start together; facts
   and rows wait only for the epoch. 9 to 5 waves.
2. **Player page body** (`loadPlayerBoard`): player, then epoch, then five reads, then recent games
   and a second full ratings read for the rank. Now player, epoch and the group's ratings start
   together (one ratings read serves both the player's row and the rank), and the player's rows carry
   their games through `games!inner(...)`, so the group's whole game list (22 KB, growing) is not read
   just to join them.
3. **Games list** (`lib/games/list.ts`): members (with labels), then count, then page, then rows,
   then players. Now members, calibration and the page start together; page 1 is one request with
   `count: 'exact'`; scoreboard names come from the members already read (only strangers are read).
4. **Game page** (`lib/games/detail.ts`, page body): the game, then scoreboard + run + calibration,
   then players, then recap + breakdown. Now game, scoreboard and calibration in one round, run and
   players in the next; recap and breakdown start beside the game.
5. **Breakdown** (`lib/breakdown/load.ts`, also Tonight's result screen): 4 rounds to 2.
6. **Chunked reads** (`lib/chunks.ts` `mapChunks`): chunks run in parallel (six at a time) in the
   games, board, breakdown and fearless readers. A 1,000-game calibration was 12 waves of
   `game_players` alone.
7. **Duplicate reads**: `group_modes` was read twice per render with two column lists (the fearless
   pool and the Mode card); now one select, React-cached per render (`readGroupModeRow`).
8. **Fearless pool** (`lib/fearless/load.ts`, Tonight and the mode panel): selected `raw` for up to
   500 games to read `gameMode`. Now `raw->>gameMode`; the blob only for the games that locked a
   champion id with no name (normally none).
9. **Group layout**: the session read starts beside the slug lookup.
10. **Admin**: Members reads its `game_players` pages in parallel (count first) beside memberships and
    labels; Games reads the epoch beside the games; home reads the invite in the same round.
11. **Mystery `generateMetadata`** ran the page's load (`ensureTodayMystery` plus `touchSession`),
    so every prefetch of `/mystery` could **write**: build the day's challenge and touch the
    visitor's session. It now reads one row (`loadTodayMysteryKind`, the kind of today's challenge if
    it exists); before the day's first visit the title is the plain `Daily`.

Remaining, with owners:

| Where | Cost | Owner / fix |
|---|---|---|
| `lib/stats/load.ts` `loadWindowGames({ withGameMode: true })` | Full `raw` for every game: 8.1 MB on `/you` and a signed-in player page, 8.3 MB on `/stats` | `stats-perf` (select `raw->gameMode`, or the facts columns) |
| `loadPlayerStats` on the player page | Every group `game_players` row, twice (300 + 100 KB) | `stats-perf` |
| `lib/names/roster.ts` `readFirstGames` | One `games` query per clashing name (22 on `customs`' board); 4 sequential waves on every board, list and Tonight render | `tonight-perf` |
| Player and game `generateMetadata` | Full loaders on every prefetch (the player page's own window chips prefetch it) | `tonight-perf` |
| Games list rows, Tonight cards, Stats links | Entity prefetches (7, 4, 7 per load) | `tonight-perf`, `stats-perf` (use `EntityLink`) |
| Game page, signed in | Waits for the role read (2 waves) before `loadGame`, because `loadGame` is keyed on the viewer and shared with the metadata | After `tonight-perf`'s metadata change: start `loadGame` from `currentSessionPlayer`'s puuid |
| Admin Members | Reads every `game_players` row of the group to count games and last-played (134 KB at 120 games, about 1.1 MB at 1,000) | platform: an aggregate (view or RPC) per member |
| `GET /api/me/pairing/status` (every 3 s while pairing) | Session plus 1 to 2 reads | Fine |
| Marketing pages | `force-dynamic` for the Sign in link (performance.md finding 10) | Unchanged |

## 7. The prefetch rule

1. Links to an **entity page** (a player, a game, a 1v1 pair) never prefetch: `EntityLink`
   (`components/links/EntityLink.tsx`, `next/link` with `prefetch={false}`), or `prefetch={false}`.
2. A `<Link>` whose `href` is an opaque value (a bare identifier or property) states its prefetch:
   `prefetch="auto"` for navigation, `EntityLink` for an entity.
3. Navigation chrome and in-page controls with readable hrefs keep the default.
4. `generateMetadata` reads the group (React-cached) and at most one small row; never a page loader.

`lib/perf/prefetchPolicy.test.ts` and `lib/perf/metadataPolicy.test.ts` enforce 1, 2 and 4. Files
owned by the other lanes are listed by name as pending; delete each entry when its lane merges.

## 8. Caching

- **Per request:** `requirePageGroup`, the session reads, `readGroupModeRow` (React `cache`), plus
  Next's `fetch` memoisation for identical GETs.
- **Across requests:** this lane's `cachedGroupCalibration` (`lib/games/calibrationCache.ts`):
  `cachedRead` (`lib/cache/cached.ts`), key `group-calibration-v1` + groupId, tag `games:<groupId>`
  (`lib/cache/tags.ts` `groupTag`), `revalidate: 300` as a backstop for writes outside Next (the
  `rebuild-ratings` script). Anon reads only; nothing per viewer, nothing live. (Since the
  integration of the three lanes, one cache module serves Tonight's and Stats' slices too.)
- **Invalidation** (`lib/cache/tags.ts` `invalidateGroup(groupId, kinds)`,
  `revalidateTag(tag, { expire: 0 })`, never throws): the eog ingest (`ingestEogGame`), the rating fold
  (`rateStoredGame`), the rebuild (`rebuildRatings`), Roll (`balanceLobby`) and Reroll (`promoteSplit`).
  All are library calls inside the platform routes, so no route changed.

## 9. Guardrails (CI, no local stack)

| Test | Catches |
|---|---|
| `lib/perf/queryBudget.test.ts` | Each loader (board both windows, player page, Games list page 1 and filtered, calibration, game page, breakdown, fearless pool, admin Members) against `lib/testing/recordingClient.ts`: request count, waves, no `raw` blob. Budgets are today's numbers |
| `lib/perf/prefetchPolicy.test.ts` | A `<Link>` to an entity page without `prefetch={false}`; an opaque `href` with no stated prefetch |
| `lib/perf/metadataPolicy.test.ts` | A `load...()` call inside `generateMetadata` outside the listed exceptions |
| `lib/perf/rawColumns.test.ts` | A `.select('... raw ...')` naming the blob outside the listed one-game readers and writers (with a per-file count) |

Fake-client budgets, before and after (roster labels and awards stubbed):

| Loader | Before | After |
|---|---|---|
| Board, This week | 7 / 5 | 7 / 4 |
| Board, All time | 6 / 4 | 6 / 3 |
| Player page | 12 / 5 | 10 / 4 |
| Games list, page 1 (calibration cached) | 11 / 8 | 5 / 2 |
| Games list, filtered | 11 / 8 | 6 / 3 |
| Game breakdown | 4 / 4 | 4 / 2 |
| Admin Members | 2 / 2 | 2 / 1 |
