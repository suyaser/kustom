# Phase 4 quality slice (M14.26): accessibility, performance, interface guidelines

Designer, 2026-10-03. Branch `worktree-agent-a0c760d8aeb72ac17`, merged from `redesign-2.0` at `08aacc5`. Local stack
only (`0028`), production build (`next build` + `next start`); kit pages on a dev server (they 404 under `next start`).
Saved by the lead from the designer's hand-back.

> **Lead's numbering (2026-10-03).** The designer proposed M14.37–M14.45, which collided with tasks already taken.
> They land as: **M14.44** client JS diet (P1, P2, P5), **M14.45** Tonight loads only the icons it shows (P3),
> A6 → **M14.41** (mode panel headings, with the Tonight lane), A7, A8, A9, A10, A11, G1, G2 → **M14.42** (other
> pages). P4 (board CLS) came from the streamed `loading.tsx` that **M14.39** removed; re-measured in M14.44.

**Headline.**
- Axe finds **no serious or critical violation on any product route**, at 375 and 1440, in Night and Day. That meets
  M14.25's acceptance (4).
- Keyboard, the Mode panel trap, landmarks, live regions, reduced motion, forced colours and reflow at 320 all hold up.
- One defect a player would hit is fixed here: keyboard focus going under the tab bar.
- The real problems are performance:
  - Tonight ships about 121 KB gzip of Node crypto polyfills by accident.
  - Every route carries 87 KB gzip of zod.
  - Tonight downloads about 830 KB of champion sprite sheets for a grid of about 10 icons.
- Lighthouse mobile scores 79 to 92. The board's CLS (0.171) is the only Core Web Vital outside "good".

## 1. Scores

### Lighthouse mobile (13.5.0, default mobile config, simulated slow 4G and 4x CPU, median of 3 runs)

| Route | Perf | LCP | CLS | TBT | JS transferred | Runs |
|---|---|---|---|---|---|---|
| `/` | 89 | 3.83 s | 0.000 | 29 ms | 460 KB | 88/89/92 |
| `/g/customs` (Tonight, finished) | **83** | **4.83 s** | 0.030 | 26 ms | **456 KB** | 83/83/83 |
| `/g/customs/leaderboard` | **79** | 4.13 s | **0.171** | 23 ms | 265 KB | 79/79/79 |
| `/g/customs/games` | 92 | 3.31 s | 0.000 | 15 ms | 261 KB | 92/92/89 |
| `/g/customs/games/<id>` | 92 | 3.31 s | 0.000 | 9 ms | 265 KB | 92/92/92 |
| `/g/customs/stats` | 91 | 3.46 s | 0.000 | 8 ms | 261 KB | 97/91/91 |

How to read these numbers:
- JS transferred is the gzip size as `next start` serves it. Vercel serves brotli, which is about 10 to 15% smaller.
- Server response time (TTFB) is local, 6 to 50 ms, so read the scores as relative.
- Tonight's total page weight is 1540 KB against about 480 KB elsewhere (see P3).
- Kit pages were not measured, because dev-server numbers are not meaningful.

### Axe (wcag2a/aa, wcag21a/aa, wcag22aa, best-practice)

| Set | Scans | Serious/critical | Moderate |
|---|---|---|---|
| 26 product paths (including the `/ops` and `/nope` 404s, `/admin/login`, admin signed out) × 375/1440 × Night/Day | 104 | **0** | `landmark-unique` on `/` and `/about` (A7); `heading-order` on the player page (fixed) and `/g/customs/mode` (A6) |
| 20 kit pages × 375/1440 × Night/Day | 80 | 16 nodes on `/kit/receipt` in Day only, a kit artifact (A10) | the same moderates as the product pages they mirror |

### Client JS per route

Measured as the gzip size of each module script the served HTML loads. The 38.5 KB `noModule` core-js polyfill is left
out, because modern browsers never fetch it.

| Route | gzip |
|---|---|
| `/`, `/how`, `/download` | 245 KB |
| `/new` | 250 KB |
| board, player, games, game, you, stats ×3 | 254–258 KB |
| mode | 260 KB |
| mystery | 264 KB |
| admin | 274 KB |
| **Tonight** | **447 KB** |

## 2. The three biggest client-JS costs, and whether each is needed

1. **Tonight-only chunk, 134 KB gzip.** Not needed.
   - About 121 KB of it is Node polyfills: buffer, events, util, stream-browserify, string_decoder, vm-browserify and
     crypto-browserify (secp256k1, pbkdf2, Diffie-Hellman).
   - Cause: `app/_tonight/StartLobby.tsx` ('use client') imports `invitedLine`, `START_LOBBY_BUTTON` and
     `startLobbySentence` from `lib/lobbyStart.ts`. That file's line 1 is `import { randomInt } from 'node:crypto'`,
     used for the server-only password.
   - Measured: cutting only that import takes Tonight from 485 to 364 KB gzip (−121 KB).
2. **Shared chunk, 87 KB gzip, on every route including the landing page.** Not needed on read-only pages.
   - It holds all of zod v4 (every locale, JSON-schema code) plus every `@customs/db` schema.
   - One chain: `TopBar`/`TabBar`/`Wordmark` → `lib/nav.ts` → `lib/versus/copy.ts` → `lib/tonight/copy.ts` →
     `lib/lobbyState.ts` → `lib/commands/queue.ts` → `@customs/db/schemas` → zod.
   - Other ways in: `lib/groups/pageGroup.ts` (`groupSlugSchema`), `lib/stats/rawFacts.ts` (the `@customs/db` root),
     `lib/tonight/state.ts`, `lib/admin/formValues.ts`, `lib/env.ts`.
   - Cutting one chain saves nothing: a second experiment moved the total by only 6 KB.
3. **react-dom, 71 KB gzip, every route.** Needed.
   - Fourth is supabase-js, 54 KB gzip, Tonight only. It brings GoTrue, PostgREST and Realtime when Tonight only needs
     Realtime (P5).

**Is Tonight's 449 KB justified?** No.
- With P1 alone it is about 330 KB.
- With P1 + P2 it is about 245 KB.
- The floor is about 160 KB: framework, Next runtime and Realtime.

## 3. Findings (ranked by what a player notices first)

### Fixed (c1db30f)

- **F1 (every grouped page below 1024): focus went under the fixed tab bar (WCAG 2.4.11).**
  - Fix: `scroll-padding-bottom` in `globals.css`.
  - Verified: 0 covered stops after the fix.
  - Evidence: `screens/focus-under-tabbar-leaderboard-375.png` and `focus-clear-of-tabbar-after-fix-375.png`.
- **F2 (player page): stat cards were `h3` straight after the `h1`.**
  - Fix: `StatCard` now uses the default `h2`.
  - Verified: axe reports 0 violations on the page.

### Performance

**P1 should-fix, Tonight: about 121 KB of crypto polyfills (§2.1).** → M14.44. **Done** (with P2, P5: Tonight 447.1 → 188.9 KB; `data/bundle-summary.json` is the after, `data/bundle-summary-m14-44-before.json` the before).
- Fix:
  - Move the friend-facing half of `lib/lobbyStart.ts` into a new `lib/lobbyStartCopy.ts` with no Node imports, and
    re-export it from `lib/lobbyStart.ts`.
  - Add `import 'server-only'` to `lib/lobbyStart.ts`, `lib/companionAuth.ts`, `lib/groups/pairing.ts` and
    `lib/discord/connect.ts`.
- Acceptance:
  - `StartLobby` reaches no `node:*` module.
  - The four server modules carry `server-only`.
  - Tonight's client JS drops by at least 100 KB gzip against `data/bundle-summary.json`.
  - The start-lobby tests still pass.

**P2 should-fix, every route: zod and all schemas, 87 KB (§2.2).** → M14.44
- Fix:
  - `lib/lobbyState.ts` stops importing `lib/commands/queue.ts`; `PLAYERS_PER_GAME` and the status helpers move to a
    constants file.
  - `pageGroup` takes `ORIGINAL_GROUP_ID` from a zod-free `@customs/db/constants` export, and checks slugs with an
    exported regex.
  - `rawFacts` and `tonight/state` import from zod-free paths.
  - A vitest walks the client import graph and fails on zod outside an allow-list: `/new`, join, admin, Mode controls.
    `scripts/graph.mjs` is a working start.
- Acceptance:
  - No chunk on `/`, the board, a game page or stats contains `ZodError`.
  - Those routes drop by at least 70 KB gzip.
  - The import-graph test runs in CI.

**P3 should-fix, Tonight with Fearless on, and `/mode`: Tonight loads all six Data Dragon sprite sheets, 826 KB of
PNG.** → M14.45. **Done:** images 11.8 KB, perf median 90, CLS 0.003 (M14.45 milestone note).
- Cause: `ModeCard.tsx:74` calls `preloadChampionSprites()` on render, but the card shows at most about 10 icons.
- Effect: Tonight weighs 1.5 MB and its LCP is 4.8 s, against 3.3 s elsewhere.
- Fix:
  - Tonight uses per-champion square images (5–10 KB each, lazy, with width and height).
  - The sheet preload moves to intent: pointerenter or focus on the Mode card link.
  - Amend 05-design §8.8.
- Acceptance:
  - Tonight (finished, Fearless on) loads 150 KB of images or less.
  - The panel still paints its icons on open.
  - Tonight's perf score is 88 or more.

**P4 should-fix, board: CLS 0.171.** → removed by M14.39, re-measured in M14.44
- The one shift was the footer. `leaderboard/loading.tsx` streamed a 621 px skeleton, then the board (1923 px) pushed
  the footer down.
- Acceptance: board CLS is 0.05 or less, median of 3.

**P5 polish, Tonight: supabase-js (54 KB) for one Realtime channel.** → M14.44
- Fix: in the browser path of `lib/publicClient.ts`, use `@supabase/realtime-js` alone. Expected saving 25–30 KB (not
  measured).
- Acceptance:
  - Reconnect and refresh still work, both live and in the kit `reconnecting` state.
  - No GoTrue or PostgREST code in Tonight's chunks.

### Accessibility (hand checks)

**A6 polish, `/g/customs/mode` direct page: `h1` is followed by lane `h3`s.** → M14.41
- 05-design §8.9 prescribes this, and it skips a level.
- Fix: lanes sit one level below the panel heading. Pass `heading === 'h1' ? 'h2' : 'h3'` into `FearlessPool.tsx:176`,
  update `mode.test.tsx` (it asserts level 3), and amend §8.9.
- Acceptance:
  - Axe `heading-order` is clean on `/g/customs/mode`.
  - The overlay keeps h2 + h3.

**A7 polish, `/` and `/about`: two receipt sections are both named "The odds were…" (`landmark-unique`).** → M14.42
- Fix: give the receipt an optional `label`, or render the demo receipts as `role="group"`.

**A8 polish, Tonight: the tab title is just `Kustom`.** Every other route has a descriptive title (WCAG 2.4.2). → M14.42
- Fix: `title: Tonight · ${group.name} · Kustom`. The `og:title` follows M14.42 gap 9.

**A9 polish: at 200% text size (not zoom), two things scroll sideways at 375.** Page zoom at 200% and reflow at 320 are
clean everywhere. → M14.42
- The landing CTA `Create your group` (`shrink-0`, no wrap) makes the page 493 px wide.
- The board's `Sort by` (`min-w-48`) makes it 400 px wide.
- Fix: let the CTA wrap; use `min-w-0 w-full sm:min-w-48` in `app/_board/SortSelect.tsx`.

**A10 polish, dev only, `/kit/receipt` in Day.** The wrapper sets `data-theme` without `bg-background`, so Night ink
sits on the Day page. → M14.42
- Fix: add `bg-background` at `app/(dev)/kit/receipt/page.tsx:38`.

**A11 polish, `/admin/login`.** It is the only 2.0 page without the skip link. → M14.42
- Fix: render `<SkipLink/>` first, and give `main` `id="main" tabIndex={-1}`.

### Interface guidelines and the 05-design §6 check list

Applied the Vercel Web Interface Guidelines (the web-design-guidelines skill) and 05-design §6 to the code and to fresh
375 captures. These pass:
- forms: labels, autocomplete off, `spellCheck={false}`, search type
- focus: outline, never box-shadow
- 44 px touch targets: no standalone control smaller on any route
- touch-action, color-scheme, theme-color
- URL as state: window, sort, filters, 1v1 picks and mode lane are all in the query
- no `transition: all`, no `autoFocus`
- no clipped names
- Arabic award subtitles carry `lang="ar" dir="rtl"`
- reduced motion: nothing animates under the preference
- forced colours: glyphs, chips, team cards and the YOU tag all survive

What remains (→ M14.42):
- **G1 polish, game page: a zero rating change shows `+0` in gain styling.** 05-design §5.3 says `±0`, muted 400.
  - Fix in `app/_games/Delta.tsx`: `size === 0 ? '±0' : formatWebDelta(value)`, with the muted class, and a test.
- **G2 polish, stats: `lib/stats/funCopy.ts:369,373` calls `toLocaleString()` with no locale.**
  - Fix: `toLocaleString(DISPLAY_LOCALE)`.

## 4. Hand-check record

- **Keyboard** (375 and 1440):
  - The skip link is the first stop and lands in `main`.
  - Every stop shows a 2px outline.
  - Below 1024 the tab bar comes before the top bar in the DOM, as documented.
- **Mode panel** (prod Tonight, 375 and 1440):
  - It opens as a dialog with focus on the `h2`.
  - 60 Tabs and 20 Shift+Tabs never leave it.
  - Escape returns to `/g/customs`, puts focus back on the card link, and leaves no `inert` behind.
- **Landmarks:**
  - One `h1` on every route.
  - One `main`.
  - Every nav is labelled. `Main` appears twice; at each width one copy is hidden by CSS.
  - `lang="en"`.
- **Tonight's live regions:** one polite announcer (`Teams are set. Blue 54 percent…`, `Game started.`,
  `Four more to go.`, `Red wins.`) plus the connection status.
- **Reflow:** 320 px and 200% page zoom are clean. 200% text has the two overflows in A9.

## 5. Method and limits

- Tools ran from a scratch npm directory, not added as dev deps: playwright 1.63, @axe-core/playwright and lighthouse
  13.5.0, on Chrome stable.
- Ports: 3111 was used until another lane's webhook stub took it. The experiments and the post-fix check ran on 3119.
- Data is thin: 8 games, many of them fixtures, and no live lobby, so the live states come from the kit.
- Not done: a real screen reader, or Windows High Contrast on hardware.
