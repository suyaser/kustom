# Performance audit: state, refresh and render cost (Kustom 2.0)

Web engineer, 2026-10-04. Audit and plan only: no app code was changed. Measured on a scratch worktree of
`origin/main` (`c932110b`, which matches `main` at `e0b7224d` for `apps/web`), on the local Supabase
stack only. Next 16.3.4, React 19.2.8, supabase-js / realtime-js 2.115.0.

## 1. Summary

The page that matters, Tonight, is slow to update for one main reason. Every change, from any source, is
handled by re-rendering the whole page on the server, and that render is expensive. Re-rendering on the
client is not the problem: a refresh costs the phone 26 to 36 ms of main thread at 4x CPU, with no long
tasks. All of the time goes to server round trips and to how often they run.

- **One Tonight render takes 26 to 56 Supabase queries in 9 to 14 sequential waves.** With a realistic
  40 ms between Vercel and Supabase, that is 400 to 700 ms per render. None of it is cached across
  requests, even data that changes once a day (the daily game) or once per game (the top five, the
  roster behind the same-name labels).
- **Each refresh also re-prefetches every link on screen.** `router.refresh()` throws away the router's
  prefetches. The player and game links then run their pages' `generateMetadata` loaders on the server
  (11 and 8 queries each). On the result screen, one refresh costs 95 queries, and only 56 of them are
  Tonight's own.
- **Refreshes are badly scheduled.** A game end gives 4 to 5 renders, some of them while the game is
  still being written. Ten people joining one at a time gives 12 renders. A tap whose answer comes back
  more than 150 ms away from the Realtime event gives 2 renders. Opening the page always gives 2.
  Another group's lobby activity re-renders your page too (3 of 3 posts in another group did).
- **Controls stop showing "pending" before the screen changes.** Roll, Reroll, Start a lobby, Set mode,
  Spin and the admin actions all have a dead window: the press is answered but the screen is still old
  for about 0.6 to 0.9 s. A second press in that window sends stale input.
- **Tab taps give no feedback for 270 to 700 ms.** There is no `loading.tsx` and no pending state on
  the tab bar.

The fix is not a rewrite.

1. Make the one refresh cheap and singular: single-flight scheduling, no refresh-driven prefetch, a
   parallel loader, and tagged caches for slow-changing data.
2. Stop the events that cause pointless refreshes: filter by group, and skip writes when a lobby post
   changed nothing.
3. Patch the one name-free slice (the Mode card) on the client from the trusted `group_modes` row. Its
   controls then never wait for a server render.
4. Keep the server render for anything that prints a name. This keeps the same-name labels correct by
   construction.

## 2. Method

- **Instrumentation (scratch worktree only).**
  - `instrumentation.ts` wrapped `fetch` to log every Supabase round trip.
  - The Tonight page logged when each render started and ended.
  - `proxy.ts` logged every page request.
  - An env switch `PERF_SB_DELAY_MS=40` added 40 ms to each Supabase call. This models the
    Vercel-to-Supabase RTT. Local calls take 2 to 5 ms, which hides the waterfalls.
  - "Waves" (queries that run one after another) is the number that does not depend on RTT. The
    milliseconds below scale with your real RTT.
- **Events.** The events were real route calls on four scratch groups (`perf-*`), all deleted
  afterwards:
  - `POST /api/companion/lobby` and `/api/companion/game` with a minted companion token.
  - `rollForTest` and `writeModeCard` (the roll route's and the mode route's own library calls).
  - Each run had a headless phone (375 x 812, touch) holding the Tonight page open and subscribed.
- **Page loads.**
  - Playwright on the prod build (`next start`, port 3168): Event Timing, LCP and CLS observers, and
    JS bytes.
  - Lighthouse 12 mobile at 375 px.
  - CDP-applied throttling: Fast 4G (9 Mbps, 60 ms) and Slow 4G (1.6 Mbps, 150 ms), at 4x CPU.
- **Limits.**
  - No Discord session was created, as instructed. So every page was measured as an anonymous
    viewer.
  - Admin taps (Roll, Set mode, Spin, Start a lobby, That's me) were measured in parts: the route's
    library work, the coalescing delay and the refresh render. The admin auth cost is estimated from
    code at 3 round trips: GoTrue `getUser`, the `players` lookup and the membership lookup.
  - Local data is small (9 games in `customs`). Query counts and waves are representative. Payload
    sizes are a lower bound.

## 3. Measurements (before)

### 3.1 Tonight: server renders per real event

All figures use 40 ms simulated RTT and one subscribed viewer.

| Event (how triggered) | Tonight renders | Render ms | Notes |
|---|---|---|---|
| Open the page (SSR) | **2** | 390 + 420 | The second render is the refresh on the first `SUBSCRIBED`. 28 page requests and 182 Supabase calls in the first 5 s, counting three prefetch waves |
| Lobby created, 1 member (companion post) | 2 | 357, 361 | `lobbies` insert plus `lobby_members` events fall in different 150 ms windows |
| Lobby to 3 members (one post) | 1 | 403 to 439 | |
| Lobby to 10 members (one post) | 1 to 2 | 404 to 430 | |
| **Same lobby post again, nothing changed** | **1** | 415 to 455 | The ingest upserts every member row on every post (`lib/ingest/lobby.ts:666-670`), so Realtime fires |
| **10 joins, one post each, 400 ms apart** | **12** | about 410 each | One render per post, plus stragglers |
| Tab visible again | 1 | 421 to 446 | |
| Roll write plus RollControl's ask | 1 | 531 to 550 | Coalesced locally because Realtime arrived inside 150 ms |
| Rated write plus ModeControls' ask, ask arrives at once | 1 | 429 to 490 | |
| **Rated write, ask arrives 300 ms or 600 ms later** | **2** | about 410 each | Hosted Realtime and Vercel response times make a gap over 150 ms common |
| Game `in_progress` post | 1 | 416 to 444 | Refresh request started about 120 ms after the post returned. New screen 574 ms after |
| **Game end (`eog` post)** | **4 to 5** | 429 to 625 | 380 to 460 Supabase calls in the window. Some renders ran while the game was still being written (torn reads) |
| **Another group's lobby, 3 posts** | **3** | about 400 | `lobby_members` and `splits` are not filtered by group (`TonightLive.tsx:62-69`) |
| Start a lobby pending (by code) | 1 every 5 s | | `TonightLive.tsx:218-222`, for every linked viewer |
| AI recap waiting (by code) | 4 in 3 min | | `components/ai/RecapWaiter.tsx:18`, which bypasses the coalescer |

### 3.2 Cost of one Tonight refresh, and the prefetch fan-out

| Screen | Tonight render: queries / waves / ms | Prefetch requests set off by the refresh | Their queries | Total queries per refresh |
|---|---|---|---|---|
| Idle, empty group | 22 to 26 / 9 to 11 / 430 | 4 tabs | 4 | about 30 |
| Filling | 30 to 31 / about 10 / 400 to 440 | 4 tabs | 4 | about 35 |
| Teams | 53 / about 12 / 490 to 550 | 4 tabs plus seat links | | |
| **Result** | **39 to 56 / 14 / 630 to 700** | **9** (4 tabs, 4 player pages, 1 game page) | **39** | **95** |
| Idle, `customs` (real roster) | 45 / 13 / 580 to 620 | 4 tabs plus top-five links | | |

A replayed player-page prefetch costs 11 queries and 280 ms on the server, a game-page prefetch 8 queries
and 280 ms, and a tab prefetch 1 query. Only `generateMetadata` and the layout run, and the response is
1.5 to 2.8 KB of route tree. The result render's 14 waves, in order:

1. `groups_public` (`requirePageGroup`).
2. Ten in parallel: `lobbies` x2, `group_modes` x2, `fearless_state`, `games`, `daily_mysteries`,
   `companion_tokens`, `group_memberships`, `groups_public` (again, the board's `loadRatingsSince`).
3. Waves 3 to 9: the board, the members, the players, ratings, the result, the scoreboard, splits.
4. Waves 10 to 14: the roster labels (`ratings`, then `group_members_public`, then `players_public`,
   then one `games` query per clashing name: 18 in parallel on `customs`), then the second-phase reads.

### 3.3 Server cost per page (one render, anonymous, 40 ms RTT)

| Page | TTFB | Supabase calls | About this many sequential RTTs | Calls in first 5 s with prefetches |
|---|---|---|---|---|
| `/` (landing, `unstable_cache`) | 10 ms | 0 to 8 | 0 | 18 |
| `/download`, `/about` | 5 to 11 ms | 0 | 0 | 0 to 10 |
| **Tonight `/g/customs`** | **580 to 690 ms** | 45 | 14 | **125** |
| **Tonight, result screen** | **630 to 720 ms** | 39 to 56 | 15 | **180** |
| **Board** | **455 to 714 ms** | 33 | 11 | 34 |
| **Games list** | **451 to 524 ms** | 32 | 11 | 96 (each game row prefetches its game page) |
| **Game page** | **534 to 696 ms** | 16 | 13 | 71 |
| Stats / Champions / 1v1 | 179 to 282 ms | 4 to 5 | 4 to 5 | 13 to 38 |
| Player page | 280 to 314 ms | 16 | 7 | 47 |
| You (anonymous) | 49 to 64 ms | 1 | 1 | 6 |
| Mode `/g/customs/mode` | 147 to 177 ms | 6 | 3 | 11 |
| Mystery | 135 to 151 ms | 4 | 3 | 9 |
| Admin (anonymous: sign-in) | 48 to 55 ms | 1 | 1 | 6 |

No page uses `<Suspense>` streaming (the only boundary is `JoinedNotice` in the group layout). No route
has a `loading.tsx`. The only cross-request cache is the landing's `unstable_cache` and M14.9's in-memory
calibration cache.

### 3.4 Core Web Vitals at 375 px (prod build)

| Page | Lighthouse score | Lighthouse FCP / LCP (simulated slow 4G, 4x CPU) | TBT | CLS | Applied Fast 4G LCP | Applied Slow 4G LCP | Unthrottled LCP |
|---|---|---|---|---|---|---|---|
| Tonight (result) | 92 | 942 / 3306 ms | 23 ms | 0.004 | 976 ms | 1340 ms | 764 ms |
| Tonight (`customs`) | 91 | 755 / 3537 ms | 15 ms | 0.002 | | | 732 ms |
| Board | 92 | 755 / 3389 ms | 16 ms | 0 | 724 ms | 1188 ms | 764 ms |
| Games | 92 | 756 / 3306 ms | 6 ms | 0 | | | 560 ms |
| Game | 92 | 757 / 3396 ms | 18 ms | 0 | | | 744 ms |
| Stats | 89 | 905 / 3686 ms | 27 ms | 0 | | | 312 ms |
| Player | 89 | 755 / 3844 ms | 34 ms | 0 | | | 352 ms |
| Landing | 92 | 905 / 3384 ms | 13 ms | 0 | | | 388 ms |
| Download | 93 | 755 / 3231 ms | 12 ms | 0 | | 880 ms | 36 ms |

- CLS and TBT are good everywhere.
- Lighthouse's simulated LCP is 3.2 to 3.8 s on every page, `/download` included, whose server time is
  4 ms. So on a slow network that number comes from the shared JS (below), not from data. Applied
  throttling gives 0.9 to 1.3 s.
- On fast networks, Tonight's LCP is mostly TTFB, which means server render time.

### 3.5 Interaction latency (key taps)

| Tap | Measured or derived | Time until the screen shows the answer | What the user sees meanwhile |
|---|---|---|---|
| Tap-to-explain (`WhyButton`) | measured, 4x CPU | 60 to 94 ms. Event Timing max 40 to 64 ms | Good. Pure client state |
| Role word (`RolePicker`) | by code | Instant (optimistic) | Good |
| Rated | by code plus write timing | Switch instant (the prod fix, local state). The card sentence and announcer follow the refresh at about 0.15 + 0.13 + 0.15 + 0.45 s ≈ 0.9 s | Good switch. The card lags |
| Set mode | derived: auth 3 RTT + write 2 calls (125 ms) + 150 ms coalescing + render 450 ms | about 0.85 to 0.9 s | Button un-pends, `Set mode` stays visible (`choice !== selected`), card still shows the old mode |
| Spin | derived, as Set mode | about 0.9 s before the reveal can start, then the 1.2 s cycle | Nothing. The reveal waits for the refreshed card's `pendingKey` (`SpinReveal.tsx:110`), even though the route already returned the spun rule |
| Roll | derived: auth about 120 ms + roll write 685 ms (15 calls) + 150 ms + teams render 530 ms | about 1.5 s | Button un-pends at about 0.8 s with the old lobby on screen for about 0.7 s more |
| Reroll | derived, about the same | about 1.2 s | The same dead window. A second press posts the same stale `splitId` |
| Start a lobby | derived | about 0.8 s, then a full re-render every 5 s while pending | |
| That's me | by code | Route, then a wasted Tonight refresh, then a **full document load** of `/you` (all JS again, about 2.3 s load on Slow 4G) | |
| Tab bar | measured | Board 542 ms, Games 526 ms, Stats 273 ms, You 98 ms, Tonight 697 ms | **No feedback at all** until the new page arrives |

### 3.6 Bundles (gzip, first load)

| Page | JS files | gzip | Notes |
|---|---|---|---|
| `/`, `/download` | 12 | 158 KB | The shared base. Two framework chunks of 71 KB and 42 KB |
| Tonight | 18 | 199 KB | Plus realtime-js 17 KB (correct: no supabase-js, no zod) |
| Board | 16 | 173 KB | |
| Mode | 16 | 176 KB | |
| Admin | 18 | 280 KB | Includes zod plus the schemas: 87.6 KB. Allowed by `lib/clientGraph.test.ts` |

RSC payload of one Tonight refresh: 9.2 KB gzip on the result screen (82 KB raw), 5.2 KB on `customs`.
Small. Bytes are not the problem.

### 3.7 Client re-render cost

Per refresh at 4x CPU: about 26 to 36 ms of main thread (scripting 14 to 18 ms), no long tasks, no
layout or style recalculation worth noting. React's reconciliation of an unchanged payload is cheap.
**Memoizing components or splitting context would not move any number here.** I did not do it, and
it should not be part of the plan.

## 4. Ranked findings

Line references are to `apps/web` on `main`.

1. **A refresh re-prefetches every visible link, and the player and game prefetches run their full
   loaders.**
   - `TonightLive.tsx:130` calls `router.refresh()`, which invalidates the router's prefetch cache. Each
     `<Link>` in view is prefetched again.
   - `p/[puuid]/page.tsx:52` and `games/[gameId]/page.tsx:41` run `loadPlayer` / `loadGameDetail` from
     `generateMetadata`, so a prefetch costs 11 and 8 queries.
   - Links on Tonight: `_tonight/TeamCard.tsx:194`, `_tonight/Cards.tsx:167`, `:197`, `:276`, `:320`,
     `:389`, `_tonight/Tape.tsx:149`. On Games, every row prefetches (`_games/GamesList.tsx:159`,
     `:267`).
   - Effect: 41% of the Supabase calls on a result-screen refresh, and about 2x the first-load cost of
     Tonight and Games.
2. **Events from other groups, and posts that change nothing, re-render Tonight.**
   - `lobby_members` and `splits` are not filtered by group (`TonightLive.tsx:58-69`). Measured: 3 of 3
     posts in another group refreshed this page.
   - The lobby ingest deletes and upserts all members on every post, changed or not
     (`lib/ingest/lobby.ts:660-670`).
   - Decision row 632 (2026-10-03) accepted the first point "at friends scale". With multi-group 2.0
     live, the cost is groups x open viewers x posts at 21:00, all on one shared function budget.
3. **The Tonight render is a deep waterfall with no cache.**
   - Two phases run in sequence, joined by the label read: `(tonight)/page.tsx:86-99`, then `:102`
     (`loadRosterLabels`), then `:103-108`, then `:142-157`.
   - `loadTonight` is itself 2 to 6 waves (`lib/tonight/load.ts:85-98`, `:165-180`, `:506-514`).
   - `loadRosterLabels` (`lib/names/roster.ts:31-80`) adds 4 to 5 waves:
     - `readRosterIds` reads `ratings`, then `group_members_public`, one after the other (`:96-121`).
     - `readPlayers` runs chunks in sequence.
     - `readFirstGames` is one query per clashing name (`:153-175`, 18 on `customs`).
   - Duplicate reads in one render: `lobbies` x2, `group_modes` x2 (`loadFearless` and
     `loadModeState`), `groups_public` x2 (`requirePageGroup` and `lib/board/load.ts:695`).
   - Re-read on every event although they change daily or per game: the top five (about 12 queries),
     the daily game, admin names, the last game, host presence.
4. **Refresh scheduling multiplies renders.**
   - The coalescer is leading-edge only, with a fixed 150 ms window, no single-flight and no trailing
     run (`TonightLive.tsx:124-137`). An event that lands during an in-flight render starts a second
     one.
   - A game end's ten-plus writes spread over more than 150 ms, so they become 4 to 5 renders. Some
     run against a half-written game.
   - Every first `SUBSCRIBED` re-reads, even when the SSR is a second old (`:172-180`).
   - A control's ask (`lib/tonight/live.ts:72`) and the Realtime event for the same write become 2
     renders whenever they are more than 150 ms apart.
5. **Controls end "pending" before the screen changes.**
   - Each control resets `pending` in `finally` right after the route answers. It then asks for a
     refresh that takes another 0.6 to 0.9 s:
     - `RollControl.tsx:73-75`
     - `RerollControl.tsx:62-64` (`next` is computed from the old props, so a second press reposts
       the old `splitId`)
     - `StartLobby.tsx:156-162`
     - `ModeControls.tsx:182-184` with `:244` (Set mode)
     - `ModeControls.tsx:206-221` (Spin)
   - The admin pages do the same:
     - `admin/_components/ConfirmAction.tsx:72-75` closes the dialog, then calls `router.refresh()`
       outside a transition.
     - The same pattern: `MemberActions.tsx:38`, `ResetRatingsCard.tsx:86`, `InviteCard.tsx:82`,
       `discord/DiscordControls.tsx:63` and `:132`.
   - Spin's local reveal waits for the refreshed card (`SpinReveal.tsx:86-110`). The admin's own route
     answer is authenticated and could play at once; only the public broadcast needs confirming.
6. **No loading boundaries and no streaming.**
   - Tab taps take 270 to 700 ms with no pending state. `components/shell/TabBar.tsx:39` only reads
     `usePathname()`, so the active tab moves only after the new page lands.
   - With no `loading.tsx`, a dynamic route's Link prefetch fetches nothing useful.
   - With no `<Suspense>`, Tonight's TTFB waits for the rail, the top five, your night, the recap and
     the breakdown. These sit below the fold on a phone.
7. **Polling uses full re-renders.**
   - Start a lobby: every 5 s for every linked viewer while pending (`TonightLive.tsx:218-222`,
     decision row 376).
   - Nameless names: every 60 s (`:212-216`).
   - The AI recap waiter calls `router.refresh()` directly, bypassing the coalescer
     (`components/ai/RecapWaiter.tsx:18`).
   - Each of these answers a one-row question with a 30 to 95 query render.
8. **That's me does two wasted loads.** It asks for a Tonight refresh and then does
   `window.location.assign` to `/you` (`_tonight/RoleTonight.tsx:262-268`, `:312-313`;
   `_games/ThatsMe.tsx:19-23`). The link writes server data, not a cookie, so a soft `router.push` would
   do. That drops a full document and JS load on a phone.
9. **Signed-in renders verify the session more than once.**
   - The group layout and Tonight use `currentSessionPlayer` (`lib/viewer.ts:58-93`). Admin pages also
     use `currentPageSession` (`lib/groups/pageSession.ts:33-55`). Each calls GoTrue `getUser()`, so an
     admin page pays two auth round trips, then a `players` read each.
   - Not on Tonight's critical path today (it runs beside `loadTonight`). It will be once finding 3 is
     fixed.
   - Not measurable here without a session.
10. **The marketing pages are `force-dynamic` only for the top bar's Sign in / Sign out.**
    (`(kustom)/download/page.tsx:10`, `about/page.tsx:11`, `page.tsx:14`.) So they are never served
    from the CDN. Low cost today (TTFB 5 to 11 ms locally), but every hit is a function invocation.
11. **`proxy.ts:38` sets the `kustom_group` cookie on every `/g/*` request**, RSC fetches and prefetches
    included. Each response carries `Set-Cookie`. Low.
12. **The admin bundle carries zod (87.6 KB gzip)** for in-browser validation (allowed by
    `lib/clientGraph.test.ts:31-36`). Low: admins only.

### Client state inventory (every control that writes)

| Control | Today | Target |
|---|---|---|
| Rated switch (`ModeControls.tsx:223-242`) | Local plus version handback (good) | Keep. Feed it from the client mode store (phase 4) |
| Set mode (`:187-204`) | Pending, then waits for refresh | Optimistic select and card title via the mode store. Pending until confirmed |
| Spin (`:206-221`) | Reveal gated on refresh | Play from the route's answer (`source: 'local'`). Broadcasts stay gated |
| Reset fearless (`:402-432`) | Waits for refresh | Patched from `fearless_state` / `group_modes` |
| Roll / Reroll | Pending ends early | `useTransition`-backed pending until the refresh lands |
| Start a lobby | Pending ends early. 5 s full-render poll | Pending until refresh. Targeted status poll |
| Role word | Optimistic (good) | Keep |
| That's me (Tonight, game page) | Full document load | `router.push` |
| Admin ConfirmAction, MemberActions, Reset ratings, Invite, Discord | Close, then refresh, no transition | `useTransition` with pending until the refresh lands. `useOptimistic` for member rows |
| `SavedSwitch` (Premium) | Optimistic. Never re-syncs `initial` | Keep. Sync on prop change if a second admin flips it |
| Fearless pool filter, Why buttons, theme | Client only (good) | Keep |

## 5. Target architecture for state and refresh

### 5.1 Who owns each slice

| Slice | First paint | After that | Why |
|---|---|---|---|
| Mode card: standing, pending rule, rated override, version, ban count | Server props | **Patched on the client** from the `group_modes` / `fearless_state` `postgres_changes` row, version-gated, plus the controls' own route answers | Has no names, so it is label-safe. The Realtime row comes through RLS, so it is trusted. This removes every server render a mode change causes today, for every viewer |
| Connection, live dot | External store (`lib/tonight/live.ts`) | Unchanged | Already right |
| In-game timer | Client (`Elapsed`) | Unchanged | Already right |
| Role override (own seat) | Server | Optimistic (exists). Confirmed by the next server render | Seat rows carry names |
| Lobby members, teams, sitters, result, tape, receipt | Server | **Server re-render**, triggered once per logical change | Every name carries its same-name label, which only the server computes |
| Top five, board, games list, stats | Server | Server, **from a tagged cache** invalidated by game ingest, rebuild and reset | Changes per game, not per event |
| Roster label inputs (roster ids, players, first games) | Server | Server, from a tagged cache (`roster:<groupId>`). **Labels themselves are still computed per render** | Correctness unchanged, cost about 0 |
| Daily game, admin names, group by slug | Server | Tagged caches (daily, `admins:<id>`, `group:<id>`) | Rarely changes |
| Host presence | Server | 30 s time-based cache | Heartbeat-driven |
| Start a lobby status | Server | Small targeted poll (new route) while pending | Service-role-only table |
| AI recap | Server | Targeted check, then one refresh when it lands | |
| Viewer, lobby password, sit-out preview, calibration | Server, per request | Never cached across viewers | Session and service-role facts |

### 5.2 The refresh pipeline

- **One scheduler in `TonightLive`.**
  - Debounce on the trailing edge (about 150 ms) with a maximum wait (about 600 ms), so a burst
    still gives one render.
  - Single-flight: at most one render in flight and one queued.
  - Events during a render mark it dirty, which gives exactly one follow-up render.
- **Asks dedupe against events.** `requestTonightRefresh()` returns a promise and carries the time the
  route answered. A render that started after that time already includes the write, so the ask joins
  it instead of starting another. The promise resolves when the `startTransition` refresh commits, and
  controls hold `pending` until then. This closes finding 5's dead window.
- **One live signal per logical change** (needs platform, section 8). Each write route bumps a
  per-group version as its last write, or the two unfiltered tables gain `group_id`. The page then:
  - hears only its own group;
  - hears a game end once, after all its writes;
  - skips the first-subscribe re-read when the version it was rendered at is still current.
- **Prefetch.**
  - `prefetch={false}` on in-content player and game links on live pages: Tonight, and the Games list
    rows.
  - Cheap `generateMetadata` on the player and game pages: a title read, not the full loader.
  - Tabs keep prefetching, and each gets a `loading.tsx` so the prefetch is useful.

### 5.3 Caching and tags

- **Within one request:** React `cache()` for the reads that run twice today (`lobbies`, `group_modes`,
  `groups_public` ratings epoch).
- **Across requests:** `unstable_cache` keyed by `groupId`. It works in Next 16 without turning on
  `cacheComponents`; `'use cache'` with `cacheTag` is the later migration. Results must be plain JSON,
  so cache arrays and build the `Map`s outside.

  | Tag | Covers | Invalidated by |
  |---|---|---|
  | `group:<id>` | slug to group | group settings, owner routes |
  | `roster:<id>` | label inputs | lobby ingest when a player row is created or renamed, member routes, pair and link |
  | `games:<id>` | top five, board, games list, last game | eog ingest, backfill, rebuild-ratings, ratings reset |
  | `admins:<id>` | admin names | role routes |
  | `mystery:<id>` | daily game | `revalidate` at the next night start |
  | `hosts:<id>` | host presence | token routes, plus `revalidate: 30` |

- **Invalidation call:** routes use `revalidateTag(tag, { expire: 0 })`. Next 16's recommended
  `'max'` profile is stale-while-revalidate: the next viewer would see the old top five once, which is
  wrong for live data. The one-argument form is deprecated.
- **Never cached across requests:** anything that reads `cookies()`, the session, or a service-role
  fact shown to a specific viewer (password, start press, sit-out).

### 5.4 React 19 / Next 16 features: what fits

| Feature | Verdict |
|---|---|
| `useTransition` | **Yes.** Around every `router.refresh()`, and as the source of "pending until the screen changed" |
| `useOptimistic` | **Yes, narrowly:** Set mode and Spin card state, admin member rows. Not for lobby or teams (names) |
| `useLinkStatus` | **Yes,** on `TabBar` / `TopBar` links: instant pressed state |
| `loading.tsx` | **Yes,** for Tonight, Board, Games, Stats and You (skeletons in the design tokens; ask `designer`) |
| `<Suspense>` streaming | **Yes, on Tonight below the fold** (rail, top five, your night, last game, recap and breakdown) and the board's storyline. A refresh inside a transition keeps shown content instead of flashing fallbacks |
| Server actions with `updateTag` and `refresh()` | **Not now.** They could save the separate refresh request per admin tap, but the routes are platform's, serve the no-JS form path, and are shared with the companion. Revisit after phase 4 if admin taps still feel slow |
| `useActionState` | Only if server actions are adopted |
| Partial Realtime patches | **Yes, for the Mode slice only** (phase 4). Lobby and game slices keep the server render |
| `cacheComponents` / PPR | **Later.** It changes every page's dynamic rules. Do it after phases 1 to 3 have cut the cost it would otherwise hide |

### 5.5 The "never cache a snapshot on the client" rule

Keep it for anything that prints a name. Relax it, with a new decision row, for name-free slices patched
from trusted `postgres_changes` rows: the Mode card, the rated flag, the ban count, the lobby status for
the live dot. The proposed wording for `TonightLive`'s comment:

> "The client may hold a name-free slice patched from a `postgres_changes` row this channel received
> (never from a broadcast). Anything that prints a player's name comes from the server render."

A later step, not in this plan: ship the page's label map (`puuid` to `{base, suffix}`) with the render.
A client patch would then be allowed when every `puuid` in it is in the map, and would fall back to a
server render when someone new appears. Labels would stay the server's.

## 6. Phased plan

Each phase ships on its own, behind the existing tests plus the ones listed. **Phases 1 and 4 touch
`ModeControls` / `TonightView`. Schedule them after the lane editing those files has merged.**

| Phase | Size | Owner | What | Tests proving no behaviour change | Metric it should move |
|---|---|---|---|---|---|
| **0. Bench** | S (0.5 d) | web | Dev-only perf logging behind `KUSTOM_PERF_LOG=1` (render start/end, Supabase call count), and `scripts/perf-tonight.ts`, which replays this audit's event script on a local scratch group | None. The script prints the 3.1 table | Baseline is reproducible |
| **1. Refresh hygiene** | S to M (1 to 1.5 d) | web | Single-flight trailing scheduler with max wait. Promise-returning `requestTonightRefresh` deduped by answer time. Pending held until the refresh commits in Roll, Reroll, Start a lobby, Set mode, Spin and the admin actions (`useTransition`). `prefetch={false}` on in-content player and game links (Tonight, Games rows). `RecapWaiter` routed through the same scheduler on Tonight. That's me via `router.push` | `TonightLive.test.tsx` with fake timers: burst gives 1 render; event during a render gives exactly 1 follow-up; ask after a covering render gives none; reconnect still re-reads. Roll and Reroll tests: button stays pending until refresh resolves, and a second press is dropped. `RoleTonight.test.tsx`: link lands via router | Renders per eog 4-5 to ≤2. Per tap 2 to 1. Prefetch requests per refresh 9 to 4. Queries per result refresh 95 to about 56. Dead window about 0.7 s to 0 |
| **2. Cheap render** | M (2 to 3 d) | web, plus platform for invalidation | Start the roster reads beside `loadTonight` (only the extras wait). `readRosterIds` reads in parallel. `readFirstGames` as one `in` query. Remove duplicate reads with `cache()`. `unstable_cache` with the tags in 5.3. Cheap `generateMetadata` on the player and game pages | `tonight.integration.test.ts`, `lib/names/roster.integration.test.ts`, `board.integration.test.ts` unchanged. New: labels from cached inputs equal labels from uncached inputs over the roster fixtures. New integration: ingest an eog, then the next render shows the new top five (tag invalidated). New: rename a player, then the suffix updates | Tonight waves 14 to ≤6. Queries 39-56 to ≤20. TTFB at 40 ms 630-700 ms to ≤300 ms. Board and Games TTFB about 450 ms to ≤150 ms warm |
| **3. One live signal** | M (2 d) | platform (migration and routes), then web | Group filter for `lobby_members` and `splits` (column plus filter), or a per-group version row bumped last by each write route. Lobby ingest skips unchanged member upserts. The first subscribe compares versions instead of re-reading | Realtime integration on the local stack: a post in group B gives 0 events on group A's channel. An eog gives exactly 1 signal after the game, players and ratings are written. An unchanged lobby post gives 0 events. Existing `companion.integration` and `lobbyState.integration` unchanged | Cross-group renders 3 to 0. Unchanged post 1 to 0. Open-page renders 2 to 1. eog renders to 1 and no torn reads |
| **4. Mode slice on the client** | M (2 to 3 d) | web (copy parity with `designer` if wording moves) | A client mode store fed by server props, `group_modes` / `fearless_state` rows and route answers, with version gating. The card's status, chip and next-game line render from it with `@customs/core`'s own helpers. Set mode optimistic. Spin plays the route's answer at once; broadcasts are still confirmed. Decision row and `TonightLive` comment updated (5.5) | A parity test that renders the card from server props and from the store for every mode and rule (Normal, Fearless with bans, each class, region, mirror, rated on and off, after Roll), with identical text. Version gating: an older row is ignored. Another admin's row moves the card. Extend `ratedSwitch.test.tsx` to Set mode and Spin. `lib/clientGraph.test.ts` still passes (no zod, no `node:*`) | Rated, Set mode and Spin tap to card ≤100 ms. Server renders per mode change: 1 per viewer to 0 |
| **5. Navigation and streaming** | S to M (1.5 d) | web, plus designer for skeletons | `loading.tsx` per tab. `useLinkStatus` pending on tab links. `<Suspense>` around Tonight's below-the-fold sections and the board storyline | Page tests render the fallbacks. `pageGroup.test.tsx` and `nav.test.ts` unchanged. Axe or keyboard checks on the skeletons | Tab tap to visible feedback 270-700 ms to <100 ms. Tonight first-byte to header ≤200 ms |
| **6. Targeted polls** | S (1 d) | platform route, then web | Start a lobby status via a small GET while pending. Recap via a small check, one refresh on land | `StartLobby.test.tsx`: poll hits the status route, not the page. Integration on the route | Renders while start pending 12/min to 0 |
| **7. Static marketing (optional)** | S (0.5 d) | web | `/download`, `/about`, `/how` static. Sign in / Sign out becomes a small client island asking `/api/me` | Landing tests unchanged. Build output shows them as static | Function invocations on marketing pages to 0. CDN-served |

Order: 0, then 1, 2 and 3 (the biggest wins, in parallel across web and platform), then 5, then 4, then
6 and 7. Phases 1 to 3 alone should cut Tonight's server work per real event by about 5 to 10x.

## 7. Risks

- **Realtime correctness.**
  - Every patch must be version-gated. Out-of-order rows are normal across reconnects.
  - Keep the re-read on every resubscribe and on visibility change. Events missed while asleep are not
    replayed.
  - DELETE payloads carry only the primary key unless `REPLICA IDENTITY FULL`. Treat a DELETE as a
    trigger for a server render, never as a patch.
  - Broadcasts on the public `tonight:<groupId>` channel can be sent by anyone with the anon key.
    Keep them as hints (as Spin does now), never as data.
  - A single-flight scheduler must never drop the last event. The rule: dirty during a render means
    one more render.
- **Torn reads.** Phase 1 alone still renders mid-ingest if a burst outlasts the maximum wait. Only
  phase 3's bump-after-the-last-write removes that.
- **Label correctness.**
  - Caching the label inputs needs invalidation on every rename and new player. A missed one shows the
    wrong suffix until it expires. Mitigations: compute labels per render from the cached inputs; add a
    short TTL (5 min) on top of the tag; add the parity test in phase 2.
  - Never cache a labelled snapshot.
  - The Mode slice prints no names. Re-check that before adding any field to it (for example a "set by"
    name).
- **Auth.**
  - Nothing keyed by, or derived from, the session may enter `unstable_cache`.
  - The password, start press, viewer role and sit-out reads stay per request.
  - Cached functions use the anon client only. The service role stays out of cross-user caches.
  - Optimistic UI never draws a control the server did not draw. The routes still re-check admin
    rights.
  - Moving the auth check to `getClaims()` to save the GoTrue round trip is an auth decision for
    platform, not part of this plan.
- **Next 16 cache semantics.**
  - `revalidateTag(tag, 'max')` serves stale data once. Use `{ expire: 0 }` (5.3).
  - The data cache is regional and shared across instances. Invalidation is near-immediate, not
    transactional.
  - `unstable_cache` is the legacy API. Plan the `'use cache'` migration with `cacheComponents`.
- **Prefetch off means slower first taps on those links.** Player and game links on Tonight lose their
  prefetch. With cheap metadata and `loading.tsx` the tap still gives instant feedback.
- **Lane collision.** Phases 1 and 4 edit `ModeControls.tsx`, `TonightView.tsx` and `TonightLive.tsx`.
- **Measurement caveats.**
  - The 40 ms RTT is an assumption. Waves are the portable number.
  - Hosted Realtime delivery is slower than local, which makes the double-render-per-tap case more
    common than measured here.
  - Admin tap latency is derived, not measured end to end.

## 8. Contracts needed from platform-engineer

1. `revalidateTag(<tag>, { expire: 0 })` after the last write in:
   - `companion/game` (eog): `games:<gid>`, and `roster:<gid>` when players were created or renamed.
   - `companion/lobby`: `roster:<gid>` when `ensurePlayers` created or renamed someone.
   - `admin/members/*`, `admin/owner/*`: `roster:<gid>`, `admins:<gid>`.
   - `admin/ratings/reset` and the `rebuild-ratings` script (or a cron hook): `games:<gid>`.
   - `admin/group`: `group:<id>`.
   - `admin/tokens`, `companion/pair`: `hosts:<gid>`.
   - `me/link`: `roster:<gid>`.
2. Lobby ingest: no write when a member row is unchanged (`lib/ingest/lobby.ts:660-670`), so a no-op post
   raises no Realtime event.
3. A per-group live signal (one of two):
   - (a) migration adding `group_id` to `lobby_members` and `splits`, so the page can filter them; or
   - (b) a `group_live(group_id pk, version bigint, kind text, changed_at)` row, published, bumped as
     each write route's last statement.

   (b) also fixes torn reads and the first-subscribe re-read. Schema change: needs a decision row.
4. `GET /api/me/lobbies/start/status?groupId=` returning `{ status: 'pending' | 'sent' | 'done' | 'failed'
   | null, host: { name } | null }` for linked members (zod response schema), replacing the 5 s page
   poll.
5. (Phase 6) a light `GET` for "has this game's recap landed" (`{ landed: boolean }`), or a Realtime-safe
   signal for it.
