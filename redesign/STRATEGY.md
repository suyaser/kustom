# Kustom 2.0: strategy, information architecture, fairness receipt

Owner: `product`. Date: 2026-10-03. Phase 2 of the 2.0 redesign. No app code changes.

Inputs: `AUDIT.md`, `audit/notes/competitors.md`, `docs/00-product.md`, `docs/05-design.md`, M13 in
`docs/02-milestones.md`, `packages/core/src/balance/*` (what the stored numbers actually mean).

Every string a friend will read that is new in this document is tagged **[NEW COPY]**. Strings already in the
product are quoted with their source. Decisions are recorded in `docs/04-decisions.md` (rows dated
2026-10-03, "Kustom 2.0"). Rows marked *Phase 2 proposal* take effect when the user approves this document.

**Revised 2026-10-03 (same day)** with the user's answers to §7's seven questions: `/g/customs` is the public
demo, the bootstrap admin owns `customs`, an admin pairing in Host mode gets a host token, settling is 10 rated
games for now, **seasons are removed**, one-click Discord connect is in 2.0, and the landing page says `Free`.

---

## 0. Settled by the user today (not re-opened here)

1. **shadcn/ui on Tailwind v4.** The bans in `05-design.md` on shadcn defaults (toasts, skeletons, shadows)
   are rewritten by `redesign/design-system.md`. One product rule holds whatever the design system says:
   anything a person must know (a refusal, a reset, a rotated link) is never *only* in a toast.
2. **Security.** Service-role route handlers and `security definer` functions stay the enforcement point.
   RLS **read** policies are added as defence in depth (own memberships, admin-only invite and member reads).
3. **Groups are public by link.** Private groups are future work. Still no public list of groups.
4. **In 2.0:** an `owner` role (owner / admin / member), member removal, and a per-group rating reset.
   This reverses "ratings never reset" (2026-09-10) and M13's "removing a member" reservation.
7. **Seasons are removed** (answer 5): "what does a season mean, we work weekly now". No season names, no
   season page, no season archive, no season-scoped reads. The weekly board is the fresh start players see.
   The rating reset survives as a plain owner action, `Reset ratings` (§3.6). *Assumption, the lead's reading,
   to confirm:* the user approved the reset earlier today and did not withdraw it by removing seasons.
8. **Also settled (answers 1 to 4, 6, 7):** `/g/customs` is the demo group; the bootstrap admin is its owner;
   an admin pairing in Host mode gets a host token automatically (§3.2 step 4); settling is **10 rated games,
   for now** (§5); Discord connect is one-click OAuth in 2.0 (§3.2 step 2); the landing page says `Free`.
5. **M13.10 to M13.14 are folded into the 2.0 build.** No page gets restyled at its old path and then moved.
6. **Local dev points at the local Supabase.** The hosted values live in `apps/web/.env.hosted.local`.
9. **Tonight's mode is one `Mode` card plus a routed panel** (2026-10-03, later the same day): the card
   summarises the mode (`Normal` or `Fearless` in 2.0, M15 adds the rest), admins and the owner pick it there
   and reset fearless there, and tapping it opens `/g/<slug>/mode`, an overlay from Tonight and a full page from
   a link. No Fearless page, no Fearless card in More (§2.4, §2.6, §6(a)). The rated toggle the user asked for
   arrives with M15's first unrated mode; in 2.0 both modes are rated as today.
10. **Companion UI changes are out of 2.0, M15 and M16** (2026-10-03): the user will replace the companion UI
   entirely. Engine work stays; the overlay's open-first panel waits for the rewrite.
11. **Five tabs, no More page** (2026-10-03, option A of `redesign/nav/proposal.md`): `Tonight · Board · Games ·
   Stats · You`. Stats is Stats + Fun + 1v1 as three segments (`Records · Champions · 1v1`); You is your player
   page seen as you plus You vs them, the claim landing, Your night, Daily, the `Admin` card (admins) and the
   account, and the sign-in pitch when signed out. Daily and the `Mode` card sit on Tonight; `How the bot
   decides` and `Get Kustom` are in the footer. New features go where their moment is; no sixth tab, no drawer
   (§2.4, §2.5, §2.6, §6). Supersedes the four tabs plus More.

---

## 1. Positioning

**One line [NEW COPY]**

> Kustom picks fair teams for your League customs and keeps score by itself. Nobody picks, nobody votes,
> nobody argues.

**Three proof lines [NEW COPY]** (refined from the research's three)

| # | Line | Why it's true | Why this wording |
|---|---|---|---|
| 1 | **Nobody votes on who won.** The result comes straight from the League client. | The companion reads the end-of-game screen. No `/win`, no reporting. | Kept word for word: it names the competitor's weak spot (InHouse Queue's 6-of-10 vote) without naming them. |
| 2 | **Nobody can hand-edit a rating.** Yours moves when a game ends, and only then. | No route, script or button sets one person's number. | "No admin can touch your rating" stopped being strictly true today: an owner can now reset the whole group's ratings at once. "Hand-edit" stays true and is the thing people actually fear. |
| 3 | **Every split shows its odds.** Win chance, rating gap, and the other options the bot turned down. | `splits` stores win %, gap, off-role count and all three ranked candidates. | "Math" sounds like homework. "Odds" is what a gamer already reads. |

**Who it's for.** A friend group of ten to twenty who play League custom 5v5s regularly, from casual to
try-hard, with ranks all over the place. They talk in Discord, open links on their phones, and are tired of
"who's captain", "those teams are stacked" and "wait, who won game 2". One or two of them are happy to run a
small Windows app. Nobody wants to be the organiser.

**Who it's not for (yet).** Public in-house servers with strangers, other games, Mac-only groups (somebody in
the lobby needs Windows), and anyone who wants captains or manual picks.

---

## 2. Site map and information architecture

### 2.1 The two places

1. **Kustom itself**: `/` (landing), `/how` (how the bot decides), `/download`, `/new`, `/join/<code>`, `/ops`.
   No group's data, except the public demo group's live receipt on `/`.
2. **A group's space**: everything under `/g/<slug>`. Public by link. Every link on it stays inside the group.

### 2.2 `/`: who sees what

| Visitor | `/` does |
|---|---|
| Signed in, member of at least one group | **Redirect (307)** to their group (M13.9's rule: the `kustom_group` cookie's group if they're in it, else their oldest membership). A regular has no reason to see a pitch every night. |
| Signed in, in no group | The landing page, with `Create your group` as the primary button. (Replaces M13.9's redirect to `/new`: a newcomer should see what they're creating first.) |
| Signed out, with a `kustom_group` cookie | The landing page, plus a one-line bar above the hero: `Back to <Group name> →` linking `/g/<slug>`. **[NEW COPY]** This covers the original group's friends who open an old `/` link signed out. |
| Signed out, no cookie | The landing page. |

**Choice: redirect, not a link,** for signed-in members. The landing page stays reachable for everybody at
`/about` (same page, never redirects), linked from every group's footer as `What's Kustom?` **[NEW COPY]**.

This reverses M13.9's "signed out → `/g/customs`". The Discord posts have linked `/g/customs` since M13.9,
so only very old pasted links hit `/`, and the cookie bar catches most of them.

### 2.3 The landing page, section by section

Mobile first: each section works as one phone screen. No scroll-reveal animations that render empty (the
competitor audit's IHQ trap). No hidden text for AI assistants, ever.

**1. Hero**

- Headline **[NEW COPY]**: `Fair teams. No arguments.`
- Sub **[NEW COPY]**: `Kustom reads your League custom lobby, splits the ten into two even teams with real
  roles, and keeps ratings from actual results. Nobody picks. Nobody types.`
- Primary button: `Create your group` **[NEW COPY]** (→ `/new`). Secondary link: `See a real group` **[NEW COPY]**
  (→ the demo group, `/g/customs`, the original group: settled).
- Beside the copy on desktop, under it on phones: **a real fairness receipt** (full variant, §4a) from the demo
  group's latest rolled game, rendered from data, with its date. Falls back to the worked example in
  `00-product.md` (Hana and Omar, Blue 54%) if the demo group has no rolled game.

**2. The problem** (pain first)

- Heading **[NEW COPY]**: `Sound familiar?`
- Three chat-bubble lines **[NEW COPY]**: `"Who's picking teams?"` / `"Bro, those teams are stacked."` /
  `"Wait, who won game 2?"`
- Close **[NEW COPY]**: `Kustom ends all three before they start.`

**3. How it works, in three steps [NEW COPY]**

1. `Get in a lobby.` One friend has Kustom running. Everyone joins the custom like always.
2. `An admin taps Roll teams.` The bot tries every way to split the ten, picks the fairest, and posts it to your Discord
   with the odds.
3. `Play.` When the game ends, Kustom reads the result from the client. Ratings move. The leaderboard updates.
   Nobody reports anything.

**4. The proof: a split, with its math**

- Heading **[NEW COPY]**: `Every split shows its odds.`
- The same real receipt as the hero, here with **"How the bot decided" open** (§4d), so all three candidate
  splits are visible without a tap.
- Below it, the demo group's calibration line (§4e), e.g. **[NEW COPY]**
  `In Customs Night, the side the bot favored won 27 of 48 games (56%). The bot expected 55%.`
  Hidden until the demo group has 20 qualifying games.
- Three short trust lines **[NEW COPY]**:
  - `Nobody picks the teams. Not the admins, not the host.`
  - `Nobody can hand-edit a rating. It only moves when a game ends.`
  - `Admins can roll, and reroll to the bot's next pick. The owner can reset everyone's ratings at once, never one person's. That's it.`

**5. Try it before you install anything**

- Heading **[NEW COPY]**: `Look around a real group.`
- Body **[NEW COPY]**: `Customs Night has played 100+ games with Kustom. Their tonight page, leaderboard and
  every game are public. No sign-in needed.` (The count is live from the database, rounded down to the ten.)
- Button **[NEW COPY]**: `Open Customs Night`
- Honest live counters (from the database, across all groups, rounded down) **[NEW COPY]**:
  `<N> games refereed · <N> players rated · 0 results typed in`. The last one is a joke that is also true.

**6. The companion, explained honestly**

- Heading **[NEW COPY]**: `The one download, and what it does.`
- Body **[NEW COPY]**:
  - `Kustom has a small Windows app. Only one friend per lobby needs it running. Everyone else just plays.`
  - `What it reads: who's in your custom lobby, the end-of-game stats screen, and your past customs from the
    client's match history, so your group's history fills in by itself.`
  - `What it can do, when you tap a button on the site: open the custom, send the invites, and move players to
    their side.`
  - `What it never touches: champion select, anything in game, your account or password. It doesn't play for
    you and it doesn't ban for you.`
  - `Windows only, for now. Friends on Mac can still play in the lobby; they just can't be the one hosting.`
  - ~~`Want the fearless ban list on screen during champ select? Anyone can install it in Overlay mode. Optional.`~~
    *Withdrawn 2026-10-04: the Rust Kustom (M17) has no overlay; M17.12 removes `COMPANION_OVERLAY` and the
    `/download` Overlay terms.*
- Link **[NEW COPY]**: `Get Kustom for Windows` (→ `/download`, never the `.exe` directly: this is read on
  phones).

**7. Create your group (final CTA)**

- Heading **[NEW COPY]**: `Start your group in two minutes.`
- Three-line checklist preview **[NEW COPY]**: `Name it.` / `Connect your Discord channel.` / `Send your
  friends one link.`
- Button: `Create your group`. Signed-out visitors go through Discord sign-in and come back to `/new`.
- Under the button **[NEW COPY]**: `Free. Sign in with Discord to start.`

**8. Short FAQ** (collapsed, `<details>`, no JS needed) **[NEW COPY]**

- `Is this allowed by Riot?` → `Kustom only reads the League client and opens custom lobbies, the way you
  would by hand. It never touches champion select or the game itself.`
- `Do we all need to install something?` → `No. One person in the lobby runs it.`
- `What if someone's new?` → `Everyone starts at 1200. A new player's rating moves fast for their first
  games, then settles.`
- `Can an admin rig it?` → `No. Admins can't pick teams or edit ratings. They tap Roll teams; the bot does the
  rest, and shows its work.`
- `Does it cost anything?` → `No. Kustom is free.` (Settled: the page may say `Free`.)

### 2.4 The group space `/g/<slug>`

**Revised 2026-10-03 (later the same day): five destinations, no More hub.** The user chose option A of
`redesign/nav/proposal.md`: every destination answers one question a friend asks, two pages that answer the same
question merge, and a page that only matters at one moment becomes a card at that moment. This supersedes the
four sections plus the More hub this section first described (decision row 2026-10-03).

| Section | Path | Question it answers | Absorbs | Who |
|---|---|---|---|---|
| **Tonight** | `/g/<slug>` | What's happening right now? Job 1: the live lobby, the teams with their receipt, the game in progress, the result. When nothing's on: last result, standings, Start a lobby. | The `Mode` card and its panel, Your night (M14.36), the Daily card, admin controls | Everyone |
| **Board** | `/g/<slug>/leaderboard` | Who's on top? Job 2: ratings, windows, trend, new players. | The player page hangs off it (tap any name) | Everyone |
| **Games** | `/g/<slug>/games`, `/g/<slug>/games/<id>` | What happened in that game? Job 3: history, filter by player and date, receipt on every row, one game page with scoreboard + receipt. | | Everyone |
| **Stats** | `/g/<slug>/stats`, `/stats/champions`, `/stats/1v1` | Who holds the records, who plays what, who has whose number? | Stats, Fun and 1v1, as three segments (below) | Everyone |
| **You** | `/g/<slug>/you` | How am I doing, and against whom? | Your player page seen as you, You vs them with everyone (M14.35), the claim landing (M14.33), Your night's one-line summary (M14.36), the Daily streak, the `Admin` card (admins, first), the account (Day / Night theme, sign out). Signed out: the sign-in pitch (below) | Everyone (what it shows depends on who's looking) |

Not tabs, each counted under a tab in the bar:

| Page | Path | Reached from | Tab marked current |
|---|---|---|---|
| **Player** | `/g/<slug>/p/<puuid>` | Tapping any name; your own from You | Board (your own page too: You is the lens, the player page is the public view) |
| **Mode panel** | `/g/<slug>/mode[?lane=]` | Tonight's `Mode` card; Discord. Tonight's mode in full (Fearless: what's open and banned, by lane; Normal: every champion open; from M15, each mode's pool). Opens over Tonight from the card (full screen on phones, a dialog on desktop); the same URL loaded from a link is a full page. No controls in it. | Tonight |
| **Daily** | `/g/<slug>/mystery` | The Daily card on Tonight, the Daily card on You, the Discord post | Tonight |
| **Admin** | `/g/<slug>/admin/*` | The first card on You (admins), `Admin` in the desktop top bar, Tonight's admin controls. Job 4: setup checklist, invite, members and roles, Discord, hosts, rating reset. Its back link goes to `/you`. | none (the desktop `Admin` link is marked) |
| **How the bot decides**, **Get Kustom** | `/how`, `/download` | The footer of every page; the receipt's disclosure links `/how` | Kustom-level pages, no group tabs |

**Stats, split by question** (not by when each page was built). The segments are links with `aria-current`
styled as a segmented control, so each has its own URL and works without JavaScript; the window chips are
shared and carried across segments in `?window=`.

| Segment | What's in it | From |
|---|---|---|
| `Records` (default, `/stats`) | One game, CS by role, the habit, the museums (pentakill, first blood, death hall...), luck, won against the odds | `/stats` and most of `/fun` |
| `Champions` (`/stats/champions`) | Most picked, most banned, fear ban, who they lock, one-trick, always a new champ | `/fun`'s champion half |
| `1v1` (`/stats/1v1`) | Lane wars, lane bully, dead heat, **one** duos block (best and worst together, nemesis), Pick two | `/1v1`, Stats → Duos, Fun → Friends and enemies |

**The segment name is `Champions`** (product, 2026-10-03). It is the word players use for the thing ("who's
on what champ"), it is one word that fits a third of 375px, and nothing else in the product is called that.
`Picks` was the alternative and is wrong: bans are in the same segment.

**1v1, the personal half.** On anyone's player page a linked viewer sees You vs them (M14.35), and on You the
same numbers for everyone at once; each row links to `Stats → 1v1 → Pick two` with both people filled in. The
public half (lane wars, any two people) stays in Stats, because it's for arguing about other people too.

**You, signed out: the sign-in pitch [NEW COPY].** One plain page, no banner and no modal anywhere else:

> **See it from where you stand.**
> Sign in and this page becomes yours: every game you've played with <Group>, your Rating, and your record
> with and against each friend.
> `Sign in with Discord`
> Nothing here is hidden. Every game and every number is already public; signing in just puts you at the
> centre of it.

Signed in but not linked to a League account in this group (M14.33's line, then §3.4's way in):

> **Which League account is yours?** Once we know, you'll see every game you've played with this group.
> Next time you're in their lobby, open this group's tonight page and tap your name. That's it.

Signed in and linked, no games in this group yet: `That's you. No games with this group yet. Your first one
shows up here.` (M14.33). The account card (theme, `Sign out`) shows in both signed-in states.

**Room to grow (replaces "a new fun feature is one card in More"):** a new feature goes where its moment is.
If it happens tonight, it's a Tonight card (M15's modes are options on the `Mode` card and panels at
`/g/<slug>/mode`; there is no `/g/<slug>/fearless` page). If it's about records, it's a Stats section. If it's
about you, it's a You card. If it's about one game, it's on the game page (M16's recaps). **There is no sixth
tab and no drawer.** A feature that fits none of these isn't ready.

**The Daily card** sits on Tonight, in idle and finished, on phones as a card in the stack (not only in the
desktop rail). It's the share hook the audit liked.

### 2.5 Navigation

**Revised 2026-10-03: five tabs, no More** (the user, option A of `redesign/nav/proposal.md`; supersedes the
four-tab bar plus More, decision row 2026-10-03).

**Phones (primary): a bottom tab bar, five tabs.**

```
[ Tonight ]  [ Board ]  [ Games ]  [ Stats ]  [ You ]
```

- Icon plus word on every tab, never icon alone (75px each at 375). Fixed, plus the safe area. The current
  section is marked by more than colour (weight and an indicator). The You icon is a head-and-shoulders glyph,
  never an avatar.
- **The fifth label is `You` for everyone**, signed in or not. A signed-out visitor never sees `Sign in` as a
  tab label; the You page does the asking.
- **Tonight is a tab again on phones.** This reverses M13.9's "no Tonight tab, the wordmark is home" for the
  bottom bar only. The wordmark still links home too.
- **Admin is not a tab.** On phones admins reach it from the first card on You and from Tonight's admin
  controls. **No `Admin` link in the phone top bar** (2026-10-03 default; revisit only if admins report hunting
  for it).
- Live dot on the Tonight tab while a lobby is filling or a game is on, *only* when the realtime channel is
  actually connected (audit problem 10).
- **Five is the ceiling.** No sixth tab, no drawer, no dropdown, no sheet (§2.4's room-to-grow rule).

**The top bar on phones:** wordmark, group name (wraps, never clipped), and nothing else. No horizontal
scrolling tabs anywhere (audit problem 7).

**Desktop (≥ 1024px): one top bar.** Wordmark + group name on the left; `Tonight · Board · Games · Stats` in the
middle; on the right `Admin` (admins only) and a `You` link (signed in) or `You` plus `Sign in` (signed out).
Same five, same order, so a person who learned it on the phone knows it on the laptop. No bottom bar on desktop.
Tablets (768) use the phone layout.

**The footer of every page** (group pages, Kustom pages, admin, errors): Riot's developer-policy notice (M14.8's
wording), `How the bot decides` → `/how`, `Get Kustom` → `/download` (the releases page until `/download`
exists, M14.24), and on group pages `What's Kustom?` → `/about` (§2.2).

**Kustom-level pages** (`/`, `/new`, `/join`, `/how`, `/download`) have the bare shell: wordmark, sign-in, no
group tabs.

### 2.6 URL list

| Path | Page | Status |
|---|---|---|
| `/` | Landing (or redirect to your group, §2.2) | new |
| `/about` | Landing, never redirects | new |
| `/how` | How the bot decides: the receipt explained, FAQ | new |
| `/download` | Get Kustom: what it reads and never touches, Windows only, Host vs Overlay, link to the release | new (replaces the footer's `Get the companion` external link) |
| `/new` | Create a group | M13.13 |
| `/join/<code>` | Join a group | M13.13 |
| `/ops` | Operator, super-admin only, else 404 | M13.14 |
| `/g/<slug>` | Tonight | M13.9 (built) |
| `/g/<slug>/leaderboard[?window=]` | Board | M13.10 |
| `/g/<slug>/p/<puuid>[?window=]` | Player | M13.10 |
| `/g/<slug>/games[?player=&from=&to=&mode=]` | Games | M13.11 + new filters |
| `/g/<slug>/games/<id>` | One game: scoreboard + receipt | M13.11 |
| `/g/<slug>/you` | You: your player page seen as you, You vs them, the claim landing, account; signed out, the sign-in pitch (§2.4) | new (M14.7b, filled by M14.15, M14.33, M14.35, M14.36) |
| `/g/<slug>/mode[?lane=]` | The mode panel: tonight's mode in full (Fearless by lane, Normal, M15's modes). An intercepted overlay from Tonight, a full page when loaded directly (Discord links land here) | new (M14.30) |
| `/g/<slug>/stats[?window=]` | Stats → Records (default segment) | M14.17 (from `/stats` and most of `/fun`) |
| `/g/<slug>/stats/champions[?window=]` | Stats → Champions | M14.17 (from `/fun`'s champion half) |
| `/g/<slug>/stats/1v1[?window=&a=&b=]` | Stats → 1v1, Pick two filled when both are given | M14.17 (from `/1v1` and both duos blocks) |
| `/g/<slug>/mystery` | The daily guess, scoped; current tab Tonight | M14.17 |
| `/g/<slug>/admin` | Admin home: checklist, invite card, tonight shortcuts | M13.14 |
| `/g/<slug>/admin/members` | Members, roles, removal (replaces `/admin/players`) | M13.14 + new |
| `/g/<slug>/admin/discord` | Discord channel | M13.14 |
| `/g/<slug>/admin/hosts` | Host tokens (replaces `/admin/tokens`) | M13.14 |
| `/g/<slug>/admin/games` | As today, scoped | M13.14 |
| `/og/g/<slug>/tonight`, `/og/g/<slug>/games/<id>`, `/og/g/<slug>/p/<puuid>` | Share cards | M13.9 to M13.11 |

**Permanent redirects (308), query strings carried:**

| Old | New |
|---|---|
| `/leaderboard` | `/g/customs/leaderboard` |
| `/p/<puuid>` | `/g/customs/p/<puuid>` |
| `/games` | `/g/customs/games` |
| `/g/<slug>/more` | `/g/<slug>/you` (the hub is deleted, M14.7b) |
| `/g/<slug>/fun` | `/g/<slug>/stats` (M14.17) |
| `/g/<slug>/1v1` | `/g/<slug>/stats/1v1` (M14.17) |
| `/stats`, `/fun`, `/1v1` | `/g/customs/stats`, `/g/customs/stats`, `/g/customs/stats/1v1` (M14.17) |
| `/mystery` | `/g/customs/mystery` |
| `/admin`, `/admin/players`, `/admin/tokens`, `/admin/discord`, `/admin/games` | `/g/customs/admin`, `.../members`, `.../hosts`, `.../discord`, `.../games` |
| `/admin/seasons` | `/g/customs/admin` (the page is deleted; seasons are removed, §3.6) |
| `/admin/login` | keeps working (sign-in), then returns to where it came from |
| `/g/<game uuid>` | `/g/<its slug>/games/<id>` (M13.9, built) |
| `/og/tonight`, `/og/p/<puuid>`, `/og/g/<uuid>` | their `/og/g/<slug>/...` paths |

---

## 3. Onboarding flow

### 3.1 The shape

Four steps for the person creating a group, each one time only, none of them during a night:

1. **Create the group** (`/new`)
2. **Connect Discord** (`/g/<slug>/admin/discord`)
3. **Invite players** (the invite card)
4. **Install Kustom on one PC** (`/download` + a six-character code)

They live as **a checklist card at the top of the admin home**, titled `Get your group ready` **[NEW COPY]**.
Each row has a state (`To do` / `Done`) shown in words and an icon, and a one-line "why". Rows can be done in
any order. The checklist is **derived from data, never from clicks** (no "mark as done" button, no stored
progress), so it can't lie and a second admin sees the same truth.

When every required row is done, the card collapses to one line: `Your group is ready for game night.`
**[NEW COPY]** It never comes back unless a fact stops being true (the webhook is removed, every host token is
revoked), in which case that row reopens.

This replaces 05-design.md's "no step 1 of 3, no progress bar" rule for the admin home only: the checklist is
not a wizard (nothing blocks the next screen), it's a status board for one-time setup. `/new` itself still
does one thing.

### 3.2 Step by step

**Step 1. Create the group**

| | |
|---|---|
| Screen | `/new`, as M13.7/M13.13 specified: `Start a group`, `Name`, `Link`, `Create`. Signed out: heading plus `Sign in with Discord`. |
| User does | Types a name and a link once. |
| Done looks like | Row 1 is already `Done` on arrival: `Group created. Your link: kustom.gg/g/<slug>` **[NEW COPY]** (host shown as the real origin). |
| Skip | Can't skip; it's the entry. |
| Unlinked creator | **Change from M13.13:** they land on `/g/<slug>/admin` straight away as owner, not on a pairing screen. Pairing moves to the checklist (step 4), because the PUUID link is only needed once Kustom is installed, and asking for a code before they've downloaded anything is a dead end. See §3.3. |

**Step 2. Connect Discord**

| | |
|---|---|
| Screen | `/g/<slug>/admin/discord`: one button, `Connect Discord` **[NEW COPY]**, with the line `Pick the server and channel for teams and results. You need permission to manage webhooks there.` **[NEW COPY]** Below it, small: `Or paste a webhook link instead` **[NEW COPY]**, which opens today's field (`Webhook link`) with the how-to `In Discord: Server Settings → Integrations → Webhooks → New Webhook. Pick the channel for teams and results. Copy Webhook URL and paste it here.` **[NEW COPY]** and `Save and send a test post` **[NEW COPY]**. |
| How it works | **One-click connect (settled: in 2.0).** The button sends the admin to Discord's own authorize page with the OAuth2 scope `webhook.incoming`; Discord shows a server and channel picker; on return Kustom exchanges the code, receives the webhook Discord created for that channel, stores it as the group's webhook (the same column the pasted link fills) and sends the test post. The OAuth `state` is bound to the admin's session and the group, so a callback can only connect the group the admin started from. Kustom keeps the webhook, not a Discord login. |
| User does | Taps one button, picks a channel in Discord, taps `Authorize`. (Fallback: pastes one link.) |
| Done looks like | The test post lands in the channel (`Kustom is connected. Teams and results will show up here.` **[NEW COPY]**) and the row reads `Done · test post sent <time ago>` **[NEW COPY]**. (Correction to the first draft, which promised `#<channel>`: a webhook carries a channel id, not its name, and Kustom has no bot token to look the name up. Discord shows the webhook in the channel, so the admin already knows where it went.) A failed test keeps the row `To do` with Discord's reason. |
| Edge cases | Admin cancels on Discord's page, or has no server where they can manage webhooks: back on the page with `Discord wasn't connected. Try again, or paste a webhook link instead.` **[NEW COPY]** Connecting again replaces the old webhook (one channel per group, as today). The webhook later deleted in Discord: posts fail, the row reopens (§3.1). |
| Depends on | A Discord application with a client id, client secret and the redirect URL registered, as server env vars in `.env.example`. It can be the same Discord app as sign-in. Sign-in itself needs the hosted Supabase Discord provider enabled, which may not be done yet; without sign-in nobody reaches this page at all. |
| Skip | Fine. Kustom works without Discord: the tonight page, board and history all work. Row stays `To do` with `Without this, teams and results only show on the site.` **[NEW COPY]** |
| Second admin | Sees `Done · test post sent <time ago>` and can reconnect or paste a new link. |

**Step 3. Invite players**

| | |
|---|---|
| Screen | The invite card on the admin home (M13.7): `Invite your group`, the full link, `Copy link` / `Copied` **[NEW COPY]** (fills M13.7's `[copy owed]`), `New link` with the confirm `The old link will stop working.` and the confirming button `Make a new link` **[NEW COPY]**. |
| User does | Copies the link into the group chat. |
| Done looks like | `Done · <N> people in the group` once **one other person** is a member, by link or by playing. Before that: `To do · Just you so far` **[NEW COPY]**. |
| Skip | Fine, and the row says why: `Friends also join by playing: anyone in a lobby with your Kustom joins the group automatically.` **[NEW COPY]** (M13.3's "playing is joining" stays the main way people join.) |
| Player opening the link | See §3.4. |

**Step 4. Install Kustom on one PC**

| | |
|---|---|
| Screen | Row 4 links `/download` and, on the admin home, a `Set up this PC as host` **[NEW COPY]** card: (1) download, (2) open Kustom with League running, (3) type this code: the same six-character pairing code as `/join` (15 minutes, single use), with `Copy`. (Amended 2026-10-04, admin audit: the Rust Kustom (M17) has no mode picker, so there is no `Host` to pick; M17.12 changes `HOST_STEP_OPEN` to match.) |
| How it works | **Settled: an admin who pairs Kustom with a code gets a host token automatically.** Kustom sends the code with the PUUID it reads from the client; the server links the admin's Discord session to that PUUID if they aren't linked yet (M13.5's rules unchanged: never re-links, never steals a PUUID), and because the session is an admin or owner of the group, mints a host token for that PUUID in that group and hands it back once. Kustom saves it. No 43-character token to copy. |
| Edge cases | The client is signed in to a different account than the admin's linked one: no token, Kustom says `This code is for <Admin name>'s League account. Sign in to that account in League, then type the code again.` **[NEW COPY]** (amended 2026-10-03, copy review row 6: the reader is already an admin, and the Hosts page mints a token, not a code) A non-admin pairs: they're linked and joined as today, no token, and Kustom says `You're in. Only admins can host. Ask an admin to host, or to make you one.` **[NEW COPY]** (amended 2026-10-04, lead ruling at M17.2; the server's `HOST_NOT_ADMIN` changes at M17.12). A host on somebody else's PC: make that friend an admin, and they pair their own PC with their own code (the user, 2026-10-04). There is no admin-issued code for another person's PC, and the Hosts page's hand-made key goes away when the Rust Kustom ships (M17.12). |
| User does | Downloads, installs, types a six-character code once. |
| Done looks like | `Done · Kustom seen on <label>, <time ago>` from `companion_tokens.last_seen_at` in this group. While a token exists but has never connected: `Waiting for Kustom to connect…` **[NEW COPY]** with no spinner. |
| Skip | The group can exist but **nothing gets recorded**. The row says it plainly: `Kustom has to be running in the lobby for teams and results to work.` **[NEW COPY]** This is the one required row. |
| Second admin | Pairs their own PC with their own code from this card. Two hosts is normal. |
| The 0.3.x window (2026-10-04) | Pairing with a code makes a host only in the Rust Kustom (1.0.0, M17). Between the 2.0 deploy and M17.12, 0.3.x is the download and cannot become a host from a code, so only `customs` hosts (with its existing token) and new groups are not promoted (the user, decision row 2026-10-04). No interim hand-key flow is built (M14.49 dropped). |

**Optional row 5, shown after step 4:** `Play your first game` **[NEW COPY]** → `Done` when the first game is
recorded. The collapse line in §3.1 waits for row 4 and row 5; rows 2 and 3 are recommended, not required.

### 3.3 Where this differs from M13.5 / M13.7 / M13.13, and what I choose

| Topic | Built / specified | 2.0 choice | Why |
|---|---|---|---|
| Unlinked creator after `Create` | M13.13: pairing code screen, then admin | Straight to admin as **owner**; pairing becomes part of step 4 | A code that needs Kustom, shown before Kustom is installed, is a wall. The server already lets a creator get a code any time (M13.5: "allowed for the group's creator"). |
| Creator's role | `admin` (M13.5) | `owner` (one per group) | User decision 4. |
| Host token for the creator | Minted by hand on `/admin/tokens` | **An admin's pairing with a code mints it** (settled). The hand-made key on Hosts is removed at M17.12, when the Rust Kustom ships (amended 2026-10-04, admin audit) | Amends the 2026-09-23 "Host pastes an admin-minted token" and M13.5's "minting a companion token per invitee" rejection, for admins only. A member pairing still gets no token. |
| Discord connect | Paste a webhook link | **Discord OAuth (`webhook.incoming`)**, paste as fallback | Settled: in 2.0. |
| `/join/<code>` unlinked | Pairing code via Kustom, or "Download it" | **Two ways**, Kustom code *or* "pick yourself next game" (below) | Most friends will never install Kustom. Making a download the only way to join breaks the scene. |
| Join copy button label | `[copy owed]` | `Copy link` / `Copied` | Fills the slot. |
| Rotate confirm button | `[copy owed]` | `Make a new link` | Fills the slot. |
| Pairing expired line | `[copy owed]` | `That code ran out.` + `New code` button **[NEW COPY]** | Matches the server's 410 sentence. |
| `You're in.` after one-tap join | Designer's flag | Yes, same `?joined=1` | One way in should look like the other. |
| Super-admin sees the invite link | Open (M13.7) | **No.** The link renders masked for a super-admin who isn't an admin: `Hidden. Only this group's admins can see the invite link.` **[NEW COPY]** | Seeing the link is a door to joining. Also matches decision 2's admin-only invite reads. |

### 3.4 A player opening the invite link

| State | What they see |
|---|---|
| Dead code | `This link doesn't work anymore. Ask your group for the new one.` (M13.13) |
| Signed out | `<Group> uses Kustom to pick fair teams for your customs.` (M13.13) + `Sign in with Discord`, then back here. |
| Signed in, already a member | Straight to `/g/<slug>`. |
| Signed in, linked | `Join <Group>` → `/g/<slug>?joined=1` → `You're in.` |
| Signed in, not linked | Heading: `Which League account is yours?` **[NEW COPY]** Two cards: |
| | **`I have Kustom`**: the six-character code, `Open Kustom on your PC with League running, then type this code under Join a group:` (M13.13), `It works for 15 minutes.` |
| | **`I don't`** **[NEW COPY]**: `No problem. Play a game with the group. Next time you're in their lobby, open this group's tonight page and tap your name. That's it.` Plus `Open <Group>` → `/g/<slug>`. (This is M3.6's existing pick-yourself, which links the Discord account to the PUUID from the lobby the companion saw. Lazy membership already made them a member when they joined the lobby.) |

**What a player who never opens the link experiences:** nothing changes. They play in the lobby, they're a
member, they're on the board. The link exists for the web taps (Start a lobby, Role for tonight).

**A second admin's path:** joins like any player, then the owner or an admin taps `Make admin` on Members. Their
next visit to Tonight shows the admin controls, and You shows the `Admin` card first. They see the same checklist.

### 3.5 Roles in 2.0

| Can | Member | Admin | Owner |
|---|---|---|---|
| Start a lobby, Role for tonight | yes | yes | yes |
| Roll teams, Reroll | | yes | yes |
| Pick tonight's mode and Reset fearless (Tonight's `Mode` card only, 2026-10-03) | | yes | yes |
| Invite card, New link, Discord settings, host tokens | | yes | yes |
| Make a member an admin | | yes | yes |
| Remove a member | | yes (members only) | yes |
| Remove an admin, make an admin a member | | | yes |
| Reset ratings (everyone, §3.6) | | | yes |
| Hand ownership to an admin | | | yes |

- **Exactly one owner per group**, always. The last-admin guard becomes the owner guard: the owner can't be
  demoted or removed; they hand ownership to an admin first (`Make owner`, confirm: `<Name> becomes the owner.
  You'll stay an admin.` **[NEW COPY]**). Existing groups: `customs`'s owner is the bootstrap admin (the
  `BOOTSTRAP_ADMIN_PUUID` player: settled); any other existing group's `created_by` player.
- **Removing a member** (`Remove from group`, confirm `<Name> leaves the board. Their games stay in history. If
  they play with you again, they're back.` **[NEW COPY]**): deletes the membership; their host tokens stop
  working; their games and the names on them stay; they disappear from the board. **Playing is joining still
  wins:** if they're in a lobby with the group again, they rejoin with the rating they had. Removal is for people
  who left or alt accounts, not a ban. Banning is out of scope.

### 3.6 No seasons; the weekly board is the fresh start; one owner-only rating reset

**Seasons are removed in 2.0** (the user: "what does a season mean, we work weekly now, I think season is legacy
that needs to be removed"). They were already mostly gone: since 2026-09-10 (M5.14) there is one season row,
created by migration, and no way to start another. 2.0 removes what's left:

- **On screen:** the `/admin/seasons` page (deleted, its old link redirects to the admin home), the no-season
  sentences (M2.18's refusal, M3.17's tonight line), and every word "season" in copy. No season names, no
  season archive, no past-season boards.
- **In reads:** nothing filters on `season_id`. A group's ratings are "the group's ratings".

**The fresh start players see is the week.** It already exists: M7.2 / M7.3 (landed 2026-09-15) built a second,
independent weekly rating that starts **everyone at 1200 every Sunday 06:00** (M5.34 moved it from Monday) and
follows only that week's games. It drives `This week` / `Last week`, the weekly awards and the weekly Discord
post, and never forms teams. Nothing new is needed for it in 2.0. The weekly board is the default board view
(as today) and is where "everyone's level again" lives. A rating reset (below) doesn't touch it: the weekly
rating starts from 1200 every week whatever happened.

**The rating reset stays, as a plain action.** *Assumption (the lead's reading, to confirm with the user):* the
per-group reset the user approved earlier today survives without the season wrapper.

- **What it is:** the owner taps `Reset ratings` **[NEW COPY]** in a section at the bottom of the admin home
  (no page of its own). Everyone's group rating goes back to 1200 from that moment. Implementation: the
  per-group `ratings_since` epoch that the live fold and `rebuild-ratings --group` respect (the engineer's
  recommendation). Never per person.
- **Confirm** **[NEW COPY]**: `Everyone's rating goes back to 1200. Games stay in history. This can't be
  undone.` and a field where they type the group's link (`<slug>`) to enable the button. This is the one
  destructive action in the product, so it's the one place we ask for typing.
- **Refused while a lobby is live or a game finished in the last 15 minutes** (the `rebuild-ratings` guard):
  `Finish tonight's game first.` **[NEW COPY]**
- **What people see:** Discord posts `Ratings were reset. Everyone starts at 1200 again. Top 3 before the
  reset: …` **[NEW COPY]** (that post is the only record; nothing is archived on the site). The board's `All
  time` chip reads `Since <date>` **[NEW COPY]** (e.g. `Since 1 Nov`) once a group has reset. Game
  history is untouched; old games keep their old rating changes.
- **Admins** see the section disabled with `Only the owner can reset ratings.` **[NEW COPY]**

**For the engineer (a Phase 3 task, not designed here):** removing seasons is a schema change. `seasons` is a
global table (not per group); `games.season_id` is `not null default public.active_season_id()`; `ratings` is
keyed `(group_id, player_id, season_id)`. Dropping the column and table needs a migration plan that loses no
data. It is lossless **only if every `games` and `ratings` row is in the one season**; check that on the hosted
project before writing it, and stop if any row isn't.

---

## 4. The fairness receipt (the reusable component)

This section is the authority. The parallel prototypes got a draft; divergences are listed in §4.9.

### 4.1 What the numbers mean (the honest basis for every word below)

From `packages/core/src/balance`:

- **The bot tries all 126 ways** to split ten people into two teams of five, gives each team its best role
  assignment, and **ranks by score** = rating gap (after the role cut) + a cost for each off-role seat (bigger
  if that person was filled last game) + a penalty if it's the same teams as last time for these ten. It keeps
  the best three. `splits.rank` 1 to 3, `is_chosen` marks the one in play (a reroll promotes 2, then 3).
- **`gap`** = the difference between the two teams' role-adjusted ratings added up, in display points (the same
  units as the ratings on the cards). Someone on their backup role counts at 93%, on a fill role at 85%. Unsigned.
- **`blue_win_prob`** = OpenSkill's win chance from everyone's real `mu` **and** `sigma` (how sure the bot is),
  **not** role-adjusted.
- **`off_role_count`** = people not on their main role (backup counts as off-role).
- **Consequence:** win % and gap measure different things and can occasionally point different ways, and the
  team totals on today's cards (raw rating sums) match neither when someone is off-role. That's the audit's
  "contradiction". The fix is to **pick one headline number (win %), label the gap with a unit, explain the
  difference once, and stop printing team totals.**
- **Not stored:** the ratings used at roll time, per-seat role tier in history, which penalty decided a ranking.
  So **no copy may claim a reason the data can't support** ("to balance top lane" is not knowable).

### 4.2 Rules for every variant

1. **One headline number: win chance**, shown as a split bar with both sides labelled in words and numbers
   (`BLUE 54%` / `46% RED`). Never colour alone.
2. **Retire "Teams are N% even"** (M3.31's evenness) and the bare `Gap 45`. One phrasing of fairness per screen.
3. **Rating gap always carries a unit and a label**: `Rating gap 45 pts`.
4. **No team totals** (7350 / 7395) on team cards or in Discord field names.
5. **Built from numeric columns only.** Never parse `explanation`. The one structured fact the sentence has that
   the columns don't (*who* swaps between split 1 and split 2) comes from a pure core helper that compares the
   stored `blue`/`red` arrays of two splits (`describeSwap(chosen, next)` returning names' puuids and their
   lanes), the same logic `nextBestClause` uses, exported and tested. Proposed task, Phase 3.
6. **Core's sentence stays**, verbatim, inside the disclosure and in Discord, so every surface can still be
   checked against one frozen string.
7. **One spelling: `favored`**, matching core's sentence and every shipped string. Never `favoured`.
8. **It does not disappear in game.** The receipt shows in balanced, in game and finished.

### 4.3 The plain sentence (by how far apart the odds are)

`p` = the favored side's win chance, rounded. `<Side>` = `Blue` or `Red`. **[NEW COPY]**

| p | Sentence |
|---|---|
| 50 | `Dead even.` |
| 51 to 53 | `Basically a coin flip.` |
| 54 to 57 | `Close. <Side> has a slight edge.` |
| 58 to 62 | `<Side> is favored.` |
| 63 and up | `<Side> is clearly favored. This was the fairest split these ten allow.` *(rank 1 only; on a reroll: `<Side> is clearly favored.`)* |

The last line is honest because the chosen split is the best-scoring of all 126. "Fairest" here means "best
score", and §4.6 explains score.

### 4.4 The reason line (the user's example, made honest)

The user's example: *"Teams within 2%: swapped X and Y to balance top lane."* What the data supports: the
chosen split's odds, its off-role count, and **who differs between it and the runner-up**, with their lanes. It
does *not* know *why* in lane terms. Closest honest version **[NEW COPY]**:

| Case | Template | Example |
|---|---|---|
| Next best is a one-for-one swap, same lane | `Next best: swap the <lane> players, <A> and <B>. That's <Side2> <p2>%, <why-lower>.` | `Next best: swap the top players, Hana and Omar. That's Blue 57%, with a bigger rating gap.` |
| One-for-one swap, different lanes | `Next best: swap <A> (<laneA>) and <B> (<laneB>). <Side2> <p2>%, <why-lower>.` | `Next best: swap Karim (mid) and Nadia (mid)…` |
| More than one swap | `Next best reshuffles <n> players. <Side2> <p2>%, <why-lower>.` | |
| No runner-up (duo locks left one) | `This was the only split that fit.` | |

`<why-lower>`, derived in this order from the two rows:

1. next `off_role_count` > chosen → `with <k> more off their main role`
2. else next `gap` > chosen `gap` → `with a bigger rating gap (<g2> vs <g1> pts)`
3. else → `and it scored a hair worse overall (repeated teams, recent fills or rounding)` (the stored score says it
   lost, the columns don't say which; we don't guess; changed 2026-10-03 from "ranked lower on role costs", which
   the numbers beside it could contradict)

When the runner-up has **closer odds** than the chosen split (possible, because ranking is on gap and roles,
not win %), case 1 or 2 always explains why, and §4.6 says it in words. That is the most "rigged"-looking
moment the receipt can show, so it must never be left unexplained.

**Off-role line** (live variant only, where seats are known) **[NEW COPY]**: `Everyone's on their main role.` /
`<Name> is off their main role (<role>).` / `<k> people are off their main role.` History uses the count only.

### 4.5 (a) Full variant: Tonight balanced, in game, finished; the game page

> **Amended 2026-10-03 (lead, M14.26 scene walk):** in game, Tonight shows the **compact** receipt (05-design and the
> site), with its link to the full one; the full variant stays for balanced, finished and the game page.

Hierarchy, top to bottom:

1. **Eyebrow** **[NEW COPY]**: `WIN CHANCE` (balanced) / `ODDS AT KICKOFF` (in game) / `THE ODDS WERE` (finished).
2. **The bar.** Blue on the left, red on the right (side 100 / 200), widths proportional to the two
   percentages, equal-luminance colours, both labels as text: `BLUE 54%` and `46% RED`. A 50% tick mark in the
   middle so 51/49 visibly sits near it. No animation beyond a single settle on first paint (reduced-motion: none).
3. **The sentence** (§4.3). In finished: replaced by the result line, `<Winner> was <p>%. <Winner> won.` (the
   poster's existing line, kept), plus `Upset!` **[NEW COPY]** when the winner was under 50%.
4. **Chips, one row, wrap on phones** **[NEW COPY]**:
   - `Rating gap 45 pts`
   - `Main roles 10/10` or `2 off main role`
   - `Bot's pick #1 of 3` (or `Reroll 1 of 2 · pick #2`)
5. **Reason line** (§4.4), `t-sm`.
6. **Disclosure**: `How the bot decided` (§4.6), closed by default except on the landing page.

In game, the receipt sits directly under the elapsed timer and above the team cards. It never collapses away.

### 4.6 (d) "How the bot decided" (expanded)

Open to everybody (today the three splits are admin-only; that ends). Contents **[NEW COPY]**:

> **How the bot decided**
>
> The bot tried all 126 ways to split these ten into two teams of five. For each one it put everyone in their
> best lane and scored it: the rating gap between the teams, plus a cost for every player off their main role
> (bigger if they were filled last game), plus a nudge against repeating last game's teams. Lowest score wins.
> Here are its top three:

Then three rows, one per stored split, in rank order, the chosen one marked `In play` **[NEW COPY]**:

| # | Odds | Rating gap | Off main role | Change from #1 |
|---|---|---|---|---|
| 1 · In play | Blue 54% | 100 pts | 0 | — |
| 2 | Blue 57% | 170 pts | 0 | swap Hana ↔ Omar (top) |
| 3 | Red 52% | 220 pts | 0 | swap Karim ↔ Nadia (mid) |

On phones this is three stacked mini-cards (each with a mini bar), not a table.

Then two explainers **[NEW COPY]**:

- `Why win chance and rating gap can disagree: win chance also counts how sure the bot is about each player,
  so a team of new faces is harder to call. The rating gap is what the bot balances on, counting anyone off their main
  role as a bit weaker there.` (amended 2026-10-03, copy review row 25: "a cut" read as a penalty)
- `Nobody picked these teams. Admins can tap Roll teams and Reroll (which moves to the next pick on this list),
  and nothing else. Nobody can hand-edit a rating; ratings only move when a game ends.`

Then the bot's own line, verbatim, labelled `The bot's note:` **[NEW COPY]** + `splits.explanation`.

Then the group's calibration line (§4.8) and a link `More on how it works` → `/how`.

### 4.7 (b) Compact variant: Games list rows, a player's game list, the night tape

One line, plus a 4px mini bar above or beside it:

- Rolled game: `<Winner> was <p>%. <Winner> won.` (+ `Upset` tag when under 50%) **[NEW COPY tag only]**
- Even: `50–50. <Winner> won.` **[NEW COPY]**
- Reroll: same line, plus a small `pick #2` tag.
- ARAM: same line, plus the existing ARAM label; no rating claims.
- Tapping the row opens the game page, which has the full variant (finished) **and** the scoreboard (audit
  problem 9).

### 4.8 (e) Group calibration stat

**Copy [NEW COPY]:** `The side the bot favored won <W> of <N> games (<pct>%). It expected about <exp>%.`
Follow-up line: `The odds are honest when those two numbers are close.`

- `N`: rated Summoner's Rift games in this group (**all of them**: a rating reset doesn't wipe the bot's past
  predictions, they were still its calls) that have a chosen split, a blue_win_prob
  other than exactly 0.5, and whose ten on each side match the split's ten (teams weren't changed in the
  lobby after the roll).
- `W`: how many of those the favored side won. `exp`: the average of the favored side's probability over the
  same games. Comparing to `exp` (not to 50%) is what makes this honest: if the bot says 55% every game, the
  favorite should win about 55%, not 100%.
- Shown only when `N ≥ 20`. Before that **[NEW COPY]**: `Not enough games yet to check the bot's odds (<N> of
  20).`
- Where: inside every "How the bot decided", the top of the Games page, `/how` (for the demo group), the landing
  page (demo group).
- Pre-game odds (§4.10) are **excluded**: those are odds the bot computed afterwards, not predictions it made.

### 4.9 (c) Discord embed variant

Text only. Discord limits: title 256, description 4096, 25 fields, field name 256, field value 1024, footer
2048, 6000 total (`guardEmbed` already sheds from the last field). The receipt goes in the **description**, so it
can never be shed. About 300 characters.

**Teams embed description [NEW COPY]:**

```
**Blue 54%** ▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ **46% Red**
Close. Blue has a slight edge.
Rating gap 100 pts · Main roles 10/10 · Bot's pick #1 of 3
Next best: swap the top players, Hana and Omar. That's Blue 57%, with a bigger rating gap.
-# Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.
```

- The bar is 20 cells, `round(p_blue * 20)` filled `▰` from the left, the rest `▱`. Words on both ends carry the
  meaning; the bar is decoration.
- Last line: core's sentence verbatim, as Discord subtext (`-# `). If subtext doesn't render in embed
  descriptions on the clients we test, it becomes plain italic. (Engineer to verify.)
- Field names become `Blue` and `Red` (team totals dropped). Per-player lines unchanged.
- Title link: the tonight page, anchored to the receipt's disclosure.
- **Result embed description:** `Blue was 54%. Blue won.` (+ ` Upset!` under 50%) then the existing `Top damage`
  clause. This is today's `Blue was favored 54%.` aligned to the poster.
- **Reroll embed:** the same description, **no prefix** (amended 2026-10-03, copy review row 15): the title
  `Teams are set · reroll 1 of 2` and the chip `Reroll 1 of 2 · pick #2` already say it, and a third time was noise.

### 4.10 (f) Games with no stored split

Backfilled games, games played without a roll, games whose teams changed in the lobby after the roll.

- If every player has `game_players.mu_before` and `sigma_before`: compute `predictWin` (core's existing
  function, no new maths) from those, show the **compact** or full bar with eyebrow `PRE-GAME ODDS` **[NEW
  COPY]**, and a line **[NEW COPY]**: `Kustom didn't pick these teams. Odds from everyone's ratings going in.`
  No gap, no off-role, no disclosure, no pick number (none of it exists).
- Teams changed after the roll: the same pre-game odds, line **[NEW COPY]**: `Teams changed in the lobby after
  the roll, so these are the odds for the teams that actually played.` The disclosure still shows the three
  splits the bot rolled.
- Any `mu_before` missing (an unrated backfill before `rebuild-ratings`): **hide** the receipt; the game page
  says `No odds for this game.` **[NEW COPY]** and nothing else.

### 4.11 Divergences from the draft given to the designer and prototypes

| Draft | This spec | Why |
|---|---|---|
| Chip for win chance | **No win-chance chip** | The bar already says it; a chip is a second phrasing of the same number on one screen (audit problem 1). |
| "Rating gap" chip | `Rating gap 45 pts` with a unit | Fixes "Gap 45 of what?". |
| Off-role chip | `Main roles 10/10` / `2 off main role` | Says the good case positively. |
| (none) | `Bot's pick #1 of 3` chip | Makes reroll visible and shows the list has three. |
| One plain sentence | Banded sentence + a separate reason line | The sentence is the feel, the reason line is the evidence. |
| Disclosure with 3 splits | Same, plus why each lower one ranked lower, the "disagree" explainer, core's sentence | The runner-up can have closer odds; it must be explained. |
| Calibration stat | Compared to expected %, hidden under 20 games | "Favorite won 58%" alone can't be judged. |
| Labelled bar | Same, plus a 50% tick | So "51/49" visibly reads as near-even. |

---

## 5. The rating number

**Decision (Phase 2 proposal): one public number, `Rating` = `round(mu * 60)`, everywhere. Proven is retired
from every surface. Boards sort on Rating.** New players are kept from topping the board by a settling section,
not by a hidden subtraction.

- **Why not keep sorting on ordinal and only show Rating?** Then the order on the page doesn't match the number
  on the page (in today's real board, a 1361 sits below a 1287). That is the "rigged" look in a new place.
- **Why not show Proven?** It reads 0 for nearly half the real board (floored), including 83-game players, and
  needs a paragraph to explain. Audit problem 3.
- **What protects against a lucky newcomer at #1:** the board has two parts:
  1. **Ranked**: players with **10 or more rated games** in this group (counted since the group's last rating
     reset, or all of them if it never reset), sorted by Rating, numbered.
  2. **Still settling** **[NEW COPY]**: everyone under 10, below the ranked list, sorted by Rating, **not
     numbered**, each with a chip `settling · 4/10` **[NEW COPY]**.
  Section line **[NEW COPY]**: `New players' ratings move fast at first. They get a rank after 10 games.`
- **10, not 30 (settled by the user, "for now"):** `00-product.md` says a Rating settles in about ten nightly
  games; 30 was Proven's horizon. One constant, so changing it later is a one-line decision row.
- **The week windows** keep their own weekly Rating (M7.2/M7.3, unchanged, from 1200 every Sunday) and stay one
  list with no settling section (unchanged: everybody is settling in a week). This is the board players reach
  first, so most nights nobody sees a settling section at all.
- **Players with zero rated games in the window** are left off and counted under the board: `+ 9 people who
  haven't played a rated game yet.` **[NEW COPY]**
- **Team cards:** each player shows their Rating, plus `settling` when under 10 games, which is also the visual
  explanation for "why does the win % differ from the ratings I see" (their uncertainty is in the win %).
- **Player page:** one big number, `Rating 1512`, the settling chip if any, a trend line, `Started at 1200, 37
  rated games since.` (M7.22, kept).
- **Ordinal** stays a computed value in `packages/core`. Balancing stays on mu. Nothing about the model changes;
  only what is printed and how the board orders.
- **Convention change:** CLAUDE.md's "Rank leaderboards on ordinal" and the 2026-09-08 / 2026-09-09 Proven rows
  are reversed. CLAUDE.md is the lead's to edit after approval.

---

## 6. Screen inventory for Phase 3 (build order)

Common to every screen: branded `not-found` with a reason and `Back to tonight`; branded error page with
`Try again`; route-level loading = a static shell (header, tab bar, headings) with no fake content; mobile 375 is
primary; no text truncation of names (wrap to two lines).

### (a) Tonight `/g/<slug>`

| State | Leads with | Primary action |
|---|---|---|
| Empty group (no game ever) | Admin: `Get your group ready` checklist summary + `Finish setup` → admin. Member/visitor: `Nothing here yet. When someone opens a custom with Kustom running, it shows up here.` **[NEW COPY]** | Admin: finish setup |
| No game tonight (idle) | Last result as a compact poster with its receipt, then this week's top 5, then `Start a lobby`. The `Mode` card (`Fearless · rated` / `138 open · 34 banned`, or `Normal · rated` / `Every champion is open.`), tapping opens the panel `/g/<slug>/mode` **[NEW COPY]** (2026-10-03; replaced the fearless line and page) | Start a lobby (any linked member) |
| Lobby filling | `6 IN THE LOBBY · Four more to go` (existing), roster as one compact list (no ten empty rows), admins named while waiting; the `Mode` card (its filling variant per 05-design "Mode card and mode panel") | Admin: Roll teams (at 10+) |
| More than ten | Rotation line before rolling: who'd sit out, in order (existing rule) | Roll teams |
| Balanced | `TEAMS ARE SET`, sit-out card if any, **viewer's side first** with their row marked by text (`You`) not colour alone, full receipt, two team cards, side line; the `Mode` card; **`What's open for <role>` in the answer band opens the panel on the viewer's lane** (`/g/<slug>/mode?lane=<role>`, Fearless only) **[NEW COPY]** | Admin: Reroll; members: Role for tonight (kept for next game) |
| In game | Elapsed timer from `started_at` (`23 min in` **[NEW COPY]**), full receipt (`ODDS AT KICKOFF`), team cards; role-pick and sign-in controls hidden; the `Mode` card, in Fearless with `This game's ten join the ban list when it ends.` **[NEW COPY]** | none |
| Finished | Result poster: winner, `<Winner> was <p>%. <Winner> won.`, rating deltas, MVP/ACE; in Fearless, the ten this game just banned, on or beside the `Mode` card (not for ARAM or a remake) **[NEW COPY]**; tonight's tape below | Admin: Start the next lobby |
| Long nights | Tape collapses after 3 games: `Show 4 earlier games` **[NEW COPY]** | |
| New player in lobby | `settling` chip on their seat; `New` tag in the roster | |
| Realtime down | Live pill reads `Reconnecting…` **[NEW COPY]**, never lit falsely | |
| Mode controls (every state) | Admins and the owner only, on the `Mode` card: the mode picker (`Normal` / `Fearless` in 2.0; M15 adds modes) and, in Fearless with at least one ban, `Reset fearless` (AlertDialog). **The only place the mode is controlled** (2026-10-03). Normal: no ban list anywhere, games don't add to it, the pool is kept and comes back as it was when Fearless is picked again. No rated toggle in 2.0: both modes are rated as today (02-milestones M14.29, M14.30) | Admin: pick mode, Reset |
| 404 slug | Branded not-found: `No group at this link. Check it with whoever sent it.` **[NEW COPY]** | Back to Kustom |

Fixes audit 1, 4, 8, 10, 6.

### (b) Board `/g/<slug>/leaderboard`

- Window chips (`This week`, `Last week`, `All time`; the month windows were removed in M14.48; `All time` reads
  `Since <date>` after a rating reset), state in the URL; unknown `?window=` falls back
  to the default instead of 404.
- Row (Dorans-style compact): rank, name (wraps), `W–L`, games, Rating, trend arrow + window change
  (`+43`, not coloured by sign: the existing rule, unless the design system restates it). Tap → player page. **No inline expansion of every game** (the
  13k-px problem); the row links out.
- Sorting: Rating (default) or Games or Win rate via a select; the settling section always stays below.
- States: empty group (`No rated games yet. The board fills in after your first Summoner's Rift game.` **[NEW
  COPY]**), week with no games, long lists (50+ rows, no pagination needed under 100; paginate at 100), new
  player (settling section), after a rating reset (`Since 1 Nov`).
- Fixes audit 3, 5 (payload), 7.

### (b2) Stats `/g/<slug>/stats`, `/stats/champions`, `/stats/1v1` (2026-10-03, option A)

- Three segments, `Records · Champions · 1v1`, as links styled as a segmented control (`aria-current`), each its
  own URL; the window chips are shared and carried in `?window=`. Contents per §2.4's segment table.
- One duos block, in 1v1 (best and worst together, nemesis), never the same pair as best and worst.
- Each segment loads on its own; each page's HTML on a 500-game fixture is under 1 MB (the `/fun` fix).
- Pick two reads `?a=&b=` so You vs them can link straight to a filled pair.
- States: a group with too few games shows each section's existing empty state.

### (b3) You `/g/<slug>/you` (2026-10-03, option A)

| Viewer | Leads with |
|---|---|
| Signed out | The sign-in pitch (§2.4, **[NEW COPY]**) and `Sign in with Discord`, returning here |
| Signed in, not linked here | `Which League account is yours?` and the way in (§2.4); the account card |
| Signed in, linked, admin or owner | The `Admin` card first: `Admin` / `You help run <Group>.` (owner: `You run <Group>.`) / `Open admin` **[NEW COPY]** |
| Signed in, linked | Your header (name, `YOU`, Rating with rank or the settling chip, W-L with games, tonight's change), Your night's one line until 06:00 (M14.36), You vs them with everyone (M14.35), the Daily card with your streak, `See your public page` → `/p/<you>`, the account card (`Day` / `Night`, `Sign out`). After linking: the welcome card (M14.33, `?welcome=1`) |

- One page whatever the state; no redirect to sign in. Nothing here is hidden from anyone else: every number on
  it is also on a public page.
- Fixes audit "your own stuff is in four places" (`redesign/nav/proposal.md` §1).

### (c) Games `/g/<slug>/games` and `/g/<slug>/games/<id>`

- Filters: player (select of group members), date range (`Tonight`, `This week`, `All`), mode
  (Rift / ARAM). All in the URL.
- Each row: date, duration as `21 min` (never `21:46`), winner, compact receipt, the viewer's own line if they
  played. Paginated, 25 per page, or "Load more".
- Game page: full receipt (finished variant) + disclosure + scoreboard (KDA, damage, gold, CS, vision) + MVP/ACE.
- States: empty group, no games for filter (`No games match. Try a wider date range.` **[NEW COPY]**), backfilled
  (pre-game odds), no odds, ARAM, bad id (branded 404).
- Calibration line at the top of the list.
- Fixes audit 1, 5, 9, 6.

### (d) Group create / join + admin

- `/new`, `/join/<code>` per §3 (M13.7 visuals, re-dressed in the new system).
- Admin home: `Get your group ready` checklist; invite card; tonight shortcuts (Roll/Reroll,
  each destructive one with a confirm). No mode or fearless control in admin: the mode and Reset are on Tonight's `Mode` card only (2026-10-03).
- Members: list with role (`Owner`, `Admin`, `Member` words, not colours), last played, games; actions per §3.5;
  owner row has no remove; `Make owner`. Tables become stacked rows at 375 (no clipping).
- Discord: `Connect Discord` (OAuth) + `Or paste a webhook link instead` + test post; shows when the test post
  was sent. States: not connected, connected, cancelled on Discord, failed test (Discord's reason).
- Hosts: mint (shown once), list with last seen, revoke with confirm. No `revoked_at`, `pnpm`, or snowflakes in
  copy.
- Reset ratings: a section at the bottom of the admin home, per §3.6 (owner only; admins see it disabled).
  No season page.
- Set up this PC as host: the pairing-code card per §3.2 step 4 (an admin's pairing mints their token).
- States: not an admin, super-admin read-only (existing line), signed out (sign-in, returns here), errors in
  place under the control.
- Fixes audit "also found" admin items, 2 (onboarding), 6.

### (e) Landing `/`

- Sections per §2.3. States: signed out, signed out with cookie (back bar), signed in with no group, demo group
  with no rolled game (worked-example fallback), counters unavailable (section hidden, never zeros).
- `/how` and `/download` ship with it.
- Fixes audit 2 and onboarding score.

### Proposed Phase 3 tasks this document implies (IDs assigned when Phase 3 is planned)

`describeSwap` core helper; receipt component (three variants) + Discord description; calibration query;
pre-game odds on split-less games; rating number change + settling section; owner role (with `customs`'s
owner set to the bootstrap admin), removal, rating reset (`ratings_since`); **remove seasons** (migration plan
that loses no data, check every row is in the one season first; delete `/admin/seasons`, the no-season
sentences and season-scoped reads); **Discord OAuth connect** (`webhook.incoming`, Discord app config, paste
fallback); **host token on an admin's Host-mode pairing** (server + companion); RLS read policies; landing,
`/how`, `/download`; the five-tab bottom bar and the You page (M14.7b; the More hub, built in M14.7, is deleted);
the three-segment Stats page (M14.17); checklist; join page's two-way state.

---

## 7. Questions

### Answered by the user (2026-10-03)

1. **Demo group:** `/g/customs`. Yes.
2. **Owner of `customs`:** the bootstrap admin. Yes.
3. **Host token on an admin's Host-mode pairing:** yes (§3.2 step 4).
4. **Settling threshold:** 10 rated games, for now (§5).
5. **Old seasons:** seasons are removed altogether; the weekly board is the fresh start (§3.6).
6. **One-click Discord connect:** in 2.0, OAuth with paste as fallback (§3.2 step 2).
7. **Free:** yes, the landing page says it (§2.3).

### Still open

1. **Does the rating reset survive without seasons?** **Answered 2026-10-03: yes** (the Phase 2 approval row; M14.18). This document assumes yes, as a plain owner action
   (`Reset ratings`, §3.6). If the user meant "no resets at all, the week is the only fresh start", §3.6's
   reset half, the owner's reset power and `ratings_since` drop out, and "Nobody can hand-edit a rating" gets
   simpler.
2. **Discord app config:** who creates the Discord application (client id, secret, redirect URL) and enables the
   hosted Supabase Discord sign-in provider? Both are outside the repo and block 2.0's onboarding.
   **Answered 2026-10-03:** both already exist (the user). Connect reuses the sign-in app; the user adds
   Kustom's callback URL to it (M14.20, decision row).
