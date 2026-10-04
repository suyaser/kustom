# Kustom rating on real games: replay of the production export

Research only, read-only. Input: `~/Downloads/kustom-export.csv` (not copied anywhere). Scripts in this folder:
`load.ts` (CSV + eligibility + core `performanceScores` and `apps/web/lib/night.ts` `weekStart`, imported from the repo
source via tsx), `fold.ts` (the Kustom fold), `analyze.ts` (every table below, also written to `tables.md`),
`extras.ts` (side checks). Run: `node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/cli.mjs analyze.ts`.

## Summary for the owner (plain English)

1. **Small sample.** 109 real 5v5 games, 34 players, 5.5 weeks. Most differences between rating rules sit inside
   the noise. Where a result is clear, it is marked as clear below.
2. **Today's odds are worse than a coin flip on our real games.** OpenSkill's pre-game odds scored 0.806 log loss
   against a coin's 0.693. When it called a side 75% favourite, that side won 41% of the time (34 games). Those
   odds carry essentially no signal.
3. **Kustom's odds are about a coin flip.** That is expected, because the bot balances every game. Kustom scored
   0.700 over all games and 0.681 over the second half. It beats today's odds clearly; beating a coin is
   within noise.
4. **The performance shares earn their place.** Kustom with shares predicted the next games slightly but
   consistently better than Kustom without them, and the interval excludes zero. So the performance score does
   say something about skill. Keep shares.
5. **Numbers get small and calm.** A settled player now moves about **±8 points a game (90% under 10, never over
   13)**, against today's ±79 (up to 197). A new player moves about ±13 (max 24), against ±113 today. Teammates
   differ only by their visible share (at most 1.2 against 0.8). Today, 43% of teams have one settled teammate
   moving more than 1.5× another.
6. **The board order barely changes; its spread does.** Rank correlation with today's board is 0.94, the top 3 are
   identical, and the average player moves 1.6 places (at most 5). The spread collapses, though: settled players
   go from 600–2739 (sd 493) to **1112–1400 (sd 66)**. With K 16 and five weeks of history, everyone sits near
   1200. Expect the board to look compressed at launch.
7. **No inflation.** Today's group average crept from 1200 to 1326 in 5.5 weeks. Under Kustom it stays at 1199.
8. **Weekly board.** A fresh weekly Kustom board agrees with today's net-points week board on 4 of the top 5 in
   most weeks. Its top 5 only settles in the last few games of a week. **Note:** the repo's week starts on
   **Sunday** 06:00 Cairo time (M5.34), not Monday. Both were run, and the results are nearly identical.
9. **Something to check (not a rating question).** The bot's stored win chance at balance time has *zero*
   correlation (r = 0.01) with the win chance the current refold assigns to the same game. In 35 of 88 games the
   refold says 70/30 or worse where the bot said 45–55. Today's board ratings are not the numbers the teams were
   balanced on.

## Method notes

- **Eligible games** are those with 10 rows, 5 per side and every `mu_before` set. That leaves 109 of 140, which
  is exactly the current fold's set. The fold checks out: `mu_before` always equals the player's previous
  `mu_after`, `rated_games_before` always equals the count of earlier eligible games, and `fold_p` is consistent
  per side.
- **Kustom** follows the owner's spec:
  - change = K × (S − E) × share;
  - E = 1/(1+exp(−(Σblue − Σred)/400));
  - start 1200, no decay;
  - K = 16 + 16·max(0, 10 − n)/10 (32 → 16 by game 11);
  - share 1.2/1.1/1.0/0.9/0.8 by in-team rank of core `performanceScores` (reversed for losers, ties to the lower
    key).
  - 19 of the 109 games have no score (no roles stored), so everyone gets 1.0 there. The 90 scored games are
    exactly the 90 that stored an MVP.
- **Comparison variants:**
  - "Kustom no-share" sets share = 1.
  - "K=24 flat" uses K = 24 for everyone from game 1.
  - "Doc K 96→24" is the earlier research doc's proposal.
- **Stomp variant.** The research doc defines a stomp factor only on a synthetic margin:
  ×(1 + 0.25·(min(|margin|/2, 1.6) − 0.8)), a multiplier between 0.8 and 1.2. For real games I used the team gold
  difference per minute, standardised by its root mean square over the 109 games and scaled ×2.3 to match the
  simulated margin's spread. Treat it as indicative only.
- **Weekly track.** The same algorithm with every Rating reset to 1200 at each boundary. The primary run also
  resets K to 32; the "career K" column keeps the all-time game count. Boundaries come from the repo's `weekStart`
  (Sunday 06:00 Africa/Cairo). The Monday 06:00 variant is the same boundary plus one day.
- **Bootstrap intervals.** They resample games independently and ignore the serial dependence, so read them as
  optimistic.
- **Side bias.** Blue won 62 of 109 (57%). Every fitted `a` ≈ 0.27 is that side bias. A running blue-side base rate
  alone scores 0.703 overall and 0.683 over the last half, which is comparable to every rating model here.

## 0. Data
Eligible games (10 rows, 5v5, all mu_before set): **109** of 140; 90 have a performance score (roles + all stats), 19 get share 1.0 for everyone. Players: 34. Span 2026-08-26 .. 2026-10-03. Blue won 62/109.
Sanity: mu_before != previous mu_after: 0 rows; rated_games_before != counted eligible games: 0 rows; fold_p not consistent (same per side, sums to 1): 0 games. 
Not eligible: 31 games, every one rated=true and mode='fearless' (10,10,10,10,10,10,10,4,4,6,6,6,6,6,6,6,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8 rows). The 7 ten-player ones have no roles and durations 1142, 1416, 1003, 1220, 1218, 1022, 2721 s (ARAM-like by the current gate). All 140 games carry mode='fearless', including the 4/6/8-player ones, so mode alone cannot gate.
Games where 'has a performance score' disagrees with 'stored an MVP': 0. Bot odds present on 88/109 eligible games.

## 2. Predictive quality (each game predicted before it is folded)

**All eligible games** (n = 109)

| Predictor | Log loss | Brier | Accuracy | LL gain vs coin x1000 (90% bootstrap CI) |
|---|---|---|---|---|
| Coin flip | 0.693 | 0.250 | 0.500 | - |
| OpenSkill fold_p (current) | 0.806 | 0.293 | 0.500 | -112.6 (-192.9 .. -34.4) |
| Kustom (share) | 0.700 | 0.253 | 0.518 | -7.0 (-31.7 .. 17.5) |
| Kustom no-share | 0.710 | 0.258 | 0.528 | -16.5 (-39.2 .. 4.7) |
| K=24 flat (share) | 0.703 | 0.255 | 0.500 | -9.7 (-41.8 .. 21.1) |
| Doc K 96->24 (share) | 0.726 | 0.264 | 0.509 | -33.1 (-80.6 .. 15.1) |
| Kustom + stomp 0.25 (share) | 0.697 | 0.252 | 0.518 | -4.3 (-30.5 .. 21.6) |

Subset with stored bot odds (n = 88): bot 0.691, fold_p 0.798, Kustom 0.694, coin 0.693.
Paired LL advantage x1000 (positive = first is better): Kustom share over no-share 9.6 (3.5 .. 15.6); Kustom share over OpenSkill fold_p 105.6 (47.3 .. 166.3); Kustom no-share over fold_p 96.0 (36.7 .. 159.6).

**Last half (games 55..109)** (n = 55)

| Predictor | Log loss | Brier | Accuracy | LL gain vs coin x1000 (90% bootstrap CI) |
|---|---|---|---|---|
| Coin flip | 0.693 | 0.250 | 0.500 | - |
| OpenSkill fold_p (current) | 0.788 | 0.289 | 0.545 | -95.2 (-220.7 .. 26.1) |
| Kustom (share) | 0.681 | 0.244 | 0.527 | 11.7 (-28.0 .. 50.8) |
| Kustom no-share | 0.699 | 0.253 | 0.564 | -6.3 (-40.0 .. 26.5) |
| K=24 flat (share) | 0.681 | 0.244 | 0.509 | 12.5 (-36.7 .. 62.9) |
| Doc K 96->24 (share) | 0.689 | 0.248 | 0.545 | 4.3 (-59.6 .. 67.2) |
| Kustom + stomp 0.25 (share) | 0.676 | 0.242 | 0.527 | 17.0 (-22.6 .. 58.5) |

Subset with stored bot odds (n = 51): bot 0.703, fold_p 0.755, Kustom 0.674, coin 0.693.
Paired LL advantage x1000 (positive = first is better): Kustom share over no-share 17.9 (7.4 .. 29.0); Kustom share over OpenSkill fold_p 106.9 (18.6 .. 193.9); Kustom no-share over fold_p 89.0 (-0.0 .. 181.5).

## 3. Per-game change sizes (Rating points)

| System | settled median | p90 | max | new median | p90 | max | settled teammate spread, mean max/min | median | share of teams with ratio > 1.5 |
|---|---|---|---|---|---|---|---|---|---|
| OpenSkill actual (mu_after - mu_before) x60, incl. MVP/ACE | 78.9 | 121.0 | 197.4 | 112.5 | 164.2 | 268.6 | 1.55 | 1.43 | 0.43 (n=193) |
| OpenSkill actual, spread over no-award teammates only | 78.9 | 121.0 | 197.4 | 112.5 | 164.2 | 268.6 | 1.38 | 1.31 | 0.28 (n=192) |
| OpenSkill base (before MVP/ACE) x60 | 78.8 | 117.7 | 197.4 | 112.5 | 163.1 | 227.8 | 1.44 | 1.34 | 0.35 (n=193) |
| Kustom (share) | 7.7 | 10.1 | 13.3 | 13.2 | 18.0 | 23.7 | 1.42 | 1.50 | 0.00 (n=193) |
| Kustom no-share | 7.9 | 9.4 | 10.6 | 13.2 | 17.0 | 21.2 | 1.00 | 1.00 | 0.00 (n=193) |
| K=24 flat (share) | 11.4 | 15.7 | 21.6 | 12.0 | 15.0 | 21.6 | 1.42 | 1.50 | 0.00 (n=193) |
| Doc K 96->24 (share) | 11.4 | 16.6 | 22.8 | 34.6 | 58.3 | 83.9 | 1.42 | 1.50 | 0.00 (n=193) |
| Kustom + stomp 0.25 (share) | 7.9 | 10.8 | 14.1 | 13.4 | 17.6 | 26.3 | 1.42 | 1.50 | 0.04 (n=193) |

Settled = 10+ rated games before the game (export's rated_games_before for OpenSkill, the fold's own count for Kustom; the two counts agree). Rows: settled 839, new 251.

## 4. Final all-time board: Kustom vs current

| Player | Games | Current Rating | Kustom Rating | Kustom no-share | Rank current (all / 10+) | Rank Kustom (all / 10+) |
|---|---|---|---|---|---|---|
| 3473c3e8 | 99 | 2739 | 1400 | 1352 | 1 / 1 | 1 / 1 |
| ee28c1f7 | 35 | 2280 | 1301 | 1266 | 2 / 2 | 2 / 2 |
| ea36a207 | 16 | 1908 | 1267 | 1258 | 3 / 3 | 3 / 3 |
| 2f9ac302 | 78 | 1820 | 1241 | 1224 | 4 / 4 | 4 / 4 |
| e2429fa2 (settling) | 5 | 1734 | 1239 | 1224 | 5 / - | 5 / - |
| 63b1eebe (settling) | 4 | 1504 | 1234 | 1231 | 8 / - | 6 / - |
| cf2fb250 | 29 | 1402 | 1229 | 1231 | 11 / 8 | 7 / 5 |
| 367ffb01 (settling) | 5 | 1600 | 1224 | 1220 | 7 / - | 8 / - |
| 9579b7ca (settling) | 6 | 1390 | 1223 | 1223 | 13 / - | 9 / - |
| 3942496a | 11 | 1648 | 1219 | 1209 | 6 / 5 | 10 / 6 |
| 83d68a30 (settling) | 3 | 1333 | 1216 | 1216 | 14 / - | 11 / - |
| 900343a2 | 18 | 1433 | 1216 | 1214 | 9 / 6 | 12 / 7 |
| 269ad229 (settling) | 1 | 1305 | 1215 | 1215 | 17 / - | 13 / - |
| 607e6a58 (settling) | 2 | 1306 | 1205 | 1203 | 16 / - | 14 / - |
| 472be0de (settling) | 2 | 1275 | 1203 | 1200 | 19 / - | 15 / - |
| 06a3cdca | 54 | 1422 | 1202 | 1183 | 10 / 7 | 16 / 8 |
| 14cc690b | 54 | 1225 | 1197 | 1194 | 20 / 12 | 17 / 9 |
| fbb344de | 21 | 1172 | 1188 | 1197 | 23 / 15 | 18 / 10 |
| cc34bc98 | 68 | 1285 | 1185 | 1171 | 18 / 11 | 19 / 11 |
| c0ba3fbc | 92 | 1318 | 1184 | 1194 | 15 / 10 | 20 / 12 |
| daef2ac0 (settling) | 3 | 1067 | 1184 | 1184 | 26 / - | 21 / - |
| e3d2c2cb (settling) | 1 | 1085 | 1184 | 1184 | 24 / - | 22 / - |
| bab2593f | 29 | 1398 | 1184 | 1188 | 12 / 9 | 23 / 13 |
| c510f5d2 (settling) | 3 | 1046 | 1183 | 1183 | 27 / - | 24 / - |
| 99b211e5 (settling) | 1 | 995 | 1176 | 1181 | 29 / - | 25 / - |
| 8435eac3 | 60 | 1220 | 1172 | 1191 | 21 / 13 | 26 / 14 |
| cede1ee6 | 11 | 1069 | 1169 | 1174 | 25 / 16 | 27 / 15 |
| 99c0b322 | 82 | 1216 | 1167 | 1165 | 22 / 14 | 28 / 16 |
| 8678327b | 53 | 982 | 1153 | 1155 | 30 / 18 | 29 / 17 |
| 1954be92 (settling) | 5 | 780 | 1143 | 1154 | 32 / - | 30 / - |
| 8283a412 | 12 | 600 | 1118 | 1124 | 34 / 21 | 31 / 18 |
| a58e20c3 | 50 | 701 | 1116 | 1140 | 33 / 20 | 32 / 19 |
| 453af68d | 90 | 1024 | 1114 | 1139 | 28 / 17 | 33 / 20 |
| 681a2355 | 87 | 807 | 1112 | 1167 | 31 / 19 | 34 / 21 |

Spearman (current vs Kustom): all 34 players 0.925; the 21 with 10+ games 0.938. Kustom share vs no-share (10+): 0.931. Top-3 overlap (10+ board): 3/3; share vs no-share top-3 overlap 3/3. Places moved on the 10+ board: mean 1.6, max 5.
Board spread (10+ players): current sd 493, range 600..2739; Kustom sd 66, range 1112..1400.

## 5a. Weekly track, weeks opening Sunday 06:00 Africa/Cairo (the repo helper, apps/web/lib/night.ts weekStart, M5.34)

Weekly Kustom = same algorithm, everyone back to 1200 and K back to 32 at the boundary. "Career K" = same reset of Rating but K keeps the all-time game count. Net points (current) = sum of printed OpenSkill deltas in the week (today's week board, M14.57). Wins order = wins minus losses, then wins.

| Week (start, local) | Games | Players | Weekly Kustom top 5 | Weekly, career K top 5 | Net points (current OpenSkill) top 5 | Kustom all-time net points top 5 | Wins-minus-losses top 5 | Top-5 overlap weekly vs net (cur) / vs W-L | Spearman weekly vs net (cur) / vs W-L | Games until weekly top-5 set final / order rho >= 0.9 for good |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-23 | 3 | 11 | 14cc 1216, 83d6 1216, 9003 1216, 99c0 1216, c0ba 1212 | 14cc 1216, 83d6 1216, 9003 1216, 99c0 1216, c0ba 1212 | 14cc +133, 83d6 +133, 9003 +133, 99c0 +133, c0ba +81 | 14cc +16, 83d6 +16, 9003 +16, 99c0 +16, c0ba +12 | 14cc +1, 83d6 +1, 9003 +1, 99c0 +1, c0ba +1 | 5/5 / 5/5 | 1.00 / 0.77 | 3 / 3 of 3 |
| 2026-08-30 | 6 | 17 | 453a 1235, cf2f 1232, ea36 1216, 99c0 1213, a58e 1213 | cf2f 1232, 453a 1229, ea36 1216, a58e 1212, 99c0 1211 | 453a +276, cf2f +255, ea36 +115, a58e +72, 99c0 +71 | cf2f +32, 453a +30, ea36 +16, a58e +10, 99c0 +9 | 453a +2, cf2f +2, 99c0 +1, a58e +1, ea36 +1 | 5/5 / 5/5 | 0.98 / 0.95 | 6 / 6 of 6 |
| 2026-09-06 | 21 | 19 | 3473 1290, 06a3 1244, 9579 1228, 14cc 1225, 9003 1216 | 3473 1277, 06a3 1239, 9579 1229, 99c0 1216, 9003 1213 | 3473 +830, 06a3 +459, 99c0 +323, 9579 +207, 8435 +203 | 3473 +79, 06a3 +43, 9579 +29, 99c0 +16, 9003 +12 | 3473 +9, 06a3 +4, 99c0 +2, 9579 +2, 8435 +1 | 3/5 / 3/5 | 0.88 / 0.90 | 21 / 16 of 21 |
| 2026-09-13 | 24 | 20 | c0ba 1271, ee28 1257, e242 1244, 06a3 1242, 453a 1242 | c0ba 1249, ee28 1246, e242 1241, ea36 1232, 453a 1230 | c0ba +597, ee28 +528, 453a +523, e242 +450, cc34 +401 | c0ba +53, ee28 +49, e242 +43, 453a +33, ea36 +32 | c0ba +8, 453a +7, 06a3 +3, ee28 +3, cc34 +2 | 4/5 / 4/5 | 0.94 / 0.92 | 21 / 17 of 24 |
| 2026-09-20 | 27 | 26 | cc34 1273, 3473 1270, ee28 1259, 2f9a 1240, 681a 1237 | 3473 1260, cc34 1260, 681a 1240, ee28 1237, 63b1 1232 | cc34 +615, 2f9a +511, ee28 +499, 681a +493, 63b1 +304 | cc34 +66, 681a +49, 2f9a +45, 3473 +44, ee28 +43 | 681a +8, cc34 +8, 3473 +5, 2f9a +4, ee28 +4 | 4/5 / 5/5 | 0.92 / 0.95 | 25 / 19 of 27 |
| 2026-09-27 | 28 | 25 | 3473 1324, 8435 1252, 3942 1243, cede 1235, 367f 1234 | 3473 1300, ee28 1231, 367f 1229, 3942 1228, 8435 1228 | 3942 +530, cede +427, 3473 +420, 367f +389, fbb3 +323 | 3473 +73, 3942 +33, 8435 +32, 367f +31, ee28 +22 | 3473 +11, 8435 +4, fbb3 +3, 3942 +3, cede +3 | 4/5 / 4/5 | 0.92 / 0.95 | 27 / 23 of 28 |

## 5b. Weekly track, weeks opening Monday 06:00 Africa/Cairo (as the owner stated)

Weekly Kustom = same algorithm, everyone back to 1200 and K back to 32 at the boundary. "Career K" = same reset of Rating but K keeps the all-time game count. Net points (current) = sum of printed OpenSkill deltas in the week (today's week board, M14.57). Wins order = wins minus losses, then wins.

| Week (start, local) | Games | Players | Weekly Kustom top 5 | Weekly, career K top 5 | Net points (current OpenSkill) top 5 | Kustom all-time net points top 5 | Wins-minus-losses top 5 | Top-5 overlap weekly vs net (cur) / vs W-L | Spearman weekly vs net (cur) / vs W-L | Games until weekly top-5 set final / order rho >= 0.9 for good |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-24 | 3 | 11 | 14cc 1216, 83d6 1216, 9003 1216, 99c0 1216, c0ba 1212 | 14cc 1216, 83d6 1216, 9003 1216, 99c0 1216, c0ba 1212 | 14cc +133, 83d6 +133, 9003 +133, 99c0 +133, c0ba +81 | 14cc +16, 83d6 +16, 9003 +16, 99c0 +16, c0ba +12 | 14cc +1, 83d6 +1, 9003 +1, 99c0 +1, c0ba +1 | 5/5 / 5/5 | 1.00 / 0.77 | 3 / 3 of 3 |
| 2026-08-31 | 6 | 17 | 453a 1235, cf2f 1232, ea36 1216, 99c0 1213, a58e 1213 | cf2f 1232, 453a 1229, ea36 1216, a58e 1212, 99c0 1211 | 453a +276, cf2f +255, ea36 +115, a58e +72, 99c0 +71 | cf2f +32, 453a +30, ea36 +16, a58e +10, 99c0 +9 | 453a +2, cf2f +2, 99c0 +1, a58e +1, ea36 +1 | 5/5 / 5/5 | 0.98 / 0.95 | 6 / 6 of 6 |
| 2026-09-07 | 25 | 19 | 3473 1293, 06a3 1244, 9579 1228, 99c0 1226, 2f9a 1225 | 3473 1280, 06a3 1239, 99c0 1232, 9579 1229, 2f9a 1219 | 3473 +875, 99c0 +475, 06a3 +459, 2f9a +270, 9579 +207 | 3473 +83, 06a3 +43, 99c0 +30, 9579 +29, 2f9a +20 | 3473 +9, 99c0 +4, 06a3 +4, 9579 +2, 453a +1 | 5/5 / 4/5 | 0.92 / 0.94 | 25 / 23 of 25 |
| 2026-09-14 | 22 | 20 | c0ba 1265, ee28 1253, 06a3 1246, e242 1241, 453a 1234 | ee28 1244, e242 1239, c0ba 1238, ea36 1231, 06a3 1227 | ee28 +528, c0ba +455, e242 +450, ea36 +312, 453a +294 | ee28 +49, e242 +43, c0ba +39, ea36 +32, 06a3 +22 | c0ba +6, 453a +5, 06a3 +3, ee28 +3, cf2f +2 | 4/5 / 4/5 | 0.93 / 0.95 | 17 / 16 of 22 |
| 2026-09-21 | 29 | 28 | cc34 1283, ee28 1273, 3473 1264, 2f9a 1243, 8435 1238 | cc34 1270, 3473 1254, ee28 1252, 63b1 1232, 8435 1231 | cc34 +744, ee28 +634, 2f9a +427, 681a +373, 8435 +335 | cc34 +80, ee28 +58, 2f9a +42, 3473 +37, 8435 +37 | cc34 +9, ee28 +6, 681a +5, 8435 +5, 3473 +4 | 4/5 / 4/5 | 0.94 / 0.94 | 29 / 24 of 29 |
| 2026-09-28 | 24 | 24 | 3473 1336, 3942 1237, 367f 1232, cede 1232, fbb3 1230 | 3473 1299, 367f 1228, 3942 1226, fbb3 1223, cede 1220 | 3942 +530, 3473 +493, cede +427, 367f +389, 8678 +347 | 3473 +81, 3942 +33, 367f +31, 8678 +26, cede +20 | 3473 +12, fbb3 +3, 3942 +3, cede +3, 8678 +2 | 4/5 / 4/5 | 0.95 / 0.90 | 23 / 20 of 24 |

## 6. Calibration: favourite's shown chance vs how often the favourite won

| Predictor | 50-55% | 55-60% | 60-70% | 70-80% | 80%+ | Recalibration fit, logit(won) = a + b·logit(p) |
|---|---|---|---|---|---|---|
| OpenSkill fold_p (current refold) | 52% shown, 50% won (n=24) | 57% shown, 53% won (n=15) | 66% shown, 57% won (n=23) | 75% shown, 41% won (n=34) | 88% shown, 58% won (n=12) | a 0.26, b 0.01 ± 0.19 (n=108) |
| Bot odds stored at balance time | 52% shown, 41% won (n=73) | 57% shown, 80% won (n=15) | - | - | - | a 0.28, b 0.99 ± 1.54 (n=88) |
| Kustom (share) | 52% shown, 52% won (n=48) | 58% shown, 49% won (n=39) | 64% shown, 57% won (n=21) | - | - | a 0.27, b 0.31 ± 0.61 (n=108) |
| Kustom no-share | 52% shown, 63% won (n=54) | 57% shown, 43% won (n=40) | 63% shown, 43% won (n=14) | - | - | a 0.26, b -0.33 ± 0.71 (n=108) |
| Kustom, last half only | 53% shown, 39% won (n=18) | 58% shown, 52% won (n=21) | 63% shown, 69% won (n=16) | - | - | a 0.53, b 1.23 ± 0.81 (n=55) |
| OpenSkill fold_p, last half only | 53% shown, 63% won (n=8) | 58% shown, 60% won (n=5) | 67% shown, 44% won (n=9) | 76% shown, 50% won (n=24) | 87% shown, 67% won (n=9) | a 0.45, b 0.24 ± 0.25 (n=55) |

b = 1 is perfectly scaled; b < 1 means the odds are overconfident (the favourite wins less often than shown); b near 0 means the odds carry no signal.

## 7. Inflation
- Current OpenSkill (mu×60): group mean after game 28: 1220, after game 55: 1261, after game 82: 1278, after game 109: 1326.
- Kustom (share): group mean after game 28: 1198, after game 55: 1199, after game 82: 1198, after game 109: 1199; points created over the whole fold -37 (81 of 109 games not zero-sum).
- Kustom no-share: group mean after game 28: 1198, after game 55: 1199, after game 82: 1198, after game 109: 1199; points created over the whole fold -47 (78 of 109 games not zero-sum).
- Current OpenSkill: total points created across the fold 4287 (start is 1200 = mu 20 for everyone).

## 8. Side checks (extras.ts)

- **Bot odds against the refold's odds.**
  - The correlation between the stored `bot_blue_win_prob` and `fold_p` is **0.011**.
  - The bot's range is 0.42–0.58; `fold_p` ranges 0.05–0.96.
  - In 35 of 88 games the refold says |p − 0.5| > 0.2 where the bot said within 0.05.
  - The ratings the board shows today are not the ones the teams were balanced on. Likely causes are later
    refolds or resets (M14.18 epoch, rebuilds after M7.x and M14.x rule changes) or the balancer's own inputs (role
    multipliers, rank seeds). Worth a look by the lead. It does not affect the Kustom replay.
- **OpenSkill sigma never settles.** After 5.5 weeks the median final sigma for 10+ game players is 7.9 (6.5–10.6).
  The 99-game player is still at 6.5. That is why settled players still swing ±79 a game.
- **OpenSkill teammate spread.** Among settled teammates: p90 2.15×, max 2.85×. There are no sign violations; no
  win ever lowered a Rating.
- **Games per player:** 1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5, 5, 6, 11, 11, 12, 16, 18, 21, 29, 29, 35, 50, 53, 54,
  54, 60, 68, 78, 82, 87, 90, 92, 99. Thirteen players are under 10 games (settling) and 21 are settled.
- **Data oddities.**
  - All 140 games are `rated = true` and `mode = 'fearless'`, including 4-, 6- and 8-player games and 7
    ten-player games that the fold skipped. Those 7 have no roles and are mostly short (1003–1416 s, one of
    2721 s): ARAM-like by the current gate.
  - So `rated` and `mode` in the export do not reflect what the fold rated. `mu_before` is the only reliable
    gate.
  - No duplicate players within a game. No game with `mu_before` set on some rows and not others.
