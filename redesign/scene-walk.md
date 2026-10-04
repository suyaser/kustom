# M14.26 scene walk (product slice)

Owner: `product`. Date: 2026-10-03. Branch `redesign-2.0` at `08aacc5`, local Supabase at `0028`, my own dev
server on `:3110`. Screenshots are in `redesign/screens/m14/walk-<step>-<width>.png` (Night theme, 375 first,
with spot checks at 768 and 1440).

**The bar:** ten friends in Discord voice open the group's link on their phones and, without asking anyone,
can tell who is in, which side they're on, and why the split is fair. A stranger who lands on `/` can start a
group in two minutes. Nobody types anything during a night.

**What was real and what wasn't.** The nightly loop ran on the real app against the local stack, in a scratch
group `walk-m1426` ("Walk Night", made with `create_group`, the same call `/new` makes). It had a real host token
(`pnpm --filter web mint-token walk-m1426-p00 walk-host --group walk-m1426`) and real `POST /api/companion/lobby`
and `POST /api/companion/game` calls over HTTP, shaped like `lib/testing/fixtures.ts` (`lobbyBody` / `eogBody`,
the M2.10 mapper's shape). The **roll** went through `rollLobby` in-process (`lib/testing/roll.ts`, the same call
the admin route makes once the session check passes, and the way `roll.integration.test.ts` does it), because
the button needs a Discord session and none can be faked. For game 2, the group's `discord_config` pointed at a
local HTTP stand-in for a webhook, so the **real teams, result and fearless posts** were captured as JSON (quoted
below). Admin and signed-in screens were walked through the dev kit only (§3). Afterwards the scratch group, its
11 players and every row they owned were deleted, and I checked: 0 groups, 0 players and 0 lobbies left, and
`customs` untouched.

Two things in the scratch data are my own doing, not product gaps. Game 1's `startedAt` was before the group
existed, so it came before the fearless cursor and banned nothing. The fixture's champion ids 100, 108 and 109
aren't real champions, so they render as "Champion 100".

---

> **Lead's numbering (2026-10-03).** M14.37–M14.40 were already taken, so the gaps below keep their walk numbers
> ("gap 1" = the task written as M14.37 here, … "gap 16" = M14.52) and land in three milestone tasks: **M14.41**
> Tonight and Discord (gaps 1–6, 16, and gap 12's Tonight/embed copy), **M14.42** the other pages (gaps 7, 8, 9, 11,
> 13, 15, and gap 12's games-row and host-card copy), **M14.43** platform (gap 10, gap 14, and the host sit-out
> ruling). Gap 12's "the companion" idle line is in M14.39.

## 1. The walk, step by step

### A stranger: `/` to a new group to a first game

| # | Step | What a friend sees | Screens | 3-second read |
|---|---|---|---|---|
| 1 | Opens `/` signed out | `FAIR TEAMS. NO ARGUMENTS.`, the sub-line, `Create your group` / `See a real group`, then a real receipt from Customs Night with its date. The problem, the three steps, the proof with `How the bot decided` open, trust lines, counters (`8 games refereed · 10+ players rated · 0 results typed in`), the honest companion section, the final CTA and the FAQ. One h1, no horizontal scroll at any width. | `walk-01-landing-{375,768,1440}` | Yes. The hero says what it is and the receipt proves it. **The link preview is a gap:** `/` and `/about` have no `og:title` or `og:image` (G9). |
| 2 | Taps `Create your group` | It's a submit button. It goes straight into Discord sign-in (`/auth/signin` → Supabase authorize → discord.com), as STRATEGY §2.3 step 7 says. Locally Discord answers with an unconfigured client (`client_id=env(...)`), so the walk stops there (§3). | `walk-21-signin-attempt-375` | Fine. |
| 2b | Opens `/new` directly, signed out | `Start a group` / `Sign in with Discord to start a group for your customs.` | `walk-02-new-signedout-{375,1440}` | Yes. |
| 2c | `/new` signed in (kit) | `Start a group`, `Name`, `Link` with `…/g/`, `Create`. | `walk-kit-onb-new-375` | Yes. |
| 3 | Lands on admin as the creator (kit) | `You started this group, so you're its owner.` Then the `Get your group ready` checklist. **Connect Discord reads `After you link your League account.`**, so for an unlinked creator it waits on row 4 (install and pair), even though it's listed second (G16). Then the invite card and `Set up this PC as host`. | `walk-kit-onb-admin-creator-375` | Mostly. The order of the rows hides the dependency. |
| 4 | A friend opens the invite link, signed out | `Walk Night uses Kustom to pick fair teams for your customs.` + `Sign in with Discord`. **Pasted in a group chat, the link has no preview** (G9). | `walk-03-join-signedout-375` | Yes on the page. No in the chat. |
| 4b | Dead invite link | `This link doesn't work anymore.` / `Ask your group for the new one.` / `Back to Kustom` | `walk-03b-join-dead-375` | Yes. |
| 4c | Invite, signed in but not linked (kit) | `Which League account is yours?` with the two cards `I have Kustom` (code `K7QX2M`, 15 minutes) and `I don't` (play, then tap your name). | `walk-kit-onb-join-unlinked-375` | Yes. |
| 5 | The new group before any game (visitor) | `NOBODY IN YET` / `When someone opens a custom with Kustom running, it shows up here.` plus the Mode card `Fearless · Rated · Nothing banned yet. All 173 open.` Board: `No rated games yet. The board fills in after your first Summoner's Rift game.` Games: `No games yet. They show up here when a custom ends.` Stats: `No games this month yet.` + `See all time`. | `walk-05-newgroup-empty-{375,768,1440}`, `walk-05b/c/d-*-375` | Yes, every empty state names what fills it. A brand-new group starting on **Fearless** surprises people (OPEN 2). |
| 6 | Admin's empty Tonight (kit) | `Get your group ready` + `Finish setup`, and the Mode controls under `Admins and the owner`. | `walk-kit-tonight-empty-admin-lead-375` | Yes. |
| 7 | Host runs Kustom, first lobby | The nightly loop below **is** the new group's first game, run from its empty state. | steps 8 to 21 | |
| 8 | Comes back to `/` later, signed out | `Back to Walk Night →` bar above the hero (the `kustom_group` cookie). | `walk-31-landing-returning-375` | Yes. |
| 9 | The demo group from `See a real group` | `/g/customs`: `RED WINS`, the receipt, MVP/ACE, team cards with deltas, the sit-out line, fearless bans, Daily, top of the board. | `walk-04-demo-tonight-{375,768,1440}` | Yes. It shows the same two-ratings problem as G1 (card 1341, board 1342). |

### The nightly loop (scratch group, real ingest)

| # | State | What a friend sees | Screens | 3-second read |
|---|---|---|---|---|
| 10 | Six in | `Live` · `game 1 tonight` · `6 IN THE LOBBY` / `Four more to go.` A compact roster with `New` and `joined just now`, and `4 open seats. They fill as people join the League lobby. Once everyone who is staying is in, an admin rolls the teams.` | `walk-06-filling-6-{375,768,1440}` | Yes. |
| 11 | Eleven in | `11 IN THE LOBBY` / `Ten play, the rest sit out. Waiting on Ramzyinhović to roll the teams.` The roster shows `10/10 +1`, and `If the teams rolled now, Ramzyinhović would sit out.` **The only admin, who is also the host running Kustom, is the one named to sit out** (OPEN 1). There's no first-game "somebody has to be first" line (G4). | `walk-07-over-ten-375` | Mostly. "Why me? I opened the lobby." |
| 12 | Ten in (the late one left) | `10 IN THE LOBBY` / `Waiting on Ramzyinhović to roll the teams.` The admin is named, as decided. | `walk-08-ten-in-{375,768,1440}` | Yes. |
| 12b | Same, as an admin (kit, 12 in) | `Roll teams` is at **y = 1451 px** at 375, almost two screens down, under the twelve-row roster (G2). | `walk-kit-tonight-over-ten-lead-375` | No. The one manual step of the night is hidden. |
| 13 | Rolled | `TEAMS ARE SET` / `Split by rating and role. Nobody picked the teams.` Then the receipt: `BLUE 50%` / `50% RED`, `Dead even.`, the next-best line, `Everyone's on their main role.`, chips `Rating gap 0 pts · Main roles 10/10 · Bot's pick #1 of 3`, `How the bot decided`. **The first team card starts at y ≈ 754**, under the tab bar, so a signed-out phone sees no names on the first screen (G3). **"Main roles 10/10" for ten players with no main role yet** (G6). | `walk-09-balanced-{375,768,1440}` | Odds yes, "which side am I" no. |
| 13b | Same, linked viewer (kit) | `YOU on BLUE, playing support` + `What's open for support`, then your side first and marked `Your side`. | `walk-23-kit-balanced-linked-375` | Yes, for the few who sign in. |
| 14 | In game | `IN GAME` / `Just started. Ratings move when it ends.` (`1 min in` a minute later), then `Odds at kickoff` in the compact form (bar + verdict + off-role line, no chips; 05-design's choice), then the team cards. | `walk-10-in-game-{375,768,1440}`, `walk-26-game2-in-game-375` | Yes. |
| 15 | Finished | `RED WINS` / `Ratings are updated. The leaderboard has the rest.`, `50–50. Red won.`, the receipt, `MVP Nadia · ACE knifiy`, team cards with `1312 +112 gained 112`, the Mode card, Daily, top of the board. **Top of the board says `Nadia 1342`, while her card two cards up says `1341`, and the others read 1314 against 1312** (G1). **No link to this game's page, and no name is tappable** (G5). | `walk-11-finished-{375,768,1440}` | The result yes. The numbers argue with each other. |
| 16 | Board (`This week`) | `This week · Sunday 27 Sep to Saturday 3 Oct · 1 rated game`, rows `1 Nadia 1 game · 1W 0L 1342 +142`, `+ 1 person who hasn't played a rated game this week yet.`, and the weekly explainer at the bottom. | `walk-12-board-week-{375,768,1440}` | Yes on its own page, where the weekly number is explained. |
| 16b | Board (`All time`) | `Still settling` with the line `New players' ratings move fast at first. They get a rank after 10 games.` and `settling · 1/10` chips, unnumbered. | `walk-12b-board-alltime-375` | Yes. |
| 17 | Games | `Not enough games yet to check the bot's odds (0 of 20).`, date and mode segments, a `Player` select + `Show`, then the row `Red won · 3 Oct · 30 min · 50–50. Red won.` (G13: "Red won" twice). | `walk-13-games-{375,768,1440}`, `walk-28-games-two-375` | Yes. |
| 18 | A game's page | `All games` back link, `RED WON` · `Saturday 3 October · 30 min`, the full receipt, then the scoreboard by side (KDA, damage, gold, CS, vision, MVP/ACE). **Scoreboard names don't link** (G5). | `walk-14-game-detail-{375,768,1440}` | Yes. |
| 19 | Share cards | Game card: `RED WINS`, both fives, `30 min`, the date (long names are cut off: `Used2BeATahmM…`). Tonight card: `RED WINS / Ratings are updated…`, with no odds and no names. Player card: `Nadia 1341 Rating, Record 1W 0L`, **with no settling marker after one game**. None of the three names the group (G10). | `walk-15-og-{game,tonight,player}-1200` | The game card yes. The other two are thin. |
| 20 | Player page (from a board row) | `Nadia`, `All time · Since 3 Oct 2026`, `Rating 1341 settling · 1/10`, `Started at 1200, 1 rated game since.`, then by role, side, streaks, recent games and the rating explainer. **The board was on `This week`, but the player page opened on `All time`** (G14). The Board tab stays marked. Back returns to the board. | `walk-16-player-{375,768,1440}` | Yes. |
| 21 | Stats | Records, Champions and 1v1 segments. **Egyptian Arabic roast subtitles (`في جيم واحد`, `هات اتنين`) show up in a brand-new group** (G8). Records defaults to `This month`, 1v1 to `All time` (G14). | `walk-17-stats-{375,768,1440}`, `walk-17b-*`, `walk-17c-*` | Mostly. |
| 22 | You, signed out | `You in Walk Night` / `See it from where you stand.`, the pitch, `Sign in with Discord`, `Nothing here is hidden…`, and the theme switch. | `walk-18-you-signedout-{375,768,1440}` | Yes. |
| 23 | Mode card → panel → Back | Opens as a dialog at `/g/walk-m1426/mode`. The browser's Back closes it and returns to Tonight. | `walk-22-mode-panel-375` | Yes. |
| 24 | Back button elsewhere | Board → `All time` chip → Back → Back steps through chip → board → Tonight, as expected. | | Yes. |
| 25 | Game 2, with history | Eleven in again, and the rotation picks the host again: everyone else has played 1 game too, he has never sat out, and the tie goes by puuid. The rest is as before. `Sitting out this game: Ramzyinhović. Each game goes to whoever has played least tonight…` sits **after both team cards** (G4). | `walk-24-*`, `walk-25-game2-balanced-{375,768,1440}`, `walk-27-game2-finished-{375,768,1440}` | The sit-out line comes too late and reads oddly. |
| 26 | Tonight's tape | `Tonight's tape · 1 played` with `Game 1 · 30 min · 50–50. Red won. · MVP Nadia`, linked to game 1. ("1 played" when two have been played: G13.) | `walk-27-game2-finished-375` | Mostly. |
| 27 | Live updates | With the finished page open and no reload, a new lobby post turned `BLUE WINS` into `7 IN THE LOBBY` **within 2 s**. | `walk-33-next-lobby-live-375` | Yes. Nobody refreshes. |
| 28 | `How the bot decided` opened | The three candidates, both explainers, the bot's note, and `Not enough games yet… (0 of 20)`. | `walk-32-disclosure-open-375` | Yes. (Game 2 at 51% wasn't counted yet because of the calibration's 5-minute cache, which is fine.) |
| 29 | Branded 404s | Unknown group: `No group at this link. Check it with whoever sent it.` / `Back to Kustom`. Unknown game: `There's no game at this link in Walk Night.` / `Back to tonight`. | `walk-20-404-group-375`, `walk-20b-404-game-375` | Yes. |
| 30 | Kustom pages | `/how` (the five sections) and `/download`. **No word about the SmartScreen warning an unsigned `.exe` triggers, and `No pairing and no token needed.` is jargon** (G7). | `walk-29-how-375`, `walk-30-download-{375,1440}` | Mostly. |
| 31 | Admin, signed out | `Admin` / `Sign in with the Discord account that runs Walk Night.` | `walk-19-admin-signedout-375` | Yes. |

### What Discord received for game 2 (captured from the real posts, localhost link dropped by design)

```
Teams are set
**Blue 51%** ▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱ **49% Red**
Basically a coin flip.
Rating gap 62 pts · Main roles 10/10 · Bot's pick #1 of 3
Next best: swap Hana (support) and Karim (mid). Blue 51%, and it scored a hair worse overall (...)
-# Blue favored 51%. Everyone on a main role. Gap 62. Next best: swap Hana and Karim, gap 62.
[Sitting out]  Sitting out: Ramzyinhović — most games tonight.      <- all ten were tied at 1 game (G4)
[Seats]        You'll be moved to your side — if not, move yourself.
[Blue] `top` H4RDC0R33 · 1088 ...   [Red] `top` knifiy · 1110 ...
[Lobby]        `Walk Night customs` · password `1234`

Blue wins · 30 min
Blue was 51%. Blue won. Top damage: LateArrival, 22.3k.
[Blue] `adc` Omar · 1450 (+138) ...                              <- Tonight's top of the board said Omar 1452 (G1)
MVP Omar · ACE LateArrival                     footer: Kustom · game 2

Fearless
Banned next game: 10 more, 10 in all. 166 still open.   (per-lane fields, the new ten in bold)
```

### Spot checks at 768 and 1440

No horizontal scroll and exactly one h1 on every page at every width. At 1440 the desktop bar reads `Tonight ·
Board · Games · Stats` with `You` + `Sign in` on the right, and the tape and top of the board sit in a right
rail (`walk-25-game2-balanced-1440` shows G1 side by side: `Nadia 1341` on her card, `1342` in the rail). The
only target under 44 px is the visually hidden `Skip to content` link.

---

## 2. Gaps

I found no blocker: the loop never broke, and nothing adds a step to the scene. G1 to G5 are the ones I'd fix
before 2.0 ships, because each one makes a friend ask somebody else.

| Gap | Severity | Summary | Task |
|---|---|---|---|
| G1 | should-fix (first) | Two different Ratings for one player on Tonight and in Discord | M14.37 |
| G2 | should-fix | Roll teams / Reroll / Start a lobby are 2 to 3.4 screens down at 375 | M14.38 |
| G3 | should-fix | Signed-out phones can't see their side on the first screen | M14.39 |
| G4 | should-fix | Sit-out card placed last, its reason contradicts Discord on ties | M14.40 |
| G5 | should-fix | Names aren't tappable; the finished poster doesn't link its game | M14.41 |
| G6 | should-fix | "Main roles 10/10" for players who have no main role yet | M14.42 |
| G8 | should-fix | Arabic roast subtitles in every new group | M14.43 |
| G7 | should-fix | `/download` is silent about SmartScreen; jargon | M14.44 |
| G9 | should-fix | No link preview for `/`, `/about`, `/join/<code>`; group pages titled just "Kustom" | M14.45 |
| G15 | should-fix | Sit-out history query isn't scoped to the group | M14.46 |
| G10 | polish | Share cards: thin tonight card, no group name, cut names, no settling chip | M14.47 |
| G13 | polish | Copy: "the companion", "1 played", "Red won" twice, "Sitting out: Sitting out", host code wording | M14.48 |
| G14 | polish | Window not carried board → player; segment defaults differ; "Since <date>" reads like a reset | M14.49 |
| G16 | polish | Checklist lists Connect Discord before the step it waits on | M14.50 |
| G17 | polish | Kit can't show the signed-in-unlinked Tonight viewer (`That's me`) | M14.51 |
| G18 | polish | In-game timer ignores the companion's `startedAt` | M14.52 |

### The tasks, in the house style

- [ ] **M14.37** Tonight and Discord show one Rating per person. *(owners: `web-engineer`, copy by `product`;
  before M14.27)*

    > Expected: one four-digit Rating per person on a screen, the same as on their team card and in the result
    > post. What happened: Tonight's `Top of the board` prints the **weekly** rating (from 1200 every Sunday, M7.2)
    > with no label, beside team cards and a result post that print the **group** Rating. After one game it was
    > `Nadia 1341 +141` on the card and `1342` in the top five, and `Omar 1450 (+138)` in Discord against `1452`
    > on Tonight (`walk-25-game2-balanced-1440`, `walk-11-finished-375`, `walk-04-demo-tonight-375`). It's the
    > audit's "two headline ratings", back in a new place.
    >
    > Acceptance:
    > - Tonight's top-five card is headed `Top this week` **[NEW COPY]** and each row shows the week's W–L and
    >   change (`+114`), **not** a four-digit number. On Tonight, the only four-digit Rating is the group Rating
    >   (team cards, roster, poster).
    > - A component test renders `finished` with a fixture where weekly ≠ group rating and asserts no player's
    >   name sits beside two different four-digit numbers anywhere on the page.
    > - The Board keeps its weekly windows and their explainer unchanged; Discord unchanged (it already uses
    >   the group Rating).
    > - Screenshots at 375 / 1440 of finished and idle.

- [ ] **M14.38** The admin's buttons are on the first screen. *(owners: `designer` then `web-engineer`)*

    > Expected: the one deliberate manual step of the night (STRATEGY §0, 00-product principle 2) is where the
    > admin is already looking. What happened, at 375×812 (kit, `?viewer=lead`): `Roll teams` at **y = 1451**
    > with 12 in (`walk-kit-tonight-over-ten-lead-375`), `Reroll` at **y = 2284**, `Start a lobby` after a result
    > at **y = 2727**. That's under a full roster, the receipt and both team cards.
    >
    > Acceptance:
    > - With 10 to 12 in the lobby, `Roll teams` is inside the header card or directly under it: its box sits
    >   within the first 812 px at 375 and clear of the tab bar. Same for `Reroll` in balanced and `Start the
    >   next lobby` in finished. A Playwright check measures all three against the kit states.
    > - The roll still sends the roster key the admin is looking at (no behaviour change); the button keeps its
    >   44 px height and its refusals stay in place under it.
    > - Members and visitors see no new element. Screenshots at 375 / 768 / 1440.

- [ ] **M14.39** A signed-out friend finds their side on the first screen. *(owners: `designer` then
  `web-engineer`, copy by `product`)*

    > Expected (M14 goal): "without asking anyone, can tell … which side they are on". Most of the ten never sign
    > in. What happened: in balanced at 375, the first team card starts at **y ≈ 754** under the receipt, and
    > the tab bar covers it (`walk-09-balanced-375`). Linked viewers get `YOU on BLUE, playing support`; nobody
    > else gets anything on the first screen.
    >
    > Acceptance:
    > - In `balanced` and `in game`, a signed-out viewer at 375×812 sees **all ten names with their side in
    >   words** above the tab bar without scrolling. One option is a compact two-column `Blue` / `Red` name
    >   strip in the header card, the full cards staying below the receipt. Designer's call, checked against
    >   05-design's list.
    > - Long names wrap, never truncate (05-design 6.14 names).
    > - Linked viewers keep the answer band; the strip doesn't duplicate it for them.
    > - Screenshots at 375 / 768 / 1440 with the 6.14 long names.

- [ ] **M14.40** The sit-out card comes first, and says the same thing as Discord. *(owners: `web-engineer`,
  copy by `product`)*

    > Expected (STRATEGY §6(a) balanced: "TEAMS ARE SET, sit-out card if any, …"; 00-product step 6: on the first
    > game "the post says as much — somebody has to be first"). What happened: the sit-out card renders **after
    > both team cards**. The page says `Each game goes to whoever has played least tonight, so they are first in
    > line for the next one.` while Discord says `Sitting out: Ramzyinhović — most games tonight.`, when all ten
    > had played exactly one game and the tie was broken by "never sat out", then puuid.
    >
    > Acceptance:
    > - In balanced, the sit-out card is the first card after the header.
    > - One reason sentence, from one `lib/` copy function, used by both the page and the teams embed, that
    >   names the rule which actually decided: `most games tonight` only when the sitter played strictly more;
    >   `Everyone's played <n> tonight. <Name> has gone longest without sitting out.` **[NEW COPY]** on a tie
    >   broken by sit-outs; `First game of the night, so somebody has to be first.` **[NEW COPY]** on game 1.
    >   Unit tests for each of the three.
    > - The embed field is `Sitting out` with the value starting at the name (no `Sitting out:` repeated).

- [ ] **M14.41** Every name is a link, and the result links its game. *(owner: `web-engineer`)*

    > Expected (STRATEGY §2.4: the player page is reached by "tapping any name"; §4.7: a row opens the game
    > page). What happened: on Tonight the team-card names and MVP/ACE are plain text, and the only player links
    > are the top five. The finished poster has no link to its own game page (the tape links earlier games
    > only). The game page's scoreboard names are plain text.
    >
    > Acceptance:
    > - Team-card names (balanced, in game, finished), the MVP and ACE names, and every scoreboard name link to
    >   `/g/<slug>/p/<puuid>`, with targets at least 44 px tall and the tab marked as Board on arrival.
    > - The finished poster has `Full scoreboard` **[NEW COPY]** → `/g/<slug>/games/<id>`.
    > - Tests by role/name: a finished fixture has ten player links plus the scoreboard link.
    > - The roll/reroll and role controls keep working (no nested interactive elements).

- [ ] **M14.42** The receipt never claims a main role nobody has yet. *(owners: `web-engineer`, copy by
  `product`; `core-engineer` only if the count needs a new export)*

    > Expected (STRATEGY §4.1: "no copy may claim a reason the data can't support"). What happened: ten new
    > players, each shown as `flexible` in the lobby, got `Main roles 10/10` and `Everyone's on their main role.`
    > on Tonight and in Discord (`walk-09-balanced-375`, the teams post above).
    >
    > Acceptance:
    > - On the live receipt (Tonight balanced/in game, the teams embed), players with no main role on record
    >   aren't counted as on-main. The chip reads `Main roles 6/6 · 4 new` **[NEW COPY]**, and the off-role line
    >   reads `4 people have no main role yet.` **[NEW COPY]** (all ten: `Nobody has a main role yet.` **[NEW
    >   COPY]**).
    > - History (stored `off_role_count` only) is unchanged.
    > - Unit tests for 0, some and all ten with no main role. The frozen core sentence is untouched.

- [ ] **M14.43** Arabic roast titles only where the group asked for them. *(owners: `product` (decision row),
  then `web-engineer`)*

    > Expected: the 2026-09-12 decision ("Every `/fun` title carries an Egyptian 3ameya roast") was the original
    > group's request. What happened: a brand-new group's Stats shows `في جيم واحد` and `هات اتنين` under its
    > headings (`walk-17-stats-375`, `walk-17c-stats-1v1-375`).
    >
    > Acceptance:
    > - Roast subtitles render for the original group (`customs`, by id) only. Every other group sees the English
    >   heading alone. No schema change; a per-group switch is M15+ if anyone asks.
    > - A test renders Stats for `customs` (roasts present, `lang="ar"`) and for another group (absent).
    > - Decision row narrowing 2026-09-12 to the original group.

- [ ] **M14.44** `/download` walks a stranger past Windows' warning. *(owners: `web-engineer`, copy by
  `product`)*

    > Expected: a stranger's only install path doesn't stall on a scary screen. The exe isn't code-signed
    > (`apps/companion/README.md`), so Windows shows "Windows protected your PC". What happened: `/download` says
    > nothing about it (`walk-30-download-375`), and its Overlay line says `No pairing and no token needed.`
    >
    > Acceptance:
    > - Under `Download Kustom`: `Windows may warn you because Kustom isn't signed yet. Click More info, then Run
    >   anyway.` **[NEW COPY]**
    > - Overlay line: `Nothing to set up.` **[NEW COPY]** instead of the pairing/token sentence.
    > - No other copy changes. Screenshots at 375 / 1440.

- [ ] **M14.45** Every link we expect people to paste has a preview. *(owner: `web-engineer`, copy by
  `product`)*

    > Expected (00-product: "a link to tonight, to one game, or to a person's page unfurls as a picture"; the
    > invite link is the one link M14 asks every group to paste). What happened: `/`, `/about` and
    > `/join/<code>` have no `og:title`/`og:image` at all. Tonight's `og:title` and tab title are just `Kustom`.
    > Every group page has the generic description `Team balancer and stats tracker for nightly League customs.`
    >
    > Acceptance:
    > - `/join/<code>`: `og:title` `Join <Group> on Kustom` **[NEW COPY]**, description `<Group> uses Kustom to pick
    >   fair teams for your customs.` (shipped string), and an image. A dead code gets the generic Kustom card and
    >   names no group.
    > - `/` and `/about`: `og:title` `Kustom: fair teams for your League customs`, the positioning line as
    >   description, a Kustom card image.
    > - Group pages: `<title>` and `og:title` name the group (`<Group> tonight · Kustom` **[NEW COPY]** on
    >   Tonight).
    > - A test reads the metadata of each route. Real unfurl checked in Discord by the user at M14.27.

- [ ] **M14.46** The sit-out rotation reads its own group's history. *(owner: `platform-engineer`)*

    > Found while checking G4. `loadRotation` in `apps/web/lib/ingest/balance.ts` reads the latest
    > `SIT_OUT_HISTORY_GAMES` (400) `games` **across all groups**. With several active groups, one group's
    > "longest without sitting out" history is pushed out by the others' games.
    >
    > Acceptance:
    > - The recent-games read filters on the lobby's `group_id`.
    > - An integration test with two scratch groups: 400+ newer games in group B leave group A's sit-out order
    >   unchanged.

- [ ] **M14.47** Share cards say whose night it was. *(owners: `designer` then `web-engineer`)*

    > What happened (`walk-15-og-*-1200`): the tonight card after a result reads only `RED WINS / Ratings are
    > updated. The leaderboard has the rest.`. No card names the group. The game card cuts long names off
    > (`Used2BeATahmM…`). The player card shows `1341 Rating` after one game with no settling marker.
    >
    > Acceptance:
    > - Finished tonight card carries `<Winner> was <p>%. <Winner> won.` and the group name.
    > - All three cards name the group.
    > - Player card shows `settling · n/10` under 10 rated games.
    > - Names shrink before they cut off; 05-design 6.14 names fit on the game card.

- [ ] **M14.48** Copy fixes from the walk. *(owners: `web-engineer`, copy by `product`)*

    > Acceptance (each string in its `lib/**/copy.ts`, with a test):
    > - Idle line: `…a custom lobby with Kustom running…` (was `with the companion running`; friends never see
    >   the word "companion").
    > - Tape count: `<n> earlier` **[NEW COPY]** (was `1 played` while game 2 was on the poster).
    > - Games row: the title is the result, so the compact line drops the repeat (`50–50.` / `Blue was 51%.`),
    >   or the title becomes the date. Designer picks one; `Red won` once per row.
    > - Teams embed: the field is `Sitting out`, the value starts at the name (with M14.40).
    > - Host card step 3: `Type this code in Kustom:` **[NEW COPY]** (was `under Join a group`, which reads as the
    >   wrong flow for a host).

- [ ] **M14.49** Windows follow you between pages. *(owner: `web-engineer`)*

    > What happened: a board row on `This week` opens the player page on `All time`. Stats → Records defaults to
    > `This month` and Stats → 1v1 to `All time`. `All time · Since 3 Oct 2026` shows on a group that never reset,
    > which reads like STRATEGY §3.6's reset note.
    >
    > Acceptance:
    > - Board rows and Stats segment links carry `?window=`.
    > - One default window for all three Stats segments.
    > - `Since <date>` only after a rating reset. Before that, `All time · first game <date>` **[NEW COPY]**.

- [ ] **M14.50** The setup checklist puts the blocking step first. *(owners: `web-engineer`, copy by
  `product`)*

    > What happened (`walk-kit-onb-admin-creator-375`): for an unlinked owner, `Connect Discord` is row 2 and
    > reads `After you link your League account.`, but linking only happens in row 4 (install Kustom and pair).
    >
    > Acceptance:
    > - While the owner is unlinked, `Install Kustom on one PC` is the first row, or the Discord row links to it
    >   with `Set up Kustom first` **[NEW COPY]**.
    > - Once linked, the order is as today. The checklist stays derived from data.

- [ ] **M14.51** The kit shows the signed-in, unlinked Tonight viewer. *(owner: `web-engineer`)*

    > The claim path's own words are "open this group's tonight page and tap your name", and its `That's me`
    > list (`RoleTonight.tsx`) is the one Tonight state neither the live walk nor the kit could reach.
    >
    > Acceptance:
    > - `/kit/tonight/<state>?viewer=unlinked` renders the `That's me` list (filling, balanced).
    > - Screenshots at 375, checked by product and designer.

- [ ] **M14.52** The in-game timer counts from the client's start. *(owner: `platform-engineer`)*

    > What happened: the timer is `lobbies.updated_at` at the `in_progress` post (`lib/tonight/load.ts`), while
    > the body already carries the client's `startedAt`. A late `in_progress` post (host reconnects mid-game)
    > shows `Just started` 20 minutes in.
    >
    > Acceptance:
    > - If `startedAt` can be stored without a migration, the timer uses it when present, with a test.
    > - If it needs a migration, close as won't-fix with a decision row (the companion posts at `GameStart` in
    >   practice).

---

## 3. Not walked live, and why

| Screen or step | Why | How it was covered |
|---|---|---|
| Discord sign-in, and everything after it | The local Supabase Discord provider isn't configured (the authorize URL had `client_id=env(SUPABASE_AUTH_DISCORD_CLIENT_ID)`, `walk-21-signin-attempt-375`), and a Discord session must never be faked in the DB | Dev kit and unit-tested states |
| You, signed in (linked, unlinked, admin card, welcome) | needs a session | `/kit/you` exists (not re-shot here); M14.33/M14.35 tests |
| `/new` submit, creator lands on admin | needs a session | `walk-kit-onb-new-375`, `walk-kit-onb-admin-creator-375` |
| `/join/<code>` signed in (linked / unlinked) | needs a session | `walk-kit-onb-join-unlinked-375` |
| Admin home, Members, Discord connect, Hosts, Reset ratings, `/ops` | needs a session (admin / owner / super-admin) | kit `onboarding?screen=…`; route integration tests |
| Pressing `Roll teams` / `Reroll`, `Start a lobby`, `Role for tonight`, `That's me`, the Mode picker and `Reset fearless` | needs an admin or linked session | The roll ran through `rollLobby` in-process (the route's own call after its session check); admin views from `/kit/tonight/<state>?viewer=lead`; `That's me` not reachable even in the kit (M14.51) |
| Host pairing (code → Host-mode token), lobby creation and invites from the companion | needs Windows and the League client | not covered here; M14.13 / M4 verification |
| Discord rendering | no Discord channel locally; localhost links are dropped from embeds by design (`lib/siteUrl.ts`) | the real posts captured as JSON from a local webhook stand-in (quoted in §1) |
| Daily guess submit | needs no session, but it's outside the scene | not walked |
| Day theme | the brief asked for Night with width spot checks | not walked |

---

## Open questions for the lead (not tasks yet)

1. **The host as the sitter.** In both games the rotation chose the host, who runs Kustom and was the only
   admin, to sit out (a tie on games played, broken by "never sat out", then puuid). If the host goes to the
   spectator slot, does their Kustom still get the end-of-game block? `docs/03-lcu-reference.md` doesn't say. It
   needs a real-client check (`companion-engineer`) before 2.0 ships. If the answer is no, the rotation must
   never seat the host out, and that's a decision row.
2. **New groups start on Fearless** (`0024`, `group_modes.mode default 'fearless'`, decided). A stranger's first
   night shows a ban list nobody asked for. Product would start new groups on `Normal` and leave `customs` as it
   is. That's a schema default, so it's the user's call.
3. **The in-game receipt.** STRATEGY §4.5 says the full receipt shows in game; `docs/05-design.md` says compact (no
   chips, no disclosure), and the site follows the design doc. I agree with compact. STRATEGY §4.5 should be
   amended to match (lane rules keep me out of STRATEGY.md this session).
