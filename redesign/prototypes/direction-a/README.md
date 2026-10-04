# Direction A: Broadcast

Static, high-fidelity prototype of the Tonight screen for Kustom 2.0. This is not app code.

## Concept

Tonight reads like the scorebug and lower-thirds of a live match broadcast made for one friend group. The page opens on a lower-third status strip ("Teams are set", "In game 14:32", "6 of 10 in"). Directly under it sits the fairness receipt, the page's one loud element, built as a scorebug: BLUE 49% on one side, 51% RED on the other, a split bar with a 50% tick, and one plain sentence. Everything else is quiet and squared-off: ink panels, condensed athletic headings, tabular mono numbers, and one amber floodlight that means "live", "you", or "the bot picked this".

## Files

- `balanced.html`: teams set, full receipt, sitting-out note (the primary screen)
- `ingame.html`: elapsed timer, a champion on every seat, compact receipt
- `filling.html`: 6 of 10 in, main roles, "Still needed: jungle, support", the empty seats folded into one line plus a 10-segment meter
- `receipt.html`: the balanced screen with "How the bot decided" open (3 splits, the no-human-input line, the calibration stat)
- `broadcast.css`: the component layer (shadcn-style variables: `--background`, `--card`, `--primary`, `--border`, `--radius`)
- `build.py`: builds every page from one set of components and one data block. Run `python3 build.py`.
- Add `?shot` to a URL to put the phone tab bar at the end of the page, so full-page screenshots don't show it floating mid-page.

Screens are in `redesign/screens/a-{balanced,ingame,filling,receipt}-{375,1440}.png` plus `a-balanced-768.png`.

## Palette

| Token | Hex | Role | Contrast on `#0A0C10` |
|---|---|---|---|
| ink (`--background`) | `#0A0C10` | page | n/a |
| panel (`--card`) | `#12161C` | cards, strip, receipt | n/a |
| raised | `#1A2029` | chips, hover | n/a |
| border / strong | `#262E3A` / `#3A4454` | hairlines, receipt frame | n/a |
| text | `#ECEFF3` | names, numbers | 16.97:1 |
| muted | `#98A3B3` | labels, meta | 7.67:1 |
| floodlight (`--primary`) | `#FFB224` | live tag, YOU tag, picked split, links, focus ring | 10.85:1 |
| BLUE azure | `#4AA3FF` | blue team | 7.43:1 (6.89:1 on panel) |
| RED vermilion | `#FF6B47` | red team | 6.94:1 (6.43:1 on panel) |

**Team colours and colourblind safety.** Azure and vermilion sit on opposite sides of the blue/yellow axis, the one axis that deuteranopia and protanopia (red-green colourblindness) keep, so the two never collapse into each other the way a stock red and green or red and blue can. Their relative luminance is nearly the same (0.35 vs 0.32), so neither side looks favoured, which keeps Floodlit's equal-luminance rule. Colour is never the only signal:
1. The words **BLUE** and **RED** appear on every team header, both ends of the win bar, and every result in the game tape.
2. Shape: blue is always a **circle** and red is always a **diamond**.
3. Pattern: blue fills are **solid** and red fills are a **45° hatch** (team rail, win bar, mini bars). The bar stays readable in greyscale and on a cheap phone screen in daylight.

Amber is close to vermilion for protanopes. That's why amber never marks a team, and every amber element also carries a word (LIVE, YOU, Picked).

## Type

- **Archivo** (Google Fonts, variable `wdth` 62–125, `wght` 400–900). One family does both jobs. At `font-stretch: 62%`, weight 900, uppercase, it's the condensed athletic display (headlines, BLUE/RED, card titles). At 100% width it's the body and the player names. Having one family with a width axis keeps the broadcast look without adding a second display face.
- **Martian Mono** (400–700) for every number: ratings, win %, timer, gap, times. It is tabular, so columns line up and the 49/51 scorebug never shifts as digits change.
- Names are 17px/700 and wrap with `overflow-wrap: anywhere`. They are never truncated (checked by script: 0 overflowing names, no horizontal scroll at 375).

## Radius and texture

- `--radius: 2px` on everything: cards, chips, buttons, tags. It is square enough to read as broadcast graphics while keeping the shadcn component shapes.
- No shadows. Depth comes from the ink, panel and raised steps plus hairlines.
- One texture: a faint amber floodlight glow at the top of the page.
- The only pattern is the red hatch, and it carries meaning, not decoration.
- The receipt is the only card with an amber top edge, so the eye lands on it first.
- Motion: only the LIVE dot pulses (switched off under `prefers-reduced-motion`), and the disclosure chevron turns when you open it.

## Skills used

- **`frontend-design:frontend-design`**: set the working method. That meant a token plan before code, and spending boldness in one place (the scorebug receipt) with everything else kept quiet. Its list of generated-design tells was used as a checklist:
  - I kept the brief's near-black and amber, because the brief pins them.
  - I avoided the other tells: an eyebrow above every heading, `→` links, and decorative numbering. The G1/G2 tape is a real sequence, so it keeps its numbers.
  - Copy follows its writing rules: plain verbs, and "Still needed: jungle, support" rather than system terms.
- **`ui-ux-pro-max:ui-ux-pro-max`**:
  - I ran `--design-system` for "esports gaming scoreboard dark broadcast". It suggested neon purple (`#7C3AED`) with Russo One / Chakra Petch and 3D hyperrealism. I **rejected** that output, because the brief explicitly bans neon/purple AI style.
  - The typography search ("condensed athletic sports display") returned Barlow Condensed, Bebas Neue and Russo One. That confirmed the condensed-athletic direction, and I chose Archivo's width axis instead so the display and body faces share one family.
  - I applied its priority checks: 4.5:1 contrast (every pair computed above), 44px minimum tap targets (verified with a script: every link and summary is at least 44px at 375), a bottom nav with 4 items or fewer, no horizontal scroll, SVG icons with no emoji, colour never the only signal, and reduced motion respected.

## Self-critique

**Strengths**
- The fairness bar reads in one glance: two big tabular percentages, labelled ends, a 50% tick, and solid against hatch. It survives greyscale and colourblindness.
- The receipt keeps the stored numbers (win %, gap, off-role) as data, not prose. The three splits make the rule visible: Option 3 was closer, but it was rejected for putting two players off-role.
- Names never truncate. The viewer's row gets a YOU tag, an amber inset rail and a screen-reader "(you)", so it doesn't depend on colour.
- The desktop layout uses the width: the scorebug spans both teams, the teams sit side by side, and a rail holds the game tape and the top of the board.
- Filling fits on about one phone screen instead of ten empty rows.

**Weaknesses**
- The scorebug's red "51%" and the amber LIVE tag are both warm. On the phone, the top 400px has a lot of warm colour, and protanopes may see the two as similar. The words carry it, but a cooler live colour is worth testing.
- The condensed uppercase headlines lean on the "broadcast" cliché and may feel shouty for a friendly group. The display face is limited to headlines and team names to contain it.
- Champion tiles are neutral initials (no Riot art). They are honest but flat. Real 2.0 might want a licensed-safe illustration or nothing at all.
- The 3-up split cards at 375 are tight (about 105px each). The notes wrap to five lines on Option 3. A swipeable row could be better on phones.
- The in-game screen still has no live score or kill count, by design (we never read in-game state). The timer is the only thing that moves, so it can still feel static.
- The calibration line ("favoured side won 54%") needs the copy tested with real players: "close to a coin flip is the goal" may read as "the ratings are useless".
