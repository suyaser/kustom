# Product

This document describes **Kustom 2.0** (milestone M14, branch `redesign-2.0`), written on 2026-10-03 before
it is built so engineers build to it. Where the live site still differs (Proven on the board, the seasons
page, the evenness line), the site is behind and this document is the target. `docs/02-milestones.md` says
which M14 task makes each part true.

## One line

A referee for our nightly League of Legends customs: it sees who is in the lobby, splits them into two fair teams
with real roles, keeps ratings from actual results, and ends the argument before it starts.

The product is called **Kustom**; `Customs Night` is the codename used in this repo, and the name of the
original group.

## Who it is for

Ten to twenty friends, rotating roster, ranks from Bronze to Master, some people one-trick a role. Discord for
comms, WhatsApp for "are we playing tonight". No organizer wants a job. One or two people are willing to run a
small Windows app. Everyone opens links on their phones.

It was built for one such group and since 2026-10-03 (M13) any other group can have their own: somebody signs
in with Discord, names it, and sends one link. Every group is its own world — its own ratings, board, fearless
list, daily guess, Discord channel, owner and admins — and nothing in one leaks into another. The rest of this
document describes one group's night, because that is still what every group's night is.

Not for (yet): public in-house servers with strangers, other games, groups where nobody has Windows, and
anyone who wants captains or manual picks.

## The problem

The ten to twenty minutes between "who's in?" and "lobby's up" is where arguments live. Whoever picks teams is
accused of stacking. New or rotating players make it worse because nobody agrees how good they are.

## Principles

1. **The bot is the referee.** No human picks teams. Ever. Not the owner, not the admins, not the host.
   Nobody types teams into Kustom. But the roll is the bot's suggestion, not a lock (the owner, 2026-10-04,
   M21 D1, built 2026-10-05): if the room moves people around in the client after the roll and plays its own teams,
   Kustom doesn't argue. From the moment the game starts, the teams that actually play are the ones every
   screen, number and post uses.
2. **Zero input.** Nobody checks in, nobody reports results. The client already knows who is in the lobby and
   who won; the companion reads it. Any manual step will be skipped by someone, and skipped steps corrupt ratings.
   The one deliberate exception is **when** to balance (2026-10-03): an admin taps Roll teams once everyone who is
   staying is in (with more than ten, the bot's rotation decides who sits out). A skipped roll costs nothing but
   a wait — no teams, no game, nothing to corrupt — and who plays with whom is still the bot's call, never the
   admin's.
3. **Fair by numbers, and it shows its work.** Every split comes with one **receipt** (below): the win chance,
   the rating gap, how many people are off their main role, and the other splits the bot turned down. "The bot
   is rigged" needs a number to argue with, and the receipt is the only way the product shows fairness, so
   every screen says it the same way.
4. **Nobody can hand-edit a rating.** Yours moves when a game ends, and only then. No page, route or script
   sets one person's number. The owner can start the whole group over at once (Reset ratings, below), never
   one person.
5. **Discord is a display, not a form.** Teams, results, and boards appear where people already look, and so
   does the week when it ends. Nothing requires typing a command. (Splitting voice was dropped at the user's
   request on 2026-09-10; the group talks in one channel, and there is no Discord bot.)

## The nightly loop

1. People gather in Discord voice as usual. (The WhatsApp thread still answers "are we playing tonight".)
2. The lobby opens. Somebody taps **Start a lobby** on the tonight page and a custom appears on whoever already
   has Kustom running — nobody picks the host, the name or the password — and an invite popup goes out to
   everyone who has been around lately (M4.2). Opening one by hand in the client still works exactly as it
   always did. Either way, somebody in that lobby is running Kustom, because that is what the rest of the night
   reads.
3. Kustom keeps the roster current as people join, leave and step into the spectator slot. The tonight page
   shows who is in and what is still missing (`6 IN THE LOBBY · Four more to go`). When everyone who is staying
   is in, an admin taps **Roll teams** on the tonight page (the page names the admins while it waits, so the room
   knows whose phone to ping); the server balances exactly the roster that admin was looking at and posts Blue
   and Red with roles and the receipt. Nothing balances by itself (2026-10-03): the automatic version fired the
   moment ten were present and still, and on a real night that was too often the wrong ten. If somebody leaves
   after the roll, the teams come down and the next game needs another tap.
4. Everyone opens the link and sees, without asking, which side they are on and in what role
   (`YOU on RED, playing support`), and why the split is fair. Players switch to their side (Kustom can do it
   for them, M4; anyone still on the other side reads `YOU on RED. Move to BLUE to play top.`, M21.13). Game starts. The page counts the minutes and keeps the receipt up as `ODDS AT KICKOFF`.
   If people moved sides after the roll anyway, or nobody rolled, the page shows the teams that actually
   started, with odds for those teams, and Discord gets a short `Game on` post with the real teams and those
   odds (M21, built 2026-10-05). The same teams on swapped sides count as the roll: the odds flip and
   nothing is posted.
5. At end of game Kustom captures the full stats block. Ratings move. The board updates. What each person plays
   is counted too, so their main and backup follow the games they actually play. The ten champions they locked
   are added to the **fearless** pool and those champs are banned from the next custom. Discord posts the ban
   list, bolding the ten that just joined. On the tonight page one **Mode** card says what tonight is
   (Kustom 2.0, M14.30): `Fearless · rated` with what's open (`138 open · 34 banned`), or `Normal · rated` when
   every champion is open. Tapping it opens the mode's panel at `/g/<slug>/mode` (over the page on a phone, the
   same address as a full page from a Discord link): for Fearless, the whole pool by lane, open champions first
   as chips with the champion's small square icon beside the name, each lane's bans folded underneath, and a
   find box that checks a pick without scrolling. Once teams are set, `What's open for <role>` opens it on the
   lane you were just given; after a game, the ten just banned show on the page. The list keeps growing until
   an admin resets it. Not every night is a fearless night: an admin picks **Normal** on the Mode card, and
   then nobody sees a ban list and games don't add to it; picked again, Fearless picks up where it stopped.
   Both are rated as usual.
   Some games are played under a **rule** (M15). Before Roll teams an admin picks one on the Mode card, or taps
   **Spin** and the server picks one so nobody can be accused of choosing: `Class wars` (everyone picks from one
   class, `Tanks only`), `Region wars` (each side picks from its own region, drawn the moment region wars is
   chosen, `Ionia` vs `Noxus`), and `Mirror match` (your lane opponent plays your champion; until Kustom can open one itself,
   the host opens a Blind Pick custom by hand, and Tonight says so where `Start a lobby` usually is; Spin
   leaves mirror out until then). Everyone sees the rule on the card, its panel (the allowed champions, minus
   the Fearless bans on a Fearless night) and the teams post. A rule lasts **one game**: it locks when teams are
   rolled, and once that game is recorded the card is back on the group's standing mode, Normal or Fearless.
   Kustom never stops a pick: after the game the poster and the result post say which side kept the rule,
   naming champions, not people (`Blue kept the rule. Red: Jinx isn't a tank.`). Breaking it changes nothing:
   the result stands. Class and region games are **not rated** by default (mirror match is rated); an admin can
   flip `Rated` for the next game, in any mode, before teams are rolled, never after. A not-rated game is
   recorded and posted like any other, but it moves no rating, adds nothing to the Fearless pool and teaches
   nobody a role. A mode change made after teams are rolled is for the next game.
   Region wars (M20, built 2026-10-05): some champions count for two regions, where
   Riot puts them and where they're from (Vi for Piltover and Zaun, every yordle for Bandle City; that second
   list is ours), so every one of the 13 regions can come up, and each champion chip says its region (`Jinx ·
   Zaun`). A champion both sides' regions share is open to both, and a pair is only drawn if each side still
   has 8 of its own. The two regions are drawn the moment region wars is chosen, by an admin or by Spin, so the
   card shows `Blue: Zaun · Red: Noxus` and the panel shows both pools before anyone has joined a lobby; nobody
   waits for teams or a full room to see them. Queued while a game is on, the next game's regions are on
   the card for everyone too (M20.16). Until the game starts an admin can tap `Redraw regions` for a
   new pair or set either side to a region they name. Before Roll that changes the next game; after Roll, while
   the teams are up, it changes this game without touching the teams and the teams post goes out again (picks
   already made stay, and the check reads the new regions); once the game is in progress the regions stay. If
   the bans of a game played in between leave the chosen pair too short, the card says so, and Roll draws a new
   pair unless an admin changes it first. Every mode works this way: what it is (the class, the regions, Rated)
   is decided and shown when it is chosen, and Roll only makes the teams. The rule moves onto the lobby when
   teams are rolled, so anything else changed after that is the next game; it comes back to the card, with its
   regions, if the teams come down or the game was a remake or an ARAM, unless an admin has already picked
   something else. When two admins tap at once, the last tap wins and both see it.
6. If more than ten showed up, the server posts who sits: whoever has played most tonight, and between
   equals whoever has gone longest without sitting. On the first game of a night nobody has done either, so
   the post says as much — somebody has to be first — and from the second game on the rotation has real
   history to work from.
7. The tonight page keeps the night (M11). The finished game stays up as a poster — who won, what the odds
   were, `Upset!` when the underdog won, the rating changes, MVP and ACE — until the next lobby opens; then it
   moves into a short log of tonight's earlier games under whatever is happening now (after three, the rest
   fold behind `Show 4 earlier games`). The page updates by itself; nobody refreshes. A link to tonight, to one
   game, or to a person's page unfurls as a picture wherever it is pasted. Nobody presses Share; there is no
   Share.

## The receipt: how fairness is shown

One component, everywhere a split appears: the tonight page while teams are set, **in game**, and after the
result; every game in history; the game page; the teams post in Discord; and the landing page. It is built
only from the numbers stored with each split, never by reading the bot's sentence back, so it can never claim
a reason the data does not have. "To balance top lane" is not something the bot knows, so the receipt never
says it.

- **One headline number: win chance.** A bar with both sides labelled in words and numbers, `BLUE 54%` and
  `46% RED`, with a mark at 50% so a coin flip looks like one. Colour never carries it alone.
- **A plain sentence** by how far apart the odds are: `Dead even.`, `Basically a coin flip.`, `Close. Blue has
  a slight edge.`, `Blue is favored.`, and from 63% up `Blue is clearly favored.` (on the bot's first pick it
  adds `This was the fairest split these ten allow.`, which is true because it scored best of all 126).
- **Three chips:** `Rating gap 100 pts` (always with its unit), `Main roles 10/10` or `2 off main role`, and
  `Bot's pick #1 of 3` (`Reroll 1 of 2 · pick #2` after a reroll).
- **A reason line** naming who would change in the next-best split and why it lost. The why is one of six,
  tried in this order, and the same words label each lower split under `How the bot decided`
  (`Ranked lower: …`):
  1. more people off their main role: `with 2 more off their main role`;
  2. a bigger rating gap: `with a bigger rating gap (120 vs 45 pts)`;
  3. last game's teams again: `and it's last game's teams again`;
  4. more of last game's teammates on the same team: `and it keeps more of last game's teammates together (4 vs 2 pairs)`
     (`1 pair` when the pick keeps one);
  5. it fills someone who was filled more recently: `and it fills someone who was filled more recently`;
  6. none of those, or a split stored before teammate variety (migration 0045): `and it scored a hair worse
     overall (repeated teams, recent fills or rounding)`.

  3 to 5 come only from the score parts stored with each split since M18.13; when more than one applies, the
  one worth the most points is named. When the runner-up had closer odds than the pick, the line always explains it, because that is
  the most "rigged"-looking thing the receipt can show.
- **`How the bot decided`**, open to everybody (it used to be admin-only): the three splits the bot kept, in
  order, with their odds, gaps and off-role counts; why win chance and rating gap can disagree (win chance
  comes from everyone's Rating as it is; the gap is what the bot balances on, and it counts anyone off their
  main role as a bit weaker there); the bot's own sentence
  word for word; and the group's **calibration line**.
- **Calibration:** `The side the bot favored won 27 of 48 games (56%). It expected about 55%.` — over every
  rated Summoner's Rift game the bot rolled with the Kustom odds where the ten who played are the ten it rolled
  (games rolled before M18 used a different odds function, so the line started again at `0 of 20` at the
  switch). It compares to what
  the bot expected, not to 50%, because a 55% favourite should win about 55% of the time. Hidden until a group
  has 20 such games (`Not enough games yet to check the bot's odds (12 of 20).`). A rating reset does not wipe
  it: those were still the bot's calls.
- **Games the bot did not pick** (recovered from match history, played without a roll, or teams changed in
  the lobby after the roll) get `PRE-GAME ODDS` from everyone's ratings going in, with a line saying Kustom did
  not pick these teams. No gap, no chips, no pick number, because none exist. A game where some of those
  ratings are missing says `No odds for this game.` and nothing else. From M21 (built 2026-10-05) this starts when the
  game starts, not when it ends: the in-game receipt, the poster, the result post, history, a player's page and
  `Won against the odds` all use the teams that played, never the rolled ones.
- **In history** the receipt is one line and a thin bar: `Blue was 54%. Blue won.`, with an `Upset` tag under
  50%.

Retired on 2026-10-03 because each said fairness a second, different way: `Teams are N% even.`, the bare
`Gap 45`, and team rating totals on cards and in Discord.

## The things a person can change on a night

Everything else happens without anybody touching it. These exist because the docs accepted them, and each is
one tap:

- **Start a lobby** (M4.2, every linked player since M4.13). The first tap of the night, and the only one that
  is optional: whoever has Kustom running can open a custom from their client the way they always have.
  Pressing the button instead opens one on somebody's PC — the server picks whose, the most recently seen friend
  whose Kustom has been up in the last ten minutes — with a name like `Customs 09 Sep #1` and a four-digit
  password neither of them chose, and then sends an invite to everyone who has been around this week. The name
  and the password are printed in the Discord post and on the page for anyone signed in, so whoever missed the
  popup joins by hand. If nobody's Kustom is running there is nothing to open and the page says exactly that.
  There are no fields on it: no mode, no name, no password, because each of those is a step. Two people tapping
  at once get one lobby. Anybody who has picked themselves out of a lobby once sees the button, and nobody has
  to find out who the admins are to get the night started. A visitor who is not signed in is offered the
  sign-in instead.
- **Roll teams** (admins and the owner). Everyone who is staying is in the lobby and an admin taps once (with
  eleven or more, the rotation sits people out; nobody trims the lobby by hand); the server balances that
  roster and posts the teams. The tap names the roster the admin saw, so if somebody joined or left in the
  second before it, nothing is rolled and the page shows the new roster to tap again. Tapping twice posts once.
  With fewer than ten there is nothing to roll.
- **Reroll** (M3.2, admins and the owner). One tap promotes the bot's second pick, one more its third, and
  then it stops: three splits come out of the balancer and there is no fourth. A reroll posts a new message in
  Discord saying which reroll it is; it never edits the old one, never changes who is playing, and never picks
  at random. The receipt's pick chip says it to everybody (`Reroll 1 of 2 · pick #2`), and `How the bot
  decided` shows which of the three is now in play. When the list runs out, the way to get different teams is
  to change who is in the lobby and roll again.
- **Role for tonight** (M3.6, anybody linked). A friend taps a role on the tonight page and the balancer treats
  it as their main for the rest of the night, with their usual main as the backup. Nobody sets their roles
  anywhere else: their main and backup are read from what they actually play (M5.16, M5.17), so this tap is
  also how a person steers that — play a role on purpose for a week and it becomes your main. Being *filled*
  into a role never changes it. It is a preference, not a lock: the teams can still put them somewhere else
  and the receipt says when they do. A tap after teams are already posted is kept for the next game rather
  than redoing the teams people have already moved for.
- **Reset fearless, and fearless on/off** (M10, M14.29/M14.30; admins and the owner, **on the tonight page
  only**, never in admin). The ban list is zero-input: every counted Rift custom appends its ten champs,
  Discord gets the list, nobody types a name. Clearing it is one tap on the tonight page, behind a confirm, because "the pool starts over" is a night-level call the same way reroll is. Kustom never
  auto-bans; Riot's line is that we do not touch champion select. Humans ban from the list. The off switch
  needs no confirm because it loses nothing: off freezes the list, on brings it back as it was.
- **A rule for the next game, Spin, and Rated** (M15; admins and the owner, on the tonight page only). Picking
  Normal or Fearless clears a pending rule. Changes made after Roll teams are for the next game.

## Owner, admins and members

Every group has **exactly one owner**, any number of admins, and members (2026-10-03). Playing in a lobby
with the group makes you a member; nobody has to be let in.

| Can | Member | Admin | Owner |
|---|---|---|---|
| Start a lobby, Role for tonight | yes | yes | yes |
| Roll teams, Reroll, mode, rule, Spin, Rated and Reset fearless (on tonight) | | yes | yes |
| Invite link, Discord, host setup | | yes | yes |
| Make a member an admin | | yes | yes |
| Remove a member | | yes | yes |
| Remove an admin, or make an admin a member | | | yes |
| Reset ratings | | | yes |
| Hand ownership to an admin | | | yes |

- **The owner is whoever created the group.** For the original group it is the bootstrap admin. The owner
  cannot be removed or made a member; to step back, they hand ownership to an admin (`Make owner`) and stay an
  admin themselves. So a group always has someone who cannot be locked out by another admin.
- **Removing someone** (`Remove from group`) is for people who left and for alt accounts. They leave the board;
  any host they ran for this group stops posting; their games, and their name on those games, stay in history.
  It is not a ban: **playing is still joining**, so if they turn up in one of the group's lobbies again they are
  back, with the rating they had. Banning is not a thing.
- Every refusal is said in words where the tap happened (`Only the owner can do that.`, `The owner can't be
  removed. Hand ownership to an admin first.`), never only in a pop-up that disappears.
- **The person who runs the deployment** can look at any group to help it and change nothing. They do not see
  a group's invite link.

## Starting a group

A new group's owner does four one-time things, none of them during a night, and none of them adds a step to
anybody else's night.

1. **Create the group** (`/new`): a name and a link (`/g/<link>`), typed once. The link never changes, because
   people paste it. They land straight on their group's admin home as its owner.
2. **Connect Discord**: one button, `Connect Discord`. Discord's own page asks which server and channel; Kustom
   keeps the channel's webhook (not anybody's Discord login) and sends a test post: `Kustom is connected. Teams
   and results will show up here.` Anyone who would rather can paste a webhook link instead. Skipping it is
   fine: the site works without Discord, teams and results just only show there.
3. **Install Kustom on one PC**: download the installer (Windows), run it, and with League open type the
   six-character code the admin home shows. Kustom is one small app that sits in the tray, starts with Windows
   and updates itself, so after this nobody touches it again (M17). Kustom learns which League account is the admin's from the client
   itself, and because they are an admin it sets that PC up as a host with no token to copy. This is the one
   step a group cannot skip: without Kustom in the lobby nothing is recorded. A second admin does the same on
   their own PC; two hosts is normal.
   To host on a friend's PC, make that friend an admin; they pair their own PC with their own code. Until the
   Rust Kustom (1.0.0, M17) is the download, the 0.3.x app cannot become a host from a code, so only `customs`
   hosts in that window and new groups are not promoted (the user, 2026-10-04).
4. **Invite players**: copy the group's one invite link into the group chat. Optional, because friends also
   join by playing.

These live as one checklist at the top of the admin home, `Get your group ready`. Each row says `To do` or
`Done` and why it matters. **The checklist is worked out from what has actually happened** — a test post
landed, another person is in the group, a host has been seen, a game was recorded — never from somebody
pressing "done", so it cannot lie and a second admin sees the same thing. When Kustom has been seen and the
first game is in, it folds to one line, `Your group is ready for game night.`, and a row only reopens if its
fact stops being true (the webhook is deleted in Discord, every host is revoked).

## Joining a group

- **Playing is joining.** Somebody who never opens a link still becomes part of the group by playing a game
  with it, exactly as a new face in the lobby always has: balanced, rated and on the board.
- **The invite link** is for the web taps (Start a lobby, Role for tonight) and for a brand-new group's first
  people. Somebody the site already knows taps `Join`. Somebody it does not is asked `Which League account is
  yours?` and given two ways, neither of which is typing a name: type a six-character code into Kustom (if they
  have it), or just play a game with the group and tap their own name on the tonight page next time they are in
  the lobby. Most friends will never install Kustom, so the second way is the usual one.
- **One person, one identity, one rating per group.** Your League account is you everywhere. Your rating is
  not: how you do against these friends says nothing about how you do against those. A person new to a second
  group starts there at 1200 like anybody else, and their number in the first group does not move. Your main
  and backup roles are about what you play, so they follow you.
- **A game belongs to one group.** If two groups' hosts are in the same custom, the group whose Kustom saw the
  lobby first gets it; the other does nothing. Nobody's game is counted twice.
- **Kustom asks which group only when there is a choice.** One group: nothing changes. More than one: the
  panel says `Posting tonight to:` (or `Tonight's group:` when it is not hosting) with the last one picked.

## Where things are

- **Every group is public by link**, the way the original group's pages always were: anyone with the link can
  read its tonight page, board, games and players without signing in. There is no list of groups anywhere.
  Private groups are not in 2.0.
- **A group's space** is `/g/<link>`, with five sections in the same order on a phone's bottom bar and a
  laptop's top bar: **Tonight**, **Board**, **Games**, **Stats**, **You**. There is no More page. Stats holds
  the records, the champions and the one-vs-ones as three parts of one page. You is your own page seen from
  where you stand: your numbers, your record with and against everyone, your night, and Admin for admins; if
  you're not signed in, it tells you what signing in shows you. The daily guess and tonight's mode are cards on
  Tonight. How the bot decides and getting Kustom are links at the bottom of every page. A new feature goes on
  the page where its moment is (tonight, records, you, one game), never a sixth tab.
- **The front door** is `/`. A stranger sees a landing page that explains Kustom in ten seconds — `Fair teams.
  No arguments.` — with a real receipt from the original group's latest game, the three steps, what the app
  reads and never touches, `Create your group`, and `Free. Sign in with Discord to start.` A signed-in member of
  a group goes straight to their group instead; a regular has no reason to see a pitch every night. The same
  page is always at `/about`, and `/how` and `/download` explain the bot and the app.
- **`/g/customs` is the demo.** The original group is public anyway, so the landing page links it (`See a real
  group`) and quotes its live receipt and calibration line. Every link the group ever pasted still lands where
  it used to.
- Every page, and Kustom itself, carries Riot's standard notice that Kustom is not endorsed by Riot Games.

## Being filled

Somebody has to take the empty seat. What changed on 2026-09-15 is that the bot now remembers who took it
last time: putting a person on a role that is not theirs has always cost the split points, and that cost is
now bigger for somebody who was filled in their last game and shrinks back to normal over the next few
(M7.5, M7.6). A person filled on Tuesday is the last choice to be filled on Wednesday.

It is a price, not a rule. If one person in the lobby is the only one who has ever played jungle, they play
jungle, and the receipt says they are off their main role. The referee prices the unfairness; it does not
refuse the night. Nobody taps anything for this — being filled still never changes what the model thinks your
main is.

## Worked example

The concrete version of "the bot is the referee", used as the pinned test case for the balancer
(`docs/02-milestones.md`, M1.4, has the full arithmetic and the expected second and third splits).

Ten friends are in the lobby on an ordinary Tuesday. They have been playing for a few weeks, so their ratings
have drifted well away from the one number everybody starts at. (Their League ranks are in the table because
they are part of the picture of who these people are; since 2026-09-16 nobody's rating is seeded from one.)

| Name | Rank | Rating | Main | Backup |
|---|---|---|---|---|
| Bilal | Platinum I | 1713 | adc | mid |
| Hana | Gold III | 1434 | top | mid |
| Iris | Platinum IV | 1578 | jungle | top |
| Karim | Gold I | 1551 | mid | adc |
| Lena | Master | 2088 | adc | jungle |
| Nadia | Silver III | 1266 | mid | support |
| Omar | Gold II | 1469 | top | support |
| Rami | Platinum III | 1638 | jungle | mid |
| Theo | Gold III | 1419 | support | adc |
| Yuki | Bronze II | 1134 | support | top |

Nobody types anything. An admin taps Roll teams and this appears in Discord and on the page:

| | Blue | Red |
|---|---|---|
| top | Hana | Omar |
| jungle | Iris | Rami |
| mid | Karim | Nadia |
| adc | Bilal | Lena |
| support | Theo | Yuki |

```
Blue 56% ▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 44% Red
Close. Blue has a slight edge.
Rating gap 100 pts · Main roles 10/10 · Bot's pick #1 of 3
Next best: swap the top players, Hana and Omar. That's Blue 60%, with a bigger rating gap (170 vs 100 pts).
Blue favored 56%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.
```

(The last line is the bot's own sentence, kept word for word, small, under the receipt. The odds are the
Kustom odds since M18.2; they were 54% and 57% under OpenSkill. These Ratings are spread wider than a real
Kustom board, which sits mostly between 1100 and 1400; the example keeps them because it is the balancer's
pinned test.)

Everyone got the role they main. Lena is the best player in the room and she is on the weaker side on paper,
which is the sort of thing that used to take ten minutes of arguing. If someone still wants a different night,
reroll gives the "swap Hana and Omar" teams instead, and then one more after that. There is no fourth.

## The rating

**The Kustom rating** (M18, the owner, 2026-10-04). One line of arithmetic a friend can check on a phone. It
replaced OpenSkill, whose changes depended on how unsure it was about ten other people, kept a group that
started together "new" for weeks, ran overconfident odds and made points out of nothing for MVP and ACE. The
switch re-scored every past game the new way, and Kustom said so once, in a patch-notes post (below).

The model keeps one Rating per player in each group. (A person in two groups has two, and they never touch.)
Everyone starts at **1200**. After every rated game:

`change = K × (result − expected) × share`

- **result** is 1 for a win and 0 for a loss.
- **expected** is your side's win chance from the two teams' total Ratings: a gap of 0 / 50 / 100 / 200 / 400
  points between the totals is 50% / 53% / 56% / 62% / 73%. It is **the same win chance the bot shows on the
  teams**. One odds function serves the receipt, the bot's scoring, the rating, the explanation, the poster and
  the AI lines, so the odds shown are the odds used, by construction.
- **K** is 32 on your first rated game and drops by 1.6 a game to 16 at your 11th, then stays 16 for good. The
  group plays about three games a night, so a newcomer never moves much more than twice what a regular does.
- **share** is how your game compared with your four teammates'. Inside each team the five are lined up by the
  performance score (below), best first. On the winning team the shares are 1.2, 1.1, 1, 0.9 and 0.8; on the
  losing team they flip, 0.8 for the best game up to 1.2 for the fifth, so the best loser gives back least. The
  best on the winning side is the **MVP** and the best on the losing side the **ACE**; both keep their names on
  every post. A game with no performance score has every share at 1 and names nobody.

What a friend can count on:

- A win never lowers your Rating and a loss never raises it.
- Only your own rated games move you. Nothing decays: a month off leaves your number where you left it.
- After 10 rated games, an even game moves you about 8 (the MVP of an even win about 10, the ACE of an even
  loss about 6), and one game never more than 20 on screen. A first game moves at most 38.
- Beating the favourite pays more than beating the underdog, and losing as the favourite costs more.
- Same team, same result, same base: two settled teammates' changes differ only by share.
- Points come from the other team. When all ten have 10 games or more, the two sides' changes cancel exactly
  (the shares add up to 5 a side), so 1200 stays the group's average and nothing inflates as the weeks go by.
  While somebody in the game is still in their first 10 the sides need not cancel, and no surface ever
  prints a team total.
- Nobody can edit a Rating. The owner's Reset ratings, everyone at once, is the only thing that moves one by
  hand.

There is no bonus for a stomp. A surrender at 15 and a close win at 40 count the same: the end-of-game numbers
were tested as a margin on the group's real games and made no difference worth having (`04-decisions.md`,
2026-10-04).

**There is one number on every screen: `Rating`, which is `round(R)`.** It sits beside your name on the teams,
the result, the board, your page and every Discord post; it is the only thing the balancer forms teams from;
and **every board is sorted on it**, so the order on the page always matches the number on the page. Two people
can print the same Rating; they keep separate ranks, in the order of the unrounded number. (Before M14 the
board sorted on a cautious second number, `Proven`; it is gone from every surface.)

A printed change is always the difference of the two displayed numbers — `1291` becoming `1300` prints
`(+8)`, never a separately rounded figure that makes the row fail to add up. A night's or a week's total is
the sum of the changes as printed, so a column always adds up (M14.57).

**The board is tight, and that is correct.** Re-scoring about 109 games at about 8 a game put the group's
settled players between roughly 1110 and 1400, where OpenSkill had them between 600 and 2700. Nobody's skill
changed; the scale moves 8 a game instead of 80. No surface stretches it: a gap of 10 is meant to look small.

**New players get a rank after 10 rated games.** What stops a lucky newcomer from topping the board is not a
hidden subtraction but a section you can see. The `All time` board has two parts:

1. **Ranked**: everyone with 10 or more rated games in this group (since the last rating reset, if there was
   one), numbered, sorted by Rating.
2. **Still settling**: everyone under 10, below, sorted by Rating, not numbered, each with `settling · 4/10`.
   The section says why: `New players' ratings move fast at first. They get a rank after 10 games.`

People with no rated game in the window are not listed; the board counts them underneath (`+ 9 people who
haven't played a rated game yet.`). A newcomer's seat on the teams carries the same `settling` chip. The chip
is a count of games and nothing else. Ten is the number for now (the user, 2026-10-03); it is one constant, and
it is also where K reaches 16.

**Everybody starts on the same number** (2026-09-16), to the board and to the bot. A new player's Rating begins
at 1200 whether they are Iron or Challenger in solo queue: this board is about customs, and on your first night
nobody here has any evidence about you, including your rank. The bot balances them as 1200 too, so the win
chance it posts is the one the rating will use (M18 retired the one-evening rank guess; rank stays on the roster
as information). The first 10 games count extra, so a newcomer finds their level in about three nights. There
is no placement mode and nothing to finish.

**A person's page says the same thing the row said** (M7.16). On `All time` it shows one big number, `Rating
1300`, the settling chip if any, a trend line, `Started at 1200, 37 rated games since.`, and their games, each
with its one-line receipt and its change. Tap a name on `This week` and the page opens on that same week,
leading with the week's points (`Points this week +36`, the board's number to the digit) and the all-time
Rating in the line under it; on
a week tab each game prints **its change on the week**, under the column label `This week`, closing with a
`Week total` row that equals the header. Everywhere else a game prints its all-time change, and no row ever
prints two unlabelled changes for one game.

**Every change says why it was that size** (M14.58, rewritten for M18). Tap any change and it says, as a sum:
whether your side was the favourite and what the game was worth (`Your side won as the 56% favourite, so the
win was worth 16 × 44% = 7.`), where your game ranked on your team (`You had the best game on your team (MVP):
×1.2.`), and in your first 10 games why K is above 16. On a week row it explains the week's change and adds the
all-time one in a clause (`All time: +8, to 1300.`). There are no uncertainty words anywhere; `settling` is only
the chip. Games rolled before M18 keep the odds the bot posted that night; where the re-scored rating's odds
round differently the result adds them once, `For points, Red was 50%.`, with no reason clause (M14.59). Discord
carries no explanation: the result post stays short and its link opens the page where every change explains
itself.

**Only Summoner's Rift customs move the number.** The group plays ARAM some nights and those games are
recorded like any other — they are in game history, in the records, on a person's own page — but they never
touch a rating (M7.1). So **Discord posts no result for an ARAM night**, and **the board leaves those games out
of its count and its record**, while Stats, Fun, Games and a person's page keep counting them, because those
are about what the group played. Every count that can be compared with a different count on another screen
says `rated games` when that is what it counted.
A Rift game an admin marked not rated, or played under a rule that is not rated (M15), is treated the same way,
except that Discord still posts its result, because the rule's line lives there. It still counts for the weekly
awards (best off-role, cursed duo) and last week's labels on the board, which read the same games Stats does:
a rule changes which champions people play, not who played which lane or who lost together. The bot's odds
for its rolled teams stay on the poster, the game page and the tape, `Upset!` included, because they were
posted before the game; odds worked out afterwards for teams that changed after the roll are not shown, as
for ARAM (M15.12).

**How a game is read: the performance score.** The share ranks come from a seven-part reading of the game:
kills and assists against deaths, damage to champions, gold, vision, damage soaked, CS, and damage to towers,
dragons and barons. The first six count for everybody; the seventh counts for the jungler and nobody else.
Everyone is read against the other nine people who were in that game. **What weighs most depends on the role
you played** (M7.13): vision is most of a support's score and almost none of a carry's, damage to champions is
most of a carry's, and a jungler is read somewhere between, plus what they took off the map (M7.14). Top, mid
and adc are read the same way, because the game's own record does not reliably say which of top and mid
somebody was. The score only orders the five on each team; it never turns a win into a loss or the other way
round. The share and the award that counted
are kept with the game, so the explanation names what actually happened.

**A game where we do not know who played what has no best player.** Kustom reads everybody's role off the
end-of-game screen, so a night it watched has all ten. A game recovered from someone's match history later
does not — the client's history does not say who played support — and on those games nobody is named and every
share is 1. Guessing a role to hand somebody a better share is the sort of thing this product refuses everywhere
else. **The result post names the MVP and the ACE**, and a person's page shows the chip on the games they were
one (M7.10).

**The switch is announced once** (the owner, 2026-10-04; superseding "unannounced"). After the re-scoring the
owner sends one patch-notes post to each group's Discord channel, the text in `02-milestones.md` M18.10. It
says the rating changed, that every past game was re-scored, that the board looks tighter, and points at
`/how`. It is never repeated, and nothing else on the site or in Discord announces it.

## The week and all time

**There are no seasons** (2026-10-03, the user: "what does a season mean, we work weekly now"). No season
names, no season page, no archive of past boards, and the word does not appear anywhere a friend can read it.
The week is the fresh start the group actually plays for.

The board opens on **This week** — Sunday 06:00 to Sunday 06:00, the same 06:00 boundary that decides which
night a game belongs to, because the group plays past midnight — and offers **Last week** and **All time**
beside it (This month and Last month were removed on 2026-10-04, M14.48: the user found them a useless
filter). A window changes who is on the board and what their record and their climb over those days were. It
never changes anybody's rating: **a window is a filter over games, not a rating event.**

**The week board ranks by the week's own Rating** (M18, the owner, 2026-10-04; it replaced M14.57's net
all-time points). A board headed *This week* that ordered people by where they stand after a year would not be
telling them about their week, and the owner wanted the week to feel like a fresh start for everyone. So every
Sunday at 06:00 everyone's **weekly Rating** starts again at 1200. It is the same formula over only that week's
rated games, with K starting again at 32 for everybody, so the first game of a week is 50/50 on the week's
numbers and a regular earns the same as a newcomer that week. It is printed as **week points**,
`round(weekly Rating) − 1200`, with your record beside it (`+36 · 5W–2L`): a fresh week reads zero for
everyone, and the week's changes printed on a person's week tab add up to it exactly. Ties go to more wins,
then fewer games, then the higher all-time Rating, then the name. One rated game puts you on the board; there
is no minimum. It is one list with no settling section; a newcomer's row keeps its `settling` chip, which
describes the all-time Rating printed small under their points. **The weekly Rating never forms teams**, and the
owner's Reset ratings does not touch it. (History: M7 had a weekly rating too; M14.57 retired it because it
printed a different change for the same game than every other screen. M18 brings it back with the week's change
labelled as the week's wherever it is printed, so that confusion cannot come back.)

**The week starts on Sunday** (2026-09-15), because that is when this group's week starts — Egypt works Sunday
to Thursday. A range reads `Sunday 13 Sep to Saturday 19 Sep`. A night is still 06:00 to 06:00.

Every Sunday, the week that just closed posts itself to Discord — its final
board, in points order, and its three awards (most improved, which is the week's most points; best off-role; cursed duo) — with nobody pressing
anything. That is the whole of what people wanted from seasons: something that ends, and something to win by
Friday. Daily was asked about and turned down: one to three games is not a board.

### Reset ratings (the owner, rarely)

The real rating is folded game by game from the group's first captured custom, and nothing restarts it except
one deliberate action: the owner's **Reset ratings**, at the bottom of the admin home (2026-10-03). It is for a
group that wants to start over, not for a normal week.

- Everyone's group rating goes back to 1200 from that moment. Never one person's.
- It is the one place in the product that asks for typing: the owner types the group's link to unlock the
  button, under `Everyone's rating goes back to 1200. Games stay in history. This can't be undone.`
- It is refused while a lobby is live or a game finished in the last 15 minutes: `Finish tonight's game first.`
- Discord gets `Ratings were reset. Everyone starts at 1200 again. Top 3 before the reset: …`, which is the
  only record of the old board; the site keeps no archive.
- Afterwards `All time` reads `Since <date>` and settling counts games since it. Game history, the rating changes printed on old games, the week's points and the
  calibration line are untouched.
- Admins see the section greyed out with `Only the owner can reset ratings.`

## Kustom Premium (M16)

Some groups have **Kustom Premium**, switched on by the person who runs Kustom (with a script, never a button);
nobody pays for it, and Kustom is still free. The landing page and `/about` don't mention it. In a Premium
group, an AI writes a little story on top of numbers Kustom already has: one line under each game's result (on Tonight's poster, the game page and the Discord result post), a
paragraph at the top of the Sunday post (and on the board's Last week), and two or three lines on each
regular's page, rewritten every Sunday. Every line is labelled `AI recap` or `AI scouting report`, and every
number in it is checked against the database before it is shown; a line that fails the check simply does
not appear. It never says the odds, never talks about anything Kustom cannot see, and only teases the side
that won. Any player can turn off `Write about me` on their You page (or ask an admin to), and admins can
switch AI lines off for the whole group or hide any single line: a game's recap, the weekly story or a
scouting report. A group without Premium sees none of this:
no banner, no locked button, no mention. Nobody types anything for any of it.

How the lines sound (product, M16.7 tone read). They sound like a friend who was watching. A winner can be
teased about their numbers in that game: `mostly there for moral support` and `a very generous support` are
fine. A line never says a winner got carried, got lucky, was boosted or was scripting, and it never says a run
of wins wasn't earned. Someone who lost is named only for a number that was actually good: the most in the
game, or their best in the group. They are never praised with a straight face for a low number (`still dropped
3 kills`). A scouting report gives a losing week as the plain count (`6 wins in 18 games`), never with `rough`,
`tough` or `quiet`; a winning week can be called warm. Lines that sit next to each other should not read alike.
A night's five recaps should not all lead with a win streak or `from the losing side`. A streak is worth a line
when it is news, not every time someone wins three games.

AI spend is capped at $2 per group a month and $20 across every group; at a cap the lines go quiet until the
1st and nothing else changes. The original group, `customs`, has Premium from the day it lands.

## Features by milestone

See `02-milestones.md` for the build order. In product terms:

| Feature | Milestone |
|---|---|
| Player roster; ranks read from the client, roles learned from the games you play | M1, M2, M5 |
| Auto-detect the ten from the lobby | M2 |
| Balanced teams posted to Discord with explanation | M3 |
| Results and ratings captured from end-of-game, no reporting | M2, M3 |
| Tonight page and leaderboard on the web, phone-friendly | M3 |
| Kustom creates the lobby and invites the ten | M4 |
| Auto side switch | M4 |
| Discord voice split and "N around" presence | ~~M4~~ dropped 2026-09-10 |
| Backfill every past custom from the client's match history, for every member, no approval step | M5, M13 |
| This week / last week / all time on the board, weekly awards, role and duo stats | M5, months removed in M14.48 |
| Game history with per-player KDA, damage, gold and CS (Summoner's Rift by default, ARAM toggle) | M5 |
| Daily Mystery: one accountless "who was it?" guess per civil day | M5 |
| ARAM is recorded and never rated | M7 |
| ~~A second rating for the week, on the weekly board only~~ | M7, retired in M14.57; back in M18 as the weekly Rating, printed as week points |
| Every rating change says why it was that size, as a sum a friend can check; the odds shown are the odds the rating used | M14.58, M14.59, rewritten in M18 |
| Filled last game, last to be filled this game | M7 |
| ~~MVP and ACE keep a little more of the result~~, and the post names them | M7; the multipliers replaced in M18 by shares for all five, the names kept |
| ~~How even the teams are, as a percentage~~ | M3.31, retired by the receipt in M14 |
| Who beats you and who you win with, on the fun page | M8 |
| The nights the bot said you would lose and you did not | M8 |
| Last week's award winners labelled on the board | M8 |
| Guess the Award: a second daily guess, alternating days with Daily Mystery | M8 |
| One vs one: who wins each lane, and any two people head to head | M8.5 |
| Fearless draft: champs played since the last reset are banned next game | M10 |
| Champion icons on the fearless card | M11 |
| Tonight's mode on one card (Normal or Fearless), its panel opens on your lane, at its own link | M14.29 to M14.31 |
| Reasons to sign in: claim your games, you vs them, your night | M14.33 to M14.36 |
| A rule for one game (class wars, region wars, mirror match), not rated by default, Spin, a Rated switch | M15 |
| Region wars on all 13 regions (two-region champions), region tags on champion chips, the regions shown as soon as region wars is chosen and redrawn or changed by an admin until the game starts | M20 (M20.14 to M20.17 open) |
| The teams that actually start are the teams: Tonight in game, the odds, a `Game on` post, the result post, history and the balancer's memory follow them, rolled or not | M21 (M21.2, M21.13, M21.14 open) |
| Kustom Premium: AI recap line, weekly storyline, scouting report, behind a per-group flag the operator sets; capped at $2 a group a month; no billing yet | M16 (built; review open, M16.7) |
| The result as a poster; tonight's earlier games kept on the page | M11 |
| A picture when a link to tonight, a game or a player is pasted | M11 |
| Asking the database whether coming back after a break really breaks the rating | M9.1 |
| Widening the model's doubt about a player who has been away | M9.2, not scoped: it waits on M9.1's numbers |
| Kustom: one small Windows app for hosts (tray, starts with Windows, links with a code, updates itself); no overlay | M6 + M12, rewritten in Rust in M17 |
| More than one group: start one, invite with a link, ratings per group, `/g/<link>` pages | M13 |
| The receipt on every split, in history and in Discord; calibration; pre-game odds | M14 |
| One Rating everywhere, boards sorted on it, the settling section | M14 |
| The Kustom rating (one-line formula, K 32 to 16, shares instead of MVP/ACE multipliers), a weekly Rating that restarts every Sunday, one odds function for the bot and the rating, announced once in a patch-notes post | M18 (switch pending, M18.10) |
| No seasons | M14 |
| Owner, admins and members; removing a member; the owner's Reset ratings | M14 |
| Tonight · Board · Games · Stats · You, on phones and laptops; no More page | M14.7b |
| The `Get your group ready` checklist, one-click Discord connect, host setup by code | M14 |
| The landing page, `/how`, `/download`, and `/g/customs` as the demo | M14 |
| Fast pages: tonight changes once per real change and never because of another group, a tap shows its answer at once, no player or lobby rows travel over the live connection | M19 |

Backfill reads the client's own match history, and M0 confirmed it can: customs are in there (17 of 21 games in
the first capture). The history *list* names only the person whose client it is, so backfill fetches each
game's detail page to learn the other nine. Nobody has yet checked how far back the window reaches (M5.6), so
"every past custom" honestly means "every custom still in the history of someone who runs Kustom".

## Explicitly out of scope

- Any Riot public API usage. Custom match data is not available there and we do not need ranked data from it.
  Champion icons are not that API: they are the game's own static images from Riot's Data Dragon at a pinned
  version, looked up by the champion id we already store, with no key and no player data (2026-10-03). No Riot
  or League logos anywhere.
- Asking every friend to run a **host**. One or two people per group install Kustom; everyone else installs
  nothing. There is no overlay and no champion-select panel (removed in M17): the fearless pool and a rule's
  pool live on the tonight page's mode panel and in Discord. Kustom is Windows only (M17); a Mac friend plays
  and is recorded through the host's PC like anybody else.
- Manual result reporting. If Kustom misses a game, backfill recovers it.
- WhatsApp bot. There is no legitimate group-bot API. The tonight page link is the WhatsApp integration.
- A Discord bot, and Slack (not until someone asks twice; it would be a single webhook).
- Anything touching champion select or gameplay. The fearless list is for humans to ban; Kustom never
  auto-bans. Champions on the in-game teams are not shown either: Kustom reads the end-of-game screen, never
  the live game.
- Private groups, deleting or renaming a group, renaming a group's link, banning a person, a group switcher,
  a public list of groups, counting one game for two groups, moving a game between groups, merging groups,
  and a group in another timezone (every group's night and week run on the same clock for now).
- Pricing. Kustom is free.

## Success

- Zero team arguments in a week of nightly games.
- Lobby open to game start under three minutes.
- The tonight page shows a change within a second of it happening, once, and a tap on it never leaves the
  old screen up after the button lets go.
- A friend who opens the link in voice can tell, without asking, whether they are in, which side they are on,
  and why the split is fair.
- A stranger who lands on `/` understands Kustom in ten seconds and can start a group in two minutes.
- Every game played with a host present is in the database with no human action. The client only keeps the
  end-of-game stats block while that screen is up, so "present" means running at the final whistle. A host
  that happens to be restarting right then loses the game to backfill — still no human action, just a day
  later.
- Ratings visibly converge, and the calibration line says so: the side the bot favored wins about as often as
  the bot expected.
- A new player's Rating settles in about ten nightly games, and that is when they get a rank on the board.
