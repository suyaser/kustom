# Design: Kustom 2.0, "Floodlit Slate"

Owner: `designer`. Status: **canonical** from 2026-10-03 (Phase 3 of the 2.0 redesign). The user chose
**Direction C, "Floodlit Slate"**: 80% Broadcast (A) and 20% Scrim Night (B), brighter, more contrast
(`04-decisions.md`, 2026-10-03).

**Night is "1.0 night" since 2026-10-04** (the user's pick from `redesign/night-variants.md`, decision row
2026-10-04): C's slate Night read as bland, so Night went back to Floodlit 1.0's deep blue-black page, its two
corner lamps and its 48px pitch grid. The components, team colours, amber, type, spacing and Day are all C's.
Secondary text is held to AA, not C's 7:1 (3.2). 7.3 holds the values.

**This file is the single source of truth for the design system.** `redesign/design-system.md` is now a
pointer to it, and its section numbers are kept here unchanged so earlier references still land. The token
block the engineer copies into `apps/web/app/globals.css` (Tailwind v4 `@theme` + shadcn variables) is
**section 7.3**, and no other file defines a colour. The prototype `redesign/prototypes/direction-c/c.css` is
evidence, not a source: where it and this file differ, this file wins (the differences are listed in 7.6).

Inputs: `AUDIT.md`, `audit/notes/frontend.md`, `audit/notes/screens.md`, the Floodlit 1.0 doc (now
`docs/05-design-1.0.md`), `redesign/prototypes/direction-c/` and its screenshots `redesign/screens/c-*.png`.
Content and copy come from `redesign/STRATEGY.md`. Wherever this file shows words in `‹angle quotes›`, they
are placeholders. **Copy per STRATEGY.md.**

### What changed from Floodlit 1.0, and why

| 1.0 (Floodlit, 2026-09-09) | 2.0 (Floodlit Slate) | Why |
|---|---|---|
| Near-black page, hairline borders, muted text around 7:1 | C shipped a lighter **slate** page (`#1A1F29`). **Since 2026-10-04 Night is 1.0's deep blue-black again** (`#05070C` page, `#0C121A` card, 1.48:1 hairlines), with 1.0's two corner lamps and grid; muted text lifted to `#8B98AD` (≥ 5.4:1 everywhere) and every control edge on `--border-strong` (≥ 3:1) | The user first called the dark direction "too dark or hard to see" and got slate, then called slate "a little bland" and chose 1.0's background back, knowing the trade (3.2). What carries legibility now is AA text everywhere and 3:1 control edges, not a light page. |
| Side shown by hue; equal luminance | Equal luminance kept; side also shown by **word, glyph (◣/◥) and texture** (blue solid, red hatched) | The audit: sides could not be told apart in greyscale. Brightening one side would make it look favoured. |
| Team colours `#4ea3ff` / `#ff6f68` | Azure `#2E9BFF` / vermilion `#FF6B35` (Day `#1563CF` / `#B5390B`) | +28% protan, +25% deutan separation. |
| Amber `#E0A33E` meant live, you, off-role, winner, reroll and links | Amber `#FFCF66` means **live, you and the primary action** only | Six meanings made "you" and "just joined" identical. The new amber passes the separation-from-red constraints (3.4). |
| Archivo Expanded (`wdth` 118) display, Inter-family text | **Archivo condensed** (`wdth` 62, 900) for the headline and side names only; **Atkinson Hyperlegible Next** text; **Martian Mono** numbers | Names like `H4RDC0R33` need 0/O and 1/l/I distinct; the condensed cut gives the scoreboard voice without shouting every label. |
| Hairline-tinted team cards | **Solid colour-blocked team header** with ink text; seats stay on the card (3.3) | "Which side am I on" answers itself at arm's length. |
| One radius, scrolling phone tabs, toasts, skeletons | 8/6/4 radii, bottom tab bar, no toasts, static reserved frames (5.0, 5.9, 5.11) | Audit findings: tabs past the fold, a bright shimmer in a dark room. |
| 1.0's colour tables | **Void.** They were already stale against `tokens.css` (audit). | Section 7.3 is the only token source. |

### Where the 1.0 sections went

`docs/05-design-1.0.md` is the Floodlit 1.0 doc, moved unchanged. **Its Palette, Type, Space/shape, Themes,
`tokens.css` v2, and "Implementation notes" token block are void**: any colour, font or size in it is
superseded by this file. Its **surface specs and copy** (Discord embed field layouts, the daily game, fearless,
groups and invites, `/stats`, the player page, copy tables) still describe what ships, and stay in
force until a 2.0 milestone rewrites that surface. **Share cards** were rewritten in M14.25: 5.16 is their
spec, and the 1.0 "Share cards" section is void except for the frame geometry 5.16 cites. Code comments that cite "05-design.md" for one of those
surfaces now mean `05-design-1.0.md`. When the two disagree on anything visual, this file wins.
**Fearless** has its 2.0 spec in section 8, "Mode card and mode panel" (settled 2026-10-03; Fearless is the
first mode, there is no fearless page; the 1.0 fearless text stays in force until the task in 8.13 A lands).

### Tools used, and where

| Tool | What I used it for | What I kept |
|---|---|---|
| **ui-ux-pro-max** `--design-system "gaming esports stats scoreboard dark" --density 8` | A baseline to argue against | **Rejected.** It returned neon purple `#7C3AED` with a rose CTA on `#0F0F23`, Russo One / Chakra Petch, and "3D & Hyperrealism". That is the generic neon/purple gaming look the user banned. I wrote it down as the thing to avoid. |
| ui-ux-pro-max `--domain typography` ("condensed sports scoreboard", "geometric friendly bold sans") | Display-face candidates per direction | Barlow Condensed, Bebas Neue, Space Grotesk and Outfit came back. All are common defaults and were rejected; Archivo condensed won (section 4). |
| ui-ux-pro-max `--domain ux` ("skeleton loading", "color not only", "truncate text wrap names", "live badge count screen reader", "native select mobile", "bottom navigation") | Rules | Essential text truncation is Critical: wrap, never clamp. Colour is never the only signal. Async count changes go in one atomic `role="status"`, not a bare live number. Reserve space for async content (CLS). Fixed nav needs matching body padding. Chips that act are buttons with `aria-pressed`. |
| ui-ux-pro-max `--stack shadcn`, `--stack nextjs` | Stack rules | Semantic CSS variables exposed through `@theme inline`, a complete `:root` scheme plus an override scheme, and `loading.tsx` with Suspense streaming. Its advice to "use Sonner" and to prefer "Radix Select over native" is **overridden** in 5.0, with reasons. |
| **frontend-design** SKILL.md | Direction discipline | Ground choices in the subject: the side glyphs come from the map, the hatch from Discord's block characters, the type from players' names. Spend boldness in one place: the win-split bar is the memorable element and everything else is quiet. Its list of AI defaults is checked in 1.3. |
| Own scripts (Python, scratchpad) | WCAG contrast; Machado-2009 protan/deutan/tritan simulation at severity 1.0, measured in OKLab; greyscale luminance ratios | Every colour number in section 3. |

---

## 1. Principles

### 1.1 Carried over from Floodlit, unchanged

1. **Colour means a team, a state, or nothing.** Blue is side 100. Red is side 200. The accent is the light:
   live, you, and the one primary action. Destructive is a state, and it only appears in admin. There is no
   decorative colour.
2. **Deltas are not coloured by sign.** No green for gains, no red for losses. Red already means side 200.
   The sign and the weight carry it (5.3).
3. **Numbers are tabular mono.** Every rating, percentage, gap, count, duration and rank. Never proportional.
4. **Neither side looks favoured.** Blue and red stay matched in luminance (1.03:1 Night, 1.06:1 Day). The favoured side
   is never bolder, bigger, brighter or first by emphasis. Blue is on the left because the client lists it
   first, and for no other reason.
5. **One explanation string.** The sentence from `packages/core` is shown verbatim. The visual layer sits
   beside it, built from the stored numbers (`blue_win_prob`, `gap`, off-role count). It never parses the
   sentence and never re-derives a number differently.
6. **No champion art, crests, avatars or emoji.** The fearless 24px icon exception carries over as written in
   `docs/05-design-1.0.md` ("The fearless icon exception"). The second named exception is the landing
   page's example game (section 12, 2026-10-04): ten Data Dragon champion squares in one fixed picture, and
   nowhere else. Neither exception is a precedent for a third.

### 1.2 What changes, and why

| Floodlit rule | 2.0 rule | Why |
|---|---|---|
| Equal-luminance sides, and colour carries the side | **Equal luminance stays, but colour never carries the side alone.** Every side surface has the word `BLUE`/`RED` or the side glyph (◣ blue, ◥ red). Every filled side area also has a texture: blue solid, red hatched. | The audit found the sides can't be told apart in greyscale. Raising one side's brightness would make it look favoured. So the separation comes from shape and texture, and the hue is tuned for colour-vision deficiency (3.3). |
| Amber means live, you, off-role, the winner's ring, the reroll button and links | **The accent means three things: live, you, and the primary action.** Off-role becomes a word plus a dashed chip. Links are underlined foreground text. The focus ring is foreground, not accent. | Six meanings for one colour made "you" and "just joined" identical (audit: high). With fewer meanings, the accent is unambiguous. |
| No skeletons, no toasts, one gradient, one glow (Night now has two lamps and a grid, 7.1) | Rewritten in 5.0 as a shadcn keep/restyle/ban list, each with a reason. Route loading uses a **static shell**. | shadcn is adopted, so the bans have to name components, not vibes. |
| Role icon always with its word | Kept, with a narrow team-card layout so both fit at 375 (5.1) | The audit's #4 problem was names cut off. The fix is layout, not deleting the word. |
| Wide display cut at 800 (Archivo `wdth` 118) | **Archivo condensed** (`wdth` 62, wght 900), for the headline and side names only. Text and mono in section 4. | Scoreboard voice in the two places it belongs; every other label is sentence case in the text face. |
| Phone nav: horizontally scrolling tabs | Bottom tab bar on phones, top nav from 768 px (5.11) | Tabs were hidden past the fold ("D" for Daily). |
| `t-base` 17 px | Kept at 17 px. Inputs and selects are never under 16 px. | iOS zooms on a 14 px select (`/1v1`). |

### 1.3 Anti-defaults (the frontend-design checklist, applied)

- No cream and serif, no acid green on black, no purple gradient, no glass, no neon glow, no "3D".
- No tracked ALL-CAPS eyebrow above every heading. Upper case is allowed only for the side words and the
  display headline (a scoreboard), never for labels. Card titles are sentence case in the text face.
- No `01 / 02 / 03` markers unless the content is a sequence. The three candidate splits are ranked, so they
  can be numbered.
- No `→` appended to buttons. A button says its verb.
- No hover-lift cards, no fade-up on scroll, and no soft grey shadow under every card.
- Middle-dot meta strings (`94 games · 58W 36L`) are used only where they replace a table row on a phone. They
  are a choice here, not chrome.

---

## 2. Token architecture

Three layers. Components only ever read **component** or **semantic** tokens, never primitives and never hex.

```
primitive   raw values, named by what they are      --p-azure-400, --p-slate-1, --p-amber-400
   ↓
semantic    named by role (shadcn names + ours)     --background, --card, --team-blue, --live
   ↓
component   named by the part that uses them        --seat-min-h, --winbar-h, --tabbar-h, --radius-card
   ↓
Tailwind    @theme inline maps semantic → utilities  bg-card, text-team-blue, rounded-card
```

The theme is set by `data-theme="night" | "day"` on `<html>`, written before paint by the existing
`THEME_BOOTSTRAP`. **Night is `:root`** (dark first). Day overrides the semantic layer only. Primitives and
component tokens never change per theme. Both themes come from one primitive set.

**Every value lives in the one block in section 7.3.** Sections 2.1 to 2.4 explain the layers and roles; they
carry no hex of their own.

### 2.1 Primitives

Raw values, named by what they are: `--p-slate-*` (night neutrals), `--p-paper-*` (day neutrals),
`--p-azure-*` / `--p-vermilion-*` (teams), `--p-amber-*` (the light), `--p-rose-*` (destructive), `--p-ink`
(the dark text that sits on fills). Ramp steps: 0 = page, 1 = card, 2 = raised, 3 = border, 5 = strong
border, 7 = muted text, 9 = text. Values: 7.3.

### 2.2 Semantic (shadcn variables, plus ours)

| Variable | Night | Day | Role |
|---|---|---|---|
| `--background` | slate-0 | paper-0 | page |
| `--foreground` | slate-9 | paper-9 | body text, names, ratings |
| `--card` / `--card-foreground` | slate-1 / slate-9 | paper-1 / paper-9 | cards, rows, team seats |
| `--raised` | slate-2 | paper-2 | **ours.** Level 2: chips, the answer band, tape tiles, card headers that are not a side |
| `--popover` / `--popover-foreground` | `--card` | `--card` | the AlertDialog (popovers are banned, 5.0). It is `--card`, not `--raised`, because Day's destructive text on raised is 4.27 |
| `--primary` / `--primary-foreground` | amber-400 / ink | amber-800 / paper-1 | the one primary action per view (button fill and its label) |
| `--primary-text` | amber-400 | amber-800 | **ours.** The light as text or outline: the `How the bot decided` summary, the you-row outline, the nav indicator, links that are the view's action |
| `--primary-fill` / `--on-primary-fill` | amber-400 / ink | amber-400 / ink | **ours.** Small amber fills that keep their colour in Day: the `Live` tag, the `YOU` sticker. In Day they add a 1px `--primary-text` inset edge (amber on white is 1.46) |
| `--secondary` / `--secondary-foreground` | `--raised` / slate-9 | `--raised` / paper-9 | secondary buttons (edge `--border-strong`: the fill is only 1.09 off the card in Night, so the edge is what marks the button, 6.15) |
| `--muted` / `--muted-foreground` | `--raised` / slate-7 | `--raised` / paper-7 | labels, meta. **Never a player name or a rating.** |
| `--accent` / `--accent-foreground` | `--raised` / slate-9 | `--raised` / paper-9 | **shadcn's hover/pressed surface, kept neutral.** It is *not* our amber. Our amber is `--primary*`, `--live`, `--you` |
| `--destructive` | rose-400 | rose-700 | admin destructive actions, error text |
| `--border` | slate-3 | paper-3 | card borders, seat dividers, the hairline. **Decorative only**: every card has one (card vs page is 1.07 Night), but it never is the only edge of a control (6.15) |
| `--border-strong` | slate-5 | paper-5 | **ours.** The receipt frame, dashed "not yet" states (sit-out, open seats, settling, empty states), the tab-bar top edge, and **the edge of every outlined or filled-raised control** (secondary and outline buttons, toggle chips, window and segment pickers, the theme switch, lane tiles, disclosure boxes; 6.15) |
| `--input` | slate-5 | paper-5 | input, select and search borders (= `--border-strong` in both themes, ≥ 3:1, 3.2, 6.15) |
| `--ring` | slate-9 | paper-9 | **focus ring = foreground**, so it never looks like the you mark or a side |
| `--team-blue` / `--team-red` | azure-400 / vermilion-400 | azure-700 / vermilion-700 | side 100 / 200: fills, glyphs, 4px rules |
| `--on-team` | ink | paper-1 (white) | **ours.** The only colour that sits on a team fill |
| `--team-blue-tint` / `--team-red-tint` | 12% team over `--card` | same | a side wash behind a row (never behind side-coloured text, 3.3) |
| `--stripe` | ink at 16% | black at 20% | **ours.** The dark stripe of the red hatch |
| `--hatch` | `repeating-linear-gradient(135deg, var(--stripe) 0 4px, transparent 4px 9px)` | same | **ours.** Laid over every red fill |
| `--you-wash` | 9% amber over `--card` | 18% amber over `--card` | **ours.** The viewer's seat/row background |
| `--live` / `--you` | `var(--primary-text)` | same | aliases, so there is no fourth hue |
| `--page-light` | azure lamp 16% top-left + amber lamp 12% top-right + 48px grid at 4% | one amber-800 glow at 5% | **ours.** What `bg-page` paints over `--background` (7.1, 7.3) |
| `--scrim` | `rgb(0 0 0 / .64)` | `rgb(14 17 22 / .48)` | behind the AlertDialog |

Tints, wash and hatch are derived with `color-mix` against `--card` or laid over the fill, so they follow the
theme with no new hex. **Do not add hex outside 7.3.**

### 2.3 Component tokens

Named by the part that uses them, the same in both themes. Values (in 7.3): `--tap` 44, `--seat-min-h` 64,
`--row-min-h` 56, `--chip-h` 28, `--role-cell-w` 60, `--thead-h` 54, `--side-block-w` 46, `--winbar-h` 50
(≥1024: 60), `--winbar-h-compact` 40 (≥1024: 44), `--winbar-h-mini` 10, `--side-rule-w` 4, `--tabbar-h` 60,
`--topbar-h` 60, `--gutter` 16 (≥768: 24), `--card-pad` 16 (≥1024: 20), `--rail-w` 340, `--radius-card` 8,
`--radius-control` 6, `--radius-chip` 4.

### 2.4 Tailwind v4 mapping

The `@theme inline` block is part of 7.3, so the mapping and the values are one paste. Rules for it:
- No `dark:` variant: Night is the default token set, so components never branch on theme. `day:` exists
  (`@custom-variant day`) for rare art-direction fixes only.
- Spacing uses **Tailwind v4's default `--spacing: 0.25rem`** (a 4 px base). Use `p-3` (12), `gap-4` (16),
  `mt-6` (24), `mt-8` (32), `mt-12` (48). No custom spacing scale; the named gaps are component tokens.
- `--shadow-*: initial` wipes Tailwind's shadow scale; only `--shadow-overlay` exists (5.0).
- shadcn's components read `--radius-{sm,md,lg,xl}`; they are aliased to our three steps so stock code lands
  on ours.

### 2.5 Spacing rhythm

| Use | Value |
|---|---|
| inside a chip | 4 × 8 |
| between a row's lines (name / meta) | 2 |
| between seat rows | 0, divided by a 1px `--border` hairline |
| card padding | `--card-pad` (16 / 20 from 1024) |
| between cards in a stack | 16 (phone) / 20 (≥1024) |
| between page sections | 32 (phone) / 48 |
| page gutter | `--gutter` (16 / 24) |

### 2.6 Radius

Three steps, never one radius on everything (that is the SaaS-card tell): **card 8, control 6, chip 4**.
Controls include buttons, inputs, the candidate-split cards, tape tiles and the full win bar's outer ends
(6). Chips include stickers, side pills, the tape-tile side block and the mini bar's outer ends (4). The win
bar's inner split, hairlines and the 4px side rule are square. Focus outlines follow the element's radius.
Nothing is a pill (999) except the live dot and the tab-bar notification dot.

### 2.7 Type scale (phone → ≥1024 where it changes)

| Token | Phone | ≥1024 | Face | Use |
|---|---|---|---|---|
| `--fs-2xs` | 13 | 13 | mono / text 700; text 400 for region tags only | **floor.** Role words, tab-bar labels, settling chip, region tags on champion chips (8.15). Nothing that carries meaning goes smaller. |
| `--fs-xs` | 15 | 15 | text | row meta (`94 games · 58W 36L`), chip labels, `Your side`, captions under the bar |
| `--fs-sm` | 16 | 16 | text | secondary lines: the reason line, sit-out sentence, strip sub-line, footnotes, deltas |
| `--fs-base` | 17 | 17 | text | body, buttons, the `How the bot decided` summary. **Inputs and selects: 17 (≥16, no iOS zoom).** |
| `--fs-md` | 19 | 19 | text 700 / mono 600 | player names, seat ratings (mono 600 at `font-stretch` 82% for width), card titles (text 700). **There is no 18 step**: anything drawn at 18 in the prototypes is `md` |
| `--fs-lg` | 23 | 26 | text 700 | the verdict sentence (`Basically a coin flip.`), h2 on pages without a strip |
| `--fs-xl` | 32 | 32 | display | side names in the team header; the h1 of non-tonight pages (text face 700 there, 5.8) |
| `--fs-display` | 46 | 64 | display | the strip headline (`TEAMS ARE SET`, `6 OF 10 IN`) and the result headline (`RED WINS`) |

Mono runs inside a chip or key/value may set 1 to 2px smaller than the text beside them (Martian is wide;
`font-stretch: 78–88%` narrows it), never below 13. Weights: text 400 body, 700 names and emphasis; mono
500/600; display 900 (800 inside the bar and pills). No 300. `text-wrap: balance` on h1/h2, `text-wrap:
pretty` on paragraphs.

### 2.8 Elevation

Dark UIs get depth from lightness and edges, not blur.

| Level | Surface | Edge | Used by |
|---|---|---|---|
| 0 | `--background` | none | page |
| 1 | `--card` | 1px `--border` | cards, rows, strips |
| 2 | `--raised` | 1px `--border` | chips, the answer band, tape tiles, the strong-bordered receipt's inner chips |
| 3 | `--popover` (= `--card`) | 1px `--border-strong` + `--shadow-overlay`, over `--scrim` | AlertDialog only |

The top bar and the tab bar are level 1 (`--card`), with a `--border` bottom edge and a `--border-strong` top
edge respectively. There is no per-card edge treatment: no top highlight (A) and no offset "sticker" drop (B).
The texture lives in the hatch, the colour-blocked headers and the page light (Night's lamps and grid, 7.1).
In Night the levels are close (card 1.07 over page, raised 1.09 over card, 1.0's look): the hairline separates
cards, and a control never relies on the level change alone (6.15).

### 2.9 Motion

| Token | Value | Allowed for |
|---|---|---|
| `--dur-press` | 80ms | `scale(.98)` on press of a button or tab |
| `--dur-fast` | 140ms | colour and opacity changes, chip state |
| `--dur-base` | 200ms | disclosure open (height via `interpolate-size` / `::details-content`), team crossfade on reroll |
| `--dur-slow` | 280ms | AlertDialog in and out (fade + `scale(.97→1)`) |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | everything above |
| `live-pulse` | 2s opacity 1 → .35 → 1 | the live dot only. It stops in any state except live. |
| "just joined" wash | 1.2s, `--you`-free: `--muted` → transparent, once | a newly joined seat (5.1) |

Rules: nothing moves on its own except the live dot. Reroll and team changes **crossfade in place** (opacity
only, no slide), because a sliding name under a thumb is a mis-tap. There is no scroll-triggered animation,
no number counting up, and no confetti on a win.

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after { animation: none !important; transition-property: opacity !important;
                         transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```

Under reduced motion the live dot is solid and static. The word "Live" is still there, so nothing is lost.

---

## 3. Colour

### 3.1 Semantic roles, in one table

| Meaning | Token | Never used for |
|---|---|---|
| Side 100 | `--team-blue` (+ tint, solid texture, ◣) | links, info, "good", focus |
| Side 200 | `--team-red` (+ tint, hatch texture, ◥) | errors, losses, destructive, "bad" |
| Live / you / primary action | `--primary`, `--primary-text`, `--primary-fill` (`--live`, `--you` alias the text one) | decoration, headings, a winner, the favoured side, game state (`In play`), a receipt frame |
| Destructive / error | `--destructive` | anything on a page that shows team colours (3.5) |
| Read this | `--foreground` | |
| Label / meta | `--muted-foreground` | names, ratings |
| Focus | `--ring` (= foreground) | |

There is no success green, no info blue and no warning yellow. "Saved" is a sentence. A refusal is a sentence
with `role="alert"` in `--foreground`, led by the word ‹Couldn't›.

### 3.2 Contrast: neutrals and accent (measured, WCAG 2.1)

Script: `redesign/prototypes/night-variants/table.py` (C's formulas from `direction-c/contrast.py`; Night is
V1 "1.0 night", 2026-10-04). "Lamp peak" is the page colour at the brightest point of each lamp, the worst case
for anything set straight on the page.

| Pair | Night | Day | Target |
|---|---|---|---|
| card vs page / raised vs card | 1.07 / 1.09 | 1.18 | the border separates; every card has one |
| border vs card / vs page | 1.48 / 1.59 | 2.12 | decorative hairline only, never a control's only edge (6.15) |
| border-strong vs card / page / raised / you-wash | 3.92 / 4.21 / 3.60 / 3.30 | 3.59 | ≥ 3: every control edge and state outline |
| input vs card / page | 3.92 / 4.21 (= border-strong) | 3.59 / 3.05 (= border-strong) | ≥ 3 in both themes (6.15, WCAG 1.4.11) |
| foreground on page / card / raised | 18.77 / 17.51 / 16.07 | 18.91 / 16.69 | ≥ 4.5 |
| **muted-foreground on page** | **6.90** | 7.38 | ≥ 4.5 |
| **muted-foreground on card** | **6.44** | 8.68 | ≥ 4.5 |
| **muted-foreground on raised** | **5.91** | 7.66 | ≥ 4.5 |
| **muted-foreground on the you-wash** | **5.41** | 8.08 | ≥ 4.5 |
| muted-foreground on lamp peak (azure / amber) | 5.71 / 5.62 | n/a | ≥ 4.5 |
| primary-text on card / raised | 12.86 / 11.81 | 7.13 / 6.29 | ≥ 4.5 |
| destructive on card / raised | 6.91 / 6.34 | | ≥ 4.5 |
| ink on primary-fill (`Live`, `YOU`, primary button) | 12.63 | 12.63 | ≥ 4.5 |
| Day primary button: white on amber-800 | n/a | 7.13 | ≥ 4.5 |
| ring vs card | 17.51 | 18.91 | ≥ 3 |

**Rule amended 2026-10-04: all text is at least AA (4.5:1 body, 3:1 large), on every surface it sits on, the
you-row and the lamp peaks included.** C held secondary text to 7:1 because the user had called the dark
direction "too dark or hard to see". On 2026-10-04 the user called the brighter slate "bland" and chose
Floodlit 1.0's deep blue-black back, side by side with a variant that kept 7:1 (`redesign/night-variants.md`,
V2). That was a knowing choice of the darker look, so the bar is AA, held with margin. 1.0's own dim
`#7D8A9E` measured 4.51 on the you-wash, so `--p-slate-7` is `#8B98AD`, which gives at least 5.41 everywhere at
1.0's hue. It still reads as secondary (2.72:1 below the foreground). Day keeps its numbers (all ≥ 7).

**The hairline is decorative.** `--border` at 1.48 is the 1.0 look: card edges and dividers. WCAG 1.4.11 needs
3:1 only where the edge is what identifies a control, and those use `--border-strong` / `--input` (6.15).

### 3.3 Team colours, with the numbers

**Chosen pair.** Azure and vermilion, matched in luminance and pushed apart in hue along the axis that
colour-vision deficiency keeps.

| | Night | Day |
|---|---|---|
| Blue (side 100) | **`#2E9BFF`** `oklch(.679 .176 250.9)` | **`#1563CF`** `oklch(.520 .182 258.6)` |
| Red (side 200) | **`#FF6B35`** `oklch(.705 .193 39.2)` | **`#B5390B`** `oklch(.522 .168 37.3)` |
| Text on a fill (`--on-team`) | ink `#10141B`: **6.37** on blue, **6.51** on red | white: **5.65** on blue, **5.91** on red |
| Text on the darkest red-hatch stripe | ink **4.89** (stripe ink 16%) | white **8.08** (stripe black 20%) |
| As text on page / card / raised | blue 6.96 / 6.49 / 5.96; red 7.11 / 6.63 / 6.09 (lamp peak, worst: 5.66) | blue 4.80 / 5.65 / 4.99; red 5.02 / 5.91 / 5.21 |
| As text on its own 12% tint | 5.57 / 5.75 (Night passes since V1; the rule below stays, for Day and one rule in both themes) | |
| Luminance ratio blue:red | **1.03** | **1.06** |
| CVD ΔE (OKLab ×100) protan / deutan / tritan | 27.3 / 31.4 / 33.8 | 28.1 / 29.4 / 30.3 |
| Discord int | blue `3054591`, red `16739125` | n/a |

**Fairness and greyscale.** Luminance stays matched (≤ 1.10, so neither side reads brighter, i.e.
favoured), and greyscale separation comes from shape and texture, not lightness. In greyscale,
achromatopsia, a bad projector or forced colours, the side comes from four redundant carriers, at least one
of which is on every side surface:

1. **The word**: `BLUE` / `RED` (team header, side pill, bar segment, tape tile, result headline, history rows).
2. **The glyph**: ◣ for blue and ◥ for red, from where each base sits on the map. An inline SVG (not a font
   glyph, not an emoji), `fill: currentColor`, `aria-hidden` beside the word. 13px inline, 18px in a header.
3. **The texture**: blue fills are solid; red fills carry `--hatch` (45°, a 4px `--stripe` every 9px). The
   stripe is a dark overlay, not a second red, so text set on the fill stays legible on every stripe (4.89
   Night, 8.08 Day). The stripe itself is low-contrast against red (1.33 Night, 1.29 Day): visible, but it is
   carrier 3, and it never ships without carrier 1 or 2 on the same fill. (The draft's 2.88:1 two-red stripe
   was dropped because ink labels on its dark stripe failed.)
4. **Position**: blue left or first, red right or second, always. It never counts as a carrier on its own.

**Rule resolved: the solid colour-blocked team header.** Floodlit 1.0 and the 2.0 draft said "never a solid
block behind five names". C puts a solid side fill behind the side name. The rule is now:

> **A solid team fill is a label, never a container.** It is allowed on exactly four things: the team-card
> header band, the side pill (`◥ RED` in the answer line), the win-bar segments, and the tape-tile side
> block. On a fill, only these may sit: the side word, the glyph, the win %, and the `Your side` tag. All of
> it is `--on-team`, never `--foreground`, never a side colour, never amber. Display-face words on a fill are
> ≥ 15px at 800–900. The red fill always carries `--hatch`. **Player names, ratings, chips and rows never sit
> on a fill**: the seats under the header are `--card`, the fill stops at the header's bottom edge, and no
> card, row or page section is ever filled with a side colour.

Why it holds: the old rule protected two things, legibility of names and "neither side looks favoured". Names
never touch the fill, and both headers are the same size, weight and fill area at matched luminance, so
neither is louder. The header's 46px leading block (`--side-block-w`) is the glyph's place: blue darkens the
fill with 14% black, red uses a denser hatch (28% black stripe) behind the glyph only, never behind text.

Rules that come from this:
- A side colour is a fill under the four-label rule above, a glyph, a 4px rule, a 12% tint, or text.
- **As text**, a side colour sits on `--card` or `--background` only. Never on `--raised` and never on its
  own tint (both failed in C's slate Night and stay banned so the rule is one rule in both themes). On a tint,
  the word is `--foreground` and the side colour is the glyph or rule.
- **Any win-split bar carries text labels on both ends** (`◣ BLUE 49%` … `51% RED ◥`) and the hatch on red.
  A bar without labels does not ship.
- A side named only by its rule must have the word or the glyph within the same card.

### 3.4 Accent: amber `#FFCF66`

The accent sits beside vermilion all the time, and under deuteranopia both drift towards yellow. It must meet
all of these. C went one step lighter than the draft reference `#FFC857`, for margin on both tight limits.

| Constraint | **`#FFCF66`** | ref `#FFC857` | A's `#FFB224` (rejected) |
|---|---|---|---|
| luminance ratio vs `--team-red` ≥ **1.8** | **1.94** | 1.84 | 1.57 fails |
| deutan ΔE vs red ≥ **15** | **16.5** | 15.2 | 11.2 fails |
| protan / tritan ΔE vs red ≥ 15 | **23.7 / 23.9** | 21.9 / 22.0 | 16.7 / 16.1 |
| text contrast on `--card` ≥ 4.5 | **9.46** | | |
| ink on it | **12.63** | | |
| hue not within 25° of either team hue; no purple; no acid green | **85°** | 83° | 76° |

Day: amber as text or outline is `#7A4F00` (7.13 on white, 6.06 on the Day page). Amber fills (`Live`,
`YOU`) keep `#FFCF66` in Day with ink text and a 1px `#7A4F00` inset edge, because the fill is 1.46 against
white. The amber never marks anything alone: you has `YOU`, live has `Live`, the action has its verb.
Discord int: `16764774`.

**Rule resolved: `In play`.** The prototype's in-game `In play` chip used the amber, stretching "live, you,
action". Game state is not connection state: `In play` (and any in-game status word) is a `--raised` chip
with `--foreground` text and a `--border` edge. Amber in the in-game screen is only the connection `Live` tag
and the you-row.

### 3.5 Destructive

`#FF6B8A` Night (5.08 on the card; 4.27 on raised, so error text never sits on `--raised`) and `#B4123C`
Day (6.79 on white). It is
**unavoidably confusable with team red** under CVD (deutan ΔE 8.8, tritan 3.1), so:
- it appears only in admin and in the AlertDialog, never on a surface that shows team colours
- a destructive control always has a verb label ("Revoke token") and a warning icon. Colour is the third
  signal.

### 3.6 Live and state colours

There is no new hue. States are the accent, the muted foreground and shape (5.4):

| State | Dot | Word colour |
|---|---|---|
| connecting | hollow ring, `--muted-foreground`, on a `--raised` tag | muted |
| live | a `--primary-fill` tag; the dot is `--on-primary-fill`, pulsing | `--on-primary-fill` (ink), text face 700 |
| stale / offline | hollow ring with a 45° slash, `--muted-foreground`, on a `--raised` tag | muted |
| in game | the live tag (if connected) beside the headline `IN GAME 14 MIN` | the headline carries the game state |

### 3.7 Rating up and down

Not coloured (Principle 2). Detail in 5.3: a gain is `--foreground` at 600, a loss is `--muted-foreground` at
400, and both are always signed with a real minus (U+2212).

### 3.8 How the tokens support Day (and any later theme)

- Only the semantic layer changes. Components have no `day:` classes, except for rare art-direction fixes.
- Every derived colour (tint, wash) is `color-mix` against `--card`, and the hatch is an overlay, so they
  re-derive per theme.
- One neutral ramp for Night (`slate`, holding 1.0's deep blue-black since 2026-10-04), one for Day
  (`paper`), a Day amber for text (`#7A4F00`), and `--on-team` flips from ink to white. Everything is in 7.3.
- `color-scheme: dark` / `light` per theme so native controls match. `<meta name="theme-color">`: Night
  `#05070C`, Day `#E8EEF6` (`lib/theme.ts`).
- Day is measured (3.2, 3.3). Re-run the script before changing any neutral.

---

## 4. Typography

Three roles, all Google Fonts, self-hosted through `next/font/google`, under the OFL.

| Role | Face | Why this one, for this product | Fallback |
|---|---|---|---|
| **Text**: names, sentences, labels, buttons, nav | **Atkinson Hyperlegible Next** (variable, wght 200–800; use 400/600/700) | The content is player names: `H4RDC0R33`, `MANOOOOOOOO`, `PRT Shou3man`, `1sec Reloading`, `Used2BeATahmMain`. Zero vs O and 1 vs l vs I decide whose name it is. Atkinson was drawn by the Braille Institute for exactly that distinction (distinct `0`/`O`, `1`/`l`/`I`, open apertures). It also reads well at arm's length in a dark room, and it is not Inter, Geist or Space Grotesk. Verified in the C prototype at 19/700, 375 px. | `'Atkinson Fallback'` (a metric-matched local Arial, below), then `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` |
| **Mono**: every number, role words, lobby password, durations | **Martian Mono** (variable, wght 100–800, **wdth 75–112.5**; use 500/600) | Wide, squared figures that read like a scoreboard, with a real minus and tabular digits by construction. The **width axis** runs it narrower (`font-stretch` 78–88%) beside the condensed display. Load with `axes: ['wdth']`. Known limit: it narrows less than hoped, so `support` fills the 60px role cell; the cell is 60, not 56. | `ui-monospace, 'SF Mono', Menlo, Consolas, monospace` |
| **Display**: the strip headline (with its numbers), the result headline, the side names | **Archivo**, condensed: `font-stretch: 62%` (wdth axis 62–125), wght **900**; inside the win bar, side pills and tape tiles `font-stretch` 70%, wght 800–900. Upper case. Tracking by size, as shipped: the strip and result headlines (`--fs-display`) **−0.01em**; page titles and team-card side names (`--fs-xl`) 0.02em; side pills, win-bar labels, tape tiles and chips (`--fs-sm`) 0.04em. | The broadcast lower-third voice of A, from a family with a real width axis, so one file gives the tall headline and the slightly wider bar labels. It continues Floodlit's Archivo (1.0 used the expanded end; 2.0 uses the condensed end). Not Bebas Neue or Barlow Condensed (defaults). **Only** for the headline and side names: card titles, stickers, the `Live` tag, chip labels and nav are the text face. The KUSTOM wordmark is a logo and also uses it. | `'Arial Narrow', system-ui, sans-serif` (with `adjustFontFallback`) |

Rules:
- **Number or role → mono. Person or sentence → text.** `font-variant-numeric: tabular-nums` on every numeric
  run, including numbers inside a sentence ("Red was 46%"), so they don't jiggle when realtime updates.
- Role words stay lower case in mono (`top`, `adc`), tracked 0.04em.
- **Meta lines split per token** (ruled 2026-10-03): in `94 games · 58W 36L · W5` the numbers are mono and the
  words, the `W`/`L` letters and the separators are the text face. Only role words are mono letters.
- Side words (`BLUE`, `RED`) and the strip and result headlines are upper case in the display face. The only
  other upper case is the `YOU` and `MVP` stickers (text face 700, they are badges) and the wordmark.
- No faux bold or italic. Load the weights used: text 400/700, mono 500/600, display 800/900 (one variable
  file with the `wdth` axis).
- `display: 'swap'`, and a size-matched fallback so the swap does not shift the team card. Martian Mono and
  Archivo use next/font's `adjustFontFallback` (on by default). **Atkinson Hyperlegible Next cannot**: Next
  ships no metrics for it ("Failed to find font override values"), so it sets `adjustFontFallback: false`
  and the app declares its own fallback face in `globals.css` (7.3), measured from the Google Fonts file
  (wght 400, latin) against Arial with next/font's own method (letter-frequency average width; the
  overrides are the face's hhea ascent 984 / descent 316 / gap 0 per 1000 upm, divided by size-adjust):

  ```css
  @font-face {
    font-family: "Atkinson Fallback";
    src: local("Arial"), local("ArialMT");
    size-adjust: 100.07%;
    ascent-override: 98.33%;
    descent-override: 31.58%;
    line-gap-override: 0%;
  }
  ```

  It sits between `var(--font-atkinson)` and `system-ui` in `--font-text`. Arial exists on Windows, macOS and
  iOS; Android has no file named Arial, so `local()` misses and Android falls through to an unmatched
  `system-ui` (Roboto), which is the accepted residue. Do not add a Roboto face with guessed numbers.

The block below is the M14.25 setup, **superseded by 4.1** (self-hosted, axis-trimmed, split files). Kept so
the diff is readable; build from 4.1.

```ts
// app/fonts.ts
import { Archivo, Atkinson_Hyperlegible_Next, Martian_Mono } from 'next/font/google';
export const text = Atkinson_Hyperlegible_Next({ subsets: ['latin', 'latin-ext'], variable: '--font-atkinson', display: 'swap', adjustFontFallback: false });
export const mono = Martian_Mono({ subsets: ['latin'], axes: ['wdth'], variable: '--font-martian', display: 'swap' });
export const display = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' });
// <html className={`${text.variable} ${mono.variable} ${display.variable}`}>
```

All three faces stay preloaded on every page (every page draws all three above the fold: the strip headline
or a page title, names, numbers), but since 4.1 only each face's small **core** file is preloaded. No other webfont is loaded; IBM Plex Mono and the 1.0
Archivo instances are gone with the 1.0 stylesheets (M14.25). The share cards carry their own static
TTFs (5.16).

`latin-ext` on text matters: real names include `Ramzyinhović` and `Menaçe`. If a `next/font` export name
differs, check the generated list; the families are on Google Fonts.

The scale is in 2.7.

### 4.1 Font loading for the LCP budget (amendment, 2026-10-04, M19)

The owner's budget: LCP < 2.5 s, TTFB < 800 ms, INP < 200 ms (Lighthouse mobile, 375 px, simulated slow 4G +
4x CPU). Measured on `next start` before this amendment: marketing pages LCP 3.2–3.4 s, group pages ~3.6 s, and
about 60% of that was the four preloaded webfonts, **182 KB** on the critical path.

**What the 182 KB actually is** (read from the built `.next/static/media` files with fontTools; the M19.18 note
had the first two swapped):

| Preloaded file | Size | Axes shipped | Axes the app draws |
|---|---|---|---|
| Archivo, latin | 90.1 KB | wght 100–900 × wdth 62–125, 302 glyphs | wght 800–900, wdth 62–70, upper case only |
| Martian Mono, latin | 38.4 KB | wght 100–800 × wdth 75–112.5 | wght 400–700, wdth 75–100 |
| Atkinson Hyperlegible Next, latin | 34.0 KB | wght 200–800 | wght 400–700 |
| Atkinson Hyperlegible Next, latin-ext | 19.1 KB | wght 200–800 | wght 400–700, and only when a name has `ć` |

Almost all of it is axis range the design never asks for. So the fix is the file, not the preload list.

#### The decision

**Option (c), done thoroughly; (a) falls out of it; (b) is rejected.**

1. **Self-host trimmed variable files**, one per face, cut to the axis ranges in the table's last column.
   They stay variable inside those ranges, so every weight and `font-stretch` value in the app keeps
   rendering exactly as today (no visual diff, no snapping).
   - text: Atkinson Hyperlegible Next, wght **400–700**.
   - mono: Martian Mono, wght **400–700**, wdth **75–100**. Wider than the 500/600 rule on purpose: today
     some mono runs inherit 400 (body) or 700 (`.num font-bold`, 5 places), and the 400–700 file costs
     only 1.3 KB more than 500–600 while making the cut a zero-diff change. Mono at 100% is real: `.num`
     with no `font-stretch-*` utility renders at 100%. Nothing draws mono above 100%.
   - display: Archivo, wght **800–900**, wdth **62–70**.
2. **Split each face into a preloaded core file and a lazy rest file by `unicode-range`**, the way Google
   splits latin and latin-ext, but drawn around our content:
   - text core and mono core: printable ASCII plus `U+00A0 U+00B7 U+00D7 U+2013 U+2014 U+2019 U+201C U+201D
     U+2022 U+2026 U+2191 U+2193 U+2212` (nbsp, the `·` separator, `×`, dashes, quotes, bullet,
     ellipsis, arrows, real minus).
   - display core: the same minus `a–z` (`U+0061–007A`). The display face is upper case only (4: "Upper
     case"), and the browser matches `unicode-range` against the text after `text-transform`, so a
     headline never requests a lower-case glyph.
   - each rest file: everything else in the face's Google latin + latin-ext coverage (Latin-1 letters,
     Latin Extended-A/B, the remaining punctuation; display rest also carries `a–z`).
   A rest file is fetched only when a glyph in its range is on screen: a name like `Menaçe` or
   `Ramzyinhović` pulls text rest (small, about 20 KB, measured as a guide, not a budget), and that one
   glyph swaps in late. That is option (a)'s trade, accepted for the same reason, without (a)'s cost of
   still shipping the full axis range.
3. **Preload the three core files on every page, from the root layout.** Not route-scoped (option b): with
   the cut, Martian core is 16.6 KB, about 80 ms at simulated slow 4G, and the heavy file that (b) left in
   place on every page was Archivo, not Martian. (b) would move the font variables out of the root layout
   and make every page know whether it draws a number above the fold, for 80 ms. No.
4. `font-display: swap` stays. `optional` was considered for the display face and rejected: on a first visit
   over a slow phone connection the headline would stay in Arial for the whole session.

#### Critical-path bytes and expected LCP

Measured on the cut files (fontTools instancer + subsetter, woff2, from the Google files Next fetched):

| Core file (preloaded) | Bytes |
|---|---|
| text core, Atkinson 400–700, ASCII + punctuation | 12.5 KB |
| mono core, Martian 400–700 × 75–100, ASCII + punctuation | 16.6 KB |
| display core, Archivo 800–900 × 62–70, upper case + digits + punctuation | 11.4 KB |
| **Total on the critical path** | **40.5 KB** (was 182 KB, −141 KB, −78%) |

Expected LCP, same Lighthouse configuration (slow 4G is about 200 KB/s in the simulation, so 141 KB is
about 0.7 s of contended transfer during the first second; the measured no-preload run took 0.4–0.6 s off
`/download` while costing FCP, which this keeps):

| Page type | Before | Expected | Budget |
|---|---|---|---|
| Marketing (`/`, `/about`, `/download`) | 3.2–3.4 s | **2.4–2.6 s** | met or within 0.1 s |
| Group pages (`/g/[slug]`, tonight, stats) | ~3.6 s | **2.9–3.1 s** | not met by fonts alone |
| FCP, every page | 0.8 s | 0.8 s or better | |

After this, fonts are about 0.2 s of LCP and there is nothing left to cut there; the group pages' remaining
gap is framework JS and data, and belongs to the engineering lanes, not to typography.

#### CLS: fallback faces matched to how the app draws, not to the font's default

The swap must not move the team card or rewrap a headline: **CLS ≤ 0.01**. next/font's automatic fallback
measures the font at its *default* instance (Martian's default is wdth 112.5, Archivo's wdth 100), but the
app draws Martian at 75–88% and the headline at 62%, so the automatic Arial fallback is much wider than the
real text. A wide fallback headline wraps to two lines and unwraps on swap; that is the most likely source of
the 0.247 on `/about` when preloads were removed. So all three faces get a hand-declared fallback, measured at
the instance the app actually draws, with next/font's method (overrides are hhea ascent / descent / gap per
upm, divided by size-adjust):

```css
/* text: unchanged from section 4 (measured at wght 400 against Arial, lower-case letter frequency) */
@font-face {
  font-family: "Atkinson Fallback";
  src: local("Arial"), local("ArialMT");
  size-adjust: 100.07%;
  ascent-override: 98.33%;
  descent-override: 31.58%;
  line-gap-override: 0%;
}

/* mono: matched on digits, which is most of what mono draws. Martian is monospaced, so every glyph at
   wght 500, wdth 85 (the commonest stretch in the app, font-stretch-85%) is 0.640 em; Arial's digits are
   tabular at 0.556 em. hhea 1000 / -200 / 0 per 1000. Runs drawn at 75% or 100% are 9-12% off, and
   those sit in fixed-width cells (role cell, seat rating), so they cannot push layout. */
@font-face {
  font-family: "Martian Fallback";
  src: local("Arial"), local("ArialMT");
  size-adjust: 115.08%;
  ascent-override: 86.90%;
  descent-override: 17.38%;
  line-gap-override: 0%;
}

/* display: matched on upper case (the face is upper case only) at wght 900, wdth 62 (the headline),
   against Arial Bold's upper case, so the fallback headline wraps exactly where the real one does.
   hhea 878 / -210 / 0 per 1000. Bar labels and pills at 70% are about 11% narrower in fallback, inside
   fixed boxes. */
@font-face {
  font-family: "Archivo Fallback";
  src: local("Arial Bold"), local("Arial-BoldMT");
  font-weight: 800 900;
  size-adjust: 70.83%;
  ascent-override: 123.95%;
  descent-override: 29.65%;
  line-gap-override: 0%;
}
```

The stacks become:

```css
--font-text: var(--font-text-core), var(--font-text-rest), "Atkinson Fallback", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-mono: var(--font-mono-core), var(--font-mono-rest), "Martian Fallback", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
--font-display: var(--font-display-core), var(--font-display-rest), "Archivo Fallback", "Arial Narrow", system-ui, sans-serif;
```

Remaining CLS risks, accepted:
- **Android has no Arial**, so all three fallback faces miss and Android falls through to Roboto unmatched,
  as it already does for text (section 4). Do not add Roboto faces with guessed numbers; measure Roboto from
  its file first if Android CLS shows up in field data.
- **A rest-file glyph swapping late** (`ç`, `ć`) changes one glyph's width inside a name. Names truncate in
  fixed rows, so it moves nothing unless a name wraps; worst case a line, well under 0.01.
- **Kerning across the core/rest split** (an ASCII letter next to an accented one) is lost, exactly as it is
  today across Google's latin/latin-ext split. Not visible at these sizes.
- Atkinson's override values were re-derived from the variable file at wght 400 for this amendment and came
  out 99.36% / 99.04% / 31.80%, within 1% of the shipped values, which were measured from the Google Fonts
  static file. Keep the shipped values; they are what CLS was verified against.

#### Build notes for web-engineer

1. **Generator, run by hand, outputs committed.** `apps/web/scripts/font-subsets.py` (Python, like
   `og-metrics.py`; needs `fonttools` and `brotli`), wrapped as `pnpm --filter web font-subsets [--check]`.
   Input: the three variable TTFs from `github.com/google/fonts` at a pinned commit (`ofl/atkinsonhyperlegiblenext/`,
   `ofl/martianmono/`, `ofl/archivo/`), downloaded into a cache dir, never at build time. For each face:
   `fontTools.varLib.instancer.instantiateVariableFont` to the ranges in point 1 (keep the instancer's
   clamped defaults; do **not** move the default to wdth 85 or 62: that measured +8 KB on mono and +4 KB on
   display, and the fallback faces above already handle the drawn width), then reload the instanced font
   from bytes before subsetting (subsetting the in-memory instance throws on lazily loaded glyphs), then
   `fontTools.subset` with `layout_features=['*']`, `hinting=False`, `notdef_outline=True`, flavor `woff2`.
   Six files into `apps/web/app/fonts/` (`text-core.woff2`, `text-rest.woff2`, and so on) plus `OFL.txt`.
   `--check` regenerates in memory and fails on a byte difference. Add the command to CLAUDE.md and the
   milestone row.
2. **Loading: `next/font/local`, two calls per face** (core and rest), so the files stay hashed and immutable
   under `/_next/static/media` and the CSS-variable architecture of section 7.3 holds:
   `weight: '400 700'` (text, mono) or `'800 900'` (display); `declarations` carrying `font-stretch: 75% 100%`
   (mono) or `62% 70%` (display) and the file's `unicode-range`; `display: 'swap'`;
   `adjustFontFallback: false` (the faces above replace it); `preload: true` on the three core calls,
   `false` on the three rest calls. Variables `--font-text-core`, `--font-text-rest`, `--font-mono-core`,
   `--font-mono-rest`, `--font-display-core`, `--font-display-rest` on `<html>`, replacing
   `--font-atkinson`/`--font-martian`/`--font-archivo` (update 7.2's rename table and the 7.3 block in the
   same change). If `next/font/local` refuses `unicode-range` or `font-stretch` in `declarations`, fall back
   to plain `@font-face` rules in `globals.css` (`url()` imports so Next still hashes the files) and three
   `<link rel="preload" as="font" type="font/woff2" crossorigin>` in the root layout for the core files.
3. **Fallback faces and stacks** exactly as above, in the unlayered `:root` block in `globals.css` where
   `Atkinson Fallback` already lives.
4. **Do not touch** `app/_og/fonts/`: the share cards render server-side from static TTFs (5.16) and are
   not on any page's critical path.
5. **Acceptance**, same Lighthouse configuration on `next start`: font transfer before LCP ≤ 45 KB on every
   page; no `*-rest` request on `/`, `/about`, `/download`, or a group page whose names are ASCII; CLS ≤ 0.01
   on `/about` and `/g/customs`; FCP no worse than 0.8 s; and a side-by-side screenshot at 375 px with the
   font requests blocked in DevTools against the loaded page shows the strip headline, the team card and a
   leaderboard row on the same lines (no rewrap). Report LCP per page type against the table above.
6. Optional follow-up, not needed for the cut: the six places that draw mono at 400 or 700 can move to
   500/600 per the weight rule in 2.7. The file covers them either way.

#### As built (web-engineer, 2026-10-04)

Built as above from google/fonts `9710da1e` (sha256-pinned in the script), with these measured departures.
7.3's block is the source for the fallback faces.

- **Layout features: the browser-default set plus `tnum`, not `*`.** The repo files carry alternates no
  page asks for (aalt, case, frac/numr/dnom, sups/subs, ordn, onum, zero, cv01/02); with `*` the three
  cores came to 49.2 KB, over the 45 KB budget. Kept: calt ccmp clig curs kern liga locl mark mkmk rclt
  rlig rvrn tnum. Cores: text 11.8 KB, mono 14.6 KB, display 14.1 KB, **40.5 KB**; rests 17.6 / 23.4 /
  48.0 KB.
- **Core adds `U+00B1 U+2039 U+203A`** (`±0`, the mode card's `›`): without them an all-ASCII tonight page
  fetched text rest (and that late swap showed up as CLS 0.16 on `/g/customs` in one run).
- **Martian Fallback is Courier New, one face per `font-stretch` drawn** (75, 78, 82, 85, 88, 100), not
  Arial at one width. The Arial face matched on digits drew letters about 10% narrow: the leaderboard's
  `settling · n/10` chip fit on the meta line in fallback and wrapped once Martian arrived, so every
  settling row grew 23 px (the page 1.3k px taller after swap). Martian is monospaced and Courier New is
  too (0.600 em for every glyph), so letters and digits match together; Martian's advance is 0.600 em at
  wdth 75 plus 0.004 em per step. Android still falls through unmatched, as for the others.
- **Archivo Fallback has a second face at `font-stretch: 70%`** (size-adjust 78.74%, the 62% value scaled
  by Archivo's own upper-case widths at wght 900, 0.5446 / 0.4899 em). Re-measured the 62% face the same
  way and got 72.7% (letter-frequency weighted) against the 70.83% above; kept 70.83%, since the strip
  headline lands on the same line and width either way at 375 px.
- **`:where(.sr-only) { font-family: system-ui, sans-serif }` in the base layer.** Hidden text is still
  shaped: the team card heading's `Blue team` under the visible `BLUE` asked the display face for lower
  case and pulled display rest (48 KB) onto every tonight page with teams.
- **Not upper case only.** The display face also draws mixed-case page titles (player name on the player
  page, `Admin`, the You page pitch, join, new group, ops). Those pages fetch display rest (48 KB, not
  preloaded) for the lower case. A separate `a–z` file would be 6.4 KB; adding `a–z` to the core makes it
  19.5 KB and the critical path 45.9 KB. Open for the designer.

---

## 5. Components

### 5.0 shadcn: keep, restyle, ban

The old Floodlit bans, rewritten as component decisions. "Restyle" means the shadcn file is generated, then
edited to our tokens. The listed edits are required.

| Component | Decision | Why / required edits |
|---|---|---|
| **Button** | Restyle | Sizes: `default` h-11 (44), `sm` **removed** (no control under 44 on a public page), `icon` size-11. Variants: `default` = primary (one per view), `secondary`, `outline`, `ghost`, `link` (underlined foreground, 44px hit area via padding), `destructive` (admin only). Focus = 2px **outline** in `--ring` with 2px offset, replacing `ring-[3px] ring-ring/50`, because a box-shadow ring vanishes in forced-colours mode. Keep the `aria-disabled` pending pattern (`data-pending`), not `disabled`. |
| **Card** | Restyle | No `shadow-sm`. `rounded-card`, level 1 per 2.8. `CardTitle` is a real heading element (`h2`/`h3`), not a `div`. |
| **Badge** | Restyle as **Chip** | Static by default (`span`). If it acts, it becomes a `button` with `aria-pressed` and grows to 44. Variants: `neutral` (`--raised`), `you` (the `YOU` sticker, `--primary-fill`), `mvp` (sticker, `--foreground` fill with `--card` text, never amber), `in-play` (neutral, 3.4), `settling` (dashed outline), `off-role` (dashed outline), `side` (glyph + word). |
| **Separator** | Keep | |
| **Input, Label, Textarea** | Restyle | Text 17px (no iOS zoom), h-11, visible `<Label>` always (no placeholder-as-label), focus outline as Button, `aria-invalid` styling via the destructive border **plus** an error sentence under the field. |
| **Native `<select>`** | **Keep native; ban Radix Select** | The OS picker on iOS/Android is the best phone picker there is. It works without JS, so the `/1v1` GET form stays no-JS, and it adds no client bundle to server pages. Styled: h-11, 17px, `appearance: none` plus our chevron, focus outline. |
| **AlertDialog** | Keep (restyle) | Every destructive admin action (5.17). |
| **Dialog** | Restrict | AlertDialog's base, and the one **routed mode panel** (8.6: its own URL, full screen on phones, Esc and Back close it, focus trapped and returned, no nesting). No other content modals on public pages: a plain modal over a live page hides the thing that is changing, has no URL to share, and Back leaves the page instead of closing it. |
| **Table** | Keep for admin ≥768 | Below 768 it renders as stacked rows (5.16). |
| **Collapsible / Accordion** | **Ban; use native `<details>`** | Disclosures (fairness "How the bot decided", "How this works") work server-only and without JS, and are announced natively. Styled with `::details-content` and `interpolate-size` for the 200ms open, and an instant open where that's unsupported. |
| **Tabs / ToggleGroup** | Ban as state; borrow the look | The window and queue pickers stay **links** with `aria-current` (URL-owned state, deep-linkable). Style the links as a segmented control. Board and Stats windows: `This week · Last week · All time`; Games: `Tonight · This week · All` (M14.48 removed the month windows). |
| **Skeleton** | **Restyle as static "reserved frame"; ban fake text bars and `animate-pulse`** | See 5.9. Only used where the final size is known, to prevent layout shift. Never a shimmer and never a grey stand-in for a sentence. Reason: a moving grey block in a dark room is the brightest motion on the screen, and it promises content of a shape it may not have. |
| **Sonner / Toast** | **Ban** | Realtime already changes the thing you're looking at. A toast on a phone covers the bottom tab bar, times out before an arm's-length reader finishes, and isn't where the change happened. Results show **in place**: the button's label becomes ‹Copied› / ‹Saved› for 2s, with `role="status"`. |
| **Tooltip / HoverCard / Popover** | Ban | No hover on touch, and essential information must not hide behind it. Explanations go in `<details>` or inline text. |
| **Sheet / Drawer (vaul)** | Ban on public pages | Every destination is a tab (5.11); there is no More page or drawer. `/g/<slug>/more` 308s to `/you`. |
| **NavigationMenu, DropdownMenu, Menubar, ContextMenu** | Ban | Plain links. Admin row actions are visible buttons (5.16). |
| **Avatar** | Ban | No avatars (Principle 6). |
| **Progress** | Ban for the win split | A win chance isn't progress. The win-split bar is our own component (5.5). |
| **Chart (recharts)** | Ban | The rating chart stays a server SVG with `role="img"` and a `<title>`. |
| **Carousel, Command, Calendar, Slider, Resizable** | Ban until a brief names a need | |
| **Shadows** | Ban (`--shadow-*: initial`) except `--shadow-overlay` on the AlertDialog | Depth comes from level surfaces and edges (2.8). |
| **Radii** | shadcn's `--radius-{sm,md,lg,xl}` aliased to our three steps | 8 / 6 / 4 (2.6). |
| **Radix in server pages** | Avoid | AlertDialog lives in admin and in the Mode card's admin controls on Tonight (8.4.2). Public pages stay server components except the tonight live island and the mode panel's body (8.5). |

### 5.1 Team card

The page's first question is "am I in, and which side?". **No name is ever truncated.**

**Anatomy (phone, 375; see `redesign/screens/c-balanced-375.png`)**

```
┌──────┬────────────────────────────────────────┐
│░░◥░░░│ RED                        [Your side] │  header 54px: solid --team-red + --hatch; 46px block;
├──────┴────────────────────────────────────────┤  side name display --fs-xl, --on-team; tag --on-team outline
│  ▢     H4RDC0R33                         1531 │  seat ≥ 64px on --card
│  top                                          │
├───────────────────────────────────────────────┤
│  ⌇     Jinxed Lad Who                    2291 │
│ jungle Wanders                                │  ← name wraps to line 2; rating stays on line 1
├───────────────────────────────────────────────┤
│  ⟋     TheSHADOWREAPER                   1785 │
│  mid   [off-role]                             │  off-role: dashed chip under the name
├═══════════════════════════════════════════════┤
║  ⛉     Used2BeATahmMain                  1262 ║  viewer: --you-wash + 2px --you outline (inset)
║support [YOU] ┆settling · 9/10┆                ║  YOU sticker + settling chip
└═══════════════════════════════════════════════┘
```

Row grid: `grid-template-columns: var(--role-cell-w) minmax(0,1fr) auto; column-gap: 8px; align-items: start`.

| Part | Spec |
|---|---|
| Role cell (60px) | Role icon 22px (the existing `RoleIcon` paths) **stacked over** the role word in mono `--fs-2xs` (13px, `font-stretch` 75%). Icon `aria-hidden`; the word is the accessible text. Icon and word are `--muted-foreground`, never a side colour. The role cell is the same in game (no champion tile). |
| Name | Text face, `--fs-md` (19), 700, `--foreground`. **`overflow-wrap: anywhere; hyphens: none`**, no `line-clamp`, no `text-overflow`, no `nowrap`. Long names push the row taller, never sideways. |
| Under the name | Zero or more chips, wrapping: `YOU` sticker, `off-role`, `settling · n/10`, `new`. No champion line in any state (see the note under States). |
| Rating | Mono 18/600, right-aligned, top-aligned with the name's first line. A settling player still shows their number. |
| Header | **Solid side fill (3.3's four-label rule).** Blue: solid `--team-blue`. Red: `--team-red` + `--hatch`. A 46px leading block holds the 18px glyph (blue: 14% black; red: denser 28% hatch). Then the side name in the display face, `--fs-xl`, upper case, `--on-team`. On the viewer's team only, a `Your side` tag at the right: text face `--fs-xs` 700, `--on-team`, 1.5px `currentColor` border, `--radius-chip`. **No team totals or averages in the header** (STRATEGY section 4) and no win chance (it lives in the receipt only). |
| Card | `--card`, 1px `--border`, `--radius-card`, `overflow: hidden` so the fill takes the top corners. No separate leading rule: the header fill is the side mark. |

**States**

| State | Treatment |
|---|---|
| Viewer's own seat (**you**) | Four signals: the `YOU` sticker (word; `--primary-fill`, ink text, text face 700 `--fs-xs`, `--radius-chip`, a −2° tilt, no shadow; Day adds the 1px `--primary-text` inset edge), a 2px `--you` outline at `outline-offset: -2px` (shape; an outline, not a box-shadow, so forced colours keep it), the `--you-wash` background, and visually hidden ‹(you)› after the name. Muted text on the wash is 7.28 (3.2). The team header also says `Your side`. |
| **Just joined** (filling / seat rack) | Different shape and word from "you": a mono `--fs-xs` meta line ‹joined just now› in muted, plus a one-time 1.2s `--muted` background wash that fades to the card colour. **No accent and no outline.** It reverts to plain after 60s. Under reduced motion there is no wash, and the meta line remains. If the joiner *is* the viewer, "you" wins and the meta line still shows. |
| Off-role | A dashed `off-role` chip (word) under the name. The role word gets a dotted underline. sr: ‹playing off-role›. No accent. |
| Empty seat (filling) | Dashed `--border-strong` row, role cell present, name slot shows ‹open› in muted. Same height, so a join doesn't shift the page. |
| Reroll | Both cards crossfade (200ms opacity). A polite live region announces the change (6.4). |
| In game | Same seats as balanced. Hides role-pick controls. |
| Winner (result) | The winning card's header adds a `Won` tag (same style as `Your side`, `--on-team`), and the card gets a 2px `--foreground` outline. **Not** a glow and not a bigger fill. The loser's header keeps its fill; nobody is dimmed. |

**Not built: champions on seats.** The Direction C prototype (c-ingame-*) shows a champion tile and a
an `Ahri, mid` line per seat in game. 2.0 does not build it: there is no data source, because the companion
never reads champ select or the live game for this (M14's out-of-scope line; decision 2026-10-03).
The prototype is wrong on this point, not the build.

**Phone vs desktop.** Below 768 the cards stack, blue first. At 768 and up they sit side by side, blue left,
each `minmax(0,1fr)`. The name column is narrower here than on a phone (about 160px at 768). The wrap rule
handles it. Test at 768 with `TheSHADOWREAPER` in every seat.

**Accessibility.** Each card is a `<section aria-labelledby>` with an `h2` ("Blue team"/"Red team" in the
accessible name). Seats are an `<ol>` in lane order. Each `li` reads ‹top, Jinxed Lad Who Wanders, rating
1560›. **shadcn base:** Card (restyled) + Chip. No Radix.

### 5.2 Player row (leaderboard, history, partners)

> **M18 (Kustom rating):** section 11 amends this for Ratings, changes, week points and the explanation panel; where they disagree, 11 wins.

**The whole row is one link** to the player page (or the game page for history). There is no `<details>`
inside the row and no link nested in a toggle (audit, high). Expanded game lists move to the player page.

```
┌──────────────────────────────────────────────┐
│  1   Ramzyinhović                        2638 │  ≥ 56px, one <a>
│      94 games · 58W 36L · W5             +33  │  meta: --fs-xs muted; delta: 5.3, no arrow
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ 24   Used2BeATahmMain                    1322 │
│      1 game · 1W 0L  ┆settling · 1/10┆        │  (All time: under Still settling, unnumbered)
└──────────────────────────────────────────────┘
```

| Part | Spec |
|---|---|
| Rank | Mono `--fs-sm`, 3ch, muted. **The top 3 are not coloured gold** (colour means team/state/nothing). Rank 1 to 3 may set in the display face at `--fs-md`: emphasis by type, not hue. |
| Name | Same wrap rule as 5.1. |
| Meta | One line that wraps. `94 games · 58W 36L · W5`. **Numbers mono, words and letters text face** (ruled 2026-10-03): `94`, `58`, `36`, `5` in mono; `games`, `W`, `L` and the `·` separators in the text face, all `--fs-xs` muted. A mono `W` beside a mono number reads as one code (`58W`); split, it reads as a count and a word. The same rule holds for every meta line built from counts (history, partners, the player page). |
| Sections (the board) | **All time only:** the ranked list (10 or more rated games, numbered), then a `Still settling` section below it: same rows, **not numbered**, each with the `settling · n/10` chip (5.6), under STRATEGY §5's section line. **This week and Last week are one list** with no settling section (everyone is settling inside a short window; STRATEGY). The windows are `This week`, `Last week` and `All time`; the month windows were removed in M14.48 (2026-10-04). Players with no rated game in the window are counted under the list, never shown as rows. |
| Rating | **One public number** (audit #3). Mono `--fs-md` 600. Settling players show a number and the chip, **never 0**. |
| Delta | The window's change (5.3), under the rating. **No arrow or triangle beside it** (5.3 wins over any older mock: an arrow reads as a side glyph). |
| History variant | Leading cell: side glyph + `Won`/`Lost` word. Then the date, duration as ‹21 min› (not `21:46`), the odds in words (`Blue was 53%.`, 5.5 compact) and the viewer's delta. It links to `/g/<slug>/games/<id>`. |
| Viewer's row | `YOU` sticker + `--you-wash` + 2px `--you` outline, as in 5.1. |

States: default; `:hover` (≥768) `--accent` surface; `:active` press scale; `:focus-visible` outline on the
whole row. Desktop may lay the meta inline after the name, but it still wraps instead of truncating.
Accessibility: the link's accessible name is the visible content in order (rank, name, rating, delta). No
`aria-label` overriding it. Lists are `<ol>` for ranked boards and `<ul>` for history. **shadcn base:**
none (plain `<a>`), plus Chip.

### 5.3 Rating change

> **M18 (Kustom rating):** section 11 amends this for Ratings, changes, week points and the explanation panel; where they disagree, 11 wins.

| Case | Visual | Screen reader |
|---|---|---|
| gain | `+33`, mono, `--foreground`, 600 | ‹gained 33› |
| loss | `−38` (U+2212, not a hyphen), mono, `--muted-foreground`, 400 | ‹lost 38› |
| zero | `±0`, muted 400 | ‹no change› |
| not rated | the word ‹not rated›, `--fs-xs` muted | same |

- **Always signed. Never coloured.** No arrows or triangles: they would be read as the side glyphs.
- Paired with a rating it sits to the right or underneath, `--fs-sm`. In parentheses only inside dense tables.
- In a sentence the number still renders in mono at the surrounding size.
- Implemented as `<RatingDelta value={n} />`: the visible text is `aria-hidden`, with a `.sr-only` span.

### 5.4 Live status indicator

**It never says Live unless the realtime channel is `SUBSCRIBED`.** It has two dimensions: the connection
state and the game state. The game state shows when it's known; the connection shows whenever it isn't live.

```
[● Live]  Sat 3 Oct, game 4 tonight   amber fill tag, ink dot pulsing (static under reduced motion)
◌ Connecting…                     hollow ring, muted, no pulse
⊘ Offline · updated 4 min ago  [Refresh]     hollow ring + slash, muted; button 44px
● In game · 12 min                connected
⊘ In game · 12 min · offline  [Refresh]      game known from the last snapshot, channel down
```

| State | Enter when | Rules |
|---|---|---|
| connecting | page load, until `SUBSCRIBED`, max 8s | Shows on first paint (the server can't know). After 8s without a subscription, go to offline. |
| live | channel `SUBSCRIBED` and the last event or heartbeat < 60s ago | The only pulsing element in the product. |
| offline (stale) | `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`, or no heartbeat for 60s | "Updated N min ago" is computed from the last successful snapshot read. Refresh re-reads (or reloads without JS). It retries in the background, and returns to live by itself. |
| in game | lobby `in_game` | Elapsed time from `started_at`, ‹12 min›, updated once a minute. **Not** `mm:ss` (reads as a clock; audit #9) and no per-second re-render. Under 1 min: ‹just started›. |

Placement: the **start** of the status strip's top line, before the date (5.10), never in the top bar. The top
line is a fixed `--chip-h` tall and the date uses the short form (`Sat 3 Oct, game 4 tonight`), so the tag
appearing, changing state or leaving never re-wraps the line or moves the page (M14.45: CLS 0.066 to 0.003). On
phones the Tonight tab also carries an 8px amber dot while live. Anatomy: a tag at `--chip-h`,
`--radius-chip`; live is `--primary-fill` with `--on-primary-fill` dot and word (text face 700, 15px; Day adds
the 1px `--primary-text` edge); other states are `--raised` with muted text. The dot is SVG `currentColor`
(survives forced colours). The tag isn't interactive. Refresh is a separate Button.

Accessibility: one `role="status" aria-atomic="true"` element announces **connection changes only**
("Live", "Offline, last updated 4 minutes ago"). The timer is not in a live region. **shadcn base:** Chip +
Button.

### 5.5 Fairness receipt

> **M18 (Kustom rating):** section 11 amends this for Ratings, changes, week points and the explanation panel; where they disagree, 11 wins.

Owned here: the visual and interaction spec. The content is product's (STRATEGY.md); every string below is a
placeholder. This is the product's memorable element; spend the boldness here and keep everything around it
quiet.

**Data in:** `blue_win_prob`, `gap`, off-role count, the explanation string (verbatim), the three candidate
splits (rank, win prob, gap, off-role, the swap that distinguishes each), and the group calibration (favoured
side's wins / games). All from stored numeric columns.

#### Full (tonight balanced; the game page)

```
┌─ 1px --border-strong ───────────────────────────┐
│ Win chance                              Game 4  │  card title, text --fs-md 700, sentence case
│ ┌─────────────────────┐┊┌─────────────────────┐ │
│ │ ◣ BLUE 49%          │┊│░░░░░░░░░░ 51% RED ◥░│ │  bar 50px (≥1024: 60): labels INSIDE, --on-team,
│ └─────────────────────┘┊└─────────────────────┘ │  display 19/900 word + mono 20/700 %; 3px gap
│              The center line marks 50/50        │  2px --foreground tick crosses the bar ±6px; caption --fs-xs muted
│ Basically a coin flip.                          │  verdict --fs-lg 700
│ Next best: swap the bot lane players, …         │  reason --fs-sm muted, names --foreground 700
│ [Rating gap 45 pts] [Main roles 10/10]          │  chips: --raised, label --fs-xs muted, value mono --foreground
│ [Bot's pick #1 of 3]                            │
├─────────────────────────────────────────────────┤
│ How the bot decided                          ⌄  │  <details>, 52px summary, --primary-text 700
└─────────────────────────────────────────────────┘
```

| Part | Spec |
|---|---|
| Frame | The one card with a `--border-strong` edge. No amber edge or top rule (the accent is not decoration). |
| Win-split bar | Two segments sized to the probability, a 3px gap at the split. Blue solid `--team-blue`; red `--team-red` + `--hatch`. Outer ends `--radius-control`, inner ends square. A 2px `--foreground` 50% tick crosses the bar 6px above and below, so 49/51 visibly sits next to even. The labels sit **inside** the segments in `--on-team` (6.37 / 6.51 Night; 4.89 on the darkest stripe; the label is ≥ 19px bold, so even the large-text floor of 3 has margin). Segment widths are clamped so a label always fits: **37/63 below 768** (at 375, `◣ BLUE 7%` needs about 37% of the bar; ruled 2026-10-03 after M14.16's 7% case clipped to `BLUE 7`), **30/70 at ≥ 768**. Only the drawn width is clamped; the labels always print the real percentage. The bar element is `aria-hidden`; a visually hidden sentence before it carries ‹Blue 49 percent, Red 51 percent›. |
| Labels | Both ends, always: glyph + word + %. The favoured side's label is **not** bolder or larger. |
| Win chance | **The bar is the only win-chance number.** There is no `Win chance` chip (STRATEGY section 4). |
| Verdict + reason | Product's banded sentence and reason line, verbatim from STRATEGY.md. The reason's `<why-lower>` is one of three, in STRATEGY §4's order: `with <k> more off their main role`, `with a bigger rating gap (<g2> vs <g1> pts)`, or, when the stored columns don't say which, `and it scored a hair worse overall (repeated teams, recent fills or rounding)`. That last one replaced "ranked lower on role costs" (2026-10-03): the score includes more than role costs, and the numbers beside the old wording could contradict it. Set it at the reason's size and colour, no hedging style. The core explanation string stays verbatim inside the disclosure. |
| Chips | `Rating gap 45 pts`, `Main roles 10/10`, `Bot's pick #1 of 3` (and ‹Sat out› when someone did). Static `span`s, `--raised`, 1px `--border`, `--radius-chip`, min 34px tall. **Main roles on the live receipt (balanced, in game, the teams embed; M14.41)** counts only players who have a main role on record: `Main roles 6/6 · 4 new` (the count after `·` mono like the rest), `2 off main role · 4 new`, and with all ten new `No main roles yet`. On **Tonight's finished poster** the chip uses the same live count (so the page never contradicts the balanced receipt minutes earlier; lead ruling, M14.41); history (the game page, the games list, the result embed) prints the stored count unchanged. |
| Off-role line | The sentence under the reason that names who is off their main role (`Everyone's on their main role.`, `Omar is off their main role (support).`, `2 people are off their main role.`, `4 people have no main role yet.`, `Nobody has a main role yet.`; strings in `lib/receipt/copy.ts`). **It shows only when it adds to the chip** (M14.45): exactly one person off-role (the line names them and their lane; the chip only counts), the compact in-game receipt (no chips), or a laneless lobby (no roles chip). Beside a chip that already says it (`Main roles 10/10`, `2 off main role · 4 new`, `No main roles yet`) it is dropped: the page says a thing once. |
| Disclosure: "How the bot decided" | Native `<details>`. Content order per STRATEGY section 4: the 126-ways intro, the three candidate splits, the disagree explainer, "Nobody picked these teams", the bot's verbatim note (mono `--fs-xs` on `--background`), calibration. |
| Candidate splits, **≥768** | Three cards in a row (`--radius-control`, `--background` fill, 1px `--border`; the picked one 2px `--primary-text`): rank in mono, odds, a 10px mini bar with tick, a 2-column key/value grid (gap, main roles), the `<why-lower>` reason (wording as above) under a dashed rule. |
| Candidate splits, **<768** | **Rule resolved (receipt-open page length): one compact `<ol>`, not three stacked cards.** Each split is one list row, at most three lines: line 1 `#1 Picked` / `#2` / `#3` and the odds as text `Blue 49 · 51 Red`; line 2 mono meta `gap 45 pts · main roles 10/10`; line 3 the one-line `<why-lower>` reason (#2, #3 only). Rows are divided by `--border` hairlines; the picked row has a 3px `--primary-text` inline-start rule and the word `Picked` (word + shape, not colour alone). **No mini bars on phone rows**: the full bar above already draws the picked split, and the odds text carries #2 and #3. Calibration keeps its two bars. Acceptance: `receipt.html` at 375 drops from about 4,200px to **≤ 3,000px** total page height, with nothing removed. |
| Calibration | One line, numbers mono, plus observed vs expected bars (`--foreground` fill vs `--muted-foreground` fill on a `--raised` track). If n < 20: ‹Not enough games yet to check the bot's odds (n of 20)›, never a percentage over a handful of games. 20 is STRATEGY §4.8's threshold and the shipped `CALIBRATION_MIN_GAMES`; it is not the settling threshold (10, 5.6). |

#### Compact (in game, history rows, the tape)

In game, the receipt stays visible as `Odds at kickoff`: the same bar at `--winbar-h-compact` (40, ≥1024 44)
with labels inside at 17px, the verdict at 19px, no chips and no disclosure. History rows and tape tiles do
not draw a bar: they say it in words (`Blue was 53%. Red won.`), and the row links to the game page where the
full receipt lives.

**Games row (ruled 2026-10-03, M14.42 option (a)).** Where the row's title already is the result (`/games`:
`◥ Red won`), the words drop `<Winner> won.` and print only the odds: `Red was 51%.`, `Blue was 45%.` plus the
`Upset` chip when the underdog won, `50–50.` on an even split, nothing when the game has no stored odds. The
side is said once per row. Rows whose title does not name the winning side keep the full sentence: the tape
tile (`Game 3`, 5.15) and a player's recent games (`Lost`, viewer-relative) still read `Red was 51%. Red won.`

**Tonight's finished poster (M14.45)** uses the games-row form too, because the strip's h1 above it already
names the winner (`RED WINS`). Its verdict line under `The odds were` reads `Red was 51%.`, `Red was 46%. Upset!`
when the underdog won (said in the sentence, at the verdict's size; the poster has no Upset chip), or `50–50.`.
One line, never `Red was 46%. Red won. Upset!` across two.

#### Discord text (teams embed description)

> **M14.61 replaces this layout (section 10, "Discord posts").** Until it ships, this subsection is what the
> builders print; once it ships, section 10 wins and this text is history. The copy below carries over unless
> section 10 says otherwise.

As shipped in M14.10. Discord has no CSS and a proportional font, so the receipt is text in the embed's
**description**, not a field: five lines, in this order.

1. **Bar line:** `**Blue 49%** ▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱ **51% Red**`: the two labels bold at the ends, 20
   cells of 5% between them, `▰` for blue's share from the left (`round(p_blue × 20)`), `▱` for red's. No inline
   code (the cells are already even-width in Discord's font), no side colours (the embed colour is the accent),
   no emoji, no glyph.
2. **Banded sentence**, verbatim from the receipt copy (`Basically a coin flip.`, `Dead even.` …).
3. **Chips line:** `Rating gap 45 pts · Main roles 10/10 · Bot's pick #1 of 3` (plus `Sat out` when someone
   did), joined with ` · `.
4. **Reason line:** the same `Next best: …` sentence as the page, including the tie wording
   (`… and it scored a hair worse overall (repeated teams, recent fills or rounding).`).
5. **Core's sentence** as Discord subtext, `-# <splits.explanation>`, verbatim: small and grey, last, for the
   people who want the numbers.

There is **no `Win chance` field**: the fields are `Sitting out` (only when somebody sits; the value
starts at the name and carries the page's own reason sentence, 5.15), `Seats` (the move lines and the side
line, always), then `Blue` and `Red` inline with one line per seat and **no team totals** (STRATEGY §4.2
rule 4), then `Lobby` when the lobby has a name. The title links the tonight page's receipt disclosure (`/g/<slug>#how-the-bot-decided`) when there is a
URL, and only then does the footer promise more there. Role words are the client's (`adc`, not `bot`).

Teams embed, filled (game 4 of the prototype night):

```
color        16764774  (amber #FFCF66: neither side)
title        Teams are set                       (links /g/customs#how-the-bot-decided)
description  **Blue 49%** ▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱ **51% Red**
             Basically a coin flip.
             Rating gap 45 pts · Main roles 10/10 · Bot's pick #1 of 3
             Next best: swap the adc players, SugarPapy and PRT Khokha. That's Blue 53%, with a bigger rating gap (61 vs 45 pts).
             -# Red favored 51%. Everyone on a main role. Gap 45. Next best: swap SugarPapy and PRT Khokha, gap 61.
field        Sitting out       (block)
             Chaos sits this one out. They've gone longest without sitting out, and everyone's played 3 games tonight.
field        Seats             (block)
             You'll be moved to your side — if not, move yourself.
field        Blue              (inline)          field   Red               (inline)
             `top` FoxHound · 1224                       `top` H4RDC0R33 · 1531
             `jungle` XETA · 1378                        `jungle` Syndrome Axes · 2291
             `mid` Ramzyinhović · 2638                   `mid` knifiy · 1454
             `adc` SugarPapy · 1218                      `adc` PRT Khokha · 1287
             `support` Used2BeATahmMain · 1322           `support` TheSHADOWREAPER · 1262
field        Lobby             (block)
             `customs-night`
footer       Kustom · more on the tonight page
```

Result embed, filled (as shipped). The description is the odds line from the receipt copy, then the top
damage clause: `Red was 51%. Red won.` when the favourite won, `Red was 46%. Red won. Upset!` when it didn't,
`50–50. Red won.` on an even split, with `Top damage: <name>, <n>k.` after it. Seat lines are
`` `role` Name · rating (delta) ``, lane order, the delta always signed in parentheses with an ASCII `-`
(Discord has no font control and these lines get pasted; the page's U+2212 rule, 5.3, is for the web). No
team totals. The MVP/ACE line is a block field named U+200B, present only when the game has an award.

```
color        16739125  (red #FF6B35: the winner's side)
title        Red wins · 31:04                    (links the game page when a URL is set)
description  Red was 51%. Red won. Top damage: Syndrome Axes, 31.4k.
field        Blue (inline)                       field   Red (inline)
             `top` FoxHound · 1210 (-14)                 `top` H4RDC0R33 · 1546 (+15)
             `jungle` XETA · 1363 (-15)                  `jungle` Syndrome Axes · 2305 (+14)
             `mid` Ramzyinhović · 2625 (-13)             `mid` knifiy · 1470 (+16)
             `adc` SugarPapy · 1203 (-15)                `adc` PRT Khokha · 1302 (+15)
             `support` Used2BeATahmMain · 1305 (-17)     `support` TheSHADOWREAPER · 1277 (+15)
field        ​ (U+200B)   MVP Syndrome Axes · ACE Ramzyinhović
footer       Kustom · game 4
```

**Accessibility.** The receipt is a `<section aria-labelledby>`. The text order is the visually hidden odds sentence, verdict,
reason, chips, disclosure, so a screen reader hears ‹Blue 49 percent, Red 51 percent› first. On reroll, the
receipt is part of the one polite announcement (6.4). **shadcn base:** Card + Chip + native `<details>`. The
bar is custom (a div with two segments; the hatch is `repeating-linear-gradient`, which is *data texture*,
not decoration, so it is exempt from the gradient ban). In forced colours: the segments get a 1px
`CanvasText` border, the hatch drops, and the labels carry it.

### 5.6 Settling / new-player chip

| Chip | Look | Words | When |
|---|---|---|---|
| settling | dashed 1px `--muted-foreground` border, transparent fill, `--muted-foreground` text, mono `--fs-2xs`, `--radius-chip` | ‹settling · 9/10› | rated games < the settle threshold (copy and threshold per STRATEGY.md) |
| new | same dashed style | ‹new› | 0 rated games |

Dashed means "not final" across the product, the same as an empty seat. These chips are never accent (that's
"you") and never solid. They are static, with no tooltip. The full meaning lives in "How ratings work"
(linked from the leaderboard footer). The number beside it is still shown: **never "0", never hidden.**

### 5.7 Empty state

One sentence, at most one action, left-aligned, inside the space the content would take. No illustration and
no icon.

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   dashed --border = "nothing here yet"
  ‹No games this week yet.›
  [‹See all time›]                        secondary Button, 44px; omitted if there's no next step
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```
On the idle tonight page the empty seat rack collapses to **one line** (audit #8), and last night's result
leads. `role="status"` only when the empty state *replaces* content live. **shadcn base:** none + Button.

### 5.8 Error and 404 pages

`not-found.tsx` (group-scoped and root), `error.tsx`, `global-error.tsx`. **The shell stays**: top bar, the
tab bar, and the group line when the group is known.

```
‹Page not found›                          h1, --fs-xl, text face 700 (not display)
‹There's no game 4821 in Customs Night.›  the reason, specific, --fs-base
[‹Back to tonight›]  [‹Leaderboard›]      primary + secondary Buttons, 44px, full width < 768
```
- 404s name what was missing (game, player, group) where the route knows it. An unknown `?window=` value
  **falls back to the default window**; it is not a 404. That includes the retired month ids
  (`this-month`, `last-month`, M14.48): the windows are `This week`, `Last week` and `All time` (Games:
  `Tonight`, `This week`, `All`), and an old month link opens the page's default.
- `error.tsx`: ‹Couldn't load this page.›, a `Try again` button that calls `reset()`, the back link, and the
  error digest in mono `--fs-xs` muted (‹ref a1b2c3›) for reporting. No stack trace and no apology filler.
- `global-error.tsx` renders its own `<html>` with the inline tokens and the text face fallback stack only,
  with no app fonts (they may be what failed).
- Unknown group slug: ‹No group called "xyz".› + `Back to Kustom`.

### 5.9 Route loading state

> **Amended 2026-10-03 (M14.39, Phase 4 review):** Tonight and the Board have **no `loading.tsx`**. A streamed
> first paint arrives in a `<template>` that never swaps in without JS, so a no-JS phone saw ‹Loading…› forever and lost
> the no-JS forms (Roll, Reroll, That's me, the Mode card link). They render whole on the server; on a client
> navigation Next keeps the old page up until the new one is ready (measured 52–104 ms at 375). The text below stands
> for any future route that is never used without JS; `LoadingView` and ‹Loading…› are currently unused.
> **M19.14 (2026-10-04):** no tab gets a `loading.tsx`; tab feedback is the pressed tab and a client-drawn
> pending frame, 5.9a.

**Decision: a static shell, streamed first; no skeletons.** `loading.tsx` per route group renders:
- the real top bar, tab bar and group line (from the layout, already static)
- the page's **real h1** (known from the route: ‹Tonight›, ‹Leaderboard›), so the page is oriented at first
  paint
- on tonight, the status strip with the live indicator in **connecting** and the headline slot reserved
- one muted line ‹Loading…› with `aria-busy="true"` on `<main>`, and no spinner
- below that, **reserved frames**: static `--card` blocks with a 1px border at the real component heights
  (two team-card frames at a 54px header + 5 × 64px, leaderboard rows at 56px), with no shimmer, no pulse and no grey text
  bars. This is the restyled shadcn `Skeleton` (5.0).

Why not skeletons: a shimmering grey block is the brightest moving thing in a dark room, and fake text bars
promise a shape that may not arrive (idle vs balanced tonight). Why reserved frames at all: so the team cards
land without shifting the page (CLS). Pages should also stream with Suspense: the shell and strip first, the
fearless pool and rail later.

### 5.9a Tab feedback and pending frames (M19.14)

Ruled 2026-10-04 for M19.15. Budget (owner): **a tab tap shows feedback within 200 ms** (INP < 200 ms) and
**LCP < 2.5 s**. Today a tab tap shows nothing for 270 to 700 ms (`redesign/research/performance.md`, P5).

**Why not `loading.tsx` (5.9 still stands).** A `loading.tsx` is a Suspense boundary, and on a **first
document load** Next streams it: the fallback is the HTML, and the real page arrives in a hidden node that only
JavaScript swaps in. With JS off, the skeleton is all the page ever shows. That is how M14.39 lost Tonight's
no-JS forms. Every tab has something a no-JS reader would lose:

| Route | What a no-JS first load needs |
|---|---|
| Tonight | Roll, Reroll, That's me, the Mode card link (5.9 amendment) |
| Board | the board itself: it is opened from Discord and WhatsApp links, and it is all content |
| Games, Game page | the list and the receipt: the result post links the game page (10.5) |
| Player page | the player: opened from the board and from shared links |
| Stats | the `/1v1` GET form (5.0, native select) and the records; `stats/loading.tsx` would also wrap `/1v1` |
| You | the sign-in and sign-out POST forms (`/auth/signin`, `/auth/signout`) |
| Admin | the POST forms and the confirm routes (5.13) |

A `loading.tsx` only helps a **client** navigation, so the skeleton has to be drawn by the client, not
streamed by the server. The design gets the same speed with no no-JS cost: the tab answers the tap itself, and
a slow navigation swaps `<main>` for a pending frame drawn in the browser.

**Per route**

| Route | `loading.tsx` | Pressed tab (`useLinkStatus`) | Pending frame |
|---|---|---|---|
| Tonight | no | yes | yes, the Tonight frame |
| Board | no | yes | yes, the Board frame |
| Games | no | yes | yes, the Games frame |
| Stats (Records, Champions, 1v1) | no | yes | yes, the Stats frame |
| You | no | yes | yes, the You frame |
| Game page | no | no (not a tab; reached from rows) | no |
| Player page | no | no (not a tab; reached from rows) | no |
| Admin (all sections) | no | the desktop top bar's `Admin` link only | no |

- **Game and player pages** get no skeleton. Their links sit in rows and tiles that are server-rendered;
  a `useLinkStatus` probe in every row would add a client component per row for a page that M19 made cheap
  (title-only `generateMetadata`). The row's own `:active` press state (5.2, CSS only, no JS) is the tap
  feedback. Their tab already reads Board or Games (5.11), and that does not change while the page loads.
- **Admin** gets the pressed state on the desktop `Admin` link (the same rule as a tab) and nothing else.
  The admin section pills are links inside the page: CSS `:active` only.
- **No `<Suspense>` boundary on a route a person can land on from a link** (every route in the table), for the
  same reason: on a first load its content is hidden from a no-JS reader. **This overrides M19.15's
  `<Suspense>` around Tonight's below-the-fold sections and the board's storyline** (OPEN for the lead). LCP
  comes from the cheaper loaders (M19.1 to M19.13), not from streaming. Tonight's header is server HTML in
  the first chunk either way.
- **A live refresh never shows a pending frame.** `router.refresh()` and Realtime re-reads are not link
  navigations, so they never set a pending tab; the shown page stays until the new one is ready (5.10).

#### The pressed tab

The tap's feedback is on the tab you pressed, painted in the same frame as the press. That is the
INP < 200 ms answer, and it does not wait on the network.

- **On press** (`:active`, unchanged): `scale(.98)` for `--dur-press` (2.9).
- **While pending** (`useLinkStatus().pending`, on the pressed link only): the label and icon go to
  `--foreground` and the icon fills (the same as active), and the tab gets the **3px top bar in
  `--border-strong`** at the active bar's place and size. The tab you are leaving keeps `aria-current` and its
  `--primary-text` bar until the new page is committed, because it is still the page on screen. Two bars
  for a moment, one neutral and one amber, read as "going there from here". Colour is not the only signal:
  the pending tab also gets the filled icon and the bar shape.
- **On landing**: the amber bar moves to the new tab, and the neutral bar goes. This is a colour change at
  `--dur-fast`, not a slide (2.9: nothing slides under a thumb).
- **Desktop top nav (>= 1024)**: the same rule on the 60px links. While pending, the link goes to
  `--foreground` with a 3px `--border-strong` underline; the current link keeps its `--primary-text`
  underline until landing.
- **No delay** on the pressed state. It is a colour change on a 75px tab, not a flash, and a delay would
  spend the INP budget. Next skips `pending` when the route was already prefetched and the change is instant,
  which is right: there is nothing to wait for.
- Tapping the tab you are already on is not a navigation: nothing changes.
- Contrast: `--border-strong` on `--card` is at least 3:1 (6.15), the same edge rule as any control.

#### The pending frame

If the navigation is **still pending 300 ms after the tap**, `<main>`'s content is hidden and the
destination tab's frame is drawn in its place. Under 300 ms (a prefetched or fast route, 52 to 104 ms measured
in 5.9) the frame never appears, so there is no flash. The old page is hidden with the `hidden` attribute, not
unmounted, so an abandoned navigation (a second tap, the back button) shows it again unchanged.

The frames use 5.9's reserved-frame part (`components/ui/frame.tsx`, the restyled shadcn `Skeleton`):

- `--card` blocks with a 1px `--border` and the card radius (8), at the **real heights** of the components that
  will land: seat rows `--seat-min-h` (64), board and history rows `--row-min-h` (56), team headers `--thead-h`
  (54), chips and the strip's top line `--chip-h` (28), segmented pickers `--tap` (44). Rows inside a frame are
  divided by the 1px hairline (2.5).
- **Shapes only, no words.** No fake text bars, no ‹Loading…›, no spinner, no amber, no side colours (a frame
  doesn't know which side a player is on yet). The h1 is a frame of its line height, not a word, because
  Tonight's and You's h1s depend on state.
- **No motion at all**: no shimmer, no pulse, no fade in. The frame appears in one paint and the page replaces
  it in one paint. Reduced motion therefore changes nothing; the pressed tab's colour change already drops to
  instant under 2.9's media query.
- Gutters, card padding and section gaps are the page's own (2.5), so the first block of the real page
  lands where its frame was. Only the first screen is framed; the frame never grows past `100svh` minus the
  bars, so a short page doesn't leave a long empty frame behind.
- CLS: frames hold the real heights of everything in the first screen, so the landing page shifts nothing
  above the fold. A page that lands taller pushes only the space below the last frame, which is below the
  fold. The target stays CLS <= 0.01.

**Frames per tab** (375 left, 1280 right; `▭` is a frame, `═` its hairline-divided rows; the top bar and the
tab bar are the real ones, unchanged):

```
TONIGHT 375                                  TONIGHT 1280 (main column + 340 rail)
▭ strip top line   28                        ▭ strip top line 28              │ ▭ rail
▭ headline         56 (display 46, 1 line)   ▭ headline 76 (display 64)       │   tape: 4 × 64
▭ sub-line         2 × 22 reserved           ▭ sub-line 2 × 22                │
▭ action / band    44                        ▭ action / band 44               │
                                             ▭ blue card            ▭ red card│
▭ team card  54 + 5 × 64 ═                     54 + 5 × 64 ═          54 + 5 ═│
▭ team card  54 + 5 × 64 ═ (below the fold)
```
The strip is one frame with its rows as the real strip's (5.10); the team cards are two frames side by side
from 768 (5.1). Idle, balanced or in game is not known before landing, so the frame is the balanced shape: it
is the tallest first screen and the most common one a tab tap lands on.

```
BOARD 375                                    BOARD 1280
▭ h1 line          32                        ▭ h1 32
▭ window picker    44 (3 segments)           ▭ window picker 44 (inline, w-auto)  │ ▭ rail (top this week)
▭ list  N × 56 ═   (rows to the fold)        ▭ list N × 56 ═                       │   5 × 56 ═
```

```
GAMES 375                                    GAMES 1280
▭ h1 line          32                        ▭ h1 32
▭ queue picker     44                        ▭ queue picker 44
▭ list  N × 56 ═                             ▭ list N × 56 ═ (main column)          │ ▭ rail
```

```
STATS 375                                    STATS 1280
▭ h1 line          32                        ▭ h1 32
▭ section picker   44 (Records · Champions · 1v1)
▭ window picker    44                        ▭ section + window pickers, one row 44
▭ section summary  52                        ▭ section summary 52
▭ rows  N × 56 ═                             ▭ rows in 2 columns, N × 56 ═ (5.14a)
```
The Stats frame is the Records shape whichever segment is tapped from the tab bar; a tap on a segment inside
Stats is an in-page link (no frame).

```
YOU 375                                      YOU 1280
▭ h1 line          32                        ▭ h1 32
▭ card             1 × 56 + 3 × 56 ═         ▭ card 4 × 56 ═     ▭ card 4 × 56 ═ (2 columns)
▭ card             3 × 56 ═
```
Signed out, You is the sign-in pitch, but the frame is the same: it is only the first screen, for at most a few
hundred milliseconds.

#### Screen readers

- The pressed tab says nothing new. The person just activated it; a pending announcement would talk over the
  page's own announcement a moment later.
- While the frame shows, `<main>` has `aria-busy="true"`; every frame is `aria-hidden` (as `Frame` already
  is). There is no ‹Loading…› text and no live region for loading, so 6.4's "one polite announcer per live
  page" is untouched.
- **Landing is announced by Next's route announcer**, which reads the new `document.title` on a client
  navigation. Every tab and page keeps its own distinct `<title>` (`Leaderboard · Customs Night`), so the
  announcement names where you are. `aria-busy` is removed in the same commit.
- Focus stays on the pressed tab during pending (it is still in the DOM), and moves as Next moves it on
  landing. The hidden old page is out of the tab order (`hidden`).

#### Build notes (for M19.15)

- One client context in the group shell (`Shell.tsx`) wraps `<main>`'s children: `{ pendingTab, since }`.
- Inside each `Link` in `TabBar` and `TopBar` sits a tiny client child that calls `useLinkStatus()` and reports
  `pending` for its tab to the context. It renders nothing visible; the pending style is a data attribute on
  the link (`data-pending`), styled in CSS.
- The `<main>` wrapper renders `children` in a `div` that gets `hidden` while `pendingTab` is set and 300 ms
  have passed, and renders `<TabFrame tab={pendingTab} />` beside it. Pending clears when `useLinkStatus`
  goes false or the pathname changes.
- `TabFrame` composes `Frame` only, with the heights above as tokens; it never fetches and takes no props but
  the tab key, so it is in the client bundle once (a few hundred bytes).
- No `loading.tsx` and no `<Suspense>` is added under `app/(group)/g/[slug]/`. `LoadingView` stays unused.
- Tests: (1) each tab renders its `TabFrame` at 375 and 1280 (snapshot of heights); (2) the server HTML of every
  tab with JS off contains the page's h1 and its forms (no streamed boundary); (3) `router.refresh()` never
  sets `pendingTab`; (4) the frame does not appear under 300 ms; (5) axe on a shown frame (`aria-busy`,
  `aria-hidden`, focus on the tab); `pageGroup.test.tsx` and `nav.test.ts` unchanged.

**Acceptance (designer signs):** the pressed tab paints within 100 ms of the tap on a mid phone at 375 and
1280, in Night and Day; each of the five frames at 375 and 1280 matches its sketch above, with no words, no
motion and no colour but `--card` and `--border`; landing from a frame moves nothing above the fold (CLS <= 0.01);
with JS off, every route in the first table renders whole on its first load.

### 5.10 Status headline strip

The one element on tonight that survives every state.

```
[● Live]  Sat 3 Oct, game 4 tonight                  ← line 1: live tag (5.4) + date line, --fs-xs muted
TEAMS ARE SET                                        ← h1, Archivo 62%/900, upper case, --fs-display (46 / 64)
Split by rating and role. Nobody picked              ← sub-line, --fs-sm muted, 2 lines reserved
the teams.
├──────────────────────────────────────────────┤
[◣ BLUE] H4RDC0R33   Jinxed Lad Who Wanders          ← name rows (no answer band only): side pill + the
         knifiy   Ramzyinhović   SYNDROMEAXESXXXX      five names in lane order, 700, wrapping
[◥ RED]  1sec Reloading   MANOOOOOOOO   …
   — or —
[YOU] on [◥ RED], playing support                   ← answer band: --raised, 18/600; side pill solid (3.3)
├──────────────────────────────────────────────┤
[            Reroll            ]                     ← action row: the viewer's one press, 44px+
```
The strip has at most **four rows, in this order**: headline block, then **either** the name rows **or** the
answer band (never both), then the action row. Each row is optional; a hairline `--border` separates rows.

- The **top line** (live tag + date) is exactly `--chip-h` tall in every state, with or without a tag, and
  the date is the short form: `Sat 3 Oct, game 4 tonight` (weekday and month abbreviated, no leading zero; the
  idle line is just `Sat 3 Oct`). At 375 the tag plus the longest date fits on one line, so the tag arriving
  after `SUBSCRIBED` or dropping to offline never re-wraps it and the headline below never moves (M14.45).
- The **h1 is the state headline** (fixes no-h1 on tonight): `TEAMS ARE SET`, `IN GAME 14 MIN`, `6 OF 10 IN`,
  `RED WINS`. Numbers inside it stay in the display face, tabular. The wordmark is not an h1.
- The **answer band** is the strip's row under the headline whenever the viewer is known and seated: `YOU`
  sticker, the side pill, the role. It is the first of three "which side am I on" answers above the fold
  (band, `Your side` header tag, you-row).
- **Name rows (M14.41)**, balanced and in game only, for a viewer with **no** answer band (signed out,
  unlinked, sitting out): one row per side, the solid side pill (glyph + word, 3.3) then that side's five
  names in lane order as one wrapping list (`<ul aria-label="Blue side">`, the pill `aria-hidden`), names 700
  `--foreground`, separated by a `gap-x-4` gap (no glyph, so no dangling dot at a line end). Names wrap between words and never truncate; at 375 a side may take
  three lines. **Plain text, not links**: the team cards below are where a name links (one link per person
  per screen). The sitter is not in these rows; the sit-out card directly under the strip names them.
  Acceptance (scene walk gap 3): signed out at 375×812, all ten names with their side in words show without
  scrolling.
- **Action row (M14.41)**: the viewer's one deliberate press, the strip's last row. `Roll teams` (admin,
  ten or more, primary), `Reroll` (admin, balanced, secondary), `Start a lobby` (any linked member, idle and
  finished, primary), or the sign-in button (signed out, idle only). At most one button, full width under
  768, `w-auto` at ≥ 768, 44px+. An optional one-line hint above the button, `--fs-sm` muted, only when it
  says something the sub-line doesn't (never restate the sub-line; over ten, the hint is the rotation
  preview, `If the teams rolled now, Chaos and then PRT Khokha would sit out.`). Members with nothing to
  press get no action row; the row never holds a link, a select or a second button (role picking stays in
  `Your role tonight`, mode in the Mode card). Acceptance (gap 2): the press is inside the first 812px at 375,
  clear of the tab bar.
- **When the viewer holds the press, the sub-line doesn't wait on someone else**: an admin who sees
  `Roll teams` never reads `Waiting on <admins> to roll the teams.` above it (that line is for everyone
  else).
- **The strip stays the hierarchy.** The headline is the largest type on the page in every state, and
  nothing in the strip is larger than the band (18/600). Worst case at 375 (an admin over ten, or a signed-out
  viewer in balanced) is about 500px, so the first card under the strip still starts inside the first
  screen. A new strip row needs a designer ruling; it is not where new features go.
- The live tag is on line 1, so the headline gets the full width. A long headline wraps
  (`text-wrap: balance`) and never truncates.
- 2 sentence lines are reserved, so a count change doesn't shift what's below.
- The headline is always `--foreground`, never amber and never a side colour (`RED WINS` is foreground;
  the winner shows in the team card and the embed colour).
- Headline changes go through the page's single polite announcer (6.4), not a second live region.

### 5.11 Navigation: bottom tab bar (< 1024) and top nav (≥ 1024)

**Five tabs, no More page** (the user's choice, option A of `redesign/nav/proposal.md`, decision rows of
2026-10-03; supersedes the four tabs plus More). **Phone and tablet (< 1024)**. C moved the cut from 768 to
1024: at 768 the tab bar still beats a crowded top row, and the two-column team layout already starts at 768.

```
┌────────────────────────────────────────┐
│ ▍KUSTOM │ Customs Night ⌄          [☾] │  top bar 60px, --card, not sticky; wordmark (display) + amber
└────────────────────────────────────────┘  5×22 bar, group switcher (text 700), Day/Night switch; never clipped
                 … page …
┌───────┬───────┬───────┬───────┬───────┐
│  ◉•   │  ≡    │  ▤    │  ◫    │  ◯    │  tab bar 60px + env(safe-area-inset-bottom), fixed
│Tonight│ Board │ Games │ Stats │  You  │  icon 24 + label --fs-2xs 700; each tab 20% wide (75px at 375), ≥ 44 tall
└───────┴───────┴───────┴───────┴───────┘
```
- Five tabs: **Tonight · Board · Games · Stats · You**, the same five in the same order on every width.
  Stats holds Records, Champions and 1v1 as URL segments. You is your own view (the `Admin` card first for
  admins, Your night, You vs them, the Daily card, its own Day/Night switch and sign out); signed out it is the sign-in pitch, and
  the label still reads `You`, never `Sign in` or `Me`. Daily and the Mode card sit on Tonight; `How the bot
  decides` (`/how`) and `Get Kustom` (`/download`) are footer links. **A new feature goes on the page where its
  moment is; never a sixth tab, never a drawer.**
- Current tab: any player page (your own included) marks Board; `/mystery` and `/mode` mark Tonight; admin
  pages mark none. No `Admin` link in the phone top bar.
- Active: `aria-current="page"`, label `--foreground`, a 3px accent bar on the tab's top edge (shape +
  position), icon filled. Inactive: `--muted-foreground`. The label is always visible; there are no icon-only
  tabs.
- Icons: inline SVG, 24px, `currentColor`, the same stroke family as `RoleIcon`, `aria-hidden`.
- `<nav aria-label="Main">` comes **before** `<main>` in the DOM, right after the skip link, and is visually fixed at the bottom. `body` gets `padding-bottom: calc(var(--tabbar-h) +
  env(safe-area-inset-bottom))`.
- Hide the bar while a text input has focus on a phone (the keyboard covers it anyway, and it jumps above the
  keyboard on iOS).
- `--card` surface, a 1px `--border-strong` top edge, and no blur. The Tonight tab carries an 8px amber dot
  while live (with the `Live` word on the page, so the dot is never the only signal).
- The active-tab bar is `--primary-text`, so it is `#7A4F00` in Day (amber on white was 1.46).

**Desktop (≥ 1024)**: one top row, 60px: lockup and group switcher left; the same five links `Tonight  Board
Games  Stats  You`; `Admin` (admins only) and account right. Links are 60px tall, current = `--foreground` + 3px `--primary-text` underline +
`aria-current`. No tab bar. Not sticky. Content becomes main column + a 340px rail (tape, `Top this week`).

**The Day/Night switch is in the top bar on every page (M14.47)**: at the far end of the bar below 1024px, and
between `You` and `Sign in` from 1024px up (signed in, where there is no `Sign in`, it is the last item). The
You page keeps its own switch; both write the one stored preference, so they always agree.

### 5.12 Admin table on mobile

≥768: shadcn Table, restyled (hairline rows, mono numbers, `th scope="col"`).
<768: **no horizontal scroll and no clipped cells**. Each row renders as a card:

```
┌──────────────────────────────────────────┐
│ Raafat                          h3, 600  │  primary cell becomes the heading
│ Role        admin                        │  <dl>: label --fs-xs muted / value --fs-sm
│ Token       kst_9f3a2c71d0e4b8a6f15c     │  full value, mono, wraps (overflow-wrap:anywhere)
│             93e0                         │
│ Last seen   2 Oct, 21:46                 │
│ [Revoke token]            [Make member]  │  visible 44px buttons, wrap to rows; no ⋯ menu
└──────────────────────────────────────────┘
```
Long IDs, tokens and snowflakes wrap in mono. Dates use `Intl.DateTimeFormat`. Developer copy (`revoked_at`,
`pnpm …`) is replaced (copy per STRATEGY.md). One component renders both layouts from the same column
definitions (`label`, `cell`, `primary?`), so they can't drift.

### 5.13 Destructive-action confirm (AlertDialog)

For revoke token, remove admin, fearless reset, and anything that deletes or demotes.

```
          ┌───────────────────────────────────┐
          │ ‹Revoke Raafat's token?›     h2   │  verb + object + question
          │ ‹Their Kustom stops posting games │  consequence, one or two sentences
          │  until they get a new one.›       │
          │                                   │
          │ [ ⚠ Revoke token ]   destructive  │  verb label, icon; full width on phone
          │ [   Cancel       ]   secondary    │  **initial focus on Cancel**
          └───────────────────────────────────┘
```
- Phone: buttons stacked full width, 44px, the action above Cancel (Cancel sits nearest the thumb).
  ≥768: inline, Cancel left, action right.
- Escape and scrim tap cancel. Focus is trapped (Radix) and returns to the trigger.
- While pending: the action button is `aria-disabled` with ‹Revoking…›, and the dialog stays open until the
  result. A failure shows a `role="alert"` sentence inside the dialog.
- The typed-confirm pattern (Reset ratings) stays for irreversible bulk actions: the action is enabled only when
  the typed name matches.
- No-JS: the trigger is a link to a confirm route that renders the same content as a page with a POST form.
- Motion: fade + scale .97 → 1 at `--dur-slow`; under reduced motion, opacity only.

### 5.14 Smaller shared parts

- **Side tag** (`◣ BLUE`): the glyph SVG + word, used anywhere a side is named in a row.
- **Window picker**: links styled as a segmented control, 44px, wrap to two rows at 375, `aria-current`.
- **Disclosure**: native `<details>`, 44px summary with a chevron that rotates 90° (no rotation under reduced
  motion), and a focus outline on the summary.
- **Link**: underlined `--foreground`, `text-underline-offset: 3px`. In running text the hit area is the text
  (inline links are exempt from 44px, WCAG 2.5.8), but **standalone** links get 44px of padding.

### 5.14a Records list (Stats → Records)

Ruled 2026-10-03 (M14.17 round 1: all time was ~24,000px at 375).

- **Don't cap the list and don't put each record behind its own `<details>`.** Every record answers a different question, and the holder is the answer, so it shouldn't take a tap to see it.
- **Each record is one row link** (to the game), at most 2 lines: line 1 is the record title in the text face, with the value in mono `--fs-md` 600 on the right; line 2 is holder · date · duration, `--fs-xs` muted (numbers mono, words text face, §5.2). The row has no Arabic subtitle line; the section's subtitle stays on the section header. The one-line explainer goes into the row's `title`, and each section ends with one native `<details>`, `How these count`, that lists every record's rule.
- **Sections:** `One game` is open. Every other section (CS by role, the habit, the museums, luck, won against the odds) is a native `<details>` whose 52px summary shows the section name and its record count in mono.
- **≥ 1024:** inside each section the rows sit in 2 columns (`grid-cols-2`, hairline between rows, no card per row).
- **Values never wrap mid-token:** `30.00 KDA · 11/1/19` drops the KDA ratio to line 2 instead of breaking.
- **Acceptance:** at 375 on all time, ≤ 4,000px with the closed sections closed and ≤ 9,000px with every section open, with nothing removed.

### 5.15 Tonight parts added by C

- **Sit-out note.** A card with a dashed `--border-strong` edge and no fill, a muted 20px icon, the lead with
  the name in 700 and one reason sentence, `--fs-sm` (`Chaos sits this one out. They've gone longest without
  sitting out, and everyone's played 1 game tonight.`). **In balanced and in game it is the first card after
  the strip, for everyone** (M14.41, STRATEGY §6(a); supersedes 1.0's "under the team cards except for the
  sitter"): with the name rows or the answer band above it, the first screen answers who plays, which side,
  and who doesn't. For the sitter it reads `You are sitting this one out. <reason> You are first in line for
  the next one.` **In finished** it is past tense with no reason (`Chaos sat this one out.`) and sits after
  the team cards, whichever path renders the result: the poster leads a finished page.
- **The reason sentence** is one `lib/` function shared with the teams embed's `Sitting out` field, and names
  the rule that actually decided: `They've played the most games tonight.`; a tie broken by sit-outs puts the
  pronoun first, right after the name, and the tie as its clause (`They've gone longest without sitting out,
  and everyone's played 1 game tonight.`), so `they` can't be read as `everyone`; nothing to tell them apart,
  `First game of the night, so somebody has to be first.` The name is said once per card; the reason uses
  `They've` (several sitters too) or `You've` for the sitter. Counts say `game(s)`, never a bare number.
- **Top this week** (idle and every other state's lower card; the rail ≥ 1024): rank (mono, muted), name
  (700, wraps, never truncates) over `4W 2L` (mono `--fs-xs` muted), and the week's change on the right (mono
  700, signed, not coloured, 5.3). **No four-digit Rating on this card**: the team cards carry each person's
  Rating, and the same name next to two different four-digit numbers on one page (the walk's gap 1) is the
  one thing it must not do. Each row is one link to the player page, 48px+. `Full board` link in the header.
- **Name links (M14.41).** Every team-card seat (balanced, in game, finished) is one link to the player page,
  **stretched over the seat** (`::after` inset 0 on the name's `<a>`, focus ring drawn on the pseudo-element),
  so the target is the full seat (`--seat-min-h`, 64px). The name is not underlined inside a seat (the row is the link,
  like a Board row); hover fills `--accent`. The `YOU` seat keeps its frame and gets no hover fill. MVP / ACE
  names on the poster are standalone underlined links, `min-h-11`. Nothing interactive sits inside a seat.
- **Full scoreboard** (finished poster, under the MVP / ACE line): a standalone `--primary-text` 700
  underlined link, `min-h-11`, to `/g/<slug>/games/<id>`.
- **Tape tile** (rail, and the page while filling): `--raised`, `--radius-control`, a 54px side block on the
  left under 3.3's four-label rule (word + glyph, `--on-team`, red hatched), then `Game 3` (700), the
  duration in mono, `Blue was 53%. Red won.` in muted, and an `MVP` sticker line. The whole tile is one link.
  The tape's header meta reads `<n> earlier` while a lobby or result is on the page (`1 earlier`, never
  `1 played`).
- **Filling rack.** A 10-cell meter (filled cells `--foreground`, empty cells dashed `--border-strong`), the
  pool as rows of name + role (two columns ≥768), a `Still needed:` line with outlined role chips
  (`--foreground` 1.5px border, icon + mono role word), and **the empty seats as one dashed line**, not four
  empty rows.

### 5.16 Share cards (Open Graph images, M14.25)

1200 × 630 PNGs for the WhatsApp and Discord unfurls of Tonight, a game and a player (`app/_og/`). The
**layout** is 1.0's, kept on purpose: the 48px frame, `▍KUSTOM` and the slug over a 2px line, the centre
third (x 400–800) holding the words that carry the card, the mirrored three-column game card with the 8px
winner's rule and the 2px loser's rule, no role words, ratings or champions on the game card
(`05-design-1.0.md`, "Share cards", geometry only). The **look** is 2.0's, and this section is its spec.

**Colour.** Always Night (an unfurl has no theme). Fixed hex in `app/_og/palette.ts`, copied from 7.3's
Night primitives; that file and 7.3 change in the same commit. One plane, no cards inside the card.

| Card token | 7.3 source | Hex | Use | On `#05070C` |
|---|---|---|---|---|
| `bg` | `--background` | `#05070C` | the whole card | |
| `line` | `--border` | `#2A3344` | the header rule, the loser's rule | 1.59 (decorative; the side word names the loser) |
| `text` | `--foreground` | `#F4F7FC` | names, headlines, the player number, record digits | 18.8 |
| `dim` | `--muted-foreground` | `#8B98AD` | slug, duration, sentence, labels; never a name | 6.90 |
| `blue` / `red` | `--team-blue` / `--team-red` | `#2E9BFF` / `#FF6B35` | side words, the game verdict, the winner's rule | 6.96 / 7.11 |
| `brand` | `--primary-text` | `#FFCF66` | the wordmark bar only; no live state exists in a PNG | |

The light is 7.3's Night `--page-light` in pixels for the 1200px card (`OG_LIGHT` in `palette.ts`): the
azure lamp `radial-gradient(ellipse 1080px 760px at 96px -140px, rgba(46,155,255,0.16), rgba(46,155,255,0) 58%)`,
the amber lamp `radial-gradient(ellipse 960px 700px at 1152px -120px, rgba(255,207,102,0.12), rgba(255,207,102,0) 52%)`
and the 48px grid at 4% as two `repeating-linear-gradient`s. Each lamp fades to its own colour at zero alpha,
never to `transparent`. If a renderer bands it, drop the lamps: flat `bg` is correct, a banded gradient is not.

**Type.** Section 4's three faces as static OFL TTFs in `app/_og/fonts/` (Satori reads no `wdth` axis and no
`woff2`), cut at the site's settings, read from disk, never fetched at render time.

| Role | Face | Size at 1200 | Notes |
|---|---|---|---|
| Wordmark | Archivo condensed (`wdth` 62) 900 | 32, `0.02em`, UPPER | after a 6 × 26 `brand` bar, gap 10 |
| Verdict / headline | Archivo condensed 900 | 112 (verdict may go to 144), line 0.95, `-0.01em`, UPPER | game verdict in the winner's side colour; Tonight headline in `text` (the strip's colour) |
| Side word | Archivo condensed 900 | 36, `0.04em`, UPPER, side colour | `BLUE` / `RED` over each column |
| Name | Atkinson Hyperlegible Next 700 | 34 (player card 72), `text` | shrinks to fit, then wraps; never ellipsis (ruling (c)) |
| Group line | Atkinson 700 | 24, `text`, one line | beside the wordmark; never shrinks; ellipsis when it doesn't fit (ruling (d)) |
| Sentence / label | Atkinson 400 | 28–36, `dim` | Tonight sentence max two lines |
| Slug | Atkinson 700 | 24, `dim`, **sentence case, no tracking** | the page's own string: `Saturday 3 October`, `All time` |
| Number | Martian Mono (`wdth` 85) 500/600 | duration 32/500 `dim`; player number 160/600 `text`; stat values 32/600 `text` | tabular by construction |

Nothing that must be read goes below 28px (about 9px at Discord's ~400px). The slug, the wordmark and the
group line are identifiers and may sit at 24–32. A side-column name may shrink to 24 for a pathological
name only (ruling (c)). Nothing on a card is ever under 24.

**Ruling (a), records split per token.** Section 4's meta-line rule holds on the card: in `1W 0L` the
digits are Martian Mono 600 and the `W` / `L` letters are Atkinson 700, same size (32), same `text` colour,
baseline-aligned, no space between a digit and its letter, one space between the pairs, exactly like
`RecordLine` on the board. The model carries the parts (numbers and letters), not a pre-joined string;
`Cards.tsx` still composes no copy.

**Ruling (b), side labels stay coloured words, not side pills.** 3.3's four-label rule allows a solid fill
on the header band, the side pill, the win-bar segments and the tape tile, and the red one always carries
the hatch. On the card the side word is a column heading over five names, not a pill in a sentence, and
the picture is downscaled to a third and recompressed: a 9px hatch turns to mush or moiré, and an unhatched
red block breaks 3.3. Two equal solid blocks would also compete with the verdict, which is the one loud
thing on the card. The words are 6.96 / 7.11 on the page, the word itself is carrier 1, and the winner's
8px rule is the celebration. Optional: the ◣ / ◥ glyph (carrier 2) as an inline SVG beside the word, 28px,
side colour, blue before `BLUE`, red after `RED` (mirrored).

**Ruling (c), names shrink before they wrap, with floors (M14.42).** Every name on a card is a person and
is never cut off (6.6). Satori has no fit-to-width, so `app/_og/fit.ts` measures and picks the largest whole
size that fits the box, down to a floor; a name still too wide at the floor wraps, at a space first and
mid-word only when one word is wider than the box. No `break-all` on anything with spaces in it.

| Text | Base | Floor | Below the floor |
|---|---|---|---|
| Side-column name (312px box) | 34 | **24** | two lines at 24, line height 1.05, inside the 56px seat row |
| Player card name (1000px box) | 72 | 40 | wraps, centred, at most two lines |
| Pitch / invite headline (1000px box) | 112 | 64 | wraps at spaces, centred, at most two lines |

The side-column floor is 24, not 28 and not 20. 24 is the identifier floor this section already allows the
slug, and a name is read the same way, as "is that me", not as a sentence. 20 would be about 7px in a
Discord unfurl, which no longer reads. Real names never reach the floor: League caps a Riot ID name at
16 characters, the long fixture `TheSHADOWREAPER` fits at 34, and only a name of 14 or more wide caps
(`WMWMWM…`) goes below about 26. Each name fits on its own, so one long name doesn't shrink the other four.

**Ruling (d), the group line (M14.42).** The card names the group beside `▍KUSTOM`, like the shell's top bar:
Atkinson 700, 24, `text` (it is the card's identity; the slug on the right stays `dim`), a 20px gap after the
wordmark. It takes whatever width is left between the wordmark and the slug and **never shrinks**. If it
were smaller than the slug beside it, the hierarchy would be upside down. It is never under the identifier
floor and never wraps, because a two-line header would push the body into the frame. When it doesn't fit
at 24 it ends in an ellipsis on one line (Satori: `overflow: hidden`, `whiteSpace: nowrap`, `textOverflow:
ellipsis`, a `maxWidth`). That is 6.6's one allowed ellipsis, the group line, and the full name is in the
unfurl's `og:title` right beside the picture. Group names are capped at 40 characters (migration 0018), and
`Customs Night`-length names never get near it. The slug never shrinks or cuts. Pitch and invite cards have
no group line (the invite's group is in its headline).

**Ruling (e), the settling chip on the player card (M14.42).** It is 5.6's chip at card size, with two changes
the picture forces:

- **A solid outline, not dashed.** A 2px dash downscaled to a third turns into a grey smear, the same
  reason ruling (b) drops the hatch. The chip is a 2px solid `line` border, transparent fill, padding
  4 × 16. The word `settling` is Atkinson 700 28 `dim`. The count follows ruling (a): `1/10` in Martian
  Mono 600 28 `dim`, so the model carries the parts, not a joined label. "Not final" is carried by the
  word and by the chip being the quietest object near the number. It is never `brand` and never filled.
- **Radius 6, not a pill.** 2.6 bans 999 everywhere except the live dot and the tab-bar dot. At 1200 the
  chip uses the control radius (6) so it reads as a chip after the downscale.
- **It sits on the `Rating` label's row**, to the label's right, 16px gap, centred on the label, and not on
  a row of its own. A row of its own adds about 62px, and with the group line and a role line the column
  ran into the header rule and the bottom frame (`m1442-og-player-settling-1200.png`). The number stays the
  one loud thing, and `Rating  settling · 1/10` reads as one fact.

**Ruling (f), the finished rated Tonight card (M14.42).** It is the game card exactly: the mirrored three
columns, the five names per side, the winner's 8px rule, the verdict (`RED / WINS`) in the winner's colour.
The **odds line** goes under the verdict where the game card has the duration: Atkinson 400 28 `dim`,
centred, 24px above, at most two lines inside the centre column (break at the sentence, so `Upset!` may sit
alone on line 2). The wording is the games row's (5.5, "Games row"): the verdict already names the winner,
so the line is `Red was 51%.`, `Red was 46%. Upset!` or `50–50.`, never `Red won.` again. An unrated or
odds-less finished night shows the duration line instead, like the game card. Idle and filling Tonight
cards stay headline + sentence.

**Ruling (g), the week notes picture (M14.79).** The Sunday post's 1920×1080 "Week N notes" picture
(`app/_og/WeekNotes.tsx`, variant A of `redesign/research/patch-image.md`; 10.6, 10.11 tier B3) keeps this
section's palette, faces and Riot-safe rule, with these differences:

1. **Notice.** It carries the short notice as a footer, verbatim: `Made by Kustom from this group's own games.
   Not affiliated with or endorsed by Riot Games.` (Atkinson 400, 26, `dim`, straight apostrophe). It is a
   picture people save and repost, so it names its source. The unfurl cards still carry no notice.
2. **Champion names, never art.** NEW's first-picks tile names champions as plain text (`Smolder, Aurora,
   Ambessa +6`). No portraits, icons, splash art or Riot role or rank icons; players are initials in rings and
   the role marks are `app/_icons/RoleIcon.tsx`.
3. **Cards inside the card.** Fact tiles and the KEY sit on `card` (`#0C121A`, slate-1) with a 2px `line`
   border, radius 10; rings sit on `raised` (`#141B28`, slate-2). Both are in `palette.ts`. The KEY is drawn
   only when the picture shows at least one ring.
4. **Size floor at 1920.** Must-read text (names, points, tile values) is 32 or more, except item 7's
   seam-split name, which may go to 27. Secondary text (labels, sub lines, the key line, the notice) and a
   record that doesn't fit beside its points are 26 or more. Nothing is under 26. In the phone feed (about 520px wide) that is 8.7–9.75px
   for what must be read; the picture is a tap-open one and the post's text carries the same facts.
5. **Records.** Ruling (a)'s split (digits Martian Mono, `W`/`L` letters Atkinson, no space between a digit
   and its letter), set in `dim` so the points stay the headline. Every medallion's points-and-record line
   sits on the medallion's bottom edge, so a row reads level whatever its names do.
6. **Gain and loss.** A gain is a 4px `text` ring with `text` points; a loss a 2px `line` ring with `dim`
   initials and points and a real minus (U+2212). No colour for up or down (3.7); the section words and the
   ▲ / ▼ glyphs tell them apart. NERFS shows plain numbers only, never a comment.
7. **Names** follow ruling (c) in this order: one line, shrinking to 33; else wrapped at spaces at 36; a
   one-word name with a lower-to-upper case seam breaks at the seam (`The` / `SHADOWREAPER`), the longer part
   shrunk to fit down to 27; only then broken inside the word at 30. Never an ellipsis.
8. **Initials.** The first letters of the first two words; for one word, the first letter and its first run
   of digits up to two (`P13`, `H4`), else the next capital (`FH`), else the second letter (`RA`). Upper case.

**Riot-safe.** No Riot or League marks, no champion art or names, no rank emblems. The product is named
only by the wordmark. The legal notice lives on the page, not in the picture. The one exception is the week
notes picture (ruling (g)): champion names as text, and the short notice as its footer.

---

## 6. Accessibility rules

1. **Focus ring on every interactive element**: `a, button, summary, select, input, textarea,
   [tabindex]:not([tabindex="-1"])`, `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`.
   Always `outline`, never a box-shadow ring (forced colours). On a team-tinted or accent surface, the 2px
   offset puts the ring on the card colour, so it stays visible.
2. **Skip link** first in `<body>`: ‹Skip to content› → `#main`. Visually hidden until focused, then a level-2
   chip top-left.
3. **One h1 per page.** Tonight: the state headline. Game page: the result (‹Red wins›). Leaderboard:
   ‹Leaderboard›. Player: the name. The wordmark is never the h1. Headings don't skip levels.
4. **One polite announcer per live page** (`role="status" aria-live="polite" aria-atomic="true"`, visually
   hidden). It speaks one meaningful sentence per change: ‹Teams rerolled. Blue 51 percent, Red 49 percent.
   You're on Red, mid.› / ‹Game started.› / ‹Red wins.› It never announces bare numbers and never the timer.
   The connection status (5.4) is the only other status region. Refusals use `role="alert"`.
5. **Colour is never the only signal.** Side = word or glyph or texture. You = tag + outline. Settling/new =
   word + dashed. Off-role = word + dashed. Live = word + dot shape. Delta = sign.
6. **No essential truncation.** Names, headlines, button labels, errors and admin values wrap. The only
   allowed ellipsis is the group line in the top bar (it is repeated in full in every heading that acts on it),
   and only when it's over 33 characters.
7. **Tap targets ≥ 44 × 44** for every standalone control, including chips that act, disclosure summaries,
   tabs and window links. `touch-action: manipulation` on controls. `-webkit-tap-highlight-color:
   transparent`, because we draw our own `:active`.
8. **Forced colours** (`@media (forced-colors: active)`): side glyphs and role icons are `currentColor` SVG,
   so they survive. Win-bar segments get `border: 1px solid CanvasText` and the hatch drops (labels carry
   it). The "you" outline uses `outline`, which maps to a system colour. The live dot is SVG. Chips keep a
   1px border. Test in Windows High Contrast.
9. **Zoom and reflow**: zoom is never blocked, layouts reflow at 320 CSS px and at 200% text with no
   horizontal scroll, and `100svh` (not `vh`).
10. **Forms**: visible labels, errors under the field with `aria-describedby`, inputs at 17px, `inputmode`
    for numeric codes, `autocomplete="off" spellcheck={false}` on IDs, `…` in placeholders.
11. **Reduced motion**: 2.9. The live dot goes static and the "just joined" wash is removed.
12. **Language**: numbers in sentences are mono and tabular. The minus is U+2212. Durations are ‹21 min›.
    Dates use `Intl.DateTimeFormat`.
13. **Screen-reader words** on every bare number: sums, ranks, deltas, percentages (5.1–5.5).
14. **Test names** for every component at 375 and 768: `Used2BeATahmMain`, `TheSHADOWREAPER`, `1sec
    Reloading`, `MANOOOOOOOO`, `Ramzyinhović`, and a 16-character all-caps name in **every** seat at once.
15. **Control edges (WCAG 1.4.11), ruled 2026-10-04.** Night's surfaces are 1.0's, so a raised fill is only
    1.09 off the card and the hairline is 1.48. **Wherever an edge is what tells a person "this is a
    control", the edge is `--border-strong` (or `--input`), at least 3:1** against what the control sits on:
    text inputs, selects and the search field (`--input`); secondary and outline buttons; toggle chips (role
    picker, lane filters); the window chips and the segmented pickers' frame; the theme switch track; the
    mode card's lane tiles and the panel's close button; the mystery guess buttons and its community
    disclosure; pagination and empty-state links; the admin section pills. Focus is the 2px `--ring`
    (foreground, 17.5:1). Disabled controls are exempt (WCAG) and keep `--border`. On the faint hairline
    stay: card edges, dividers, static chips, read-only code boxes, and **whole-card links** (a tape tile,
    the daily mystery card), which a person identifies by their content and title, not by an edge. Check:
    every visible control whose fill is under 3:1 against its surroundings has an edge of at least 3:1, on
    every public route at 375 and 1440.

---

## 7. Direction tokens: C, "Floodlit Slate"

The user chose C on 2026-10-03. Directions A ("Broadcast") and B ("Scrim Night") are **rejected** as wholes;
what C kept from each is listed in `redesign/prototypes/direction-c/README.md`, and what was dropped is in 7.5.

### 7.1 Identity, at a glance

| Slot | Value |
|---|---|
| Night neutrals | "1.0 night" (since 2026-10-04): page `#05070C`, card `#0C121A`, raised `#141B28`, border `#2A3344`, strong `#66738A`, muted text `#8B98AD`, text `#F4F7FC` |
| Day neutrals | cool paper: page `#E9EDF2`, card `#FFFFFF`, raised `#EEF1F5`, border `#A9B3C1`, strong `#7D8898`, muted text `#434C5A`, text `#0E1116` |
| Accent | amber `#FFCF66` (Night text, all fills); `#7A4F00` (Day text and outlines). 3.4 has the passing numbers: 1.94 vs red, deutan ΔE 16.5. |
| Teams | shared, 3.3: `#2E9BFF` / `#FF6B35` Night, `#1563CF` / `#B5390B` Day; on-team ink `#10141B` / white |
| Display face | Archivo, `font-stretch` 62%, 900; headline and side names only (section 4) |
| Radius | card 8, control 6, chip 4 (2.6) |
| Texture | (1) the red **hatch**: a 4px dark stripe every 9px at 135°, on every red fill; (2) the **solid colour-blocked team header** under 3.3's four-label rule; (3) the **page light**, `--page-light`, the only decorative gradient: in Night, 1.0's two corner lamps (azure 16% top-left, amber 12% top-right) and its 48px pitch grid at 4%; in Day one amber-800 glow at 5%. The azure lamp is ambient light, opposite an amber lamp of the same size, never behind a side label or a side's content, so it does not read as Blue's colour (the exception to 7.2's "no decoration in a side colour", chosen with 1.0's look). No per-card edge highlight, no offset shadow. |
| Stickers | `YOU` and `MVP` only: radius 4, −2° tilt, no shadow, text face 700. Never on names, numbers or the bar. Under reduced motion the tilt stays (it is not motion). |
| Discord ints | amber `16764774` (teams), blue `3054591`, red `16739125` (results) |

### 7.2 Renames

From the 2.0 draft of this file (`redesign/design-system.md` before 2026-10-03): `--p-ink-*` → `--p-slate-*`
(and step 5 added for `--border-strong`); `--p-accent-400/800` → `--p-amber-400/800`; `--team-red-hatch`
removed (the hatch is now `--stripe` + `--hatch`, an overlay); tints 14% → 12%; `--popover` is `--card`, not
raised; next/font's own variables are `--font-{text,mono,display}-core` and `-rest` (since 4.1; before it,
`--font-atkinson`/`--font-martian`/`--font-archivo`), and the
documented names `--font-text`/`--font-mono`/`--font-display` are now **unlayered `:root` runtime variables**
holding the full stacks over them (7.3), which `@theme inline` exposes as the utilities `font-text` (=
`font-sans`, the default), `font-mono` and `font-display`. The `:root` block wins over the theme layer's
same-named self-references; the radius lines are literal values in a plain `@theme`). New semantic tokens: `--raised`, `--border-strong`,
`--primary-text`, `--primary-fill`, `--on-primary-fill`, `--on-team`, `--stripe`, `--hatch`, `--hatch-strong`,
`--side-block-shade`, `--you-wash`, `--glow` (replaced on 2026-10-04 by `--page-light`, per theme).

From the prototype's `c.css`, which used short names (the app uses shadcn's). Copy from 7.3, not from
`c.css`.

| `c.css` | App token | Why |
|---|---|---|
| `--accent` | `--primary` (fill/button) and `--primary-text` (text/outline) | shadcn reserves `--accent` for its neutral hover surface |
| `--accent-text` | `--primary-text` | |
| `--accent-fill` / `--on-accent` | `--primary-fill` / `--on-primary-fill` | |
| `--tint-blue` / `--tint-red` | `--team-blue-tint` / `--team-red-tint` (12%) | the draft's names; `--team-*` prefix groups them |
| `--muted-foreground: #c5cdd9` | `#CBD2DD` | 7:1 on the you-wash (3.2) |
| `--glow` Day `rgb(21 99 207 / .06)` | `rgb(122 79 0 / .05)` | the Day glow was team blue, i.e. decoration in a side colour |
| `.tblock` / `.tside` inline gradients | `--side-block-shade`, `--hatch-strong`; tape tiles use `--hatch` | one hatch token; the tile's 22% stripe was a third variant |
| `--font-text` | `--font-text` (`:root` stack over next/font vars `--font-text-core`, `--font-text-rest`, then `Atkinson Fallback`); utility `font-text` = `font-sans` | the stack lives in an unlayered `:root` block so the theme layer's self-reference cannot shadow it |
| `--font-display` / `--font-mono` stacks | `--font-display` / `--font-mono` (`:root` stacks over next/font vars `--font-display-core`/`-rest` / `--font-mono-core`/`-rest`, then `Archivo Fallback` / `Martian Fallback`); utilities `font-display` / `font-mono` | same |
| (none) | `--raised` is kept as is, and shadcn's `--muted`, `--secondary`, `--accent` alias it | |

### 7.3 The token block (copy into `apps/web/app/globals.css`)

This is the only place a colour, radius or size value is defined. Paste it whole.

```css
@import "tailwindcss";
@import "tw-animate-css";              /* shadcn's dependency; only fade/zoom are used (2.9) */

@custom-variant day (&:where([data-theme="day"], [data-theme="day"] *));

/* ---------- Primitives (never read by components) ---------- */
:root {
  /* Night neutrals: Floodlit 1.0's deep blue-black (2026-10-04); muted and strong lifted for AA / 3:1 */
  --p-slate-0: #05070C;  --p-slate-1: #0C121A;  --p-slate-2: #141B28;  --p-slate-3: #2A3344;
  --p-slate-5: #66738A;  --p-slate-7: #8B98AD;  --p-slate-9: #F4F7FC;
  --p-paper-0: #E9EDF2;  --p-paper-1: #FFFFFF;  --p-paper-2: #EEF1F5;  --p-paper-3: #A9B3C1;
  --p-paper-5: #7D8898;  --p-paper-7: #434C5A;  --p-paper-9: #0E1116;
  --p-azure-400: #2E9BFF;      --p-azure-700: #1563CF;
  --p-vermilion-400: #FF6B35;  --p-vermilion-700: #B5390B;
  --p-amber-400: #FFCF66;      --p-amber-800: #7A4F00;
  --p-rose-400: #FF6B8A;       --p-rose-700: #B4123C;
  --p-ink: #10141B;
}

/* ---------- Semantic: Night (default) ---------- */
:root {
  color-scheme: dark;
  --background: var(--p-slate-0);
  --foreground: var(--p-slate-9);
  --card: var(--p-slate-1);
  --card-foreground: var(--p-slate-9);
  --raised: var(--p-slate-2);
  --popover: var(--card);
  --popover-foreground: var(--card-foreground);
  --primary: var(--p-amber-400);
  --primary-foreground: var(--p-ink);
  --primary-text: var(--p-amber-400);
  --primary-fill: var(--p-amber-400);
  --on-primary-fill: var(--p-ink);
  --secondary: var(--raised);
  --secondary-foreground: var(--foreground);
  --muted: var(--raised);
  --muted-foreground: var(--p-slate-7);
  --accent: var(--raised);                 /* shadcn hover surface, NOT the amber */
  --accent-foreground: var(--foreground);
  --destructive: var(--p-rose-400);
  --border: var(--p-slate-3);
  --border-strong: var(--p-slate-5);
  --input: var(--p-slate-5);               /* inputs need 3:1 on Night's dark card (6.15) */
  --ring: var(--foreground);
  --team-blue: var(--p-azure-400);
  --team-red: var(--p-vermilion-400);
  --on-team: var(--p-ink);
  --team-blue-tint: color-mix(in srgb, var(--team-blue) 12%, var(--card));
  --team-red-tint: color-mix(in srgb, var(--team-red) 12%, var(--card));
  --stripe: rgb(16 20 27 / 0.16);
  --hatch: repeating-linear-gradient(135deg, var(--stripe) 0 4px, transparent 4px 9px);
  --hatch-strong: repeating-linear-gradient(135deg, rgb(0 0 0 / 0.28) 0 4px, transparent 4px 9px);
  --side-block-shade: rgb(0 0 0 / 0.14);
  --you-wash: color-mix(in srgb, var(--primary-fill) 9%, var(--card));
  --live: var(--primary-text);
  --you: var(--primary-text);
  --scrim: rgb(0 0 0 / 0.64);
  /* 1.0's floodlight: azure lamp top-left, amber lamp top-right, the 48px pitch grid */
  --page-light:
    radial-gradient(90% 760px at 8% -140px, rgb(46 155 255 / 0.16), transparent 58%) no-repeat,
    radial-gradient(80% 700px at 96% -120px, rgb(255 207 102 / 0.12), transparent 52%) no-repeat,
    repeating-linear-gradient(0deg, transparent 0 47px, rgb(244 247 252 / 0.04) 47px 48px),
    repeating-linear-gradient(90deg, transparent 0 47px, rgb(244 247 252 / 0.04) 47px 48px);
}

/* ---------- Semantic: Day (overrides only) ---------- */
:root[data-theme="day"] {
  color-scheme: light;
  --background: var(--p-paper-0);
  --foreground: var(--p-paper-9);
  --card: var(--p-paper-1);
  --card-foreground: var(--p-paper-9);
  --raised: var(--p-paper-2);
  --primary: var(--p-amber-800);
  --primary-foreground: var(--p-paper-1);
  --primary-text: var(--p-amber-800);
  /* --primary-fill and --on-primary-fill stay amber + ink; add a 1px --primary-text inset edge in Day */
  --muted-foreground: var(--p-paper-7);
  --destructive: var(--p-rose-700);
  --border: var(--p-paper-3);
  --border-strong: var(--p-paper-5);
  --input: var(--p-paper-5);
  --team-blue: var(--p-azure-700);
  --team-red: var(--p-vermilion-700);
  --on-team: var(--p-paper-1);
  --stripe: rgb(0 0 0 / 0.2);
  --you-wash: color-mix(in srgb, var(--primary-fill) 18%, var(--card));
  --scrim: rgb(14 17 22 / 0.48);
  --page-light: radial-gradient(110% 380px at 50% -140px, rgb(122 79 0 / 0.05), transparent 72%) no-repeat;
}

/* ---------- Component tokens (same in both themes) ---------- */
:root {
  --tap: 44px;
  --seat-min-h: 64px;
  --row-min-h: 56px;
  --chip-h: 28px;
  --role-cell-w: 60px;
  --thead-h: 54px;
  --side-block-w: 46px;
  --winbar-h: 50px;
  --winbar-h-compact: 40px;
  --winbar-h-mini: 10px;
  --side-rule-w: 4px;
  --tabbar-h: 60px;
  --topbar-h: 60px;
  --rail-w: 340px;
  --gutter: 16px;
  --card-pad: 16px;
  --fs-2xs: 0.8125rem;  /* 13 */
  --fs-xs: 0.9375rem;   /* 15 */
  --fs-sm: 1rem;        /* 16 */
  --fs-base: 1.0625rem; /* 17 */
  --fs-md: 1.1875rem;   /* 19 */
  --fs-lg: 1.4375rem;   /* 23 */
  --fs-xl: 2rem;        /* 32 */
  --fs-display: 2.875rem; /* 46 */
  --dur-press: 80ms; --dur-fast: 140ms; --dur-base: 200ms; --dur-slow: 280ms;
}
@media (min-width: 768px)  { :root { --gutter: 24px; } }
@media (min-width: 1024px) {
  :root { --card-pad: 20px; --winbar-h: 60px; --winbar-h-compact: 44px;
          --fs-lg: 1.625rem; /* 26 */ --fs-display: 4rem; /* 64 */ }
}

/* ---------- Faces (sections 4 and 4.1) ---------- */
/* next/font/local (app/fonts.ts, generated by scripts/font-subsets.py) sets --font-{text,mono,display}-core
   (preloaded) and --font-{text,mono,display}-rest (fetched only for a glyph outside the core's
   unicode-range) on <html>. These are the documented names, unlayered so they win over the theme layer's
   same-named self-references. Fallback faces are measured at the instance the app draws (4.1). */
@font-face {
  font-family: "Atkinson Fallback";
  src: local("Arial"), local("ArialMT");
  size-adjust: 100.07%; ascent-override: 98.33%; descent-override: 31.58%; line-gap-override: 0%;
}
/* Martian is monospaced: matched against Courier New (0.600 em), one face per font-stretch drawn.
   size-adjust = Martian advance at wght 500 / 0.6001; ascent 100% and descent 20%, each / size-adjust. */
@font-face { font-family: "Martian Fallback"; src: local("Courier New"), local("CourierNewPSMT");
  font-stretch: 75%;  size-adjust: 99.98%;  ascent-override: 100.02%; descent-override: 20%;    line-gap-override: 0%; }
@font-face { font-family: "Martian Fallback"; src: local("Courier New"), local("CourierNewPSMT");
  font-stretch: 78%;  size-adjust: 101.98%; ascent-override: 98.06%;  descent-override: 19.61%; line-gap-override: 0%; }
@font-face { font-family: "Martian Fallback"; src: local("Courier New"), local("CourierNewPSMT");
  font-stretch: 82%;  size-adjust: 104.65%; ascent-override: 95.56%;  descent-override: 19.11%; line-gap-override: 0%; }
@font-face { font-family: "Martian Fallback"; src: local("Courier New"), local("CourierNewPSMT");
  font-stretch: 85%;  size-adjust: 106.65%; ascent-override: 93.76%;  descent-override: 18.75%; line-gap-override: 0%; }
@font-face { font-family: "Martian Fallback"; src: local("Courier New"), local("CourierNewPSMT");
  font-stretch: 88%;  size-adjust: 108.65%; ascent-override: 92.04%;  descent-override: 18.41%; line-gap-override: 0%; }
@font-face { font-family: "Martian Fallback"; src: local("Courier New"), local("CourierNewPSMT");
  font-stretch: 100%; size-adjust: 116.65%; ascent-override: 85.73%;  descent-override: 17.15%; line-gap-override: 0%; }
/* Archivo: upper case against Arial Bold's; 70% scales the 62% value by Archivo's own 0.5446 / 0.4899. */
@font-face { font-family: "Archivo Fallback"; src: local("Arial Bold"), local("Arial-BoldMT"); font-weight: 800 900;
  font-stretch: 62%; size-adjust: 70.83%; ascent-override: 123.95%; descent-override: 29.65%; line-gap-override: 0%; }
@font-face { font-family: "Archivo Fallback"; src: local("Arial Bold"), local("Arial-BoldMT"); font-weight: 800 900;
  font-stretch: 70%; size-adjust: 78.74%; ascent-override: 111.51%; descent-override: 26.67%; line-gap-override: 0%; }
:root {
  --font-text: var(--font-text-core), var(--font-text-rest), "Atkinson Fallback", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: var(--font-mono-core), var(--font-mono-rest), "Martian Fallback", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --font-display: var(--font-display-core), var(--font-display-rest), "Archivo Fallback", "Arial Narrow", system-ui, sans-serif;
}
/* (in @layer base) visually hidden text never requests a webfont: */
:where(.sr-only) { font-family: system-ui, sans-serif; }

/* ---------- Tailwind v4 mapping ---------- */
@theme inline {
  --color-background: var(--background);   --color-foreground: var(--foreground);
  --color-card: var(--card);               --color-card-foreground: var(--card-foreground);
  --color-raised: var(--raised);
  --color-popover: var(--popover);         --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);         --color-primary-foreground: var(--primary-foreground);
  --color-primary-text: var(--primary-text);
  --color-primary-fill: var(--primary-fill); --color-on-primary-fill: var(--on-primary-fill);
  --color-secondary: var(--secondary);     --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);             --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);           --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);           --color-border-strong: var(--border-strong);
  --color-input: var(--input);             --color-ring: var(--ring);
  --color-team-blue: var(--team-blue);     --color-team-red: var(--team-red);
  --color-on-team: var(--on-team);
  --color-team-blue-tint: var(--team-blue-tint); --color-team-red-tint: var(--team-red-tint);
  --color-you-wash: var(--you-wash);
  --color-live: var(--live);               --color-you: var(--you);

  --font-sans: var(--font-text);          /* utilities font-text (= font-sans), font-mono, font-display */
  --font-text: var(--font-text);
  --font-mono: var(--font-mono);
  --font-display: var(--font-display);

  --text-2xs: var(--fs-2xs);   --text-2xs--line-height: 1.3;
  --text-xs: var(--fs-xs);     --text-xs--line-height: 1.4;
  --text-sm: var(--fs-sm);     --text-sm--line-height: 1.45;
  --text-base: var(--fs-base); --text-base--line-height: 1.5;
  --text-md: var(--fs-md);     --text-md--line-height: 1.25;
  --text-lg: var(--fs-lg);     --text-lg--line-height: 1.25;
  --text-xl: var(--fs-xl);     --text-xl--line-height: 1;
  --text-display: var(--fs-display); --text-display--line-height: 0.95;

  --shadow-*: initial;
  --shadow-overlay: 0 16px 48px rgb(0 0 0 / 0.5);
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --animate-live: live-pulse 2s ease-in-out infinite;
}

/* not inline: these are literal values, so Tailwind emits the variables and the rounded-* utilities */
@theme {
  --radius-card: 8px;  --radius-control: 6px;  --radius-chip: 4px;
  --radius-sm: 4px;    --radius-md: 6px;       --radius-lg: 8px;   --radius-xl: 8px;   /* shadcn aliases */
}

@keyframes live-pulse { 50% { opacity: 0.35; } }

/* ---------- Base ---------- */
html { background: var(--background); -webkit-text-size-adjust: 100%; }
body {
  background: var(--page-light), var(--background);
  color: var(--foreground);
  font-family: var(--font-text);
  font-size: var(--fs-base);
  line-height: 1.5;
}
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after { animation: none !important; transition-property: opacity !important;
                         transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
@media (forced-colors: active) {
  [data-side-fill] { border: 1px solid CanvasText; background-image: none !important; }
}
```

`<meta name="theme-color">`: Night `#05070C`, Day `#E8EEF6`. Every side fill (header, pill, bar segment,
tile block) carries `data-side-fill` so the forced-colours rule reaches it. Fonts: section 4, with the
next/font/local `variable` names `--font-{text,mono,display}-core` and `-rest` under the documented
`--font-text`, `--font-mono`, `--font-display` (`apps/web/app/fonts.ts`; the 1.0 name `--cn-font-archivo`
went with the 1.0 stylesheets in M14.25).

**Where `globals.css` departs from this paste (where rules apply, never a value).** Since M14.25 the base is
global: there is no `kustom2` root class and no scoping. Tailwind is imported as its theme and utilities
layers, and the preflight is a copy (Tailwind v4.3.3) inside `@layer base` in `globals.css`, every selector
zero-specificity (`:where()` or bare `*`) so any utility wins. In that copy: ink and text face on
`:where(html, [data-theme])` (re-declared at every theme boundary); `--fs-base` and
`background-color: var(--background)` on `body` only (on `html` it would move `1rem`); the placeholder is
`--muted-foreground`; headings inherit size and weight and balance; links inherit colour and decoration; the
focus ring above as `:where(:focus-visible)`; `main#main` (the skip-link target) has no ring. **The light is
not on `body`**: it is the `bg-page` utility (`var(--page-light), var(--background)`), put on the element that
is the page (the shell, the kit pages), so bars and dialogs keep their own surface. The overscroll and
anything below a short page show flat `--background`. Theme selectors are `[data-theme]`, not
`:root[data-theme]`, with the derived roles re-declared per boundary, and Tailwind's stock palette, type
scale and radii are wiped so only these exist.

### 7.4 Discord

Section 10 (M14.61) adds the two side embeds and a fourth colour, slate, for AI-written blocks (10.2).

| | hex | int |
|---|---|---|
| teams embed (neither side) | `#FFCF66` | `16764774` |
| blue (side 100) result | `#2E9BFF` | `3054591` |
| red (side 200) result | `#FF6B35` | `16739125` |

Night values, because Discord's default is dark. The worked examples are in 5.5.

### 7.5 Rejected from A and B

- **A (Broadcast)**: near-black ink page `#0A0C10` and card `#12161C` (too dark, the user's verdict); amber
  `#FFB224` (fails 3.4); 2px radius everywhere; tracked all-caps card titles; the amber top edge on the
  receipt; the 1px top-highlight edge; the thin 12px bar with labels above it.
- **B (Scrim Night)**: warm graphite neutrals; Bricolage Grotesque / Rubik / Gabarito display; 20–24px card
  radius and 999 chips; the hard offset "sticker" shadow; tilted badges anywhere except `YOU` and `MVP`;
  amber `#FFD24D`; the team header word in `--foreground` on a tint (C uses a solid fill with `--on-team`).
- **The draft's** two-red hatch stripe (`--team-red-hatch`, 45% mix), the `Win chance` chip, team totals or
  averages in the header, and the 4px leading rule on team cards (the header fill replaces it).

### 7.6 Where 2.0 deliberately differs from `c.css`

The muted text value (7.2; and since 2026-10-04 the whole Night ramp and its light, which are 1.0's, not `c.css`'s), the Day glow (7.2), the `In play` chip (neutral, not amber; 3.4), stickers and the
`Live` tag in the text face rather than Archivo (section 4), error/destructive never on `--raised` (3.5), the
dialog on `--card`, and the phone candidate splits as a compact list (5.5). Everything else matches the
prototype and its screenshots.

---

## 8. Mode card and mode panel (2.0)

Owner: `designer`. Status: **canonical pattern, settled by the user 2026-10-03** ("can we expand the card into a
big modal… so the user can select mode as normal/fearless/region wars/class wars and if rated or not, and any
details specific can be extended from the specific card, not its own page"), on the lead's recommendation
(decision row 2026-10-03, "routed mode panel"). This section **replaces** the earlier §8 "Fearless (2.0)"
(approved the same morning): Fearless is now the first **mode**, its on/off switch is the mode picker ("off"
is `Normal`), and **the planned `/g/<slug>/fearless` page is gone**, replaced by one routed panel,
`/g/<slug>/mode`. What §8 got right is kept below as written: the open-first hierarchy, type sizes, sprites,
counts, the find box and single-select lane control, and the empty and reset states.

Prototype: `redesign/prototypes/mode/` (`python3 build.py`; reuses `../fearless/build.py`'s real roster and
Data Dragon 16.19.1 sprites; `tags.json` is Data Dragon's `tags` at the same pin). The earlier
`redesign/prototypes/fearless/` stays as the source of the pool block. Screens, 375 and 1440:
`redesign/screens/m14/mode-card-states-*.png`, `mode-panel-fearless-*.png` (375 opened on `support`, 1440 on
`All`), `mode-panel-class-tanks-*.png`, `mode-page-direct-*.png` (the URL opened from a Discord link).

**The user's standing requirements, kept as acceptance:** open champions are primary and banned are
secondary; one lane per row on phones; type with a real hierarchy, bigger, not uniform; one card per mode
idea, details in its panel, never a page of its own.

**Out of scope, settled 2026-10-03: the companion UI.** The user will replace the companion's UI completely.
Every overlay spec the earlier §8 proposed (open-first for your lane in the champ-select panel, sprites in
the panel) is **deferred: companion UI replacement** (8.13 B). The `GET /api/overlay` payload is untouched by
this section.

### 8.1 Who looks at it, and when

The night runs in a loop: **finished → filling → balanced → champ select → in game → finished**. A mode
answers *"what am I allowed to play?"* and its follow-up *"what's left for my lane?"*. Fearless asks it at two
moments, every other mode at one:

| Moment | Who | Where they are | What they need |
|---|---|---|---|
| **Teams set, champ select about to start** (balanced) | all ten, each about one lane | phone in hand in Discord voice | their lane's allowed champions, at once; a yes/no check on one name. **About 60 seconds.** |
| **A game just ended** (finished, Fearless only) | the people who played | phone, reading the result | which ten just joined the ban list, and how big the pool is now |
| **Before Roll teams** | an admin or the owner | Tonight, usually the host at the PC | pick tonight's mode, rated or not |

Nobody needs a 172-champion roster on an idle evening or mid-game, so **Tonight carries a card, never the
pool**. The pool lives one tap away in the panel, which opens on the viewer's lane when they have one.

**We still never read champion select** (CLAUDE.md). A mode is announced (card, Discord), displayed (panel)
and checked afterwards from the end-of-game block (M15). Nothing ever blocks a pick.

### 8.2 The pattern: one card, one routed panel

- **One `Mode` card on Tonight** summarises tonight's mode: its name, `Rated` or `Not rated`, and one status
  line the mode supplies (Fearless `138 open · 34 banned`; Region wars `Ionia vs Noxus`; Class wars
  `Tanks only`). Admins and the owner change the mode and the rated flag **on the card**; members see the
  state only. Reset fearless also lives on the card (admins, AlertDialog 5.13).
- **Tapping the card opens the mode panel** over Tonight: a large dialog at ≥ 1024, full screen below. It
  holds the mode's detail: for Fearless the pool tool (8.7), for other modes their rule and pool (8.10).
- **The panel is a URL**, `/g/<slug>/mode` (with `?lane=<role>`). Opened from Tonight it overlays and Back
  closes it; opened directly (a Discord link, a refresh, a WhatsApp paste) the same URL renders as a full page
  inside the shell (`mode-page-direct-*.png`). **No nav tab, no More card, no `/fearless` page.**
- One card, whatever the mode. New modes (M15) add a definition (8.10), not a card, a page or a route.

**Visibility rule: the card shows in every Tonight state, for everyone, whatever the mode** (lead ruling
2026-10-03, M14.30 round 1; it replaces this section's earlier "no card for plain `Normal` + `Rated`" rule,
because the build brief's "every Tonight state, for everyone" wins). In `Normal` the card reads `Normal` ·
`Rated` · `Every champion is open.`: answering *"what am I allowed to play?"* with "anything" is still an
answer, and a card that comes and goes with the mode would move the page under people. Admins and the owner
get the same card plus the controls foot (it is where the picker lives); members and visitors get the card
with no form. An unrated `Normal` game reads `Normal` · `Not rated`.

### 8.3 The card on Tonight, per state

Placement follows STRATEGY §6(a)'s order; the card never moves above the strip or the team cards.

| State | Card body (mode = Fearless; other modes in the last column) | Place | Other modes |
|---|---|---|---|
| Empty group | The card for everyone (8.2); admins and the owner also get the picker, so a mode can be set before the first game. | after the empty-state card | same |
| **Idle** | **Row**: title + chip, `138 open · 34 banned`, `See what's open ›`. 64px min at ≥768; status and action stack at 375. Empty pool: `Nothing banned yet. All 172 open.` | after `Top this week` (5.15) | title + chip, the rule (`Tanks only`), `See the tanks ›` |
| **Filling / more than ten** | Row + **five lane tiles** (`top 32`, `jungle 34`…; `--raised`, 64px), each a link to the panel on that lane (`/mode?lane=jungle`). The find box moved into the panel. | under the roster and `Still needed:`, before the tape | row; tiles show each lane's allowed count where the mode has a pool |
| **Balanced** | Row + **your lane**: `◈ Your lane support · 24 open`; the whole row links to `/mode?lane=support`, so the panel **opens on the viewer's lane**. Not seated (visitor, sitting out): no lane line, link to `/mode`, panel opens on `All`. **The answer band's `What's open for support` links to the same URL** and opens the panel. | directly after the team cards (the sit-out note is above the receipt, 5.15) | `Your lane support · 11 tanks`; answer band `Tanks for support` (the mode supplies the label; `Normal` supplies none) |
| **In game** | Row + `This game's ten join the ban list when it ends.` Admin controls stay, with `Changes apply from the next game.` under the select. | after the team cards | row; the rule |
| **Finished** | **`Banned next game`** leads the card: meta `from game 4`, five rows (60px role cell + the two chips, blue's seat then red's), footer counts. Then the row, under a muted eyebrow **`Next game`** (text 15 muted), so its chip reads as the next game's (M15.15). Hidden for an ARAM or a remake (they add nothing): the `Next game` row alone. A Rift game played not rated: `Not rated, so this game banned nothing.` where `Banned next game` would be, then the `Next game` row. | directly under the result poster, before the tape | the `Next game` row; the kept/broke line is the poster's (M15.5), not the card's |
| **Mirror match on a Fearless night** (M15.14) | The card keeps the Fearless pool: mirror is a lane rule, every ban stands. Pending or locked, status `Same champion as your lane opponent · 138 open` (text 700 23) + `This game only. Then back to Fearless.`, action `How it works ›`. Balanced, seated: `◈ Your lane support · 27 open`, answer band `What's open for support`. In game: `This game's champions join the ban list when it ends.` (five, not ten: each lane's two seats locked one champion). Finished: `Banned next game` lists each champion once (one chip per lane). Idle, the strip's host line `Mirror match next. Host: open a Blind Pick custom in League yourself. Start a lobby only makes Draft Pick.`; filling, `Mirror match next. It needs a Blind Pick lobby. If this one is Draft Pick, the host opens a Blind Pick custom in League and everyone moves to it.` (M15.16; dashed note, lead in 700). On a Normal night, mirror is unchanged: no pool, no counts. | as the state | n/a |
| **Not rated on a Fearless night** (M15.15) | A game that isn't rated adds nothing to the pool (R4), so no line promises bans. Balanced and in game, under the counts: `This game isn't rated, so it bans nothing.` Finished: see the Finished row. Before Roll, the panel when the next game is not rated: `Still open, by lane. Next game isn't rated, so it bans nothing.`; once the teams are set: `Still open, by lane. This game isn't rated, so it bans nothing.`; empty pool: `Nothing banned yet, so every champion is open. This game isn't rated, so it bans nothing.` (or `Next game isn't rated, …` before Roll). The strip's in-game sentence becomes `Not rated, so no Rating change.` in the same state, so the strip and the card never disagree. | as the state | the rule's own `Not rated: Ratings don't move.` |
| Balanced, empty pool | Dashed card: `172 open · 0 banned`, `Nothing banned yet, so every champion is open. The ten you lock this game are banned next game.` | as balanced | n/a |
| Reset moment (Realtime) | Dashed card: `Fresh pool.` + `Raafat reset fearless, so every champion is open again.` · `reset 21:40`, until the next game lands. Announcer: `Fearless reset. Every champion is open again.` | in place | n/a |
| Mode changed (Realtime) | The card re-renders in place (it never disappears, 8.2); after a switch to Normal, members get a dashed note inside the card (`Back to Normal.` / `An admin set tonight to Normal, so every champion is open.`) until the next game lands. A one-game M15 mode returns to the standing mode after its game, which reads as this same change. Announcer: `Tonight's mode is now Class wars: Tanks only.` | in place | same |

### 8.4 The card, visually

#### 8.4.1 Anatomy (375, `mode-card-states-375.png`)

```
┌──────────────────────────────────────────────┐ card, --card, 1px --border, radius 8, overflow hidden
│ Fearless [Rated]                              │ h2 text 700 19 · rated chip
│ 138 open   34 banned                          │ status: mono 600 23 + text 15 muted · mono 17 muted
│ ◈ Your lane support · 24 open                 │ balanced only: icon 20, mono 16 role, mono 16 count
│ See what's open ›                             │ action, text 700 16 underlined; right column ≥768
│                     (all of the above is one <a>, the whole row is the target)
├──────────────────────────────────────────────┤ admin foot: border-top, --raised at 45% over --card
│ Admins and the owner                          │ mono 13 muted
│ Mode                                          │ label text 700 15
│ [ Fearless                                 ⌄ ] [Set mode]   native <select> 44px; button only when changed
│ (●─) Rated                                    │ M15 only: shadcn Switch, 44px row, 700 17
│      Next game is rated.                      │ state sentence 15 muted
│ [ Reset fearless ]                            │ secondary button; Fearless with ≥1 ban only
└──────────────────────────────────────────────┘
```

- **The row is one link** (`<a href="/g/<slug>/mode?lane=…">`), so the card works without JS (it navigates to
  the full page). The admin controls are **outside** the link (no interactive element inside an `<a>`).
- **Rated chip**: `Rated` = neutral chip (`--raised`, solid `--border`, text 700 14); `Not rated` = dashed
  `--border-strong`, transparent, muted (dashed = "absent", 5.7). Words, never colour alone.
- **Status line is the mode's level 1**: Fearless's two counts (open first) or the rule as text 700 23
  (`Tanks only`), or two side names with their glyphs for Region wars (8.10).
- **Action label** comes from the mode: `See what's open` (Fearless), `See the tanks` (class), `See both
  pools` (region), `All modes` (Normal, admins).

#### 8.4.2 The admin controls

- **Mode: native `<select>`** (5.0's rule: the OS picker is the best phone picker), options `Normal`,
  `Fearless`, then `<optgroup label="Class wars">` (`Tanks only`, `Marksmen only`, `Mages only`, `Assassins
  only`, `Supports only`), `<optgroup label="Region wars">` (`Region wars (sides drawn at roll)`). Only the
  group's enabled modes are listed (M15.1). **No auto-submit on change**: on Windows, arrowing through a closed
  select fires `change` per option, which would cycle the live mode for everyone. A primary `Set mode` button
  appears beside it once the selection differs from the current mode; without JS it is always shown (one
  `<form method="post">` with `redirectTo`). Room is left for M15's `Spin` as a secondary button on this row.
- **Rated: shadcn `Switch`, M15 only.** Product's 2026-10-03 row: no rated toggle and no rated column in M14;
  Normal and Fearless are rated exactly as today and the chip is derived from the mode. **In M14 the card shows
  the chip and no switch.** When M15.1 allows an override, the switch goes here as drawn (no confirm, effect
  shown in place, said once by the announcer; sentences `Next game is rated.` / `Next game is
  recorded, not rated.`); choosing an M15 mode sets it to that mode's default. The prototype draws the switch
  so M15 has its place.
- **Reset fearless**: secondary button, only while the mode is Fearless and the pool has ≥ 1 ban; opens the
  AlertDialog of 5.13 (8.11's copy), initial focus on Cancel.
- **Fearless semantics carry over from M14.29 unchanged**: any mode other than Fearless is "fearless off"
  (the pool freezes, games add nothing); choosing Fearless again resumes the list where it stopped; a fresh
  pool is only ever Reset.
- **In game**: `Changes apply from the next game.` sits under the select; the running game keeps the mode
  and rated flag it started with (the stamp is the server's, M14.29 / M15.3).
- Members and visitors get no form at all, not a disabled one.

### 8.5 The panel

#### 8.5.1 URL and routing

- `/g/<slug>/mode`, optional `?lane=top|jungle|mid|adc|support|all`. Built with Next.js **parallel +
  intercepting routes**: a `@panel` slot in `app/(group)/g/[slug]/layout.tsx` (its `default.tsx` renders
  nothing), `@panel/(.)mode/page.tsx` renders the overlay when navigated to from Tonight, and
  `g/[slug]/mode/page.tsx` renders the full page on a hard load. Both render the same `ModePanelBody`.
  `mode` is a static segment, so it wins over the existing `[...rest]` catch-all. Intercepting matches route
  segments, not groups, so `(tonight)` does not affect `(.)mode`: the web engineer verifies the soft
  navigation from `/g/<slug>` in a test.
- Opened from Tonight it is a **push** (Back closes it). Inside the panel, the lane control and find box are
  client state and never touch the URL (8.7.4); `?lane=` is only the initial value.
- `<title>` becomes `<Mode> | Kustom` while open (`Fearless | Kustom`); the OG card for `/mode` is the mode's
  name and status line (M14.10's OG module).
- A mode change while the panel is open re-renders it to the new mode in place, with the announcer line
  (8.3). Pool growth (a game landing) updates the counts in place.

#### 8.5.2 Phone (< 1024) vs desktop (≥ 1024)

| | < 1024 | ≥ 1024 |
|---|---|---|
| Frame | **full screen**, `--card` fill, covers the top bar and the tab bar | **dialog**, `min(1180px, 100vw − 64px)` wide, 32px from the top, max-height `100vh − 64px`, radius 8, 1px `--border-strong`, `--shadow-overlay` (the AlertDialog's exception, extended here) |
| Behind | nothing visible | Tonight under a scrim `rgb(10 13 18 / .74)`, no blur |
| Bar | sticky 56px: crumb `Tonight · Mode` (15 muted) left, **`× Close`** right (44px, icon + word, `--raised`, 1px `--border`) | same, padding 24 |
| Body | scrolls inside the panel (`overscroll-behavior: contain`), padding 16, safe-area bottom | padding 20 24 |
| Fearless | one lane, 2-column chip grid; `All` stacks lanes | `All` = the five-column draft board (8.7.6) |
| Head | h2 (h1 on the direct page) text 700 32 + rated chip; `Pool since Thu 1 Oct, 4 games. Every champion locked since then is banned.` | same |
| Foot | admins: `To change the mode or reset, use the Mode card on Tonight.` (no control in the panel) | same |

The panel holds **reading and filtering, never decisions**: no picker, no switch, no Reset inside it (those are
the card's, and an AlertDialog over a panel would be a nested panel).

#### 8.5.3 The direct page

The same body in the shell's `<main>`, under a breadcrumb `Customs Night · Tonight` (links to `/g/<slug>`), h1
instead of h2, no scrim, no Close button (the breadcrumb and the nav are the way out). Tab bar highlights
Tonight. If the group has no mode beyond the default, it shows `Normal`'s body (the list of enabled modes,
one sentence each) rather than a 404, so an old Discord link still lands somewhere true.

### 8.6 The routed-panel rule (an exception to 5.0's "no content modals")

5.0 bans content modals on public pages: a phone modal over a live page hides the thing that is changing,
has no URL, can't be pasted into WhatsApp, and Back leaves the page instead of closing it. **That ban stands
for every plain modal.** A content panel is allowed only when **all** of these hold:

1. **It is a route.** It has its own URL; loaded directly, that URL renders the same content as a full page in
   the shell. Its trigger is an `<a href>`, so without JS it is just a link to the page.
2. **Back closes it, and so do Esc and the `Close` button.** Close is `router.back()` when the panel was
   pushed from the page behind it, and a link to `/g/<slug>` otherwise (never a dead end).
3. **Full screen below 1024**, a dialog at ≥ 1024. Never a bottom sheet, never a half-height phone modal.
4. **Real dialog semantics**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` its heading; focus moves
   to the heading on open (`tabindex="-1"`; not the search box, which would pop the phone keyboard), is
   trapped inside, and **returns to the trigger** on close (the card row or the answer-band link, by id); the
   page behind is `inert` and does not scroll.
5. **One at a time.** No panel opens from a panel, no AlertDialog opens over it, no toast.
6. **Reading and filtering only**: every control that changes shared state stays on the page behind.
7. **Live stays audible**: Tonight's single announcer lives in the shell outside the `inert` subtree, so
   Realtime changes are still spoken while the panel is open, and the panel's own content updates in place.

Why this one is allowed: during the 60 seconds before champ select, the pool *is* the thing the player is
looking at; Tonight behind it has nothing left to change for them (teams are set), and Back returns them to it
instantly with focus where they left. **Registry: `mode` is the only routed panel.** A second one needs a
decision row that names which of the seven it meets.

### 8.7 Fearless inside the panel

#### 8.7.1 Anatomy (375, `mode-panel-fearless-375.png`)

```
┌──────────────────────────────────────────────┐ panel bar, sticky 56
│ Tonight · Mode                      [× Close] │
├──────────────────────────────────────────────┤
│ Fearless [Rated]                              │ heading text 700 32 + chip
│ Pool since Thu 1 Oct, 4 games. Every champion │ 16 muted
│ locked since then is banned.                  │
│ 138 open   34 banned                          │ counts: mono 32 / text 17 700 · mono 19 / text 15 muted
│ Still open, by lane. Played champions are     │ --fs-sm muted
│ banned next game.                             │
│ Find a champion                               │ visible label, text 700 --fs-xs
│ [ Ahri, Lee Sin, Wukong…                    ] │ search input 44px, 17px
│ [ All ][ ▢ top ][ ⋀ jungle ]                  │ lane control, 3 + 3 at 375, one row ≥768
│ [ ▢ mid ][ ▢ adc ][■ support ]                │ pressed = --foreground fill, --card text
│ Your lane this game: support. Show every lane │ only when opened on the viewer's lane
│ Ahri is still available.                      │ the answer line, role="status", empty = no box
│──────────────────────────────────────────────│
│ ⛉ support                           24 open  │ h3: icon 24 + mono 23/600 · mono 19 + text 15 muted
│ [▣ Alistar     ] [▣ Bard        ]             │ open grid, 2 columns at 375, chips 40px
│ …                                             │
│ Banned 8 ⌄                                    │ <details> closed, 44px summary, muted
└──────────────────────────────────────────────┘
```

#### 8.7.2 Type hierarchy (this is the rule; "too uniform" is what it fixes)

| Level | Element | Type | Colour |
|---|---|---|---|
| 0 | panel heading `Fearless` | text 700 **32** (`--fs-xl`) | `--foreground` |
| 1 | open count `138` | Martian Mono 600, **32** (`--fs-xl`), `font-stretch` 85% | `--foreground` |
| 2 | lane word `support` | Martian Mono 600, **23** (`--fs-lg`), lower case, 88%, with a 24px `RoleIcon` | `--foreground` |
| 3 | per-lane `24` and the banned count `34`; the answer line | mono 600 19 / text 700 19 (`--fs-md`) | foreground; banned total `--muted-foreground` |
| 4 | **open chip names** | text **600, 17** (`--fs-base`) | `--foreground` |
| 5 | banned chip names; `open` / `banned` words; labels; sentences | text 400 15–16 | `--muted-foreground` |

On the card the same ladder runs one step smaller (title 19, count 23, banned 17), so the card never shouts
louder than the panel. Archivo is not used in modes (display is for the strip headline and side names only).

#### 8.7.3 The chip and the icon

The icon exception from `05-design-1.0.md` carries over: **24 × 24, square, radius 4, never a circle, no
crop, no ring, no glow, `aria-hidden`, the name is the accessible text, an icon never appears without its
name.** Source: Data Dragon sprites (8.8).

| Chip | Box | Name | Icon |
|---|---|---|---|
| **Open** (primary) | grid cell, min-height 40, padding `4 6 4 5`, gap 7, `--raised` fill, 1px `--border`, radius 4 | text 600 17, `--foreground`, wraps at spaces (`overflow-wrap: break-word`, never `anywhere`) | full |
| **Banned** (secondary) | inline chip, natural width, min-height 34, transparent, 1px **solid** `--border` (dashed means an empty seat), radius 4 | text 400 15, `--muted-foreground` | `opacity: .55`, no greyscale filter |
| **Find hit** | the chip it is, **inverted**: `--foreground` fill, `--card` text | as its row, in `--card` | full |
| `Banned next game` chips (card, finished) | the open dress | 600 17 | full: here the ban *is* the news |
| Unknown id or not in the pinned `champion.json` | no icon box at all | as its row | none |
| **Region tag** (M20, 8.15) | a second line under the name, inside the same box, on every chip above | text 400 13, `--muted-foreground` (`--card` on a find hit) | unchanged |

The hit is inverted, not amber (amber means live, you and the primary action only, 1.2). Chips are not
controls, so 40px, not 44. Measured at 375: `Heimerdinger` (109px) fits the 150px cell; at 320 the grid drops
to one column, so no name breaks mid-word.

#### 8.7.4 Find box and lane control

- **Find box**: shadcn Input restyle, `type="search"`, 44px, 17px, `--background` fill, visible label `Find a
  champion`, placeholder `Ahri, Lee Sin, Wukong…`. Substring match on normalised names; an exact name prints
  `<Name> is on the ban list.` / `<Name> is still available.`; **typing ignores the lane control and opens
  every `Banned` fold**; per-lane counts hide while typing; `No champion matches.` when nothing does.
- **Lane control: single select `All · top · jungle · mid · adc · support`**, `aria-pressed` buttons in a
  `role="group"` named `Lane`, 44px, `RoleIcon` 20 + mono 15, `All` in the text face 700, pressed = inverted.
  3 + 3 at 375, one row beside the box ≥ 768. Initial value: `?lane=`, else the viewer's seat in balanced,
  else `All`. Client state after that, never pushed to the URL.

#### 8.7.5 Banned as secondary, and counts

Each lane ends with a native `<details>` **closed by default** (`Banned` + mono count + chevron, 44px,
muted); its chips wrap at natural width. `other` (a first lock with no stored role) appears only under `All`.
Counts read `138 open · 34 banned` everywhere, open first; screen-reader text is the visible text. Totals are
the roster (172) minus the pool; an id outside the roster counts as banned, not open.

#### 8.7.6 375 vs 1440

| | 375 | ≥ 1024 (dialog) |
|---|---|---|
| Tools | label, box, then lane control 3 + 3 | box (260–380px) and the control in one row |
| One lane | 2-column grid | `minmax(168px,1fr)` → 5–6 columns |
| `All` | lanes stacked top → support | **draft board: five lane columns**, each a single column of chips, `Banned` fold at its foot (`mode-panel-fearless-1440.png`) |

#### 8.7.7 Empty and reset

Dashed `--border-strong` card (dashed = "not yet", 5.7), one sentence, no find box: the balanced empty pool and
the reset moment of 8.3. Inside the panel an empty pool shows the same sentence under the counts and every
lane's full open grid (everything is open), with no `Banned` folds.

### 8.8 Icons and performance

**The panel uses Data Dragon champion sprite sheets, not 172 image files; the Mode card does not.**
Measured 2026-10-03 on `16.19.1`: **6 sheets** (`img/sprite/champion0–5.png`, 480 × 144, 48px cells), **842 KB total**, against
~4.9 MB for 173 single 120px icons. A 48px cell is exactly 2× for a 24px box. Coordinates come from M14.8's
checked-in `champion.json`, keyed by numeric `key` (Wukong is `MonkeyKing`, key 62).

- Markup: `<i class="ico" aria-hidden="true">`, `background-size: 240px 72px`, `background-position: -x/2
  -y/2`. `championSprite(id) → { sheet, x, y } | null` replaces `championIconUrl`.
- **Panel: six sheets, never `loading="lazy"`** (the audit's "blank until scrolled"). The sheets are preloaded
  (`<link rel="preload" as="image" fetchpriority="low">`) when the panel renders **and on intent**: pointer over
  or focus on any link into the panel (the card row, the lane tiles, the answer band's jump), so the panel
  paints its icons on open.
- **Mode card on Tonight: never loads the sheets** (ruled M14.45). Its `Banned next game` chips use each
  champion's own square through Next's image optimizer: 24 × 24 box, `loading="lazy"`, 1× and 2× WebP. A
  finished Tonight with ten banned champions costs ten small squares, not 842 KB of sheets. Same box, radius and
  chip geometry as the sprite crop it replaced; nothing in the chip moves.
- Preconnect to `ddragon.leagueoflegends.com` wherever Fearless shows (the card or the panel). The card's
  squares come from our own origin through the optimizer; the preconnect is for the sheets, which an intent
  preload may fetch from any screen that shows the card.
- `content-visibility: auto; contain-intrinsic-size: auto 520px` per lane section; hidden lanes are `hidden`.
- **Failure**: one `new Image()` per sheet; on `error` the panel gets `data-icons="off"` and every icon box goes
  (one reflow). A champion newer than the pin is name-only until the pin bump.
- **Bundle**: the panel body is its own client island, loaded with the `@panel` route; Tonight's live island
  does not grow (the card is server-rendered plus a small controls form for admins).

### 8.9 Accessibility

- Card: `section` labelled by its h2; the row link's accessible name is its visible text (`Fearless Rated 138
  open 34 banned See what's open`); tiles are links named `top 32` etc.; the controls form is labelled `Mode
  settings`, the select by its visible `Mode` label, the M15 switch is `role="switch"` named `Rated`.
- Panel: the seven rules of 8.6 (dialog semantics, focus to heading, trap, `inert` behind, focus return to the
  trigger, Esc/Back/Close, announcer outside `inert`). Heading level: h2 in the overlay (Tonight keeps its h1),
  h1 on the direct page; lanes are h3. The answer line is the panel's only `role="status"`.
- Forced colours: the dialog gets a 2px `CanvasText` border; hit and pressed get system outlines; the switch
  track gets a `CanvasText` border. Reflow at 320: one-column grid, no horizontal scroll (checked in the
  prototype at 375 and 1440: no sideways scroll, every control 44px except inline sentence links).
- Reduced motion: the panel appears with no transition (it is a route change, not an animation).

### 8.10 How M15 modes plug in

A mode is **one definition**, not a component tree. The card and the panel are shared; a mode supplies:

| Field | Fearless | Class wars | Region wars |
|---|---|---|---|
| `name` / option label | `Fearless` | `Class wars` / `Tanks only` (one option per class) | `Region wars` |
| `status` (card level 1) | `138 open · 34 banned` | `Tanks only` | `◣ BLUE Ionia` vs `◥ RED Noxus` (side glyph + display face side word, region in text 700 23; `Sides drawn when teams are rolled.` before balanced) |
| `actionLabel` | `See what's open` | `See the tanks` | `See both pools` |
| `laneLabel(role)` (answer band) | `What's open for support` | `Tanks for support` | `Ionia for support` (your side's region) |
| `ratedDefault` | rated | not rated (M15) | not rated (M15) |
| `finishedBody` | `Banned next game` | none (poster line, M15.5) | none |
| `panelBody` | pool tool (8.7) | rule sentence + the class pool with find and lanes | **two pools side by side** at ≥ 1024 (blue's region left with `--tint-blue` head, red's right with `--tint-red` and the hatch), stacked blue then red at 375, your side first; same find box and lane control |
| data | fearless pool | Data Dragon `tags` (M15.4) | the region table (M15.9), words only |

- **Class wars panel** (`mode-panel-class-tanks-*.png`): heading `Class wars` + `Not rated`, rule `Tanks only`
  (text 700 23), sentence `Every pick this game is a champion Riot tags Tank. Nobody is stopped in champ
  select; the result post says which side kept the rule. Not rated: ratings don't move.`, counts `46 tanks of
  172 champions`, then the same find box and lane control, champions grouped by their usual lane (from
  `lanes.ts`). A lane with none says so in words: `No tank is usually played here. Any tank on this list may
  go adc.` (16.19.1: top 18, jungle 16, mid 1, adc 0, support 11). Banned folds do not exist outside Fearless.
- **Fearless counts as a mode, one at a time.** Combining (Fearless + Tanks only) is not designed; if product
  wants it, the panel shows the class pool minus fearless bans with Fearless's banned folds (M15.2's
  `modePool` already subtracts), and the card's status reads `Tanks only · 12 open`.
- Mode names are words; no crests, region art, class icons or lore text (M15's rule).

### 8.11 Copy (new or changed)

| Where | Copy | Status |
|---|---|---|
| card title | the mode name: `Normal`, `Fearless`, `Class wars`, `Region wars` | [NEW COPY] |
| rated chip | `Rated` / `Not rated` | [NEW COPY] |
| card status, Fearless | `138 open · 34 banned`; empty `Nothing banned yet. All 172 open.` | [NEW COPY] |
| card action | `See what's open` / `See the tanks` / `See both pools` / `All modes` | [NEW COPY] |
| card, balanced | `Your lane support · 24 open` (`· 11 tanks`) | [NEW COPY] |
| card, in game | `This game's ten join the ban list when it ends.` | [NEW COPY] |
| card, Normal (everyone) | `Every champion is open.` (replaces `Standard draft, nothing narrowed. Only admins see this card.`, retired by the 8.2 ruling) | [NEW COPY] |
| card, finished | `Banned next game` · `from game 4` | [NEW COPY] |
| answer band | `What's open for support` / `Tanks for support` / `Ionia for support` | [NEW COPY] |
| controls | `Admins and the owner`; label `Mode`; button `Set mode`; in game `Changes apply from the next game.`; failure `Couldn't change that. Try again.`; M15: switch `Rated`, `Next game is rated.` / `Next game is recorded, not rated.` (lead 2026-10-04: both describe the next game) | [NEW COPY] (replaces M14.30's switch copy) |
| reset | `Reset fearless`; AlertDialog `Reset the fearless pool?` / `All 34 bans are cleared and every champion is open again. Discord gets told.` / `Reset fearless` · `Cancel` | button shipped; dialog [NEW COPY] |
| panel bar | `Tonight · Mode`, `Close` | [NEW COPY] |
| panel head, Fearless | `Pool since Thu 1 Oct, 4 games. Every champion locked since then is banned.` | [NEW COPY] |
| panel, Fearless | `Still open, by lane. Played champions are banned next game.`; `Find a champion` / `Ahri, Lee Sin, Wukong…`; `Lane`; `Your lane this game: support.` + `Show every lane`; `Banned` + count | sentence and label shipped; rest [NEW COPY] |
| answer lines | `<Name> is on the ban list.` / `<Name> is still available.` / `No champion matches.` | shipped |
| panel foot, admins | `To change the mode or reset, use the Mode card on Tonight.` | [NEW COPY] |
| panel, class | `Tanks only`; class sentence (M15.19, one shape per class, `a`/`an` from the word): `Everyone picks a tank this game: any champion Riot lists as a Tank. Nobody is stopped in champ select; the result post says which side kept the rule. Not rated: Ratings don't move.` (`Everyone picks an assassin this game: any champion Riot lists as an Assassin. …`; rated tail `Rated: Ratings move as usual.`); `46 tanks of 172 champions`; `No tank is usually played here. Any tank on this list may go <lane>.` | sentence [NEW COPY] (M15.19; replaces `Every pick this game is a champion Riot tags Tank.`) |
| empty / reset / mode change | `Nothing banned yet, so every champion is open. The ten you lock this game are banned next game.`; `Fresh pool.` + `Raafat reset fearless, so every champion is open again.` · `reset 21:40`; `Back to Normal.` + `An admin set tonight to Normal, so every champion is open.` | [NEW COPY] |
| card, mirror on Fearless (M15.14) | status `Same champion as your lane opponent · 138 open`; `This game only. Then back to Fearless.`; balanced `Your lane support · 27 open`; answer band `What's open for support`; in game `This game's champions join the ban list when it ends.`; panel: the mirror sentence (`You and your lane opponent play the same champion. It needs a Blind Pick lobby. Nobody is stopped in champ select; the result post says which lanes kept it. Rated as usual.`) above the Fearless pool | [NEW COPY] |
| strip, mirror host line (M15.16) | idle `Mirror match next. Host: open a Blind Pick custom in League yourself. Start a lobby only makes Draft Pick.`; filling `Mirror match next. It needs a Blind Pick lobby. If this one is Draft Pick, the host opens a Blind Pick custom in League and everyone moves to it.` | filling [NEW COPY] |
| card, not rated on Fearless (M15.15) | balanced and in game `This game isn't rated, so it bans nothing.`; finished, where `Banned next game` would be, `Not rated, so this game banned nothing.`; strip in game `Not rated, so no Rating change.` | [NEW COPY] |
| card, finished eyebrow (M15.15) | `Next game` (above the row, so its `Rated` / `Not rated` chip is the next game's) | [NEW COPY] |
| panel, not rated on Fearless (M15.15) | `Still open, by lane. This game isn't rated, so it bans nothing.` / `Still open, by lane. Next game isn't rated, so it bans nothing.`; empty pool `Nothing banned yet, so every champion is open. This game isn't rated, so it bans nothing.` (`Next game …` before Roll). Designer-approved 2026-10-04: the `This game` form once teams are set, the `Next game` form before Roll, pairing with `Next game is recorded, not rated.` | [NEW COPY], approved |
| tape tile and `/games` row note (M15.19) | `Tanks only · not rated`, `Ionia vs Noxus · not rated`, `Mirror match` (rated: the name alone), in the shape of `ARAM · not rated`; text 15 muted, its own line under the odds line. The kept/broke check line never goes on these rows (D6). A region id missing from the pinned table prints its id with each hyphen-separated word capitalised (`newland` → `Newland`, `blessed-isles` → `Blessed Isles`), never blank | [NEW COPY], approved |
| announcer | `Fearless reset. Every champion is open again.` / `Ten more banned next game.` / `Tonight's mode is now Class wars: Tanks only.` / `This game is now rated.` / `This game is now not rated.` | [NEW COPY] |

Retired before shipping: `Open the full pool`, the `/fearless` page copy, the More `Fearless` card, M14.30's
`Fearless is off` / `On. Champions you lock…` switch sentences (off is now `Normal`).

### 8.12 Discord fearless post (text layout)

> M14.61 restyles both posts (section 10.8): same copy and fields, plus the shared identity and the lane counts.

As shipped in M14.31 (`fearlessEmbed` and `fearlessResetEmbed` in `apps/web/lib/discord/embeds.ts`, copy in
`apps/web/lib/fearless/copy.ts`, sent by `postFearlessPool` / `postFearlessReset` in `lib/discord/post.ts`).
These two posts link the mode panel from their title. Since M15.6 the teams post (and its Reroll posts) also
opens its description with the rule line, or `This game: not rated.`, the rule line carrying the panel URL as raw
text (`See the tanks: <url>`, `See both pools: <url>`, mirror `How it works: <url>`); the result post carries the
kept/broke/couldn't-check line and `Not rated, so no Rating change.` under its odds line, champions only
(`lib/discord/modeLines.ts`). A rated Normal or Fearless game's posts are unchanged. No post goes out when the
mode changes, and there is no separate mode message.

**Which post, and when.** This is its own message, never part of the result. It goes out after a **rated** game
finishes, right after the result post, to the game's group's channel. It is sent only when:

| Group mode at post time | Pool | Post |
|---|---|---|
| `Normal` | any | nothing (skipped, `group mode is normal`); the result post is unchanged |
| `Fearless` | empty | nothing (skipped, `fearless pool is empty`) |
| `Fearless` | one or more bans | the pool post below |

The reset post goes out when an admin resets the pool, in Fearless only. In Normal the pool cursor still moves
but nothing is posted, and the reset route answers `post: 'skipped'`.

**The pool post, top to bottom:**

1. Accent bar `16764774`, the same as the teams post: the list belongs to neither side.
2. Title `Fearless`, linking `/g/<slug>/mode`: the mode panel, which opens as a full page from Discord. It has
   no `?lane=` and never links `/fearless`.
3. Description `Banned next game: <n> more, <total> in all. <open> still open.` `<n>` counts the champions this
   game locked first since the reset, so it is ten on an ordinary game and fewer when a lock repeated a ban.
   `<total>` is the whole pool. `<open>` counts the roster champions that have a lane and are not banned.
   The description is one plain line: no `-#` subtext and no italics. `EXPLANATION_STYLE` (`'subtext'`, with
   `'italic'` as the fallback) applies only to core's sentence on the teams post (5.5) and does not touch
   this post.
4. One non-inline field per lane, in the order `top`, `jungle`, `mid`, `adc`, `support`. A lane with no bans
   gets no field. If a banned champion has no lane, it goes in a last field named `other`. The field name is
   the lane word in lower case. The value is **one line** joined with `, `: **this game's new names first and
   bold** (A to Z), then the rest of the lane A to Z. A repeat lock is never bold. Names are markdown-escaped
   (`` ` `` `*` `_` `~` `|` `\`), so `K'Sante` and `Kai'Sa` print as they are and a `*` cannot un-bold the
   names next to it. A full 172-champion pool fits inside every embed limit without dropping a lane.
5. Footer `Kustom · tap the title to see what's still open`, plus the timestamp.

Captured from the real post for game 2 (`redesign/scene-walk.md`): `Fearless` /
`Banned next game: 10 more, 10 in all. 166 still open.`, with lane fields and the new ten in bold. A later
game, filled in:

```
Fearless                                   <- title, links to /g/customs/mode
Banned next game: 10 more, 34 in all. 138 still open.
top
**Aatrox**, **Gnar**, Camille, Darius, Fiora, Garen, Jax
jungle
**Lee Sin**, **Vi**, Graves, Kha'Zix, Sylas, Viego
mid
**Ahri**, **Syndra**, Akali, Orianna, Viktor, Yasuo, Zed
adc
**Jinx**, **Kai'Sa**, Caitlyn, Ezreal, Miss Fortune, Vayne
support
**Nautilus**, **Thresh**, Blitzcrank, Leona, Lulu, Lux, Morgana, Pyke
Kustom · tap the title to see what's still open              <- footer
```

**The reset post** has the same accent, title, link and footer. Its description is
`Fearless reset. Every champion is open again.` (the same sentence as the 8.11 announcer line; it replaced
M10's `Pool cleared. Ban list is empty.` in M14.9), and it has no fields.

**No URL configured** (no slug, or a localhost origin): neither post has a title link, and both footers fall
back to `Kustom`, so they never promise a tap that goes nowhere.

**Later.** M15 modes are planned to add one line to the teams post (M15.6): `Mode: Class wars, Tanks only · not
rated`. This is not built.

### 8.13 Tasks (re-scoped 2026-10-03)

**A. M14.30 Mode card and mode panel, Fearless first** *(owner: `web-engineer`; after M14.29; `apps/web`; no
schema change)*
- Scope: the card per 8.3/8.4 in every state, with the admin controls (Mode select with `Normal` and
  `Fearless` until M15 adds more; the rated chip derived from the mode and **no switch** in M14; Reset with its
  AlertDialog); the answer-band link; the `@panel` slot, `(.)mode` intercept and `mode/page.tsx` direct page
  per 8.5; the panel rules of 8.6; Fearless's panel body (8.7) with sprites (8.8); the copy in 8.11 in
  `lib/fearless/copy.ts` (mode-generic strings in `lib/mode/copy.ts`). Removes `/admin`'s fearless reset.
  **Drops** the `/g/<slug>/fearless` route and the More card.
- Acceptance: (1) one fixture per Tonight state renders 8.3's card and no other; everyone gets the card in
  every state including `Normal` + rated (8.2 ruling), admins also get the controls foot; (2) balanced with a seated viewer links to `/mode?lane=<role>` and the
  panel opens on that lane with `Your lane this game: <role>.`; a visitor gets `All`; (3) soft navigation from
  Tonight renders the overlay, a hard load of the same URL renders the page with the shell (Playwright both);
  Back and Esc close; focus lands on the heading and returns to the trigger; the page behind is `inert`;
  (4) find, lane control and answer strings as 8.7.4 (byte-identical to M10.2/M10.3); (5) icons as 8.8 (panel
  sprites never lazy; the card's `Banned next game` squares since M14.45), no `communitydragon`; (6) 375 and 320: no mid-word breaks, no sideways scroll; 1440 shows
  the board in the dialog; (7) no `select`, switch or Reset inside the panel; members get no form;
  (8) screenshots `redesign/screens/m14/tonight-mode-*` and `mode-panel-*` at 375/768/1440, designer ≤ 3
  rounds; (9) Tonight's live island JS does not grow against M14.9; (10) typecheck, test, lint, build.

**B. Overlay: open first for your lane** *(was M14.32)* **Deferred: companion UI replacement.** The user will
replace the companion's UI; no overlay design work until then. M14.32's API half (`fearless.open` on
`GET /api/overlay`) is deferred with it.

**C. M14.31 Discord fearless post 2.0** *(owner: `platform-engineer`; shipped)* — 8.12; title URL `/g/<slug>/mode`, footer
`Kustom · tap the title to see what's still open` on both posts; otherwise as approved (two-game fixture bolds exactly the second game's ten; limits guard at 172 bans; no icon or
CDN string).

### 8.14 STRATEGY and milestone edits this needs (product's to make)

- STRATEGY §6(a): replace every per-state fearless clause with "the Mode card (05-design 8.3)"; §2.6 URL list:
  `/g/<slug>/mode` replaces `/g/<slug>/fearless`; §2.4 More: no Fearless card.
- `02-milestones.md`: M14.30's brief and title (8.13 A), M14.32 marked deferred, M14.31's URL; M15.5's "Mode
  row" and "mode card above the teams" become this card's picker and the card in its place (8.3).
- `04-decisions.md`: product's rows of 2026-10-03 (the Mode card and routed panel; no rated toggle in M14;
  companion UI out of scope) are the decisions; designer's row of the same day records the panel's seven
  conditions, the one-panel registry, `Set mode` instead of auto-submit, and the member visibility rule.

### 8.15 Region tags on champion chips (M20.4)

Owner: `designer`. For M20.5. It follows decision row M20 D3: the tags are display only, show the region's
plain name in words, are part of the chip's accessible name, and there is no filter by region. A champion's
regions are the set from M20 D1. The set holds Riot Universe's region and at most one Kustom home region.
Unaffiliated means the set is empty. The tag answers one question the room asks in champion select: "is Jinx
Zaun?". It is reference text. It is not a second name, and it is not a control.

#### 8.15.1 The rule

- **Every champion chip on a pool view carries its regions as a second line of text under the name.** That
  means:
  - the Fearless pool, by lane and under `All`;
  - the class, region and mirror pools;
  - the `Banned` folds;
  - the find box's hit;
  - the Mode card's `Banned next game` chips (the only place the card shows champion icons today).

  If the card ever shows champion icons anywhere else, the tag goes there too.
- **The words are the region's display name from the one table** (`regionName`): `Zaun`, `Shadow Isles`,
  `Bandle City`, `Targon`, `The Void`. There are no abbreviations, no slugs and no upper case.
- **Two regions: both names, joined by ` · `** (a middle dot with a space either side, the house separator,
  as in `138 open · 34 banned`).
  - Universe's region comes first and the home region second, so the chip agrees with the credit line
    (`Where a champion has two, the second is our own call.`): Vi reads `Piltover · Zaun` and Kayn reads
    `Ionia · Noxus`.
  - Fizz is the one champion with no Universe region and two homes. He keeps the home list's order,
    `Bilgewater · Bandle City` (see the open question in M20.4's report).
- **Unaffiliated, or no row in the table: no tag at all.** That covers a champion newer than the table and a
  `Champion 999` from an id outside the roster. The second line is not rendered and leaves no empty element.
  There is no `Unaffiliated`, no `—`, no `Runeterra` and no placeholder. The chip is the name alone, exactly as
  it is today. At 16.19.1 this is 14 champions (`Bard`, `Nami`, `Senna`, `Lucian`, …).
- **A region-wars pool shows the full tag too**, including the region of the pool the chip sits in. A shared
  champion (M20 D2) appears in both pools, and its `Piltover · Zaun` in each one is what tells the room either
  side may take it. Nothing in the tag is emphasised for tonight's regions: no bold, no tint, no side colour.
- The tag never changes what a chip is. Sorting, grouping, counts, the find box, the lane control, open versus
  banned, and the hit inversion are all exactly as in 8.7. **Typing a region name in the find box matches
  nothing new.** It is still a substring match on champion names only, so `Zaun` prints `No champion
  matches.`
- The find box's answer line keeps its copy (`Vi is still available.`). The tag shows on the inverted hit chip
  under it. Changing that sentence is product's call, and nobody has asked for it.

#### 8.15.2 The look

| Part | Open chip (and the card's `Banned next game`) | Banned chip | Find hit (either) |
|---|---|---|---|
| Box | unchanged (8.7.3): grid cell, `--raised`, 1px `--border`, radius 4, padding `4 6 4 5`, gap 7, min-height 40 | unchanged: natural width, transparent, 1px solid `--border`, min-height 34 | inverted as now |
| Name | text 600 17 `--foreground`; **line-height 20px when the chip has a tag** (unchanged at 1.5 when it has none) | text 400 15 `--muted-foreground`; line-height 20px when tagged | `--card` |
| **Tag** | **text 400 13 (`--fs-2xs`), line-height 16px, `--muted-foreground`**, directly under the name with no extra gap, start-aligned with the name | the same: text 400 13, line-height 16, `--muted-foreground` | **`--card`, full strength** (no opacity, which would fail contrast on the inverted fill) |
| Icon | unchanged, centred on the name-and-tag stack (the chip keeps `align-items: center`) | unchanged, 55% | full |

- **The text side of the chip becomes a stack**: name, then tag. Both sit in the column that starts after
  the icon. With icons off (`data-icons="off"`), the stack starts at the chip's padding.
- **The hierarchy holds without a new token.** The name is foreground 600 17 and the tag is muted 400 13. That
  is four steps apart in size, weight and colour together, so the eye runs down the names as a column and
  skips the tags. In the panel's ladder (8.7.2), the tag sits below level 5.
- **Wrapping**:
  - The space inside a multi-word region name is a no-break space (U+00A0), as is the space before the dot.
    So `Bandle City` and `Shadow Isles` never split, and when a two-region tag does not fit, it breaks after
    the dot: `Piltover ·` on one line, `Bandle City` on the next.
  - The chip keeps `overflow-wrap: break-word`, so a unit longer than the line still breaks as a last resort
    instead of scrolling sideways.
  - Do not use `white-space: nowrap`: at large text it would push the chip wider than its cell.
- **Heights** (Night and Day alike):
  - an untagged chip stays 40;
  - a one-line tag makes about 46;
  - a tag that wraps to two lines makes about 62.
  - These need the name's line-height at 20px inside a tagged chip (ruled in M20.5 round 1). At the
    inherited 1.5 (25.5px) a one-line tag measured 52 and a wrapped one 68, which made the full `All` pool at
    375 about a third longer to scroll instead of a sixth, and left a loose gap between name and tag. 20px
    ties the tag to its name. A name that wraps (`Twisted Fate` on the card at 375) still reads at 17/20. An
    untagged chip keeps 1.5 and its 40.
  - In a two-column row both cells take the taller height (CSS grid's default stretch), and a lone
    untagged chip keeps its name centred.
  - Banned chips go from 34 to about 46 (name 15/20, tag 13/16, padding 4 top and bottom).
- **Night and Day use the same tokens**, with no `day:` class. `--muted-foreground` measures 5.91 on `--raised`
  and 6.44 on `--card` at Night, and 7.66 and 8.68 at Day (3.2). All of those are above AA, and the 13px floor
  is allowed by 2.7. On a find hit the tag is `--card` on `--foreground`, which is the name's own contrast
  (17.51 at Night, 16.69 at Day).
- Forced colours: the tag is plain text and maps to `CanvasText`, and the chip keeps its 1px border.

#### 8.15.3 Frames

375, Night, Fearless `All`, jungle shown (the other lanes look the same). Text width per cell is about 123px,
and widths are measured at Atkinson 13/400:

```
│ ⋀ jungle                               31 open │ lane head unchanged
│ ┌──────────────────────┐ ┌──────────────────────┐
│ │▣ Elise               │ │▣ Evelynn             │ Evelynn: unaffiliated, no second line,
│ │  Shadow Isles ·      │ │                      │ name centred in the stretched cell
│ │  Noxus               │ │                      │
│ └──────────────────────┘ └──────────────────────┘ 62: Elise's tag wraps after the dot
│ ┌──────────────────────┐ ┌──────────────────────┐
│ │▣ Jarvan IV           │ │▣ Kayn                │
│ │  Demacia             │ │  Ionia · Noxus       │ 46: both tags fit on one line
│ └──────────────────────┘ └──────────────────────┘
│ ┌──────────────────────┐ ┌──────────────────────┐
│ │▣ Rek'Sai             │ │▣ Vi                  │
│ │  The Void · Shurima  │ │  Piltover · Zaun     │
│ └──────────────────────┘ └──────────────────────┘
│ Banned 4 ⌄                                       │ fold unchanged; opened, chips are two-line:
│ [▣ Lee Sin ] [▣ Kindred ] [▣ Xin Zhao       ]    │ [icon at 55%, name 15 muted]
│ [  Ionia   ]              [  Demacia · Ionia]    │ [tag 13 muted]; Kindred has none
```

- **Acceptance (2), scannable with the full pool.** At 375 under `All`, all 172 chips are about a sixth
  longer to scroll than today:
  - about 74 rows at 46 and about 12 rows at 62, against 86 rows at 40, plus the unchanged lane heads;
  - the names keep their left edge, weight and colour;
  - one lane at a time (the default for a seated player, 8.7.4) is still about one and a half screens.

  M20.5's frame `mode-panel-fearless-tags-375.png` is the full `All` pool, top to bottom.
- **Region wars at 375**: stacked pools as now, with the sticky `BLUE Piltover` / `RED Zaun` heads. Vi appears
  in both pools with the same `Piltover · Zaun`.
- **1440**, in the dialog:
  - The `All` board's five lane columns (about 210px each, one chip per line) fit almost every tag on one
    line. `Shadow Isles · Bandle City` (Vex) is about 165px, so it is the likeliest to wrap.
  - The one-lane grid (`minmax(min(100%, 10.5rem), 1fr)`, 6 columns of about 181px) and the two region pools (3 columns
    each) wrap long two-region tags after the dot, as at 375.
  - Nothing else in the dialog moves.
- **The Mode card, finished, `Banned next game`**: the same chips, so the same tag. Cells there are narrower
  (about 89px of text beside the role cell at 375), so a two-region tag usually takes two lines. That is fine:
  this is a list of at most ten.

#### 8.15.4 Large text (200%) and reflow

- **The chip grids switch from two columns to one by text size, not by screen width** (the 12.3a idea, done
  with a grid minimum in rem). Each chip list's columns become `repeat(auto-fill, minmax(min(100%, 9rem),
  1fr))`, in place of `grid-cols-1 min-[360px]:grid-cols-2`.
  - **rem, not em** (ruled in M20.5 round 1). The pool sets its own font at 17px, so 9em there is 153px, and
    the panel's 309px list at 375 dropped to one column. rem follows the reader's text-size setting, which
    is what this rule is for, and ignores the component's font. Measured: two columns at 100% on 375, one
    at 320, 360, 125% and 200%.
  - At 100% on 375: the 309px list holds two columns of 9rem (144px) or more, as today.
  - At 320: one column, as today.
  - At 125% and 200% on 375: one column, so the tag line gets the full width minus the icon (about 299px at
    200%, where `Shadow Isles · Bandle City` at 26px is about 330px and breaks after the dot as designed).
  - The ≥1024 minimums move to rem too: one lane `10.5rem` (168px at 100%), two pools `9.4rem` (150px). The
    board stays one chip per column line.
  - The Mode card's `Banned next game` list uses **`repeat(auto-fit, minmax(min(100%, 7rem), 1fr))`**
    (ruled in M20.5 round 1). The list is 241px at 375, so 8em gave one column at 100%. 7rem gives two at
    100% and one at 125% and up. It is **`auto-fit`, not `auto-fill`**: each row holds exactly two chips
    (blue's seat, then red's). With `auto-fill` the 1440 card made five narrow tracks with three empty ones,
    and `Twisted Fate` wrapped beside blank space. `auto-fit` collapses the empty tracks, so the two chips
    share the row as they did before. The pool grids keep `auto-fill`, so cells are the same width across
    lanes.
- Banned chips already wrap at natural width. At 200% each chip is two lines and the fold just grows.
- Check at 200% on 375, Night and Day: no sideways scroll, no name or region name broken inside a word, every
  tag fully visible, nothing hidden behind the sticky region heads.

#### 8.15.5 Accessible name

- **The chip reads as `<name>, <regions>`**: `Jinx, Zaun`, then `Vi, Piltover and Zaun`, then `Bard` with
  no tag.
- Markup inside the existing `<li>`, which stays non-interactive:
  - the name `<span>`;
  - a visually hidden `, ` (`sr-only`);
  - the tag `<span>`, in which a two-region tag puts the visible ` · ` in an `aria-hidden` span and a
    visually hidden ` and ` beside it.

  Screen readers then never say "middle dot", and the list reads the way a friend would answer.
- No `aria-label` on the `<li>`: list items do not reliably take an author name, and visible text that matches
  is better anyway. No `title` attribute and no tooltip either. The words are on screen.
- The banned status still comes from the `Banned` fold's summary, and the hit from the answer line
  (`role="status"`). The tag adds no live announcement.
- The region pool sections keep their names (`BLUE Piltover`). The tag does not repeat in them.

#### 8.15.6 Do not

- **No colour, tint, crest, flag, icon, emblem or art per region**, and no side colour on a tag in region wars
  (blue and red are sides, not regions) (M15, M20 D3).
- No box, pill, border or fill around the tag. A boxed word reads as a control or a filter, and 172 more
  borders would bury the names.
- No tag on the same line as the name. `Jinx Zaun` reads as one name, and inline tags break the names' column.
- No mono face, display face, upper case or tracking on the tag. Mono is for numbers and roles. A region is a
  word.
- No abbreviations (`SI`, `BC`, `Void`) and no truncation or ellipsis (6.6). The tag wraps, and the chip grows.
- No placeholder for an empty set (`Unaffiliated`, `—`, `?`, `Runeterra`).
- No marker for which region is Universe's and which is ours (no asterisk, no italic). The credit line under
  the region pools says it once.
- No region filter, region search, sort by region or group by region (M20 D3). No hover or tap reveal: chips
  are not controls (8.7.3).
- No tags beyond pool views and the card's champion icons. That means none on team cards, the poster, the
  tape, history, the landing figure or any Discord post. Region wars' posts already name the two regions in
  their rule line.
- Do not fetch or ship the region table on Tonight's live island. The card is server-rendered.

#### 8.15.7 Acceptance for M20.5 (designer signs on screenshots, at most 3 rounds)

1. Frames at 375 and 1440, in Night and Day:
   - Fearless `All` (the full pool at 375) and one lane;
   - region wars Piltover vs Zaun, with Vi in both pools;
   - class wars `Tanks only`;
   - a `Banned` fold open;
   - a find hit on `Vi`;
   - the finished card's `Banned next game`.
2. The same Fearless `All` and region frames at 200% text on 375.
3. Jinx reads `Zaun`, Vi `Piltover · Zaun`, Zaahen `Shurima`, Vex `Shadow Isles · Bandle City`, and Bard no
   tag. Nothing truncates, and no region name splits inside a word.
4. Contrast: tag ≥ 4.5 on `--raised`, `--card` and the hit fill in both themes. This holds by token, so
   confirm no opacity was applied.

---

## 9. Kustom desktop (M17)

Owner: `designer` (M17.2). Status: **draft for product's copy sign-off**. Builds in M17.8 (window, tray, pairing,
switch) and M17.12 (updater). Inputs: the M17 section of `02-milestones.md`, the 0.3.x/0.4.0 UI it replaces
(`apps/companion/desktop/`, `src-tauri/`), and sections 1 to 7 of this file.

The user, 2026-10-03: "only keep a simple companion i can link to my account and choose to switch between groups
and show current group and an updater". Windows only, one mode (host), no overlay. The job in the background is
unchanged; **the window is small and quiet**. A host looks at it twice: once to link, and now and then to answer
"which group is this PC recording for, and is it working?". Everything else is the tray.

**Not in it, on purpose:** a settings page, a token or API-address field, unlink or remove a group, Overlay, a theme
switch, OS notifications, sounds, a log viewer. Nothing in this section needs a control that is not listed in 9.5
or 9.7.

### 9.1 The window

| | Rule |
|---|---|
| Size | **400 × 690** logical px (690 + the title bar fits a 768px-high screen above the taskbar) (Tauri inner size), fixed: `resizable: false`, `maximizable: false`, minimisable. Centred on first show. |
| Frame | Native Windows decorations (snap, Alt+F4 and the window name for screen readers come free); `theme: "Dark"` so the title bar is dark; `backgroundColor: "#05070C"` (`--p-slate-0`, V1 page) so showing it never flashes white. Title `Kustom`. |
| Close | The close button, Alt+F4 and Esc **hide the window to the tray**; the engine keeps running. Minimise goes to the taskbar as usual. A hidden window has no taskbar button. Quit is only in the tray (9.7). |
| Opening | A launch by hand shows the window. A launch by **Start with Windows** starts in the tray with no window, **unless Kustom needs the person**: no usable token (Link) or an old engine running (9.6). Left-click on the tray icon = `Open Kustom`. |
| Single instance | A second launch shows and focuses the running window (restores it if minimised). No second process, no message. |
| Restart to update | The new version comes back the way the old one was: window shown if it was shown, tray only if not. |
| Layout | Header 52 (lockup left, version right, `--border` bottom edge), fixed; under it main and footer (9.5) scroll **together**, vertically only, never horizontally. **Ruled at M17.8 review (2026-10-04): the window does not grow and nothing is hidden behind a disclosure; the rare tall states scroll.** At 100 % text, Link, Old engine, Restarting and every everyday Home state (one or two groups, any League state, any last-game case, a pending switch) fit with no scroll. Only the update card and the Can't find League block may push content past 690. When they do, the **fold rule** holds: the group name, the League row or block including its answer, and the screen's primary button sit above the fold; only footer content (the folder row, the checkbox row, the Home line, the Riot notice) may go below it, and every footer control is also in the tray (9.7). The Riot notice is always last, so it is what goes first. The scrollbar is the native WebView2 one, always shown while there is overflow (no `scrollbar-width: none`, no overlay-only styling); a line cut by the bottom edge is the other cue. Focus moving to a control below the fold scrolls it into view (`scroll-margin-top: 60px`, so the fixed header never covers a focused control). Why not taller: 690 is already the most a 1920 × 1080 screen at 150 % scaling gives (720 logical px above the taskbar, minus the title bar), the commonest laptop setup. Why not a disclosure for the Riot notice: it must stay readily visible (M14.8), and a disclosure adds a control and a state to a window whose rule is "small and quiet" for a state most hosts never see (the update usually installs itself at the first idle moment, 9.5.4). |

### 9.2 Theme and tokens

**Night only. Recommendation: do not follow Windows light/dark.** Why: the window is opened beside the League
client (dark) in the same dark room as the tonight page, and Night is this system's first theme (2.1); it is a
400px status panel, not a reading surface, so Day buys little; and one theme halves M17.8's screenshots and the
risk of a theme bug in an app we can only test on a Windows round-trip. Game companions (Discord, the League client)
stay dark on a light Windows too. What must work on a light taskbar is the **tray icon**, so it carries its own
tile (9.7). Day can be added later with no redesign: the tokens below are 7.3's semantic layer, so `data-theme="day"`
would work the same way it does on the web.

- **Tokens:** `apps/companion/desktop/tokens.css` copies the web's **V1 "1.0 night"** Night tokens (decision row
  2026-10-04, the user's pick: `#05070C` page, `#0C121A` card), not 7.3's slate, **unchanged** (no `@theme`, no
  Tailwind: plain CSS variables). No hex anywhere else; where this section names a slate value (9.1's
  `backgroundColor`, 9.7's tile), read the V1 token in the same role. The values in today's `desktop/index.html`
  (`#0B0E14`, `#FFB13C`, `--cn-*`) are void with that file.
- **Used:** `--background` with Night's `--page-light` (the two lamps and the grid); `--card` + `--border` (cards, level 1);
  `--raised` (secondary button); `--border-strong` (the update card's edge, the "not yet" hollow dot);
  `--foreground`, `--muted-foreground`; `--primary` / `--primary-foreground` (**one primary button per screen**);
  `--primary-fill` (the connected dot); `--team-blue` / `--team-red` (only the winner glyph and word on the last-game
  line, as text on `--card`: 6.49 / 6.63). `--destructive` is not used: nothing in the app destroys anything.
- **Type:** Atkinson Hyperlegible Next 400/700 (text: names, sentences, buttons) and Martian Mono 500/600 (the code
  field, times, durations, the version), as in section 4. **Self-hosted** WOFF2 in `desktop/fonts/`, Atkinson
  latin + latin-ext (group names such as `Menaçe`), Martian latin; `Atkinson Fallback` from section 4 in the stack.
  **No Archivo**: the `▍KUSTOM` lockup is an inline SVG (outlined letters, the amber 5×22 bar), so one 300 KB variable
  font is not shipped for one word. No network font: today's Google Fonts link goes, and the CSP is
  `default-src 'self'` (an offline PC still renders).
- **Scale (2.7):** group name `--fs-lg` 23/700 (the one thing to read); values and buttons `--fs-base` 17; labels
  and secondary lines `--fs-xs` 15, muted; the code field mono 32/600, tracked 0.2em; footer and Riot notice
  `--fs-2xs` 13. Spacing on the 4px base, window padding 16, 12 between cards. Radii 8 / 6 / 4 (2.6).
- **Controls:** buttons 44 tall, radius 6 (primary = amber fill, ink label; secondary = `--raised`, `--border-strong`
  edge, 6.15; link = underlined `--foreground`, 44 hit area). Native `<select>` and `<input type="checkbox">`, styled per
  5.0. **No motion:** colour changes at `--dur-fast`, nothing pulses (the dot is static), no spinners.

### 9.3 States, in the order Kustom decides them

```
start ── an old engine's status.json is fresh ──> Old engine running (9.6)
      ── no usable token for any group ─────────> Link (9.4)
      ── the current group's token is refused (401 on /me) ──> Link, "again" variant (9.4 L9)
      └─ otherwise ─────────────────────────────> Home (9.5)
Home ── `Link another group` ──> Link (with Back) ── linked ──> Home
any  ── update downloaded ──> Home's update card + tray item; restarting ──> Restarting (9.5.4)
```

Copy below: `[NEW COPY]` marks words written here (product signs them). Unmarked text is the server's sentence
(shown verbatim, `apps/web/lib/groups/copy.ts`), the M17 brief's own words, or Riot's notice.

### 9.4 Link

```
┌──────────────────────────────────────┐
│ ▍KUSTOM                        1.0.0 │ header 52
├──────────────────────────────────────┤
│ Link this PC                         │ h1, 23/700
│                                      │
│ 1  Get a code on the site: admins    │ 15, ordered list (a real sequence, 1.3); M17.18
│    from Set up your PC as host on    │
│    the admin home, everyone else     │
│    from their invite link.           │
│ 2  Keep League open and signed in,   │
│    then type the code here.          │
│                                      │
│ Code                                 │ label
│ ┌──────────────────────────────────┐ │
│ │ K 7 M Q 2 X                      │ │ mono 32/600, 56 tall
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │               Link               │ │ primary, 44
│ └──────────────────────────────────┘ │
│ Six letters and numbers, from the    │ answer slot: 3 lines reserved,
│ site.                                │ so no answer moves the footer
│                                      │
├──────────────────────────────────────┤
│ [x] Start with Windows     Open logs │ footer row, 44
│ Kustom isn't endorsed by Riot Games  │ Riot notice, 13, muted
│ and doesn't reflect the views …      │
└──────────────────────────────────────┘
```

| State | What changes | Copy |
|---|---|---|
| L1 idle, League open | slot shows help | `Link this PC` [NEW COPY]; step 1 `Get a code on the site: admins from Set up your PC as host on the admin home, everyone else from their invite link.` (M17.18) and step 2 as drawn [NEW COPY]; label `Code` [NEW COPY]; button `Link` [NEW COPY]; help `Six letters and numbers, from the site.` [NEW COPY] |
| L2 League not open or not signed in | button `aria-disabled`, re-enabled live when League connects | `Open League and sign in. Kustom reads your League account from it.` [NEW COPY] |
| L3 linking | button label, field read-only | `Linking…` [NEW COPY] |
| L4 too short | on Link, no request | `Type all six characters.` [NEW COPY] |
| L5 a character the code never uses | inline, as typed | `Codes never use O, 0, I or 1. Check the site.` [NEW COPY] |
| L6 refused (404, 410, 409, 429) | slot, `role="alert"`; field keeps the code, selected, so a retype replaces it | the server's sentence verbatim, e.g. `That code doesn't match. Check the page and type it again.` / `That code ran out. Get a new one where you got this one.` / `This code is for ‹name›'s League account. Sign in to that account in League, then type the code again.` / `This Discord account is already linked to ‹name›.` / `That League account is already linked to someone else.` / `Too many tries. Wait a minute, then type the code again.` |
| L7 a member's code (`hostRefusal`) | slot, `role="status"`; **nothing saved**; field cleared | the server's `hostRefusal` verbatim, which is the new `HOST_NOT_ADMIN`: `You're in. Only admins can host. Ask an admin to host, or to make you one.` (M17.12 edits the server string; decision row 2026-10-04), then `You don't need Kustom to play: the host's Kustom records your games. It won't start with Windows any more, and you can uninstall it.` (M17.19; a `hostRefusal` also turns Start with Windows off) [NEW COPY] |
| L8 cannot reach the site / 5xx / malformed answer | slot, `role="alert"` | network: `Couldn't reach the Kustom site. Check your internet, then press Link again.` [NEW COPY]; 5xx or malformed: `Couldn't link just now. Press Link again in a minute.` [NEW COPY] |
| L8b League stopped answering mid-link | slot, `role="alert"` | `Couldn't read your League account. Check you're signed in, then press Link again.` [NEW COPY] |
| L9 "again" (the current group's token refused on `/me`) | h1 changes; the server's 401 sentence first in the slot, `role="alert"` | h1 `Link this PC again` [NEW COPY]; then the server's sentence |
| L10 from Home (`Link another group`) | a `Back` link-button above the h1 (returns to Home, nothing changes); h1 changes | `Back` [NEW COPY]; h1 `Link another group` [NEW COPY]; steps unchanged |
| L8c the site linked, but the token could not be written to disk | slot, `role="alert"`; field cleared and focused (the code is spent) | `Kustom couldn't save the link on this PC. Get a new code from the site, then type it here.` [NEW COPY] |
| Success | no success screen: straight to Home, which shows the line under the group name until the window is next hidden; **a newly linked group becomes the current group** (through the guarded switch, 9.5.2) | `Linked. Kustom records this group's customs from now on.` [NEW COPY] |

Field: `<input>` with `<label>`, `autocomplete="off"`, `spellcheck="false"`, `autocapitalize="characters"`; shown
upper case; spaces and dashes stripped (paste `k7m-q2x` works); `maxlength` applies after that clean-up; Enter =
Link; `aria-describedby` = the slot. Focus lands in the field when the screen opens.

### 9.5 Home

```
┌──────────────────────────────────────┐
│ ▍KUSTOM                        1.0.0 │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │ update card, only when ready:
│ │ Update ready: Kustom 1.0.3.      │ │ --card, 1px --border-strong
│ │                    [Restart now] │ │ primary
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │ group card
│ │ Recording for                    │ │ 15 muted ┐ one h1
│ │ Customs Night                    │ │ 23/700   ┘
│ │ Switch group                     │ │ label    ┐ only with two
│ │ [ Customs Night               ⌄ ]│ │ select 44┘ or more groups
│ │ Link another group               │ │ link-button
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │ status card, two rows ≥ 48
│ │ League     ● In a custom game    │ │
│ │──────────────────────────────────│ │
│ │ Last game  21:42 · ◥ Red won ·   │ │ times and minutes mono
│ │            31 min                │ │
│ └──────────────────────────────────┘ │
│ [            Open Tonight          ] │ secondary (primary when no update card)
│                                      │
│ [x] Start with Windows     Open logs │ footer row
│ Closing this window keeps Kustom     │ 13 muted, Home only
│ running. Quit from the tray icon.    │
│ Kustom isn't endorsed by Riot Games… │ Riot notice
└──────────────────────────────────────┘
```

#### 9.5.1 Group card

- Label `Recording for` [NEW COPY]; the group's name in full, wrapping, never truncated (6.6).
- `Open Tonight` [NEW COPY] opens `<apiBase>/g/<slug>` in the default browser (`opener`). It is the screen's primary
  button unless the update card is showing; then it is secondary, so there is one primary per screen.
- One group: no select. `Link another group` [NEW COPY] is always there (that is how a second group arrives).

#### 9.5.2 Switch group

- Native `<select>` labelled `Switch group` (the brief's words), listing **only groups this PC holds a host token
  for**, by name, the current one selected. Choosing another starts the switch at once.
- During the switch (normally under a second): select `aria-disabled`, line `Switching…` [NEW COPY].
- **Guarded** (a game in progress or a block unposted, M14.13): the select shows the choice; line under it,
  `role="status"`: `Switches to ‹Tuesday Crew› after this game.` [NEW COPY]. Choosing the current group again
  cancels it. When it happens: `Switched to ‹Tuesday Crew›.` [NEW COPY] in the announcer only (9.8).

#### 9.5.3 Status card

**League** row. The dot is an SVG, `aria-hidden`; the word carries the state (6.5).

| Client state (connection machine + gameflow phase) | Dot | Copy [NEW COPY] |
|---|---|---|
| not running, folder known (saved, default, or last seen from the process) | hollow ring, `--border-strong` | `League isn't open` |
| not running and **no folder found** by any of the three steps | the row becomes the Can't find League block (9.5.6) | |
| disconnected / reconnecting | hollow ring, `--border-strong` | `League isn't open` |
| connected, `None` or any idle phase | solid `--primary-fill` | `League is open` |
| `Lobby`, `Matchmaking`, `ReadyCheck` | solid | `In a lobby` |
| `ChampSelect` | solid | `In champ select` |
| `GameStart`, `InProgress`, `Reconnect`, `WaitingForStats`, custom game | solid | `In a custom game` |
| the same phases, not a custom | solid | `In a game (not a custom, not recorded)` |
| `PreEndOfGame`, `EndOfGame` | solid | `Game over` |

**Last game** row (label `Last game` [NEW COPY]): the last game *this PC* posted for the current group, live or by
backfill. Time from `Intl.DateTimeFormat` in the Windows locale (24 or 12 hour as the PC is set).

| Case | Copy [NEW COPY] |
|---|---|
| today | `21:42 · ◥ Red won · 31 min` |
| yesterday | `Yesterday 23:10 · ◣ Blue won · 28 min` |
| older | `Sat 3 Oct, 22:15 · ◣ Blue won · 34 min` |
| captured, not yet accepted by the site (in the queue) | `21:42 · saved, posts when the site answers` |
| none | `No game recorded yet` |

The winner is glyph + word in the side colour (3.3; text on `--card`), with `aria-label` `Red won`. Where this row
comes from after a restart is open question 2.

#### 9.5.4 Update

| State | Window | Copy |
|---|---|---|
| checking, downloading, failed | **nothing** (a failure is a log line, never a dialog, per M17) | |
| ready | update card at the top of Home; `Kustom ‹1.0.3›.` never breaks inside (no-break space); when the sentence and the button do not fit side by side (larger text sizes) the button goes under the sentence, full width, never past the card edge | `Update ready: Kustom ‹1.0.3›.` (brief's `Update ready`, version [NEW COPY]); button `Restart now` |
| `Restart now` while guarded (lobby, champ select, game, a queued block) | button stays; line under it, `role="status"` | `Kustom restarts after this game.` [NEW COPY] |
| restarting | the whole window: lockup, then one centred line; no button | `Restarting to update…` [NEW COPY] |

```
┌──────────────────────────────────────┐
│ ▍KUSTOM                        1.0.0 │
├──────────────────────────────────────┤
│                                      │
│                                      │
│        Restarting to update…         │ 17, centred, role="status"
│                                      │
│                                      │
└──────────────────────────────────────┘
```

It also restarts by itself at the first idle moment (M17's rule), so the card is usually seen only by someone who
opens the window mid-night. After the restart the header's version is the only sign; there is no "updated" line.

#### 9.5.5 Footer (every screen)

- `Start with Windows` (brief's words): a native checkbox, **on by default**, showing the real autostart state each
  time the window opens (so a change made in Task Manager shows here). Same setting as the tray item.
- `Open logs` (brief's words): a link-button that opens the logs folder (`opener`), the folder the README tells a
  host to send the newest file from.
- Home only: the **League folder** row (9.5.6), above the checkbox row.
- Home only: `Closing this window keeps Kustom running. Quit from the tray icon.` [NEW COPY]
- Riot's notice, verbatim as on the web (M14.8): "Kustom isn't endorsed by Riot Games and doesn't reflect the views
  or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot
  Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc." 13px,
  `--muted-foreground` on `--background` (10.85:1), real text.

#### 9.5.6 Can't find League, and the League folder

The engine looks in this order (M17.5, decision row 2026-10-04): (1) the running client's own process, whose
command line carries the install folder, (2) the saved `leagueInstallDir`, (3) the default paths. When League is
running, step 1 always finds it, so this state only appears with League closed **and** no folder found by 2 or 3
(a custom install that has never been seen running). Nobody edits `config.json`.

**The block** replaces the League row in the status card (the Last game row stays below it):

```
┌──────────────────────────────────────┐
│ ▍KUSTOM                        1.0.0 │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │ group card, unchanged
│ │ Recording for                    │ │
│ │ Customs Night                    │ │
│ │ Link another group               │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │ status card
│ │ League   ○ Can't find League     │ │ hollow ring; 17/700
│ │ League isn't running, and Kustom │ │ 15
│ │ couldn't find where it's         │ │
│ │ installed.                       │ │
│ │ [ Browse… ]   [ Try again ]      │ │ secondary, secondary; 44
│ │ Opening League also fixes this.  │ │ 15 muted
│ │ [answer slot, no space reserved] │ │
│ │──────────────────────────────────│ │
│ │ Last game  None yet              │ │
│ └──────────────────────────────────┘ │
│ [            Open Tonight          ] │ primary
│ League folder  Not set     [Change…] │ footer row
│ [x] Start with Windows     Open logs │
│ Closing this window keeps Kustom …   │
│ Kustom isn't endorsed by Riot Games… │
└──────────────────────────────────────┘
```

| Step | What happens | Copy [NEW COPY] |
|---|---|---|
| idle | the block as drawn | title `Can't find League`; line `League isn't running, and Kustom couldn't find where it's installed.`; buttons `Browse…`, `Try again`; hint `Opening League also fixes this.` |
| `Browse…` | the **native Windows folder picker** (Tauri `dialog` plugin, folder mode, title below), starting at `C:\Riot Games` if it exists, else `C:\` | picker title `Choose your League of Legends folder` |
| picker cancelled | nothing changes, no message; focus back on `Browse…` | |
| checking the pick | buttons `aria-disabled`; slot | `Checking…` |
| found | slot, `role="status"`; folder saved as `leagueInstallDir`; the block goes back to the plain League row (`League isn't open`) with the line kept in the slot until the window is hidden | `Found League in ‹D:\Games\Riot Games\League of Legends›` |
| a real miss | slot, `role="alert"`; nothing saved. **Only for real misses**: the engine normalises a pick of the `Riot Games` folder or the `Game` subfolder to the right folder, and that is a success | `That folder doesn't look like League. Pick the League of Legends folder, the one with LeagueClient.exe in it.` |
| `Try again` | runs the three steps again; label `Looking…` | still nothing: slot, `role="alert"`, `Still can't find League.`; found: the plain League row |
| League opens meanwhile | step 1 finds it; the block disappears by itself, no click | announcer: `Found League.` |

**The slot reserves no height** (changed at M17.8 review): it is empty, zero tall, until an answer arrives, and the
rows below move down then. That move never happens under the pointer: an answer arrives after the system picker
closes, or below the `Try again` button that was pressed, which itself does not move. This keeps the idle block
about 44px shorter, and a reservation could not hold the three-line miss sentence anyway.

**A good folder that could not be written to `config.json`** (from `Browse…` or `Change…`): slot, `role="alert"`;
nothing saved, the old folder (or `Not set`) stays: `Kustom couldn't save that folder. Pick it again in a moment.`
[NEW COPY]. It says "pick", not "try again", because `Try again` is the block's other button and does something
else.

Paths are shown **in full and wrap** (`overflow-wrap: anywhere`), never truncated or middle-ellipsed (6.6), in the
text face (a path is a place, not a number). Windows separators and drive letters as given.

**The League folder row** (Home footer, above the checkbox row): label `League folder`, then the folder the engine
uses (saved, default, or the one the running client reported) or `Not set`, then a link-button `Change…`
(`aria-label="Change League folder"`). `Change…` runs the same picker, checks and messages as `Browse…`, with the
answer in a one-line slot under the row; a miss keeps the old folder. The row is the only place to change the
folder once it is found, so no settings page is needed.

**Tray:** line 2 reads `League: can't find it` [NEW COPY]; the icon stays normal (opening League fixes it, and
Kustom records as soon as it does), and the window does not open by itself for it.

**Accessibility for the picker flow:** the Windows folder dialog is the system's own, so keyboard, Narrator and
High Contrast work as in every Windows app; it is modal to the Kustom window. Focus returns to the button that
opened it (`Browse…` or `Change…`) when it closes, picked or cancelled. The result goes in the slot under that
button, tied with `aria-describedby`, so it is read once and stays readable; success is `role="status"`, a miss or
`Still can't find League.` is `role="alert"`. During `Checking…`/`Looking…` the buttons are `aria-disabled` (not
`disabled`), so focus does not drop to the page. The hollow ring is `aria-hidden`; the title says the state. The
full path is real text, so a screen reader reads it all.

### 9.6 Old engine still running

```
┌──────────────────────────────────────┐
│ ▍KUSTOM                        1.0.0 │
├──────────────────────────────────────┤
│ The old Kustom is still running.     │ h1, 23/700
│ Close it, then press Retry.          │ 17
│                                      │
│ Look for it in the tray by the       │ 15 muted
│ clock, or in its own window.         │
│ ┌──────────────────────────────────┐ │
│ │              Retry               │ │ primary
│ └──────────────────────────────────┘ │
│ [answer slot, 1 line reserved]       │
│                                      │
├──────────────────────────────────────┤
│ [x] Start with Windows     Open logs │
│ Kustom isn't endorsed by Riot Games… │
└──────────────────────────────────────┘
```

- h1 and first line: the brief's sentence, split at the full stop: `The old Kustom is still running.` /
  `Close it, then press Retry.` Help: `Look for it in the tray by the clock, or in its own window.` [NEW COPY]
- `Retry` → label `Checking…` [NEW COPY] → still running: slot, `role="alert"`, `It's still running.` [NEW COPY];
  gone: the next state in 9.3. No watcher starts until it is gone. The tray icon is the "not recording" variant.

### 9.7 Tray

**Icon:** the Kustom mark on its own slate tile (`--p-slate-1` `#0C121A`, amber bar, `--p-slate-9` `#F4F7FC` letter: the V1 card and text), so it reads on
light and dark taskbars; ICO at 16, 20, 24, 32. **Two states, told apart by shape**, not colour alone: normal
(solid amber bar) and **not recording** (the bar drawn hollow): no usable token, token refused, or old engine
running. League being closed is normal, not "not recording". The tooltip always says which.

**Menu** (rebuilt on every state change; Windows renders it, so it follows the system theme):

```
Customs Night                         disabled: the current group's name
League: in a custom game              disabled: status
──────────────────────────
Switch group                     ▸    only with two or more groups
    ● Customs Night                   radio items, current checked
    ○ Tuesday Crew
Open Kustom                           default item (bold); same as left-click
Open logs
──────────────────────────
✓ Start with Windows                  checkbox
Restart to update                     only when an update is ready
──────────────────────────
Quit Kustom
```

| Item | Copy and states |
|---|---|
| Line 1 | the group's name; `Not linked` [NEW COPY] with no token; `Not recording: the old Kustom is running` [NEW COPY] in 9.6 |
| Line 2 | `League: ` + the 9.5.3 state in lower case (`League: isn't open`, `League: open`, `League: in a lobby`, `League: in champ select`, `League: in a custom game`, `League: in a game (not a custom)`, `League: game over`, `League: can't find it`) [NEW COPY]; hidden when line 1 says not linked or old engine |
| Switch group | the brief's words; a pending switch shows its item as `‹Tuesday Crew› (after this game)` [NEW COPY] |
| Open Kustom, Open logs, Start with Windows | the brief's words |
| Restart to update | the brief's words; while guarded `Restart to update (after this game)` [NEW COPY], still clickable, it schedules |
| Quit Kustom | `Quit` in the brief, with the app's name [NEW COPY] because the tray is shared. **No confirmation**: an unposted block is queued first (M17), and backfill recovers a game Kustom was closed for |

**Tooltip** (Windows caps it at 127 characters): `Kustom ‹1.0.0› · ‹Customs Night› · League: ‹in a lobby›`,
plus ` · update ready` when ready; `Kustom · not linked`; `Kustom · not recording, the old Kustom is running`
[NEW COPY].

### 9.8 Accessibility

- **Keyboard.** Everything works without a mouse. Tab order is DOM order: Link: (Back), field, Link, Start with
  Windows, Open logs. Home: Restart now, Switch group, Link another group, (Browse…, Try again), Open Tonight, Change…, Start with
  Windows, Open logs. Old engine: Retry, Start with Windows, Open logs. Enter submits the code; Space toggles the checkbox; the
  select is native. Esc hides the window. Focus on open: the code field on Link, nothing forced elsewhere (no focus
  jump while a host glances at it). The tray menu is reachable with Win+B, then Enter or Shift+F10.
- **Focus.** 2px `--ring` outline, 2px offset, on every control (6.1); outline, not box-shadow, for forced colours.
- **Contrast** (3.2, 3.3, measured): foreground on card 17.51; muted on card 6.44, on page 6.90; ink on the amber
  button 12.63; the update card's `--border-strong` edge 3.92; team-coloured winner text on card 6.49 / 6.63 at 17px,
  always with glyph and word. Nothing in the window is below 13px.
- **Screen reader.** Window name `Kustom`. One h1 per screen (Home's h1 is `Recording for ‹Customs Night›`). The
  lockup SVG is `role="img"` `aria-label="Kustom"`; the version reads `Version 1.0.0`. Dots and glyphs are
  `aria-hidden`; the words carry them. One polite announcer (`role="status"`, `aria-atomic="true"`), one sentence
  per change, never a bare number: `League is open.` / `In a custom game.` / `Game recorded. Red won.` /
  `Update ready.` / `Switched to ‹Tuesday Crew›.` Refusals and errors use `role="alert"`. Every control has a
  visible label; the select and checkbox use `<label>`. Tray items are plain text, so Narrator reads them,
  disabled status lines included.
- **Forced colours / High Contrast.** Native controls; dots, glyph and lockup are `currentColor` SVG; the hollow
  ring and the solid dot still differ by shape.
- **Text size.** Windows text scaling up to 225 %: main scrolls vertically, nothing clips, the window stays fixed.
  WebView2 zoom (Ctrl + wheel) stays on.
- **Motion.** None to reduce.

### 9.9 Acceptance for M17.8 (designer signs)

Screenshots at 400 × 690 of: L1, L2, L6 (one sentence), L7, L8, L9, L10; Home with one group, two groups, a
pending switch, each League state, Can't find League (idle, looking, still not found, a miss, found), the League
folder row (path and `Not set`), each last-game case, the update card, the guarded restart line; Restarting;
Old engine and its `It's still running.`; the tray menu with two groups and with an update; both tray icons on a
light and a dark taskbar; Home at 200 % text; Home in High Contrast. Every string matches this section.
For each state that scrolls at 100 % text (update ready, update guarded, Can't find League with and without an
answer, each also with two groups), two shots: at the top, showing the fold rule of 9.1 holds, and scrolled to the
bottom, showing the Riot notice whole and the scrollbar.

### 9.10 Open questions (for the lead)

1. **The member sentence names Overlay mode.** `HOST_NOT_ADMIN` in `apps/web/lib/groups/copy.ts` ends "Ask one, or
   switch to Overlay mode." Only host-mode pairing returns it and 0.3.x never sends host mode, so changing it touches
   no shipped client. Proposed: `You're in. Only admins can host. Ask an admin to host, or to make you one.` Platform
   edits it, product signs; not a contract change (the field is a free string).
2. **Last game after a restart.** Showing it from memory only means it reads `No game recorded yet` after every restart or
   update, which is exactly when a host checks. Proposed: one small additive file, `groups/<groupId>/last-posted.json`
   (`{ at, winningSide, durationS }`), written after a 2xx. It is new on disk, so under M17's parity rule it needs a
   decision row.
3. **Web copy that names Host mode.** `HOST_STEP_OPEN` (`apps/web/lib/admin/homeCopy.ts`) says "pick Host"; the
   1.0 app has no mode. Belongs to M17.12's copy surfaces.

---

## 10. Discord posts (M14.61)

Owner: `designer`. Status: **built** (M14.61, 2026-10-04). Builder: `platform-engineer`, in
`apps/web/lib/discord/`. As built, this section replaces 5.5 "Discord text" and the embed half of 7.4, and
restyles 8.12. Mock-ups: `redesign/screens/discord/` (`discord-posts.html`, shot at 375 and 1440).

The user asked for posts that look good, not only posts that carry the numbers. Discord gives us one free
colour per embed, up to ten embeds per message, bold, inline code, subtext, masked links and two image slots.
The current posts use one embed and one colour, so on a phone the teams arrive as a single amber bar with
`Blue` and `Red` stacked under it in the same grey. This section spends what Discord gives us on the one thing
a player looks for first: **which side am I on, and how did it go for my side.**

### 10.1 Rules for every post

1. **Display only.** Nobody types or taps in Discord to make anything happen. No buttons, no reactions to read,
   no bot.
2. **Phone first.** At 375 the embed's text column is about 270 px, roughly 36 characters of Discord's body text.
   Inline fields stack to one column on phones, so we **stop using inline fields for the two sides**. Each side
   gets its own embed (10.3), which reads the same on a phone and on a desktop.
3. **One message per event, as now.** A post is one webhook call carrying a stack of embeds. A new message type
   needs a product decision. The only one proposed is the Spin post (10.9), and it is gated.
4. **Colour is the bar, and only the bar.** Text colour can't be controlled in Discord. ANSI code blocks are
   rejected because mobile shows them as plain grey text, and the fenced-code ban of 2026-09-08 still holds.
5. **Emoji only as data.** `🟦` and `🟥` (U+1F7E6, U+1F7E5) appear in exactly two places: the side embeds'
   titles and the ten-cell odds bar (10.4). They carry side, the way the glyph does on the web. Any other emoji
   is out: no custom guild emoji (we don't own the guilds), no medals, no trophies (M7.10), no section markers.
6. **Every post links back to the site.** The first embed's title links the page the post is about, and the
   author line links the group's Tonight. No URL (no slug, or a localhost origin) means no link and no promise,
   as now.
7. **Words carry the meaning, colour backs them up.** Every side embed names its side in words. A reader with
   colour blindness, or a client with embeds collapsed, loses nothing.
8. **House voice.** Short, plain, friendly. Every existing string carries over unless 10.13 marks it new.

### 10.2 Identity: name, avatar, author, colours

| Part | Value | Notes |
|---|---|---|
| `username` (webhook override) | `Kustom` | On every post, including the test post. A pasted webhook named `Captain Hook` still posts as Kustom. |
| `avatar_url` | `<origin>/og/kustom/avatar?v=1` (10.11) | Left out when there is no public origin. Discord then uses the webhook's own avatar. |
| `author.name` | the group's name, e.g. `Customs Night` | On the **first embed** of every post. Result: `Customs Night · game 47`. Teams in a Fearless standing mode: `Customs Night · Fearless`. Not markdown. Group names are capped at 40 characters (0018), so they always fit. |
| `author.url` | `/g/<slug>` | Absent along with every other link when there is no URL. |
| `author.icon_url` | none | The avatar is already beside the message, and a second copy is noise. |
| `footer` | **only when it carries a sentence**: the board posts' explanatory line, the fearless post's `tap the title…` line | `Kustom`, `Kustom · game 47` and `Kustom · more on the tonight page` are dropped. The name is the username, the game number moved to the author, and the title is the link. |
| `timestamp` | dropped | The message header already shows `Today at 21:40`. A second time under the embed repeats it. |

**Colours** (Night values, because Discord's default theme is dark):

| Token | Hex | Int | Used on |
|---|---|---|---|
| neutral (amber) | `#FFCF66` | `16764774` | the teams header and the teams `How the bot decided` embed, board posts, fearless posts, resets, Spin |
| blue (side 100) | `#2E9BFF` | `3054591` | the Blue side embed on teams and result; a Blue win's result header |
| red (side 200) | `#FF6B35` | `16739125` | the Red side embed on teams and result; a Red win's result header |
| slate (AI) **new** | `#8B98AD` | `9148589` | `AI recap` blocks only (result recap, Sunday storyline). This is `--muted-foreground`: written about the numbers, not one of them. |

Why the two side embeds don't read as a prediction (the concern behind the 2026-09-08 "teams bar is amber"
row): both sides get an embed of the same size and luminance (1.03, 3.3), Blue always comes first, and the
header and the footer embed are amber. The stack reads as amber, blue, red, amber: neither side is favoured,
and both are named.

### 10.3 The stack

| Post | Embeds, top to bottom | Max |
|---|---|---|
| Teams (balance, reroll) | **E1** header (amber) · **E2** `🟦 BLUE` (blue) · **E3** `🟥 RED` (red) · **E4** `How the bot decided` (amber) | 4 |
| Result | **E1** header (winner's colour) · **E2** `🟦 BLUE` · **E3** `🟥 RED` · (**E4** `AI recap` (slate), added by the 15-minute edit, Premium only) | 4 |
| Sunday weekly | (**E0** `AI recap` storyline (slate), Premium and a stored storyline only) · **E1** board (amber) | 2 |
| Nightly board | **E1** board (amber) | 1 |
| Fearless pool / reset | **E1** (amber) | 1 |
| Ratings reset | **E1** (amber) | 1 |
| Spin (gated, 10.9) | **E1** (amber) | 1 |
| Test post | `content` only, no embed (unchanged) | 0 |

Stack rules:
- Only **E1** has `author` and the page link in its title. E4 on teams links its own anchor. **E2 and E3 never
  get a `url`.** Discord merges embeds that share a `url` into one image gallery, and side embeds have nothing
  to link that E1 doesn't already.
- **Order is fixed.** Blue before red, always (3.3 carrier 4).
- **Discord's 6,000-character total is per message, across every embed** (titles, descriptions, field names and
  values, footers and author names). The guard moves from one embed to the message: see 10.12.

### 10.4 Teams post (balance and reroll)

**Anatomy.**

| Embed | Part | Content |
|---|---|---|
| E1 amber | author | `Customs Night`, or `Customs Night · Fearless` when the lobby's standing mode is Fearless [NEW COPY] |
| | title | `Teams are set` / `Teams are set · reroll 1 of 2` (unchanged), links `/g/<slug>` |
| | description line 1 (only with a rule or not rated) | the mode line, restyled (10.9): `**This game: tanks only.** Not rated. [See the tanks](<url>)` |
| | description: labels | `**Blue 49%** · **51% Red**` (the receipt's two labels with the bar taken out, both bold, a middle dot between) |
| | description: bar | `🟦🟦🟦🟦🟦🟥🟥🟥🟥🟥`, ten cells, its own line |
| | description: verdict | the banded sentence, verbatim (`Basically a coin flip.`) |
| | field `Sitting out` (block, only when someone sits) | unchanged (the name first, then the page's reason sentence) |
| | field `Seats` (block, always) | unchanged: move lines, then the side line |
| | field `Lobby` (block, when named) | unchanged: `` `customs-night` · password `4471` ``. It moves up from last, because a latecomer needs it before the teams. |
| E2 blue | title | `🟦 BLUE` [NEW COPY] |
| | description | five seat lines in lane order: `` `top` **FoxHound** · 1224 ``, plus ` · off main role` as now |
| E3 red | title | `🟥 RED` [NEW COPY] |
| | description | five seat lines, same shape |
| E4 amber | title | `How the bot decided` (the page's disclosure name), links `/g/<slug>#how-the-bot-decided` |
| | description | chips line, reason line, core's sentence as `-#` subtext: the receipt's lines 3 to 5 from 5.5, verbatim |

**The bar.** Ten cells of 10%. Blue cells = `round(p_blue × 10)`, with an exact half rounded **towards 5**, so
neither side gains a cell from rounding. Each side keeps at least one cell (clamped to 1 to 9), the same rule as
the web bar's clamp: the drawn bar is clamped, the labels print the real percentage. Ten emoji are about 200 px
in Discord, so the bar fits one line at 375. The 20 `▰▱` cells plus both labels did not, which is why the labels
now sit on the line above. The bar is the one memorable thing in the post, and it is the only place emoji show
real colour.

**Seat lines.** Role in inline code (a grey chip), the name in bold, a middle dot, then the Rating.
The bold name is the "where am I" scan, and the Rating stays plain. Most lines fit 375 on one line. The
longest ones (`support` plus a 15- or 16-character name, and every result line with a delta) can wrap at 375
(measured in the mock-up: `` `support` **Used2BeATahmMain** · 1322 `` is about 250 px against a column of
about 255 px). So **the wrap point is fixed**: the Rating and its change are joined by a no-break space (U+00A0,
`1277 (+15)`), so a wrap moves the whole number to the next line after the middle dot, never `1277` on one line
and `(+15)` on the next. Bold costs about 7 px and is not the cause, so it stays. Escaping and the 32-character cut are unchanged (`renderName`), and
the bold markers go around the escaped name.

**Why these blocks, in this order.** On a phone, E1 is about one screen: the odds, then the one line that must
happen before anyone plays (`Seats`), then the lobby. The two sides come next, each under its own colour bar,
so "which side am I on" is answered by colour and word together. The nerd lines (chips, next best, core's
sentence) close the stack in E4. They are still in every post and still verbatim, but they no longer sit
between a player and their name.

**Teams, filled** (game 4 of the prototype night, Fearless standing, Chaos sitting out):

```text
Kustom  APP  Today at 21:12
┃ Customs Night · Fearless                         author, links /g/customs          E1 amber 16764774
┃ Teams are set                                    title, links /g/customs
┃ **Blue 49%** · **51% Red**
┃ 🟦🟦🟦🟦🟦🟥🟥🟥🟥🟥
┃ Basically a coin flip.
┃ Sitting out
┃ Chaos sits this one out. They've gone longest without sitting out, and everyone's played 3 games tonight.
┃ Seats
┃ You'll be moved to your side — if not, move yourself.
┃ Lobby
┃ `customs-night` · password `4471`

┃ 🟦 BLUE                                                                            E2 blue 3054591
┃ `top` **FoxHound** · 1224
┃ `jungle` **XETA** · 1378
┃ `mid` **Ramzyinhović** · 2638
┃ `adc` **SugarPapy** · 1218
┃ `support` **Used2BeATahmMain** · 1322

┃ 🟥 RED                                                                             E3 red 16739125
┃ `top` **H4RDC0R33** · 1531
┃ `jungle` **Syndrome Axes** · 2291
┃ `mid` **knifiy** · 1454
┃ `adc` **PRT Khokha** · 1287
┃ `support` **TheSHADOWREAPER** · 1262

┃ How the bot decided                              title, links /g/customs#how-the-bot-decided   E4 amber
┃ Rating gap 45 pts · Main roles 10/10 · Bot's pick #1 of 3
┃ Next best: swap the adc players, SugarPapy and PRT Khokha. That's Blue 53%, with a bigger rating gap (61 vs 45 pts).
┃ -# Red favored 51%. Everyone on a main role. Gap 45. Next best: swap SugarPapy and PRT Khokha, gap 61.
```

The same post as the webhook body (abridged to one seat per side):

```json
{
  "username": "Kustom",
  "avatar_url": "https://playkustom.com/og/kustom/avatar?v=1",
  "embeds": [
    { "color": 16764774,
      "author": { "name": "Customs Night · Fearless", "url": "https://playkustom.com/g/customs" },
      "title": "Teams are set", "url": "https://playkustom.com/g/customs",
      "description": "**Blue 49%** · **51% Red**\n🟦🟦🟦🟦🟦🟥🟥🟥🟥🟥\nBasically a coin flip.",
      "fields": [
        { "name": "Sitting out", "value": "Chaos sits this one out. They've gone longest without sitting out, and everyone's played 3 games tonight." },
        { "name": "Seats", "value": "You'll be moved to your side — if not, move yourself." },
        { "name": "Lobby", "value": "`customs-night` · password `4471`" } ] },
    { "color": 3054591, "title": "🟦 BLUE", "description": "`top` **FoxHound** · 1224\n…" },
    { "color": 16739125, "title": "🟥 RED", "description": "`top` **H4RDC0R33** · 1531\n…" },
    { "color": 16764774, "title": "How the bot decided",
      "url": "https://playkustom.com/g/customs#how-the-bot-decided",
      "description": "Rating gap 45 pts · Main roles 10/10 · Bot's pick #1 of 3\nNext best: …\n-# Red favored 51%. …" }
  ]
}
```

**Variants.**

| Case | What changes |
|---|---|
| Reroll | E1 title `Teams are set · reroll 1 of 2`, nothing else |
| A rule (class, region, mirror) | E1 description opens with the mode line (10.9). The author still names the standing mode. |
| Normal or Fearless switched to not rated | E1 description opens `**This game: not rated.**` (no link, as now) |
| Nobody sits | no `Sitting out` field |
| No lobby name | no `Lobby` field |
| No stored receipt (`receipt: null`) | E1 has no labels, bar or verdict; its description is the mode line or nothing. E4's description is core's sentence alone, as plain text, not subtext. |
| No URL | no author link and no title links; E4's title is plain text |
| Main roles with newcomers | the chip reads `Main roles 6/6 · 4 new` as now (5.5) |

### 10.5 Result post

> **M18 (Kustom rating):** section 11 amends this for Ratings, changes, week points and the explanation panel; where they disagree, 11 wins.

**Anatomy.**

| Embed | Part | Content |
|---|---|---|
| E1, the winner's colour | author | `Customs Night · game 47` [NEW COPY], or `Customs Night` when the count failed (the old footer's rule, moved) |
| | title | `Red wins · 31 min` (unchanged), links the game page `/g/<slug>/games/<id>` |
| | thumbnail (Tier B, 10.11) | the result badge, `<origin>/og/g/<slug>/games/<id>/badge` |
| | description | lines, in this order, each only when it exists: the odds line (`Red was 51%. Red won.` / `Red was 46%. Red won. Upset!` / `50–50. Red won.`); the rule check line (M15.6, verbatim); `Not rated, so no Rating change.`; `Top damage: Syndrome Axes, 31.4k.`; the award line `**MVP** Syndrome Axes · **ACE** Ramzyinhović` (rated games only) |
| E2 blue | title / description | `🟦 BLUE`; five lines `` `top` **FoxHound** · 1210 (-14) `` |
| E3 red | title / description | `🟥 RED`; five lines, same shape |
| E4 slate (edit only) | title / description | `AI recap`; the recap line, escaped as now (`discordRecapText`) |

- **One line per fact.** Top damage now gets its own line instead of trailing the odds sentence. On a phone, the
  old one-line description wrapped mid-name.
- **The award line keeps product's words and order** (`MVP <name> · ACE <name>`, M7.10). Only the two labels
  turn bold. It moves from a U+200B field under the columns into E1, so it sits with the headline it belongs to.
  No trophy, medal or colour.
- **Seat lines** are the teams post's shape with the change in parentheses, joined to the Rating by U+00A0
  (10.4): an ASCII `-` and always signed,
  `+0` / `-0` (5.3's Discord rule, unchanged). On a game played not rated, the line is the role and the name
  only: `` `top` **FoxHound** ``.
- **Side embed titles don't say won or lost.** E1's title and colour already do, and every delta's sign
  repeats it on the line of the person reading.
- **The AI recap is its own last embed**, not a field on E1 as M16.4 built it. Brief 1.3 puts it "under the
  result and the rating changes". As a field on E1 it would sit **above** the ten ratings. `recapPayload`
  appends E4 to the stored payload instead of adding a field. The 15-minute window and the in-memory message id
  are unchanged.

**Result, filled** (game 4, Red won, Premium recap landed):

```text
Kustom  APP  Today at 21:44
┃ Customs Night · game 4                           author, links /g/customs           E1 red 16739125
┃ Red wins · 31 min                                title, links /g/customs/games/<id>    ┌──────┐
┃ Red was 51%. Red won.                                                              │ RED  │ thumbnail,
┃ Top damage: Syndrome Axes, 31.4k.                                                  │ WINS │ Tier B
┃ **MVP** Syndrome Axes · **ACE** Ramzyinhović                                        └──────┘

┃ 🟦 BLUE                                                                            E2 blue
┃ `top` **FoxHound** · 1210 (-14)
┃ `jungle` **XETA** · 1363 (-15)
┃ `mid` **Ramzyinhović** · 2625 (-13)
┃ `adc` **SugarPapy** · 1203 (-15)
┃ `support` **Used2BeATahmMain** · 1305 (-17)

┃ 🟥 RED                                                                             E3 red
┃ `top` **H4RDC0R33** · 1546 (+15)
┃ `jungle` **Syndrome Axes** · 2305 (+14)
┃ `mid` **knifiy** · 1470 (+16)
┃ `adc` **PRT Khokha** · 1302 (+15)
┃ `support` **TheSHADOWREAPER** · 1277 (+15)

┃ AI recap                                                                           E4 slate 9148589
┃ Syndrome Axes put 31.4k into champions and Red closed it out in 31 minutes.
```

A not-rated class game, E1 description only (the rest is the same, with names only on the seat lines). It
has **no award line**: MVP and ACE scale a Rating change, and a game played not rated moves nobody, so
`buildNotRatedInput` sends `award: null` and the line is absent, not empty:

```text
┃ Red was 51%. Red won.
┃ Tanks only: Blue kept the rule. Red: Jinx isn't a tank.
┃ Not rated, so no Rating change.
┃ Top damage: Syndrome Axes, 31.4k.
```

ARAM still gets no result post (00-product, unchanged).

### 10.6 Sunday weekly post

> **M18 (Kustom rating):** section 11 amends this for Ratings, changes, week points and the explanation panel; where they disagree, 11 wins.

**Anatomy.**

| Embed | Part | Content |
|---|---|---|
| E0 slate (only with a stored, unhidden storyline, Premium) | title | `AI recap` (the storyline's label, M16.1 1.3) |
| | description | the storyline paragraph (≤ 600 characters, escaped like the recap) |
| E1 amber | author | `Customs Night` |
| | title | `Last week · leaderboard` (unchanged), links `/g/<slug>/leaderboard?window=last-week` |
| | description | the slot line, unchanged: `Sunday 27 Sep to Saturday 3 Oct · 14 rated games` |
| | field `Top ten` / `The board` (block) | ranked lines as now (`` `1` Name · +212 · 5W–2L ``, settling chip on the line); **ranks 1 to 3 have the name in bold** [NEW STYLE] |
| | one block field **per award** | field name = the award's label (`Best off-role`, `Cursed duo`), value = its line(s), verbatim. This replaces one `Awards` field with bold labels inside. A tie keeps its names on separate lines under the one label. |
| | footer | `WEEK_BOARD_SENTENCE_SHORT`, unchanged |
| | image | the week notes picture (M14.79), `<origin>/og/g/<slug>/week/<weekStart>`, 1920×1080, under the board (10.11 tier B3). **Public origin only**: sent only when the post's origin is a public https one, never from localhost. A nearly empty week (nobody up, no NERFS, plain SYSTEMS, nothing NEW) sends no image and the route 404s for it. The post is complete without it, and the text never refers to it. |

**The slot for M16.5 is E0**, a separate embed above the board, not a paragraph pushed into E1's description.
Machine-written prose sits under its own slate bar and label, and the facts sit under amber. M16.5's
"byte-identical when missing" test then means **E0 absent and E1 exactly as this section's layout**. It
compares against the M14.61 snapshot, not today's.

```text
Kustom  APP  Sunday at 06:00
┃ AI recap                                                                           E0 slate (Premium)
┃ ‹One paragraph about the week, at most 600 characters, every number checked.›

┃ Customs Night                                    author, links /g/customs           E1 amber
┃ Last week · leaderboard                          title, links …/leaderboard?window=last-week
┃ Sunday 27 Sep to Saturday 3 Oct · 14 rated games
┃ Top ten
┃ `1` **Ramzyinhović** · +212 · 5W–2L
┃ `2` **Syndrome Axes** · +140 · 6W–3L
┃ `3` **knifiy** · +88 · 4W–3L
┃ `4` XETA · +41 · 3W–3L
┃ `5` H4RDC0R33 · +30 · 4W–4L
┃ `6` PRT Khokha · +12 · 3W–3L
┃ `7` FoxHound · -18 · 2W–3L
┃ `8` SugarPapy · -44 · 2W–4L
┃ `9` TheSHADOWREAPER · -61 · 1W–3L
┃ `10` Chaos · -96 · 1W–4L · settling · 4/10
┃ Best off-role
┃ XETA · 4W 1L · 80% · their main is jungle
┃ Cursed duo
┃ FoxHound and SugarPapy · 1W 5L · 17%
┃ Points are the Rating won or lost in the week's games, so one good night can top the week. All time is the one that makes teams.
```

No games in the week: no post, as now.

### 10.7 Nightly board post

Same as 10.6's E1 without E0 and without awards: author, title `This week · leaderboard` (links
`?window=this-week`), the `Top ten` / `The board` field with the top three bold, the footer sentence. On the
all-time track, `Still settling` stays its own field, unnumbered, never bold.

### 10.8 Fearless pool and reset posts

Both keep 8.12's copy, title link (`/g/<slug>/mode`) and footer. Changes:
- the 10.2 identity (username, avatar) and author `Customs Night`; timestamp dropped;
- each lane field's name carries its count: `top · 7`, `jungle · 6`, … `other · 1` [NEW COPY]. The value is
  unchanged: one line, this game's new names first and bold.

```text
┃ Customs Night                                                                      E1 amber
┃ Fearless                                         title, links /g/customs/mode
┃ Banned next game: 10 more, 34 in all. 138 still open.
┃ top · 7
┃ **Aatrox**, **Gnar**, Camille, Darius, Fiora, Garen, Jax
┃ jungle · 6
┃ **Lee Sin**, **Vi**, Graves, Kha'Zix, Sylas, Viego
┃ mid · 7
┃ **Ahri**, **Syndra**, Akali, Orianna, Viktor, Yasuo, Zed
┃ adc · 6
┃ **Jinx**, **Kai'Sa**, Caitlyn, Ezreal, Miss Fortune, Vayne
┃ support · 8
┃ **Nautilus**, **Thresh**, Blitzcrank, Leona, Lulu, Lux, Morgana, Pyke
┃ Kustom · tap the title to see what's still open                                    footer
```

The reset post: author, title `Fearless` (linked), description `Fearless reset. Every champion is open again.`,
footer as 8.12, no fields.

### 10.9 Mode of the night: the line, and the Spin post (gated)

**In the teams post (built in M15.6, restyled here).** The mode line is E1's first description line. The rule
half is bold, and the raw URL becomes a masked link (embed descriptions render `[text](url)`). Words are
M15.6's, unchanged:

| Mode | E1 line 1 |
|---|---|
| class | `**This game: tanks only.** Not rated. [See the tanks](<url>)` |
| region | `**This game: region wars.** Blue picks from Ionia, Red from Noxus. Not rated. [See both pools](<url>)` |
| mirror | `**This game: mirror match, same champion as your lane opponent.** Blind Pick lobby. Rated. [How it works](<url>)` |
| Normal / Fearless, not rated | `**This game: not rated.**` |
| no URL | the same, without the link |

```text
┃ Customs Night · Fearless                                                           E1 amber
┃ Teams are set
┃ **This game: tanks only.** Not rated. See the tanks       ← "See the tanks" is a link
┃ **Blue 52%** · **48% Red**
┃ 🟦🟦🟦🟦🟦🟥🟥🟥🟥🟥
┃ Basically a coin flip.
┃ …
```

**The Spin post: proposed, not built.** M15.1 §4 rules "one line, never a separate message", and that stands
until product reverses it (10.15 Q2). If it is reversed, this is the post, sent when an admin sets or spins a
rule for the next game, at most one per pending rule:

```text
┃ Customs Night                                                                      E1 amber
┃ Next game: Tanks only                            title, links /g/customs/mode   [NEW COPY, gated]
┃ Spun by Kustom. Not rated. Every pick should be a champion Riot tags Tank.        [NEW COPY, gated]
┃ [See the tanks](<url>)
```

Set by hand rather than spun: `Set for the next game. Not rated. …` [NEW COPY, gated]. No admin name: the
channel doesn't need to know who pressed it.

### 10.10 Ratings reset and the test post

- **Ratings reset**: one amber embed, the 10.2 identity, author `Customs Night`, title `Ratings reset` (links the
  all-time board), description verbatim (`Ratings were reset. Everyone starts at 1200 again. Top 3 before the
  reset: …`). No footer, no timestamp.
- **Test post**: unchanged `content` text (`Kustom is connected. Teams and results will show up here.`), now
  sent with `username: Kustom` and the avatar, so the first thing a group sees is the identity every later post
  uses.

### 10.11 Images

Nothing is hosted today except the share-card routes under `apps/web/app/og/` (`ImageResponse`, fonts read from
`app/_og/fonts/`, palette `app/_og/palette.ts`). Images here come only from new routes of that kind on our own
origin. **Every post is complete without them.** An image URL is sent only when the origin is public (the same
check that decides whether a post has links at all). A route that 404s or times out leaves Discord laying the
embed out without the image.

| Tier | Image | Slot | URL and source | Fallback |
|---|---|---|---|---|
| A | none | | | The whole of 10.4 to 10.10 ships text-only. |
| B1 | Kustom avatar | `avatar_url` | **new** `app/og/kustom/avatar/route.tsx` → `<origin>/og/kustom/avatar?v=1`. 256 × 256 PNG, `cache-control: public, max-age=31536000, immutable`; bump `v` to change it. Page `#05070C`, the `▍` wordmark bar in amber `#FFCF66` and a `K` in Archivo condensed 900 `#F4F7FC`, both inside the centre 70%, because Discord crops avatars to a circle. | Omit `avatar_url`; the webhook's own avatar shows. |
| B2 | Result badge | E1 `thumbnail` on the result post only | **new** `app/og/g/[slug]/games/[gameId]/badge/route.tsx` → `<origin>/og/g/<slug>/games/<id>/badge`. 256 × 256 PNG, `public, max-age=300, s-maxage=300` like the game card. Page `#05070C`; a 16 px rule across the top in the winner's colour; `RED` (Archivo condensed 900, 112 px, winner's colour); `WINS` (Archivo 900, 72 px, `#F4F7FC`; `TAPE_WINS`). Nothing else: no names, no duration, no champion art (5.16's Riot-safe rule). Discord shows it at 80 px, where `RED` is about 34 px tall. Same 404 rules as the game card. | No thumbnail; E1's text uses the full width. |
| B3 | Week notes picture (M14.79) | E1 `image` on the Sunday post only (10.6) | `app/og/g/[slug]/week/[weekStart]/route.tsx` → `<origin>/og/g/<slug>/week/<weekStart>` (`weekStart` = the Sunday the week opens). 1920×1080 PNG, variant A of `redesign/research/patch-image.md`, drawn by `app/_og/WeekNotes.tsx` (5.16 ruling (g)). `cache-control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800` (`WEEK_NOTES_CACHE`): an hour in the browser, **a day at the CDN**, served stale up to a week while it refreshes; not immutable, because a backfill and `rebuild-ratings` can refold a closed week. The game card's 404 rules, plus a week that has not closed, has no counted game, or is nearly empty. Not on the site and not an unfurl. In the phone feed (about 520px wide) names, points and tile values come out at 8.7–9.75px; it is a tap-open picture. | No image; E1 is the whole post. |

**B2 has one cost**: a thumbnail narrows E1's text column by about 96 px on every line beside it. At 375 that
leaves about 175 px, so the award line wraps to two lines. Ship B2 only if the 375 render keeps every E1 line to
at most two lines. B1 has no layout cost and ships with Tier A.

**Rejected:**
- **Champion icons.** The 2026-09-23 row keeps icons on the Fearless surface only. A Discord embed has one
  thumbnail slot, and ten picks don't fit it. Adding champion names to the seat lines would push about half of
  them past 36 characters at 375. Community Dragon or Data Dragon URLs (`lib/champs/ddragon.ts` has
  `ddragonChampionIconUrl`) would also put a third-party CDN inside every post.
- **The 1200 × 630 game card as `image`.** It repeats the ten names as a ~300 px picture under the text. The
  card is for unfurls of a pasted link, and it stays there.
- **A link button** (`Open tonight`). Only application-owned webhooks may send components. OAuth-connected
  groups have one, pasted webhooks don't, and the title link works for both. Left for later (10.15 Q4).

### 10.12 Limits

Unchanged: 256 title, 4096 description, 25 fields, 1024 per value, 256 author name, 2048 footer. Changed:
**6,000 characters summed over every embed in the message, and 10 embeds** (Discord counts title, description,
field names and values, footer text and author name across all embeds). `guardEmbed` becomes
`guardMessage(embeds)`. It keeps the three rules of `limits.ts`: identity below the limit, cuts on line
boundaries, and the line that matters survives.

Give-way order when a message is over 6,000. Each step drops lines from the bottom of that block, keeping its
first and last line (as now):

| Post | Order (first to give) | Never cut |
|---|---|---|
| Teams | E4 subtext → E4 reason → E1 `Seats` move lines → E1 `Sitting out` | E1 title, labels, bar, verdict, the side line; E2 and E3 seat lines; `Lobby` |
| Result | E4 recap (dropped whole) → E1 award line → E1 top damage | E1 title and odds line, the rule check, not rated; E2 and E3 |
| Weekly | E0 storyline (dropped whole) → award tie names → board rows from the bottom | E1 title, slot line, row 1 |
| Fearless | as 8.12 (fits at 172 bans) | |

No real post comes near this: a teams post with ten escaped 32-character names is about 2,400 characters.

### 10.13 Copy

| Where | Copy | Status |
|---|---|---|
| webhook name | `Kustom` | [NEW COPY] (the product name, now set by us) |
| author, every first embed | `<group name>` | [NEW COPY] |
| author, teams in Fearless | `<group name> · Fearless` | [NEW COPY] |
| author, result | `<group name> · game <n>` (moved from the footer `Kustom · game <n>`) | [NEW COPY] |
| side embed titles | `🟦 BLUE`, `🟥 RED` | [NEW COPY] |
| teams labels line | `**Blue 49%** · **51% Red**` | re-laid out (was the bar line's ends) |
| teams E4 title | `How the bot decided` | shipped (the page's disclosure name) |
| result award line | `**MVP** <name> · **ACE** <name>` | restyled (bold labels), words unchanged |
| fearless field names | `top · 7` | [NEW COPY] |
| mode line | M15.6's words, rule half bold, link masked | restyled |
| AI blocks | `AI recap` | shipped (M16.1) |
| Spin post (gated) | `Next game: Tanks only`; `Spun by Kustom. Not rated. Every pick should be a champion Riot tags Tank.`; `Set for the next game. Not rated. …` | [NEW COPY, gated on 10.15 Q2] |
| dropped | footers `Kustom`, `Kustom · game <n>`, `Kustom · more on the tonight page`; the U+200B award field | retired |

### 10.14 Acceptance (M14.61)

1. Every builder in `lib/discord/` returns the stack in 10.3. Snapshot per post and per variant in 10.4 and
   10.5. The worked examples here are the fixtures (game 4 names).
2. Every payload sets `username: 'Kustom'`. `avatar_url` and image URLs only with a public origin (test with
   localhost: absent).
3. E2 and E3 never carry `url`. Only E1 carries `author` (test).
4. Seat lines: the Rating and its change are joined by U+00A0, and nothing else in the line is (test).
5. The bar: `p = 0.49, 0.50, 0.55, 0.45, 0.03, 0.97` → 5/5, 5/5, 5/5, 5/5, 1/9, 9/1 blue/red cells (half
   rounds towards 5, clamp 1 to 9).
6. `guardMessage`: identity below 6,000 across embeds. A synthetic message over the limit loses lines in 10.12's
   order, and the never-cut lines survive (tests at the limit, as M4.12's).
7. `recapPayload` appends a slate E4 to the stored payload and never adds a field to E1. The edit is still the
   same message within 15 minutes.
8. M16.5's hook: the Sunday builder takes `storyline?: string`. Absent gives exactly the E1-only snapshot.
9. Every string matches 10.13 and the shipped copy modules (receipt, sit-out, mode, fearless, board, stats);
   nothing is retyped.
10. Real check: one teams, one result and one Sunday post sent to a scratch channel, screenshotted on a phone
   (iOS or Android, dark theme) and desktop. Designer signs, at most two rounds.
11. typecheck, test, lint, build.

### 10.15 Open questions (for the lead)

1. **Reversing two shipped choices.** Side-coloured embeds amend the 2026-09-08 row "teams embed bar is amber"
   (the header stays amber; the sides are coloured equally), and the emoji bar amends M14.10's "no side colours,
   no emoji" on the bar. Both need a decision row (proposed below).
2. **The Spin post.** M15.1 §4 says the mode never gets its own message. Does product want one when a rule is
   set or spun? The sketch is in 10.9. Default: no, and the mode line stays the announcement.
3. **The result badge (B2)** costs E1 width on phones. Ship it only after the 375 render check in 10.11?
4. **Link buttons** for OAuth-connected groups (`Open tonight`, `Open the game`), with title links for pasted
   webhooks. Worth a later task?

---

## 11. The Kustom rating on every surface (M18.8)

Owner: `designer`. Status: **spec for M18.7**, written 2026-10-04 after M18.1 landed, before the pages are built.
The rating itself is settled in `02-milestones.md` M18 and the `M18:` rows of `04-decisions.md`; nothing here
reopens a number. This section says how the numbers look. Where it and an older section (5.2, 5.3, 5.5, 5.15,
10.5, 10.6) disagree about a Rating, a change or week points, **this section wins**. The words marked
[FINAL COPY, M18.9] are product's final strings (they live in `lib/board/copy.ts`, `lib/breakdown/copy.ts`,
`lib/receipt/copy.ts` and `lib/landing/copy.ts`; the code is the source if the two ever differ); the structure,
order and styling around them are this section's.

### 11.1 What changes for the eye

| | Before (OpenSkill) | After (Kustom) | Design consequence |
|---|---|---|---|
| A settled player's change | 40 to 120 | about ±8, at most 20 printed | One or two digits. Changes keep 5.3's style; nothing grows to make a small number look big. |
| A first game (all time, or the week's) | up to 200+ | at most 38 | Same. |
| The all-time board | sd 493, 600 to 2739 | **sd 66, about 1112 to 1400 for settled players at launch** | Every Rating starts with `1`; people read the last two digits. 11.2. |
| Week points | net all-time points (M14.57) | `round(weekly R) − 1200`, everyone `±0` at Sunday 06:00 | Same place, new meaning; the per-game weekly changes add up to it. 11.4, 11.5. |
| Teammates' changes | differ by uncertainty | same base, differ only by share (×0.8 to ×1.2) | The explanation can be a sum a friend checks. 11.6. |
| Odds | bot (probit) and fold (logistic) could disagree | one function, one number | M14.59's `For points, …` line goes on every game rolled after the switch. 11.7. |

**The board will look tight at launch, and that is correct.** The rebuild folds about 109 games at ±8, so the
settled board compresses from 600–2739 to roughly 1112–1400 (sd 66), with neighbours often 5 to 15 apart and
the occasional tie on the printed number. Nobody's skill changed; the new scale moves 8 a game instead of 80.
**No surface compensates**: no stretched chart axis that hides the 1200 line, no bar lengths scaled from a
zero that make everyone equal, no colour ramp over the range, no decimals to break ties. The rank column
carries order; the Rating carries the size of the gap, and a gap of 10 is meant to look small.

### 11.2 The all-time Rating

- **Printed as `round(R)`**, four mono digits, `--fs-md` 600 in rows and seats (5.1, 5.2), display size on the
  player page's Rating card. Never a decimal, never a range, never a sigma or ordinal anywhere.
- **The settling chip stays** (`settling · n/10`, 5.6): it is a count of rated games, not a certainty. The
  `new` chip stays for a player with no rated game (also a count). **Every other certainty word goes**: no
  `new player, moves fast`, no `settled, swings are small`, no `±`-style uncertainty.
- **Ties on the printed Rating.** With sd 66, two rows can print the same number. The order stays the stored
  order (unrounded `R`); the rank numbers stay distinct. The row needs no tie marker (decision row 2026-10-04,
  "Printed Rating ties keep distinct ranks in unrounded order").
- **Charts** (the player page's Rating chart, the board chart). The y-axis fits the data with the same padding
  rule as today, and the dashed 1200 reference line stays, labelled `Start 1200` in mono `--fs-2xs` muted. At
  launch a settled player's line will mostly live between 1150 and 1350; that is the truth of the new scale, and
  the axis must not zoom to make ±8 look like a cliff. **Minimum y span 100 points** (centred on the data), so a
  three-game line of +8, −7, +9 reads as a flat-ish line, not a sawtooth.
- **The week chart** (player page on a week tab) plots week points from `0` (weekly `R − 1200`), the reference
  line at 0 labelled `Week start`, same 100-point minimum span.

### 11.3 Changes (5.3, amended)

5.3's rules stand: always signed, never coloured, real minus U+2212 on the web, ASCII `-` in Discord, `±0` on
the web and `+0` / `-0` in Discord, no arrows. Added:

- **Width.** A change column reserves **3ch** (`+19`, `−38`); week points reserve **4ch** (`+136`). Tabular mono,
  right-aligned, so a column of single-digit changes lines up on the units.
- **Integers only.** The printed change is `round(R_after) − round(R_before)`, never `base × share` rounded.
  The two can differ by 1 (XETA in 11.8 is the worked case); 11.6 says how the explanation owns that.
- **One labelled change per game per place.** No row, seat, card or embed prints two changes for one game
  unless one of them is labelled inline (only the explanation panel on a week row does, 11.6.3).

### 11.4 The week board (5.2's week windows, amended)

The row keeps M14.57's hierarchy: **the week number leads, the all-time Rating is secondary.**

```
┌──────────────────────────────────────────────┐
│  1   Ramzyinhović                         +58 │  week points: mono --fs-md 600, signed (5.3)
│      7 games · 5W 2L                     1393 │  all-time Rating: mono --fs-sm 400 muted, under it
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│  9   TheSHADOWREAPER                      −33 │  a negative week leads the same way, muted 400 (5.3)
│      4 games · 1W 3L                     1212 │
└──────────────────────────────────────────────┘
```

| Part | Spec |
|---|---|
| Column label | `Points this week` / `Points last week` (M14.57's `POINTS_COLUMN_LABEL`), above the number column, text face `--fs-xs` muted, right-aligned. It is the label the whole column inherits; rows do not repeat it. |
| Week points | `round(weekly R) − 1200`, signed, `--fs-md`, 600 for a gain, muted 400 for a loss, `±0` muted. The list is sorted on it (ties per M18.6: more wins, fewer games, higher all-time Rating, name). |
| All-time Rating | Under the points, `--fs-sm` mono 400 muted, **no label in the row** and **no all-time change** in the row (that would be the second number). Its accessible text is `<n> Rating` (sr-only `Rating`, as today). |
| Meta | Games and record, 5.2's rule (numbers mono, words text). |
| Settling | No settling section on week windows (5.2, unchanged). The `settling · n/10` chip may still sit in the meta on a person with under 10 all-time games, because it describes the Rating printed under the points. |
| Fresh week | Before the first game of a week the list is empty and 5.7's empty state shows (`No games this week yet.`, M14.70's pointer to last week). Nobody is listed at `±0` with no games. |
| Footer note | `WEEK_BOARD_SENTENCE_SHORT` [FINAL COPY, M18.9]: `Everyone starts each week at zero and only that week's games count, so one good night can top it. All time is the Rating that makes teams.` (`zero` in words: the same string is the Discord week footer, which must carry no digit; `that week` so it reads true on `Last week` and in the Sunday post). |

Screen reader, per row: `1, Ramzyinhović, 58 points this week, 7 games, 5 wins 2 losses, Rating 1393.`

**Top this week** (5.15, Tonight's card and rail): the number on the right is the week points, unchanged in
place and style; its sr text becomes `<n> points this week`. Still no four-digit Rating on that card.

### 11.5 The player page on a week tab

The page answers "how did my week go" first, and every number on it must add up to its header.

```
┌─ Rating card ───────────────────────────────────┐
│ Points this week   +36                          │  label text --fs-md 700; number display, mono 600
│ 7 games · 5W 2L · Rating 1300                   │  --fs-sm muted; `Rating` word text face, number mono
│ [chart: week points from 0]                      │  11.2
│ Everyone starts each week at zero and only that │  week note, --fs-sm muted [FINAL COPY, M18.9]
│ week's games count. Rating is your all-time     │  (`their` on somebody else's page)
│ number, the one that makes teams.               │
└─────────────────────────────────────────────────┘
┌─ Recent games ─────────────────── This week ────┐  column label, right: `This week`, --fs-xs muted
│ ◥ Won  Sat 3 Oct · 31 min                  +19 ⌄│  the game's WEEKLY change, the Why button
│ mid  Red was 56%. Red won.                [MVP] │
├─────────────────────────────────────────────────┤
│ ◣ Lost Sat 3 Oct · 28 min                  −16 ⌄│
│ ...                                             │
├─────────────────────────────────────────────────┤
│ Week total                                 +36  │  closing row: --fs-sm text, mono 600 number
└─────────────────────────────────────────────────┘
```

| Part | Spec |
|---|---|
| Header (week tab) | Swaps M14.57's order: **`Points this week` / `Points last week` leads** at the Rating card's display size; the all-time Rating moves into the meta line as `Rating 1300`. On `All time` the card is unchanged (Rating leads, the settling chip beside it). Same hierarchy as the week board (11.4), so a person going from the board to their page sees the same number big. |
| Game rows (week tab) | The right column prints **only that game's weekly change** (`week_r_after` rounded minus `week_r_before` rounded), in the Why button. **The per-game all-time Rating after is dropped on week tabs** (it was the second number on the row; it lives on `All time`). The MVP / ACE chip stays beside the change. |
| The label | Two places, both cheap: the list's column label `This week` / `Last week` on the card header's right (text face `--fs-xs` muted, aligned over the change column), and the sr text of every change: `gained 19 this week. Why?`. No per-row visible word: seven `this week` words down a phone screen is noise, and the column label plus the header already say it. |
| Week total row | The last row of a week list, not a link, not a button: `Week total` and the sum, which equals the header by construction (M18.6 tests it). It is the visible proof that the column adds up. Only when the list shows every game of the week; a paged list (over 20 games) drops it. |
| Compact receipt on the row | Unchanged: the stored roll odds (`Red was 56%. Red won.`). It is the bot's number about the game, the same on every tab. The week's own odds live inside the panel (11.6.3). |
| Not rated, ARAM | `not rated`, no change, no Why, exactly as on `All time`; they add nothing to the total. |

**All time** keeps 5.2's history variant: the all-time Rating after and the all-time change per game.

### 11.6 The explanation panel ("Why?", M14.58, rewritten for Kustom)

**Structure.** `explainKustomDelta` returns `{ side, result, expectedPct, k, firstTenGames, shareRank, share,
award, points }` per track. The panel turns them into **at most four sentences**, in this order, then the
footnote. The row's number is already the button's label, so the panel does not open by restating it.

1. **The odds sentence** (always): who was favoured, and what the game was worth before shares, as a sum.
2. **The share sentence** (always on a rated row): the share rank in words and the multiplier.
3. **The first-ten sentence** (only when `firstTenGames`): why K is above 16.
4. **The track clause** (week rows only, 11.6.3): the all-time change in one clause.

Then, only when needed, **the rounding line** (11.6.4), and the footnote `Upsets and first games move the
most.` [FINAL COPY, M18.9; replaces `Upsets and new players move the most.`] in `--fs-xs` muted.

**Visual.** The existing `WhyPanel`: a full-width row under the game, `--fs-sm` `--foreground`, numbers in mono
at the text's size (6.12), sentences run as one paragraph, the footnote its own line. **The sum is set inline**:
`16 × 44% = 7` with each number mono and the `×` and `=` in the text face with a thin space each side
(U+2009). No table, no stacked arithmetic, no bars. Multipliers print as `×1.2`, `×0.9`, `×1` (no trailing
`.0`). K prints rounded to a whole number (`30`, not `30.4`), and so does the base.

#### 11.6.1 The words [FINAL COPY, M18.9]

Let `pct` be the subject's side's `expectedPct`, `K` = `round(k)`, and `worth` = `round(K × (100 − pct) / 100)`
for a win, `round(K × pct / 100)` for a loss. The **stance** uses 5.5's even band (48 to 52 inclusive):

| Stance, result | Odds sentence (viewer) |
|---|---|
| favourite (pct > 52), won | `Your side won as the 56% favourite, so the win was worth 16 × 44% = 7.` |
| favourite, lost | `Your side lost as the 56% favourite, so the loss cost 16 × 56% = 9.` |
| underdog (pct < 48), won | `Your side won as the 44% underdog, so the win was worth 16 × 56% = 9.` |
| underdog, lost | `Your side lost as the 44% underdog, so the loss cost 16 × 44% = 7.` |
| even (48 to 52), either | `It was an even game (50%), so the win was worth 16 × 50% = 8.` / `… so the loss cost 16 × 50% = 8.` |

The second percentage is never named ("the chance you didn't have" is not a phrase anybody needs); the sum
shows it. On a first-ten game the `16` is the game's K (`30 × 44% = 13`).

| Share rank, result | Share sentence (viewer) |
|---|---|
| 1, won (MVP) | `You had the best game on your team (MVP): ×1.2.` |
| 2, won | `Your game was 2nd best on your team: ×1.1.` |
| 3, either | `Your game was 3rd best on your team: ×1.` |
| 4, won | `Your game was 4th best on your team: ×0.9.` |
| 5, won | `Your game was 5th best on your team: ×0.8.` |
| 1, lost (ACE) | `You had the best game on your team (ACE), so you gave back least: ×0.8.` |
| 2, lost | `Your game was 2nd best on your team: ×0.9.` |
| 4, lost | `Your game was 4th best on your team: ×1.1.` |
| 5, lost | `Your game was 5th best on your team, so you gave back most: ×1.2.` |
| no rank (`shareRank` null) | `This game couldn't be scored player by player, so everyone counts ×1.` |

`2nd`, `3rd`, `4th`, `5th`: the digit mono, the suffix text face. **Ranks never say `worst`**: these are
friends.

| `firstTenGames` | First-ten sentence (viewer) |
|---|---|
| all-time track | `Your first 10 games count extra while your Rating finds its level (×30 instead of ×16).` |
| week track | `Everyone's first 10 games of a week count extra (×32 instead of ×16).` |

The number in brackets is that game's `round(k)`. The weekly line says `Everyone's` because on the week track
every player's first game is at 32; that is the fresh start, not a newcomer rule.

**Somebody else's row** (`subject.kind === 'name'`): the name is said once, in the first sentence, then
`They` / `their` (M14.58's rule): `Omar's side won as the 56% favourite, …` / `They had the best game on their
team (MVP): ×1.2.` / `Their first 10 games count extra while their Rating finds its level (×30 instead of ×16).`

**Words that are gone:** `new, so your number moves fast`, `still settling, so swings are bigger`, `settled,
so swings are small`, `MVP added a quarter`, `ACE softened it by a fifth`, `LEGACY_AWARD_SENTENCE` (the rebuild
refolds every game, so no row is legacy), and the "changes don't sum to zero" paragraph. `settling` survives
only as the chip.

#### 11.6.2 Filled, all-time row (the viewer, settled, MVP of a 56% win)

Stored: red, won, `fold_p` 0.5622, `k` 16, share rank 1, `r_before` 1291.6, `r_after` 1300.0, printed `+8`.

```
◥ Won  Sat 3 Oct · 31 min                  1300
mid  Red was 56%. Red won.            +8 ⌃ [MVP]
┌──────────────────────────────────────────────┐
│ Your side won as the 56% favourite, so the   │
│ win was worth 16 × 44% = 7. You had the best │
│ game on your team (MVP): ×1.2.               │
│ Upsets and first games move the most.        │  --fs-xs muted
└──────────────────────────────────────────────┘
```

#### 11.6.3 Two tracks in one panel (a week row)

On a week tab the row's number is the **weekly** change, so the panel explains **the weekly change** with the
weekly parts, and adds the all-time change as **one labelled clause at the end**, with no reasoning of its own
(the all-time reasons are one tap away on `All time`). The weekly odds come from weekly Ratings, so they can
differ from the roll odds printed on the row; the odds sentence therefore opens with `On this week's numbers`
whenever the weekly `expectedPct` differs from the row's printed roll odds, and always on a first game of the
week (when it is 50%).

Filled (same game, the viewer's first game of the week):

```
◥ Won  Sat 3 Oct · 31 min                        
mid  Red was 56%. Red won.           +19 ⌃ [MVP]
┌──────────────────────────────────────────────┐
│ On this week's numbers it was an even game   │
│ (50%), so the win was worth 32 × 50% = 16.   │
│ You had the best game on your team (MVP):    │
│ ×1.2. Everyone's first 10 games of a week    │
│ count extra (×32 instead of ×16).            │
│ All time: +8, to 1300.                       │  the track clause
│ Upsets and first games move the most.        │
└──────────────────────────────────────────────┘
```

- The clause is `All time: +8, to 1300.` [FINAL COPY, M18.9]: the label word first, the signed change in mono
  (5.3, U+2212 for a loss), then the Rating after. For somebody else's row the same words.
- **On `All time` there is no week clause.** The week is not the thing a person opened.
- The share sentence is said once (the share rank is the same on both tracks, M18.1).
- Never two unlabelled changes: the button carries the weekly number under the column label `This week`; the
  only other change in the panel starts with `All time:`.

#### 11.6.4 The rounding line

The sentences multiply rounded numbers; the printed change is a difference of rounded Ratings. When
`round(worth × share) ≠ |points|` the panel adds, before the footnote, in `--fs-xs` muted [FINAL COPY, M18.9]:
`Ratings keep their decimals, so the change shown is 1 off this sum.` Web computes the condition from the parts; it never
appears when the sum matches. XETA in 11.8 (`16 × 44% = 7`, `×0.9` gives 6, printed `−7`) is the test case.

#### 11.6.5 Accessibility

The Why button's accessible name stays `<change words>. Why?` with the track for week rows (`lost 16 this week.
Why?`). The panel's sentence is read as text: `16 times 44 percent equals 7` (sr-only `times` / `equals`
replace the glyphs; the `×` and `=` are `aria-hidden`). `×1.2` reads `times 1.2`.

### 11.7 The receipt, the poster, tonight's seats

- **Receipt (5.5).** No layout change. The bar will sit near the middle more often (a 100-point team gap is
  56/44), which is what the 50% tick is for. The `Rating gap <g> pts` chip prints the gap in team totals on the
  new scale (usually 0 to 150). The verdict bands are product's and unchanged.
- **Calibration line** restarts at `Not enough games yet to check the bot's odds (0 of 20)` after the switch
  (only `odds_model = 'kustom'` rolls count). Expected; no note explains it.
- **M14.59's `For points, …` line** is gone on every game rolled after the switch (the bot and the fold read the
  same Ratings). On **games rolled before the switch**, the stored roll odds stay as posted and the fold's
  expected now comes from the refolded Kustom Ratings, so the two can differ: the line stays there, as
  `For points, Red was 50%.` with **no `because` clause** (neither of today's two reasons is true for them; the
  one-time patch-notes post says once that every old game was re-scored, and the row's panel states the fold's
  odds in full). Product accepted this as written (M18.9, decision row 2026-10-04).
- **Team cards (5.1) and the finished poster.** Seats print `round(R)`; the finished seat adds the all-time
  change at `--fs-sm` beside it, unchanged in style. No size boost for small numbers. MVP / ACE line unchanged in
  words and place.
- **Share cards (5.16).** The player card prints `round(R)` and the settling ruling (e) unchanged. Nothing on a
  share card shows week points (not specified before; not added now).

### 11.8 Discord

Text layouts unchanged (10.5, 10.6, 10.7); the numbers are the new ones. Filled with a consistent game (red
favoured by 100 points, so 56%; settled players, K 16; computed with the M18.1 formula):

```text
Kustom  APP  Today at 21:44
┃ Customs Night · game 4                                                         E1 red
┃ Red wins · 31 min
┃ Red was 56%. Red won.
┃ Top damage: Syndrome Axes, 31.4k.
┃ **MVP** Syndrome Axes · **ACE** Ramzyinhović

┃ 🟦 BLUE                                                                        E2 blue
┃ `top` **FoxHound** · 1181 (-7)
┃ `jungle` **XETA** · 1237 (-7)
┃ `mid` **Ramzyinhović** · 1393 (-5)
┃ `adc` **SugarPapy** · 1153 (-9)
┃ `support` **Used2BeATahmMain** · 1200 (-8)

┃ 🟥 RED                                                                         E3 red
┃ `top` **H4RDC0R33** · 1243 (+7)
┃ `jungle` **Syndrome Axes** · 1361 (+8)
┃ `mid` **knifiy** · 1298 (+8)
┃ `adc` **PRT Khokha** · 1221 (+6)
┃ `support` **TheSHADOWREAPER** · 1212 (+6)
```

(Shares: Syndrome Axes ×1.2, knifiy ×1.1, H4RDC0R33 ×1, TheSHADOWREAPER ×0.9, PRT Khokha ×0.8; Ramzyinhović
×0.8 as ACE, XETA ×0.9, FoxHound ×1, Used2BeATahmMain ×1.1, SugarPapy ×1.2. XETA's `−6.3` prints `−7` because
1243.7 → 1237.4 rounds 1244 → 1237: the 11.6.4 case.)

Sunday post (10.6), the board field with week points:

```text
┃ Top ten
┃ `1` **Ramzyinhović** · +58 · 5W–2L
┃ `2` **Syndrome Axes** · +47 · 6W–3L
┃ `3` **knifiy** · +31 · 4W–3L
┃ `4` XETA · +14 · 3W–3L
┃ `5` H4RDC0R33 · +9 · 4W–4L
┃ `6` PRT Khokha · +2 · 3W–3L
┃ `7` FoxHound · -11 · 2W–3L
┃ `8` SugarPapy · -25 · 2W–4L
┃ `9` TheSHADOWREAPER · -33 · 1W–3L
┃ `10` Chaos · -52 · 1W–4L · settling · 4/10
┃ Everyone starts each week at zero and only that week's games count, so one good night can top it. All time is the Rating that makes teams.
```

The footer is 11.4's note, so the board page and the post say the same sentence. The nightly board post
(10.7) on the all-time track prints `round(R)` with no change; its `Still settling` field is unchanged.

### 11.9 Checklist for M18.7 (the designer ticks it on screenshots, phone 375 and laptop 1440)

1. All-time board: `round(R)`, settled range at launch about 1112–1400 on the real data, no decimals, no
   compensating axis or colour; settling section and chip unchanged.
2. Week board: week points lead (`--fs-md` 600), all-time Rating under it small and muted, no all-time change on
   the row, `Points this week` column label, new footer note.
3. Player page, week tab: header leads with `Points this week`, Rating in the meta line; game rows print only
   the weekly change under a `This week` column label; `Week total` row equals the header.
4. Player page, all time: unchanged layout; each row's change opens the 11.6 panel with no week clause.
5. Why panel: sentences in 11.6's order, inline mono sums with `×` and `=`, K and base whole numbers, the
   share sentence for every rank (and the null case), first-ten line only when `k > 16`, the week clause only on
   week rows, the rounding line only when the sum is off (XETA fixture), no sigma or certainty word.
6. Somebody else's row: name once, then `They` / `their`.
7. Receipt: no `For points` line on a post-switch game; on a pre-switch game, no `because` clause; calibration
   reads `0 of 20` on the switch day.
8. Discord result and Sunday posts match 11.8's shape with ASCII minus and `+0`/`-0`.
9. Screen reader: `gained 19 this week. Why?`, `58 points this week`, `16 times 44 percent equals 7`.
10. Widths: change column 3ch, week points 4ch, tabular; nothing wraps at 375 with `TheSHADOWREAPER`.

### 11.10 Open questions (for the lead)

All three closed 2026-10-04:

1. ~~**Ties on the printed Rating.**~~ Distinct ranks in unrounded order (the owner; decision row "Printed Rating
   ties keep distinct ranks in unrounded order").
2. ~~**Pre-switch games' `For points` line.**~~ Kept on pre-switch rolls only, with no `because` clause (product,
   M18.9; decision row).
3. ~~**All copy marked [DRAFT COPY]**~~ Final in M18.9: every such string above now reads [FINAL COPY, M18.9]
   and matches the copy files.

---

## 12. Landing imagery: the example game (2026-10-04)

Owner: `designer`. Surface: the landing page, `/` and `/about` (`apps/web/components/landing/LandingPage.tsx`).
The owner's brief: the page is all text, and a visitor should see at a glance that this is a tool for League of
Legends custom games. This section is the second named exception to 1.1 rule 6.

### 12.1 The direction

1. **The product is the picture.** The hero's right column (and on phones, the block under the buttons) shows
   one finished example game: the compact win bar, then the five lanes as rows, blue on the left and red
   mirrored on the right, with each player's champion square, name and rating change.
2. **Ten Data Dragon champion squares are the only artwork.** They are recognisable champions, one per lane per
   side, served from our own origin as small WebP files committed to the repo. There is no splash art, no logo
   and no art band.
3. **It is a fixture, and it says so.** It uses the same ten friends and the same split as the worked example
   (`lib/landing/example.ts`, split 1: blue 54%). Red wins the game. The caption calls it an example game.
4. **The hero receipt moves down, nothing is lost.** The real receipt, live or example, already shows in the
   Proof section, open. Today the hero shows it a second time, closed. The example game takes the hero's slot,
   and the Proof receipt keeps the live caption and `See this game`.
5. **Quiet around it.** Stock tokens, 1px `--border`, no glow and no motion. The champion faces are the only
   new thing on the page, and they are content (who played what), never decoration.

Why not the alternatives:

- **A splash band behind the hero** (dimmed art at 1440 × 400 or larger). It is the esports-broadcast look, not a
  friend's living room. It is decoration, which 1.1 rule 1 bans. It would be the largest image on the page, so
  it becomes the LCP element, and a dimmed photo under the display headline drops text contrast below 3.2's
  numbers at the lamp peaks. Rejected.
- **A champion collage or a grid of faces.** It says "League", but it does not say "balanced teams". It is a
  fan site, not this product. Rejected.
- **Champions on the real Team card (5.1).** Still not built. 5.1's "Not built: champions on seats" stands:
  there is no data source before the game. This picture is a separate component, so the exception cannot leak
  into Tonight.

### 12.2 The champions

These are default skins only, at the pin `DDRAGON_VERSION` (`16.19.1`). The numeric key is what the code keys
on, and the Data Dragon id is the file name.

| Lane | Blue (lost) | Red (won) | Why this pair |
|---|---|---|---|
| top | Hana: **Garen** (86, `Garen`) −18 | Omar: **Darius** (122, `Darius`) +17 | The Demacia vs Noxus top lane. Every player knows both faces. |
| jungle | Iris: **Lee Sin** (64, `LeeSin`) −21 | Rami: **Amumu** (32, `Amumu`) +22 | The most-played jungler of all time, and the most recognisable face in the game. |
| mid | Karim: **Ahri** (103, `Ahri`) −16 | Nadia: **Yasuo** (157, `Yasuo`) +15 | The two mid faces that non-mains know too. |
| adc | Bilal: **Jinx** (222, `Jinx`) −19 | Lena: **Ezreal** (81, `Ezreal`) +20 | Arcane's lead, and the game's most-picked marksman. |
| support | Theo: **Thresh** (412, `Thresh`) −14 | Yuki: **Lux** (99, `Lux`) +13 | The two support icons. Lux is the face on most "first champion" lists. |

Names and seats are `EXAMPLE_SPLITS[0]`: blue Hana, Iris, Karim, Bilal and Theo; red Omar, Rami, Nadia, Lena and
Yuki, in lane order. The changes are illustrative whole numbers in M18's range (11.3). The winners are positive,
the losers negative, and no change is zero. The duration is `32 min` (6.12: durations are ‹21 min›, never
`32:40`; signed off 2026-10-04).

### 12.3 Anatomy

Phone, 375 (the card is 343 wide; 16px pad, so 311 inside):

```
┌─ --card, 1px --border, radius 8 ───────────────────┐
│ ◥ Red won                                   32 min │  title row: text --fs-md 700 + glyph; duration mono --fs-xs muted
│ ┌──────────────────────┐┊┌───────────────────────┐ │
│ │ ◣ BLUE 54%           │┊│░░░░░░░░░░ 46% RED ◥░░░│ │  WinBar size="compact" (40px), unchanged
│ └──────────────────────┘┊└───────────────────────┘ │
├────────────────────────────────────────────────────┤
│ [Garen] Hana          ⌂top           Omar [Darius] │  row: square | name | role | name | square
│         −18                           +17          │  change under the name, mono --fs-xs
├────────────────────────────────────────────────────┤
│ [LeeSin] Iris        ⌇jungle         Rami [Amumu]  │
│          −21                          +22          │
├────────────────────────────────────────────────────┤
│  … mid, adc, support                               │
└────────────────────────────────────────────────────┘
  An example game: ten friends on an ordinary Tuesday.  figcaption, --fs-sm muted
```

Row grid: `grid-template-columns: var(--sq) minmax(0,1fr) 3.5rem minmax(0,1fr) var(--sq)`, `column-gap: 8px`
(12 from 1024), `align-items: center`. Rows are divided by 1px `--border` hairlines, as on 5.1's seats.

| Part | Spec |
|---|---|
| Card | `--card`, 1px `--border` (not `--border-strong`: that edge belongs to the receipt, 5.5), `--radius-card`, `--card-pad`. Width: the hero's right column at ≥ 1024 (`30rem`). Below 1024 it is full column width, capped at `30rem`, and aligned to the start edge with the copy. |
| Title row | `◥ Red won`: the side glyph in `--team-red` (13px, as in the bar), then the words in the text face, `--fs-md` 700, `--foreground`. Blue winning would read `◣ Blue won`, but the fixture is red. The duration `32 min` is mono `--fs-xs` `--muted-foreground`, end-aligned (6.12). This is a `<p>`, not a heading: the hero's only heading is the h1. |
| Win bar | `<WinBar odds={…} size="compact" />` from `components/receipt/win-bar.tsx`, as is. It carries its own sr sentence. 8px below the title row and 12px above the first row. |
| Champion square | `--sq`: **40px below 768, 48px at 768–1023, 56px at ≥ 1024.** Square, `border-radius: var(--radius-chip)` (4), `object-fit: cover`, `display: block`, `flex: none`. Shown as Data Dragon delivers it: no crop, no zoom, no mask, **never a circle**, no ring, no shadow, no filter. It is not dimmed for the losing side ("nobody is dimmed", 5.1). `width` and `height` attributes equal `--sq` at the phone size (40), and CSS sizes the box, so the box is reserved before the bytes arrive. The fallback behind it is `--raised` (it shows only if the file fails). |
| Name | Text face 700, `--foreground`. `--fs-sm` (16) below 1024, `--fs-md` (19) from 1024. Blue names are start-aligned and red names end-aligned (the mirror). Wrap rule as 5.1: `overflow-wrap: anywhere`, never truncated. |
| Change | `<RatingDelta delta={n} width="change" />` (`app/_board/RatingDelta.tsx`), under the name, `--fs-xs`, 2px below. It is signed, uncoloured and uses the real minus; a gain is `--foreground` 600 and a loss `--muted-foreground` 400, as everywhere (5.3, 11.3). Blue changes are start-aligned and red changes end-aligned. |
| Role cell | Centred, 3.5rem (56px) wide. `RoleIcon` at 20px stacked over the role word in mono `--fs-2xs`, `font-stretch` 75%, `--muted-foreground`, as in 5.1's role cell. `support` is the widest word and fits at 13px. |
| Row height | `--sq` plus 8px above and below (56 / 64 / 72). |
| Caption | `<figcaption>`, `--fs-sm`, `--muted-foreground`, 8px under the card. |

Measured fit at 375: 311 − 2 × 40 (squares) − 56 (role) − 4 × 8 (gaps) leaves 71px per name. The longest
example name (`Karim`, `Nadia`) is about 50px at 16/700, so nothing wraps. At 1440: 440 inside − 2 × 56 − 56
− 4 × 12 leaves 112px per name at 19px.

Card height: about 380px at 375 (title 28, bar 40, gaps 20, five 56px rows, padding 32) and about 470px at
1440. Below 1024 the card starts right under the buttons, at about 460px on a 375 × 667 screen, so the title,
the bar and the first lane row (Garen vs Darius) are in the first screen. That is the glance.

### 12.3a Large text: the stacked row

Added at sign-off (2026-10-04). The five-column row does not fit large text on a phone: at 200% on 375 the
role column grows to 112px (3.5rem) and leaves about 43px per name, so `overflow-wrap: anywhere` breaks
‹Omar› into ‹O / m / ar›. No column width fixes that, because ‹Karim›, ‹support› and ‹Nadia› at 32px need
about 280px together and the card has 279. So the row changes shape instead of letting a name break.

- **Trigger: a container query on the card, in em.** The card (the `--card` box that holds the table) gets
  `container-type: inline-size`. The rows stack at `@container (width < 18em)`. The em resolves against the
  card's own font size, so the switch follows the text size, not the screen. At 100% on 375 the card is 311px
  (19.4em), so it keeps the normal row. At 125% it is about 15em, and at 200% about 8.7em, so both stack. A 320
  screen at 100% (16em) stacks too, and that is correct, because its names would break in the normal row.
  1440 and tablets never stack.
- **The stacked row**, still one `<tr>` per lane:

  ```
  ├──────────────────────────────────────────┤
  │                 ⌂ top                    │  role th: icon 20px inline before the word, centred
  │ [Garen]                        [Darius]  │  squares at the outer edges, 40px
  │ Hana                               Omar  │  name: blue start, red end; text face 700
  │ −18                                 +17  │  change: RatingDelta, as 12.3
  ├──────────────────────────────────────────┤
  ```

  The `<tr>` becomes `display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); column-gap: 8px`.
  The role `<th>` takes `grid-column: 1 / -1` on the first line, with the icon and the word in one line
  (`flex-direction: row`, gap 4px), centred. The blue `<td>` sits in column 1 and the red `<td>` in column 2.
  Inside each `Seat`, the square is on its own line, then the name, then the change: one column, start-aligned
  for blue and end-aligned for red. The mirror holds. The squares stay 40px and keep their outer edge. Padding
  is 8px above and below, as in 12.3. The `<colgroup>` width does not apply in this mode.
- Each name gets half the card minus 4px: about 135px at 200% on 375, and ‹Karim› needs about 100px. Keep
  `overflow-wrap: anywhere` as the last resort for a name longer than any real one. It no longer fires for real
  names.
- **Semantics stay a table.** A `display` change on table parts can drop table semantics in some engines. So
  the table parts carry explicit roles in every mode: `role="table"` on the table, `role="row"` on each `<tr>`,
  `role="rowheader"` on the role `<th>`, `role="columnheader"` on the hidden `<th>`s, and `role="cell"` on each
  `<td>`. These are redundant in the normal mode and harmless. The row still reads ‹top · Hana, Garen, lost 18 ·
  Omar, Darius, gained 17›.
- Nothing else changes: no new tokens, no side colour on the seats, and the win bar and title row are as 12.3.

### 12.4 Where it sits

- **≥ 1024:** the hero grid is unchanged (`minmax(0,1fr) minmax(0,30rem)`, `items-start`, gap 48). The example
  game replaces `<HeroReceipt>` in the right column. The h1, the sub line and both buttons do not move.
- **< 1024:** the order is h1, sub line, buttons, then the example game, 24px below (the grid's existing
  `gap-6`). The buttons stay above the fold at 375 × 667, as M14.24 requires.
- **Proof** keeps `<HeroReceipt … open />` exactly as today, with the live caption and `See this game` when the
  demo group has a rolled game, and the example receipt otherwise.
- **Nothing else on the landing page gets a champion.** Not the steps, the problem bubbles, the counters, the
  FAQ, `/download` or `/how`. The Open Graph card (5.16) is unchanged.

### 12.5 Night and Day

The layout is identical in both themes. Only tokens change: card, border, text, the bar's team fills and the
hatch. The squares are the same files, with no per-theme filter. In Day a square sits on white with no border,
as in the fearless chip.

### 12.6 Accessibility

- The whole picture is a `<figure>`. The rows are a real `<table>`, because the content is a lane-by-lane
  comparison:
  - `<caption class="sr-only">`: ‹Example game, lane by lane. Red won.›
  - visually hidden column headers: ‹Blue team›, ‹Lane›, ‹Red team›
  - one `<tr>` per lane, in lane order, with the role cell as `<th scope="row">`
- Each square's `alt` is the champion's name (`Garen`). Here the champion is the content, and nothing else on the
  row names it. That is the opposite of the fearless chip's `alt=""`, which sits beside a visible name. A row
  reads ‹top · Hana, Garen, lost 18 · Omar, Darius, gained 17›.
- The win bar stays `aria-hidden`, with its sr sentence (5.5).
- Text contrast is all stock tokens on `--card` (3.2). The role word and a loss are muted at 6.44, a gain is `--foreground`.
- Large text reflows the rows (12.3a). A name never breaks inside a word at any text size, and the page never
  scrolls sideways (M14.42). The squares do not scale with text.
- Forced colours: the bar follows 6.8's `data-side-fill` rule. The images stay. No meaning rides on colour.

### 12.7 Assets and performance

- **Self-hosted, committed, statically imported.** There are ten files,
  `apps/web/components/landing/champions/<DdragonId>.webp`, each made from Data Dragon's
  `cdn/<DDRAGON_VERSION>/img/champion/<id>.png`. They stay at the native size Data Dragon serves at the pin, **128 × 128** at 16.19.1 (no resample, so the
  art is as delivered), as WebP at quality 80, with metadata stripped. That is about 3–4 KB each and **≤ 60 KB
  for all ten** (measured 34 KB on 2026-10-04). They are imported with `import garen from './champions/Garen.webp'`, so Next emits hashed,
  immutable-cached URLs under `/_next/static/media/`.
- 128px covers 3× at 40 and about 2.3× at 56, so there is no `srcset`. If a later pin serves another native
  size, keep it as served; the `width`/`height` attributes stay 40 either way.
- **No image optimizer and no hotlink.** The page never requests `ddragon.leagueoflegends.com` or
  `/_next/image`. No new `remotePatterns`, and no preconnect on the landing page.
- **Loading:** `loading="eager"` (they are in the first screen at 1440 and near it at 375), `decoding="async"`,
  `fetchpriority="low"` so that the fonts and the h1 win. No preload. No fade-in, placeholder shimmer or blur-up.
- **LCP:** the element stays the h1 or the sub line, both text. A 56px square is far smaller than either, so it
  cannot become the LCP element. The budget (LCP < 2.5 s) is unchanged by this section.
- **CLS: 0 from this section.** Every box has a fixed size in CSS plus `width`/`height` attributes. The card's
  height does not depend on the images.
- **Failure:** a missing file shows the `--raised` box with the alt text clipped inside it. The row keeps its
  height, and the name is still there.
- **Pin bump:** the files do not follow `DDRAGON_VERSION` automatically. They are re-cut only by hand, with the
  script below. A newer patch's art change is not worth a re-cut.

### 12.8 Do not

- No League of Legends logo, wordmark, Riot fist, "LoL" lockup, or the word "official". No Riot fonts
  (Beaufort, Spiegel). No hextech gold frames, no champ-select chrome, no imitation of the client's UI.
- No splash, loading-screen or centred art, no background art band, and no art under any text.
- No circular faces, rings, glows, side-coloured borders or tints on the squares, and no greyscale for the losers.
- No champion as a role marker. The role is the word plus `RoleIcon`, as everywhere.
- No hover effect, tilt, parallax, carousel, rotation through champions or entrance animation.
- No live data in this picture. It is the fixture, captioned as an example, and the real game lives in Proof.
- No second picture lower on the page. One exception, one place.

### 12.9 Copy

| Key | String | Status |
|---|---|---|
| `EXAMPLE_GAME_CAPTION` | `An example game: ten friends on an ordinary Tuesday.` | designer draft; product may reword |
| `EXAMPLE_GAME_WON` | `Red won` | designer draft; sentence case (the upper-case side word stays inside the bar) |
| `EXAMPLE_GAME_TABLE_CAPTION` (sr) | `Example game, lane by lane. Red won.` | designer draft |
| column headers (sr) | `Blue team`, `Lane`, `Red team` | |

No existing hero copy changes. `HERO_TITLE_SET`, `HERO_SUB` and both buttons stay as they are.

### 12.10 Acceptance (designer signs on screenshots, Night and Day, at 375 and 1440)

1. At 375 × 667, the buttons and the Garen vs Darius row are both in the first screen.
2. All ten faces render from `/_next/static/media/`. The network panel shows no ddragon and no `/_next/image`
   request on `/`.
3. CLS is 0.00 on `/` with a throttled load, and the LCP element is text.
4. Nothing truncates, and no name breaks inside a word at 200% text (12.3a). The figure itself causes no
   sideways scroll. The BareShell header's overflow at 200% is pre-existing and tracked as its own follow-up, not
   part of this sign-off.
5. A screen reader reads the table row by row, with the champion names.
6. The Riot notice is still in the footer of `/` and `/about`.

## 13. In game with the kickoff teams (M21.5, ruled 2026-10-05)

From `in_progress` the in-game block draws the teams that started (M21 rules in `docs/02-milestones.md`). The
strip, the answer band, the Mode card, the sit-out card and 5.1's seat states are unchanged; only the three
things below are new. Nothing else is added: no badge, no `Custom teams` chip (the receipt explains fairness).

### 13.1 The receipt in game: one shape for all three kinds

`Odds at kickoff` is always 5.5's **compact** receipt, whatever the kind, so the card does not change shape
when the room swapped two people:

| Kind | Bar | Verdict (bold, 19px) | Line under it (muted `--fs-sm`, the reason slot) | Disclosure |
|---|---|---|---|---|
| `rolled` | compact, the split's odds (turned round on swapped sides) | `oddsSentence` as today | the off-role line as today | none |
| `custom` | compact, the stored kickoff odds | `oddsSentence` **without** `This was the fairest split these ten allow.` (the bot did not pick these teams; call it with a rank above 1 or a named helper) | `Teams changed in the lobby after the roll, so these are the odds for the teams playing now.` | none |
| `unrolled` | compact, the stored kickoff odds | as `custom` | `Kustom didn't pick these teams. Odds from everyone's ratings going in.` | none |
| not rated, `custom` or `unrolled` (M15.18) | none | none | `No odds for this game.` | none |

- No `The center line marks 50–50` caption in game (5.5 compact: the tick explains itself, and the caption
  is the full receipt's teaching line).
- **No `How the bot decided` in game for any kind.** 5.5's compact rule (no chips, no disclosure) holds; the
  rolled run returns in the finished poster's disclosure when the game ends, as it does today.
- **Not rated, no odds:** the line sits **inside** the receipt frame under the `Odds at kickoff` title, not as
  bare text between the strip and the team cards. The frame keeps the slot where every other night has odds, so
  the page does not jump when the next game is rated.
- The changed line at 375 wraps to two lines under the verdict, at 1440 one line; `text-pretty`, no other
  styling. It is the reason, not a warning: no colour, no icon.

### 13.2 A changed side's team card

A side whose five are not the split's five has no lanes until the end of game:

- **No role cell at all.** When every seat on the card has no role, the card's rows drop the role column
  (`grid-template-columns: minmax(0,1fr) auto`) and the name starts at the card padding (`--card-pad`), not
  after an empty 52/60px gutter. An empty gutter reads as missing data. A side that kept the split's five keeps
  5.1's role cell; the two cards may then start their names at different x, which is correct (they say
  different things).
- **Order: Rating, highest first**, ties by name. Not lane order (unknown), not join order.
- Seat height, the `YOU` states, `settling` and `new` chips are 5.1's. No `off-role` chip (there is no lane to
  be off).
- The answer band says `YOU on RED` with no `, playing <role>` (already built).
- At the end of game the result's seats bring the real lanes back; no in-game guess at lanes from the split.
