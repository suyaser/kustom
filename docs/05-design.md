# Design

Owner: `designer`. This document is the source of truth for tokens, type, copy shape and layout across
`apps/web` and the Discord embeds. If a UI task disagrees with this file, this file is wrong or the task is —
say which, do not invent a third answer.

## Who is looking at this, and where

A phone, held at arm's length, in a dark room, opened from a WhatsApp link, while the person is already in
Discord voice and about to be in a game. They have three questions, in this order:

1. **Am I in, and which side?**
2. **Why these teams?**
3. **What happened?**

Everything below is ordered by those three questions. **Night is the default theme** (2026-09-13): the
gaming look after dark. Day is the same system in light. Phone widths are the design width; the desktop
layout adds a second column and a rail, not a bigger phone.

Tone, **amended 2026-09-09 by the user's own calibration**: *"it should look like an actual gaming product,
modern, something like Blitz and so, with its own character and style."* v1 read this as a scoreboard in a
friend's living room and built something so restrained it looked unfinished. The corrected tone is a **games
product for twenty friends**: dense, lit, confident, and still honest. Plain nouns, real numbers, no hype;
never "GG", never "EPIC", never a broadcast lower-third — but also never a bare list on a black field. The
subject has a vocabulary — `top jungle mid adc support`, blue 100 and red 200, ranks, ratings — and that
vocabulary is the content. It is never decoration. The system that carries it is **Floodlit**, next.

## Floodlit — the v2 system (2026-09-09)

**Supersedes** the `Palette`, `Type` and `Spacing, size, motion` sections below, and the tonight-page half of
`Components`. Those sections are kept, retitled `v1 — superseded`, because the embed sections and several
component rules still quote them and because a superseded decision is worth more than a deleted one. **Where
v1 and this section disagree, this section wins.** The Discord embed sections are untouched: Discord has no
CSS and nothing here reaches it.

Why there is a v2 at all: the deployed page (screenshot, 2026-09-09, 430px) renders v1 faithfully and reads as
unfinished. No wordmark, no date, no navigation, one unexplained number per row, the word `flexible` nine
times, and 449px of empty reserved card. The user's own words on what it should be instead: *"it should look
like an actual gaming product, modern, something like Blitz and so, with its own character and style."* v1 was
restrained to the point of having no character. This one has one, and the character is named so that every
later choice has something to be checked against.

### The character, in one sentence

> **Floodlit: a dark stadium after dark — near-black ink, one warm light overhead, and the ten names lit up
> under it in blue and red.**

Five rules fall straight out of it, and every visual decision in this section is one of them:

1. **The light comes from above, and there is one of it.** Surfaces are lit on their top edge (a 1px inner
   highlight) and sit on a background that is faintly warmer at the top of the page than at the bottom. There
   is exactly one glow in the product — the live pill — because there is one lamp.
2. **Ink, not grey.** The background is a blue-black at `#0B0E14`, not a neutral charcoal, so the two side
   colours sit on something that belongs to them. Never `#000`: pure black smears text on an OLED phone.
3. **Colour is a team, a state, or nothing.** Blue is side 100, red is side 200, amber is the light — live,
   you, off-role, the winner's ring, the control you may press. There is no fourth colour and no decorative
   use of the first three.
4. **Dense, like a stats site.** Rows are tight, numbers are tabular, labels are small and always present. A
   card that shows five facts is better than a card that shows one fact large. The only large type in the
   product is a result and a count.
5. **Structure over ornament.** Rules, tints, rings and one gradient. No glass blur, no neon, no crest, no
   emoji, no purple. **No splash art, no loading-screen art, no portrait crop, no decorative champion art —
   anywhere.** The single exception is a 24×24 square champion icon leading the name on a fearless chip on `/`
   (M11, "The fearless icon exception" below). Any other surface that wants a champion icon needs its own named
   exception written into this file by the designer before code. "The fearless card has them" is not a
   precedent.

### Palette

Nine named tokens per theme, up from seven. The two new ones are the reason the page can look built: a second
surface to raise things onto, and a line colour that is a colour rather than an alpha guess.

| Token | Role | Dark | Light |
|---|---|---|---|
| `bg` | Page ink. Blue-black. | `#0B0E14` | `#EEF1F6` |
| `surface` | Cards, rows, strips. | `#141923` | `#FFFFFF` |
| `raise` | The layer above a card: card headers, chips, tabs, the top bar, empty seats' contrast partner. | `#1D2431` | `#DAE2ED` |
| `line` | Every hairline and card border. A real colour, so borders are the same on all three surfaces. | `#2A3140` | `#D5DCE7` |
| `text` | Everything you are meant to read. | `#EEF2F8` | `#10141B` |
| `dim` | Labels, counts, secondary lines. Never a player's name, never a rating. | `#94A0B2` | `#556072` |
| `blue` | Side 100. | `#4C9AFF` | `#1F5FC4` |
| `red` | Side 200. | `#FF6B63` | `#B4302B` |
| `brand` | Amber. The light. Live state, "you", off-role, the reroll control, the winner's ring, the wordmark's one lit letterform, links. **Renamed from `accent`; every rule that said `accent` now says `brand`, unchanged.** | `#FFB13C` | `#8A5A0B` |

Contrast, measured (WCAG 2.1, computed 2026-09-09 — not eyeballed):

| | on `bg` dark | on `surface` dark | on `raise` dark | on `surface` light | on `raise` light |
|---|---|---|---|---|---|
| `text` | 17.19 | 15.67 | 13.86 | 18.45 | 14.13 |
| `dim` | 7.29 | 6.65 | 5.88 | 6.36 | 4.87 |
| `blue` | 6.78 | 6.18 | 5.47 | 6.01 | 4.61 |
| `red` | 6.93 | 6.32 | 5.59 | 6.18 | 4.73 |
| `brand` | 10.68 | 9.73 | 8.60 | 5.92 | 4.53 |

Everything passes AA on every surface in both themes. **Blue and red are within 0.15 of each other in dark**
(6.18 / 6.32, against v1's 1.1 spread): if one side were brighter, that side would read as the favoured one
before anybody read a number. `brand` at 9.73 is deliberately the brightest thing on a dark page — it is the
lamp, and it is only ever on a few square centimetres at a time.

Light's three layers were 1.08 apart against dark's 1.24, which is why the light top bar and every light card
header nearly vanished on the rendered page (designer's review of M3.18). `#DAE2ED` puts them 1.15 apart and
every colour stays above 4.5 on it.

**Derived values. Do not add hex; derive.**

```
blue tint      color-mix(in srgb, var(--cn-blue) 10%, var(--cn-surface))
red tint       color-mix(in srgb, var(--cn-red) 10%, var(--cn-surface))
brand tint     color-mix(in srgb, var(--cn-brand) 12%, var(--cn-surface))
blue line      color-mix(in srgb, var(--cn-blue) 55%, var(--cn-line))
red line       color-mix(in srgb, var(--cn-red) 55%, var(--cn-line))
pressed        color-mix(in srgb, var(--cn-text) 8%, var(--cn-raise))
lit            inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent)     /* the top-edge highlight */
glow           0 0 0 4px color-mix(in srgb, var(--cn-brand) 14%, transparent) /* the live pill, and nothing else */
```

**The one gradient in the product.** The shell carries a single soft radial at the top, the floodlight:

```css
background:
  radial-gradient(120% 70% at 50% -15%, color-mix(in srgb, var(--cn-brand) 5%, transparent), transparent 65%),
  var(--cn-bg);
```

5% amber over 65% of the fold. It is felt, not seen, and it is what stops a 1400px desktop viewport from
being a flat black field. It is fixed to the shell, does not scroll, and is the only `linear`/`radial-gradient`
allowed anywhere in `apps/web`. No purple, no teal, no two-stop brand ramp behind a hero. The M11 share cards
paint this same amber floodlight into their PNG ("Share cards" below). That is the same light drawn in a
second medium, not a second gradient. Nothing else gets a gradient: not a chip, not a tape, not a poster.

**Colour rules that survive v1 unchanged, and are still the ones people break:**

- A side colour is a rule, a text colour, a ring, or a tint at 10%. **Never a filled block behind five names.**
- **Rating deltas are never coloured by sign.** No green. A gain is `text` at 600, a loss is `dim` at 400, both
  always signed. Green-for-good collides with `red` meaning side 200.
- Nothing pulses but the live dot. Nothing shimmers. There are no skeletons.

### Type

Two families. Archivo is loaded as a **variable font with the width axis**, which buys a display cut with no
second download: `next/font/google` supports `axes` on variable families.

| Family | Role | How | Fallback |
|---|---|---|---|
| **Archivo** (`wght` 400–800, `wdth` 100–125) | Everything read as language, plus the display cut. Normal width for names, copy and labels; **`wdth` 118 at weight 800 for display** — the result headline, the lobby count, the wordmark. A wide grotesque at 800 is a scoreboard face; it is also not what an AI page looks like, which is a thin serif or a geometric sans. | `Archivo({ subsets:['latin'], axes:['wdth'], display:'swap', variable:'--cn-font-archivo' })` | `'Helvetica Neue', Arial, system-ui, sans-serif` |
| **IBM Plex Mono** (400, 600) | Everything read as data: ratings, deltas, gap, percentages, duration, rank, role words, lobby password, PUUID fragments. Tabular figures, a distinguishable `1`/`l`, a real minus. | unchanged from v1 | `ui-monospace, 'SF Mono', Menlo, monospace` |

The split is still the whole system: **number or role → mono; person or sentence → Archivo.** Every numeric run
sets `font-variant-numeric: tabular-nums`.

The display cut is one utility, used in four places and nowhere else:

```css
.cn-display {
  font-family: var(--cn-font-sans);
  font-variation-settings: 'wdth' 118;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.02;
}
```

If the `wdth` axis is a problem in `next/font` for any reason, the fallback is plain Archivo 800 with
`letter-spacing: -0.02em` and the page loses a little character and nothing else. Do not substitute a second
family for it.

#### Scale

Root 16px. Body 17px — the page is read at arm's length. Nothing that carries meaning goes below 12px.

| Token | Phone | ≥720px | Line height | Used for |
|---|---|---|---|---|
| `t-xs` | 12px | 12px | 1.35 | role words, chips, legends, per-row meta, nav tabs |
| `t-sm` | 14px | 14px | 1.4 | deltas, duration, the status sentence, footer |
| `t-base` | 17px | 17px | 1.5 | body, the explanation line, sit-out copy |
| `t-md` | 19px | 19px | 1.25 | player names in rows, ratings |
| `t-lg` | 24px | 26px | 1.2 | side names, card and section headings |
| `t-xl` | 32px | 36px | 1.1 | the wordmark's home for growth; secondary headlines |
| `t-display` | 44px | 56px | 1.02 | **two things only**: the lobby count and the result headline |

Weights: 400 body, 500 labels, 600 names and numbers that matter, 800 display only. **No 300, ever.**

Letter-spacing: `-0.02em` on `t-display`, `-0.01em` on `t-lg` and `t-xl`, `0.06em` on mono role words and
`0.08em` on mono micro-labels (`live`, `open`, legends), which are always lower case — `top`, `adc`, never
`TOP`. **Upper case is allowed on the display cut only** (`BLUE WINS`), because that is a scoreboard and not a
role.

### Space, shape, elevation, motion

4px base, unchanged: `sp-1` 4, `sp-2` 8, `sp-3` 12, `sp-4` 16, `sp-5` 24, `sp-6` 32, `sp-7` 48, `sp-8` 64.

- Radius: `10px` on cards, `8px` on inner rows and buttons, `4px` on chips, `0` on hairlines. Softer than v1's
  6px because cards are now layered and a tight radius on a stack reads as a table.
- **Every card is: `surface` fill, 1px `line` border, `lit` inner top highlight.** That trio is the whole
  elevation system. There is no shadow anywhere else; a dark UI gets depth from a lit edge, not from a blur.
- `raise` is the layer *inside* a card: the card's header bar, chips, the nav tabs, the top bar itself.
- Every tappable thing is at least **44 × 44px**, including role taps (M3.6), the reroll button, the nav tabs
  and every footer link.
- Motion: `opacity 150ms ease` for anything appearing, `background-color 120ms` and `transform: scale(.985)`
  on press for buttons and tabs, a 2s opacity cycle on the live dot. Nothing else moves.
  `prefers-reduced-motion: reduce` drops all of it including the pulse.

### Iconography

Inline SVG, drawn in this repo, `currentColor`, 24×24 viewBox, `stroke-width: 2`, round caps and joins, no
fill. One component, `apps/web/app/_icons/RoleIcon.tsx`, five paths. **The icon never appears without its
word** — it is an anchor for the eye in a dense row, not a replacement for language — and it is always
`aria-hidden`, because the word beside it is the accessible name.

```
frame (top/mid/adc only, stroke at 30% opacity)   <rect x="3.5" y="3.5" width="17" height="17" rx="4"/>
top        M8 16 V8 H16
mid        M8 16 L16 8
adc        M8 16 H16 V8
jungle     M18 6 C9 6 6 9 6 18 C15 18 18 15 18 6 Z     +  M9 15 L15 9
support    M12 4 L19 7 v5 c0 4 -3 6.5 -7 8 c-4 -1.5 -7 -4 -7 -8 V7 Z
```

The three lanes sit **inside** the frame with a clear unit of air (8→16, not 6→18). At 14px the old geometry
left under a pixel between the glyph and the frame's inner edge and the two strokes merged: `top`, `mid` and
`adc` all read as the same small filled square. The word beside it still carries the meaning; the mark has to
be worth its 14px.

Sizes: 14px beside a name in a row, 16px in a card header, 20px on `/p/[puuid]`. Colour: `dim` normally,
`brand` when the seat is off-role, the side colour never — a role is not a team.

**Sides get no icon and no crest.** A side is a 4px rule in its colour on the card's leading edge plus its name
in the display cut. There is no asset pipeline in this project and there should not be one.

The only other glyph in the product is the live dot: an 8px circle, `brand`, inside a `raise` pill with the
word `live` in mono `t-xs`. The pill carries the `glow` shadow. That is the one glow.

#### The fearless icon exception (M11, designer 2026-09-23; extended to the overlay by M12)

The places in the product where a champion is drawn: the fearless card on `/`, and the fearless block of the
optional overlay (M12). Why these places: both are used during pick, and in champion select people recognise
a face faster than they read a name. Everywhere else a champion is a word: Discord, `/fun`, `/games`, the
player page, the result poster, the night tape and the share cards. None of those gets an icon, and none gets
one later without a new exception written here.

**The overlay reuses this exception byte for byte.** Same 24×24 square, same Community Dragon URL from
`championIconUrl`, same `alt=""`, same opacity rules for banned chips. The overlay does not draw open-lane
tails and does not have a find box; its fearless block is the ban list alone.

**The object.** A square champion icon, shown as the source delivers it. There is no zoom, no face crop, no
mask and no frame, because a portrait crop is the "no portrait crop" rule above. Keyed by the numeric
`FearlessChampion.id`, the same id the name comes from.

| Property | Value |
|---|---|
| Rendered size | **24 × 24 CSS px, at every width.** It does not grow on desktop. Ask for a 48px source for 2× screens if the source offers one. `width="24" height="24"` on the element, so the box is reserved before the bytes arrive. |
| Shape | Square, `border-radius: 4px`. **Never a circle.** A round champion face reads as a ranked emblem or a crest, and crests are banned. |
| Fit | `object-fit: cover`, `flex: none`, `display: block`. No `transform: scale()` to trim a baked-in border. |
| Placement | First child of the chip, before the name. Gap `sp-2` (8px). |
| Loading | `loading="lazy"`, `decoding="async"`. **It does not fade in**: no opacity transition on load, no placeholder fill and no shimmer. The reserved 24px box is empty until the image paints. |
| `alt` | `alt=""`. The name beside it is the accessible text, and a screen reader must not say "Ahri Ahri". |
| Glow, ring, shadow | None. Icons do not glow. The live pill is still the only lamp. |
| Theme | Identical in Day and Night. No filter per theme. |

**The chip, restated for M11.** The markup stays `ul.cn-fearless-list > li`, and the `img` goes inside the
`li` ahead of the text node. Today's chip is about 31px tall (14px × 1.5 line height, 4px padding, 1px
border), so a 32px floor changes nothing that already renders:

```css
.cn-fearless-list li {
  display: inline-flex;
  align-items: center;
  gap: var(--cn-sp-2);
  min-height: 32px;
  padding: 3px 10px;                 /* no icon: the chip as it is today */
  /* background, border, radius, type: unchanged */
}
.cn-fearless-list li:has(> .cn-fearless-icon) {
  padding-inline-start: 3px;         /* 3 + 1 border + 24 + 3 + 1 = 32px square lead */
}
.cn-fearless-icon {
  width: 24px; height: 24px;
  flex: none; display: block;
  object-fit: cover;
  border-radius: 4px;
}
.cn-fearless-open-chip .cn-fearless-icon { opacity: 0.55; }
.cn-fearless-hit .cn-fearless-icon { opacity: 1; }
```

(If `:has()` is unwelcome, put a `cn-fearless-chip-icon` class on the `li` when an image is rendered. Both
produce the same box.)

| Chip | Icon | Name | Chip dress |
|---|---|---|---|
| **Banned** | Full opacity | `text`, 600, as today | `raise` fill, `line` hairline, as today |
| **Open** (`cn-fearless-open-chip`) | **`opacity: 0.55` on the `img` and nothing else.** No `filter: grayscale()`, no desaturate, no tinted overlay: a grey champion is a fourth colour. | `dim`, 500, as today | Transparent fill, dashed `line` border, as today |
| **Find hit** (`cn-fearless-hit`) | **Full opacity, never recoloured**, even when the hit is an open chip. An icon tinted amber looks like a rendering bug. | `brand`, as today | `brand-tint` fill, `brand` border plus inset ring, as today |
| **Unknown id** (name falls back to `Champion ${id}`) | **No `img` element.** | As its row | Unchanged, and no reserved blank square |
| **Image fails to load** | Remove the `img` (`onError` drops it). The chip reflows to name-only once, at load time. Never a broken-image glyph, never alt text in the chip. | As its row | Unchanged |

**Height, and the 44px rule.** The chips are not controls: they are list items with no handler, and nothing
on this card is tappable except the find box, which is already 44px. So the 44px floor does not apply. **Every
chip, including the find hit, is 32px.** Growing the hit chip to 44px would reflow every wrapped row below it
on each keystroke, in the one box people type into while pick is running. That is a layout shift under a
thumb, which "The tonight page v2" forbids. If a chip ever becomes tappable, every chip goes to 44px at once,
not just one state.

**What does not change.** The lane words, the `open` label, the find box, the count, the sentence and the
A–Z order stay as they are. No gradient or tint sits behind an icon. An icon never appears without its name
(same rule as `RoleIcon`). No champion appears outside this card.

### The app shell

Every page of `apps/web` outside `/admin` gets the same shell. It is what makes the tonight page a page of a
product rather than a document that happens to be dark.

```
┌───────────────────────────────────────────────────────────────┐
│  ▍KUSTOM     Tonight  Leaderboard  Games  Stats  Fun  1v1  Daily   Day Night │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   … page content, on the paper or the ink, under the floodlight … │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  How this works · Get the companion · Your games              │  footer: dim, t-sm
└───────────────────────────────────────────────────────────────┘
```

### Themes — Day and Night (2026-09-13)

Two named looks, one `data-theme` on `<html>`, persisted in `localStorage` as `cn-theme`. Night is the
default and the `:root` tokens. A `beforeInteractive` script writes the stored name before first paint,
and the toggle reads `data-theme` after mount so a refresh cannot show Day selected on a Night page.
A leftover stored `current` becomes Night.

| Name | File | What it is |
|---|---|---|
| **Night** (default) | `tokens.css` `:root` / `[data-theme=night]` plus `theme-gaming.css` | The gaming look after dark. |
| **Day** | `[data-theme=day]` plus the same file | The same system on cool paper. Same Archivo + Plex Mono, same chips and cards. |

Colour is still a team, a state, or nothing. Day and Night do not add a fourth colour, champion art, glass,
or a second font. Admin adopts the same tokens and keeps its own shell.

The theme control is one switch in the top bar (`Day` / `Night`), dressed like the nav tabs: Archivo,
the same size and tracking, the active word underlined in `brand`. One tap flips. Phone: wordmark and
the switch on the first row, tabs on the second. Desktop: wordmark, tabs, switch. The live pill stays in
the status strip.

- **Wordmark.** `KUSTOM` in the display cut at `t-md`, upper case, letter-spacing `0.02em`, in `text`,
  preceded by a 3px × 18px `brand` bar (`▍`). That bar is the lamp and it is the entire logo. No image, no
  favicon work beyond a 32px version of the bar on ink. **The product is called Kustom** (the user, 2026-09-09:
  the group says "kustom"); `Customs Night` is the repo's codename and stays in `CLAUDE.md`, the docs and the
  package names. Every friend-facing surface — wordmark, `<title>`, embed footers, README, console — says
  Kustom. Six letters at 800 weight is also a better wordmark than thirteen.
- **Nav.** Tabs, mono `t-xs`, `0.08em`, lower case is wrong here — these are destinations, so Archivo `t-sm`
  500 in `dim`, the current one in `text` with a 2px `brand` underline. Order: `Tonight`, `Leaderboard`,
  `Games`, `Stats`, `Fun`, `1v1`, `Daily`, `Companion ↗`. **A tab is rendered only if its route exists**: `Leaderboard` lands with M3.5,
  `Games` with M5.25, `Stats` with M5.4, `Fun` with M5.24, `1v1` with M8.5, `Daily` with M5.32, `Companion` is external and always there. A nav item that 404s is worse than a missing
  one. Keep the list in one exported array (`lib/nav.ts`) so no page hand-writes it.
- **The daily tab is `Daily`, not the name of either game** (renamed 2026-09-16 by M8.4, from `Mystery`).
  Two games now alternate civil days behind `/mystery` (Daily Mystery and Guess the Award), and this tab is
  rendered by the shell on **every** page of the site. Naming one game would make the shell state a fact it does
  not have: the shell has not loaded today's challenge, and it must not spend a query per page view to learn
  which game it is, so `Mystery` over an award day was the same wrong word printed on six pages at once.
  `Daily` is true on both days and on a day with no challenge at all. The word lives in `lib/mystery/copy.ts`
  as `DAILY_LABEL` and `lib/nav.ts` imports it, exactly like `Games`, `Stats` and `Fun` — the tab is still the
  page's own word, that word just stopped being a title. **`/mystery`'s `<title>` does name the game**
  (`Guess the Award · Kustom`), because that page has already paid for the load and a tab reading one game over
  a card reading the other is the page arguing with itself.
- **Phone.** Two rows: wordmark and the theme switch (44px), then the tab row (44px, tabs left aligned,
  horizontally scrollable with no scrollbar). Not sticky — a sticky bar costs 88px of a 700px screen on the
  one page people read in full.
- **Desktop (≥720px).** One row: wordmark left, tabs, theme switch right.
- **The live pill is not in the top bar.** It belongs to the status strip, next to the state it describes, and
  a product has one place for a piece of information. The top bar carries identity, destinations, and the
  theme switch (`Day` / `Night`).
- **Footer.** One line of links, `t-sm` `dim`, top border `line`, `sp-6` above it. The date and season are the
  status strip's slug line and are not repeated here. `Your games` appears only for a signed-in viewer and points at
  `/p/<their puuid>`. `Get the companion` points at the **releases page**, not the `.exe` — the tonight page
  is opened on a phone, and a link that starts a 90MB Windows download on a phone is a bug:
  `https://github.com/suyaser/kustom-releases/releases/latest`. The direct `.../latest/download/Kustom.exe`
  link stays on `/admin` and in the group chat, where the reader is on the PC that needs it.
- **`How this works`** is a `<details>` in the footer, closed by default, four short lines. No new route, no
  new data, and the one place on the page allowed to change height — because a person tapped it. Its summary
  is dressed exactly like the links beside it, underline included: two amber controls on one row, one
  underlined and one not, reads as a mistake.
- **Card titles are language, so they are Archivo**: `t-sm`, 600, `text`, no tracking — `How this works`,
  `Run the companion`, and any card title after them. Mono `t-xs` `dim` `0.08em` is for legends and states
  only: `SEATS`, `rating`, `AROUND`, `live`, `open`. A sentence set in 12px tracked mono reads as a code
  comment and ends up quieter than the prose it introduces.

Shell CSS, in outline:

```css
.cn-shell {                      /* wraps top bar, main, footer */
  min-height: 100svh;            /* svh, not vh: the phone URL bar must not move the footer */
  display: flex; flex-direction: column;
  background: var(--cn-floodlight), var(--cn-bg);
}
.cn-topbar { background: var(--cn-raise); border-bottom: 1px solid var(--cn-line); }
.cn-topbar-inner, .cn-main, .cn-footer-inner {
  max-width: 76rem; margin: 0 auto; width: 100%;
  padding-inline: var(--cn-sp-4);
}
.cn-main { flex: 1; padding-block: var(--cn-sp-5) var(--cn-sp-7); }
.cn-footer { margin-top: auto; border-top: 1px solid var(--cn-line); }
@supports (padding: max(0px)) {
  .cn-topbar-inner { padding-top: max(0px, env(safe-area-inset-top)); }
  .cn-footer-inner { padding-bottom: max(var(--cn-sp-5), env(safe-area-inset-bottom)); }
}
```

### Breakpoints and the desktop grid

Three widths, and no fourth:

| Width | Layout |
|---|---|
| `< 720px` | One column, full width inside `sp-4` gutters. The design width. |
| `≥ 720px` | One column, `max-width: 44rem`, centred; team cards go side by side, blue left; gutters `sp-5`. |
| `≥ 1080px` | **Two columns**: main `minmax(0, 1fr)`, rail `20rem`, gap `sp-6`, the pair centred inside the shell's 76rem. |

The rail is what stops a phone column floating in a black field, and it is never empty:

```
≥1080px
┌ main ─────────────────────────────┐ ┌ rail ──────────────┐
│ status strip                      │ │ Top of the board   │
│ primary block (seats/teams/result)│ │  5 rows            │
│                                   │ │                    │
│                                   │ │ How this works     │
│                                   │ │  4 lines           │
│                                   │ │                    │
│                                   │ │ Run the companion  │
│                                   │ │  1 line + link     │
└───────────────────────────────────┘ └────────────────────┘
```

- `Top of the board` is the leaderboard's first five rows, reusing M3.5's row component and a
  `loadTopPlayers(client, { limit: 5 })`. It ships **with M3.5**; until then the rail holds the other two
  cards and nothing looks broken.
- The rail is `display: none` below 1080px. Its content is duplicated in the footer (`How this works`,
  `Get the companion`), so a phone loses no information.
- **The rail never carries state.** No live data that changes under a thumb, no reroll, no role tap. It is
  three static cards and a board snapshot that refreshes with the page.

### The tonight page v2

The two rules from v1 that do **not** change, and that nothing below is allowed to bend:

- **One primary block**, chosen from `lobbies.status` for the newest non-abandoned lobby tonight, replaced in
  place. The state table in "The tonight page's three states — one rule" is still the state table.
- **No layout shift inside a state.** A join, a name arriving, a reroll: none of them may move a pixel that a
  thumb is already over. v2 keeps this by making the reserved space *content* instead of emptiness.

#### The status strip

Always mounted, the only element that survives every transition, and now three lines instead of one:

```
TUESDAY 9 SEPTEMBER                               ← slug: mono t-xs, dim, 0.08em, upper case
9 IN THE LOBBY                          ● live    ← headline: count t-display brand + label t-lg display, upper
One more to go.                                   ← sentence: t-sm dim, two lines reserved
```

- The **slug** is the night's date (from `nightStart`, so a 01:00 game still says Tuesday), and **nothing
  else**. It is the line that tells a friend from WhatsApp what they are looking at and when. Formatted **on
  the server and in the snapshot**, `Intl.DateTimeFormat('en-GB', { weekday:'long', day:'numeric',
  month:'long', timeZone: CUSTOMS_NIGHT_TZ })` — a fixed locale and the configured timezone, or the browser
  re-render disagrees with the server render and the line changes under the reader. **The season name is gone
  from this line** (M5.12, `04-decisions.md` 2026-09-10): a season is no longer a thing a friend has, so the
  slug that used to read `TUESDAY 9 SEPTEMBER · SEASON 2` is the date alone in every state. The middot and the
  half after it go with it — there is no second half to fall back to and nothing takes the slot. The board's
  own dates live in the window slot on `/leaderboard`, which is a different page and a different line.
- The **headline** is `<count> IN THE LOBBY` while filling and one word or phrase otherwise:
  `NOTHING TONIGHT`, `TEAMS ARE SET`, `IN GAME`, `FINAL`. The count is `t-display` in `brand`; the label is
  `t-lg`, display cut, upper case, `text`.
- The **live pill** sits at the right end of the headline row: `raise` fill, 4px radius, an 8px `brand` dot on
  a 2s opacity cycle, the word `live` in mono `t-xs` `0.08em` `dim`, and the `glow` shadow. It is the only
  glow in the product and the only pulse. It is gone at `finished` and on the idle page. The word is the
  accessible text; the dot is `aria-hidden`. **The v1 dot with no word is a defect**: a pulsing orange circle
  that nothing names means nothing.
- The **sentence** is the page's one polite live region (`aria-live="polite"`) and is given
  `min-height: calc(2 * 1.4 * var(--cn-t-sm))` so that any sentence up to two lines on a 390px screen changes
  without moving the block below it. It changes with the count, which is the one text on the page that changes
  without a state change.
- The **ten bars of v1 are removed.** The seat rack below says the same thing with names in it.

#### Filling — the seat rack

The v1 list reserved 449px and left it blank, which on a six-person night is four rows of empty card and is
what "unfinished" looks like. v2 renders **ten seats, always**, and an unfilled seat is a seat.

```
┌ SEATS · 9 of 10 ─────────────────────── rating ┐   header: raise, 32px, mono t-xs dim
│  1sec Reloading                           1612 │   44px rows, hairline between
│  FoxHound                                 1612 │
│▌ PRT Empty                                1252 │   ▌ = 2px brand inset rule: you
│  PRT Khokha                               1553 │
│  Raafat                                   1688 │
│  Ramzyinhović                             1274 │
│  Rano of Zaun                             1373 │
│  SugarPapy                                1576 │
│  The Single Guy                           1634 │
│  open                                          │   recessed: bg fill, `open` mono t-xs dim 0.08em
└────────────────────────────────────────────────┘
Nobody has a role set, so the balancer treats everyone as flexible.
```

- The rack is exactly ten rows tall at every count, so the 9 → 10 join replaces `open` with a name and moves
  nothing. This is the same guarantee as v1's `min-height`, kept as content rather than as a number that has to
  agree with a font. `10 × 44px + 9px` is still the arithmetic and `rowHeight.test.ts` still guards it — it
  now also asserts that ten `<li>` are rendered at every count.
- An empty seat is filled with `var(--cn-bg)` — recessed below the card — so the rack reads as a rack. It is
  not a skeleton: it does not shimmer, it does not fade, and it is the same on the server and the client.
- Header: `SEATS · 9 of 10` left, `rating` right, both mono `t-xs` `dim` `0.08em`. **That `rating` legend is
  the fix for "1612 means nothing".** One 12px word, right-aligned over the column, in exactly the pattern the
  leaderboard already uses (`Proven · Rating` as a legend, not a header row).
- Row grid, phone: `[you] name 1fr · role 6.5rem · rating 4.5rem`, gap `sp-4`. The v1 grid was `1fr auto auto`
  with a 12px gap, which let `flexible` and `1612` collide into one blob against the right edge. Fixed columns
  give the eye an edge and are what a stats site looks like. **At ≥720px the name column is capped**:
  `minmax(0, 16rem) · role 10rem · rating minmax(4.5rem, 1fr)`. A `1fr` name on an 830px column is 450px of
  nothing between a name and its role (measured on the rendered page: a 566px column carrying 124px of text),
  which is the sparse look this redesign exists to end; the team cards' own `6.5rem 1fr 5.5rem` is the proof of
  the other way. The rating stays hard right, under its legend.
- **`flexible` only appears when it distinguishes.** If *no* member on screen has a role, the role column is
  not rendered at all and one line under the rack says so once. If *some* do, every row shows its roles and
  the ones with none show `flexible`, because there the word is contrastive information. Nine identical grey
  words in a column is not information; it looks like a field that failed to load.
- Roles, when shown: `RoleIcon` at 14px + the role word, mono `t-xs` `dim`; a secondary role follows in the
  same treatment after a middot, no icon. `top · mid`, never `top / mid` — a slash between two roles reads as
  a fraction next to a column of numbers. **The role column is 6.5rem below 480px and 10rem above it**, and the
  second role is `display: none` below 480px — never removed from the DOM, so it stays in the accessible name.
  10rem is measured, not guessed: `jungle · support` with its icon and gap is 149px at 12px mono with 0.06em. A
  column that hard-cuts to `suppo` is worse than one that shows the role somebody actually plays.
- **A role override prints as `<the override> · <their usual main>`** — `support · jungle` — because that is
  literally what core holds once `resolveRoles` demotes the old main to backup, so the column's existing
  "main · backup" grammar carries it with nothing new to learn. `support` alone destroys information on the
  one row the reader cares most about, and at 480 and up it makes that row look like it lost a field while
  nine rows beside it show two roles. No arrow, no badge, no second colour: the only glyphs on this page are
  the five role icons and the live dot, and an arrow beside a column of tabular numbers reads as a trend. The
  `you` rule already says whose row it is. Below 480 the second role is hidden as usual, so the phone is
  unchanged. `resolveRoles` is exported from `@customs/core` for exactly this (`04-decisions.md`,
  2026-09-10); `lib/tonight/roles.ts` asks it rather than restating the rule.
- The "just joined" 2px `brand` inset rule and the permanent "you" rule are unchanged from v1, including the
  reason they are inset shadows rather than borders.
- People past the ten sit under the rack, under a `raise` divider labelled `Around`, in the same row shape.
  Nothing is reserved for them.
- Empty lobby: the rack renders ten `open` seats and `Nobody in the lobby yet.` sits under it. A rack of ten
  empty seats is a better empty state than a sentence alone, and it is the same component.

#### Teams

```
┌────────────────────────────────────────────────┐   card + brand 3px left rule, no header
│ Sitting out this game: Sara and Deniz. Each    │
│ game goes to whoever has played least tonight… │
└────────────────────────────────────────────────┘

┏━━━━━━━━━━━━━━ 4px blue ━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ BLUE                                      7695 ┃  raise header: side name display t-lg blue, sum mono t-md dim
┠────────────────────────────────────────────────┨
┃ ◺ top       Hana                          1434 ┃
┃ ✦ jungle    Iris                          1578 ┃
┃ ◹ mid       Karim                         1551 ┃
┃ ◿ adc       Bilal                         1713 ┃
┃ ⛨ support   Theo                          1419 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━ 4px red ━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ RED · ● off-role                          7595 ┃  legend: mono t-xs dim, brand dot; sum unmoved
┃ ◺ top       Omar                          1469 ┃
┃ …                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  Move to your side in the lobby.                    side line: Archivo t-sm dim, `balanced` only

┃ Blue favored 54%. Everyone on a main role.      ┃  explanation: 3px brand left rule, t-base text
┃ Gap 100. Next best: swap Hana and Omar, gap 170.┃
┃                                    [ Reroll ]   ┃  admins only, right on ≥720px
```

- The 4px side rule is on the **leading edge**: the top edge when the cards are stacked (phone), the left edge
  when they are side by side (≥720px). Same rule, one `border-block-start` / `border-inline-start` swap in the
  media query.
- Card body keeps the 10% side tint; header bar is `raise` with the side colour on the name only. **Never a
  filled side-coloured block behind five names.**
- Role column: icon + word, `dim`; **off-role turns the icon and word `brand` and adds a dotted underline
  under the word**, plus the `brand` dot before the name and the visually-hidden `off-role` — colour is never
  the only signal, and the stored explanation names them in a sentence anyway. The header bar of a card that
  has any marked seat also carries a `· off-role` legend, and a card with **three or more** marked seats
  drops the amber from its role words. Both are specified in full in the two sub-sections below, and both are
  counted **per card**.
- Lane order, always, top to support. Never sorted by rating. The sum stays a bare number with its
  visually-hidden `sum of the five ratings` (product, 2026-09-08 — not reopened).
- The explanation strip is unchanged in every way that matters: `splits.explanation` verbatim, one `<p>`,
  never recomposed, never truncated, `text` and not `dim`. It gets the v2 card treatment (surface, `line`
  border, `lit` highlight, 3px `brand` left rule).
- **The reroll control stays on the explanation strip** and does not move to the top bar. The button means
  "give me a different version of *this sentence*"; in a header it would be a control with no object. On phone
  it is full width below the sentence, on ≥720px it is right-aligned beside it. The disabled state and the
  `No more splits. …` note are unchanged.
- The sit-out strip stays **above** the cards, for v1's reason. It gets the card treatment and the 3px `brand`
  leading rule and **no header bar**: its own sentence opens `Sitting out this game: …`, and a `SITTING OUT`
  label above that is the same three words twice, 45px above the fold on the one screen where the second team
  card is already below it.
- **The side line sits under both cards and above the explanation strip** (M4.7 (b), designer 2026-09-11):
  one line for the page, never one per card and never per person, Archivo `t-sm` `dim`, `sp-4` under the
  second card and `sp-4` over the strip, full width and no border of its own. Its two sentences are product's
  and are in the copy table above — `Move to your side in the lobby.` when the auto side switch is off, and
  `You'll be moved to your side — if not, move yourself.` when the gate is on — and which of the two prints is
  the gate's, not the dress's. It is **`dim` and not `text`, and it never takes a `brand` rule**: it is an
  instruction about a thing outside this page, and the strip under it is the bot explaining itself, which is
  the loudest prose the state has. Two ruled blocks stacked would be two things claiming to be the point of
  the screen, and the one under them is the one worth reading twice. It is drawn in **`balanced` only**
  (product): once the game launches there is no lobby to move in, so `in_game` prints nothing where it was
  and the explanation strip closes up under the cards (**M4.11**). The height it leaves behind is not
  reserved — nothing on this page is waiting to reappear in it.

##### The `· off-role` legend in a team card header (designer, 2026-09-10)

The rendered Floodlit build marks off-role seats inside the rows and says nothing about them in the header, so
a reader who scans the two headers — which is what the eye does first on a card with a 4px side rule and a
display-cut side name — learns nothing until they read five rows. The legend is the key to the amber dot, and
it is the header's only amber.

Markup, and this is the whole change to `TeamCard`'s header in `apps/web/app/_tonight/TonightView.tsx`:

```html
<header class="cn-card-head cn-team-head">
  <div class="cn-team-heading">
    <h2 class="cn-display cn-side">RED</h2>
    <span class="cn-head-sep" aria-hidden="true">·</span>
    <p class="cn-num cn-off-legend">
      <span class="cn-off-dot" aria-hidden="true"></span>
      off-role<span class="cn-sr"> seats in this card</span>
    </p>
  </div>
  <p class="cn-num cn-sum">7595<span class="cn-sr"> sum of the five ratings</span></p>
</header>
```

- **Placement.** After the side name, in reading order, inside a new leading group `.cn-team-heading`. The sum
  stays the header's second and last flex child. **Adding the legend may not move the sum by a pixel**: blue
  with no legend and red with one keep their sums on their own card's right edge, which is exactly what
  `justify-content: space-between` on `.cn-team-head` already does — and it is why the legend goes inside the
  leading group and not in as a third child. `.cn-team-heading { display: flex; align-items: baseline; gap:
  var(--cn-sp-2); min-width: 0; }` and `.cn-sum { flex: 0 0 auto; }`.
- **Separator.** One middot, `·`, in its own `aria-hidden` span, mono `t-xs`, `dim`, with the group's `sp-2`
  gap on each side. The same separator as the rack header's `SEATS · 9 of 10`; one punctuation mark for one
  job across the page. **Not a CSS `::before`** — generated content is announced by VoiceOver, and this is
  punctuation.
- **Type.** Mono `t-xs`, weight 400, `dim`, letter-spacing `0.08em`, lower case, `white-space: nowrap`. It is a
  legend and it is dressed exactly like `rating`, `SEATS`, `live` and `open`. **The word is never `brand`.**
  The one amber in the header is the dot — amber on the word as well would put three amber elements in a
  32px bar and start the same fight the threshold rule below settles.
- **The dot.** The same 6px `.cn-off-dot` the marked rows use, `aria-hidden`, `brand`, `vertical-align:
  middle`, `sp-2` to the word from its own `margin-right`, with the row's reserved-slot margin cancelled in
  one line: `.cn-off-legend .cn-off-dot { margin-left: 0; }`. One dot definition in `tonight.css`, so the
  legend is literally the same mark it is a key for.
- **Baseline.** The legend sits on the side name's baseline, not centred against it: 12px mono hanging off a
  display-cut `t-lg` is the intended relationship, and `align-items: baseline` on both the header and the
  group is what produces it.
- **When it appears.** Exactly when that card has at least one seat with `offRole === true`, in the `balanced`
  and `in_game` states. **When it disappears:** when that card has none — including when the *other* card has
  some. It is per card, never per page. It never appears on the result card's team headers (M3.16: the marker
  is not repeated once the game has been played, and neither is its key), never in the seat rack, and never in
  an embed — the teams embed already appends ` · off-role` to the player's own line.
- **No height change.** A reroll that removes the last marked seat removes the legend and the header keeps its
  height: 12px of mono inside a bar whose height is set by the display-cut side name. This is the no-shift rule
  and it costs nothing here.
- **390px.** The header's content box is `390 − 2×16 gutter − 2×12 padding = 334px`. Budget: `BLUE` (the longer
  name) at `t-lg` 24px ≈ 74px, separator plus its two gaps ≈ 21px, dot plus gap 14px, `off-role` at 12px mono
  with `0.08em` ≈ 60px, a four-digit sum at mono `t-md` tabular ≈ 46px — about 215px used, ~120px spare. One
  line at 390, and it is not allowed to become two: `white-space: nowrap` on the legend, `flex: 0 0 auto` on
  the sum, and the side name never shrinks. Those are budgets, not measurements: check the real thing at 390px
  with `BLUE` and a five-digit sum before calling it done.
- **1280px.** The cards are side by side inside the main column (~330px each once the rail takes 20rem), so the
  budget is the phone's and the same rule holds. At this width the two headers are read as a pair, which is the
  point: a legend on one and none on the other says at a glance which side is carrying the compromise.
- **Accessible name: `off-role seats in this card`.** The visible word plus a `cn-sr` suffix ` seats in this
  card`; the dot and the separator are `aria-hidden`. The plural is a category, like `rating` over a column of
  many, so nothing pluralises at render. It is deliberately **not** the bare word `off-role`, which straight
  after `RED` reads as a property of the side; and it is deliberately **not** `aria-hidden` in full, because a
  listener moving header to header should get the same warning a reader gets before hearing five rows. Each
  marked row keeps its own hidden `off-role` — that one is per seat, this one is per card, and they do not
  collide.
- **Test note.** `TonightView.test.tsx:297` asserts `screen.getAllByText('off-role')` has the marked-seat
  count. It keeps passing, because the legend's own text content is `off-role seats in this card` and not
  `off-role` — but that is a coincidence of the accessible name, so the same commit adds an explicit
  assertion: one `.cn-off-legend` per card that has a marked seat, and none on a card that has not.

##### The amber threshold — three or more marked seats in one card (designer, 2026-09-10)

> **Count the marked seats in one team card. At one or two, the off-role marker is unchanged. At three or
> more, the role icon and word go back to `dim`. The dotted underline, the `brand` dot before the name, the
> visually-hidden `off-role` and the header legend all stay.**

| Marked seats in the card | role icon + word | dotted underline | dot before the name | hidden `off-role` | header legend |
|---|---|---|---|---|---|
| 0 | `dim`, no underline | — | — | — | absent |
| 1–2 | `brand` | yes | yes | yes | present |
| 3–5 | **`dim`** | yes | yes | yes | present |

Only one thing changes at the threshold, and it is the colour of the icon-and-word pair. Nothing is removed.

**Why there is a threshold at all.** A ten-mid-main night puts four amber role words and four amber icons into
one card. That is more lit area than the card's own 4px side rule and its side name put together, so the card
stops reading as *blue* or *red* and starts reading as *the amber one* — and side is the first of the three
questions this page answers ("Am I in, and which side?"), while off-role is part of the second. A marker that
outranks the identity of the thing it is marking is not a marker.

**Why three.** Three of five is the majority. Below it the marked seats are the minority and colour is the
fastest way to find them, which is the entire job. At or above it the *unmarked* seats are the minority, and
colour spread over the majority is a wash rather than a mark — it points at nothing because it points at most
things. The same arithmetic in the other direction is a nice check: at 3 marked, colouring the two unmarked
seats instead would be the minority rule again, and it is rejected because inverting a marker's meaning between
two cards on one screen is worse than dropping its colour on one of them.

**Why the rest survives.** The dotted underline is the non-colour signal that the colour rule has always been
paired with (`Colour is never the only signal`), and it is still legible under `dim` — an underline is a shape,
not a hue. The 6px dot per row is ~36px² of amber for five rows against a role word's ~600px², so five dots
never out-weigh a side rule, and the dots are what the header legend is a key to. The hidden `off-role` is what
a listener hears and it is not visual at all. And the fact itself is never lost: the explanation line under the
cards prints `4 off-role: Hana at support, …` verbatim, which is the sentence that actually answers "why me".

**Per card, not per page.** Each card counts its own five seats. A split with 2 marked on blue and 3 on red
renders blue's role words amber and red's `dim`, on the same screen, and that is correct, not an
inconsistency: the question a card answers is "which of *these five* seats", the two cards are read one at a
time, and a page-wide count would let a red seat change colour because of something that happened on blue.
The threshold is also the same in light and dark — one threshold, not two — because it is about what share of a
card is marked, not about how loud the amber is.

**Implementation.** One class, one declaration, no new token:

```css
/* Three or more marked seats in one card: the mark keeps its shape and gives up its colour. */
.cn-team-many-off .cn-off {
  color: var(--cn-dim);
}
```

`TeamCard` computes `const marked = seats.filter((seat) => seat.offRole).length;`, adds `cn-team-many-off` to
the card's `<section>` when `marked >= 3`, and renders the legend when `marked >= 1`. `.cn-off` keeps its
`text-decoration: underline dotted` and its offset, so the underline survives the override, and `RoleIcon`
draws in `currentColor` so the icon follows the word with no second rule. This rule applies to the **teams
block only**: the result card does not repeat the marker at all, and the seat rack does not have one.

**Test.** A split with three marked seats on one side and one on the other asserts `cn-team-many-off` on the
first card's section and not on the second, with `.cn-off` still present on every marked seat of both — the
class is a colour override, not a removal, and a test that checks `.cn-off` disappeared would be testing the
wrong rule.

#### Result

```
┌────────────────────────────────────────────────┐  1px brand ring on the winner's block
│ RED WINS                                 34:12 │  t-display red · duration mono t-sm dim
│ Blue was favored 54%.                          │  t-base dim
│ Top damage: Lena, 47.3k                        │  t-sm, the number in brand
└────────────────────────────────────────────────┘

┏━ 1px line (lost) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ BLUE                                           ┃
┃ ◺ top       Hana                  1393  (−41)  ┃
┃ …                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
┏━ 4px red ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ RED                                            ┃
┃ ◺ top       Omar                  1510  (+41)  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Blue favored 54%. Everyone on a main role. Gap 100. …   ← the split they played, verbatim
```

Everything M3.16 settled holds: **the result card is the only pair of team cards on this screen**, one rating
per player per screen, no side sums in a result header, no off-role marker repeated, no team total of deltas,
deltas never coloured by sign. What v2 changes is only dress:

- The headline is the display cut at `t-display` in the winner's colour, upper case. This is the one place in
  the product where a colour is large, and it is large for one line.
- The winning card keeps its 4px side rule **and** gains a 1px `brand` ring; the losing card's rule drops to
  1px `line`. Two signals, both structural, neither a wash of colour over the page.
- `Top damage` moves inside the headline card as its third line rather than floating under the two team cards.
  It is a fact about the game, and the game's card is where facts about the game go.
- **The header does not repeat the winner.** The strip says `FINAL`; the card says `RED WINS` in 44px forty
  pixels below it. Two winners on one screen is the same redundancy M3.16 removed for ratings. If product
  wants the winner in the strip instead, then the card headline drops to `t-lg` — one of the two, never both.

##### The result poster (M11, designer 2026-09-23)

The headline card becomes a scoreboard lockup: **the winner line is the fold**. Today it reads as a small
header over two tables because the duration shares the winner's row and the facts sit at the same weight as
the verdict. M11 separates the verdict from the footnotes. It does not add a single new colour, size or
ornament.

```
┌▌─────────────────────────────────────────────┐  headline card: cn-card + 4px rule in the WINNER's side colour
│▌ 34:12                                        │  duration: mono t-xs, dim, 0.08em, tabular. Its own line.
│▌ RED WINS                                     │  cn-display t-display, winner colour, upper case, full row
│▌ Red won as the underdog.                     │  underdog line (product copy, only when true): t-base, text, 600
│▌ ─────────────────────────────────────────── │  1px line hairline, sp-3 above and below
│▌ Blue was favored 54%.                        │  t-sm dim
│▌ Top damage: Lena, 47.3k                      │  t-sm text, number mono brand (unchanged)
│▌                                   Copy link  │  optional footer, see below
└──────────────────────────────────────────────┘
┏━ winning team card: 4px side rule + 1px brand ring (unchanged) ━┓
┗━ losing team card: rule drops to 1px line (unchanged)          ━┛
explanation line (unchanged)
```

- **The winner's side rule on the headline card.** A 4px `blue` or `red` rule on the card's leading edge,
  drawn exactly like a team card's (`inset 4px 0 0` in Night's `theme-gaming.css`, the leading border
  elsewhere). That rule is what turns the card into that side's scoreboard. The headline card gets **no
  brand ring**: the ring belongs to the winning five, because the celebration is on the people.
- **The duration moves above the winner** as a mono slug (`t-xs`, `dim`, `0.08em`). That gives `BLUE WINS`
  the whole row. At 390px, `BLUE WINS` at 44px in the wide cut uses about 280px, so it never wraps and never
  fights a right-aligned number. `cn-result-head` stops being a space-between row and becomes a column.
- **`cn-display` stays the only large type** besides the lobby count. `t-display` does not grow for M11.
- **Underdog line.** Only when product writes one and the data says so. `t-base`, `text`, 600: the same
  weight as an explanation sentence. **Not a badge, not `brand`, not gold, not upper case, not `UPSET`.** The
  sentence itself is the whole treatment.
- **The hairline** separates the verdict from the footnotes. The prediction drops from `t-base` to `t-sm`, and
  top damage keeps its dress. Both sit under the rule, so nothing below the rule competes with the verdict.
- **Five versus five: unchanged.** Two team cards with after ratings and deltas. The winner's 4px rule plus
  brand ring and the loser's 1px `line` are the whole celebration. No trophy, no crown, no confetti, no
  `VICTORY`, no side sum of deltas, no team total, no delta coloured by sign.
- **No champion icons on the poster**, not even beside the top-damage name.
- **Phone fold.** At 390 × 700, the top bar (88px), the strip (about 150px) and the headline card through its
  underdog line (about 130px) finish near 370px. The ten names may scroll, and that is accepted.
- **Motion.** None beyond what the block already does on a state change. No staged reveal and no count-up
  on the duration.
- **A copy-link control, if product ships one**, is a text link, not a button. It sits in the headline
  card's footer, right-aligned, `t-sm` `dim` with the standard underline, and has a 44 × 44 hit area
  (padding, not a box). It has no fill, no icon and no `brand`. It is never placed in the strip, the rack or
  the teams state: the nightly loop has one tap (`Start a lobby`), and a share control dressed as a call to
  action would become a second one.

#### The night tape (M11, designer 2026-09-23)

A quiet log of tonight's finished beats, newest last. It is not a second scoreboard, not a fourth lobby
state and not a feed. It answers question 3 ("what happened?") for the whole night rather than the last game.

```
┌ Tonight so far ────────────────────────────────┐  cn-card; title = product's word (see OPEN)
│ ▪  21:04  Lobby opened.                         │
│ │                                               │
│ ▪  21:12  Teams posted.                         │
│ │                                               │
│ ▪  21:48  Red won in 34:12.                     │  "Red" in red, 600 — a word, never a block
│ │                                               │
│ ▪  22:05  Lobby opened.                         │
│ │                                               │
│ ▪  23:40  Lobby dropped.                        │  the whole sentence dim: a non-event
└────────────────────────────────────────────────┘
```

- **One card, one column, nothing nested.** `cn-card`, padding `sp-4`, a `cn-card-title` heading, then an
  `ol.cn-tape`. No card inside it, no chips, no avatars, **no champion icons**, no second colour field. A bare
  list on the ink breaks the tone amendment, and a card holding cards is a dashboard.
- **Row.** A grid of `5ch` for the time and `1fr` for the sentence, gap `sp-3`, `align-items: baseline`,
  `padding-block: sp-1` (a row is about 28px). Rows are not tappable, so no 44px floor applies.
  - Time: mono `t-xs`, `dim`, tabular, `HH:mm` h23 in `CUSTOMS_NIGHT_TZ`. **Formatted on the server into
    the snapshot**, exactly like the slug, so the hydrated render cannot disagree with the server render.
    After midnight it just reads `00:40`. The night's 06:00 boundary already orders the rows.
  - Sentence: Archivo `t-sm`, `text`, 400. The copy is product's.
  - **Result beat:** the side word (`Blue` / `Red`) in the side colour at 600, with the rest in `text`. A
    number in the sentence (a duration) is mono. This is how the rest of the product colours a side in
    prose: a word, never a filled block, and never both side colours in one row.
  - **Dropped beat:** the whole sentence in `dim`. It is the one beat the eye should skip.
  - No row is highlighted as "latest". Nothing in the tape is `brand`.
- **The spine and the ticks** are drawn in `line` and nothing else, so the live pill stays the only lamp.
  A 2px spine on the start edge, with a 6px square tick (radius 0) centred on it at each row's first line.
  The spine is drawn **per row, tick to tick**, so it never overhangs the first or the last tick:

```css
.cn-tape { list-style: none; margin: 0; padding: 0 0 0 var(--cn-sp-5); }
.cn-tape li { position: relative; display: grid; grid-template-columns: 5ch 1fr;
  gap: var(--cn-sp-3); align-items: baseline; padding-block: var(--cn-sp-1);
  font-size: var(--cn-t-sm); line-height: 1.4; }
/* T = the tick's centre from the row top = sp-1 + half a t-sm line */
.cn-tape li::before { content: ""; position: absolute; width: 6px; height: 6px;
  background: var(--cn-line);
  inset-inline-start: calc(-1 * var(--cn-sp-5) + 4px);
  top: calc(var(--cn-sp-1) + 0.7 * var(--cn-t-sm) - 3px); }
.cn-tape li:not(:last-child)::after { content: ""; position: absolute; width: 2px;
  background: var(--cn-line);
  inset-inline-start: calc(-1 * var(--cn-sp-5) + 6px);
  top: calc(var(--cn-sp-1) + 0.7 * var(--cn-t-sm));
  bottom: calc(-1 * (var(--cn-sp-1) + 0.7 * var(--cn-t-sm))); }
```

- **A new row fades in** with `opacity 150ms ease`. It reuses the existing appear transition (`cn-new`) and
  adds no new keyframes. `prefers-reduced-motion: reduce` drops it. Rows never slide or stagger, and the
  list never auto-scrolls.
- **Hidden when there is nothing to log.** No beats means no card, no heading and no empty sentence, the
  same rule as fearless.
- **Placement: after Fearless, directly before `Your role tonight`, in every state.** The fearless find box
  is a live tool used during pick. By the third game the tape is 10 or more rows (about 300px), and history
  must not push a live tool below the fold. `Your role tonight` stays last, per M3.6. The tape grows only
  when a beat lands, and every beat is also a state change that already replaces the primary block, so a new
  row never moves a pixel on its own. **Desktop:** main column, never the rail. The rail never carries state.

#### Idle

The idle page is the one a friend hits at 19:00, and v1 gave it one sentence and one link on an otherwise
black screen. v2:

- Strip: slug, headline `NOTHING TONIGHT`, no live pill, sentence = the existing M1.10 wording, unchanged:
  `When ten of you are in a custom lobby with the companion running, the teams show up here.`
- Primary block: an **empty seat rack**, ten `open` rows, with the header `SEATS · 0 of 10`. It says the same
  thing the sentence says, in the shape the page will have in an hour, and it gives the idle screen a body.
- Under it, the two cards the rail carries: `How this works` and `Run the companion`. **Below 1080px only** —
  at 1080 and up the rail already holds them, and rendering both is the same two cards twice on one screen.
  One card, one place, per width.
- The v1 `Last night and the board` link becomes the `Leaderboard` tab in the top bar. One destination, one
  place.

#### `Start a lobby`, and the lobby a latecomer can still join (M4.7 (a) and M4.10, designer 2026-09-10)

The one tap this product has. 21:00, a friend opens the page from the same WhatsApp link everybody else has,
and this is the only thing on it they can press. The words are settled in "Copy — `Start a lobby`"; this is
where the control sits, what it is dressed in, and — the part the first build got wrong — **which states it is
drawn in at all**.

**Who sees it, from M4.13 (2026-09-15).** Any viewer the session has matched to a player row — that is the
twenty people who play, admin or not, and nobody has to find out who the admins are to get the night started.
A signed-out visitor gets the sign-in sentence and its button in `idle` instead (the copy table's own row); a
signed-in visitor with no player row gets **no element at all**, because `SIGNED_IN_NO_LOBBY` at the foot of
the column is already the true sentence for them. Being drawn is not permission: `POST /api/me/lobbies/start`
resolves the session again before it writes.

**It is drawn in `idle` only.** `filling` means a live `lobbies` row exists, and `decideStart` refuses on
exactly that with `There is already a lobby open.` A control whose only possible answer is a refusal is not a
control — the same rule that already keeps it off `balanced`, applied one state earlier. In `filling` the block
still renders, without the button, to carry `Invited 7 friends — waiting for them to accept.` and a failed
create's nack: those are a readout, and a readout is not a control.

**In `idle` it sits above the rack**, directly under the status strip's sentence. Below it the rack is ten 44px
rows of `open`, and the button lands at y≈799 on a 390 × 844 phone — under the fold, on the one screen where it
is the point of the page. The rack in `idle` is a picture of what the page will look like in an hour; the
button is the thing that makes that happen, and it goes first. In `filling` the readout is **under** the rack,
because there the rack is content and the line is about the seats in it.

**No card.** No surface, no border, no padding box. A bordered card holding one button and one line is a fourth
card in an idle column that already carries three, and at 1280 it renders as 1300 × 110px of empty surface with
a 200px button in one corner — the sparse look Floodlit exists to end. The block is `display: flex;
flex-direction: column; gap: var(--cn-sp-3)` and nothing else; the `.cn-block` gap above it is its only margin.
Precedent: the reroll button has no card either — it sits on the strip whose sentence it re-rolls.

**No mark.** Not the 2px `brand` inset rule, which means "this is about you" on the rack row and the role card;
this is about the night, and a second meaning for one mark is worse than no mark. Not the 3px `brand` leading
rule, which means "the bot's own sentence" on the explanation and sit-out strips. And not a mark meaning
"admin": the route was admin-gated only until M3.6's third route class landed, a mark that would have had to be
removed in a month was never drawn, and M4.13 removed the gate instead.

**The button is the amber `.cn-button`, unchanged** — outline, `brand` text, `radius-row`, 44px, full width
below 720px and its own width above. It is the amber control on this page, and it never competes with the other
one: `Start a lobby` is drawn in `idle`, `Reroll` in `balanced`, and the state table makes those disjoint. **It
is never a filled amber block.** 358 × 44px of solid `brand` is more lit area than the live pill, a winner's
ring and a 4px side rule put together, it breaks the one-lamp rule, and in light it reads as a warning banner —
the same reason the sign-in control is an outline.

**The three states, and what tells them apart.** One slot under the button, never a toast, never a banner,
never the URL. They differ by **weight, not colour**: red would read as side 200 and there is no green in this
palette.

| State | Line | Type | Live region | The button |
|---|---|---|---|---|
| idle, nothing pressed | — | — | — | amber, live |
| pending / sent | `Opening a lobby on Hana's PC…` | Archivo `t-sm` 400 `text` | `role="status"` | **quiet**: `dim` text, `line` border, `aria-disabled="true"` |
| refused | one of the route's sentences | Archivo `t-sm` **600** `text` | `role="alert"` | amber, live — a refusal is a thing you retry |
| acked, filling | `Invited 7 friends — waiting for them to accept.` | Archivo `t-sm` `dim` (`.cn-hint`) | `role="status"` | not drawn |

- **The pending button is quiet but not `disabled`.** A second tap while a create is in flight can only return
  `A lobby is already being opened.`, so the control must stop looking like an invitation — but `disabled`
  moves focus off the button that was just pressed, which is the one thing M3.20 exists to prevent.
  `aria-disabled` plus the `:disabled` dress plus a client-side short-circuit keeps the focus and kills the
  press.
- **Success prints nothing.** The lobby appearing is the answer.

##### The number-in-a-sentence rule, and the one thing that breaks it

**A quantity inside a sentence stays in the sentence's family.** The `7` in `Invited 7 friends`, the `1290` and
the `37` in the seed line, the `58%` in a caption: all Archivo. Mono is for numbers **in a column**, where the
tabular edge is the job; a mono number mid-Archivo-line changes x-height in the middle of a sentence and reads
as code.

**A token you have to transcribe is mono, sentence or not.** A lobby name and a four-digit password are not
quantities being read in passing — they are characters being retyped into another application, which is
exactly what the Type table already means by listing `lobby password` under mono, and where a distinguishable
`1`/`l` and `0`/`O` is the whole point. Those two spans, and nothing else inside a sentence.

##### `Missed the invite?` — the lobby line (M4.10)

The invite fan-out runs **once**, on the create ack. There is no second wave and the button is not a doorman,
so the friend who walks into voice at 21:20, and the one who swiped the popup away, have one way in that does
not interrupt nine people: the lobby's name and its four digits, read off the page they are already holding.
The words are product's; the gate is the lead's; this is the slot and the dress.

- **It is not part of the `Start a lobby` block.** It is drawn in `filling` **and `balanced`**, and the control
  is drawn in `idle`, so they are two objects that only ever share a screen in `filling`. There they stack in
  that order — the readout about the invites that went out, then the way in for somebody they missed.
- **Home: the last line of the primary block**, above `Your role tonight`. In `filling` that puts it under the
  rack; in `balanced` under the explanation strip. One slot, one rule, both states — the alternative is a line
  that moves between two blocks when the teams land, on the screen where a thumb is already resting.
- **Gone from `in_game` on.** By then there is nothing to join, and a live password on a finished night is an
  exposure that buys nobody anything.
- **Signed-in and matched to a player row, or nothing at all.** An anonymous viewer sees no line; so does a
  signed-in viewer the page has not matched to a player — the `That's me` list is two blocks below and is the
  thing for them to do first. A link forwarded out of the group must not carry a live password with it, and a
  latecomer is by definition one of the twenty who picked himself out of that list once already. This is a
  **render gate, not a security boundary**: the same rule that decides the rack's `you` mark decides this line,
  and the password is in the page's data for a viewer the server has already identified.
- **Dress: one line, no card, no rule, no icon.** Archivo `t-sm` in **`text`** — not `dim`: it is a thing to
  act on, and the page's grey is for footnotes. `Missed the invite?` opens it, which is what tells the nine who
  are already in that the rest of the sentence is not for them. The name and the password are mono `t-sm`
  `text`, tabular, per the rule above. It wraps to two lines at 390px and that is the correct outcome.
- **`user-select: all` on the password span**, so a tap-and-hold on a phone grabs the four digits and nothing
  around them. It is the one place in the product where somebody is expected to copy something.
- **Never a card, never the display cut, never amber.** It is a sentence, not a headline and not a control; the
  amber on this screen belongs to the reroll button or to nothing.

**`/admin` renders the control and its own lobby line with the same words** — the name and password are
ungated there, because that page is already behind a session and an admin check. The Floodlit dress of
the admin area does not rewrite those sentences.

#### `Your role tonight`, and picking yourself (M3.6, designer 2026-09-10)

The one thing on this page a friend can change about themselves. Somebody says in voice "I'll jungle
tonight", taps `jungle`, puts the phone down. It is a **preference, not a lock**, and no pixel on the card
may promise more than the balancer delivers. Every word of it is settled in "Copy — the role tap and picking
yourself"; this section is where those words sit and what they are dressed in.

**Home: a card, last in the main column, outside the primary block.** Never a control inside a rack row — the
rack is ten 44px rows at every count, five 44px targets do not fit in one, and a row that is structurally
different for one reader stops being a scoreboard. Never in the rail: the rail never carries state. Being
last means the card can appear, change state or disappear without moving a pixel a thumb is already over,
which is the no-shift rule paid for with layout instead of with a reserved height.

**The card is marked as yours**: `box-shadow: inset 2px 0 0 var(--cn-brand)` — the same 2px `brand` inset
rule that marks your row in the rack, two blocks up. Same mark, same meaning, no new token. **Not** the 3px
leading rule, which already means "the bot's own sentence" on the explanation and sit-out strips.

**Anatomy**, top to bottom, the same three parts in all three states:

```
┌ ▌ ───────────────────────────────────────────────┐
│ Your role tonight · Hana                         │  title: Archivo t-sm 600 text; the name dim 400
│ [◺ top ] [✦ jungle] [◹ mid ] [◿ adc ] [⛨ support] │  chips: 44px tall, capped at 9rem wide
│ That is not you. Only an admin can …             │  a refusal, if there was one: t-sm, text
│ Teams are already set. A role you pick now …     │  the state's one hint: t-sm dim
└──────────────────────────────────────────────────┘
```

- **The title is language, so it is Archivo** — `t-sm`, 600, `text`, no tracking, exactly like `How this
  works` and `Run the companion`. Mono `t-xs` `dim` `0.08em` is for `SEATS`, `rating`, `live` and `open`; a
  title set in it reads as a code comment and ends up quieter than the control it introduces. The copy
  table's `Where` column describes this slot as `t-xs` `dim` because that is what the first build shipped —
  the words in that table are product's and stand, the type here is this section's and supersedes it.
- **The name after the middot is `dim` at 400**, same family and size, so the title reads as one line with
  one emphasis. It is absent, middot and all, for a player with no display name.
- **A refusal goes directly under the chips, above the hint, in `text`** — beside the control that was
  pressed, never as a banner, never in the URL, never `dim`. Three grey sentences in a stack is where a
  refusal goes to hide.
- **One hint per state, never two stacked.** `open` gets the preference sentence, `balanced` and `in_game`
  get the teams-are-set sentence and nothing else, `finished` and later draw no card at all. Two sentences
  under a two-line control is more prose than product, and in `balanced` the first of them is about a game
  that is no longer on screen.

**The chips.**

```css
.cn-role-choices { display: grid; gap: var(--cn-sp-2);
                   grid-template-columns: repeat(auto-fit, minmax(6rem, 9rem)); justify-content: start; }
.cn-role-choice  { min-height: 44px; color: var(--cn-text); background: var(--cn-raise);
                   border: 1px solid var(--cn-line); border-radius: var(--cn-radius-row); }
.cn-role-on      { color: var(--cn-brand); background: var(--cn-brand-tint); border-color: var(--cn-brand);
                   box-shadow: inset 0 0 0 1px var(--cn-brand); }
```

- **Capped at 9rem, left-aligned.** A `1fr` chip stretches to ~245px in the 1280 main column: five 44×245px
  bars around a 12px word, which is the sparse look Floodlit exists to end. At 390 the grid breaks 3 + 2 —
  solo lanes, then bot lane, which is the right place for a lane order to break. At 720 the five fill one
  row. Lane order always, `top` to `support`, never sorted.
- **`text` at rest, not `dim`.** The rack prints a `dim` mono role word with a `dim` icon fifty pixels above,
  and that word is a fact nobody can press. The same treatment cannot also mean "tap me". The icon stays
  `dim`, so a chip still does not read as a name row; the word carries the affordance. Amber on all five
  would put five lamps on one card and break the one-lamp rule the chosen chip depends on.
- **The chosen chip is the whole receipt for a tap.** No toast, no flash, no "saved" — realtime already
  changes the thing you are looking at. It carries `aria-pressed`, so colour is not the only signal, and
  tapping it again clears the choice: that is the only way out and there is no Clear button.
- **The doubled inset edge is a light-mode rule paid for in both themes.** In light, `raise` is `#DAE2ED` and
  the brand tint is a 12% wash on white, so four unselected chips out-weigh the chosen one and the product's
  only receipt becomes the palest thing in its own row. A second inset 1px `brand` line makes a 2px edge with
  no change to the box, and it costs dark nothing.

**Picking yourself, once (`That's me`).** A signed-in viewer with no player row gets the same card: title,
product's sentence, then **a row list, not a chip grid**. Names are language of varying length, and a grid of
them is a wall of unequal words with no scanning edge — the rack shape is the right one and these are the
same people in the same order.

- The row is the rack's: 44px, `line` hairline between, name `t-md` **600** left. A name that is 600 in the
  rack and 400 forty pixels below it is the same content in two voices.
- **At ≥720 the row is `minmax(0, 16rem) auto` with `justify-content: start`** — the rack's own name cap at
  that width. `space-between` at every width puts a name at x=100 and its control at x=1200, nine times over.
- **The control is a discrete button, not the whole row.** A claim is a one-way door: the route answers a
  second one with 409 and only an admin can undo it on `/admin/players`. A one-way door does not get a
  full-width thumb target on a phone in a dark room.
- It is **dressed like a role chip** — `raise`, `line`, `radius-row`, `t-sm` — and never like the amber
  reroll button: ten `brand`-outlined bars down one card is a column of lamps pointing at nothing, and these
  are equal options, which is what the five role words are too.
- Its accessible name is the label plus the person: a listener moving button to button must not hear nine
  identical ones.
- The same nine names appear in the rack above and in this list. That is allowed, once: the two lists answer
  different questions, the second is below the fold, and it exists for one tap on one night.

**Signed out** is the same card with the same title, holding the settled sentence and one `.cn-button` under
it. **A button is a label and never a sentence** — no full stop inside a 44px amber outline, which in light
reads as a warning banner. It is **not disabled**: a dead control that explains why it is dead is worse than
a live one that fixes it in a tap. The sign-in stays on this card and does **not** move to the top bar — the
bar carries identity and destinations, a bare `Sign in` there is a control with no object, and here its
object is forty pixels below it. Reading is never gated; the rest of the page is what everybody else sees.

**Nothing on this card navigates** except the sign-in, which is an OAuth round trip and cannot be done in
place. Every control is a real form with a real action, intercepted when JavaScript is running.

**Keyboard.** M3.6 is the first screen in the product with a cluster of targets — five chips and up to eleven
buttons — so it is where the focus ring lands, and the ring is product-wide: see `tokens.css`, v2.

#### Copy — final (product 2026-09-09; two side-line rows added 2026-09-11)

Product has passed every string. `(shipped)` marks a sentence that already exists and is quoted unchanged;
everything else is final text the engineer types into `apps/web/lib/tonight/copy.ts`, `lib/nav.ts` and the
shell without asking. **Nine strings changed from the designer's proposal and four differ from what the code
says today** — the `Status` column names them, so M3.18 knows which are edits and not typos. Layout, order and
placement are the designer's and are untouched.

| Where | String | Status |
|---|---|---|
| wordmark | `KUSTOM` (the amber bar is the logo, not a word; `Customs Night` is the repo codename and appears on no friend-facing surface) | product 2026-09-09 |
| strip headline, idle | `NOBODY IN YET` | product 2026-09-09 — **changed**, code says `Nothing tonight` |
| strip headline, filling | `<n> IN THE LOBBY` | product 2026-09-09 |
| strip headline, balanced | `TEAMS ARE SET` | product 2026-09-09 — code says `Teams set` |
| strip headline, in game | `IN GAME` | product 2026-09-09 |
| strip headline, finished | `GAME OVER` | product 2026-09-09 — **changed**, code says `Final` |
| sentence, idle | *(shipped)* `When ten of you are in a custom lobby with the companion running, the teams show up here.` | shipped, kept |
| sentence, 0 in | *(shipped)* `Nobody in the lobby yet.` — in the strip, and **not repeated under the rack** | product 2026-09-09 — **changed** |
| sentence, 1–9 in | `One more to go.` … `Nine more to go.` (word, not digit — the digit is already 44px above it) | product 2026-09-09 |
| sentence, 10 in | `Teams in a moment.` | product 2026-09-09 — **changed** |
| sentence, 11+ in | `Ten play, the rest sit out this game.` | product 2026-09-09 |
| sentence, balanced | `Split by rating and role. Nobody picked the teams.` | product 2026-09-09 — **changed** |
| sentence, in game | `Ratings move when it ends.` | product 2026-09-09 — **changed** |
| sentence, finished rated | `Ratings are updated. The leaderboard has the rest.` | product 2026-09-09 — **changed** |
| sentence, finished unrated | *(none — the slot keeps its height and stays empty; no apology, per v1)* | product 2026-09-09 |
| side line under the team cards, `balanced` — auto side switch **off** (today, and if the path is never verified) | `Move to your side in the lobby.` | **new**, product 2026-09-11 (words M4.3, placement M4.7 (b)) — kept byte for byte from the M4.3 brief and the decision row of 2026-09-09. **One line under both cards, not one per card**, and never per person: naming who is on the wrong side is stale the second somebody moves. Not drawn in `in_game` — see below |
| the same line, auto side switch **on** | `You'll be moved to your side — if not, move yourself.` | **new**, product 2026-09-11 (words M4.3, placement M4.7 (b)) — kept byte for byte. Em dash (U+2014) and a straight apostrophe, both as written in the brief. Which of the two prints is the gate's, not the writer's: while `switch_side` is unverified the page may not promise anybody is moved |
| rack header | `SEATS` · `<n> of 10` · `rating` | product 2026-09-09 |
| empty seat | `open` | product 2026-09-09 |
| all-flexible hint | `Nobody has set a role tonight, so the bot can put anyone anywhere.` | product 2026-09-09 — **changed** |
| all-flexible hint, admin only, appended | ~~`Set roles` (link to `/admin`)~~ — **removed 2026-09-10 with M5.17**: roles are inferred from play and `/admin/players` shows them read-only, so the link pointed at nothing. The hint sentence stands alone, for everybody, admin or not | product 2026-09-09, removed by the lead 2026-09-10 (M5.17) |
| empty lobby | *(shipped)* `Nobody in the lobby yet.` — one place only, see `sentence, 0 in` | shipped, kept |
| past the ten | *(shipped)* `Around` | shipped, kept |
| nameless hint | *(shipped)* `Names fill in after someone's first game.` | shipped, kept |
| no season | *(shipped, M3.17)* `No season is active, so tonight's games are not being saved. An admin can start one.` | shipped, kept |
| fearless, title | `Fearless` | product 2026-09-18 (M10) |
| fearless, sentence | `Ban these next game.` | product 2026-09-18 (M10) |
| fearless, count | `10 champions.` / `1 champion.` | product 2026-09-18 (M10) |
| fearless, search | `Find a champion` | product 2026-09-20 (M10.2) |
| fearless, search empty | `No champion matches.` | product 2026-09-20 (M10.2) |
| fearless, banned | `Ahri is on the ban list.` | product 2026-09-20 (M10.2) |
| fearless, lane | `top` / `jungle` / `mid` / `adc` / `support` / `other` | product 2026-09-20 (M10.2) — the app's own lowercase role words |
| fearless, still open | `still open` | product 2026-09-22 (M10.3) — the label under a lane, after the ban chips, before the champions that lane can still lock |
| fearless, available | `Garen is still available.` | product 2026-09-22 (M10.3) — the find box, when the exact name is not on the ban list. Open chips are dim and dashed; a search hit paints brand the same way a ban hit does. Discord does not print this list |
| overlay, fearless title | `Fearless` | product 2026-09-23 (M12) — same word as the tonight card |
| overlay, fearless sentence | `Ban these next game.` | product 2026-09-23 (M12) — same sentence as the tonight card |
| overlay, fearless empty | `No champions banned yet.` | product 2026-09-23 (M12) — empty pool; the tonight card's empty state is silent until the first lock |
| overlay, lobby title | `This lobby` | product 2026-09-23 (M12) |
| overlay, with | `With 7–2` | product 2026-09-23 (M12) — same-side record past `MIN_DUO_GAMES`; wins–losses |
| overlay, against | `Against 3–5` | product 2026-09-23 (M12) — opposite-side record past the same floor |
| overlay, thin record | `Under 5 games together.` | product 2026-09-23 (M12) — below `MIN_DUO_GAMES` for both with and against; one sentence, not two |
| overlay, lane mark | `lane` | product 2026-09-23 (M12) — mono chip on the posted lane opponent |
| overlay, waiting | `Waiting for the League client…` | product 2026-09-23 (M12) — lockfile missing |
| overlay, no lobby | `No lobby yet.` | product 2026-09-23 (M12) — fearless still shows; the roster block is this line |
| nav | `Tonight` · `Leaderboard` · `Games` · `Stats` · `Fun` · `1v1` · `Daily` · `Companion ↗` | product 2026-09-09 — **changed** from `Get the app`; `Games` added 2026-09-12 (M5.25); `Mystery` added 2026-09-13 (M5.32) and **renamed `Daily` 2026-09-16 (M8.4)** — two games alternate behind that one route and the shell, which renders this row on every page, neither knows nor may pay to learn which one today is; **`1v1` added 2026-09-18 (M8.5)** after `Fun` |
| footer | `How this works` · `Get the companion` · `Your games` | product 2026-09-09 |
| how this works, line 1 | `Nobody checks in. The companion app on somebody's PC reads the League lobby and sends who is in it.` | product 2026-09-09 |
| how this works, line 2 | `The bot makes three splits and posts the fairest, with the win chance and the rating gap. An admin can step to the next one. Nothing is picked at random.` | product 2026-09-09 — **changed** |
| how this works, line 3 | `Results come off the end-of-game screen. Nobody reports a score.` | product 2026-09-09 |
| how this works, line 4 | `Everybody starts on the same rating, and every Summoner's Rift result moves it. Proven is the board's careful version of it and settles after about 30 games.` | **re-worded, product 2026-09-16 (M7.19, step 3 of two)** — was `Your rating starts from your rank and moves with every result. Proven is the board's careful version of it and catches up after about 30 games.`, which was false in three ways at once, and this one string fixes all three: nothing starts from a rank any more (M7.19), an ARAM result moves nothing (M7.1), and `catches up` is the verb M3.19 retired. The designer's proposed string fixed two of the three and kept `starts from your rank`, so it is superseded rather than taken. **Two sentences, not three**: the first-few-nights swing is real and is the answer to "why did my number jump 110?", but the four lines are the whole system in four lines and this one already carries two ideas; the group hears that part in M7.19's own message to them (acceptance 7) and `/p/[puuid]` carries the per-player version. **It does not name ARAM.** Saying which mode counts is true and short; saying which mode does not invites a footer line about a mode this line is not about, and M7.18 is the task that labels the two counts where they actually collide. The line moves from second person to `Everybody` on purpose: the fact that changed is that the start is the same for all ten, and that is not a sentence about you. **The defects this replaces, raised by the designer 2026-09-16 (M7 review), both product's to fix in `lib/shellCopy.ts`, both fixed here.** (1) **`moves with every result` is false since M7.1** — ARAM results move nothing, `00-product.md` says so in a paragraph of its own ("Only Summoner's Rift customs move the number"), and the group was told exactly that on 2026-09-16 when the rebuild ran. This line is in the footer of every page and in the rail card, so it is the product's most-printed claim about ratings and it is the one a player can now catch out. (2) **`catches up` is the word M3.19 ruled out** — `SETTLING_SENTENCE` was rewritten on 2026-09-10 precisely because the gap **settles** and never closes, and this line kept the retired verb, so the two sentences a reader meets on one visit disagree about what Proven does. ~~Proposed, one string fixing both: `Your rating starts from your rank and moves with every Summoner's Rift result. Proven is the board's careful version of it and settles after about 30 games.`~~ — **superseded 2026-09-16 by the string in column 2**, which drops the third falsehood the proposal kept. Nothing about MVP and ACE belongs in it — four lines are the whole system and `/p/[puuid]`'s own explanation carries that one |
| companion card, title | `Run the companion` | product 2026-09-09 |
| companion card, body | `Windows only. Install it once, paste in the token an admin gives you, and leave it running while you play.` | product 2026-09-09 — **changed** |
| companion card, link | `Get the companion` → `https://github.com/suyaser/kustom-releases/releases/latest` | product 2026-09-09 |

**Why the nine changed.** Each one is a rule, not a preference, so the next string is decided the same way.

- **`NOTHING TONIGHT` → `NOBODY IN YET`.** This is the screen a friend hits at 19:00 from a WhatsApp link, and
  "nothing tonight" reads as *the night is off* to a group that plays every night. It is also false in the
  other idle case, an abandoned lobby. `NOBODY IN YET` is true in both and invites the reader to be first.
- **`FINAL` → `GAME OVER`.** The tone line in this document says *never a broadcast lower-third*, and `FINAL`
  is the lower-third word. `GAME OVER` is the group's own vocabulary and just as short. The winner stays named
  once, on the result card headline at `t-display` — product does **not** take M3.16's offer to move it up
  into the strip.
- **The sentence never repeats the headline.** `Ten in. Teams in a moment.` under a 44px `10 IN THE LOBBY`,
  and `They are in.` under `IN GAME`, spend the page's one live line saying what the biggest type already
  said. Both drop their first clause.
- **`Same ten, split by rating and role.` → `Split by rating and role. Nobody picked the teams.`** With eleven
  around it is not the same ten, so the old line is wrong on exactly the nights the sit-out strip appears. The
  new second half is the product's promise (principle 1, "the bot is the referee") in four words, and it is the
  sentence that ends the argument the whole thing exists to end.
- **0 in the lobby says it once.** The proposal had `Nobody has joined yet.` in the strip and the shipped
  `Nobody in the lobby yet.` under the rack — the same fact twice, 40px apart. The settled string wins and it
  goes in the strip, because the strip's sentence slot is mounted in every state and has to hold its two lines
  anyway. Nothing is rendered under the rack at count 0; a rack of ten `open` seats is the picture.
- **`the balancer` → `the bot`.** Product calls it the bot on every other surface. "Balancer" is the name of a
  module in `packages/core`; nobody in the voice channel says it.
- **`Get the app` → `Companion ↗`.** One thing needs one name, and the name is already fixed by a shipped
  sentence this redesign may not rewrite ("…with the companion running"). With `Get the companion` in the
  footer and `Run the companion` on the card, `Get the app` was the only place on the page inventing a second
  word for the same download. A destination noun also matches the three tabs beside it.
- **`how this works` line 2 gains the reroll.** Four lines are the whole explanation of the system, and the one
  human control in it was missing. Admin-only and never random are both said, because "the bot is rigged" is
  the argument this paragraph exists to pre-empt.
- **`how this works` line 3/4 swap and line 4 is rewritten.** The order is now the order of a night: lobby,
  teams, result, rating. The old rating line named `Rating` and `Proven` without saying where a rating comes
  from or when it can be trusted, which is the actual question a new player asks.

**The four lines are true of the shipped system, claim by claim.**

| Claim | True because |
|---|---|
| Nobody checks in; a companion on somebody's PC reads the lobby | M2.3's lobby watcher; `00-product.md`, "Zero input" |
| Three splits, fairest posted, with win chance and rating gap | M1.4 returns three ranked splits; `splits.explanation` prints both numbers |
| An admin can step to the next one, nothing is random | M3.2: reroll is admin-only, promotes rank 2 then rank 3, never picks at random, and stops |
| Results come off the end-of-game screen | M2.5's eog capture; no manual reporting anywhere in the product |
| Everybody starts on the same rating | `provisionalSeed()` = `{ mu: 20, sigma: 12 }` — 1200 — written as the first seed of every stored rating, all-time and weekly (M7.19, 2026-09-16). `seedFromRank` has one caller left, the balancer's live guess for a face with no customs games, which is never persisted and never printed on a rating surface. **True of the code from 2026-09-16; true of the group's stored numbers once M7.19's hosted re-seed and rebuild have run**, which is the one open step behind this line — the copy is interpolated everywhere it names a number, so no page asserts it before it is true |
| Every Summoner's Rift result moves it | the fold on every rated game (M2.5, M5.2), gated to Summoner's Rift by M7.1 (2026-09-15) — an ARAM result is recorded and moves nothing, which is `00-product.md`'s own paragraph and what the group was told on 2026-09-16 |
| Proven settles after about 30 games | `ordinal = mu − 2σ`; `00-product.md`, "that gap shrinks as you play and settles after about 30 games". **`settles`, never `catches up`** — the verb M3.19 retired on 2026-09-10 because σ falls and does not reach zero, so the gap settles and never closes. The board's own sentence was fixed that day; this line kept the retired verb until M7.19's re-word (2026-09-16), and `board.test.ts`'s guard now has a twin on the shell line |

Nothing in the four lines mentions "ten games" for Rating: the page has room for one number, and the number
worth printing is the one that governs the board people argue about.

**The side line, ruled 2026-09-11 (M4.7 (b)).** Both sentences are **kept, byte for byte**. They were
settled in the M4.2 and M4.3 briefs and quoted again in the decision row of 2026-09-09, and the same two
sentences go in the teams embed's `Seats` block, so a rewrite here would be a rewrite in three places to buy a
reader nothing. Two things that look like exceptions are not:

- **The em dash is house style for this shape.** Every other string in this table avoids one, but the shape
  *fact, then what you do about it* already carries a dash on every surface where it appears —
  `Your role is unchanged — tap it again.`, `Nothing changed — tap it again.`,
  `No lobby was opened — tap it again.`. `You'll be moved to your side — if not, move yourself.` is that
  shape: the promise, then the fallback when the promise cannot be kept, because a companion that is closed
  or finds the side already holding five moves nobody and the page cannot know which of the ten that is.
- **The apostrophe is straight (`'`), not typographic**, matching `isn't`, `Nobody's` and `someone's`
  everywhere else in these tables and in `copy.ts`.

**It is not drawn in `in_game`, and that is not the designer's call to reverse.** Once the game launches there
is no lobby to move in, so `Move to your side in the lobby.` names a thing that does not exist for the half
hour it would sit on the screen. The line belongs to `balanced` only, since M4.7 (b).

**Inside `balanced` the line now goes the moment every seat matches its side** (M4.11, landed 2026-09-15).
M4.3's acceptance check 7 asked for exactly this: the tonight snapshot carries each member's live
`lobby_members.side`, and the line is drawn only while at least one of the ten is mismatched or has not yet
reported a side at all — a seat nobody has placed keeps the line up rather than being read as a match, because
that is the seat the switch-side queue itself cannot move and the page is the only thing telling them to.

The sit-out strip, the explanation line, the no-season sentence, the `No more splits.` note and every embed
string are **unchanged**. v2 is a visual redesign; it does not get to rewrite settled sentences.

**One shipped string retires with the shell:** `IDLE_LINK_LABEL` (`Last night and the board`) has no home once
`Leaderboard` is a tab, as this section's "Idle" already says. Delete the constant with M3.18 rather than
leaving a dead export in `copy.ts`.

#### Copy — the role tap and picking yourself (M3.6, product 2026-09-10)

Every word M3.6 puts on the tonight page, including the refusals. The control's strings were settled in the
M3.6 brief on 2026-09-09 and are quoted here unchanged; the refusals are new — the brief covered what the
route does, not what the friend reads when it says no, so the engineer wrote nine sentences against no doc
and product rules them here: eight are replaced, one is kept. They live in `apps/web/lib/tonight/copy.ts` (what the page draws) and
`apps/web/lib/me/copy.ts` (what the routes answer, all of it, in one file — the rules modules and the handler
import from there and hold no sentence of their own). That is two files and one table; they may not drift.

**The rule for a refusal**, so the next one is written the same way: *say what happened, then say who can
undo it or what to do next.* Never the database's vocabulary — a friend on a phone has no rows, no ids and no
player records. Never an apology. Never name a page the reader cannot open (`/admin` is not a fix a non-admin
can act on; "an admin can" is).

| Where | String | Status |
|---|---|---|
| control heading, `t-xs` `dim` above the five role words, on the viewer's own control | `Your role tonight · <name>`, and plain `Your role tonight` when that player has no display name yet | **product 2026-09-10 (M3.6, designer's review)** — the name is added; `· ` is the rack header's separator. Never `· Someone`. The tonight page draws this control for the viewer alone, so there is no second heading to keep it off; if the admin role tap on `/admin/players` (M3.25) ever grows a heading, that page's rows carry their own names and this one is not it |
| under the control, `open` — the state's one hint | `The bot tries for this one. If the teams need it, you can still end up somewhere else.` | product 2026-09-09 (brief) — shipped verbatim, kept |
| under the control, `balanced` and `in_game` — the state's one hint | `Teams are already set. A role you pick now is what the bot tries for in the next game.` | **product 2026-09-10 (M3.6, designer's review)** — replaces `Saved for the next game. Teams are already set.`, which was written to stand next to the preference sentence and now stands alone. **M3.6's acceptance check 3 quotes the old words and needs the same edit** |
| signed out, the card's body sentence | `Sign in with Discord to pick your role.` | product 2026-09-09 (brief) — kept, and it is now the sentence rather than the button, per the designer's card |
| signed out, the button under it | `Sign in with Discord` | **product 2026-09-10 (M3.6, designer's review)** — new. A button is named for what pressing it does; the reason to press it is the sentence above |
| above the list, signed in with no player | `Which one of these is you? Pick yourself once and the page knows you from now on.` | product 2026-09-09 (brief) — shipped verbatim, kept |
| on every row of that list | `That's me` | product 2026-09-09 (brief) — shipped verbatim, kept. Straight apostrophe |
| signed in with no player and no lobby to pick out of | `Signed in. Open the page while the lobby is up and you can pick yourself out of it.` | product 2026-09-09 (brief) — shipped verbatim, kept |
| appended to the all-flexible hint, admin only | ~~`Set roles`~~ — **gone 2026-09-10 (M5.17)**, with `SET_ROLES_LINK`. There is no role control to link to: the hint stands alone and the one role a friend can still choose is the card under the rack | product 2026-09-09 (the table above), removed by the lead 2026-09-10 |
| the tap did not reach the server | `That did not reach the server. Your role is unchanged — tap it again.` | **product 2026-09-10 (M3.6)** — replaces `That did not reach the server. Your role is unchanged.` |
| `That's me` did not reach the server | `That did not reach the server. Nothing changed — tap it again.` | **product 2026-09-10 (M3.6)** — replaces `That did not reach the server. Nothing changed.` |
| a non-admin naming somebody else (403) | `That is not you. Only an admin can set somebody else's role.` | **product 2026-09-10 (M3.6)** — replaces `That is not your row. Only an admin can set a role for somebody else.` |
| the lobby is finished, dropped, abandoned or gone (404, 409) | `That lobby is over. You can set a role when the next one opens.` | **product 2026-09-10 (M3.6)** — replaces `That lobby is over. Nothing to set a role on.` |
| a linked player who is not in that lobby (409) | `You are not in that lobby. Join it in League and you can pick a role.` | **product 2026-09-10 (M3.6)** — replaces `You are not in that lobby, so there is no row to set.` |
| a signed-in visitor with no player tapping a role (403) | `Pick yourself out of the list first, then you can set a role.` | **product 2026-09-10 (M3.6)** — replaces `Pick yourself out of the lobby first, then you can set a role.` |
| a session that already has a player tapping `That's me` (409) | `You already picked yourself. An admin can undo it if it was the wrong name.` | **product 2026-09-10 (M3.6)** — replaces `You are already linked to a player.` |
| `That's me` on somebody who is not in tonight's lobby (403) | `You can only pick somebody who is in tonight's lobby.` | **product 2026-09-10 (M3.6)** — replaces `Only somebody in tonight’s lobby can be picked.`, curly apostrophe and all |
| `That's me` or a role tap naming a PUUID no player has (404) | `No player with that id.` | engineer 2026-09-10 — **kept as is**: the page cannot produce this request, so it is the only string here no friend can reach. If it ever becomes reachable it comes back to this table |

**Why the eight changed** (and, from 2026-09-10, the three the designer's review moved). Each is the rule above, applied.

- **No rows.** Three of the eight said `row` — `That is not your row`, `there is no row to set`. `lobby_members`
  is a table this product deliberately never shows anybody: the whole design is that the lobby is read, not
  filled in. A friend told "that is not your row" has to guess what a row is before they can guess what went
  wrong. `That is not you` is the same refusal in words the reader already has.
- **A refusal ends with what happens next.** `Nothing to set a role on.` is a dead end; `You can set a role
  when the next one opens.` is the same fact plus the thing that is true in ten minutes, and it is why nobody
  needs to do anything about it. Same for the two offline sentences: `tap it again` is the whole fix and it
  was missing.
- **`Pick yourself out of the lobby first` reads as "leave the lobby".** The brief's own sentence
  (`…you can pick yourself out of it`) is safe because it follows `Open the page while the lobby is up`; the
  refusal has no such neighbour and lands on a friend who is standing in a lobby they want to stay in. `out
  of the list` names the thing on screen — the `That's me` list two blocks up the page.
- **`You are already linked to a player.` describes the database, not the person.** The reader's fact is that
  they already tapped `That's me`, and the thing they want to know is whether it can be fixed. Both go in.
  `Someone is already linked to that player.` is not touched: it is product's from the brief and is pinned by
  M3.6's acceptance check 3.
- **`Saved for the next game.` was a receipt on a card that nobody had tapped.** With the hints stacked it
  followed the preference sentence and read as the answer to a tap; as the state's only hint it is the first
  thing a friend sees when they open the page after the teams are posted, having tapped nothing — and it
  tells them a role was saved for them. The replacement is a rule instead of a receipt, true before and after
  a tap, and it keeps the limiter the stacked sentence used to supply from the line above it: `the bot tries
  for` is the same verb the `open` hint uses, so the two states speak one vocabulary. The receipt itself is
  unchanged and is not a sentence — the role word turns `brand`, as the brief settled.
- **A button is a label, not a sentence.** `Sign in with Discord to pick your role.` is the reason; `Sign in
  with Discord` is the act. Splitting them is the designer's card, and it costs one new string.
- **The heading names you, because the phone gets passed around.** A friend hands the phone over so somebody
  can see the teams, that person taps a role, and it lands on the first friend's row with no way to tell from
  the screen. `Your role tonight · Hana` is the whole fix and it costs a micro-label six characters. It is
  suppressed rather than filled with `Someone` when there is no name: a heading that says `· Someone` answers
  the question with the word that caused it.
- **Rendered strings use the ASCII apostrophe.** `Only somebody in tonight’s lobby can be picked.` was the one
  friend-facing string in the app with a curly `’`, against `That's me` and `Names fill in after someone's
  first game.` two files away. Curly apostrophes stay in comments and test names, where they are prose.
  Passive voice went with it: it is a friend tapping, so the sentence says `You can only pick`.

Of the control's own copy, six of the brief's eight strings stand byte for byte and `SET_ROLES_LINK` is the
table above this one finally rendering. The two that moved on 2026-09-10 moved because the designer's review
changed what stands beside them — a card with one hint per state, and a button under a sentence — not because
product changed its mind about what the control means. Nothing here promises more than the balancer does,
which is the one rule the whole block exists to keep.

#### Copy — `Start a lobby` (M4.2, product 2026-09-10; widened by M4.13, 2026-09-15)

Every word the one tap can produce, on either surface, in one table — the tonight page and `/admin` call the
same route and may not end up saying two different things about one command. The control's own strings were
settled in the M4.2 brief on 2026-09-09 and are quoted here unchanged; the rows marked **new** are what the
2026-09-10 and 2026-09-15 passes ruled, where the brief had prose and no string. They live in
`apps/web/lib/lobbyStart.ts` (everything the route answers with, imported by both surfaces — it moved out of
`lib/admin/` with the route in M4.13), `apps/web/lib/me/copy.ts` (the not-linked sentence, beside the other
`/api/me/*` refusals) and `apps/web/lib/tonight/copy.ts` (the two sentences only the browser can know). That is
three files and one table; they may not drift.

**The rule for a refusal is the M3.6 block's**, unchanged: say what happened, then say who can undo it or what
to do next. Never the queue's vocabulary — `wrong_phase` and `already_in_lobby` are words for a log, not for a
friend on a phone.

| Where | String | Status |
|---|---|---|
| the button, both surfaces | `Start a lobby` | product 2026-09-09 (brief) — shipped verbatim, kept |
| while the command is pending or sent | `Opening a lobby on Hana's PC…` — the host the server picked, named while it is pending and not after | product 2026-09-09 (brief) — kept. Real ellipsis, as everywhere else |
| on success | *(nothing — the member list appearing is the answer, and a toast on top of it is noise)* | product 2026-09-09 (brief) — kept |
| under the member list while the lobby is filling, until ten are in | `Invited 7 friends — waiting for them to accept.` · `Invited 1 friend — waiting for them to accept.` | product 2026-09-09 (brief) — kept; the singular is the engineer's and is the only form the sentence can take at one |
| a lobby of tonight is already `open`, `balanced` or `in_game` | `There is already a lobby open.` | product 2026-09-09 (brief) — kept |
| nobody's companion has been up in the last 10 minutes | `Nobody has the companion running right now. Start it and try again.` | product 2026-09-09 (brief) — kept |
| a `create_lobby` for tonight is still pending | `A lobby is already being opened.` | product 2026-09-09 (brief) — kept; it is also what the M4.9 unique index answers with |
| the kind is flagged off by M4.1's gate | `Opening lobbies isn't verified on this patch yet.` | product 2026-09-09 (brief) — kept |
| the host's client never answered and the command expired | `Nobody's client answered. Try again.` | product 2026-09-09 (brief) — kept, and it is the **only** failure sentence: from the friend holding the phone, a client in champion select and a client that refused the POST are one fact — nothing was created, press it again |
| the host had made a lobby by hand a minute earlier (`already_in_lobby`) | `Hana already has a lobby open — everyone can join that one.` | product 2026-09-09 (brief) — kept |
| the press never reached the server | `That did not reach the server. No lobby was opened — tap it again.` | **new**, product 2026-09-10 (M4.2) — the web engineer's sentence, confirmed byte for byte. It is the shape product fixed for `ROLE_TAP_OFFLINE` and `LINK_OFFLINE` — the fact, what is unchanged, then the whole fix — and `No lobby was opened` covers the invites too, because the fan-out only ever hangs off a lobby that exists. The page's own string, not the route's: the route never saw the request |
| an anonymous visitor, on the **idle** page | `Sign in with Discord to start a lobby.`, with a `Sign in with Discord` button under it | **live since M4.13** (2026-09-15); product 2026-09-09 (brief), suspended 2026-09-10 and back unchanged, which is what keeping it in this table was for. The press has widened to every linked player, so it no longer promises a button the reader cannot press; and the second ground for the suspension was false in the one state it exists in — `RoleTonight` draws **nothing** for a signed-out visitor with no live lobby, so on an idle page there is no other sign-in anywhere on the site. The sentence is the reason and the button is the label, the role card's own signed-out shape. **Never a disabled `Start a lobby`.** `idle` only: `filling` is a readout, not a control |
| the session expired between the render and the press (401) | `Sign in with Discord to start a lobby.` | **new**, product 2026-09-15 (M4.13) — the one refusal on this control the **page** answers, in its own words. It is the same fact as the row above, so it is the same sentence; the route's own `sign in required` is gate vocabulary and never reaches a screen. Every other refusal still prints the route's words |
| a signed-in visitor with no player row (403) | `Pick yourself out of the list first, then you can start a lobby.` | **new**, product 2026-09-15 (M4.13) — `START_LOBBY_NOT_LINKED`, in `apps/web/lib/me/copy.ts` beside `ROLE_TAP_NOT_LINKED`, whose shape it is built on: same first clause, one verb changed, because it is the same fact about the same visitor said about a second control. **The page cannot produce this request** — the control is drawn for linked viewers only — so it is the forged-post answer, and that visitor is shown no new copy at all: `SIGNED_IN_NO_LOBBY` at the foot of the column is already the true sentence for them |
| tonight page, the lobby a friend can still join by hand — **signed-in linked viewers only** | `Missed the invite? The lobby is Customs 09 Sep #1, password 4821.` — without a stored password, `Missed the invite? The lobby is Customs 09 Sep #1.` — with no name, **no line** | **new**, product 2026-09-10 (**M4.10**; the gate is the lead's, after the designer's review) — the name and password in mono, the sentence in Archivo. Drawn in the `filling` and `balanced` states only, and gone from `in_game` on because by then there is nothing to join. **An anonymous visitor is shown nothing**, and so is a signed-in visitor with no player row — the `That's me` list two blocks up is the thing to do first, and it is already on their screen. The designer is right that a forwarded link with a live password on it is a credential, and the late friend is still served: he is one of the twenty, he has picked himself once, and the page has known him since. Placement is the designer's, with M4.7 |
| `/admin`, under the button | `Customs 09 Sep #1 · password 4821` — the name alone when no password is stored | engineer 2026-09-10 (M4.2) — kept. The plain page reads the row itself, so an admin who reloads still sees what became of tonight's command. Same three shapes as the teams embed's `Lobby` field, minus its code spans |
| `/admin`, nobody has pressed it tonight | `No lobby has been opened tonight.` | engineer 2026-09-10 (M4.2) — kept: the fact, with the button right above it, which is the admin area's whole voice |

**Why the tonight page prints the name and the password.** The M4.2 brief already ruled it — *"It is not a
secret: it goes in the Discord embed and on the tonight page"* — and the copy table, not the brief, was what
went missing, so the control shipped without it. The scene is the argument: the fan-out runs **once**, on the
create ack, and there is no second wave and no reminder ("the button is not a doorman"). Everyone who walks
into voice after that, and everyone who dismissed the popup, has exactly one way in that does not interrupt
nine people — the lobby's name and its four digits, read off the page they are already holding. Without the
line the group does what it does today: somebody reads the password out loud in voice, which is a step, and
steps are what this product claims not to have. `Missed the invite?` opens it because it tells the nine who
are already in that the rest of the sentence is not for them.

It is one lobby's exposure and it expires by itself: a new four-digit password is generated per lobby, and the
line is gone the moment the game starts. **And from 2026-09-10 it is not on the open page at all** — the lead,
after the designer's review, gated it to a signed-in viewer the page has matched to a player row. The whole
worry was a link forwarded out of the group turning into a way in; a line only the group can see is not that,
and it costs the late friend nothing, because being linked is what the page already needed of him to know who
he is. Product weighed the open form against a latecomer having to ask; the gated form ends the trade.

### What changes on the leaderboard and the player page (M3.5)

M3.5 is being built against v1 right now. Nothing in its **content** decisions moves — `Proven` is still the
primary number and the sort key, `Rating` is still on line 2, the two names are still fixed, the legend is
still a legend and not a sticky header row, the `settling` chip is still a chip, the history chart still plots
`Rating` and only `Rating`, with the seed line in the same units. What changes is dress, and it is a follow-up
task, not a reason to stop:

1. **The shell.** `/leaderboard` and `/p/[puuid]` mount the same top bar and footer. This is the biggest single
   change and it is free if the shell lands as a layout.
2. **Tokens.** `accent` → `brand`, and the new `raise` and `line` tokens. Rows sit on `surface` inside a card
   with a `raise` header bar carrying the `Proven` legend, instead of a bare list on the page.
3. **Type.** `Proven` on line 1 becomes mono `t-md` 600 (unchanged in kind); the player page's current
   `Proven` number becomes `t-display`. Rank 1 keeps `brand` on the rank number only — no medals.
4. **Role icons** wherever a role is named on `/p/[puuid]`.
5. **Extract the row.** The rail on the tonight page renders the board's top five, so M3.5's row must be a
   component (`app/_leaderboard/BoardRow.tsx`) and its query must take a limit
   (`loadTopPlayers(client, { limit })`). Building it inline in the page means writing it twice.
6. **The sparkline stays hand-drawn.** One inline `<svg>`, one `<path>`, 1.5px `brand`, no fill, no points, no
   grid, no charting library. 140px on phone, 180px in the rail if it ever appears there.

#### The window picker (M5.12, designer 2026-09-10)

Five windows, five links, in the header of `/leaderboard`, `/p/[puuid]` and — with M5.4 — `/stats`, which
mounts the same component with `This month` selected. The control looks the same on all three pages and the
words are product's five, unshortened.

**A wrapping row of chips.** Not a segmented control: five two-word labels do not fit in 358px at 390 without
scrolling or breaking the 44px rule, and a segmented control on two rows reads as broken. Not tabs under the
title: the shell nav is tabs with a `brand` underline 44px above, and two tab rows on one phone screen is two
navigations in one visual language — a chip row reads as a filter, which is what this is. **3 + 2 at 390, one
row from 720px.** The wrap splitting the two month options across rows is accepted: the chosen chip is marked
and the h1 names it.

**Labels are Archivo `t-sm` 500, not mono.** Same ruling as the shell nav — *"these are destinations, so
Archivo"* — and the same type rule as everywhere else: `number or role → mono`. `This week` set in mono is a
terminal string on a page whose every number is already mono, and a capital letter on a mono micro-label is
forbidden two sections up (`top`, `live`, never `This Week`).

**Where it sits, both pages.** The header strip is three lines and a hairline:

```
This week Leaderboard                       ← h1: window name t-lg 600, page noun in `dim` (unchanged)
[This week] [Last week] [This month]
[Last month] [All time]                     ← the picker, sp-4 under the h1
SUNDAY 31 AUG TO SATURDAY 6 SEP · 14 RATED GAMES   ← the window slot (the board's form, M7.18;
                                                     `· 14 GAMES` on /stats, /fun and /games)
────────────────────────────────────────
```

On `/p/[puuid]` line 1 is the player's name in the display cut and everything else is identical.

**The window slot holds exactly one of two things, never both and never neither.** The strings are product's
(copy table, next section) and this is only where they sit:

- the window's **range and count** — `Sunday 6 Sep to Saturday 12 Sep · 14 rated games` on `/leaderboard`
  (`boardSlotLine`), `Sunday 6 Sep to Saturday 12 Sep · 14 games` on `/stats`, `/fun` and `/games`
  (`windowSlotLine`), `September · 34 games`, `Since 8 Sep 2025 · 312 games`. **Two formatters, because there are
  two counts** (M7.18): the board counts the games that moved a rating and the other three count the games the
  group played, ARAM included, and since M7.1 those are different numbers under the same dates. Both are right,
  so each says which it is, in one word, on every window and not only on the ones where they differ. The slot
  dresses both the same. Mono `t-xs` `dim` `0.08em`, upper-cased by
  the dress and sentence case in the DOM, which is the tonight strip's slug treatment: it is a legend about the
  thing above it, and it is the answer to "which week". Every window has one, including `All time` — a slot
  that vanishes on one of five taps reads as broken. **On `/p/[puuid]` the range half prints alone**, because
  M5.15's seed line already ends `, 6 rated games since.` (M7.22). **`/stats` prints the whole form**, range and count, in the
  same slot `/leaderboard` does — M5.22 took the count out of that page's two group sentences precisely so that the
  slot is the one place it appears, and M7.18 is why the two forms are not the same words.
- when the window has no games, the window's **empty sentence** (`No games last week.`), Archivo `t-base`
  `dim`, **instead of** the range and never beside it. It lives here and not below the hairline because on
  `All time` the same slot sits above rows that exist, so it is not a caption of empty content — it is a
  statement about the window that was just chosen, and the window is the header. **An empty window draws
  nothing under the hairline**: no board card on `/leaderboard`, and on `/stats` no awards, no group card and
  no lists (rule 6 of that page's section). `/p/[puuid]` is the one exception and keeps its rating card,
  because the subject there is a person and their two numbers are current rather than the window's; everything
  windowed on it is undrawn like the rest. The sentence in the slot is the whole answer, and a card with a
  legend and nothing under it is a page that looks broken rather than empty. An empty board is then a closed
  header over an empty page, which is honest.

**Dress.**

```css
.cn-windows { display: flex; flex-wrap: wrap; gap: var(--cn-sp-2); margin-top: var(--cn-sp-4); }
.cn-window {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 44px; padding: 0 var(--cn-sp-3); white-space: nowrap;
  font-family: var(--cn-font-sans); font-size: var(--cn-t-sm); font-weight: 500;
  color: var(--cn-text); text-decoration: none;
  background: var(--cn-raise); border: 1px solid var(--cn-line);
  border-radius: var(--cn-radius-row); transition: background-color 120ms ease;
}
.cn-window:hover  { background: var(--cn-pressed); }
.cn-window:active { background: var(--cn-pressed); transform: scale(.985); }
.cn-window-on {
  color: var(--cn-brand); background: var(--cn-brand-tint);
  border-color: var(--cn-brand); box-shadow: inset 0 0 0 1px var(--cn-brand);
}
```

`text` at rest, for the role chips' reason: a row of `dim` words reads as five disabled controls. The doubled
`brand` edge is the light-mode rule paid for in both themes — in light, `brand-tint` is a 12% wash on white and
lands *lighter* than the `raise` chips beside it, so the chosen chip is the palest box in its row and that edge
is the whole receipt. One recipe, both controls, both themes. No `max-width`: the picker is as wide as the
column it sits in.

**It is five links, and the current one is marked the way the shell marks its own current tab** —
`aria-current="page"`, not `aria-current="true"`, and still a link, so a keyboard user does not hit a hole
where the window they are reading should be. `<nav aria-label="Time window">`, because a second unnamed
landmark beside the shell's is announced as "navigation".

**A row's window line.** `6 games · 4W 2L · +58` closes the meta run on line 2: games, record and climb are one
window fact and belong in one run, and the right edge of line 2 stays `Rating` under `Proven`, one vertical
pair of numbers. The climb is **never coloured by sign** — gain `text` 600, loss `dim` 400, always signed — and
it is **`t-xs`, the size of the run it sits in**: `.cn-row-meta .cn-delta { font-size: inherit; }`, declared in
`board-parts.css` so the tonight rail's rows get it too. Shipped, it was `t-sm` inside a `t-xs` line, which put
two type sizes in one row of meta. On `All time` there is no climb and the streak keeps the position.

**The still-settling note sits below the board card**, not between the picker and the first row: with the
picker in the header it pushed the first name past half the fold on a 390×844 phone, and a sentence about how
the sort works is read after the numbers, not before them. Still once per page.

#### "How you got here" on `/p/[puuid]` (M5.15, designer 2026-09-10)

Somebody is sure the board is wrong about them. These are the three lines that answer it: where they started,
what each game did, and why a game is worth what it is worth. They are **prose on a page of tables**, and the
whole dress question is how prose earns its place beside a column of tabular numbers without becoming a second
column of them.

The type rule they run on — a quantity in a sentence stays Archivo, a token you have to transcribe is mono — is
written once, under "The number-in-a-sentence rule", with the `Start a lobby` block. Nothing on this page is a
token to transcribe, so every number in every sentence here is Archivo: `1290`, `37`, `58%`.

**The seed line: `t-base`, `text`, above the chart, inside the rating card.** It is the first half of the
answer, not a caption for it. At `t-sm` `dim` — what the first build shipped — it is the quietest text in the
card it is the point of, wedged between a mono meta line and a mono chart label. `margin-block: var(--cn-sp-3)`
so it is not glued to either.

**The meta line above it drops its games count when the seed line is present.** `37 games · 19W 18L`
twenty-four pixels above `…, 37 rated games since.` prints one number twice, which the copy table already forbids for
the window slot. The record line becomes `19W 18L`; the count lives in the sentence, which is the more useful
of the two places. At zero games there is no meta line and the seed line has already dropped its clause, so
nothing here has a second case.

**And the sentence that says which games that record is over sits where the sections start** (M7.18): `The
record above counts games that moved a rating; everything below counts every game you played, ARAM included.`
`t-sm` `dim`, one paragraph, between the rating card and `By role` — the seam where the two universes part, and
the only place on this page either of them is named. It is not a caption on the record and not a note on each
section. **The meta line itself never carries a count**: the rule above means there is no window and no player
on which it could, so nothing on that line says `rated` and no code branch pretends otherwise. The one count a
reader sees above the sections is the seed line's, and **since M7.22 (product, 2026-09-16) it says so in its own
words**: `Started at 1200, 37 rated games since.` The rule in this paragraph is **kept, not inverted** — the
count was named where M5.22 already put it, rather than moved back up to the record line, because "since when"
is what the count is about and the meta line has no "since" in it. See the two seed-line rows of the copy table
for all five windows.

**The per-game line is a caption on the head above it, and carries only what that head cannot say.** The head
already prints `Lost`, `1392` and `(−42)`; the line beside it is `As the 58% side.` — their own side's chance,
and nothing else. A game with no stored chance gets **no line at all**: with the result and the delta gone
there is nothing left in that form but the head retyped. `not rated` rows keep their three words and no line,
unchanged.

- **Placement is unchanged and is not reopened**: under the head it explains, above the lineup, inside the game
  block's leading side rule. It does **not** crowd the 44px lineup rows — it is outside them, and they keep
  their height. `padding-bottom: var(--cn-sp-2)` so it hangs off the head rather than floating between the head
  and the first seat.
- **`t-sm` `dim`, and it stays `dim`.** Once it is four words and not a duplicate it is a caption, and a
  caption does not compete with the number it is a caption for. This is the one line on the page that is
  allowed to be quiet, because the head above it is already loud.
- **It ends in a full stop**, because it is a caption and not a label. Every other run of prose on this page
  closes the same way; an unstopped fragment in `dim` under a row of numbers reads as text that got cut off.
  Labels — `rating`, `seed`, `not rated` — are the things without stops, and they are mono.

**The explanation line, once per page, under the list, in the explanation strip's dress.** It is the same
object as the tonight page's explanation line — the bot saying why it did what it did — so it gets the same
treatment and no new token: `border-inline-start: 3px solid var(--cn-brand)`, `padding: var(--cn-sp-3)`,
`t-base`, `var(--cn-text)`. Under the list and not above it, because it answers a question the rows raise.
It is also now the only line on the page that explains the **size** of a change, since the per-game caption
gave that job up — which is the argument for it being the loudest of the three and not the quietest.

**It is two sentences in one paragraph since M7.10 (2026-09-16), not two strips.** The MVP / ACE sentence
follows M5.15's inside the same `<p>` in the same rule: they answer the same question and splitting them would
draw a second brand rule twenty pixels under the first, which reads as two arguments where there is one. The
strip grows by a line on a phone and that is the whole visual change. **Both sentences always print** — this
one is about the model, not about a game, so a player who has never been either one still reads it, and a page
whose every row is `not rated` still reads it.

**The `MVP` / `ACE` word on a row takes no dress of its own** (`.cn-game-award`): the delta's `t-sm`, the row's
`--cn-text`, no weight, no background, no border, no icon, no gold. It follows the delta inside the same head,
`1512 (+43) MVP`, so it is read as the end of that phrase rather than as a badge parked beside it, and it does
not wrap away from its number. Floodlit has no award colour, and a task that prints two words per game is not
the place to mint one. It is also the one thing on a game head that is about **who**, not about how much, which
is exactly why it must not out-shout the number it qualifies.

**The `not rated` footnote keeps `.cn-hint` and stays above it.** Two `dim` paragraphs stacked read as one grey
block that nobody finishes; a footnote about three rows and the page's whole argument are not the same voice.
One is `dim` prose, the other is a strip with a brand rule, and the difference is visible before either is
read.

**Light.** `dim` on light `surface` is 6.36 and the captions hold. Nothing in this section is light-specific
and there is no second threshold.

#### The per-player sections on `/p/[puuid]` (M5.20, designer 2026-09-11)

The M5.4 brief put them "below the rating chart"; M5.8 drew `/stats`, and this is that recipe read for one
person instead of for twenty. Five rulings, no new token, and no word product has not already fixed.

**1. The order down the page stands.** Rating card (the two numbers, the record, the seed line, the chart, the
settling sentence), the award line, `By role` and its footnote, `By side`, `Partners`, `Streaks`, the mean-game
line, `Recent games`, the explanation strip. Everything the page asserts *about* a person comes before
everything that *happened* to them, and the explanation strip keeps the last word because it is the one line
that says why any of it moved. At 390 that is two and a half screens before `Recent games`, so nothing
collapses, nothing folds behind a tap and no section moves. The band is four cards and two bare sentences; a
fifth card is the thing to resist.

**2. The award line is a statement, not a caption.** `Most improved, September.` sits between the rating card
and `By role`, in the flow and not inside the card — the card is M5.15's, and this belongs to the window band
under it. `t-base`, `text`, **weight 600**, no badge, no icon, no colour (product). The weight is the whole
ruling: at 400 it is the seed line's dress forty pixels below the seed line, and the page's only honour reads
as a second caption. `t-lg` stays `/stats`', where three winner lines with numbers in them are the page's
headline and the name leads each one; here the `<h1>` is already the name.

**3. `By side` keeps its card, and the two names take the two colours.** Two rows are not too few for a card:
it is `By role`'s twin one row above, with the same record shape and the same five-row minimum, and one line
holding two records is a table squeezed into a sentence at 390. `Blue` and `Red` are **Archivo, capitalised, at
the row's `t-sm`** — product's ruling in the copy table above, and the dress follows the word: a side is a name
read as language, like the partner names in the card below it, and the mono lower-case exception stays the
roles' alone. They print in `--cn-blue` and `--cn-red` rather than `dim`, because this is the one card in the
product where a side is the subject of a row rather than a team, so the colour is the content — and this same
page already paints a game block's leading rule by side. It is not the team card's mark: no tint, no border,
no chip, two words. Contrast is 6.2 and 6.4 on dark `surface`, 6.1 and 6.2 on light, both clear of the 4.5
this size asks for.

**4. No name is in both partner lists.** `Theo · 6W 4L · 60%` under `Best together` and again under
`Worst together` is the fold showing through, and it is the first thing a reader points at. With N qualifying
partners: `Best together` takes the top `min(3, N)`, `Worst together` takes what is left from the bottom
(`min(3, N − 3)`), and at N ≤ 3 the card draws `Best together` alone — a ranked list of everyone who qualifies,
best first, which is exactly what the label claims. With nothing qualifying the card prints
`Nobody has 5 games with them yet.` **once**, with neither group label over it: one fact, one sentence. No new
string, and the minimum does not move.

**5. The mean game is a line, not a card.** `Average game 34 min.` in a bordered card of its own is M5.8's
rule 3 read backwards — that rule gives three orphan sentences a body and says in the same breath that one
sentence does not need one. It prints in the flow under `Streaks`, `t-base` in `text`, the dress
`.cn-stats-answer` already carries.

**Roles are M5.8's exception, unchanged, and at the size `/stats` prints them:** mono, lower case, **16px**
icon and word. A role is one object across two pages, and this one must not print it larger than the page
beside it.

**The empty window ships as built.** The window's sentence goes in the slot where the range would be, in
`dim`, the same place and the same dress `/leaderboard` and `/stats` give it — the board is one tap away and
all three pages say one thing one way. The rating card stays, and the strip keeps its hairline: **M5.8's
rule 6 is a `/stats` rule**, where the window is the whole subject. Here the subject is a person, their two
numbers are current rather than the window's, and a page about somebody that prints no number about them is a
page that failed. Everything windowed — the record line, the seed line, the chart and all six sections — is
undrawn, which is the rule this page already follows.

**Light.** Nothing here is light-specific. The two side colours are the only new ink and both hold above 6:1
on white; `dim`, the group labels and the card header bars are unchanged.

#### Copy — the board pages, final (product 2026-09-09)

Every word `/leaderboard` and `/p/[puuid]` say, in one table, the same way the tonight page's strings are
settled above. They live as one constant each in `apps/web/lib/board/copy.ts` — that file is the code half of
this table and the two may not drift. `(shipped)` marks a string that already existed and is quoted unchanged;
the three marked **new** in the 2026-09-09 pass are the ones M3.5, M3.8 and M3.10 wrote against no doc,
reviewed by product and kept.

**Amended 2026-09-10 (product), for windows, the closed-window post and "how you got here."** Seasons are gone
(`04-decisions.md`): the board is read through five time windows, so the heading, the nightly title and both
empty states move, two strings are deleted outright, and the rows for the weekly and monthly post (M5.10), the
seed and per-game explanation lines (M5.15) and the inferred roles on `/admin/players` (M5.17) are new here.
The word *season* no longer appears in anything a friend can read. Layout for all of it is **M5.8**'s; the
words below are fixed.

| Where | String | Status |
|---|---|---|
| primary number, label | `Proven` — `round(ordinal * 60)`, the sort key — **on `All time`, `This month` and `Last month` only**; on `This week` and `Last week` the primary number is the weekly `Rating` and Proven is not printed at all | *(shipped, M3.5)*; **week carve-out, product 2026-09-15 (M7.3)** — whichever number decides the order is the number the row has to print, and a week window is ordered by the weekly `Rating` |
| secondary number, label | `Rating` — `round(mu * 60)`, the number the embeds print — **line 2 on the three Proven windows**; on a week row it is gone from line 2, because it is already the big number on line 1 | *(shipped, M3.5)*; **week carve-out, product 2026-09-15 (M7.3)** — one row never says one number in two type sizes |
| legend over the one unlabelled number | `Proven` | **amended, designer 2026-09-09** — was `Proven · Rating`; see "Leaderboard row". The code change lands with M3.18 |
| board heading | the **window's** name (`This week`), with `Leaderboard` beside it in `dim` | **amended, product 2026-09-10 (M5.12)** — was the season's name; seasons are gone (`04-decisions.md`) and the season row's name is never printed to a friend again. `standings` → `Leaderboard` (designer 2026-09-09) is unchanged |
| nightly embed title | `This week · leaderboard` | **amended, product 2026-09-10 (M5.12)** — the nightly post prints the week's board and links to `?window=this-week` |
| result embed, footer | `Kustom · game 47` — `Kustom` alone when the count is missing | **amended, product 2026-09-10 (M5.12)** — was `Season 1 · game 47`; the count is unchanged and is the **all-time** game number (every game stored up to this one), never tonight's. See "Result embed" |
| back link on `/p/[puuid]` | `← Leaderboard`, and deleted when the shell lands | **amended, designer 2026-09-09** — same row |
| still-settling chip | `settling` | *(shipped, M3.8)* kept |
| still-settling sentence on `/leaderboard`, once per page | `The board sorts on Proven: your rating, minus how unsure the board still is about you. That gap shrinks as you play and settles after about 30 games.` | **amended, product 2026-09-10 (M3.19); scoped to `/leaderboard` and kept byte for byte, product 2026-09-10 (M3.26)** — the 2026-09-08 pair told a new player they begin at the bottom and rise, which is false on a season's first board, where every row is a rank seed and Proven orders exactly as rank does. The ruling is in `04-decisions.md`; "Still-settling marker (M3.8)" below quotes the same words. **`you` is right here and stays**: everyone reading this board is on it, and the sentence's grip is that the reader finds themselves in it. The player page prints the row below instead; the two are separate constants and neither may be edited into the other. `SETTLING_SENTENCE` keeps this string |
| still-settling sentence on `/p/[puuid]`, once per page | `The board sorts on Proven: a player's rating, minus how unsure the board still is about them. That gap shrinks as they play and settles after about 30 games.` | **new, product 2026-09-10 (M3.26)** — on Yuki's page `your rating` names the number printed twenty pixels above it, and that number is Yuki's, not the reader's. Same two sentences, same shape, same two interpolations (`Proven` from `PROVEN_LABEL`, `30` from `SETTLING_GAMES`), one pronoun moved, so a reader arriving from the board meets the same explanation and not a second one. **No name is interpolated**: a nameless player is `Someone` (M3.10), and `Someone's rating, minus how unsure the board still is about Someone` is not a sentence a friend would say — nor is the possessive of every name in the group one rule (`Lucas's`). **The M5.15 strip does not replace it**: that strip says why a change is the *size* it is and names neither number, while this one is the only thing on the page that says why Proven sits below Rating and what the `settling` chip beside them means. Placement, and the `settling` gate on printing it at all, are unchanged. A second constant, `SETTLING_SENTENCE_PLAYER` |
| still-settling sentence, embed footer | `Proven is your rating minus how unsure the board still is about you, and it settles after about 30 games.` | **amended, product 2026-09-10 (M3.19)** — `until … has seen about 30 games` said the gap closes then; it never closes. Same ruling row. **Scoped by M7.3 to the windows that still sort on Proven**: the nightly post reads `this-week` and the Sunday post reads `last-week`, so neither of them prints this any more — the row below does. It survives on the monthly post alone |
| the sentence under the board on a week window, once per page, **instead of** the three rows above | `Every week starts everyone on the same rating on Sunday, so a good Tuesday shows up here straight away. The board sorts on Rating — what the bot thinks you are after this week's games — and takes nothing off for playing only a few, so a clean two-game week can sit above a longer patchy one. It is a handful of games either way, so these numbers swing. All time is the settled one, and the one that makes teams.` | **new, product 2026-09-15 (M7.3)** — `This week` is the board's **default window**, so this is the sentence most readers meet and the `Proven` one is now the exception. Four sentences and each is load-bearing: the Sunday restart (why Tuesday is visible on Thursday), which column the order is made of and why it is not the cautious number every other tab shows, that a week is few games and the numbers move hard, and where the settled number lives. **`Every week`, not `This week`** — `Last week` prints the same string, because it is the same track and the same question. No game count is interpolated and the name carries no `SETTLING`: M7.2 measured the weekly track reaching `sigma < 5.00` at game 30, which a group playing one to three games a night never reaches inside a week, so **the week does not claim to settle at all**. **Re-worded 2026-09-16 (M7.21), one clause**: it said `back at their rank`, and M7.19 took the League rank out of every stored seed — `provisionalSeed()`, the same number for everybody — so a week restarts everyone on one rating rather than on their own. `back at their rank` → `on the same rating`, the substitution `WEEK_PLAYER_SENTENCE` settled the same day; **second person is kept**, because every reader of a board is on it. Nothing else in the four sentences moved. `WEEK_BOARD_SENTENCE` in `lib/board/copy.ts`; `SETTLING_SENTENCE*` are untouched and neither may be edited into the other (the M3.26 rule) |
| the same, embed footer, on the **nightly** post (`this-week`) and the **Sunday** post (`last-week`) | `Every week starts everyone on the same rating on Sunday, so these numbers swing, and two clean wins can top a longer patchy week. All time is the settled one, and the one that makes teams.` | **new, product 2026-09-15 (M7.3)** — the short form, for the one-line footer. Both week posts say it; only the **monthly** post still carries the Proven footer. **Re-worded 2026-09-16 (M7.21)** with the long form and for the same reason, the same one clause: `back at their rank` → `on the same rating`, second person kept, nothing else touched. A footer already sent to Discord is not edited; the next nightly post carries the new words. `WEEK_BOARD_SENTENCE_SHORT` |
| legend over the board's one number | `Proven` on `All time`, `This month` and `Last month` · **`Rating`** on `This week` and `Last week` | **amended, designer 2026-09-16 (M7.3)** — the legend names **the number the board sorted on**, whichever track that is, and on a week that is the weekly `Rating` (`round(mu × 60)` off the week's own from-scratch fold). One helper, `boardLegend(track)`, because the legend and the row's own visually-hidden noun have to name the same number. The word `Proven` does not print anywhere on a week board — not in the legend, not on line 2, not in small type |
| `settling` chip on a week window | *(none — no row carries it on `This week` or `Last week`)* | **new, product 2026-09-15 (M7.3)** — the chip marks the handful of rows the board is least sure of; on a week that is every row, every week, and a marker on all ten rows marks nothing. There is no `WEEK_SETTLING_GAMES` and no second chip. `SETTLING_GAMES` and the chip are byte-identical on the other three windows |
| the sentence under the chart on `/p/[puuid]` on a week window, once per page, **instead of** the third-person Proven sentence | `Every week starts everyone on the same rating on Sunday, so a good Tuesday shows up here straight away. This is their rating after this week's games, with nothing taken off for playing only a few. It is a handful of games either way, so these numbers swing. All time is the settled one, and the one that makes teams.` | **new, product 2026-09-16 (M7.16)** — the page joined the weekly track, so the paragraph that explains Proven was explaining a number no longer on the screen. **Third person**, because the page may be somebody else's: `WEEK_BOARD_SENTENCE`'s `you` is right on a board, where every reader is on it, and wrong twenty pixels under a number that belongs to whoever's page this is (the M3.26 rule). It carries the board sentence's four load-bearing points and drops its clause about a sort order, because this page sorts nothing. **It does not say `back at their rank`**: M7.19 (2026-09-16) took the League rank out of every stored seed, so a week restarts everyone on one rating. This sentence got that wording first, and **M7.21 carried the same one-clause correction to the two board rows above on 2026-09-16**, so all three week strings now say a week starts everyone on the same rating; they still differ where they must — the person, and the clause about a sort order. Printed on an empty week too, where the number on screen is the weekly seed. `WEEK_PLAYER_SENTENCE` in `lib/board/copy.ts`; `SETTLING_SENTENCE_PLAYER` is untouched and prints byte for byte on `All time`, `This month` and `Last month` |
| the two numbers on `/p/[puuid]` on a week window | `Rating <n>` alone, in the display cut — **no `Proven`, anywhere** | **new, product 2026-09-16 (M7.16)** — the board row's own carve-out, one tap later and for the same reason: a week is a handful of games by design, so `− 2σ` is enormous on every page every week. The one number is the weekly `Rating` and is the digit on that player's board row. The `settling` chip does not print on a week here either, and the chart's hairline is the weekly seed under the existing `start` label — never `seed`, which stays a fact about a whole history |
| ~~season active, no games yet~~ | ~~`No games this season yet.`~~ | **deleted, product 2026-09-10 (M5.12)** — replaced by the five window lines below; the word *season* leaves the friend-facing vocabulary |
| ~~no season is active, on both pages~~ | ~~`No season is active, so there is no board yet. An admin can start one.`~~ | **deleted, product 2026-09-10 (M5.14)** — there is no button behind it any more, and a deployment with no season row has no games either, so the empty-window line is true and enough |
| a recent game's result, on `/p/[puuid]` | `Won` / `Lost` | **new**, product 2026-09-09 — kept as written |
| game count | `1 game` · `28 games` | *(shipped)* kept |
| win–loss record | `13W 15L` | *(shipped)* kept |
| rating chart, title | `Rating` | *(shipped)* kept |
| rating chart, reference line | `seed` | *(shipped)* kept |
| player page sections | `By role` · `Recent games` | *(shipped)* kept |
| a player with no name | `Someone` | *(shipped, M3.10)* kept |
| nameless hint, once per page while any row reads `Someone` | `Names fill in after someone's first game.` | *(shipped, M3.10)* kept |
| rating column, unrated game | `not rated` | **new**, product 2026-09-10 (M3.23) |
| hint under Recent games, when any row is unrated | `Some games don't move ratings: ARAM, too short, short a player, or added from match history and not counted yet.` | **amended, product 2026-09-16 (M7.17)** — was `Some games don't move ratings: too short, short a player, or added from match history and not counted yet.` (new, product 2026-09-10, M3.23). **The defect the designer raised on 2026-09-16 (M7 review) — the list was short one reason — is fixed by this row.** Since M7.1 an ARAM is stored, listed and never rated, and M7.11's rebuild un-rated the four ARAM nights already in the history, so rows read `not rated` for a reason the sentence did not offer, on a page whose whole job is to explain why a number did or did not move. The sentence enumerates, so an unlisted reason reads as a bug rather than a rule. **One word added and nothing else in the sentence touched**: ARAM goes first because it is now the most common of the four, there is no second sentence, and no argument for *why* ARAM does not rate — that lives in `00-product.md` and not in a hint line. **No per-row reason**: M3.23's one vocabulary stands, so `NOT_RATED` is untouched and every unrated row still reads the same three syllables. `NOT_RATED_HINT` in `lib/board/copy.ts`, pinned by code point in `lib/board/board.test.ts`; the prose under "Rating history" below says the same string |
| nightly embed, field name | `Top ten` when ten lines print, `The board` when fewer | **amended, product 2026-09-10 (M3.22)** — was `Top ten` always; see "Nightly leaderboard embed" |
| window picker, the five options | `This week` · `Last week` · `This month` · `Last month` · `All time` | **new**, product 2026-09-10 (M5.12) — the same five words are the option, the board heading and the post title |
| window picker, accessible name (on screen nowhere) | `Time window` | **new**, product 2026-09-10 (M5.12) — the `<nav>`'s `aria-label`, so five links are not announced as a second unnamed "navigation" beside `Leaderboard`. Product's own noun, and true on all three pages; if **M5.8** gives the control a visible heading it is this string, verbatim |
| window slot, the range half (under the picker) | `Sunday 13 Sep to Saturday 19 Sep` · `Sunday 6 Sep to Saturday 12 Sep` · `September` · `August` · `Since 8 Sep 2025` | **new**, product 2026-09-10 (M5.12, the designer's slot); **the week runs Sunday to Saturday, product 2026-09-15 (M5.34)** — was `Monday 8 Sep to Sunday 14 Sep`, and the only thing that moved is the anchor day, which the formatter derives from the window's own bounds. One per window kind. Weeks name both weekdays and carry the month on both ends (`Sunday 28 Sep to Saturday 4 Oct`); the last day named is the last **night** of the window. Months are the month's name and nothing else — a day range would spell out what a calendar already says. Only `Since …` carries a year, because only it can reach one |
| window slot, assembled — `/stats`, `/fun`, `/games` | `` `${range} · ${gamesLabel(count)}` `` → `Sunday 6 Sep to Saturday 12 Sep · 14 games`, `September · 34 games`, `Since 8 Sep 2025 · 312 games` | **new**, product 2026-09-10 (M5.12); **week form re-anchored to Sunday, product 2026-09-15 (M5.34)**; **scoped to the three played-count pages, product 2026-09-16 (M7.18)** — the string is **unchanged and `windowSlotLine` is unedited**; what moved is that `/leaderboard` stopped calling it and took the row below instead. The count is the window's counted games (M5.4's universe, `gateGame`, ARAM included per M5.26) and goes through `gamesLabel`, so a one-game week never reads `1 games`. On `/p/[puuid]` the **range half prints alone** — M5.15's seed line already ends `, 6 rated games since.` (M7.22 named that count; this row's own string is untouched by it) and no page says one number twice |
| window slot, assembled — `/leaderboard` | `` `${range} · ${ratedGamesLabel(count)}` `` → `Sunday 13 Sep to Saturday 19 Sep · 12 rated games`, `September · 34 rated games`, `Since 8 Sep 2025 · 312 rated games`, and `· 1 rated game` at one | **new**, product 2026-09-16 (M7.18) — the board is a rating board and its count is the games that **moved a rating**, which since M7.1 is a smaller number than `/stats`' under the same dates one tab across. Both counts are right; the bug was that neither page said which it was showing, so each says it in one word. **A second formatter (`boardSlotLine`) beside `windowSlotLine` and never a flag on it**: two sentences about two universes that happen to share a shape, and the day one moves the other must not. **The word is never conditional** — on a window with no ARAM in it the two counts are equal and this still reads `rated games`, because a label that appeared only when the numbers differed would teach nobody anything and would read as an error. An **empty window** prints its empty sentence and never `· 0 rated games`. The adjective goes on the noun and not the count: `1 rated game`, never `rated 1 game`. `boardSlotLine` / `ratedGamesLabel` in `lib/board/copy.ts`, pinned by code point in `lib/board/counts.test.ts` |
| window slot, empty window | the window's own empty sentence, alone — `No games last week.` | **new**, product 2026-09-10 (M5.12) — the slot shows the sentence **instead of** the range, never both and never `· 0 games`. It is the sentence's one place on the page: with it in the slot the board card is not drawn at all, which is how "never a blank card" and "never twice" are both true |
| empty window, one per kind | `No games this week yet.` · `No games last week.` · `No games this month yet.` · `No games last month.` · `No games yet.` | **new**, product 2026-09-10 (M5.12) — a running window says *yet*, a closed one does not, because nothing more is coming |
| a row's window line | `6 games · 4W 2L · +58` | **new**, product 2026-09-10 (M5.12) — the window's games, record and climb; absent on `All time`, where the row is today's row |
| player chart reference line, in a window | `start` (`seed` stays on `All time`) | **new**, product 2026-09-10 (M5.12) — the rating carried into the window is not a seed |
| weekly / monthly post, title and dates | `Last week · leaderboard` / `Last month · leaderboard`, description `Sunday 6 Sep to Saturday 12 Sep · 14 rated games` | **new**, product 2026-09-10 (M5.10); **week re-anchored to Sunday, product 2026-09-15 (M5.34)**; **the count is named, product 2026-09-16 (M7.18)** — the last day named is the last *night* of the window, and the description is still the board's own slot line composed by the board's own formatter (now `boardSlotLine`), so the post and the page it links to cannot say two things about one window. A sent embed is a record of what was said and is not edited; the next post carries the new words |
| weekly / monthly post, awards field | `Awards`, then `**Most improved**`, `**Best off-role**`, `**Cursed duo**` with M5.4's winner lines verbatim | **new**, product 2026-09-10 (M5.10) — including the "nobody qualifies" sentence when nobody did |
| awards, still running | `Awards are handed out when the week ends.` / `… when the month ends.` | **new**, product 2026-09-10 (M5.4) |
| awards, section intro | `Three awards for the week. Nobody votes; the numbers pick.` / `… for the month. …` | **amended, product 2026-09-10 (M5.4)** — was `Three end-of-season awards.` |
| an award on `/p/[puuid]` | `Most improved, week of 6 Sep.` / `Most improved, September.` — and the same form for the other two awards: `Best off-role, September.`, `Cursed duo, week of 6 Sep.` | **amended, product 2026-09-10 (M5.4); the other two awards named, product 2026-09-11 (M5.20)** — was `Most improved, Season 1.`. All three read `<award label>, <calendar>.`: the label is interpolated from the award's own constant so this line cannot drift from `/stats` and the weekly post, and the calendar is the window's — `September` from `formatMonthName` on the two month windows, `week of 6 Sep` on the two week ones. A cursed-duo line prints on both halves' pages and names neither the partner nor the record; the full line is on `/stats`. No badge, no icon. See the M5.20 copy table |
| `/stats` cap line | `Showing the most recent 2000 games.` | **amended, product 2026-09-10 (M5.4)** — was `… of this season.` |
| `/p/[puuid]`, the sentence where the stats sections begin | `The record above counts games that moved a rating; everything below counts every game you played, ARAM included.` | **new**, product 2026-09-16 (M7.18) — the header's record is folded over the games that moved a rating and every section under the chart (`By role`, the sides, the partners, the streaks, the mean game) is folded over every game the player played, ARAM included. Both are right, they are forty pixels apart, and nothing said so. **Once, at the seam**, not a word on each of the five sections and not a second sentence beside the streak — which stays the one mixed computation it has always been (M5.21) and is covered by the second half of this one. **Second person**, the one place M3.26's third-person rule does not apply: the page is about a person and the reader is usually looking at their own, so `you` names the reader's games and not the number above. A third-person twin for somebody else's page is product's to write if it is ever needed; the code does not grow one. **Not conditional on the player having played an ARAM** — somebody with none reads it and finds it true and dull, which is the correct outcome. It is **absent** on a window with no sections under it, and absent for a player whose whole window was ARAM (no record above it to explain). `PLAYER_COUNTS_SENTENCE` in `lib/board/copy.ts` |
| the header record on `/p/[puuid]` | `20W 17L` — **no count, and therefore no `rated`, anywhere on this line** | **corrected 2026-09-16 (M7.18 as landed; the reviewer)** — the row that stood here proposed `37 rated games · 20W 17L` and said the count printed "in one case". **There is no such case.** M5.22's rule (two rows down) drops the count whenever the seed line is present, the seed line is present on every window that has a record, and the line itself is absent at zero games — so the count prints on no window, for no player, ever, and the branch M7.18 wrote for it was unreachable code. It is deleted; `ratedGamesLabel` belongs to `boardSlotLine` and to nothing on this page. **So the first clause of M7.18's acceptance 3 — "the header record names the rated count" — is _not met_ by M7.18 as landed**, and saying it was met in a formatter was the same mistake in prose. Only the second clause (the one sentence above the sections) landed. The count a reader actually sees above those sections is the **seed line's** `, 37 games since.` — `player.games`, the rated count, worded as plain `games` directly above played-count sections — which is the ambiguity the task was opened to fix and is still there. Naming it means editing an M7.19-pinned string or inverting M5.22, so it is product's word choice and the designer's placement: **open as M7.22**. **Settled 2026-09-16 (M7.22, product): option (b), and this line is not where it lands.** The record line stays `20W 17L` on every window, for every player, with no count and no `rated` on it — M5.22 is **kept, not inverted**, so the count stays in the sentence that says *since when*, and `PlayerView.tsx` grows no `ratedGamesLabel` import back. What changed is one word in the seed line two rows down: `sinceClause` calls `ratedGamesLabel` instead of `gamesLabel`, so the page's one rated count reads `Started at 1200, 37 rated games since.` (and `Started the week at 1469, 6 rated games since.`, `Started the month at 1469, 14 rated games since.`, `, 1 rated game since.` at one, `Started at 1200.` at zero). The alternative — moving the count up here as `37 rated games · 20W 17L` and dropping the seed line's clause — was refused: it reverses a designer decision to fix a wording problem, and it leaves a count with no `since` in it on a line whose neighbours are a rating and a record |
| seed line on `/p/[puuid]`, `All time` | `Started at 1200, 37 rated games since.` — and at **zero games the clause is dropped**: `Started at 1200.` | **the count is named, product 2026-09-16 (M7.22, option (b))** — was `Started at 1200, 37 games since.`, and `37` has always been `player.games`, the *rated* count, sitting forty pixels above `By role`, the streaks and the partners, every one of which counts games **played**, ARAM included. That is the ambiguity M7.18 was opened to remove and the one page where it was still live, because M5.22 leaves this line as the only count on the page. `sinceClause` calls `ratedGamesLabel` instead of `gamesLabel`; **`gamesLabel` is unedited** and `windowSlotLine` keeps `/stats`, `/fun` and `/games` byte for byte. One game reads `, 1 rated game since.` — `ratedGamesLabel`'s own rule, never `1 rated games` and never `rated 1 game` — and the zero-games drop below is untouched. **The word is not conditional**: a window with no ARAM in it still says `rated`, for M7.18's reason — a label that showed up only when two numbers differed would read as an error on the day it appeared. **M5.22 is kept, not inverted**: moving the count onto the record line was the other option and was refused, so the meta line still prints `20W 17L` and nothing else. **The clause M7.19 dropped stays dropped** — that rule was about the *rank*, and naming what the count counted is a different sentence's problem. Older notes, still true: **re-worded, product 2026-09-16 (M7.19, step 3 of two)** — was `Seeded from Gold II at 1469, 37 games since.`, which named a rank beside a number that since 2026-09-16 does not come from it. **The rank clause is dropped, not softened.** A rank printed on the one line that explains where a rating came from is read as the reason for it whatever the preposition does — `Diamond I at the time · started at 1200` was considered and refused for that — and this page is a rating surface, where the product's line is that a solo-queue rank says nothing about these customs. `ratings.seed_rank_tier` / `seed_rank_division` are still stored and still say what the client reported the night a history began; they are simply not on a screen. The number is still `player.reference`, the value the chart's hairline is drawn from, so the sentence and the line cannot disagree — and because it is interpolated, not asserted, the line stays true both before the retroactive re-seed (a row still folded from an old rank seed reads its own number) and after it (1200 for everybody). It also now rhymes with the window form below: `Started at …` / `Started the week at …`. **The 2026-09-10 amendment stands unchanged**: at zero games the clause is dropped, because acceptance check 5 forbids a bare `0` on the newest player's page in the same breath as `NaN` and the record line above it already vanishes there; the count goes through ~~`gamesLabel`~~ `ratedGamesLabel` since M7.22, so one game reads `, 1 rated game since.` |
| seed line on `/p/[puuid]`, in a window | `Started the week at 1469, 6 rated games since.` on `This week` and `Last week` · `Started the month at 1469, 14 rated games since.` on `This month` and `Last month` · **no line at all** in a window the player has no counted game in | **the count is named, product 2026-09-16 (M7.22, option (b))** — the same one-word change as the row above, through the same `sinceClause`, so there is no fifth string and no second rule for a window. **The word is true on the week windows too**: `player.games` is `played.length` there and `played` is filtered on `mu_after not null`, which is the rated universe on every window — checked in `lib/board/load.ts`, not assumed. On a week that count is the weekly fold's, and the wording does not change for it (M7.16). A window with no counted game still prints **no line at all**, so the zero case never meets the new word. Older note, unchanged: **amended, product 2026-09-10 (M5.15)** — product wrote one window sentence and the picker has four windows. `Started the week` on `Last month` names the wrong calendar, and every other window string on this page (the empty lines, the slot's ranges) already says `week` or `month` per kind, so the noun is interpolated off `WindowKind` and there is no fifth string. Nothing prints in an empty window because the chart's reference falls back to the player's **seed** there, and `Started the week at <seed>` would name a number that week never saw — the window's own empty sentence is already on the page and is the true one |
| a recent game, the chance its side was given | `As the 58% side.` · `As the 42% side.` — and **no line at all** when the game has no stored chance | **amended, product 2026-09-10 (M5.15, the lead after the designer's review)** — was `Won as the 42% side, +43`, which said everything twice: the row head already reads `Lost … 1392 (−42)`, so the sentence beside it repeated the result and re-spelled the delta. What the head cannot say is the only thing left in the line. **It ends in a full stop**: it is a caption, not a label, and every other line of prose on this page closes the same way — a fragment in `dim` with no stop under a row of numbers reads as text that got cut off. The percentage is still **their own side's**, `Math.round(p × 100)` |
| ~~a recent game with no stored chance~~ | ~~`Won, +43` / `Lost, −31`~~ | **deleted, product 2026-09-10 (M5.15, the lead)** — with the result and the delta gone from the sentence there is nothing left of this form but the row head repeated, so a backfilled game, a game whose lobby row was cleared and a game played without the bot print the head alone. No placeholder, no `—`, and the row is still never hidden. **The Discord embeds are untouched** and keep U+2212 out of their own numbers exactly as they do today; this line lives on one page |
| the one explanation line under `Recent games` | `Beating the favoured side moves you more than beating the underdog, and the board moves you more while it is still unsure about you.` | **new**, product 2026-09-10 (M5.15) — once per page, not per row. **Its `you` stands, and M3.26 does not touch it** (product, 2026-09-10): it states the rule of the game, which is true of whoever is reading, and it points at no number on the screen — the defect M3.26 fixes was `your rating` naming a figure that belongs to the person whose page it is. Same reading for the nightly embed's short form, which is addressed to a channel where every reader is a player |
| games cannot be saved, admin and API | `Games cannot be saved: the database is missing its one season row.` | **amended, product 2026-09-10 (M5.14)** — was `… Start a season on the Seasons page.`; there is no such page action now |
| games are not being saved, tonight page | `Tonight's games are not being saved. Play on — they can be added back from match history later.` | **amended, product 2026-09-10 (M5.14)** — was `An admin can start one.`; backfill is true, and it is the only thing the twenty people holding the link can act on |
| inferred roles on `/admin/players` (plain page, no dress) | `support · jungle · from 17 games` · `flexible · from 2 games` · `flexible · no games yet` | **new**, product 2026-09-10 (M5.17) — read-only text where two selects used to be |
| award badge on a `/leaderboard` row, `Last week` and `Last month` only | `Most improved` · `Best off-role` · `Cursed duo` | **no new string, designer 2026-09-15 (M8.3)** — placement only. The three are **imported from `lib/stats/copy.ts`** (`MOST_IMPROVED`, `BEST_OFF_ROLE`, `CURSED_DUO`), never retyped and never re-cased, for the reason that file's own header gives: they are printed on a page *and* in a Discord post, and one surface saying `Cursed duo` while another says `Worst duo` is a bug nobody finds until somebody wins it. This is the second board-page string that lives in `lib/stats/copy.ts` rather than `lib/board/copy.ts`, and it stays there — a copy of an award's title in the board's own file is the drift this row exists to prevent. The badge is the title **alone**: no count, no delta, no partner name, no `#1`, no calendar — `/p/[puuid]`'s `Most improved, September.` carries the calendar because that page has no window heading, and `/leaderboard`'s `h1` already names the window. Nothing is drawn on `This week`, `This month` or `All time`. See "The award badge on a board row" |
| result embed, the MVP / ACE line (its own last field) | `MVP Lena · ACE Rami` — and **no line and no field at all** for a game with no award | **new, product 2026-09-15 (M7.10)** — two names, a middle dot, and nothing else: no score, no percentage, no emoji, no trophy, no colour and no `#1` (acceptance 6). The score behind the pick is a number a reader can do nothing with and one more thing that can disagree with the post; the names are the whole point. **The MVP is named first because the winning side is.** Both words are upper case — they are op.gg's terms and this group reads them there every day, so never `Mvp`, never `mvp`. Names go through the same `renderName` as every other embed line, so a nameless player is `Someone` and a long Riot ID is truncated at 32 characters and escaped identically. Nothing prints for the other eight and no post says "nearly MVP". `MVP_LABEL` / `ACE_LABEL` / `awardLine` in `lib/discord/embeds.ts`, pinned by code point in `embeds.test.ts`; the field itself is specified in "Result embed" below |
| a recent game on `/p/[puuid]`, when the reader's page owns the award | `MVP` · `ACE`, beside the delta the row already prints — `1512 (+43) MVP` | **new, product 2026-09-15 (M7.10)** — the word, and nothing around it: **not a badge, not an icon, not a colour of its own**, no trophy, no gold, no `#1`. It is the delta's own size (`--cn-t-sm`) and the row's own `--cn-text`, so it reads as part of the same sentence as the number it follows, which is what it is. Floodlit has no award colour and this is not the place to invent one. **One of two words or nothing**: absent for the other eight players of that game, absent for every game with no award, and absent on a `not rated` row — the same reason no page says "nearly MVP". Same two constants as the embed's labels, a second pair in `lib/board/copy.ts` (`MVP_LABEL`, `ACE_LABEL`); the dress is `.cn-game-award` |
| the explanation line under `Recent games`, second sentence | `The best player on the winning side keeps a little more of what they gained, and the best player on the losing side gives a little less back.` | **new, product 2026-09-15 (M7.10)** — it joins the row above **in the same paragraph**, directly after it, not as a second `.cn-explain` block: the reader's question is one question ("why is this number the size it is") and the answer is now two sentences long. **It is about the model, not about a game**, so it prints on every player's page whether or not they have ever been either one — the same rule that makes M5.15's sentence once-per-page rather than once-per-row, and the reason a game with no award still leaves it standing. No maths, no percentage, no formula, no `1.25×`, and **neither word is capitalised into it**: this sentence names the positions, the two labels above name the players. `MVP_EXPLANATION` in `lib/board/copy.ts` |

**Why the three new ones stand.**

- **`No games this season yet.`** is the same shape as the tonight page's `Nobody in the lobby yet.` — the
  fact, in five words, with nothing to tap. It is true in both of the places it renders: under the heading of
  a season nobody has played yet, above the rank-seeded rows that all read `0 games`; and on a player page
  where the chart would be, about that player. One sentence for both is deliberate — a second, longer one
  ("You have not played yet this season") would be a third empty-state voice on a product that has two.
- **`No season is active, so there is no board yet. An admin can start one.`** is built like M3.17's tonight
  sentence — the fact, then who can fix it, nothing to tap — because the two pages are read by the same
  twenty people from the same WhatsApp link. It is a third constant, not a reuse: `NO_ACTIVE_SEASON_MESSAGE`
  ends by naming a page nineteen of them cannot open, and the tonight sentence is about tonight's games not
  being saved, which is not what an empty board is about. Same fact, three readers, three sentences, and none
  of the three may be edited into another.
- **`Won` / `Lost`** is this player's own result, because the page is about them: `Red wins` beside their own
  delta makes a reader work out which side they were on before they can read their own row. Past tense, not
  the `13W 15L` letters, because the line is one game that happened, not a tally.

**And why `standings` became `Leaderboard`** (designer, 2026-09-09, from the rendered pages). One destination
had three names on it: the route and the Floodlit nav tab said `Leaderboard`, the page heading and the back
link said `standings`, and the embed title said `standings` again. `Leaderboard` wins all three, because it is
already product-approved friend-facing copy — it is the nav tab in the table above this one, and it is the
noun inside a shipped sentence this redesign may not rewrite (`Ratings are updated. The leaderboard has the
rest.`). `standings` was invented by this document's own embed section and is in no other surface's
vocabulary. This is the same rule that turned `Get the app` into `Companion ↗`: one thing, one name.

The board's numbers keep the names `00-product.md` gives them ("The numbers on the screen") and no surface
invents a third. `Won` and `Lost` are the only strings in this table that do not live in
`apps/web/lib/board/copy.ts` today — they are two module constants in `app/_board/PlayerView.tsx`, and the
next engineer to touch that file moves them, so this table has one code half and not two.

#### Copy — `/stats`, the strings the brief did not write (M5.4, product 2026-09-10)

The M5.4 brief fixed every number on this page and most of its words: the awards, the cap line, the no-role
footnote, the two group lines and the section intros are in the table above or in the brief itself, and the
window's own words — the five labels, the slot, the five empty sentences — are the board's and are imported,
never retyped. They live as one constant each in `apps/web/lib/stats/copy.ts`, which is the code half of this
table exactly as `lib/board/copy.ts` is the code half of the one above it, and the two may not drift: the
awards are printed on a page **and** in a Discord post, and one of them saying `Cursed duo` while the other
said `Worst duo` is a bug nobody would find until somebody won it.

What is below is the remainder: the seven strings the web engineer wrote because the brief asked for the line
and not the words, one pronoun the database cannot know, and one line the brief wrote only in the plural.
**Of the seven, five keep and two are replaced.** A kept string is
product's now — it is not "the engineer's, tolerated" — and the `(engineer)` markers in `copy.ts` come out
with the next touch of that file.

| Where | String | Ruling |
|---|---|---|
| the window's third fact, with the two group statements | `12 players played.` — `1 player played.` at one, and **no line at all** in a window with no games | **keep, product 2026-09-10 (M5.4)** — the brief's page order asks the header for "counted games, players who played" and the slot (`September · 34 games`) is fixed byte for byte by M5.10's post, so the players number needs its own sentence and this is the plainest true one. `players` is the app's noun for these twenty people everywhere else on the page (`Players with no main role are not in this one`); `people` would be a second noun for one thing. The singular is the same rule `gamesLabel` follows, and the zero case never renders, because an empty window prints its own sentence in the slot and draws no card |
| a role block with nobody over the minimum | `Nobody has 5 games on jungle yet.` — the role in the app's own lowercase word, so `adc` and `mid` read as they do in every other line; the `5` interpolated from the same constant the list filters on | **keep, product 2026-09-10 (M5.4)** — the empty-state voice this product already has: the fact, in six words, with nothing to tap (`Nobody in the lobby yet.`, `No games this week yet.`). It names the role rather than saying `here` because the five blocks are read as one column on a phone and a quiet block one thumb-length below its heading has to say what it is quiet about. `yet` is right: it is a running count, and the brief's own quiet-week rule is that no threshold moves to make the page look full |
| duos, nothing qualifies | `No pair has 5 games together yet.` | **keep, product 2026-09-10 (M5.4)** — same shape, and it is deliberately the award's noun (`No pair played 4 games together this week.`) with the browsing table's number in it, so a reader who meets both lines on one page reads one rule at two bars and not two rules |
| streaks, the two the window holds | `Longest win streak` · `Longest losing streak` | **keep, product 2026-09-10 (M5.4)** — product's own words out of the brief ("longest win streak and longest losing streak of the season, per player, and on `/stats` the group's best and worst with the holder's name"), promoted to labels in the sentence case the page's other sections use (`Best together`, `By role`). `losing`, not `loss`: it is the streak a person is on, not a column head |
| streaks, the third block | ~~`On a run now`~~ → `On a streak now` | **replaced, product 2026-09-10 (M5.4)** — see below |
| streaks, nobody qualifies | ~~`Nobody is on a run of three or more.`~~ → `Nobody is on a streak of 3 or more.` | **replaced, product 2026-09-10 (M5.4)** — see below |
| best off-role, the winner line | `Omar · 9W 3L · 75% · their main is top` | **keep, product 2026-09-10 (M5.4), and this row supersedes the brief's `his main is top`** — the database holds a PUUID, a name a player can change between two page loads, and no pronoun; `his` is a fact this product does not have about nineteen of the twenty people it prints. `their` is the pronoun the board pages already settled on for the same reason (M3.26's `how unsure the board still is about them`). **Acceptance check 7 of M5.4 reads this row for this line**, not the brief's sentence. Decision row: `04-decisions.md`, 2026-09-10 |
| the no-role footnote, at one game | `1 game is not in the role numbers — the client did not record who played where. Backfilled games never do.` | **keep, product 2026-09-10 (M5.4)** — the brief wrote the plural only. The count goes through `gamesLabel` like every other count on these pages and the verb follows it, so the one-game night does not read `1 games are`. Everything after the dash is product's, unchanged |

**Why the two replacements stand.**

- **`On a streak now`, not `On a run now`.** The section is `Streaks`, the two labels above it are
  `Longest win streak` and `Longest losing streak`, the leaderboard row prints `W3`, and the M5.4 brief calls
  it a streak throughout. `run` is a second noun for the thing the page has already named three times in the
  same card — the rule that turned `standings` into `Leaderboard`: one thing, one name. It is also the warmer
  word by accident only: in English "on a run" leans to a winning one, and this block lists `L4` beside `W3`
  with no comment, which is the point of it.
- **`Nobody is on a streak of 3 or more.`** Same noun, and the digit because the number is a module constant
  the block is filtered on — spelled out in the sentence it can drift from the list above it, and the page's
  other two "not enough yet" lines already print their minimum as a digit (`5 games`). The tonight page's
  `One more to go.` is not the precedent here: that word exists because the digit is already set 44px above
  it, and nothing on this page prints this 3 but the `W3` chips the sentence is about.

**The per-player sections on `/p/[puuid]` (M5.20) are not in this table.** Their empty lines and section
labels are unwritten copy, and they came to product before they shipped, like these did: they are the table
below, ruled 2026-09-11, and the two rows of this page's own copy that ruling amends are in it too.

#### Copy — the per-player sections on `/p/[puuid]` (M5.20, product 2026-09-11)

The table above ends by saying these strings were not in it and would come to product before they shipped.
This is that table. M5.20 is a rendering task, so most of what these sections say is imported and never
re-worded — the window's five labels and five empty sentences, `By role`, `Streaks`, `Best together`,
`Worst together`, `Longest win streak`, `Longest losing streak`, the cap line, `13W 15L`, `71%`, `W3`. Eight
strings were left for product. **Seven keep and one is replaced.** They live as one constant each in
`apps/web/lib/stats/copy.ts` under its own heading and never in `PlayerStats.tsx`, so this table has one code
half like the two above it; a kept string is product's now — it is not "the engineer's, tolerated" — and the
`(engineer, for product)` markers in `copy.ts` come out with the next touch of that file.

| Where | String | Ruling |
|---|---|---|
| the card under `By role` | `By side` | **keep, product 2026-09-11 (M5.20)** — `By role` is a shipped, product-approved section name on this page and this is its twin: a preposition and the thing, so the two cards read as a pair and M5.8's card-title rule covers both without a new shape. The alternatives were a noun this product uses nowhere (`Side record`) or no card at all — and no card is not available, because the group's blue rate is `/stats`'s headline and is deliberately not repeated here, so this is the one place in the product where a side is a record rather than a team |
| the two rows of that card | ~~`blue` / `red`~~ → `Blue` / `Red` | **replaced, product 2026-09-11 (M5.20)** — see below |
| the card of the three best and three worst | `Partners` | **keep, product 2026-09-11 (M5.20)** — it is product's own noun for this list, out of the M5.4 brief (*"`/p/[puuid]` shows that player's three best and three worst partners"*), and it names a different object from `/stats`'s `Duos`: a row there is a pair (`Yuki and Theo`), a row here is one other person, read from the page owner's side of it. `Duos` over a column of single names would be the page asking the reader to do the subtraction. One thing, one name is not broken by two things having two names — and the two lists inside the card keep the pair page's own labels, `Best together` and `Worst together`, which are true of a partner as well as of a pair |
| partners, nobody over the minimum | `Nobody has 5 games with them yet.` | **keep, product 2026-09-11 (M5.20)** — the page's other "not enough yet" lines in one shape: `Nobody has 5 games on jungle yet.` with the role swapped for the person, the `5` interpolated from the same constant the list filters on so the sentence and the bar cannot drift, and `yet` because it is a running count. **`them` is this page's pronoun and not a slip**: M3.26 settled that a player page is about somebody who is usually not the reader, and the third person makes one string true on your own page and on Yuki's |
| the first row of `Streaks` | `Current streak` | **keep, product 2026-09-11 (M5.20)** — product's own words out of the brief (*"**Current streak**: the run ending at their most recent counted game, printed `W3` / `L2`"*), promoted to a label beside `Longest win streak` and `Longest losing streak` exactly as those two were, in the same sentence case. It does not collide with `/stats`'s `On a streak now`: that block is the list of everyone on three or more and needs a bar to exist, this row is one person's run and prints `W1` as readily as `W8`, so a shared string would be false on one of the two pages |
| average game length, per player | `Average game 32 min.` | **keep, product 2026-09-11 (M5.20)** — the group's sentence with its count dropped and a stop in its place, which is this page's settled rule twice over: the meta line gives its games count up to M5.15's seed line, and the window slot prints its range half alone here, both because no page says one number twice. Whenever this line is drawn the player has a counted game in the window, so the seed line above it is already printing `, 37 rated games since.` (M7.22) and the count is on the page exactly once. **Never `0 min` and never `NaN`** — with no counted game the whole band is undrawn. **After ruling (a) below this is the same string as the group's**, so one function serves both pages and there is no second constant to drift from it |
| an award won, all three of them | `Most improved, week of 6 Sep.` · `Best off-role, September.` · `Cursed duo, September.` | **keep, product 2026-09-11 (M5.20), and the board table's `an award on /p/[puuid]` row is amended to match** — the brief wrote the form once and with one award in it, but wrote it about *"a player who won **an award**"*, so the generalisation is the brief's own sentence read whole. The label is interpolated from the award's own constant (`MOST_IMPROVED`, `BEST_OFF_ROLE`, `CURSED_DUO`), which is what stops this page saying `Best off role` while `/stats` and the weekly post say `Best off-role`. A cursed-duo line prints on both halves' pages and names neither the partner nor the record on purpose: the award's full line, with the pair and the numbers in it, is on `/stats` and in the post, and this line's whole job is to say which award and which calendar. No badge, no icon, unchanged |
| the no-role footnote, per player | `3 games are not in the role numbers — the client did not record who played where. Backfilled games never do.` — reused byte for byte, with this player's own count | **keep, product 2026-09-11 (M5.20)** — the M5.20 brief asked whether a per-player form was owed and the answer is no. Under a card that is already this player's numbers, a count with no possessive reads as theirs exactly as `13W 15L` does, and a second sentence for one fact is a second sentence to keep in step with the first: `gamesLabel`, the verb that follows it (`1 game is`), and everything after the dash, which is product's and unchanged. A player whose games are all backfilled gets this line as the whole of the card, and that is right — it is a sentence saying why there are no rows, not a card that failed to load |

**Why `Blue` and `Red`, not `blue` and `red`.** Every side this product prints to a friend is capitalised: the
teams embed's `Blue · 7695`, the result embed's `Blue`, `Blue was favored 54%.`, the team card's header, and
`/stats`'s own `Blue wins 69% of the time.` one tab away. Roles are lower case in *every* surface, Discord
included — `top` is the word's form and not a list convention — so taking the case off the role rows instead of
off the word gives one thing two names on two adjacent pages, which is the defect that turned `standings` into
`Leaderboard`. The reading that these are "the subject of a data row" is the right instinct applied to the
wrong word: what makes `top` lower case is that it is `top` everywhere, and what makes this `Blue` is that it
is `Blue` everywhere. The consequence for the dress is an existing rule and not a new one — a side is a name
read as language, so Archivo like the names in every other list, and the mono lower-case exception stays the
roles' alone.

**The two questions the designer parked on the M5.20 row (2026-09-10), ruled.**

**(a) The count comes out of both group statements on `/stats`.** All three of those numbers are the same
number by construction — the slot, `Blue wins …` and `Average game …` are all `countedGames`' length, passed
from one field — so the two `· 32 games` halves are not a second fact, not a denominator and not a caveat.
They are the slot retyped, twice, a few lines under it. This document has already refused exactly this on the
other page twice (the meta line's count beside the seed line's; the window slot's count beside it), and it is
refused here at three. Were the statements ever folded over a smaller universe than the slot's — games with a
stored duration, say — the count would be load-bearing and would stay; they are not, and the day one of them
is, it prints its own denominator again and this row is amended.

| Where | String | Ruling |
|---|---|---|
| `/stats`, the group's side rate | ~~`Blue wins 69% of the time · 32 games`~~ → `Blue wins 69% of the time.` | **amended, product 2026-09-11 (M5.20's copy questions)** — supersedes the M5.4 brief's *"printed with the count"* for this line. The full stop arrives with the count's departure: the trailing ` · 32 games` is what made this a legend rather than a sentence, and the card's third line has been a stopped sentence since M5.4 (`12 players played.`) |
| `/stats`, the group's average game | ~~`Average game 35 min · 32 games`~~ → `Average game 35 min.` | **amended, product 2026-09-11 (M5.20's copy questions)** — same ruling, same stop; it is now byte for byte the per-player line above, one function on two pages, which is the answer to "why does the group's average say `· 32 games` and mine does not" being that neither does |

The card becomes three parallel stopped sentences — `Blue wins 69% of the time.` / `Average game 35 min.` /
`12 players played.` — which is what M5.8 drew it as. **Nothing else moves.** The slot keeps
`SEPTEMBER · 32 GAMES` byte for byte, because M5.10's weekly post is that same string; the cap line is
untouched; no number changes. **The code half is not M5.20's**, whose out-of-scope forbids touching `/stats`,
so it ships as its own task with the two call sites, the two signatures and `StatsView`'s tests in it.

**(b) An empty window says its sentence and nothing else.** Silence is right, and the reason is that the page
is not silent: the picker is on the screen, above the sentence, five links with the chosen one marked, and it
is the same control on a full window and an empty one. A line that appears only when the page is empty is a
second navigation that exists only in the failure state, and it would name windows the reader can already see
and tap. It would also have to know something this page did not read — the nearest window with games is four
more reads or one unbounded one, on the single page whose read is already capped — and `All time` settles it:
a group with no games at all has no nearer window to point at, so the pointer's own fallback is silence, on
exactly the screen it was proposed to rescue. A line that is right on some windows and absent on the rest is
worse than a page that behaves the same way five times. **The empty sentence and the picker are the whole
answer**, which is what the board pages already do and what M5.8 drew for this one. If the group ever wants a
"take me to the last week we played" control it is a feature with a decision row, not a copy fix.

### `/stats` — the window's page (M5.8, designer 2026-09-10)

Four cards down one 44rem column, no rail, nothing to press, opened at work on a Sunday morning rather than in
a dark room at 21:00. M5.4's plain layout is the right skeleton and this changes six things about it. Every one
of them is a recipe this product already ships; none is a new token, and no product string moves, splits or
re-orders.

**1. Two heading levels, and no third.**

- **Card title**, in the card's `raise` header bar: Archivo `t-sm` 600 `text` — `.cn-board-title`, the shell's
  card-title rule. `Awards`, `By role`, `Duos`, `Streaks`.
- **Group label**, opening a block inside a card: Archivo `t-sm` 600 `dim` — `Best together`,
  `Worst together`, `On a streak now`, `Longest win streak`, `Longest losing streak`. Roles are the exception
  they always are: mono, lower case, icon at **16px** and word, unchanged.

The M5.4 build has this upside down — `.cn-list-title` is mono `t-xs` `dim`, so a card's own name is the
quietest text inside it and the sub-head is the loudest. Mono micro-labels on this page are legends and data
(`10W 8L · 56%`, `W10`, `top`), never the name of a section. `/p/[puuid]`'s `By role` and `Recent games` take
the same swap: two pages, one rule.

**2. The awards card is the page's headline, and it is drawn only when there are awards.**

- **Closed window.** Label Archivo `t-sm` 600 `dim`; the winner line `t-lg` 600 `text`; the "nobody qualifies"
  line stays `t-base` `dim`; the rule and the no-main-role note drop to `t-xs` `dim`. The winner line is **the
  biggest language in the product outside a result headline** — three of them, and the name leads each one, so
  size alone makes the person the headline. It wraps to two lines at 390 on the longest award and that is fine:
  a statement wraps, a table does not.
- **The line is one string.** `Sara · +153 · 1314 → 1467` comes from `lib/stats/copy.ts` and the same string
  goes in the weekly Discord post. It is never split into cells, never re-set in mono, never re-ordered. The
  number-in-a-sentence rule applies: it is all Archivo.
- **The card takes the winner's ring** — `border-color: var(--cn-brand)`, the identical mark and meaning as the
  result's winning team card (`.cn-team-won`) — **and only when at least one of the three was won.** Three
  "nobody qualifies" sentences behind an amber border is a lie. This ring and the chosen window chip are the
  page's only amber; that is the one-lamp rule holding on a page with no live state.
- **Running window: no card.** `Awards are handed out when the month ends.` is a `.cn-hint` in the header
  strip, under the slot line. A bordered card holding one 14px grey line is the 449px-of-empty-card failure in
  miniature, and on `This month` — the default — it is the first thing anybody sees.
- **`All time`: nothing at all**, unchanged.

**3. The group's three statements get a body.** The blue win rate, the average game and `12 players played.` go
in one card: `surface`, 1px `line`, `lit`, **no header bar**, `sp-3` padding, `t-base` `text`, `sp-2` between
lines. Three sentences alone on the ink between two cards read as something that failed to load. (One sentence
does not need a card — the tonight page's sit-out strip is one sentence in one. Three orphans do.)

**4. A streak is a row, not a sentence.** `Longest win streak W10 Nadia` reads label-number-name and parses as a
person called W10. The two longest become blocks in the shape the third already has:

```
Streaks
  Longest win streak
  Nadia                              W10
  Longest losing streak
  Rami                                L6
  On a streak now
  Deniz                               W8
```

Group label, then one row per holder, name left, streak right in mono — a tie prints two rows with the same
number, which is also how the page says "they are tied" without a word for it.

**5. The rank column stays.** Mono `t-xs` `dim`, 1.5rem, restarting at 1 in every role block, **never `brand`**:
rank 1 here is not the top of the board and must not borrow the board's mark. Without the column a five-name
list is a set rather than a ranking, and which of the five is the best jungler this month is the argument this
page exists to start.

**6. An empty window is one sentence in the header slot, and nothing is drawn under it.** *(Rewritten
2026-09-11, after M5.23 built it; the first version put the sentence in the body at `t-base` in `text` and
took the hairline off, and both halves are now false.)* The window's own empty sentence sits where the range and
count would be — Archivo `t-base` `dim`, in the slot — which is where `/leaderboard` and `/p/[puuid]` have
always put it, so the one control that changes all three pages is answered in the same place on all three.
**The strip keeps its hairline on every window**: the rule closes a header, it does not promise a card, and an
edge that vanishes on one of five taps reads as a page that half-loaded. Under it `/stats` draws **nothing at
all** — no awards card, no group statements, no role blocks, no duos, no streaks. A bordered card with a
legend and nothing in it is the strongest "this page broke" signal the shell can produce, and it would be
drawn on the one screen with the least to say.

**What does not change:** the 44rem column with no rail (this page has nothing per-night to put in one), the
picker and its slot, the order down the page, the 44px rows, and every word.

### Share cards — Open Graph images (M11, designer 2026-09-23)

1200 × 630 PNGs for WhatsApp and Discord unfurls. They are Floodlit painted into a picture: the same ink, the
same one light and the same two faces. Nothing that reached a picture is also allowed back onto the site.

**Always Night.** An unfurl has no theme preference and no `data-theme`, and Night is the default. There is no
Day card.

**The palette is fixed hex, because `ImageResponse` has no CSS variables and no `color-mix()`.** The card uses
**the shipped Night values in `tokens.css` `[data-theme="night"]`**, not the Floodlit table above. As of
2026-09-23 the two have drifted (`bg` `#05070C` against `#0B0E14`, `brand` `#FFC857` against `#FFB13C`, and
others), and the lead has to settle which one is the record. Until then, the unfurl matches the page the tap
opens. Keep them
in one constants file (`app/_og/palette.ts`) whose header comment names `tokens.css` as the source. If the
Night tokens change, this file changes in the same commit.

| Card token | Hex | Use |
|---|---|---|
| `bg` | `#05070C` | Fill, the whole card |
| `line` | `#2A3344` | The one hairline, the losing side's rule |
| `text` | `#F4F7FC` | Names, headline, the player number |
| `dim` | `#7D8A9E` | Slug, duration, sentence, labels. Never a name. |
| `blue` | `#4EA3FF` | Side 100: the winner word, the side label, the winner's rule |
| `red` | `#FF6F68` | Side 200: the same |
| `brand` | `#FFC857` | **The wordmark bar only.** No live state exists in a PNG. |

No `surface`, no `raise` and no cards inside the card. The picture is one plane of ink.

**The one light.** A single amber radial at the top, the shell's floodlight at the same 5%, in pixels:

```
radial-gradient(ellipse 1440px 441px at 600px -95px, rgba(255,200,87,0.05), rgba(255,200,87,0) 65%)
```

Fade to the same amber at zero alpha, not to `transparent`: some renderers interpolate through black and draw
a grey band. Shipped Night's second lamp (a blue corner radial) and the pitch grid are **not** painted. A
blue wash in the corner of a `RED WINS` card is the page taking a side. If the renderer bands or cannot draw
the ellipse, drop the light entirely. Flat ink is correct and a banded gradient is not.

**Type.** `ImageResponse` (Satori) cannot read a variable font's `wdth` axis and does not take `woff2`. Commit
static TTFs from Google Fonts (OFL, with `OFL.txt` beside them) under `app/_og/fonts/` and load them from disk.
**Never fetch fonts from Google at render time**: an unfurl bot that times out on a font request gets no card.

| Card role | Face | Size at 1200px | Notes |
|---|---|---|---|
| `og-display` | Archivo **Expanded ExtraBold** (static, `wdth` 125, the shipped Night display cut) | 112px, line height 1.0, `-0.02em`, UPPER | Winner word and tonight headline. Fallback: Archivo ExtraBold at normal width. That is the system's own stated fallback, and there is still no second family. |
| `og-mark` | Archivo Expanded ExtraBold | 28px, `0.14em`, UPPER, `text` | `KUSTOM`, after a 6 × 28px `brand` bar, gap 12px. No glow on the bar. |
| `og-side` | Archivo Expanded ExtraBold | 28px, `0.12em`, UPPER, side colour | `BLUE` / `RED` over each column |
| `og-name` | Archivo SemiBold | 34px, `text` | One line. Ellipsis past the column. Never wrap a name. |
| `og-sentence` | Archivo Medium | 36px, `dim`, line height 1.3 | At most two lines |
| `og-slug` | IBM Plex Mono Medium | 20px, `0.08em`, UPPER, `dim` | The night's date, the same string as the strip's slug |
| `og-num` | IBM Plex Mono Medium | 32px, `dim`, tabular | Duration |
| `og-stat` | IBM Plex Mono SemiBold | 160px, `text`, tabular | The player card's one number |
| `og-label` | IBM Plex Mono Medium | 24px, `0.08em`, lower case, `dim` | The label under that number, the page's own word |

An unfurl is drawn at about a third of its size on a phone. So nothing that must be read goes below 28px
(which becomes about 9px on screen). The slug and the wordmark are identifiers and may be 20–28px.

**The frame, shared by every card.**

```
48px safe inset on all four sides. Content box x 48–1152, y 48–582.

y 48   ▍KUSTOM                                        TUESDAY 22 SEPTEMBER
y 104  ─────────────────────────────────────────────────────────────────   2px line, full content width
y 112–582  the body, vertically centred in this band
```

**The centre third is sacred.** WhatsApp crops the preview to a centred square (x 285–915) in several of its
layouts, and Discord scales the whole card to about 400px wide. **The words that carry the card sit inside
x 400–800**: the winner word, the tonight headline and the player number. Everything else may be cropped
away without the card lying.

**Game card** (`/g/[gameId]`, a finished game):

```
┌──────────────────────────────────────────────────────────────────────┐
│ ▍KUSTOM                                        TUESDAY 22 SEPTEMBER  │
│ ──────────────────────────────────────────────────────────────────── │
│                                                                      │
│ ▏ BLUE                       RED                             RED █   │   side labels, side colour
│ ▏ Hana                       WINS                           Omar █   │   winner word 2 lines, red
│ ▏ Yusuf                                                     Lena █   │
│ ▏ Karim                      34:12                         Salma █   │   duration og-num dim
│ ▏ Mo                                                       Tarek █   │
│ ▏ Nour                                                      Dina █   │
│   ▏ loser: 2px line                         winner: 8px red █        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
 x 48–400 blue five     x 400–800 the verdict     x 800–1152 red five
```

- **Three columns.** Blue on the left, left-aligned. Red on the right, **right-aligned and mirrored**, so the
  picture is symmetric around the verdict. This is the one place the mirror is allowed, because a poster
  reads from the middle out and a page reads from the start edge.
- Each side column carries a rule on its **outer** edge. The **winner's rule is 8px in its side colour**
  and the **loser's rule is 2px `line`**. That is the site's 4px-versus-1px at poster scale, and it is the
  whole celebration. Names start 24px in from the rule.
- Side label (`og-side`), a 24px gap, then five names (`og-name`) on a 56px pitch, in lane order `top`
  through `support`. **No role words** (the card is read at a third of its size and five mono labels are
  noise), no ratings, no deltas, no champion.
- **The verdict:** `BLUE` / `WINS` or `RED` / `WINS` on **two lines**, centred, in the winner's colour at
  `og-display`. Then a 24px gap and the duration (`og-num`) centred. At 112px the word `WINS` in the wide
  cut must fit 360px. If the fallback face or a longer word ever breaks that, step the size down to a 96px
  floor. Never fit the width by condensing.
- Names in `text` on **both** sides. `dim` is never a player's name, including the losers' names.
- An **underdog sentence** does not go on the card. It belongs on the page, where it is a sentence with a
  context.

**Tonight card** (`/`):

- Body: the strip's **headline** (`og-display`, `text`, centred, max-width 720px so it breaks onto two
  lines, for example `9 IN THE` / `LOBBY`), then a 24px gap, then the strip's **sentence** (`og-sentence`,
  centred, max-width 880px). Not a screenshot, not the rack, not ten names.
- **The count is `text`, not `brand`.** On the site the count is amber because it is live. A PNG is a
  photograph of a moment that the unfurl cache will keep showing after it stops being true, and a stale
  number must not wear the live colour. No live pill, no dot.
- Idle night: `NOTHING TONIGHT` and the idle sentence. That is fine, and it is honest.

**Player card** (`/p/[puuid]`):

- Body, centred: the player's name (`og-name` scaled to 72px Archivo SemiBold, one line, ellipsis at
  1000px), a 16px gap, **the one all-time number the page leads with** (`og-stat`, `text`), then the
  page's own label for it under it (`og-label`). Nothing else: no record, no chart, no rank, no avatar.
- The number is never coloured and never signed unless the page signs it.

**Every other route:** the frame with the wordmark alone, centred, at 56px with a 10 × 56px bar. It has no
slug, because the route is not about a night.

**Never on a card:** champion icons, emoji, QR codes, a URL or a `kustom…` domain line, avatars, rank
emblems, crests, `VS`, trophies, a second gradient, a drop shadow, a border around the whole card or a
rounded card inside the card. The small wordmark is the only identity.

**Alt text** (`alt` export per route) is a sentence, and product writes it in the M11 copy table. The
layout above uses no new chrome words. Every string on a card is one the page already prints.

### `tokens.css`, v2 — the file to write

```css
:root {
  color-scheme: dark light;

  --cn-bg: #0b0e14;
  --cn-surface: #141923;
  --cn-raise: #1d2431;
  --cn-line: #2a3140;
  --cn-text: #eef2f8;
  --cn-dim: #94a0b2;
  --cn-blue: #4c9aff;
  --cn-red: #ff6b63;
  --cn-brand: #ffb13c;

  --cn-blue-tint: color-mix(in srgb, var(--cn-blue) 10%, var(--cn-surface));
  --cn-red-tint: color-mix(in srgb, var(--cn-red) 10%, var(--cn-surface));
  --cn-brand-tint: color-mix(in srgb, var(--cn-brand) 12%, var(--cn-surface));
  --cn-blue-line: color-mix(in srgb, var(--cn-blue) 55%, var(--cn-line));
  --cn-red-line: color-mix(in srgb, var(--cn-red) 55%, var(--cn-line));
  --cn-pressed: color-mix(in srgb, var(--cn-text) 8%, var(--cn-raise));
  --cn-lit: inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
  --cn-glow: 0 0 0 4px color-mix(in srgb, var(--cn-brand) 14%, transparent);

  --cn-sp-1: 0.25rem; --cn-sp-2: 0.5rem; --cn-sp-3: 0.75rem; --cn-sp-4: 1rem;
  --cn-sp-5: 1.5rem;  --cn-sp-6: 2rem;   --cn-sp-7: 3rem;    --cn-sp-8: 4rem;

  --cn-t-xs: 0.75rem;   --cn-t-sm: 0.875rem; --cn-t-base: 1.0625rem;
  --cn-t-md: 1.1875rem; --cn-t-lg: 1.5rem;   --cn-t-xl: 2rem;
  --cn-t-display: 2.75rem;

  --cn-radius: 10px;
  --cn-radius-row: 8px;
  --cn-radius-chip: 4px;

  --cn-font-sans: var(--cn-font-archivo), "Helvetica Neue", Arial, system-ui, sans-serif;
  --cn-font-mono: var(--cn-font-plex-mono), ui-monospace, "SF Mono", Menlo, monospace;
}

@media (prefers-color-scheme: light) {
  :root {
    --cn-bg: #eef1f6;
    --cn-surface: #ffffff;
    --cn-raise: #dae2ed;
    --cn-line: #d5dce7;
    --cn-text: #10141b;
    --cn-dim: #556072;
    --cn-blue: #1f5fc4;
    --cn-red: #b4302b;
    --cn-brand: #8a5a0b;
    --cn-lit: inset 0 1px 0 color-mix(in srgb, #ffffff 70%, transparent);
  }
}

@media (min-width: 720px) {
  :root { --cn-t-lg: 1.625rem; --cn-t-xl: 2.25rem; --cn-t-display: 3.5rem; }
}

.cn-display {
  font-family: var(--cn-font-sans);
  font-variation-settings: "wdth" 118;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.02;
}

.cn-card {
  background: var(--cn-surface);
  border: 1px solid var(--cn-line);
  border-radius: var(--cn-radius);
  box-shadow: var(--cn-lit);
}

.cn-card-head {
  background: var(--cn-raise);
  border-bottom: 1px solid var(--cn-line);
  border-radius: var(--cn-radius) var(--cn-radius) 0 0;
}

/* One focus ring for the product. Keyboard only -- a thumb never sees it. */
:where(a, button, summary, input, select, [tabindex]):focus-visible {
  outline: 2px solid var(--cn-brand);
  outline-offset: 2px;
  border-radius: inherit;
}
```

**The focus ring is `brand`, 2px, offset 2px, and there is one of it** (designer 2026-09-10, from the M3.6
review, where the page first grew a cluster of targets: five role chips and up to eleven buttons). It is the
lamp again, on the one control the reader has moved to, so it needs no fifth colour; the offset keeps it off
the 1px `line` border it will usually sit next to, and `border-radius: inherit` stops a square ring around a
rounded chip. It is **not** the `glow` shadow — that belongs to the live pill and nothing else — and it is
`:focus-visible`, so it never appears under a thumb. `:where()` keeps specificity at zero, so any component
can override the ring's shape without fighting it. Until this rule lands, the new controls carry the
browser's own outline, which is a white hairline in one engine and a blue one in another and belongs to
neither theme. `admin.css` is not touched: the admin area keeps the browser's controls and the browser's
focus, for the reasons in "The admin area stays plain".

`.cn-num` and `.cn-sr` are unchanged from v1. `themeColor` in `app/layout.tsx` becomes `#0b0e14` / `#eef1f6`.
`admin.css` is **not** touched: it keeps `color-scheme: light dark`, `.admin { font-family: system-ui }` and
the browser's own controls, for the reasons in "The admin area stays plain".

### Implementation list — ranked by what a first-time visitor notices

Build order is not this order: item 4 is the foundation and lands first. This order is impact.

1. **The app shell.** New `apps/web/app/_shell/TopBar.tsx`, `Footer.tsx`, `HowThisWorks.tsx`, `lib/nav.ts`,
   `app/shell.css`; mounted in `app/layout.tsx` around `{children}`, with `/admin` opting out (it already
   scopes itself with `.admin`). Wordmark `▍KUSTOM`, tabs for routes that exist, footer links. This is
   the whole "what is this page and where else can I go" gap in one commit.
2. **The status strip.** `lib/tonight/state.ts`: `tonightHeader` returns `{ headline, count, sentence, live }`.
   `lib/tonight/types.ts` + `load.ts`: the snapshot gains `seasonName: string | null` (select `name` alongside
   `id` in `selectSeasonId`) and `nightLabel: string` (formatted server-side, fixed locale, configured
   timezone). `TonightView.tsx`: slug line, display headline, live pill, two-line-reserved sentence.
   `<h1>` becomes the wordmark in the shell, so the strip headline becomes a `<p>` — `TonightView.test.tsx`
   queries the heading and will need updating in the same commit.
3. **The seat rack.** New `app/_tonight/SeatRack.tsx` out of `MemberList`; ten rows always; `open` rows on
   `bg`; header `SEATS · n of 10` and the `rating` legend; fixed row grid; the all-flexible rule and its hint
   line. `tonight.css` for the rack; `rowHeight.test.ts` gains "ten `<li>` at every count" and keeps its
   44px arithmetic.
4. **Tokens and type.** `app/tokens.css` rewritten to the nine tokens, the derived values, `lit`/`glow`, the
   new scale and the `.cn-display` utility; `app/layout.tsx` adds `axes: ['wdth']` to the Archivo import and
   the `themeColor` values change to `#0b0e14` / `#eef1f6`. Every existing `--cn-accent` reference becomes
   `--cn-brand` (grep: `tonight.css`, `TonightView.tsx` has none, `admin.css` must **not** be touched).
5. **Cards.** The card recipe — `surface`, 1px `line`, `lit` inset, 10px radius, `raise` header bar — applied
   to the team cards, the sit-out strip, the explanation strip and the result card in `tonight.css`. The 4px
   side rule moves from `border-top` to the leading edge per breakpoint.
6. **Role icons.** New `app/_icons/RoleIcon.tsx`, five paths, used in the rack, both team cards and both
   result cards. `aria-hidden`, always beside the word.
7. **The result card.** Display headline in the winner's colour, `Top damage` pulled into the headline card,
   `brand` ring on the winner, 1px `line` on the loser. No content change: M3.16 stands.
8. **Desktop.** `shell.css`: 76rem shell, `≥720px` one column at 44rem, `≥1080px` `1fr / 20rem` grid with the
   rail. Rail cards: `How this works`, `Run the companion`, and `Top of the board` when M3.5 lands.
   `min-height: 100svh` on the shell and `margin-top: auto` on the footer, so the column has an end.
9. **Safe areas.** `env(safe-area-inset-top)` on the top bar and `-bottom` on the footer. The current page's
   16px top padding puts the count under a notch.
10. **The companion link points at the releases page**, `https://github.com/suyaser/kustom-releases/releases/latest`,
    not at `…/latest/download/Kustom.exe`. This page is opened on a phone.

### What to keep — do not rewrite these

The page is not wrong. It is under-dressed. The engineer should touch presentation and leave the machinery
alone:

- `lib/tonight/load.ts` — the loader, its anon-key reads, its rating derivation. It gains two fields
  (`seasonName`, `nightLabel`) and nothing else.
- `lib/tonight/state.ts`'s `tonightState` — the state machine and the `finished`-but-unrated fallback are
  correct and were argued for twice. Only `tonightHeader` grows.
- `TonightLive` and the Realtime path, including the nameless-name polling condition.
- `RerollControl` in full: the no-JS form fallback, the named split, the error sentences.
- Delta computation at render (`-0` does not survive JSON), `displayRating`, `formatDuration`, `formatDamage`,
  `favoredClause`, `renderWebName`, `joinWebNames`.
- Every settled string: the sit-out copy, the explanation verbatim rule, the no-season sentence, `No more
  splits. …`, the idle sentence, `Around`, `Nobody in the lobby yet.`, the nameless hint.
- The one-primary-block rule, the no-shift rule, the 44px floor, "no numbers in a proportional font", and the
  list under "What this design does not do" — with one amendment, recorded below.

**Amendment to "What this design does not do".** Two entries are relaxed by Floodlit and no others: there is
now **one** gradient (the shell's 5% amber floodlight) and **one** glow (the live pill's 14% amber ring). Both
are named, both are single instances, and both are load-bearing — they are what makes a 1400px viewport look
lit rather than empty. Everything else on that list stands: no emoji, no cream, no serif display, no purple,
no teal, no acid green, no glass blur, no champion art, no avatars, no crests, no "VS", no skeletons, no
toasts, no shimmer.


## Palette (v1 — superseded 2026-09-09 by Floodlit)

> Kept for the reasoning, not for the values. `accent` is now `brand`, `#12151A` is now `#0B0E14`, and there
> are two more tokens. The **rules** in this section — a side colour is a rule or a tint and never a fill,
> deltas are never coloured by sign, blue and red must sit within about a point of each other in contrast —
> all survive into v2 unchanged.

Seven named tokens per theme. Everything else in the UI is derived from these with `color-mix()`, so there is
no eighth colour to keep in step.

| Token | Role | Dark | Light |
|---|---|---|---|
| `bg` | Page. A cool near-black, never `#000`: pure black on an OLED phone smears text at arm's length. | `#12151A` | `#F3F4F6` |
| `surface` | Cards, rows, strips. One step off `bg`, no shadow. | `#1B2027` | `#FFFFFF` |
| `text` | Everything you are meant to read. | `#E7EAEF` | `#161A20` |
| `dim` | Labels, counts, secondary lines. Never a player's name, never a rating. | `#97A0AD` | `#5B6573` |
| `blue` | Side 100. Team names, the card's top rule, the win colour on a blue result. | `#6BA5F7` | `#1F5FC4` |
| `red` | Side 200. Same jobs on the other side. | `#EA6F69` | `#B4302B` |
| `accent` | Brass. The one colour that is **neither side**: live state, off-role marker, "you", the reroll control, the rating-history line. | `#E0A33E` | `#8E5B0E` |

Contrast, measured (WCAG 2.1, against `surface`, the worst of the two backgrounds):

| | dark | light |
|---|---|---|
| `text` | 13.6 | 17.5 |
| `dim` | 6.2 | 5.9 |
| `blue` | 6.5 | 6.0 |
| `red` | 5.4 | 6.2 |
| `accent` | 7.4 | 5.8 |

All pass AA for body text. `blue` and `red` are deliberately within ~1.2 of each other in ratio: if one side
were visibly brighter, that side would read as the favoured one before anyone read a number.

**Derived values.** Do not add hex; derive.

```
hairline      color-mix(in srgb, var(--cn-text) 14%, transparent)
blue tint     color-mix(in srgb, var(--cn-blue) 7%, var(--cn-surface))
red tint      color-mix(in srgb, var(--cn-red) 7%, var(--cn-surface))
accent tint   color-mix(in srgb, var(--cn-accent) 10%, var(--cn-surface))
pressed       color-mix(in srgb, var(--cn-text) 8%, var(--cn-surface))
```

**Colour rules.**

- A side colour is only ever a **1px to 3px rule, a text colour, or a 7% tint**. Never a filled block behind
  five names. A saturated fill in a dark room at 11pm is a flashlight.
- **Rating deltas are never coloured by sign.** No green. A gain is `text` at weight 600, a loss is `dim`, and
  both always print their sign. Green-for-good would collide with `red` meaning "side 200", and a red number
  next to a red team is unreadable in every sense.
- Nothing is a gradient. No shadows except a 1px hairline. No glow.

## Type (v1 — superseded 2026-09-09 by Floodlit)

> The families are the same two and the mono/proportional split is unchanged. What v2 adds is the Archivo
> width axis as a display cut and a `t-display` step above `t-xl`.

Two families, Google Fonts, loaded through `next/font/google`.

| Family | Role | Weights | Fallback stack |
|---|---|---|---|
| **Archivo** | Everything read as language: names, headings, the explanation line, copy. A grotesque with tight sidebearings — it stays legible small and does not look like a dashboard template. | 400, 600, 700 | `'Archivo', 'Helvetica Neue', Arial, system-ui, sans-serif` |
| **IBM Plex Mono** | Everything read as data: ratings, deltas, gap, win percentage, duration, rank number, role labels, lobby password, PUUID fragments. True tabular figures, a distinguishable `1`/`l`, and a real minus. | 400, 600 | `'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace` |

The split is the whole system: **if it is a number or a role, it is mono; if it is a person or a sentence, it
is Archivo.** A column of ratings in a proportional font wobbles and a scoreboard that wobbles looks wrong
before anyone can say why.

Every numeric run also sets `font-variant-numeric: tabular-nums`.

### Scale

Root stays at 16px. Body is 17px because the page is read at arm's length; nothing that carries meaning goes
below 12px.

| Token | Size | Line height | Used for |
|---|---|---|---|
| `t-xs` | 0.75rem / 12px | 1.35 | role labels, `settling` chip, per-row meta (`24 games · 13W 11L`) |
| `t-sm` | 0.875rem / 14px | 1.4 | rating delta, duration, secondary lines |
| `t-base` | 1.0625rem / 17px | 1.5 | body, the explanation line, sit-out copy |
| `t-md` | 1.25rem / 20px | 1.3 | player names in team cards and leaderboard rows, ratings |
| `t-lg` | 1.625rem / 26px | 1.2 | side headers (`Blue`), section headings |
| `t-xl` | 2.25rem / 36px | 1.1 | the lobby count (`7`), the result headline (`Red wins`) |

`t-xl` is the only size that changes across breakpoints, and only upward (2.75rem at ≥720px). Everything else
is the same on a phone and a laptop; a name is not more important on a bigger screen.

Weights: 400 body, 600 names and numbers that matter, 700 only for `t-xl`. No 300, ever — hairline weights
vanish on a phone at arm's length.

Letter-spacing: `-0.01em` on `t-lg` and above; `0.06em` on mono role labels rendered in lower case, which is
how they are always rendered (`top`, `jungle`, `adc` — never `TOP`, never `ADC` in caps, because the client
and the group say them in lower case).

## Spacing, size, motion (v1 — superseded 2026-09-09 by Floodlit)

> The 4px scale and the 44px floor are unchanged. Radii and elevation are not: v2 cards are 10px with a 1px
> `line` border and a lit top edge, and the max content width is no longer 42rem.

4px base.

| Token | px |
|---|---|
| `sp-1` | 4 |
| `sp-2` | 8 |
| `sp-3` | 12 |
| `sp-4` | 16 |
| `sp-5` | 24 |
| `sp-6` | 32 |
| `sp-7` | 48 |
| `sp-8` | 64 |

- Page gutter `sp-4` on phone, `sp-5` at ≥720px. Max content width 42rem; the tonight page never gets wider,
  it centres.
- Gap between blocks `sp-5`. Gap between rows inside a card `0` — rows are separated by a hairline, not space.
- Radius: `6px` on cards and strips, `3px` on chips, `0` on hairline dividers. Nothing is a pill.
- Every tappable thing is at least **44 × 44px**, including the role-override taps (M3.6), the reroll button
  and the idle page's `Last night and the board` link — a bare inline anchor is about 26px tall and is the one
  tappable thing on the whole idle screen.
- Motion: one transition, `opacity 150ms ease`. New rows fade in. Nothing slides, nothing scales, nothing
  pulses more than a 2s opacity cycle on the single live dot. Honour `prefers-reduced-motion: reduce` by
  dropping to no transition at all. The page must never move under a thumb that is about to tap.

## Components (v1 — the tonight-page entries are superseded by Floodlit)

> Read this section for **what a component contains and why**, which is still current everywhere, and Floodlit
> for **how it looks**. Where a component below names `accent`, read `brand`. The leaderboard, still-settling
> and rating-history entries are current for M3.5 with the follow-up listed under "What changes on the
> leaderboard and the player page".

### Lobby member list — state "filling"

- Hero: the count, `t-xl` mono, `7` in `accent`, then ` in the lobby` in `t-base` `dim`. Under it, a row of
  ten 3px bars, `sp-1` apart, filled ones `accent`, empty ones hairline. That row is the whole status at
  arm's length: you can count it without reading.
- One row per member, in join order, oldest first. Newest is appended, not prepended — a list that reorders
  under a thumb is worse than a list you scroll. Everyone in the **same** companion post arrived at the same
  instant and has no join order between them: break that tie on the **name**, not on a database id, so a first
  post of seven reads as a list rather than as a shuffle.
- Row (exactly 44px tall, hairline between): name `t-md` 600 · main role `t-xs` mono `dim`, secondary role
  after a `/` also `dim` · display rating right-aligned, `t-md` mono tabular. A member with no role declared
  reads `flexible` in that column, in the same mono `t-xs` `dim` — it is what the balancer will treat them as,
  and a blank there reads as missing data.
- A member who joined in the last 3s carries a 2px `accent` left rule, then it fades out on the page's one
  150ms opacity transition. Draw it as an element that is always there and only changes opacity, never as a
  border that appears: a row that gains a border gains 2px of width under a thumb.
- The signed-in viewer's own row: 2px `accent` left rule, permanent, drawn as an inset shadow so it adds no
  width. Finding yourself is job one.
- **Reserve ten rows' height from the start**, and reserve it in the row's own units: `10 × 44px` plus the
  nine hairlines between them. Going from 9 to 10 must not shift the page while someone is reading it, and a
  reserved height that was guessed from the font instead of the row is a shift of about thirty pixels at the
  exact moment everybody is looking.
- People beyond the ten (`is_spectator`) sit under a hairline labelled `Around` in `t-xs` `dim`.
- Empty: `Nobody in the lobby yet.` in `dim`. Not an illustration, not a spinner.

### Team card

- Two cards. Stacked on phone, **blue first** (side 100 is the lower number and the client's first side).
  Side by side at ≥720px, equal width, blue left.
- Card: `surface` with the side tint, 6px radius, a 3px rule in the side colour along the **top** edge only.
- Header row: `Blue` in the side colour, `t-lg` 600, and on the right the sum of the five display ratings,
  mono `t-md` `dim`. Label it `7695` with no word: the header is `Blue` and a number, and the explanation line
  below owns the word "gap". They are not the same quantity (see "Sums are not the gap" below). Decided
  (product, 2026-09-08): the side sums stay **bare numbers with no label**, here and in the embed. Give the
  web number visually-hidden text `sum of the five ratings` so a screen reader is not left with a bare
  integer.
- Five rows, always five, **always in lane order** top, jungle, mid, adc, support. Never sorted by rating.
  That order is `Split.blue` / `Split.red` as stored, so render the array as given.
- Row: role label, mono `t-xs` `dim`, in a fixed 4.5rem column · name Archivo `t-md` 600 · display rating,
  mono `t-md`, right-aligned tabular.
- **Off-role:** the role label turns `accent` and gains a 1px dotted underline, and the row gets an `accent`
  dot before the name. Colour is never the only signal — the explanation line names the player and the role in
  words, and the row carries visually-hidden text `off-role`.
- **You:** 2px `accent` left border on the row.
- No crest, no "VS", no champion art, no avatars. There is no source for any of it and it would be the first
  thing that made this look like a template.

### Explanation line

- Sits directly **below** both team cards, full width. Read order on a phone is: my side, my name, then why.
- A `surface` strip, 2px `accent` left border, `sp-3` padding, text `t-base` in `text` — not `dim`. This
  sentence is the product's whole argument; it does not get demoted to caption grey.
- Rendered **verbatim** from `splits.explanation` as a single `<p>`. Never re-composed from the split's
  numbers, never chopped into badges or chips, never truncated, never ellipsised. Three lines of wrap on a
  phone is the correct outcome.

  > Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.

- The reroll control (M3.2, admins only) is a ghost button on the right of the strip on wide screens, and a
  full-width button under it on phone. Label `Reroll`. After the last split it is `disabled` and the strip
  shows, in `dim` `t-sm`: `No more splits. Change who is in the lobby to rebalance, or play these.`
  (Product copy, 2026-09-08. It is deliberately *not* core's `BalanceError` message
  `No more splits. Rebalance or play these.` — "rebalance" is not a button on this page, it is what happens
  when the lobby membership changes, and the friend reading it should be told which.)
- After a reroll the strip re-renders with the promoted split's stored string (M3.7). Same element, opacity
  fade, no scroll.
- **Fill protection has no surface, on purpose** (M7.5 / M7.6, checked by the designer 2026-09-16). Since
  2026-09-15 an off-role seat costs the balancer more when the same person was filled recently — 240 display
  points for somebody filled last game, decaying to the flat 120 — so *who* gets filled changes on the nights
  it matters. Nothing about it prints anywhere: not in this sentence, not on a seat, not on a row, not in the
  embed. The sentence keeps its shape and still names who is off-role and where (`4 off-role: Hana at support,
  …`), which is the fact a player can act on; "we owed her a main" is a claim about a night that is not on the
  screen, and a marker for it would be a second vocabulary on the one line the whole product argues from.
  **Nothing in this file is owed for M7.5 or M7.6 beyond this paragraph**, and a future reviewer looking for
  the missing surface should stop here rather than invent one. If the group ever asks why somebody keeps
  getting support, the answer is a copy task of its own with product's words in it.

### Sit-out notice

- Full-width strip above the team cards, `surface`, 2px `accent` left border, `t-base`.
- Above, not below: if you are sitting out, everything under it is not about you, and you should learn that
  before you scan for your name.
- When the viewer is one of the sitting players the strip leads with a second-person sentence and keeps the
  `accent` border; nobody else's strip changes.
- Copy (product, 2026-09-08 — final; the rule behind it is fewest games tonight, then oldest sit-out):
  - general: `Sitting out this game: Sara and Deniz. Each game goes to whoever has played least tonight, so they are first in line for the next one.`
  - viewer: `You are sitting this one out. Each game goes to whoever has played least tonight, so you are first in line for the next one.`
  - Names are joined with `, ` and a final ` and`: `Sara and Deniz`, `Sara, Deniz and Ali`. Any change to
    these two sentences goes through product.

### Result card

- Headline `Red wins` in the winner's side colour, `t-xl` 700, with the duration beside it in mono `t-sm`
  `dim`: `34:12`.
- Second line, `t-base` `dim`: the prediction, kept honest — `Blue was favored 54%.` The bot said a number
  before the game; it does not get to quietly drop it after.
- Then the two team cards again, with each row's rating replaced by the **after** rating and a delta chip. The
  card for the winning side keeps its 3px top rule; the losing side's rule drops to hairline `dim`.
- **These are the only team cards on the finished screen.** The explanation line of the split they played sits
  under them; nothing renders a second pair with the before numbers (M3.16, and the state table above).
- **Same five positions as the teams block, lane order, top to support.** "My row" has to be where it was
  twenty minutes ago, and the result embed already sorts this way. A player the scoreboard has no role for is
  printed without one and sorts after the five who have one.
- **No side sums in the result card's headers.** The sum answers "are these teams even?", which is a question
  the game has just answered, and a reader who saw `6000` before the game and `6465` after has computed a team
  total of deltas by subtraction — the one number this page must not put on screen (below). The header of a
  result card is the side name alone.
- The off-role marker is **not** repeated here. It described a decision, and the decision has been played; the
  stored explanation under the cards still names the player and the role in words.
- One line under the cards, `t-base`: `Top damage: Lena, 47.3k.` with the number in `accent`.
- No wash of colour over the page, no banner, no confetti. The result is a fact, not an event.
- **Never print a team total of deltas.** The two sides do not sum to zero — different sigmas and rounding —
  and a visible imbalance is a free argument about a thing that is working correctly.

### Rating delta

- Mono, `t-sm`, tabular, in parentheses after the new rating: `1512 (+43)`.
- Always signed. `+` and U+2212 `−` on the web (it is the width of `+` in Plex Mono and aligns in a column);
  plain ASCII `+` and `-` in Discord, which has no font control and gets copy-pasted.
- Not coloured by sign: gain is `text` at 600, loss is `dim` at 400.
- `(0)` never appears — if the delta rounds to zero, print `(+0)` or `(−0)` to match the sign of the mu change,
  so a column of ten rows never has a stray unsigned entry.
- Rounding rule: the delta is `displayAfter − displayBefore`, both already rounded — never
  `round((muAfter − muBefore) * 60)`. Otherwise `1469 + 42 = 1512` is false on the screen. See DECISIONS.

### Leaderboard row

- One row per player, min-height 56px (two lines), hairline between, no zebra striping.
- **Line 1**, left to right: rank number, mono `t-sm` `dim`, fixed 2.5ch · name Archivo `t-md` 600, single
  line, ellipsis · **Proven**, mono `t-md` 600, right-aligned, hard against the row's right edge.
- **Line 2**, `t-xs` `dim`, exactly this order, separated by ` · `:

  ```
  Rating 1266 · 28 games · 13W 15L · L2 · [settling]
  ```

  Rating comes **first on line 2 and sits directly under the Proven number**, right-aligned to the same edge,
  so the two numbers form one vertical pair per row and the eye reads them as one player's two facts rather
  than as two competing columns. Everything after it (games, W/L, streak, the `settling` chip) is left-aligned
  under the name. So line 2 is two groups pinned to opposite edges, the same as line 1.
- **The words print per row, not as column headers.** `Rating` prints inline on every line 2, `Proven` prints
  nowhere on the row at all — it is the unlabelled primary number, named once in a `t-xs` `dim` legend above
  the list. Reasons: the list is a stacked card list on a phone, not a table, so a header row scrolls away
  after four rows and every row below it is then two unexplained numbers; and `Rating` is the number people
  arrive knowing, so it is the one that needs its name attached where it appears. The legend is not a header
  row: it does not stick, does not sort, and is not tappable.
- **The legend is the single word `Proven`, right-aligned over that number, and not `Proven · Rating`**
  (amended 2026-09-09, from the rendered page). Right-aligned, the two-word legend puts `Rating` directly
  above the *Proven* column and `Proven` above nothing, which reads as two side-by-side columns when the two
  numbers are stacked. `Rating` needs no legend because it names itself on every row.
- `Proven` is never abbreviated and the two numbers are never merged into one cell (`1266 / 654`). They are
  different quantities on different lines.
- Rank 1 gets `accent` on the **rank number only**. No medals, no trophies, no emoji, no highlight row.
- The viewer's own row: 2px `accent` left border. No auto-scroll to it.
- At ≥720px the row does not become a table. Same two lines, wider gutters. A twenty-person board does not
  need a table and a table would need the header row this design just removed.
- **Two numbers, one problem.** The board sorts on `ordinal = mu − 2σ` but the number everyone knows is
  `round(mu × 60)`. Showing the second while sorting on the first puts visibly out-of-order numbers on the
  page, which is the exact complaint M3.8 exists to prevent. The design shows **both**, columns labelled:
  **`Proven`** (`round(ordinal × 60)`, the sort key, primary, right-most) and **`Rating`** (`round(mu × 60)`,
  `dim`, mono `t-sm`, on line 2). Then the sort matches the primary column exactly, and the still-settling
  sentence is what explains why a new player's two numbers differ. Accepted by the lead; the names `Proven`
  and `Rating` are fixed by product (M3.5 brief, `02-milestones.md`) and no surface invents a third name.
- **Proven never prints below zero.** `ordinal = mu − 2σ` is negative for an unranked seed's first weeks and
  for any low tier — Iron IV seeds at `-160`, unranked at exactly `0`, and a Bronze player who loses their
  first two goes under — and a primary column with `-83` in it reads as a broken page before anybody reads the
  legend. `provenRating` floors at `0` on every surface, web and Discord. Sorting is unchanged: rows tied at
  `0` fall through to `Rating`, so the column is still non-increasing top to bottom. `0` is also the honest
  reading — the board has not credited you with anything yet — and the still-settling sentence is what
  explains it.
- **A week row has one number, and it is `Rating`** (M7.3, product 2026-09-15; designer's note 2026-09-16).
  Everything above describes the row on `All time`, `This month` and `Last month`. On `This week` and
  `Last week` — and `This week` is the board's **default**, so this is the row most readers actually meet —
  the primary slot on line 1 carries the weekly `Rating` (`round(mu × 60)` off that week's own from-scratch
  fold), the legend above the column reads `Rating` rather than `Proven`, line 2's small-type `Rating 1266` is
  **dropped rather than replaced**, and no row carries the `settling` chip. **Nothing on a week board prints
  Proven in any size.** Three consequences worth stating, because each one is a rule this section otherwise
  contradicts:
  - The "two numbers, one problem" paragraph above is the *Proven* board's answer. A week board has no second
    number to reconcile: it sorts on the number it prints, which is the same rule arrived at from the other end.
  - The visually-hidden noun beside the primary number follows the legend (`Rating` on a week, `Proven`
    elsewhere), so a listener is never handed an integer that means something else on the tab next door. The
    class name `.cn-proven` is the layout's and is not a claim about which number is in it.
  - **The tonight page's `Top of the board` rail inherits all of it**, because the rail is `LEADERBOARD_WINDOW`
    — `this-week` — sliced to five. The rail's legend reads `Rating`, its rows carry no chip, and it never
    badges (M8.3) and never opens (M5.30).
- **There is a third line, and only on a row that won one of the window's awards** (M8.3, 2026-09-15). It holds
  labelled badges and nothing else, it is drawn on `Last week` and `Last month` only, and it is never drawn in
  the tonight rail. Everything about it — the dress, the order of two badges, the wrap — is its own section
  below, "The award badge on a board row".

### Leaderboard row expand (M5.30) — 2026-09-13

A row with rated games in the open window is a `<details>`, closed by default. The two-line row is the
summary. Opening it lists those games newest first: `Won` / `Lost`, the night (`9 Sep`), the duration, and
`1512 (+43)` on the right — the same four facts, the same delta glyphs, the same gain/loss weights as
`Recent games` on `/p/[puuid]`. No lineup, no chance clause: those stay on the player page a tap on the name
already opens.

- The control is `<details>`, the same expand `/games` and `/fun` use. No JavaScript. The games are in the
  first paint.
- A 5px `dim` triangle sits between the name and Proven so the primary number stays on the right edge, under
  the legend. The slot is reserved on every row so a seed with nothing to open does not shift that column.
- The side is the 3px leading rule, blue or red, never a wash behind `Won`.
- The tonight rail never opens: `loadTopPlayers` does not attach the breakdown.
- Rated games only. An unrated row does not move the number the expand is explaining.
- **The games are on the row's own track** (M7.3). On a week window each game's `1512 (+43)` is that game's
  movement in the *weekly* fold, not the stored all-time one, because the row's total is the weekly number and
  a row whose total is one track and whose games are another does not add up. **Since M7.16 (2026-09-16) the
  page agrees with it**: `/p/[puuid]` on a week window prints the same weekly delta for the same game, so the
  expand and the list a tap later are one answer — the row that used to warn readers about that difference is
  superseded. The other honest consequence stands: the weekly track does not carry the **MVP / ACE**
  adjustment at all (M7.9, acceptance 6, waived, and settled as a product decision in M7's close-out audit),
  so a game somebody was MVP of moves them by the plain amount on a week window, on both surfaces. It is not
  marked and should not be — the expand explains the number above it and nothing else. `MVP` stays the one
  word on the two surfaces M7.10 put it on, and it does not move with the track.

### The award badge on a board row (M8.3, designer 2026-09-15)

On `Last week` and `Last month` the winners' rows carry the award's own words. On `This week`, `This month` and
`All time` nothing is drawn, because those windows have no awards to draw (M5.4: *an award that changes every
night is a statistic, not an award*), and this task does not invent any. The tonight rail never badges.

**It is a third line, its own run, under the meta.** Not inside line 2's middot run and not beside the name:

```
 3  Nadia                              ▾   1548     ← line 1, unchanged
    12 games · 8W 4L · +153 · W3        Rating 2088 ← line 2, unchanged
    [Most improved] [Cursed duo]                    ← line 3, only on a row that won something
```

- **Not in line 2.** `12 games · 8W 4L · +153 · W3 · Most improved` sets an award as the last item of a run of
  statistics, separated by the same middot, in the same size and colour as the numbers around it — which is
  precisely the reading M5.4 spent a paragraph refusing. The run is one window fact ("what happened inside the
  window"); an award is what came out of it. It also fits at 390 only just, so the second badge would wrap
  inside the meta span and land under the record with `Rating` baseline-aligned to the line above it — the same
  third line, arrived at by accident and with no control over it.
- **Not on line 1.** The name is `flex: 1 1 auto` with an ellipsis, and the triangle and the primary number own
  the right edge. A chip between them buys its width out of the one thing on the row a reader is looking for.
- **Left-aligned under the name, and line 3 has no right-hand group.** Lines 1 and 2 are each two groups pinned
  to opposite edges; this one is deliberately not, because there is no second fact to pin. `padding-bottom:
  var(--cn-sp-2)` on the run, with line 2's existing `padding-bottom: var(--cn-sp-2)` above it, so the badges
  sit in the row's own rhythm and the row grows from 56px to about 84px. **A badged row being taller than its
  neighbours is the point**: three rows in twenty carry more, which is how a label earns attention without
  taking a colour.

**The badge itself: the settling chip's shape, in language's typeface.**

```css
/* An award the window handed out (M8.3). A label, not a control and not a decoration. */
.cn-row-awards {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cn-sp-2);
  margin: 0;
  padding-bottom: var(--cn-sp-2);
}

.cn-award {
  border: 1px solid var(--cn-line);
  border-radius: var(--cn-radius-chip);
  padding: 0 var(--cn-sp-2);
  font-family: var(--cn-font-sans);
  font-size: var(--cn-t-xs);
  font-weight: 500;
  line-height: 1.5;
  color: var(--cn-dim);
  white-space: nowrap;
}
```

- **Archivo, not mono**, and this is the one place it parts company with the `settling` chip it borrows its box
  from. The type rule is `number or role → mono`; `Most improved` is neither, it is a two-word phrase with a
  capital letter, and a capital on a mono micro-label is forbidden three sections up (`top`, `live`, `settling`,
  never `This Week`). The window picker's labels are Archivo for the same reason. The difference is also useful:
  on `Last month` a row can carry `settling` on line 2 and `Most improved` on line 3, and mono-lowercase versus
  Archivo-sentence-case is what stops two identical marks from meaning two different things on one row.
- **`dim`, 1px `line`, `radius-chip` — no colour of its own.** Not `brand`: `brand` is the one lamp, spent on the
  chosen window chip and the viewer's own row on this page already, and three amber boxes down a board would
  outrank both. Not blue or red — those are sides. The hairline is not decoration, it is what makes two words in
  `dim` read as a label rather than as text that wandered out of line 2.
- **Never a number, an icon, a trophy, a medal, a `#1`, an emoji or a count.** The badge is the award's title and
  nothing else. `Cursed duo` does not name the partner and `Most improved` does not print `+153`: the line
  already prints that player's climb, and the full award line with both halves of a duo is `/stats`'s, once.
- **No tooltip and no `title` attribute.** A tooltip is a hover, the page is read on a phone, and a badge that
  needs explaining is a badge that should have been a sentence.

**Two badges on one row.** A row can win more than one — most improved and cursed duo is the ordinary case, and
all three is possible. They print in **the awards' own order, always: `Most improved`, `Best off-role`,
`Cursed duo`** — `awardBlocks`' order, which is `/stats`' order and the Discord post's order. Never sorted by
anything else, never re-ordered per row, because a reader comparing two badged rows should meet the same
sequence on both. Each badge is `white-space: nowrap` and the run is `flex-wrap: wrap`, so if a run ever exceeds
the row it breaks **between** badges and never inside a label.

**390px.** Content box is `390 − 2×16 gutter − 2×12 row padding = 334px`. Budget, at Archivo 500 12px with 8px
of padding each side and a 1px border: `Most improved` ≈ 99px, `Best off-role` ≈ 99px, `Cursed duo` ≈ 81px. The
worst pair is 206px and all three are 295px, so **every case fits on one line at 390** and the wrap rule is
insurance rather than layout. Those are budgets, not measurements: check the real thing at 390 with two badges
before calling it done.

**1280px.** The board card sits in the same 44rem column, so the run has ~648px and nothing about it changes.
**The row does not become a table and the badges do not move to the right edge at any width** — one structure at
both widths, for the rule the row already follows (*at ≥720px the row does not become a table, same lines, wider
gutters*). A badge that lives on line 3 on a phone and at the end of line 2 on a laptop is two layouts and two
tests for three rows a week.

**The badge is not a control, and the expand is untouched (M5.30).** The run renders inside `BoardRowLines`,
after `.cn-row-bottom` — so it is inside the `<summary>` on an expandable row and inside the `<li>` on a row
with nothing to open, from one place in the component. Consequences, and all three are wanted:

- The whole row, badges included, stays **one** tap target for the `<details>`. The badge enlarges that target
  rather than competing with it.
- **No `<a>`, no `<button>`, no `tabindex` inside the run.** An interactive element inside a `<summary>` is a
  nested control: a thumb landing near it either toggles nothing or navigates by accident. In particular the
  badge does **not** link to `/stats`, tempting as that is — the brief says the badge is not a control, and the
  window picker plus the nav already reach that page.
- It must sit **inside** the summary, not after the `</details>`: outside it, an open row would print its award
  under the list of games it won the award with, where it reads as a caption on the last game.

**A screen reader** hears the badge as the last words of the row, after the meta: *"Nadia, 1548 Proven, 12
games, 8W 4L, plus 153, W3, Most improved"*. No `aria-label`, no visually-hidden prefix, no `role` — the words
are already language, and the window that handed the award out is the `h1` above the board. Both halves of a
cursed duo are badged and both are on the board, so the pair explains itself: two rows, same two words.

**Edge cases**, all of them falling out of "the loader hands the row its list and the row prints it": no
qualifying winner means no run and a board byte-identical to today's; a tie means both rows carry the badge; a
cursed-duo winner who is not on the board is simply not badged and **no ghost row is added**. The word `season`
appears nowhere in any of it.

**Light and dark.** One recipe. `dim` on `surface` clears 7:1 in both themes at this size, and the `line`
hairline is the same one already drawn between every two rows, so the badge inherits the board's own edge rather
than introducing a second one.

### Still-settling marker (M3.8)

- The marker is a chip: the word `settling`, mono `t-xs`, `dim`, 1px hairline border, 3px radius, `sp-1`
  horizontal padding. No colour, no dot, no emoji, no asterisk. It reads as a label, not a warning.
- Placed after the meta on line 2 of the leaderboard row, and beside the rating on `/p/[puuid]`.
- The sentence appears **once per page**, under the leaderboard heading and under the rating chart on the
  player page — not per row. **From 2026-09-10 (M3.26) the two pages print two different forms**: the
  second-person one below is `/leaderboard`'s, and `/p/[puuid]` prints the third-person twin in the copy
  table above, because on somebody else's page `your rating` names their number. Copy (product,
  2026-09-08; **both sentences amended 2026-09-10**, M3.19 — the old pair said the gap closes at 30 games
  and that new players start at the bottom, and neither is true; `04-decisions.md`):
  `The board sorts on Proven: your rating, minus how unsure the board still is about you. That gap shrinks as you play and settles after about 30 games.`
  Short form, for the one-line Discord footer where two sentences will not fit:
  `Proven is your rating minus how unsure the board still is about you, and it settles after about 30 games.`
- Both sentences say **settles**, never *catches up*: Proven stays below Rating for good — sigma flattens
  near 4.5, which is 540 display points on a settled player (Lena, 41 games: Rating `2088`, Proven `1548`).
  What changes with games is how far below, and most of that movement is in the first 30.
- Disappears at 30 games with no ceremony.

### Game history (`/games`) — 2026-09-12

The captured customs, newest first, each a collapsed match card that opens into both scoreboards. Same
window picker as the board, default `This week`. A second chip row under it is **Summoner's Rift** (default)
and **ARAM** — the same 44px chip recipe, `?queue=aram` when not on Rift. Optional `?p=<puuid>` filters to
one person and switches the headline from `Blue won` / `Red won` to their own `Won` / `Lost`, with their
KDA · KP · CS on the collapsed card — the match-history shape, without champion art or item icons
(Floodlit forbids both, and items are not stored as columns). Expand is a `<details>`, so the scoreboard
is in the first paint. The toggle stays up on an empty list so a quiet Rift week can still open ARAM.

Columns the companion already stores: role, name, **champion name** (from `champion_id`, no art),
KDA, damage (bar + compact `k`), gold, CS. Kill
participation is `(kills + assists) / that side's kills`. A side rule on the card's leading edge; on the
group list it is the winner's, on a focused list it is that player's. No green, no fill behind `Won`.

`Recent games` on `/p/[puuid]` keeps the last five and links `All games` at this page in the same window.

`/fun` wears the same Rift / ARAM chips, same `?queue=`, same default. CS by role and Objective Thief
are hidden on ARAM.

Order under the strip: First Blood Museum (killer, champion, night), First Blood Donated only
when the block named `firstBloodDeath` (hidden when empty — the live blob does not name who
died), Pentakill / Quadrakill / Triple / Double museums, First Turret, Death Hall of Fame,
Objective Thief (Rift), Fear Ban, Most banned (Rift), Most picked, Who they lock (one-trick
vs always a new champ), Luck (lowest KDA on a win / highest KDA on a loss), **Friends and enemies**
(M8.1, nemesis and best duo), **Won against the odds** (M8.2), then CS by role, one-game records, habits. First blood and vision are no longer printed as missing notes; the killer
museum is empty only when the stored block named no killer. Deaths and
`longestTimeSpentLiving` are not a corpse. Multi-kill halls sum the stored count fields; a
game with two triples is one opening labelled `2 triples`. First Turret is the
`firstTowerKill` flag, never inferred from gold. Fear Ban is one sentence per person:
`Omar's Shaco has been banned in 64% of games where they were available (16 of 25).` Most
banned and Most picked are the lobby's champions, not a person's: `Shaco · 16 bans`,
`Ahri · 12 picks`. Who they lock ranks people with at least five counted games that named a
champion: **One-trick** is the highest share on one champion (`Shaco · 100% of 15 games`),
**Always a new champ** is the most distinct champions (`12 champions · 15 games`). Each row
is a closed `<details>` that opens **See champs** into `Ahri × 12`. Luck ranks how often
someone was the lowest KDA on the winning side (**Lucky trash** / المحظوظ طرش) or the
highest KDA on the losing side (**Most robbed** / المظلوم بزيادة): `2 times`, closed
`<details>`, **See games** into `0/8/1 · Alistar`.

**Friends and enemies** (M8.1, `صحابه وخصومه`) is two ranked lists in one card, ten rows each. **Nemesis**
(`اللي دايما بيكسبه`) is per player and one-way — Yuki's nemesis is Lena, Lena's is somebody else: the person
who has beaten them most, over at least five counted games on opposite sides. The row is `6 of 10` in the mono
column with `Lost 6 of 10 to Lena.` wrapping under it; the count always carries its denominator, because the
count alone would be an attendance award. A perfect record against somebody is never a nemesis. **Best duo**
(`التنائي اللي مبيخسرش`) is `duoRecords` — the same call `Partners` on `/p/[puuid]` makes — printing the same
pair line, `Lena and Theo · 8W 2L · 80%`. Each row is a closed `<details>` that opens **See games** into the
customs it was folded from, newest first, each labelled `Won` / `Lost` with its scoreboard. Empty:
`No pair has 5 games against each other yet.` and `No pair has 5 games together yet.` **Unlike CS by role and
Objective Thief, this group is not hidden on ARAM** — both lists draw on whatever the `?queue=` read returned.

**Won against the odds** (M8.2, `كسبوا وهما خسرانين`) is a ranked list and a one-game record, both read from
`splits.blue_win_prob` — the chance the balancer posted for a side *before* the game, never a live recompute,
so a rebuild cannot move either. The list counts counted customs won when the side's own posted chance was
under 45%, floored at two such wins (`3 wins`, `See games` into `31% · Won · Tuesday`); the record under it is
the single least likely win in the window, naming the five who did it (`Blue won at 31%.`). The comparison is
on the rounded percent the group actually saw that night — the same rounding `sideWinChance` applies on the
tonight page, the result embed and the recent-games row — not on the raw stored float, so a `0.449` game reads
`45%` and does not sneak under a heading that says "under 45%". No "upset", no "miracle", no exclamation mark:
the bot was wrong and the section says so plainly. A backfilled game has no lobby and no split and is in
neither list — most of the history is backfilled, so this section is thin for a while and says so with its own
empty sentence (`No counted custom in this window was won from under 45%. Backfilled games have no posted
chance, so only nights the bot made the teams can be here.`) rather than looking broken; a window with exactly
one qualifying win prints the record but the list's own second sentence (`Nobody has done it 2 times in this
window yet.`), since the two thin cases are not the same one.

One-game records include Longest killing spree from `largestKillingSpree`
(at least three). Every English card title and record name carries an Egyptian 3ameya roast
facing it on the right in brand (`مين فتحها`, `كنسهم كنس`, `كسب وهو زبالة`) — not فصحى and
not a translation. Odd rows sit on `raise` so a long museum is a zebra.

The museum is **grouped by the killer**, a hairline between people. One first blood is the row
itself (champion, night, **This game**). Two or more open **See games** and list each opening.
Deathless games and Career thief do the same: one counted custom is **This game**; more than one is
**See games**. A steal names the objective when the block recorded exactly one epic type they also
killed (`1 dragon steal`); it stays `1 steal` when the type is missing or mixed.

A one-game record (Most kills, a CS high, a museum opening) carries **This game**. The control is
the summary of a `<details>` — same expand `/games` uses, no JavaScript — and opens both
scoreboards of that custom, with the record holder's row marked. Habits that are not a list of
nights stay flat.

The open scoreboard prints roles and sits in lane order. A stored `game_players.role` wins. A
backfilled null is filled for display only from `games.raw` (`detectedTeamPosition`, Smite, the
timeline pairs the fixtures did not refute, then the leftover unique lane on a five-seat Rift
side). Never from the champion. ARAM does not invent lanes. `/stats` and role inference never
see this fill.

### One vs one (`/1v1`) — 2026-09-18 (M8.5)

Lane 1v1 and any two people head to head. Same shell, same window picker, default `All time`.
Summoner's Rift only — `countedGames` then `matchesQueue(..., 'sr')`. No ARAM chip: Howling
Abyss has no lanes.

A lane meeting is exactly one player on each side with that role. Two tops on one side, or a
missing role, is not a 1v1 and does not count. Each lane prints the five series with the most
meetings, past three. Winner's name first, `8W 2L · 80%`, both names links. A percentage waits
for five meetings, the same bar `/stats` uses.

Two spice lists sit above the lanes: **Lane bully** (highest win rate, five meetings, at least
70%) and **Dead heat** (score within one game, five meetings, longest first).

**Pick two** is a GET form, `?a=` and `?b=` puuids, so the URL is the argument in the chat.
Two `<select>`s and a Compare button; `onChange` submits when JavaScript is on. Left is `a`,
right is `b`. The series prints a verdict, a `12–7` score, a brand/line bar, last meeting,
streak, last-five form as `W W L W L`, mean KDA into each other, the champion
each locked, same-role rows, and the record when they queued together. Colour is never a side:
the leader's number is `text` at 600, the trailer is `dim`. Brand is the lead share of the bar.

Every English card title carries an Egyptian 3ameya roast on the right in brand, the same
dress `/fun` uses.

### Fearless (tonight page, M10) — 2026-09-18, M10.2 2026-09-20

A card on `/`, under Daily Mystery, not in the rail: the list is tonight's constraint, not a
sidebar fact. Hidden while the pool is empty so an idle night is not a card that says nothing.

- Title `Fearless`, `cn-card-title`. Count on the right in `dim` (`10 champions.`).
- Sentence `Ban these next game.` in `text`.
- Find box, 44px, `Find a champion`. Matching names stay; the rest drop. An exact name
  prints `Ahri is on the ban list.` in brand and paints that chip like a pressed role
  (`brand` / `brand-tint`). That is the pick-phase check. The companion does not read
  champion select.
- Names grouped under lowercase lane words (`top` `jungle` `mid` `adc` `support`), A–Z
  inside the group. A first lock with no stored role sits under `other`.
- Names as wrap chips on `raise` with a `line` hairline. **M11: each chip leads with a 24×24 square champion
  icon.** This is the one exception to "no champion art". Size, opacity, the unknown-id case and the 32px chip
  height are in "The fearless icon exception" under Iconography, and nothing here overrides it.
- Unique ids. First-appearance decides membership and the lane heading; display order is
  lane then name. The companion does not auto-ban; this is a list for humans.

### The player page (`/p/[puuid]`) — settled 2026-09-09

Order down the page, and nothing else in it: name · record · the two numbers · the `Rating` chart · the
still-settling sentence · `By role` · `Recent games` · the nameless hint.

**On `This week` and `Last week` it is the same order with one number instead of two** and the week's own
sentence where the still-settling one goes (M7.16, below).

- **The record is on the page.** `37 games · 20W 17L`, `t-xs` `dim`, directly under the two numbers. The
  leaderboard row carries it and this page is about one person; a page that shows less about a player than
  the row that linked to it is a step backwards from the tap that got there.
- **`No games this season yet.` is about games, not about the chart.** It prints when the player has none. A
  player with games but nothing plottable gets the section with no chart and no sentence — the page never
  contradicts the row that linked to it.
- **`Recent games`, five, newest first.** Per game: the player's own result (`Won` / `Lost`, never the winning
  side), the duration, **the date** — `9 Sep`, mono `t-sm` `dim`, beside the duration, formatted on the server
  with the fixed locale and the configured timezone, exactly like the tonight page's slug — and
  `1392 (−42)` right. A list of results with no dates cannot answer the first question anybody asks of it. The
  section header carries a right-aligned `rating` legend and the number carries visually-hidden `Rating`, the
  same rule the board row's bare Proven already follows.
- **Unrated games are listed, not hidden** (product, 2026-09-10, M3.23). `Recent games` is the last five games the player played, rated or not, in `started_at` order, and an unrated one counts toward the five. Its rating column reads `not rated` — mono `t-sm` `dim`, right-aligned where `1392 (−42)` sits, no delta, no em-dash, no visually-hidden `Rating` on that row — while `Won` / `Lost`, the date and the duration print as normal. A refused game (too short, nine players, a duplicate player) and a backfilled game that `rebuild-ratings` has not folded yet read the same two words; the backfill row gains its number when the rebuild runs. Everything else on the page stays rated-only: the two numbers, the chart, the seed line, `By role` and the `37 games · 20W 17L` record, which is why the record may count fewer games than the list shows. Once per page, only when at least one row reads `not rated`, directly under the list with the nameless hint's placement rule: `Some games don't move ratings: ARAM, too short, short a player, or added from match history and not counted yet.` **ARAM joined that list on 2026-09-16 (M7.17)** — since M7.1 an ARAM is stored, listed and never rated, and the four ARAM nights already in the group's history became `not rated` rows when M7.11's rebuild ran, which makes it the most common of the four reasons. The placement rule and the row's own two words are unchanged.
- **This page reads the weekly track on the two week windows, and the all-time one on the other three**
  (**M7.16**, landed 2026-09-16; the defect was noted by the designer the same day and was M7.3's own flagged
  follow-up). Until then `/leaderboard?window=this-week` printed a player's **weekly** Rating as their one
  number while `/p/<same puuid>?window=this-week` printed their **all-time** Rating and Proven, the `settling`
  chip and an all-time chart — two numbers for one person and one week, with nothing on either surface naming
  which track it was showing. The fix is the first of the two the designer offered and the one this page took a
  position on: **the page reads the same fold the board does**, rather than labelling the contradiction. On
  `This week` and `Last week` it now shows one number — the weekly `Rating`, equal to the digit on that
  player's row — **no Proven at all**, no `settling` chip, the weekly fold's chart with the weekly seed under
  the `start` hairline, the weekly delta on every `Recent games` row inside the window, and
  `WEEK_PLAYER_SENTENCE` where the Proven sentence would be. The record (`games` / `wins` / `losses`) and the
  `MVP` / `ACE` word on a row are unchanged, because neither is a fact about a track. `All time`, `This month`
  and `Last month` are byte-identical to what M5.12 shipped. There is **one weekly fold in the app** and both
  surfaces call it, which is what makes "equal to the digit on the row" a property of the code.
- **The five are the player's own side, in lane order**, their own row marked with the `brand` inset rule.
  **Every other name is a link to that player's page**; the viewed player's own row is plain text. This is the
  one screen in the product that lists other people by name, and hopping between friends is what the board is
  for.
- **A recent game shows its side as a rule, never as a fill** (designer, 2026-09-10, from the rendered page).
  Each game block carries the 3px side rule on its leading edge and nothing else: the block's headline is
  `Won` / `Lost`, and a 10% red tint behind the word `Won` teaches a reader that red means lost. The side
  tint stays on the tonight page's team cards, where "which side?" is the question the card exists to answer;
  here side is a detail under a result. Same rule in light and dark.
- **Four of the five names are links, so they have to look like it without a hover** (designer, 2026-09-10,
  from the rendered page). The teammates carry a `line`-coloured underline at rest, raised to `currentColor`
  on hover and focus; the viewed player's own row is plain text with no underline. This is the one place in
  the product where a link is not the only thing in its row and its neighbour is not a link, and the page is
  read on a phone, which has no hover to reveal anything. And the `brand` inset rule in that lineup marks
  **one** row — the player whose page this is. It is not also drawn on the signed-in viewer's seat: with
  twenty friends and five seats the viewer is often in the same lineup, and two identical marks meaning two
  different things leave a reader unable to tell which row the page is about.
- **The back link is `← Leaderboard`** until the shell lands, and is deleted then: the `Leaderboard` tab is
  the same destination, and a page does not carry two ways to one place.
- **The player's name outranks the section headings.** In Floodlit the name is the display cut, the two
  numbers are `t-display` and `t-md`, and `By role` and `Recent games` are mono `t-xs` micro-labels in a
  `raise` card header. The v1 page set the name and both section headings to the same `t-lg` 600 and put the
  two numbers below all three, which makes the largest type on the page the words `By role`.

### Rating history (`/p/[puuid]`)

- **The plotted series is `Rating` (`round(mu × 60)`) — one series, never Proven.** The chart is titled
  `Rating` in `t-xs` `dim` above the plot, using the same word as line 2 of the leaderboard row, so the page
  has exactly two numbers with two names and the chart belongs to one of them.

  Product's reasoning, recorded here so nobody "fixes" it later: a Proven line sags at the start of a player's
  history for a reason the chart cannot show. Proven falls when σ is high and rises as σ falls, so a new
  player's Proven line climbs steeply while their actual skill estimate is flat, and a returning player's dips
  while nothing about them changed. That shape reads as "I got worse" and there is no axis, label or tooltip
  on a 140px phone chart that can say "that is your uncertainty, not your play". Rating moves only when you
  win or lose a game, which is the only thing a history chart can honestly claim to be about.

- Consequence: **the seed reference line is in the same units** — a hairline horizontal at
  `round(seedMu × 60)` with a `t-xs` `dim` label `seed`. Never the seed's ordinal. One unit on one chart.
- The player's current `Proven` number is not plotted; it appears once as text beside the current Rating, with
  the `settling` chip when under 30 games, above the chart. The chart shows the journey, the numbers beside it
  show where the board has them today.
- A single 1.5px `accent` line, no fill, no points, no grid. X is game index, not date — nights are uneven and
  a date axis makes a settled player look erratic.
- Height 140px on phone. No tooltip on hover; the recent-games list underneath is the detail view.
- Y range is the series min/max padded by 5%, and the seed line is always inside it even when that widens the
  range. A chart whose reference line is off-screen is a chart with no reference.

## Discord embeds

Checked against the shipped JSON on 2026-09-09 (`apps/web/lib/discord/__snapshots__/embeds.test.ts.snap`,
M3.1 and M3.3). Both worked examples below — every field name, every line, both colours, both footers, the
`Red wins · 34:12` title and all ten result deltas — match the snapshot character for character. Where this
section changed on that date it is called out in place, and the field order of the teams embed is the one
place the code has to move to meet it.

Constraints this layout is built against, and none of them are negotiable: no custom fonts, no CSS, one accent
colour per embed (a 4px bar down the left edge), field **name** ≤ 256 and field **value** ≤ 1024 characters,
25 fields max, 6000 characters total. Inline fields pack up to three per row on desktop and re-wrap on mobile,
so **every field must make sense read alone**, in any order, on one column. Nothing in this section comes near
those numbers; **M4.12**'s shared guard sits behind every builder as a last resort and is specified once,
under "Teams embed", because `Seats` is the one field that grows with the night.

Two consequences that shape everything below:

- **No column alignment.** Discord's proportional font will not align `Hana` and `Karim`, and a fenced code
  block that does align is a grey slab that scrolls sideways on a phone and kills every other colour on the
  message. So each line is short and self-contained: a role in inline code, a name, a middot, a number.
- **Colour is structure, not decoration.** The embed bar is `accent` (brass) for teams — neither side — and
  the winner's side colour for a result. A teams embed tinted blue would look like a prediction.

Embed bar colours, as the integers the API passes:

| | hex | int |
|---|---|---|
| blue (side 100) | `#6BA5F7` | `7054839` |
| red (side 200) | `#EA6F69` | `15363945` |
| accent | `#E0A33E` | `14721854` |

These are the **dark** palette values, because Discord's default is dark and the bar sits on a dark card.

### Teams embed

Structure:

```
color        accent (14721854)
title        Teams are set
url          https://<tonight page>          [dropped when the only honest origin is localhost]
description  <splits.explanation, verbatim>
field 1      name "Sitting out"   block   value: one sentence           [only if somebody sits]
field 2      name "Seats"         block   value: any move lines, then the side line   [the side line always prints]
field 3      name "Blue · 7695"   inline  value: five lines, lane order
field 4      name "Red · 7595"    inline  value: five lines, lane order
field 5      name "Lobby"         block   value: name and password      [only if known]
footer       Kustom · more on the tonight page
timestamp    now
```

**The rotation goes above the teams** (revised 2026-09-09, reading the shipped M3.1 JSON; M3.1 shipped these
two fields *after* `Blue` and `Red`, which is the one place the code and this file disagree). The web puts the
sit-out strip above the team cards on a stated rule: *if you are sitting out, everything under it is not about
you, and you should learn that before you scan for your name.* That rule is stronger in Discord, not weaker.
Ten rating lines plus a wrapped explanation is about one phone screen, so `Swap: Omar out, Nadia in.` — the one
line in the message that has to happen before anybody can play — was landing below the fold. On a ten-person
night neither field existed and the embed was byte-identical to what shipped; on an eleven-person night
everyone else pays two short lines to put the instruction above the fold. Discord groups *consecutive* inline fields, so
a block field in front of `Blue` and `Red` does not break their pairing. *(Amended 2026-09-11: `Seats` is now
on every teams post, because the side line below always prints. The rotation lines still come and go with the
night; the ten-person post gains one sentence in the same field and nothing moves.)*

**The side line is the last line of `Seats`** (M4.7 (b), placement designer 2026-09-11; the words are
product's, M4.3, and are the two the tonight page prints). `Move to your side in the lobby.` — or `You'll be
moved to your side — if not, move yourself.` when the auto side switch is on — closes the block, **under** any
`Swap:` or `take the open slot` line and never above one: a move line names two people and has to be read
first, the side line is addressed to all ten. **It always prints**, so `Seats` becomes a field on every teams
post rather than only on a night somebody rotates, and M3.13's order already puts that field above `Blue` and
`Red`, which is where an instruction belongs. One line, never per person — naming who is on the wrong side is
stale the second somebody moves — and no field of its own: a `Sides` heading over one sentence is a heading
over one sentence, and the sentence is already about seats.

Line format inside a side field, one per role in lane order:

```
`top` Hana · 1434
```

Off-role players get ` · off-role` appended to their own line, so the fact survives being read on its own; the
description already names them in a sentence.

Filled in with the worked example (`docs/00-product.md`, split 1):

> **Teams are set**
>
> Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.
>
> **Seats**
> Move to your side in the lobby.
>
> | **Blue · 7695** | **Red · 7595** |
> |---|---|
> | `top` Hana · 1434 | `top` Omar · 1469 |
> | `jungle` Iris · 1578 | `jungle` Rami · 1638 |
> | `mid` Karim · 1551 | `mid` Nadia · 1266 |
> | `adc` Bilal · 1713 | `adc` Lena · 2088 |
> | `support` Theo · 1419 | `support` Yuki · 1134 |
>
> **Lobby**
> `customs-night` · password `4471`
>
> Kustom · more on the tonight page

The exact strings the API builds:

```
title        Teams are set
description  Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.

field 2 name   Seats
field 2 value  Move to your side in the lobby.

field 3 name   Blue · 7695
field 3 value  `top` Hana · 1434
               `jungle` Iris · 1578
               `mid` Karim · 1551
               `adc` Bilal · 1713
               `support` Theo · 1419

field 4 name   Red · 7595
field 4 value  `top` Omar · 1469
               `jungle` Rami · 1638
               `mid` Nadia · 1266
               `adc` Lena · 2088
               `support` Yuki · 1134

field 5 name   Lobby
field 5 value  `customs-night` · password `4471`

footer         Kustom · more on the tonight page
```

**Budget, and the last-resort guard** *(amended 2026-09-11 for **M4.12**; the old half-sentence "do not
truncate the field" is now false, and the half in front of it is not)*. A side field is ~110 characters
against the 1024 limit, so a name would have to be ~180 characters to threaten it: nothing this section draws
is expected to be cut, and no layout here is designed around being cut. **The 32-character name rule stands
and is still the real defence** — a display name is truncated at 32 with `…` at the source, before escaping,
so the word in `splits.explanation` and the word in the field are the same word.

Behind it, and only behind it, **M4.12's shared guard** holds every value inside Discord's limits — 1024 a
field value, 256 a title, 4096 a description, 2048 a footer, 6000 the message — so that a pathological night
cannot 400 the whole webhook and cost the group the post. It is a guard, not a layout: if it fires on an
ordinary night, the fix is the line that grew, not the limit. Three rules make it a design decision rather
than a `slice`:

- **It cuts on line boundaries**, never mid-line and never mid-word. Half of `Swap: Omar out, Nad` is a
  message that looks corrupted; a missing line is a message with fewer lines in it, which is what actually
  happened.
- **It drops the lowest-priority lines first**, so what survives is what the field exists to say: the **side
  line** in `Seats`, the **first line of each award** in the window post, and the **top rows** of a board. A
  `Seats` field cut back to its instruction is still an instruction; cut back to nine `Swap:` lines and no
  instruction it is a list.
- **One `…` line marks the gap** — the character alone on its own line, **at the cut and not at the end of the
  field**, plain text, no count and no `and 3 more`. It is the same mark the 32-character name rule uses, so
  one character means "there was more here" everywhere in the message; a count is a number the reader can do
  nothing with and one more thing that can be wrong; and putting it where the lines were removed is what says
  *which* part is missing. Whoever wants the rest opens the tonight page, which the footer already points at.

**The title on a reroll** (product, 2026-09-09, for M3.2). A reroll is a new message, never an edit of the
old one, and the title says how far down the list the group has gone: `Teams are set · reroll 1 of 2` for
split 2, `Teams are set · reroll 2 of 2` for split 3. Split 1 keeps the plain `Teams are set`, including when
an admin promotes it back. Nothing else about the embed changes — same accent bar, the promoted split's
explanation verbatim, the same ten. `of 2` is there so the second one reads as the last one without anybody
having to be told there is no fourth split; the web strip carries the sentence for the friend who presses
again (`No more splits. …`, above).

**Names, in every line of both embeds.** One renderer (`renderName`): the newest display name we have,
trimmed; `Someone` when we have none (M3.10); 31 characters and `…` when it is longer than 32. A blank-looking
line in a five-line field reads as a bug, which is why the fallback is a word and not an empty string.
`Someone` is never written to a **row**: `players.display_name` and `players.game_name` stay null, so the
next sweep or end-of-game block fills the real name in with no migration and no cleanup. It is not only a
rendering rule, though (amended 2026-09-09, M3.15): it is also the name the API hands the balancer, so it is
the word inside `splits.explanation` — a stored sentence the embed and the tonight page quote verbatim and may
never recompose. One word in both places, or one message reads `Someone` on a team line and
`Next best: swap Unknown and Hana` in the sentence above it. See the 2026-09-09 row in `04-decisions.md`.

A name is printed as **text, not markup**. Riot IDs carry underscores and asterisks, and a single stray
backtick closes the role's code span and swallows the rest of the field. Escape `` ` ``, `*`, `_`, `~` and `|`
with a backslash inside `renderName` — **last**, on the already-truncated string, so a backslash can never be
sliced away from the character it escapes and the 32 characters stay 32 characters as read. There is no name
we want rendered as italics.

**The `Lobby` field has three shapes**, and the third one is the code's, recorded here because it was missing:

```
`customs-night` · password `4471`     both known
`customs-night`                       no password (every lobby before M4.1)
Password `4471`                       a password with no name
(no field at all)                     neither
```

Never `password: —`, never the word `unknown`, never an empty field. The capital `P` in the third shape is
correct: there it starts the sentence, where in the first shape it is mid-line after the name.

**When there is no `url`** — a dev machine, or any origin that resolves to localhost, which `tonightPageUrl`
drops rather than post a link that works for one person — the title is not a link, so the footer must not
promise one. The footer is then `Kustom` alone. A footer that says "more on the tonight page" over an
unlinked title is the message telling a friend to tap something that is not there.

Sit-out fields, when they exist — copy (product, **M2.15**, 2026-09-08; shipped verbatim by M3.1). Two
independent fields: `Sitting out` answers "who is not playing", `Seats` answers "who has to move", and those
are not the same question. Each appears only when it has something to say.

```
field 1 name   Sitting out
field 1 value  Sitting out: Omar — most games tonight.
               (…and when everyone around has played the same number tonight, the clause is
                `— longest since they last sat out.` Always "they".)
               (…and when they are tied on games *and* nobody around has ever sat out — the
                first balance of a night with a fresh group — the clause is
                `— nobody has sat out before, so somebody had to be first.`)

field 2 name   Seats
field 2 value  Swap: Omar out, Nadia in.
               Yuki is playing — take the open slot.      [a mover with nobody to swap with]
```

**Three reason clauses, not two** (product, 2026-09-09). `— longest since they last sat out.` is true on the
first balance of a night — nobody has sat out, so everybody has been waiting the longest possible time — and
vacuous, which is worse than useless: it states a fact about a history that does not exist, and the friend
reading it goes looking for the night they sat out and cannot find it. What actually happens on game one is
that everyone ties on games and on sit-outs and the comparator falls through to PUUID order, which is to say
it is arbitrary. So the clause says that, in the words a friend would use: `nobody has sat out before, so
somebody had to be first.` It does not say "random" or "the bot drew a name", because it is neither — the same
person is picked every time until somebody plays a game, and a friend told it was a draw will ask for another
one. From the second game of the night on, the two existing clauses are true and this one never appears again.

The value repeats the field name (`Sitting out` / `Sitting out: Omar …`) and that repetition stays. Inline
fields re-wrap and a field can be read alone, quoted alone, or screenshotted alone, so the sentence carries its
own subject. A field whose value only makes sense under its bold heading is a field that breaks the first time
Discord re-flows it.

This supersedes the earlier single-sentence version of the sit-out field (`Sara and Deniz` / "Each game goes to
whoever has played least tonight…"), which stays as it is on the **web** sit-out strip above: the strip is a
paragraph a friend reads on a page, the embed field is two short lines in a channel. M2.15 is the source of the
embed copy and `lib/discord/embeds.ts` is the only place it is composed.

Filled in, eleven around, all tied at zero games tonight (this is the case
`discord.integration.test.ts` pins, with the group's placeholder names):

> **Teams are set**
>
> Even 50%. Everyone on a main role. Gap 0. Next best: swap Player4 and Player5, gap 0.
>
> **Sitting out**
> Sitting out: Player0 — nobody has sat out before, so somebody had to be first.
>
> **Seats**
> Swap: Player0 out, Player10 in.
>
> | **Blue · 6000** | **Red · 6000** |
> |---|---|
> | *the ten who are playing, five a side, lane order — Player10 among them and Player0 not* | |
>
> **Lobby**
> `customs-night`
>
> Kustom · more on the tonight page

Two fields, not one line: the sitter reads the first and stops, the mover reads the second and acts, and
neither has to work out which half of a compound sentence is about them.

**Sums are not the gap.** `7695` and `7595` are the sums of five display ratings. Their difference equals the
`Gap 100` in the explanation only because nobody here is off-role; the gap is computed on effective
(role-adjusted) skill. The field name is therefore just `Blue · 7695`, with no label — the embed never claims
the two numbers are the same thing, and the explanation line is the only place the word "gap" appears.

### Result embed

```
color        winner's side colour
title        Red wins · 34:12
url          https://<tonight page>                          [same localhost rule as the teams embed]
description  Blue was favored 54%. Top damage: Lena, 47.3k.  [absent when it would be empty]
field 1      name "Blue"   inline   five lines: new rating and delta
field 2      name "Red"    inline   five lines: new rating and delta
field 3      name "​"  (U+200B)      one line: MVP <name> · ACE <name>   [absent entirely when the game has none]
footer       Kustom · game 47                                ["Kustom" alone if the game cannot be counted]
timestamp    game end
```

**Field 3 is the MVP / ACE line (M7.10, added 2026-09-16).** Three things about it are the design and not an
implementation detail:

- **Its name is a zero-width space (U+200B), not a heading.** Product wrote one line *under* the two columns
  and wrote no heading for it; a field is the only place in an embed that is under two inline fields (the
  description is above them, the footer is `Kustom · game 47`'s), and Discord rejects a field whose name is
  the empty string. The name is therefore a character that takes no room and says nothing, and the line reads
  as a line. Never a real heading — no `Award`, no `MVP`, no `Standouts`.
- **It is not inline**, so it sits under the two columns rather than becoming a third one beside them.
- **It is the last field, and that ordering is load-bearing.** `guardEmbed` sheds from the last field backwards
  when a post is over Discord's 6000 characters (M4.12), so this is the first thing the post gives up and the
  ten rating rows are never cut to make room for it.

**Absent entirely, never empty.** A game with no MVP and no ACE — a component missing, a role the client never
reported, a remake, an ARAM, anything the fold did not rate, any game played before M7.7 — adds **no field at
all**, and the post is byte-identical to the two-field one this group has read since M3.3. Never an empty
field, never a dash, never `unknown`, never a heading with nothing under it.

**Amended 2026-09-10 (product, with M5.12): the footer is `Kustom · game 47`, not `Season 1 · game 47`.**
Seasons are gone from everything a friend reads (`04-decisions.md`), so the left half becomes the product's
own name — the same word in the same place as the teams embed's `Kustom · more on the tonight page`. Exactly:
`` `Kustom · game ${gameNumber}` ``, and `Kustom` when `gameNumber` is null. This supersedes the clause in
**M3.21**'s acceptance that kept `Season 1 · game 12`; the count it was keeping is kept, the container it
named is not.

**The count is the group's all-time game number**, and that is the only reading it has: every game stored
with a `started_at` at or before this one, rated or not, counted at the moment the post is written. `game 47`
means the forty-seventh custom Kustom has on record — **not** the forty-seventh tonight, which is a number
the tonight page already carries and which the footer would have to run a second query to learn. A game
backfilled into an older night shifts the numbers after it, and no post is ever edited to match; a footer is
a stamp on a message, not a row in a table.

`Kustom` alone in the footer is right and needs no apology (product, 2026-09-09, unchanged): the game number
is a count, and a count we could not take is simply not printed. Never `game ?`, never `game 0`, never a
sentence explaining that something did not add up. Nobody reading a footer has asked a question yet. It is
also the fallback the teams embed already has, so the two messages fail the same way.

The embed exists only for a game the rating fold actually rated. A remake, a four-minute surrender, a
scoreboard that is not five a side, **an ARAM** (M7.1, 2026-09-15: the Howling Abyss is recorded and never
rated), the second companion's re-post: no message. There is no "no ratings this game" variant, because the
whole message is what the game did to ten ratings and an embed that says nothing is worse than silence. **The
teams post is unaffected**, so an ARAM night is a teams post followed by silence — which is the honest shape
and is not a bug report: the game is on `/games`, on `/fun?queue=aram` and on everybody's own page, and the
only thing that did not happen is the thing that did not happen to anybody's rating.

Line format, deliberately the same shape as the teams embed so the two messages read as one scoreboard:

```
`adc` Bilal · 1668 (-45)
```

Filled in — Red wins the worked example, the underdog at 46%. **These are `rateGame`'s numbers** (M3.3,
2026-09-08: the earlier hand-computed version of this table was replaced by the output of the `openskill`
package, pinned as a snapshot in `apps/web/lib/discord/embeds.test.ts`):

> **Red wins · 34:12**
>
> Blue was favored 54%. Top damage: Lena, 47.3k.
>
> | **Blue** | **Red** |
> |---|---|
> | `top` Hana · 1393 (-41) | `top` Omar · 1510 (+41) |
> | `jungle` Iris · 1531 (-47) | `jungle` Rami · 1683 (+45) |
> | `mid` Karim · 1508 (-43) | `mid` Nadia · 1316 (+50) |
> | `adc` Bilal · 1668 (-45) | `adc` Lena · 2127 (+39) |
> | `support` Theo · 1372 (-47) | `support` Yuki · 1182 (+48) |
>
> MVP Lena · ACE Iris
>
> Kustom · game 47

The shape the hand version predicted survived contact with the package — Nadia at σ 5.10 moves most, Lena at
σ 4.50 moves least — but every individual number moved by one or two points, which is why nothing here may be
retyped by hand again. Duration and top damage are still invented; the docs pin no result for the worked
example.

**The award line on this roster is `MVP Lena · ACE Iris`**, pinned in `embeds.test.ts` against the same worked
input. Red won, so the MVP is Red's `adc` and the ACE is Blue's `jungle`, and the MVP is named first because
the winning side is — the same reason Blue's column is printed first whichever side won. Neither name carries
its role, its score or its delta: the ten lines above already say all three.

**On this roster the two columns do happen to cancel** (−223 and +223), which the hand-computed version did
not (it had −228 and +231). They are not guaranteed to: movement scales with each player's own σ² and the two
sides' σ² sums are not equal, so the cancellation here is arithmetic luck, not a property. The rule is
unchanged and it is a rule about the embed, not about the numbers: **the result embed prints no team totals.**

Losers keep their side's field first-or-second position by side number, never reordered to put the winner
first: the two embeds must line up so that "my column" is in the same place both times. That includes the
vertical order inside a column: lane order, top to support, the same five positions as the teams embed. A
player whose role neither the scoreboard nor the stored split knows is printed without a role — the name
starts the line — and sorts after the five who have one, so the known rows never move to make room.

**The four number formats, so no surface invents a fifth.**

| | rule | reads |
|---|---|---|
| duration | `m:ss`, and `h:mm:ss` once past the hour. No zero padding on the leading unit, no `min`, no `34m 12s`. | `34:12`, `1:02:03`, `0:59` |
| delta | signed always, ASCII `+` / `-`, `+0` and `-0` for a change too small to round to a point | `(+43)`, `(-45)`, `(-0)` |
| damage | one decimal and `k` from a thousand up, the plain integer below it | `47.3k`, `1.0k`, `940` |
| odds | past tense, the favourite named, whole percent; when nobody was favoured, no number | `Blue was favored 54%.` `Red was favored 58%.` `Neither side was favored.` |

The coin flip is the one clause that is **not** core's words. Core's explanation line says `Even 50%.` and
that is right where it sits — first clause of a present-tense list, before the game, next to `Gap 0.` In the
result embed the same fragment lands under the headline `Red wins · 34:12`, in a line whose other half is a
full past-tense sentence, and it reads as a claim about the game that was just played rather than about the
prediction: *even, 50%* beside *Red wins* is a scoreline until you read it twice. It is also the common case
on the first night the group ever uses this — everyone unrated, every split gap 0 — so it is the first
result sentence anybody reads. Product, 2026-09-09: the result embed says `Neither side was favored.` The
number is dropped with it because 50% is what "neither" means and the percent was only ever there to carry
the size of the claim. Core's `Even 50%.` in the teams explanation is unchanged and stays core's.

**`-0` is a real value and it does not survive JSON.** `displayDelta` returns negative zero for a rating that
fell by less than half a point, and `formatDelta` asks `Object.is` before it looks at the sign. Anything that
carries a delta through `JSON.stringify` — an API response, a cached payload — turns `-0` into `0` and prints
`(+0)` on a row that went down. So a delta is computed where it is rendered and never transported. This is the
rule the tonight page and `/p/[puuid]` inherit (M3.4, M3.8), not just the embed.

**If the two columns wrap on a phone, drop `inline`.** `` `support` Theo · 1372 (-47) `` is 27 characters, and
a Discord mobile inline field is about half the message width. If that wraps to two lines, a five-line column
becomes ten ragged ones and the column stops being a column. The fix in that case is to make both result
fields full-width block fields — `Blue` above `Red`, five clean lines each — and **not** to shorten the line:
the role, the name, the new rating and the delta are the entire content. The teams embed's lines are six to
eight characters shorter and are expected to survive; if they do not, they take the same treatment. Decide this
by looking at one real post on one real phone, not from the JSON.

### Fearless embed (M10)

A second message after the result, never a field on it. Accent bar — the list is neither side's.

```
color        accent (14721854)
title        Fearless
url          https://<tonight page>          [dropped when the only honest origin is localhost]
description  Ban these next game. 10 champions.
fields       one block field per non-empty lane, names `top` / `jungle` / `mid` /
             `adc` / `support` / `other`, value: one name per line, A–Z inside the lane
             (M10.2; was one `Champions` field in lock order)
footer       Kustom · more on the tonight page
timestamp    now
```

Empty pool is not posted. An admin reset posts the same title with description
`Pool cleared. Ban list is empty.` and no fields.

### Nightly leaderboard embed (M3.5)

One field, block, no columns — a ranked list is a single column by nature and inline fields would break it
across a row.

```
color        accent
title        This week · leaderboard      <- M5.12: the window, never a season name
url          https://<leaderboard>?window=this-week
field 1 name   Top ten          <- only when ten lines print; otherwise `The board`
field 1 value  `1` Lena · 1548 · 41 games
               `2` Bilal · 1137 · 44 games
               ...
timestamp    the moment the post is made, ISO 8601
footer       Every week starts everyone on the same rating on Sunday, so these numbers swing, and two clean
             wins can top a longer patchy week. All time is the settled one, and the one that makes teams.
```

**The number in this post is the weekly `Rating`, not Proven** (M7.3, 2026-09-15). The nightly post reads
`this-week` and the Sunday post reads `last-week`, so both are the weekly track: the figure after the name is
`round(mu × 60)` off that week's from-scratch fold, the list is ordered by it, and the footer is the week's
sentence and not Proven's. **Only the monthly post still prints Proven and Proven's footer.** The rule under
all of it is unchanged and is the reason this section exists: a one-number list shows the number it is ordered
by. What moved is which number that is, per window, and the two strings cannot be swapped by hand — one
`boardFooter(track)` picks the footer and one `boardLegend(track)` names the column on the page, so the post
and the page a tap later cannot disagree about which board the reader is on.

The timestamp is what tells a reader scrolling back next week *which* night's board this was; both other
embeds carry one. This block lists only the fields that carry a design decision — it omits `description` for
the same reason.

**The field name follows the count** (product 2026-09-10, M3.22). The field is named `Top ten` only when ten
lines actually print. With fewer than ten it is named `The board`. The trigger is the number of lines, not the
size of the group: on a night when eight friends are seeded and eight lines print, `Top ten` is a promise the
post does not keep — that list is not the top of anything, it is everyone. With exactly ten on the board both
readings are true and `Top ten` is right, which is why the rule is worded on the lines and not on the roster.
`The board` is not a new word for the page: it is the first two words of the settling sentence both web pages
already print, and it stays lower case after `The` so it reads as a heading over a list rather than a second
name for `Leaderboard` (the one-thing-one-name rule the title follows). One constant in
`apps/web/lib/discord/embeds.ts` (`leaderboardEmbed`).

On a **Proven window** — which, since M7.3, means the monthly post and nothing else — the number after the
name is the **Proven** number (`round(ordinal × 60)`) and the list is ordered by it, descending. The embed
prints one number either way: a one-number list must show the number it is ordered by, and a second number in
a proportional font with no column to sit in is unreadable. `Rating` is on the web page.

The worked example below is that Proven shape, kept because the arithmetic under it is the thing worth
keeping. **Read it as `Last month · leaderboard`**; a nightly or Sunday post has the same five parts with the
weekly `Rating` in the number column and the week's footer under it.

Filled in with the worked example's ten (`docs/02-milestones.md` M1.4 table — `ordinal = mu − 2σ`, then
`× 60`, rounded once). Game counts are illustrative; the docs pin none:

> **Last month · leaderboard**
>
> **Top ten**
> `1` Lena · 1548 · 41 games
> `2` Bilal · 1137 · 44 games
> `3` Rami · 1062 · 39 games
> `4` Iris · 990 · 38 games
> `5` Karim · 987 · 40 games
> `6` Omar · 917 · 42 games
> `7` Hana · 882 · 37 games
> `8` Theo · 831 · 38 games
> `9` Nadia · 654 · 28 games
> `10` Yuki · 534 · 24 games
>
> Proven is your rating minus how unsure the board still is about you, and it settles after about 30 games.

The arithmetic, so nobody has to redo it: Lena `34.80 − 2 × 4.50 = 25.80`, `× 60 = 1548`. Omar
`24.49 − 9.20 = 15.29`, `× 60 = 917.4 → 917`. Iris and Karim land 3 points apart (`990` / `987`) on a `1578` /
`1551` rating gap of 27 — Proven compresses, and rows will often sit close together. Design for near-ties: the
number is `t-md` mono tabular and never abbreviated, so `990` above `987` reads as ordered rather than equal.

Note the order is not the Rating order. Nadia (`1266` rating, `654` Proven) sits below Theo (`1419` / `831`)
on both, but Yuki at `1134` rating is last on Proven by a wider margin than her rating suggests, because her
σ is the second highest in the room. That is the whole point of the column, and it is why the footer sentence
ships with every one of these posts and not just the first.

Nadia and Yuki are under 30 games in this example, so on the **web** leaderboard both carry the `settling`
chip — on a Proven window, which is the window this example is. A week board has no chip on any row (M7.3).
The embed has no chip on any window: the footer sentence covers the message, and a `(settling)` suffix per
line would double the length of the two lines that are already about the newest players.

## Implementation notes for the web engineer (v1 — token block superseded by Floodlit)

> The `tokens.css` block below is the **v1** file. The shipped file matches it; Floodlit replaces it. "The
> admin area", "The tonight page's three states — one rule" and the state table underneath are
> current and are not superseded. The 2026-09-08 "stays plain" rule is superseded: admin now adopts
> the tokens and keeps its own shell.

### Tokens as CSS custom properties

New file `apps/web/app/tokens.css`, imported once from `apps/web/app/layout.tsx`. Prefix every custom property
`--cn-` so nothing collides with a library later.

```css
:root {
  color-scheme: dark light;

  --cn-bg: #12151a;
  --cn-surface: #1b2027;
  --cn-text: #e7eaef;
  --cn-dim: #97a0ad;
  --cn-blue: #6ba5f7;
  --cn-red: #ea6f69;
  --cn-accent: #e0a33e;

  --cn-hairline: color-mix(in srgb, var(--cn-text) 14%, transparent);
  --cn-blue-tint: color-mix(in srgb, var(--cn-blue) 7%, var(--cn-surface));
  --cn-red-tint: color-mix(in srgb, var(--cn-red) 7%, var(--cn-surface));
  --cn-accent-tint: color-mix(in srgb, var(--cn-accent) 10%, var(--cn-surface));

  --cn-sp-1: 0.25rem;  --cn-sp-2: 0.5rem;  --cn-sp-3: 0.75rem;  --cn-sp-4: 1rem;
  --cn-sp-5: 1.5rem;   --cn-sp-6: 2rem;    --cn-sp-7: 3rem;     --cn-sp-8: 4rem;

  --cn-t-xs: 0.75rem;  --cn-t-sm: 0.875rem;  --cn-t-base: 1.0625rem;
  --cn-t-md: 1.25rem;  --cn-t-lg: 1.625rem;  --cn-t-xl: 2.25rem;

  --cn-radius: 6px;
  --cn-radius-chip: 3px;
}

@media (prefers-color-scheme: light) {
  :root {
    --cn-bg: #f3f4f6;
    --cn-surface: #ffffff;
    --cn-text: #161a20;
    --cn-dim: #5b6573;
    --cn-blue: #1f5fc4;
    --cn-red: #b4302b;
    --cn-accent: #8e5b0e;
  }
}
```

Only the seven change between themes; every derived value follows for free. `color-scheme: dark light` (dark
first) makes scrollbars, form controls and the pre-paint background follow the same choice, so there is no
white flash opening the link in a dark room.

There is **no theme toggle** in M3. `prefers-color-scheme` is the whole switch. A toggle needs storage, a
server/client mismatch guard and a control in the header, and nobody has asked.

### Fonts

`next/font/google` in `apps/web/app/layout.tsx`, exposed as variables, `display: 'swap'`, `subsets: ['latin']`:

```
Archivo        -> --cn-font-sans   weights 400, 600, 700
IBM_Plex_Mono  -> --cn-font-mono   weights 400, 600
```

Put the generated class on `<html>`, and set `font-family: var(--cn-font-sans)` on `body`. Add a `.cn-num`
utility that sets `font-family: var(--cn-font-mono)` and `font-variant-numeric: tabular-nums`, and use it on
every rating, delta, gap, percentage, duration, rank number and role label. Fallback stacks are in the Type
section; put them in the CSS variable, not only in the `next/font` fallback array, so a blocked Google Fonts
request still lands on Helvetica/Menlo rather than Times.

### The admin area

`/admin` adopts the same nine tokens, type, cards and Day/Night as the rest of the product
**(2026-09-21; supersedes "The admin area stays plain")**. It keeps its own shell — a sidebar of
destinations, not the friend-facing top bar — because it is an ops surface for five people on a
laptop, not a WhatsApp link. Native `<form>` controls stay native; they are dressed with the
tokens rather than replaced.

Rules that stay:

- No client JavaScript beyond `AdminForm`, `AdminAnswerGroup`, `AdminNav` and the theme switch.
  Every write is still a real `<form>` posting to `/api/admin/*` (or `/api/me/lobbies/start`).
- Copy is unchanged. A redesign does not rewrite a sentence an admin has already learned.
- Colour is still a team, a state, or nothing. Destructive writes (revoke, remove admin, reset
  fearless) outline in `red`; primary writes (start a lobby, mint, sign in, save) outline in
  `brand`. Never a filled red block.
- The public shell stays off this route: `/admin` is still outside `(site)`.
- `.admin` uses `--cn-font-sans` / `--cn-font-mono`, not `system-ui`. The old system-font rule
  existed only to keep the area plain after the root layout set Archivo on `body`.

### The tonight page's three states — one rule

M3.4 does not get to invent its own state model. The page renders **exactly one primary block**, chosen from
`lobbies.status` for the newest non-abandoned lobby today, plus at most one secondary block:

| `lobbies.status` | header strip reads | primary block | secondary block below |
|---|---|---|---|
| no lobby, or `abandoned` | `Nothing tonight` | Idle: one sentence, and a link to the leaderboard | — |
| `open` | `<n> in the lobby`, live dot | Lobby member list | — |
| `balanced` | `Teams set`, live dot | Sit-out notice, team cards, explanation line | — |
| `in_game` | `In game`, live dot | Sit-out notice, team cards, explanation line | — |
| `finished` | `Final` | Result card: headline, prediction line, the two team cards with **after** ratings and deltas, top damage | The explanation line of the split they played |

**The finished state, said once (M3.16, designer, 2026-09-09).** An earlier version of this row listed
"team cards and the explanation line" as a secondary block *under* the result card, and the "Result card"
component already puts both team cards inside the result card with the after ratings. Read together they put
two ratings for the same player on one screen, which is a bug report waiting in voice. Product's rule for M3.4
is **one rating per player per screen**, and the result card's is the one. So: the finished state renders the
result card and, under it, the explanation line of the split they played — and nothing else. There is no
second pair of team cards, before or after. The built page (M3.4) took this answer; this file now says the
same thing in both places.

A `finished` lobby whose game the rating fold did not rate — a remake, a four-minute surrender, **and since
M7.1 an ARAM** — has no result card to draw: the header reads `Final`, the teams block and the explanation
line stay up as they were, the strip's sentence slot keeps its height and says nothing, and there are no
deltas. No banner apologising for it; Discord stays silent about these games too. **This is the only place an
ARAM night reaches the tonight page, and it is correct**: no headline in the winner's colour, no ratings, no
`MVP` line, nothing that would read as a rated result. The one thing this state does not do is *say* which of
the reasons it was, and product has ruled since 2026-09-09 that it should not — the page has no apology to
make. The reason lives in `00-product.md` ("Only Summoner's Rift customs move the number") and, for a reader
who goes looking, on `/p/[puuid]`'s `not rated` row, whose hint has named ARAM first among its reasons since
M7.17 (2026-09-16).

Idle copy (product, 2026-09-08 — final), the same sentence the placeholder page already carries from M1.10 so
the wording does not change under people when M3.4 lands: `When ten of you are in a custom lobby with the
companion running, the teams show up here.` Under it, a link reading `Last night and the board`. Nothing
else: no illustration, no spinner, no "check back later". The header strip already says `Nothing tonight`, so
the body does not repeat it.

**No season active — the tonight page's own sentence (product, 2026-09-09 — final; M3.17).** `/admin`, the
seasons page and the companion's 503 all say `No season is active, so games cannot be saved. Start a season on
the Seasons page.` — one constant, `NO_ACTIVE_SEASON_MESSAGE` (M2.18). The tonight page does **not** say that.
It is the link that gets pasted in WhatsApp, so it is read by the whole group, and it would end by telling
twenty friends to open a page one of them can open. Its sentence is:

> No season is active, so tonight's games are not being saved. An admin can start one.

Same fact, no instruction the reader cannot follow, and no link to a locked door. It is not a state — it can
be true while the page is idle, filling, showing teams or showing a result — so it sits at the top of `main`,
directly under the header strip and above the primary block, in all four states. It is the one element on this
page that is ever additional to the state table above; it never replaces a block, and it is absent entirely
whenever a season is active. The treatment is the designer's call; the words are product's, and a change to
them goes through product.

The rule, in one sentence: **a state change replaces the primary block in place; the page never appends, never
scrolls itself, and never animates anything but a 150ms opacity fade.** The header strip is always mounted and
is the only element that survives every transition, so a phone reopened mid-night answers "where are we" in
one glance without scrolling.

Corollaries the implementation must respect:

- The lobby member list reserves ten rows of height, so the 9→10 transition does not move the page.
- `balanced` and `in_game` render the identical block. The only difference is the header word and the live
  dot; the teams do not re-render, do not re-fetch and do not fade.
- The explanation line is always the stored string of the currently promoted split (`splits.is_chosen`), on
  every state that shows teams, including after a reroll (M3.7).
- Realtime updates mutate state, never scroll position or focus. Someone tapping their role (M3.6) when the
  tenth player joins must not have the page move under their thumb.
- The header's live dot is the only pulsing element on the page, 2s opacity cycle, `accent`, and it stops at
  `finished`.

## What this design does not do (amended by Floodlit: one gradient, one glow)

Listed because each one is a thing a page like this drifts into:

- No emoji anywhere — not as section markers, not as side icons, not in embed field names, not for
  win/loss. The role words are the icons.
- No cream backgrounds, no serif display face, no purple or teal gradient, no acid green on black, no glass
  blur, no neon glow, no dark-mode-with-a-single-saturated-accent-everywhere.
- No champion art, avatars, crests, "VS" badges, or animated win banners. There is no asset pipeline and there
  should not be one. **Two surfaces, one exception (M11 + M12):** a 24×24 square champion icon on fearless
  chips on `/` and on the optional overlay's fearless block, loaded by champion id at runtime with no
  pipeline ("The fearless icon exception"). It covers no other surface.
- No skeleton shimmer. A dark room does not want a moving grey rectangle; empty states are one sentence.
- No toasts. Realtime already changes the thing you are looking at.
- No numbers rendered in a proportional font, ever.

## The daily game — Daily Mystery and Guess the Award (M5.32, extended by M8.4)

One accountless guessing game per civil day, on `/` and `/mystery`. Since M8.4 there are **two** games and
they alternate civil days: **Daily Mystery** (a standout-or-disastrous stat line, guess whose it is) and
**Guess the Award** (the best number in one game in one category, guess whose it is). One challenge per day
either way, so nothing about the card's shape changed: one card, one route, one countdown, one row in
`daily_mysteries`.

Floodlit's own rules still win: no emoji, no named leaderboard, no purple, no champion art. The visitor is a
cookie. The League player is the one on the scoreboard. Those are different people and the page never
pretends otherwise.

**The card never names the rotation.** It does not say "today is award day", does not explain the parity, and
never promises what tomorrow is — the card is whatever it is, and the two sentences that used to promise
another *case* or a `Next mystery` were each wrong by exactly one day. The one surface that does name today's
game is the one that has already loaded it: the card's own heading and `/mystery`'s `<title>`.

- **The day's question is the large type; the hook under it is what changed.** The heading is the category
  (`Disaster class`, `Most gold`), then the kicker (`The crime` / `The award`), then `Someone in our customs
  went` and the **KDA in the display cut on both games**, then two or three hook lines. On a mystery day
  those lines are the category's own (deaths, kill participation, CS, damage taken, duration); on an award
  day they are exactly two — **the award's own number under its own label**, then the duration. That is the
  whole above-the-fold card.
- **Six names, two columns, 44px.** Same button recipe as reroll. A second tap locks the guess. There is
  no username field. Identical on both games: the question is always *who*.
- **Clues are a list, not a quiz.** `Clue 1 · Champion` then the word. Reveal is one button under the
  names. The page never prints a clue the visitor has not asked for. The clue ladder is the same eight
  types on both games.
- **After the lock, the card becomes the case file.** Correct / Wrong, `It was <name>`, the full
  performance, then `Who did everyone blame?` — `Who did everyone pick?` on an award day — as labelled bars,
  with `Most falsely accused: <name>` / `Most wrong picks: <name>` under them. Nobody is *accused* of winning
  an award, which is the whole reason those four sentences fork. Community numbers are absent from the play
  state because they are not in the props.
- **The award's own number is the first row of the performance panel, and it is never inferred.** It is read
  off the revealed scoreboard by the same function the hook used, so the day's premise and the day's reveal
  cannot print two different numbers. Four of the seven awards (gold, vision, mitigation, objectives) are not
  otherwise rows in that panel, and before M8.4's fix pass those days settled without ever showing the number
  they were about. The two that *are* rows (damage, CS) print once, in the award's row, and the duplicate
  below is dropped.
- **A column the database never stored reads `Not recorded`, never `0`.** Vision score, damage mitigated and
  objective damage arrived with migrations 0014 / 0015 (M7.7, M7.14); a game older than the backfill has no
  number, and null is not zero. It prints in `text`, not mono — it is a sentence about the absence of a
  number, not a number.
- **First Detective is a sentence, not a medal.** Brand colour, no trophy. Later visitors get `Someone
  has already claimed today's First Detective.` and never a name. The badge keeps its name on both games
  (one `first_correct_at` column, one word for whoever gets today right first); only the sentence under it
  forks, because "solve the mystery" is not what an award day was.
- **Percentile is a bucket** (`Top 5%` … `Top 50%`) or nothing. Under ten correct guesses the page stays
  quiet.
- **Share copies a spoiler-free line.** `Daily Mystery #184 — solved with 1 clue. Top 15%.` or `Guess the
  Award #7 — solved with 1 clue. Top 15%.` Never the player. Each game counts its own challenges, which is
  why 0016 moved the unique to `(kind, challenge_number)` and why `#184` and `#7` sit side by side.
- **Countdown** to the next civil midnight in `CUSTOMS_NIGHT_TZ`, mono, under a hairline. Same clock the
  rotation uses. Not the 06:00 night boundary. **Its label is `Next game` on both games and on the empty
  card** — the clock runs to the moment *the other* game starts, so it names neither.

### An award day, drawn

```
Guess the Award #7                          ← slug, mono t-xs
Most gold                                   ← t-display, categoryLabel
THE AWARD                                   ← kicker, t-xs 0.08em dim
Someone in our customs went
12 / 2 / 8                                  ← the KDA, display cut, both games
  Gold                21.4k                 ← the award's own number and label
  Game                34:12
Who was it?
  [ Nadia ] [ Bahaa ] [ Omar ] …            ← six, two columns, 44px
```

and after the lock:

```
Guess the Award #7
Correct
MOST GOLD · AWARD SETTLED                   ← category, then what became of it
It was Nadia
First detective. You are the first person today to name the right player.
You solved it with 1 clue.
Top 15%

Your result
  Today's award is settled      Correct
  Clues used                    1 clue
  Solved in                     18 seconds
  Your guess: Nadia             Yes

12 / 2 / 8
  Gold                          21.4k       ← the award's row, first
  Champion                      Nidalee
  Role                          JUNGLE
  Damage                        28.9k
  CS                            241
  Game                          34:12 · Mon 15 Sep
  Result                        Won

Today's community
  Attempts 31 · Correct 19 · Wrong 12 · Accuracy 61.3%

Who did everyone pick?
  Nadia   ████████████████   61%
  Bahaa   ███████            26%
  …
  Most wrong picks: Bahaa

Next game                       04:11:57
```

#### Copy — the daily game (M5.32; the award column added 2026-09-16, M8.4)

Every string below is in `apps/web/lib/mystery/copy.ts`. The rule that decided the fork: **a word that names
the thing being guessed about forks; a word that names the visitor, the mechanic or the scoreboard does not.**
A crime, a case, a blame are award-day lies; a clue, a guess, a detective, a percentile are true of both.

| Where | Daily Mystery | Guess the Award | Note |
|---|---|---|---|
| card heading, share prefix | `Daily Mystery #184` | `Guess the Award #7` | `challengeHeading(kind, n)`. Each game counts its own challenges (0016: unique on `(kind, challenge_number)`) |
| kicker over the hook | `The crime` | `The award` | `gameCopy(kind).kicker` |
| kicker over the answer | `Case closed` | `Award settled` | `.closedKicker`, printed after the category on one line |
| result-panel row label | `Today's case is closed` | `Today's award is settled` | `.todayClosed` |
| distribution heading | `Who did everyone blame?` | `Who did everyone pick?` | `.blame` |
| line under the bars | `Most falsely accused: Bahaa` | `Most wrong picks: Bahaa` | `mostAccusedLine(kind, name)`. `Most wrongly named` was rejected in M8.4's fix pass: it reads both ways at once |
| First Detective's sentence | `You are the first person today to solve the mystery correctly.` | `You are the first person today to name the right player.` | `firstDetectiveYou(kind)`. The badge above it is `First detective` on both |
| share, solved | `Daily Mystery #184 — solved with 1 clue. Top 15%.` | `Guess the Award #7 — solved with 1 clue. Top 15%.` | `zero clues` / `1 clue` / `n clues`; the bucket is dropped when there is none |
| share, missed | `Daily Mystery #184 — missed it. There's another one tomorrow.` | `Guess the Award #7 — missed it. There's another one tomorrow.` | **changed 2026-09-16 (M8.4)**, both games — it promised another *case*, and under alternation tomorrow is the other game |
| countdown label | `Next game` | `Next game` | **new 2026-09-16 (M8.4)**, replacing a per-game label. Kind-neutral on purpose: the clock ends when the other game starts |
| nav tab | `Daily` | `Daily` | **renamed 2026-09-16 (M8.4)** from `Mystery`; see "The app shell". `DAILY_LABEL`, imported by `lib/nav.ts` |
| a stat the database never stored | `Not recorded` | `Not recorded` | A null M7.7 / M7.14 column on a game older than migrations 0014 / 0015. Never `0`, never an em-dash |
| the empty day | `No customs to expose yet. Play a few and the first mystery writes itself.` under the heading `Daily Mystery` | *(same)* | Nothing was built, so there is no kind and the card does not guess one. It is the last sentence still naming one game, on the one screen where neither has happened yet; product's string to revisit if a group ever sits on it, not worth a fork today |
| everything else | `Who was it?` · `Guess now` · `Need help?` · `Reveal a clue` / `Reveal another clue` · `Locked in` · `Lock in <name>` · `Back` · `It was <name>` · `You guessed <name>.` · `Correct` / `Wrong` · `First detective` · `Someone has already claimed today's First Detective.` · `Your result` · `Clues used` · `Solved in` · `Today's community` · `<n>% of today's detectives were fooled.` · `Someone in our customs went` · `Copy result` / `Copied` | *(identical)* | One constant each, not two. `detectives` names the visitor, not the thing they were asked about, so it survives an award day |

**The seven awards.** The heading is the day's question; the label is what the number is printed under, in
the hook and again on the reveal. They differ on purpose: `Most vision` is a superlative, `Vision score` is a
column.

| Category | Heading (`categoryLabel`) | Stat label (`awardStatLabel`) | Reads as | Null before |
|---|---|---|---|---|
| `kda` | `Widest KDA` | `KDA` | `5.50` — two decimals, `(K+A) / max(1, D)` | — |
| `damage` | `Most damage` | `Damage` | `41.2k` | — |
| `gold` | `Most gold` | `Gold` | `21.4k` | — |
| `vision` | `Most vision` | `Vision score` | `62` — integer | 0014 (M7.7) |
| `mitigation` | `Most damage mitigated` | `Damage mitigated` | `38.6k` | 0014 (M7.7) |
| `cs` | `Most CS` | `CS` | `241` — integer | — |
| `objectives` | `Most damage to objectives` | `Objective damage` | `19.7k` | 0015 (M7.14) |

The five mystery headings (`Disaster class`, `Monster game`, `Farming simulator`, `Raid boss`, `Where were
you?`) are unchanged by M8.4 and share the same `categoryLabel`.

#### Two notes on the closed card's layout (designer, 2026-09-16 — flags, not defects)

- **The two-part kicker reads well and should stay one line.** `MOST GOLD · AWARD SETTLED` is the day's
  question and its outcome in the order a reader wants them, in the micro-label's own size and colour, under
  a headline that is already `Correct` / `Wrong` — three facts, three weights, no repetition. The one thing
  to watch is width: `MOST DAMAGE TO OBJECTIVES · AWARD SETTLED` at `t-xs` with `0.08em` is about 300px of a
  358px content column at 390, so it wraps on the next phone down and the break lands wherever it lands.
  **The fix, if it is ever wanted, is one property and no markup change**: the two halves are already
  separate `<span>`s, so `.cn-mystery-kicker span { white-space: nowrap }` moves the break to the middot.
  Not requested here.
- **The award's number belongs where it is, but the `kda` day prints one fact twice.** First row of the
  performance panel, under a panel whose heading is the KDA, is the right order — the award is why the day
  existed, and everything under it is context. On a `Widest KDA` day, though, the heading reads `12 / 2 / 8`
  and the row directly under it reads `KDA 5.50`: the same fact in two notations, 8px apart. Harmless, and
  cheaper to live with than a special case, but recorded here so it is not re-discovered as a bug.
- **The play card's biggest number is the KDA on both games.** On five of the seven awards the award's own
  number is a hook line and the display cut belongs to a KDA the day is not about. That is defensible — the
  KDA is the strongest identifying fact the page can show six suspects, and it is the one shape every seat
  has — but it is a design question nobody has actually been asked, so it is a flag for the lead rather than
  a rule. **Do not change it on this pass.**
