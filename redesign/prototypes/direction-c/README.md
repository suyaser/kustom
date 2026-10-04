# Direction C: Floodlit Slate

A static prototype of the Tonight screen for Kustom 2.0, built as 80% Direction A (Broadcast) and 20% Direction B (Scrim Night), with the contrast raised. This is not app code.

The user's verdict on A was "too dark or hard to see". C keeps A's broadcast look and fixes the darkness at the source:
- The page is a dark slate, not near-black.
- Cards sit clearly above the page.
- Borders and seat dividers are visible.
- Secondary text is at least 7:1 on its own surface.
- The sides are colour-blocked, so you can tell them apart at a glance.

In screenshots, the mean luminance of `c-balanced-375.png` is **62.0**, against A's **32.5** and B's 54.4.

## Files

- `balanced.html`: teams set, full receipt, sitting-out note
- `ingame.html`: elapsed timer, a champion on every seat, compact receipt
- `filling.html`: 6 of 10 in, "Still needed: jungle, support", the 4 empty seats as one dashed line
- `receipt.html`: "How the bot decided" open
- `balanced-day.html`: the balanced screen in the Day theme (`<html data-theme="day">`)
- `c.css`: tokens and components. Plain CSS with no framework, so every value is visible.
- `build.py`: builds every page from one data block. It started from `direction-a/build.py`. Run `python3 build.py`.
- `contrast.py`: computes every ratio in this file, plus the Machado colour-vision deltas. Run `python3 contrast.py`.
- `check.js`: the QA probe pasted into Playwright. It checks for names broken mid-word, targets under 44px and horizontal scroll.
- Add `?shot` to a URL to park the phone tab bar at the end of the page for full-page captures.

Screens: `redesign/screens/c-{balanced,ingame,filling,receipt}-{375,1440}.png`, `c-balanced-768.png`, `c-balanced-day-{375,1440}.png`.

## What came from A and what came from B

**From A (the 80%)**
- The lower-third status strip: an amber `Live` tag and a condensed uppercase headline (`TEAMS ARE SET`, `IN GAME 14:32`, `6 OF 10 IN`).
- Compact, dense team rows: role icon over the role word, name, rating on the right.
- Tabular mono numbers.
- A single amber accent.
- The page order: the receipt above the teams, the teams side by side from 768px, and a 340px desktop rail (tape and top of the board).
- The short phone page: filling is about two screens.
- The role icon set, the `build.py` structure and the `?shot` capture mode.

**From B (the 20%)**
- The answer line under the headline: **YOU on RED, playing support**. It uses a YOU sticker and a solid, hatched RED side pill.
- The full-width labelled win bar. It is 50px tall on phones and 60px on desktop. `◣ BLUE 49%` and `51% RED ◥` sit inside the segments in ink, on solid blue and hatched red, with the 50% tick crossing the bar.
- Softer corners: cards 8px, controls 6px, chips 4px. A was 2px everywhere and B was 16 to 26px.
- Colour-blocked team headers: a solid side fill with a 46px leading block. The block is darker solid on blue and a hatch on red. `Your side` is marked on the viewer's team.
- Restrained stickers: `YOU` and `MVP`, radius 4, a −2° tilt, no drop shadow. `MVP` is foreground-on-card, so it never borrows the accent.
- Tape tiles with a side block.
- The rail's "Last night" tape while the lobby fills.
- B's data and viewer: TheSHADOWREAPER, red support, `settling · 9/10`.

**From the shared specs (neither direction)**
- Team colours, the ◣/◥ glyphs, the red hatch, and the Atkinson and Martian Mono fonts.
- The 44px targets.
- STRATEGY section 4's final receipt:
  - The bar is the only headline number. There is no win-chance chip.
  - Chips read `Rating gap 45 pts`, `Main roles 10/10` and `Bot's pick #1 of 3`.
  - A banded sentence ("Basically a coin flip.") plus a reason line ("Next best: swap the bot lane players…").
  - No team totals in the card headers.
  - The compact "Odds at kickoff" receipt stays visible in game.
  - The disclosure holds the 126-ways intro, three splits with "ranked lower" reasons (#3 has closer odds and says why it still lost), the disagree explainer, "Nobody picked these teams", the bot's verbatim note, and calibration against the expected rate (58 of 103, 56%, expected 55%).
- The nav: a phone bottom bar with Tonight, Board, Games and More (a live dot on Tonight); a desktop top bar with the same four plus the group switcher.

## Palette and contrast (WCAG 2.1, from `contrast.py`)

| Token | Night | Day |
|---|---|---|
| page `--background` | `#1A1F29` (A: `#0A0C10`) | `#E9EDF2` |
| card | `#262D3A` (A: `#12161C`) | `#FFFFFF` |
| raised (chips, answer band, tiles) | `#313948` | `#EEF1F5` |
| border | `#566173` | `#A9B3C1` |
| border-strong (receipt frame, dashed states) | `#7A8597` | `#7D8898` |
| foreground | `#F4F6FA` | `#0E1116` |
| muted foreground | `#C5CDD9` | `#434C5A` |
| accent (live, you, action) | `#FFCF66` | text and outline `#7A4F00`; fill `#FFCF66` (text on the fill is ink) |
| team blue / red | `#2E9BFF` / `#FF6B35` | `#1563CF` / `#B5390B` |
| ink on team fills | `#10141B` | `#FFFFFF` |

| Measurement | Night C | A (for comparison) | Day C |
|---|---|---|---|
| card vs page | **1.19** | 1.08 | 1.18 (white card on grey page) |
| border vs card | **2.21** (2.64 vs page) | 1.33 | 2.12 |
| border-strong vs card | 3.71 | n/a | 3.59 |
| text on card | 12.78 (10.73 on raised) | 15.73 | 18.91 |
| muted text on card | **8.63** | 7.11 | 8.68 |
| muted text on raised | **7.24** | n/a | 7.66 |
| muted text on the YOU row wash | 6.91 (below the 7 target; still AA) | n/a | n/a |
| accent on card | 9.46 | n/a | 7.13 (`#7A4F00`) |
| blue / red as text on card | 4.77 / 4.88 | 6.26 / 6.40 | 5.65 / 5.91 |
| ink on blue / red fills (bar labels, headers, pills) | **6.37 / 6.51** | n/a | 5.65 / 5.91 (white) |
| ink on the darkest red hatch stripe | 4.53 (labels are 19px or larger and bold, so the large-text 3:1 floor applies) | n/a | 8.08 |
| luminance ratio blue:red (fairness, target ≤1.10) | 1.03 | n/a | 1.06 |

**Team colours on the lighter card.** Blue and red as text on the slate card drop to 4.77 and 4.88. That is why C almost never sets team-coloured text on the card: side names are ink on a solid fill (6.4 and 6.5). Colour-vision ΔE blue vs red: protan 27.3, deutan 31.4.

## Amber fix (design-system 3.4, measured against red `#FF6B35`)

| Accent | Contrast vs red (≥1.8) | Deutan ΔE (≥15) | Protan / tritan ΔE | Hue |
|---|---|---|---|---|
| A `#FFB224` | 1.57, fails | 11.2, fails | 16.7 / 16.1 | 76° |
| reference `#FFC857` | 1.84 | 15.2 | 21.9 / 22.0 | 83° |
| **C `#FFCF66`** | **1.94** | **16.5** | 23.7 / 23.9 | 85° |

I went a step lighter than the reference, for margin on both limits. Ink on the accent is 12.63:1. The accent always comes with a word: `Live`, `YOU`, `In play`.

## Type

- **Archivo** (wdth 62%, weight 900) for display. It is used only for the headline (headline numbers included), the BLUE and RED side names, the side words inside the bar, pills and tiles, and the stickers. Card titles are now sentence case in Atkinson, which tones down A's shouting.
- **Atkinson Hyperlegible Next** for all text:
  - body 17px (16px for secondary lines)
  - names 19px/700
  - the verdict 23px on phones and 26px on desktop
- **Martian Mono** for numbers and role words (lowercase, 13px).
- Nothing that carries information is under 13px.

## Skills used

- **`frontend-design:frontend-design`**:
  - Set the working order: token plan, a check against generic tells, build, then critique from screenshots.
  - Kept the boldness in one place, the win bar plus the colour-blocked headers.
  - Removed A's tracked all-caps card titles, which is one of the skill's listed tells.
  - Kept copy plain: "Still needed: jungle, support", "If the client doesn't move you, switch to your side yourself."
  - Following its "take one accessory off" advice, I dropped A's amber top edge on the receipt, because the accent means live, you or action and not decoration.
- **`ui-ux-pro-max:ui-ux-pro-max`**:
  - Ran its dark-mode contrast, non-text-contrast and colour searches. They returned generic slate palettes, the usual 4.5:1 rule and the 2px/3:1 focus guidance.
  - I took the rules and rejected the palettes, which were Tailwind slate with a green accent and did not fit the brief.
  - Applied its priority checklist: contrast, 44px targets, no horizontal scroll, a bottom nav of 4 items, SVG icons, colour never alone, reduced motion, and a 2px foreground focus ring.

## Checks (Playwright, `check.js`)

- At 375 on every screen, and at 768 on balanced:
  - **0** names broken mid-word (Used2BeATahmMain: 173px used of 204px)
  - **0** targets under 44px
  - **no** horizontal scroll
- All three fonts loaded.
- Over 3 rounds I fixed:
  1. names breaking mid-word at 375
  2. the tab bar landing in the middle of the page in shot mode
  3. mono headline numbers looking gappy
  4. the role word touching the card edge
  5. the Day theme's yellow nav indicator (1.46:1 on white, now `#7A4F00`)
  6. a caption that said "white line" when the line is dark in Day

## Self-critique

**Strengths**
- It is clearly brighter and easier to read than A, about twice the screen luminance, and still unmistakably A: the same strip, scorebug energy, dense rows and amber.
- "Which side am I on" now answers itself three times above the fold: the answer line, the solid header with `Your side`, and the outlined YOU row.
- The bar reads in one glance on both themes, in greyscale (solid vs hatch, words at both ends) and for colour-blind viewers.

**Weaknesses**
- Card vs page is still only 1.19:1. The visible border does the separating. A lighter card would lower the team-text contrast further.
- Solid team headers come close to design-system 3.3's "never a solid block behind names". The fill stops at the header, and no names sit on it, but it should be re-checked.
- The `In play` chip reuses the accent, which stretches "accent = live, you or action".
- The receipt-open phone page is long (about 4,200px). Splits stack on phones by spec.
- Martian Mono's width axis did not narrow the role word as much as expected, so `support` fills the 60px role cell.
- The in-game screen still only moves its timer, by design.
