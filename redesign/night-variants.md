# Night variants: bringing back the 1.0 floodlight (M14 review follow-up)

**Outcome, 2026-10-04: the user picked V1. It is the Night default** (05-design 7.3), with `--border-strong`
lifted to `#66738A` and used for every control edge (05-design 3.2, rule 6.15). The `?night=` switch and the
variant blocks are gone; the comparison shots below stay as the record.

The user, on Direction C: *"i like the background on our old design and blue dark colors our new design feel a
little bland"*. This is a token and background change only: no layout, no component, no copy. Day is
untouched (checked: computed tokens and pixels identical with either variant switched on in Day).

Two variants sit beside C as Night overrides in `apps/web/app/globals.css`. **Neither is the default.**

## How to look at them

- Dev server only: add `?night=v1` or `?night=v2` to any page. It sticks for the tab (sessionStorage), so links
  keep the variant. `?night=c` goes back to C.
- The switch is a dev-only inline script (`lib/nightCompare.ts`, rendered by `app/layout.tsx` only when
  `NODE_ENV !== 'production'`). A production build has no way to set `data-night`; the override CSS ships but
  can never match.
- Contact sheets (top 1100 css px of each page, three columns labelled):
  `redesign/screens/m14/night-compare-375.png`, `redesign/screens/m14/night-compare-1440.png`.
- Full pages: `redesign/screens/m14/night-{current,v1,v2}-<screen>-{375,1440}.png` for `tonight-real`
  (`/g/customs`, finished), `tonight-balanced`, `tonight-finished` (kit), `board`, `game`, `landing`, `mode`.

## What 1.0 actually was

Recovered from `518e62c^:apps/web/app/tokens.css` and `theme-gaming.css` (deleted in M14.25):

- Page `#05070C`, surface `#0C121A`, raise `#141B28`, line `#2A3344`, text `#F4F7FC`, dim `#7D8A9E`.
- Two corner lamps, not one centred glow: a **blue** lamp top-left (`--cn-blue` at 16%) and a **gold** lamp
  top-right (`--cn-brand` at 12%), plus a faint 48px pitch grid (text at 4%).

Measured in OKLCH, 1.0 and C share the same hue (about 262, a cool blue-grey). What made 1.0 feel "blue dark"
is that it is far darker (page L 0.13 vs C's 0.24), so the same small chroma reads as navy rather than grey,
and the blue lamp washes the top-left corner. C's single centred amber glow at 7% on a lighter slate is the
"bland" part: there is no cool light anywhere on the page.

## What changed, per variant

Only these Night semantic tokens move. Team colours (`#2E9BFF` / `#FF6B35`), amber (`#FFCF66`), ink
(`#10141B`), hatch, tints and the you-wash formula, radii, type and spacing are all C's. Tints and the
you-wash recompute from the new `--card` automatically.

| Token | C (current) | V1 "1.0 night" | V2 "between" |
|---|---|---|---|
| `--background` | `#1A1F29` | `#05070C` (1.0 page) | `#0B1321` |
| `--card` | `#262D3A` | `#0C121A` (1.0 surface) | `#162033` |
| `--raised` | `#313948` | `#141B28` (1.0 raise) | `#222D41` |
| `--border` / `--input` | `#566173` | `#2A3344` (1.0 line) | `#49576E` |
| `--border-strong` | `#7A8597` | `#5D6A80` (new; 1.0 had none) | `#728096` |
| `--muted-foreground` | `#CBD2DD` | `#8B98AD` (1.0 `#7D8A9E` lifted, see below) | `#CAD3E1` |
| `--foreground` | `#F4F6FA` | `#F4F7FC` (1.0 text) | `#F4F6FA` (unchanged) |
| `--page-light` (`bg-page`) | one amber glow, 7%, centred | blue lamp 16% top-left + amber lamp 12% top-right + 48px grid at 4% | the same two lamps, no grid |

The lamps, as shipped in the override:

```css
radial-gradient(90% 760px at 8% -140px, rgb(46 155 255 / 0.16), transparent 58%) no-repeat,
radial-gradient(80% 700px at 96% -120px, rgb(255 207 102 / 0.12), transparent 52%) no-repeat
```

1.0 sized them as a percentage of the whole shell, so a tall page got a huge glow and a short one a small
glow. Here they are fixed pixel heights matching what 1.0 drew on a typical tall Tonight page, so every page
gets the same light. The blue lamp uses C's azure (the team blue), as 1.0 did. It is ambient light at a
corner, at 16% alpha, never behind a side label. The amber lamp sits opposite it, so neither side reads as
favoured.

`bg-page` now reads `var(--page-light), var(--background)`. C's value is the same gradient text it was
before, so C renders exactly as it did.

**V1 fixes on top of 1.0:**

1. Muted `#7D8A9E` becomes `#8B98AD`. 1.0's dim measured 4.93 on raise and **4.51** on the you-wash, which
   passes AA by a hundredth. The lift gives at least 5.4 everywhere and keeps the 1.0 hue.
2. A `--border-strong` of `#5D6A80` (3.44 on card), because C's input and state outlines need at least 3:1
   and 1.0 had no such step.

The hairline border stays 1.0's 1.48:1. That is the faint-lines look 1.0 had. It is decorative, and every
input has a label.

**V2** keeps C's ramp structure: card about 1.15 above the page, raised about 1.18 above the card, border about
2.2:1, muted at or above 7:1 on every surface. It cuts that ramp darker and bluer (OKLCH: page L 0.19 and
chroma 0.031 vs C's 0.24 and 0.021, at the same hue 262). Then it adds 1.0's two lamps. It drops the grid,
which is the one 1.0 texture C never had.

## Contrast (WCAG 2.1, measured)

Script: `redesign/prototypes/night-variants/table.py` (C's formulas from `direction-c/contrast.py`). Its full
output is in `contrast-output.txt`. "Lamp peak" means the page colour at the brightest point of each lamp,
which is the worst case for anything set straight on the page.

| Pair | Target | C | V1 | V2 |
|---|---|---|---|---|
| card vs page | border separates | 1.19 | 1.07 | 1.14 |
| border vs card | decorative | 2.21 | 1.48 | 2.23 |
| border-strong vs card | ≥ 3 | 3.71 | 3.44 | 4.07 |
| foreground on page / card / raised | ≥ 4.5 | 15.26 / 12.78 / 10.73 | 18.77 / 17.51 / 16.07 | 17.19 / 15.06 / 12.77 |
| **muted on page** | ≥ 4.5 (C: 7) | 10.85 | **6.90** | 12.32 |
| **muted on card** | ≥ 4.5 (C: 7) | 9.09 | **6.44** | 10.80 |
| **muted on raised** | ≥ 4.5 (C: 7) | 7.63 | **5.91** | 9.16 |
| **muted on you-wash** | ≥ 4.5 (C: 7) | 7.28 | **5.41** | 8.79 |
| muted on lamp peak (blue / amber) | ≥ 4.5 | 9.31 (C glow) | 5.71 / 5.62 | 9.75 / 9.57 |
| amber text on card / raised | ≥ 4.5 | 9.46 / 7.94 | 12.86 / 11.81 | 11.15 / 9.46 |
| blue text on page / card | ≥ 4.5 | 5.70 / 4.77 | 6.96 / 6.49 | 6.42 / 5.63 |
| red text on page / card | ≥ 4.5 | 5.82 / 4.88 | 7.11 / 6.63 | 6.56 / 5.75 |
| blue / red on raised (text banned, 3.3) | ≥ 3 non-text | 4.01 / 4.09 | 5.96 / 6.09 | 4.77 / 4.87 |
| team text on lamp peak, worst | ≥ 4.5 | 4.89 | 5.66 | 4.99 |
| foreground on blue / red tint | ≥ 4.5 | 10.70 / 10.98 | 15.02 / 15.19 | 12.53 / 12.93 |
| ink on blue / red fill | ≥ 4.5 | 6.37 / 6.51 | unchanged | unchanged |
| team luminance ratio; CVD ΔE protan / deutan / tritan | ≤ 1.10; ≥ 15 | 1.03; 27.3 / 31.4 / 33.8 | unchanged | unchanged |

Every pair passes AA in both variants. The team colours actually gain contrast on the darker surfaces, and
the 3.3 "never as text on raised" exception now passes AA in V1 and comes within 0.2 of it in V2. **V1 is the
only variant that breaks C's own 7:1 secondary-text rule** (5.4 to 6.9). That is the 1.0 look, and it is the
"too dark or hard to see" complaint the user made about Direction A.

## Recommendation: V2

1. **It answers the complaint without reopening the old one.** The user called A "too dark, hard to see" and
   now calls C "bland". V2 brings the blue-dark cast and the floodlight back. It keeps every secondary line at
   9:1 or better, borders you can see, and cards that sit visibly above the page. V1 drops muted text to
   5.4 to 6.9 and hairlines to 1.48. On a phone at arm's length in a dark room, that is the A problem again.
2. **The floodlight is what makes it read as 1.0.** In the side-by-side shots, the blue lamp in the top-left
   and the gold lamp in the top-right do most of the "old background" work. Both variants have them. What V1
   adds beyond that is darkness and the grid, and on a phone the grid barely shows.
3. **Cards stay legible as cards.** V1's card is 1.07 above the page, so a card is only its 1.48 hairline.
   The 2.0 screens, unlike 1.0, carry many stacked cards (the tape, Top this week, odds, team cards, Mode,
   your role), and in V1 they blur into one black field. V2 keeps C's 1.14 lift.
4. **Less to re-verify.** V2 keeps C's ratios, so 05-design 3.2's rules hold as written with new hexes. V1
   would need 3.2's 7:1 rule rewritten down to AA.

If the user wants even more of 1.0, the cheapest step past V2 is adding V1's 48px grid at 4% to V2's
`--page-light`. It is one line and touches no contrast number.

## If a variant is chosen (not done here)

In the same commit as making it the default:

- `globals.css`: move its values into the `--p-slate-*` primitives (or rename them), set Night's
  `--page-light`, and delete the `data-night` blocks.
- Delete `lib/nightCompare.ts` and its use in `app/layout.tsx`.
- `docs/05-design.md` 2.1, 3.2, 7.3, and the token tables.
- `app/_og/palette.ts`: `bg`, `line`, `dim`, and `OG_LIGHT`. The share cards must match the page.
- `app/global-error.tsx`: its hard-coded `#1A1F29` / `#262D3A` / `#313948` / `#566173` / `#CBD2DD`.
- `lib/theme.ts` `THEME_COLOR.night`, which is still 1.0's `#05070c`. V1 matches it; V2 would use `#0B1321`.
