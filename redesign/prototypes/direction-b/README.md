# Direction B: "Scrim Night"

Static prototype of the Tonight screen for Kustom 2.0. Serve the folder (`python3 -m http.server 8102`) and open
`balanced.html`, `ingame.html`, `filling.html` or `receipt.html` (the receipt with "How the bot decided" open).
Screenshots: `redesign/screens/b-*.png`.

## Concept

Tonight should feel like the group chat on a game night, not a broadcast scoreboard: warm graphite, chunky rounded cards
with hard offset shadows, and stickers for the human bits (YOU, MVP, Picked). The two sides are bold colour blocks with
a pattern and a shape, so "which side am I on" reads from across the room and survives greyscale. The fun sits around
the numbers, never on them: the fairness receipt uses plain sentences, one labelled bar and three big tabular numbers,
so it reads as evidence, not decoration.

## Palette

| Token | Hex | Role | Contrast |
|---|---|---|---|
| bg | `#1D1B18` | Page, warm graphite (not black, not navy) | |
| card | `#28241F` | Cards | |
| card-2 | `#332E28` | Chips, raised rows | |
| line | `#4A433A` | Borders, dashed empty states | |
| fg | `#F4EEE4` | Primary text | 14.9:1 on bg |
| muted | `#BDB2A2` | Secondary text | 8.2:1 on bg, 7.4:1 on card |
| faint | `#9A8F80` | Tertiary text (timestamps, captions) | 5.4:1 on bg, 4.9:1 on card |
| ink | `#1A1714` | Text on colour blocks | |
| **blue** | `#4FA9FF` | BLUE side, azure | 6.9:1 on bg; ink on it 7.2:1 |
| **red** | `#FF7452` | RED side, vermilion-coral | 6.4:1 on bg; ink on it 6.7:1 |
| butter | `#FFD24D` | You, live, Picked (the one non-team accent) | 11.9:1 on bg |

**Colourblind safety.** Azure vs vermilion sits on the blue/orange axis that deuteranopia and protanopia keep (the
Okabe-Ito pairing), not the red/green axis they lose. The two have near-equal luminance (0.373 vs 0.344) so neither side
looks favoured, which keeps Floodlit's fairness rule. Because equal luminance means they look alike in greyscale, sides
never rely on hue: the word BLUE or RED is always printed, BLUE carries a **circle** and a **dot** pattern, RED a
**diamond** and **diagonal stripes**, in team headers, the win bar and the game tape.

## Type

- **Bricolage Grotesque** (800/700): headlines, names, numbers. Chunky, slightly quirky grotesk that is friendly
  without being a "gamer" font, and nothing like Riot's Beaufort/Spiegel.
- **Figtree** (400-700): body and labels.
- All numbers use tabular figures. No monospace labels, no tracked all-caps eyebrows; uppercase only on the side names
  and stickers.

## Shape and texture

- Radius by hierarchy: team cards 26px, cards 24px, rows and chips 16px, icon tiles 12px, stickers 9px, pills full.
- Hard 4-5px offset shadow in near-black instead of soft blur: the "sticker sheet" detail. No gradients, no glass.
- Stickers are slightly rotated (-3 to 2 degrees). The viewer's row gets a 3px butter outline plus a YOU sticker plus
  screen-reader text, so it is never colour alone. New players get a dashed "settling 9/30 games" chip instead of a 0.
- Role icons are original inline SVG (no Riot assets); champions are text with a neutral initial tile.
- Bottom tab bar (Tonight / Board / Games / More) under 1024px, top nav with "Customs Night" above it.

## Screens

- **Balanced**: status strip with live pill and "You on RED, playing support"; full receipt; BLUE and RED cards
  (stacked below 1280px, side by side above); sitting-out note. Desktop rail: tonight's tape (each game says "Blue was
  53%. Red won." with an MVP sticker) and top of the board.
- **In game**: "In game · 14:32", champions per seat, compact receipt kept on screen.
- **Lobby filling**: "6 of 10 in", 10 pips, six players with main role, "Still needed: Jungle, Support", empty seats
  collapsed to one dashed line. The rail shows last night, not an empty tape.
- **Receipt expanded**: splits A/B/C side by side (stacked on phones) with mini bars, win %, gap and off-role; the
  picked one outlined with a sticker; "Nobody picked these teams." / "Admins can't edit ratings."; calibration bar
  "The favoured side won 54% of 103 games" with the 50% line marked.

Data note: the real ratings given put a 5v5 at about 7,800 per side, so the sentence reads "45 points apart out of about
7,800" rather than the draft's 7,400. Split: BLUE 7,780 vs RED 7,825, Chaos sitting out.

## Skills used

- **`frontend-design:frontend-design`**: set the process (token plan first, then check it against the "generic AI"
  tells). It pushed me off a near-black base, off monospace data labels and all-caps eyebrows, and towards spending the
  boldness in one place: the team colour blocks and the win bar, with everything else quiet.
- **`ui-ux-pro-max:ui-ux-pro-max`**: ran `--design-system` for a gaming community product. It returned a neon purple
  palette and Russo One / Chakra Petch, which I **rejected** as exactly the esports/AI look the brief bans. Kept its
  pre-delivery checklist (4.5:1 contrast, 44px targets, reduced motion, no emoji icons, 375-1440 checks), the
  typography search (pointed to bold single-family grotesks; I chose Bricolage for more warmth), and the "don't convey
  information by colour alone" UX rule that drove the shape + pattern markers.
- Checks run on every screen with Playwright: no horizontal scroll at 375, no truncated or wrapped names at
  375/768/1024/1440, every link/button/summary at least 44x44.

## Self-critique

Strengths
- Side and seat read in one glance; the YOU sticker plus outline is the clearest "am I in" answer of any version.
- The win bar with a dashed dead-even line makes 49/51 look as close as it is; the sentence and three chips repeat it
  without jargon.
- Patterns and shapes make sides survive greyscale and colour blindness; contrast is comfortably above AA everywhere.
- Long names (Used2BeATahmMain, TheSHADOWREAPER, Ramzyinhović) fit without cutting.

Weaknesses
- The phone page is long (about 2,600px balanced, 3,800px with the receipt open). The receipt sits above the teams on
  purpose (fairness first), but that pushes the viewer's own row below the fold; the "You on RED" chip carries the
  answer up top.
- Patterned blocks are busy next to each other on the 1440 layout; the tape tiles might be better solid.
- Team totals (7,780 / 7,825) in the headers still invite "why is RED higher?"; product may prefer averages or hiding
  them behind the receipt.
- Sticker rotation and hard shadows are charming at small doses; spread to every page they could get cartoonish.
- Teams stack until 1280px so names never cut; 1024-1279 desktops get a long single column.
