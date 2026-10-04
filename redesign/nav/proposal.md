# Pages and navigation: kill More, five tabs, three-way Stats, a You tab

Owner: `designer`. Date: 2026-10-03. Branch `redesign-2.0`. A proposal for the lead and the user. It edits nothing
in `apps/`, `docs/05-design.md` or `STRATEGY.md`; the changes those need are listed in section 5.

**The user's ask (verbatim):** "I don't like also the More page, it looks ugly, and I think we can have a better
way to handle this, like a drop down I can select pages, or combine pages into a better UX."

**The short answer:** the More page is ugly because it is a junk drawer, not because of its styling. Six loose
pages (Stats, Fun, 1v1, Daily, Admin, account) had nowhere to go, so they went into a settings-style list with a
card called `Stats` holding a row called `Stats` (`redesign/screens/m14/shell-more-night-375.png`). Styling it
better doesn't fix that, and neither does a dropdown: a dropdown is the same drawer, just hidden. The fix is to
**merge pages until every destination is a tab**, and then delete More.

Prototype: `redesign/nav/prototype/` (run `python3 build.py`, serve `redesign/`). Screens: `redesign/nav/screens/`.

---

## 1. What is wrong with today's IA

| Problem | Where |
|---|---|
| A hub page with 10 rows, 4 of which are settings, and it takes a tab | `/g/<slug>/more` |
| A `Stats` card with a `Stats` row in it. Nobody can tell Stats, Fun and 1v1 apart from their names | More, `lib/nav.ts` |
| Duos shown twice: Stats → Duos (best/worst together) and Fun → Friends and enemies (best duo, nemesis); 1v1 → Pick two shows "when they queue together" a third time | `/stats`, `/fun`, `/1v1` |
| Your own stuff is in four places: More → You (sign in, theme), your player page (reached by finding yourself on the board), Tonight (Your night, M14.36), and soon You vs them on *other people's* pages (M14.35) | spread |
| Admin has three ways in on desktop (top bar, More card, Tonight controls) and one buried way on phones (More, first card) | shell |
| Two jobs on one tab: "More" is both "other pages" and "settings" | More |

## 2. Page consolidation: the lean list

**Rule:** each destination answers one question a friend asks. If two pages answer the same question, they merge.
If a page only matters at one moment, it becomes a card at that moment, not a page in the nav.

| # | Destination | Question it answers | Path | Absorbs |
|---|---|---|---|---|
| 1 | **Tonight** | What's happening right now? | `/g/<slug>` | Live lobby, teams, receipt, result, **Mode card + routed panel** (M14.30, M15 modes), **Your night** (M14.36), **the Daily card** (already the share hook), Start a lobby, admin controls |
| 2 | **Board** | Who's on top? | `/g/<slug>/leaderboard` | Leaderboard; the **player page** hangs off it (tap any name); M16 **weekly storyline** sits at the top of the weekly window |
| 3 | **Games** | What happened in that game? | `/g/<slug>/games`, `/games/<id>` | History + game page (already one section); M16 **recap line** on the game page |
| 4 | **Stats** | Who holds the records, who plays what, who has whose number? | `/g/<slug>/stats`, `/stats/champions`, `/stats/1v1` | **Stats + Fun + 1v1** as three segments (below) |
| 5 | **You** | How am I doing, and against whom? | `/g/<slug>/you` | Your player page in the "you" lens, **You vs them for everyone** (M14.35), **Claim your games** landing (M14.33), Daily streak, **Admin entry** for admins, account (sign in/out, theme, later Ping me and Unlink). Signed out: the sign-in pitch (research #15) |
| – | Admin | Set the group up | `/g/<slug>/admin/*` | Not a tab. Entry: You (first card, admins only), desktop top bar, Tonight controls |
| – | Daily | Today's guess | `/g/<slug>/mystery` | Not a tab. Entry: the Tonight card, the You card, the Discord post. Counts as Tonight in the tab bar |
| – | Mode panel | Mode rules and pool | `/g/<slug>/mode` | Unchanged (M14.30). Counts as Tonight |
| – | How the bot decides / Get Kustom | Kustom-level pages | `/how`, `/download` | More's "This group" card. Footer on every page, plus the receipt's disclosure |

**Stats, split by question instead of by when it was built:**

| Segment | Content today | From |
|---|---|---|
| `Records` (default) | One game, CS by role, the habit, museums (pentakill, first blood, death hall…), luck, won against the odds | `/stats` + most of `/fun` |
| `Champions` | Most picked, most banned, fear ban, who they lock, one-trick, always a new champ | `/fun`'s champion half |
| `1v1` | Lane wars, lane bully, dead heat, **one** duos block (best/worst together + nemesis), Pick two | `/1v1` + Stats → Duos + Fun → Friends and enemies |

The segments are **links with `aria-current`**, styled as a segmented control (05-design 5.0's existing rule for
window pickers), so every segment has a URL and works without JS. The window chips are shared and carried across
segments in `?window=`. This also takes the sting out of the `/fun` payload problem (M14.17): Champions and Records
load separately.

**1v1 into the player page.** The *personal* half moves: on anyone's player page, a linked viewer sees You vs them
(M14.35) linking to `Stats → 1v1 → Pick two` with both people filled in. The *public* half (lane wars, any two
people) stays in Stats, because it's for arguing about other people too.

**Room to grow (replaces STRATEGY 2.4's "a new fun feature is one card in More"):** a new feature goes where
its moment is. If it happens tonight, it's a Tonight card (M15 modes are, via the Mode card). If it's about
records, it's a Stats section. If it's about you, it's a You card. If it's about one game, it's on the game page
(M16 recaps). **There is no sixth tab and no drawer.** A feature that fits none of these is a sign it isn't ready.

## 3. Navigation options

### Option A: five tabs, no More (recommended)

```
[ Tonight ] [ Board ] [ Games ] [ Stats ] [ You ]
```

- **Phone:** five equal tabs, 75px wide at 375, icon over word, 60px + safe area. That's the iOS/Material maximum,
  and every label is one short word. Live dot on Tonight as now. The top bar stays wordmark + group name only.
- **Desktop (≥ 1024):** `Tonight · Board · Games · Stats` in the middle; on the right, `Admin` (admins) and a
  `You` button (signed in) or `You` + `Sign in` (signed out). Same five, same order.
- **Discoverability:** everything is one tap from anywhere, and every destination is named on screen. No hidden
  rows.
- **Admin:** first card on You (`Admin · You run Customs Night`), the desktop top bar, Tonight's controls. Admins
  are 2 or 3 people per group, and they know where it is.
- **Account:** the You tab. Signed out, You is the sign-in pitch ("Your 83 games, your record with every friend").
  That turns the account tab into the sign-in incentive surface the research asked for, with no banner and no
  modal.
- **Bans:** none lifted. No dropdown, no sheet, no popover. Plain links.
- **Pros:** fewest taps; one destination per question; no drawer to rot; the You tab gives sign-in a permanent,
  polite home; zero new interaction patterns; screen-reader users get a flat list of five.
- **Cons:** five is the ceiling, so a sixth thing must fit inside one of the five (that's the point, but it's a
  discipline the lead has to hold). `You` for a signed-out visitor is a pitch page (that's fine, it's honest).
  Daily loses its standalone tab position. It never had a nightly tab-worthy audience, and the Tonight card plus
  the Discord post are where people actually come from.

### Option B: four tabs + a routed "More" sheet (alternative)

```
[ Tonight ] [ Board ] [ Games ] [ More ]  -> More opens a sheet at /g/<slug>/more
```

- **Phone:** the More tab opens a bottom sheet over the current page, with a scrim and a `Close` control. It's the
  Mode panel pattern (M14.30): an intercepting route, so the sheet has its own URL and renders as a full page
  without JS or on reload. Contents: Stats, Daily, Mode, Your page, Admin, theme, sign out, How, Get Kustom.
- **Desktop:** `More ▾` opens an anchored panel under the link (same route, same content).
- **Discoverability:** worse than A. Everything behind More is invisible until opened, and at 375 the sheet fills
  the whole screen (`b-open-375.png`), so it's really the More page in a costume.
- **Admin / account:** rows in the sheet.
- **Bans:** lifts "Sheet/Drawer: ban on public pages" and "DropdownMenu: ban". Justifiable only because it reuses
  the routed-panel decision, but that decision said "nothing else follows it".
- **Pros:** room for unlimited rows; closest to what the user literally asked for ("a drop down I can select
  pages"); the shell barely changes.
- **Cons:** the same junk drawer, one tap deeper; a second content overlay on public pages; focus trap, scroll
  lock and Back handling to maintain; does not solve the overlap between Stats, Fun and 1v1, only hides it.

### Option C: the group name is a dropdown (considered, not prototyped)

`Customs Night ▾` in the top bar opens a native `<details>` panel with the page list and, later, your other
groups. Bottom tabs stay at four.

- **Pros:** native and no-JS; the natural home for a **group switcher** when one is in scope.
- **Cons:** top-left is the hardest place to reach on a phone; two navigation systems (tabs and a dropdown) that
  overlap; a tapped name that opens a menu instead of going home breaks today's "the lockup goes home" rule.
- **Keep the idea for groups only:** when group switching is in scope (post-M14), the group name in the top bar
  becomes the native `<details>` group switcher. Pages stay in the tabs. That's a clean split: tabs for *where in
  this group*, name for *which group*.

### Recommendation: A

It answers the user's real complaint (More is ugly and pointless) by deleting More instead of moving it. It needs
no ban lifted, it fits the five-tab pattern every phone app uses (Team Up's bottom nav, which the audit praised),
and it gives sign-in a home. The user's "drop down I can select pages" instinct is served by Stats' segmented
control (pick a section in one tap) and, later, by C's group switcher.

## 4. The prototype

`redesign/nav/prototype/` (Direction C tokens via `../../prototypes/direction-c/c.css`, plus `nav.css`;
`build.py` writes the pages).

| Screen | 375 | 1440 |
|---|---|---|
| A, Tonight (tab bar closed state, Your night + Mode + Daily cards) | `screens/a-tonight-375.png` | `screens/a-tonight-1440.png` |
| A, Stats with Records / Champions / 1v1 segments | `screens/a-stats-375.png` | `screens/a-stats-1440.png` |
| A, You (linked admin: Admin card, You vs them, Daily, Account) | `screens/a-you-375.png` | `screens/a-you-1440.png` |
| A, You signed out (the sign-in pitch) | `screens/a-you-signed-out-375.png` | `screens/a-you-signed-out-1440.png` |
| B, closed | `screens/b-closed-375.png` | `screens/b-closed-1440.png` |
| B, More open (sheet / anchored panel) | `screens/b-open-375.png` | `screens/b-open-1440.png` |

Spec notes for A:
- Tabs: icons are Tonight (lamp), Board (bars), Games (grid), Stats (trophy), You (head and shoulders: a glyph,
  not an avatar, so Principle 6 holds). Active: 3px `--primary-text` bar on the top edge, filled icon, foreground
  label, `aria-current`.
- Desktop `You` button: icon + `You`, bordered; current = accent inset underline, the same as the nav links.
- Stats segments: `seg-links`, 44px, equal thirds, current = `--raised` + 3px accent underline + `aria-current`.
- You header: name in display 70% stretch, wraps (`overflow-wrap:anywhere`), `YOU` sticker, three stat tiles
  (Rating with rank, W-L with games, tonight's change). Numbers never wrap.
- You vs them rows: name, `With` and `Against` records in mono, one plain-language line under it. Tapping a row
  goes to `Stats → 1v1 → Pick two` with both of you filled in.

## 5. Impact on the build plan (for the lead)

1. **M14.7 shell (built):** amend. `lib/nav.ts`: `MainTabKey = 'tonight' | 'board' | 'games' | 'stats' | 'you'`;
   remove `more`; add `you` (`/you`, moved) and point `fun`/`versus` at `/stats/champions`, `/stats/1v1`.
   `currentMainTab`: `/stats*`, `/fun`, `/1v1` → stats; `/you` → you; `/mystery`, `/mode` → tonight; a player
   page → board (including your own: You is the lens, the player page is the public view). `TabIcon` gets
   `stats` and `you`. `TopBar`: the account link goes to `/you` (not `/more#you`); `You` + `Sign in` signed out.
   Delete `app/(group)/g/[slug]/more/` and the `MORE_*` strings in `shellCopy.ts`; the theme switch moves to You.
   Update `Shell.test.tsx` and `nav.test.ts`. One serial-lane task: **M14.7b "five tabs, You page shell"**.
2. **New route `/g/<slug>/you`** (in M14.7b, minimal: Admin card, account card, a link to your page; signed out:
   the pitch). It fills out in M14.15 (your player summary), M14.33 and M14.35.
3. **Redirects (308, query carried):** `/g/<slug>/more` → `/g/<slug>/you`; `/g/<slug>/fun` → `/g/<slug>/stats`
   (champion anchors to `/stats/champions`); `/g/<slug>/1v1` → `/g/<slug>/stats/1v1`; legacy `/stats`, `/fun`,
   `/1v1` → the `customs` equivalents above (amends the STRATEGY 2.6 redirect table).
4. **M14.15 (Board + player page):** the player page component takes a `lens: 'public' | 'self'`; `/you` renders
   the self lens plus account. The welcome card (M14.33) lands on `/you?welcome=1` instead of `/p/<you>?welcome=1`.
5. **M14.17 (Stats, Fun, 1v1, Daily):** rewritten as "**Stats with three segments**" plus Daily under the group.
   One duos block (it fixes the duo bug's surface along with the test). The `/fun` 1 MB cap still applies per
   segment. Daily at `/g/<slug>/mystery`, reached from Tonight and You, current tab Tonight.
6. **M14.9 / M14.30 (Tonight):** check that the Daily card is present on phones in idle and finished (today it's in
   the desktop rail; on phones it must be a card in the stack). The Mode panel is unchanged.
7. **M14.35 (You vs them):** two placements: the card on others' player pages (as briefed) **and** the
   everyone list on `/you`. Same query.
8. **M14.36 (Your night):** unchanged on Tonight; a one-line summary also on `/you` until 06:00.
9. **M14.22 / M14.23 (admin):** the admin entry is You's first card + desktop top bar + Tonight. The admin pages'
   back link goes to `/you`.
10. **M14.24 (landing, `/how`, `/download`):** absorbs More's `How this works` and `Get Kustom`. Until then the
    footer keeps `Get Kustom` and links the existing how-it-works copy.
11. **M15 / M16:** no new destinations. Modes stay on Tonight's Mode card; recaps go on the game page; the weekly
    storyline goes on Board; scouting reports go on the player page and You.
12. **Docs (after approval):** 05-design §5.11 rewritten for five tabs, §5.0 unchanged (no ban lifted); STRATEGY
    §2.4 (More table and room-to-grow rule), §2.5 (four tabs → five), §2.6 (URLs + redirects); one decision row:
    "More removed; five tabs; a feature joins the page where its moment is, never a sixth tab."

## 6. Open questions

1. Label `You` or `Me`? `You` matches the `YOU` sticker and the existing copy ("You vs them"). Recommended: `You`.
2. Should a signed-out phone see `Sign in` as the fifth tab label instead of `You`? Recommended: no. One label on
   every visit; the page does the asking.
3. Admin in the phone top bar as well (a small `Admin` link on the right for admins)? It's cheap and visible, but
   it crowds a long group name. Recommended: not now; revisit if admins report hunting for it.
