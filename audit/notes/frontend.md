# Frontend audit: apps/web (Kustom 2.0, phase 1)

Scope: everything under `apps/web/app` except `api/`, read against `docs/05-design.md` (Floodlit) and the
Vercel Web Interface Guidelines (fetched 2026-10-03). Read-only. I did not run anything.

All paths below are relative to `apps/web/app/` unless they start with `apps/`, `lib/` or `docs/`.

---

## Route map

| Route | File | What it shows | Client? |
|---|---|---|---|
| `/` | `page.tsx` | Nothing. A 308 to the viewer's group (cookie, then memberships), or to `/g/customs` | server |
| `/g/[slug]` | `(group)/g/[slug]/page.tsx` | **Tonight**: status strip, then idle, filling (seat rack and roll), teams (two team cards, explanation, evenness, reroll), or result poster; then fearless, the night tape, the daily-game teaser and role tap; a rail with the top 5, how this works, and the companion | `TonightLive` (Realtime) |
| `/g/[slug]/games/[gameId]` | `(group)/g/[slug]/games/[gameId]/page.tsx` | One game's result poster, the share-card target | server |
| `/leaderboard` | `(site)/leaderboard/page.tsx` | Board with a window picker (`?window=`), rows expand by `<details>` | server (BoardView) |
| `/games` | `(site)/games/page.tsx` | Game history (`?window&queue&p`), expandable match sheets | server |
| `/stats` | `(site)/stats/page.tsx` | Window stats: role blocks, streaks | server |
| `/fun` | `(site)/fun/page.tsx` | Fun facts, including "Won against the odds" | server |
| `/1v1` | `(site)/1v1/page.tsx` | Head-to-head; a GET form with two `<select>`s | server + PlayerPick |
| `/mystery` | `(site)/mystery/page.tsx` | The daily guessing game | `MysteryLive` |
| `/p/[puuid]` | `(site)/p/[puuid]/page.tsx` | Player page: rating chart (SVG), "how you got here", recent games, per-player stats | server |
| `/admin` | `admin/(dashboard)/page.tsx` | Live lobby, roll, every split with its gap and explanation, promote, fearless reset | server + AdminForm |
| `/admin/players`, `/tokens`, `/games`, `/discord`, `/seasons` | `admin/(dashboard)/*/page.tsx` | CRUD tables and forms | server + AdminForm |
| `/admin/login` | `admin/login/page.tsx` | Discord sign-in | server |
| `/og/g/[slug]/tonight`, `/og/p/[puuid]`, … | `og/**` | Share-card PNG route handlers | n/a |

Structural notes:
- **The routing is half-migrated (M13.9).** Only tonight and the game page live under `/g/[slug]`. The six
  `(site)` pages still read the *original* group only (`(site)/layout.tsx:39` `originalGroup()`), and their
  links are hardcoded to `/p/${puuid}` (`_games/MatchSheet.tsx:81`, `_board/PlayerView.tsx:408`,
  `_stats/StatsView.tsx:382`). Admin is global `/admin`, not `/g/<slug>/admin` as 05-design.md specifies. The
  design's `/new`, `/join/<code>` and pairing screens have no page yet.
- Every page is `dynamic = 'force-dynamic'` and awaits all its Supabase reads before the first byte.
- Three layouts: root (fonts, theme bootstrap), `(site)`/`(group)` (Shell = TopBar + Footer), and `admin`
  (its own sidebar app and its own 789-line CSS).

## Guidelines findings (file:line)

### High

- `_shell/Shell.tsx:38` - no skip link; the topbar has up to 9 tabs before `<main>`
- `_tonight/TonightView.tsx:342` - the tonight page has no `<h1>`. The headline is a `<p>`, and the comment at :320 says the wordmark is the h1, but it isn't (`_shell/TopBar.tsx:34` is a `<Link>` with spans)
- `(group)/g/[slug]/games/[gameId]/page.tsx:58` - no `<h1>` on the game page, which is the share-card landing page
- `_tonight/TonightView.tsx:650` - the "you" row is marked by a 2px amber inset and nothing else: colour only, no `cn-sr` text. Same at `_tonight/ResultPoster.tsx:127`, `_tonight/SeatRack.tsx:119`, `_leaderboard/BoardRow.tsx:63`, `_board/PlayerView.tsx:388`, `_games/MatchSheet.tsx:46`, `_games/GamesView.tsx:135`. This breaks 05-design's own "colour is never the only signal" rule
- `tonight.css:338` / `tonight.css:353` - `.cn-new` (just joined) and `.cn-you` draw the same 2px amber left bar, so the two states look identical
- `_leaderboard/BoardRow.tsx:66` - a `<Link>` (:126) sits inside `<summary>`. That nests an interactive element in an interactive element: a tap near the name either expands the row or navigates, and screen readers announce it badly
- `tokens.css:161` - the global focus ring covers only `button, a, summary, [tabindex]`. Outside `/admin`, a `<select>` or `<input>` gets no `:focus-visible` rule (`versus.css:19`, PlayerPick)
- No `loading.tsx`, `error.tsx`, `global-error.tsx` or `not-found.tsx` anywhere (see States)
- `tokens.css:42` - Day `red` `#c2252c` on `raise` `#d7e0ec` is **4.38:1**, below AA for the side name in a team header. Day `brand` on `raise` is exactly 4.50

### Medium

- `admin/(dashboard)/tokens/page.tsx:154` - Revoke is destructive and fires at once, with no confirm or undo
- `admin/(dashboard)/players/page.tsx:248` - "Remove" admin fires at once, no confirm
- `admin/(dashboard)/page.tsx:266` - fearless reset fires at once, no confirm. Seasons has a typed confirm and shows the right pattern
- `_tonight/TonightView.tsx:685` - after a reroll the explanation `<p>` and both team cards are swapped in place, but nothing is `aria-live`. Only the status sentence (:353) is announced
- `versus.css:24` - `<select>` at `t-sm` (14px): iOS zooms the page on focus. The fearless search got this right at `tonight.css:1234`
- `shell.css:149-150` - on a phone the nav tabs scroll sideways with the scrollbar hidden, so tabs past the fold can't be discovered (`lib/nav.ts` has up to 7 tabs + Admin + Companion)
- `_tonight/FearlessCard.tsx:202` - renders every champion chip (about 170) with no `content-visibility: auto`. Inside a client component, `useMemo` re-filters on every keystroke
- `_tonight/FearlessCard.tsx:233` - icons load from `raw.communitydragon.org` (`lib/champs/names.ts:202`) with no `<link rel="preconnect">`
- `_shell/ThemeToggle.tsx:20-24` - starts at `THEME_DEFAULT` and corrects itself in an effect, so the label flashes for Day users (CSS is right thanks to the bootstrap script, but the switch text is not)
- `tonight.css:1244` - `outline: none` replaced by a `box-shadow` ring. That's acceptable, but it disappears in forced-colors mode. Use `outline-color` instead

### Low

- `admin/(dashboard)/discord/page.tsx:82` - `"..."` → `"…"`. Placeholders lack `…`: `_tonight/FearlessCard.tsx:96`, `admin/(dashboard)/players/page.tsx:130`, `admin/(dashboard)/tokens/page.tsx:89`
- `admin/(dashboard)/discord/page.tsx:61,94,105,116,127` - snowflake id inputs: add `autoComplete="off"` and `spellCheck={false}`
- `admin/_components/ui.tsx:123`, `admin/(dashboard)/discord/page.tsx:55` - hand-rolled ISO slices for dates; use `Intl.DateTimeFormat` (the public side already does this in `lib/night.ts`)
- No `touch-action: manipulation` or `-webkit-tap-highlight-color` in any CSS file (phone-primary product)
- No `text-wrap: balance` on headings (`cn-strip-title`, `cn-headline`, `cn-player-name`)
- `.cn-sr-only` is defined three times (`tonight.css:1446`, `mystery.css:162`, `versus.css:154`) on top of `.cn-sr` in `tokens.css`
- `_tonight/FearlessCard.tsx:115` - `<fieldset>` with `aria-label` and no `<legend>`; works, but not idiomatic
- Only 6 `:hover` rules across the public CSS. Defensible on a phone-first product; desktop links in rows feel inert

### Pass

`app/layout.tsx` viewport (zoom allowed, `color-scheme` per theme in tokens.css, theme-color set), every
`prefers-reduced-motion` block, no `transition: all` anywhere (lists like `admin.css:591` name their
properties), RoleIcon `aria-hidden` with its word, the rating chart `role="img"` + `<title>`
(`_board/RatingChart.tsx:72`), fearless `<img>` with width, height, `alt=""` and lazy loading, the window and
queue pickers as `<Link>` + `aria-current` with state in the URL, `aria-disabled` rather than `disabled`
while a request is in flight (Roll, Reroll, Start), `role="alert"` on refusals, GET form on `/1v1`.

## Fairness rendering today

This is where the "the bot is rigged" objection gets answered, or doesn't.

**What is rendered:**
1. **Explanation strip** (`_tonight/TonightView.tsx:674-689`): `splits.explanation` verbatim from core
   (`packages/core/src/balance/explain.ts:57`), e.g. `Blue favored 54%. Everyone on a main role. Gap 100. Next
   best: swap Hana and Omar, gap 170.` One `<p>`, `text` colour, brand rule. Shown in `balanced` and
   `in_game`, and on the result poster (`ResultPoster.tsx:78`).
2. **Evenness** (`TonightView.tsx:454,513`, `lib/tonight/copy.ts:298`): `Teams are 92% even.` **Shown in
   `balanced` only.** It disappears once the game starts.
3. **Team sums** (`TonightView.tsx:605,643`): a bare number in each card header, with sr-only "sum of the
   five ratings". Per-seat display ratings in every row.
4. **Reroll marker** (`TonightView.tsx:520`): `Reroll 1 of 2. Teams changed.`, to every viewer.
5. **Result poster** (`ResultPoster.tsx:32-33`): `Blue was favored 54%.` or the underdog clause.
6. **Night tape** (`NightTape.tsx:46-47`): evenness and underdog per earlier game.
7. **Player page** (`lib/board/explain.ts:52`, `PlayerView.tsx:335`): `As the 58% side.` per recent game.
8. **/fun "Won against the odds"** (`lib/stats/funCopy.ts:246`), with copy that says the number came from
   *before* the game.
9. **Admin only** (`admin/(dashboard)/page.tsx:213,235`): every split with rank, gap and explanation. **This is
   the most convincing anti-rigging artefact in the product, and players never see it.**
10. Footer and rail "How this works" (`lib/shellCopy.ts:24`): "three splits … the fairest … Nothing is picked at
    random."

**What is missing or weak:**
- **No visual for the win chance.** Everything is prose. A player scanning on a phone gets no 54/46 bar,
  and the number sits mid-sentence on line 1-3 of a wrapped paragraph, below both cards.
- **The sum and the percentage can disagree on their face.** `blueWinProb` comes from mu *and* sigma
  (`packages/core/src/balance/index.ts` `predictWin`), but only mu-derived ratings are shown. Two teams 30
  apart can read `Blue favored 56%` because blue has fewer unknowns. Nothing on the page says why, which
  is the exact moment someone says "rigged". The card sums are also sums of rounded seat ratings, while
  `gap` is the rounded raw gap, so they can be off by a few points from the `Gap N` in the sentence.
- **The alternatives aren't visible.** "Next best: swap X and Y, gap 170" is the only trace of splits 2
  and 3. Players can't see the three candidates side by side; admins can, in a plain list.
- **Sit-outs and fill protection are explained by one sentence, or deliberately not at all**
  (05-design.md "Fill protection has no surface"). If someone keeps getting support, the UI has no answer.
- **No calibration view.** Nowhere does it say "the favoured side won 58% of 40 games". That's the single
  strongest "not rigged" proof the stored data already supports (`splits.blue_win_prob` + `games.winning_side`).
- **Evenness disappears in `in_game`**, which is when most people open the link from Discord.
- **No methodology page.** "How this works" is four lines in a `<details>` and the rail. There's no
  page explaining OpenSkill, `ordinal`, off-role cost, the repeat-split penalty, or the duo lock.

## States coverage

- **`loading.tsx`: none.** Every page awaits several Supabase reads with `force-dynamic` and no Suspense.
  On a phone opening a WhatsApp link that's a blank tab until the slowest query lands. 05-design forbids
  skeletons, but a static shell (topbar + strip) streamed first would respect that rule.
- **`error.tsx` / `global-error.tsx`: none.** The rail, mystery, admins and lobby-start loaders degrade
  through `…OrNone`, but `loadTonight`, `loadBoard`, `loadStats`, `loadGamesHistory`, `loadVersus`,
  `loadFunFacts` and `loadPlayerBoard` throw into Next's unstyled default error page, with no Kustom chrome
  and no "try again".
- **`not-found.tsx`: none.** `notFound()` is called in 9 places (bad `?window=`, unknown group slug, unknown
  game or player) and all of them get Next's default 404 with no shell, no nav and no way back. `?window=foo`
  on the leaderboard is a 404 rather than falling back to the default window.
- **Realtime failure**: `TonightLive.tsx:213` logs and keeps the stale snapshot with no visible signal. The
  `live` pill stays lit even if the channel never subscribed.
- **Empty states: good.** About 40 in-component `length === 0` branches with written copy (`WINDOW_EMPTY`,
  `Nobody in the lobby yet.`, the fearless empty search, the no-season notice with `role="status"`).
- **Pending and refused states on the three amber controls: good** (M3.20 pattern: `aria-disabled`, a quiet
  class, a `role="alert"` sentence, a no-JS form fallback).

## Accessibility

Good:
- Contrast was measured, not guessed, and off-role uses an icon colour, a dotted underline, a dot and sr text.
  Sums, ranks and the live pill all have sr words. Zoom is not blocked. There's a 44px tap floor. Reduced
  motion is honoured everywhere.
- Landmarks: `<main>` per page, `nav aria-label`, `aside aria-label`, `aria-current` on tabs and pickers.

Problems:
- No skip link. Missing `<h1>` on tonight and the game page, the two most-shared URLs.
- "You" is signalled by colour only, and it collides with "just joined".
- A link nested in `<summary>` on leaderboard rows.
- `<select>`/`<input>` have no focus ring outside admin.
- Reroll and team swaps are not announced.
- **Doc and code have drifted on colour.** `docs/05-design.md`'s token table and contrast table describe
  `#0B0E14 / #94A0B2 / #4C9AFF / #FF6B63 / #FFB13C`, but `tokens.css:17-45` ships `#05070c / #7d8a9e /
  #4ea3ff / #ff6f68 / #ffc857` (Night) and a different Day set. Recomputed for what ships: Night `dim` on
  `raise` 4.93 (passes, barely), Day `red` on `raise` **4.38 (fails)**, Day `brand` on `raise` 4.50 (at the
  edge). The doc's measured table is stale.
- **Colourblind safety of blue and red:** acceptable, mostly because of text. Night blue `#4ea3ff` and red
  `#ff6f68` have almost the same luminance (0.350 vs 0.336). That's deliberate (neither side looks favoured),
  but it means the two are **indistinguishable in greyscale or achromatopsia**. Under protan/deutan, red
  shifts to olive-tan against blue, which is still separable by hue. What saves it: every team card says
  `BLUE`/`RED` in the display cut, the poster says `BLUE WINS`, and the tape names the side. Risky spots are
  anywhere a side is a bare 4px rule or a tint with no word, and any future win-prob bar. That bar must
  carry text labels, or a pattern on one side.

## Performance

- **Client surface is small and deliberate:** 14 `'use client'` files. The heavy one is the tonight tree.
  `TonightView` has no directive but is imported by `TonightLive`, so **the whole tonight page hydrates**:
  SeatRack, ResultPoster, NightTape, FearlessCard, TopOfBoard, HowThisWorks, and the role tap. It also
  ships `@supabase/supabase-js` with Realtime plus the full `lib/tonight/load.ts` loader to the browser,
  because it re-reads the snapshot client-side on every event (`TonightLive.tsx:204`).
- The Realtime channel listens to 7 tables (`TonightLive.tsx:35`); `lobby_members` and `splits` are not
  group-filtered, so every group's churn wakes every open tonight page, then a full re-read runs after
  120ms.
- Fonts: `next/font` self-hosted, `display: swap`, and the Archivo variable font with the `wdth` axis. That's
  one file, but a large one. Plex Mono adds 2 weights. Fine.
- Images: only the fearless icons (lazy, sized, third-party CDN, no preconnect). The rating chart is a server
  SVG. No `next/image` anywhere, and none is needed.
- CSS: about 5,200 lines of global CSS in 11 files, imported per route (`tonight.css` alone is 1,559 lines,
  `board.css` 636). `theme-gaming.css` overrides the base with `html:not([data-theme="current"])`
  selectors, which is a leftover from a retired third theme, so every rule pays a specificity tax. It also adds
  two `repeating-linear-gradient`s (a pitch grid) and two radial lamps on `.cn-shell`, which is a
  full-viewport repaint layer. That contradicts the doc's "one gradient" rule.
- No streaming or Suspense. TTFB equals the slowest of up to 5 parallel queries plus the sequential
  lobby-start read (`(group)/g/[slug]/page.tsx:98`).

## Styling system + shadcn migration cost

**Today:** hand-written global CSS, BEM-ish `cn-*` classes (`admin-*` in admin), with tokens as CSS custom
properties in `tokens.css` (9 colours per theme, derived tints via `color-mix`, a 4px spacing scale, a type
scale that steps up at 720px). Themes come from `[data-theme="night"|"day"]` on `<html>`, set before paint by
`lib/theme` `THEME_BOOTSTRAP`. **No Tailwind, no PostCSS config, no CSS Modules, no component library, no
`components.json`, no `cn()`/clsx** (class strings are built with ternaries and template literals). Shared
primitives are thin: `.cn-card`, `.cn-card-head`, `.cn-num`, `.cn-display`, `.cn-button`, `.cn-sr`, plus
admin's `ui.tsx` (PageHeader, Card, Status, Notices). Components are organised by feature folder
(`_tonight`, `_board`, `_leaderboard`, `_games`, `_stats`, `_fun`, `_versus`, `_mystery`, `_shell`, `_icons`,
`_og`), each paired with a CSS file at the app root. There's reuse at the row level (`parts.tsx`,
`RoleCell`, `RoleIcon`, `BoardRow` shared by the rail and the leaderboard), but **team cards exist twice**
(`TonightView.TeamCard` and `ResultPoster.ResultCard`), and so do lineup rows (`PlayerView`, `GamesView`,
`MatchSheet`), each with its own CSS.

**What a move to Tailwind v4 + shadcn/ui touches:**
- *Easy:* the tokens map almost one-to-one onto shadcn's variables (`bg→--background`,
  `surface→--card`, `raise→--muted/--secondary`, `line→--border`, `text→--foreground`,
  `dim→--muted-foreground`, `brand→--primary/--ring`), plus two custom ones (`--team-blue`, `--team-red`).
  `[data-theme]` maps onto shadcn's `.dark` class (or a custom variant). `next/font` variables carry over.
- *Medium:* all 11 CSS files (~5.2k lines) become utilities or component variants. `tonight.css` is the
  bulk, and its layout rules (leading-edge side rule that swaps `border-block-start`↔`border-inline-start` at
  720px, the rail grid, row grids with fixed columns) need care. Admin (789 lines plus tables and forms) is
  the cheapest win: shadcn Table, Input, Button, Card, AlertDialog (which also fixes the missing confirms),
  and Sonner is *not* allowed (05-design says no toasts).
- *Real cost:* **21 test files make 414 class-name assertions** (`toHaveClass`, `querySelector('.cn-…')`).
  Each component migration breaks its tests unless the tests move to roles and text first. Do that refactor
  before the restyle.
- *Design-rule conflicts to settle first:* shadcn defaults bring shadows, rings, `rounded-lg`, Radix popovers,
  toasts and skeletons. 05-design bans skeletons, toasts, glass and extra shadows, and wants no colour beyond
  team, state and brand. Either 2.0 rewrites those rules, or the shadcn theme gets stripped down hard.
  Radix Select or Dialog would also add client JS to pages that are server-only today.
- *Useful primitives:* Tabs/ToggleGroup for the window and queue pickers (keep them as links), Collapsible
  or Accordion for the `<details>` rows (fixes the nested-link problem if the name link moves out of the
  trigger), Tooltip/Popover for "why 54%?" sigma explanations, Progress or a custom bar for win chance,
  AlertDialog for destructive admin actions, Sheet for a phone nav drawer replacing the hidden-scroll tabs.

## What works and should be kept

- **Data and state machinery**: `lib/tonight/state.ts` (`tonightState`, `rollStage`), `lib/tonight/load.ts`,
  `TonightLive`'s coalesced Realtime re-read and nameless polling, and all `lib/*/copy.ts` copy modules
  (copy is centralised and tested, so a restyle doesn't touch words).
- **No-JS-first forms**: Roll, Reroll, Start a lobby, role tap and `/1v1` all post or GET as real forms and are
  enhanced with fetch. `aria-disabled` while in flight keeps focus in place. Keep this pattern in any
  component library.
- **URL-owned state**: window and queue pickers are links with `aria-current`, `?p=` focus on `/games`, and
  `/1v1?a&b`. These are deep-linkable, which matters for Discord sharing.
- **Accessibility details already done right**: sr words on sums, ranks, off-role and live; the icon is never
  shown without its word; reduced motion; the 44px floor; zoom allowed; the role-cell off-role marking.
- **Explanation verbatim from core**, one string on web, Discord and OG cards, so the surfaces can never
  disagree. Build the visual fairness layer *beside* it, from the same `blueWinProb` and `gap`, never
  re-derived differently.
- **Share cards** (`_og/Cards.tsx`, `og/**`) and per-page `generateMetadata` titles.
- **Floodlit's principles** (colour is a team, a state, or nothing; tabular mono for numbers; deltas not
  coloured by sign; equal-luminance sides) are good fairness design in themselves. Keep them, even if the
  surface changes.
