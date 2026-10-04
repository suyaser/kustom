# Can AI make team formation more fun? (research, 2026-10-04)

Research note, not a plan. Nothing here is in `docs/02-milestones.md` yet, and every change below needs a
decision row before it is built. Question from the owner: *"investigate if we can use ai to better improve team
formation, so it doesnt just [go] on ratings it knows synergies and other stuff that can make it more fun."*

Method: I read the balancer (`packages/core/src/balance/`, `config.ts`), the receipt (`receipt.ts`,
`explain.ts`, `docs/00-product.md` "The receipt"), the balancing rows in `docs/04-decisions.md`, M16 and
`apps/web/lib/ai/`. Then I built a simulation: 20 synthetic friends, roughly 5 games a night, planted duo
synergies and role comfort, the real OpenSkill 5.0.1 package core uses, and a line-for-line port of
`balance()`. No hosted or production data was read. Section 9 has the queries that would confirm or overturn
the conclusions on real games.

---

## 1. Summary for the owner

**Short answer: not the way the question imagines, at least not yet.** For a group of 20, an AI that "knows
synergies" would mostly be learning noise, and it would make the receipt look less fair while making games
no closer. Three cheaper changes will make nights feel better, and AI's job stays what M16 made it: a writer,
not a judge.

What the simulation found:

1. **Games are lopsided mainly because ratings are uncertain, not because the bot ignores synergy.** After
   300 to 600 games, today's balancer still leaves an average true edge of about 9 points of win chance (a
   real 59/41). Perfect knowledge of everyone's skill, with today's role rules, would cut that to 3 to 7 points. Perfect knowledge of
   the planted duo synergies, with skill still estimated, cut it by **0.4 points, which is within noise**.
   Better ratings matter about ten times more than synergy. That belongs to the parallel rating research.
2. **Synergy can't be learned at our size.** A duo plays together in about 1 game in 10. Even a strong
   planted synergy (+9 points when together) is found for only 27% of the true pairs after 600 games, while
   13% of pairs with no synergy at all get flagged. Raw "together versus apart" records are worse: after 300
   games, 32% of pairs with zero true synergy show a 10-point swing by luck alone. The group's existing
   "cursed duo" award is fun, but it is mostly luck.
3. **No trained model beats a coin flip on games the bot balanced.** That is what good balancing looks like:
   the bot has already used everything predictable. A learned model with pair terms overfits until about
   1,200 games, and even then it only ties a coin flip.
4. **Most stomps can't be balanced away.** With perfectly fair teams, the simulated stomp rate is 17%. Today's
   balancer gets 18.5%. The gap that's left over is small, and it comes from rating error.
5. **Two things the group does feel can be fixed today, without AI:**
   - **Who gets filled.** The off-role price is a percentage of rating (`mu * 0.85`), so filling the weakest
     player on a team always costs the least. In the simulation, **the weakest third of the group was filled
     in 27% of their games and the strongest third in 12%**. An off-role cost that doesn't depend on rating
     evened that out to 20% / 18% / 20%, with no measurable loss of fairness.
   - **The same teammates game after game.** Today's balancer repeats more teammate pairs from the previous
     game than random teams would (4.0 versus 3.7 of 20 per game). A small, capped variety term cut repeats by
     11%, with no measurable loss of fairness.
6. **A side finding for the receipt** (shared with the rating research): when every game is balanced and
   everyone starts from the same seed, OpenSkill's ratings spread out about 4 to 5 times wider than true
   skill, and the shown odds become overconfident. In the simulation, a side shown at 63%+ won about half the
   time. The group's calibration line will show whether that happens for real. Query 9.1 checks it today.

**Headline recommendation:** keep the deterministic balancer as the only source of truth and give it two
small, capped, explainable terms: rating-independent fill burden and teammate variety. Fix the odds
calibration together with the rating work. Keep synergy as a stat, not a balancing input, until about 1,000
rated games and a statistical screen say the signal is real. If AI is used, use it under Premium to write a
labelled line about why the matchup is fun, after the teams are set. Never let it pick the split.

---

## 2. How the balancer works today (the parts that matter here)

- All 126 partitions of the ten are scored, with the lowest puuid on blue. Each side picks the best of 120 lane
  assignments, maximising `sum(effective) - fill costs`, where
  `effective = mu * 60 * {main 1.0, secondary 0.93, fill 0.85}`.
- `score = rawGap + Σ offRoleCost + 200 * isRepeat`. `offRoleCost = 120 * (1 + 1 / (gamesSinceLastFill + 1))`
  is fill protection (M7.5). The top 3 are kept. Reroll walks them and is never random.
- Duo locks are a filter, not a penalty. Ties fall back to `offRoleCount`, then puuids. The whole thing is
  pure and byte-deterministic.
- The receipt prints `blueWinProb` from `predictWin(raw mu, sigma)`, the rating gap, off-role count and pick
  number. `whyLower` explains the runner-up from stored columns: `off-role`, `gap`, or `role-costs` (the
  bucket for "repeat, recent fills or rounding").

Two properties of this design decide what can be added:

1. **Win chance and gap measure different things.** The gap uses role-adjusted skill; the odds use raw `mu`.
   So any new term that moves the chosen split away from the smallest raw-`mu` difference shows up on the
   receipt as a worse win chance. In the simulation, the synergy-aware balancer made the *shown* edge 3 to 5
   points bigger while the *true* edge stayed flat. Friends would read that as "the bot got worse".
2. **`whyLower` can't name a reason it has no column for.** Every new term needs its parts stored with the
   split, or the reason line falls back to "scored a hair worse overall" more often. Storing them is a schema
   change (a `splits.score_parts jsonb`), which is the user's call.

---

## 3. Simulation: setup and results

**World.** 20 players. True skill is `25 + 3·N(0,1)`, about the worked example's spread. Mains are
unbalanced like a real group (5 mids, 3 junglers). Each player's true secondary multiplier is drawn from
0.88 to 0.98 and their true fill multiplier from 0.74 to 0.92; 10% are true flex players. Attendance runs
from 35% to 95%. Each night has 4 to 6 games, and seats rotate to whoever has played least that night.
Planted synergy: 5 positive and 3 negative duos at ±4.5 points ("weak") or ±9 points ("strong") of win
chance, plus a 30-pair variant. Outcome:
`P(blue) = logistic(Δstrength / 11.8)`, where 11.8 = 2√2·β. That noise level reproduces the product's worked
example (a 100-point gap ≈ 54%). Ratings start at the provisional seed (20, 12), as in production. The MVP
nudge is left out.

**Balancers compared,** paired by seed, so attendance and noise are identical:

| variant | what it adds to today's score |
|---|---|
| `current` | today's `balance()`, ported exactly |
| `synergyEst` | pair term from our own history: shrunk residual, ±4 pts/pair, ±8 pts/team cap |
| `synergyOracle` | the true planted synergy, uncapped (best case for synergy) |
| `variety` | +25 display points per teammate pair repeated from the previous game tonight |
| `comfortEst` | per-player per-role comfort from win residuals, shrunk, ±4 pts cap |
| `additiveRoles` | off-role price `(1 - mult) * 25 * 60` regardless of rating, instead of `mu * mult` |
| `trueSkillDeclaredRoles` | knows true skill, uses today's role multipliers (isolates rating error) |
| `truthCeiling` | knows everything (best case) |
| `random` | random split (floor) |

**Results, games 300 to 600, 20 seeds.** "True edge" is |true P − 50%|. Brackets give the paired
difference from `current` ± 2 standard errors.

| world | variant | true edge (pts) | stomp % | shown edge (pts) | off-role / game | repeated pairs / game |
|---|---|---|---|---|---|---|
| null | current | 8.99 | 18.5 | 8.8 | 1.93 | 4.03 |
| null | synergyEst | 9.21 [+0.22 ± 0.47] | 18.8 | 13.3 [+4.5] | 1.92 | 3.98 |
| null | variety | 9.03 [+0.04 ± 0.56] | 18.8 | 9.2 | 1.94 | **3.56 [−0.47]** |
| null | additiveRoles | 8.66 [−0.33 ± 0.59] | 18.9 | 10.0 | 1.93 | 3.99 |
| null | trueSkillDeclaredRoles | **2.86 [−6.13]** | 17.3 | — | 1.75 | — |
| null | truthCeiling | 1.10 | **17.2** | — | 1.75 | — |
| strong | current | 9.90 | 19.3 | 9.0 | 1.92 | 4.03 |
| strong | synergyEst | 10.46 [+0.56 ± 0.46] | 19.1 | 14.0 [+5.0] | 1.95 | 4.00 |
| strong | synergyOracle | 9.51 [−0.39 ± 0.46] | 19.6 | 13.8 [+4.8] | 1.93 | 3.97 |
| strong | comfortEst | 10.46 [+0.57 ± 0.55] | 19.3 | 13.2 | 2.03 | 3.96 |
| strong | variety | 10.14 [+0.24 ± 0.51] | 19.2 | 9.2 | 1.93 | **3.55 [−0.47]** |
| strong | trueSkillDeclaredRoles | **7.04 [−2.86]** | 18.3 | — | 1.75 | — |
| strong | truthCeiling | 1.15 | 17.0 | — | 1.76 | — |
| any | random | ~15.5 | ~21 | ~31 | 2.84 | 3.73 |

**Variety weight sweep** (weak world, games 100 to 600):

| per repeated pair | true edge | shown edge | repeated pairs / game | off-role / game |
|---|---|---|---|---|
| 0 (today) | 9.61 | 7.32 | 4.05 | 1.92 |
| 10 | 9.76 | 7.36 | 3.83 | 1.94 |
| **25** | 9.67 | 7.46 | **3.61 (−11%)** | 1.94 |
| 50 | 10.13 | 7.47 | 3.42 | 1.97 |
| 100 | 9.77 | 7.79 | 3.24 (−20%) | 1.99 |

**Who gets filled** (off main role, by true-skill third, 20 seeds, games 100 to 600):

| | weakest third | middle | strongest third |
|---|---|---|---|
| current (`mu * multiplier`) | **27.3%** | 17.9% | **12.4%** |
| additiveRoles | 19.7% | 18.2% | 19.9% |

This follows from the code, not just the simulation. A fill's cost to its team is `0.15 * mu * 60 + 120·(protection)`.
On the worked example's numbers, filling Yuki (1134) costs her team 170 + 120 and filling Lena (2088) costs
313 + 120. `assignRoles` always picks the cheapest seat, so within a team the lowest-rated player fills.
Fill protection only adds the same 120 to everyone, so it can't cancel that.

**Recovering planted synergy from our own history** (residual estimator with empirical-Bayes shrinkage;
"found" means right sign and ≥ 2 points):

| games | mean games together per pair | strong world: corr(est, true) | planted found | null pairs flagged | raw records off by ≥ 10 pts on null pairs |
|---|---|---|---|---|---|
| 150 | 16 | 0.06 | 13% | 15% | 48% |
| 300 | 32 | 0.11 | 21% | 16% | 32% |
| 600 | 63 | 0.19 | 23% | 18% | 18% |
| 1000 | 105 | 0.20 | 34% | 21% | 11% |
| 2000 | 211 | 0.22 | 53% | 33% | 6% |

The simple residual estimator gets *worse* at telling true from false over time: null flags climb to 33%,
because each player's rating error leaks into all of their pairs. Adding player terms fixes part of that
(ridge logistic, CV-chosen penalty): at 600 games, corr 0.22, 27% found, 13.5% null flagged; at 1,200 games,
0.29, 30% and 13.9%. With 30 planted pairs it reaches 0.46 and 57% found at 1,200 games, but 31% of null
pairs are flagged. **At any realistic size, a synergy term would act on false pairs about as often as on real ones.**

The power maths agrees. The standard error of a duo's together-versus-apart win rate after *n* games together
is about `0.5 / √n`. Showing a +9-point duo at two standard errors needs about 120 games together. At about 1
game in 10 per pair, that is roughly 1,200 group games, or about a year of nightly play. A +5-point duo needs
about 400 games together. Duo locks make it worse: a locked pair is never apart in a balanced lobby, so its
synergy cannot be told apart from its ratings at all.

---

## 4. The ideas, judged

Scores are 1 to 5 (5 best). For effort, 5 means trivial.

| # | idea | fun | fairness | trust | cost | effort | verdict |
|---|---|---|---|---|---|---|---|
| A | **Fill burden that doesn't depend on rating** | 5 | 4 | 5 | free | 4 | **do (phase 1)** |
| B | **Teammate variety within a night** | 4 | 4 | 5 | free | 4 | **do (phase 1)** |
| C | **Honest odds** (recalibrate the shown win chance; with the rating research) | 2 | 5 | 5 | free | 3 | **do (phase 2)** |
| D | AI "why this is a fun game" line under the receipt (Premium) | 4 | 5 (never picks) | 4 | ~$0.25/mo | 3 | optional (phase 3) |
| E | Lane rivalry and duo stats as *story* (receipt-adjacent, Discord) | 4 | 5 | 4 | free | 4 | do as narrative; never in the score |
| F | Pair synergy / anti-synergy in the score | 2 | 2 (noise) | 2 | free | 3 | **not now**; data-gated (phase 4) |
| G | Comfort beyond main/secondary | 3 | 3 | 4 | free | 3 | later, from role *counts*, not win/loss |
| H | Learned win-probability model | 1 | 2 | 1 | free | 2 | no (keep only the 2-parameter recalibration in C) |
| I | LLM picks among the top-N splits | 3 | 4 (with ε-band) | 2 | ~$0.25 to $0.55/mo | 2 | no (see §6); D gets the same fun without the trust cost |
| J | Lane-matchup history in the score | 2 | 2 | 3 | free | 2 | no: about 1 to 3% of games per matchup; story only (E) |
| K | Stomp avoidance via margin variance | — | — | — | — | — | doesn't apply (see §7) |
| L | New players get a strong teammate | 2 | 3 | 3 | free | 4 | tie-break only; low priority |

### 4.1 What each data-driven idea would look like (idea 1 of the brief)

- **Pair synergy (F).** Shrinkage: `syn_ab = Σ residual_ab / (n_ab + k)`, where the residual is the outcome
  minus the *recalibrated* predicted win chance from that pair's side, minus each player's own mean residual
  (otherwise individual rating error leaks into every pair). `k = 0.25 / τ̂²`, with
  `τ̂² = var(raw pair means) − mean(0.25 / n)` taken across pairs with ≥ 10 games together. **If τ̂² ≤ 0, the
  term switches itself off.** That is the honest default and what the simulation's 500-game strong world
  produced. Plausible values when it does switch on are k ≈ 100 to 300 games, so a pair with 40 games
  together keeps only 12 to 30% of its raw record. Caps: ±3 points of win chance per pair, ±6 per team.
  Points become display units through the *measured* slope of the calibrated odds, never a constant.
  **Where it enters:** inside the gap (a hidden strength to balance), never as a bonus to maximise, and the
  shown win chance must include it. Otherwise the receipt prints "Blue 62%" on teams the bot thinks are even.
- **Anti-synergy.** The same term with a negative sign. No separate machinery. Never as a ban: "these two
  can't play together" is a duo lock in reverse, and the product has rejected manual locks like that.
- **Lane matchups (J).** In about 300 games a given same-lane, opposite-side pairing happens a handful of
  times. Fine for a story ("Rematch: mid, 4 to 1"), meaningless as a balancing input.
- **Role comfort / champion pool (G).** Win-loss residuals per player per role made things worse in the
  simulation (`comfortEst`: +0.4 to +1.1 points of true edge, +0.1 fills per game). Fills are rare because fill
  protection works, so the data is thinnest exactly where it is needed. If anything, add a third tier from
  *counts* we already store: `played this role ≥ 5 of the last 40 games` → 0.90 instead of 0.85. That is
  deterministic and explainable ("Theo has played jungle 7 times lately").
- **Rivalry (E).** Fun as narrative, not as an objective. A balancer that seeks rivalries chooses teams for a
  reason other than fairness. That is a quiet thumb on the scale, the exact thing the receipt exists to rule
  out.
- **Variety (B).** Works. See §5.

### 4.2 Learned models (idea 2 of the brief)

Time-split validation: train on the first 70% of games, test on the last 30%, with the ridge penalty chosen by
5-fold CV on contiguous blocks of the training games. 8 seeds.

| test log-loss (lower is better; coin flip 0.693) | null, 600 games | strong, 600 | strong, 1200 | 30 pairs, 1200 |
|---|---|---|---|---|
| OpenSkill odds as shown | 0.725 | 0.727 | 0.762 | 0.747 |
| OpenSkill, recalibrated (2 parameters) | 0.693 | 0.696 | 0.695 | 0.695 |
| + 20 player terms | 0.698 | 0.707 | 0.705 | 0.703 |
| + per-player fill terms | 0.699 | 0.698 | 0.699 | 0.699 |
| + 190 pair terms | 0.703 | 0.700 | 0.700 | 0.693 |
| truth (unattainable) | 0.678 | 0.654 | 0.669 | 0.656 |

Reading: on games the bot balanced, nothing learnable at this size beats a coin flip. The 20 + 20 + 190 = 230
parameters against a few hundred games overfit (the CV keeps pushing the pair penalty to its maximum), and
the remaining signal (truth 0.65 to 0.68) is real but out of reach. The **one model worth having is the
2-parameter recalibration**. It turns overconfident odds into honest ones and costs nothing in explainability:
`shown = logistic(a + b · logit(openskill))`. That is a rating-system decision; see §10.

---

## 5. Recommended scoring changes, exactly

All in `packages/core`, pure, with inputs computed by the caller (as `gamesSinceLastFill` already is).

**A. Fill burden that doesn't depend on rating** (replaces the multiplicative role multiplier in the gap).

```
effective(p, role) = mu_p * 60 - roleDrop[tier(p, role)]
roleDrop = { main: 0, secondary: 105, fill: 225 }   // = 0.07 and 0.15 of mu 25 in display points,
                                                     // i.e. today's numbers at the group's median
offRoleCost(p)     = unchanged (120 * (1 + 1/(gamesSinceLastFill + 1)))
```

- *Alternative, if the owner wants to keep proportional role skill:* keep `mu * multiplier` and add
  fill-*share* protection beside recency, for example `+ 60 * fillsInLast20(p) / 4`, capped at +120. The
  simulation only tested the additive version.
- Caps: none needed. It is a re-pricing, not a new term. The off-role count tie-break is unchanged.
- **Data check first:** query 9.1, part 2 (fill share by rating third). If real fills are already even, skip it.

**B. Teammate variety.**

```
varietyCost(split) = min(100, 25 * repeatedTeammatePairs)
repeatedTeammatePairs = unordered pairs on the same side in this split who were also teammates
                        in the previous game of the same night (any roster)
score = rawGap + Σ offRoleCost + 200 * isRepeat + varietyCost
```

- New input: `BalanceInput.recentTeammates?: readonly Duo[]` (the caller reads the night's previous game).
  It never names anyone outside the ten. Puuids only.
- The cap bounds the fairness cost: a split can win on variety by at most 100 display points, about 3 to 4
  points of win chance at the worked example's scale, and the shown win chance still prints the true
  number. The simulation's average cost was 0.0 to 0.2 points.
- It keeps the exact-repeat penalty (200) as is. Variety is the gentle version of the same rule.

**C. Honest odds** (with the rating research). `blueWinProb` stored and shown =
`logistic(a + b · logit(predictWin))`, with `(a, b)` fitted to the group's own rated, bot-rolled games
(≥ 200) and refitted at most monthly, so the receipt never moves under a game. Pure: core takes `(a, b)`
as an input.

**Not added:** synergy, comfort-from-wins and rivalry terms. §8 says when to look again.

---

## 6. LLM-assisted (idea 3 of the brief)

**Where Claude can help:** words, not choices, consistent with M16's "AI is a writer, never a source".

1. **A matchup line, Premium, labelled, after the roll** (D). Example: `AI recap · Rematch in mid: {P3} and
   {P8} again, 4 to 1 so far. {P1} and {P6} haven't been teammates since last week.` It is built from the
   same kind of fact list as the M16 recap (pair records, lane meetings, streaks), with `{Pn}` tokens and the
   same deterministic checker, and stored once per split. It is written *after* the teams are posted, so it
   adds no latency to Roll teams, and it is posted under the receipt (never inside it), like M16 lines.
   Cost: about 1.5k tokens in and 60 out. On Haiku 4.5 ($1/$5) that is about $0.002 per roll; on Sonnet 5.5
   ($2/$10) about $0.004. At about 150 rolls a month that is $0.27 to $0.54 per group, beside today's
   measured about $0.94 of the $2 cap. Use Haiku, or write it only when there is a real fact to tell (a
   rivalry with ≥ 5 meetings, a duo record ≥ 15 games). Failure means no line, as everywhere in M16.
2. **Mode of the night suggestion.** The deterministic Spin already avoids "someone picked the mode to suit
   themselves" (`fun-modes.md` §3). An LLM suggestion would undo that. At most, a Premium Sunday line
   ("Fridays have been region wars; Blue won 7 of 9") as story. Low value.
3. **Writing the receipt's "why".** No. The receipt is built only from stored numbers so it can never claim
   a reason the data does not have (`00-product.md`). A generated sentence is the one thing it must not
   contain. Generated text stays outside the receipt, labelled.

**If the owner still wants the LLM to pick among near-equal splits (I),** these are the guardrails, and why I
advise against it:

- **ε-band:** the deterministic score stays the source of truth. The model only sees splits with
  `score ≤ best + ε`, with ε at most 40 display points (about 1.5 points of win chance), and only as `{Pn}`
  tokens with lane, side and fact list. If the band has one split, there is no call. The server validates the
  reply's split id against the band and rejects anything else.
- **Latency:** the teams post waits on it. Hard timeout 2.5 s (Haiku p50 is about 1 to 2 s), then fall back to
  pick #1 with no line. That adds up to 2.5 s to every Roll teams.
- **Cost:** as in item 1, plus the call happens before every roll, including rolls with nothing interesting
  to say.
- **Failure fallbacks:** any of timeout, cap reached, kill switch, checker rejection or a band of one gives
  deterministic pick #1, and the receipt shows exactly what it shows today.
- **Why not:** (a) Reroll is promised "never random", and a model's pick is not reproducible: the same ten
  could get different teams on a re-roll, which breaks `lastSplit` logic and the "same input, same output"
  property every decision row assumes. (b) The pick chip and `This was the fairest split these ten allow.`
  stop being true when the model chooses #2. (c) In the simulation the band is usually one split: within 25
  display points only 27% of rolls had any alternative, and within 100 points 73% did (scale caveat in §9).
  So the LLM would rarely have a choice to make. (d) A deterministic tie-break inside the same band (variety,
  fill share) gives the same "fun among equals" with a reason the receipt can print. Query 9.2 measures the
  real band from the stored top-3 scores.

---

## 7. Fun-centric objectives: which ones the group feels (idea 4 of the brief)

The group's own history shows what it feels. Each of these was built because someone complained:
**being filled** (M7.5 fill protection), **the same teams again** (the repeat penalty), **"the bot is
rigged"** (the receipt, calibration). Synergy shows up as story (the "cursed duo" award), not as a
complaint about balance.

- **"Nobody plays off-role twice in a row"** is felt, and it exists. The new finding is *who* absorbs fills
  over a month (A). That is the change most likely to be noticed by the quietest players.
- **Spreading the strongest players** is already implied by minimising the gap. With ten players the
  strongest two land on opposite sides whenever that helps the gap. A rule on top would only cost fairness.
- **Avoiding stomps via margin variance** doesn't apply at the split level. In a team-sum model the variance
  of the margin is `Σ all ten σ² + noise`, which is the same for all 126 splits. The only lever is the
  expected margin, which the gap already minimises. Stomps are mostly game noise: 17% even with perfect
  teams, against today's 18.5%.
- **Balancing comfort, not just skill,** is the same thing as fill pricing (A, G).
- **Giving newer players a strong teammate** feels kind, but it is invisible unless the receipt says so, and
  the band rarely has room. At most a final tie-break (`settling` player with the highest-rated player when
  two splits tie exactly).
- **Variety** is felt more by a group of 20 than by a big queue, because the same faces return nightly. Do it (B).

---

## 8. What competitors and research do (idea 5 of the brief)

- **InHouseQueue** (the bot we decided not to adopt, 2026-09-08): MMR-based balancing, role queue with fill,
  duo support, captain queue, MVP votes. Its docs show no synergy or fun objective; teams balance on MMR
  and roles. **NeatQueue** offers team-selection modes "Captains, Random, Balanced, Unfair" and no learned
  synergy. Neither explains its split. Kustom's receipt is already ahead of both.
- **TrueSkill 2** (Microsoft, Halo 5) adds squad membership, experience and quit tendency as features and
  goes from 52% to 68% match-prediction accuracy. That gain comes from millions of matches between
  strangers, where "came as a party" is a strong signal. Our analogue is duo locks, already a filter. **Halo:
  Reach "Friends FTW"**: players win more with friends than with strangers, a real party effect at scale.
  Inside one friend group everyone is a friend, so that variable doesn't vary.
- **MOBA synergy research** (hero-pair embeddings, factorisation machines, neural draft models) models
  *champion* synergy on hundreds of thousands to millions of games. It doesn't transfer to 190 *player*
  pairs with a few dozen games each.
- **EOMM** (Chen et al. 2017, EA): matchmaking optimised for engagement, not fairness. It drew lasting player
  backlash as "rigged by design". A churn study on about 6M matches (*Everybody's Marble*) found players churn
  after mismatches against stronger opponents, and that being matched with weaker opponents retained them
  better than even games. A *Management Science* paper reports 4 to 6% engagement gains from
  history-aware matching. **For Kustom this is a line not to cross:** quietly giving a player on a losing
  streak an easier game is exactly "a fun factor quietly handing one side the win". In a group where every
  split carries a public receipt, the first time someone noticed would cost more trust than any retention
  gain is worth.

---

## 9. What needs real data, and the exact queries

Run these in the Supabase SQL editor, on your own data, by your own hand. They return anonymised player
numbers, never puuids or names. Save query 9.1 as CSV and run
`node analyze-export.mjs export.csv` from the scratchpad sim folder (§11). It prints the four deciding
numbers: odds calibration slope, fill share by rating third, the pair-synergy screen τ, and teammate repeats
per night.

**9.1 Per-player-per-game export (rated games, one group).**

```sql
with g as (
  select gm.id, gm.started_at, gm.winning_side, gm.mode, gm.lobby_id
  from public.games gm
  join public.groups gr on gr.id = gm.group_id
  where gr.slug = 'customs' and gm.rated
), ids as (
  select player_id, dense_rank() over (order by player_id) as p
  from (select distinct player_id from public.game_players where game_id in (select id from g)) x
)
select g.id as game, g.started_at, g.winning_side, g.mode,
       ids.p, gp.side, gp.role, gp.champion_id, gp.mu_before, gp.sigma_before,
       gp.counts_for_role_inference,
       s.blue_win_prob, s.gap, s.off_role_count, s.rank as pick_rank
from g
join public.game_players gp on gp.game_id = g.id
join ids using (player_id)
left join public.splits s on s.lobby_id = g.lobby_id and s.is_chosen
order by g.started_at, g.id, gp.side;
```

Caveats: a game whose teams changed in the lobby after the roll still joins its chosen split. The analyser
only uses `blue_win_prob` as "the bot's odds" and recomputes odds from `mu_before` / `sigma_before` when
there is no split. `counts_for_role_inference = false` on a bot split means "filled off both roles", which
undercounts fills onto the secondary role.

**9.2 How wide is the band of near-equal splits** (from the stored top 3).

```sql
select s1.lobby_id, s1.created_at,
       s2.score - s1.score as score_gap_2, s3.score - s1.score as score_gap_3,
       s1.gap as gap_1, s2.gap as gap_2,
       s1.off_role_count as off_1, s2.off_role_count as off_2,
       round(s1.blue_win_prob::numeric, 3) as p1, round(s2.blue_win_prob::numeric, 3) as p2
from public.splits s1
join public.lobbies l on l.id = s1.lobby_id
join public.groups gr on gr.id = l.group_id and gr.slug = 'customs'
left join public.splits s2 on s2.lobby_id = s1.lobby_id and s2.roster_key = s1.roster_key
                           and s2.created_at = s1.created_at and s2.rank = 2
left join public.splits s3 on s3.lobby_id = s1.lobby_id and s3.roster_key = s1.roster_key
                           and s3.created_at = s1.created_at and s3.rank = 3
where s1.rank = 1
order by s1.created_at;
```

(If a set of three was not inserted with one `created_at`, match on `date_trunc('second', created_at)`.)
The share of rows with `score_gap_2 < 40` is how often an ε-band tie-break or an LLM pick would even have a
choice.

**9.3 Rating spread** (does the inflation in §1 item 6 happen for real?).

```sql
select count(*) as players, round(avg(r.mu)::numeric, 2) as mean_mu,
       round(stddev_pop(r.mu)::numeric, 2) as sd_mu, round(min(r.mu)::numeric, 2) as min_mu,
       round(max(r.mu)::numeric, 2) as max_mu, round(avg(r.sigma)::numeric, 2) as mean_sigma
from public.ratings r join public.groups gr on gr.id = r.group_id
where gr.slug = 'customs' and r.games >= 10;
```

An SD of `mu` well above 5 (300 display points), or the calibration line showing the favoured side winning
far less often than expected, means the receipt's odds are overconfident and C moves up.

**What would change the conclusions:**

- 9.1 τ > 2 points with ≥ 1,000 games → reopen F with the exact term in §4.1 (still capped, still inside the gap).
- 9.1 fill shares even across thirds → drop A.
- 9.1 recalibration slope near 1.0 → C is cosmetic. Slope well below 1 → C first.
- 9.2 band usually ≥ 3 splits within 40 → a deterministic in-band tie-break (variety, fill share) has room,
  and B could move from score term to tie-break.

---

## 10. Dependencies on the rating-systems research (`redesign/research/rating-systems.md`)

- **The biggest fairness lever is theirs.** True skill with today's role rules cut the true edge from about
  9 to 3 to 7 points. Synergy, oracle or estimated, did not move it beyond noise.
- **Rating inflation under balanced-only play** (my `osbal.mjs`): OpenSkill 5.0.1 (Plackett-Luce default),
  everyone seeded at (20, 12) and *every* game balanced, ends with an SD of `mu` around 14 against a true 3
  (slope about 5) after 600 to 1,500 games. The same engine with random teams lands near the true scale
  (slope 0.8 to 1.2). Balanced games can fix the order of players but not the scale, and sigma shrinks, so the
  stretch freezes. A stretched scale makes `predictWin` overconfident and makes every *additive* constant
  (120 fill, 200 repeat, any new term) relatively smaller.
- `predictWin`'s denominator is `√(2β² + Σσ²)`: openskill's `n` is the number of *teams*, not players.
  Worth their check against the real calibration line.
- C (a recalibrated `blueWinProb`) is a rating-research decision that the receipt depends on. Any synergy term
  (F) needs a calibrated points-to-display slope, so F waits on C.
- A (the role price) changes what `mu` learns: off-role losses move ratings. Both changes should be tested
  together in one rebuild.

---

## 11. Phased plan

- **Phase 0, measure (no code; the user, 15 minutes).** Run 9.1 to 9.3 and `analyze-export.mjs`. Decide A
  and C on real numbers.
- **Phase 1, deterministic terms (core, then web copy).** A and B in `packages/core`, behind
  `config.balance`, with tests (fill share by rating third evens out on a fixture roster; variety term capped
  at 100; no change when `recentTeammates` is absent). Store score parts on the split
  (`splits.score_parts`, schema change, the user's call) so `whyLower` gains `variety` and `fill-share`
  reasons and keeps `role-costs` for what is left.
- **Phase 2, honest odds (with the rating research).** C: refitted `(a, b)`, receipt and calibration line
  unchanged in shape. The numbers just become true.
- **Phase 3, optional Premium matchup line (D).** One more M16 line kind (`matchup`), written after the teams
  post, checked, labelled `AI recap`, stored once per split, ~$0.27/month on Haiku. Never inside the
  receipt, never picks.
- **Phase 4, data-gated synergy (F).** Only if 9.1 shows τ > 2 points after ≥ 1,000 rated games. The term
  in §4.1, inside the gap, included in the shown odds, printed on `How the bot decided`. Re-run the screen
  monthly; it switches itself off if τ goes back to 0.

### How each change appears on the receipt (trust holds)

The headline, chips and the "fairest split" sentence don't change. Only the reason line and `How the bot
decided` learn new words, and only from stored score parts:

| change | reason line (next best) | `How the bot decided` | proposed copy (product to own) |
|---|---|---|---|
| A fill burden | `Next best: swap Theo and Omar. That's Blue 52%, but it fills Omar again.` | `Who fills: whoever has filled least lately, whatever their rating.` | [NEW COPY] |
| B variety | `Next best: … That's Blue 53%, with 4 of last game's teammates together again.` | `Mixes teammates: 1 pair from the last game together (pick #2 had 4).` | [NEW COPY] |
| C honest odds | — | Calibration line unchanged; one sentence: `Odds are tuned to how this group's games actually went.` | [NEW COPY] |
| D AI line | — | — (it sits under the receipt, labelled `AI recap`) | M16 copy rules |
| F synergy (later) | `… but Omar and Karim win more together (+3 from 140 games), so the bot balanced for it.` | A row per counted pair with its games-together count | [NEW COPY] |

A term never appears without its number, its sample size and its cap. A pair with fewer games than the
term's shrinkage needs is never named.

---

## 12. Open questions

1. **Fill burden:** is it fair that weaker players fill more because a fill costs them less, or should
   every regular share the fills? (A is a values call, not a maths one.)
2. **Schema:** may `splits` gain `score_parts jsonb`, so the receipt can name variety and fill-share reasons?
   (User decision. Without it, both land in the "scored a hair worse overall" bucket.)
3. **Variety scope:** only the previous game of the same night (recommended), or a decaying window across
   nights ("you've been with Omar 6 of the last 10")?
4. **Duo locks and synergy:** if F is ever turned on, should a locked duo's together-record count? It can't
   be separated from their ratings.
5. **Premium matchup line:** worth a fifth M16 line kind, or does the recap line already carry enough story?
6. **Odds recalibration cadence:** monthly refit with a minimum of 200 games, or only on a Reset ratings?

---

## Simulation files (scratchpad, not the repo)

`/private/tmp/claude-501/-Users-suyaser-lol/33c2c4d5-3271-4fd2-a336-2cee3f00cc73/scratchpad/team-formation/`:
`sim.mjs` (world, ported balancer, variants, estimators), `experiment.mjs` → `exp1.txt` (§3 table),
`variety.mjs`, `fills.mjs`, `decomp.mjs`, `recovery.mjs` → `recovery.txt`, `learned.mjs` → `learned.txt`
(§4.2), `band.mjs`, `osbal.mjs` / `osscale.mjs` / `calib.mjs` (the rating-scale findings),
`analyze-export.mjs` (reads query 9.1's CSV), `fake-export.mjs` (synthetic CSV to test it). It uses the
repo's own `openskill@5.0.1` through a symlink. The scratchpad is temporary: copy the folder if it should
be kept.

**Caveats.** The world is synthetic: skill is static, there are no tilt or champion effects, and the MVP
nudge is left out. The planted synergy sizes are guesses (4.5 and 9 points), deliberately generous. The
display-point scale in the simulation is stretched by the rating inflation above, so §6's band sizes in
display points are a lower bound for a real group. Query 9.2 answers that directly.

Sources: [InHouseQueue (top.gg)](https://top.gg/bot/1001168331996409856),
[InHouseQueue docs](https://docs.inhousequeue.xyz/), [NeatQueue (top.gg)](https://top.gg/bot/857633321064595466),
[TrueSkill 2 (Microsoft Research)](https://www.microsoft.com/en-us/research/publication/trueskill-2-improved-bayesian-skill-rating-system/),
[Friends FTW! Halo: Reach](https://arxiv.org/pdf/1203.2268),
[EOMM: An Engagement Optimized Matchmaking Framework](https://arxiv.org/pdf/1702.06820),
[Match experiences affect interest (churn study)](https://visualize.jove.com/38318006),
[Matchmaking Strategies for Maximizing Player Engagement (Management Science)](https://pubsonline.informs.org/doi/fpi/10.1287/mnsc.2023.02957),
[Digital Trends on the SBMM churn study](https://www.digitaltrends.com/gaming/gaming-study-says-skill-based-matchmaking-is-fair-but-it-also-quietly-drives-players-away/),
[Modeling avatar synergy and opposition in MOBA](https://arxiv.org/pdf/1803.10402),
[A Recommender System for Hero Line-Ups in MOBA Games (AAAI)](https://ojs.aaai.org/index.php/AIIDE/article/view/12938).
Prices: `apps/web/lib/ai/meter.ts` (read 2026-10-04: Haiku 4.5 $1/$5, Sonnet 5.5 $2/$10 per million tokens).
