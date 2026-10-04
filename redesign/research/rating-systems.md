# Rating systems for Kustom: research and backtest

Research only. No product code changed. Written 2026-10-04 for the owner and the lead.
The scratch harness lives outside the repo, in
`/private/tmp/claude-501/-Users-suyaser-lol/33c2c4d5-3271-4fd2-a336-2cee3f00cc73/scratchpad/rating-research/`.
That folder belongs to this session, so the formulas below are written out in full and do not depend on it.

---

## 1. Executive summary (plain English)

**The library is not why the board feels unfair. How we use it is.** We ran about 20 rating systems, each over the
same 30 simulated seasons of a group like ours: 26 people, about 490 bot-balanced 5v5 games a season, players
joining and leaving, role effects, and good and bad nights. One result held in every season. **From wins and losses
alone, every sensible system ranks the group about equally well and balances teams about equally well.** On
ranking, every candidate was within about 0.03 of OpenSkill (scale −1 to 1). On balance quality, every candidate
was within about one percentage point of win chance. No algorithm squeezes much more out of "who won". Ten people
share one result, so each game carries little information about any one player.

**Where systems differ a lot is how the number behaves.** Today's setup (OpenSkill with default settings,
everyone starting at sigma 12, and an MVP/ACE multiplier) has four habits that friends feel as unfairness:

1. **Your change depends on other people's uncertainty.** Two settled teammates on the same winning team often
   get very different numbers. In the backtest the bigger one averaged **2.06×** the smaller.
2. **A group that started together stays "new" for a long time.** When all ten start at sigma 12, sigma is still
   10.2 after 20 games and 8.9 after 36. So everyone keeps swinging about 80 to 110 points a game for weeks. That
   is the "lost 120, gained 50" complaint.
3. **The odds run overconfident and the scale stretches.** On teams that nobody balanced, today's win chances
   score worse than a coin flip: log loss 0.836 against a coin's 0.693. Part of the reason is that OpenSkill's
   `predictWin` counts luck per *team*, not per player. Ratings spread far wider than true skill
   does, and they keep spreading.
4. **MVP/ACE creates points from nothing.** MVP ×1.25 and ACE ×0.8 never cancel out. The group average drifted
   up about **440 points a season**, so a newcomer's 1200 sits further below the group average every month.

**Recommendation: (c), a custom "Kustom rating"**. It is Elo-shaped, so every change is one line of arithmetic:

> **points = K × (result − expected) × share**

- **K** depends only on how many rated games *you* have played. It starts at 96 for your first game and falls
  evenly to 24 by your 11th. After that it stays 24 for ever.
- **expected** comes from the two teams' total Ratings, and it is the same percentage the bot shows.
- **share** generalises MVP/ACE. Inside each team, players are ranked by the existing performance score and get
  1.2, 1.1, 1.0, 0.9 or 0.8 of the team's result. The best winner gets 1.2 (the MVP). The best loser loses only
  0.8 (the ACE).

In the backtest it matched or slightly beat today's ranking accuracy. The 60-season average was about +0.02,
which is within noise. It balanced teams slightly better, and its odds were far better calibrated: log loss
0.604, where a perfect-knowledge reference scores 0.554 and today scores 0.836. A settled player's change is
typically **±12** and never more than **29** in one game. Teammates' numbers differ only by their visible share.
Ratings do not inflate. Refolding history under it would keep the board order almost the same: rank correlation
0.97, about 1 place moved on average, and 2.6 of the top 3 unchanged. **The numbers would be smaller and closer
together.**

**Per your ruling there is no inactivity decay anywhere.** A Rating changes only when its owner plays a rated
game.

**There is one catch, and it belongs to bot-balanced teams, not to any library.** When every split is balanced
on the ratings, the *overall size* of the rating scale stops showing up in results. Stretch everyone's Rating
away from the average by the same factor and the balanced split is still balanced in truth, so it still lands
50/50. Nothing pulls the scale back. Under today's setup that is why the odds run overconfident: in the
team-formation report's simulation, a side shown at 73% won 51% of the time. Kustom drifts too, only more
slowly: its scale stays honest with random teams, sits about 1.9× too wide after 600 perfectly balanced games
and about 3× after 1,500.

Whether the bot shows a fair win chance and whether the board ranks people correctly are separate questions. In
our realistic simulation Kustom still ranked people best over a full simulated year. So the recommendation adds
one guard. The receipt's calibration line is the alarm. When it shows the favourite winning less often than
promised, both the shown odds and the expected score are recalibrated with one shared two-number fit (section
6.5). That keeps "the odds shown are the odds used" true.

One thing must be checked against real games before the share part ships. Does our performance score actually say
something about skill? If it does, shares help. If it is pure noise, shares cost nothing measurable but still
print different numbers for teammates. Section 9 has the one-time export and the replay command.

---

## 2. What was tested, and how

**Data.**

- The repo's fixtures hold **one** real 10-player custom (`packages/lcu/fixtures/16.17/match-detail.json`). The
  match-history fixtures hold one participant per game, so they cannot be backtested.
- The local Supabase stack holds synthetic test seeds only, so it was not used.
- The hosted database was not touched.
- **Everything below is synthetic.** Section 9 says which conclusions could change on real data and gives the
  exact export to check them.

**The simulated group.** Defaults are in `lib.ts`. "Probit" means the units of the normal-curve model that
decides who wins.

| Property | Value |
| --- | --- |
| Players | 26 per season: 16 founders and 10 who join on random nights; 5 leave |
| Attendance | each player shows up on 35–95% of nights |
| Schedule | 120 nights, 3–6 games a night, sitters rotate; about 490 games a season |
| True skill | normal, sd 0.4 (probit) per player; 30% of players improve over the season |
| Outcome | blue wins if Σ(skill + form + seat luck) − the same for red + game luck > 0 (per-seat luck sd 0.5, per-game luck sd 1.0) |
| Pivotal player | swapping the best player for the worst moves a 50% game to about 80% |
| Nights and roles | form sd 0.12 per night; main and second role are free, a fill seat costs 0.1–0.45 |
| Performance score | skill + seat luck + stat noise (sd 1.0); MVP/ACE and shares read it |
| Stomp signal | the game's real margin plus noise |
| Teams | split by the system under test (closed loop, as in real life), over all 126 splits, minimising distance from 50% plus an off-role price |

**Seeds.** Tuning used seeds 101–124. The headline numbers use seeds **1–30**. A validation rerun used seeds
201–230. **Every system sees the same nights, the same ten people per game and the same luck draws.**

**Metrics.**

| Metric | What it measures |
| --- | --- |
| **LL(rand), Brier(rand)** | Held-out accuracy. A second copy of each season uses *random* teams, and each game is predicted before it is folded in. Bot-balanced games are useless for this because every game sits near 50%. Coin = 0.6931; a predictor that knows true skill = 0.5544. |
| **Imbalance** | Balance quality, closed loop: the mean of \|true win chance − 50%\| over the games the system balanced itself. Random teams = 0.216; teams balanced on true skill = 0.069. Lower is better. |
| **rho** | Ranking accuracy: the weekly rank correlation between the board (players with 10 or more games) and true skill. |
| **new@10** | Cold start: how far a newcomer's board percentile is from their true percentile at their 10th game. |
| **Swings** | The absolute change per game in displayed points, for settled players (10 or more games before) and new players. |
| **Spread** | Among settled teammates on one team with no award, the bigger change divided by the smaller. 1.0 means the same result gives the same number. |
| **Sign violations** | Wins that lowered a Rating or losses that raised one, per 1000. |
| **Absent drift** | Points a player's Rating moved on nights they did not play. |
| **Inflation** | How far the group mean drifted from 1200. |

---

## 3. Results

### 3a. Accuracy (seeds 1–30, ~491 games a season)

Δ columns are paired differences against the current system, ± one standard error. Lower imbalance is better.

| System | LL (rand) | Brier (rand) | Imbalance | Δ imbalance | rho | Δ rho | new@10 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **OpenSkill PL, today** (defaults, σ0 12, MVP ×1.25 / ACE ×0.8) | 0.836 | 0.241 | 0.134 | — | 0.736 | — | 0.254 |
| OpenSkill PL, no MVP/ACE | 0.792 | 0.239 | 0.135 | +0.000±0.002 | 0.748 | +0.012±0.014 | 0.254 |
| OpenSkill PL, tau 0.2 | 0.824 | 0.240 | 0.132 | −0.002±0.003 | 0.741 | +0.004±0.010 | 0.251 |
| OpenSkill PL + stomp factor | 0.852 | 0.241 | 0.126 | −0.009±0.003 | 0.780 | +0.044±0.014 | 0.237 |
| TrueSkill (σ0 8.33, tau 0.2) | 0.638 | 0.218 | 0.138 | +0.004±0.002 | 0.721 | −0.015±0.019 | 0.245 |
| TrueSkill-2-style (per-player stat observation) | **0.581** | **0.199** | **0.106** | **−0.029±0.002** | **0.899** | **+0.162±0.013** | **0.169** |
| Glicko-2, team composite-opponent | 0.608 | 0.210 | 0.136 | +0.002±0.002 | 0.718 | −0.018±0.014 | 0.255 |
| Elo, team, flat K 32 | 0.666 | 0.226 | 0.133 | −0.001±0.003 | 0.746 | +0.009±0.015 | 0.243 |
| Bradley-Terry refit over all history | 0.606 | 0.210 | 0.133 | −0.001±0.003 | 0.738 | +0.002±0.015 | 0.243 |
| Whole-History Rating (drift per own game) | 0.603 | 0.208 | 0.133 | −0.001±0.002 | 0.745 | +0.008±0.018 | 0.247 |
| Per-role OpenSkill (5 ratings each) | 0.736 | 0.237 | 0.146 | +0.012±0.003 | 0.714 | −0.023±0.016 | 0.237 |
| Kustom, no shares | 0.607 | 0.210 | 0.136 | +0.002±0.003 | 0.725 | −0.011±0.017 | 0.240 |
| Kustom, MVP/ACE only (zero-sum) | 0.605 | 0.209 | 0.133 | −0.002±0.003 | 0.744 | +0.007±0.014 | 0.256 |
| **Kustom (proposed, rank shares)** | **0.604** | **0.208** | **0.127** | **−0.008±0.002** | **0.775** | **+0.039±0.014** | **0.235** |

### 3b. How it feels (same runs)

The "raw" columns are display points as a friend would see them. The two "skill-adjusted" columns rescale each
system so one point means the same gap in true skill. The current system's raw points are inflated by its
stretched scale, which is why its skill-adjusted settled median matches Kustom's.

| System | Settled: median / p95 / max (raw) | New: median / p95 (raw) | Skill-adjusted settled p95 | Skill-adjusted new p95 | Spread | Sign violations ‰ | Absent drift | Board sd at season end (raw) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **OpenSkill PL, today** | 40 / 99 / 202 | 114 / 200 | 29 | 59 | **2.06** | 0 | 0 | 948 |
| OpenSkill PL, no MVP/ACE | 40 / 98 / 171 | 113 / 197 | 34 | 68 | 2.05 | 0 | 0 | 821 |
| TrueSkill (tau 0.2) | 17 / 61 / 153 | 103 / 166 | 31 | 85 | 1.79 | 0 | 0 | 564 |
| TrueSkill-2-style | 8 / 24 / 109 | 48 / 236 | 40 | 396 | **7.42** | **239** | 0 | 156 |
| Glicko-2 team | 10 / 17 / 26 | 33 / 53 | 25 | 79 | 1.21 | 0 | 0 | 190 |
| Elo, flat K | 16 / 20 / 35 | 16 / 20 | 21 | 21 | 1.03 | 0 | 0 | 268 |
| Bradley-Terry refit | 4 / 9 / 13 | 11 / 12 | 32 | 42 | 2.39 | 0.01 | **4.2 / night** | 80 |
| WHR | 9 / 17 / 33 | 23 / 27 | 30 | 47 | 1.97 | 0.22 | **4.6 / night** | 164 |
| Per-role OpenSkill | 39 / 103 / **1982** | 109 / 224 | 34 | 75 | 2.54 | 5.6 | 0 | 861 |
| **Kustom (proposed)** | **12 / 15 / 21** | 31 / 53 | **15** | **53** | **1.35** | **0** | **0** | 268 |

**Inflation over one season (raw).** Today's group mean rose about **+440** (seeds 201–230: +444; tuning seeds:
+432 to +459). Without MVP/ACE it moved about −10. Kustom and its zero-sum variants stayed within ±15.

### 3c. Robustness: Kustom with rank shares against today, under other worlds

Seeds 201–230 (validation). Here the share is applied team-pot-normalised, which is identical to the proposed
formula whenever all ten players are settled.

| World | Δ rho vs today | Δ imbalance vs today | Kustom LL (rand) | Today's LL (rand) |
| --- | --- | --- | --- | --- |
| Base | −0.004±0.013 | −0.003±0.002 | 0.619 | 0.867 |
| Narrow skill spread (sd 0.25) | +0.023±0.023 | −0.008±0.003 | 0.669 | 0.905 |
| Wide skill spread (sd 0.55) | +0.028±0.010 | −0.002±0.003 | 0.563 | 0.790 |
| Stats are noisier (stat noise 2.0) | +0.012±0.011 | −0.002±0.003 | 0.620 | 0.847 |
| **Stats say nothing about skill** | −0.004±0.011 | −0.006±0.003 | 0.623 | 0.825 |
| More churn (16 join, 10 leave), seeds 1–30, normalised-share version | +0.039±0.017 | −0.009±0.003 | 0.619 | 0.831 |

The same check for the TrueSkill-2-style system: **+0.162** rho when stats track skill, +0.050 with noisier
stats, and **−0.303** when stats carry no skill (imbalance +0.056, close to random teams). **It is high reward and
high risk, and it breaks "a win is a win" for one player in four.**

Stat padding was tested with one player whose performance score reads 1 sd too high every game without winning
more. Places gained on the end-of-season board:

| System | Places gained by padding |
| --- | --- |
| Today | 2.8 |
| Kustom, MVP/ACE only | 2.0 |
| **Kustom, rank shares** | **2.0** |
| Kustom, continuous performance share (α 0.25) | 4.1 |
| TrueSkill-2-style | 9.1 |

Rank shares cap what padding buys: being 1st instead of 2nd on your team is worth 0.1 of one game's result.

### 3d. Weekly board options (seeds 1–30, same logs)

| Weekly board | rho with true over-performance that week | rho with true skill | A settling player is #1 | Settling players' share of the board |
| --- | --- | --- | --- | --- |
| Net points, today's rating (what ships now) | 0.815 | 0.230 | **22.1%** | 10.6% |
| **Net points, Kustom** | 0.821 | 0.227 | **16.9%** | 10.6% |
| Equal-K points (everyone earns at K 24 that week) | **0.831** | 0.187 | 9.2% | 10.6% |
| Kustom points per game | 0.793 | 0.220 | 20.3% | 10.6% |
| Short-window rating (a fresh 20/12 every week, the retired M7.2 shape) | 0.816 | 0.261 | 9.2% | 10.6% |
| Reset-from-all-time weekly (K 48, rank by change) | 0.831 | 0.187 | 9.2% | 10.6% |

"True over-performance" is Σ(result − true win chance) over the week: the luck and form a weekly board is meant to
celebrate. The reset-from-all-time row ranks exactly like the equal-K row, because it is the same quantity at
twice the size.

### 3e. Bot-balanced teams and the rating scale (cross-check with `redesign/research/team-formation.md`)

The team-formation research found that with balanced teams and a shared seed, OpenSkill's ratings spread 4–5×
wider than true skill and the shown odds go overconfident. This was checked two ways:

- I reran their `osbal.mjs` unchanged (one seed).
- I ran the same world in `kbal.mjs`, which imports their `sim.mjs`, with Kustom added: 20 seeds, 20 players,
  true skill 25 + 3·N(0,1), win chance logistic(gap / 2√2β), balancing on the sum of ratings.

Scale is display points per point of true skill. "Calibrated" for Kustom is 400 / 2√2β = 33.9. The last
column groups games by the win chance shown for the favourite and gives how often the favourite actually won.

| System, teams | Games | Rank rho | Display sd | Scale | vs own random-team scale | Log loss | Favourite shown at → actually won |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OpenSkill, random teams | 600 | — | 291 | 78.8 | 1.0× | 0.911 | 55–60%: 56%, 60–70%: 55%, 70%+: 67% |
| **OpenSkill, balanced** | 600 | 0.901 | 867 | 253.6 | **3.2×** | 0.695 | 55–60%: **48%**, 60–70%: **48%** |
| OpenSkill, balanced | 1,500 | 0.940 | 890 | 271.9 | 3.5× | 0.696 | 60–70%: 51% (587 games), 70%+: 58% (91) |
| Kustom, random teams | 600 | — | 131 | 35.0 | **1.03× of calibrated** | 0.649 | 50–55%: 54%, 55–60%: 55%, 60–70%: 60%, 70%+: 72% |
| **Kustom, balanced** | 600 | 0.876 | 230 | 65.4 | **1.9× of calibrated** | 0.693 | 99% of games shown at 50–55%; won 50% |
| Kustom, balanced | 1,500 | 0.919 | 342 | 101.7 | 3.0× | 0.693 | as above |
| Kustom, balanced, K falls to 8 after game 10 | 1,500 | 0.919 | 158 | 47.5 | 1.4× | 0.693 | as above |
| Kustom, balanced | 3,000 | 0.927 | 473 | 143.1 | 4.2× | 0.693 | as above |
| Kustom, balanced, K falls to 8 after game 10 | 3,000 | 0.947 | 192 | 58.6 | 1.7× | 0.693 | as above |
| OpenSkill, balanced | 3,000 | 0.963 | 913 | 284.4 | — | 0.697 | — |

**What this shows.**

1. **The team-formation finding reproduces.** Their single-seed `osbal.mjs` trace: random teams settle near
   scale 1 (slope 1.25 at game 600, 0.76 at 1,500). Balanced teams climb to 2.88 → 4.20 → 4.69 → 4.96. Under
   balancing, a 60–70% favourite wins about half the time.
2. **The cause is structural.** Write every Rating as `mean + c × true skill`. A split with equal rated totals
   then has equal true totals whatever `c` is, so balanced games carry no information about `c`. Only the
   leftover imbalance does: fills, newcomers, rerolls, imperfect balance. Any update that moves a Rating by a
   fixed step on a near coin flip lets `c` random-walk.
   - OpenSkill's steps shrink with sigma, so its spread stops growing, but only after its early high-sigma games
     have already stretched it about 3×.
   - Kustom's constant K keeps walking, at about K/2 per game.
3. **`predictWin`'s denominator is `n·β² + σ_A² + σ_B²`, where n is the number of *teams* (2), not players (10)**
   (`dist/predict-win.js` in 5.0.1, confirmed). It treats a whole team's luck as one player's. Together with the
   probit predict / logistic update mismatch (section 4), this makes today's shown odds sharper than the update
   itself believes.
4. **Ranking and scale are separate problems.**
   - In this perfectly balanced, nobody-improves world, OpenSkill's shrinking step ranks best in the long run
     (0.963 at game 3,000), and a K that keeps falling helps Kustom (0.947 against 0.927 for flat K).
   - In the realistic world of section 3 (fills, nights, newcomers, people improving), the residual imbalance
     carries the scale and **flat K ranks best even over a year**. Seeds 1–20, set `kfloor`:

| World | Today: rho / settled raw p95 / board sd | Kustom flat K 24: Δrho / p95 / sd | K 24 → floor 12: Δrho / p95 / sd | K 24 → floor 8: Δrho / p95 / sd |
| --- | --- | --- | --- | --- |
| One season (≈490 games) | 0.729 / 99 / 954 | **+0.053±0.019** / 15 / 270 | +0.033±0.019 / 9 / 179 | +0.010±0.020 / 9 / 158 |
| One year (≈1,520 games) | 0.802 / 78 / 1036 | **+0.055±0.014** / 15 / 520 | +0.042±0.011 / 8 / 297 | +0.032±0.009 / 7 / 231 |
| One year, nobody improves | 0.857 / 78 / 1033 | +0.009±0.006 / 15 / 489 | +0.013±0.009 / 8 / 283 | +0.016±0.010 / 7 / 224 |

   Kustom's held-out log loss on random teams stays 0.57–0.62 in every row, against 0.83–0.92 for today's
   system. Flat K does widen the board over a year (sd 270 → 520), which is the slow walk in point 2.
5. **About the team-formation report's other result:** "a 2-parameter recalibration is the only learned model
   worth having." That agrees with section 3a here. Every win/loss system hits the same ceiling on balanced
   games, so a richer model cannot beat a coin flip there. A two-number correction of the scale can still fix
   the odds.

---

## 4. The candidates, judged

| Candidate | Accuracy | Stable, explainable delta | Feels fair (monotone, capped, sign-safe) | Gaming | Cold start | Fits balancing | Effort in pure TS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OpenSkill PL, today | tied on rank and balance; overconfident odds | no: depends on all ten sigmas (spread 2.06) | monotone, sign-safe; uncapped (max 202 settled, 309 new) | MVP is mildly paddable (2.8 places) | σ0 12; a fresh group stays "new" for 30+ games | yes (balances on mu), but the scale drifts with sigma | in place |
| OpenSkill BT / TM variants | BT is bit-identical to PL for two teams; TM-full overreacts (log loss 0.80, whiplash 24%) | as PL | as PL | as PL | as PL | as PL | config only |
| OpenSkill, tuned (option a) | best tune: β 12–16, σ0 4, τ 0.3 gives log loss 0.61–0.64 and rho ±0.01 | spread falls to 1.1–1.2 | still uncapped | as today | σ0 4 makes newcomers slow | yes | config plus rebuild |
| TrueSkill | rho −0.015; better calibrated than PL | no; sigma collapses (settled p95/median 3.6×) | uncapped | — | weak | yes | ~80 lines |
| TrueSkill-2-style stats | **best if stats track skill**, worst if not | no (spread 7.4) | **no: 24% of results go the wrong way** | **worst** (9 places) | fast | yes | ~150 lines plus a fit |
| Glicko-2, team composite | rho −0.018; good calibration | per-player RD, so medium | capped by RD | — | RD 150 | team average, OK | ~120 lines |
| Elo, team, flat K | tied | **yes: K × (S − E), same for everyone** | capped at K, zero-sum | — | **bad**: newcomers crawl | yes | ~40 lines |
| Bradley-Terry refit, all history | tied | **no: your number moves when others play** | sign-safe, but moves while you sit out (breaks your ruling) | — | prior | yes | ~80 lines (Newton) |
| Whole-History Rating | tied; best calibrated of the win/loss-only systems | **no**: as BT | breaks your ruling; 0.2‰ sign violations | — | prior | yes | ~150 lines |
| Per-role ratings | **worse** (rho −0.023, imbalance +0.012) | no: your "number" jumps when your main changes (max 1982) | — | role-shopping | 5× colder | needs roles before the split | ~150 lines |
| Our MVP/ACE ×1.25 / ×0.8 | adds a little skill signal | named, so legible | sign-safe; **inflationary (+440 a season)** | 2.8 places | — | — | in place |
| Margin-of-victory / stomp factor | +0.04 rho on a synthetic margin | "you won big" is arguable | sign-safe | surrender timing | — | — | small |
| Inactivity decay | **ruled out (the owner, 2026-10-04)** | — | — | — | — | — | — |
| **Kustom (proposed)** | tied or slightly better; far better calibrated | **yes: one line, K from your own games, share from your own rank** | capped (29 settled), zero-sum when settled, sign-safe | 2.0 places | K 96 → 24 over 10 games | yes: E is the bot's odds | ~120 lines plus tests |

**Notes.**

- **The PL/BT/TM choice.** For two teams, OpenSkill's Plackett-Luce and Bradley-Terry-full give identical numbers
  (confirmed in the runs). The library's `predictWin` is a probit of the team-sum gap while its update is a
  logistic one. That is the 57% against 62% gap noted under M14.59, and it is one source of the overconfidence.
- **beta, tau, kappa.**
  - `beta` 25/6 is per *team* in OpenSkill. TrueSkill uses one beta per player. With ten sigmas of 8–12, beta is a
    small part of `c`.
  - `tau` is added per game *played*, so it never changes an absent player. It complies with the no-decay ruling
    as it stands.
  - `kappa` (1e-4) is a sigma floor that never binds here.
  - Tuning OpenSkill until it feels fair (large beta, small starting sigma, a larger tau so sigma stops
    collapsing) turns it into Elo with a fixed K plus extra machinery. That is the case for writing the Elo form
    directly.
- **Glicko-2.** RD growth only happens per game played (standard Glicko-2 grows RD per rating period). We never
  measured the time-based version. The ruling removes it anyway, and nothing else in the design relied on it.
- **TrueSkill 2** gets its big accuracy gain from individual statistics (kills and so on), which is what Microsoft
  reports too. It is also exactly what Riot deliberately keeps out of League's MMR: you win and lose as a team. Our
  design takes the safe slice: shares inside a team's result, never against it.
- **Refit methods (BT, WHR)** are the statistically cleanest. They are not trustworthy as a displayed number,
  because your Rating would change on nights you stayed home (4–5 points a night here).

---

## 5. Why today's numbers feel unfair: the mechanics

1. **`Δmu_i = sigma_i² / c × (S − p)` with `c² = Σ all ten sigma² + 2β²`.** Your change scales with your own
   uncertainty *and* shrinks when the lobby holds unsure players. Two settled friends on the same winning team
   averaged a **2.06×** ratio. Tap-to-explain can only call this `new / settling / settled`.
2. **Sigma barely shrinks when everyone is unsure together.** Ten players folded from 20/12 have sigma 11.04
   after 10 games, 10.16 after 20, 8.90 after 36, 5.41 after 100, and 2.92 after 200. The product copy's "about 30
   for someone thirty games in" holds for a newcomer among settled veterans, not for a group that all reset on
   2026-09-16. At sigma about 9, an even game moves about 80 points; with ×1.25 MVP and lopsided fold odds, 120
   is ordinary.
3. **The scale stretches.** Over a season the simulated board's sd went 680 → 930 → 980 raw points, while true
   skill was fixed. Most of this comes from balancing: on balanced games the overall scale is invisible
   (section 3e). With random teams the same games and the same engine give a board sd of about 550–670. Ratings far apart then produce near-certain odds. On teams nobody balanced, today's log loss
   was **0.836, worse than a coin (0.693)**. The bot's percentages on balanced teams look fine only because the
   balancer drives them to 50%.
4. **MVP/ACE is not zero-sum.** About +0.45 of a typical change enters the system every game: the MVP's +25% and
   the ACE's 20% relief. Over a season that is about **+440** on the group mean, so 1200 means "below average"
   more each month.
5. **The newcomer's odds differ between bot and fold** (M14.59). The balancer guesses from rank and the fold uses
   1200. This is mild under Kustom, because K is the same function for the whole lobby.

---

## 6. Recommendation: (c) the Kustom rating

### 6.1 Definitions

Store one number per player per group: **`R`**, a real number, displayed as `Rating = round(R)`. Also keep `n`,
the player's rated games since the group's last reset (already stored as `rated_games_before`).

For a rated game with blue team B and red team T, and a player i on side X with S_X = 1 for a win, 0 for a loss:

```
team strength    Σ_B = sum of the five R on blue,  Σ_T = sum of the five R on red
expected (blue)  E_B = 1 / (1 + exp(−(Σ_B − Σ_T) / 400))          E_T = 1 − E_B
K                K(n) = 24 + 72 × max(0, 10 − n) / 10             (n = rated games before this one)
                 → game 1: 96, game 2: 88.8, …, game 10: 31.2, game 11 on: 24
share            rank the five players of side X by the existing performance score
                 (core rating/performance.ts, role-bucketed, unchanged), best first:
                     winners:  1.2, 1.1, 1.0, 0.9, 0.8
                     losers:   0.8, 0.9, 1.0, 1.1, 1.2   (the best loser gives back least)
                 performance score not available for the game (backfill, missing stat) → every share 1.0
                 ties broken by puuid (as mvpAce does today)
change           Δ_i = K(n_i) × (S_X − E_X) × share_i
new rating       R_i ← R_i + Δ_i;   printed change = round(R_after) − round(R_before)
start            R = 1200 for everyone, n = 0 (as today); 1200 is the group mean for ever, because settled games are zero-sum
```

**Odds table** for a gap in team totals (this is also what the bot shows):

| Gap | Win chance |
| --- | --- |
| 0 | 50% |
| 50 | 53% |
| 100 | 56% |
| 200 | 62% |
| 400 | 73% |

### 6.2 Properties, all by construction

| Situation | Change |
| --- | --- |
| Settled, even game, middle share | ±12 |
| MVP of an even win | +14.4 |
| ACE of an even loss | −9.6 |
| Settled, any game | at most 24 × 1.2 = **28.8** |
| A newcomer's first game | at most 96 × 1.2 = 115, and only then |

- **Sign-safe.** K > 0, share > 0, and (S − E) takes the sign of the result. A win always gains and a loss always
  loses.
- **Monotone in the odds.** The bigger the underdog, the more a win pays and the less a loss costs.
- **Zero-sum when all ten are settled.** Shares sum to 5 on each side, so blue's total change is exactly minus
  red's. There is no inflation, and the product no longer needs the "changes don't sum to zero" paragraph, except
  for games with a newcomer.
- **Independent of anyone else's uncertainty.** Two teammates with 10+ games and the same share get the same
  number.
- **No decay.** Nothing in the formula reads time or other people's games.

### 6.3 How it explains itself (M14.58 becomes simpler)

The stored breakdown per row becomes:

- `fold_p` = E for the player's side (as now)
- `K` (or `n`, from which K follows)
- the share rank 1–5
- `base` = K × (S − E), before the share

A worked example of the sentence:

> **+12** · Red won. Blue was favourite at 56% (team total 6,180 vs 6,080), so the win was worth 24 × 44% = 10.6.
> You had the 2nd-best game on your team: ×1.1 → **+12**.
>
> **−29** · First-game example: Your 3rd game counts extra while your Rating finds its level (×81 instead of
> ×24). …

Certainty is no longer inferred from sigma. It *is* K: "new" means K above 24, and it reaches 24 at game 11, the
same line as the `settling · n/10` chip. The settling chip at 10 rated games stays as it is.

### 6.4 New players, absences, MVP/ACE, weekly board, balancing

- **New players.** Start at 1200, the group mean, with K 96 falling to 24 by game 11.
  - Backtest: the newcomer percentile error at game 10 was 0.235, against 0.254 today.
  - Newcomer swings: median 31 and p95 53 (raw), against 114 and 200 today.
  - The balancer may keep its one-evening rank guess for a zero-game player (as M14.59 decided). It needs mapping
    onto the new scale, because a tier is worth far fewer points now (open question 3).
- **Absences.** Nothing happens (the owner's ruling). A returning player keeps their R and K. Their first game
  back moves like any settled game.
- **MVP and ACE.** They become the ends of the share scale and keep their names on posts: MVP is share 1.2 on the
  winning team, ACE is share 0.8 on the losing team. Unlike today, the extra comes out of the team's own result,
  so nobody's number is created from nothing. The backtest shows rank shares are never meaningfully worse than
  today's MVP/ACE, even when stats say nothing about skill, and better when they do. The fallback, if the
  real-data check says stats are pure noise: `share = 1.0` for everyone, or MVP/ACE-only zero-sum shares (1.2 /
  0.95 / 0.95 / 0.95 / 0.95). Both rows are in table 3a.
- **Weekly board.** Keep **net points** (the sum of printed changes, so columns add up, as M14.57 decided).
  Under Kustom a settling player tops the week 16.9% of the time, against 22.1% today, with a 10.6% share of the
  board. If newcomers topping weeks becomes a complaint, the fairest board measured is **equal-K points**: each
  game scored at K 24 for everyone, newcomer or not. It had the best fit to true over-performance (0.831) and no
  newcomer skew (9.2%). It breaks "the week's column adds up to the printed changes", so it is the owner's call.
  Per-game averages and a fresh weekly rating did worse or brought back the two-numbers problem M14.57 removed.
- **Balancing.** The balancer keeps working in display points. Effective skill becomes `R × roleMultiplier`;
  numerically that is what `mu × multiplier × 60` is today. Win chance becomes E above, so the receipt's
  percentage *is* the fold's expectation and M14.59's two odds collapse into one for everyone with a rating.
  Balance quality in the backtest was equal or slightly better (imbalance 0.127 against 0.134). "Rating gap 100
  pts" now always means 56%.

### 6.5 The balanced-teams guard: honest odds and an honest scale

Bot-balanced teams cannot show the scale (section 3e). The design therefore watches it, and corrects it in one
place, instead of pretending it holds.

- **One odds function.** Every number that claims to be a win chance goes through one function:
  - the receipt's `Blue 54%`;
  - the fold's E;
  - the tap-to-explain sentence;
  - the balancer's scoring;
  - the calibration line.

  ```
  E_B = logistic( a + b × (Σ_B − Σ_T) / 400 )
  ```

  `a` (a side bias) and `b` (a scale correction) start at **a = 0, b = 1**, which is exactly section 6.1. So
  "the odds shown are the odds used" (M14.59) holds by construction, newcomers included once they have a
  Rating.
- **The alarm is the calibration line already on the receipt (M14).** Do nothing until it has at least 200 rated
  games. Then fit `(a, b)` by logistic regression of results on the rated gap, ridge-shrunk toward (0, 1), over
  every rated game since the last reset. This is the team-formation report's option C.
  - If b falls below about **0.8**, the favourite is winning less often than shown. Adopt the fit, at most once a
    month, with a one-line note: `Odds are tuned to how this group's games actually went.`
  - It is a group-level change, made openly. It changes no stored Rating, so nobody's number moves while they
    sit out. Only future expected scores change.
- **What it costs.** With b < 1 the expected scores sit nearer 50%, so the scale keeps widening a little faster
  while the odds stay honest: in `kbal.mjs`, calibrated log loss improved and the random-team scale widened to
  1.6×. The board's spread then grows slowly over a year (in the realistic simulation, sd 270 → about 520). The
  order stays the best measured, but bigger gaps mean less per point.
- **The alternative lever.** If the owner prefers a board whose spread stays put, let K keep falling after game
  10: `K = max(12, 24 × √(10 / n))`. That gives 24 at game 10, 17 at game 20, 12 from game 40. It roughly halves
  the drift (one-year sd 297 instead of 520). It costs about 0.01–0.02 of ranking accuracy where people improve,
  and it halves veterans' moves to about ±6, so their number barely moves. I recommend flat K 24 plus the
  calibration guard. The floor is the owner's feel choice (open question 6).
- **Do not rescale stored Ratings to "fix" the spread.** Shrinking everyone toward 1200 would move absent
  players' numbers, which the owner has ruled out. A reset stays the owner's explicit action.

### 6.6 What it costs to build

- **`packages/core/src/rating/kustom.ts`**, about 120 lines: `expected`, `kFor(n)`, `shares(players, side)` built
  on the existing `performanceScores`, `rateGameKustom`, and `explainKustomDelta`. It is pure, with no
  dependency, and the `openskill` package can be removed. Tests pin every sentence in 6.2.
- **Balancer.** `predictWin` → `expected`, one call site.
- **Storage.** No new rating column is needed if `ratings.mu` stores `R / 60`: every `displayRating(mu)` surface
  then prints the same integer with no web change, and `sigma` can hold K. That reuse is a hack, though; a clean
  `rating` column is better. **The share rank (1–5) does need a place.** Today's `award` text column holds
  `mvp | ace | none`. Storing the rank is a schema decision, so per CLAUDE.md the lead takes it to the owner (open
  question 1).
- **Web.** The fold and the rebuild call the new function. The explanation copy is shorter.

---

## 7. Migration without wrecking trust

1. **Build behind the rebuild, not behind a live switch.** Land core plus tests, then run
   `rebuild-ratings --dry-run` with the Kustom fold and print, side by side:
   - old and new board order;
   - places moved;
   - old and new per-game changes for the last two weeks.

   Simulated expectation:
   - board order rank correlation **0.97**;
   - mean places moved **1.0**, the most anyone moves about 4;
   - top 3 unchanged for 2.6 of 3 places.
2. **One announced rebuild,** as M7.11 did: a single Discord line and a short note on `/how`. Every past game's
   printed change will be rewritten. Past weeks' boards will reorder slightly, because they are sums of those
   changes.
3. **Keep the scale's anchor and name.** Expect the spread to widen again slowly with flat K, through the drift
   in section 3e; the calibration guard keeps the odds honest while it does. It is still `Rating`, still starting at 1200, and 1200 is now the group
   average for good. **The spread will shrink**, because the old spread was mostly the stretching described in
   section 5: the simulated board sd went from about 950 to about 270. Do not rescale to imitate the old spread.
   That would bring back big swings and erase the main gain. If the real export shows a real board sd well under
   300 (possible with only a few weeks of history), the change in look will be small.
4. **The settling threshold of 10 stays.** K reaching 24 at game 11 lines up with it.
5. **Owner's Reset ratings.** Unchanged: R = 1200 and n = 0 for everyone.

**What friends will notice:**

- Changes of about ±10–15 per game instead of 40–120.
- Teammates' numbers within 20% of each other, with the reason printed.
- A tighter board.
- The bot's win chance and the rating's expectation are now the same number.
- Newcomers still move fast for about ten games, then calm down at a predictable rate.
- MVP still exists and still gets the most. The loser's best still loses least.
- A game where everyone was settled reads "+12 ×5 / −12 ×5"-ish, and the two teams' totals cancel.

---

## 8. Fairness guarantees for `/how` (plain words)

1. **A win never lowers your Rating, and a loss never raises it.**
2. **Your Rating only moves when you play a rated game.** Missing a night, a week or a month changes nothing, and
   other people's games never move your number.
3. **After your first 10 games, one game can move you by 29 points at most.** An even game is worth about 12.
4. **Beating the favourites pays more, and losing as the underdog costs less.** The odds we use are the ones the
   bot showed.
5. **Same team, same result, same base points.** The only difference is your share for how you played, between
   0.8× and 1.2×, and we show it.
6. **Points come from the other team.** When everyone in the game has 10+ games, what one side wins the other
   side loses, so Ratings don't inflate and 1200 is always the group average.
7. **Everyone starts at 1200.** Your first ten games count extra, from about 4× down to normal, so you find your
   level quickly. After that every game counts the same for everyone.
8. **Nobody can edit a Rating by hand.**

---

## 9. Real-data rerun (what could change the conclusion, and the export to check it)

**What real data could change:**

1. **Whether the performance score carries skill.** This decides whether to ship shares or flat shares. In the
   simulation, stats always carried some skill signal except in the "no skill" world.
2. **How stretched today's real board is.** This decides how big the visible change from the rebuild will be.
3. **Real swing sizes** compared with the simulated ones.

The accuracy *ties* are very unlikely to flip: every system hit the same ceiling in every simulated world.

**The export.** Run it once, read-only, in the Supabase SQL editor on the hosted project, by the owner. Then use
"Download CSV". It hashes PUUIDs and holds no names.

```sql
-- Kustom rating research export: one row per player per game, one group, read-only.
select
  g.id                         as game_id,
  g.started_at,
  g.winning_side,
  g.duration_s,
  g.rated,
  coalesce(g.mode, '')         as mode,
  md5(p.puuid)                 as player_key,
  gp.side,
  gp.role,
  gp.kills, gp.deaths, gp.assists, gp.gold, gp.cs,
  gp.damage_to_champs, gp.vision_score, gp.damage_self_mitigated, gp.damage_to_objectives,
  gp.mu_before, gp.sigma_before, gp.mu_after, gp.sigma_after,
  gp.base_mu_after, gp.award, gp.fold_p, gp.rated_games_before,
  s.blue_win_prob              as bot_blue_win_prob
from public.games g
join public.groups gr      on gr.id = g.group_id and gr.slug = 'customs'
join public.game_players gp on gp.game_id = g.id
join public.players p      on p.id = gp.player_id
left join public.splits s  on s.lobby_id = g.lobby_id and s.is_chosen
order by g.started_at, g.id, gp.side;
```

The output is CSV with those 27 columns in that order, one row per player per game. Nulls export as empty
cells. A lobby with more than one chosen split would duplicate rows; the replay drops any game without exactly
ten rows.

**The replay.** Run `node real.ts export.csv` in the scratch folder. It rebuilds the rated Summoner's Rift games
with the same gate as `gateRatedGame` (rated, CLASSIC or no mode, over 300 s, ten players five a side) and folds
them through four systems:

- today's rule;
- Kustom with no shares;
- Kustom with MVP/ACE-only zero-sum shares;
- Kustom with rank shares.

It prints:

- the stored delta distribution (what friends actually saw);
- each system's online log loss and Brier, with a bootstrap interval on the gain over a coin;
- the swing sizes;
- the board sd and range;
- **the calibration line of the bot's stored odds**: real games grouped by the favourite's shown win chance,
  with how often the favourite actually won. This is the real-data version of section 3e. If 60%+ favourites
  win near 50%, the stretch is real here too.

A dry run on a synthetic CSV in the export's format works end to end.

**How to read it.**

- These games were balanced by today's ratings, so every system's log loss will sit near 0.693, and the absolute
  numbers favour today's system.
- The decisive comparison is **Kustom with rank shares against Kustom with no shares**: the same bias applies to
  both, so the difference isolates whether the performance score predicts results. If rank shares' interval sits
  at or above no-shares, ship shares. If below, ship flat shares or MVP/ACE-only.
- Also compare the stored sd and range with the Kustom refold to see how much the board's look will change.

---

## 10. Open questions for the owner and lead

1. **Schema.** Where the share rank (1–5) and K are stored per `game_players` row: a new migration, or reusing
   `award` and `sigma_*`. This is a schema change, so per CLAUDE.md it goes to the owner.
2. **Shares or MVP/ACE only.** Decide after the real-data check. Rank shares are the recommendation if
   performance predicts results.
3. **The zero-game balancer guess.** `seedFromRank` steps are 180 display points per tier on today's scale. On the
   Kustom scale a tier should probably be worth about 40–60 points around 1200 (for example Silver IV 1200, Gold
   IV 1250, Platinum IV 1300). Calibrate it from the export: regress players' Kustom R after 20 games on their
   rank.
4. **Stomp factor.** It gave +0.04 rho on a synthetic margin, but the real margin signal (end-of-game gold or kill
   difference) is untested and arguable ("we surrendered at 15"). Recommendation: not in v1. Revisit with the
   export.
5. **Weekly board.** Net points (keeps columns adding up) or equal-K points (fairer to veterans when a newcomer
   has a hot week)?
6. **K values.** K 24 settled / 96 new over 10 games was picked on tuning seeds. K 32 tied on accuracy with
   bigger swings (an even game ±16). Whether K keeps falling after game 10 (floor 12) trades a steadier board
   spread for slower climbs and smaller veteran moves (section 6.5). These are feel choices, each one constant.
8. **The odds-calibration threshold and cadence.** Section 6.5 suggests 200 games, b < 0.8, at most monthly; the
   team-formation report asks the same question (its open question 6). Decide once, for both reports.
7. **The balancer's off-role multiplier** multiplies an absolute rating (`R × 0.85`), so a fill costs a 1500
   player more points than a 900 player. This is unchanged by this proposal but worth a look: a flat off-role
   price in points would be scale-free.

---

## 11. Sources

**Algorithms**

- Weng & Lin, *A Bayesian Approximation Method for Online Ranking*, JMLR 12 (2011), the model behind OpenSkill: <https://jmlr.org/papers/v12/weng11a.html>
- openskill.js (the library and version in use, 5.0.1): <https://github.com/philihp/openskill.js>
- Herbrich, Minka & Graepel, *TrueSkill: A Bayesian Skill Rating System*, NIPS 2006: <https://www.microsoft.com/en-us/research/publication/trueskilltm-a-bayesian-skill-rating-system/>
- Minka, Cleven & Zaykov, *TrueSkill 2: An improved Bayesian skill rating system* (MSR-TR-2018-8): <https://www.microsoft.com/en-us/research/publication/trueskill-2-improved-bayesian-skill-rating-system/> and [TrueSkill on Wikipedia](https://en.wikipedia.org/wiki/TrueSkill)
- Glickman, *Example of the Glicko-2 system*: <http://www.glicko.net/glicko/glicko2.pdf>
- Coulom, *Whole-History Rating: A Bayesian Rating System for Players of Time-Varying Strength* (2008): <https://www.remi-coulom.fr/WHR/WHR.pdf>
- Dangauthier, Herbrich, Minka & Graepel, *TrueSkill Through Time* (2007): <https://www.microsoft.com/en-us/research/publication/trueskill-through-time-revisiting-the-history-of-chess/>
- Elo rating system, including team and K-factor variants: <https://en.wikipedia.org/wiki/Elo_rating_system>
- Bradley–Terry model: <https://en.wikipedia.org/wiki/Bradley%E2%80%93Terry_model>

**Related studies and practice**

- *Skill Issues: An Analysis of CS:GO Skill Rating Systems* (2024), which compares Elo, Glicko-2 and TrueSkill on team games: <https://arxiv.org/pdf/2410.02831>
- FiveThirtyEight's margin-of-victory multiplier for Elo (NFL methodology): <https://fivethirtyeight.com/methodology/how-our-nfl-predictions-work/>
- Riot on League MMR ignoring personal performance ("you win and lose together as a team"): <https://devtrackers.gg/leagueoflegends/p/c5fe7696-riot-clarified-some-things-about-mmr-win-streaks-personal-performance>

---

## Appendix: reproducing the backtest

All files are in the scratch folder named at the top. Each command runs with `node <file>` and Node 25's native
TypeScript stripping. They import `openskill` 5.0.1 from the repo's `node_modules`.

| File | What it does |
| --- | --- |
| `lib.ts` | the world, the season simulator and the balancer |
| `systems.ts` | every candidate behind one interface |
| `evaluate.ts` | the metrics |
| `main.ts <set> <firstSeed> <n> <world>` | the backtest tables. Sets: `main`, `core`, `awards`, `os`, `kgrid`, `kgrid2`, `kscale`, `kfinal`. Worlds: `base`, `narrow`, `wide`, `noisyStats`, `statsNoSkill`, `churn`. Section 3a is `node main.ts main 1 30 base`. |
| `weekly.ts` | section 3d |
| `pad.ts` | the stat-padding test |
| `boardshift.ts` | the board-order change on a refold |
| `dbg2.ts` | the sigma trajectory of a fresh group |
| `kbal.mjs` | section 3e: the team-formation world (it imports `../team-formation/sim.mjs`), with OpenSkill and Kustom, balanced vs random. Environment variables: `KS`, `KF`, `GAMES`, `ONLY`. |
| `real.ts export.csv` | the real-data replay (section 9) |
| `gen-csv.ts` | writes a synthetic file in the export's format |
