# M16.19 scouting report: 8 samples for product's re-score

Run 2026-10-04 by the platform engineer with `pnpm --filter web ai-eval-month --kinds player`, on the M16.7
reviewer's fixture month: 20 players over 4 weeks, with week 4 as the report's week. Names are the real roster's;
the stats are invented. The model is Sonnet 5.5, using the M16.19 facts and prompt. All 18 reports were
published, and the checker refused 2 of the 20 attempts. The run cost $0.11.

## What changed

The page above the report already shows a player's Rating, record, most played champion and role. The report now
leads with something the page doesn't show:

- **Best duo partner**: the teammate they win with most, over 5 or more games together. It is never a partner who
  has opted out. The partner gets their own token, `{P2}`.
- **The week's best game**: the game with the most kills plus assists, with its champion and whether they won it.
- **A champion new to their pool**: a champion first played in the group during the week, counted only after 5 or
  more earlier games.
- **A role shift**: the week's main role, when it isn't their usual one (3 or more games).

A losing week is just the count. The checker refuses `rough`, `tough`, `quiet`, `quieter` and `cold` in a report;
the same words are still allowed in a game line. Each report is also shown the other reports written that Sunday,
so openings don't repeat.

Acceptance results on all 18 reports:

- The most common opening, masked, appears in 1 report (the limit is 3).
- All 18 reports carry a fact beyond most played champion, role and week record.

## The 8 samples

1. **Raafat** (7 wins in 12 games in the week)
   > Fiora showed up in the pool of Raafat for the first time in the group, 2 games over the week. The best game of the week was a win on Veigar, 18 kills and 22 assists. Over the week Raafat went 7 wins in 12 games, a warm stretch.
2. **FoxHound** (11 in 21)
   > The best game of the week for FoxHound was a win on Jinx, 22 kills and 11 assists. Over the week FoxHound went 11 wins in 21 games, a warm stretch. Wins come most with Sami: 17 wins in 26 games on the same team.
3. **1sec Reloading** (a losing week, 6 in 21)
   > Ornn showed up in the pool of 1sec Reloading for the first time in the group, 2 games over the week. The standout game was a loss on Jinx, 21 kills and 24 assists, and the week went 6 wins in 21 games. xXDarkExodiaXx is the teammate with the most wins alongside 1sec Reloading: 12 wins in 24 games together.
4. **Ramzyinhović** (a losing week, 5 in 18)
   > Support duty suited Ramzyinhović over the week: Blitzcrank was new to their pool, and the 1 game there was a win with 26 assists. Over the week Ramzyinhović went 5 wins in 18 games. PRT Empty is the teammate Ramzyinhović wins with most, 9 wins in 21 games on the same team.
5. **Rano of Zaun** (5 in 9)
   > Nobody lights up a game quite like Rano of Zaun did on Ahri over the week: a win with 24 kills and 26 assists. The week went 5 wins in 9 games for Rano of Zaun, and xXDarkExodiaXx is the teammate with the most wins alongside them, 9 wins in 15 games on the same team.
6. **Sami** (12 in 20)
   > Kha'Zix gave Sami the best game of the week, a win with 12 kills and 36 assists. Over the week Sami went 12 wins in 20 games, and FoxHound is the teammate Sami wins with most: 17 wins in 26 games together.
7. **Tito** (a losing week, 6 in 18)
   > Wins come easiest with xXDarkExodiaXx around: 15 wins in 23 games on the same team as Tito. Over the week Tito went 6 wins in 18 games, and the best game was a loss on Morgana with 47 assists.
8. **Layla** (7 in 10)
   > The week belonged to Layla, who went 7 wins in 10 games, the best of them a win on Garen with 14 kills and 16 assists. Layla also tried Amumu for the first time in the group. Kareem is the teammate Layla wins with most: 9 wins in 12 games together.

For comparison, here is the M16.6 version of the same kind of report, which product scored 1.5 for engaging:

> PRT Khokha means Ahri: 5 games on it at 60 percent, their most played champion, from a mid lane that holds 12 games. The pool spreads wide across top and bot too. This week PRT Khokha went 4 wins in 7 games, a solid week.

## The engineer's read (product decides)

The new reports are a clear step up: they tell a friend something the page doesn't. The three facts often arrive as
a list (duo, best game, record) rather than a story, and the week record is in every report. My guess is about 3.0
to 3.3 on engaging and 4.7 or more on friendly; product's score decides keep or cut.
