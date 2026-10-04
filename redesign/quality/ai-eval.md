# Kustom Premium AI lines: quality eval (M16.8)

Run 2026-10-04 by the platform engineer, with `pnpm --filter web ai-eval` (`apps/web/scripts/ai-eval.ts`).
Total API spend for the whole eval: **about $0.62** of the $3.00 budget (Haiku $0.18, Sonnet $0.44).

**Verdict: KEEP, on Sonnet 5.5, with the M16.8 prompt and facts.** The M16.3 prompt on Haiku 4.5 wrote box
scores that nobody in the group would read twice (funny 1.0 out of 5). With the new facts and prompt on
Sonnet 5.5, the lines tell the game's story and are sometimes funny (overall 4.2, funny 3.2). They are never
mean and never wrong. That comes from the checker, not the model. **One caveat:** only one of the 16 games
is a real game of this group (see "Data"). Read the first real night's lines before calling this settled.

## Data

The local stack's `customs` group holds only test seeds: nine games, five of them 0/0/0 and three a copy of
the same synthetic scoreboard. The real games are on the hosted project, and this lane must not touch it. The
eval set is therefore:

- **1 real game**: `packages/lcu/fixtures/16.17/match-detail.json`, a ten-human custom of this group. It is a
  49-minute bloodbath, 73 to 76 kills, with real names.
- **15 scenario games** in `apps/web/scripts/ai-eval-scenarios.ts`, shaped like this group's customs and using
  the real roster's names. There is one per situation a recap has to handle: stomp, close, MVP on the losing
  side, deathless carry, support game, upset, ARAM, a 16-minute surrender, a 52-minute marathon, ties, a winner
  who went 0/9, a win with fewer kills, opt-outs, and the new history facts (streak, first champion, personal
  best).
- **3 scenario weeks** for the Sunday storyline (M16.5, merged from its branch for this eval).

To rerun on real games, restore a copy of the hosted data into the local stack (the user's call) and run
`pnpm --filter web ai-eval --source local`. It reads production's own loader (`loadGameFactsInput`, history
facts included) and writes nothing.

## Rubric

Each line is scored 1 to 5 on five criteria, read as a friend scrolling Discord after the game:

| Criterion | 1 | 5 |
| --- | --- | --- |
| Funny / engaging | a stat readout you skip | you'd quote it in chat |
| Specific | could be any game | only this game reads like this |
| Accurate | a wrong or garbled claim | every claim true, numbers right |
| Tone | mean or barbed at a loser | friendly ribbing, winners only |
| Length | over 180 characters, a wall | 80 to 160 characters, punchy |

## Scores (16 games each)

| Run | Funny | Specific | Accurate | Tone | Length | Overall | Published | Cost / line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Before**: M16.3 prompt, Haiku 4.5 | 1.0 | 2.2 | 4.4 | 4.0 | 2.3 | **2.8** | 16/16 (5 retried) | $0.0017 |
| M16.8 prompt, Haiku 4.5 | 1.8 | 3.4 | 4.8 | 4.6 | 3.2 | 3.6 | 15/16 | $0.0027 |
| **After**: M16.8 prompt, Sonnet 5.5 | 3.2 | 4.6 | 4.9 | 4.8 | 3.6 | **4.2** | 16/16 (1 retried) | $0.0055 |

Haiku with the new prompt is accurate but formulaic. It wrote "{support} locked it down from support with N
assists and N vision score" in six of 16 games, and its 15th game was rejected twice. Sonnet picks one angle and
varies its wording.

## Before (M16.3 prompt, Haiku 4.5): 10 samples

1. *Real bloodbath*: "Ramzyinhović went off with 24 kills in 48 minutes as Red dominated Blue 76 kills to close out the game, while Rano of Zaun kept everyone alive with 110 vision score." Garbled scoreline. "Kept everyone alive" is a claim nobody can check.
2. *Stomp*: "PRT Empty went 12 kills and 0 deaths on Lee Sin while xXDarkExodiaXx set up the win with 24 assists on Thresh as Blue took down Red in 22 minutes."
3. *Close*: "Rano of Zaun went off with 10 kills and 36210 damage to champions, while PRT Empty orchestrated the win with 22 assists and 66 vision score in Red's 41 minute victory."
4. *MVP on the losing side*: "Blue took the 33 minute win with Menaçe Jhin leading the way at 9 kills, while XETA Nami orchestrated things with 21 assists and 52 vision score." It misses the story: the losing Akali had 15 kills and the most damage.
5. *Deathless carry*: "Raafat went 14 kills and 0 deaths on Jinx while Rano of Zaun on Nami dished out 26 assists, and Red took down Blue 32 kills to close out the 29 minute game."
6. *Upset*: "Raafat with 8 kills and 23104 damage led Red to a 27 minute upset win, while PRT Empty orchestrated the victory with 19 assists and 44 vision score from support."
7. *Marathon*: "Blue took it in 52 minutes with Raafat's Kai'Sa leading the charge at 16 kills and 68120 damage, while FoxHound's Leona orchestrated from behind with 34 assists and 112 vision score."
8. *Winner went 0/9*: "Rano of Zaun with 13 kills and PRT Empty with 11 kills led Blue to victory in 34 minutes, while Raafat orchestrated the win with 25 assists and 55 vision score." It misses the obvious tease.
9. *Won with fewer kills*: "Blue took down Red 24 kills to claim the 39 minute win, with Ramzyinhović lighting the map at 70 vision score and FoxHound dumping 33410 damage across the fight." It reads as if Blue had more kills, which is wrong.
10. *Personal best + first champion*: "xXDarkExodiaXx went off with 13 kills in 32 minutes, while Rano of Zaun orchestrated the win with 26 assists and a massive 54 vision score for Blue's 37 team kills."

The pattern: "X went off with N, while Y orchestrated with N and N". "Orchestrated" appears 7 times in 16 lines,
and every line is 180 to 220 characters of numbers.

## After (M16.8 prompt, Sonnet 5.5): 10 samples

1. *Real bloodbath*: "FoxHound finished with 28 kills on Draven, the most in the game, from the losing side. Ramzyinhović won it anyway with 119k damage on Veigar and 19 deaths."
2. *Stomp*: "PRT Empty played Lee Sin for 22 minutes without a single death: 12 kills, 0 deaths. Blue won it with 38 team kills, and xXDarkExodiaXx still found time for 24 assists."
3. *MVP on the losing side*: "Most kills in the game went to PRT Khokha: 15 kills on Akali, 38.4k damage, all from the losing side. XETA won it with 21 assists and 6 deaths."
4. *Deathless carry*: "Raafat stayed on Jinx for 29 minutes and never died: 14 kills, 0 deaths, 29.9k damage. Red won it, and Rano of Zaun still made the map look small with 26 assists."
5. *Support game*: "Rano of Zaun was in on 33 of 34 team kills, with 31 assists and a 98 vision score on Thresh. Somebody check if they were secretly everywhere."
6. *ARAM*: "Blue wrapped it up in 18 minutes with 52 team kills. PRT Empty led the way with 17 kills on Draven, and Rano of Zaun still won it with 11 deaths."
7. *Tie for kills, a winner with the most deaths*: "Menaçe led the whole game with 7 deaths on Jinx and still walked away with the win. The scoreboard was close, so thank XETA for 27.4k damage."
8. *Winner went 0/9*: "PRT Khokha took 9 deaths on Sett and 0 kills into a win anyway. Rano of Zaun had 13 kills and did the carrying, so the bill was covered."
9. *Personal best + first champion*: "xXDarkExodiaXx took Kassadin out for the first time in the group and dropped 13 kills, their best total with this crew. 1sec Reloading still posted 34.9k damage on Zed from the losing side."
10. *Losing personal best + a streak*: "Menaçe put up 24 assists on Vi, their most in the group, and still came out on the losing side. Rano of Zaun makes it 5 wins in a row on Malphite."

Best three: after 5 ("Somebody check if they were secretly everywhere"), after 8 ("so the bill was
covered"), after 7 ("led the whole game with 7 deaths and still walked away with the win").

Worst three:

- "Blue took down Red 24 kills to claim the 39 minute win..." (before 9). It is misleading.
- "Ramzyinhović went off with 24 kills in 48 minutes as Red dominated Blue 76 kills..." (before 1). The scoreline is garbled.
- "PRT Empty had 21 assists on Thresh, the most in the game, and it was Red who took the loss." (after, *won with fewer kills*). It is the weakest after line: it points at the losing team. It passed the checker, which shows the barb list is still a list.

Other lines the checker caught and threw away, and which never showed: "Blue fell short", "but it wasn't enough",
"couldn't close out a 48-minute slugfest". These barbs at losers used to pass. They are now on the barb list.

## Weekly storyline (M16.5, Sonnet 5.5)

On M16.5's prompt the paragraph recites the board the post prints right under it. For example: "...PRT Khokha
takes 2 place with 13 wins in 20 games, xXDarkExodiaXx grabs 3 place..., XETA holds 4 place after 22 games, and
Menaçe rounds out the board in 5 place. Nice work, everyone." That scores about 2.0.

With the M16.8 `WEEK_STYLE` it tells the week instead (about 3.4):

> Ramzyinhović owned the week: 6 wins in a row, 14 wins in 18 games and 212 points, enough for 1st place and the
> biggest climb on the board. PRT Khokha kept the pressure on with 13 wins in 20 games and 2nd place, though the
> gap stayed wide. xXDarkExodiaXx took 3rd place and walked off with the best off-role award too.

The storyline is still plainer than the recap. It also has a higher refusal rate, about one paragraph in three
over two attempts, almost all from idioms the checker reads literally ("made the most of", "top three", "a streak
of"). That is a cost of one paragraph a week, not a reason to loosen the checker. M16.7's fixture month should
report it.

## Cost and model

| | Haiku 4.5 | Sonnet 5.5 |
| --- | --- | --- |
| Per game line, retries included | $0.0027 | $0.0055 |
| Per group-month at 5 games a night, 5 nights a week (about 108 games) | about $0.29 | about $0.60 |
| Plus the weekly storyline (Sonnet, about $0.008 x 4.3) | | about $0.04 |
| Against the $2 per-group cap | 15% | **about 32%** |

Recommendation: **Sonnet 5.5 for the game line** (done in `lib/ai/meter.ts`). It is double the cost, still a
third of the cap, and it is the difference between a line people read and one they skip. Haiku 4.5 retires no
sooner than 2026-10-15 in any case. The scouting report (M16.6) is still configured on Haiku 4.5 and needs the
same decision before M16.6 ships. The recommendation is Sonnet 5.5 there too: about $0.01 per player-week.

## What changed (M16.8)

- **Facts.** The new facts are:
  - a winner who holds the most deaths gets a claim, which is teasing material;
  - a losing player who leads the game in something is marked a standout, so they get credit;
  - the game's shape (short, long, lopsided, close, won with fewer team kills) is a fact made only of words;
  - history facts read from the group's earlier games: a win streak of 3 or more (winners only), the first game
    on a champion (after 5 games), and a personal best on a Rift stat (against 10 or more earlier Rift games).
- **Prompt.** The prompt asks for one angle and no box score, and lists the angles in order of strength. Damage is
  printed as `29.9k`, which the checker already matches. The prompt has style rules and few-shot examples, and
  the group's last 6 lines are sent as a "do not repeat" list (tokens and numbers masked). A `WEEK_STYLE` was
  added for the Sunday paragraph.
- **Checker.** The checker is stricter only: ten more loser barbs ("couldn't", "wasn't enough", "fell short",
  and others). Nothing was loosened.
- **Bug found.** Sonnet 5.5 answers `thinking: {type: 'disabled'}` with a 400 error. Every M16.5 storyline call
  would have failed in production. It now sends `between_tools`, which is this model's no-thinking setting, and
  a test pins it.
