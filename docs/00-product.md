# Product

## One line

A referee for our nightly League of Legends customs: it sees who is in the lobby, splits them into two fair teams
with real roles, keeps ratings from actual results, and ends the argument before it starts.

The product is called **Kustom**; `Customs Night` is the codename used in this repo.

## Who it is for

Ten to twenty friends, rotating roster, ranks from Bronze to Master, some people one-trick a role. Discord for
comms, WhatsApp for "are we playing tonight". No organizer wants a job. One or two people are willing to run a
small desktop app.

## The problem

The ten to twenty minutes between "who's in?" and "lobby's up" is where arguments live. Whoever picks teams is
accused of stacking. New or rotating players make it worse because nobody agrees how good they are.

## Principles

1. **The bot is the referee.** No human picks teams. Ever.
2. **Zero input.** Nobody checks in, nobody reports results. The client already knows who is in the lobby and
   who won; the companion reads it. Any manual step will be skipped by someone, and skipped steps corrupt ratings.
3. **Fair by numbers, but explained.** Every split posts its predicted win chance, the rating gap, whether anyone
   is off-role, and the next-best alternative. "The bot is rigged" needs a number to argue with.
4. **Discord is a display, not a form.** Teams, results, and leaderboards appear where people already look, and
   so does the week when it ends. Nothing requires typing a command. (Splitting voice was dropped at the user's
   request on 2026-09-10; the group talks in one channel.)

## The nightly loop

1. People gather in Discord voice as usual. (A "7 around" post was planned; it needed a bot process and the
   bot was dropped with the voice split on 2026-09-10, so the WhatsApp thread still answers that one itself.)
2. The lobby opens. Somebody taps **Start a lobby** on the tonight page and a custom appears on whoever already
   has the companion running — nobody picks the host, the name or the password — and an invite popup goes out to
   everyone who has been around lately (M4.2). Opening one by hand in the client still works exactly as it
   always did. Either way, somebody in that lobby is running the companion, because that is what the rest of the
   night reads.
3. When ten are in and stable, the companion sends the roster. The server balances and posts Blue and Red with
   roles, win chance, and a one-line why.
4. Players switch to their side (companion can do it for them, see M4). Game starts.
5. At end of game the companion captures the full stats block. Ratings move. Leaderboard updates. What each
   person plays is counted too, so their main and backup follow the games they actually play.
6. If more than ten showed up, the server posts who sits: whoever has played most tonight, and between
   equals whoever has gone longest without sitting. On the first game of a night nobody has done either, so
   the post says as much — somebody has to be first — and from the second game on the rotation has real
   history to work from.

## The three things a person can change

Everything else happens without anybody touching it. These three exist because the docs already accepted them,
and each is one tap:

- **Start a lobby** (M4.2, every linked player since M4.13). The first tap of the night, and the only one that is optional:
  whoever has the companion running can open a custom from their client the way they always have. Pressing the
  button instead opens one on somebody's PC — the server picks whose, the most recently seen friend whose
  companion has been up in the last ten minutes — with a name like `Customs 09 Sep #1` and a four-digit password
  neither of them chose, and then sends an invite to everyone who has been around this week. The name and the
  password are printed in the Discord post and on the page for anyone signed in, so whoever missed the popup
  joins by hand. If
  nobody's companion is running there is nothing to open and the page says exactly that. There are no fields on
  it: no mode, no name, no password, because each of those is a step. Two people tapping at once get one lobby.
  Anybody who has picked themselves out of a lobby once sees the button — which is the twenty people who play,
  and nobody has to find out who the admins are to get the night started. A visitor who is not signed in is
  offered the sign-in instead; whoever the link was forwarded to gets neither. The group has not yet started a
  night this way in front of anybody, so the first real press is still ahead of us.
- **Reroll** (M3.2, admins). Teams are posted and somebody wants a different night. One tap promotes the
  second split, one more promotes the third, and then it stops: three splits come out of the balancer and
  there is no fourth. A reroll posts a new message in Discord saying which reroll it is; it never edits the
  old one, never changes who is playing, and never picks at random. When the list runs out, the way to get
  different teams is to change who is in the lobby, which rebalances by itself.
- **Role for tonight** (M3.6). A friend taps a role on the tonight page and the balancer treats it as their
  main for the rest of the night, with their usual main as the backup. Nobody sets their roles anywhere else:
  their main and backup are read from what they actually play (M5.16, M5.17), so this tap is also how a person
  steers that — play a role on purpose for a week and it becomes your main. Being *filled* into a role never
  changes it. It is a preference, not a lock: the
  teams can still put them somewhere else and the explanation line says so when they do. A tap after teams
  are already posted is kept for the next game rather than redoing the teams people have already moved for —
  the referee does not reopen a decision because one player changed their mind.

## Being filled

Somebody has to take the empty seat. What changed on 2026-09-15 is that the bot now remembers who took it
last time: putting a person on a role that is not theirs has always cost the split points, and that cost is
now bigger for somebody who was filled in their last game and shrinks back to normal over the next few
(M7.5, M7.6). A person filled on Tuesday is the last choice to be filled on Wednesday.

It is a price, not a rule. If one person in the lobby is the only one who has ever played jungle, they play
jungle, and the explanation line says they are off-role exactly as it does today. The referee prices the
unfairness; it does not refuse the night. Nobody taps anything for this and nothing about it appears on a
screen — being filled still never changes what the model thinks your main is.

## Worked example

The concrete version of "the bot is the referee", used as the pinned test case for the balancer
(`docs/02-milestones.md`, M1.4, has the full arithmetic and the expected second and third splits).

Ten friends are in the lobby on an ordinary Tuesday. They have been playing for a few weeks, so their ratings
have drifted off the rank they were seeded from.

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

Nobody types anything. This appears in Discord:

| | Blue | Red |
|---|---|---|
| top | Hana | Omar |
| jungle | Iris | Rami |
| mid | Karim | Nadia |
| adc | Bilal | Lena |
| support | Theo | Yuki |

> Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.

Everyone got the role they main. The two sides are 100 rating points apart out of about 7,600 a side. Lena is
the best player in the room and she is on the weaker side on paper, which is the sort of thing that used to
take ten minutes of arguing. If someone still wants a different night, reroll gives the "swap Hana and Omar"
teams instead, and then one more after that. There is no fourth.

## The numbers on the screen

The model keeps one rating per player, `{ mu, sigma }` — `mu` is what it thinks you are, `sigma` is how sure
it is. It is the only rating that forms teams, and it is never reset. (The two week windows on the
leaderboard are read through a second, throwaway number that starts over every Sunday; that is further down,
and it touches nothing here.) Two numbers come out of the real one, and they have fixed names everywhere in
the product:

- **Rating** is `round(mu * 60)`. It sits beside your name in the teams embed, the result embed and the
  tonight page, and it is what the balancer works from.
- **Proven** is `round(ordinal * 60)`, where `ordinal = mu - 2 * sigma`. It is the leaderboard's number. The
  board sorts on Proven and shows it as the primary column, with Rating underneath in smaller type, so the
  order on the page always matches the number the page is showing. Proven is deliberately cautious: it sits
  below your Rating by how unsure the model still is about you, so the player the board has watched least
  carries the biggest subtraction. That gap shrinks as you play and settles after about 30 games. It does
  not close — a settled player is still a few hundred points below their Rating, and is meant to be. The
  page says all of that in one sentence rather than leaving people to guess.

**The two week windows are the one place that rule is different** (2026-09-15, M7.3). `This week` and `Last
week` sort on **Rating** — the week's own Rating, from the week's own number — and print that as their one
number; no Proven appears on a week board at all. A week is a handful of games by design, so Proven's
subtraction there is enormous for everybody and biggest for whoever played least: it would rank a 4W 4L week
above a clean 2W 0L one for the sole reason that the longer week is "more proven", which is the same
confusing kind of fairness that opened M7. Playing more still counts — each further game moves your weekly
number less than the one before it, which is how the model works and is true whatever the board sorts on — it
just is not charged twice. `All time`, `This month`, `Last month` and `/p/[puuid]` are unchanged: Proven is
the number and the sort.

A printed change is always the difference of the two displayed numbers — `1469` becoming `1512` prints
`(+43)`, never a separately rounded figure that makes the row fail to add up.

**Only Summoner's Rift customs move the number.** The group plays ARAM some nights and those games are
recorded like any other — they are on the game history, in the records, on a person's own page — but they
never touch a rating. A mode with no lanes and no roles was never what the balancer is trying to measure,
and until 2026-09-15 it was quietly counted, which is a bug and not a policy (M7.1).

**Carrying is worth a little more.** The best player on the winning side keeps about a quarter more of what
they gained, and the best player on the losing side gives back about a fifth less. Best means the highest
score on a seven-part reading of that game: kills and assists against deaths, damage to champions, gold,
vision, damage soaked, CS, and damage to towers, dragons and barons. The first six count for everybody, near
enough the shape op.gg's MVP and ACE use; the seventh counts for the jungler and nobody else. Everyone is read
against the other nine people who were actually in that game, never against some average player somewhere
else. **What weighs most depends on the role you played** (2026-09-15, M7.13): vision is most
of a support's score and almost none of a carry's, damage to champions is most of a carry's, and a jungler is
read somewhere between the two, plus the one number nobody else is scored on: what they took off the map
(M7.14). Top, mid and adc are read the same way as each other, because the game's own
record does not reliably say which of top and mid somebody was. It is a small adjustment made after
the model has rated the game, it never turns a win into a loss or the other way round, and it leaves Proven's
"how sure are we" half alone: a good night is not the same thing as certainty (M7.8).

**A game where we do not know who played what has no best player.** The companion reads everybody's role off
the end-of-game screen, so a night the companion watched has all ten. A game recovered from someone's match
history later does not — the client's history does not say who played support — and on those games nobody is
named and nobody keeps anything extra. Guessing a role to hand somebody a bonus is the sort of thing this
product refuses everywhere else, and it refuses it here too. **The result post names
both of them** and a person's own page says which of their games they carried, because a number that moves
differently for two people on the same winning team has to say why (M7.10).

**Rating changes do not sum to zero across the two teams.** Movement scales with how unsure the model is
about each player, so five players it barely knows move further than five it has watched for a month: a
result can be `-228` on one side and `+231` on the other. Both sides were rated correctly; the totals were
never meant to match. That is why no surface ever prints a team total of rating changes — it would be a
number that looks wrong every night while being right.

## Features by milestone

See `02-milestones.md` for the build order. In product terms:

| Feature | Milestone |
|---|---|
| Player roster; ranks read from the client, roles learned from the games you play | M1, M2, M5 |
| Auto-detect the ten from the lobby | M2 |
| Balanced teams posted to Discord with explanation | M3 |
| Results and ratings captured from end-of-game, no reporting | M2, M3 |
| Tonight page and leaderboard on the web, phone-friendly | M3 |
| Companion creates the lobby and invites the ten | M4 |
| Auto side switch | M4 |
| Discord voice split and "N around" presence | ~~M4~~ dropped 2026-09-10 |
| Backfill every past custom from the client's match history | M5 |
| This week / this month / all time on the board, awards, role and duo stats | M5 |
| Game history with per-player KDA, damage, gold and CS (Summoner's Rift by default, ARAM toggle) | M5 |
| Daily Mystery: one accountless "who was it?" guess per civil day | M5 |
| ARAM is recorded and never rated | M7 |
| A second rating for the week, on the weekly board only | M7 |
| Filled last game, last to be filled this game | M7 |
| MVP and ACE keep a little more of the result, and the post names them | M7 |
| How even the teams are, as a percentage, under the teams on the tonight page | M3.31 |
| Who beats you and who you win with, on the fun page | M8 |
| The nights the bot said you would lose and you did not | M8 |
| Last week's award winners labelled on the board | M8 |
| Guess the Award: a second daily guess, alternating days with Daily Mystery | M8 |
| Asking the database whether coming back after a break really breaks the rating | M9.1 |
| Widening the model's doubt about a player who has been away | M9.2, not scoped: it waits on M9.1's numbers |
| Tray app wrapper with auto-start | M6 |

Backfill (M5) reads the client's own match history, and M0 confirmed it can: customs are in there
(17 of 21 games in the first capture). Two details shape it. The history *list* names only the person whose
client it is, so backfill fetches each game's detail page to learn the other nine. And nobody has yet checked
how far back the window reaches (M5.6), so "every past custom" honestly means "every custom still in the
history of someone who runs the companion".

## The week, the month, and all time

Ratings never reset. There is one number per player, folded game by game from the first custom this group ever
captured to the one they played last night, and nothing a person or an admin can press starts it over.

What used to be a season is now a **window the same board is read through**. The leaderboard opens on **This
week** — Sunday 06:00 to Sunday 06:00, the same 06:00 boundary that decides which night a game belongs to,
because the group plays past midnight — and offers **Last week**, **This month**, **Last month** and **All
time** beside it. A window changes who is on the board and what their record and their climb over those days
were. It never changes anybody's rating, because **a window is a filter over games, not a rating event**.
That is precisely why it can happen every single week without costing the number its meaning: a weekly reset
would leave everyone permanently "settling", and a board where nobody has settled is a board nobody believes.

**The week has a number of its own** (M7.2 to M7.4). The group's objection was fair: a board headed *This
week* that ordered people by where they stand after a year is not telling them about their week. So the two
week windows are read through a second rating that starts everyone at their rank again every Sunday at
06:00 and follows only that week's games. Starting over every Sunday is what makes it quick: a game moves
your week about three times as far as a game moves a settled all-time rating, so Tuesday night is still
visible on Thursday's board. What it does **not** do is settle inside a week — a handful of games is not
enough for any model to be sure of anybody. It is also why the two week windows **sort on Rating and not on
Proven** — the one exception in the product, written out under "The numbers on the screen" above. The week
board says exactly that under itself, in place of the
sentence the other windows carry about Proven, and it is the one board in the product with no `settling`
marker on any row: everybody on a week is still settling, always, and a word printed on all ten rows tells
nobody anything. That is also the answer to the paragraph above — a board where nobody has settled is a
board nobody believes, so the week does not claim anybody has. It is a second
number, not a reset: the real rating is still folded from the first custom
this group ever captured, it is still what forms teams, and nothing about the week ever reaches the balancer.
`This month`, `Last month` and `All time` are the real number, as they have always been. One tap moves between
them and the page says which one you are looking at.

**The week starts on Sunday** (2026-09-15), because that is when this group's week starts — Egypt works
Sunday to Thursday — and the product is built for their week and not for a calendar standard's. Sunday 06:00
to Sunday 06:00, so a range reads `Sunday 13 Sep to Saturday 19 Sep`. The night boundary and the month are
untouched by that: a night is still 06:00 to 06:00 and a month is still the month.

Every Sunday and every first of the month, the window that just closed posts itself to Discord — its final
board and its three awards (most improved, best off-role, cursed duo) — with nobody pressing anything. That is
the whole of what people wanted from seasons: something that ends, and something to win by Friday.

Daily was asked about and turned down. One to three games is not a board, and three awards computed on two
games is noise with a trophy on it.

Under all of that the database keeps one `season` row as the container every game points at. It was created
once, by the first migration; its name is never printed on a page or in a post; and there is no button anywhere
that makes a second one.

## Explicitly out of scope

- Any Riot public API usage. Custom match data is not available there and we do not need ranked data from it.
- Manual result reporting. If the companion misses a game, backfill (M5) recovers it.
- WhatsApp bot. There is no legitimate group-bot API. The tonight page link is the WhatsApp integration.
- Slack. Not until someone asks twice. It would be a single webhook.
- Anything touching champion select or gameplay.

## Success

- Zero team arguments in a week of nightly games.
- Lobby open to game start under three minutes.
- Every game played with a companion user present is in the database with no human action. The client
  only keeps the end-of-game stats block while that screen is up, so "present" means running at the
  final whistle. A companion that happens to be restarting right then loses the game to backfill —
  still no human action, just a day later.
- Ratings visibly converge: a player's predicted win chance across their last twenty games averages near 50%.
- A new player rises in strength faster than they rise on the board. Their Rating settles in about ten
  nightly games, but the leaderboard sorts on Proven, the deliberately cautious number
  (`ordinal = mu - 2 * sigma`), which stays behind Rating and takes roughly a month of nightly games to
  settle there. That is on purpose: the board makes you prove it. (This is about `All time` and the month
  windows. The two week windows sort on Rating and ask a different question — how your week went — and
  nobody proves anything in a week.)
