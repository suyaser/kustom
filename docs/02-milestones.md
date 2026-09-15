# Milestones

Build order. Each milestone ships something a player can see. Tasks are sized for one agent session each.
Acceptance criteria are what an implementing agent must demonstrate before marking a task done.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M0 Spike: verify the client | done | Verified on 16.17 (2026-09-08) with fixtures and schemas. Still open: switch-side path and invite body (M4), Windows run (M2.11). Spectator shape captured 2026-09-08 (M2.13). |
| M1 Foundation | done | M1.1 to M1.10 done; M1.1 to M1.11 done (M1.11 landed 2026-09-09; the wildcard allow-list entry can be removed). Hosted Supabase project linked and migrated (0001, 0002); Discord OAuth app not yet created. Can run in parallel with M0. |
| M2 Companion v1: roster and results | in progress | M2.1 to M2.5, M2.7 to M2.10, M2.13 to M2.15, M2.18 to M2.20 done; M2.6 built as Kustom.exe 0.1.3 (apps/companion/dist, sha256 ffe6345e…), publish (v0.1.3, plus the kustom-releases README rename) and the Windows run pending on the user. **0.1.5 released 2026-09-15** (the user; `pnpm --filter companion release`, tag published on `kustom-releases`), the bump M4.1's gate flip owed, carrying `LOBBY_WRITE_VERIFICATION.verified: true`. The release itself hasn't been run against a real lobby yet — see M4's row for what that observation would and wouldn't confirm. M2 ticks after Session 2 of docs/06-test-night.md. |
| M3 Teams in Discord and on the web | in progress | M3.0 to M3.5, M3.7, M3.8, M3.10 to M3.24 done; the whole web is Floodlit as of 2026-09-10 (shell, tonight page, leaderboard, player page, rail). M3.6 (migration 0009), M3.25, M3.27, M3.28, M3.29 landed. M3.26 and M3.30 landed 2026-09-11. Nothing calls `/api/cron/leaderboard` yet. **M3.31 landed 2026-09-15**: `Teams are 92% even.` under the balanced teams' explanation, one more line computed from the `blue_win_prob` the split already stores — reopened M3 rather than belonging in M8, and it does not change the rating model, the balancer's choice of split, or the Discord embed. |
| M4 Lobby automation, voice split, presence | in progress | **M4.1 done 2026-09-12**: companion and server halves landed (migration 0006 on kustom); the first live verify-commands (16.17, 2026-09-09) got 500 INVALID_LOBBY with the community body, so 0.1.4 carried a corrected probe built from the client's own lobby UI code, and the rerun on 16.18 (2026-09-12) had all three writes accepted first try (200/200/204) — both gates and the three reference rows are green. M4.2 server side and M4.9 lock index landed 2026-09-10 (migrations 0006 and 0008 on kustom; page control pending on the web engineer). Next: M4.3. Needs M3. M4.7a control and M4.10 lobby line landed 2026-09-11. M4.7 both halves landed 2026-09-11. M4.12 landed 2026-09-11. **The companion rebuild landed 2026-09-15**: 0.1.5 released (tracked on M2.6), carrying `LOBBY_WRITE_VERIFICATION.verified: true` for all three kinds instead of 0.1.4's stale `false` — the underlying writes were already verified by M4.1's probe on 16.18 (2026-09-12); this rebuild only ships that already-green flag to the group's own exe. **Not yet observed: an actual nightly session run end-to-end on 0.1.5** — nobody has watched the server queue a real command and the companion execute it outside the probe, which is a real-world confirmation worth having but not a named task blocking anything below. **M4.8 landed 2026-09-15** (product doc: three things a person can change, nightly loop step 2; no decision row — the admin-only gating was already recorded twice on 2026-09-10). Remaining: M4.11, independent of that observation (and M4.3's acceptance 7, which is M4.11), plus M4.2's own two open pieces — widening the press to linked players, unblocked since M3.6 landed and proposed as M4.13, and the live check. **M4.13 scoped 2026-09-15** (product): the press moves to `POST /api/me/lobbies/start` and the control is drawn for any linked viewer, not only admins — `platform-engineer` for the route, `web-engineer` for the control, **dispatched only after M4.11 lands** because both work in `apps/web/app/_tonight/`. |
| M5 Backfill, windows, stats | in progress | M5.1, M5.2, M5.11 landed (backfill walker, scan route, approval toggle, rebuild-ratings, dropped lobby status); migrations 0004 and 0005 pushed to kustom. **Reshaped 2026-09-10**: seasons are gone (M5.3 dropped, ratings never reset) and the board is read through time windows instead — M5.9 boundaries, M5.12 picker, M5.10 + M5.13 the automatic weekly and monthly Discord post, M5.14 removes season creation. Roles become inferred from play (M5.16 to M5.18) and `/p/[puuid]` explains a rating (M5.15). M5.4 to M5.7 need M3. Independent of M4. M5.17 inferred roles stored (migration 0010 on kustom) and M5.18 mechanism landed 2026-09-10; M5.9/M5.12/M5.14 windows in progress. M5.5 missed-game report landed 2026-09-10. M5.9, M5.12, M5.14 windows landed 2026-09-10; M5.13 and M5.10 landed 2026-09-11 (migration 0011 on kustom, Vercel Cron daily 04:30 UTC); M5.15 and M4.7 in progress; next M5.4, M5.8. M5.4 /stats and M5.8 landed 2026-09-11. M5.7 stored seed landed 2026-09-11 (migration 0012 on kustom). M5.20 and M5.22 landed 2026-09-11. M5.21 and M5.23 landed 2026-09-11. M5.24 `/fun` landed 2026-09-12. M5.25 `/games` landed 2026-09-12. M5.26 Rift/ARAM split on `/games` and `/fun` landed 2026-09-12. M5.27 `/fun` first blood, deaths, steals and fear bans from `games.raw` landed 2026-09-12. M5.28 `/fun` This game expand landed 2026-09-12. M5.29 `/fun` museum groups, steal names, champion tables and display roles on the open scoreboard landed 2026-09-12. M5.30 `/leaderboard` per-game expand landed 2026-09-13. M5.31 `/fun` OTP vs variety pools landed 2026-09-13. M5.32 Daily Mystery landed 2026-09-13 (migration 0013; `/` card + `/mystery`; civil midnight in `CUSTOMS_NIGHT_TZ`; Vercel Cron `0 21,22 * * *` plus lazy create on first GET). M5.33 `/fun` lucky trash vs most robbed landed 2026-09-13. **M5.34 landed 2026-09-15: the week starts on Sunday, not Monday** (the user; Egypt's week) — a `weekStart` anchor change with no schema, no rating and no cron-schedule change, landed before M7.3, which reseeds the weekly rating on that boundary; the hosted flip-day overlap was stamped so no duplicate board reached the channel. Open: M5.6 (needs a client), M5.18 table (needs a capture night). **M5.35 added 2026-09-15** (the user, off product's role-detection research): two extra lines to read off the M5.18 capture night — whether `gameData.teamOne[]/teamTwo[].selectedPosition` is a real per-player role at `GameStart` or leftover queue preference. It rides on that night, adds no endpoint, no companion behaviour and no release, and cannot be dispatched before the recording exists. It was paired with **M7.12** as an input to a possible future **M7.13** — **M7.12 landed and M7.13 is now scoped** (the role-bucketed performance weights, 2026-09-15), and it is scoped off `detectedTeamPosition` alone, so **M5.35 is not blocking it**. What M5.35 would still buy is a role for games the end-of-game block never covered; and note that until **M5.18** gives backfilled games a role at all, M7.13 gives those games no MVP, on purpose. |
| M7 Ratings that are fair | in progress | Opened 2026-09-15 from the user's four settled decisions after a week of customs left the group calling the ratings unfair. Eleven tasks at the start, grown to fourteen the same day as role-detection research (M7.12), the role-bucketed formula it unblocked (M7.13) and that formula's own seventh-component follow-up (M7.14) each turned into real tasks: **M7.1** ARAM never rates (the bug; land it first), **M7.2** to **M7.4** a second weekly rating track that never forms teams, **M7.5** and **M7.6** decaying fill protection, **M7.7** to **M7.9** the MVP / ACE bonus (M7.7 is the blocking persist), **M7.10** the post and the player page name the MVP and the ACE, **M7.11** the single `rebuild-ratings` run that closes the milestone. Three later resolutions, 2026-09-15: **one rebuild at the end and none per fix**, **no monthly track** (the month windows keep the all-time number, decided, not deferred), and **the bonus is surfaced, not silent**. Every task changes the rating model, which is why none of them is an M5 task. **Runs before M6**, which is still waiting on a month of M2. **M5.34 (the week starts on Sunday) lands before M7.3**: M7.2 to M7.4's briefs were amended 2026-09-15 to say Sunday wherever they named the week's reset day. **M7.1 landed 2026-09-15.** M7.7's verification half landed the same day (vision score / damage-mitigated corroborated for real ten-player customs; no companion release owed). M7.2 (the weekly rating fold) landed 2026-09-15. **M7.5 landed 2026-09-15**: fill protection in `packages/core`'s balancer, `config.balance.fillProtectionFactor` (1.0), charged once and read from both `assignRoles` and the split score so the two cannot drift. **M7.8 landed 2026-09-15**: `rating/performance.ts` — `performanceScores`, `mvpAce`, `applyMvpAceBonus`, `config.rating.performance` and `config.rating.mvp`; `rateGame` untouched, `sigma` untouched, no MVP at all for a game missing any component; wired into nothing until M7.9. **M7.7 landed 2026-09-15**, both halves: migration `0014` adds `vision_score` / `damage_self_mitigated` to `game_players` nullable with no default, ingest fills both off the posted `raw` block through the one existing reader, and the reviewer's blocking find — a negative or out-of-int4 number in a blob 500ing ingest for ever — is gated by `storedStat` with a regression test. Pushed to the hosted project the same day; `pnpm --filter web copy-raw-stats` ran against it (44 games with a gap, all 44 fillable, 436 rows filled, 0 rows still short) and a second run confirmed idempotent. **M5.34 (the week starts on Sunday) landed 2026-09-15**, including the hosted `window_posts` stamp that suppresses the overlapping Monday-anchored week. **M7.6 landed 2026-09-15**: `gamesSinceLastFill` computed in `apps/web/lib/ingest/balance.ts` and handed to the balancer, live in the balance path immediately — no rebuild needed, since it is a balancer input, not part of the fold. **M7.3 landed 2026-09-15**: the weekly board reads the weekly rating; see its own checkbox for detail. **M7.4 landed 2026-09-15**: `Most improved` on a week reads the weekly climb through M7.3's fold; see its own checkbox for detail. **M7.3's sort key was settled 2026-09-15 before dispatch: the two week windows sort on `Rating`, not on Proven** (the user; decision row, `00-product.md` carve-out, brief, copy and acceptance all rewritten the same day — M7.2's output is unaffected, this is only what M7.3's board sorts and prints). **M7.12 added 2026-09-15** (the user, off product's role-detection research): a read-only measurement of how good `detectedTeamPosition` actually is on ten-human customs. It changes nothing, owes no rebuild, does not wait on M7.11 — and **blocks every role-aware proposal** until it lands. **M7.12 landed 2026-09-15** and the answer was good enough: 23 real ten-human customs, five distinct roles on 46 of 46 sides, 0 nulls, Smite agreeing 46 of 46, with one recorded limit — nothing in the blob separates top from mid. **M7.13 was scoped the same day off it** (the design is the user's, approved after reading that answer): the performance score reads the role. M7.8's single flat weight vector becomes three, keyed by a role bucket — `carry` (top, mid, adc, lumped on purpose because that is the one distinction M7.12 could not make), `jungle`, `support` — with the same six components, the same within-game normalisation, the same 1.25× / 0.80×, and **no MVP at all for a game where any of the ten has no role**, which is M7.8's existing missing-input rule applied to a new input and not a second model. It **revises M7.8 in place rather than layering**, because nothing M7.8 produced has ever reached a player, and it therefore **lands before M7.9**. Two steps: the pure formula in `packages/core` (`core-engineer`), and a read-only battle test of the new picks against the old ones over the same 23 games (`platform-engineer`, no writes, no rebuild). One open sub-question it carries: whether `damageDealtToObjectives` is real in both stored shapes and worth a seventh component for the jungle row — verified first, and if it checks out it opens **M7.14** (the column, the copy and the reweighted jungle row, both pre-answered in M7.13's brief) rather than dragging a migration into a core task. **M5.35 is not a dependency of any of it.** **M7.13 landed 2026-09-15**: the three-vector formula, `config.rating.performanceBucket`'s role-to-bucket map, and the missing-role rule, all in `packages/core`, reviewed clean; step 1 answered the same day — a hosted-DB read (44 stored games, both shapes) confirms `damageDealtToObjectives` is real, non-zero on 98%+ of rows, and genuinely per-player (distinct-value count equals participant count on every game checked) — see `03-lcu-reference.md`; and the read-only battle test against M7.12's 23 games closed the same day (6 of 23 MVPs moved, 7 of 23 ACEs moved, recommendation to proceed). **M7.14 was scoped 2026-09-15** off the step-1 answer: damage to objectives as a seventh component, `0.15` in the jungle vector and `0.00` in `carry` and `support` (the user's pre-answered weights from M7.13's brief, repeated verbatim, not re-derived), which needs a nullable `damage_to_objectives integer` column on `game_players` at the next free migration number, an ingest fill off the posted `raw` block (no mapper change, no companion release — the 2026-09-15 decision stands), the existing `copy-raw-stats` extended to a third column, and then the core change. **Two product decisions in it**: the missing-input rule stays **universal** — a null on a *carry*, whose weight on it is 0.00, still means the game has no MVP, because the normalisation denominator is the whole game and because a weight-scoped rule would let a `config.ts` nudge change which past games are scorable; and **M7.14 does not gate M7.9 or M7.10** (M7.13 did, because it replaced the formula; this adds to a settled one) but **must land before M7.11**, or the milestone owes a second rebuild. Its halves are ordered: migration + ingest + copy first, core only once the copy reports **zero rows still short**, so no stored game is ever blanked. **M7.13's battle test ran 2026-09-15**, before M7.14's core half, so M7.13's brief's own amendment means M7.14 owes a short jungle-only addendum to it rather than a second full run. Next: M7.14's build (`platform-engineer` half, then `core-engineer` half), the addendum, then M7.9 (needs M7.7 ✓, M7.8 ✓ and M7.13 ✓), M7.10, M7.11. M7.12 already landed, independently. |
| M8 The day after: rivals, awards, a second guessing game | in progress | Opened 2026-09-15 from four ideas of the user's, all four settled with them the same day. **M8.1** nemesis and best duo on `/fun`; **M8.2** won against the odds — the honest "best comeback", read from the stored `blue_win_prob` so a rebuild cannot move it (**confirmed by the user over the literal biggest-`mu`-swing version**); **M8.3** the existing awards as badges on `/leaderboard`'s closed windows, placement only, because most improved and longest streak already shipped in M5.4; **M8.4** Guess the Award, and **the two games alternate civil days** (the user, 2026-09-15) — one challenge per day as today, so `daily_mysteries.day` keeps its unique and the only migration is additive (`kind`, a widened `category` check, `(kind, challenge_number)`). The fourth idea, the balance percentage, is **M3.31** and not here. Every task is a read over stored games; none touches the rating model. **Starts after M7 clears `apps/web`** (M8.1 to M8.3 after M7.4; M8.4 after M7.9). **M8.1 landed 2026-09-15.** **M8.2 landed 2026-09-15**: "Won against the odds" on `/fun`, read from the chosen split's stored win chance, never a live recompute. **M8.3 landed 2026-09-15**: badges on `Last week`/`Last month` board rows via a second, parallel award read (see its own checkbox and the decision row for why). Only **M8.4** remains, waiting on M7.9. Nothing in M8 is waiting on an answer. |
| M9 Does coming back after a break break the rating? | not started | The user asked on 2026-09-15 for `sigma` decay after a layoff and settled the same day that **the measurement comes first**. **M9.1** is that measurement and is a real task: a read-only script over the hosted project that counts 14-day-plus returns and compares the first game back against ordinary games **at the same `sigma`**, run **after M7.11** so it measures the model the group is actually on. It changes nothing and decides nothing. **M9.2**, the decay function itself, has no brief and is not to be picked up until the user has read M9.1's numbers — it would move Proven and the balancer's inputs, the one thing all four of M7's changes avoided, and it would want a second rebuild after M7.11 was meant to be the only one. Paste M9.1's numbers into this row when it lands. |
| M6 Tray app and polish | not started | Needs M2 stable for a month. |

Update this table as tasks complete. Status values: `not started`, `in progress`, `blocked: <why>`, `done`.

---

## M0 Spike: verify the client (1 to 2 days, needs a Windows PC with League)

Goal: turn every `unverified` row we need for M2 in `03-lcu-reference.md` into `verified`, with fixtures.

Tasks:

- [x] **M0.1** `packages/lcu` skeleton: lockfile discovery, basic-auth HTTPS client, WebSocket subscriber, a `smoke` script that hits each endpoint in the reference and writes the raw JSON to `packages/lcu/fixtures/<patch>/<endpoint>.json`.
- [x] **M0.2** Run the smoke script through a full custom game: open lobby, fill it (even with two people and eight empty slots is enough for shapes), play or remake, reach end of game. Capture the WS event stream to a file.
- [x] **M0.3** Answer the eight questions in "Behaviors to confirm" in `03-lcu-reference.md`. Update every status column. Write zod schemas for the endpoints we keep, tested against the fixtures.
- [x] **M0.4** (resolved: custom games do appear in match history, 17 of 21 in the 16.17 capture; backfill stays in M5) If custom games do not appear in match history, record it in `04-decisions.md` and remove backfill from M5; the end-of-game path is then the only source and the companion rule ("lobby owner runs it") becomes mandatory in the product doc.

Acceptance: `pnpm --filter lcu test` passes against fixtures; the reference doc has no `unverified` rows for lobby, gameflow, eog, current-summoner, ranked-stats.

## M1 Foundation (2 to 3 days)

Goal: the monorepo, the database, and the pure core with tests. No client needed.

- [x] **M1.1** Monorepo: pnpm workspaces, TypeScript project references (dropped, see decisions 2026-09-08: source-shipping packages, `tsc --noEmit`), Biome, vitest, `apps/web` (Next.js App Router), `packages/core`, `packages/db`, `packages/lcu` (from M0 or a stub). Root scripts listed in `CLAUDE.md` all exist.
- [x] **M1.2** Supabase project, migration `0001_init.sql` with the schema in `01-architecture.md`, RLS policies, generated types, `pnpm db:migrate` and `pnpm db:types`.
- [x] **M1.3** `packages/core/rating`: seed from tier, `rateGame`, `ordinal`, `displayRating`, `predictWin`. Tests: seeds match the table; a Bronze on the winning side gains more than a Master beside them; ten games converge a mis-seeded player.

    > **Brief (product, 2026-09-08)**
    >
    > **Seed table, divisions spelled out.** Seed `mu` from `players.rank_tier` + `players.rank_division` at
    > first sight. Division IV is the tier base; add 0.75 per division above IV.
    >
    > | Tier | IV | III | II | I |
    > |---|---|---|---|---|
    > | Iron | 14.00 | 14.75 | 15.50 | 16.25 |
    > | Bronze | 17.00 | 17.75 | 18.50 | 19.25 |
    > | Silver | 20.00 | 20.75 | 21.50 | 22.25 |
    > | Gold | 23.00 | 23.75 | 24.50 | 25.25 |
    > | Platinum | 26.00 | 26.75 | 27.50 | 28.25 |
    > | Emerald | 29.00 | 29.75 | 30.50 | 31.25 |
    > | Diamond | 32.00 | 32.75 | 33.50 | 34.25 |
    >
    > Master, Grandmaster and Challenger are all 35.00 with **no division bonus** (they have no divisions; if the
    > client reports one, ignore it). Unranked, or any tier string we do not recognise, is 20.00.
    >
    > **Seed sigma.** 8.33 for any ranked seed. 10.00 for unranked/unknown. Nothing else.
    >
    > **Functions.**
    > - `seedFromRank(tier, division) -> { mu, sigma }`. Pure lookup, no clamping, no rounding.
    > - `rateGame(blue, red, winningSide) -> { blue, red }` where `blue`/`red` are five `{ mu, sigma }` in input
    >   order and `winningSide` is `100` or `200`. Returns new ratings in the same order. **There is no draw
    >   path** — a League custom cannot draw, and a remake is not a game (the API drops it before this call).
    > - `ordinal({ mu, sigma }) -> mu - 2 * sigma`.
    > - `displayRating(mu) -> Math.round(mu * 60)`.
    > - `predictWin(blue, red) -> number`. **Blue's probability first**, a single number in `[0, 1]`. Red's is
    >   `1 - it`. Takes the real `{ mu, sigma }`, never the role-adjusted effective skill.
    >
    > **Tests, exactly.**
    >
    > 1. *Seeds match the table.* Every cell above, plus Master/GM/Challenger = 35.00, plus unranked = 20.00 with
    >    sigma 10.00, plus a garbage tier string = 20.00 with sigma 10.00.
    > 2. *A Bronze on the winning side gains more than a Master beside them.* This only holds when their sigmas
    >    differ — OpenSkill moves `mu` in proportion to the player's own `sigma^2`, not their rank, so two
    >    players with the same sigma on the same winning team gain the identical amount. Pin the setup:
    >    the Bronze II is freshly seeded (`mu 18.50, sigma 8.33`), the Master is settled (`mu 35.00, sigma 3.50`),
    >    they are on the same team with three `mu 25.00, sigma 5.00` teammates, the other five are all
    >    `mu 25.00, sigma 5.00`, and their side wins. Assert `muAfter - muBefore` is strictly larger for the
    >    Bronze. Do not "fix" this by giving them equal sigmas and asserting something weaker.
    > 3. *Ten games converge a mis-seeded player.* Setup: `P0` seeded Iron IV (`mu 14.00, sigma 8.33`), plus ten
    >    other players, all settled Gold IV (`mu 23.00, sigma 3.50`). That is eleven people in the room, so
    >    exactly one of the ten others sits out each game — same as a real night with eleven around. Ten games;
    >    in game `k` (0-indexed), `P0`'s team is `P0` plus players `1 + (k % 10)`, `1 + ((k+1) % 10)`,
    >    `1 + ((k+2) % 10)`, `1 + ((k+3) % 10)` (wrapping, skipping `P0`), the next five in the same wrap
    >    (`1 + ((k+4) % 10)` through `1 + ((k+8) % 10)`) are the opponents, the one left over sits, and `P0`'s
    >    side wins every time. Assert all three, with the numbers below pinned exactly (measured against
    >    `openskill` 5.0.1, M1.3):
    >    - `mu(P0)` strictly increases after every game;
    >    - `sigma(P0)` strictly decreases after every game. It is `6.4704` after game 10 and **first drops below
    >      5.00 in game 36 of this setup** (26 games if the wins alternate between the sides instead of `P0`'s
    >      side winning every one). Ten games settle a mis-seeded player's `mu`, not their `sigma`.
    >    - `mu(P0)` crosses 23.00 — the Gold IV seed — in game 4, and is `34.09` after game 10.
    >
    >    These are the model's real behaviour, not targets. If one of them fails against the `openskill`
    >    package, **do not lower the number.** Record the game count it actually takes, report it to the lead as
    >    a finding, and leave the test failing or skipped with the real number in a comment — "how many games a
    >    smurf distorts teams for" is a product fact we want to know, not a test to tune.
    >
    > **Out of scope for M1.3.** Season resets (M5.3), the rating-rebuild fold (M5.2), any database or API call,
    > and anything that reads the clock. `rateGame` is a pure function of its arguments.

- [x] **M1.4** `packages/core/balance`: partition enumeration, role assignment, scoring, top three, explanation string, reroll. Tests: the worked example from the product vision (ten named players with ranks) yields a gap of 100 with everyone on a main role; duo lock is respected; repeat-split penalty changes the choice; nine or eleven players throws.

    > **Brief (product, 2026-09-08)**
    >
    > ### What a player sees
    >
    > Ten friends are in a custom lobby. Nobody typed anything. Within a few seconds Discord shows two teams of
    > five, each with a role next to the name, a win chance, a gap number, and one line saying what the next
    > best teams would have been. If someone shouts "rigged", an admin taps reroll and the second-best split
    > goes up instead. That is the whole feature. `packages/core/balance` is the part that turns ten players
    > into those three splits and those three sentences. It touches nothing else.
    >
    > ### Input
    >
    > `balance(input)` where `input` is:
    >
    > - `players` — exactly ten. Each: `puuid` (string, the identity), `name` (string, `players.display_name`,
    >   used only in the explanation), `mu` (number), `sigma` (number), `mainRole` (role or `null`),
    >   `secondaryRole` (role or `null`), `roleOverride` (role or absent).
    > - `duos` — array of `[puuidA, puuidB]` pairs that must land on the same team. May be empty. May be absent.
    > - `lastSplit` — the five puuids that were on **one** side of the last chosen split for this group, or
    >   `null`. Side colour is not part of it.
    >
    > Roles are `'top' | 'jungle' | 'mid' | 'adc' | 'support'`.
    >
    > ### Output
    >
    > `{ splits, explanations }` — `splits` is one to three entries, best first. Each split:
    >
    > - `blue` — five `{ puuid, role }`, `red` — five `{ puuid, role }`
    > - `gap` — integer, display-rating units (see "Numbers" below)
    > - `blueWinProb` — number in `[0, 1]`, blue's chance
    > - `score` — number, unrounded, the value that ordered the list
    > - `offRoleCount` — integer, 0 to 10
    >
    > `explanations[i]` is the sentence for `splits[i]`. Store all three in the `splits` table so reroll and the
    > tonight page never recompute.
    >
    > ### Numbers, stated once so the tests can pin them
    >
    > - Effective skill of a player on a role, in **display units**: `mu * multiplier * 60`, multiplier `1.00`
    >   main, `0.93` secondary, `0.85` anything else.
    > - Per team, pick the role assignment (all 120 permutations) that maximises
    >   `sum(effective) - 120 * offRoleCount(thisTeam)`.
    > - `rawGap = |sum(blueEffective) - sum(redEffective)|`, unrounded, display units.
    > - `score = rawGap + 120 * offRoleCount + 200 * isRepeatOfLastSplit`. A split that separates a duo is not
    >   scored at all — it is never generated.
    > - `gap = Math.round(rawGap)`. Rounding happens once, for display only.
    > - `blueWinProb = predictWin(blue, red)` on the real `{ mu, sigma }`, never on effective skill.
    > - **Enumeration and side colour.** Sort the ten players by `puuid` ascending first, so the same ten in any
    >   order give byte-identical output. Then enumerate the 126 partitions as: player `[0]` is always on blue,
    >   choose four of the remaining nine to join them. That fixes which side is blue without any other rule,
    >   and lets red be the favoured side when the numbers say so.
    > - **Ties.** Lower `score` wins; then lower `offRoleCount`; then the lexicographically smaller sorted list
    >   of blue puuids. Deterministic, no randomness anywhere in this package.
    >
    > ### Role edge cases
    >
    > - `mainRole: null` (a friend nobody has set up yet) means **flexible**: every role is a main for them,
    >   multiplier `1.00`, never counted off-role. A new face must never make the night worse.
    > - `mainRole` set, `secondaryRole: null`: every non-main role is `0.85` and off-role.
    > - `roleOverride` present: **the override becomes the main; the usual main becomes the secondary; the
    >   declared secondary drops to `0.85`.** One line to explain to a friend — "the role you tapped is your
    >   role tonight, your usual role is your backup" — and it never punishes someone for their real strength.
    > - `roleOverride` equal to the existing main is a no-op.
    >
    > ### Duos
    >
    > A duo is two puuids that must be on the same team. Colour does not matter. Build connected components
    > with union-find (`[A,B]` and `[B,C]` means A, B and C are one block), then keep only the partitions where
    > every block sits entirely on one side. Everything else is discarded before scoring — there is no
    > "infinite penalty" number in the code, just a filter.
    >
    > If no partition survives — a block larger than five, or blocks whose sizes cannot be packed into 5 and 5,
    > for example sizes `4, 4, 2` — throw `BalanceError('Duo locks cannot fit five and five: <names of each
    > block>')`. Do not silently drop a duo. The API turns this into a Discord line the group can act on.
    >
    > ### Repeat-split penalty
    >
    > "Same as last night" means **the same five people together**, regardless of side colour. A split is a
    > repeat if `set(blue) === lastSplit` or `set(red) === lastSplit`. Penalty `200` display points, added once.
    >
    > Tiny scenario that flips the choice, using the worked example below: pass
    > `lastSplit = [Hana, Iris, Karim, Bilal, Theo]`. Split 1 now scores `99.6 + 200 = 299.6` and falls to
    > fourth. The chosen split becomes the old split 2 (gap 170), then the old split 3 (gap 220), then an
    > off-role split scoring 244.92. That is the whole test.
    >
    > ### Explanation string
    >
    > One line, clauses joined by a single space, each clause ending in a full stop. Numerals throughout.
    >
    > 1. **Win chance.** `p = Math.round(blueWinProb * 100)`. If `p > 50`: `Blue favored {p}%.` If `p < 50`:
    >    `Red favored {100 - p}%.` If `p === 50`: `Even 50%.`
    > 2. **Roles.** If `offRoleCount === 0`: `Everyone on a main role.` If `1`: `{Name} off-role at {role}.`
    >    If `2` or more: `{n} off-role: {Name} at {role}, {Name} at {role}.` — blue's players first, then red's,
    >    each side in role order top, jungle, mid, adc, support.
    > 3. **Gap.** `Gap {gap}.`
    > 4. **Next best.** Compare this split with the next one in the stored list. Align them first: take
    >    whichever of the next split's two sides overlaps this split's blue more. Let `k` be the number of
    >    players who move.
    >    - `k === 1`: `Next best: swap {name leaving blue} and {name joining blue}, gap {gap}.`
    >    - `k >= 2`: `Next best: {k} swaps, gap {gap}.`
    >    - If the next split has a different `offRoleCount`, append it before the full stop:
    >      `..., gap {gap} with {n} off-role.` (The next best can have a smaller gap and still be worse,
    >      because off-role costs 120 a head. Saying so is the point of the line.)
    >    - If there is no next split — this is the last of the three, or duo locks left only one — omit
    >      clause 4 entirely. No "no alternatives" filler.
    >
    > Names come from `name` as given. Core does not deduplicate identical names.
    >
    > ### The worked example
    >
    > Also in `00-product.md` under "Worked example". Ten friends, a few weeks into the season, so `mu` has
    > drifted off the seed. Puuids are `puuid-<lowercase name>`, which makes the sort order alphabetical and
    > puts Bilal at index 0, hence on blue.
    >
    > | Name | Rank | Seed mu | Current mu | sigma | Display | Main | Secondary |
    > |---|---|---|---|---|---|---|---|
    > | Bilal | Platinum I | 28.25 | 28.55 | 4.80 | 1713 | adc | mid |
    > | Hana | Gold III | 23.75 | 23.90 | 4.60 | 1434 | top | mid |
    > | Iris | Platinum IV | 26.00 | 26.30 | 4.90 | 1578 | jungle | top |
    > | Karim | Gold I | 25.25 | 25.85 | 4.70 | 1551 | mid | adc |
    > | Lena | Master | 35.00 | 34.80 | 4.50 | 2088 | adc | jungle |
    > | Nadia | Silver III | 20.75 | 21.10 | 5.10 | 1266 | mid | support |
    > | Omar | Gold II | 24.50 | 24.49 | 4.60 | 1469 | top | support |
    > | Rami | Platinum III | 26.75 | 27.30 | 4.80 | 1638 | jungle | mid |
    > | Theo | Gold III | 23.75 | 23.65 | 4.90 | 1419 | support | adc |
    > | Yuki | Bronze II | 18.50 | 18.90 | 5.00 | 1134 | support | top |
    >
    > Two mains per role, no duos, no overrides, `lastSplit: null`.
    >
    > **Split 1** (chosen). Gap **100**, everyone on a main role.
    >
    > | | Blue | Red |
    > |---|---|---|
    > | top | Hana | Omar |
    > | jungle | Iris | Rami |
    > | mid | Karim | Nadia |
    > | adc | Bilal | Lena |
    > | support | Theo | Yuki |
    >
    > Blue mu sum `128.25`, red `126.59`, difference `1.66`. In display units `1.66 * 60 = 99.6`, and
    > `Math.round(99.6) = 100`. `offRoleCount 0`, so `score = 99.6`.
    >
    > **Split 2.** Swap Hana and Omar. Gap **170** (`2.84 * 60 = 170.4`), everyone still on a main role,
    > `score = 170.4`.
    >
    > **Split 3.** Split 1 with both the top pair and the jungle pair swapped: blue Hana, Rami, Karim, Bilal,
    > Theo. Gap **220** (`3.66 * 60 = 219.6`), everyone on a main role, `score = 219.6`.
    >
    > The next best split after those three is off-role and scores `244.92`, so the top three are stable: any
    > split with someone off-role costs at least `240` before its gap is counted, and all three of these are
    > below that. The roster was built that way on purpose — the test must not depend on a coin-flip between an
    > off-role split and an all-main one.
    >
    > **Expected explanations**, in order:
    >
    > ```
    > Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.
    > Blue favored 57%. Everyone on a main role. Gap 170. Next best: 2 swaps, gap 220.
    > Blue favored 59%. Everyone on a main role. Gap 220.
    > ```
    >
    > The percentages are the only figures here that come out of the `openskill` package rather than our own
    > arithmetic. They were computed as `Phi(dMu / sqrt(2 * beta^2 + sum of all ten sigma^2))` with
    > `beta = 25/6` and `sum(sigma^2) = 229.77`, giving `0.5406`, `0.5693`, `0.5890`. Each sits at least
    > 0.004 away from a rounding boundary, so a small implementation difference will not move the printed
    > number. Verify against the real package before pinning. If it disagrees, pin what the package returns,
    > update this brief and `00-product.md`, and add a row to `04-decisions.md` — do not adjust the roster.
    >
    > Note: `01-architecture.md` used to illustrate the format with a string ending "gap 300", written before
    > this roster existed. It now carries split 1's string above verbatim. If the real `openskill` package moves
    > a percentage, update both places together.
    >
    > ### Errors
    >
    > All throw `BalanceError` with a message a human can read:
    >
    > - `players.length !== 10` — "Balancing needs exactly ten players, got 9." Nine and eleven both throw.
    >   Deciding who sits is the API's job, not ours.
    > - Duplicate `puuid` in `players` — "Duplicate player: <puuid>."
    > - A `duos` entry naming a puuid that is not in `players` — "Duo names someone not in the lobby: <puuid>."
    > - A `duos` entry naming the same puuid twice.
    > - Duo locks with no legal partition, as above.
    > - `lastSplit` that is not five puuids drawn from `players` — throw rather than ignore; a bad `lastSplit`
    >   silently ignored means the repeat penalty quietly stops working and nobody notices for a month.
    >
    > ### Reroll
    >
    > `nextSplit(splits, currentIndex) -> number`. Returns `currentIndex + 1` while one exists; throws
    > `BalanceError('No more splits. Rebalance or play these.')` at the end of the list. It never reshuffles,
    > never randomises, and never calls `balance` again. Two people pressing reroll twice get the same third
    > split, not a new one.
    >
    > ### Tests, exactly
    >
    > 1. The worked example returns three splits with gaps `100`, `170`, `220`, all with `offRoleCount 0`, the
    >    exact rosters and roles in the tables above, and the three explanation strings verbatim.
    > 2. Feeding the same ten players in a shuffled order returns identical output, field for field.
    > 3. `duos: [[Hana, Lena]]` — every returned split has Hana and Lena on the same side, and split 1 is the
    >    base split 2 (blue Omar, Iris, Karim, Bilal, Theo; gap 170, `offRoleCount 0`).
    > 4. `duos: [[Hana, Omar]]` — the two top mains locked together. Split 1 has gap 26 with `offRoleCount 2`
    >    (Hana at mid, Nadia at top). Assert only split 1; splits 2 and 3 tie on score here and are settled by
    >    the tie-break, which is not worth pinning.
    > 5. Duo locks that cannot fit: blocks of 4, 4 and 2 throw, and the message names the blocks.
    > 6. `lastSplit = [Hana, Iris, Karim, Bilal, Theo]` — split 1 becomes the base split 2 (gap 170). Passing
    >    the red five of the base split 1 instead produces the same result, proving side colour is ignored.
    > 7. `roleOverride: top` on Yuki — split 1 has gap 98 and `offRoleCount 1`, Yuki at top on red, Omar at
    >    support on blue, and the explanation reads
    >    `Blue favored 58%. Omar off-role at support. Gap 98. Next best: 2 swaps, gap 4 with 2 off-role.`
    > 8. Nine players throws. Eleven players throws. Duplicate puuids throw.
    > 9. A player with `mainRole: null` is never counted in `offRoleCount` and can be placed in any role.
    > 10. `nextSplit` walks 0 to 1 to 2 and then throws.
    > 11. Performance: balancing ten players stays under 100 ms on a laptop. One `expect` on elapsed time is
    >     enough; this runs on a Vercel function while ten people wait.
    >
    > ### Out of scope for M1.4
    >
    > - **Who sits out.** More than ten people around is the API's problem (M2.5, sit-out logic). Core sees ten
    >   or throws.
    > - **Someone leaves mid-lobby, the companion disconnects, a lobby goes stale.** All lobby-state machine,
    >   M2.5. Core has no memory between calls and no clock.
    > - **Unknown player.** Core handles a null `mainRole` and that is all it needs to know. Creating the row,
    >   fetching their rank, and seeding their rating is M1.5 and M2.4.
    > - Persistence of the three splits (`splits` table, M1.5/M3.1), Discord embed layout (M3.0/M3.1), the
    >   reroll button and route (M3.2), the tonight page (M3.4), and choosing `lastSplit` from history (M2.5).
    > - Tuning any constant. `1.00 / 0.93 / 0.85`, `120`, `200` and `* 60` are decided in `01-architecture.md`
    >   and `04-decisions.md`. Changing one is a decision row and a new task, not a commit.

- [x] **M1.5** `apps/web` API skeleton: companion token auth middleware, `POST /api/companion/lobby`, `POST /api/companion/game`, `POST /api/companion/rank`, all zod-validated, writing to Supabase with idempotency on `lcu_party_id` and `lcu_game_id`. Lazy player creation by PUUID.
- [x] **M1.6** (two halves removed later: *create a season* on 2026-09-10 — **M5.14**, the one season row is created once by migration and never again; *set roles* on 2026-09-10 — **M5.17**, roles are inferred from play) `/admin`: Discord OAuth via Supabase Auth, `is_admin` gate. Pages to list players, set roles, link a Discord ID, mint and revoke companion tokens, edit `discord_config`, create a season. Seed the first admin by PUUID in a migration or env var. The role editor must be able to clear a main or secondary role back to null, not only change it — a null main means flexible (M1.4), and there has to be a way back to it.
- [x] **M1.7** Give every player a name a friend recognises. `players.display_name` is written nowhere today: `ensurePlayers` only fills `summoner_id`, `game_name` and `tag_line`, and `/admin/players` has no field for it, so every row lands with `display_name` null and stays that way. `/admin/players` shows `—` for every name, `/admin/tokens` shows an 8-character PUUID fragment, and M1.4's explanation string is built from `display_name` (M1.4 brief, "Input"), so the first Discord embed would read `Next best: swap  and , gap 170`. Fill `display_name` from the Riot `gameName` when a `players` row is created and when the client reports a changed `gameName`, and add a display-name field to the `/admin/players` row form so an admin can override it with what the group actually calls someone. An admin-set name is never overwritten by the client.

    > **Brief (product, 2026-09-08)**
    >
    > **What a player sees.** Their name, the one the group uses, in the teams post, on the tonight page and
    > on the leaderboard. Never a PUUID fragment, never a blank.
    >
    > **Behaviour.** On row creation `display_name` = the reported `gameName`, or null when the client
    > reported none (a PUUID first seen in an eog block has no name attached). On a later report, refresh
    > `display_name` only while it still equals the previously stored `gameName` — that is the "nobody has
    > overridden it" test — so a Riot ID change follows through but an admin's override survives it. Clearing
    > the admin field posts `""` and stores null, which puts the row back on automatic.
    >
    > **Edge cases.** A PUUID first seen in an eog block (no `gameName` in `companionGameParticipantSchema`)
    > keeps a null `display_name` until a lobby or rank post names them; every surface must still render
    > something, so keep the existing `displayName ?? gameName ?? shortPuuid` fallback chain and add
    > `gameName` to the `/admin/tokens` table, which skips it today. Two friends with the same `gameName` are
    > two rows with the same name; core does not deduplicate (M1.4) and neither does this — the admin field
    > is how the group breaks the tie. Renaming does not touch identity: PUUID is still the key.
    >
    > **Acceptance check.** Post a lobby of ten with `gameName` set: every `players` row has
    > `display_name = gameName`. Repost unchanged: no column changes (the M1.5 diff-before-write rule holds).
    > Set a name on `/admin/players`, then repost the lobby with a *different* `gameName`: `game_name` moves,
    > `display_name` does not. Clear the field: it goes back to null and the next lobby post refills it from
    > `gameName`. `/admin/players` and `/admin/tokens` show a readable name for every row in all of these.
    >
    > **Out of scope.** Nicknames per season, Discord display names (the group's Discord name is not the
    > League name and linking them is M1.6's `discord_id`), and any change to how a player is matched.

- [x] **M1.8** `POST /api/companion/lobby` must check the caller is in the lobby it is reporting. There is no check at all today: any valid companion token can post any `lcu_party_id` with any member list, and because `replaceMembers` deletes every member not in the posted list, one stale or buggy companion rewrites another lobby's roster. Verified 2026-09-08 against the local stack: a token for a player who is in no lobby posted the ten-player party with one member and the stored roster dropped from ten rows to one, HTTP 200. Refuse with 403 when the token's player PUUID does not appear in the posted `members` (`isSpectator: true` counts, matching M2.8's widened game rule). Record the rule in `04-decisions.md` and add it to the "Security" bullet in `01-architecture.md`, which today only covers games.

    > **Why (product).** M2.5 balances off `lobby_members` and M2.7 matches tonight's ten against history
    > from the same table. A roster any token can shrink is a roster the referee cannot trust, and the failure
    > is silent: teams get balanced for nine people and nobody knows why. This has to be decided before
    > anything reads that table to make teams.
    >
    > **Edge cases.** Fewer than ten members is normal and stays a 200 — the lobby is still filling. An empty
    > `members` array from a companion that is still in the lobby is the "everyone left" report and stays a
    > 200, but it can no longer come from an outsider, because an empty list cannot contain the caller.
    > A companion watching as a spectator posts itself with `isSpectator: true` and is accepted; if M0.3 finds
    > the client does not list a spectator among lobby members at all, that is a finding for the lead, not a
    > reason to drop the check. A second companion in the same lobby is unaffected: it is in the list.
    >
    > **Acceptance check.** A token whose player is in the posted `members` gets 200 and the roster is
    > replaced. The same token posting a `members` list that does not contain its own player gets 403 and
    > **no row in `lobbies` or `lobby_members` changes** — assert on the rows, not just the status. A token
    > whose player is in the list as `isSpectator: true` gets 200. Posting an unknown `partyId` with the
    > caller in the list still creates the lobby.

- [x] **M1.9** Rewrite the minted-token page for the friend who has to use it (`apps/web/lib/admin/tokenPage.ts`). It currently ends "Paste it into the companion's first-run prompt (`%APPDATA%/customs-night/config.json`)", which reads as if the file path is where you paste. Copy goes through product; the replacement wording is below and must ship verbatim.

    > **Copy (product, 2026-09-08).** Body, in order:
    >
    > - `<h1>` — `Companion token`
    > - `<p><strong>Copy it now.</strong> This is the only time it is shown — we only keep a scrambled copy, so we cannot show it to you again. Lost it? Mint another and revoke this one.`
    > - the `<code>` block with the token, unchanged
    > - the PUUID and Label list, unchanged
    > - `<p>` — `Start the companion and paste this in when it asks. It remembers it, so you only do this once.`
    > - `<p class="muted">` — `It saves it in %APPDATA%/customs-night/config.json if you ever need to find it.`
    > - the "Back to tokens" link, unchanged
    >
    > **Acceptance check.** The rendered page contains those sentences verbatim, the token still appears in
    > exactly one HTTP response and in no URL or cookie, and `renderMintedTokenPage`'s existing escaping test
    > still passes.

- [x] **M1.10** The placeholder tonight page (`apps/web/app/page.tsx`, from M1.1) renders "Nothing tonight yet." followed by a bare `<ul>` of `top jungle mid adc support` with no explanation, and `/admin` links friends to it as "Tonight". Anyone who opens the site during M2 sees what looks like a broken page. Pure copy until M3.4 replaces the page: keep the heading, replace the body with `Nothing tonight yet. When ten of you are in a custom lobby with the companion running, the teams show up here.` and drop the role list.

    > **Acceptance check.** `/` renders the heading and that one sentence, no role list, and nothing else.
    > `pnpm --filter web build` still passes. M3.4 replaces the whole page and this task is not a constraint
    > on it.


- [x] **M1.11** Discord sign-in never comes back to the hosted site. `/auth/signin` appends `?next=/admin` to the `redirect_to` it hands Supabase, so the allow-list entry `https://kustom-delta.vercel.app/auth/callback` never matches and Supabase silently falls back to the project's Site URL. Observed live 2026-09-08: signing in on the deployed site landed on `http://localhost:3000/?code=...`, which nobody can complete. **Fix:** `/auth/signin` stores `next` in a short-lived HttpOnly, same-site cookie (10 minutes) and sends `redirect_to` as the bare `<siteOrigin>/auth/callback`; `/auth/callback` reads and clears the cookie, validates that `next` is a same-origin path (leading `/`, no scheme, no `//`), and defaults to `/admin`. Owner: `web-engineer`, after the M2.5 work leaves `apps/web`.

    > **Why (product).** `/admin` is where a companion token is minted, and a token is the first thing a friend
    > needs. Today nobody can reach the admin page on the deployed site at all: the sign-in round trip ends on
    > somebody's localhost. That blocks the M2 test night as surely as a missing deployment does, and it is not
    > a thing a friend can work around.
    >
    > **Acceptance check.** The sign-in 303's `Location` carries a `redirect_to` with **no query string**. A
    > sign-in started from `/admin` lands on `/admin`; one started from another page lands on that page; with no
    > cookie at all the callback lands on `/admin`. A `next` of `https://example.com/x`, `//example.com/x` or
    > anything without a leading slash is ignored and the default is used. The cookie is `HttpOnly`, same-site,
    > and gone after the callback. The existing integration tests for the admin gate still pass. The hosted
    > allow-list then needs exactly one entry, `https://kustom-delta.vercel.app/auth/callback`: say so in
    > `apps/web/README.md` and delete the wildcard workaround note there.
    >
    > **Out of scope.** Anything else about the sign-in (providers, session length, the gate itself). The
    > deployment (the M2 precondition). Linking Discord ids (M1.6, done).

Acceptance: `pnpm -r test` green; a curl with a valid token creates a lobby row and a game row; a second identical curl changes nothing.

> **Acceptance evidence (product, 2026-09-08).** Walked against the running local stack, `pnpm --filter web dev`.
>
> - `pnpm -r test`: core 3 files, db 3 files / 42 tests, web 10 files / 116 tests all pass. `packages/lcu`
>   is 94 of 96 — the two failures are `lockfile.test.ts` and `cli/smoke.test.ts` asserting the League client
>   is *not* running on this machine, and it is. Fixed in a parallel task; not an M1 defect.
> - Lobby: `POST /api/companion/lobby` with a minted token, a ten-member party. First call
>   `created: true`, `memberCount: 10`; `lobbies` 0 -> 1, `lobby_members` 0 -> 10, `players` 1 -> 10 (the
>   token's own row already existed). Repeats returned `created: false` and a full `select *` snapshot of
>   `lobbies`, `lobby_members`, `games`, `game_players`, `players` and `ratings` was byte-identical across a
>   repost — `updated_at` included, so the M1.5 diff-before-write rule holds.
> - Game: `POST /api/companion/game` with a `CUSTOM_GAME` eog for the same party. First call
>   `created: true`, `participants: 10`; `games` 0 -> 1, `game_players` 0 -> 10, the row's `lobby_id`
>   resolved to the lobby above. Repeats `created: false`, same snapshot diff, empty.
> - Refusals behave as documented: no token 401, unknown token 401, bad body 400 with zod paths,
>   `gameType: MATCHED_GAME` 422, an eog the token's player is not in 403.
> - `ratings` stayed at 0 rows after a complete eog. That is correct for M1 — `rateGame` runs in M2.5.
> - Test rows were deleted afterwards; all seven tables are back to 0.
>
> Gaps found in the pass are M1.7 to M1.10 above, M2.9 and M3.9. None of them contradict the two clauses
> of this acceptance; M1.8 is the one that should land before M2.5 reads `lobby_members` to make teams.

## M2 Companion v1: roster and results (2 to 3 days, needs M0 and M1)

Goal: a friend runs one exe, and every lobby and game they are in lands in the database with no action.

- [x] **M2.10** Align the companion payload schemas with the real 16.17 client shapes. `packages/db/src/schemas/companion.ts` was written in M1.2 from the shapes in `03-lcu-reference.md`, before anyone had seen a real response, and M0.3's fixture pass found twelve places where the client disagrees. Fix the schemas, the mapping and the ingest together as one contract, first in M2: **M2.2 and M2.3 both build directly on these payloads and must not start before this lands.** Two owners on one contract — `platform-engineer` for `packages/db/src/schemas/` and the ingest side in `apps/web`, `companion-engineer` for the mapping in `apps/companion`. **Precondition:** `packages/lcu/fixtures/16.17/` must be committed (M0.2) and the lobby, eog and ranked rows in `03-lcu-reference.md` turned `verified` (M0.3); the acceptance check reads those fixtures and today the directory holds only `README.md`.

    > **Brief (product, 2026-09-08)**
    >
    > **The scene.** Nothing here is visible to a player, and that is the point: every one of these
    > mismatches ends the night the same way. The tenth friend joins, the companion posts, zod refuses the
    > payload, and Discord stays silent while ten people wait — or worse, the post is accepted and teams get
    > built with two bots and everyone on the same side. The contract has to match the client before anything
    > is built on it.
    >
    > **Lobby (`companionLobbyPayloadSchema`, `companionLobbyMemberSchema`).**
    >
    > 1. **`members[].summonerId` is a JSON number, not a string.** `optionalText` refuses a number, so today
    >    one real lobby response fails the whole payload. Accept `number | string`, normalise to a decimal
    >    string (`players.summoner_id` is `text`; no migration), null when absent. Do not drop the field —
    >    M4's invites are the only thing that needs it.
    > 2. **Lobby members carry no `gameName`/`tagLine`.** The client's lobby member has no Riot ID pair. The
    >    companion sends what it already has (its own `current-summoner`, anything it looked up via
    >    `GET /lol-summoner/v2/summoners/puuid/{puuid}`) and the server tolerates null for both. **Posting a
    >    lobby never waits on a name lookup.** PUUID is the identity; a roster with null names is a correct
    >    roster, and the names fill in from the next eog block or the M2.4 sweep. A lookup that fails, times
    >    out or 404s is logged once and the member still goes in the payload.
    > 3. **`side` comes from `gameConfig.customTeam100` / `customTeam200` membership.** `members[].teamId` is
    >    always `0` in a custom lobby and must never be read by anything, ever. A puuid in neither array is
    >    `side: null` (the client has not placed them yet) — that is a valid state, not an error. This answers
    >    question 3 of "Behaviors to confirm" in `03-lcu-reference.md`; M0.3 records the answer there.
    >
    > 4. **Bots have `isBot: true` and `puuid: ""`.** The companion drops them before posting. The server also
    >    drops any member with an empty or all-zero puuid rather than 400 the whole roster, logging one line —
    >    a bot leaking through must never cost the group the other nine members. Order matters: filter bots,
    >    **then** run the M1.8 caller-in-`members` check, then replace. Filtering can leave fewer than ten
    >    members, which simply means the lobby is not balanced yet.
    >
    > **Game, end of game (`companionGamePayloadSchema`, `phase: 'eog'`).**
    >
    > 5. **The block has no start time.** `startedAt` stays required in the schema; the companion derives it.
    >    Prefer the `InProgress` moment it observed for that `gameId` (it already posts one in the
    >    `phase: 'in_progress'` payload); when it has none — a companion that started or reconnected mid-game
    >    has none — fall back to `endOfGameTimestamp` minus `gameLength`. The fallback is not optional.
    >    Confirm the units of both fields against the fixture and write them into `03-lcu-reference.md`
    >    instead of assuming milliseconds and seconds.
    > 6. **A `TerminatedInError` block has no winning team.** The companion recognises it and does not post it,
    >    logging the reason. If one reaches the API anyway it is refused with a message that names the reason;
    >    nothing is written and nothing is ever rated. The lobby is left alone — it stays `in_game` and ages
    >    out to `abandoned` on the existing idle rule (M2.5). Do not invent a status for it.
    > 7. **Role comes from `detectedTeamPosition`:** `TOP -> top`, `JUNGLE -> jungle`, `MIDDLE -> mid`,
    >    `BOTTOM -> adc`, `UTILITY -> support`. Anything else — `""`, missing, a value we have not seen — is
    >    `null`. `role` is nullable everywhere for exactly this reason. Never infer a role from the champion.
    > 8. **Stat keys, exactly:** `CHAMPIONS_KILLED` (not `KILLS`), `NUM_DEATHS` (not `DEATHS`), `ASSISTS`,
    >    `GOLD_EARNED`, `TOTAL_DAMAGE_DEALT_TO_CHAMPIONS`, and cs is `MINIONS_KILLED` **plus**
    >    `NEUTRAL_MINIONS_KILLED`. `WIN` is `0 | 1`, a number, not `"Win"`/`"Fail"`. A missing key is 0, which
    >    the schema already defaults; one absent stat never costs us a game. The stat-key list in the eog row
    >    of `03-lcu-reference.md` is wrong today and is corrected by this task.
    > 9. **There is no `queueId` in the block.** Nothing may read one. The custom-game gate is
    >    `gameType === 'CUSTOM_GAME'`, which is what M2.5 already uses; remove `queueId` from the eog row of
    >    the reference.
    > 10. **Bot players have `botPlayer: true` and the all-zero puuid** (`00000000-0000-0000-0000-000000000000`).
    >    The companion filters them before validation, and `puuidSchema` in `common.ts` rejects the all-zero
    >    puuid outright: it accepts it today, so a bot game would create a `players` row keyed on a PUUID that
    >    every bot in every game shares — the one kind of bad row this product cannot tolerate, because PUUID
    >    is the identity. That change touches every payload; it is a widening of what we refuse, and it needs
    >    its own test. Filtering can leave fewer than ten participants, and the M2.5 gate (ten participants,
    >    five a side, over 300 seconds) then correctly stores the game without rating it.
    > 11. **`games.raw` must be scrubbed of `mucJwtDto` and `multiUserChatPassword` before storage.** The block
    >    carries live chat credentials and `games` is **public-read** under RLS, so this is a leak, not
    >    hygiene. Replace the value of both keys with the string `"[redacted]"` at any depth, matching the
    >    convention `packages/lcu/src/scrub.ts` already uses for WS events. Scrub on the server before insert;
    >    the companion may scrub too, but the server is the one that has to be right, because old companion
    >    binaries keep running in people's tray for months.
    >
    > **Rank (`companionRankPayloadSchema`).**
    >
    > 12. **Unranked is `tier: ""` with `division: "NA"`.** Normalise both to `null`; a null tier forces a null
    >    division. `optionalText` already folds `""` to null, so `"NA"` is the one that survives today and
    >    would print on the player page as a division. `losses` reads `0` for every player but yourself, so it
    >    is not truth: the schema does not carry it and must not gain it. Wins and losses come from our own
    >    `games` rows, never from the client.
    >
    > **Edge cases.** Fewer than ten, or more than ten, are untouched by this task — it is about shape, not
    > count. Spectators: confirm from the fixture whether `customSpectators[]` members appear in `members` at
    > all; if they do not, a sitting-out friend cannot be seen in the lobby payload and M2.8's spectator path
    > rests entirely on the `reported_by_player_id` fallback — say so in the reference rather than guessing.
    > Someone leaving mid-lobby is unchanged: replace semantics while `open`, frozen from `in_game` (M2.9).
    > A companion that disconnects and reconnects at `EndOfGame` is the case that makes the `startedAt`
    > fallback mandatory. An unknown player lands as a `players` row with null names and no rank, and both
    > fill in later; ingest never blocks on either.
    >
    > **One mapper, not two.** The raw-LCU-to-payload mapping is written once and imported by both
    > `apps/companion` and the fixture test. It is client-shape knowledge, so `packages/lcu` (which would take
    > `@customs/db` as a dependency — `db` depends only on `core`, so there is no cycle) is the natural home;
    > a test in `packages/db` reaching for `packages/lcu/fixtures/` is the alternative. **The lead picks the
    > home**; what this brief requires is that the mapping exists in exactly one place and that no copy of it
    > lives in `apps/companion`.
    >
    > **Acceptance check.**
    >
    > 1. A fixture-backed test builds a lobby payload from `packages/lcu/fixtures/16.17/lobby.json` through the
    >    mapper and `companionLobbyPayloadSchema.parse` succeeds: sides come out five and five from
    >    `customTeam100`/`customTeam200`, every `summonerId` is a digit string, null `gameName`/`tagLine` pass.
    > 2. The same for `eog-stats-block.json` through `companionGamePayloadSchema` (`phase: 'eog'`): ten
    >    participants, `winningSide` 100 or 200, `startedAt` equal to `endOfGameTimestamp` minus `gameLength`,
    >    roles mapped from `detectedTeamPosition`, and at least one participant's `cs` asserted by hand as
    >    `MINIONS_KILLED + NEUTRAL_MINIONS_KILLED`.
    > 3. A bots lobby fixture parses with only the humans in it, and a member with an empty-string puuid does
    >    not take the rest of the roster down with it.
    > 4. A `TerminatedInError` block is refused with a reason naming it, and no `games` row is written.
    > 5. `puuidSchema` rejects the all-zero puuid.
    > 6. A stored `games.raw` reads `"[redacted]"` at `mucJwtDto` and `multiUserChatPassword`, and the original
    >    values appear nowhere in the row.
    > 7. A rank payload built from the unranked fixture has `tier: null` and `division: null`.
    > 8. `pnpm -r typecheck` and `pnpm -r test` pass, and the lobby, eog and ranked rows of
    >    `03-lcu-reference.md` carry the corrected shapes.
    >
    > **Out of scope.** No migration — `summoner_id` is already `text` and `role` already nullable. No change
    > to the M2.5 rating gate, the lobby state machine or the M2.9 freeze. No match-history or backfill shapes
    > (M5). No champion-name or icon lookup. No packaging.

    > **Correction (product, 2026-09-08, written with the M2.5 brief).** Point 6 above says a `TerminatedInError`
    > lobby "stays `in_game` and ages out to `abandoned` on the existing idle rule (M2.5)". The second half is
    > wrong and M2.5 does not implement it: the 2-hour idle sweep covers `open` and `balanced` only, because
    > `abandoned` keeps the replace semantics (M2.9) while an `in_game` roster must stay frozen forever. Such a
    > lobby stays `in_game`, and M5.5 — "lobbies that reached `in_game` and never finished" — is the surface that
    > lists it. Everything else in point 6 stands: the block is not posted, a block that reaches the API anyway is
    > refused by name, nothing is written, nothing is rated, and no status is invented for it.

- [x] **M2.14** A lobby row is one game cycle, not one party. `lobbies.lcu_party_id` is unique and M2.9 freezes the roster from `in_game` through `finished`, but the client keeps the same party all night: in `packages/lcu/fixtures/16.17/ws-events.ndjson`, party `e3c69392` was created at 16:36:41, its game ran 16:37:39 (`GameStart`) to 16:53:05 (`EndOfGame`), and the same party id was still emitting lobby `Update` events at 17:39:27 with no new `Create` and no new id. So without this, only the first game of the night is ever balanced. **Approach (lead, 2026-09-08):** migration `0003` drops the plain unique on `lobbies.lcu_party_id` and replaces it with a partial unique index `where status in ('open','balanced','in_game')` — at most one live lobby per party. A lobby post whose latest row for that party is `finished` or `abandoned` creates a **new** lobby row with the same party id; `selectLobby` (lobby ingest) and `findLobbyId` (game ingest) resolve a party to its live row, falling back to the newest row for a game post that arrives after the cycle closed. M2.7's `lastSplit` lookup is untouched (it reads `splits.roster_key`, not lobbies) and so is the M2.9 freeze: the old row keeps its ten frozen members and its `games` link. No data is lost and nothing is rewritten, so this is a migration, not a decision. **Sequenced immediately after M2.10** — same engineer, same package, same contract pass.

    > **Why (product).** This is the whole scene failing at 21:30. Game one gets teams; game two, three and
    > four get silence, and the group goes back to arguing while the bot watches. It is also the thing M2.7
    > and the repeat-split penalty exist for — "not the same five again" only means something across the
    > games of one night.
    >
    > **Acceptance check.** Drive a lobby to `finished`. Post the same party id again with the same ten:
    > a second `lobbies` row exists, the first still has its ten frozen members and its `games` row, the new
    > one balances after 10 s, and its `lastSplit` is the five puuids of the first game's chosen split, so the
    > second game's teams are not a repeat of the first's. Post a late eog for the first game after the second
    > row exists: it still lands on the first row, once. The tonight page shows one live lobby, not two. A
    > third and fourth cycle on the same party behave the same.
    >
    > **Out of scope.** Any change to what a lobby row means once it is closed. Merging cycles for stats
    > (M5). Deleting old rows.

- [x] **M2.1** `apps/companion` CLI: config file, first-run token prompt, connection state machine with reconnect and backoff, structured logs with rotation.

    > **Note (product, 2026-09-08, after M0.3).** The companion subscribes to the firehose
    > (`[5, "OnJsonApiEvent"]`) and filters by `uri`, because the per-URI topics have not been exercised yet.
    > That means every event the client emits passes through this process on a friend's home PC, including
    > their private chat and their live game credentials. Two consequences for this task: the logs never
    > contain a raw event body — `packages/lcu/src/scrub.ts` already does this for `record-ws` and the same
    > function guards the log path — and events on URIs the companion does not read are dropped at the edge,
    > not carried into application state. Champion-select and matchmaking URIs are dropped and never acted
    > on; that is the gameplay line in `03-lcu-reference.md`, and it is easier to hold when the events never
    > get past the filter.
- [x] **M2.2** Lobby watcher: on every lobby WS event, POST the member list with sides and spectator flags. Debouncing lives on the server, not here. Needs M2.10: sides come from `gameConfig.customTeam100`/`customTeam200`, never `members[].teamId`, and bots are filtered before posting.

    > **Brief (product, 2026-09-08)**
    >
    > **The scene.** Friends trickle into a custom lobby over a couple of minutes. Nothing is asked of them. On
    > someone's PC a companion is running, and every time the lobby changes it tells the server who is in it — with
    > their names, so the teams post reads like a group of friends and not a list of hex strings. That is this
    > task: a faithful mirror of the lobby, pushed the instant it changes. It decides nothing. The ten seconds, the
    > balance, the sit-outs and the states are all M2.5.
    >
    > **Input: one URI.** The companion reads `/lol-lobby/v2/lobby` events off the firehose (M2.1) and nothing else
    > for this feature. `/lol-lobby/v2/lobby/members` fires 1-2 ms later with the members array **and no
    > `gameConfig`**, so it cannot say which side anyone is on; it is dropped at the filter. Recorded in
    > `04-decisions.md`. Parse every event with `LobbySchema` (`packages/lcu`); a body that does not parse is
    > logged once with the URI and dropped, never crashing the watcher.
    >
    > **The payload** is `companionLobbyPayloadSchema` as M2.10 leaves it, built by the shared mapper M2.10 puts in
    > one place:
    >
    > - `partyId` — `partyId` from the event body.
    > - `lobbyName` — `gameConfig.customLobbyName`.
    > - `lobbyPassword` — **always `null`.** There is no password anywhere in the 16.17 lobby body (checked against
    >   all three lobby fixtures; the only `*assword` key is `multiUserChatPassword`, which is a chat credential
    >   and is scrubbed, never sent). The column fills in with M4.1, when the companion is the one that set the
    >   password. Recorded in `04-decisions.md`; M3.1's `Lobby` field is simply absent until then.
    > - `members[]` — one entry per **human in `members[]`**. Never build the list from the team arrays: bots live
    >   in `customTeam100`/`customTeam200` with `puuid: ""` and are not in `members[]` at all.
    >   - `puuid` — as reported.
    >   - `side` — from the same event, never from a later one: `customTeam100` → `100`, `customTeam200` → `200`,
    >     in `customSpectators` or in none of the three → `null`. `members[].teamId` is `0` in a custom lobby and
    >     must not be read (question 3 of the reference; decision row already exists).
    >   - `isSpectator` — `true` when the puuid is in `customSpectators` **or** the member carries
    >     `isSpectator: true`. On 16.17 the two always agree (question 9); the `or` costs nothing and survives the
    >     day they do not.
    >   - `summonerId` — normalised to a decimal string (M2.10, point 1).
    >   - `gameName` / `tagLine` — whatever the companion already knows; see below. Never blocks the post.
    > - **Bots are dropped before the payload is built** (`isBot: true`, or an empty or all-zero puuid), and dropped
    >   *before* the caller-in-members check, so a bot can never push the local player out of a payload that would
    >   then be refused (M2.10, point 4).
    >
    > **Names, without ever waiting.** Lobby members carry no `gameName`/`tagLine` and `summonerName` is `""`, so
    > the first time the group meets someone the roster has a blank where their name goes. The companion fixes that
    > without holding anything up:
    >
    > 1. Post immediately, with `gameName: null` for anyone it has no name for.
    > 2. In the background, for each unknown puuid, `GET /lol-summoner/v2/summoners/puuid/{puuid}` (verified), at
    >    most once per puuid per process, at most five lookups a second. Its own puuid comes free from
    >    `current-summoner`.
    > 3. When lookups finish, re-post the current roster once, coalesced, with the names filled in. The member set
    >    has not changed, so M2.5's clock does not restart and the names arrive well inside the ten seconds — the
    >    teams post is readable the first time it appears.
    > 4. A lookup that 404s, times out or fails is logged **once** for that puuid and never retried in this
    >    process. The roster is still correct without it; M2.4's sweep is the other route to a name.
    >
    > **Posting rules.**
    >
    > - **At most one POST in flight.** Events arrive in bursts (the 16.17 recording has eleven lobby events inside
    >   400 ms). Keep only the newest payload while a post is in flight and send that one when it completes; drop
    >   everything it superseded. A lobby post is only interesting while it is current, so — unlike the eog block
    >   (M2.3) — nothing is queued to disk and nothing is retried from a previous run.
    > - **A failed post** is retried with the existing backoff, but only while it is still the newest payload.
    > - **`recheckInMs`** in the response (M2.5): if it is a number, re-post the identical payload after that many
    >   milliseconds, unless a real lobby event has produced a newer one first. This is how "unchanged for ten
    >   seconds" ever gets observed on a server with no timers. `null` means do nothing.
    > - **`ranksNeeded`** in the response (M2.5, consumed by M2.4): hand it to the rank sync and otherwise ignore it.
    > - **403** means the caller is not in the lobby they posted, which should be impossible; log one line with the
    >   party id and stop posting that party until the next `Create`.
    > - **On connect**, if the client is already in a lobby, `GET /lol-lobby/v2/lobby` once and post it. A 404
    >   (`LOBBY_NOT_FOUND`) means there is no lobby: post nothing. This is the "someone started the companion after
    >   everyone had already joined" case, and it is the common one on a real night.
    > - **On `Delete` (data null), post nothing.** The `Delete` fires 30-100 ms after the phase hits `GameStart`,
    >   so a post here would be an empty roster arriving moments before the game post — it would wipe the ten
    >   people we are about to need. A lobby that really dissolved is handled by M2.5's 2-hour idle rule instead.
    >   Recorded in `04-decisions.md`.
    >
    > **Edge cases.**
    >
    > - **Fewer than ten, more than ten.** The companion does not count. It posts what it sees, every time.
    > - **Someone leaves mid-lobby.** One more event, one more post, the shorter list. The server's replace
    >   semantics do the rest while the lobby is `open` or `balanced`; from `in_game` on the response says
    >   `rosterFrozen: true` and the companion just logs it (M2.9).
    > - **Companion disconnects.** No posts while it is down. On reconnect, the "already in a lobby" GET above puts
    >   the roster back in one request.
    > - **Two companions in one lobby.** Both post the same list; the server dedupes on `lcu_party_id` and only the
    >   first becomes `reported_by_player_id`. No coordination between companions, ever.
    > - **A friend in the spectator slot.** They are in `members[]` with `isSpectator: true` and in
    >   `customSpectators` (question 9), so their own companion's post contains their puuid and passes the M1.8
    >   check. Nothing special to do — but the fixture-backed check below is what keeps it that way.
    > - **An unknown player.** Posted with a null name on the first event and a real name a second later, via the
    >   name path above. The post is never delayed for them.
    > - **A member the client has not placed** (in `members[]`, in none of the three arrays): `side: null`,
    >   `isSpectator: false`. That is a valid roster, not an error, and it is how an eleventh player can reach the
    >   server at all.
    >
    > **Acceptance check.**
    >
    > Fixture-driven, no live client required (`packages/lcu/fixtures/16.17/`).
    >
    > 1. Replaying every `/lol-lobby/v2/lobby` event in `ws-events.ndjson` through the mapper produces a payload
    >    that `companionLobbyPayloadSchema.parse` accepts for each one, with a non-empty `partyId` and no throw on
    >    the two `Delete` frames.
    > 2. `lobby.json` → one member, `side: 100`, `isSpectator: false`, `lobbyName: "PRT Empty's Game"`,
    >    `lobbyPassword: null`.
    > 3. `lobby--two-players.json` → two members, one `side: 100`, one `side: 200`, neither a spectator.
    > 4. `lobby--spectator.json` → two members; the spectator has `isSpectator: true` and `side: null`, the other
    >    `side: 100`; the spectator's puuid is present, not dropped.
    > 5. A synthetic event built from `lobby.json` with an extra member `{ isBot: true, puuid: "" }` in `members[]`
    >    and a bot puuid in `customTeam100` posts exactly the human members, and the local player is still in the
    >    payload.
    > 6. The two `Delete` frames produce zero POSTs.
    > 7. Connect-while-in-lobby: with the GET stubbed to `lobby.json`, exactly one POST goes out; with it stubbed
    >    to a 404, zero POSTs and one log line.
    > 8. Coalescing: feed the eleven events between 16:36:41.502 and 16:36:46.976 with a post that takes 500 ms —
    >    at most two POSTs are made and the last one carries the state of the last event.
    > 9. Names: a member whose puuid the process has not seen is posted with `gameName: null` within 50 ms; exactly
    >    one `summoner-by-puuid` call is made for that puuid however many events arrive; when it resolves (stubbed
    >    from `summoner-by-puuid--other.json`) exactly one extra POST goes out with `gameName` and `tagLine` filled;
    >    a stubbed 404 produces one log line, no extra POST, and no retry.
    > 10. `recheckInMs: 7000` in a response with no further events produces exactly one identical repost at
    >     7 s (±1 s); `recheckInMs: null` produces none.
    > 11. No log line contains a raw event body, and none contains `mucJwtDto` or `multiUserChatPassword`
    >     (`scrub.ts`, M2.1).
    > 12. `pnpm -r typecheck` and `pnpm -r test` pass.
    >
    > **Out of scope.** Debouncing, counting to ten, deciding anything about sides or sit-outs (all M2.5). The
    > gameflow and end-of-game path (M2.3). Rank and the name *sweep* on a schedule (M2.4 — this task looks a name
    > up only for someone it can see in a lobby right now). Creating lobbies, inviting, switching sides (M4).
    > Anything that reads or posts to a champion-select or matchmaking URI, ever.

- [x] **M2.3** Game capture: on gameflow `InProgress` POST the game ID against the lobby; on `EndOfGame` fetch the eog block and POST it. Needs M2.10 for the payload shape (derived `startedAt`, `detectedTeamPosition` roles, real stat keys, `TerminatedInError` dropped). Handle the case where the client reaches `EndOfGame` while the companion was reconnecting: on connect, if phase is `EndOfGame` or `WaitingForStats`, fetch and post.

    > **Note (product, 2026-09-08, after M0.3).** Two facts from the 16.17 capture change how this task is
    > built, without changing what it does.
    >
    > 1. **The block arrives before the phase does.** The WS `Create` for
    >    `/lol-end-of-game/v1/eog-stats-block` landed 0.3 s after `WaitingForStats` and about a second before
    >    the phase reached `EndOfGame`. So the **primary path is the WebSocket event**: take the block from
    >    the event payload and hold it. The `GET` on `EndOfGame` is the fallback for a companion that was not
    >    listening, not the main road. Writing this phase-first inverts the reliable path.
    > 2. **The fallback has a deadline.** The `GET` answered 200 for as long as the end-of-game screen was up
    >    (checked at +33 s and +4 min) and 404'd once the client was back in the lobby (+10 min). So "on
    >    connect, if phase is `EndOfGame` or `WaitingForStats`, fetch and post" only recovers a game while
    >    somebody is still staring at the score screen. Once they click through, the block is gone from the
    >    client for good and the game is backfill's problem (M5.1). Keep the recovery attempt; when the GET
    >    404s, log one line naming the `gameId` and say it is left to backfill. Never poll for it afterwards.
    >
    > 3. **The block goes to disk, not just to memory.** An in-memory hold plus a retry still loses the game
    >    to a crash, a laptop lid, or an API that is down for the two minutes that matter — and by the time
    >    the companion is back, the client has dropped the block. So: on capture (WS event, or the
    >    `EndOfGame` GET fallback), scrub `mucJwtDto` and `multiUserChatPassword` (M2.10, point 11), then
    >    write one file per `gameId` under the companion's data directory and POST from there. Retry with
    >    the existing backoff, across restarts, indefinitely while the file is there. Delete it on a 2xx —
    >    including the idempotent "already have this game" answer — and on a 4xx that names a permanent
    >    reason (`TerminatedInError`, not `CUSTOM_GAME`), logging why. Keep it on anything else. Cap the
    >    queue at a sane number of files and drop the oldest with a log line rather than filling a friend's
    >    disk. A file that no longer parses is logged once and deleted.
    >
    > **What a player sees.** Nothing, on a good night. On a bad one: the game they just played shows up on
    > the tonight page a minute late instead of never, and nobody has to say "the bot missed that one".
    >
    > **Edge cases.** Two companions in the same game each hold their own copy; the second POST is a no-op
    > (`lcu_game_id` dedupe) and both delete their file. A companion that never comes back leaves a file
    > that is posted whenever it next starts, days later — the server accepts it, because dedupe and the
    > rating rebuild (M5.2) make late arrival safe. A block for a game the API has never heard of (no
    > lobby) is still posted; that is M2.8's and backfill's problem, not this one.
    >
    > **Acceptance check for the durable path.** With the API returning 500: play a custom, confirm the
    > block is on disk, click past the end-of-game screen so the client's `GET` 404s, kill the companion,
    > bring the API back, start the companion — the game lands exactly once with ten `game_players` rows.
    > Repeat with the companion killed *before* it ever POSTs. A `TerminatedInError` block leaves no file.
    > Two runs of the same recovery produce one `games` row.
    >
    > **Out of scope.** Backfill (M5.1). Any change to the ingest contract. A UI for the queue; a log line
    > is enough until M6.1.
    > **Brief (product, 2026-09-08)**
    >
    > **The scene.** The nexus falls. Ten friends are still on the score screen arguing about who fed, and the
    > game is already in the database with the ratings moved. Nobody typed anything. On a bad night — the API is
    > down, a laptop lid closes, Windows decides to restart — the game lands the next time the companion starts
    > instead of never, and nobody has to remember which one the bot missed. That is this task: notice the game
    > started, notice how it ended, and never lose it.
    >
    > **Where it lives.** `apps/companion`: a game watcher plus a small on-disk queue, wired into the hooks the
    > connection machine already exposes (`onConnected`, `onGameflowPhase`, `onEogBlock` — `hooks.ts` only logs
    > today and is replaced hook by hook). Payloads come from the one shared mapper M2.10 put in place; no copy
    > of the mapping lives here. No new LCU endpoint: `/lol-gameflow/v1/gameflow-phase`,
    > `/lol-gameflow/v1/session` and `/lol-end-of-game/v1/eog-stats-block` are all `verified` rows in
    > `03-lcu-reference.md`.
    >
    > **Reads only, from `GameStart` onward.** Between `GameStart` and `EndOfGame` the companion makes exactly
    > two client requests: one `GET /lol-gameflow/v1/session` at `GameStart`, and the single connect-time
    > `GET /lol-end-of-game/v1/eog-stats-block` described below. No POST to the client, ever, and nothing on a
    > champion-select, matchmaking or live-game URI; `127.0.0.1:2999` is not read. That is the Riot line in
    > `03-lcu-reference.md`, and this task sits directly on top of it.
    >
    > ### Post 1 — `phase: 'in_progress'`
    >
    > On the phase event `GameStart` (and on `InProgress` if the process missed `GameStart`), once per `gameId`:
    >
    > - `GET /lol-gameflow/v1/session` and take `gameData.gameId`. **Never read the id in any other phase.** In
    >   `Lobby` the session still holds the previous game's id for the rest of the night (16.17, verified: the
    >   session still said `4000969091` 46 minutes after that game ended). A `0`, a missing id or a failed GET
    >   means no post at all — one log line and carry on; the end-of-game block carries its own `gameId` and the
    >   `startedAt` fallback covers the rest.
    > - POST `{ phase: 'in_progress', gameId, partyId, startedAt }`. `startedAt` is the moment the phase event
    >   was observed, ISO 8601 with an offset. `partyId` is the last lobby id this process saw (M2.2 holds it;
    >   the lobby `Delete` arrives 30-100 ms after `GameStart`, so capture the id **at** `GameStart` and keep it
    >   for the whole game); `null` when the companion started mid-game.
    > - Keep `{ gameId, startedAt, partyId }` in memory until the end-of-game post for that id is settled.
    > - **This post is not queued to disk.** It is a hint that lets M2.5 freeze the roster; the eog post carries
    >   the same `gameId`, `partyId` and `startedAt` and can move a lobby `open`/`balanced` -> `finished` on its
    >   own (M2.5's transition table). Use the API client's own retries and give up with one log line.
    >
    > ### Post 2 — `phase: 'eog'`
    >
    > **The block comes from the WebSocket event, held in memory. The GET is never the main road** — the
    > `Create` lands about a second before the phase reaches `EndOfGame`, and the GET is a 404 once anyone
    > clicks past the score screen. On `Create` or `Update` for `/lol-end-of-game/v1/eog-stats-block`, in this
    > order:
    >
    > 1. **Ignore `Delete`** (data null). A block being withdrawn is not news.
    > 2. **Dedupe on `gameId`** before anything else: a `gameId` already posted in this process, or already
    >    holding a queue file, is dropped silently. `Update` follows `Create` by 75 ms with the same block.
    > 3. **Drop what the server would refuse, before it costs a file.** `gameType !== 'CUSTOM_GAME'` (a friend's
    >    ranked game is not ours to store): one log line with `gameId` and `gameType`, no file, no POST. **No
    >    winning team** (a remake, or `TerminatedInError`): one log line naming the `gameId` and the reason, no
    >    file, no POST. The 16.17 capture has exactly this case — game `4000965483` emitted a complete
    >    `CUSTOM_GAME` block whose only team had `isWinningTeam: false`. Recorded in `04-decisions.md`.
    > 4. **Map and scrub.** The shared mapper, then `mucJwtDto` and `multiUserChatPassword` replaced at any
    >    depth (the block carries live chat credentials and `games.raw` is public-read). `startedAt` is the
    >    observed `InProgress` moment for this `gameId` when the process has one, otherwise
    >    `endOfGameTimestamp - gameLength * 1000`. The fallback is not optional.
    > 5. **Write the file, then post.** `<configDir>/queue/<gameId>.json`, written as `<gameId>.json.tmp` and
    >    renamed, owner-only, holding `{ version: 1, queuedAt, payload }` where `payload` is the exact request
    >    body. Only digits are allowed in the name; anything else is dropped with a log line rather than
    >    written. The POST happens after the rename, never before it.
    > 6. **Delete the file on any 2xx** — `created: true` and `created: false` both mean the server has the game
    >    — and on a 4xx that names a permanent reason: 422 (`no winning team`, `gameType must be CUSTOM_GAME`,
    >    a duplicate puuid), 403 (not a participant), 400, 404. Log the reason in one line and say the game is
    >    left to backfill. **Keep** the file on a network error, a 5xx, a 408 or a 429 and retry: the API
    >    client's own attempts first, then the whole file again on an outer backoff (30 s to 15 min, jittered),
    >    for as long as the process runs.
    >
    > ### The queue on start
    >
    > The queue needs the API, not League, so it replays at startup without waiting for the client: list
    > `<configDir>/queue/`, oldest `queuedAt` first, and post each file under the same rules, one at a time. A
    > file that no longer parses as `companionGamePayloadSchema` is logged once and deleted. The directory is
    > capped at 50 files; over that the oldest is deleted with a log line rather than filling a friend's disk. A
    > file days old is still posted: `lcu_game_id` dedupe and the M5.2 rating rebuild make late arrival safe.
    >
    > ### Saying who you are, on every start
    >
    > On every start, and immediately after the first-run prompt, `GET /api/companion/me` once before anything
    > else. On 200, print one line: `signed in as <displayName>`. On 401, print one plain sentence — the token
    > was refused, mint a new one on the admin page — and no stack trace; the process keeps running (the token
    > may be revoked mid-season and the queue still has work). On a network error or a 5xx, say the API is not
    > answering yet and carry on: this call never blocks the watcher or the queue. The route exists for exactly
    > this and nothing calls it today (`main.ts` only pings `/api/health`, which uses no token and so says
    > nothing about it), which is how a mistyped token currently becomes a silent night.
    >
    > ### The one time the GET is used
    >
    > `onConnected` carries the phase read at connect. If it is `EndOfGame` or `WaitingForStats` and the process
    > holds no block for that game, `GET /lol-end-of-game/v1/eog-stats-block` **once** and run the same pipeline
    > from step 2. A 404 means somebody already clicked through and the block is gone from the client for good:
    > one log line naming the phase and saying it is backfill's problem (M5.1), and **never a second attempt,
    > never a poll**. This is the "the companion was restarting at the final whistle" case that
    > `00-product.md` already accepts under Success.
    >
    > ### Edge cases
    >
    > - **Fewer than ten, more than ten.** The companion posts what the block says. Ten participants, five a
    >   side and the 300-second floor are M2.5's gate, not a reason to hold anything back here.
    > - **Someone leaves mid-lobby, or mid-game.** Nothing here reads `leaver` or `wasAfk`. A leaver is in the
    >   block like anyone else, and the lobby side of leaving is M2.2 and M2.9.
    > - **Companion disconnects mid-game.** No `InProgress` moment is held, so `startedAt` falls back to the
    >   arithmetic — 8.8 s later than the observed moment on the fixture game, which is load time, not an
    >   error. If it reconnects while the score screen is still up, the connect-time GET catches the block; if
    >   it reconnects after, nothing is posted and one line says why.
    > - **Companion killed between the file write and the POST.** The file is on disk and the next start posts
    >   it. That ordering is the whole point of the queue.
    > - **An unknown player.** Nothing special: the block is where someone first seen in a lobby finally gets a
    >   name (`riotIdGameName`/`riotIdTagLine`), and the API stores it.
    > - **Two companions in one game.** Each holds its own copy, both post, both get 200, exactly one sees
    >   `created: true`, and both delete their file. No coordination between companions, ever.
    > - **A block for a game with no lobby.** Posted with `partyId: null`; `games.lobby_id` is null and M2.5
    >   still rates it.
    > - **A second game on the same party the same night.** New `gameId`, new file, new pair of posts. Nothing
    >   here caches per party (M2.14 is the server's side of that).
    > - **The API is down all evening.** Files accumulate, capped at 50, and land the next morning.
    >
    > ### Acceptance check
    >
    > Fixture-driven against `packages/lcu/fixtures/16.17/` with a stubbed API and a stubbed client, except 5,
    > 8 and 9, which belong to the test night.
    >
    > 1. Replaying the phase events of `ws-events.ndjson` with the session GET stubbed from the recording
    >    produces exactly **two** `in_progress` POSTs — `gameId` `4000965483` and `4000969091` — each with a
    >    `startedAt` within 100 ms of that game's `GameStart` frame (`16:34:20.911Z`, `16:37:38.903Z`).
    > 2. Replaying the five eog frames produces exactly **one** eog POST, for `4000969091`, `winningSide: 200`.
    >    Game `4000965483` produces zero POSTs, zero files and one log line naming it and "no winning team".
    >    The `Delete` frame produces nothing.
    > 3. With the session GET stubbed to `gameflow-session--in-lobby.json` (phase `Lobby`, `gameId 4000969091`)
    >    and no `GameStart` frame: zero POSTs. A stale id is never posted.
    > 4. `startedAt`: with the `InProgress` moment held, the eog payload carries it; feeding only the eog frame,
    >    it is `2026-09-08T16:37:47.672Z` (`endOfGameTimestamp - gameLength * 1000` from `eog-stats-block.json`).
    > 5. **The crash sequence, on the test night.** With the API unreachable (a dead origin in the companion's
    >    `apiBase`: nobody can make the deployed API answer 500 on demand, and a true 500 is covered by check 6
    >    below — both are the same retryable path). Play a custom, confirm
    >    `queue/<gameId>.json` exists and parses, click past the end-of-game screen so the client's GET 404s,
    >    kill the companion (`taskkill /f`), bring the API back, start the companion — the game lands **exactly
    >    once**, with ten `game_players` rows. Repeat with the kill placed before the first POST attempt: same
    >    result. Run the recovery twice: still one `games` row, and `queue/` ends empty both times.
    > 6. Permanent refusals: a stubbed 422 deletes the file and logs the reason; so does a stubbed 403. Five
    >    consecutive 500s leave the file in place, and the fifth log line still names it.
    > 7. The queued file reads `"[redacted]"` at `mucJwtDto` and `multiUserChatPassword`, neither original value
    >    appears anywhere in it, and no log line carries a raw block, a lockfile password or the companion token.
    > 8. **Kill one companion mid-game; the game still lands** (the M2 acceptance line): two companions in one
    >    real custom, one killed at minute five — one `games` row, ten `game_players` rows.
    > 9. **Two companions, one end of game:** both post the same block, both get 200, exactly one has
    >    `created: true`, and the database holds one `games` row and ten `game_players` rows.
    > 10. Connect-time fallback: with the connect phase stubbed `EndOfGame` and the GET stubbed to
    >     `eog-stats-block.json`, exactly one POST and exactly one GET; with the GET stubbed to 404, zero POSTs,
    >     one log line, and no second GET across 60 s of injected time.
    > 11. A block with `gameType: "MATCHED_GAME"` produces no file and no POST.
    > 12. 51 queued files: the oldest is deleted with a log line and the remaining 50 are posted.
    > 13. A right token prints `signed in as <displayName>` exactly once on start; a wrong one prints one plain
    >     sentence naming the admin page, no stack trace, and the process is still running a minute later with
    >     the queue replayed.
    > 14. `pnpm -r typecheck` and `pnpm -r test` pass.
    >
    > **Sequencing (lead, 2026-09-08).** **M2.8 must land before the test night.** Until the game route accepts
    > a poster who is in the lobby rather than only on the scoreboard, a spectating friend's companion gets a
    > permanent 403 for every block it holds — and this task deletes a queue file on a permanent 403, so their
    > queue drains silently. M2.8 is being implemented alongside M2.5 if it stays small.
    >
    > ### Out of scope
    >
    > Backfill (M5.1) and any match-history read. Any change to the ingest contract or the payload schemas —
    > M2.10 is the contract, and if it is wrong here, stop and say so rather than widening it. The lobby post
    > (M2.2), rank and names (M2.4), the server's state machine and rating fold (M2.5). A UI or tray indicator
    > for the queue (M6.1). Anything that writes to the League client.

- [x] **M2.4** Rank sync: own rank on start and every 6 hours; rank for every unknown PUUID seen in a lobby, once, then weekly.

    > **Note (product, 2026-09-08, after M0.3).** This sweep also fetches **names**, not just ranks. Lobby
    > members carry no `gameName`/`tagLine` — `summonerName` is an empty string on 16.17 — so a roster posted
    > straight from a lobby event has null names for everyone the database has not met before (M2.10, point
    > 2). The only way to a name is a per-puuid lookup:
    > `GET /lol-summoner/v2/summoners/puuid/{puuid}` returns `gameName` and `tagLine` for another player and
    > is already verified. Do it in the same pass as the rank read, for the same PUUIDs, on the same schedule,
    > and POST both together. Posting a lobby still never waits on it.
    >
    > Why it matters: without this, the first night a new friend plays, the teams embed has their rating and
    > a blank where their name should be until their first game ends. `losses` from the client is `0` for
    > anyone but yourself — do not read it, here or anywhere (M2.10, point 12).

    > **Brief (product, 2026-09-08)**
    >
    > **The scene.** A friend plays with the group for the first time. Before anyone has typed their name anywhere,
    > the teams post shows them with a name the group recognises and a rating that already looks roughly right,
    > because the client knew their rank and the companion asked. Nobody was interviewed, nobody was "added". Six
    > hours later the same quiet pass keeps everyone's rank current. Nothing a player can see happens in this task
    > except that the two things they would have had to tell us are already there.
    >
    > **Two reads, one post.** For each PUUID this pass handles, the companion does:
    >
    > - `GET /lol-ranked/v1/ranked-stats/{puuid}` (verified 16.17, works for friends and non-friends alike) — or
    >   `GET /lol-ranked/v1/current-ranked-stats` for its own player;
    > - `GET /lol-summoner/v2/summoners/puuid/{puuid}` (verified) for `gameName` and `tagLine`;
    >
    > and posts both in one `POST /api/companion/rank`. That needs two optional fields on
    > `companionRankPayloadSchema`: **`gameName` and `tagLine`, both `optionalText`, both nullable.**
    > `ingestRank` passes them to `ensurePlayers`, which already refreshes `game_name`, `tag_line` and the
    > automatic `display_name` and already refuses to overwrite an admin's override (M1.7). Flag the two fields for
    > M2.10 — they are part of that contract pass, not a change made behind it. Recorded in `04-decisions.md`.
    >
    > **Normalisation, in the companion, before posting.**
    >
    > - Read only `queueMap.RANKED_SOLO_5x5`. Flex is not our ladder and TFT queues are noise.
    > - Unranked is `tier: ""` with `division: "NA"`. Both become `null`, and a null tier forces a null division —
    >   otherwise `"NA"` survives `optionalText` and prints on the player page as a division (M2.10, point 12).
    > - `leaguePoints` → `lp`. A missing or negative value is `null`.
    > - **`losses` is not read, not carried, not stored.** It is `0` for everyone but yourself, so it is not truth.
    >   Wins and losses come from our own `games` rows. The string `losses` should not appear in the companion's
    >   source at all.
    > - `queue` stays `RANKED_SOLO_5x5`; the API ignores any other queue (`SEEDING_QUEUE` in `lib/ingest/rank.ts`).
    > - A tier string we have never seen is posted **as the client said it**. `packages/core` treats anything it
    >   does not recognise as unranked, so a new tier name never breaks ingest and shows up in the data instead.
    >
    > **Who counts as unknown: the server says so.** The companion holds no staleness rule. The lobby response
    > (M2.5, M2.2) gains `ranksNeeded: string[]` — the puuids **among the members just posted** whose `players` row
    > has `rank_updated_at` null or older than 7 days, capped at the member limit. That is the whole "once, then
    > weekly": the server's 7-day window is the schedule, and a player drops off the list the moment their POST
    > lands. One rule, one place, and a fix ships with the API instead of with a new exe on ten friends' PCs.
    > Recorded in `04-decisions.md`.
    >
    > The companion keeps only a small in-memory guard so a burst of lobby posts cannot fetch the same puuid twice:
    > a set of "asked in the last hour", cleared on restart. It is a de-duplicator, not a policy.
    >
    > **Own rank: on start and every 6 hours.** Immediately after the first successful client connection, then on a
    > 6-hour interval, from an injected clock so it is testable. A restart re-posts; that is fine and cheap.
    >
    > **Privacy line: the companion posts a rank or a name only for a PUUID the server asked for, or its own.**
    > The firehose carries `/lol-ranked/v1/cached-ranked-stats/{puuid}` `Update` events (question 10) for lobby
    > members *and for the whole friends list*, in the same shape `RankedStatsSchema` already parses. Use it only as
    > a shortcut: if an event arrives for a puuid that is currently in `ranksNeeded`, take it and skip the GET.
    > Never post from an event for anyone else. Our database is a record of a group of friends' customs, not a
    > scrape of somebody's friends list. Recorded in `04-decisions.md`.
    >
    > **Pacing and failure.** At most five client calls a second across this whole pass, so a lobby of ten unknown
    > players cannot stall the client. A failed or 404 lookup is logged once per puuid per hour and simply left for
    > the next lobby response, which will still list that puuid because `rank_updated_at` never moved. No retry
    > loop, no backoff storm, and never a blocked lobby post.
    >
    > **Edge cases.**
    >
    > - **Fewer than ten, more than ten.** Irrelevant here: this pass is per PUUID, and it works from whoever the
    >   server asked about.
    > - **Someone leaves mid-lobby.** A lookup already in flight for them still posts. A rank row for a player who
    >   is not in the lobby any more is correct data, and their `players` row already exists.
    > - **Companion disconnects.** The pass stops. On reconnect, the first lobby response lists whoever is still
    >   unknown, so nothing is lost, only delayed.
    > - **Two companions in one lobby.** Both get the same `ranksNeeded` and both may post the same rank. The
    >   second write is the same values plus a fresher `rank_updated_at`: harmless, idempotent, no dedupe needed.
    > - **Unknown player.** First lobby event: posted with a null name and no rank; they balance at
    >   `mu 20.00, sigma 10.00`. Their rank usually lands within a second or two — inside M2.5's ten-second window —
    >   and they balance from their real rank instead. If it lands later, nothing needs fixing: M2.5 writes no
    >   `ratings` row until a game is actually rated, so the next balance simply uses the newer rank. A rating that
    >   already exists is **never** re-seeded from a rank.
    > - **A player who is genuinely unranked.** `tier: null` forever, seeded 20/10 every time until they play.
    >   They must not be re-asked more often than anyone else: `rank_updated_at` is set on every stored rank
    >   report, unranked included, or the 7-day window never closes for them.
    >
    > **Acceptance check.**
    >
    > Fixtures in `packages/lcu/fixtures/16.17/`; the client and the API are stubbed; the clock is injected.
    >
    > 1. On start: exactly one `current-ranked-stats` GET and exactly one `POST /api/companion/rank` for the
    >    companion's own puuid, with `tier`, `division` and `lp` taken from `current-ranked-stats.json` and
    >    `queue: 'RANKED_SOLO_5x5'`.
    > 2. An unranked reading (`tier: ""`, `division: "NA"`) posts `tier: null` and `division: null`.
    > 3. A lobby response with `ranksNeeded: [a, b]` produces exactly two `ranked-stats/{puuid}` GETs, exactly two
    >    `summoner-by-puuid` GETs and exactly two rank POSTs, each carrying `gameName` and `tagLine`
    >    (asserted against `ranked-stats-by-puuid--other.json` and `summoner-by-puuid--other.json`).
    > 4. The next lobby response repeating the same `ranksNeeded` within the hour produces **zero** further client
    >    calls.
    > 5. A `cached-ranked-stats` WS event for a puuid in `ranksNeeded` satisfies it with no GET; the same event for
    >    a puuid that was never asked about produces no call and no POST.
    > 6. Six hours of injected time: exactly two own-rank POSTs in seven hours, and no other player is refetched
    >    because of the timer.
    > 7. `grep -r losses apps/companion/src` finds nothing.
    > 8. A `ranked-stats` GET that 500s produces one log line, no crash, no retry loop, and the lobby post that
    >    carried the `ranksNeeded` still succeeded.
    > 9. Server side, against the local stack: a rank POST carrying `gameName` sets `players.game_name` and the
    >    automatic `display_name`, leaves an admin-set `display_name` alone, sets `rank_updated_at`, and the same
    >    puuid is absent from `ranksNeeded` on the next lobby post. A puuid with `rank_updated_at` 8 days old is
    >    present in it.
    > 10. `pnpm -r typecheck` and `pnpm -r test` pass, and the ranked and summoner rows of
    >     `03-lcu-reference.md` still match what this code reads.
    >
    > **Out of scope.** Seeding and re-seeding ratings (M2.5). Flex queue, LP history, win/loss records, and
    > anything drawn from `wins` (M5). Rank on the tonight page or the leaderboard (M3). Match history (M5.1).
    > Any lookup by Riot ID or summoner name — PUUID is the identity and this task never resolves anything the
    > other way round.

- [x] **M2.5** Server: lobby state machine (open, balanced, in_game, finished, abandoned) with the 10-second stability rule; on eog, insert `games` and `game_players`, run `rateGame`, update `ratings`. Ignore eog blocks whose `gameType` is not `CUSTOM_GAME`.

    > **Note (product).** M1.5 already stores *every* `CUSTOM_GAME` eog block as a `games` row, remakes and
    > short surrenders with fewer than ten participants included, so M2.5 cannot assume only real games reach
    > it. Gate rating on the stored row: rate only when it has ten participants, five per side, and `durationS`
    > above 300 seconds (5 minutes); otherwise keep the row and leave `ratings` untouched. M2.5 records that
    > threshold in `04-decisions.md`. M2.3 may decide not to post remakes at all; the gate stands either way.

    > **Brief (product, 2026-09-08)**
    >
    > **The scene.** The tenth friend joins the lobby. Ten seconds later two teams are on the screen. They play.
    > By the time the client is back in the lobby, the ratings have already moved. Nobody typed anything, nobody
    > pressed anything, and nobody told the server that a game had started or who won. M2.5 is the whole server
    > half of that scene: what "ready" means, when it fires, and what an end-of-game block does to the
    > leaderboard. Discord is M3.1 — every acceptance check below must pass with the webhook switched off.
    >
    > **Where it lives.** One new module (`apps/web/lib/lobbyState.ts`) plus the two companion routes and the
    > ingest files that already exist. `packages/core` gains nothing: it already exports `balance`, `explain`,
    > `nextSplit`, `rateGame`, `seedFromRank` and `predictWin`, and everything here is I/O and policy. The three
    > numbers live at the top of the new module and nowhere else: `ROSTER_STABLE_MS = 10_000`,
    > `IDLE_ABANDON_MS = 7_200_000` (2 h), `MIN_RATED_DURATION_S = 300`.
    >
    > ### The transition table
    >
    > | From | To | Signal | What else happens |
    > |---|---|---|---|
    > | — | `open` | first lobby post for an unseen `lcu_party_id` | lobby row inserted (M1.5), members replaced |
    > | `open` | `open` | lobby post whose roster (everyone around, spectators included) differs from what is stored | members replaced, the roster clock restarts |
    > | `open` | `balanced` | lobby post whose roster is byte-identical to what is stored **and** the clock says the last change was 10 s ago or more **and** ten or more people are around | the ten who play are selected, `balance()` runs, three `splits` rows are inserted |
    > | `balanced` | `open` | lobby post whose roster differs | members replaced, clock restarts, the old splits stay (they are history, and `roster_key` keeps them findable) |
    > | `balanced` | `balanced` | lobby post with an identical roster | nothing at all — no second balance, no new splits |
    > | `open` or `balanced` | `in_game` | game post with `phase: 'in_progress'` whose `partyId` resolves to this lobby | the roster freezes (M2.9) from this moment |
    > | `in_game` | `finished` | `phase: 'eog'` post, `gameType === 'CUSTOM_GAME'`, whose `partyId` resolves to this lobby | `games` + `game_players` are written (M1.5 code), then the rating fold |
    > | `open` or `balanced` | `finished` | the same eog post, when the `in_progress` post never arrived | same, and the roster freezes on the way through |
    > | `open` or `balanced` | `abandoned` | the idle sweep: the lobby row's `updated_at` is more than 2 h old | nothing else; the roster keeps replace semantics (M2.9) |
    >
    > Everything not in that table is not a transition. `finished` and `abandoned` are terminal. **`in_game` never
    > ages out** — see "The sweep" below, and note that this corrects half a sentence in the M2.10 brief.
    >
    > ### How "unchanged for 10 seconds" is measured with no timers
    >
    > Vercel gives us no timer, no queue and, on the free plan, no cron worth having. So the rule is measured on
    > the posts we already get, and the server tells the companion when to knock again.
    >
    > 1. **The roster's identity** is `rosterKey()` from `@customs/db` over the puuids of **everyone around** — every
    >    posted member, spectators included, bots already dropped (M2.10, point 4). Sorted, so member order never
    >    looks like a change. Sides, the `isSpectator` flag, names, `role_override`, the lobby name and the
    >    password are **not** part of the identity: a friend swapping from blue to red, or into the spectator slot
    >    and back, must not restart the clock, because the balancer assigns sides itself and the sit-out rotation
    >    (below) treats a spectator as one of the people who are here.
    > 2. **The clock** is the lobby row's own `updated_at`. Ingest already reads the stored members before it
    >    writes; when the identity differs from what is stored, it replaces the members **and** writes the lobby
    >    row (`status = 'open'`), which fires `lobbies_set_updated_at` and restarts the clock. When the identity is
    >    the same, nothing is written and `updated_at` stays where it was. `now() - updated_at >= ROSTER_STABLE_MS`
    >    is the whole stability rule. A lobby-name change also touches the row and so costs one more recheck; that
    >    is acceptable and is not worth a column.
    > 3. **The knock.** The lobby response gains `recheckInMs: number | null`. The server returns the milliseconds
    >    left on the clock (minimum 1000, `ROSTER_STABLE_MS` when the roster just changed) whenever the roster has
    >    ten or more people around and the lobby is still `open`; `null` in every other case, including fewer than
    >    ten and already `balanced`. The companion re-posts the identical payload after that delay unless a real
    >    lobby event supersedes it (M2.2). That keeps the ten seconds in one place — the server — and leaves the
    >    companion with no rule to get wrong, only a number to obey.
    > 4. **Two companions.** The transition is claimed with a compare-and-set:
    >    `update lobbies set status = 'balanced' where id = ? and status = 'open'`. Only the request whose update
    >    returns a row balances and inserts splits; the loser answers 200 and writes nothing. If the split insert
    >    then fails, the lobby is `balanced` with no splits for its current `roster_key`; the next post (or the next
    >    recheck) sees that and balances again. Say so in a comment — it is the self-healing path, not a bug.
    >
    > **The sweep.** At the start of every companion lobby and game post, one statement:
    > `update lobbies set status = 'abandoned' where status in ('open','balanced') and updated_at < now() - interval '2 hours'`.
    > The partial index `lobbies_open_idx` covers it. `in_game` is deliberately **not** in that list: `abandoned`
    > keeps the replace semantics (M2.9) and an `in_game` roster must stay frozen, so a lobby whose game was
    > dropped by the server stays `in_game` for good and M5.5 is the surface that lists it. This corrects the
    > second half of point 6 of the M2.10 brief; nothing else in that point changes.
    >
    > ### Choosing the ten, and who sits
    >
    > **Everyone around is a candidate, spectators included.** The pool is every non-bot member of the posted
    > roster whatever their `isSpectator` flag says. This is what `01-architecture.md` already means by "around",
    > and it is forced by the client: each side caps at five, so the eleventh friend has nowhere to stand except
    > the spectator slot. Treating that slot as "volunteered to sit forever" would mean the same person watches
    > every game and the referee never notices — the rotation in step 6 of the nightly loop exists to stop that.
    >
    > - **Exactly ten around:** those ten play, however they are currently seated. Nine on teams and one
    >   spectating is a ten-player night, and the post tells the spectator to take the empty slot.
    > - **More than ten around:** order the pool by (a) games played tonight, most first; (b) least recent
    >   sit-out first (someone who has never sat out sorts first); (c) `puuid` ascending. The first `n - 10`
    >   sit; the rest play. In one sentence for a friend: *whoever has played the most sits, and between equals,
    >   whoever has gone longest without sitting.*
    > - **Fewer than ten around:** nothing happens and the lobby stays `open`. "Around" counts the spectator slot,
    >   so nine on teams and one watching is ten around and does balance; nine people in total is nine.
    > - **The seating may not match the split, and that is expected.** If the chosen ten include `k` people who
    >   are currently in the spectator slot, then exactly `k` of the people sitting out are currently on a team,
    >   and the two lists pair off in the order above — first sitter with first spectator who is playing. When
    >   ten are around and one of them is spectating, `k` is 1 and nobody sits: one person still has to move.
    >   The API hands M3.1 both lists (who sits, and each pair or lone mover); the copy is fixed in **M2.15**
    >   and the embed layout in `05-design.md`, and nothing here invents wording. The companion never moves
    >   anyone: side switching is M4.3, a different task with a different Riot-policy line.
    > - **"Tonight" runs 06:00 to 06:00**, in the timezone named by `CUSTOMS_NIGHT_TZ` (an IANA name, default
    >   `Africa/Cairo`, overridable per deployment), not midnight to midnight — a session that runs to 01:30 is
    >   one night, and the boundary falls at an hour when nobody is playing. Games are counted over
    >   `games.started_at`, joined through `game_players`. The engineer adds the variable to `.env.example` and
    >   to `readServerEnv`. Recorded in `04-decisions.md`.
    > - **"Sat out"** needs no table and gets no column. A sit-out is: the player was a `lobby_members` row of a
    >   lobby that reached `in_game` or `finished`, and has no `game_players` row for that lobby's game. The most
    >   recent such game's `started_at` is their last sit-out. One query per balance over a night's worth of
    >   lobbies; do not cache it.
    > - **The sit-out list is derived, never stored:** it is everyone around minus the ten in the chosen split.
    >   M3.1 and M3.4 read it that way, so it can never disagree with the split beside it.
    >
    > A member the client has placed on neither side and did not mark as a spectator (`side: null`,
    > `isSpectator: false`) is in the pool like anyone else. There is nothing special about them.
    >
    > ### The balance call
    >
    > On the transition to `balanced`, and only then:
    >
    > - Build one `BalancePlayer` per selected player from `lobby_members` + `players` + `ratings` (active season):
    >   `puuid`, `name` = `display_name` (M1.7 guarantees one), `mu`/`sigma`, `mainRole` = `players.main_role`,
    >   `secondaryRole` = `players.secondary_role`, `roleOverride` = `lobby_members.role_override` when set.
    > - **No `ratings` row: seed in memory with `seedFromRank(players.rank_tier, players.rank_division)`** — no rank
    >   at all gives `mu 20.00, sigma 10.00`. **Do not write a `ratings` row here.** Rows are written by the rating
    >   fold and by nothing else, which is what makes "re-seed a new player until they have actually played" free:
    >   with no row, every balance re-reads their newest rank, and the moment they finish a game the fold writes the
    >   row and the seeding stops. There is no explicit re-seed code and there must not be one.
    > - `duos`: pass none. Duo locks have no source yet (no UI, no column); they land with M3.6 at the earliest.
    >   Say `duos: []` and leave a comment naming this line, so the day duos exist there is one place to change.
    > - `lastSplit`: M2.7's lookup — the newest `is_chosen` split whose `roster_key` equals this ten's
    >   `rosterKey()`, taking the five puuids of its `blue`. Null when there is none.
    > - Store all three returned splits in one insert: `rank` 1..3, `blue`/`red` as the balancer's
    >   `{ puuid, role }` arrays, `gap`, `blue_win_prob`, `score`, `off_role_count`, `explanation` verbatim from
    >   core (never recomposed), `roster_key` = `rosterKey()` of the ten, `is_chosen` on rank 1 only.
    > - **A rebalance must clear `is_chosen` on that lobby's earlier splits in the same write.**
    >   `splits_one_chosen_per_lobby_idx` allows exactly one chosen row per lobby and will reject the insert
    >   otherwise. The old rows stay; only the flag moves.
    > - `balance()` throws on anything but exactly ten (`BalanceError`). That throw must never reach the companion:
    >   log one line and answer 200 with the lobby left `open`.
    >
    > ### The rating fold
    >
    > On an eog post, after `ingestEogGame` has written `games` and `game_players` (M1.5 code, unchanged):
    >
    > 1. **Gate.** Rate only when the stored game has exactly ten `game_players` rows, five with `side = 100` and
    >    five with `side = 200`, and `duration_s > 300`. Otherwise keep the row, leave `ratings` untouched, log one
    >    line naming which clause failed. 300 exactly is not rated. A `TerminatedInError` block never gets this far
    >    (the companion drops it, the API refuses it, M2.10 point 6) and must never be rated even if it does.
    > 2. **Claim.** Rating runs exactly once per game, and the claim is the null rating column, not a new column:
    >    the update that writes `mu_before/sigma_before/mu_after/sigma_after` for the game's ten rows carries
    >    `where game_id = ? and mu_after is null`. If it affects zero rows, this game was already rated — answer
    >    200 and stop. If it affects ten, this request owns the fold. Anything between zero and ten is a crash
    >    scar: log it loudly, finish the rows you claimed, and leave the rest to the M5.2 rebuild.
    > 3. **Before.** For each of the ten, the current `ratings` row for `games.season_id`, or a `seedFromRank` seed
    >    when there is none. Order each side by `puuid` ascending so the two arrays handed to `rateGame` are
    >    deterministic and a rebuild produces the same numbers.
    > 4. **Rate.** `rateGame(blue, red, winningSide)` with the real `{ mu, sigma }`. Write the four columns on
    >    `game_players`, then upsert `ratings`: `mu`, `sigma` from the result, `games = games + 1`,
    >    `wins = wins + (side === winningSide ? 1 : 0)`. Read-then-write is fine here — the claim above serialises
    >    the same game, and one group cannot play two games at once.
    > 5. **The lobby.** Move it to `finished` (from `in_game`, `balanced` or `open`). An eog whose `partyId`
    >    resolves to no lobby is stored with `lobby_id: null` and **still rated** — ratings do not depend on a
    >    lobby ever having existed, which is also what makes backfill (M5.1) possible.
    >
    > ### Edge cases
    >
    > - **Fewer than ten around.** Stays `open` forever, no splits, no post, `recheckInMs: null`. Nine people who
    >   sit there for an hour cost the server nothing. Nine on teams plus one spectator is ten around, not nine.
    > - **Eleven to fourteen around.** Selection above picks ten; `balance()` still receives exactly ten.
    >   If selection cannot produce exactly ten (a tie the comparator cannot break is impossible once `puuid` is
    >   the last key, so this means a bug), log and leave the lobby `open`. A wrong ten is worse than no teams.
    > - **Someone leaves while `balanced`.** Back to `open`, clock restarts, the earlier three splits stay in the
    >   table. When the roster returns to those same ten, M2.7's `lastSplit` lookup will find the chosen one of
    >   them and the balancer will avoid repeating it — that is the repeat-split penalty doing its job across a
    >   rebalance, and it is correct.
    > - **Companion disconnects.** Nothing happens: no posts, no transitions, and the lobby ages out after 2 h. If
    >   it comes back it re-posts and the clock restarts. There is no state on the server that decays in between.
    > - **Two companions in one lobby.** Both post the same roster; the identity check makes the second post a
    >   no-op, the CAS makes the balance happen once, `lcu_party_id` and `lcu_game_id` make the writes idempotent.
    >   Two companions must produce exactly three splits and one `games` row.
    > - **Unknown player joins.** A `players` row appears lazily (M1.5), with no rank until M2.4's sweep answers.
    >   They balance at `mu 20.00, sigma 10.00`, they are never marked in any output, and if their rank lands
    >   before their first game finishes they are seeded from it instead. After their first rated game they have a
    >   `ratings` row and their rank never seeds them again.
    > - **A game the server dropped.** No eog is posted; the lobby stays `in_game`; the group opens a new lobby.
    > - **An eog for a lobby that is already `finished`.** Repeat post: no rows change, no re-rating, 200.
    >
    > ### Acceptance check
    >
    > Integration tests against the local Supabase stack, in the style of `companion.integration.test.ts`, with an
    > injected clock so the 10 s and 2 h waits are not real.
    >
    > 1. Post nine members, wait 30 s of injected time, post again: `status: 'open'`, zero `splits` rows,
    >    `recheckInMs: null`, HTTP 200 both times. Post nine on teams plus one spectator instead and it balances
    >    at +10 s with all ten in the split — a spectator is one of the people who are here.
    > 2. Post ten: `recheckInMs` is 10000 (or less on the repost), `status: 'open'`, zero splits. Repost the
    >    identical ten at +10 s: `status: 'balanced'`, exactly **3** `splits` rows, exactly one `is_chosen` with
    >    `rank = 1`, and all three carry the same `roster_key`, equal to `rosterKey()` of the ten puuids.
    > 3. Repost the identical ten again: still exactly 3 split rows, still `balanced`, and the chosen split's id is
    >    unchanged.
    > 4. Swap one member: `status: 'open'`, still 3 split rows. Post the new ten at +10 s: **6** split rows, still
    >    exactly one `is_chosen`, and it belongs to the newer set.
    > 5. Post eleven around — ten on teams and one spectator — where one of the ten already has 2 `game_players`
    >    rows tonight and everyone else has 0: the chosen split's ten exclude that player and **include the
    >    spectator**, `lobby_members` still has eleven rows, and the derived sit-out list is exactly the one
    >    excluded player, paired with the spectator who takes their slot.
    > 5b. The night boundary: a game that started at 02:00 local counts as tonight for a balance at 03:00 local,
    >    and does not count for a balance at 07:00 local. Pin both with an injected clock and
    >    `CUSTOMS_NIGHT_TZ=Africa/Cairo`.
    > 6. `phase: 'in_progress'` for that party: `status: 'in_game'`. Repost the lobby with three members:
    >    `rosterFrozen: true` and `lobby_members` still has the full count (M2.9 regression check).
    > 7. Post an eog with ten participants, five a side, `durationS: 900`: `status: 'finished'`, one `games` row,
    >    ten `game_players` rows with all four rating columns non-null, ten `ratings` rows with `games = 1` and
    >    `wins = 1` for exactly the five on `winningSide`. Post the same eog again from a second token: every one
    >    of those numbers is unchanged and no `ratings.updated_at` moved.
    > 8. Gate: `durationS: 300` → stored, `mu_after` null on all ten, zero `ratings` rows. `durationS: 301` → rated.
    >    Nine participants → stored, not rated. Six-and-four → stored, not rated.
    > 9. An eog whose `partyId` matches no lobby: `games.lobby_id` is null and the ten players are still rated.
    > 10. A player with no `ratings` row and no rank in `players`: their `mu_before` is `20` and `sigma_before` is
    >     `10`. A player with `PLATINUM`/`I` and no row: `28.25` and `8.33`.
    > 11. Idle: a lobby whose `updated_at` is 2 h 1 min old is `abandoned` after any later companion post; one at
    >     1 h 59 min is untouched; one in `in_game` at 3 h old is still `in_game`.
    > 12. Two identical posts fired concurrently at the 10 s mark produce exactly 3 splits and one `is_chosen`.
    > 13. `pnpm -r typecheck` and `pnpm -r test` pass; `docs/04-decisions.md` has the rows listed below.
    >
    > ### Decisions this task records in `04-decisions.md`
    >
    > The stability clock and `recheckInMs`; the 300-second rating gate; the 2-hour sweep excluding `in_game`;
    > "tonight" and `CUSTOMS_NIGHT_TZ`; the sit-out ordering and how a sit-out is derived; the null-`mu_after`
    > claim as the rate-once guarantee. Several of these are already written above — the row is the durable record,
    > not a second decision.
    >
    > ### Out of scope
    >
    > Discord, entirely (M3.1, M3.3). The tonight page (M3.4). Reroll (M3.2) — this task only sets `is_chosen` on
    > rank 1 and must not add an endpoint that moves it. Duos and role overrides as an input surface (M3.6). Voice
    > (M4). The rating rebuild (M5.2) and season carryover (M5.3). Any new column or migration: if one turns out to
    > be unavoidable, stop and tell the lead rather than adding it here. Reusing a party id for a second game the
    > same night is **M2.14**, accepted and sequenced immediately after M2.10, so it will most likely be in place
    > before this task starts. Either way M2.5 adds no reuse logic of its own: `finished` is terminal for a row,
    > and resolving a party id to its live row is M2.14's change to `selectLobby` and `findLobbyId`.

    > **Addendum (lead, 2026-09-08).** The 2-hour abandon sweep keeps running opportunistically at the start of
    > every companion post, as the brief describes, **and** M2.5 also exposes it as `GET /api/cron/sweep`,
    > guarded by a bearer `CRON_SECRET` (added to `.env.example` and `readServerEnv`). Same statement, same
    > rules, no second copy of the logic; the route exists so a scheduler can close out a night on which nobody
    > posted again. It writes nothing else and answers `{ ok: true, abandoned: <n> }`. A missing or wrong
    > secret is a 401. Recorded in `04-decisions.md`.

- [~] **M2.6** (built and reviewed; publish and Windows verification pending on the user, see docs/06-test-night.md. **One rebuild is owed, by M4.1's 2026-09-12 gate flip**: the shipped exe is 0.1.4, the verify-commands probe build, and it carries `LOBBY_WRITE_VERIFICATION.verified: false` from `packages/lcu/src/writes.ts` — with the server's gate now open it nacks `endpoint_unverified` for every `create_lobby`, `invite` and `switch_side` it is handed. Bump `apps/companion/package.json` to 0.1.5 and run `pnpm --filter companion release`; M4.1, M4.2 and M4.3 are dead on a real night until that asset is on the release page) Packaging: single Windows exe (Node single-executable application or `pkg`), `README` for friends with three steps: download, paste token, leave it running. Verify it survives a client restart and a PC sleep.

    > **Brief (product, 2026-09-08)**
    >
    > **The scene.** A friend gets one link in the group chat. They download one file, double-click it, paste
    > the token once, and never think about it again — every night after that it is already running. If setup
    > costs them a second evening they will not run it, and a night with nobody running it is a night the bot
    > does not exist.
    >
    > **What ships, and where it lives.** One file, `Kustom.exe`, and the README below. Releases are
    > **GitHub release assets on the public repo `suyaser/kustom-releases`** (lead, 2026-09-09); the code repo
    > stays private. One tag per version, `v<version>`, carrying `Kustom.exe` and `README.txt`, and the
    > link in the group chat is the stable one GitHub keeps pointed at the newest tag:
    > `https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe`. It needs no
    > GitHub account to download. This replaces the Supabase `releases` bucket, whose free plan caps an object
    > at 50 MB against a 90 MB exe — see `04-decisions.md`. `/admin` links to it (the tonight page later). The
    > upload is part of the build step, not a manual drag: `pnpm --filter companion build:exe` produces the
    > file and the command that publishes the tag is written down beside it. No installer, no sidecar DLLs,
    > and no `.zip` a friend has to unpack — an unpack step is a step.
    >
    > **Which origin gets baked in.** The deployed Vercel URL, once it exists. If it is not ready when this task
    > starts, build with a placeholder origin, finish everything else, and rebuild the exe against the real URL
    > before the tag is published — no friend ever downloads the placeholder build.
    >
    > **How it is built.** The companion runs on `tsx` today, with `.js` relative imports and two workspace
    > dependencies, so a bundle comes first: one esbuild pass (`--bundle --platform=node --target=node22`) over
    > `src/main.ts` that pulls in `@customs/lcu`, `@customs/db` and `zod`, and then Node's single-executable
    > application or `pkg` over that bundle. **The engineer picks SEA or `pkg`, and records the choice and the
    > reason** in `04-decisions.md`; both are acceptable and the one that produces a working exe with the least
    > machinery wins. Add the command as `pnpm --filter companion build:exe` and list it in the commands block
    > of `CLAUDE.md`.
    >
    > **Building on a Mac for Windows.** Builds happen on this Mac; the target is Windows x64. SEA injects into
    > a `node.exe` of the same major version (>= 22, matching the repo's `engines`), which can in principle be
    > downloaded and injected from macOS — but nothing about that is verified here. **If cross-building has not
    > produced a working exe within an hour, build on the Windows PC instead.** It already has the repo checked
    > out for M2.11, and which path was used goes in the README's build section. Do not spend a day on the Mac.
    >
    > **The API origin is baked in.** `DEFAULT_API_BASE` in `config.ts` is `http://localhost:3000`, which is the
    > wrong answer on a friend's PC. It becomes a build-time constant: an esbuild `--define` (or an equivalent
    > generated module) carries the deployed Vercel origin, falling back to `http://localhost:3000` when the
    > define is absent so `pnpm --filter companion dev` is unchanged. A `config.json` with its own `apiBase`
    > still wins over it, always. **And when the baked origin answers `GET /api/health`, the first run does not
    > ask for an address at all** — it goes straight to the token prompt, and only falls back to today's
    > `API address [...]` question when that check fails. One paste, not two answers. Recorded in
    > `04-decisions.md`.
    >
    > **The console is the product here.** Console level stays `info` (the file keeps `debug`), and a friend's
    > entire experience is: a starting line, the token prompt on first run only, `api reachable`, `waiting for
    > the League client` or `connected to the League client`, then `watching`. No progress bars, no repeating
    > poll lines, no stack traces. The first line names the app, because an unlabelled console window is the
    > one that gets closed.
    >
    > ### The README, verbatim
    >
    > Ships as `apps/companion/README.md` and beside the download. This is friend-facing copy: an engineer who
    > needs different wording asks product for it rather than rewriting it. A short build section for us may
    > follow the three steps, below a horizontal rule.
    >
    > ```markdown
    > # Kustom companion
    >
    > This little app watches your League client and tells the bot who is in the lobby and who won, so nobody
    > has to pick teams or report scores. It only reads the client — it never plays for you and never clicks
    > anything in a game.
    >
    > ## 1. Download it
    >
    > Get `Kustom.exe` from the link in the group chat —
    > <https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe>, which always
    > gives you the newest one — and put it somewhere you will find it again. Your desktop is fine. You do not
    > need a GitHub account.
    >
    > Windows may say it does not recognise the app. Click **More info**, then **Run anyway**. It says that
    > about anything that is not from a big company.
    >
    > ## 2. Paste your token
    >
    > Double-click it. The first time, it asks for a token. If it is your first time, join one of our custom
    > lobbies first so the bot knows you exist, then ask for the token. Whoever runs the admin page makes one for
    > you and sends it over — ask them for it. Paste it in and press Enter. You will not see it as you type; that
    > is on purpose.
    >
    > It remembers the token, so this is the only time you do this.
    >
    > ## 3. Leave it running
    >
    > That is the whole job. Play League as usual. When you are in a custom lobby with the others, the teams
    > show up in Discord on their own, and the result lands on the site when the game ends.
    >
    > Keep the window open while you play. Closing it breaks nothing — you just stop being the one reporting —
    > but if nobody has it open when a game ends, that game is not counted.
    >
    > ## If something looks wrong
    >
    > The app writes down everything it did. Press Windows+R, paste `%APPDATA%\customs-night\logs`, press
    > Enter, and send the newest file to whoever set this up. There are no passwords in it.
    >
    > Your token is in `%APPDATA%\customs-night\config.json`. Do not paste that file anywhere; it is yours.
    > ```
    >
    > ### Acceptance check
    >
    > On the Windows PC (the same machine as M2.11), against the deployed API, with the League client installed:
    >
    > 1. **Cold install.** Download the exe, double-click it, paste the token: the console reaches `watching`
    >    within 30 s of the League client being up. Download to `watching` in under 2 minutes, on a PC with no
    >    Node and no pnpm, with no address typed.
    > 2. **Second run.** Close it and run it again: no prompt, and `watching` again.
    >    `%APPDATA%\customs-night\config.json` holds the token and the baked origin.
    > 3. **Bad token.** A mistyped token produces one plain sentence naming the problem and pointing at the
    >    admin page — not a stack trace, and not silence.
    > 4. **Client restart.** With the exe running, quit and relaunch the League client: within 30 s the console
    >    logs `lockfile changed; the client restarted` (or `lockfile gone`) and comes back to `watching`, with
    >    no human action and no process exit.
    > 5. **Sleep.** Sleep the PC for 2 minutes and wake it: within 60 s the console is back at `watching`, and a
    >    lobby opened after the wake still produces a lobby POST. If the socket instead comes back silent — open
    >    but delivering no events — fixing that (a liveness ping, or closing on a missed heartbeat) is part of
    >    this task, and the finding goes into `03-lcu-reference.md`.
    > 6. **Size.** One file, under **120 MB** (it carries Node; the README says so if anyone is surprised).
    > 7. **No spam.** An hour with the client open and no lobby produces at most 20 console lines, and no line
    >    contains the token, a lockfile password or a raw event body. The log file has the rest.
    > 8. **One URL, everywhere.** The download link printed in `apps/companion/README.md`, in this brief, in
    >    `docs/06-test-night.md` and on `/admin` is byte-identical to
    >    `https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe`, the tag
    >    `v<version>` carries both `Kustom.exe` and `README.txt`, and `curl -IL` on the link answers 200
    >    from a signed-out session before it goes into the group chat.
    > 9. `pnpm -r typecheck` and `pnpm -r test` still pass, and `pnpm --filter companion dev` still starts
    >    against `http://localhost:3000` with no config file present.
    >
    > ### Out of scope
    >
    > Code signing and anything else that removes the SmartScreen prompt — it costs money and a certificate, and
    > the README handles it in one sentence. Auto-start with Windows, a tray icon and a status indicator (M6.1).
    > An auto-updater: a new exe is a new link in the group chat. macOS and Linux builds — `pnpm --filter
    > companion dev` stays the path for the two of us who develop it. Any change to what the companion does:
    > this task changes only how it is delivered and what a friend reads.

- [x] **M2.7** (landed inside M2.5: roster_key lookup feeds lastSplit, tested) `lastSplit` for the balancer: when a lobby reaches `balanced`, the API looks up the most recent chosen split (any night) whose lobby had exactly the same ten puuids as this lobby, and passes the five puuids of one of its sides as `lastSplit`. If no such split exists, it passes null. Never pass a split from a lobby with a different roster.

    > **Acceptance check (product).** With a stored chosen split for the same ten players, a new lobby with those
    > ten sends a `lastSplit` of exactly five puuids drawn from that stored split's blue or red side, and the
    > returned split 1 is not the repeat. Change one player in the lobby and `lastSplit` is null on the next
    > balance. With no history for these ten, `lastSplit` is null. Side colour of the stored split does not
    > change the result (M1.4 already treats it as colour-agnostic).

- [x] **M2.8** Widen the game-ingest participant check so a spectator's companion is not locked out. `POST /api/companion/game` accepts an eog block when the token's player PUUID appears among the game's `participants` **or** is a member of the lobby with the same `lcu_party_id` as the posted game, `isSpectator` included. A token whose player is in neither list still gets a 403. Backfill's admin-approved exception is unchanged.

    > **Why (product).** `companionLobbyMemberSchema` carries `isSpectator`, so a friend who sits out a
    > round and runs the companion while watching is a real, normal case. Under the M1.5 rule their eog POST
    > is rejected, and if they are the only one running the companion that night the game is lost until
    > backfill (M5). This is not an M1.5 regression — the old `localPlayer` rule had the same hole — but it
    > should be decided behavior, not an accident. M2.8 records the widened rule in `04-decisions.md` and
    > updates the "Security" bullet in `01-architecture.md` the same session.

    > **Acceptance check (product).** Post an eog whose participants exclude the token's player but whose
    > lobby (same `lcu_party_id`) has that player as `isSpectator: true` — the game lands once with ten
    > `game_players` rows. A post from a token whose player is in neither list still 403s.

    > **Blocked-on note (product, 2026-09-08, after M0.3).** The acceptance check above assumes a spectator
    > shows up in the lobby payload as a member with `isSpectator: true`. **Nobody has seen that happen.**
    > The 16.17 capture has one solo lobby with bots: `customSpectators` was `[]` in all 30 lobby events and
    > no member ever had `isSpectator: true`. If the client keeps spectators only in
    > `gameConfig.customSpectators[]` and out of `members[]`, this task's lobby-membership path never
    > matches and the spectator case is no better than it is today. Capture it first — **M2.13**.
- [x] **M2.9** Freeze the lobby roster once the lobby reaches `in_game`. `replaceMembers` (M1.5) makes `lobby_members` mirror whatever the companion last posted, deletions included — verified 2026-09-08: posting the same party with an empty `members` array left the lobby row with zero members and HTTP 200. So the record of who was in a lobby is mutable right up to and past the game. M2.7 matches tonight's ten against "a lobby that had exactly the same ten puuids", and M5.5 lists lobbies that reached `in_game` and never finished; both read a list that a late or partial post can empty. Once the state machine (M2.5) moves a lobby to `in_game`, freeze `lobby_members` entirely, and keep it frozen through `finished`: a later post for that party is still accepted (200) and still idempotent, and the lobby's own fields (name, password) still refresh, but no member row is inserted, updated or deleted — `side` included, because once the game has started the side that counts is the one recorded on `game_players`. The response says `rosterFrozen: true` and returns the stored member count so the companion can see nothing moved. `open`, `balanced` and `abandoned` keep the replace semantics.

    > **Why (product).** "Who was around tonight" is the input to the sit-out rotation (step 6 of the nightly
    > loop) and to the repeat-split penalty. If it can be erased by the last companion to shut down, the
    > referee forgets last night and the same five get put together again — the one failure of this product
    > people would actually notice.
    >
    > **Edge cases.** Someone leaving while the lobby is still `open` is a real leave and must still delete
    > their row; this rule only applies from `in_game` on. A lobby that goes `abandoned` without ever
    > reaching `in_game` keeps the normal behaviour. A companion that reconnects mid-game and posts a partial
    > list changes nothing. Two companions posting different lists after `in_game` both change nothing.
    >
    > **Acceptance check.** Post a ten-member lobby, drive it to `in_game`, then repost the same party with
    > three members: `lobby_members` still has ten rows. Repost with an empty list: still ten. Do the same
    > against a lobby still in `open`: the deletes apply as they do today.


- [ ] **M2.11** Run the M0 verification pass on Windows before anything is packaged. Every row in `03-lcu-reference.md` was verified on macOS (16.17, 2026-09-08) and the companion ships as a Windows exe, so today the shipped platform is the unverified one. With the client running on Windows: `pnpm --filter @customs/lcu smoke --diff` against the committed `16.17` fixtures, plus a lockfile read at the Windows default path and one exercise of the process-args fallback. Update the Connecting rows in `03-lcu-reference.md` with Windows evidence, and turn "Process args fallback" from `unverified (observed, no code)` into a verified row or a task to drop it. If no Windows PC is available in the group, M2 ships macOS-verified and is corrected on the first Windows install — say so in the reference rather than leaving the rows looking platform-neutral.

    > **Why (product).** The scene is ten friends in Discord; nine of them are on Windows. A shape difference
    > between platforms — a lockfile path, a certificate mode, an empty `summonerName` that is populated on
    > Windows — would be found on the first real night with everyone waiting, which is the worst possible
    > place to find it. This is an afternoon on one PC.
    >
    > **Edge cases to cover while the client is up.** Client not running (exit 2). Client starting up, so the
    > lockfile exists but the port is not listening yet — the probe must exit 3, not silently fall back to
    > `insecure`. Client restarted while the companion watches (the reconnect path of M2.1). A non-default
    > install directory, which is what the process-args fallback exists for: hide the lockfile, or point
    > `LCU_LOCKFILE_CANDIDATES` at a path that does not exist, and confirm the fallback finds the same port
    > and password.
    >
    > **Acceptance check.** `smoke --diff` exits 0 on Windows against the `16.17` fixtures, or every
    > difference is written into the reference with a Windows note. The lockfile row and the process-args row
    > carry a dated Windows line. `pnpm --filter lcu test` still passes.
    >
    > **Out of scope.** Packaging (M2.6). Any new endpoint. Re-verifying the M4 rows.

    > **Note (product, 2026-09-08): the PC exists, and this is the run sheet.** A Windows PC with League
    > installed is available to the user. The fallback sentence in the task line — ship macOS-verified and
    > correct it on the first Windows install — stays on the record as plan B and is not the path. This is an
    > afternoon on one machine.
    >
    > **On that PC, in order.** Node >= 22 and pnpm first (`corepack enable`):
    >
    > ```
    > git clone https://github.com/suyaser/kustom.git
    > pnpm install
    > pnpm --filter @customs/lcu smoke --diff
    > pnpm --filter companion dev
    > ```
    >
    > The first three are the reference pass. The fourth is the **M2.1 open item**: the companion's config
    > directory (`%APPDATA%\customs-night`), its hidden token prompt and its daily log file were written from
    > the docs and have never executed on Windows. Run it with the client up, let it reach `watching`, then
    > quit and relaunch the League client and watch it reconnect; Ctrl-C ends it. Its first run asks for an API
    > address and a token: press Enter at the address, answer `y` to "Keep it anyway?" if nothing answers, and
    > paste a real token if one has been minted or any non-empty string if not — today's hooks only log, and
    > M2.2 and M2.3 post nothing yet.
    >
    > **What to paste back**, in the lead's thread:
    >
    > 1. The client version and the last 20 lines of `smoke --diff`, including its exit code (`echo
    >    %ERRORLEVEL%`) and every difference it reported.
    > 2. The lockfile line from that output: the path found and the port parsed. **Never the password, and
    >    never the raw lockfile.**
    > 3. Whether the process-args fallback found the same port with the lockfile hidden (point
    >    `LCU_LOCKFILE_CANDIDATES` at a path that does not exist).
    > 4. The two probe results from the task's edge cases: the exit code with the client closed (expect 2), and
    >    the exit code with the client still starting up (expect 3, never a silent fall back to `insecure`).
    > 5. The companion's first 15 console lines, through `watching` — they carry `configDir` and `logDir` — plus
    >    what it printed when the client restarted, and a directory listing of `%APPDATA%\customs-night` and
    >    `%APPDATA%\customs-night\logs`.
    > 6. **Never** the companion token, the lockfile password, or a log file nobody has read first.
    >
    > Anything that differs from macOS goes into `03-lcu-reference.md` as a dated Windows line, not into a
    > message: a difference nobody wrote down is a difference we find again on the first real night.

- [x] **M2.13** Find out where a spectator appears in the lobby payload. Two people and ten minutes: one runs `pnpm --filter @customs/lcu record-ws` in a custom lobby, the other clicks the spectator slot and back out. The whole question is whether that person shows up in `members[]` with `isSpectator: true`, or only in `gameConfig.customSpectators[]`, or in both. Nothing in the 16.17 capture answers it — `customSpectators` was `[]` in all 30 lobby events and no member ever carried `isSpectator: true`, because it was a solo lobby with bots. Deliverable: `packages/lcu/fixtures/16.17/lobby-spectator.json`, parsed in `schemas.test.ts`, and the answer written into the lobby row and into question 3 of "Behaviors to confirm" with a date and patch.

    > **Why (product).** Two rules rest on the unobserved answer. M1.8 (done, shipped) refuses a lobby post
    > unless the caller's PUUID is in the posted `members`, "`isSpectator: true` counts". M2.8 accepts a
    > spectator's end-of-game post if that player is a lobby member with `isSpectator: true`. If the client
    > does not put spectators in `members[]`, both are dead letters: the friend who sits out tonight — often
    > the same person who runs the companion, because they have nothing else to do — gets a 403 on every
    > lobby post, and the group's teams never appear. That is the whole scene failing on an ordinary
    > eleven-person night.
    >
    > **Consequence, to be carried out by this task.** If a spectator is absent from `members[]`: widen the
    > M1.8 caller check and the M2.8 lobby check to also accept a PUUID found in
    > `gameConfig.customSpectators[]`, add the decision row to `04-decisions.md`, and correct M1.8's
    > wording — a shipped rule must not describe a payload the client does not send. If a spectator *is* in
    > `members[]` with the flag, both rules are already right; say so in the reference and change no code.
    >
    > **Acceptance check.** `lobby-spectator.json` committed and parsed by `schemas.test.ts`. The lobby row
    > and question 3 state where a spectator appears, dated and patch-tagged. Either a code change plus a
    > decision row, or one line in the reference confirming the existing rules were correct.
    >
    > **Out of scope.** The ten-human lobby fixture (see the note under this milestone's acceptance line).
    > M4's lobby creation. Any spectator-facing UI.

- [x] **M2.15** The sit-out copy: who sits, and who swaps into their slot. M2.5 decides it (everyone around is a candidate, spectators included; most games tonight sits, then least recent sit-out) and the numbers are settled — this task is the wording and the embed field, and it ships with M3.1. The strings below are product copy and ship verbatim; `05-design.md` gains the field layout in the same session.

    > **The copy (product, 2026-09-08).** Two independent fields. Each appears only when it has something to
    > say, and neither ever apologises for the other.
    >
    > **Field `Sitting out`** — present only when somebody sits.
    >
    > 1. `Sitting out: {names} — most games tonight.` Names joined with `, ` and a final ` and `.
    > 2. When everyone around has played the same number of games tonight, the reason clause is
    >    `— longest since they last sat out.` instead. Always `they`: no surface in this product genders anyone.
    > 3. Nobody sits, no field. Never `Sitting out: nobody`.
    >
    > **Field `Seats`** — present only when somebody has to move, which is not the same question.
    >
    > 4. One line per pair, in the order M2.5 pairs them: `Swap: {sitter} out, {mover} in.`
    > 5. A mover with nobody to swap with — ten around, one of them watching, nobody sitting:
    >    `{Name} is playing — take the open slot.`
    > 6. Everyone already in the right seat, no field.
    >
    > Worked example, eleven around, Omar has played four tonight and Nadia has been watching:
    >
    > > **Sitting out**
    > > Sitting out: Omar — most games tonight.
    > >
    > > **Seats**
    > > Swap: Omar out, Nadia in.
    >
    > Worked example, ten around with Yuki in the spectator slot:
    >
    > > **Seats**
    > > Yuki is playing — take the open slot.
    >
    > **Why it reads like that.** It says the rule in four words so nobody has to ask why, it names the move as
    > one action rather than describing the client's UI, and it stops there — the referee is not embarrassed
    > about the rotation and does not explain itself twice. Splitting sitting from seating keeps each line
    > about one thing: on most nights only one of the two fields is there at all.
    >
    > **Acceptance check.** Eleven around, ten on teams and one spectating, the spectator having the fewest
    > games tonight: the chosen split contains the spectator, both fields are present, each string verbatim,
    > and the names in the `Swap:` line are the pair M2.5 paired. Ten around, all ten on teams: neither field
    > appears. Ten around with one spectating: `Seats` only, with the `take the open slot` line, and no
    > `Sitting out` field. Twelve around with two sitters and two movers: one `Sitting out:` line naming both
    > and two `Swap:` lines. All games tied at zero: the `longest since they last sat out` variant.
    >
    > **Out of scope.** Moving anyone (M4.3 switches sides, and only for the local player). A reaction, button
    > or command to volunteer to sit — that is a typed step, and this product does not have those.

- [x] **M2.18** Say it out loud when no season is active. `games.season_id` is `not null default public.active_season_id()` (`0001_init.sql`), so with no active season **every** game insert of the night fails — after the game, on a Vercel function, with nothing on any console but a failed post and a retried queue file. `POST /api/companion/game` answers with a message that names the missing active season (and is refused before any write rather than surfacing as a generic insert error), and `/admin` says the same sentence where it today prints "No season is active. Start one on the seasons page." — that page already knows; the API does not. Owner: `platform-engineer`, **after M3.1 and M3.3** (found while writing the M2 test-night sheet, where it is precondition 2 and a human checks it by eye).

    > **Acceptance check.** With no active season: an eog post is refused with a body naming the season, nothing is written to `games`, the companion keeps its queue file (a retryable failure, not a permanent one, so the night is recovered by starting a season and letting the queue drain), and the log line names the season rather than a Postgres error. With a season active every M2.5 check still passes unchanged. `/admin` and the seasons page print the same sentence. **Amended 2026-09-09 (M3.17):** the tonight page does *not* print this sentence after all — it prints its own, `No season is active, so tonight's games are not being saved. An admin can start one.`, because this one ends by naming a page only an admin can open and the tonight page is read by the whole group. Same fact, different reader. `/admin`, the seasons page and this route are unchanged.
    >
    > **Out of scope.** Auto-creating a season (a season is a thing the group decides together, `00-product.md`). Any change to the rating fold or the gate.

Acceptance: two people run the companion, play one custom, and the game appears once in `games` with ten `game_players` rows and updated ratings. Kill one companion mid-game; the game still lands.

> **Run sheet (product, 2026-09-08): `docs/06-test-night.md`.** The exact sequence, what the friend is told,
> what the user pastes back, and a pass/fail table mapping every line of this acceptance to its evidence.
> **Two sessions, and this milestone is ticked only after the second** (lead, 2026-09-08), because a custom
> with fewer than ten humans is stored and never rated (the ten-participant / 300 s gate). **Session 1, the
> rehearsal:** two people, the Windows exe plus the Mac companion, proving capture, the roster freeze, dedupe,
> M2.3 check 5's crash recovery and check 8's kill-one-companion-mid-game. **Session 2, the ten-human night:**
> the rating fold and the "appears once with ten rows" half of the line. Until Session 2 lands, M2 is
> **partial**, and the only standing proof of the fold is
> `apps/web/app/api/companion/lobbyState.integration.test.ts`, "rates a real game once, however many
> companions post it".
>
> Three things end a session before it starts and are checked first: a season must be active (**M2.18** is the
> task that makes that failure say so instead of failing after the game), the Vercel variables of the
> precondition below must be set, and **the second machine's player row must exist before its token is
> minted** — `/admin/tokens` mints against an existing player, which is why the M2.6 README now tells a
> first-timer to join a lobby before asking for a token (`04-decisions.md`). Session 1 also needs a **second
> League account** for the Mac companion: the user's own or the friend's, decided in the pre-night list, not
> on the night.

> **Precondition (product, 2026-09-08).** The API has to be deployed on Vercel before the test night: ten
> friends' companions cannot reach a laptop on someone's desk, so the deployment is not an M3 nicety but the
> thing that makes this acceptance runnable at all, and it is the origin M2.6 bakes into the exe. The Vercel
> project needs every variable in `.env.example` plus the two M2.5 introduces: `CUSTOMS_NIGHT_TZ` (an IANA
> name, `Africa/Cairo`) and `CRON_SECRET`, the bearer of `GET /api/cron/sweep` — M2.5 sweeps opportunistically
> on companion posts **and** exposes that route for a scheduler, so the secret has a reader.

> **Note (product, 2026-09-08).** Capture `lobby-10.json` on the first M2 test night. Every lobby fact in
> `03-lcu-reference.md` comes from a one-human lobby with bots, so nothing has confirmed that a full lobby
> looks the same: `summonerName` still empty with ten real people in it, member ordering, `maxTeamSize`,
> the position-preference fields, and five puuids in each of `customTeam100`/`customTeam200` rather than
> one and none. The night already puts ten people in a lobby; someone runs `record-ws` alongside, the
> fixture lands in `packages/lcu/fixtures/16.17/`, and `schemas.test.ts` parses it. This is a byproduct of
> the acceptance run, not a task that blocks it.

- [x] **M2.19** Windows first-run fixes from the 0.1.0 field test (2026-09-09): the hidden token prompt discards terminal escape sequences and validates the token shape before saving (re-prompts, `--show-token`); a custom League install is found via the process list when the default lockfile is missing (`lockfilePath` still wins). Ships as companion 0.1.1.
- [x] **M2.20** Rename to Kustom. The user, 2026-09-09: the group says "kustom", so the product is **Kustom**; `Customs Night` stays the repo's codename in `CLAUDE.md`, the docs and the package names, and appears on no surface a friend sees. The companion half: the exe becomes `Kustom.exe` (and `Kustom.exe.sha256`), the download link becomes `https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe`, the console banner becomes `Kustom companion <version> starting`, the first-run prompt lines, `--help` and every other printed string drop "Customs Night", `apps/companion/README.md` is retitled `Kustom companion` throughout, the release title is `Kustom companion <version>`, and the `kustom-releases` README line names the new asset. Ships as companion **0.1.3**, rebuilt and re-published. Owner: `companion-engineer`, **before the first published release** — after a friend has the old file in their downloads folder this costs everybody a re-download. `%APPDATA%/customs-night/config.json` does **not** move: it is a path, not a surface, and moving it would make an existing install ask for its token again. **Acceptance:** `grep -ri "customs night" apps/companion packages/lcu` returns only codename comments and the config path, never a printed string; the built `Kustom.exe` prints `Kustom companion 0.1.3 starting` and its `--help` says Kustom; the download URL is byte-identical in `apps/companion/README.md`, the M2.6 brief, `docs/06-test-night.md`, `/admin` and the releases-repo README; `Kustom.exe.sha256` is published beside it and matches; `CLAUDE.md`'s `build:win` line and `docs/03-lcu-reference.md`'s `verify-commands` line name `Kustom.exe`; `pnpm -r typecheck` and `pnpm -r test` pass.

## M3 Teams in Discord and on the web (2 to 3 days, needs M2)

Goal: first real night. Ten join the lobby, teams appear in Discord with an explanation, results and leaderboard follow.

- [x] **M3.0** Design system: `designer` produces `docs/05-design.md` (tokens, type, component notes, Discord embed text layouts). Lands before any M3 UI task.
- [x] **M3.1** On `balanced`: post the teams embed to the Discord webhook from the stored chosen split (M2.5 runs the balancer and stores the three splits): two columns with role and display rating, the explanation line, lobby name and password if known, and a sit-out line when more than ten are around. Sit-out copy goes through product before it ships (M2.15).

    > **Brief (product, 2026-09-08)**
    >
    > **The scene.** Ten friends are in voice, someone opened a custom lobby, everyone joined. Nobody typed
    > anything. Within seconds of the tenth join Discord shows two teams with roles beside the names, one
    > sentence saying why, and the lobby name and password so a straggler can still get in. That is the whole
    > task: the moment the lobby goes `balanced`, the group has teams.
    >
    > **What happens, in order.** M2.5 moves the lobby to `balanced` (ten non-spectator members unchanged for
    > 10 seconds). On that transition the API builds the balancer input from `lobby_members` and `ratings` for
    > the active season, takes `lastSplit` from M2.7, calls `balance()`, stores all three splits with their
    > explanation strings in `splits` (exactly one `is_chosen`), computes the sit-out list when more than ten
    > are around, and posts one teams embed to the webhook in `discord_config`. Field names, line format,
    > order, colour and every string are `docs/05-design.md`, "Teams embed". That document is the copy, not a
    > suggestion.
    >
    > **Explanation line.** Posted verbatim from the stored explanation of the chosen split. Never recomposed
    > from the split's numbers, never shortened to fit, never split into fields. M3.7 is the end-to-end check.
    >
    > **Sit-out line.** Only when more than ten are around. It names the sitters and states the rule in one
    > sentence. The strings are fixed in `05-design.md`; **copy goes through product** before it ships — an
    > engineer who needs different wording asks for it rather than writing it.
    >
    > **Tonight page URL.** The embed `url` is `NEXT_PUBLIC_SITE_URL` (already introduced by M1.6 and read and
    > normalised by `readAuthEnv` in `apps/web/lib/env.ts`) plus the tonight page path. **No domain exists
    > yet**, so: when the variable is unset, fall back to the origin of the request that triggered the
    > transition; if there is no usable origin either, post the embed with no `url` rather than a broken one.
    > Never hardcode a host, and never post a `localhost` link to Discord.
    >
    > **Edge cases.**
    >
    > - **Fewer than ten.** No balance, no post. The lobby stays `open` and the tonight page shows the member
    >   list. `balance()` throws on nine and that throw must never reach the webhook or the companion.
    > - **More than ten.** The API picks the ten (fewest games tonight, then oldest sit-out) and the rest are
    >   the sit-out list; `balance()` still receives exactly ten. If the selection cannot produce exactly ten,
    >   log one line and post nothing: a wrong ten is worse than no post.
    > - **Someone leaves before the post.** The 10-second stability rule has not fired, so nothing was posted
    >   and there is nothing to undo.
    > - **Someone leaves after the post.** The lobby returns to `open` and rebalances, which posts a new
    >   embed. M3.1 does not edit or delete the earlier message; two messages in the channel is the honest
    >   record of what happened.
    > - **Companion disconnects.** Nothing is re-posted. The split is stored and the embed is out. When the
    >   companion returns and re-posts the same party, ingest diffs before it writes and the transition does
    >   not fire again. Two companions in one lobby produce one post; dedupe on `lcu_party_id`.
    > - **Unknown player.** A lobby member with no `ratings` row for the active season is seeded from their
    >   rank (M1.3, M2.4) before balancing; with no rank either, they seed unranked (`mu 20.00, sigma 10.00`).
    >   They are balanced like anyone else and carry no marker in the embed — the "still settling" story is
    >   the leaderboard's job (M3.8), not the teams post. A player with no `mainRole` is never counted
    >   off-role.
    > - **Webhook missing, or Discord refuses the post.** Store the splits anyway and log one line. The
    >   tonight page is the other surface and must not depend on Discord having accepted anything. No retry
    >   loop.
    >
    > **Acceptance check (product).**
    >
    > 1. Drive a ten-member lobby to `balanced`. Exactly one embed is posted, within 15 seconds of the tenth
    >    join: accent bar (`14721854`), title `Teams are set`, the stored explanation string verbatim as the
    >    description, two inline fields named `Blue · <sum>` and `Red · <sum>`, five lines each in lane order
    >    `top jungle mid adc support` with the role in inline code, footer
    >    `Kustom · more on the tonight page`.
    > 2. `splits` has three rows for that lobby with their three explanation strings, exactly one `is_chosen`.
    > 3. Eleven around: the embed also carries the `Sitting out` field with the product copy verbatim, and the
    >    ten in the team fields are the ten with the fewest games tonight.
    > 4. Nine around: no post, no `splits` rows, and the companion's POST still answers 200.
    > 5. Lobby name and password known: the `Lobby` field is present. Unknown: the field is absent, not empty
    >    and not `unknown`.
    > 6. Someone off-role in the chosen split: their line ends ` · off-role` and the description names them.
    > 7. With `NEXT_PUBLIC_SITE_URL` unset and no usable request origin, the embed posts with no `url` and
    >    nothing else changes.
    >
    > **Out of scope.** Reroll (M3.2), the result embed (M3.3), the tonight page (M3.4), voice split (M4),
    > editing or deleting a posted message, @-mentions, reactions, buttons, and any slash command. Nobody
    > types to make this happen and nobody types after it.

- [x] **M3.2** (admin route and /admin control; the tonight-page button lands with M3.4) Reroll: an admin route and a small button on the tonight page that promotes split 2 or 3 and reposts. No random reroll exists.

    > **Brief (product, 2026-09-09)**
    >
    > **The scene.** Teams are posted, and somebody in voice says "nah, run it again". One person taps once.
    > Within a second or two the channel has the second split and the page has changed under everybody. Nobody
    > typed a command, nobody voted, and there are exactly two of these taps in a night's lobby before the
    > answer is "play these".
    >
    > **Two pieces, two milestones.** The route ships now. The button ships with the tonight page (M3.4),
    > because there is no page to put it on until then; its behavior is specified here so M3.4 has nothing to
    > decide. An admin with no page can still reroll from the route, which is the whole reason the route goes
    > first.
    >
    > **The route.** `POST /api/admin/lobbies/[lobbyId]/reroll`, admin session and `players.is_admin` like
    > every other admin route, request and response through zod. The body names the split it means
    > (`{ splitId }`) — never "next", never "random". Naming the target is what makes a double tap on a slow
    > phone harmless.
    >
    > 1. Refuse unless the lobby's status is `balanced`. `in_game`, `finished`, `abandoned` and `open` all
    >    answer 409 and change nothing: once the game has started, the teams on the rift are the teams.
    > 2. The split must belong to this lobby, or 404.
    > 3. Already `is_chosen`: 200, nothing promoted, **nothing posted**. Two taps produce one message.
    > 4. Otherwise clear `is_chosen` on the lobby's chosen row and set it on the target — the same two
    >    statements, in the same order, that `storeSplits` uses, because `splits_one_chosen_per_lobby_idx`
    >    allows exactly one chosen row per lobby.
    > 5. Then `postTeamsForSplit(client, splitId, { requestOrigin })`. The promotion stands whatever Discord
    >    answers; the response says whether the post went out. A webhook that is down costs the group a
    >    message, never the teams.
    >
    > **What the embed says.** The same teams embed, with the title carrying which reroll this is:
    > `Teams are set · reroll 1 of 2` for split 2, `Teams are set · reroll 2 of 2` for split 3, plain
    > `Teams are set` for split 1 including when an admin promotes it back. Description is the promoted
    > split's stored explanation, verbatim, never recomposed (M3.7). Same ten, same sitters, same seat lines —
    > `postTeamsForSplit` rebuilds them from the pool with the same pure functions M2.5 used, so a reroll never
    > quietly changes who is playing. It is a new message, never an edit or a delete of the old one: two
    > messages are the honest record of what happened, the newest is the one that counts, and the title says
    > how far down the list the group has gone. Full copy is in `docs/05-design.md`, "Teams embed".
    >
    > **The third press.** There is no third press. Core returns three splits, so there are two rerolls. After
    > split 3 is promoted the button is `disabled` and the strip beside it reads the copy that is already in
    > `05-design.md`: `No more splits. Change who is in the lobby to rebalance, or play these.` A stale tab
    > that posts anyway gets 409 and the same sentence in the response, and nothing is posted to Discord.
    >
    > **Edge cases.**
    >
    > - **Fewer than ten, more than ten.** Reroll never re-picks the ten. It promotes another arrangement of
    >   the ten already chosen; who sits does not change, and the `Sitting out` and `Seats` fields say what
    >   they said before because they are rebuilt from the same pool.
    > - **Someone leaves mid-lobby.** Ingest puts the lobby back to `open` and the next balance inserts three
    >   fresh splits and posts a new teams embed. A reroll aimed at a split whose ten are no longer all in the
    >   lobby is refused with 409 before anything is promoted — check first, do not promote and then discover
    >   it in `postTeamsForSplit` (which answers `skipped`, having already lost the old chosen row).
    > - **Companion disconnects.** Nothing here needs it. The splits are stored and the webhook is the
    >   server's.
    > - **Unknown player.** Rendered `Someone` by `renderName` (M3.10) like everywhere else. No other
    >   difference.
    > - **Webhook missing or refusing.** Promotion stands, one log line, response says the post did not go
    >   out, no retry loop.
    > - **Signed in but not an admin.** 403, and the button is never rendered for them.
    >
    > **Acceptance check (product).**
    >
    > 1. A `balanced` lobby with three stored splits, rank 1 chosen. POST the rank 2 split: 200, `splits` has
    >    exactly one chosen row and it is rank 2, and one new Discord message arrives titled
    >    `Teams are set · reroll 1 of 2` whose description is rank 2's stored explanation string character for
    >    character.
    > 2. POST the same split id again: 200, no second message, still one chosen row.
    > 3. POST the rank 3 split: title `Teams are set · reroll 2 of 2`. POST rank 1 after that: it is promoted
    >    again and the title is the plain `Teams are set`.
    > 4. Lobby `in_game` or `finished`: 409, nothing promoted, nothing posted.
    > 5. A split id from another lobby: 404. No admin session: 403. Malformed body: 400.
    > 6. With M3.4 landed: the tonight page's cards and explanation line become the promoted split's within a
    >    few seconds, with no reload and no scroll jump, and after rank 3 the button is disabled with the
    >    `No more splits.` sentence beside it.
    >
    > **Out of scope.** A random reroll, a fourth split, changing who plays or who sits, editing or deleting
    > the earlier message, a Discord button or slash command, reroll for non-admins, reroll during a game, and
    > the tonight page's layout (M3.4).

- [x] **M3.3** On `finished`: result embed with winner, duration, top damage, rating deltas per player.

    > **Brief (product, 2026-09-08) — the two number rules**
    >
    > **Delta rule.** A displayed rating change is `displayRating(muAfter) - displayRating(muBefore)`: both
    > numbers are rounded first, then subtracted. Never `round((muAfter - muBefore) * 60)`. The row on the
    > screen has to add up — `1469 (+43)` next to a new rating of `1512` — and it only does under this rule.
    > The delta is computed at the display boundary from the two stored ratings, by one shared helper that the
    > result embed, the tonight page and the player page all call, so the Discord message and the web page can
    > never print different numbers for the same game. `packages/core` keeps `displayRating`; it does not gain
    > a delta concept. Recorded in `04-decisions.md`.
    >
    > **Never print a team total of deltas.** The two sides do not sum to zero (movement scales with each
    > player's own sigma), and a visible imbalance is a free argument about a thing that is working correctly.
    > `00-product.md`, "The numbers on the screen", is the sentence to quote when someone asks in voice.
    >
    > **Fixture warning (from the designer, M3.0).** The per-player deltas in the result-embed example in
    > `docs/05-design.md` were computed by hand from the two-team Plackett-Luce reduction, not by `rateGame`.
    > They are illustrative only. **Replace them with real `rateGame` output before any of them is pinned in a
    > test or a fixture**, and update the example in the design doc in the same session if the real numbers
    > differ. Duration and top damage in that example are invented; the docs pin no result for the worked
    > example.

- [x] **M3.4** `/` Tonight page: live via Supabase Realtime; phone-friendly; the link is what gets pasted in WhatsApp. Shows lobby members as they join, then teams, then result.

    > **Brief (product, 2026-09-09)**
    >
    > **The scene.** Somebody pastes the link in WhatsApp at 21:40. A friend on a phone, in a dark room,
    > taps it. Before they have finished reading the first line they know whether the night is happening,
    > whether they are in it, and which side they are on. Then they put the phone down, and when the teams
    > change the page changes by itself. There is no refresh button, no login wall, and nothing to type.
    >
    > **Which lobby the page is about.** The newest `lobbies` row of tonight that is not `abandoned`, where
    > tonight is `nightStart(now, CUSTOMS_NIGHT_TZ)` — the same 06:00-to-06:00 night the sit-out rotation
    > counts over (`lib/night.ts`), so at 01:30 the page still shows the game that started at 23:00. If the
    > newest row of the night is `abandoned`, fall through to the next newest that is not; if there is none,
    > the page is idle. One row is one game cycle, not one party (M2.14, migration 0003).
    >
    > **The states.** `docs/05-design.md`, "The tonight page's three states — one rule", is the layout and
    > this brief does not get to invent a fourth. In product terms:
    >
    > - **Idle** (no lobby tonight, or the newest is `abandoned`). Header strip `Nothing tonight`. Body: the
    >   M1.10 sentence, unchanged word for word, `When ten of you are in a custom lobby with the companion
    >   running, the teams show up here.` and under it a link reading `Last night and the board`. The
    >   placeholder page's own first fragment, `Nothing tonight yet.`, moves into the header strip and loses
    >   the "yet" — the strip is a label, not a sentence, and the body must not say it twice.
    > - **Filling** (`open`). Header `<n> in the lobby` with the live dot. The member list in join order,
    >   oldest first, ten rows of height reserved from the first paint. Each row: name, main role and backup,
    >   display rating. People past the ten (`is_spectator`) under the `Around` hairline. No teams, no
    >   prediction, no countdown — nothing that guesses at what the balancer will do.
    > - **Teams** (`balanced` and `in_game`, the identical block; only the header word and the dot differ).
    >   Sit-out strip, then the two cards blue-first, then the explanation line verbatim from the promoted
    >   split (`splits.is_chosen`), then the reroll control for an admin (M3.2). A lobby that goes
    >   `balanced` → `in_game` must not re-render, re-fetch or fade the teams.
    > - **Result** (`finished`). The result card: headline, duration, the honest prediction line, the two
    >   teams with after-ratings and delta chips, top damage. The explanation line of the split they played
    >   stays below it.
    >
    > **Every number, and where it comes from.** The page prints no number it computed a second way.
    >
    > - Filling and teams: display rating is `displayRating(mu)` of the player's `ratings` row for the active
    >   season, seeded from rank in memory when there is no row — the same rule `loadPool` uses, which is what
    >   the Discord embed printed. A page and an embed that disagree by one point is a ten-minute argument.
    > - Result: the new rating is `displayRating(mu_after)` and the delta is
    >   `displayRating(mu_after) - displayRating(mu_before)` from `game_players`, **computed where it is
    >   rendered**. A delta is never carried through JSON: `-0` does not survive `JSON.stringify` and a row
    >   that went down would print `(+0)` (`05-design.md`, "Rating delta").
    > - **A player's rating appears once per screen.** The result card already contains both team cards with
    >   the after numbers; do not render a second pair of cards with the before numbers underneath. Two
    >   numbers for one player on one screen is a bug report waiting in voice. (The state table in
    >   `05-design.md` reads as though the finished state has both; the "Result card" component is the one to
    >   follow. Raised with the designer.)
    >
    > **The strip above the cards.** Sit-out copy is fixed in `05-design.md` and comes in two versions, the
    > general one and the second-person one for a viewer who is signed in, linked and sitting. Nobody else's
    > strip changes. When ten are around and nobody sits there is no strip at all.
    >
    > **`Someone`, and names that arrive late.** A player the database has no name for renders `Someone`
    > (M3.10) and the team block carries one quiet line under it, once and never per row: `Names fill in after
    > someone's first game.` M3.10 promises the name replaces itself live, and that does not come for free:
    > `players` is service-role only and neither it nor `players_public` is in the `supabase_realtime`
    > publication, so no name change will ever arrive as an event. While any row on screen reads `Someone`,
    > re-read the name map every 60 seconds and on tab focus, and stop as soon as none are left. A name
    > arriving must swap in place and move nothing.
    >
    > **No `settling` chip on this page.** The still-settling story is the leaderboard's (M3.8), exactly as it
    > is kept out of the teams embed (M3.1). Ten chips beside ten names on the one screen people read in a
    > hurry is noise, and this page never sorts anybody.
    >
    > **Live.** Supabase Realtime `postgres_changes` on `lobbies`, `lobby_members`, `splits`, `games` and
    > `game_players` — all published in migration 0001 and all publicly readable. Names come from
    > `players_public` (the base table has `discord_id` and no public policy). First paint is server-rendered
    > with real content so the WhatsApp link never opens on a spinner; the subscription attaches after
    > hydration and re-reads what it needs. If the socket drops, reconnect quietly and re-read once — no
    > banner, no toast, no "reconnecting…" text. The page is public: no sign-in to read, ever.
    >
    > **The night's second lobby.** After a game finishes the same friends usually stay put and the companion
    > opens the next cycle: a new `lobbies` row, same party id. The page follows the newest row, so the result
    > of game 1 is replaced by the member list of game 2 as it fills. That is the right answer to "where are
    > we now" and it means the tonight page is not where a finished game lives — Discord has the result embed
    > and the leaderboard has what it did to everybody. No "last game" block ships in M3.4; if the first real
    > night asks for one it is a task and a decision row, not a drive-by.
    >
    > **Edge cases.**
    >
    > - **Fewer than ten.** Filling, forever if need be. No teams, no message, no "waiting for 3 more" that
    >   implies the group owes the page anything.
    > - **More than ten.** Filling shows everyone, with the people in the spectator slot under `Around`. Who
    >   sits is not known until the balance, so the page must not guess at it before `balanced`.
    > - **Someone leaves mid-lobby.** The count drops and the row disappears with the standard fade; the list
    >   does not reorder and the page does not scroll. If it drops below ten after teams were posted, ingest
    >   returns the lobby to `open` and **the page goes backwards** — teams gone, member list back. That is
    >   correct and it needs no explanation on the page: the header strip changed, which is the whole point of
    >   it being always mounted.
    > - **Companion disconnects.** Nothing changes and nothing is announced. The row simply stops updating; a
    >   lobby nobody has posted about for two hours becomes `abandoned` by the sweep and the page goes idle by
    >   itself. Until then a dissolved lobby keeps saying `7 in the lobby`, which is accepted: the sweep is the
    >   fix and it already exists.
    > - **Unknown player.** `Someone`, plus the one hint line. Everything else about the row is correct.
    > - **A game whose lobby is `finished` but which the fold did not rate** (remake, short surrender). The
    >   result card needs `game_players` ratings to exist; with none, show the teams block and the explanation
    >   line with the header `Final` and no deltas. No "this game did not count" banner — Discord stays silent
    >   about these too (M3.3) and the page has nothing more to say.
    > - **Two tabs, two phones.** No shared state, no presence, nothing that counts viewers.
    >
    > **Acceptance check (product).**
    >
    > 1. Open `/` with no lobby tonight: header `Nothing tonight`, the M1.10 sentence verbatim, the
    >    leaderboard link, nothing else. No spinner, no skeleton, no illustration.
    > 2. Drive a lobby from 1 to 10 members with the page open on a phone: every join appears **within 5
    >    seconds** with no reload, the newest row is appended at the bottom, and nothing above it moves. The
    >    9→10 join in particular shifts no pixel of the page.
    > 3. Balance the lobby: the page replaces the member list with the sit-out strip, the two cards and the
    >    explanation line within 5 seconds of the Discord message, the explanation matching the embed's
    >    description character for character, and the ten ratings matching the embed's ten.
    > 4. `balanced` → `in_game`: only the header word and the live dot change. The cards do not fade,
    >    re-order or re-fetch.
    > 5. Finish the game: the result card replaces the teams block within 5 seconds. Every row's
    >    rating and delta equal the result embed's for the same player, including a `(-0)` if one occurs.
    > 6. Reroll (M3.2) while the page is open: cards and explanation become the promoted split's, in place,
    >    with no scroll movement.
    > 7. Eleven around: the sit-out strip is above the cards and reads the `05-design.md` copy verbatim; a
    >    signed-in sitter sees the second-person version and nobody else's changes.
    > 8. A member with null `display_name` and null `game_name`: the row reads `Someone` and one hint line
    >    appears under the team block, once. Set the name in the database with the page still open: it appears
    >    within a minute and nothing else moves.
    > 9. Lighthouse or the browser's own layout-shift number on a mid-range phone: CLS stays effectively zero
    >    across the whole night's transitions, and the first paint carries content, not a loading state.
    > 10. With the anon key only (no session), every state above renders. Nothing on the page requires a
    >    login, and `players.discord_id` is never on the wire.
    >
    > **Follow-ups from the design round (product, 2026-09-09), kept here so they do not live only in a review.**
    >
    > - **M3.17: the tonight page uses its own no-season sentence**, a second constant beside
    >   `NO_ACTIVE_SEASON_MESSAGE` in `lib/season.ts`, placed at the top of `main` under the header strip:
    >   `No season is active, so tonight's games are not being saved. An admin can start one.` The admin
    >   sentence ends "Start a season on the Seasons page.", which is a page nineteen of the twenty people
    >   holding the WhatsApp link cannot open. Copy and placement are in `05-design.md` beside the idle copy;
    >   decision row 2026-09-09. It rides with M3.4 or immediately after it, and it is M3.17's acceptance
    >   check, not this task's.
    > - **Three things to eyeball on the first real night**, written into `06-test-night.md` Session 2
    >   because no laptop can answer them: the reserved ten-row slab with only seven in the lobby, on an OLED
    >   phone in a dark room; whether the sit-out strip pushes the Blue card's last rows below the fold on a
    >   390 x 844 phone; and where the 25-character name ellipsis lands on a long Riot ID. They are
    >   observations to report back, not acceptance checks for M3.4 — each becomes a task with its own ID
    >   only if the night says so.
    >
    > **Out of scope.** The leaderboard and player pages (M3.5), the role tap (M3.6, which lands its own
    > control on this page), the still-settling chip (M3.8), voice (M4), any history of past games, filters,
    > search, a theme toggle, notifications, and any surface that asks the reader for input.

- [x] **M3.5** `/leaderboard` and `/p/[puuid]` with rating history. Nightly leaderboard post to the webhook at a configured time.

    > **Brief (product, 2026-09-08) — the board shows two numbers**
    >
    > **Why.** The board sorts on `ordinal = mu - 2 * sigma`, but the number everyone recognises from the
    > teams and result embeds is `round(mu * 60)`. Print only the second and the page shows a list that is
    > visibly out of order; print only the first and nobody recognises their own number. So every row shows
    > both, and each has one name used everywhere in the product.
    >
    > - **Proven** — `round(ordinal * 60)`. Primary, right-aligned on line 1, and **the sort key**. Rows are
    >   ordered by Proven, descending, always.
    > - **Rating** — `round(mu * 60)`. Secondary, dim, on line 2. The same number the embeds print beside a
    >   name, and the number the balancer works from.
    >
    > **The rule: the sort order and the primary number are the same number, on every surface, with no
    > exception.** Where only one number fits — the nightly Discord embed — it is Proven, because a list
    > ordered by a number it does not show is exactly the complaint this rule exists to prevent.
    >
    > The names `Proven` and `Rating` are fixed. Capitalised as column labels, lower case inside a sentence.
    > No surface invents a third name for either: not `/p/[puuid]`, not the embed, not the admin.
    > `docs/05-design.md` carries the layout and `docs/00-product.md`, "The numbers on the screen", carries
    > the explanation a friend gets read to them in voice.
    >
    > **Edge cases.**
    >
    > - **Fewer than 30 games.** The `settling` chip and the one-per-page sentence, both M3.8. Proven still
    >   sorts them; nothing is hidden and no separate section exists.
    > - **Zero games this season.** A seeded player with no games has a Rating and a Proven and appears on the
    >   board, at the bottom, with `0 games` and the chip. Do not filter them out — a friend who was seeded
    >   last night and cannot find themselves will ask why.
    > - **Two players with the same Proven.** Break the tie on Rating, then on name, so the order is stable
    >   between renders.
    > - **Season with no games yet.** The board renders its heading, the sentence, and one line saying the
    >   season has no games yet. Not an empty page, not a spinner.
    >
    > **Acceptance check (product).**
    >
    > 1. `/leaderboard` rows are in descending `round(ordinal * 60)` order and the primary number on every row
    >    equals that value. Reading the primary column top to bottom never goes up.
    > 2. Line 2 of every row shows `round(mu * 60)` as Rating, and for a player who just played, that number
    >    equals what the result embed printed beside their name for the same game.
    > 3. A player with fewer than 30 recorded games shows the chip, and the still-settling sentence appears
    >    once on the page, not once per row.
    > 4. The nightly embed lists players in the same order as `/leaderboard` and prints the Proven number
    >    after each name, with the short still-settling sentence as the footer.
    > 5. `/p/[puuid]` shows both numbers under the same two labels.
    >
    > **Out of scope.** Changing the sort or the rating model, carrying ratings between seasons (M5.3), role
    > and duo stats (M5.4), any filter or search on the board, and pagination beyond what the group's size
    > needs.

- [x] **M3.6** (landed 2026-09-10: `Your role tonight` card and `That's me` self-link on the tonight page, `/api/me/*` route class, night preference on `players.role_tonight` expiring at 06:00 local, migration 0009 on kustom; the admin per-row tap moved to `/admin/players` with M3.25) Role override for tonight: a player taps their role on the tonight page (Discord login) or an admin sets it. Held for the rest of the night's lobby cycles and gone by the next night — the original "cleared when the lobby finishes" would mean re-tapping between every game (plan changed 2026-09-09; see the brief and `04-decisions.md`, and a new migration updates the comment on `lobby_members.role_override`). **Copy source of truth (2026-09-10):** the strings in this brief are superseded by the `05-design.md` table "Copy — the role tap and picking yourself (M3.6, product 2026-09-10)"; read from there, not from here.

    > **Brief (product, 2026-09-09)**
    >
    > **The scene.** Somebody says in voice "I'll jungle tonight". They open the page they already have open,
    > tap `jungle` under their own name, and put the phone down. The next time the bot builds teams it treats
    > jungle as their main and their usual main as the backup. Nobody typed a command, nobody asked an admin,
    > and the friend who never taps anything is unaffected — this is an option, not a step in the loop.
    >
    > **What a tap means.** `lobby_members.role_override`, which core turns into the player's main with their
    > declared main demoted to backup (`resolveRoles`). It is a **preference, not a lock**: the balancer can
    > still put them somewhere else, and when it does the explanation line names them and the role, exactly as
    > it does for anybody else off-role. The page must not promise more than that.
    >
    > **Who can set it.** The player themselves, or an admin on anybody. A player is identified the only way
    > this project identifies one: Supabase session → `players.discord_id` → the player row → their
    > `lobby_members` row in tonight's lobby. This is a **third route class** — a session with a linked
    > player and no `is_admin` — and it is the first one; `04-decisions.md` records it. The route takes the
    > lobby and the role (`null` clears), and a `puuid` naming somebody else is honoured **only** for an
    > admin. A non-admin body that names another player is a 403, never a silent write to their own row.
    >
    > **Picking yourself, once (lead, 2026-09-09).** `players.discord_id` is set nowhere but `/admin/players`
    > today, so without this every friend's first tap is blocked on somebody else doing a chore. Instead: a
    > visitor who is signed in with Discord and matches no player row is shown tonight's lobby members —
    > the same rows the page is already rendering — each with a `That's me` control, and picks themselves
    > once. That writes their Discord id onto that player's row and nothing else; from then on they are a
    > linked player everywhere in the product. Rules: only rows of tonight's lobby are offered (a friend
    > cannot claim somebody who is not in the room with them), a player row that already carries a
    > `discord_id` is not offered and a post naming one is refused (409, `Someone is already linked to that
    > player.`), and an admin can undo any link on `/admin/players`, which is the existing repair path. Copy
    > above the list: `Which one of these is you? Pick yourself once and the page knows you from now on.`
    > **Acceptance:** a signed-in visitor with no link sees the list, taps their name, and their next role tap
    > lands on their own `lobby_members` row with no admin involved; the same visitor signing in again is
    > never asked twice; tapping a name that is already linked to someone else changes nothing and answers
    > 409; an admin clearing the link on `/admin/players` puts the visitor back to being asked once.
    >
    > **When it counts.** At the next balance of that lobby, and never retroactively.
    >
    > - Lobby `open`: nothing to say. The tap is stored and the balance that fires when ten are stable uses
    >   it.
    > - Lobby `balanced` or `in_game`: the tap is **stored and the teams do not move.** No rebalance, no
    >   repost, no swap. Two reasons, both worth saying out loud in voice: a rebalance on a role tap turns
    >   the role control into an unlimited reroll that any one of ten people can pull, and by then people have
    >   already moved to their side in the client. The control says so rather than pretending:
    >   `Saved for the next game. Teams are already set.` The two doors that do change teams tonight are
    >   Reroll (M3.2) and changing who is in the lobby, which rebalances by itself.
    > - Lobby `finished` or `abandoned`, or no lobby at all: the control is not shown. There is nothing to
    >   attach a choice to and a preference with no lobby is M5's problem, not this one.
    >
    > **How long it lasts — plan changed, 2026-09-09.** The task line and the column comment said "cleared
    > when the lobby finishes". Since M2.14 (migration 0003) a `lobbies` row is one *game cycle*, so that rule
    > means the choice dies after one game and every friend re-taps between games. That is a step added to the
    > nightly loop, four or five times a night, which is exactly what this product does not do. **The choice
    > lasts the night:** when lobby ingest opens a new cycle row for a party, it copies `role_override` from
    > that player's row in the party's previous cycle, provided that row was created after `nightStart` for
    > the current night. Nothing is cleared on `finished` — the closed row keeps what it had, as a record of
    > what the teams were built from — and the first lobby of the next night simply has nothing to copy from.
    > Ship a migration that updates the comment on `lobby_members.role_override` to say this; never edit 0001.
    >
    > **Copy (product, final; any change comes back here).**
    >
    > - Control heading, `t-xs` `dim` above the five role words: `Your role tonight`
    > - Under the control, once: `The bot tries for this one. If the teams need it, you can still end up
    >   somewhere else.`
    > - After teams are posted: `Saved for the next game. Teams are already set.`
    > - Signed out: `Sign in with Discord to pick your role.` on the control that starts the OAuth flow back
    >   to `/`.
    > - Signed in, Discord not linked to a player: `Which one of these is you? Pick yourself once and the page
    >   knows you from now on.` above the list of tonight's members, each with `That's me`. Only when no
    >   lobby is open tonight, and so nobody can be picked: `Signed in. Open the page while the lobby is up
    >   and you can pick yourself out of it.`
    >
    > No toast, no confirmation dialog, no "saved!" flash. The role word turning `accent` is the receipt
    > (`05-design.md`: realtime already changes the thing you are looking at).
    >
    > **The control itself.** Five role words in the design's mono lower case, each at least 44 × 44px,
    > on the viewer's own row and — for an admin — on every row. Tapping the role that is already chosen
    > clears the override and the player goes back to their profile's main and backup; that is the only way
    > out and there is no separate Clear button. The choice renders as selected on every device the moment it
    > lands, because the page is already subscribed to `lobby_members`.
    >
    > **Edge cases.**
    >
    > - **Not signed in.** The page reads exactly as it does today; only the control changes. Reading is never
    >   gated.
    > - **Signed in, no linked player.** The `That's me` list, above — this is the day-one case for everybody,
    >   and it resolves itself in one tap without an admin. With no lobby open there is nothing to pick from,
    >   so the page says so and asks nothing.
    > - **Signed in, linked, not in tonight's lobby.** No control. There is no row to write.
    > - **A sitter taps.** Allowed. They are in `lobby_members`, they may well be in the next game, and their
    >   choice counts at that balance.
    > - **Fewer than ten around.** Stored, waiting. **More than ten:** unchanged — the override never affects
    >   who plays, only where the balancer tries to put them.
    > - **Someone leaves mid-lobby and comes back.** Their `lobby_members` row is what the ingest diff decides
    >   (M2.9's freeze applies from `balanced` on); a row recreated within the same night's party gets the
    >   carry-forward like any other.
    > - **Companion disconnects.** No effect: overrides live on the server and the next balance reads them.
    > - **Unknown player.** A linked player with no display name renders `Someone` and can still tap their own
    >   row. Nothing about the override touches `players`.
    > - **Tapping while the tenth player joins.** The realtime update must not move the page under the thumb
    >   (`05-design.md`: state changes replace the primary block, they never scroll or re-order).
    >
    > **Acceptance check (product).**
    >
    > 1. Signed in as a linked player who is in an `open` lobby: tap `jungle` on your own row. The row shows
    >    it as chosen, `lobby_members.role_override` is `jungle`, and the balance that follows puts jungle
    >    first for that player (their old main is the backup) — verified against core's `resolveRoles`, not by
    >    eyeballing the teams.
    > 2. Tap `jungle` again: the override is `null` and the row shows the profile's roles again.
    > 3. Tap a role while the lobby is `balanced`: 200, the override is stored, **no new Discord message and
    >    no change to `splits`**, and the control shows `Teams are already set. A role you pick now is what the bot tries for in the next game.` (product's 2026-09-10 rewording; the copy table in `05-design.md` is the source)
    > 4. Finish that game and let the companion open the night's next cycle: the new `lobby_members` row for
    >    that player carries the same `role_override`, with no second tap, and the next balance uses it.
    > 5. The first lobby of the next night (past 06:00 local) carries no override for anybody.
    > 6. A non-admin posting a body that names another player's PUUID: 403, and neither row changes.
    > 7. An admin taps a role on somebody else's row: it lands on that player's row, with the same rules. **Struck from M3.6 on 2026-09-10 (lead):** the route honours an admin naming another PUUID, but a 44px rack row has no per-row control pattern; the admin control ships on `/admin/players` with M3.25.
    > 8. Signed out, and signed in without a link: the two sentences above, and no control that writes
    >    anything.
    >
    > **Out of scope.** Duo locks — `balanceLobby` still passes `duos: []` and there is no column, no control
    > and no product decision for them; they are their own task, not a rider on this one. Also out: changing a
    > player's profile `main_role`/`secondary_role` (that is `/admin/players`, M1.6), guaranteeing a role,
    > remembering a preference across nights, role preferences in Discord, and any rebalance triggered by
    > anything other than the lobby's membership changing.

- [x] **M3.7** Off-role clause end to end: the teams embed and the tonight page show the explanation line of whichever split is currently promoted, including after a reroll, with the off-role clause matching that split.

    > **Acceptance check (product).** Balance a lobby whose split 1 has `offRoleCount` 0 and whose split 2 has
    > someone off-role. The embed and the tonight page both read `Everyone on a main role.` Reroll to split 2:
    > both surfaces now read the split 2 sentence verbatim, naming the off-role player and their role
    > (`{Name} off-role at {role}.`, or `{n} off-role: ...` for two or more), and the roles rendered beside the
    > names match that split's assignment. Nothing recomputes the explanation — both surfaces render the stored
    > string for the promoted split from the `splits` table.

- [x] **M3.8** Leaderboard says why a new player is low: a "still settling" marker and one plain sentence on `/leaderboard` and `/p/[puuid]` for players with fewer than 30 recorded games.

    > **Brief (product, 2026-09-08)**
    >
    > **Why.** The leaderboard sorts on `ordinal = mu - 2 * sigma`. A newly seeded player's `mu` settles in
    > about ten nightly games, but their `sigma` does not fall below 5.00 until roughly game 36 (M1.3 brief,
    > test 3). So a friend who joins tonight sits near the bottom of the board for about a month after they
    > have stopped being mis-rated, and the first person it happens to will call the board broken in voice.
    > This is the model working as intended; the board just has to say so.
    >
    > **Acceptance check (product).** On `/leaderboard` and `/p/[puuid]`, a player with fewer than 30 recorded
    > games shows a "still settling" marker next to their row and one plain sentence explaining the board is
    > cautious until it has seen you play; the marker disappears at 30 games; the number in the sentence is
    > **30**, matching the threshold the marker itself uses. Thirty is the product's round number for the
    > M1.3 finding that a mis-seeded player's sigma first falls below 5.00 somewhere between game 26 and
    > game 36 depending on results — so the sentence says "about 30 games" and the marker switches off at
    > exactly 30. Copy is final and lives in `docs/05-design.md`, "Still-settling marker". **Both sentences
    > were amended by product on 2026-09-10 (M3.19)** — the 2026-09-08 pair said the gap closes at 30 games
    > and that a new player starts at the bottom, and neither is true; the shipped words are the two in
    > `05-design.md` and in `04-decisions.md`'s ruling row, not the ones this brief was written against.
    > Any change goes through product.
    >
    > **Out of scope.** Changing the sort, the rating model, or `ordinal`. No separate "new players" board, no
    > provisional/placement badge that hides a rating, no change to how teams are balanced — balancing is on
    > `mu` and is unaffected.
- [x] **M3.9** (**retired 2026-09-10 with the button it guarded** — **M5.14**; there is no way to start a season, so there is nothing to confirm) Make starting a season a deliberate act. `/admin/seasons` has a name field and a `Start` button that fires on one click. From M3.5 on, that click empties the leaderboard: `ratings` is keyed `(player_id, season_id)`, nothing is carried over until M5.3, and there is no undo — the old season's rows survive but every public page reads the active one. Require a typed confirmation (the name of the season being ended) before the post is accepted, and say in the response what just happened. The copy on the page already spells out the consequence (product, 2026-09-08); this is the guardrail behind it.

    > **Why (product).** Everything else in `/admin` is reversible in one more click. This is the only button
    > in the app that destroys a month of the group's history in the eyes of everyone who looks at the board,
    > and it sits two fields away from "set a role". A friend clicking around on a phone should not be able
    > to do it by accident.
    >
    > **Acceptance check.** Posting to `/api/admin/seasons` without the confirmation field, or with the wrong
    > value, answers 400 and no season changes. With the exact name of the currently active season it
    > succeeds as it does today. The page shows the field with the name to type spelled out next to it.
    > Nothing about `start_season` (migration 0002) or the one-active-season index changes.


- [x] **M3.10** Decide what a player with no name looks like. The League lobby carries no `gameName`/`tagLine` (M0.3), so a friend the database has never met appears with `display_name` null until the M2.4 sweep or their first end-of-game block fills it in — which can be minutes after teams are posted. Every surface that prints a name needs one agreed fallback: the teams embed, the result embed, the tonight page, the leaderboard, `/p/[puuid]`.

    > **Copy (product, confirmed with the designer 2026-09-08: `05-design.md` has no placeholder convention
    > for a nameless player, so this sets it).** The fallback is the word **`Someone`**, nothing else — no PUUID fragment, no
    > "Unknown Player", no "Player 7". A PUUID is 36 characters of noise that helps nobody read a team, and
    > "Unknown" reads like an error when the truth is just that the client has not told us yet. Ten friends
    > looking at the embed know who the tenth is; they are standing in the same voice channel. On the tonight
    > page, a row showing `Someone` gets a quiet one-line hint underneath the team block, once, not per row:
    > "Names fill in after someone's first game." That sentence is the whole explanation and it does not
    > need a link.
    >
    > **Behavior.** The fallback is never written to `players`: `display_name` and `game_name` stay null in
    > the database so the next sweep or eog block fills them in without a migration or a cleanup. It is
    > applied at render on every surface — and, from **M3.15** (2026-09-09), it is also the name the API
    > hands the balancer, so `Someone` is the word inside `splits.explanation`, the one string three surfaces
    > quote verbatim and none may recompose. "Never stored" means never stored in a `players` row, not never
    > written into a sentence we keep. Two players with no name both render `Someone`; that is acceptable and
    > rare, and it resolves itself within one game. A name that arrives while the page is open replaces it
    > live (the tonight page is already Realtime).
    >
    > **Acceptance check.** With one `players` row holding a null `game_name` and null `display_name`: the
    > teams embed, the result embed and the tonight page all print `Someone` for that player and everything
    > else about the row (rating, role, rating change) is correct and unaffected. The leaderboard and
    > `/p/[puuid]` print the same. Nothing anywhere prints a PUUID, a null, or an empty cell. Set the name
    > and every surface shows it with no other change.
    >
    > **Out of scope.** Fetching the name (M2.4). Discord display names (M4). Any change to `players`.

- [x] **M3.11** Result embed: the coin-flip clause becomes `Neither side was favored.` (Label note: commit `afa22e1` on the review branch is titled "M3.11, designer review" and means M3.13 plus M3.14; M3.11 in this doc is only this copy fix.) Product copy, 2026-09-09 (`05-design.md`, "The four number formats"): `Even 50%.` is core's present-tense fragment and under the headline `Red wins · 34:12` it reads as a claim about the game rather than the prediction — and on a first night, where every split is gap 0, it is the first result sentence the group ever sees. `favoredClause` in `apps/web/lib/discord/embeds.ts` is the only place it is composed. **Acceptance:** a rated game whose chosen split had `blue_win_prob` 0.5 posts the description `Neither side was favored. Top damage: …`; 54% and 58% cases are unchanged; the snapshot is updated in the same commit; core's explanation string is untouched.
- [x] **M3.12** Sit-out reason: a third clause for the first balance of a night. When everyone around is tied on games tonight **and** nobody around has a recorded sit-out, the comparator falls through to PUUID order — arbitrary — and today's clause, `— longest since they last sat out.`, states a fact about a history that does not exist. Copy (product, 2026-09-09, in `05-design.md`): `Sitting out: Player0 — nobody has sat out before, so somebody had to be first.` `SitOutReason` gains a third value; `assemble.ts` picks it when `tiedOnGames` and every pool member's `lastSitOutAt` is `null`. **Acceptance:** eleven around on a fresh database posts the new clause; run one game and balance again with eleven around and the clause is `— most games tonight.`; a pool tied on games where somebody has sat out before still reads `— longest since they last sat out.`; `discord.integration.test.ts`'s eleven-tied case is updated to the new string.
- [x] **M3.13** *(landed with the designer-review fixes on the branch in review, commit `afa22e1`; lead ticks at merge.)* Teams embed field order: `Sitting out` and `Seats` go **before** `Blue` and `Red`. Decided 2026-09-09 (designer, M3.1 review; row in `04-decisions.md`) and written into `05-design.md`, but `embeds.ts` still pushes them after. **Acceptance:** with eleven around, the posted embed's fields are in the order `Sitting out`, `Seats`, `Blue`, `Red`, `Lobby`, and the two side fields still pair as inline neighbours; with ten around the JSON is byte-identical to what ships today. **Acceptance superseded 2026-09-11 (designer ruling, M4.7 (b)):** `Seats` prints on every teams post because the side line is its last line, so a ten-person post is no longer byte-identical to the M3.13 snapshot; the test was updated in place.
- [x] **M3.14** *(landed with the designer-review fixes on the branch in review, commit `afa22e1`; lead ticks at merge.)* `renderName` escapes Discord markdown. Decided 2026-09-09 (designer, M3.1 review) and in `05-design.md`; the shipped function truncates but does not escape, so a Riot ID with a backtick closes the role's code span and swallows the rest of the field. **Acceptance:** a display name containing `` ` ``, `*`, `_`, `~` and `|` renders as those characters in Discord, the other four lines of the field are intact, escaping happens after the 32-character cut, and a backslash is never left without the character it escapes.
- [x] **M3.15** `Someone` inside the stored explanation. `apps/web/lib/ingest/balance.ts` still names a nameless player `Unknown` (`UNKNOWN_PLAYER_NAME`) when it builds the balancer input, and core writes that string into `splits.explanation` — which both the embed and the tonight page print verbatim. So one message can read `Someone` on the line and `Next best: swap Unknown and Hana` in the sentence above it, and M3.10's "one agreed fallback on every surface" is broken in the one string nothing may recompose. **Acceptance:** balance a lobby containing a player with null `display_name` and null `game_name`; the stored explanation says `Someone` wherever it names them, the embed and the tonight page agree, and nothing is written to `players`.
- [x] **M3.16** Designer: reconcile the `finished` row of the tonight-page state table with the "Result card" component in `05-design.md`. The table lists team cards and the explanation line as a secondary block *under* the result card, and the result card already contains both team cards with after-ratings and deltas — read together they put two different ratings for the same player on one screen. Product's rule for M3.4 is one rating per player per screen (the result card's). **Acceptance:** `05-design.md` says once, in one place, what the finished state renders, and M3.4's brief and the built page agree with it. **Landed 2026-09-09**, via the M3.4 design round and the designer's edit to `05-design.md` ("The finished state, said once"): the state table's `finished` row and the "Result card" component now say the same thing — the result card, then the explanation line of the split they played, no second pair of team cards with the before numbers, and no side sums in the result card's headers — and M3.4's brief and this doc agree with it. Decision row 2026-09-09. Nothing outstanding; ready for the lead to tick.

- [x] **M3.17** The tonight page's own no-season sentence. With no active season the page says `No season is active, so tonight's games are not being saved. An admin can start one.` — a second exported constant beside `NO_ACTIVE_SEASON_MESSAGE` in `apps/web/lib/season.ts` (M2.18), rendered at the top of `main` directly under the header strip, in every state, and absent whenever a season is active. Found in the M3.4 design round (designer, 2026-09-09): M2.18's sentence ends "Start a season on the Seasons page.", and the tonight page is the link pasted in WhatsApp, so it would send twenty friends to a page one of them can open. Copy, placement and the reasoning are in `05-design.md` beside the idle copy; decision row 2026-09-09. Owner: `web-engineer`, with M3.4 or straight after it. **Acceptance:** with no active season, `/` renders the tonight sentence and nowhere renders the string `Start a season on the Seasons page.`; `/admin`, the seasons page and `POST /api/companion/game` still render `NO_ACTIVE_SEASON_MESSAGE` word for word and `lib/season.test.ts` passes unchanged; with a season active `/` renders no season sentence in any of the four states; the sentence is one exported constant with a test pinning its wording, not an inline string, and the tonight page does not import the admin constant.

- [x] **M3.18** Floodlit: the app shell and the tonight page v2, exactly the designer's implementation list (items 1 to 10) in `05-design.md`, with the copy as finalised in "Copy — final (product 2026-09-09)". Owner: `web-engineer`, after M3.5 lands (the shell's `Leaderboard` tab and the rail's `Top of the board` are M3.5's route and M3.5's row component; building the shell first means writing the nav condition twice).

    > **Brief (product, 2026-09-09)**
    >
    > **The scene.** Ten friends in Discord voice. Someone opens a lobby, someone pastes the link in WhatsApp, a
    > phone comes out of a pocket in a dark room. Today that phone shows a black page with no title, one
    > unexplained number per row, the word `flexible` nine times and 449px of nothing. After this task it shows a
    > product: a wordmark, tonight's date and season, a lit count, ten seats filling up, and four lines that
    > explain the whole system to somebody who joined the group last week. **No new step enters the scene.**
    > Nothing here asks anybody to type, tap, sign in or confirm; every control that exists today exists
    > afterwards, in the same place, doing the same thing.
    >
    > **What is being built.** Items 1 to 10 of "Implementation list — ranked by what a first-time visitor
    > notices", built in the designer's build order (4 first, then 1, 2, 3, 5, 6, 7, 8, 9, 10): tokens and type,
    > the shell (top bar, nav, footer, `How this works`), the status strip, the seat rack, the card recipe, role
    > icons, the result card, the desktop grid and rail, safe areas, and the releases-page link. `05-design.md`
    > is the specification for every pixel; this brief only settles behaviour and words.
    >
    > **Copy.** Every string comes from the final copy table. Four of them differ from what the code says today
    > and are deliberate edits, not typos: the idle headline becomes `NOBODY IN YET`, the finished headline
    > becomes `GAME OVER`, the balanced and in-game sentences lose the clause that repeated the headline, and the
    > nav's fourth tab is `Companion ↗`, not `Get the app`. `tonightHeader` in `lib/tonight/state.ts` returns
    > those labels and its tests pin them, so the test updates land in the same commit. `IDLE_LINK_LABEL` is
    > deleted with the rest of the idle link. No other settled sentence moves: the sit-out copy, the explanation
    > verbatim rule, M3.17's no-season sentence, `No more splits. …`, the idle sentence, `Around`, `Nobody in the
    > lobby yet.` and the nameless hint are quoted, not rewritten.
    >
    > **Edge cases, and what the page does.**
    >
    > - **Fewer than ten.** The rack is ten rows at every count; the unfilled ones are `open` on `bg`. Six around
    >   is six names and four `open` seats, never four blank rows and never a shorter card.
    > - **Nobody yet.** Filling at 0: the strip sentence is `Nobody in the lobby yet.` and nothing is rendered
    >   under the rack — the fact is said once, not twice on one screen. Idle: headline `NOBODY IN YET`, the
    >   shipped idle sentence, an empty rack headed `SEATS · 0 of 10`, then the `How this works` and
    >   `Run the companion` cards inline at every width.
    > - **More than ten.** The eleventh and later names sit under the rack beneath the `Around` divider, in the
    >   same row shape, with nothing reserved for them; the strip sentence is `Ten play, the rest sit out this
    >   game.`; at `balanced` the sit-out strip appears above the team cards with its shipped sentence.
    > - **Someone leaves mid-lobby.** A name becoming `open` again must move nothing: same ten rows, same order
    >   rule, and the count in the headline and the rack header change together. A leave that drops 10 → 9 while
    >   the lobby is still `open` returns the page to the filling sentence; a leave after teams are posted does
    >   not touch the team cards, because the split is stored.
    > - **Companion disconnects.** The page has no idea and must not pretend to: there is no "offline" state, no
    >   toast, no greying. The live pill keeps its meaning — the lobby is open, not the socket is up — and the
    >   last snapshot stays on screen until something changes it. Nothing added by this task polls, retries or
    >   renders an error.
    > - **Unknown player.** `Someone` (M3.10) in the rack, in both team cards, in the result card, and inside the
    >   stored explanation (M3.15); the nameless hint sits under the block, once, while any row reads it. The
    >   name-polling condition in `TonightLive` is untouched.
    > - **No season.** M3.17's sentence stays directly under the strip in every state, and the slug line is the
    >   date alone.
    > - **Unrated finish.** `GAME OVER`, the teams they played, the explanation, no deltas, no result card, and
    >   the sentence slot empty at its reserved height. No apology line (M3.4).
    > - **Light mode, reduced motion, no JavaScript.** The light palette is the same nine tokens;
    >   `prefers-reduced-motion: reduce` kills the pulse and every transition; with JavaScript off the page still renders
    >   server-side and the reroll form still posts (row 2026-09-09 in `04-decisions.md`).
    >
    > **Acceptance.**
    >
    > 1. The shell says **KUSTOM** and nothing under `apps/web` says `Customs Night` (M3.21, which lands inside
    >    this task).
    > 2. All ten items of the designer's list are in, each identifiable in the diff: `tokens.css` is the v2 file
    >    verbatim, `app/_shell/` has `TopBar`, `Footer`, `HowThisWorks` and `lib/nav.ts`, `app/_tonight/SeatRack.tsx`
    >    exists, `app/_icons/RoleIcon.tsx` has five paths, the shell's grid has the three widths and the rail.
    > 3. Every string on the page matches the final copy table character for character, including the four
    >    changed headlines and sentences, and a test pins the strip's label for each of the five states.
    > 4. `rowHeight.test.ts` asserts ten `<li>` in the rack at counts 0, 6, 9, 10 and 12, and keeps its 44px
    >    arithmetic.
    > 5. The role column is absent and the one hint line present when no member on screen has a role; present on
    >    every row, with `flexible` on the ones without, as soon as one member has one. The word `flexible` never
    >    appears nine times in a column.
    > 6. `grep -r "cn-accent" apps/web` returns nothing outside `admin.css`, and `admin.css` is byte-identical to
    >    its state before this task.
    > 7. The nav renders only routes that exist; with M3.5 merged that is three tabs (`Tonight`, `Leaderboard`, `Companion ↗`; `Stats` appears with M5.4), and no tab 404s. The
    >    footer's `Get the companion` and the nav's `Companion ↗` both point at
    >    `https://github.com/suyaser/kustom-releases/releases/latest`; the string `latest/download/Kustom.exe`
    >    appears nowhere under `apps/web/app` outside `/admin`.
    > 8. `Your games` renders only for a signed-in viewer with a player row, and points at `/p/<their puuid>`.
    >    The `Set roles` link inside the all-flexible hint is not rendered until M3.6 ships the control.
    > 9. One primary block per state, no layout shift inside a state: a join, a leave, a name arriving and a
    >    reroll each move nothing above the fold on a 390px viewport.
    > 10. Exactly one gradient and one glow exist in `apps/web`: the shell radial and the live pill. `grep` for
    >    `gradient(` and `box-shadow` in the web CSS returns those two plus `--cn-lit` and nothing else.
    > 11. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; `TonightView.test.tsx` is
    >     updated in the same commit as the heading change, not after it.
    > 12. **Screenshots at 390px and 1280px of all five states** (idle, filling at 6, filling at 11, balanced,
    >     result) are reviewed by the `designer` against `05-design.md` and **shown to the user before the lead
    >     ticks this task.** A tick without those two rounds is not a tick.
    >
    > **Out of scope.** Any change to `lib/tonight/load.ts` beyond the two new fields (`seasonName`,
    > `nightLabel`); `tonightState`'s state machine; `TonightLive` and the Realtime path; `RerollControl`'s
    > behaviour, refusal sentences or no-JS fallback; the delta, rating, duration, damage and name helpers; the
    > Discord embeds (Discord has no CSS and nothing in Floodlit reaches it); `/admin` and `admin.css`; the
    > leaderboard and player page, which are **M3.19**; the role tap (M3.6); any new route, table, column or API
    > field; and any new feature at all — this task adds no step to the nightly loop.

- [x] **M3.19** Floodlit follow-up on `/leaderboard` and `/p/[puuid]`, once M3.5 has landed against v1. The six changes in `05-design.md`, "What changes on the leaderboard and the player page (M3.5)": mount the shell, adopt the nine tokens (`accent` → `brand`, rows inside a card with a `raise` header carrying the `Proven · Rating` legend), the type changes, role icons wherever a role is named, the board row extracted as `app/_leaderboard/BoardRow.tsx` with `loadTopPlayers(client, { limit })` so the tonight page's rail can reuse it, and the sparkline kept hand-drawn. Owner: `web-engineer`, straight after M3.18. **No content decision moves**: `Proven` stays the primary number and the sort key, `Rating` stays on line 2, the two names stay fixed, the legend stays a legend and not a sticky header row, the `settling` chip stays a chip, and the history chart still plots `Rating` only, with the seed line in the same units. **Acceptance:** both pages render inside the shell with the correct tab underlined; no `--cn-accent` reference survives; the board row is one component used by both `/leaderboard` and the tonight page's rail, and the rail's `Top of the board` shows the same five rows as the top of the board; every number, label and sort order is byte-identical to M3.5's shipped output, except `SETTLING_SENTENCE` and `SETTLING_SENTENCE_SHORT`, which product rewrote on 2026-09-10 (the gap settles, it never closes); screenshots at 390px and 1280px reviewed by the `designer`. **Also carried from the designer's M3.5 review (2026-09-09), each with the file it found it in:** the board legend is the single word `Proven` right-aligned over the primary number, not `Proven · Rating` (`lib/board/copy.ts`, `board.css`); on `/p/[puuid]` the name outranks the section headings and the two numbers outrank both, with `By role` and `Recent games` as mono `t-xs` micro-labels in a `raise` card header; the four teammates in each recent-game lineup link to their own pages, the viewed player's row plain (`PlayerView.tsx`); `Recent games` carries a right-aligned `rating` legend and the bare number gets `cn-sr` text; when the seed widens the chart's range that side is padded by 0.15 of the span so the seed line sits inside the plot (`lib/board/chart.ts`); a `Someone` link on the board gets a `cn-sr` rank disambiguator; `.cn-row-name` buys its 44px with `padding-block`, not `line-height: 44px`; the one-game chart label says `Rating over 1 game, …`; and the settling sentence was false on a season's first board (every row is a seed), and **product ruled on 2026-09-10**: the finding stands, the designer's proposed replacement does not go in verbatim (its em-dash, and `catches up` repeats the defect — Proven never reaches Rating). Both constants in `lib/board/copy.ts` are rewritten to the words in `05-design.md`'s copy table and "Still-settling marker", `SETTLING_SENTENCE` and `SETTLING_SENTENCE_SHORT`, with `30` still interpolated from `SETTLING_GAMES`; `04-decisions.md` carries the ruling. The full findings are in the session's designer report; the doc additions are already in `05-design.md`. **From the designer's Floodlit re-check (2026-09-10), also this task:** the `· off-role` legend in the header bar of any team card with an off-role seat (`05-design.md` "Teams" already specifies it; `TonightView.tsx` renders name + sum only), and a rule for a card with three or more marked seats so amber stops outweighing the side colour (the designer writes both specs into `05-design.md` first).

- [x] **M3.20** Interactions without full-page reloads. The user, 2026-09-09: *"experience sucks, page refreshes on any button I press."* Cause: `/admin`'s forms post and 303-redirect back with `?notice=`/`?error=` (decision rows 2026-09-08), and the tonight page's no-JS path does the same. Every action on `/admin` — main and secondary role, display name, Discord link and unlink, admin flag, mint token, revoke token, Discord config, season start, backfill approval — and on the tonight page — reroll, and later M3.6's role tap and self-link — submits **in place** via React form actions (`useActionState`/`useTransition`, or `fetch` to the existing route), shows its notice or error inline next to the control it belongs to, updates that row optimistically or re-fetches that row only, and never navigates. The existing route handlers stay the API and keep their tests unchanged; the plain form post stays as the degraded no-JS path. Owner: `web-engineer`, with or right after M3.18. **Acceptance:** pressing any button on `/admin` or the tonight page changes no URL and triggers no document load — asserted by a component test on the action and checked in a browser where the page's `load` event count stays 1 across a full round of controls; a refused write renders its sentence inline beside the control, not as a banner at the top of the page and not in the query string; keyboard focus stays on the control that was pressed; with JavaScript disabled every form still posts and still works through the 303 path; `pnpm -r test` passes with the route tests untouched. **Note:** the tonight page's reroll already posts with `fetch` and never navigates (decision row 2026-09-09), so it is a check here, not a rewrite — the work is `/admin`.

- [x] **M3.21** The Kustom name on the web. Wordmark `▍KUSTOM` in the shell, the tonight page's `<title>` and every other `<title>` under `apps/web` outside `/admin`, the teams and result embed footers (`Kustom · more on the tonight page`, and `Kustom` alone when there is no tonight-page URL), and the nightly leaderboard embed's footer. Owner: `web-engineer`, **lands inside M3.18** — the shell is where the wordmark is born, so this is not a separate commit, it is the name the shell is built with. The embed footers are the one part that is not Floodlit: they are two strings in `apps/web/lib/discord/embeds.ts` and their snapshots. `Customs Night` stays in `CLAUDE.md`, the docs and the package names. **Acceptance:** `grep -r "Customs Night" apps/web` returns nothing; the teams embed footer reads `Kustom · more on the tonight page` (and `Kustom` with no URL); the result embed keeps `Season 1 · game 12` and the nightly embed keeps the settling sentence, since both footers carry information and M3.18's copy section calls them settled (lead, 2026-09-10, after the M3.18 review); the browser tab and the WhatsApp link preview say Kustom.
- [x] **M3.22** The nightly embed's field name follows the count. Product, 2026-09-09: with eight players seeded, the nightly post reads `Top ten` over eight lines. The field is named `Top ten` only when ten lines print, otherwise `The board`. One string in `apps/web/lib/discord/embeds.ts` (`leaderboardEmbed`) and its snapshot; update the nightly-embed section of `docs/05-design.md` through `product`. Owner: `web-engineer`, rides with M3.19. **Acceptance:** an embed test with eight entries asserts `The board`, the ten-entry snapshot still reads `Top ten`.
- [x] **M3.23** Recent games and unrated games. Product, 2026-09-09: `loadPlayerBoard` filters `mu_after !== null` before taking the last five, so a game that landed unrated (every backfilled game until `rebuild-ratings` runs) is missing from a player's recent list with nothing saying why, while it is in the database and on `/admin/games`. Product ruled 2026-09-10: list them, counting toward the five, with `not rated` in the rating column (refused games and not-yet-rebuilt backfills read the same), one hint sentence under the list when any row is unrated; the chart, By role and the record stay rated-only. Note the fold gate refuses on participant count, side split, duration and duplicate player only; `winning_side` is `not null`, so "no winner" is not a refusal. Lands inside M3.19. Owner: `web-engineer`, rides with M3.19. **Acceptance:** a `lib/board` test with one unrated game among six asserts the documented behavior; the doc names it.
- [x] **M3.25** (landed 2026-09-10: pages of 50 with `.range()`, search by name or PUUID prefix, safe-integer pages, the mint dropdown says when it is truncated) `/admin/players` paging. Found 2026-09-10 on the local stack: one form per editable field per player means ~4800 client components for 1000 rows and a page 85,000px tall, and the players query has no `range`, so past PostgREST's 1000-row cap rows silently drop (which is what failed `admin.integration.test.ts` on the shared stack). Twenty friends is fine; the fix is a search box plus paging of 50 with an explicit `.range()`, admin stays plain. Owner: `web-engineer`, after M3.6. **Acceptance:** 1200 seeded players render in pages, the search finds a player by name or PUUID prefix, the integration test seeds past 1000 and still finds its row.
- [x] **M3.26** (landed 2026-09-11: `SETTLING_SENTENCE_PLAYER` on /p/[puuid], third person, no name) The settling sentence in the second person on someone else's page. Designer, 2026-09-10: on Yuki's `/p/[puuid]` a visitor reads "your rating, minus how unsure the board still is about you" about someone else. Product rules whether `/p/[puuid]` gets a third-person form (`Yuki's rating, minus …`, interpolating the name) or a person-neutral sentence shared with the board, writes it into the copy table, and the web engineer swaps the constant (`SETTLING_SENTENCE` stays for `/leaderboard`, a second constant or a function for the player page). Owner: `product` then `web-engineer`, with M3.6. **Acceptance:** the two pages' sentences are in `05-design.md` byte for byte, the player page's sentence never says "you" or "your", and `board.test.ts` pins both.
- [x] **M3.30** (landed 2026-09-11: the idle column keeps the 44rem cap at 1280) The idle tonight page's main column keeps its 44rem cap at 1280. Designer, 2026-09-10 (from the M4.7 review): in `idle` the main column runs the full 76rem, so the empty rack is a 1300px row with `open` at the far left; the grid table in `05-design.md` caps the single column at 44rem from 720px and the `>=1080px` two-column rule appears to have dropped it. Owner: `web-engineer`, with M5.4. **Acceptance:** at 1280 the idle main column is 44rem wide beside the rail, the filling and balanced columns unchanged; a screenshot at 1280 reviewed by the designer.
- [x] **M3.27** (landed 2026-09-10: `afterAll` in tonight.integration.test.ts, zero rows leaked across ten runs) `app/tonight.integration.test.ts` cleans up after itself. Found 2026-09-10: the file has no `afterAll`, so every suite run leaks ten `it-<run>-tn*` players and a game into the shared local stack (140 such players after a day), which is how the stack crossed PostgREST's row cap in the first place. Owner: `web-engineer`, with M3.25. **Acceptance:** the file deletes its players, ratings, lobby and game in `afterAll`; `select count(*) from players where puuid like 'it-%'` is unchanged by a run.
- [x] **M3.28** (landed 2026-09-10: `workspaceConcurrency: 1` in pnpm-workspace.yaml (the .npmrc form is inert on pnpm 12); it spaces non-dependent packages, it cannot serialise two worktrees on one stack) `pnpm -r test` is reliable with the local stack up. Found 2026-09-10: `pnpm -r` runs `packages/db` and `apps/web` in parallel and both drive the same local Supabase stack, where the active season and `players` are global; one run in six failed five web cases that pass alone. Fix: `--workspace-concurrency=1` for the test script (or move the db schema integration test onto its own schema), plus deleting the dead `.cn-hint-link` rule in `tonight.css:945`. Owner: `platform-engineer`, with M3.25. **Acceptance:** ten consecutive `pnpm -r test` runs green with the stack up.
- [x] **M3.29** (landed 2026-09-11: `afterAll` restores Season 1 and deletes the test's games by season before its seasons, on failure too) `rebuild.integration.test.ts` leaves no season behind when a run fails mid-file. Found 2026-09-10: two inactive `it-<run> rebuild` seasons were left on the shared stack by runs that failed at 05:32; the same shape as M3.27. Owner: `platform-engineer`, with the next platform task. **Acceptance:** the file's `afterAll` (or a `try/finally` around the season switch) deletes its seasons and restores Season 1 as active even when an assertion fails; `select count(*) from seasons` is unchanged by a failing run.
- [x] **M3.31** (landed 2026-09-15. Core half: `evenness`/`balanceScore` in `packages/core/src/rating/index.ts`, `predictWin` byte-identical. Review found the edge-case note below is wrong — `predictWin` does not throw on an empty team, it returns 0/1/0.5 — so the guard lives in `balanceScore` itself instead; see the 2026-09-15 decision row. Web half: `Evenness` in `TonightView.tsx`, `evennessLine` in `lib/tonight/copy.ts`, reads `splits.blue_win_prob` (stored, never a live recompute), gated on `lobby.status === 'balanced'` alongside `SideLine` and `MissedInvite` — review caught the first version rendering unconditionally, including under a finished-but-unrated remake's `GAME OVER` headline (M3.4's `kind: 'teams'` path), fixed and pinned with a test that proves it's on that path first. One documented consequence of matching the existing gate: the line also disappears at `in_game`, not just after the whistle. The copy row for `05-design.md` is still owed by the designer.) How even the teams are, as a percentage, on the tonight page. A pure `balanceScore` in `packages/core` beside `predictWin`, and one line under the balanced teams. **Does not change the rating model, the balancer's choice of split, or what the Discord embed says.** *(owner: `core-engineer` for the function, `web-engineer` for the line; asked for by the user 2026-09-15. **It is not in M8**: see M8's preamble. Sequenced after **M7.2** and **M7.8**, which are both editing `packages/core/src/rating/index.ts` and `config.ts`; it touches neither the board nor the fold, so it does not wait on the rest of M7.)*

    > **Brief (product, 2026-09-15)**
    >
    > ### What a player sees
    >
    > Teams are posted on the tonight page. Under them, one new line: `Teams are 92% even.` That is the whole
    > feature. The existing sentence — `Blue favored 54%. Everyone on a main role. Gap 100. Next best: …` — is
    > not edited, not reordered and not shortened.
    >
    > ### Why a third number about the same fact is allowed here, and what keeps it honest
    >
    > The page already prints two numbers about how even the split is: the win chance and the gap. This adds a
    > third, and the only reason it is not clutter is that it is the one a friend reads without thinking. `Gap 100`
    > means nothing until you know a side sums to about 7,600, and `Blue favored 54%` is read by half the group as
    > "blue wins" rather than "it is nearly a coin flip". `92% even` is the same fact in the one shape nobody has
    > to be taught.
    >
    > **So it must be arithmetic on a number already on the page, and never a second opinion.** It is defined as
    > exactly `100 - |blueWinProb - 0.5| × 200`, rounded — 50% is 100, 54% is 92, 70% is 60. It cannot say the
    > teams are even while the line under it says blue is favoured 70%, because there is one number underneath
    > both. This is the rule to break the task on: if the implementation ever computes a second comparison of the
    > two sides, it is wrong, however good the second comparison is.
    >
    > ### What to build
    >
    > Two small exports beside `predictWin` in `packages/core/src/rating/index.ts`:
    >
    > - `evenness(blueWinProb: number): number` — the transform above, returning an integer in `[0, 100]`.
    >   Throws outside `[0, 1]`, like every other guard in that file.
    > - `balanceScore(blue: readonly Rating[], red: readonly Rating[]): number` — `evenness(predictWin(blue, red))`,
    >   for callers holding ratings rather than a stored probability.
    >
    > `predictWin` is not touched and **no second win-probability model is written** (it exists and is tested,
    > M1.3). `rateGame`, `ordinal`, `displayRating` and `seedFromRank` are untouched.
    >
    > ### The display path reads the stored number
    >
    > The tonight page renders from `splits.blue_win_prob`, the chosen split's stored probability — the same
    > column `/p/[puuid]`'s recent games and the leaderboard's per-game expand already read. So the page calls
    > `evenness`, not `balanceScore`, and the percentage on the screen is derived from the percentage the group
    > was shown on the night, even after somebody's rating has moved since. **No new API field is required** and
    > none should be added: `Split` already carries `blueWinProb` and the tonight payload already carries it
    > through. If it turns out the tonight view genuinely cannot reach the stored probability, say so and stop
    > rather than recomputing from live ratings, which would make the two lines disagree the morning after.
    >
    > ### Copy (product; the designer adds the row to `05-design.md`)
    >
    > - The line, once, under the balanced teams, in the tonight page's own body size:
    >   `Teams are 92% even.`
    > - `100% even.` reads as a claim nobody believes, so at exactly 100 the line is `Teams are as even as they get.`
    > - No bar, no meter, no colour scale, no green-to-red. Floodlit: a sentence, like every other number on the page.
    > - The Discord teams embed does not get this line. M3.11's description is pinned copy and the embed's job is
    >   the split, not a second reading of it. If the group asks for it there, that is a copy task of its own.
    >
    > ### Edge cases
    >
    > - **A lobby with no stored probability** (a split written before the column, a lobby the page is rendering
    >   optimistically) prints no line at all. Not `—`, not `unknown`.
    > - **A perfectly even split** prints the `as even as they get` wording; a test pins it.
    > - **Everybody unrated on the first night ever** is a 50% split, so the line says as even as they get, which
    >   is true and is the same thing `Neither side was favored.` already says.
    > - **Fewer than ten in the lobby**: the tonight page shows no teams, so no line. `balanceScore` itself is not
    >   five-and-five bound — it takes two non-empty teams of any size, and a test covers 4v4 — but nothing in the
    >   product displays a split of anything but ten.
    > - **An empty team** throws. **Corrected 2026-09-15**: `predictWin` itself does *not* throw on an empty
    >   team — measured, it answers 0, 1 or 0.5 (OpenSkill sums an empty side to nothing and predicts anyway) —
    >   so `balanceScore` guards both sides itself rather than relying on `predictWin` to do it. See the
    >   2026-09-15 decision row.
    >
    > ### Acceptance
    >
    > 1. Pure: no clock, no I/O, no config read. Every branch tested.
    > 2. `evenness(0.5) === 100`; `evenness(0.54) === 92`; `evenness(0.7) === 60`; `evenness(1) === 0`; and
    >    `evenness(p) === evenness(1 - p)` for a table of `p` — the score is about the gap, not about which side.
    > 3. Monotonic: a test folds a lobby where one team's mu sum grows step by step and asserts the score never
    >    rises. Two identical teams score 100.
    > 4. `predictWin`, `rateGame`, `ordinal`, `displayRating` and `seedFromRank` are byte-identical in behaviour;
    >    M1.3's and M1.4's tests pass unmodified and the worked example's splits do not move.
    > 5. The tonight page prints the line from `splits.blue_win_prob` and a test pins that the printed score and
    >    the printed win chance are the same number twice — feed the view a 70% split and assert `60% even` and
    >    `Blue favored 70%.` appear together.
    > 6. The teams embed, the result embed and every board surface are unchanged (test).
    > 7. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; the status table is updated; the
    >    copy row is in `05-design.md`.
    >
    > ### Out of scope
    >
    > Changing which split the balancer picks, or its ordering — this is a display transform and reading it must
    > not feed back into `score` or `compareSplits`. A balance score on the Discord embed, on `/games`, on
    > `/p/[puuid]` or in the history. Storing it: it is two arithmetic operations on a column that is already
    > there. A "how even was it" museum on `/fun` — that is M8.2's question and it is a different one.

- [x] **M3.24** Time-of-day flake in `apps/web/lib/discord/discord.integration.test.ts`. Found 2026-09-09 at 06:00:41 Cairo: the M3.12 case "goes back to the most-games clause once one game has been played" posts a game at `Date.now() - 60_000`; between 06:00:00 and 06:01:00 in `CUSTOMS_NIGHT_TZ` that instant falls before the night boundary, `gamesTonight` is 0 for everyone, and the clause falls back to longest-since. Test-only fix: inject `now` or start the game safely inside the night (the night's own start plus an hour). Owner: `platform-engineer`, with M5.11. **Acceptance:** the case passes when run with a faked clock at 06:00:30 in the night timezone.

Acceptance: a full night with real players, teams posted within 15 seconds of the tenth join, results within 60 seconds of end of game, no human action beyond joining the lobby.

## M4 Lobby automation, voice split, presence (3 to 4 days, needs M3)

Goal: the companion opens the lobby and invites the ten; Discord splits voice; the WhatsApp thread gets a "7 around".

- [x] **M4.1** (companion half landed 2026-09-09: poll, execute-once, gated executors, verify-commands mode; server half landed 2026-09-10: migration 0006 on kustom, poll/ack/nack routes, switch_side queued on balanced and on reroll, superseded on leaving balanced, gate `COMMAND_KIND_ENABLED` mirrors the lcu gate. **Live verification landed 2026-09-12 on patch 16.18**: a friend ran `Kustom.exe --verify-commands` against a real client and all three writes were accepted first try — create custom lobby 200, invite 200, switch side 204 — with 0.1.4's corrected create body (top-level `queueId` equal to `mutators.id`, from the client's own lobby dialog) after 16.17's community body had answered 500 INVALID_LOBBY. Both gates are green in the same commit: `LOBBY_WRITE_VERIFICATION` in `packages/lcu/src/writes.ts`, `COMMAND_KIND_ENABLED` in `apps/web/lib/commands/gate.ts`, and the three `03-lcu-reference.md` rows. **Server-side only until a companion rebuild is published**: `apps/companion/package.json` is still 0.1.4 — the probe build, cut before the flip — and the exe the group downloaded has `LOBBY_WRITE_VERIFICATION.verified: false` baked in, so it answers `endpoint_unverified` to every `create_lobby`, `invite` and `switch_side` the open server now queues. Until the version is bumped and `pnpm --filter companion release` has published it, the queue writes rows nobody executes — M4.1, M4.2 and M4.3 do nothing on a real night. Tracked on M2.6. **Reviewer-caught fix, 2026-09-13, before the next companion rebuild**: the flip as landed on 2026-09-12 would have nacked every real `create_lobby` anyway. Two bugs, both in code that had only ever run against invented fixtures: (1) `CustomGameQueuesSchema.gameServerRegions` was `.optional()`, which rejects the real capture's `null` (fixed to `.nullish()`); (2) the 16.18 dialog's own `mutators[]` carry no descriptive text for *any* mode (not only blind, as 2026-09-10's evidence suggested), so `chooseCustomLobbyMutator`'s word match resolved nothing for draft — the `3110` used in the 16.18 live run was typed by a human at the `verify-commands` prompt, never resolved by production code. Fixed by joining the dialog's mutator ids against `GET /lol-game-queues/v1/queues` (now fetched by the executor too), which does name them; `packages/lcu/src/writes.test.ts` gained an end-to-end test off the real `custom-game-queues.json` + `game-queues.json` fixtures asserting queueId 3110, which is what would have caught both bugs before the flip shipped. See `docs/03-lcu-reference.md` rows "Custom game dialog data", "Queue list", "Create custom lobby" and `docs/04-decisions.md`, 2026-09-13.) `companion_commands` queue: the companion polls, executes, acks. Kinds: `create_lobby`, `invite`, `switch_side`.

    > **Brief (product, 2026-09-09)**
    >
    > **The scene.** Nobody is watching this task. It is the wire under M4.2 and M4.3: the server needs a way to
    > say "open a lobby", "invite Rami", "you are on red" to a client it cannot reach, and the companion needs a
    > way to do exactly those three things and nothing else. If it works, ten friends never learn that it exists.
    > If it half works, somebody's client opens two lobbies, and that is the failure this brief is written against.
    >
    > **Where it lives.** `apps/web/app/api/companion/commands/route.ts` (GET) and
    > `apps/web/app/api/companion/commands/ack/route.ts` (POST), both on the existing companion-token class
    > (`lib/companionRoute.ts`); the queue's rules in `apps/web/lib/commands.ts`; the wire schemas in
    > `packages/db/src/schemas/companionCommands.ts` (one payload schema and one result schema per kind, exported
    > from `@customs/db/schemas` like every other boundary); the runner in `apps/companion/src/commandRunner.ts`
    > with its executed-ids file in `apps/companion/src/executed.ts`; and the three client calls in
    > `packages/lcu` on top of `WRITE_ENDPOINTS`, which is the only place in this repo allowed to POST to
    > `127.0.0.1`. One new migration (take the next unused number) adds the columns below.
    >
    > **The migration.** `companion_commands` as shipped in `0001_init.sql` can say what to do and that it was
    > acked, but not what came back or why it failed, and it has no expiry — a `create_lobby` row handed out an
    > hour late opens a lobby nobody asked for. Add, never editing 0001:
    >
    > ```sql
    > alter table public.companion_commands
    >   add column sent_at    timestamptz,
    >   add column attempts   smallint not null default 0,
    >   add column result     jsonb,
    >   add column error      text,
    >   add column expires_at timestamptz not null default now() + interval '5 minutes';
    > ```
    >
    > The existing `companion_commands_pending_idx` already covers the poll. RLS stays as it is: this table has
    > no read policy at all and is reached only through the service role behind a token check.
    >
    > **Time to live, per kind.** `create_lobby` 60 s, `invite` 5 min, `switch_side` 3 min, set by the writer, in
    > one map in `lib/commands.ts`. A minute is how long a friend will wait staring at a button before pressing
    > it again; three minutes is how long a side switch is still the right side; five is how long an invite is
    > still worth popping up. Expired rows are `failed` with `error = 'expired'`.
    >
    > ### `GET /api/companion/commands`
    >
    > Query: `clientConnected=true|false` (required). Answer:
    >
    > ```
    > { commands: [{ id, kind, payload, createdAt, expiresAt }], nextPollInMs }
    > ```
    >
    > - **The token's player only.** `target_player_id = <token's player>`, `status in ('pending','sent')`,
    >   `expires_at > now()`, oldest `created_at` first, at most **5**. There is no admin view of another
    >   player's queue on this route and no way to ask for one; the parameter does not exist.
    > - `nextPollInMs` is `5000`. It is the server's dial, exactly as `recheckInMs` is (M2.5): the companion obeys
    >   the number and holds no interval of its own.
    > - **Handing a row out** sets `status = 'sent'`, `sent_at = now()`, `attempts = attempts + 1`. A `sent` row is
    >   handed out again only after **30 s** (`RECLAIM_MS`) — long enough that a companion mid-execution is not
    >   raced by its own next poll, short enough that a crash costs one poll.
    > - At `attempts > 3` the row is `failed` with `error = 'not acked after 3 deliveries'` and is never returned
    >   again. A command that kills the companion three times is not going to work the fourth.
    > - **`clientConnected=false` answers `{ commands: [], nextPollInMs }` and touches nothing** — no `status`
    >   move, no `attempts`, and **no `last_seen_at` write**. The companion asks for work only when it can do it,
    >   so a queue is never drained into a client that is not there, and `companion_tokens.last_seen_at` comes to
    >   mean "this friend was at their PC with League open", which is the signal M4.2's "around" is built on.
    >   Every other companion route keeps touching `last_seen_at` as today; they all imply a live client anyway.
    > - Each call runs one cheap expiry sweep first, in the style of M2.5's abandon sweep:
    >   `update companion_commands set status='failed', error='expired' where status in ('pending','sent') and expires_at <= now()`.
    >
    > ### `POST /api/companion/commands/ack`
    >
    > Body: `{ id: uuid, outcome: 'done' | 'failed', result?: <kind's result schema>, error?: string }`
    > (`error` trimmed to 500 characters). Rules:
    >
    > - The row must exist **and** belong to the token's player, otherwise **404** — not 403. A 403 would confirm
    >   that somebody else's command id exists.
    > - `outcome: 'done'` → `status = 'acked'`, `acked_at = now()`, `result` stored after parsing with that kind's
    >   result schema. A result that fails the schema is **422** and the row is left alone: a mangled result is a
    >   companion bug, and losing it is better than storing a lie that M4.2 will read.
    > - `outcome: 'failed'` → `status = 'failed'`, `acked_at = now()`, `error` stored, `result` null.
    > - **An ack of a row that is already `acked` or `failed` is a 200 no-op** — `{ ok: true, status, changed: false }`
    >   — and changes not one column. This is the other half of execute-once: a lost ack is re-sent, not re-run.
    > - The route announces acks through a hook list (`registerCommandHook({ onAcked })`, mirroring
    >   `apps/web/lib/ingest/hooks.ts`). M4.2 hangs the invite fan-out off it. A hook that throws is logged and
    >   the response still goes out.
    >
    > ### The payloads and what comes back
    >
    > | kind | payload | result on `done` |
    > |---|---|---|
    > | `create_lobby` | `{ lobbyName: string(1..30), lobbyPassword: string(4..16) }` | `{ partyId, lobbyName }` |
    > | `invite` | `{ puuid, summonerId: string \| null }` | `{ puuid, method: 'summonerId' \| 'puuid', state: 'Pending' \| 'Accepted' }` |
    > | `switch_side` | `{ targetSide: 100 \| 200 }` | `{ side: 100 \| 200 }` |
    >
    > Failure reasons are a closed vocabulary (`commandFailureReasonSchema`), so a page can render them and a log
    > line can be grepped: `not_connected`, `wrong_phase`, `no_lobby`, `not_custom_lobby`, `already_in_lobby`,
    > `not_on_a_team`, `side_full`, `endpoint_unverified`, `client_rejected`, `expired`, `malformed_payload`.
    > `error` is the reason plus, for `client_rejected`, the client's status code and its message — never a body.
    >
    > ### Executed once, even when the ack is lost
    >
    > `<configDir>/commands-done.json`: `{ version: 1, entries: [{ id, kind, at, outcome, result?, error? }] }`,
    > capped at 200 entries, entries older than 24 h dropped on write, same tmp-file-and-rename discipline as the
    > end-of-game queue (`queue.ts`). Written **after the client call returns and before the ack POST**.
    >
    > - On every poll, a command id in that file is **not executed again**. The companion re-acks it from the
    >   recorded outcome and result and makes no client call. That is the whole guarantee.
    > - The one hole is honest and stated: a process killed between the client call and the file write can run a
    >   command twice. That is why **every executor reads the lobby first and compares before it writes** — a
    >   second `create_lobby` finds a lobby open and nacks `already_in_lobby`, a second `invite` finds a `Pending`
    >   or `Accepted` invitation and acks `done` without POSTing, a second `switch_side` finds the local player
    >   already on the target side and acks `done` without POSTing. Repeating a command is a no-op by
    >   construction, not by luck.
    >
    > ### What the companion does when the client is not in the right state
    >
    > The runner never queues work behind a bad state; it answers straight away so the person pressing the button
    > learns something.
    >
    > - **No client at all.** The runner polls with `clientConnected=false` and is handed nothing. It never nacks
    >   for this reason; a friend who is launching League gets their invite when the client is up, and the command's
    >   own TTL is what gives up. (`not_connected` exists for the race where the socket drops between the poll and
    >   the call.)
    > - **Phase is anything but `None` or `Lobby`.** `wrong_phase`, no client call. Champion select and in-game are
    >   not states we act in — see the line below.
    > - **`create_lobby`** with `GET /lol-lobby/v2/lobby` answering 200: `already_in_lobby`, and the existing
    >   `partyId` goes in `error`. **The companion never dissolves a lobby somebody is standing in.**
    > - **`invite`** with a 404 from the lobby: `no_lobby`. With `gameConfig.isCustom` false: `not_custom_lobby`.
    >   With the invitee already in `members[]` or already holding a `Pending` invitation: acked `done`, no POST.
    > - **`switch_side`** with no lobby or a non-custom one: as above. With the local puuid in `customSpectators`
    >   or on neither side: `not_on_a_team` — the toggle cannot seat a spectator. With the target side already
    >   holding five: `side_full`. Already on the target side: `done`, no POST.
    > - **A kind whose reference row is not `verified`:** `endpoint_unverified`, no client call, one log line
    >   naming the row to verify. See the gate below.
    >
    > ### The line this task sits on
    >
    > The executor holds a **hard allow-list of client paths** — `POST /lol-lobby/v2/lobby`,
    > `POST /lol-lobby/v2/lobby/invitations`, `POST /lol-lobby/v1/lobby/custom/switch-teams` (and its v2
    > candidate) — plus the reads it needs (`GET /lol-lobby/v2/lobby`, `GET /lol-gameflow/v1/gameflow-phase`,
    > `GET /lol-summoner/v2/summoners/puuid/{puuid}`). Anything else is refused at runtime with a thrown error in
    > tests. **Create a lobby, invite, switch side. Nothing else, ever.** No champion-select path, no matchmaking
    > path, no `/lol-champ-select/*` subscription acted on, no request to `127.0.0.1:2999`. That is the Riot line
    > in `CLAUDE.md` and in `03-lcu-reference.md`, and a command kind the enum does not name is acked `failed`
    > with `malformed_payload` rather than turned into a client call.
    >
    > ### Before any of it: the live verification pass
    >
    > `03-lcu-reference.md` still marks all three write endpoints `unverified`, and questions 5 and 6 are open,
    > because M0's tooling is GET-only by design. **Nothing in this task may ship enabled on an unverified row**
    > (`CLAUDE.md`, "Verify before you claim"). So M4.1 ships two things: the queue, which is fully testable
    > against stubs, and the tool that turns the rows green.
    >
    > `pnpm --filter companion verify-commands` (packaged: `Kustom.exe --verify-commands`). It is run by a
    > person, with the League client up and one friend online, and it is the **only** code allowed to POST to the
    > client while the rows are unverified. It makes no API calls, prompts before each probe, prints a report and
    > writes it to `<configDir>/verify-commands-<patch>-<date>.txt`.
    >
    > 1. **Create.** `POST /lol-lobby/v2/lobby` with the body in the reference row, `lobbyName: "customs-verify"`,
    >    `lobbyPassword: "1234"`, `mutators.id: 1`. Print the status, the body's `partyId` and
    >    `gameConfig.customMutatorName`, and whether the client's own lobby screen shows the password. Repeat with
    >    `mutators.id: 2` and record which number is which mode.
    > 2. **Invite.** With that lobby open: `GET /lol-summoner/v2/summoners/puuid/{puuid}` for the friend, then
    >    `POST /lol-lobby/v2/lobby/invitations` with `[{ toSummonerId }]`. Print the status and the resulting
    >    `invitations[]` row. On any 4xx, retry with `[{ toPuuid }]` and print both answers.
    > 3. **Switch.** `POST /lol-lobby/v1/lobby/custom/switch-teams` with an empty body; print the status and
    >    `customTeam100`/`customTeam200` before and after. On 404, the v2 path. Then fill the target side (the
    >    friend plus bots) and repeat, printing what a full side answers.
    >
    > **Pass condition, per kind:** the endpoint's row in `03-lcu-reference.md` carries the exact body that
    > worked, the answer for the full-side case, and a status of `verified (<patch>, <date>)`; questions 5 and 6
    > are answered in the same edit. Until a kind's row is green, its per-kind flag is off at **both** ends — the
    > server does not queue it and the companion answers `endpoint_unverified` — so an old exe can never become
    > the thing that POSTs an unverified path. The user runs the mode and pastes the report; the engineer writes
    > the rows. Do not go looking for another way in if a path 404s: M4.3's escape hatch is a line of copy, not a
    > different endpoint.
    >
    > ### Edge cases
    >
    > - **Fewer than ten, more than ten.** The queue does not know how many people are in the room. Who gets a
    >   command is M4.2's and M4.3's decision; this layer carries one row per player.
    > - **Someone leaves mid-lobby.** Their pending rows sit until the TTL fails them. Nothing here cancels
    >   anything; M4.3 supersedes its own rows when the teams change.
    > - **Companion disconnects.** It keeps polling with `clientConnected=false` and is handed nothing, so a
    >   command is never spent on a dead client. If the client comes back inside the TTL, the command runs.
    > - **A player with no companion.** The row expires and is `failed` with `expired`. M4.2 should not write it
    >   in the first place; the TTL is the backstop, not the rule.
    > - **An unknown player.** A `players` row is a `players` row; the queue keys on `target_player_id` and has no
    >   opinion about names or ranks.
    > - **Two tokens for one player.** The architecture says one token per player. Two live tokens on two machines
    >   would both be offered the same row and both could execute it; `RECLAIM_MS` makes it unlikely and the
    >   read-before-write executors make it harmless for `invite` and `switch_side`. Two machines signed in as one
    >   player is out of scope and named here so nobody thinks it was missed.
    > - **A second command while the first is still running.** The runner executes one command at a time, in the
    >   order it was handed them. Five is the page size for a reason.
    >
    > ### Acceptance check
    >
    > Integration tests against the local stack for the routes, stubbed-client and stubbed-API tests for the
    > runner, in the style of `companion.integration.test.ts` and `gameWatcher.test.ts`. 13 is a human check.
    >
    > 1. GET with a valid token returns only that player's rows, oldest first, at most five; a second player's row
    >    is never visible with either token. No bearer, a revoked token, an unknown token → 401.
    > 2. A handed-out row is `sent` with `attempts = 1` and `sent_at` set; polling again at +29 s does not return
    >    it; at +31 s it returns with `attempts = 2`; the delivery that would make `attempts` 4 instead marks it
    >    `failed` with `error = 'not acked after 3 deliveries'` and it is never returned again.
    > 3. `clientConnected=false` answers `{ commands: [] }`, moves no row, and leaves `last_seen_at` where it was;
    >    the same token with `clientConnected=true` a second later does move it (subject to the 5-minute throttle).
    > 4. A row past `expires_at` is never returned and is `failed` with `error = 'expired'` after any later poll.
    > 5. Ack `done` with a valid result: `acked`, `acked_at` set, `result` stored. Ack it again: 200,
    >    `changed: false`, and every column identical. Ack another player's id: 404 with no row read into the
    >    response. Ack `done` with a result that fails the kind's schema: 422 and the row untouched.
    > 6. Ack `failed` with `side_full`: `failed`, `error` carries the reason, `result` null, and the registered
    >    `onAcked` hook saw it.
    > 7. **The lost ack.** Stubbed client, stubbed API: a `create_lobby` is executed once, the ack POST fails with
    >    a network error, the same row comes back on the next poll, and the companion makes **no** client call and
    >    re-acks with the identical result. Assert the client stub recorded exactly one POST.
    > 8. The same, across a restart: kill the runner after the client call and before the ack, start it again,
    >    still exactly one client POST for that id.
    > 9. Every nack path, one test each: no lobby → `no_lobby`; a non-custom lobby → `not_custom_lobby`; phase
    >    `ChampSelect` → `wrong_phase`; an open custom lobby on `create_lobby` → `already_in_lobby` with the
    >    `partyId` in `error`; `switch_side` while already on the target side → `done` with zero client POSTs;
    >    target side holding five → `side_full` with zero client POSTs; a spectator → `not_on_a_team`.
    > 10. With a kind's verification flag off: the command is acked `failed` with `endpoint_unverified`, no client
    >     call is made, and one log line names the reference row.
    > 11. Across the whole companion suite, the client stub records **no** request to a path outside the
    >     allow-list and **no** connection to port 2999. Assert it as a test, not as a review.
    > 12. No log line at `info` or above carries a lobby password, a companion token, a lockfile password or a
    >     chat credential; the created lobby's password appears at `debug` only. (`log.addSecret` covers the token;
    >     the password is a deliberate `debug`.)
    > 13. **Live:** the verification report exists for the current patch, and either the three rows in
    >     `03-lcu-reference.md` are `verified` with their exact bodies, or the kinds that failed are flagged off in
    >     both places and M4.2/M4.3 read those flags.
    > 14. `pnpm -r typecheck` and `pnpm -r test` pass; the migration applies on `pnpm db:reset` and
    >     `pnpm db:types` is regenerated.
    >
    > ### Out of scope
    >
    > What the commands are *for* — the Start button and the invite fan-out (M4.2), the side switch (M4.3). The
    > Discord bot (M4.4) and presence (M4.5). Any fourth command kind: the enum has three and widening it is a
    > migration and a decision row, not a drive-by. Automatic retry of a `failed` command — a person presses the
    > button again, which is one tap and is honest about what happened. An admin page for the queue; the row's
    > `status` and `error` are enough until somebody asks twice.

- [~] **M4.2** (server side landed 2026-09-10: `POST /api/admin/lobbies/start` admin-gated per the decision row, rules and copy in `lib/admin/lobbyStart.ts`, invite fan-out in `lib/commands/invites.ts` on the ack seam, gated off with M4.1. **Both page controls landed 2026-09-10**: the tonight page's `app/_tonight/StartLobby.tsx` for `viewer.isAdmin` in the `idle` and `filling` states, and the same press on `/admin` through `AdminForm`; both post JSON in place and print the route's own refusals, and both read tonight's row through `lib/tonight/lobbyStart.ts` — a **poll**, every 5 s while it is pending, because `companion_commands` is service-role only and in no Realtime publication (`04-decisions.md`). Pending: widening the press to linked players once M3.6 lands, and the live check. **M3.6 landed 2026-09-10 and the widening is scoped as M4.13, 2026-09-15** — route onto the `/api/me/*` class, control drawn for any linked viewer, the anonymous sign-in sentence back in `idle`; the live check is the only piece that stays on this row) "Start a lobby" button on the tonight page and an admin route: creates a `create_lobby` command for a chosen companion user, with a generated name and password, followed by `invite` commands for everyone linked and "around".

    > **Note (product, 2026-09-08, after M0.3).** The invite body is still unverified and M0 could not
    > answer it: the smoke tooling is GET-only by design, so nothing was ever POSTed to a live client. This
    > task verifies it as its first step, per `03-lcu-reference.md` question 6: `POST
    > /lol-lobby/v2/lobby/invitations` with `[{ "toSummonerId": <id> }]` using a `summonerId` from
    > `GET /lol-summoner/v2/summoners/puuid/{puuid}`; if that 4xx's, retry with `[{ "toPuuid": "<puuid>" }]`.
    > `invitations[]` in the lobby event shows which worked. Update the reference row and its status before
    > building the queue handler on it — that is the "verify before you claim" rule. `create_lobby`'s body
    > and its `mutators.id` values are unverified for the same reason and get the same treatment here.

    > **Brief (product, 2026-09-09)**
    >
    > **The scene.** 21:40. Seven friends are in Discord voice and one of them has the tonight page open on a
    > phone. They tap **Start a lobby**. Somebody's League client — nobody had to decide whose — opens a custom
    > lobby with a name and a password neither of them chose, and the invite popup appears for everyone who is
    > around. Nobody typed a lobby name, nobody read a password out loud, nobody asked "who's making it?".
    > This is the one tap M4's acceptance line already accepts, and it is the only one.
    >
    > **Where it lives.** One route, `apps/web/app/api/lobbies/start/route.ts`, called by two surfaces: the
    > tonight page control (M3.4's component) and a `Start a lobby` control on the `/admin` dashboard index. The
    > rules — who may press, who hosts, the name, the password, who is around, the fan-out — live in
    > `apps/web/lib/lobbyStart.ts`. The invite fan-out hangs off M4.1's `onAcked` hook. The companion side is
    > M4.1's executor plus one thing: it remembers the password it set.
    >
    > **Who may press.** A signed-in visitor whose Supabase session matches a `players` row — M3.6's third route
    > class — or an admin. Not admin-only: opening a lobby is what any of these ten people does today, and making
    > it an admin chore puts a human in the way of a night starting. An anonymous visitor sees the button
    > disabled with `Sign in with Discord to start a lobby.`; a signed-in visitor with no player row gets M3.6's
    > `Which one of these is you?` flow instead of an error. **One route, both surfaces** — the admin control is
    > the same call with an admin's session, so there is one set of rules and no second copy to drift.
    >
    > **Refusals.** Each is a 409 and one sentence the page prints where the button was:
    >
    > | when | sentence |
    > |---|---|
    > | a lobby of tonight is `open`, `balanced` or `in_game` | `There is already a lobby open.` |
    > | nobody's companion has been up in the last 10 minutes | `Nobody has the companion running right now. Start it and try again.` |
    > | a `create_lobby` for tonight is still pending (< 60 s old) | `A lobby is already being opened.` |
    > | the `create_lobby` kind is flagged off (M4.1's gate) | `Opening lobbies isn't verified on this patch yet.` |
    >
    > The third one is also the double-tap guard: the pending row *is* the lock, so two people tapping at the same
    > moment produce one command.
    >
    > **Who hosts.** The server picks: among players with an unrevoked companion token whose `last_seen_at` is
    > inside the last **10 minutes**, the newest, preferring the presser when they qualify. `last_seen_at` means
    > "at their PC with League open" from M4.1 on, which is exactly the question being asked. Nobody chooses a
    > host in a dropdown; the page names the one that was picked while the command is pending and then stops
    > mentioning it.
    >
    > **The name and the password.**
    >
    > - Name: `Customs <dd Mon> #<n>`, ASCII, at most 30 characters — `Customs 09 Sep #2`. `n` is the number of
    >   `lobbies` rows for tonight (`nightStart`, `CUSTOMS_NIGHT_TZ`, any status) plus one, so the night's second
    >   lobby says so in the client's own lobby list and in the Discord embed.
    > - Password: four digits, `randomInt(0, 10000)` zero-padded. Four because somebody joining by hand types it,
    >   and the group reads it out in voice. It is not a secret: it goes in the Discord embed and on the tonight
    >   page.
    > - Both go on the `create_lobby` payload. The companion keeps `{ partyId → password }` in memory and sends
    >   `lobbyPassword` on **every** lobby post for that party. That is what finally fills
    >   `lobbies.lobby_password`, and it **supersedes** the 2026-09-08 decision that the column stays null until
    >   M4.1.
    > - **A `lobbyPassword: null` never clears a stored password.** Only a non-null value writes. The second
    >   companion in the same lobby posts null, and so does the host's own companion after a restart; neither of
    >   them knows the password and neither may erase it.
    > - Mode: blind pick (`mutators.id: 1`), `mapId: 11`, `teamSize: 5`, `spectatorPolicy: 'AllAllowed'` — one
    >   constant, `CUSTOM_LOBBY_MUTATOR_ID`, matching the lobbies the group actually opened in the 16.17 capture
    >   (queue 3100). If the group wants draft, that is a one-line change and a decision row, not a picker on the
    >   page: a dropdown is a step, and this product's claim is that there are none.
    >
    > **"Around", defined here because M4.5 does not exist yet.** Voice presence is the real answer and it lands
    > two tasks later. Until then, around is the union of:
    >
    > - **a.** every player whose companion token was seen in the last **60 minutes** (`last_seen_at`, which now
    >   means their client was up); and
    > - **b.** every player who appeared in a custom on one of the last **7 nights** — a `game_players` row, or a
    >   `lobby_members` row of a lobby that reached `in_game` — counted in nights by `CUSTOMS_NIGHT_TZ`, the same
    >   06:00 boundary as everything else;
    >
    > minus the host, minus anyone already in `lobby_members` for the live lobby, ordered most recently active
    > first, capped at **19** invites. Clause (b) is not decoration: `00-product.md` says one or two friends run
    > the companion, so a companion-only definition would invite two people and call it a night. An invite that
    > reaches somebody who is not around costs them one popup that expires on its own; a missing invite costs a
    > person their game. When M4.5 lands, voice presence replaces clause (b) and this rule shrinks to one line.
    >
    > **The fan-out.** On the `create_lobby` ack with `outcome: 'done'` — which is also the proof that a lobby
    > exists — queue one `invite` command **per person in the around set, all targeted at the host's companion**
    > (the client invites into whatever lobby it is in; the invitee needs no companion at all). Payload carries
    > the invitee's `puuid` and their `summoner_id` when we have one, so M4.1's executor can use whichever body
    > the verification pass found. A `create_lobby` that fails or expires queues nothing: no lobby, no invites,
    > no half state.
    >
    > **Copy (product owns these words).**
    >
    > - Button: `Start a lobby`
    > - While the command is pending: `Opening a lobby on <Name>'s PC…`
    > - On success: nothing. The member list appearing *is* the answer, and a toast on top of it is noise.
    > - Under the member list while the lobby is filling, until ten are in:
    >   `Invited <n> friends — waiting for them to accept.`
    > - The four refusals in the table above.
    >
    > ### Edge cases
    >
    > - **Fewer than ten accept.** Nothing happens. The lobby sits `open`, M2.5's rules take over, and there is no
    >   second wave of invites and no reminder. The button is not a doorman.
    > - **More than ten accept.** The client caps each side at five and the rest land in the spectator slot, which
    >   M2.5 already counts as around and rotates through. Nothing here changes.
    > - **Someone leaves mid-lobby.** No re-invite. If the group wants them back, someone presses Start on the
    >   next cycle or invites them from the client, which is the same click it has always been.
    > - **The host's companion goes away between the press and the poll.** The command is never handed out
    >   (`clientConnected=false`), it expires after 60 s, and the page says
    >   `Nobody's client answered. Try again.` Nothing was created.
    > - **The host already has a lobby open** (they made one by hand a minute earlier). The nack is
    >   `already_in_lobby`; the page says `<Name> already has a lobby open — everyone can join that one.` and no
    >   password is stored, so the teams embed falls back to the name alone, exactly as M3.1 already specifies.
    > - **An unknown player in the around set.** Invited like anyone else on their puuid; they have no name yet and
    >   the page renders `Someone` (M3.10).
    > - **The host's companion restarts after creating the lobby.** It no longer knows the password and posts
    >   null; the stored password survives by the never-clear rule above.
    > - **Two people tap at the same moment.** One `create_lobby` row; the second tap gets
    >   `A lobby is already being opened.`
    > - **The night's second lobby.** After a cycle reaches `finished`, Start is allowed again and `#n` increments.
    >
    > ### Acceptance check
    >
    > Integration tests for the route, unit tests for the around set and the name/password, and one live check.
    >
    > 1. Anonymous → 401 and the disabled button with the sign-in sentence. A signed-in linked non-admin →
    >    allowed. An admin → allowed. A signed-in visitor with no player row → M3.6's picker, not a 500.
    > 2. With no token seen in the last 10 minutes → 409, the "nobody has the companion running" sentence, and
    >    **zero** rows written anywhere.
    > 3. A successful press writes exactly one `create_lobby` row for the chosen host, `expires_at` 60 s out, a
    >    name matching `^Customs \d\d [A-Z][a-z]{2} #\d+$` and a four-digit password. A second press inside 60 s
    >    writes no second row and answers 409.
    > 4. On the `create_lobby` ack, `invite` rows appear for exactly the around set minus the host minus current
    >    members, at most 19, most-recently-active first, each carrying the invitee's puuid and their
    >    `summoner_id` when known — all with `target_player_id` = the host.
    > 5. A `create_lobby` acked `failed`, and one left to expire, each queue **zero** invites.
    > 6. The host's next lobby post carries `lobbyPassword` and `lobbies.lobby_password` holds it; a later post
    >    from a second companion with `lobbyPassword: null` leaves the column unchanged; the teams embed's Lobby
    >    field renders `` `Customs 09 Sep #1` · password `4821` `` — the first time that field has ever had a
    >    password (M3.1, acceptance check 5).
    > 7. Around-set units: a token last seen 61 minutes ago with no game in 7 nights is out, at 59 minutes in; a
    >    player who played 6 nights ago in, 8 nights ago out; anyone in `lobby_members` of the live lobby is never
    >    invited; the host is never invited; a 25-player group is trimmed to 19 with a log line.
    > 8. With `create_lobby` or `invite` flagged off by M4.1's verification gate, the route answers 409 with the
    >    "not verified on this patch yet" sentence and writes nothing.
    > 9. **Live, with one friend:** press Start, a lobby opens on the host's client with that name and password,
    >    the friend gets an invite popup, and the tonight page shows the member list without anyone refreshing it.
    > 10. `pnpm -r typecheck` and `pnpm -r test` pass.
    >
    > ### Out of scope
    >
    > Side switching (M4.3), voice (M4.4), the "N around" count and presence (M4.5). A mode picker, a name field,
    > a password field — all three are steps. Kicking, dissolving a lobby from the web, or re-inviting. Backfill,
    > seasons, anything in M5. Changing who sits (M2.5 owns that and it has not moved).

- [~] **M4.3** (built inside M4.1 on 2026-09-10: `switch_side` is queued on `balanced` and on a reroll for every seat on the wrong side, the companion executes it through `POST /lol-lobby/v2/lobby/team/{TEAM}`; it ticks when the user's 0.1.4 probe verifies that path and the gate flips; if the path is refused, the fallback is the row's own: the teams embed says "switch to your side") Auto side switch: after balancing, for each lobby member who runs a companion, queue `switch_side` if they are on the wrong side. Verify the endpoint in M0 first; if it does not exist, this task is dropped and the embed says "switch to your side". **Acceptance 7 (the line vanishes when the sides match) is unmet, not deferred silently; it lands as M4.11.** **Acceptance checks 1 (the embed line) and 8 met on 2026-09-11 with M4.7 (b); the probe verified the side-switch path on 16.18 (2026-09-12) and the gate is green, so the queue writes rows; check 7 is M4.11 and the tick waits on it.**
- [x] **M4.9** (landed 2026-09-10: migration 0008 partial unique index, `enqueueCommands` conflict mapping, sweep before the read; on kustom. Note: the M3.6 role-override migration is numbered 0009 because 0008 shipped first) The Start-a-lobby lock is a database constraint. Reviewer, 2026-09-10: the pending-create lock in `lib/admin/lobbyStart.ts` is read-then-insert; two presses in the same instant can both insert (same host: the companion nacks the second with `already_in_lobby` and the page prints a misleading sentence; two admins with two companions: two lobbies and two fan-outs). Add a partial unique index on `companion_commands` for `kind = 'create_lobby' and status in ('pending', 'sent')` (migration, applied to kustom by the lead) and map the unique violation to the existing `A lobby is already being opened.` refusal. Owner: `platform-engineer`, before the gate flips. **Acceptance:** two concurrent presses in an integration test yield one row and one 409.
- [x] **M4.10** The tonight page prints the live lobby's name and password (product, 2026-09-10; the M4.2 brief already ruled it is not a secret). In `filling` and `balanced` the page renders `Missed the invite? The lobby is Customs 09 Sep #1, password 4821.` byte for byte from the `05-design.md` copy table (`Copy — Start a lobby`); with `lobbies.lobby_password` null the name-only form; with no name no element at all; absent in `idle`, `in_game`, `finished`. Owner: `web-engineer`, with M4.7's placement. **Acceptance:** a component test pins all four cases; the sentence is Archivo with the name and password in mono. **Gate (lead, 2026-09-10):** rendered only for a signed-in viewer matched to a players row; anonymous and unlinked viewers get no element. **Landed 2026-09-11** with M5.15: last line of the primary block, linked viewers only, five component cases.
- [ ] **M4.11** The side line goes when the sides are right (product, 2026-09-11; M4.3 acceptance 7 stays unmet until this lands). The tonight snapshot carries each chosen player's current `lobby_members.side`; the side line is present while any of the ten is mismatched and absent when all ten match, driven by the Realtime `lobby_members` events with no refetch and no re-render of the team cards. Owner: `web-engineer`, with the gate flip. **Acceptance:** a component test with ten matched seats renders no `.cn-side-line`; one mismatched seat renders it; the cards' markup is byte-identical between the two.
- [x] **M4.12** (landed 2026-09-11: `lib/discord/limits.ts` guards every embed limit, cuts on line boundaries lowest-priority first with one `…` line at the gap, keeps the side line, the awards' first lines and the board's top rows; the pathological Seats case goes 1481 to 903 with the side line last; no snapshot moved) A 1024-character guard on embed field values. Reviewer, 2026-09-11: ten `Swap:` lines of 32-character names made only of markdown-escapable characters give a `Seats` value of 1503 characters after cut-then-escape, and Discord answers 400 to the whole webhook; pre-existing and pathological, but there is no guard anywhere in `apps/web/lib/discord/embeds.ts`. Add one shared truncation that keeps the side line and cuts the move lines with a `…` line, and a test at the limit. Owner: `platform-engineer`, with the gate flip. **Acceptance:** every field value the builders emit is at most 1024 characters for any input; the side line survives truncation.
- [ ] **M4.13** The press widens to every linked player (product, 2026-09-15; M4.2's own last open piece besides the live check, unblocked since M3.6 landed on 2026-09-10). `Start a lobby` moves off the admin route class onto M3.6's `/api/me/*` class — `POST /api/me/lobbies/start`, one route, both surfaces, the admin path deleted rather than aliased — and the tonight page draws the control for any **linked** viewer instead of `viewer.isAdmin`. Admins keep it with no special case: `players.is_admin` can only be true on a row that is already linked. Owner: `platform-engineer` for the route move and the gate, `web-engineer` for the control's rendering condition and the anonymous sentence; product for the copy rows and `00-product.md` in the same session it lands. **Sequencing: dispatch after M4.11 has landed and merged** — both tasks live in `apps/web/app/_tonight/` and two engineers in that directory at once is a merge nobody needs. **Acceptance:** anonymous 401 and no button (but the sign-in sentence is back in `idle`); signed-in unlinked 403 with the `/api/me/*` not-linked sentence, never a 500; linked non-admin presses it and a `create_lobby` row is written; admin unchanged on both surfaces; the four refusals byte for byte on the new path. Landing this does **not** tick M4.2: the live check is still outstanding there.

    > **Brief for M4.13 (product, 2026-09-15)**
    >
    > **The scene.** 21:40, nine friends in voice, and the one with the tonight page open is not an admin. Today
    > she sees an empty rack and nothing to press, so she says "somebody with the button, start it" and the night
    > waits on whoever is at their desk. That sentence is the step this product claims not to have. After this
    > task she taps `Start a lobby` herself, a custom opens on somebody's PC, and nobody found out who is an
    > admin.
    >
    > **What a player sees**
    >
    > - **A signed-in friend who has picked themselves once** (`viewer.kind === 'linked'`, admin or not) sees the
    >   button on the `idle` page and the readout in `filling`, exactly where M4.7 (a) put them, dressed exactly
    >   as they are today. Pressing it does what it does for an admin today: the host pick, the generated name and
    >   password, the invite fan-out, the four refusals. **Nothing about the press itself changes.**
    > - **A signed-out visitor** sees no button, and on the `idle` page gets back the sentence M4.2's brief wrote
    >   and 2026-09-10 suspended: `Sign in with Discord to start a lobby.` with the `Sign in with Discord` button
    >   under it, in the role card's signed-out shape (the sentence is the reason, the button is the label — the
    >   designer, 2026-09-10) and posting to `/auth/signin` with `next` back to `/`. **Never a disabled button**:
    >   the M4.2 brief's "disabled with the sentence" is dead, killed by M3.20 and by the designer's amber-control
    >   rules. In `filling` a signed-out visitor still sees nothing at all: that block is a readout, not a control.
    > - **A signed-in visitor with no player row** sees no button and no sign-in sentence — they are signed in,
    >   so inviting them to sign in is noise. The page already speaks to them at the foot of the column with
    >   `Signed in. Open the page while the lobby is up and you can pick yourself out of it.` (`SIGNED_IN_NO_LOBBY`,
    >   M3.6), and that sentence is the true one on an idle page: picking yourself needs a live lobby to pick
    >   yourself out of. **No new copy and no new flow for this case.**
    >
    > **Why the anonymous sentence comes back, and it is not the reason the copy table gave.** The 2026-09-10 row
    > suspended it on two grounds: it would promise a button a non-admin could not press (this task removes that),
    > and "this page's one sign-in already lives on the role card forty pixels away". The second ground is false in
    > the one state that matters: `RoleTonight` draws nothing at all for a signed-out visitor with no live lobby,
    > so on the **idle** page — the only state the button exists in — there is no sign-in control anywhere on this
    > site. Without this sentence, a friend whose session has expired opens the page on the one night it matters
    > and finds no door. That is why it returns in `idle` only, which is also where the copy table already said it
    > would return.
    >
    > **The rule, server side.** One route, `apps/web/app/api/me/lobbies/start/route.ts`, on M3.6's class
    > (`lib/me/route.ts`'s `withViewerAuth`, `lib/me/identity.ts`'s `resolveMe`) — the same wrapper
    > `/api/me/role-tonight` and `/api/me/link` run on, not a fourth class and not a second copy of the rules.
    >
    > - `context.me.player === null` is a **403 with a sentence**, the way `/api/me/role-tonight` answers
    >   `ROLE_TAP_NOT_LINKED`: a new constant in `lib/me/copy.ts` beside it, `START_LOBBY_NOT_LINKED` =
    >   `Pick yourself out of the list first, then you can start a lobby.` The page cannot produce this request
    >   (the control is drawn for linked viewers only), so it is the forged-post answer and the honest one; it is
    >   never a 500 and never the raw envelope of a gate that assumed a player row.
    > - The presser is still the **session**, never the body: `pressedByPlayerId: context.me.player.playerId`.
    >   The body still decides nothing and keeps its one `redirectTo` field.
    > - **Admins need no branch.** `authorizeAdmin` can only return true for a session whose Discord id matched a
    >   `players` row, so every admin is a linked player and passes the new gate on the same line everyone else
    >   does. `me.player.isAdmin` is read by nothing in this handler.
    > - **The old path is deleted, not aliased.** M4.2's brief fixed "one route, both surfaces"; two paths for one
    >   command is the second copy that drifts. `/admin`'s `AdminForm action` moves to the new path, and the two
    >   things that name the old file follow it: `lib/admin/notices.ts`'s schema import and `notices.test.ts`'s
    >   source-path assertion (`handler('lobbies/start/handler.ts')`).
    > - The rules and every string the route answers with move with it, out of `lib/admin/lobbyStart.ts` — the
    >   2026-09-10 decision row called this "an auth swap and a moved file" in advance and this is the file. Where
    >   they land is the engineer's (`lib/lobbyStart.ts` is what that row named); that both surfaces import one
    >   copy of them is not.
    >
    > **The rule, page side.** In `TonightView` the gate becomes the `linked` boolean the file already computes for
    > M4.10's lobby line, not `seatViewer.isAdmin`. `StartLobby.tsx` keeps its shape; its `START_ACTION` and its
    > schema import follow the route. **Being drawn is still not permission** — the route resolves the session
    > again with the service-role client before it writes, and a forged press gets the 403.
    >
    > **One string the page owns, not the route.** A session that expired between the render and the press gets a
    > 401 whose body says `sign in required`, which is gate vocabulary and not a sentence for a friend on a phone.
    > On a 401 the control prints `Sign in with Discord to start a lobby.` — the same string as the signed-out
    > state, because it is the same fact — instead of the route's words. Every other refusal still prints the
    > route's own words, as it does today.
    >
    > ### Edge cases
    >
    > - **Fewer than ten, more than ten, someone leaves mid-lobby.** Untouched. M4.2 owns all three and this task
    >   changes who may press, not what the press does.
    > - **The host's companion disconnects between the press and the poll.** Untouched: the command expires at 60 s
    >   and the page says `Nobody's client answered. Try again.` The presser being a non-admin changes nothing —
    >   the failure sentence was never about them.
    > - **An unknown player in the around set** is invited on their puuid and renders as `Someone`, exactly as
    >   today (M3.10). **A presser with no name of their own** is equally fine: the press never prints the
    >   presser's name, only the host's.
    > - **A linked player who is not in tonight's lobby, and whose own companion is not running**, may still press.
    >   That is deliberate and already M4.2's rule: the host pick prefers the presser when they qualify and picks
    >   the most recently seen companion otherwise. Somebody on a phone in the car opening the lobby for the eight
    >   already in voice is the scene, not an abuse of it.
    > - **Two non-admins tap at the same moment.** One lobby, one `create_lobby` row, and the second tap gets
    >   `A lobby is already being opened.` — M4.9's partial unique index, unchanged and untouched by the auth swap.
    > - **An admin undoes somebody's link while their page is open.** Their next press is the 403 not-linked
    >   sentence rather than a crash or a silent no-op; the button is gone on their next render.
    > - **A session with no Discord identity** is a 403 from the shared gate (`this session has no Discord
    >   identity`), decided in `lib/me/identity.ts` and not in this handler, and the page has already treated that
    >   viewer as anonymous since M3.6.
    > - **Somebody forwards the WhatsApp link to a stranger who signs in with Discord.** They match no player row,
    >   so they get the 403 and no button — the widening is to *linked players*, which is the twenty people who
    >   have picked themselves out of a lobby, and never to "anyone with a Discord account".
    >
    > ### Acceptance check
    >
    > Integration tests for the route (move M4.2's existing suite onto the new path rather than rewriting it),
    > component tests for the control, and no live check — that one stays on M4.2.
    >
    > 1. **Anonymous:** `POST /api/me/lobbies/start` with no session → 401, and **zero** rows written anywhere.
    > 2. **Signed in, no player row:** → 403 whose body is `START_LOBBY_NOT_LINKED` byte for byte, zero rows
    >    written, and not a 500 — asserted through an injected `authorize` whose `me.player` is `null`, the same
    >    way `/api/me/role-tonight` asserts `ROLE_TAP_NOT_LINKED`.
    > 3. **Signed-in linked non-admin:** → 200, exactly one `create_lobby` row for the chosen host, and the row's
    >    presser is their player id, not the host's and not an admin's.
    > 4. **Admin:** → the same 200 on both surfaces. `/admin`'s form post still lands (new action path) and
    >    `adminNotice('lobby-start', …)` still prints `Opening a lobby on <Name>'s PC…`.
    > 5. **The old path is gone:** no `app/api/admin/lobbies/start` directory, no reference to
    >    `/api/admin/lobbies/start` anywhere in `apps/web` outside `.next`, and a POST to it 404s.
    > 6. **The four refusals are byte for byte what they are today** on the new path — already open, nobody's
    >    companion up, a create still pending, the kind flagged off — and M4.9's unique violation still maps to
    >    `A lobby is already being opened.`
    > 7. **The control's rendering condition:** a component test renders the tonight page in `idle` for four
    >    viewers — anonymous, unlinked, linked non-admin, linked admin — and gets: sentence plus sign-in button,
    >    nothing, the button, the button. The same four in `filling` get: nothing, nothing, the readout, the
    >    readout.
    > 8. **A 401 answer prints the page's sentence**, `Sign in with Discord to start a lobby.`, and never
    >    `sign in required`.
    > 9. `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint` and `pnpm --filter web build` pass.
    > 10. **Docs, in the landing session:** `00-product.md`'s `Start a lobby` bullet drops "admins for now" and its
    >     closing "Today only an admin sees the button …" sentence; `05-design.md`'s `Copy — Start a lobby` table
    >     un-suspends the anonymous row and gains a row for `START_LOBBY_NOT_LINKED`; `04-decisions.md` gets a row
    >     only if the behaviour differs from this brief (the two rows this brief itself rests on are already
    >     written, 2026-09-15).
    >
    > ### Out of scope
    >
    > Who hosts, the generated name and password, the around set, the invite fan-out, the refusal rules — every
    > one of them is M4.2's and none of them moves. The live check (stays on M4.2, which is why this task does not
    > tick it). M4.11's side line. Any new way to link an account: linking still needs a live lobby to pick
    > yourself out of, and inventing an idle-page picker here would be a second linking flow M3.6 would have to
    > unpick. Rate limiting or a per-player press budget — the pending-create lock and the ten-minute companion
    > window already bound this, and twenty friends are not a threat model. A sign-in control anywhere else on the
    > site, and any change to the `/admin` dashboard beyond the one form action.

    > **Correction to M4.3 (product, 2026-09-08, after M0.3).** "Verify the endpoint in M0 first" did not happen and
    > cannot: M0's tooling is read-only and a switch-side path can only be confirmed by POSTing to a live
    > client. The verification moves into this task, as `03-lcu-reference.md` question 5 already says. First
    > step, before any queue work: with a custom lobby open, `POST /lol-lobby/v1/lobby/custom/switch-teams`
    > with an empty body, then the v2 path if v1 404s, and watch `gameConfig.customTeam100`/`customTeam200`
    > in the lobby event to see whether the local player moved. Then fill the target side with bots and retry
    > to learn what a full side does. Write the answer into the reference and flip its status.
    >
    > The escape hatch stands: if no path works, drop the task and the teams embed says which side to move
    > to. Moving yourself in a lobby is one click, and this milestone's acceptance ("everyone on the right
    > side") is met by people clicking it. Do not invent a champion-select or in-game path to get around a
    > 404 — that is the line in `CLAUDE.md`.

    > **Brief for M4.3 (product, 2026-09-09)**
    >
    > **The scene.** The teams post in Discord. Ten friends alt-tab back to the client and they are already on the
    > sides the bot gave them. That is the whole feature. The version of it that ships if the client will not
    > cooperate is one sentence on the screen, and it costs each person one click — which is what they do today.
    > Either way M4's acceptance line ("everyone on the right side") is met; only the number of clicks changes.
    >
    > **Where it lives.** `apps/web/lib/commands.ts` (the queue writer and the flag), hung off the existing
    > `onBalanced` hook in `apps/web/lib/ingest/hooks.ts` — the same seam Discord posts from — plus the reroll
    > path (M3.2). The embed line goes in the teams embed builder, the page line in M3.4's teams state. The
    > companion side is entirely M4.1's `switch_side` executor; this task adds no client call of its own.
    >
    > ### The verification gate
    >
    > `switch_side` runs only when **both** are true: the switch-side row in `03-lcu-reference.md` is `verified`
    > for the running patch, and `SWITCH_SIDE_ENABLED` in `apps/web/lib/commands.ts` is on. One constant, read by
    > the queue writer **and** by the copy below, so the embed and the queue can never say different things. The
    > companion keeps its own per-kind flag from M4.1: a stale exe must never be the thing that POSTs an
    > unverified path.
    >
    > The verification itself is M4.1's `verify-commands` probe 3, run by a person against a live client. Its
    > answer decides this task, and there are three:
    >
    > - **A path toggles the local player.** Write the working path, whether the empty body is required, and the
    >   full-side answer into the reference row and question 5, flip both flags on, and the queue below ships.
    > - **Neither path works, or it only works from a state we do not enter.** The task is dropped, the flag stays
    >   off, the fallback copy is what ships, and the status table says "dropped: no switch-side path on 16.17"
    >   with the date. **Do not look for another way in.** A champion-select or in-game path is the line in
    >   `CLAUDE.md` and no amount of convenience buys it.
    > - **It works but a full target side refuses.** Expected, and handled below — the endpoint is a toggle, so
    >   two people trading sides cannot both go first.
    >
    > ### What gets queued, and when
    >
    > On the `balanced` transition, and again on a reroll promotion (M3.2), for each of the chosen ten who:
    >
    > - **a.** has an unrevoked companion token seen in the last **10 minutes** (`last_seen_at` means their client
    >   is up, from M4.1), **and**
    > - **b.** has a `lobby_members.side` that differs from the side the chosen split gives them, **and**
    > - **c.** has a `side` that is not null.
    >
    > Clause (c) is the one that is easy to miss: a friend in the spectator slot who is in the chosen ten has
    > `side: null`, and a toggle cannot seat a spectator on a team. They are never queued and the line below is
    > what tells them to move. Nobody outside the chosen ten is ever queued — a sitter is not moved by us.
    >
    > **On a reroll, the previous cycle's pending `switch_side` rows are marked `failed` with
    > `error = 'superseded'` in the same write that queues the new ones**, so nobody is dragged to a side from the
    > split the group just rerolled away from. At most one pending `switch_side` per player per lobby at any time.
    >
    > **The bounce.** Both sides cap at five and the endpoint only toggles, so when two people are trading places
    > one of them finds the target side full. Each executor re-reads the lobby immediately before acting and nacks
    > `side_full` rather than POSTing (M4.1). Whoever's seat clears first succeeds; anyone left over is covered by
    > the line. We do not sequence the queue to choreograph a swap — a two-step dance across two machines with a
    > five-second poll is more ways to be wrong than the click it replaces.
    >
    > **Why this is safe against a rebalance.** A side change is not part of the roster's identity (M2.5), so a
    > companion's lobby post after a switch updates `lobby_members.side` without touching `lobbies.updated_at` and
    > without restarting the ten-second clock. Switching sides can never cause a rebalance. That property is load
    > bearing for this task; if it ever changes, this task breaks first.
    >
    > ### The copy, and when each line appears
    >
    > The teams embed is posted **at the moment of balancing**, before any companion has polled, so the embed can
    > never truthfully say "everyone is on their side". It says what will happen:
    >
    > - Flag **off** (or dropped): `Move to your side in the lobby.`
    > - Flag **on**: `You'll be moved to your side — if not, move yourself.`
    >
    > One line, in the `Seats` block that M3.13 already put above the team cards; the designer places it and does
    > not have to invent the words. It is never per-person: naming who is on the wrong side is stale the second
    > somebody moves, and on a phone it is four extra lines nobody reads.
    >
    > The tonight page is live and can be accurate, so it shows `Move to your side in the lobby.` **while any of
    > the chosen ten is on a side that is not theirs**, and nothing once all ten match. It disappears by itself,
    > which is the only way a nagging line is allowed to exist.
    >
    > ### Edge cases
    >
    > - **Fewer than ten around.** No balance, so nothing to queue.
    > - **More than ten.** Only the chosen ten; a sitter is never moved, and a spectator who is playing is told to
    >   move rather than dragged.
    > - **Someone leaves mid-lobby.** The lobby goes back to `open`; the pending rows are superseded by the next
    >   balance. One already in flight may still fire and move somebody in a lobby that is rebalancing — harmless,
    >   because the next balance assigns sides again and the line is on the screen either way.
    > - **Companion disconnects.** It is handed nothing while `clientConnected=false` (M4.1); the command expires
    >   after three minutes; the person moves themselves. No nack, no noise.
    > - **Unknown player.** No token, no command, covered by the line like anyone else without a companion.
    > - **Everyone is already on the right side.** Zero rows queued, and the embed still carries its line. Correct:
    >   the embed cannot know, and "move to your side" read by somebody already on their side costs nothing.
    >
    > ### Acceptance check
    >
    > 1. Flag off: a `balanced` transition writes **zero** `switch_side` rows, the embed carries
    >    `Move to your side in the lobby.`, and the tonight page carries the same sentence.
    > 2. Flag on: rows are queued for exactly the chosen ten whose stored side differs and whose token was seen in
    >    the last 10 minutes; a player with `side: null` is never queued; a sitter is never queued; a player whose
    >    token was last seen 11 minutes ago is never queued.
    > 3. Each queued row carries `targetSide` equal to the side that player has in the **chosen** split, and
    >    `expires_at` three minutes out.
    > 4. A reroll marks the earlier rows `failed` with `superseded` before queuing the new set; at no point does a
    >    player hold two pending `switch_side` rows.
    > 5. Companion: already on the target side → acked `done` with zero client POSTs; target side holding five →
    >    `side_full` with zero client POSTs; spectator → `not_on_a_team`.
    > 6. After a successful switch, the next lobby post updates `lobby_members.side`, `lobbies.updated_at` does
    >    **not** move, and the lobby is still `balanced` — the regression check for the property above.
    > 7. The tonight page's line is present while one of the ten is mismatched and gone when all ten match, driven
    >    by the Realtime `lobby_members` events with no refetch and no re-render of the team cards.
    > 8. Flag on with the embed: the message says `You'll be moved to your side — if not, move yourself.` and the
    >    message is never edited afterwards (M3.1's rule stands).
    > 9. `pnpm -r typecheck` and `pnpm -r test` pass. If the endpoint did not verify, checks 2 to 6 are skipped
    >    with the reason in the status table and 1, 7 and 9 still pass.
    >
    > ### Out of scope
    >
    > Everything about the lobby existing (M4.2). Voice (M4.4, M4.5). Any attempt to move a spectator onto a team,
    > or to swap two players by orchestrating two commands. Champion select, in any form, for any reason.

- [-] **M4.4** **Dropped by the user, 2026-09-10** ("not interested in auto separating players into channels"). Nothing built; the bot app stays a placeholder. `apps/discord` bot: Realtime subscription; on `balanced` move linked members into blue and red voice; on `finished` move everyone back. Handles missing permissions gracefully with a log line, never a crash.
- [ ] **M4.5** (**deferred 2026-09-10**: with M4.4 dropped, the bot would exist for this alone; queued only if the user asks for the "N around" post) Presence: when lobby voice membership changes and no lobby is open, post or edit a single "N around: names" message. Count feeds the sit-out logic as "around".
- [-] **M4.6** **Dropped with M4.4, 2026-09-10**: no bot to deploy. Deploy the bot to Fly.io or Railway with a health check and auto-restart.

- [x] **M4.7** (both halves landed 2026-09-11: (a) the `Start a lobby` control, (b) the side line under the team cards in `balanced` and as the last line of the teams embed's `Seats` field, one definition for both surfaces; the vanish-when-matched rule is M4.11) (half (a), the `Start a lobby` control, landed 2026-09-11 per the designer's section: idle only, above the rack, quiet while opening, admin-gated until the press widens; half (b) the side line on the team cards is unbuilt) (half (a) landed 2026-09-10, built to the designer's own section in `05-design.md`: **not a card** but a stack of lines — the button in `idle` only and **above** the rack, directly under the strip's sentence; in `filling` the same block with no button, a readout under the rack carrying the invited line or a failed create's sentence; the button goes quiet with `aria-disabled` and `.cn-button-quiet` while the command is live and never takes the `disabled` attribute; a progress line is `text` 400 `role="status"`, a refusal is 600 `role="alert"`. Half (b), the side line, is untouched and this row stays open for it) Designer: the two M4 surfaces that have copy and no layout. (a) The `Start a lobby` control on the tonight page — where it sits in the **idle** and **filling** states of `05-design.md`'s state table, and how the four refusal sentences and the pending line (`Opening a lobby on <Name>'s PC…`) are shown without a toast. (b) The side line — `Move to your side in the lobby.` / `You'll be moved to your side — if not, move yourself.` — in the teams embed's `Seats` block (field order fixed by M3.13) and under the team cards on the page. The words are product's and are fixed in the M4.2 and M4.3 briefs; the placement is the designer's. **Half (b) page line landed 2026-09-11** (one line under both cards in `balanced`, gate-dependent sentence); the embed line is landing; the vanish-when-matched rule is M4.11.

    > **Acceptance check.** `05-design.md` shows both controls in the state table and in the embed layout, with the exact strings, and says what the page shows while a `create_lobby` is pending. No new component vocabulary and no second copy of a sentence: if the doc and the brief disagree by a character, the doc is wrong.


    > **The one ruling that is neither product's nor the designer's** (the lead, 2026-09-10, in `04-decisions.md`): the line renders **only for a signed-in viewer matched to a `players` row**, and is absent — not hidden — for everybody else. Product asked for every viewer, the designer for none. The password is not a secret among the twenty people who play, but the tonight page's link gets forwarded, and a page that hands a lobby password to whoever opens it invites a stranger into the game.
    >
    > The name and the password are **mono**, the one exception to "numbers inside a sentence are Archivo": they are tokens a person transcribes into another window, and the password carries `user-select: all` so one tap on a phone selects all four digits. `lobbies.lobby_name` and `lobbies.lobby_password` ride along on the tonight snapshot's existing lobby read — one query, three facts — and both are publicly readable already.

- [x] **M4.8** (landed 2026-09-15, five days late: `00-product.md`'s section is now "The three things a person can change" with a `Start a lobby` bullet first — the host pick, the generated name and password, the invite fan-out, no fields, one lobby for two simultaneous taps — carrying the two ways today's build differs from this brief, namely that the control is **admin-only** until M4.2's widening lands and that nobody has pressed it on a real night yet; the nightly loop's step 2 now opens with the tap and keeps the by-hand lobby as an equal path. **No decision row added**: both differences were already decided and recorded on 2026-09-10 — the route is `POST /api/admin/lobbies/start` on the admin class (row "M4.2's press is `POST /api/admin/lobbies/start`…") and the control is drawn for admins only (row "The `Start a lobby` control is drawn **for an admin only**…"), so 04-decisions.md was already true and appending a third row would restate them. The widening itself is unblocked — M3.6's third route class landed 2026-09-10 — and is proposed as M4.13) Product: when M4.2 lands, `00-product.md` gains `Start a lobby` as the third thing a person can change (it is a human action the milestone acceptance already accepts, and the section currently says there are two), and the nightly loop's step 2 stops saying "someone opens a custom lobby" as if by hand. Same session as M4.2, with a row in `04-decisions.md` only if the behaviour differs from the brief.

Acceptance: from an empty Discord voice channel to a balanced lobby with everyone on the right side and in the right voice channel, with the only human actions being "join voice", "click Start a lobby", and "accept invite".

## M5 Backfill, windows, stats (2 to 3 days, needs M3; skip backfill if M0.4 said no)

- [x] **M5.1** (both halves landed 2026-09-09; acceptance check 11, the live walk against a real client, is the user's) Backfill: on companion start and daily, walk the local player's match history, filter `CUSTOM_GAME`, fetch details for unknown game IDs, POST as `source: backfill`. Server verifies the reporting player is a participant.

    > **Note (product, 2026-09-08, after M0.3).** M0.4 is resolved yes — customs are in match history (17 of
    > 21 games in the 16.17 capture, queue 3100/3110/3270). Three facts from that capture pin this task down.
    >
    > 1. **The detail fetch is mandatory, not an optimisation.** The list endpoint returns `participants` and
    >    `participantIdentities` of **length 1** even for a completed 5v5 — only the local player. `teams[]`
    >    is complete, so the list can tell you a game happened and who won, but never who played. One
    >    `GET /lol-match-history/v1/games/{gameId}` per unknown custom game is the only way to the ten
    >    rosters. Budget for it: a first run on a fresh install is one request per custom in the window, so
    >    rate-limit and run it in the background, never on the path of a lobby post.
    > 2. **Stat keys differ from the eog block.** Match detail is camelCase
    >    (`kills`, `deaths`, `goldEarned`, `totalMinionsKilled`) and `teams[].win` is the string
    >    `"Win"`/`"Fail"`; the eog block is uppercase (`CHAMPIONS_KILLED`) with `WIN` as `0 | 1`. Backfill
    >    needs its own mapper into the same payload, not a reuse of M2.10's eog mapper.
    > 3. **Aborted games look like real ones in the list.** `endOfGameResult: "Abort_TooFewPlayers"` came back
    >    with one participant and one team. Drop anything that is not `GameComplete` with ten participants;
    >    the M2.5 rating gate catches the rest.
    >
    > How far back the window reaches is unknown — **M5.6**. Until that is answered, the honest claim is
    > "every custom still in the history of someone who runs the companion", which is what
    > `00-product.md` now says.

    > **Brief (product, 2026-09-09)**
    >
    > **Sequencing: this task is pulled forward.** It runs **right after M3.4 and M3.5**, before the first real
    > night, and M5.2 runs with it. The reason is the group's, not the plan's: the customs in everybody's match
    > history are the only evidence the ratings have, and a leaderboard that opens empty on night one is a month
    > of nightly games away from meaning anything. Backfill first, then a rebuild, and the first night starts on
    > real numbers instead of rank seeds. It keeps the id M5.1; the M5 row in the status table says
    > "M5.1 and M5.2 pulled forward, ahead of M4". Nothing in it depends on M4, and M4 does not wait for it.
    >
    > **The scene.** A friend approves it once on the admin page. Nothing else happens that anyone can see. The
    > next time they open the tonight page, the leaderboard has the last three weeks of customs in it, with the
    > right people on the right sides and the right ratings, and nobody typed a score.
    >
    > **Where it lives.** `apps/companion/src/backfill.ts` (the walker, its cache and its throttle) with a
    > `backfill.ts` mapper beside the eog mapper in `packages/lcu`; `apps/web/app/api/companion/backfill/scan/route.ts`
    > (the "what do you already have" call) reusing the existing `POST /api/companion/game` for the games
    > themselves; `apps/web/lib/ingest/game.ts` unchanged except for the two rules below; a `Backfill` column on
    > `/admin/players`. One migration (next unused number) adds two columns to `players`. Both match-history
    > endpoints are already `verified` on 16.17 — the list and the detail — so nothing here waits on a client
    > verification pass.
    >
    > ### The two facts this is built on
    >
    > Both from the 16.17 capture and already in the M4-era note above: **the list carries only the local player**,
    > so one `GET /lol-match-history/v1/games/{gameId}` per unknown custom is the only road to the ten rosters;
    > and **match detail is camelCase with `teams[].win` as `"Win"`/`"Fail"`**, so backfill needs its own mapper
    > into the same payload rather than a reuse of M2.10's eog mapper.
    >
    > ### The payload
    >
    > The existing `phase: 'eog'` body from `@customs/db/schemas`, with `source: 'backfill'`. Field by field, from
    > `match-detail`:
    >
    > | field | from the detail | rule |
    > |---|---|---|
    > | `gameId` | `gameId` | The dedupe key, same as an eog block. |
    > | `startedAt` | `gameCreation` (epoch ms) | ISO 8601 with an offset. No arithmetic: the detail has a real start time, unlike the eog block. |
    > | `durationS` | `gameDuration` (seconds) | |
    > | `winningSide` | `teams[]` where `win === 'Win'` | No winner, or both, → the game is dropped locally and never posted. |
    > | `gameType` | `gameType` | Only `CUSTOM_GAME` is a candidate at all. |
    > | `partyId` | — | **Absent.** A backfilled game belongs to no lobby; `games.lobby_id` stays null and M2.5 already rates such games. |
    > | `participants[].puuid` | `participantIdentities[].player.puuid`, joined on `participantId` | The identity, as everywhere. |
    > | `participants[].gameName` / `tagLine` | `participantIdentities[].player.gameName` / `tagLine` | Backfill is where a friend the database has never met gets a name. |
    > | `participants[].side` | `participants[].teamId` | 100 or 200. |
    > | `participants[].role` | — | **Null.** The detail has no `detectedTeamPosition`; `timeline.lane`/`role` is a different vocabulary and nothing verified maps it. Role is display-only and rating does not read it. M5.4 may revisit with a fixture. |
    > | stats | `participants[].stats`, camelCase | `kills`, `deaths`, `assists`, `goldEarned`, `totalDamageDealtToChampions`, `cs = totalMinionsKilled + neutralMinionsKilled`. A missing key is 0, as in the eog mapper. |
    > | `raw` | the whole detail body | Scrubbed on the way in and again in ingest. The detail carries no chat credentials, but `scrubRawEogBlock` is idempotent and `games.raw` is public-read; this is not the place to make an exception. |
    > | `source` | — | `'backfill'`. |
    >
    > `season_id` keeps its default (the active season). A custom from before the season began still lands in the
    > season that is running, which with one season is exactly right and with several is M5.3's problem — say so
    > in a comment rather than inventing season attribution here.
    >
    > ### What counts as a duplicate
    >
    > - **The same `lcu_game_id` already in `games`, from any source.** The insert is the existing
    >   `onConflict: 'lcu_game_id', ignoreDuplicates: true`: the response says `created: false` and **not one
    >   column of the stored row changes** — not `raw`, not `started_at`, not `source`, not a `game_players` row.
    >   A game we captured live is the better record and backfill never overwrites it.
    > - **The same game backfilled by two friends.** Same rule, no coordination, exactly as two companions in one
    >   end of game already work.
    > - **Locally,** `<configDir>/backfill.json`: `{ version: 1, lastRunAt, deepestBegIndex, knownGameIds: number[] }`
    >   capped at 2000 ids, tmp-file-and-rename like the eog queue. It exists to save **detail fetches**, which are
    >   the expensive part; deleting it must cost bandwidth and nothing else, and check 4 pins that.
    > - **No disk queue for backfill posts.** A failed post is simply retried on the next pass, because unlike an
    >   end-of-game block the source is still on the client tomorrow.
    >
    > ### The scan call
    >
    > `POST /api/companion/backfill/scan`, companion token, body `{ gameIds: number[] }` (at most 100), answering
    > `{ approved: boolean, unknown: number[] }`. One round trip tells the companion whether it may act at all and
    > which ids are worth a detail fetch. When `approved` is false the answer's `unknown` is always `[]`, the
    > route sets `players.backfill_requested_at` if it is null (once — a second scan does not move it), and the
    > companion logs one sentence and stops:
    > `Backfill is waiting for an admin to approve it. Nothing was sent.`
    >
    > ### Approval, and why it exists
    >
    > `01-architecture.md` makes backfill the exception to "a companion may only report what it was in", and it is
    > admin-approved the first time per player. The migration adds to `players`:
    >
    > ```sql
    > alter table public.players
    >   add column backfill_requested_at timestamptz,
    >   add column backfill_approved_at  timestamptz;
    > ```
    >
    > The reason to say out loud, because "security" on its own sounds like paperwork: an end-of-game post is one
    > game the server can see a lobby for; a backfill batch is dozens of games from nowhere, and one bad or
    > mis-mapped batch moves every rating in the group. One person looking at it once, before the first batch, is
    > cheap. After that the flag stays on and the daily pass is silent forever.
    >
    > **`/admin/players` gets a `Backfill` column** with three states — `off`, `asked <date>`, `on since <date>` —
    > and one control per row, `Allow` / `Revoke`. Copy under the page heading:
    > `Backfill lets a player's companion send past customs from their client's match history. Turn it on once
    > you know whose PC it is.` Revoking sets the column back to null and the next scan answers `approved: false`.
    >
    > **The participant check has no lobby fallback for backfill.** M2.8 lets a poster who was in the lobby report
    > a game they are not on the scoreboard of, because the friend sitting out is often the one running the
    > companion. For `source: 'backfill'` that half does not apply: the token's player must be among the posted
    > participants or it is a 403 and nothing is written.
    >
    > ### Not rated on arrival
    >
    > **A backfilled game is stored and not rated inline.** Ratings are a fold in `started_at` order and backfill
    > delivers games out of order by definition, so rating them as they land would produce numbers that the first
    > rebuild throws away. The game route rates inline only for `source: 'eog'`; a backfill insert leaves the four
    > `game_players` rating columns null, moves no `ratings` row, and answers
    > `{ rated: false, reason: 'backfill' }`. **`pnpm --filter web rebuild-ratings` (M5.2) is what turns a batch
    > into ratings**, which is why the two tasks ship together and why the admin page says, next to a player who
    > has just been approved: `Backfilled games are not rated until the ratings are rebuilt.`
    >
    > ### The walk, and the rate limit against the client
    >
    > The client is somebody's game machine, not a server. The walker is background work and is never on the path
    > of a lobby post.
    >
    > - **When.** 60 seconds after the first connect (so the eog queue and the identity check go first), then
    >   every 6 hours. A pass that hits its cap with unknown ids left schedules another in 10 minutes.
    > - **Only while the client is idle.** Phase must be `None` or `Lobby`. Anything else pauses the pass where it
    >   stands; it resumes on the next tick. Nothing is fetched during champion select or a game.
    > - **List pages:** `begIndex` in steps of 20, at most **5 pages per pass**. Stop early on an empty page, an
    >   error, or a page whose custom ids are all already known. The first pass on a fresh install walks to a cap
    >   of **200 games**; how much history actually exists is unknown and is **M5.6**'s job, not this task's — the
    >   walker must treat "the page came back short or empty" as the end and log the deepest `begIndex` it reached
    >   so M5.6 has evidence.
    > - **Detail fetches:** at most **20 per pass**, at least **2000 ms apart**, one at a time.
    > - **Drops, each with one log line naming the game id:** anything that is not `CUSTOM_GAME`; anything whose
    >   `endOfGameResult` is not `GameComplete`; any detail with fewer than ten participants or without a winning
    >   team; any detail that fails the schema.
    >
    > ### Edge cases
    >
    > - **Fewer than ten in an old custom.** Dropped locally with a log line. It would have been stored and not
    >   rated anyway (M2.5's gate); not posting it keeps `games` free of rows nobody will ever look at.
    > - **More than ten.** A detail with eleven participants fails the mapper's contract and is dropped, logged
    >   once. It has never been seen; it is a shape check, not a case.
    > - **Someone left mid-lobby / mid-game, months ago.** Irrelevant here: the detail is the record and a leaver
    >   is a participant like anyone else.
    > - **Companion disconnects mid-pass.** The pass stops. Ids already posted are in the local cache and in the
    >   database; the next pass picks up the rest. Nothing is written to disk except the cache.
    > - **Unknown player.** The commonest good outcome: backfill is where a friend who has never been in a lobby
    >   with a companion running gets a `players` row **and** a name, straight from `participantIdentities`.
    > - **Two friends both approved.** Both walk their own history, both post the same nights, and the second one
    >   creates nothing. Their histories overlap and that is the point: between them they cover games neither has
    >   alone.
    > - **A game already stored from an eog block.** `created: false`, nothing changes. Its rating columns are
    >   already filled and the rebuild will recompute them anyway.
    > - **The API is down.** The pass fails, logs one line, and tries again on the next tick. No queue, no files.
    >
    > ### Acceptance check
    >
    > Fixture-driven against `packages/lcu/fixtures/16.17/` with a stubbed client and stubbed API, except 11.
    >
    > 1. Walking `match-history--list.json` yields one candidate per `CUSTOM_GAME` entry and none for anything
    >    else; the `Abort_TooFewPlayers` entry is dropped with one log line naming its id.
    > 2. The mapper turns `match-detail.json` into a payload with ten participants, `side` from `teamId`,
    >    `winningSide` from `teams[].win === 'Win'`, `durationS` from `gameDuration`, `startedAt` from
    >    `gameCreation`, camelCase stats mapped as in the table, `role: null` on all ten, `source: 'backfill'`, no
    >    `partyId`, and names on every participant. Pinned field by field in
    >    `packages/db/src/schemas/companion.contract.test.ts`, beside the eog rules.
    > 3. Unapproved: the scan answers `{ approved: false, unknown: [] }`, sets `backfill_requested_at` once (a
    >    second scan does not move it), the companion posts **nothing**, and the log has exactly one sentence.
    > 4. Approved: exactly one POST per unknown custom game. A second pass posts nothing and makes **zero** detail
    >    fetches. Delete `backfill.json` and run again: the details are re-fetched, every POST answers
    >    `created: false`, and no row in `games` or `game_players` changes.
    > 5. A game already stored from an eog block: after a backfill post of the same id, `source` is still `'eog'`,
    >    `raw`, `started_at` and all ten `game_players` rows are byte-identical to before.
    > 6. A backfill POST whose participants do not include the token's player is **403** and writes nothing —
    >    including when that player is a `lobby_members` row of a live lobby (the M2.8 fallback must not apply).
    > 7. Not rated inline: a backfilled game has ten `game_players` rows with four null rating columns, no
    >    `ratings` row moved, and the response says `{ rated: false, reason: 'backfill' }`.
    > 8. Rate limit: with 40 unknown ids, one pass makes at most 20 detail requests, each at least 2000 ms after
    >    the last, at most 5 list requests, and **zero** requests while the stubbed phase is `InProgress`,
    >    `ChampSelect` or `EndOfGame`.
    > 9. `/admin/players` shows `off` / `asked <date>` / `on since <date>`; `Allow` flips it to on with the date;
    >    `Revoke` sets it back to null and the next scan answers `approved: false`.
    > 10. `pnpm -r typecheck` and `pnpm -r test` pass; the migration applies on `pnpm db:reset`; `pnpm db:types` is
    >     regenerated.
    > 11. **Live, on a real client (the user).** Approve one player, run the companion, wait one pass: their past
    >     customs appear once each with `source: 'backfill'` and null rating columns; the deepest `begIndex`
    >     reached is in the log for M5.6; then `pnpm --filter web rebuild-ratings` (M5.2) and the leaderboard shows
    >     real numbers before anybody plays a game.
    >
    > ### Out of scope
    >
    > The rebuild itself (M5.2) — this task rates nothing. How deep history goes (M5.6). Seasons and attributing an
    > old game to an old season (M5.3). A page showing what backfill found (M5.5). Ranks: backfill posts games, not
    > ranks, and M2.4 already owns that sweep. Any use of the Riot public API, now or as a fallback: there is no
    > key in this project and there is not going to be one.

- [x] **M5.2** Rating rebuild: `pnpm --filter web rebuild-ratings` folds every game in `started_at` order from seeds. Run after any backfill batch. Idempotent.

    > **Brief (product, 2026-09-09)**
    >
    > **Sequencing: pulled forward with M5.1**, to right after M3.4/M3.5. A backfill batch that is never folded is
    > a table of games and no leaderboard, so these two are one piece of work in two commits.
    >
    > **The scene.** Nobody sees this run. It is the promise underneath every number on the board: the ratings are
    > a pure fold over games in the order they were played, and if that ever stops being true — a batch of old
    > customs arrives, a bug drops a game, the model changes — one command puts it back. `games.raw` is kept for
    > exactly this reason (`01-architecture.md`), and this is the command that spends it.
    >
    > **Where it lives.** `apps/web/scripts/rebuild-ratings.ts`, run as
    > `"rebuild-ratings": "node --env-file-if-exists=.env.local scripts/rebuild-ratings.ts"` in
    > `apps/web/package.json`, beside `mint-token`. **Add the line to `CLAUDE.md`'s command list in the same
    > commit** — the file says to. The fold itself is not written twice: extract the pure middle of
    > `apps/web/lib/ingest/rating.ts` — ten rows plus their before-ratings plus the winning side, in, after-ratings
    > out — into an exported function that both `rateStoredGame` and this script call. That shared function is
    > what makes "reproduces the incremental fold exactly" a fact about the code rather than a hope about two
    > copies of it.
    >
    > ### What it does
    >
    > 1. **Guard.** Refuse to start when any `lobbies` row is `open`, `balanced` or `in_game`, or when any `games`
    >    row was created in the last 15 minutes. Message:
    >    `A lobby is live. Run this when nobody is playing, or pass --force.` `--force` skips the guard and
    >    nothing else.
    > 2. **Snapshot.** Read every `games` row for the season with a non-null `winning_side`, ordered by
    >    `started_at` ascending, `lcu_game_id` ascending as the tie-break — the second key matters the moment
    >    backfill lands two games with the same `gameCreation`, and without it two runs could disagree. Read every
    >    `game_players` row for those games, and every `players` rank. Keep the id set and the run's start time.
    > 3. **Fold, in memory, from seeds.** Everyone starts at `seedFromRank(players.rank_tier, players.rank_division)`
    >    — no rank at all is `mu 20, sigma 10`, exactly as the live fold seeds. For each game in order, apply the
    >    same gate the live fold applies (ten rows, five a side, `duration_s > 300`) and, when it passes, sort each
    >    side by puuid ascending and call the shared function. Record the before and after for all ten and bump
    >    that player's games and wins.
    > 4. **Write once, at the end.** One batched pass: `game_players` rating columns for every game (set for a game
    >    that rated, **nulled** for a game that did not — a game that no longer qualifies must not keep stale
    >    numbers), then a `ratings` upsert per player with `mu`, `sigma`, `games`, `wins`. Nothing is written
    >    before the fold is complete, so a crash halfway leaves the old numbers standing rather than half of two
    >    folds.
    > 5. **Fence.** Re-read the game id set for the season. If it grew, or any game in the snapshot has changed its
    >    `winning_side` or participant count, print
    >    `New games landed while this was running. Run it again.` and exit **2**. The command is idempotent, so
    >    running it again is free — that is the whole reason this design needs no lock.
    > 6. **Report.** Always print: games considered, games rated, games skipped by reason, players written, and
    >    the largest single `mu` change. With `--dry-run`, print the same report, plus how many rows *would*
    >    change, and write nothing.
    >
    > ### No lock, and why
    >
    > There is no transaction to hold: the API writes through PostgREST with the service role, one statement at a
    > time, and a session advisory lock taken by a script does not stop it. The alternatives were a lock table
    > (a migration, and a lock nobody remembers to release after a crash) or a fold version column on every row
    > (a migration and a second code path forever). Instead: **a guard so it does not overlap in the first place,
    > an in-memory fold so `ratings` is untouched until the end, and a fence that detects the overlap and tells
    > you to run it again.** A concurrent end-of-game post during a rebuild cannot corrupt anything — it reads
    > pre-rebuild ratings, writes its own game's columns, and the rebuild's final pass overwrites both with the
    > ordered answer; if that game arrived after the snapshot, the fence catches it and the second run includes
    > it. The rebuild is the one writer allowed to overwrite the `mu_after is null` claim, and that is stated in a
    > comment on the write.
    >
    > ### One season
    >
    > `ratings` is keyed `(player_id, season_id)` and `games.season_id` is already set, so the fold is per season
    > and the script does one season per run: the active one by default, `--season <id>` for another. There is
    > exactly one season today; the loop exists so M5.3 does not have to rewrite this. **Season carry-over is not
    > this task**: the rebuild always folds a season from seeds, and when M5.3 makes a new season copy `mu`
    > forward, the seed for that season stops being the rank and the script gets its second input — that is M5.3's
    > change to make, and there is a comment on the seeding line saying so. A `ratings` row for a player with no
    > rated game in the season is reported and left alone; `--prune` deletes it. Deleting rows nobody asked to
    > delete is not a default.
    >
    > ### The one honest caveat
    >
    > The rebuild seeds from the player's **current** rank, because that is what `seedFromRank` is given. If
    > somebody's rank in `players` changed after their first rated game, the rebuild starts them from the new
    > seed and their whole history moves a little. That is not a bug in the fold — it is the best estimate the
    > database currently holds — but it means "reproduces the incremental fold exactly" is true only while ranks
    > have not moved in between, and the acceptance check below controls for it. If the group ever cares, the fix
    > is to store the seed the first fold used; that is **M5.7**, not this task.
    >
    > ### Edge cases
    >
    > - **No games at all.** Report says zero, `ratings` is left untouched (with `--prune`, emptied), exit 0.
    > - **A game with nine participants, or six-and-four, or exactly 300 seconds.** Skipped by the gate, counted in
    >   the report, and its four rating columns are nulled.
    > - **A game with a duplicate puuid on the scoreboard.** Skipped and named loudly: it is a data bug, and the
    >   fold must not average somebody against themselves.
    > - **A backfilled game older than every rated game.** Folds first and everyone's history shifts. That is the
    >   point of M5.1 and the reason these two ship together.
    > - **A player who has left the group.** Their `ratings` row is rebuilt from their games like anyone else.
    >   Nothing here knows about leaving.
    > - **The script is run twice at once.** The second run's fence trips on the first run's writes... it does not,
    >   because the id set did not change. Two simultaneous runs produce the same numbers, which is the definition
    >   of idempotent; nothing prevents it and nothing needs to.
    >
    > ### Acceptance check
    >
    > Integration tests against the local stack, seeded through the same ingest path the companion uses.
    >
    > 1. **Two runs are identical.** Run the script twice; a canonical dump of every `game_players` rating column
    >    and every `ratings` row (ordered, serialised) is byte-identical after each.
    > 2. **It reproduces the incremental fold.** Post ten games in `started_at` order through
    >    `POST /api/companion/game`, letting the live fold rate each one, then run the rebuild: every
    >    `mu_before`, `sigma_before`, `mu_after`, `sigma_after` on all 100 `game_players` rows is unchanged, and
    >    every `ratings` row's `mu`, `sigma`, `games`, `wins` is unchanged. No rank moves during the test.
    > 3. **Out of order equals in order.** Insert the same ten games in a shuffled arrival order (as backfill
    >    would), rebuild, and the dump equals the dump from check 2 exactly.
    > 4. **The tie-break.** Two games sharing a `started_at` to the millisecond produce the same result across ten
    >    shuffled insert orders.
    > 5. **The gate.** A 300-second game, a nine-participant game and a six-and-four game are skipped, counted in
    >    the report, and end with four null rating columns even when they had numbers before the run.
    > 6. **`--dry-run`** writes nothing: the dump before and after is identical, and the report still names the
    >    number of rows that would change.
    > 7. **The guard** refuses with the sentence above while a lobby is `balanced`; `--force` runs anyway.
    > 8. **The fence.** Insert a game after the snapshot is taken (a test hook between snapshot and write): the run
    >    exits 2 with `New games landed while this was running. Run it again.`, and a second run includes that
    >    game and exits 0.
    > 9. **Seasons.** With two seasons' worth of games, a run rebuilds only the active season's `ratings` and
    >    leaves the other season's rows untouched; `--season <id>` does the other one.
    > 10. `pnpm -r typecheck` and `pnpm -r test` pass; `CLAUDE.md`'s command list has the new line.
    >
    > ### Out of scope
    >
    > Season carry-over (M5.3). Changing the rating model or any constant in it — a model change is what this
    > command exists to survive, not what it does. Storing the seed used (M5.7, if anybody ever asks). A web or
    > admin trigger: this is a command somebody runs on purpose, with the output in front of them, and a button
    > that silently rewrites every rating in the group is not something this product should own.

- [-] **M5.3** **Dropped 2026-09-10: ratings never reset.** Was "Seasons: admin starts a new season; ratings copy `mu` and reset `sigma`; leaderboard and pages are season-aware." Nothing of it was built. The 2026-09-09 brief is dropped with it; what follows is why, and where its parts went.

    > **Why it went (product, 2026-09-10).** The user: *"we can have a weekly or daily automatic session what
    > do you think about that and remove session creating."* A season only ever earned its place if starting
    > one was worth the damage it did, and for this group it never was. A carry-over season keeps `mu` and
    > resets `sigma`, so on night one everybody's Proven drops and everybody wears the `settling` chip for
    > about a month. This group plays one to three games a night, so a weekly reset would leave the whole
    > board permanently "settling" and the number would stop meaning anything; a yearly one leaves a button in
    > `/admin` all year waiting to be pressed by mistake, which is the exact thing M3.9 had to defend against.
    > **A season was a rating event pretending to be a calendar.** The calendar is what the group wanted.
    >
    > **What replaces it.** Nothing about the rating changes: one running `{ mu, sigma }` per player, folded in
    > `started_at` order, from the group's first game to the one they played last night. What people wanted
    > from seasons — a fresh thing to win, something that ends — arrives as **time windows the same board is
    > read through**: `This week`, `Last week`, `This month`, `Last month`, `All time` (**M5.12**, boundaries
    > in **M5.9**), with the closed week's and month's board and awards posting themselves to Discord
    > (**M5.10**, **M5.13**). A window is a filter over games, not a rating event. That is the whole reason it
    > can happen every Monday without costing anybody's number its meaning.
    >
    > **Daily was considered and rejected.** One to three games is not a board, and three awards computed on
    > two games is noise with a trophy on it. Weekly is the shortest window this group produces enough games
    > to fill.
    >
    > **What survives of the dropped brief.** (1) `ratings.seed_mu` / `ratings.seed_sigma` were this task's
    > invention and are now **M5.7**'s whole job — the first fold writes the seed, nothing ever rewrites it —
    > which also means the comment in `apps/web/lib/ingest/rebuild.ts` that says *"When M5.3 makes a new season
    > carry `mu` forward, this line is what changes"* now points at M5.7, and the "Season carry-over is not
    > this task" paragraph in M5.2's brief is answered: there is no carry-over, because there is nothing to
    > carry from. (2) The live-lobby guard stays where it already is, on `rebuild-ratings`. (3) `?season=<uuid>`
    > and the season picker become `?window=` and the window picker (**M5.12**). (4) The `/admin/seasons` copy
    > this brief wrote is retired unwritten; the page's start control is removed instead (**M5.14**). (5) The
    > nightly Discord post stops naming a season (**M5.12**).
    >
    > **The `seasons` table stays.** One row — the one `0001_init.sql` already inserts — the all-time
    > container every `games.season_id` points at, and `active_season_id()` keeps working exactly as it does today. Its name is
    > never printed to a friend again — which is why the row the user named `gamesd` in production is harmless
    > where it is and does not need renaming.

- [x] **M5.4** (/stats landed 2026-09-11: picker default This month, the three awards with per-window minimums, by role, by side, duos, streaks, average length; lib/stats pure and fixture-tested; the Monday post carries the awards field; the per-player sections are M5.20) Stats pages: win rate by role, by side, by duo pairing (min five games together), average game length, longest streaks. Awards when a window closes: most improved, best off-role, cursed duo. **Picker (lead, 2026-09-10):** `/stats` mounts the same `WindowPicker` in the same header slot as the board pages, default `This month`, with the window slot (date range or empty sentence) beneath it; it invents no second control.

    **Scope split (product, 2026-09-10):** this task is **`/stats` and the awards**. The brief's per-player sections on `/p/[puuid]` — role record, side record, partners, streaks, average game length and the `Most improved, September.` line — are **M5.20**, owner `web-engineer`, after **M5.8** draws them. Nothing is softened by the split: every clause and every acceptance check below that names `/p/[puuid]` is quoted verbatim in M5.20 and is owed there, and the pure functions those sections need shipped with this task (`playerRoleRecords`, `playerSideRecords`, `duoRecords`, `playerStreaks` in `apps/web/lib/stats/fold.ts`), so M5.20 is a rendering task and not a second fold.

    **Copy ruling (product, 2026-09-10):** the seven strings this brief asked for by name and did not write are ruled in `05-design.md`, "Copy — `/stats`, the strings the brief did not write" — five keep as the engineer wrote them, `On a run now` becomes **`On a streak now`** and `Nobody is on a run of three or more.` becomes **`Nobody is on a streak of 3 or more.`** (one thing, one name: the section is `Streaks`). The best off-role winner line is **`Omar · 9W 3L · 75% · their main is top`**: that row supersedes the `his` written below, and **acceptance check 7 reads the copy table for that line**, not this brief. `apps/web/lib/stats/copy.ts` is the code half of that table and the two may not drift.

    > **Brief (product, 2026-09-09)**
    >
    > **Amended for windows (product, 2026-09-10).** Seasons are gone — **M5.3** is dropped and ratings never
    > reset. Everywhere this brief says *season*, read **window**: `This week`, `Last week`, `This month`,
    > `Last month`, `All time`, computed from `started_at` by **M5.9**'s boundaries and selected by
    > **M5.12**'s picker. Four clauses change and nothing else does — the scope line under "The universe", the
    > awards' "only on a season that has ended", the three award minimums (they scale with the window), and
    > `/stats`'s default window. Every number, the tie rule, the copy and the acceptance checks below stand as
    > written with the word swapped.
    >
    > **Depends on M3.5** (the shared header, the `Proven`/`Rating` vocabulary and `/p/[puuid]` itself) and
    > on **M5.9** and **M5.12** for the window parameter. **Needs a designer pass: M5.8.** Build the numbers
    > first; the layout lands with M5.8.
    >
    > **The scene.** It is not the ten-in-voice scene — nothing here happens during a night. This is the page
    > someone opens at work the next morning to say "I told you I win on red", and the page the group reads
    > once, together, on the last night of a season. It adds no step to the nightly loop and must not: no
    > input, no toggles, no filters beyond the season picker.
    >
    > ### The universe: what counts as a game, everywhere on this page
    >
    > **A game counts here if and only if the rating fold counted it.** Ten `game_players` rows, five a side,
    > `duration_s > 300` — the shared gate `gateGame` in `apps/web/lib/ingest/fold.ts`. Import it; do not
    > re-implement the predicate in SQL. The reason is one rule the product cannot break: **the games number
    > on `/stats` equals the games number on `/leaderboard` equals `ratings.games`.** A page that counts
    > remakes would put two different game counts for the same player on two pages, and every number under
    > both would be argued with.
    >
    > Scope is one window: the counted games whose `started_at` falls inside the selected window (**M5.9**).
    > There is no season filter — there is one season and it is the all-time container. **`/stats` defaults to
    > `This month`**, not to the leaderboard's `This week`: every minimum on this page is five games or more,
    > and a five-game minimum against a five-game week prints nothing but "not enough yet". One tap gets to
    > the week.
    >
    > ### Where it lives, and how it is computed
    >
    > - **`/stats`**, public, anon key, same as `/leaderboard`. Linked from the header beside Leaderboard.
    > - **Per-player sections on `/p/[puuid]`**, below the rating chart: their role record, their side record,
    >   their partners, their streaks, their average game length.
    > - **Computed at request time, from `games` and `game_players`, with a cap.** One loader,
    >   `apps/web/lib/stats/load.ts`, reading the season's games (`id, started_at, duration_s, winning_side,
    >   lcu_game_id`), their `game_players` (`game_id, player_id, side, role, mu_before, mu_after`) and
    >   `players_public` (`id, puuid, display_name, game_name, tag_line, main_role`), paging at PostgREST's
    >   1000 like the rebuild does, then folding it in TypeScript. The player page calls the same loader and
    >   picks one player out of the answer.
    > - **The cap is `STATS_MAX_GAMES = 2000`, most recent first.** Twenty friends playing four games a night
    >   reach that in a year and a half; a season will be two to four hundred. Over the cap, the page prints
    >   one line: `Showing the most recent 2000 games.` Nothing silently drops. (Amended 2026-09-10: `of this
    >   season` is gone with the word; a window's name is already in the heading above it.)
    > - **`export const revalidate = 300`.** Five minutes is invisible on a page about a season and it means
    >   a refresh war costs one query. No precomputed table, no materialised view, no migration: precomputing
    >   would be a second thing that can disagree with `game_players`, and `game_players` is the truth. If the
    >   page ever gets slow, the fix is the cap, not a cache table.
    >
    > ### The numbers, exactly
    >
    > A "row" below means one `game_players` row of a counted game. A row **won** when its `side` equals its
    > game's `winning_side`.
    >
    > 1. **Win rate by role.** Role is `game_players.role` — the position the client detected, which is what
    >    they actually played. Rows with `role = null` are **excluded from every role number** and counted
    >    once in a footnote (see "Games with no role" below). Per player and role: numerator = won rows at
    >    that role, denominator = rows at that role. **Minimum 5 rows for a percentage**; under 5 the record
    >    prints without one (`3W 1L`), so nobody is "100% mid" off one game.
    >    **A group-wide win rate by role does not exist and must not be built**: every game has a blue top and
    >    a red top, so any group-level role rate is 50.0% by construction. `/stats` instead shows five blocks,
    >    one per role, each a ranked list of the players with ≥5 rows at that role: `1  Rami · 12W 5L · 71%`.
    > 2. **Win rate by side.** Per player: their rows on side 100 and on side 200, same 5-row minimum for the
    >    percentage. Group-wide **is** meaningful and is the headline of the section: blue wins ÷ counted
    >    games, printed (the count came out on 2026-09-11, M5.22; the slot carries it) (`Blue wins 53% of the time · 214 games`).
    > 3. **Duo pairing.** A pair `{A, B}` is credited with a game when both have a counted row in it **on the
    >    same side**. Numerator = games where that side won; denominator = games together. **Minimum 5 games
    >    together** to appear at all. `/stats` shows the five best and the five worst qualifying pairs, sorted
    >    by the tie rule below; `/p/[puuid]` shows that player's three best and three worst partners. The full
    >    190-pair table is not a page anybody reads.
    > 4. **Average game length.** Arithmetic mean of `duration_s` over counted games, rounded to the nearest
    >    minute, printed (the count came out on 2026-09-11, M5.22; the slot carries it) it is over (`Average game 32 min · 214 games`). Per player: the mean
    >    over their counted games. Zero games → the empty line, never `NaN` and never `0 min`.
    > 5. **Streaks.** Order a player's counted rows by their game's `started_at` ascending, `lcu_game_id`
    >    ascending as the tie-break — the rebuild's ordering, so the streak and the rating history tell the
    >    same story. A streak is a maximal run of consecutive rows with the same outcome.
    >    - **Current streak**: the run ending at their most recent counted game, printed `W3` / `L2`, the
    >      form the leaderboard row already uses (`05-design.md`). A single game is `W1`.
    >    - **Longest win streak** and **longest losing streak** of the season, per player, and on `/stats` the
    >      group's best and worst with the holder's name.
    >    This is the same definition the `L2` on the leaderboard row must use. Whichever of M3.5 and M5.4
    >    lands first owns the helper; the second imports it. Two definitions of a streak in one app is a bug.
    >
    > **The tie rule, used everywhere on this page, stated once:** win rate descending, then games
    > descending, then display name A–Z (case-insensitive), then `puuid`. Percentages are
    > `Math.round(wins / games * 100)` and print as `71%`.
    >
    > **Games with no role.** Backfilled games carry `role: null` on every participant (M5.1) and an
    > end-of-game block can too. One line under the role section, and only when the number is above zero:
    > `<N> games are not in the role numbers — the client did not record who played where. Backfilled games
    > never do.`
    >
    > ### The awards
    >
    > **They appear only on a window that has closed.** `Last week` and `Last month` have them. `This week`
    > and `This month` render the block's heading and one line — `Awards are handed out when the week ends.` /
    > `Awards are handed out when the month ends.` — because an award that changes every night is a statistic,
    > not an award. **`All time` has no awards block at all**: a window that never closes has no last night to
    > read them on, and "most improved of all time" is a different question from the one these three ask.
    > This is what `Last week` and `Last month` exist for on the picker — the Monday Discord post (**M5.10**)
    > links to the same board and the same three lines, on a page the group can open and argue with.
    >
    > **They are computed at request time from the closed season's games, never stored.** A late backfill or
    > a rebuild then corrects an award instead of freezing a wrong one in a table forever.
    >
    > Section intro: `Three awards for the week. Nobody votes; the numbers pick.` / `Three awards for the
    > month. …` (amended 2026-09-10 — was `Three end-of-season awards.`; the noun is the window's).
    >
    > **Most improved.** The biggest climb in Rating across the season: `round(mu_after × 60)` of their **last**
    > counted game minus `round(mu_before × 60)` of their **first** counted game (both from `game_players`, so
    > it is the number the pages printed, and the subtraction of two rounded numbers — the rule in
    > `00-product.md`). **Minimum: 6 counted games in a week window, 15 in a month window** (the table under
    > "Minimums scale with the window"). Ties: more games wins; still tied, both are named.
    > - Rule line: `Biggest climb in Rating from a first game to a last one, over at least <N> games.`
    > - Winner line: `Nadia · +212 · 1266 → 1478`
    > - Nobody qualifies: `Nobody played <N> games this week.` / `… this month.`
    >
    > **Best off-role.** Best record in counted games where the role they played was **not** their
    > `players.main_role` — secondary counts as off-role, exactly as the balancer counts it
    > (`offRolePenalty` applies to anyone not on a main role). Needs `main_role` and `role` both non-null.
    > **Minimum: 4 off-role games in a week window, 10 in a month window.** Ranked by win rate, then the tie
    > rule.
    > - Rule line: `Best record away from their main role, over at least <N> of those games.`
    > - Winner line: `Omar · 9W 3L · 75% · his main is top`
    > - Nobody qualifies: `Nobody spent <N> games off their main. That is the balancer doing its job.`
    > - Always under it, when any player has no main role: `Players with no main role are not in this one —
    >   every role is theirs.`
    >
    > **Cursed duo.** The qualifying pair with the **lowest** win rate on the same side. **Minimum: 4 games
    > together in a week window, 8 in a month window** — the browsing table's 5 is for looking, an award needs
    > a little more before it crowns anybody. Ties: more games together; still tied, both pairs are named.
    > - Rule line: `The pair with the worst record on the same team, over at least <N> games together.`
    > - Winner line: `Yuki and Theo · 2W 9L · 18%`
    > - Nobody qualifies: `No pair played <N> games together this week.` / `… this month.`
    >
    > ### Minimums scale with the window
    >
    > | | most improved | best off-role | cursed duo |
    > |---|---|---|---|
    > | week (`Last week`) | 6 counted games | 4 off-role games | 4 games together |
    > | month (`Last month`) | 15 counted games | 10 off-role games | 8 games together |
    >
    > A regular in this group plays five to fifteen games a week, so 6 crowns somebody who was actually there
    > all week and never the friend who showed up once and won. The month column is the 15/10/8 this brief was
    > written with and does not move. **Two numbers per award, in one table, in one module constant keyed by
    > window kind** — not a formula, not a fraction of the window's games, because a threshold nobody can
    > recite is a threshold the group will argue with. `All time` has no row because it has no awards.
    >
    > On `/p/[puuid]`, a player who won an award in a closed window gets one line in that window's section:
    > `Most improved, week of 1 Sep.` / `Most improved, September.` (amended 2026-09-10 — was
    > `Most improved, Season 1.`). No badge, no icon.
    >
    > ### `/stats`, in order
    >
    > 1. The window's name and the dates it covers, counted games, players who played.
    > 2. Awards (closed season) or the one-line placeholder (active season).
    > 3. Group numbers: blue win rate, average game length.
    > 4. By role: five blocks, ranked lists, the no-role footnote.
    > 5. Duos: `Best together` and `Worst together`, five each.
    > 6. Streaks: longest win streak and longest losing streak of the season with holders, then anyone whose
    >    current streak is 3 or longer.
    >
    > ### Edge cases
    >
    > - **A window with no games.** The page renders its header and one line: `No games this week yet.` /
    >   `No games this month yet.` / `No games yet.` (**M5.12**'s copy, one constant per window kind). Not an
    >   empty page, not a spinner — the M3.5 rule. A `Last week` with no games is the group not having played,
    >   and says exactly that: `No games last week.`
    > - **A window with two games.** Every minimum bites and every block prints its "not enough yet" line.
    >   That is correct and it is what a quiet week looks like; do not lower a threshold to make the page look
    >   full.
    > - **Every role number null (a season of pure backfill).** The role section prints only the footnote.
    > - **A player in one game who then left the group.** Appears in the numbers they qualify for and nowhere
    >   else. Nothing here knows about leaving.
    > - **A player with no display name** (M3.10's fallback) uses the same fallback as every other surface,
    >   never a raw PUUID.
    > - **A pair that played 5 games together and 40 against each other.** Only same-side games count.
    >   Rivalries are not in this milestone.
    > - **A game with a duplicate player on the scoreboard** is already excluded — `gateGame` rejects it.
    > - **Someone opens `/stats` mid-game.** The game in progress is not in `games` yet and appears after it
    >   lands, up to five minutes later. Say nothing on the page about it; it is a season page.
    >
    > ### Acceptance check
    >
    > Unit tests on the pure fold with a hand-built fixture (this is arithmetic; it should not need the
    > database), plus one integration test that the page renders from a seeded season.
    >
    > 1. **The universe.** A window with one rated game, one 300-second game, one nine-player game and one
    >    backfilled ten-player game produces `counted games = 2`, and on `All time` every player's games number
    >    on `/stats` equals their `ratings.games` on `/leaderboard`, for every player. In a narrower window the
    >    two pages count the same games as each other for that window.
    > 2. **By role.** A fixture where one player is 12W 5L on jungle and 1W 0L on mid shows `71%` for jungle,
    >    the bare record `1W 0L` for mid, and the group's jungle list ranks them by the tie rule. Null-role
    >    rows change no role number and are named in the footnote with the right count.
    > 3. **By side.** The group blue rate equals blue wins ÷ counted games in the fixture, to the printed
    >    percent; a player with 4 games on red shows a record and no percentage.
    > 4. **Duos.** A pair with 4 games together does not appear; at 5 it appears; a game where they were on
    >    opposite sides does not count for either the numerator or the denominator.
    > 5. **Average game length** equals the mean of `duration_s` over counted games, rounded to the minute,
    >    and a season with no counted games prints the empty line rather than `0 min`.
    > 6. **Streaks.** A sequence W W L W W W with two games sharing a `started_at` produces the same
    >    `longest = 3` and `current = W3` under ten shuffled insert orders (the `lcu_game_id` tie-break).
    > 7. **Awards on a closed window only.** `This week` and `This month` show the placeholder line and no
    >    winner; `Last week` and `Last month` on the same fixture show all three, each matching a hand-computed
    >    answer, with the exact copy above; `All time` renders no awards block.
    > 8. **Award minimums and ties.** In a month window a player with 14 games and a huge climb does not win
    >    most improved and one with 15 does; in a week window the same fixture flips at 5 and 6. Two players
    >    tied on climb and games are both named; the same for the duo award at 3 and 4 games in a week and at
    >    7 and 8 in a month.
    > 9. **The cap.** With `STATS_MAX_GAMES` lowered in the test, the page uses the most recent N games and
    >    prints the cap line; under the cap the line is absent.
    > 10. **The window parameter.** `/stats?window=last-week` shows that week's numbers and awards; an
    >    unknown value is a 404; no parameter is `This month`.
    > 11. `pnpm -r typecheck` and `pnpm -r test` pass; the status table row is updated; **M5.8 is filed and
    >    open** — this task ships correct numbers in a plain layout and does not invent one.
    >
    > ### Out of scope
    >
    > Champion stats, KDA, gold, damage and CS — the columns exist and none of them is a question this group
    > asks out loud; a page of them is a different product. Head-to-head records and rivalries. Anything
    > per-night. Filters, search, sorting controls, CSV. A precomputed stats table or a materialised view.
    > Posting stats or awards to Discord (**M5.10**). Changing the rating model, the leaderboard sort, or the
    > two names `Proven` and `Rating`.

- [x] **M5.5** (landed 2026-09-10: `/admin/games` read-only, lobbies in `in_game`/`dropped`, copy pinned) Missed-game report: a page listing lobbies that reached `in_game` but never `finished`, so someone knows the companion rule was broken that night.

    > **Candidate for this page (product, 2026-09-08), not a task.** A read-only `/admin/games` list — one row per `games` row with its `lcu_game_id`, participant count, duration and whether it was rated. There is no such surface today, so the M2 test night is verified by reading row counts out of the database by hand (`docs/06-test-night.md`). If M5.5 gets built, "the games we did capture" is the same query as "the lobbies we did not", and one page can answer both. Nobody needs it before then.

    > **Brief (product, 2026-09-09)**
    >
    > **The scene, failing.** Ten friends played, the game ended, and nothing appeared. Everybody who was
    > going to run the companion had closed it, or the one person running it alt-F4'd on the defeat screen.
    > The rating did not move and nobody can say which night it was, because there is no surface anywhere in
    > this app that says "a game started here and never came back". Backfill (M5.1) usually fixes it the next
    > day; when it does not, this page is the only way anybody finds out the rule was broken. It is one
    > read-only admin page and it adds no step to the nightly loop.
    >
    > **The facts it rests on** (both already true, both verified):
    >
    > - **A `lobbies` row is one game cycle** (M2.14, `0003`), so an `in_game` row is one specific game that
    >   started.
    > - **`in_game` is swept to `dropped`, not `abandoned`** (M5.11 superseded M2.5's rule on 2026-09-09): two
    >   hours idle at `in_game` becomes `dropped`, which keeps the frozen ten (M2.9) and never gets replace
    >   semantics. So **a lobby that reached `in_game` and never got an end-of-game block ends as `dropped`**,
    >   with the exact ten who were in it. That is not a leak; it is the record. This page is the query over
    >   it: the `Missed` list is `status in ('in_game', 'dropped')`.
    > - A late end-of-game block still lands: `findLobbyId` resolves a game to the newest lobby row that
    >   existed when the game started, so a queued block from days ago closes its own cycle and the row
    >   leaves this page by itself.
    >
    > ### One page, two lists
    >
    > **`/admin/games`**, admin-only, under the existing dashboard layout, with a nav entry `Games`. Admin and
    > not public: this is operational, and "we missed one" is not a thing the group needs on a phone at 21:30.
    > Read-only — no buttons, no writes, nothing that edits a lobby or a game.
    >
    > **List 1 — `Missed`.** Every `lobbies` row with `status = 'in_game'`, newest `updated_at` first, capped
    > at 100 — and `dropped` too once **M5.11** adds that status, which is the same list under a name that
    > says so. Write the status filter as a named constant with both values in it from the start, so M5.11
    > is a one-line change here and no query anywhere says `'in_game'` twice. One row each:
    >
    > - the night it belongs to (`nightStart` over `lobbies.created_at`, `CUSTOMS_NIGHT_TZ` — the same night
    >   definition as everything else), as `Tue 9 Sep`
    > - when it went in-game (`updated_at`), as a time
    > - who reported it (`reported_by_player_id` → display name, M3.10's fallback)
    > - the frozen roster: how many members, and their names
    > - the party id, short (first 8 characters), so it can be matched against a companion log
    > - a state note, one of:
    >   - `no game` — the ordinary case, and the whole point of the page
    >   - `game landed, lobby never closed` — a `games` row exists with this `lobby_id` while the lobby is
    >     still `in_game`. A different bug (the finish transition failed after the insert) and it must not
    >     hide inside the same word as the first one.
    >
    > **List 2 — `Captured`.** The most recent 200 `games` rows, any season, newest `started_at` first. One
    > row each: night, start time, `duration_s` as `m:ss`, `source` (`eog` / `backfill`), participant count
    > (`10`, or the real number in a warning tone when it is not 10), `rated` (yes when every `game_players`
    > row has a non-null `mu_after`; `no` otherwise), the season's name, and the lobby's short party id or
    > `—` when `lobby_id` is null (every backfilled game).
    >
    > This is the read-only games list the 2026-09-08 note above proposed, built here because "the games we
    > did capture" and "the lobbies we did not" are the same query against the same two tables, and because
    > it retires the row-counting by hand in `docs/06-test-night.md`.
    >
    > ### Copy (product-owned; use these words)
    >
    > - Page heading: `Games`
    > - Under `Missed`: `These lobbies started a game and no result ever arrived. Somebody's companion was
    >   closed at the final whistle. Backfill usually picks the game up the next day and the row disappears
    >   on its own.`
    > - Empty `Missed`: `Nothing missing. Every game that started has a result.`
    > - Under `Captured`: `The last 200 games the server has. Backfilled games are rated by
    >   pnpm --filter web rebuild-ratings, not on arrival.`
    > - Empty `Captured`: `No games yet.`
    > - The `game landed, lobby never closed` note, once under the list when any row has it: `A result
    >   arrived for this game but the lobby never moved to finished. The rating is fine; the lobby row is
    >   stuck.`
    >
    > ### Edge cases
    >
    > - **A lobby stuck `in_game` from tonight, while the game is still being played.** It is listed, and it
    >   is right to list it — the page is a list of games without results, and one of them is thirty minutes
    >   old. Do not add a "settling" delay or hide recent rows: an admin reading this page at midnight can
    >   read a clock. The `updated_at` column is what tells them.
    > - **A stuck lobby whose roster is empty or short.** Possible if the freeze happened on a partial post.
    >   Print the real count; do not filter the row out. A missed game with three members recorded is worse
    >   news than one with ten, not better.
    > - **The same party stuck twice on one night.** Two rows, two cycles, both listed. That is M2.14
    >   working.
    > - **A backfilled game with no lobby.** `—` in the lobby column, always. It is not a missed lobby and it
    >   never appears in list 1.
    > - **A game with 9 or 11 participants.** Shows in `Captured` with the real count and `rated: no`,
    >   because `gateGame` skipped it. This page is where that becomes visible for the first time.
    > - **Hundreds of stuck rows.** Cap at 100 with a line saying how many there are in total. If that number
    >   is ever above ten, the news is not the list, it is that the companion rule is not being followed at
    >   all.
    > - **No season / a season boundary.** Neither list is season-scoped. Missed lobbies have no season, and
    >   the point of `Captured` is the last two hundred games whatever season they are in; the season is a
    >   column, not a filter.
    >
    > ### Acceptance check
    >
    > Integration tests against the local stack, seeded through the ingest path.
    >
    > 1. **The list is the query.** Drive a lobby to `in_game` and post no game: it appears in `Missed` with
    >    `no game`, the right night, the reporter's name, ten member names and the short party id.
    > 2. **It disappears when the game lands.** Post the end-of-game block for that lobby: the lobby is
    >    `finished`, it is gone from `Missed`, and the game is in `Captured` with `eog`, `10`, `rated: yes`.
    > 3. **The other bug is named.** A `games` row whose `lobby_id` points at a lobby left at `in_game`
    >    renders `game landed, lobby never closed`, not `no game`.
    > 4. **`open`, `balanced`, `abandoned` and `finished` lobbies never appear in `Missed`** — including an
    >    `abandoned` row that went through `balanced`, which is not a missed game.
    > 5. **`Captured` reads truthfully.** A backfilled game shows `backfill`, `—` for the lobby and
    >    `rated: no` before a rebuild; after `pnpm --filter web rebuild-ratings --force` the same row shows
    >    `rated: yes`. A 200-second game shows its duration and `rated: no`.
    > 6. **Ordering and caps.** `Missed` is newest `updated_at` first and stops at 100 with the total
    >    printed; `Captured` is newest `started_at` first and stops at 200.
    > 7. **Access.** A signed-in non-admin and an anonymous visitor get whatever the other admin pages give
    >    them today, by the same guard; nothing here invents its own.
    > 8. **Read-only.** The page issues no write of any kind: no route under `/api/admin/games` exists that
    >    is not a GET.
    > 9. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; the status table is updated;
    >    `docs/06-test-night.md`'s "read the row counts by hand" step is replaced by a line pointing at this
    >    page.
    >
    > ### Out of scope
    >
    > **Any write.** No "mark abandoned", no re-ingest, no delete. The stuck row is evidence, and a button
    > that clears evidence on the only page that shows it is the wrong shape. The real cost of a stuck row —
    > that the party's later lobby posts land on the frozen row and the group gets no more teams that night —
    > is a server rule, not an admin chore: **M5.11**. Alerting, Discord posts, or a badge anywhere else.
    > Match-history depth or anything backfill decides (M5.1, M5.6). Editing a game or its result — no
    > surface in this product may do that; the fold is the only writer of ratings.

- [ ] **M5.6** Find out how far back match history goes. M0 only ever read the default window (`begIndex=0&endIndex=20`, which returned 21 games, inclusive) and never paged past it, so the reach of backfill is a guess. Walk `begIndex` back in pages of 20 on a real client until the client stops returning games or starts erroring, and write the answer into `03-lcu-reference.md`: how many games deep it goes, whether `gameCount` is the true total or just the window, and what an over-the-end request does (empty `games[]`, 400, or a repeat of the last page).

    > **Why (product).** The product doc promises backfill "recovers it" when the companion misses a game.
    > If the window is 21 games, that promise holds for about two nights, not for the season, and the
    > sentence has to change. This is a two-hour read against a live client that decides whether a
    > paragraph of the product doc is true.
    >
    > **Acceptance check.** `03-lcu-reference.md`'s match-history row states the observed depth with a date
    > and patch, and the over-the-end behaviour. If the depth is shallower than a season, add a note to
    > M5.1 capping the walk and open a product task to rewrite the backfill paragraph in `00-product.md`.

- [x] **M5.7** (landed 2026-09-11: migration 0012 on kustom adds `ratings.seed_mu`, `seed_sigma`, `seed_rank_tier`, `seed_rank_division`; the live fold writes the seed for a row it creates, the rebuild stores the seed its own fold used and prefers a stored seed over the current rank, so a rank change never rewrites history; the player page's seed line reads it; `--prune` deletes a row's seed with it; the hosted rows have no seed until the next `rebuild-ratings` run) Store the seed the first fold used, if the group ever cares. The rebuild (M5.2) seeds every player from their **current** rank, so a rank that moved after a player's first rated game silently rewrites that player's whole history on the next rebuild. Today that is acceptable and documented; it stops being acceptable the first time somebody's board position changes and nobody can say why. The fix is one column — the `{ mu, sigma }` the very first fold gave them, per season — read by both folds instead of `seedFromRank`.

    > **Acceptance check.** A player whose `players.rank_tier` changes between their first rated game and a rebuild has byte-identical `game_players` rating columns before and after the rebuild. Until this ships, the caveat stays written in the M5.2 brief and nowhere else pretends otherwise.

    > **Scope shrank (product, 2026-09-09), then grew back (product, 2026-09-10).** The 2026-09-09 note said
    > M5.3 would add `ratings.seed_mu` / `ratings.seed_sigma` for carried players and leave this task the
    > rank-seeded remainder. **M5.3 is dropped**, so this task owns the columns, the migration and the rule
    > outright: **the first fold that rates a player writes their seed columns, and nothing ever rewrites
    > them.** The rebuild reads the stored pair when it is non-null and `seedFromRank` otherwise. The
    > acceptance check above is unchanged, and it is also what makes **M5.15**'s `Seeded from Gold II at 1469` **Amended 2026-09-10 after the designer's review:** the per-game line is the chance clause alone, `As the 58% side.`; a game with no stored chance prints no line (the `Won, +43` form is deleted); acceptance checks 1 and 2 read accordingly.
    > line exact rather than approximate — until this ships, that line reads the player's *current* rank, with
    > the caveat M5.2's brief already carries.

- [x] **M5.8** (landed 2026-09-11 with M5.4: the designer's six rules applied, section in 05-design.md) Designer pass on `/stats`, the awards block and the window picker (M5.4, M5.12). The numbers and the copy are product's and are pinned in the M5.4 brief; the layout is not. Needs: the five role blocks and the duo lists on a phone without becoming a table; the awards block reading as three statements, not three cards competing with the window header; the **window picker** (`This week` · `Last week` · `This month` · `Last month` · `All time`) on `/leaderboard`, `/p/[puuid]` and `/stats` as one control that looks the same on all three, fits five options on a phone without a dropdown if it can, does not compete with the still-settling sentence for the top of the page, and makes the selected window unmistakable — it is the difference between two boards that otherwise look identical; the per-game explanation lines on `/p/[puuid]` (**M5.15**) as one readable column and not a second table; the per-player stats sections on `/p/[puuid]` below the rating chart. Written into `docs/05-design.md` beside the leaderboard row. **Acceptance addendum (product, 2026-09-10):** the selected window option carries `aria-current="page"`, and the picker's `<nav>` keeps its `Time window` name whether or not the dress adds a visible heading; if it does, the heading is that string verbatim.

    > **Acceptance check.** `05-design.md` has a `/stats` section with the same level of detail as "Leaderboard row" — type sizes, the order of the blocks, what a block looks like with nothing in it, and the picker's placement on all three pages — and it invents no number, no threshold and no wording that the M5.4 brief has not already fixed.

- [x] **M5.9** (landed 2026-09-10: `windowRange`, `isInWindow`, `closedWindow` with the dedupe key, week and month formatters in lib/night.ts) The window boundaries: which week and which month a game belongs to. *(owner: web-engineer)* Was "attribute a game to the season its `started_at` falls in", which existed because a second season would have put backfilled games on the wrong board. There is one season now (**M5.3** dropped) and that problem is gone; what took its place is the same arithmetic under a better name — every windowed board, page and post asks "is this game inside this week" and there must be exactly one answer to it in the codebase.

    > **Brief (product, 2026-09-10)**
    >
    > **The scene.** There is no scene. Nobody sees this task; they see `This week` on the leaderboard and the
    > Monday post in Discord, and both are only ever as right as this file. It is small, pure and testable, and
    > it ships before **M5.12**, **M5.10** and **M5.13**, all three of which import it.
    >
    > **Where it lives.** `apps/web/lib/night.ts`, beside `nightStart` — not `packages/core`, for the reason
    > that file already gives: the timezone comes from `CUSTOMS_NIGHT_TZ` and core takes no environment. Pure
    > functions taking the instant and the zone, no `Date.now()`, tested in `night.test.ts`.
    >
    > **A game belongs to the week and the month its `started_at` falls in, by the 06:00 boundary.** Same
    > boundary as the night (M2.5, `04-decisions.md`), for the same reason: the group plays past midnight, and
    > a Sunday-night game that starts at 01:40 belongs to the week that is ending, with the rest of that
    > night's games, not to the week that starts six hours later. Windows are half-open, `[start, end)`, and
    > every one of them starts at 06:00 local:
    >
    > - **week** — Monday 06:00 to the next Monday 06:00.
    > - **month** — the 1st at 06:00 to the 1st of the next month at 06:00.
    > - **all time** — no start, no end.
    >
    > **The arithmetic is one step off `nightStart`, deliberately.** `weekStart(instant, tz)` takes
    > `nightStart(instant, tz)` — which already rolled a 01:40 instant back to the previous day's 06:00 — reads
    > that boundary's civil weekday in `tz`, and steps back to Monday. `monthStart` does the same and steps
    > back to day 1. Building either from `instant` directly would put a 02:00 Monday game in the wrong week
    > and a 02:00 first-of-the-month game in the wrong month, and those are the two games a year somebody
    > actually notices.
    >
    > **The surface.**
    >
    > ```ts
    > export type WindowKind = 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'all-time';
    > export interface WindowRange { start: Date | null; end: Date | null; }
    > export function windowRange(kind: WindowKind, now: Date, tz?: string): WindowRange;
    > export function isInWindow(startedAt: Date, range: WindowRange): boolean;
    > ```
    >
    > `all-time` is `{ start: null, end: null }` and `isInWindow` is true for everything — the callers get one
    > predicate and no branch, which is what stops five surfaces each inventing an "except all time" clause.
    > `this-week` and `this-month` end in the future (`end` is the next boundary, not `now`), so a game that
    > lands mid-evening is inside the window it was played in without the range moving under it.
    >
    > **Daylight saving.** The boundary is a local wall clock, so a week can be 167 or 169 hours and one week a
    > year has an hour of overlap or a missing one at 06:00. `nightStart` already resolves that; this file adds
    > nothing to it and must not "fix" it by working in UTC offsets. `Africa/Cairo` is the configured zone and
    > it does observe DST.
    >
    > **No column, no migration, no backfill of anything.** The window is computed at read time from
    > `games.started_at`. That is what makes a game backfilled three weeks late land in the week it was
    > actually played, on every page and in every past post, with nothing rewritten — the property the old
    > season-attribution task had to build machinery for. `games.season_id` stays exactly as it is.
    >
    > **Acceptance check.** Unit tests in `apps/web/lib/night.test.ts`, with `CUSTOMS_NIGHT_TZ` fixed to
    > `Africa/Cairo` and instants written as local wall clocks.
    >
    > 1. **The week's edges.** A game at Monday 05:59 local is in the week that is ending; the same game at
    >    06:01 is in the new one. A game at Sunday 23:30 and one at Monday 01:40 of the same night land in the
    >    same week.
    > 2. **The month's edges.** A game at 02:00 on the 1st is in the month that is ending; a game at 07:00 on
    >    the 1st is in the new one. A 31-day month, a 30-day month and February all give a range that starts
    >    and ends at 06:00 local.
    > 3. **`last-week` is the week before `this-week`**, adjacent with no gap and no overlap: the previous
    >    range's `end` is byte-identical to the current range's `start`. The same for `last-month`.
    > 4. **All time** returns nulls and `isInWindow` accepts a game from 2019 and one from tonight.
    > 5. **DST.** Across Egypt's spring-forward and autumn-back weekends, every range still starts at 06:00
    >    local, the ranges stay adjacent, and no game is in two windows or in none.
    > 6. **Purity.** No function reads `Date.now()` or `process.env` — the zone is a parameter with the same
    >    default as `nightStart`.
    > 7. `pnpm -r typecheck` and `pnpm -r test` pass; the status table row is updated.
    >
    > **Out of scope.** The picker and the pages (**M5.12**), the posts (**M5.10**, **M5.13**), any change to
    > `nightStart` itself or to what a night means, and any per-window storage.

- [x] **M5.10** (words landed with M5.13 on 2026-09-11: `windowSummaryEmbed` with the closed window's board, `windowSlotLine` as the description, and an `Awards` field that prints only when M5.4 hands it lines) What the weekly and monthly Discord post says: the closed window's board and its three awards, in one embed. *(owner: web-engineer)* Was "post the closed season's final board and its three awards when a season starts", a candidate that needed a decision row; the decision row exists now (`04-decisions.md`, 2026-09-10) and the trigger is a calendar boundary instead of a button. **M5.13** owns when it fires and that it fires once; this task owns the words.

    > **Brief (product, 2026-09-10)**
    >
    > **Depends on M5.9** (the boundaries), **M5.4** (the awards and the counted-games universe) and
    > **M5.12** (the page the post links to). Ships before **M5.13**, which calls it.
    >
    > **The scene.** Monday morning. Nobody is in voice, nobody opened anything, and there is a post in the
    > channel that says who won the week and who the numbers picked. Somebody screenshots it into WhatsApp and
    > the argument runs all day. That is the entire product of this task: **the week ends by itself, out loud.**
    > It adds no step to the nightly scene because it does not happen during one.
    >
    > **Where it lives.** `apps/web/lib/discord/embeds.ts` beside `leaderboardEmbed`, as a pure builder
    > (`windowSummaryEmbed`) taking the loaded board and awards and returning the embed object — snapshot
    > tested like the other three. The loaders are M5.4's `lib/stats/load.ts` and M5.12's board loader; this
    > task adds no query it does not already have.
    >
    > **The embed.**
    >
    > ```
    > color        accent
    > title        Last week · leaderboard          <- or `Last month · leaderboard`
    > url          https://<site>/leaderboard?window=last-week
    > description  Monday 1 Sep to Sunday 7 Sep · 14 games
    > field 1      The board / Top ten              <- M3.22's rule, unchanged
    >              `1` Lena · 1548 · 6 games
    >              ...
    > field 2      Awards
    >              **Most improved** Nadia · +212 · 1266 → 1478
    >              **Best off-role** Omar · 9W 3L · 75% · his main is top
    >              **Cursed duo** Yuki and Theo · 2W 9L · 18%
    > timestamp    the moment the post is made, ISO 8601
    > footer       Proven is your rating minus how unsure the board still is about you, and it settles after about 30 games.
    > ```
    >
    > **Every number and every award line is M5.4's, quoted, not re-derived.** Including the "nobody
    > qualifies" lines: an award nobody won prints its sentence (`Nobody played 6 games this week.`) rather
    > than being dropped, so the block always has three lines and the group can see the bar it missed.
    >
    > **The board in the post is the window's board** (**M5.12**'s rule): the players who played inside the
    > window, in Proven order, with each player's rating **as of their last counted game in the window**, and
    > the games count is that window's games, not their lifetime total. Ten lines maximum, same as the nightly
    > post.
    >
    > **The dates in the description are the window's own** (`Monday 1 Sep to Sunday 7 Sep`,
    > `September`), formatted by `lib/night.ts`'s one formatter, in `CUSTOMS_NIGHT_TZ` — the last day named is
    > the last **night** of the window, so a week that ends Monday 06:00 is described as ending on Sunday. A
    > reader should never have to work out which seven days these are.
    >
    > **A window with no counted games produces no post**, and the skip is one log line. `No games last week.`
    > is a true sentence for a page somebody chose to open and a bad one for a channel it arrives in
    > unasked — the same rule the nightly post already follows for an empty board.
    >
    > **Acceptance check.**
    >
    > 1. **The snapshot.** A seeded week produces the embed above, verbatim, with the awards computed by M5.4
    >    and the board by M5.12, and the title, the url and the description naming the same window.
    > 2. **The numbers agree with the page.** Every line in field 1 matches `/leaderboard?window=last-week`
    >    row for row and number for number, in the same order.
    > 3. **A window nobody qualified in** prints all three award sentences with the right minimum in each.
    > 4. **A window with no games** returns no embed at all (the builder returns `null`) and the caller logs
    >    one line.
    > 5. **Monthly** is the same builder with `last-month`, and no string in it is written twice — the noun
    >    (`week` / `month`) is a parameter, not a copy-paste.
    > 6. `pnpm -r typecheck` and `pnpm -r test` pass; the strings are in `05-design.md`'s copy table.
    >
    > **Out of scope.** When it fires and firing once (**M5.13**). Any change to the nightly post beyond what
    > **M5.12** already does to its title. A per-player mention or ping — nobody gets an `@` for losing.

- [x] **M5.11** A lobby stuck at `in_game` must stop swallowing that party's later posts. Found while briefing M5.5 (product, 2026-09-09) and it is worse than the report it was found in: `selectLiveLobby` resolves a party to its `open`/`balanced`/`in_game` row, and a post landing on an `in_game` row is answered with `rosterFrozen: true`, `balanced: null`, `recheckInMs: null` (`apps/web/lib/ingest/lobby.ts`). The client keeps the same `partyId` all night (M2.14, verified in the 16.17 capture). So **one missed end-of-game block costs the group every remaining game of that night**: game two's roster is never read, no split is ever produced, and the companion is told nothing is wrong. Nobody would guess the cause from inside Discord.

    > **The fix is a new terminal status, `dropped`, not a button and not a new row alongside the old one.**
    > A new lobby row cannot simply be started next to the stuck one: `lobbies_active_party_idx` (`0003`) is
    > unique per party `where status in ('open', 'balanced', 'in_game')`, so two live rows for one party is
    > exactly what the schema forbids. So the stuck row has to leave the live set, and it must not leave it
    > as `abandoned` — `abandoned` means "dissolved before it ever started", keeps replace semantics (M2.9),
    > and would erase the one fact M5.5 exists to show.
    >
    > `dropped`: reached `in_game`, never got a result. Terminal, roster frozen forever, outside the partial
    > index. The same sweep that abandons a stale `open` or `balanced` lobby gains one statement —
    > `in_game` and `updated_at` older than the same two hours (no game runs two hours) becomes `dropped` —
    > and the party's next post then starts a clean cycle by the rules M2.14 already wrote. **`dropped ->
    > finished` stays a legal transition**, so a queued end-of-game block from days ago still closes its own
    > lobby and the row leaves the missed list by itself, which is the behaviour M5.5's brief describes.
    > M5.5's `Missed` list becomes `status in ('in_game', 'dropped')` — an `in_game` row is a game that may
    > still be being played, a `dropped` one is a game nobody will ever see a result for.
    >
    > An admin pressing "unstick" on an admin page would also work, and it would be a step in the scene at
    > 21:30 with nine friends waiting. That is the thing this product does not do.
    >
    > **Acceptance check.** (1) A lobby driven to `in_game` and left there, then posted again 2h1m later with
    > the same party id: the stuck row is `dropped` with its frozen roster intact, a new `lobbies` row is
    > created for the party, its roster is written, and ten stable members balance it. (2) The same post at
    > 1h59m still lands on the frozen row and answers `rosterFrozen: true` — nothing changes for a game in
    > progress. (3) A late end-of-game block for the dropped game still resolves to that row (`findLobbyId`
    > takes the newest row that existed when the game started), moves it `dropped -> finished`, rates it
    > normally, and leaves the new cycle alone. (4) `GET /api/cron/sweep` alone, with no companion post, is
    > enough to drop the row. (5) The tonight page treats `dropped` exactly as it treats `abandoned` —
    > `Nothing tonight` — and no other surface gains a new word for it. (6) A migration adds the enum value
    > and `packages/db/src/types.ts` is regenerated; `LobbyStatus` in the shared schemas carries it.

- [x] **M5.12** (landed 2026-09-10: five-window picker on /leaderboard and /p/[puuid] with the date-range slot, windowed numbers as of the last counted game, All time byte-identical; the nightly post reads This week in the configured zone; result footer `Kustom · game N`; the tonight strip prints the night alone) The window picker: read the board through `This week`, `Last week`, `This month`, `Last month`, `All time`. *(owner: web-engineer)* The replacement for the season selector M5.3 was going to build. `/leaderboard` defaults to `This week`, `/p/[puuid]` to `All time`, `/stats` to `This month` (M5.4). **Footer ruling (product, 2026-09-10):** the result embed's footer becomes `Kustom · game ${gameNumber}` (`Kustom` when the count is null; the count is the all-time game number, unchanged), superseding the M3.21 clause that kept the season name; `ResultEmbedInput.seasonName` and the `season_id` filter in `countGamesInSeason` go with it (the number is identical on a one-season database); the selected picker option carries `aria-current="page"`. **Slot ruling (product, 2026-09-10):** the picker carries a slot under it, `${range} · ${gamesLabel(count)}` per the copy table (`Monday 1 Sep to Sunday 7 Sep`, `September`, `Since 8 Sep 2025`; the week form is M5.10's description byte for byte; `/p/[puuid]` prints the range half alone), replaced by the window's empty sentence when the window has no games, in which case no board card is drawn. Also, lands with M5.12: the tonight strip prints the night's date alone (`seasonName` leaves `TonightSnapshot`; the live strip currently reads `· GAMESD`).

    > **Brief (product, 2026-09-10)**
    >
    > **Depends on M5.9** (the boundaries) and on M3.5 (the pages). **M5.8** dresses it; this task ships it
    > plain and correct.
    >
    > **The scene, and what it may not touch.** Ten friends in voice, someone opens a lobby, teams appear.
    > Nothing on this task's list happens during that. This is the page somebody opens on the bus on Monday.
    > The rule it must not break: **the nightly loop gains no step and no number changes meaning.** A window
    > filters which games are looked at. It never refolds a rating, never resets a sigma, and never produces a
    > number a rebuild would not reproduce.
    >
    > ### What a window board is, exactly
    >
    > **Membership.** The players with at least one counted game (`gateGame`, M5.4's universe) whose
    > `started_at` is inside the window. `All time` is every player with a `ratings` row.
    >
    > **The two numbers.** Each player's `Proven` and `Rating` **as of their last counted game inside the
    > window**, from that game's `game_players.mu_after` / `sigma_after`. On `All time` that is by construction
    > their `ratings` row, which is what the page reads there — one rule, no special case. On `This week` it is
    > also their current rating, because their last game in the running week *is* their last game. On
    > `Last week` it is the board as it stood when the week closed, which is what makes the Monday post
    > (**M5.10**) reproducible on Tuesday and after a late backfill.
    >
    > **The order is unchanged: Proven descending**, `lib/board/order.ts`'s comparator, the floor and the tie
    > rule exactly as they are. The window changes who is on the board, not how boards are sorted. This is the
    > single most important sentence in the task: a weekly board sorted by "who climbed most this week" would
    > be a second ranking with a second meaning, and the group already has one number to argue about.
    >
    > **The window line on a row.** Beside the two numbers, what happened inside the window:
    > `6 games · 4W 2L · +58`. The change is `displayRating(mu_after of the last counted game in the window) −
    > displayRating(mu_before of the first)` — the difference of two displayed numbers, `00-product.md`'s rule,
    > through `lib/ratingDisplay.ts` and no other arithmetic. On `All time` the row is exactly today's row and
    > gains nothing.
    >
    > **`/p/[puuid]`** takes the same parameter: the chart plots the window's games in order, the record and
    > the role breakdown count the window's games, and the reference line is the rating carried **into** the
    > window (labelled `start`), except on `All time` where it stays the seed line (`seed`) that ships today.
    > Its default is `All time`, because the page is a person's history and **M5.15** is about reading it;
    > a page that opens on six days of games would answer a question nobody asked it.
    >
    > ### The control
    >
    > Five options in the page header of `/leaderboard`, `/p/[puuid]` and `/stats`, in this order and with
    > these words: `This week` · `Last week` · `This month` · `Last month` · `All time`. Each is a plain link
    > to `?window=this-week|last-week|this-month|last-month|all-time` — a normal navigation, no client state,
    > no fetch, works with JavaScript off, and the selected one is marked and not a link. An unknown value is
    > `notFound()`; it can only come from a typed URL. Absent is the page's own default. **The parameter is
    > the same word on all three pages** and the control looks the same on all three (layout: **M5.8**).
    >
    > `Last week` and `Last month` are on the picker and not only behind a link from Discord: the Monday post
    > links to a board, and a board a reader cannot get back to after one tap elsewhere is a dead end. They
    > are also the only place the awards are readable on the web (M5.4).
    >
    > ### The nightly Discord post
    >
    > It stops naming a season. Title becomes `This week · leaderboard`, url `?window=this-week`, and the
    > board it prints is the week's board by the rules above, with each row's count being the week's games.
    > A season name in a Discord title was always going to read as `gamesd · leaderboard` on the deployment
    > that exists; more to the point, "the season" is no longer a thing the product has. The footer sentence,
    > the field-name rule (M3.22) and the ten-line cap are untouched.
    >
    > ### Copy
    >
    > All of it is in `05-design.md`'s board copy table (product, 2026-09-10) and one constant each in
    > `apps/web/lib/board/copy.ts`:
    >
    > - the five option labels above, used verbatim as the board heading beside `Leaderboard`;
    > - empty windows: `No games this week yet.` · `No games last week.` · `No games this month yet.` ·
    >   `No games last month.` · `No games yet.`;
    > - `NO_GAMES_YET` (`No games this season yet.`) is **deleted** — the word season leaves the product's
    >   friend-facing vocabulary entirely with this task.
    > - `NO_SEASON_BOARD` (`No season is active, so there is no board yet. An admin can start one.`) is
    >   deleted too; with **M5.14** there is no button behind that sentence, and a deployment with no season
    >   row has no games either, so the empty-window line is both true and enough.
    >
    > ### Edge cases
    >
    > - **A player who played this week and nothing since March.** On `This week` they are on the board with
    >   this week's games; on `All time` they are where they always were. Nothing marks them.
    > - **A player who has not played this week.** Absent from `This week`. Not greyed out, not at the bottom:
    >   the board is who played.
    > - **A window with one game.** One row, `1 game · 1W 0L · +43`, and the settling chip still follows the
    >   30-game all-time rule (it is a fact about the rating, not about the window).
    > - **A game backfilled into a closed week** changes `Last week`'s board the moment `rebuild-ratings` has
    >   folded it, and the Discord post from Monday stays as posted. Both are right; nothing tries to edit an
    >   old post.
    > - **An unrated game in the window** counts nowhere here, exactly as on `/leaderboard` today. M3.23's
    >   `Recent games` list on `/p/[puuid]` keeps showing it with `not rated`.
    > - **`?window=` on a page with no games at all** prints the empty line, never a blank card.
    >
    > ### Acceptance check
    >
    > 1. **Membership.** A fixture with a game last week and a game this week: `This week` lists only the
    >    players in this week's game; `Last week` only last week's; `All time` lists both sets.
    > 2. **The numbers.** On `Last week`, a player who played after the boundary shows their rating **as of
    >    their last game inside that week**, not their current one; on `All time` every row equals their
    >    `ratings` row to the printed number.
    > 3. **The order.** Rows are Proven descending on every window, and a player who climbed most in the week
    >    is *not* moved to the top by it.
    > 4. **The window line.** `6 games · 4W 2L · +58` counts only in-window games, and the change equals
    >    `displayDelta` over the window's first and last counted game — asserted against
    >    `lib/ratingDisplay.ts`, not recomputed in the test.
    > 5. **Defaults.** `/leaderboard` with no parameter is `This week`, `/p/[puuid]` is `All time`, `/stats`
    >    is `This month`; each names its window in the heading. An unknown `?window=` is a 404 on all three.
    > 6. **The player page.** The chart plots only the window's games and its reference line is the rating
    >    carried into the window, labelled `start`; on `All time` it is the shipped `seed` line, unchanged.
    > 7. **Empty windows.** Each of the five prints its own sentence; no page renders a blank card, a spinner
    >    or the word `season`.
    > 8. **The nightly post** is titled `This week · leaderboard`, links to `?window=this-week`, and prints
    >    the week's counts; `grep -r "season" apps/web/lib/board apps/web/lib/discord` finds no friend-facing
    >    string.
    > 9. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; the status row is updated.
    >
    > **Out of scope.** Any window that is not one of the five (no date pickers, no "since I joined"). Storing
    > a windowed board. Changing the sort, the floor, the settling rule or either number's name. The posts
    > (**M5.10**, **M5.13**). `/stats` itself (**M5.4**).

- [x] **M5.13** (landed 2026-09-11: `GET /api/cron/window`, `window_posts` claim table (migration 0011 on kustom), 10-minute lease with compare-and-swap for retries, empty windows stamped once; caller: Vercel Cron from `apps/web/vercel.json`, daily at 04:30 UTC for both `/api/cron/window` and `/api/cron/leaderboard`, `Authorization: Bearer <CRON_SECRET>` sent by Vercel when the project env has CRON_SECRET; the post is at-least-once by design) Fire the weekly and monthly post by itself, exactly once. *(owner: platform-engineer)* `GET /api/cron/window`, bearer `CRON_SECRET`, safe to call on any cadence: it posts a window only after that window has closed and only if it has not already posted it.

    > **Brief (product, 2026-09-10)**
    >
    > **Depends on M5.9** and **M5.10**. This is the task that makes "every week and every month" true without
    > anybody pressing anything.
    >
    > **The scene.** There is no button anywhere in this product that posts the week. If a friend has to
    > remember to press something on a Monday, it will be pressed twice one week and never again after that.
    >
    > **The door is the one that already exists.** Same shape as `GET /api/cron/sweep` and
    > `GET /api/cron/leaderboard`: a bearer `CRON_SECRET` compared in full, 503 when the variable is unset,
    > 401 on a bad token, `nodejs` runtime, `force-dynamic`. The **schedule lives outside the app** (Vercel
    > Cron or an uptime pinger, `04-decisions.md`) and the route is written so the schedule cannot get it
    > wrong: **call it hourly, daily or twice a minute and it posts each window exactly once.**
    >
    > **How once is guaranteed.** A new table, `window_posts (kind text, window_start timestamptz, posted_at
    > timestamptz default now(), primary key (kind, window_start))`, service-role only, one new numbered
    > migration. The route computes the most recently **closed** week and month from M5.9, inserts the row
    > first and posts only if the insert took (`on conflict do nothing`, check the row count) — insert-then-
    > post, not post-then-insert, because a duplicate post is a thing the group sees and a missed one is a
    > thing they ask about. If the webhook then fails, delete the row so the next call retries; a webhook
    > failure is not a posted week.
    >
    > **What it posts.** M5.10's embed for `last-week`, and on the 1st also for `last-month`. Both in the same
    > call, week first — on a Monday the 1st the group gets two posts in the order they read in.
    >
    > **The response** is `{ ok: true, posted: ['last-week'], skipped: [{ kind: 'last-month', reason:
    > 'already posted' }] }` under a zod schema like every other route. It never contains the webhook URL.
    >
    > **Edge cases.** (1) **First ever call**, with no `window_posts` rows and months of history: it posts the
    > one most recently closed week and, on the 1st, the one most recently closed month — never a backlog of
    > every week since March. (2) **A window with no games**: M5.10 returns nothing; the route records it as
    > posted anyway with `posted_at` set and logs the skip, so the empty week is not retried hourly for seven
    > days. (3) **The deployment is down all Monday**: Tuesday's first call posts last week, late and correct;
    > the post's own timestamp says when it was sent and its description says which week it covers. (4) **Two
    > calls land in the same second**: the primary key decides; the loser posts nothing. (5) **No webhook
    > configured**: 503-shaped skip with a reason, nothing written.
    >
    > **Acceptance check.** (1) Integration tests against the local stack: a call before the boundary posts
    > nothing; a call after it posts once; ten more calls post nothing and write nothing. (2) A forced webhook
    > failure leaves no `window_posts` row, and the next call posts. (3) On the 1st of a month, week and month
    > both go, week first; on the 2nd, only the week is considered. (4) A fresh database with a year of games
    > posts exactly one week and at most one month. (5) Wrong or missing bearer is 401/503 and writes nothing.
    > (6) The migration is applied to the hosted project and `packages/db/src/types.ts` is regenerated; the
    > route's schemas live with the others; `CRON_SECRET` is already in `.env.example`. (7) `pnpm -r typecheck`
    > and `pnpm -r test` pass and the status row is updated, with the chosen schedule (path, cadence, who
    > calls it) written into the row so the next person knows where the timer lives.
    >
    > **Out of scope.** What the post says (**M5.10**). Any UI, admin page or button that triggers it. Editing
    > or deleting a post that already went out. A daily version of it — rejected, `04-decisions.md`.

- [x] **M5.14** (landed 2026-09-10: the season route and form are gone, the seasons page is read-only, no migration) Remove season creation. *(owner: web-engineer; no migration)* `/admin/seasons` loses its name field, its typed confirmation and its `Start` button; `POST /api/admin/seasons` goes with them. The one season row is the one `0001_init.sql` already inserts, and after this task nothing can make a second.

    > **Brief (product, 2026-09-10)**
    >
    > **The user's words:** *"remove session creating."* With **M5.3** dropped, starting a season does nothing
    > any friend would want and everything they would not: it empties the board and cannot be undone. The
    > safest version of that button is the one that is not there.
    >
    > **What goes.** The form, the confirmation field and its copy (**M3.9**'s rule retires with it), the
    > `Start` action, the API route, and `startSeason` in `lib/admin/seasons.ts`. `/admin/seasons` becomes a
    > read-only line naming the season row and the date it started — one sentence, no action — or is dropped
    > from the admin nav entirely if nothing else needs it. The engineer picks; both are one screen of nothing.
    >
    > **What stays.** `public.start_season()` and `set_active_season()` stay in the database, unreachable, and
    > **no migration edits or drops them** — an applied migration is never edited (CLAUDE.md), and a function
    > nobody can call costs nothing. `active_season_id()`, `games.season_id` and M2.18's refusal all stay
    > exactly as they are.
    >
    > **The bootstrap already exists and needs no work.** `0001_init.sql` inserts `Season 1` with the fixed id
    > `00000000-0000-0000-0000-000000000001`, active, `on conflict do nothing` — so a fresh clone and a local
    > `db:reset` come up with a season and can save a game on the first night. Check that and write nothing
    > new. The hosted project has the user's own row (named `gamesd`) active instead, from a press of the
    > button this task removes; leave it exactly where it is, because with **M5.12** a season's name is never
    > printed to a friend again. Nothing can leave a database with zero active seasons after this: `0001`
    > opens one and `start_season` — the only thing that ever closed one — becomes unreachable.
    >
    > **Copy that becomes false and is rewritten here** (also in `05-design.md`'s copy table):
    >
    > - `NO_ACTIVE_SEASON_MESSAGE` — was `No season is active, so games cannot be saved. Start a season on the
    >   Seasons page.` Becomes: `Games cannot be saved: the database is missing its one season row.` It is an
    >   admin- and API-facing sentence for a broken deployment, so it names the fault and promises no button.
    > - `NO_ACTIVE_SEASON_TONIGHT_MESSAGE` — was `No season is active, so tonight's games are not being saved.
    >   An admin can start one.` Becomes: `Tonight's games are not being saved. Play on — they can be added
    >   back from match history later.` That is true (backfill, M5.1), it is the only thing the twenty people
    >   holding the WhatsApp link can act on, and it does not send them looking for an admin at 22:00.
    > - `NO_SEASON_BOARD` is deleted by **M5.12**.
    >
    > **Acceptance check.** (1) `grep -ri "start a season\|startSeason\|start_season" apps/web/app
    > apps/web/lib` finds nothing outside this doc. (2) `POST /api/admin/seasons` returns 404. (3) A local
    > `pnpm db:reset` comes up with exactly one active season and an end-of-game post saves. (4) Nothing in
    > the app can produce a second `seasons` row: no route, no page, no script. (5) With the season row
    > deleted by hand, the post is refused with the new sentence and the tonight page prints the new one.
    > (6) `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter web build` pass; the status row is updated.
    >
    > **Out of scope.** Deleting the SQL functions or the table. Renaming the existing season row, or any
    > migration at all. Any change to how a game is attributed (**M5.9**) or to the rebuild.

- [x] **M5.15** (landed 2026-09-10: the seed line above the chart, one caption per `Recent games` row — `As the 58% side.`, the chance clause alone, because the row's head already prints the result and the change — and one explanation line under the list in the explanation-strip dress; the chance is the chosen split's `blue_win_prob` for the player's own side, read for the five rows on screen; the change is `formatWebDelta(displayDelta(...))`, the column's own string; copy in `lib/board/copy.ts`, composition in `lib/board/explain.ts`; three readings the copy table did not fix are in `04-decisions.md`. **Per-role ratings were considered and rejected** — the row is in `04-decisions.md`, 2026-09-10) "How you got here": say why each rating change on `/p/[puuid]` is the size it is. *(owner: web-engineer)* From the user, 2026-09-10: *"can we explain rankings on each player how he achieved this rank so remove doubt."* Every number this needs is already stored; nothing new is computed and no migration is added. **Copy source of truth (2026-09-10):** the strings quoted in this brief are superseded by the `05-design.md` board copy table; read from there.

    > **Brief (product, 2026-09-10)**
    >
    > **The scene.** Somebody is sure the bot is wrong about them. They open their own page and read, in order:
    > where they started, and then every game since — what the balancer thought their side's chances were, what
    > happened, and what it cost or paid. Nothing to click, nothing to ask anybody for. **A number you can
    > retrace is a number you stop arguing with**, which is the same reason the split posts its win chance
    > (`00-product.md`, principle 3).
    >
    > **The seed line**, once, above the chart: `Seeded from Gold II at 1469, 37 games since.` The tier and
    > division are `players.rank_tier` / `rank_division` formatted in title case (`Gold II`, `Master`,
    > `Unranked` when the client reported none), the number is `displayRating` of the seed the fold used, and
    > the count is `ratings.games`. **This is the same seed the chart's reference line already draws** — one
    > value, read once, so the line and the sentence cannot disagree. Until **M5.7** stores the seed, it is
    > computed from the player's current rank and carries the caveat M5.2's brief already documents; M5.7
    > makes it exact and changes no word of this copy. On `All time` only (**M5.12**): in a week or month
    > window the line reads `Started the week at 1469, 6 games since.`
    >
    > **The per-game sentence**, on every row of `Recent games` (M3.23's list):
    >
    > - `Won as the 42% side, +43`
    > - `Lost as the 58% side, -31`
    > - no win chance stored: `Won, +43` / `Lost, -31`
    > - not rated: `not rated` and nothing else, exactly as M3.23 ships it — no chance, no change.
    >
    > The percentage is the chance **their side** was given: the chosen split's `splits.blue_win_prob` for the
    > game's lobby when they were on side 100, `1 − blue_win_prob` when they were on 200, `Math.round(p × 100)`.
    > The change is `displayDelta(mu_before, mu_after)` through `lib/ratingDisplay.ts` — the difference of two
    > displayed numbers, never a separately rounded figure — and it is the same string
    > `formatWebDelta` already prints beside it, so the sentence and the column can never disagree.
    >
    > **One line under the list, once**, which is the whole point of the task:
    > `Beating the favoured side moves you more than beating the underdog, and the board moves you more while
    > it is still unsure about you.` No maths, no formula, no link to a paper.
    >
    > **Where the win chance comes from and when it is missing.** `games.lobby_id` → the lobby's chosen split
    > (`splits.is_chosen`) → `blue_win_prob`. It is null for every backfilled game (no lobby), for a game whose
    > lobby row was cleared (`on delete set null`), and for any game the group played without the bot. Those
    > rows drop the clause and keep the result and the change; **no row invents a chance and no row is hidden.**
    >
    > **Per-role ratings were considered and rejected (product, 2026-09-10).** Five ratings each needing about
    > thirty games to settle is months of nightly play for one player on a group that plays one to three games
    > a night, so every per-role number would sit in the `settling` state permanently and the board would get
    > less trustworthy, not more. The balancer already charges for playing off your main (`offRolePenalty`),
    > and "how do I do on jungle" is answered by win rate by role on `/stats` (**M5.4**) without splitting the
    > rating. **Revisit if**, after 100+ games each, several players' per-role win rates diverge sharply — that
    > would be evidence one rating is hiding something, and the evidence would already be on `/stats`.
    >
    > **Acceptance check.** (1) Every row of `Recent games` for a player with a lobby-born game carries its
    > win-chance sentence, and the percentage equals `blue_win_prob` (or its complement) rounded, for their
    > own side. (2) A backfilled row prints `Won, +43` with no chance and no placeholder. (3) An unrated row is
    > untouched by this task. (4) The seed line names the tier and division as words and the displayed number,
    > and it equals the chart's reference line to the point. (5) A player with no games shows the seed line and
    > no list, and never `NaN`, `0` or an empty section. (6) Every number printed is byte-identical to what
    > `lib/ratingDisplay.ts` produces — asserted by calling it in the test, not by re-rounding. (7) The
    > explanation line renders once per page, not per row. (8) `pnpm -r typecheck`, `pnpm -r test` and
    > `pnpm --filter web build` pass; the strings are in `05-design.md`'s copy table; the status row is updated.
    >
    > **Out of scope.** Per-role ratings (above). Showing the other nine players' numbers on somebody's page.
    > A "why" on the leaderboard row or in Discord. Recomputing or explaining the rating model itself — this
    > task prints stored numbers and one sentence about them.

- [x] **M5.16** (landed 2026-09-10: `inferRoles(games, window?)` from `@customs/core`; `startedAt` is `string | number` and the function sorts itself; a count tie breaks to the more recent role, then lane order; `counted` is reported under the threshold for the admin line) Infer a player's main and backup role from their own games. *(owner: core-engineer)* Pure function in `packages/core`, tested. From the user, 2026-09-10: *"for roles can we have roles auto assigned based on the frequency of the players and changable by time automatically."*

    > **Brief (product, 2026-09-10)**
    >
    > **The scene.** Nobody has ever set their role and nobody ever will. A friend who has played support for
    > three weeks is a support to the balancer, and the week they start playing jungle every night, the
    > balancer notices by itself. This is the last piece of manual data in the product; after **M5.17** the
    > roster is entirely read from play.
    >
    > **The rule.**
    >
    > - Count `game_players.role` — the position the client detected — over the player's **last 20 counted
    >   games, most recent first** (counted = the rating fold's universe, M5.4). Rows with a null role do not
    >   count and do not consume a slot.
    > - **Main** is the most frequent role, **backup** the second most frequent.
    > - **Ties break to the more recent**: of two roles with the same count, the one whose most recent game is
    >   later wins. Deterministic, and it is the honest tiebreak — the question is what they play *now*.
    > - **Fewer than 3 counted role rows: main is `flexible` (null), no backup.** That is exactly the
    >   balancer's existing behaviour for a player with no roles set (M1.4), so a newcomer is filled into
    >   whatever is left, which is what already happens today and needs no new code path.
    > - A player with exactly one role in the window has a main and **no backup**. Never invent a second role.
    >
    > **The feedback-loop guard, which is the reason this task has a brief.** A game does **not** count toward
    > inference if the balancer put the player off both their then-main and then-backup. Without it the loop
    > eats itself: a support who gets filled into jungle twice becomes a jungle main, gets balanced as a
    > jungler, and is never a support again — the product would have invented a role for somebody and then
    > insisted on it. With it, being filled is a thing that happens *to* you and never a thing that changes
    > who you are. **The role-for-tonight tap (M3.6) is the intended way to change**: the tap makes that role
    > your main for the night, you are then balanced on-role, and the game counts. Playing a new role on
    > purpose moves you; being forced into one does not.
    >
    > The guard needs the roles the player had **at the time of that game**. The caller supplies them —
    > `game_players` stores the role played, and the assignment's on/off-role status is what M5.17 records
    > when it folds the game. The pure function takes a list, not a database.
    >
    > **The surface.**
    >
    > ```ts
    > export interface RoleGame { role: Role | null; startedAt: number; countsForInference: boolean; }
    > export interface InferredRoles { main: Role | null; secondary: Role | null; counted: number; }
    > export function inferRoles(games: readonly RoleGame[], window?: number): InferredRoles;
    > ```
    >
    > `window` defaults to `config.roles.inferenceWindow = 20` and the threshold
    > `config.roles.minGames = 3` sits beside it — two numbers in `packages/core`'s config, not literals in a
    > loader. `counted` is how many games the answer rests on, so the admin page can print it.
    >
    > **Why 20 and 3.** Twenty counted games is about two weeks for a regular and a month for somebody who
    > plays half the nights: long enough that one odd evening does not move a main, short enough that a real
    > change shows up inside a fortnight — "changable by time", which is what was asked for. Three is the
    > smallest number that is not one lucky fill.
    >
    > **Acceptance check.** Unit tests in `packages/core`, no I/O, no `Date.now()`.
    > (1) Twelve support games and five jungle games gives `support` / `jungle`. (2) A 5–5 tie gives the role
    > with the later most recent game, under both insert orders. (3) Two counted games gives
    > `{ main: null, secondary: null, counted: 2 }`; the third flips it. (4) Only games inside the window of 20
    > count: a player with 30 games whose first 15 were mid and last 15 jungle comes out jungle-first.
    > (5) A game with `countsForInference: false` changes no count — a support filled into jungle five times
    > stays a support. (6) Null roles are skipped and do not consume a window slot. (7) One role only gives a
    > main and a null secondary. (8) The function is pure and total: an empty list is `{ null, null, 0 }`.
    >
    > **Out of scope.** Reading or writing the database, deciding when to recompute, the admin page
    > (**M5.17**). Roles for backfilled games (**M5.18**). Any change to the balancer, the off-role penalty or
    > the role-for-tonight tap (M3.6).

- [x] **M5.17** (landed 2026-09-10: migration 0010 on kustom with `game_players.counts_for_role_inference`, `players.roles_inferred_at` and `roles_counted`; the flag is written in the same statement as the rating claim against the chosen split via `resolveRoles`; recompute after every rated fold and over every player at the end of `rebuild-ratings`; `/admin/players` shows the pair read-only and `set-roles` answers 410; the tonight page's `Set roles` link is removed) Store the inferred roles and take the role selectors off `/admin`. *(owner: web-engineer)* Recompute after every rated game and after every rebuild; `/admin/players` shows the inferred pair read-only with the count behind it. From the user, 2026-09-10: *"remove the role select automatically from admin."*

    > **Brief (product, 2026-09-10)**
    >
    > **Depends on M5.16.** Needs no new balancer work: it writes the same two columns the balancer already
    > reads.
    >
    > **Where the answer goes.** `players.main_role` and `players.secondary_role` — unchanged columns, so
    > nothing downstream moves — plus one new `players.roles_inferred_at timestamptz` and
    > `players.roles_counted int`, in one new numbered migration, so a page can say how fresh the answer is and
    > how many games it rests on. **The M1-era hand-set roles are overwritten by the first recompute.** That is
    > the intended outcome and it needs no data migration: the games are the truth and they are already stored.
    >
    > **When it runs.** After every rated game (in the same path that folds the rating, for the ten players in
    > it) and at the end of `rebuild-ratings` (for everybody). Nowhere else — no cron, no button, no recompute
    > on page load. A player's pair changing is not an event anything announces.
    >
    > **The guard's input.** When the fold records a game, it knows whether each player was on their main or
    > backup at that moment (the balancer's own assignment produced the split's off-role list, and M3.6's tap
    > makes the tapped role the main for the night). Record it per `game_players` row — one boolean column,
    > `counts_for_role_inference`, in the same migration — rather than reconstructing it later from roles that
    > have since changed. A backfilled game has no assignment and counts (**M5.18**): nobody forced it.
    >
    > **`/admin/players`.** The two role `<select>`s go. The row shows `support · jungle · from 17 games` in
    > plain text, or `flexible · from 2 games` under the threshold, or `flexible · no games yet`. **M3.25**
    > (the admin paging task) drops them too rather than paginating a control that is being removed; whichever
    > lands second does the deleting. Everything else on the page — display name, Discord link, admin flag —
    > is untouched, and this page stays plain (`05-design.md`).
    >
    > **What a friend sees.** Nothing new. Their role on the tonight page and in the teams post is the same
    > field it always was; it just now comes from what they play. The one control they have is the same one
    > they had: the role-for-tonight tap (M3.6).
    >
    > **Edge cases.** (1) **A player with no games** keeps `flexible` and is filled by the balancer as today.
    > (2) **A player whose roles change mid-night**: the recompute happens after a game, so tonight's next
    > split uses the new pair — correct, and invisible. (3) **The tap (M3.6) and the inferred main disagree**:
    > the tap wins for that night, exactly as M3.6 says, and its game counts toward inference, so a player who
    > taps jungle for a week becomes a jungle main by playing there. (4) **A rebuild after a big backfill**
    > can move several people's pairs at once; that is the correct answer arriving late, and it is silent.
    > (5) **Ten players, one recompute each, on the end-of-game path**: it is one extra query per game, not
    > per request; keep it inside the same transaction-ish path as the fold and never on the lobby-post path.
    >
    > **Acceptance check.** (1) An integration test folds three counted games with known roles and reads the
    > inferred pair off `players`, with `roles_counted = 3` and `roles_inferred_at` set. (2) A fourth game
    > where the balancer put a player off both their roles leaves their pair unchanged and does not raise
    > `roles_counted`. (3) `rebuild-ratings` recomputes everybody and is idempotent — a second run changes no
    > role column. (4) A player under the threshold has `main_role` null and the balancer fills them exactly as
    > it does today (an existing M1.4 test still passes). (5) `grep -r "main_role" apps/web/app/admin` finds no
    > form control, and the page renders the read-only line in all three shapes. (6) A hand-set role from M1 is
    > overwritten on the first recompute and nothing errors. (7) The migration is applied to the hosted project
    > and `packages/db/src/types.ts` regenerated. (8) `pnpm -r typecheck`, `pnpm -r test`,
    > `pnpm --filter web build` pass; the status row is updated.
    >
    > **Out of scope.** The inference rule itself (**M5.16**). Backfilled roles (**M5.18**). Any change to the
    > balancer, to M3.6's tap, or to what a role means. A per-player history of role changes — nobody has asked
    > to see one.

- [~] **M5.18** (mechanism, CLI `timeline-roles`, `smoke --game-id` overlays and the empty table landed 2026-09-10; the one overlapping fixture proves nothing and the one 5v5 detail refutes the name-based pairs, so no pair is mapped on 16.17 until the documented capture night: record-ws during play, `smoke --game-id` next day, `timeline-roles`) Give backfilled games a role. *(owner: companion-engineer)* Match-history detail carries no `detectedTeamPosition`, so every backfilled game stores `role: null` (M5.1) and is invisible to role stats and to role inference. Map the detail's `timeline.lane` / `timeline.role` pair to our five roles with a table verified against the fixtures, and record it in `03-lcu-reference.md`.

    > **Brief (product, 2026-09-10)**
    >
    > **Why now.** Two tasks depend on it and both degrade quietly without it: `/stats`'s role blocks
    > (**M5.4**) print a footnote counting every backfilled game as "the client did not record who played
    > where", and role inference (**M5.16**, **M5.17**) sees only live games, so a player whose history is
    > mostly backfill is `flexible` for weeks. Neither is broken; both are thinner than they need to be.
    >
    > **The rule this task must respect (CLAUDE.md).** An endpoint or field marked `unverified` may not be
    > depended on. `timeline.lane` / `timeline.role` is a **different vocabulary** from ours (M5.1's brief says
    > so) and nothing has checked it maps. **Verify offline first**: the 2026-09-08 fixtures contain games whose
    > real positions are known from the live captures of the same games, so the mapping can be checked without
    > a client and without a friend. If a pair cannot be mapped with confidence, it maps to **null** — an
    > invented role is worse than a missing one, because it silently moves somebody's main.
    >
    > **What ships.** (1) A pure mapper in `packages/lcu` (or the backfill mapper beside M5.1's, wherever the
    > detail is already parsed) from `(lane, role)` to `'top' | 'jungle' | 'mid' | 'adc' | 'support' | null`,
    > with a table of every pair seen in the fixtures and what it maps to. (2) The backfill payload carries the
    > mapped role, so `game_players.role` is filled for backfilled games. (3) The verified table, with the
    > patch it was read on, written into `docs/03-lcu-reference.md` and its status moved off `unverified`.
    >
    > **Edge cases.** A pair the table does not know maps to null and is logged once with its values, so the
    > next fixture pass can add it. A game where the mapping produces two junglers or no mid is stored as
    > mapped — this task does not repair a scoreboard, and M5.4's numbers survive a duplicate role. Games
    > already stored keep their null role until a re-backfill or a rebuild that re-reads details; **nothing
    > rewrites a stored row** (M5.1's dedupe rule), so the honest claim is "backfilled from here on".
    >
    > **Acceptance check.** (1) Unit tests map every `(lane, role)` pair in the fixtures to the position the
    > live capture of the same game recorded, with zero mismatches; an unknown pair maps to null. (2) A
    > backfill run against the fixtures produces `game_players.role` non-null for every participant of a game
    > whose pairs are all known. (3) `03-lcu-reference.md` carries the table, the patch and the evidence, and
    > no field it names is still marked `unverified`. (4) With the mapper in place, M5.4's no-role footnote
    > counts only the games that genuinely could not be mapped. (5) `pnpm -r typecheck` and `pnpm -r test`
    > pass; the status row is updated.
    >
    > **Out of scope.** Champion, KDA or any other backfilled column. Re-reading games already stored.
    > Anything about the live end-of-game block, which already carries the position.

    > **Pointer (product, 2026-09-15): the same capture night also answers M5.35.** M5.35 reads two more
    > fields out of the `ws-events.ndjson` this task's step 1 already records — `selectedPosition` /
    > `selectedRole` at `GameStart` — to settle whether the client knows the roles before the game instead of
    > after it. It adds no step to the night, no endpoint and no companion behaviour, and **M5.18's brief,
    > acceptance and rule are unchanged by it**: whatever M5.35 finds, backfilled games still get their role
    > from the `timeline` pair or from nothing.

- [x] **M5.20** (landed 2026-09-11: role and side records, three best and three worst partners with no overlap, current and longest streaks from the shared helper, the mean game, the award line for all three awards; `PlayerBoardView.roles` deleted; two seams recorded in the decisions log) The per-player stats sections on `/p/[puuid]`: their role record, their side record, their partners, their streaks, their average game length, and the award line. *(owner: web-engineer; after **M5.8**)* **Copy questions for product with this task (designer, 2026-09-10):** the window's game count prints three times in one band on `/stats` (the slot line and both group statements); and an empty window offers no way onward, so decide whether a line points at the nearest window with games or silence is right.
- [x] **M5.21** (landed 2026-09-11: the board and the rail read their streak from the stats fold over the same window as the player page; `STREAK_GAME_WINDOW` gone; the seam is recorded) One streak, one window. Reviewer, 2026-09-11: the leaderboard row's streak is folded from rated rows over the season's last 200 games (`STREAK_GAME_WINDOW` in `lib/board/load.ts`, sorted by `Date.parse(startedAt)` with no `lcu_game_id` tie-break), while `/stats` and the player page fold counted games over up to 2000 ordered by `started_at, lcu_game_id`; a player whose last game is older than the group's last 200 shows no streak on the board and a real one on their page, and a backfilled game awaiting rebuild is in one and not the other. Make the board row read its streak from the same stats fold over the same window (the rail included), delete `STREAK_GAME_WINDOW`, and keep the rated-vs-counted seam documented. Owner: `web-engineer`, after M5.20. **Acceptance:** `playerStats.integration.test.ts`'s streak-equality case holds for a player whose last game is 250 games back; `grep STREAK_GAME_WINDOW apps/web` is empty.
- [x] **M5.22** (landed 2026-09-11 with M5.20) The count leaves the two `/stats` group statements (product, 2026-09-11): `Blue wins 69% of the time.` and `Average game 35 min.` with no ` · 32 games` half, since the slot above prints the same number; `blueWinLine` and `averageGameLine` lose their `games` argument and gain the stop; `playerAverageGameLine` is deleted and the player page calls `averageGameLine`. Owner: `web-engineer`, lands as its own commit on the M5.20 branch (lead widened the scope by one clause). **Acceptance:** the count appears exactly once in the `/stats` header band (test); one average-game string in `lib/stats/copy.ts`; the slot unchanged.
- [x] **M5.23** (landed 2026-09-11: `WindowSlot` shared by the three pages, the empty sentence in the slot in dim with the hairline; M5.8 rule 6 rewritten) One empty-window sentence, one dress. Designer, 2026-09-11: `/leaderboard` and `/p/[puuid]` print the window's empty sentence in the header slot in `dim`; `/stats` prints it in the body in `text` under a bare strip (M5.8 rule 6). Decide once (the designer rules; M5.8's rule 6 was written for a page whose whole subject is the window) and make the three pages match. Owner: `web-engineer`, with M5.21. **Acceptance:** the three pages render the empty sentence in the same element with the same class; one component or one shared rule; the M5.8 section amended.

    > **Split out of M5.4 (product, 2026-09-10).** M5.4 shipped `/stats`, the awards and every pure
    > function these sections need; it did not render them on the player page. This task is the rendering,
    > and it waits for **M5.8**, which is the pass that says what they look like under a rating chart
    > ("the per-player stats sections on `/p/[puuid]` below the rating chart" is already in M5.8's list).
    > **Nothing here is new work product invented.** Every clause below is quoted from the M5.4 brief of
    > 2026-09-09 as amended for windows on 2026-09-10, and the numbers, the minimums and the tie rule are
    > that brief's — read it for them.
    >
    > **The scene.** Still not the ten-in-voice scene. This is the friend who lost four in a row, opened
    > their own page to work out whether it is them or the teams, and found a chart and a list of games.
    > `/stats` answers "who is best on jungle"; this answers "how do **I** do on jungle", which is the
    > question the M3.5 brief already said belongs on this page and not in a second board.
    >
    > ### What renders, quoted
    >
    > - **Where:** "Per-player sections on `/p/[puuid]`, below the rating chart: their role record, their
    >   side record, their partners, their streaks, their average game length."
    > - **How:** "The player page calls the same loader and picks one player out of the answer" —
    >   `apps/web/lib/stats/load.ts`, `STATS_MAX_GAMES`, `revalidate = 300`, and the shared gate
    >   `gateGame`. No second query path, no predicate re-implemented in SQL, no precomputed table.
    > - **Role record:** `game_players.role`; null-role rows "are excluded from every role number";
    >   "**Minimum 5 rows for a percentage**; under 5 the record prints without one (`3W 1L`)".
    > - **Side record:** "their rows on side 100 and on side 200, same 5-row minimum for the percentage".
    >   The group's blue rate is `/stats`'s headline and is not repeated here.
    > - **Partners:** "`/p/[puuid]` shows that player's three best and three worst partners" — same side
    >   only, "**Minimum 5 games together** to appear at all", ordered by the brief's tie rule.
    > - **Streaks:** "**Current streak**: the run ending at their most recent counted game, printed `W3` /
    >   `L2`", plus "**Longest win streak** and **longest losing streak** of the season, per player". The
    >   helper is the one that already exists; "two definitions of a streak in one app is a bug".
    > - **Average game length:** "the mean over their counted games", rounded to the minute. "Zero games →
    >   the empty line, never `NaN` and never `0 min`."
    > - **The award line:** "On `/p/[puuid]`, a player who won an award in a closed window gets one line in
    >   that window's section: `Most improved, week of 1 Sep.` / `Most improved, September.` No badge, no
    >   icon." `All time` has no awards, so this line exists only on `Last week` and `Last month`.
    > - **The window:** every section is read through the page's selected window (**M5.12**), which
    >   defaults to `All time` here. The sections follow the picker like the rest of the page does.
    >
    > ### Edge cases (the brief's, and the two this page adds)
    >
    > - **A player with no counted game in the selected window.** The sections print their empty lines;
    >   the page still renders its header, the seed line's window rule (**M5.15**) is unchanged, and
    >   nothing is a spinner and nothing is a blank card — the M3.5 rule.
    > - **Every role null** (a player whose games are all backfilled): the role section prints the
    >   footnote's per-player equivalent and no role rows. The footnote's words are `/stats`'s; a
    >   per-player form is copy and comes to product.
    > - **A player with no main role** (`flexible`, M5.17) has no off-role anything on this page; the
    >   off-role award is `/stats`'s and is not recomputed here.
    > - "A player with no display name uses the same fallback as every other surface, never a raw PUUID."
    > - "A pair that played 5 games together and 40 against each other" — only same-side games count.
    >
    > ### Acceptance check
    >
    > 1. **The loader.** The page reads `lib/stats/load.ts` and selects one player out of its answer;
    >    `grep` finds no second stats query and no second copy of `gateGame`'s predicate.
    > 2. **Role.** A player 12W 5L on jungle and 1W 0L on mid shows `71%` for jungle and the bare record
    >    `1W 0L` for mid; null-role rows change no number on the page.
    > 3. **Side.** A player with 4 games on red shows a record and no percentage; at 5 the percentage
    >    appears.
    > 4. **Partners.** Three best and three worst; a partner at 4 games together is absent and at 5 is
    >    present; a game played on opposite sides counts for neither numerator nor denominator.
    > 5. **Streaks.** The current streak reads `W3` / `L2` and equals the `W3` the leaderboard row prints
    >    for the same player on the same window, from the same helper; longest win and longest losing
    >    streak match a hand-computed fixture under shuffled insert orders (the `lcu_game_id` tie-break).
    > 6. **Average game length** equals the mean of `duration_s` over that player's counted games, rounded
    >    to the minute; a player with no counted games in the window prints the empty line, never `0 min`
    >    and never `NaN`.
    > 7. **The award line.** On `Last month`, September's most-improved winner's page prints
    >    `Most improved, September.` and nobody else's does; on `This month` and on `All time` no page
    >    prints it. No badge, no icon.
    > 8. **The window.** Switching the picker changes every section on the page; `All time` is the default
    >    with no parameter.
    > 9. **Copy.** Every friend-facing string these sections add — the section labels and the empty lines —
    >    is in `05-design.md`'s copy table before merge, written by product, and lives in
    >    `lib/board/copy.ts` or `lib/stats/copy.ts` and not in a component.
    > 10. **The dress is M5.8's**, and this task ships what M5.8 drew rather than a layout of its own.
    > 11. `pnpm -r typecheck` and `pnpm -r test` pass; the status table row is updated.
    >
    > ### Out of scope
    >
    > Everything M5.4 put out of scope, unchanged: champion stats, KDA, gold, damage, CS, head-to-head
    > and rivalries, anything per-night, filters, search, sorting, CSV, a precomputed table. Also: any
    > change to `/stats` itself, to the awards, to the rating model or to the two names `Proven` and
    > `Rating`.

- [x] **M5.24** (landed 2026-09-12: `/fun` reads the scoreboard columns `game_players` already stores — kills, deaths, assists, gold, damage, CS — through the same window and `gateGame` universe `/stats` uses; first blood and vision stay named as missing because they are not stored) Fun facts page: single-game records and CS high/low per role. **Does not change `/stats`, the awards, or the rating model.** First blood and vision need a later persist if the group wants those tables filled.

- [x] **M5.25** (landed 2026-09-12: `/games` lists captured customs newest first, expandable into both scoreboards from the columns `game_players` already stores; `?p=` is one person's list with their own Won/Lost and KDA; no champion art, no items) Game history page. Same window picker as the board, default `This week`. Same anon read as `/stats`. Lists every captured game in the window, not only `gateGame`'s — a remake still happened, and `/p/[puuid]` already lists it. **Does not change `/stats`, the awards, or the rating model.**

- [x] **M5.26** (landed 2026-09-12: `/games` and `/fun` default to Summoner's Rift; a second chip row toggles ARAM via `?queue=aram`. Mode is read from `games.raw.gameMode` — no migration. CLASSIC and a missing mode are Rift; KIWI is on neither list. `/fun` hides CS-by-role on ARAM. `/stats` and the rating fold stay mixed.) Split ARAM off the game history and the fun records. **Does not change `/stats`, the awards, or the rating model.**

- [x] **M5.27** (landed 2026-09-12: `/fun` reads first blood, steals, longest life and draft bans from `games.raw` — no migration. First Blood Museum names the killer, their champion and the night; the victim and the in-game clock are not in the block. Death Hall folds deaths and deathless streaks from the scoreboard. Objective Thief is Rift-only. Fear Ban is enemy bans of a person's most-played champion over at least five games.) Fill the museum from the blob the companion already stores. **Does not change `/stats`, the awards, or the rating model.**

- [x] **M5.28** (landed 2026-09-12: a one-game `/fun` record opens the same scoreboard `/games` uses, behind `This game`, a `<details>` with the holder's row marked. Habits and window totals do not expand.) Remember the custom that set the number. **Does not change `/stats`, the awards, or the rating model.**

- [x] **M5.29** (landed 2026-09-12: First Blood Museum is grouped by the killer with a hairline between people and **See games** when they have more than one; First Blood Donated is the same list for who died, filled only from `firstBloodDeath` — never inferred — and hidden when that flag is missing; Pentakill / Quadrakill / Triple / Double museums and First Turret fold the stored count and `firstTowerKill` fields the same way; Longest killing spree is a one-game record from `largestKillingSpree` (at least three); every English title carries an Egyptian 3ameya roast, not a translation; deathless games and Career thief reopen those customs; a steal names the objective when the block recorded exactly one epic type; Most banned / Most picked are lobby tables, not a person's, and Most banned is filled from `teams[].bans` including a later copy onto live eog rows that never stored the list; the open scoreboard fills missing roles for display only from `games.raw` and sits in lane order. No migration. `/stats` and role inference stay on stored `game_players.role`.) Tighten the museum and the sheet. **Does not change `/stats`, the awards, or the rating model.**
- [x] **M5.30** (landed 2026-09-13: `/leaderboard` rows with rated games in the open window are a closed `<details>`; opening one lists those games newest first with `Won`/`Lost`, the night, the duration and `1512 (+43)` from `game_players.mu_before`/`mu_after`; the tonight rail does not attach the list; no new table.) Show how the week's number was made. **Does not change the rating model.**
- [x] **M5.31** (landed 2026-09-13: `/fun` **Who they lock** ranks people with at least five counted games that named a champion — **One-trick** / اكتر واحد معرق by share on one champion, **Always a new champ** / لعيب بيلعب بشامبيونات مختلفة by distinct champions; each row is a closed `<details>` that opens **See champs** into `Ahri × 12`. Comfort blanket is gone; this is that habit as a list.) OTP vs variety. **Does not change `/stats`, the awards, or the rating model.**
- [x] **M5.32** Daily Mystery. One interesting custom-game performance per civil day, identity hidden, six names, progressive clues, one locked guess per anonymous visitor. No accounts and no named leaderboard: First Detective, clue-then-time percentile (quiet under 10 correct), and "who did everyone blame?" after lock-in. Same card on `/` and `/mystery`. Migration `0013` is service-role only so the answer never ships in the first GET. Selection prefers unusual KDA / CS / tank / ghost games and skips a recently used match or player. Rotates at 00:00 in `CUSTOMS_NIGHT_TZ`. Owner: `platform-engineer` + `web-engineer`.

    > **Acceptance.** `GET /api/daily-mystery` does not contain the answer, later clues, or guess
    > distribution. A second visitor on the same civil day sees the same challenge id. `POST .../guess`
    > twice with the same visitor id is one row. Two concurrent first-correct posts: one `first_correct_at`.
    > A closed return visit refreshes community numbers and refuses a second guess. Floodlit: no emoji,
    > no "Ahmed is #1". Empty database: the card says there is nothing to expose and `/` still loads.

- [x] **M5.33** (landed 2026-09-13: `/fun` **Luck** ranks people by how often they were the lowest KDA on the winning side — **Lucky trash** / المحظوظ طرش — or the highest KDA on the losing side — **Most robbed** / المظلوم بزيادة; each row is `2 times` and a closed `<details>` that opens **See games** into `0/8/1 · Alistar`. One person per side per custom, ties broken by deaths then takedowns then name. Won ugly / Lost pretty stay the one-game extremes.) Lucky trash vs most robbed. **Does not change `/stats`, the awards, or the rating model.**

- [x] **M5.34** (landed 2026-09-15: `weekdayOf` in `apps/web/lib/night.ts` made Sunday-first; `weekStart`'s formula untouched, so the anchor lives in one expression. Every fixture/comment/example string re-anchored; the cron and `windowPosts.ts` needed no logic change, confirmed by reading both — verified in review, no day-of-week test anywhere. The hosted flip-day overlap was stamped in `window_posts`, confirmed via a hosted read/write, so the group never saw a duplicate board.) The week starts on **Sunday**. `weekStart` in `apps/web/lib/night.ts` rolls back to the most recent Sunday 06:00 in `CUSTOMS_NIGHT_TZ` instead of the most recent Monday 06:00. The 06:00 hour, the night boundary and the month boundary do not move. **Does not change `/stats`, the awards, or the rating model.** *(owner: `platform-engineer`; **runs before M7.3**, whose brief is written off this anchor)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Why now
    >
    > The group's week runs Sunday to Thursday — Egypt's working week — and the app has been cutting it on
    > the ISO Monday since M5.9, which is a default nobody chose. A board headed `This week` that opens on a
    > Monday splits the group's own week in half and puts Sunday night's customs at the end of the week that
    > is already over. This is a one-line rule change and a lot of expected strings; it is queued ahead of
    > **M7.3** only because M7.3 builds the weekly rating's reseed on this exact boundary, and a task that
    > reseeds on the wrong day would have to be redone.
    >
    > ### What a player sees
    >
    > `This week` on `/leaderboard` covers **Sunday 06:00 to Sunday 06:00**. The slot under the picker reads
    > `Sunday 13 Sep to Saturday 19 Sep` instead of `Monday 14 Sep to Sunday 20 Sep`. The weekly board and its
    > three awards arrive in Discord on **Sunday morning** rather than Monday morning, with nobody pressing
    > anything, exactly as today. Nothing else on any page moves: the night is still 06:00 to 06:00, `This
    > month` is still the calendar month, and no rating changes by one digit.
    >
    > ### The rule
    >
    > The week containing an instant opens at **06:00 local on the most recent Sunday**, read off the *night's*
    > 06:00 boundary and not off the raw instant — the M5.9 reasoning, unchanged, for the same reason it was
    > written. How that is expressed (`weekdayOf`'s numbering, the offset it is subtracted from) is the
    > engineer's call; the product rule is the anchor day and nothing else.
    >
    > Unchanged, and a diff that touches any of them is a diff that went wrong: `NIGHT_START_HOUR`,
    > `nightStart`, `nightEnd`, `civilDayStart`, `monthStart`, `windowRange`'s half-open `[start, end)` shape,
    > `closedWindow`'s key derivation, `isInWindow`, `DEFAULT_NIGHT_TIME_ZONE`.
    >
    > ### Files this reaches
    >
    > - `apps/web/lib/night.ts` — `weekStart` itself, and the comments that name the day around it: the window
    >   section's header block, `weekStart`'s own doc, `formatWeekday`'s and `formatWeekRange`'s examples.
    > - `apps/web/lib/night.test.ts` — the `weekStart` cases and the `/^Mon .* 06:00$/` property assertion.
    > - `apps/web/app/board.integration.test.ts`, `stats.integration.test.ts`, `playerStats.integration.test.ts`
    >   — fixed instants and expected strings (`Monday 1 Jun to Sunday 7 Jun`, `Monday 4 May to Sunday 10 May`,
    >   `Most improved, week of 6 Jul.`) all shift by a day. **This is the bulk of the work**, and the fixtures'
    >   *comments* explain which weekday each seeded game sits on, so they have to be re-read, not sed'd.
    > - `apps/web/app/api/cron/window/route.ts` and `apps/web/lib/discord/windowPosts.ts` — **comments only**,
    >   see below.
    > - `apps/web/app/_board/WindowSlot.tsx`'s example comment and `PlayerView.test.tsx`'s fixture strings.
    > - No migration, no schema change, no `vercel.json` change, no new command.
    >
    > ### The cron does not need a code change, and here is why
    >
    > Checked against the source, not assumed. `GET /api/cron/window` contains **no day-of-week test anywhere**:
    > it considers `last-week` on every call, takes its bounds from `closedWindow` → `windowRange` → `weekStart`,
    > and dedupes on `window_posts (kind, window_start)`. `windowPosts.ts` is a lease and a compare-and-swap over
    > that same key and reads no calendar at all. `vercel.json`'s `30 4 * * *` already fires every day and posts
    > only a window that has closed and has no row. So the post moves from Monday to Sunday **by itself** the
    > moment the boundary moves. Every `Monday` in those two files is prose in a doc comment and is corrected
    > with the rest.
    >
    > ### The one-off at the flip — the only part that can embarrass anyone
    >
    > Moving the anchor changes the **key** of the most recently closed week, and a key with no row is a week
    > that has never been posted. Deployed on any day but the boundary itself, the next cron call will post a
    > `last-week` board covering days the group already read a board about, one day offset. The route's own
    > comment states the standard: *a duplicate post is a thing ten friends see*.
    >
    > **Product rule: the flip must not put a second board in the channel about days the group has already been
    > posted.** Before or with the deploy, stamp the shifted `last-week` key as posted in `window_posts` — the
    > kind, the new `window_start`, `posted_at` set, a reason that says why — or any equivalent that leaves the
    > channel silent until the first genuinely new Sunday. If `window_posts` holds no posted `last-week` row at
    > all (the webhook was never configured on this deployment), there is nothing to suppress and nothing to do.
    > Say which of the two happened in the decision row.
    >
    > The **running** `This week` also changes under readers on the flip day — a board that covered Monday
    > onward now covers Sunday onward, so it gains a night of games and possibly a player. That is correct, it
    > is the change the group asked for, and it needs nothing but the user's own word to them.
    >
    > ### Edge cases
    >
    > - **Sunday 06:01, nobody has played.** The window's empty sentence, unchanged.
    > - **A game at Sunday 05:59 local** is in the week that is ending; the same game at **06:01** is in the new
    >   one.
    > - **Saturday 23:30 and Sunday 01:40 of one night** land in the same week — the old one — because the week
    >   is built off `nightStart`. This is the case the M5.9 brief wrote about Sunday/Monday; it moves with the
    >   anchor and keeps its meaning.
    > - **DST.** `nightStart`'s answer, not a second one: a week can be 167 or 169 hours and nothing here
    >   "fixes" that in UTC offsets.
    > - **A game backfilled three weeks late** lands in the Sunday-anchored week it was played in, computed at
    >   read time, with nothing rewritten. **Posts already in the channel stay as posted** — they are history and
    >   nothing edits them, the M5.12 rule.
    > - **`week of 1 Sep` on `/p/[puuid]`** is derived from the window's own start, so it names the Sunday by
    >   itself. No copy constant changes; the tests move.
    >
    > ### Acceptance
    >
    > 1. `weekStart` of an arbitrary instant always reads `Sun … 06:00` in `CUSTOMS_NIGHT_TZ` — the existing
    >    property test with `Mon` become `Sun`.
    > 2. Sunday 05:59 is in the closing week and Sunday 06:01 in the new one; Saturday 23:30 and Sunday 01:40 of
    >    one night are in the same week (tests).
    > 3. The slot on a week window reads `Sunday <d> <Mon> to Saturday <d> <Mon>`, and the weekly Discord post's
    >    description is that same string byte for byte, from the one formatter.
    > 4. `nightStart`, `nightEnd`, `civilDayStart`, `monthStart` and the `this-month` / `last-month` / `all-time`
    >    ranges are byte-identical to today's, with a test that says so.
    > 5. No rating, no `ratings` row and no balancer output moves by one digit; no migration; `vercel.json`
    >    untouched.
    > 6. `/api/cron/window` still posts `last-week` exactly once per week under repeated calls, and the overlap
    >    week at the flip does not reach the channel.
    > 7. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; the status table is updated; a
    >    decision row records how the flip-day overlap was suppressed.
    >
    > ### Out of scope
    >
    > The night boundary (06:00, unchanged). The month boundary (calendar month, unchanged). `CUSTOMS_NIGHT_TZ`
    > itself. The Daily Mystery's civil-midnight clock (M5.32). The cron schedule. The weekly rating track
    > (M7.2 to M7.4 — this task moves the anchor their briefs name and builds none of them). Rewriting landed
    > M5 briefs or the landed 2026-09-10 decision rows: history stays as written and this task's decision row
    > supersedes it.

- [ ] **M5.35** Two extra lines on the M5.18 capture night: does the client know the roles at `GameStart`? *(owner: `companion-engineer`; rides on the **M5.18** capture, adds no new endpoint and no new companion behaviour, and owes no release. Approved by the user 2026-09-15 off product's role-detection research; scoped here the same day)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Why
    >
    > The user asked whether the companion could send the real role at game start instead of relying on a
    > post-game guess. `gameData.teamOne[]/teamTwo[].selectedPosition` is already in a payload the companion
    > reads at `GameStart` and is already in our schema — but our only capture has one human in it, and in that
    > capture it reads `MIDDLE` with `selectedRole: "MIDDLE.PRIMARY.MIDDLE.UNSELECTED"` (matchmaking-preference
    > vocabulary), never changes across 73 events from `Lobby` to `EndOfGame`, and disagrees with the same
    > game's eog `detectedTeamPosition: JUNGLE`. It looks like stale queue state. One ten-human game settles it.
    >
    > ### What to produce
    >
    > From the same `ws-events.ndjson` the M5.18 night already records: the ten `selectedPosition` /
    > `selectedRole` values at the `GameStart` session event, and the ten `detectedTeamPosition` values from
    > that game's eog block, side by side, per puuid. Plus the ten
    > `playerChampionSelections[].spell1Id/spell2Id` from the same session event, which is the Smite check.
    >
    > ### Acceptance
    >
    > 1. A row-per-puuid table pasted into `03-lcu-reference.md` under the gameflow-session endpoint.
    > 2. That row's Notes say plainly whether `selectedPosition` is a real per-player value in a ten-human
    >    custom or leftover queue preference, on this patch, with the date.
    > 3. **No new endpoint is read, no champion-select URI is touched, no request is made to
    >    `127.0.0.1:2999`** — this is a re-read of a payload M2.3 already fetches.
    > 4. No companion behaviour changes and no release is owed.
    >
    > ### Out of scope
    >
    > Sending the role to the API (that is a later task and only if the answer is yes). Any scoring change.
    > `/liveclientdata`.
    >
    > ### Two notes on placement (product, not part of the ask)
    >
    > - **It cannot start on its own.** The input is the recording M5.18's "What finishes it" step 1 produces,
    >   so this task is dispatched with that night and not before it. If the night happens and the recording
    >   has no ten-human `GameStart` session event in it, say so and leave the task open — a table read off a
    >   nine-human game is the same one-human evidence in a bigger coat.
    > - **A `no` closes it.** If `selectedPosition` turns out to be queue preference, the finding is the whole
    >   deliverable: the reference row and a decision row, and nothing further is owed. Do not go looking for
    >   a second source for the role; **M7.12** is the task that measures the source we already have.

Acceptance: after a backfill of one player's history, games appear once each, ratings rebuild deterministically (same output on two runs), the stats pages render with real numbers, the leaderboard reads through `This week` / `This month` / `All time` with no rating ever reset, last week's board and awards arrive in Discord on Sunday with nobody pressing anything, and every player's main and backup come from the games they played.

## M7 Ratings that are fair (2 to 3 days, needs M5; runs before M6)

Goal: the number moves for the reasons the group thinks it does. Opened 2026-09-15 after a busy week of customs
left the group arguing that the ratings were unfair, with four decisions settled with the user that night.
**Every task here changes the rating model** — which is exactly why none of them is an M5 task: M5.24 to M5.33
each carry the sentence "does not change the rating model", and these carry the opposite. It sits before M6 in
the build order because M6 is still waiting on a month of M2 and this is tonight's complaint.

Four things change, in this order: ARAM stops rating (a bug), the week gets a rating of its own, being filled
twice in a row gets expensive, and the best player on each side keeps a little more of what they earned — and
the post says who that was. **The all-time rating that forms teams is not reset by any of it**, and no task
here may reset it.

**One rebuild, at the end, and not before** (user, 2026-09-15). Two of these changes rewrite the ratings when
the fold is replayed, and replaying per fix would move everybody's number three times in a week with no way to
tell which change did what. No task in M7 runs `pnpm --filter web rebuild-ratings` against the hosted project;
**M7.11** is the single run, after everything else has landed, and it is announced to the group before they
notice. Until it happens the live fold is already right and the stored history is a little stale, which is
visible on no page.

**One task here changes nothing, and it is the last one on purpose** (added 2026-09-15, approved by the user off
product's role-detection research). **M7.12** is a read: it measures how often the client's own
`detectedTeamPosition` gets a ten-human custom's roles right, writes a number into `03-lcu-reference.md`, and
stops. It is in M7 rather than M5 because what it gates is M7's subject — **nothing role-aware may be scoped
until it has landed**, and the first thing waiting on it is a possible revision of M7.8's performance
components, which the user has not approved and which is not scoped anywhere in this doc. It does not reopen the
one-rebuild rule and it owes no rebuild: **M7.11 is still the last task in this milestone that changes a number**,
and M7.12 can be worked before it, after it, or beside any M8 task.

**And that read came back "good enough", so there is a thirteenth task** (added 2026-09-15; the design is the
user's, approved the same day, product scoped it the same day). **M7.13** is what M7.12 unblocked: M7.8 scores a
support and an adc on the same six weights, and it is revised **in place** to score each player against one of
three weight vectors chosen by a role bucket — `carry` (top, mid, adc, lumped together because the one thing
M7.12 could not do is tell top from mid), `jungle`, `support`. Same six components, same within-game
normalisation, same bonus; only the weights move, and a game where any of the ten has no role gets no MVP, the
same way a game missing a stat already gets none. It is revised rather than layered because **nothing M7.8
produced has ever reached a player** — M7.9 and M7.10 have not landed — so **M7.13 lands before M7.9** and the
milestone still owes exactly one rebuild.

**And M7.13's one open question came back yes, so there is a fourteenth** (scoped 2026-09-15, off the answer to
M7.13's step 1). `damageDealtToObjectives` is real on both stored shapes, per-player and non-zero, so **M7.14**
adds it as a seventh component weighted `0.15` in the **jungle** vector and `0.00` in the other two — the weights
the user already set in M7.13's brief, repeated and not re-derived. It is a separate task because it needs a
column, an ingest fill and a backwards copy out of `games.raw`, which is `platform-engineer` work with schema in
it and was never going to fit inside a pure-core task. **It does not gate M7.9 or M7.10** — M7.13 did, because it
replaced the formula M7.9 stores answers from; this adds to a settled one — but **it must land before M7.11**,
or the milestone owes a second rebuild. Its own two halves are ordered strictly: the migration, the ingest and
the copy run first, and the core change lands only once the copy reports no stored row still short, so no game
ever loses its MVP to a column that has not been filled yet.

- [x] **M7.1** (landed 2026-09-15: a second export `gateRatedGame` beside the untouched `gateGame` in `apps/web/lib/ingest/fold.ts` adds the queue check via the existing `matchesQueue`/`gameModeFromRaw`; `rating.ts` and `rebuild.ts` both pass it `games.raw`/`raw->gameMode`; a missing mode stays Rift; `gateGame` and `countedGames` are unchanged so `/stats`, `/fun` and the streak stay mixed as M5.26 requires. Entailed and documented: an ARAM no longer gets a Discord result embed, since only a rated game gets one — the teams post is unaffected. No rebuild run; that is M7.11's.) ARAM never rates. `gateGame` in `apps/web/lib/ingest/fold.ts` checks participant count, side split and duration and nothing else, so a long enough ARAM custom folds into OpenSkill today. Add the queue check, store every mode and rate only Summoner's Rift. *(owner: `platform-engineer`; `core-engineer` reviews, it is shared fold logic; no dependencies, land it first)*

    > **Brief (product, 2026-09-15)**
    >
    > ### What a player sees
    >
    > Nothing new on any page. An ARAM custom still appears on `/games`, on `/fun?queue=aram`, on `/stats`
    > and in a player's own game list exactly as it does today — it is recorded, it is just not rated. What
    > changes is that the Howling Abyss nights stop moving the number the balancer forms teams from, and after
    > the rebuild below every player's rating moves once, to what it would have been if ARAM had never counted.
    >
    > ### The rule
    >
    > A game is **rated** when `gateGame` passes it **and** its mode is Rift: `matchesQueue(gameModeFromRaw(raw), 'sr')`
    > from `apps/web/lib/games/queue.ts`, which is `CLASSIC` or a missing mode. ARAM, `KIWI` and anything the
    > client invents next patch are stored with their ten rows and their scoreboard and four null rating columns,
    > for ever. A new `FoldSkipReason` — `game-mode` — says so in the log beside the existing three.
    >
    > **A missing mode is Rift.** Every night captured before the mode was read was Rift (M5.26's rule, decided
    > 2026-09-12 and not reopened here), so treating null as unknown would un-rate the group's whole history.
    >
    > ### The trap, and the one thing this task may not do
    >
    > `gateGame` is not only the rating gate. `countedGames` in `apps/web/lib/stats/fold.ts` calls it, and that
    > is the universe of `/stats`, `/fun`, `/p/[puuid]`'s sections and the board's streak. A mode check dropped
    > inside `gateGame` with no second door would empty `/fun?queue=aram` — the page folds `countedGames` and
    > *then* filters to ARAM — and silently take every ARAM game out of `/stats`, which contradicts M5.26 in as
    > many words ("`/stats` and the rating fold stay mixed"). So: **`gateGame` keeps its meaning** — a game that
    > happened and can be read — and rated-eligibility is a second gate beside it in the same file, used by
    > `rating.ts` and `rebuild.ts` and by nothing else. The shape (a wrapper, a second export, an options
    > argument the two rating callers pass) is the engineer's call and gets a decision row; the separation is
    > not negotiable.
    >
    > Both rating callers have to learn the mode: `selectGame` in `rating.ts` selects
    > `season_id, duration_s, winning_side, lobby_id` and `rebuild.ts` selects
    > `id, lcu_game_id, started_at, duration_s, winning_side, source`. Neither reads `raw` today. No migration
    > and no `game_mode` column: M5.26 already refused one, and a column would block the fix behind a `db:migrate`.
    >
    > ### Edge cases
    >
    > - **A live ARAM lands.** Stored, ten rows, scoreboard columns filled, no rating columns, skip logged with
    >   `game-mode`, and the companion gets the same 2xx it gets today. A non-2xx would make it retry a game that
    >   will never rate.
    > - **The lobby still finishes.** Rating is not what ends a lobby; `finished` is unchanged.
    > - **A backfilled ARAM** is stored unrated as every backfill is, and the rebuild leaves it that way.
    > - **A mode we have never seen** (`URF`, `NEXUSBLITZ`, a typo): stored, never rated, logged.
    > - **`raw` is null** (a row written before the blob was kept): Rift, rated, exactly as today.
    >
    > ### Afterwards — and **do not run the rebuild** (user, 2026-09-15)
    >
    > The ARAM games already folded stay folded until **M7.11**, which is the one and only
    > `pnpm --filter web rebuild-ratings` run of this milestone. Landing this task leaves the database in a
    > state where new ARAM games never rate and old ones still count: that is expected, it is visible on no page
    > as anything but slightly stale numbers, and it is the price of moving everybody's rating once instead of
    > four times. Verify the fix with tests against the local stack, not by rebuilding production.
    >
    > ### Acceptance
    >
    > 1. A stored ten-player ARAM over 300 seconds has four null rating columns after `rateStoredGame`, and the
    >    log names `game-mode`.
    > 2. The same game after a **local** `rebuild-ratings` still has four null rating columns, and no `ratings`
    >    row counts it. The hosted database is not rebuilt by this task (M7.11).
    > 3. A Rift custom rates exactly as it does today: an integration fixture's numbers do not move by one digit.
    > 4. `countedGames` over a window holding both maps returns the same list it returns today (test), and
    >    `/fun?queue=aram` still fills its tables.
    > 5. `/games?queue=aram` and `/stats` show the ARAM game; `/leaderboard`'s per-game expand (M5.30) does not.
    > 6. `rebuild-ratings` is still idempotent: two runs in a row, identical output.
    > 7. `pnpm -r typecheck` and `pnpm -r test` pass; the status table is updated; a decision row records the
    >    shape chosen for the second gate.
    >
    > ### Out of scope
    >
    > A `game_mode` column. Splitting `/stats` by map. Un-rating anything for any other reason (a nine-player
    > game, a short game and a duplicate player are already gated and their rules do not change). Any change to
    > what the pages list.

- [x] **M7.2** (landed 2026-09-15: `rateGameWeekly` beside the byte-pinned, untouched `rateGame`, tuned via `config.rating.weekly = { beta: 2.00, tau: 0.30 }`. Five games is not reachable without a coin-flip board — measured `sigma < 5.00` at game 30 weekly vs 36 all-time — so the target is the per-game movement instead: ~79 display points from a fresh Sunday seed vs ~29 for a settled all-time player, about three times the movement, almost all of it M7.3's reseed and not this tuning. Every number independently re-derived twice in review.) The weekly rating, in `packages/core`: a second, tuned OpenSkill fold beside `rateGame` that moves a week's games several times further than the all-time channel moves a settled player. `rateGame`'s behaviour for the all-time channel is not touched. *(owner: `core-engineer`; no dependencies, parallel with M7.1)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Why there are two
    >
    > The group's complaint is that `This week` ranks them by how they stand all-time, not by the week they
    > actually had — and `apps/web/lib/board/load.ts` says so on purpose in its own comment. A weekly **reset**
    > was rejected: it reopens the 2026-09-10 "ratings never reset" decision and it would leave Sunday's first
    > lobby balanced almost blind. So the all-time rating stays exactly as it is, keeps forming teams, and keeps
    > settling over about thirty games (`SETTLING_GAMES`), and the week gets a **second, independent** number
    > that starts from scratch every Sunday and never touches team-forming. **The week's anchor day moved to
    > Sunday on 2026-09-15 (M5.34)**; every "Sunday 06:00" in this brief and in M7.3 and M7.4 is that boundary,
    > and M5.34 lands before M7.3 so the reseed is built on it.
    >
    > **Amended by product, 2026-09-15, after the engineer's measurement** (the finding this brief asked for, in
    > "The target" below). What the week is for is that it *moves* — a Sunday restart from the rank seed is what
    > makes Tuesday show up on Thursday's board — not that it makes up its mind faster than the all-time number
    > does. The original wording of this task said "settles in about five games instead of thirty" and that is
    > not true and cannot be made true; the target below is the measured one.
    >
    > This task is only the maths. The fold that uses it is M7.3.
    >
    > ### What to build
    >
    > A new exported function beside `rateGame` in `packages/core/src/rating/index.ts` — a separate function or a
    > parameterised variant, the engineer's call — that rates one game with `openskill`'s `beta` and `tau`
    > options (both are on `rate()`'s `Options` type in 5.0.1, checked) read from a new `config.rating.weekly`
    > block. Same signature shape as `rateGame`: five and five in, five and five out, in input order, winning
    > side `100` or `200`, no draw path.
    >
    > **`rateGame` may not change.** Its numbers are pinned by M1.3's tests and by every stored `mu_after` in
    > the database. Add a test that asserts the all-time path's output for a fixed input is identical to the
    > number it produces today.
    >
    > ### The target, and the M1.3 rule
    >
    > **Measured on M1.3's pinned setup** (`P0` seeded Iron IV among settled Gold IVs, one sitter, `P0`'s side
    > wins every game), and these three numbers are the target, not a round one product would prefer:
    >
    > | | All-time channel | Weekly channel |
    > |---|---|---|
    > | `sigma < 5.00` — what "settles" means everywhere in this product (decision, 2026-09-10) | game 36 | game 30 |
    > | display points a game moves a **settled** player | ~29 | — |
    > | display points a game moves a player folded from a fresh Sunday seed (`seedFromRank`, σ 8.33) | — | ~79 |
    >
    > So the weekly channel is worth having for the third row and not the first: six games faster to settle is
    > nothing a friend would notice, and **about three times the movement per game is the whole effect the group
    > will see**. Most of that comes from M7.3's Sunday reseed rather than from `beta` and `tau` at all, which is
    > the honest reading and is why the tuning stops where it does.
    >
    > **`beta` and `tau` are tuned as far as they safely go and no further.** Past that the weekly board becomes
    > a coin flip — a settled player swinging 100 display points off one game — and `sigma` stops converging at
    > all above `tau ≈ 0.5`. A board that can be moved 100 points by one game is not a board about the week, it
    > is a board about the last game, so **do not** trade more movement for that.
    >
    > **Do not soften a number to make a test pass, and do not tune `rateGame` to help.** M1.3's rule, word for
    > word: how a number behaves is a product fact we want to know, and the tuning is not the place to make the
    > week feel fast. This section is already the result of that rule being followed once — it asked for five
    > games, the engineer measured thirty and said so, and the target moved rather than the number.
    >
    > ### Acceptance
    >
    > 1. Pure: no clock, no I/O, no environment. Every branch tested.
    > 2. `rateGame`, `seedFromRank`, `ordinal`, `displayRating` and `predictWin` are unchanged, and a test pins
    >    the all-time output byte for byte.
    > 3. The tuned constants are in `config.rating.weekly` and nowhere else; the architecture doc's rating
    >    section carries them and all three measured numbers in the table above, and says nowhere that the
    >    weekly channel settles faster than the all-time one in any sense a player would mean.
    > 4. A test pins the measured per-game movement from a fresh seed and the measured `sigma < 5.00` game
    >    count, whatever they are. If a later patch of `openskill` moves either, the test says so and product
    >    re-reads M7.3's copy — that copy is written off these numbers.
    > 5. A player with no games in the week is never handed to this function at all — that is the caller's rule
    >    (M7.3), and this function throws on anything that is not five and five, exactly as `rateGame` does.
    > 6. `pnpm -r typecheck` and `pnpm -r test` pass; the status table is updated.
    >
    > ### Out of scope
    >
    > Reading the database, the week, or the clock. Persisting anything. Balance, seeding, `ordinal`, the display
    > multiplier. Any change to how the all-time channel rates a game.

- [x] **M7.3** (landed 2026-09-15: `foldWeeklyRatings` in `apps/web/lib/board/weekly.ts` folds `this-week`/`last-week` at read time from the stored seed, through that week's rated games only — no table, no migration. The board sorts and prints the weekly `Rating` on those two windows, never Proven; `All time` and the month windows are byte-identical to before. Verified: a clean 2W-0L week outranks a 4W-4L week even though the shorter week's `ordinal` is lower — the exact fix the milestone exists for. The rail, the tonight page, and both Discord posts all read the same `track`-tagged rows. A week row's expand now shows the weekly deltas, not the stored ones, so the numbers add up. Known, scoped-out gap: `/p/[puuid]` still shows the all-time number on a week window — follow-up approved, not yet scheduled.) The weekly board reads the weekly rating. `This week` and `Last week` are folded from scratch at read time, seeded from rank, through that week's rated games only. All-time, the month windows and team-forming are untouched. *(owner: `platform-engineer`; after M7.1 and M7.2)*

    > **Brief (product, 2026-09-15)**
    >
    > ### What a player sees
    >
    > They open `/leaderboard` on a Thursday, which is `This week`, and the order is the week they had — the
    > person who went 8W 1L on Tuesday and Wednesday is at the top, whatever they are all-time. On Sunday at
    > 06:00 it is empty and starts again (the week's anchor day, moved to Sunday by **M5.34**, which lands
    > first). Somebody who played twice and won twice is above somebody who played eight and split them,
    > because a week is judged on the week and not on how many games it took. `All time` is one tap away and is the number that forms teams, and the
    > note under the board says which is which — including that a week is too few games for this one to be sure
    > of anybody, which is true of every row on it and is why none of them carries a `settling` chip.
    >
    > ### The rule
    >
    > For `this-week` and `last-week` only, fold a second rating per player:
    >
    > - **Seed**: the player's stored seed (`ratings.seed_mu` / `seed_sigma`, M5.7) when there is one, else
    >   `seedFromRank(players.rank_tier, players.rank_division)` — the same seed a new player gets, which is what
    >   "from scratch" means here.
    > - **Games**: every rated-eligible game (M7.1's gate) whose `started_at` is inside the window, in
    >   `started_at` then `lcu_game_id` order — the rebuild's order, so the week and the history tell the same
    >   story about the same night.
    > - **Maths**: M7.2's function, and no other.
    > - **Membership**: unchanged — the players with at least one counted game inside the window.
    >
    > **The seed must be reproducible.** `Last week`'s board has to read the same on Tuesday as it did on
    > Sunday, and the same again after a late backfill — that is what makes the weekly post checkable. A seed
    > taken from the live `players.rank_*` columns breaks that the first time somebody's rank moves, which is why
    > the stored seed comes first and the live rank is only the fallback for a player who has never been rated.
    >
    > ### What the row prints
    >
    > **A week window sorts on `Rating`, not on Proven** (user, 2026-09-15; the row is in `04-decisions.md` and
    > the carve-out is in `00-product.md`). The board shows the number it sorted on — the product doc's rule,
    > and it is why this is not just a re-sort: whichever number decides the order is the number the row has to
    > print, so on a week window that printed number is the weekly `Rating` (`displayRating(weekly mu)`) and
    > **no Proven is printed on a week board at all** — the small-type second number under the primary is
    > omitted on `This week` and `Last week`, not replaced by something else.
    >
    > Why Rating here and Proven everywhere else: a week is a handful of games by design, so the
    > `- 2 * sigma` subtraction is enormous for every row and largest for whoever played fewest, and Proven
    > would put a 4W 4L week above a clean 2W 0L one purely because the longer week is "more proven". That is
    > the same confusing-fairness complaint that opened M7. Playing more games already earns you less movement
    > per game — that is how OpenSkill's `mu` updates work and it is true whatever the board sorts on — so
    > sorting on Rating loses none of it and simply stops charging a short clean week twice.
    >
    > On a week window: `rating`, `sortKey` and `proven` **all** come from the weekly track — one row never
    > mixes tracks — with `rating` the primary column, and `sortKey` the weekly `mu` itself, raw and never
    > printed, exactly as `sortKey` carries the raw `ordinal` on the other windows today (2026-09-09). The
    > `proven` field may still be computed off the weekly track for the row's shape, but nothing on a week
    > surface renders it, and an acceptance check says so. `games`, `wins` and `losses` are facts about games
    > and do not change; `climb` is the weekly seed to the weekly end, so the row still reads
    > `6 games · 4W 2L · +58`.
    >
    > **No `settling` chip on a week window, and no `WEEKLY_SETTLING_GAMES`** (product, 2026-09-15; the Copy
    > section below carries the ruling and the wording). The chip exists to mark the handful of rows the board
    > is least sure of. On a week that is every row, every week — a marker on all ten rows marks nothing, and
    > this product doc already refused a board where nobody has settled. `SETTLING_GAMES` and the chip stay
    > exactly as they are on `All time` and the month windows.
    >
    > ### What this moves, and what it must not
    >
    > `LEADERBOARD_WINDOW` is `this-week`, so this changes **`/leaderboard`'s default**, the tonight page's rail,
    > the home page and the nightly Discord leaderboard post; and the Sunday post (M5.10, M5.13) loads
    > `last-week`. Name all five in the commit message. `this-month`, `last-month` and `all-time` are untouched.
    >
    > **It never forms teams.** `apps/web/lib/ingest/balance.ts` must not import any of it, and a grep for the
    > weekly fold under `lib/ingest/` returning nothing is an acceptance check. Likewise `/p/[puuid]`, `/stats`,
    > `/fun`, `/games` and the ratings table: unchanged.
    >
    > ### Where it lives
    >
    > Computed at read time, mirroring `windowRows`, is the expected shape — no table, no migration, no cron,
    > and a backfilled game lands in the week it was played with nothing rewritten, which is the whole reason
    > windows work at all (M5.9). If a persisted table turns out to be the only way, it lands with its own
    > decision row saying what forced it and how a late backfill is repaired.
    >
    > ### Copy (product, amended 2026-09-15; the designer adds the rows to `05-design.md`)
    >
    > **The ruling.** This brief said the week `settles after about 5 games` and carried a
    > `WEEKLY_SETTLING_GAMES = 5`. M7.2's measurement killed both: "settles" in this product means
    > `sigma < 5.00` — the 2026-09-10 decision, the word in `SETTLING_SENTENCE`, the word behind the chip — and
    > the weekly track reaches it at game **30**, against 36 all-time. A group that plays one to three games a
    > night does not get there, so the honest version of the old sentence would have read *settles after about
    > 30 games* under a board where nobody ever had, and the written version would have crowned people settled
    > at game 5 while their number was still mostly seed. Neither is shippable in a product whose first
    > principle is "fair by numbers, but explained", and this milestone exists because the ratings felt
    > dishonest once already.
    >
    > **So the week does not claim to settle, and says what it does instead.** What is true and measured is that
    > a weekly number moves about 79 display points a game against a settled player's 29, because every Sunday
    > it restarts from the rank seed. That is the thing the group will actually notice, it is a different claim
    > from "this number is no longer mostly noise", and only the first one goes on the page.
    >
    > **The copy below was rewritten on 2026-09-15 for the Rating sort.** The earlier version explained the
    > order in terms of Proven (`your rating, minus how unsure it is about you … every number here sits low and
    > swings`). Neither half of that sentence survives the change: the week no longer sorts on Proven, and a
    > weekly Rating does not sit low — it starts at your rank seed and moves either way from there. Copy that
    > describes a page the reader is not looking at is the thing this milestone exists to stop, so it is
    > replaced, not patched.
    >
    > - Under the board on a week window, once per page, replacing the all-time Proven sentence
    >   (`SETTLING_SENTENCE`) — a new constant in `lib/board/copy.ts`, with no `SETTLING` in its name:
    >   `Every week starts everyone back at their rank on Sunday, so a good Tuesday shows up here straight away. The board sorts on Rating — what the bot thinks you are after this week's games — and takes nothing off for playing only a few, so a clean two-game week can sit above a longer patchy one. It is a handful of games either way, so these numbers swing. All time is the settled one, and the one that makes teams.`
    > - Four sentences and each one is load-bearing: the week's point (the Sunday restart, which is why
    >   Tuesday is visible on Thursday); what the column is and why it is not the cautious number a reader sees
    >   on every other window — `This week` is the **default** window, so it cannot borrow a definition from a
    >   tab a reader may never open, and the person who opens `All time` next has to know the two boards are
    >   ordered by different numbers; that a week is few games and the numbers move hard; and where the real
    >   number lives. Do not cut the second one to fit a line.
    > - The sentence must not promise that a short week is *better* than a long one, only that it is not
    >   docked for being short. `takes nothing off for playing only a few` is the claim; `a clean two-game week
    >   can sit above a longer patchy one` is the visible consequence and the thing somebody will otherwise
    >   open a bug report about.
    > - The short form, for the embed footer where `SETTLING_SENTENCE_SHORT` prints today — the nightly
    >   leaderboard post reads `this-week` and the weekly post reads `last-week`, so both say this instead:
    >   `Every week starts everyone back at their rank on Sunday, so these numbers swing, and two clean wins can top a longer patchy week. All time is the settled one, and the one that makes teams.`
    > - **`Every week`, not `This week`**, in both: `Last week` prints the same two strings, because it is the
    >   same track and the reader is asking the same question, and a second wording per window is a second
    >   vocabulary for one fact. `Every week` is true under either heading; `This week` would read as a mistake
    >   under `Last week`.
    > - `SETTLING_SENTENCE`, `SETTLING_SENTENCE_SHORT`, `SETTLING_SENTENCE_PLAYER`, `SETTLING_CHIP` and
    >   `SETTLING_GAMES` are **not edited** — they keep printing, byte for byte, on `All time`, on the month
    >   windows and on `/p/[puuid]`, which are all still the all-time number. Neither pair may be edited into
    >   the other, the M3.26 rule.
    > - No new chip, no badge, no second picker, no asterisk on a row.
    >
    > ### Edge cases
    >
    > - **Sunday 06:01, nobody has played.** The window's empty sentence, as today.
    > - **One game played this week.** Everybody on it is on the board, ten rows one game from their rank seed,
    >   five of them up and five down, and the sentence above is why the order looks wild. This is expected and
    >   is not a bug report.
    > - **A short clean week against a long patchy one.** 2W 0L in two games can sit above 4W 4L in eight, and
    >   that is the decided behaviour, not a sorting bug (user, 2026-09-15). The only thing that orders a week
    >   window is the weekly Rating.
    > - **A player with no `ratings` row and no rank** seeds unranked (20 / 10), the same as everywhere else.
    > - **A backfilled game arrives on Thursday for Tuesday.** It is in the fold the moment the rebuild rates it
    >   and the week recomputes; last week's closed board changes too, which is correct and already true today.
    > - **An ARAM night.** Not in the fold at all (M7.1).
    >
    > ### Acceptance
    >
    > 1. Two players with identical all-time ratings and opposite weeks are ordered by their week (integration test).
    > 2. `Last week` read twice, with a rank changed in between, gives the same board.
    > 3. `All time`, `This month` and `Last month` rows are byte-identical to today's (test) — including that
    >    they still sort on Proven, which this task does not touch.
    > 4. Nothing under `apps/web/lib/ingest/` imports the weekly fold; the split the balancer produces for a
    >    fixed lobby is unchanged.
    > 5. **The week sorts on Rating.** A player who went 2W 0L in two games is above a player who went 4W 4L in
    >    eight whose weekly `mu` is lower, even though the eight-game player's weekly `ordinal` is higher — the
    >    test fixture states both numbers, so it fails if anything reads `sigma` to order a week window
    >    (integration test).
    > 6. On a week row, `rating`, `sortKey` and `proven` all come from the weekly track and none of them from
    >    the all-time one (test); `sortKey` is the weekly `mu`, and the rows come back in non-increasing
    >    `rating` order, so the printed order matches the printed number.
    > 7. No week surface renders Proven: `/leaderboard` on `this-week` and `last-week`, the tonight rail, the
    >    home page and the nightly and weekly embeds print the weekly `Rating` as the row's one number, with no
    >    Proven column, label or small-type second number (test on at least the board and the embed).
    > 8. On `This week` and `Last week`: no row carries the `settling` chip, the sentence under the board is the
    >    long copy above, character for character, from `lib/board/copy.ts`, and the embed footer on the nightly
    >    and weekly posts is the short one. A test pins both strings and asserts no surface interpolates a game
    >    count into either.
    > 9. On `All time`, `This month` and `Last month`, and on `/p/[puuid]`: the chip, `SETTLING_GAMES` and all
    >    three `SETTLING_SENTENCE*` constants are byte-identical to today (test). `grep -r WEEKLY_SETTLING`
    >    returns nothing.
    > 10. `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter web build` pass; the status table is updated; a
    >    decision row records where the fold lives.
    >
    > ### Out of scope
    >
    > The awards and the weekly post's award field (M7.4). `/p/[puuid]`, `/stats`, `/fun`, `/games`. Any change
    > to `ratings`, to team-forming, or to the all-time number on any surface. The sort on `All time`,
    > `This month` and `Last month` stays on Proven and is not up for discussion in this task; the Rating sort
    > is a carve-out for the two week windows and nothing else.
    >
    > **The month windows are not deferred, they are decided** (user, 2026-09-15): `This month` and `Last month`
    > keep ranking on the all-time number, for ever, because a month of nightly customs is roughly the thirty
    > games the all-time rating already settles over — a from-scratch monthly track would be a second name for
    > the same reading. Do not build one, and do not "prepare" for one by generalising the weekly fold over an
    > arbitrary window. Anybody reopening this needs a reason the decisions log does not already answer.

- [x] **M7.4** (landed 2026-09-15: `weeklyClimbs` in `apps/web/lib/stats/awards.ts` folds `Most improved` over a week window through M7.3's `foldWeeklyRatings` — one fold, not a second one — from the player's weekly seed to their end-of-window weekly Rating. Month windows keep the stored all-time climb unchanged; `Best off-role` and `cursed duo` are byte-identical. Seeds come from the loader via the same `seedFor` stored-seed-then-rank rule `lib/board/load.ts` uses, so the Sunday post's board half and awards half start the week from one number.) The weekly awards read the weekly rating. `Most improved` over a week window is the weekly climb; the other two awards do not read ratings and do not change. *(owner: `platform-engineer`; after M7.3)*

    > **Brief (product, 2026-09-15)**
    >
    > ### The rule
    >
    > `mostImproved` in `apps/web/lib/stats/awards.ts` folds `climbs()` off the stored `mu_before` / `mu_after`
    > columns — the all-time track. On a **week** window it reads the weekly track instead: the player's weekly
    > seed to their weekly number at the end of the window, which is "who beat their rank hardest this week".
    > **Both ends are `mu`-derived** — the weekly `Rating`, the same quantity the all-time climb is a difference
    > of — so M7.3's ruling that a week window *sorts* on Rating rather than Proven changes nothing here: this
    > award never read `sigma`, and a climb measured on Proven was never on the table.
    > Month windows keep the all-time climb exactly as they have it. The per-window minimum game counts are
    > unchanged, and so is the tie rule (more games wins; still tied, both are named).
    >
    > `Best off-role` and `cursed duo` read games and roles, never ratings. They do not change, and a diff that
    > touches them is a diff that went wrong.
    >
    > ### Where it shows
    >
    > The weekly Discord post's awards field (M5.10, M5.13) and `/stats` on a week window — the post arrives on
    > **Sunday** morning once M5.34 has landed, which changes when it fires and nothing about what it says. The
    > post's
    > board half comes from M7.3 for free; check the embed prints the weekly numbers and that no line in it says
    > or implies all-time.
    >
    > ### Acceptance
    >
    > 1. On a week window with a Bronze who went 6W 1L and a Master who went 6W 1L, the Bronze is most improved.
    > 2. `This month`, `Last month` and `All time` awards are byte-identical to today's (test).
    > 3. The award's minimum, its "nobody won it" sentence and its rule line are unchanged.
    > 4. A closed-window post replayed twice writes one `window_posts` row and posts the same numbers.
    > 5. `pnpm -r typecheck` and `pnpm -r test` pass; the status table is updated.
    >
    > ### Out of scope
    >
    > Inventing a fourth award. Changing the minimums. The `Most improved, September.` line on `/p/[puuid]`
    > (M5.20), which is a month award and stays where it is.

- [x] **M7.5** (landed 2026-09-15: `offRoleCostOf(player)` computes `offRolePenalty × (1 + fillProtectionFactor / (gamesSinceLastFill + 1))`, `fillProtectionFactor` 1.0 in `config.balance`; both `assignRoles` and the split score read the one charged value, so the two cannot drift. `gamesSinceLastFill?: number | null` on `BalancePlayer`, optional so no existing caller breaks; `null`/unreadable/negative all handled without throwing. M1.4's worked example is byte-identical when every value is `null`. Review found and fixed one overclaim in the docs: protection can change *how many* seats are filled, not just *who* — corrected in `01-architecture.md` and `config.ts`'s comment, independently re-measured by the engineer at ~1% of random lobbies.) Fill protection in the balancer, League-ranked style: a decaying cost that makes filling the same person twice in a row expensive, and never blocks it. Pure, in `packages/core`. *(owner: `core-engineer`; independent of M7.2 and M7.8, parallel with M7.1)*

    > **Brief (product, 2026-09-15)**
    >
    > ### What a player sees
    >
    > They got filled into support last night. Tonight the same ten are in the lobby and somebody else takes
    > support, unless there is genuinely nobody else who can — in which case they are filled again and the
    > explanation line says they are off-role, exactly as it does today. Nothing on any screen is new.
    >
    > ### The rule
    >
    > `config.balance.offRolePenalty` is a flat 120 display points per off-role seat and applies the same to a
    > player who has never been filled and to one who was filled twice this week. Scale it per player:
    >
    > ```
    > cost(player) = offRolePenalty × (1 + fillProtectionFactor / (gamesSinceLastFill + 1))
    > ```
    >
    > with `config.balance.fillProtectionFactor` defaulting to **1.0**: a player filled in their last game costs
    > 240, one game later 180, three games later 150, nine games later 132, and it decays to the flat 120 from
    > there. `gamesSinceLastFill` is a new per-player input on `BalancePlayer`, `number | null`, and `null` —
    > never filled, or no history to read — is baseline, the behaviour every existing test already pins.
    >
    > **Both places, or neither.** `offRolePenalty` is read twice in `packages/core/src/balance/index.ts`: inside
    > `assignRoles`, which prices one team's 120 role permutations, and again in the split score. Scaling one and
    > not the other prices a seat one way and ranks the split another, which is a bug that only shows up on the
    > nights it matters.
    >
    > **A soft cost, never a block.** A lobby where one person is the only one who has ever played jungle still
    > gets a jungle. The balancer's job is to price the unfairness, not to refuse the night.
    >
    > ### Edge cases
    >
    > - **A flexible player** (`mainRole: null`) is never off-role by M1.4's rule, so protection never applies to
    >   them and their `gamesSinceLastFill` is ignored.
    > - **Everybody was just filled.** Every cost rises together, the ordering between splits is what matters,
    >   and the three splits stay well-defined.
    > - **`gamesSinceLastFill: 0`** — filled in the very last game — is the maximum, 240. There is no larger
    >   value and no unbounded term.
    > - **Ties** are broken by `compareSplits` exactly as today; the tie-break order does not change.
    > - **Determinism**: same input, same three splits, same order, every time.
    >
    > ### Acceptance
    >
    > 1. **M1.4's worked example is unchanged** when every `gamesSinceLastFill` is `null`: the same teams, gaps
    >    100 / 170 / 220, everyone on a main. That example is the product's pinned test case and it may not move.
    > 2. Given two equally good alternatives, the balancer fills the player who was **not** filled last game.
    > 3. Decay: the same lobby with `gamesSinceLastFill` of 0, 1, 3 and 9 produces the documented costs, and at
    >    a large value the chosen split equals the `null` case.
    > 4. An unavoidable fill still happens: a lobby where only one player can cover a role is still split, that
    >    player is still on it, and `offRoleCount` counts them.
    > 5. A flexible player's `gamesSinceLastFill` changes nothing.
    > 6. The explanation string is unchanged in shape and wording.
    > 7. Pure, tested, `fillProtectionFactor` in `config.ts` only, and `01-architecture.md`'s balancer section
    >    carries the formula and the number.
    > 8. `pnpm -r typecheck` and `pnpm -r test` pass; the status table is updated.
    >
    > ### Out of scope
    >
    > Where the number comes from (M7.6). A hard block on filling twice. Remembering **which** role somebody was
    > filled into — this remembers that they were filled, nothing finer. Any new sentence on any surface; if the
    > group wants the explanation to say "we owed them a main", that is a copy task of its own.

- [x] **M7.6** (landed 2026-09-15: `loadFills` in `apps/web/lib/ingest/balance.ts` reads each lobby member's last `config.roles.inferenceWindow` rated games — bounded by the group's last 200 games since `game_players` carries no timestamp — and `fillDistances` walks them newest-first to find `gamesSinceLastFill`; runs unconditionally alongside `loadRotation`, not gated behind its ten-or-fewer early return. Live in the balance path now: the next real lobby already prices fills with protection, and M7.11's rebuild does not touch this read.) Compute `gamesSinceLastFill` and pass it to the balancer. No column and no migration: `game_players.counts_for_role_inference` already records exactly this. *(owner: `platform-engineer`; after M7.5)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Where the fact already is
    >
    > M5.17 writes `game_players.counts_for_role_inference = false` for precisely the players the balancer put on
    > a role that was neither their main nor tonight's override — that is a fill, recorded at fold time, which is
    > the only moment it is knowable (`apps/web/lib/ingest/roles.ts` says so at length). So the history exists,
    > and this task is a read.
    >
    > ### The rule
    >
    > Over the player's last **20** counted games, newest first — the same window role inference reads
    > (`config.roles.inferenceWindow`), so "what the model thinks your role is" and "how recently we took you off
    > it" are read over the same nights — `gamesSinceLastFill` is the number of games since the most recent one
    > flagged `false`: `0` when their last game was a fill, `null` when there is no fill in the window.
    >
    > It is computed in `loadPool` in `apps/web/lib/ingest/balance.ts`, beside the rotation read, and handed
    > through `toBalancePlayer`. **Note the trap**: `loadRotation` returns early when ten or fewer are around,
    > because the sit-out order is meaningless then — fill protection is not, and it matters most at exactly ten,
    > where somebody has to take the empty seat. This read must happen for every lobby size.
    >
    > ### Edge cases
    >
    > - **A player with no games** is `null`.
    > - **A game nobody rated** (a remake, an ARAM after M7.1) never carried a flag and is not a fill.
    > - **A backfilled game** is `true` by the column's default — we did not choose those seats, so it is not a
    >   fill, and that is the column's documented meaning, not a shortcut.
    > - **A fill from a lobby whose split we could not read** is also `true` for the same reason.
    > - **Eleven or more around**: unchanged sit-out ordering; this is a second, independent number.
    > - **The read fails**: the lobby still balances with `null` for everybody. A balancer that refuses to split
    >   because it cannot remember last night is worse than a flat penalty.
    >
    > ### Acceptance
    >
    > 1. Integration: a player filled in the group's last game reads `0`; three games later, `3`; with no fill in
    >    twenty games, `null`.
    > 2. A ten-player lobby gets real values (the `loadRotation` early return does not swallow them).
    > 3. The split for a fixed lobby with no fills in history is identical to today's.
    > 4. One extra read per balance at most; the balance path stays inside its current budget.
    > 5. `pnpm -r typecheck` and `pnpm -r test` pass; the status table is updated.
    >
    > ### Out of scope
    >
    > A `games_since_last_fill` column, a materialised view, or any write. Changing what
    > `counts_for_role_inference` means or when it is written. Showing the number to anybody.

- [x] **M7.7** (landed 2026-09-15: migration `0014` on kustom adds `vision_score`/`damage_self_mitigated` to `game_players`, nullable, no default; ingest fills both off the posted `raw` block through the existing `rawFactsFromUnknown` reader, no companion release needed; `storedStat` gates every write against negative/non-finite/out-of-int4 values after a review found one would 500 ingest forever and abort the backfill mid-run. `pnpm --filter web copy-raw-stats` ran against the hosted project: 44 games with a gap, all 44 fillable, 436 rows filled, 0 rows still short; a second run confirmed idempotent.) Store vision score and damage self-mitigated. Verify both on a real end-of-game block, add the two columns, fill them at ingest and copy them onto stored rows from `games.raw`. Blocks M7.9. *(owner: `companion-engineer` for the verification and the client-side mapping, `platform-engineer` for the migration, the ingest and the copy; parallel with M7.1 and M7.5)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Why
    >
    > M7.8's performance score weights vision at 0.25 and damage mitigated at 0.15 — four tenths of it — and
    > `game_players` stores neither. Today it holds kills, deaths, assists, gold, damage to champions and CS.
    > Without these two the score is a KDA-and-gold score, which would crown the same carry every night and
    > would be the second truth this project keeps refusing.
    >
    > ### Verify first (CLAUDE.md's rule, and it is nearly answered)
    >
    > Both numbers are already in the 16.17 fixtures on both paths: the end-of-game block's `stats` carries
    > `VISION_SCORE` and `TOTAL_DAMAGE_SELF_MITIGATED` with camelCase duplicates beside them, and the
    > match-history detail's `participants[].stats` carries `visionScore` and `damageSelfMitigated`. `/fun`
    > already reads `VISION_SCORE` out of `games.raw` (`apps/web/lib/stats/rawFacts.ts`). What is **not** proven
    > is a human 5v5 block — the eog fixture is a solo custom against five bots, and the reference row says as
    > much. Confirm against a real ten-player block before flipping the status: the group's stored `games.raw`
    > rows answer it without a capture night if the lead can run a read against the hosted database. Update the
    > `End of game stats` and `Match detail` rows in `docs/03-lcu-reference.md` either way, naming both keys.
    >
    > ### The columns
    >
    > Migration `0014`: `vision_score integer` and `damage_self_mitigated integer` on `game_players`, both
    > **nullable**, no default. Nullable is the point — `null` means "this game never stored it" and M7.8 skips
    > the game rather than scoring a real tank at zero mitigation. Do not add `not null default 0`.
    >
    > Names follow the client's own words (`damageSelfMitigated`), not the formula's shorthand.
    >
    > ### Filling them
    >
    > - **At ingest**, from the posted block, uppercase key first and camelCase as the fallback — M2.10's rule
    >   for every stat we read. Both shapes: the live end-of-game block and the backfilled match-history detail.
    > - **On the boundary**, two optional fields on `companionGameParticipantSchema` in
    >   `packages/db/src/schemas/companion.ts`, nullish, defaulting to null, with the source table in the
    >   doc comment updated. Every boundary is zod'd (CLAUDE.md).
    > - **Backwards**, a one-off copy onto stored rows from `games.raw` where the blob has them — the M5.29
    >   precedent for bans. Without it the bonus would be a rule that only applies to games played after Tuesday,
    >   and the rebuild would rate the group's history under two different models.
    >
    > **Check whether a companion release is actually needed before scheduling one.** The exe the group runs
    > already posts the raw block and the server already stores it, so if ingest reads the two numbers off the
    > payload's raw rather than off the mapped participant, no new exe is required for the numbers to start
    > flowing. M2.6 owes a release for other reasons; this task should not be what waits on it.
    >
    > ### Edge cases
    >
    > - **ARAM** has a vision score of 0 or no ward stat at all. Stored as it comes; M7.1 means it never rates
    >   anyway.
    > - **A bot row** never reaches this code (dropped before the schema, M2.10).
    > - **A blob with the key missing** writes `null`, not `0`.
    > - **A second companion posting the same game** is the same no-op it is today (`lcu_game_id` dedupe).
    >
    > ### Acceptance
    >
    > 1. The two reference rows name both keys and carry a patch and a date for a ten-player block.
    > 2. Migration `0014` applies locally (`pnpm db:reset`) and to the hosted project; `pnpm db:types`
    >    regenerated and committed.
    > 3. A live end-of-game post fills both columns for all ten; a backfilled detail fills both.
    > 4. A block missing the keys writes `null` twice and the game still stores and still rates.
    > 5. The copy pass fills every stored row whose `games.raw` holds the numbers, is safe to run twice, and
    >    reports how many rows it touched.
    > 6. `pnpm -r typecheck`, `pnpm -r test` and `pnpm lint` pass; the status table is updated; a decision row
    >    records whether the numbers come off the mapped payload or the raw blob, and whether a release is owed.
    >
    > ### Out of scope
    >
    > Any other stat (wards placed, killing sprees, objectives — `/fun` already reads those from `raw`). Showing
    > vision or mitigation on any page. The bonus itself (M7.8, M7.9).

- [x] **M7.8** (landed 2026-09-15: `packages/core/src/rating/performance.ts`, three exported functions and nothing else — `performanceScores` (six weighted components, each divided by the game's own maximum, one score in `[0, 1]` per player, in input order), `mvpAce` (best winner, best loser; five a side or it throws; ties by puuid ascending) and `applyMvpAceBonus` (a flat `{ puuid, before, after }[]` in, the same ten out, MVP's `mu` delta × 1.25 and ACE's × 0.80, `sigma` copied through untouched). `config.rating.performance` holds the six weights and `config.rating.mvp` the two fractions; `rating/index.ts` is not touched and M1.3's and M7.2's tests still pass unmodified. A game missing any component for any of the ten scores `null` and is rated exactly as before. Two decision rows: what "missing" means (`null`, `undefined`, non-finite; per game, never per player; negatives clamp to zero) and why the 1.25× is exact on the formula but ~1e-15 when read back off two stored `mu`s. Nothing calls it yet — that is M7.9.) The performance score and the MVP / ACE bonus, in `packages/core`: an op.gg-shaped score over the game's own numbers, and a bounded post-hoc adjustment to the `rateGame` delta. Pure. *(owner: `core-engineer`; the function can be written before M7.7 lands, its use cannot)*

    > **Brief (product, 2026-09-15)**
    >
    > ### What a player sees
    >
    > Nothing, this task. Later: the person who carried the win keeps a little more of it, and the person who
    > was the only one trying on the losing side loses a little less. Their names are not printed anywhere yet —
    > see the out-of-scope note.
    >
    > ### The words
    >
    > **MVP** is the highest-scoring player on the **winning** team, **ACE** the highest-scoring player on the
    > **losing** team. Those are op.gg's own terms and their own model, not our invention. Their formula is
    > proprietary and unpublished; ours is a documented community approximation and is a **tunable like every
    > other number in `config.ts`, not gospel**.
    >
    > ### The score
    >
    > Six components, weighted, in `config.rating.performance`:
    >
    > | component | weight |
    > |---|---|
    > | KDA | 0.10 |
    > | damage to champions | 0.20 |
    > | gold | 0.20 |
    > | vision score | 0.25 |
    > | damage self-mitigated | 0.15 |
    > | CS | 0.10 |
    >
    > They sum to 1.00. **Each component is normalised inside the game**: a player's value divided by the best of
    > the ten for that component, so every term is in `[0, 1]` and gold does not swamp KDA by being a four-digit
    > number. KDA is `(kills + assists) / max(1, deaths)`. A component whose game-wide maximum is zero
    > contributes zero to everybody rather than dividing by zero. The score is therefore in `[0, 1]` and is
    > comparable only inside its own game, which is all MVP and ACE need.
    >
    > ### The adjustment
    >
    > Applied **after** `rateGame`, never inside it, so the base rating maths stays untouched and independently
    > testable. For one player, with `delta = after.mu - before.mu`:
    >
    > - MVP: `mu' = before.mu + delta × (1 + config.rating.mvp.bonusFraction)`, default **0.25**.
    > - ACE: `mu' = before.mu + delta × (1 - config.rating.mvp.aceReliefFraction)`, default **0.20**. The ACE's
    >   delta is negative, so this shrinks a loss; it never turns one into a gain.
    > - Everybody else is untouched, and **`sigma` is never touched by any of this** — Proven must keep meaning
    >   "how sure the model is", and certainty is not something you earn by farming vision.
    >
    > The bound is the construction: the sign of a delta never flips, the magnitude is scaled by a fixed
    > fraction, and no term is unbounded. A winner always gains; a loser always loses.
    >
    > ### When it does not apply
    >
    > If any of the six components is missing for any of the ten — a game stored before M7.7, a blob that never
    > carried vision — there is **no MVP and no ACE** and the game is rated exactly as it is today. Partial
    > scoring would rank a player who has a vision score against one who does not.
    >
    > ### Edge cases
    >
    > - **A tie on the score**: highest score wins, then puuid ascending. Pinned in a test so the fold is
    >   reproducible; a float tie is nearly impossible and the rule exists anyway.
    > - **A player with zero on every component** can still be the ACE if the other four are also zero. That is a
    >   four-minute stomp, and it is honest.
    > - **A remake or a nine-player game** never reaches this: it is gated out before the fold.
    >
    > ### Acceptance
    >
    > 1. Pure: no clock, no I/O, no network — and specifically **no call to op.gg or any other service**. The
    >    formula is arithmetic over numbers the client already gave us; this project has no Riot API key and adds
    >    no second one.
    > 2. `performanceScores`, `mvpAce` and the adjustment are three tested functions, with the weights and the
    >    two fractions in `config.ts` only.
    > 3. MVP's delta is exactly 1.25× and ACE's exactly 0.80× the unadjusted one, to floating-point equality.
    > 4. `sigma` out equals `sigma` in for all ten, always.
    > 5. A game with one missing component anywhere returns "no MVP, no ACE" and the untouched `rateGame` result.
    > 6. `rateGame` itself is unchanged and its M1.3 tests still pass unmodified.
    > 7. `01-architecture.md`'s rating section carries the table, the two fractions and the normalisation rule.
    > 8. `pnpm -r typecheck` and `pnpm -r test` pass; the status table is updated.
    >
    > ### Out of scope
    >
    > Applying it (M7.9). Naming the MVP or the ACE on any surface — that is **M7.10**, decided by the user on
    > 2026-09-15 and scoped there; this task prints nothing anywhere. Weighting by role, by champion, or by game
    > length. A per-team ACE on the winning side.
    >
    > **Amended by product, 2026-09-15, after M7.12 measured the roles and the user approved a design off it.**
    > The "weighting by role" line above is overtaken: **M7.13 revises this task's formula in place** — the same
    > six components, the same within-game normalisation, the same three functions and the same 1.25× / 0.80×,
    > with the single flat weight vector in `config.rating.performance` replaced by three keyed on a role bucket
    > (`carry` = top/mid/adc, `jungle`, `support`), and no MVP at all for a game where any of the ten has no
    > role. Nothing this task produced has ever reached a player — M7.9 and M7.10 have not landed and no row
    > stores an MVP — so it is revised before it is ever applied rather than shipped and replaced. Everything
    > else in this brief stands as written; read the weights table above as history and M7.13's as current.
    > Weighting by champion or by game length is still out of scope, and so is a per-team ACE.

- [ ] **M7.9** Apply the MVP / ACE bonus in the fold, once, for both callers. *(owner: `platform-engineer`; after M7.7 and M7.8, and land it in the same session as M7.7's backwards copy)*

    > **Brief (product, 2026-09-15)**
    >
    > ### The rule
    >
    > The adjustment happens inside `foldGame` in `apps/web/lib/ingest/fold.ts`, which is the one implementation
    > both callers share — that file's own header says why: a game the live fold rated one way and the rebuild
    > rated another would move numbers nobody played for. To get there, `FoldPlayer` grows the six performance
    > numbers (or the fold takes a second argument carrying them), and `rating.ts` and `rebuild.ts` both select
    > the new columns.
    >
    > ### Sequencing, because this rewrites history — and **the rebuild is not yours to run** (user, 2026-09-15)
    >
    > Once the bonus is in the fold, the next `rebuild-ratings` applies it to **every** game whose columns exist.
    > That is intended — one model over the whole history, not one model per fortnight — and it is why M7.7's
    > copy from `games.raw` has to land first. But the run itself is **M7.11**, after M7.10, and it is the only
    > one in this milestone: four separate rebuilds would move everybody's number four times in a week and turn
    > a fix into a running argument. Until then the live fold rates new games with the bonus and the stored
    > history does not have it, which is a difference nobody can see on a page and which M7.11 closes.
    >
    > ### Acceptance
    >
    > 0. `pnpm --filter web rebuild-ratings` is **not run against the hosted project** by this task. Local stack
    >    only, for the tests below.
    > 1. A stored game with a null in either new column rates identically to today, digit for digit.
    > 2. A stored game with all six columns rates with exactly one amplified delta on the winning side and one
    >    reduced delta on the losing side, and eight untouched.
    > 3. The live fold and `rebuild-ratings` produce the same numbers for the same game (the existing
    >    incremental-versus-rebuild integration test, extended).
    > 4. `rebuild-ratings` is idempotent: two runs, identical output.
    > 5. `/leaderboard`'s per-game expand (M5.30) and `/p/[puuid]`'s recent games print the adjusted delta,
    >    because they read `mu_before` / `mu_after` — no change to either page, checked not written.
    > 6. The weekly track (M7.3) folds the same adjusted result, because it folds the same games through the
    >    same gate; confirm it, do not special-case it.
    > 7. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; the status table is updated.
    >
    > ### Out of scope
    >
    > Any surface change (M7.10 names the MVP and the ACE). The rebuild itself (M7.11). Any change to
    > `gateGame`, to the duration floor, or to what is stored.

- [ ] **M7.10** Name the MVP and the ACE where the number moved: the result post and `/p/[puuid]`'s rating explanation, from the columns M7.7 and M7.9 already write. *(owner: `platform-engineer` for the embed and the loader, `web-engineer` for the player page; after M7.9)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Why this is not optional
    >
    > The product's third principle is "fair by numbers, **but explained**": every split posts why it is the
    > split, and "the bot is rigged" needs a number to argue with. M7.9 amplifies one player's gain by a quarter
    > and softens another's loss by a fifth, and until this task nothing anywhere says so — a friend comparing
    > two `+43`s that are not the same `+43` has found a bug in the referee, whether or not there is one. The
    > user settled this on 2026-09-15: surface it, do not ship it silently.
    >
    > ### What a player sees
    >
    > The result post in Discord, under the scoreboard it already prints, names two people: the MVP of the
    > winning side and the ACE of the losing side. On their own page, a game in `Recent games` that they were
    > MVP or ACE of says so beside the delta it already prints, and the page's "how you got here" explanation
    > (M5.15) gains one sentence saying that carrying a game is worth a little more and being the only one
    > trying costs a little less.
    >
    > ### Copy (product, with this task; the designer adds the rows to `05-design.md`)
    >
    > - The embed line, one line, under the existing block: `MVP Lena · ACE Rami` — two names, a middle dot, no
    >   score, no percentage, no emoji. The score is a number a reader can do nothing with and one more thing
    >   that can disagree with the post; the names are the whole point.
    > - On a game row on `/p/[puuid]`: the word `MVP` or `ACE` beside the delta, in the row's own size. Not a
    >   badge, not an icon, not a colour of its own.
    > - The explanation sentence: `The best player on the winning side keeps a little more of what they gained, and the best player on the losing side gives a little less back.`
    > - Nothing is printed for the eight other players, and no page prints "you were nearly MVP".
    >
    > ### The rule
    >
    > **No new read and no new computation.** M7.9 writes the adjusted `mu_after`, so which two rows were
    > adjusted is already knowable from what the fold stored; the loaders that draw these surfaces already
    > select those rows. If it turns out MVP and ACE cannot be recovered from the stored columns without
    > recomputing the score at read time, stop and say so rather than folding a second copy of the formula into
    > the web app — that would be two implementations of the thing this milestone exists to make trustworthy,
    > and the answer is a stored marker, decided with the lead and recorded.
    >
    > ### Edge cases
    >
    > - **A game with no MVP and no ACE** — any of the six components missing (every game played before M7.7,
    >   and any blob that never carried vision) — prints **nothing**. No line in the embed, no word on the row,
    >   no "unknown". The explanation sentence still appears, because it is about the model and not about a game.
    > - **A nameless player** uses the same `NAMELESS_PLAYER` word every other surface uses.
    > - **A remake or an unrated game** has no MVP: it was never rated, so nothing was amplified.
    > - **An ARAM custom** has no MVP for the same reason (M7.1).
    > - **A reroll or a re-post** changes nothing here: this is a result surface, not a teams surface.
    > - **A long Riot ID** goes through the same 32-character truncation and the same field guard every other
    >   embed line goes through (`lib/discord/limits.ts`, M4.12) — this line is the lowest-priority line of its
    >   field and is the first to be cut.
    >
    > ### Acceptance
    >
    > 1. A rated game with all six components posts one line naming exactly two people: the highest-scoring
    >    player on the winning side and the highest-scoring player on the losing side.
    > 2. A game missing any component posts no such line, and the post is otherwise byte-identical to today's.
    > 3. The two names in the embed and the two words on `/p/[puuid]` come from the same stored answer — a test
    >    pins that the surfaces cannot disagree about one game.
    > 4. No new database read is added to either path; the loaders select what they already selected.
    > 5. The three strings are in `lib/discord/embeds.ts` / `lib/board/copy.ts` and not in a component, pinned
    >    by code point, and are in `05-design.md`'s copy table before merge.
    > 6. Floodlit: no emoji, no trophy, no colour for MVP, no "#1".
    > 7. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; the status table is updated.
    >
    > ### Out of scope
    >
    > Printing the performance score itself, anywhere. An MVP table on `/fun` or `/stats`, an all-time MVP
    > count, or an award — those are `/fun`'s register and they get their own task if the group asks twice.
    > Naming an MVP for a game nobody rated. Any change to the bonus itself.

- [ ] **M7.11** The one rebuild. After every M7 task has landed, run `pnpm --filter web rebuild-ratings` exactly once, confirm it is clean, and tell the group. *(owner: `platform-engineer`, with the lead; after M7.1, M7.3, M7.4, M7.6, M7.9 and M7.10 — **the last task in the milestone that changes a number**; M7.12 below is numbered after it but is a read, is not gated by it, and owes no rebuild)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Why it is a task and not a footnote
    >
    > Three of this milestone's changes rewrite history when the fold is replayed: ARAM leaves the ratings
    > (M7.1), and the MVP / ACE adjustment enters them (M7.7, M7.9). Run per fix, that is everybody's number
    > moving three times in a week, three WhatsApp arguments, and no way to tell which change did what. The user
    > settled it on 2026-09-15: **one rebuild, at the end, announced**. Nothing in M7 runs `rebuild-ratings`
    > against the hosted project before this, and the tasks that used to owe one say so.
    >
    > ### The run
    >
    > `pnpm --filter web rebuild-ratings --dry-run` first, and read the summary. Then
    > `pnpm --filter web rebuild-ratings --force` — the command refuses while a lobby is live or a game landed
    > in the last fifteen minutes, which is every evening, so pick a morning or pass `--force` knowingly — and
    > run it again on exit 2, which means games landed mid-run. Then a third run, which must change nothing.
    >
    > ### What to check afterwards, before anybody opens the app
    >
    > - Every ARAM game in the database has four null rating columns and no `ratings` row counts it.
    > - A Rift game with all six performance columns shows exactly one amplified and one reduced delta.
    > - The two biggest movers on the board are explainable in one sentence each — if they are not, stop and
    >   report rather than announcing a number nobody can defend.
    > - `/leaderboard` on `All time`, on `This week`, the tonight rail and `/p/[puuid]` all load and agree.
    >
    > ### Telling the group (product writes it, the lead posts it)
    >
    > One WhatsApp message, before anybody notices on their own: everyone's rating moved once tonight, ARAM
    > games no longer count towards it, carrying a game is now worth a little more, and nothing was reset — the
    > same history was re-added with those two rules. Plain words, no version numbers, no apology.
    >
    > ### Acceptance
    >
    > 1. Every M7 task through M7.10 is ticked in the status table before this starts.
    > 2. The dry run, the run and a third confirming run are all recorded in the status table row with the date.
    > 3. The third run changes nothing (idempotent), and no game is left half-rated.
    > 4. The four checks above are answered in the report.
    > 5. A decision row records the date the history changed under the group and what moved.
    > 6. The group is told before they ask.
    >
    > ### Out of scope
    >
    > Any code change. Tuning a constant because the result looks surprising — a surprise is a finding for the
    > lead, and tuning after seeing the answer is how a referee stops being one. A second rebuild to "smooth"
    > anything.

- [x] **M7.12** (landed 2026-09-15: 23 real ten-human Rift customs measured against the hosted project, 230 participants, 7 nights. Result: `detectedTeamPosition` is good enough to pair players by role — five distinct roles on 46 of 46 sides, 0 of 230 rows null, all 46 junglers independently confirmed by Smite, a 30-participant hand-read agreeing throughout. One recorded limit: nothing in the blob separates top from mid. Role-aware proposals are now unblocked; M7.13 stays unscoped until the user acts on this.) How good is `detectedTeamPosition`, actually? A read-only measurement over the hosted project, no client, no code in `packages/` or `apps/`. **No formula, no column, no page and no rating moves.** *(owner: `platform-engineer`, half a day; **blocks every role-aware proposal**. No dependency on any other M7 task — it reads roles, not ratings, so it does not wait on M7.11 and owes no rebuild. Approved by the user 2026-09-15 off product's role-detection research; scoped the same day)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Why
    >
    > The project distrusts role detection, but the evidence in `03-lcu-reference.md` refutes
    > `timeline.lane`/`timeline.role`, not `detectedTeamPosition` — which that same doc's M5.18 rule treats as
    > the ground truth the timeline pair is judged against. `detectedTeamPosition` has never been measured on a
    > real ten-human custom. Nothing role-aware may be scoped until it has been.
    >
    > ### What to produce
    >
    > For every stored game with ten human `game_players` rows and `source` live: (1) how many have five
    > distinct non-null roles on each side; (2) the distribution of duplicated and missing roles; (3) how many
    > rows have `role` null at all.
    >
    > Then, for three games hand-picked across different nights, a hand-read against the blob in the style of
    > `03-lcu-reference.md`'s existing confusion table — Smite (`spell1Id`/`spell2Id` == 11),
    > `neutralMinionsKilled`, `totalMinionsKilled`, `visionScore` — and a count of how many of the thirty
    > participants the client got right.
    >
    > ### Acceptance
    >
    > 1. A results block appended to `03-lcu-reference.md` under a new heading, with the counts and the
    >    thirty-participant hand-read, and the `detectedTeamPosition` status line updated to say what was
    >    measured and on how many games.
    > 2. Nothing is written to the database and no file under `packages/` or `apps/` changes except the script,
    >    if one is kept.
    > 3. The write-up ends with one sentence: whether `detectedTeamPosition` is good enough to pair players by
    >    role, in the author's judgement, with the number that supports it.
    > 4. A decision row recording the answer.
    >
    > ### Out of scope
    >
    > Changing any formula. Changing `MATCH_TIMELINE_ROLES` (that is **M5.18**, and it needs a capture).
    > Fixing bad roles.
    >
    > ### Three notes on placement (product, not part of the ask)
    >
    > - **Where "the `detectedTeamPosition` status line" is.** There is no row of its own for it: the field is
    >   named in the **End of game stats** row of "Endpoints we use", and the M5.18 section below the table
    >   leans on it as ground truth. Acceptance 1 means both of those — the eog row's Status cell gains what
    >   this task measured and on how many games, and the M5.18 section's "ground truth" claim stops being an
    >   assumption. The new heading is where the counts and the hand-read live.
    > - **A script, if one is kept, is a script and not a feature.** Acceptance 2 allows one file under
    >   `apps/web/scripts/` on the M9.1 pattern (service role, read-only, prints to stdout, its command line
    >   added to `CLAUDE.md`). If it is easier to answer this with ad-hoc queries and keep nothing, keep
    >   nothing — the deliverable is the numbers in the reference doc, not the tool.
    > - **It ends with a judgement and no scope.** The one sentence in acceptance 3 may say "good enough" or
    >   "not good enough". It may not open a task, change a weight, or add a component to M7.8's score. What it
    >   feeds is **M7.13**, described in the status row and deliberately not scoped. *(It said "good enough",
    >   the user read it and approved a design the same day, and **M7.13 is scoped below**, 2026-09-15.)*

- [x] **M7.13** (landed 2026-09-15: the three-vector formula, the role-to-bucket map and the missing-role rule, reviewed clean, in `packages/core`. Step 1 answered the same day — `damageDealtToObjectives` confirmed on both stored shapes, opening M7.14, which product scoped the same day. The read-only battle test against M7.12's 23 games (acceptance 8) ran the same day, two columns per the amendment below since it went before M7.14's core half: 6 of 23 MVPs moved, 7 of 23 ACEs moved, none looked wrong from the stat lines, recommendation to proceed to M7.9 — see the "Battle test" block at the end of this brief for the full tables and judgement.) The performance score reads the role: three weight vectors instead of one. A revision of
  **M7.8's own formula, in place** — same six components, same within-game normalisation, same bonus, same three
  exported functions — where which weights a player is scored on is picked by a role bucket: **carry** (top, mid,
  adc), **jungle**, **support**. A game where any of the ten has no role has no MVP and no ACE, exactly as a game
  missing a stat already does. Pure, in `packages/core`, plus a read-only battle test against the same 23 real
  customs M7.12 measured. **Lands before M7.9**, so no player ever sees an MVP the flat formula picked.
  *(owner: `core-engineer` for the formula, `platform-engineer` for the battle test; after M7.12 ✓ and M7.8 ✓;
  the design is the user's, approved 2026-09-15 off M7.12's answer, and product scoped it the same day)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Why this exists, and why it is M7.8 revised rather than a second thing
    >
    > M7.8 scores a support and an adc on the same six weights. Vision is 0.25 of that score and damage to
    > champions is 0.20, so on the numbers a support is being asked to win MVP on the carry's terms and the
    > carry on the support's — the "why did *they* get it" argument the whole milestone exists to stop, waiting
    > to happen on the first night M7.10 prints a name.
    >
    > It could not be scoped before now, on purpose: nothing role-aware was allowed until **M7.12** measured
    > whether the client's roles are real. It did — 46 of 46 sides, 0 nulls, Smite agreeing 46 of 46 — and the
    > user approved this design off that answer.
    >
    > **It revises M7.8's implementation in place; it does not layer a second formula on top.** M7.8 has landed
    > and is ticked, but **nothing it produces has ever reached a player**: M7.9 (apply) and M7.10 (print)
    > have not landed, no row stores an MVP, and no post has named one. So the cheapest honest move is to change
    > the formula before it is ever applied, rather than ship one model, print it, and replace it in a fortnight.
    > There is one performance model in this project and after this task it is this one. A second exported
    > scorer beside the old one is explicitly not what this is — two models in one history is the thing the
    > 2026-09-15 decision rows already settled against.
    >
    > ### What a player sees
    >
    > Nothing, this task, the same as M7.8. Later, when M7.10 prints the names: the MVP of a game is more often
    > the person the room would have named. A support who ran the map can win it on vision and a jungler on
    > objectives and KDA, without either of them having to out-damage the adc to do it, and an adc stops being
    > punished for not warding.
    >
    > ### The buckets
    >
    > Three, not five, and the middle one is the point:
    >
    > | bucket | roles |
    > |---|---|
    > | `carry` | top, mid, adc |
    > | `jungle` | jungle |
    > | `support` | support |
    >
    > **top, mid and adc are lumped together because M7.12 found nothing in the blob separates top from mid.**
    > That is the one limit that measurement recorded, and this design steps around it instead of arguing with
    > it: a bucket that never has to tell top from mid cannot be wrong about it. What the data *does* pin, to
    > 46 of 46 with an independent Smite check, is jungle and support — which are exactly the two roles whose
    > job the flat formula misreads. So the split is drawn where the evidence is, and nowhere else.
    >
    > A five-role split is **not** what this is, and must not quietly become it: five vectors would need the
    > top/mid distinction the data does not have, and would be five hand-set numbers each defended by nothing.
    > (`04-decisions.md`, 2026-09-10, already rejected five *ratings* for a different reason; this is a second,
    > independent reason not to go to five here.)
    >
    > ### The weights
    >
    > Three vectors in `config.rating.performance`, keyed by bucket. Each row sums to 1.00.
    >
    > | component | `carry` (top/mid/adc) | `jungle` | `support` |
    > |---|---|---|---|
    > | KDA | 0.15 | 0.25 | 0.25 |
    > | damage to champions | 0.30 | 0.20 | 0.05 |
    > | gold | 0.20 | 0.15 | 0.05 |
    > | vision score | 0.05 | 0.15 | 0.40 |
    > | damage self-mitigated | 0.10 | 0.10 | 0.15 |
    > | CS | 0.20 | 0.15 | 0.10 |
    >
    > They are hand-reasoned from what each role is actually for, and they are **tunables in `config.ts` like
    > every other number in this project, not gospel** — the same sentence M7.8's brief carries. They are not
    > fitted to anything, and this task may not fit them to anything: see "What this does not do" below.
    >
    > ### What does not change
    >
    > Everything else about M7.8, and this list is exhaustive:
    >
    > - **The six components** and how each is read. KDA is still `(kills + assists) / max(1, deaths)`.
    > - **The within-game normalisation.** Every component is still divided by the best of the ten in that same
    >   game, so the baseline is still the nine people who were actually there. This is the property the
    >   2026-09-15 decision row kept the formula for and it survives untouched: a Bronze player can still win
    >   MVP on a Bronze-heavy night.
    > - **The score is still in `[0, 1]`** and still means nothing outside its own game.
    > - **MVP is still the best score on the winning side, ACE the best on the losing side**, ties by puuid
    >   ascending.
    > - **The bonus is still 1.25× and 0.80×**, still applied after `rateGame`, still never touching `sigma`.
    > - **`rateGame` and `rateGameWeekly` are not touched**, and M1.3's and M7.2's tests still pass unmodified.
    >
    > Only which of three weight vectors a player's six normalised components are multiplied by changes, and
    > only the player's own role chooses it.
    >
    > ### A game with no role
    >
    > **If any of the ten has no role, the game has no MVP and no ACE** and is rated exactly as it is today.
    >
    > Read that as the rule M7.8 already has, not a new one. M7.8 declines to answer when it is missing an
    > input, per game and never per player, because partial scoring would rank a player who has a vision score
    > against one who does not. Role is now an input. A player whose role is unknown cannot be scored against a
    > vector, and picking one for them — or scoring them on the old flat one — would be exactly the partial
    > answer that rule exists to refuse. **This is one model declining to answer, not a second model**, and
    > nobody should read it as reopening the settled objection to role-aware scoring built on outside data:
    > there is no outside data here, no population baseline, and no second formula anywhere in the history.
    >
    > **What it costs, plainly:** every **backfilled** game carries `role = null` for all ten
    > (`04-decisions.md`, 2026-09-09; M5.18 is unresolved and needs a capture night nobody has scheduled), so
    > the backfilled half of the history will never have an MVP. Today, after M7.7's copy, those games *could*
    > have had one. That is a real loss and the user accepted it: an MVP picked without knowing who played
    > support is worth less than no MVP. The games that keep one are the live end-of-game ones — the 23 M7.12
    > measured, and every night from here.
    >
    > ### Step 1: is `damageDealtToObjectives` real, and does it belong to the jungler?
    >
    > A jungler's job is objectives and **none of the six components reads one**. Do this first, before the
    > weights are typed, because the answer decides whether the table above is final.
    >
    > What product already read (fixtures only, `packages/lcu/fixtures/16.17/`, and **this is not the
    > verification** — it is where to start looking): the live end-of-game block carries it per player, twice,
    > as `TOTAL_DAMAGE_DEALT_TO_OBJECTIVES` and `damageDealtToObjectives` with the same value; the
    > match-history detail carries it per participant as `stats.damageDealtToObjectives`. That is the same
    > two-name pattern, in the same two shapes, that M7.7 verified for vision and mitigation.
    >
    > What the engineer owes, to this project's "verify before you claim" rule:
    >
    > 1. Confirm it on **real stored customs**, both shapes, from `games.raw` on the hosted project — not from
    >    the one fixture — with real non-zero per-player values that differ across the ten.
    > 2. Record the answer. If it is not there in both shapes with real values, **drop it, say so, and ship the
    >    six-component table above unchanged.** That is a clean outcome, not a failure.
    > 3. If it is there: **it still does not go into this task.** `game_players` has no column for it, so a
    >    seventh component would need a migration, an ingest change and a backwards copy out of `games.raw` —
    >    M7.7 over again, a `platform-engineer` session with schema in it — and, because the missing-input rule
    >    is all-or-nothing, adding it would blank the MVP on every game already stored until that copy ran.
    >    None of that belongs in a pure-core task that has to land before M7.9. It opens **M7.14**, and this
    >    brief pre-answers the question M7.14 would otherwise have to invent, so that nobody hand-sets a weight
    >    twice:
    >
    >    | jungle row, if M7.14 happens | |
    >    |---|---|
    >    | KDA | 0.20 |
    >    | damage to champions | 0.20 |
    >    | gold | 0.10 |
    >    | vision score | 0.15 |
    >    | damage self-mitigated | 0.10 |
    >    | CS | 0.10 |
    >    | **damage to objectives** | **0.15** |
    >
    >    The 0.15 comes off gold, CS and KDA, 0.05 each: gold and CS because objective damage is a second
    >    reading of the same farming clock and would otherwise be counted three times, KDA by one notch because
    >    a jungler taking objectives is doing the thing ganks were a proxy for. **The `carry` and `support` rows
    >    do not move** — they would carry the seventh component at weight 0.00, which changes no score.
    >
    > ### The battle test, once the formula exists
    >
    > The weights are hand-reasoned, so they are validated the way the rejected alternatives' own reasoning said
    > this kind of change should be: **against this group's real games, by inspection, read-only**.
    >
    > - **The games**: the same 23 real ten-human Summoner's Rift customs M7.12 measured on the hosted `kustom`
    >   project (`source = 'eog'`, exactly ten `game_players` rows, `raw->>'gameMode'` CLASSIC, 2026-09-08 to
    >   2026-09-14). The same access pattern as M7.12: SQL the user pastes from the Supabase editor, or the lead
    >   hands over the rows. **Nothing is written. No column, no rebuild, no rating moves.**
    > - **The comparison**: game by game, who the *current* flat M7.8 formula picks as MVP and ACE against who
    >   the three-bucket formula picks, with the role of each pick beside it and a mark on every row that
    >   changed.
    > - **The totals**: how many of the 23 MVPs moved, how many ACEs moved, and the count of picks by role
    >   before and after.
    > - **The judgement**: one short paragraph, plain words, in the register M7.12's write-up ended on — do the
    >   new picks look more like what somebody who watched that game would have called it? This is an eyeball
    >   test against known games and is meant to be. There is no statistical test to run: ~44 games is not
    >   enough to fit anything, which is precisely why the two rejected alternatives were rejected and why this
    >   is validated by inspection instead.
    > - **Where it lands**: as an indented `> **Battle test (<engineer>, <date>)**` block under this brief, so
    >   it persists beside the weights it justifies, plus the headline numbers in the status row.
    >
    > **If the new picks look worse, the task stops and reports.** It does not tune the weights until the table
    > looks nicer — that is fitting on 23 games, which is the thing this design exists to avoid — and it does
    > not ship anyway. A bad result is a finding for the user, who set these numbers.
    >
    > ### Edge cases
    >
    > - **A backfilled game** (all ten `role = null`): no MVP, no ACE, rated exactly as today. Covered above.
    > - **One player of the ten with a null role**, live: same answer. The rule is per game, never per player,
    >   exactly as the missing-stat rule is.
    > - **A role the model does not know** — a value outside the five — is treated as no role, and the game gets
    >   no MVP. It never falls back to `carry`, because a silent default is a guess printed as a fact.
    > - **A side with two supports and no top**, which M7.12 saw zero of in 230 rows: scored as it comes. The
    >   buckets are read per player and nothing here requires a side to hold five distinct roles. The balancer's
    >   view of roles is not involved.
    > - **An ARAM custom** has no MVP for the reason it already had none: it is not rated at all (M7.1).
    > - **A tie on the score** is unchanged: highest score, then puuid ascending.
    > - **A remake or a nine-player game** never reaches this; it is gated out before the fold.
    > - **Every component's game-wide maximum is zero** for some component: it contributes zero to everybody, as
    >   today, whatever the bucket weights say.
    >
    > ### Acceptance
    >
    > 1. **Answered 2026-09-15.** `damageDealtToObjectives` is confirmed on real stored customs in both shapes:
    >    a hosted-DB read across all 44 stored games (28 live eog, 16 backfilled match-detail) found it present
    >    on 100% of rows, non-zero on 98.6% of live rows and 96.3% of backfilled ones, agreeing wherever both key
    >    casings are present, and genuinely per-player — every game checked has as many distinct values as
    >    participants. Recorded in `03-lcu-reference.md`. **M7.14 is opened** with the jungle row above; this
    >    task ships the six-component table as written, unconditionally — the question was decided in favor of
    >    a follow-up task, not a scope change here. `carry` and `support` are untouched by the question.
    > 2. `performanceScores` still exists, still returns one score per player in input order, and is still the
    >    only scorer exported. `PerformancePlayer` gains the player's role; a missing or unknown one is a
    >    first-class value, not a throw. There is no second scoring function and no `role`-less flat path left
    >    behind for a caller to pick by accident.
    > 3. The three vectors live in `config.rating.performance` and nowhere else, each summing to 1.00, with a
    >    test that asserts the sums. The role-to-bucket map is named in exactly one place.
    > 4. A game with any of the ten missing a role returns `null` from `performanceScores`, `null` from
    >    `mvpAce`, and an untouched copy of the fold's result from `applyMvpAceBonus` — the same three answers a
    >    game missing a stat already gives, pinned in a test beside the existing missing-stat test.
    > 5. A test with a hand-built ten where the support has the game's best vision and the worst damage shows
    >    the support winning MVP under the new weights and not under the old ones — the change doing its one
    >    job, pinned so a later tune cannot silently undo it.
    > 6. `mvpAce`'s five-a-side rule, its tie rule, `applyMvpAceBonus`'s exact 1.25× / 0.80×, and `sigma` out
    >    equalling `sigma` in are all unchanged and still tested.
    > 7. `rateGame` and `rateGameWeekly` are untouched; M1.3's and M7.2's tests pass unmodified.
    > 8. The battle test's table, totals and judgement are appended under this brief, and the run wrote nothing
    >    to the database.
    > 9. `01-architecture.md`'s rating section carries the three vectors, the buckets and the missing-role rule,
    >    replacing M7.8's single table rather than sitting beside it.
    > 10. A decision row records the design, and `00-product.md`'s "Carrying is worth a little more" paragraph
    >     says what "best" now means.
    > 11. `pnpm -r typecheck` and `pnpm -r test` pass; the status table is updated.
    >
    > ### What this does not do, and out of scope
    >
    > - **It does not change M7.9 or M7.10.** They apply and print whatever `performanceScores` and `mvpAce`
    >   produce, and their briefs stand as written. M7.9 gains one obligation only: it hands the role it already
    >   has on every `game_players` row to the scorer.
    > - **No external data, no population baseline, no z-scores, no percentile against anybody outside the
    >   lobby.** Closed on 2026-09-15 and not reopened here: the weights are hand-reasoned, the normalisation is
    >   still within-game, and nothing is vendored.
    > - **No fitting**, from this group's ~44 games or from anywhere else. Also rejected on 2026-09-15, and the
    >   battle test is an inspection, not a fit.
    > - **No five-role split**, now or later, unless something new tells top from mid.
    > - **No seventh component in this task** — see step 1.
    > - Kill participation as a component, named as a candidate in the 2026-09-15 decision row, stays a
    >   candidate and is not part of this.
    > - No new column, no migration, no ingest change, no rebuild. **M7.11 is still the one rebuild**, it still
    >   runs last, and this task lands before M7.9 so the rebuild it already owed is the only one.
    > - Naming or printing anything (M7.10). Showing a score as a number anywhere (still forbidden, M7.8's rule).
    > - Any change to the balancer, to off-role cost, or to what the model thinks your main is. Nothing here
    >   reaches `inferRoles` or `assignRoles`.
    >
    > ### Two notes on sequencing (product, not part of the ask)
    >
    > - **It lands before M7.9.** Not because M7.9 would break, but because the moment M7.9 lands a real night's
    >   MVP is stored by whatever formula is in core that evening, and the argument for revising M7.8 in place
    >   rather than layering is precisely that nothing has been applied yet. If M7.9 somehow lands first, this
    >   still lands before **M7.10**, and M7.11's rebuild restates every stored answer under the new formula.
    > - **M8.4 is downstream and unaffected in shape.** It needs a stored MVP, not the formula, and its brief
    >   already handles "no game in the window can be scored". It should know that its pool is now live-eog
    >   games only.
    >
    > ### Amendment (product, 2026-09-15, after step 1 was answered): the battle test may be run once, not twice
    >
    > Step 1 came back real and **M7.14 is scoped below**, which changes the jungle row. Acceptance 8 is still
    > open, so there is a choice about when the read happens, and there is one right answer either way:
    >
    > - **If the battle test is dispatched before M7.14's core half lands**, run it exactly as written above:
    >   two columns, flat M7.8 against the six-component three-bucket formula. M7.14 then owes a short
    >   jungle-only addendum of its own (its acceptance 10).
    > - **If M7.14's core half has already landed**, run it once with **three** columns — flat M7.8, the
    >   six-component three-bucket formula, and the seven-component one — over the same 23 games. That satisfies
    >   this acceptance and M7.14's, and it is strictly better than two separate reads because the two changes
    >   stay separately visible in one table instead of being conflated in either.
    >
    > What it may not become is one read that reports only "flat versus whatever is in core today". The point of
    > acceptance 8 is to see what the bucketing did, and a table that folds the seventh component into that
    > number cannot answer it.
    >
    > ### Battle test (platform-engineer + lead, 2026-09-15)
    >
    > Run before M7.14's core half landed, so this is the two-column read the amendment above calls for — flat
    > M7.8 against the six-component three buckets — over the same 23 real ten-human customs M7.12 measured
    > (hosted `kustom` project, 2026-09-08 22:39 to 2026-09-14 23:45, 230 player rows, `apps/web/scripts/m7-13-battle-test.ts`
    > against the user's own pasted SQL extraction). Read-only; nothing was written.
    >
    > | # | night | won | MVP — flat M7.8 | MVP — three buckets | ACE — flat M7.8 | ACE — three buckets | moved |
    > |---|---|---|---|---|---|---|---|
    > | 1 | 09-08 22:39 | red | Raafat (mid) | Raafat (mid) | PRT Shou3man (top) | PRT Shou3man (top) | |
    > | 2 | 09-08 23:25 | blue | Ramzyinhović (jungle) | Ramzyinhović (jungle) | PRT Khokha (top) | PRT Khokha (top) | |
    > | 3 | 09-09 21:56 | blue | XETA (top) | **Raafat (mid)** | Ramzyinhović (top) | Ramzyinhović (top) | MVP |
    > | 4 | 09-09 22:43 | red | Ramzyinhović (top) | Ramzyinhović (top) | knifiy (support) | knifiy (support) | |
    > | 5 | 09-10 22:59 | blue | Bot (adc) | Bot (adc) | 1sec Reloading (support) | 1sec Reloading (support) | |
    > | 6 | 09-10 23:32 | red | Raafat (top) | Raafat (top) | Bot (adc) | Bot (adc) | |
    > | 7 | 09-11 00:05 | red | Menaçe (top) | Menaçe (top) | Ramzyinhović (jungle) | **Bot (adc)** | ACE |
    > | 8 | 09-11 21:29 | red | Ramzyinhović (top) | **knifiy (jungle)** | Menaçe (adc) | Menaçe (adc) | MVP |
    > | 9 | 09-11 22:13 | blue | Ramzyinhović (top) | Ramzyinhović (top) | 1sec Reloading (adc) | 1sec Reloading (adc) | |
    > | 10 | 09-11 22:57 | blue | Ramzyinhović (top) | Ramzyinhović (top) | Menaçe (adc) | Menaçe (adc) | |
    > | 11 | 09-11 23:49 | blue | Bot (adc) | Bot (adc) | PRT Empty (top) | PRT Empty (top) | |
    > | 12 | 09-12 21:24 | blue | Ramzyinhović (top) | **Rano of Zaun (support)** | Bot (adc) | Bot (adc) | MVP |
    > | 13 | 09-12 22:03 | blue | Rano of Zaun (support) | Rano of Zaun (support) | PRT Khokha (top) | PRT Khokha (top) | |
    > | 14 | 09-12 22:43 | blue | Ramzyinhović (top) | **Bot (adc)** | 1sec Reloading (adc) | 1sec Reloading (adc) | MVP |
    > | 15 | 09-12 23:36 | blue | Menaçe (adc) | Menaçe (adc) | PRT Shou3man (jungle) | **Rano of Zaun (support)** | ACE |
    > | 16 | 09-13 21:13 | red | Ramzyinhović (top) | **SugarPapy (mid)** | FoxHound (support) | **xXDarkExodiaXx (adc)** | both |
    > | 17 | 09-13 22:30 | blue | 1sec Reloading (adc) | 1sec Reloading (adc) | knifiy (jungle) | **Ramzyinhović (top)** | ACE |
    > | 18 | 09-13 23:13 | blue | Raafat (top) | Raafat (top) | Ramzyinhović (jungle) | **SugarPapy (top)** | ACE |
    > | 19 | 09-13 23:43 | red | Ramzyinhović (top) | Ramzyinhović (top) | Raafat (mid) | Raafat (mid) | |
    > | 20 | 09-14 21:16 | red | Ramzyinhović (mid) | Ramzyinhović (mid) | Menaçe (adc) | Menaçe (adc) | |
    > | 21 | 09-14 21:55 | blue | Bot (adc) | Bot (adc) | SugarPapy (jungle) | **Menaçe (adc)** | ACE |
    > | 22 | 09-14 22:46 | blue | PRT Empty (jungle) | **Raafat (mid)** | Ramzyinhović (adc) | Ramzyinhović (adc) | MVP |
    > | 23 | 09-14 23:45 | red | Ramzyinhović (top) | Ramzyinhović (top) | Bot (top) | **PRT Khokha (mid)** | ACE |
    >
    > **Totals.** 23 of 23 games scored by both — 0 role-less, matching M7.12's 0-of-230-null exactly. **MVPs
    > moved on 6 of 23** (26%). **ACEs moved on 7 of 23** (30%). Neither pick moved on 11 of 23 (48%).
    >
    > | role | MVP flat | MVP buckets | ACE flat | ACE buckets |
    > |---|---|---|---|---|
    > | top | 13 | 8 | 6 | 7 |
    > | jungle | 2 | 2 | 5 | 0 |
    > | mid | 2 | 5 | 1 | 2 |
    > | adc | 5 | 6 | 8 | 11 |
    > | support | 1 | 2 | 3 | 3 |
    >
    > Every moved pick's own score under both formulas (so the size of each disagreement is visible, not just its
    > direction) is in the script's full output; the closest was a 0.001 margin (jungle ACE, 09-13 23:13), the
    > widest a 0.135 margin (support MVP, 09-12 21:24). No moved pick's new score was a blowout over the field —
    > every new MVP and ACE either held or took the top score in its own game, never a distant second promoted by
    > the arithmetic.
    >
    > **Judgement (drafted from the tables above; the user watched these nights and has the final read).** The
    > shift is moderate and goes exactly the direction the redesign intended: top drops from carrying 19 of 46
    > awards to 15, almost entirely because vision fell from 0.25 to 0.05 in the carry vector, and the clearest
    > case is game 3 — a modest-damage, high-vision top laner loses MVP to a mid laner who did 69,609 damage,
    > nearly triple anyone else's, which under the flat formula's heavier vision weight he'd never have won.
    > Support picks up two MVPs it never had under the flat formula (games 12 and 13's Rano of Zaun, both on
    > monster-assist, monster-vision lines) and jungle loses every ACE it held (5 of 23 down to 0) — junglers'
    > relatively low damage and gold next to laners now costs them the "least bad on the losing side" slot more
    > often. Nothing in the 13 moved rows reads as a wrong or surprising winner from the stat line alone; several
    > (games 3, 12, 16) look like real corrections of exactly the kind the milestone exists to make. **Recommend
    > proceeding to M7.9.**

- [ ] **M7.14** (platform half landed 2026-09-15, reviewed clean: migration `0015_damage_to_objectives.sql` on `game_players`, nullable, no default, `>= 0` check as defence in depth, `damage_to_objectives`/`damageToObjectives` named after its sibling `damage_to_champs` rather than the client's own words; `RawGameFacts` reads it uppercase-first with the load-bearing camelCase fallback (proven against a match-detail fixture carrying no uppercase key at all); ingest writes it through `storedStat` beside M7.7's two; `copyRawStats` extended to a third column with its own per-column shortfall count, so the objectives number can't hide behind M7.7's already-zero one. **Pushed to hosted and backfilled 2026-09-15** (the user): migration `0015` applied, `copy-raw-stats` ran against the hosted project — 44 games with a gap, all 44 fillable, 436 rows filled on `damage_to_objectives`, **0 rows still short on any of the three columns**. The core half in `packages/core` is clear to proceed.) Damage to objectives: the seventh component, and the one row that reads it. A migration, an
  ingest fill, a backwards copy out of `games.raw`, and one more number in `packages/core`'s **jungle** vector —
  the follow-up M7.13's step 1 opened when `damageDealtToObjectives` came back real, per-player and non-zero on
  both stored shapes. **The weights are already set** (M7.13's brief pre-answered them and this brief repeats
  them verbatim); nobody hand-sets a weight twice. `carry` and `support` carry the component at 0.00 and no
  score in those two buckets moves by one digit. *(owner: `platform-engineer` for the migration, the boundary
  field, the ingest and the copy; `core-engineer` for the component and the vector; after M7.7 ✓ and M7.13's
  core ✓. **It does not gate M7.9 or M7.10. It must land before M7.11**, the one rebuild.)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Why this is its own task and not part of M7.13
    >
    > A jungler's job is objectives and **none of M7.8's six components reads one**. M7.13 found the number and
    > deliberately did not take it: a seventh component needs a column, an ingest change and a backwards copy —
    > schema work, in a task that had to stay pure and land before M7.9 — and, because the missing-input rule is
    > all-or-nothing, a core change that lands before the column is filled takes the MVP off every stored game
    > until the copy runs. So M7.13 shipped the six-component table unconditionally, wrote down the jungle row it
    > would want if the number were real, and opened this.
    >
    > It is real. A hosted-DB read on 2026-09-15 across every stored game with either shape: present on 100% of
    > rows on both, non-zero on 98.6% of live end-of-game rows and 96.3% of backfilled ones, the two key casings
    > never disagreeing where both appear, and genuinely per-player — every game checked has as many distinct
    > values as participants, so it is not a team total copied ten times. **One asymmetry, and it is the thing
    > the reader has to respect:** the live end-of-game block carries both `TOTAL_DAMAGE_DEALT_TO_OBJECTIVES` and
    > `damageDealtToObjectives`; the match-history detail carries **only** the camelCase one, and the uppercase
    > key is null on every row of the backfilled game that was eyeballed. `03-lcu-reference.md` has all of it.
    >
    > This also makes M7's own acceptance sentence literally true. It already promises "the support who ran the
    > map can win it on vision, **the jungler on objectives and fights**, the carry on damage". Until this lands,
    > the jungler is read on fights and farm, and "objectives" in that sentence is a claim the numbers do not
    > support.
    >
    > ### What a player sees
    >
    > Nothing until M7.10 prints a name, and then: a jungler who took the map — towers, dragons, barons — can win
    > MVP for taking it, instead of having to out-KDA or out-farm a laner to be noticed for it. Nothing changes
    > for a top, a mid, an adc or a support: their weights are untouched and their seventh weight is 0.00.
    >
    > ### The rule
    >
    > A seventh component, `damageToObjectives`, joins the six in `performanceScores`. It is read for all ten
    > players, normalised inside the game like every other component — divided by the best of the ten, clamped
    > into `[0, 1]` — and multiplied by the player's own bucket weight. Three vectors, still keyed by bucket,
    > still summing to 1.00 each:
    >
    > | component | `carry` (top/mid/adc) | `jungle` | `support` |
    > |---|---|---|---|
    > | KDA | 0.15 | **0.20** | 0.25 |
    > | damage to champions | 0.30 | 0.20 | 0.05 |
    > | gold | 0.20 | **0.10** | 0.05 |
    > | vision score | 0.05 | 0.15 | 0.40 |
    > | damage self-mitigated | 0.10 | 0.10 | 0.15 |
    > | CS | 0.20 | **0.10** | 0.10 |
    > | **damage to objectives** | **0.00** | **0.15** | **0.00** |
    >
    > The jungle row is M7.13's pre-answered table, verbatim, and the reasoning is its reasoning: the 0.15 comes
    > off gold, CS and KDA, 0.05 each — gold and CS because objective damage is a second reading of the same
    > farming clock and would otherwise be counted three times, KDA by one notch because a jungler taking
    > objectives is doing the thing ganks were a proxy for. **The `carry` and `support` rows do not move.** Their
    > seventh weight is `0.00`, which multiplies out to nothing: every carry and support score is bit-for-bit
    > what it was before this task, and a test should say so.
    >
    > These are tunables in `config.ts` like every other number in this project, not gospel — the same sentence
    > M7.8's and M7.13's briefs carry — and this task may not tune them. They were set once, by the user, in
    > M7.13's brief.
    >
    > ### The missing-input rule: universal, and not scoped to where the weight is above zero
    >
    > **If any of the ten is missing the objectives number, the game has no MVP and no ACE** — including when the
    > player missing it is a carry or a support whose weight on it is 0.00.
    >
    > This is not a new rule and it is not a choice made here for tidiness. `componentsOf` in
    > `packages/core/src/rating/performance.ts` already checks all eight of its inputs for every player before
    > any bucket is consulted; the missing-stat rule was written per game and never per player, before roles
    > existed, and M7.13 applied the same shape to the role. Three reasons it stays universal:
    >
    > 1. **The denominator is the whole game.** Every component is normalised against the best of the ten. A
    >    carry with a null objectives number does not simply score zero on it — they drop out of the maximum, so
    >    the jungler's share is measured against a field of nine. The jungler's score would then depend on
    >    whether we happened to store a *laner's* number, which is exactly the kind of quiet arbitrariness the
    >    all-or-nothing rule exists to refuse.
    > 2. **A weight-scoped rule makes a tunable rewrite history.** If "missing" only counted where the weight is
    >    above zero, then moving `carry`'s objectives weight from `0.00` to `0.02` one evening would silently
    >    change *which past games are scorable at all* — a config nudge reaching back through the history. A
    >    weight may change what a score is; it may never change whether a game has one.
    > 3. **One rule is explainable and two are not.** "A game we cannot read completely has no best player" is a
    >    sentence a friend accepts. "A game we cannot read completely has no best player unless the part we
    >    cannot read did not count for that person anyway" is not.
    >
    > So `componentsOf` gains a ninth checked input and returns `null` if it is missing, exactly as it does for
    > the other eight. Nothing about the shape of the rule changes.
    >
    > ### Does this blank every stored MVP? Only if the halves land in the wrong order
    >
    > This is the concern M7.13 raised, and the answer is sequencing inside this task, not a softer rule.
    >
    > **The platform half lands first and the copy runs before the core half is merged.** In order: the migration,
    > the ingest fill, deployed; then `pnpm --filter web copy-raw-stats` against the hosted project until it
    > reports **zero rows still short on `damage_to_objectives`**; then, and only then, the seventh component in
    > `packages/core`. Done that way, no stored game ever passes through a state where core demands a number the
    > database does not have, and no live night falls in a gap: from the deploy onward ingest fills it, and
    > everything before the deploy is what the copy is for.
    >
    > **What is at stake if the order is reversed** is every game's MVP, for as long as it takes to run a script —
    > today that is nothing, because M7.9 has not landed and no row stores an MVP anywhere; after M7.9 it is the
    > stored answer on every game in the history until the copy finishes. There is no reason to find out.
    >
    > **If the copy cannot fill everything, stop and report before merging the core half.** A row that stays null
    > is a game that has no MVP for ever. The verification says that should be zero rows — the stat is present on
    > 100% of rows on both shapes — so a non-zero count means something was not understood, and the right move is
    > a finding for the lead and the user, not a merge. (M7.7's own copy reported 0 rows still short on 44 games,
    > so there is a precedent for what "fine" looks like.)
    >
    > ### The column
    >
    > The next free migration number, mirroring `0014_vision_and_mitigation.sql` in every respect:
    >
    > - `damage_to_objectives integer` on `game_players`, **nullable, no default**. `null` means "this game never
    >   stored it", which is not the fact `0` states — a jungler who never touched a dragon really did do zero,
    >   and the two must not read the same.
    > - `check (damage_to_objectives >= 0)` as defence in depth only. **`storedStat` in
    >   `apps/web/lib/ingest/statValue.ts` is the real gate**, for M7.7's reviewed reason: a negative or
    >   out-of-int4 number reaching the insert 500s ingest *after* the `games` row is stored, so the companion
    >   retries the same game into the same 500 for ever. Every write of this column goes through `storedStat`,
    >   in ingest and in the copy, and a value it refuses is stored as `null` rather than clamped.
    > - A `comment on column` in the house style of 0014's two, naming both client keys and what `null` means.
    > - No RLS change, for 0014's reason: the column is publicly readable like every other column on the table,
    >   and the identical number is already public inside `games.raw`.
    >
    > **The name is `damage_to_objectives`, and `damageToObjectives` everywhere in our own code** — the core
    > component, `RawGameFacts`, the boundary field. 0014's migration says names follow the client's own words,
    > and that is why it is `damage_self_mitigated`; this one has a sibling that outranks the rule. Damage to
    > champions is already `damageToChamps` in core and `damageToChamps` on the boundary, from a client key
    > called `TOTAL_DAMAGE_DEALT_TO_CHAMPIONS`. Damage to objectives is the same stat family read against a
    > different target, and the two must not be named by two different conventions in the same weights table.
    >
    > ### Filling it
    >
    > - **The reader**: one more field on `RawGameFacts` in `apps/web/lib/stats/rawFacts.ts`, read as
    >   `asInt(stats.TOTAL_DAMAGE_DEALT_TO_OBJECTIVES) ?? asInt(stats.damageDealtToObjectives)` — the same
    >   uppercase-then-camelCase order M2.10 uses for every stat. The fallback is not decoration here: the
    >   match-history detail carries **only** the camelCase key, so a reader that required the uppercase one
    >   would fill live games and silently leave every backfilled game null.
    > - **At ingest**: `apps/web/lib/ingest/game.ts` already reads the posted `raw` block once through
    >   `rawFactsFromUnknown`. One more `storedStat(...)` beside `vision_score` and `damage_self_mitigated`.
    > - **On the boundary**: one optional `damageToObjectives` field on `companionGameParticipantSchema`
    >   (`packages/db/src/schemas/companion.ts`), `nullish().default(null)`, with the source table in the doc
    >   comment extended — symmetric with M7.7's two, which exist as a fallback the mapper does not yet fill.
    >   **No `packages/lcu` mapper change and no companion release is owed**: the decision of 2026-09-15 stands
    >   unchanged, every exe the group has ever run already puts the whole scrubbed block into `games.raw`, and
    >   `scrubValue` redacts nothing that looks like this key.
    > - **Backwards**: extend the existing `copyRawStats.ts` / `pnpm --filter web copy-raw-stats` to the third
    >   column rather than writing a second script. Same pattern, same `storedStat` gate, same "only ever fills a
    >   null, never overwrites", same safe-to-run-twice, and the report gains a per-column count of rows still
    >   short so the `damage_to_objectives` number can be read on its own. One command in CLAUDE.md, updated to
    >   say three numbers instead of two, not a second one-off beside it.
    >
    > ### Sequencing: this does not gate M7.9, and it does gate M7.11
    >
    > M7.13 gated M7.9 and this does not, which is a real difference and not an oversight. M7.13 *replaced* the
    > formula M7.9 was about to start storing answers from, and the whole argument for revising M7.8 in place
    > rather than layering was that nothing had been applied yet. This task adds a component to a formula that is
    > now settled, behind a hosted migration and a copy run the user has to trigger. Holding M7.9, M7.10 and the
    > end of the milestone behind schema work would trade a real stall for a cost that is already paid for:
    >
    > - **Before M7.11**, hard. M7.11 is the one rebuild and it restates every stored MVP under whatever is in
    >   core when it runs. If this lands after it, the milestone owes a second rebuild, which breaks the
    >   one-rebuild resolution of 2026-09-15 — and at that point this stops being an M7 task and becomes
    >   something the user has to agree to pay a second rebuild for.
    > - **Before M7.10, strongly preferred.** M7.10 prints names into Discord, and a Discord post is never
    >   rewritten. If a jungler-less MVP is posted on Tuesday and M7.11's rebuild later gives that game to the
    >   jungler, `/p/[puuid]` and the post disagree for ever about one night. That is small and survivable —
    >   the rebuild restating stored history is exactly what M7.9's brief already accepts — but it is free to
    >   avoid by landing this first, and it is not free to undo.
    > - **Beside M7.9 is fine.** M7.9 hands the scorer whatever columns exist; it needs no change for this, the
    >   same way it needed none for M7.13.
    >
    > ### The battle test
    >
    > These weights get the same validation M7.13's got: inspection against this group's real games, read-only.
    > M7.13's acceptance 8 is still open, so **do not run that read twice** — its brief was amended today with
    > the rule:
    >
    > - If M7.13's battle test has **not** run when this task's core half lands, run it once with **three**
    >   columns (flat M7.8, six-component three-bucket, seven-component) over M7.12's same 23 games, and it
    >   satisfies both acceptances.
    > - If it **has** already run, this task owes a **jungle-only addendum**: over the same 23 games, how many
    >   MVPs and ACEs moved when the seventh component was added, listed game by game with the jungler's own
    >   score before and after, plus the confirmation that no carry's or support's score changed at all.
    >
    > Either way: read-only, nothing written, no rebuild, appended as an indented block under this brief, and
    > **if the new picks look worse the task stops and reports** rather than tuning the weights until the table
    > looks nicer. Fitting on 23 games is the thing this design exists to avoid.
    >
    > ### Edge cases
    >
    > - **A backfilled game** has the camelCase key only, and the copy fills it. It still has no MVP, because all
    >   ten of its roles are null (M7.13). Fill it anyway: the column is cheap, the copy should not carry a
    >   special case, and M5.18 may one day give those games roles.
    > - **A blob that never carried the number** leaves `null`, never `0`, and that game has no MVP for ever.
    >   Expected count: zero. If it is not zero, see "stop and report" above.
    > - **A negative or out-of-int4 value** becomes `null` through `storedStat`, ingest returns 200, the game
    >   lands and rates. It is never clamped to `0` or `INT32_MAX`.
    > - **An ARAM custom** stores the number like any other and is never rated (M7.1), so it never has an MVP.
    > - **Every one of the ten did zero objective damage** — a 12-minute surrender with no plates: the component's
    >   game-wide maximum is `0`, so it contributes zero to everybody, exactly as the existing `best <= 0` branch
    >   already does for the other six. The jungle row's remaining weights then sum to 0.85 for everyone in that
    >   bucket, which lowers junglers' scores uniformly and changes no ordering *within* the bucket; it can change
    >   a jungler-versus-laner comparison, and that is the honest consequence of the game having no objectives in
    >   it. No renormalisation — renormalising per game would mean the weights differ game to game, which is a
    >   second model.
    > - **A game with fewer than ten rows** never reaches the scorer; it is gated out before the fold.
    > - **A second companion posting the same game** is the same `lcu_game_id` no-op it is today.
    > - **A game ingested between the deploy and the copy run** is filled by ingest, not by the copy, and the copy
    >   skips it because it only fills nulls.
    >
    > ### Acceptance
    >
    > 1. The migration applies locally (`pnpm db:reset`) and to the hosted project; `pnpm db:types` regenerated
    >    and committed. The column is nullable with no default and a `>= 0` check, and carries a comment naming
    >    both client keys.
    > 2. A live end-of-game post fills the column for all ten; a backfilled match-history detail fills it too,
    >    from the camelCase key alone.
    > 3. A blob missing the key writes `null`, and a blob with a negative or out-of-int4 value writes `null`,
    >    with a test — the game stores and rates in both cases, and ingest does not 500.
    > 4. `pnpm --filter web copy-raw-stats` fills the new column on stored rows, is safe to run twice, and reports
    >    rows filled and **rows still short per column**. The hosted run's numbers are written into the status row
    >    and the checkbox, M7.7-style, and the `damage_to_objectives` shortfall is **zero** before the core half
    >    merges.
    > 5. `performanceScores` reads a seventh component. `PerformanceStats` gains `damageToObjectives`, and
    >    `componentsOf` returns `null` when it is missing **for any player, whatever that player's bucket weight
    >    is** — pinned by a test that gives a *carry* the null and asserts the whole game scores `null`.
    > 6. The three vectors in `config.rating.performance` each have seven entries and each still sum to 1.00, the
    >    existing sum test now covering the seventh. `carry` and `support` are `0.00` on it.
    > 7. A test proves `carry` and `support` scores are unchanged to the last bit by this task: the same hand-built
    >    ten scored with and without objectives values produces identical scores for every non-jungle player.
    > 8. A test where the jungler has the game's best objective damage and is otherwise mid-table shows them
    >    winning MVP under the seven-component weights and not under the six — the change doing its one job,
    >    pinned so a later tune cannot silently undo it.
    > 9. Every other property of M7.8 and M7.13 is unchanged and still tested: within-game normalisation, the
    >    `[0, 1]` range, five-a-side, ties by puuid ascending, 1.25× / 0.80×, `sigma` untouched, the missing-role
    >    rule, and `rateGame` / `rateGameWeekly` untouched with M1.3's and M7.2's tests passing unmodified.
    > 10. The battle test landed in one of its two shapes above, read-only, appended under a brief, with its
    >     headline numbers in the status row.
    > 11. `01-architecture.md`'s rating section carries the seven-component table, replacing M7.13's six-component
    >     one rather than sitting beside it. `03-lcu-reference.md`'s objectives sentence names the column that now
    >     stores the number. CLAUDE.md's `copy-raw-stats` entry says three numbers.
    > 12. `00-product.md`'s "Carrying is worth a little more" paragraph is updated with the copy below, **in the
    >     session this lands** and not before — the doc describes what is running.
    > 13. A decision row records the universal missing-input rule and the sequencing; `pnpm -r typecheck`,
    >     `pnpm -r test` and `pnpm lint` pass; the status table is updated.
    >
    > ### The player-facing copy, written here so nobody invents it
    >
    > In `00-product.md`, "Carrying is worth a little more". The sentence that begins `Best means the highest
    > score on a six-part reading` becomes:
    >
    > > Best means the highest score on a seven-part reading of that game: kills and assists against deaths,
    > > damage to champions, gold, vision, damage soaked, CS, and damage to towers, dragons and barons. The first
    > > six count for everybody, near enough the shape op.gg's MVP and ACE use; the seventh counts for the jungler
    > > and nobody else. Everyone is read against the other nine people who were actually in that game, never
    > > against some average player somewhere else.
    >
    > and the role clause a few lines later gains one ending:
    >
    > > ...and a jungler is read somewhere between the two, plus the one number nobody else is scored on: what
    > > they took off the map (M7.14).
    >
    > Nothing else in that paragraph moves. **No new clause about missing numbers is owed** as long as acceptance
    > 4's shortfall is zero: the copy makes the history whole, so there is no class of game a friend could notice
    > losing its MVP. If the shortfall is not zero, this brief's copy is incomplete and product owes one more
    > sentence before it ships.
    >
    > ### Out of scope
    >
    > - **Tuning any weight**, including the jungle row. It was set in M7.13's brief and is repeated above
    >   verbatim; a task that re-derives it has gone wrong.
    > - **A five-role split**, now or later, unless something new tells top from mid.
    > - **An eighth component.** Kill participation stays the candidate it has been since 2026-09-15.
    > - **Showing the number anywhere.** Not on `/games`, not on `/fun`, not on the scoreboard, not on
    >   `/p/[puuid]`, and the performance score itself is still never printed (M7.8's rule).
    > - **A rebuild.** M7.11 is still the one run.
    > - Any change to the balancer, off-role cost, `inferRoles`, `assignRoles`, or what the model thinks your main
    >   is.
    > - Any Riot public API call, any external baseline, any fitting.

Acceptance: an ARAM night moves nobody's rating; `This week` on the leaderboard is the week the group actually
had, and `All time` is still the one number the balancer uses; a player filled last night is filled again only
when there is nobody else; the person who carried the game keeps a little more of it and the post says who
they were; every rating moved exactly once, on the night M7.11 ran, and the group heard it from us first; and
the all-time rating has still never been reset. And, separately from all of that and visible on no page, we
know in a number how often the client's own `detectedTeamPosition` gets a ten-human custom's roles right —
measured, not assumed, with nothing changed to find out. And because that number came back good, the person who
carried is worked out against what their role was for: the support who ran the map can win it on vision, the
jungler on objectives and fights (objectives from **M7.14**, which is what makes this clause literally true —
M7.13's six components read fights and farm), the carry on damage, and on a game where we do not know who played
what, nobody wins it at all.

## M8 The day after: rivals, the awards where people look, and a second guessing game (1 to 2 days, needs M5; M8.4 needs M7)

Goal: more to read and one more thing to play on the morning after a night of customs. Opened 2026-09-15 from
four ideas the user asked for that evening. **Three of them are here and one is not**, and the honest reason is
worth writing down, because these three do not share a subject the way M7's four did.

What makes M8 one milestone is not a theme, it is a **class of change**: every task here is a **read over games
that are already stored**. No task adds a capture, an LCU call, a companion release, or a step in the nightly
loop, and no task touches the rating model — each one carries the same sentence M5.24 to M5.33 carry,
`does not change /stats, the awards, or the rating model`, and a diff that touches `packages/core/src/rating`,
`lib/ingest/` or `lib/board/load.ts`'s ordering is a diff that went wrong. (M8.4 owes one additive migration for
the second game's `kind`; nothing in it reads or writes a rating.) That is a weaker unit than M7's and it is
deliberately named as one: this is the museum getting bigger, not a change to how the referee works.

**The fourth idea is not in M8.** "How even are the teams, as a percentage" is **M3.31**, in the milestone that
owns the tonight page and the sentence under the teams, because that is what it is — one more line in the
explanation M3.11 already writes, computed from a column that is already stored. Parking it here to make a round
number of four would have put a one-line display transform behind a migration and a guessing game.

**A fifth idea — widening `sigma` for players who have been away — is not in M8 either, and is not built yet.**
It is **M9**, which opens with a **read**: M9.1 asks the database whether a comeback game really does move
somebody harder than anybody else at the same uncertainty, and the decay function itself (M9.2) has no brief
until that answer exists. It is a rating-model change that reaches team-forming, and it arrived in a batch with
three stats ideas; scoping it as though it were one of them is how a referee stops being one.

**Sequencing: M8 starts after M7 clears.** Nothing in M8 is urgent and two of its tasks queue behind M7's own
contention, exactly as M7 itself was queued behind M5:

- `apps/web` is M7's busiest thread — `M7.1 → M7.7 → M7.3 → M7.4 → M7.9 → M7.10 → M7.11`. M8.1, M8.2 and M8.3
  all edit `apps/web/lib/stats/*` and `apps/web/lib/board/*`, and M8.3 reads `awardsView`, which **M7.4 is
  rewriting**. Start M8.1 and M8.2 no earlier than M7.4; start M8.3 after it.
- `packages/core` is M7.2 → M7.5 → M7.8. M8 adds nothing to core, so it never contends there — but **M8.4 needs
  M7.8's `performanceScores` and M7.9's stored answer** and cannot start before both.
- **M7.11 is the one rebuild and M8 must not bring a second.** M8.2 was defined against a stored number on
  purpose so that no M8 surface changes when M7.11 runs.

- [x] **M8.1** (landed 2026-09-15: a new "Friends and enemies" group on `/fun`. `Best duo` calls `duoRecords` verbatim — no second pair fold. `Nemesis` is new: a per-player, asymmetric fold over opposing-side games, ranked by losses against then worse record then more games then name, floored at `MIN_DUO_GAMES` and reused, never a second minimum. Every row prints its denominator, `Lost 7 of 9 to Lena.`, so the count cannot read as an attendance award; a perfect record against somebody is never a nemesis. Both lists expand into their customs newest-first and respect the `?queue=` split. Review confirmed the asymmetry, the tie-break order, and that `/stats`, the awards, the board and `packages/core` are untouched.) Nemesis and best duo on `/fun`. Who beats you, and who you win with. Query-only, over counted games in the open window. **Does not change `/stats`, the awards, or the rating model.** *(owner: `web-engineer`; after M7.4)*

    > **Brief (product, 2026-09-15)**
    >
    > ### What a player sees
    >
    > A new group on `/fun`, in the museum register the page already speaks: two ranked lists, each row a person,
    > each row expandable into the customs behind it with the same `See games` `<details>` M5.33's Luck uses.
    >
    > - **Nemesis** — the person who has beaten them most, with the count and the denominator: `Lost 7 of 9 to Lena.`
    > - **Best duo** — the pair with the best record on the same side: the list `/p/[puuid]`'s `Partners` block
    >   already draws, finally visible on the page where the lobby reads about itself rather than only on one
    >   person's page.
    >
    > ### Best duo is not new maths, and must not become any
    >
    > `duoRecords` in `apps/web/lib/stats/fold.ts` already folds every pair with at least `MIN_DUO_GAMES` (5)
    > games on the same side, and `compareDuos` already fixes the order (rate, then games, then both names). It is
    > what `/p/[puuid]`'s three best and three worst partners are, and what the `cursed duo` award reads. **Call
    > it.** A second pair fold in `fun.ts` would be two answers to one question and the first night they disagreed
    > would be the last night anybody believed either.
    >
    > ### Nemesis is new, and it is the mirror of that file's own note
    >
    > `duoRecords`' comment says it out loud: "a game they played against each other counts for neither the
    > numerator nor the denominator. Rivalries are a different question and are not in this milestone." This is
    > that question. A new fold beside it — **opposing sides**, in a counted game, both rows readable:
    >
    > - It is **per player and asymmetric**. Yuki's nemesis is Lena; Lena's nemesis is somebody else. That is the
    >   point of the word and it is why this is not a pair table.
    > - Ranked by **losses against**, tie-broken by the worse record against them, then by more games against,
    >   then by name. Same shape as every other tie rule in the file.
    > - Minimum **`MIN_DUO_GAMES` games against that person**, reusing the constant rather than inventing a second
    >   floor. Nobody gets a nemesis off one bad night.
    >
    > **The count alone would be an attendance award.** In a group of ten who play the same ten, whoever turns up
    > most is everybody's nemesis by raw losses. That is why the row prints `7 of 9` and not `7`: the denominator
    > is the honest half of the sentence, and a reader can see for themselves whether it is a rivalry or a rota.
    >
    > ### Copy (product; the designer places it, the group's ear overrules the Arabic)
    >
    > `/fun`'s convention since M5.29 is an English title and an Egyptian 3ameya roast beside it, in
    > `lib/stats/funCopy.ts`. Product's proposals, to be read out to the group before merge and changed on the
    > spot if they land badly:
    >
    > - Group heading: **Friends and enemies** / `صحابه وخصومه`
    > - **Nemesis** / `اللي دايما بيكسبه` — row: `Lost 7 of 9 to Lena.`
    > - **Best duo** / `التنائي اللي مبيخسرش` — row: the existing pair line, `8W 2L · 80%`, unchanged from the
    >   partners block so the two pages read the same.
    > - Empty states use the existing sentences (`NO_DUOS`, and a nemesis twin of it), not new ones.
    >
    > ### Edge cases
    >
    > - **Fewer than five games against anybody**: no nemesis row for that person. The section still prints with
    >   its empty sentence, the way every museum does.
    > - **A perfect record against somebody** (0 losses) is never a nemesis; the list is about losses.
    > - **A tie at the top of somebody's own list** — two people have each beaten them 5 of 7 — resolves on the
    >   rules above and is deterministic, pinned in a test.
    > - **A player who has left the group** is still somebody's nemesis; rows are keyed by PUUID and read the
    >   roster for names, so a renamed or departed player behaves exactly as they do everywhere else.
    > - **A nameless player** uses the same `NAMELESS_PLAYER` word every other surface uses.
    > - **ARAM**: both lists respect the `?queue=` split (M5.26) like the rest of the page, and read the same
    >   Rift-by-default universe.
    > - **A window with no games**: the page's existing capped/empty handling, untouched.
    >
    > ### Acceptance
    >
    > 1. Pure functions in `lib/stats/`, tested: a fixture where A beat B six times out of ten names B's nemesis
    >    as A and does **not** name A's nemesis as B.
    > 2. Best duo on `/fun` and `Partners` on `/p/[puuid]` are the same call — a test asserts the top pair on the
    >    page equals `duoRecords(...)[0]` for the same window.
    > 3. Nobody appears with fewer than `MIN_DUO_GAMES` games against their nemesis (test), and `grep` finds no
    >    second minimum constant.
    > 4. Every row expands into the customs it was folded from, newest first, in the M5.28 `<details>` pattern.
    > 5. `/stats`, the three awards, the board and the rating model are untouched (test + a read of the diff).
    > 6. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; the status table is updated; the
    >    copy rows are in `05-design.md`.
    >
    > ### Out of scope
    >
    > A nemesis line on `/p/[puuid]` — the player page has `Partners` already and a second rivalry block there is
    > its own task if the group asks twice. A head-to-head page. Champion-level rivalries. Any change to
    > `duoRecords`, `compareDuos` or `compareDuosWorst`. A fourth award (M8.3).

- [x] **M8.2** (landed 2026-09-15: a "Won against the odds" group on `/fun` — a ranked list of wins from under the posted chance (default 45%, floored at 2 wins) plus the single least-likely win in the window as its own record. Reads `splits.blue_win_prob` for the chosen split of each lobby, the same read `lib/board/load.ts` makes for the M5.30 per-game expand, never a live recompute — reviewer confirmed no `mu_before`/`mu_after` anywhere in the fold and a rebuild-invariance test. The comparison is on the rounded percent the group actually saw that night, not the raw stored float, so a `0.449` game reads as `45%` and does not sneak under a "under 45%" heading. A backfilled game has no lobby and no split and is in neither list. Merged by hand into `apps/web/lib/stats/fun.ts` / `funCopy.ts` / `types.ts` alongside M8.1's already-landed nemesis/best-duo code, since both worktrees touched the same files from a stale base.) Won against the odds: the honest version of "best comeback", from the win chance the balancer already stored. **The user confirmed this definition over the literal biggest-`mu`-swing one on 2026-09-15.** **Does not change `/stats`, the awards, or the rating model.** *(owner: `web-engineer`; after M7.4)*

    > **Brief (product, 2026-09-15)**
    >
    > ### The idea, and why it is not the idea as asked for
    >
    > The ask was "best comeback: the largest single-game rating swing upward". **That award would name the
    > newest player in the group every time, for ever.** Movement scales with `sigma` — the product doc says so in
    > as many words ("five players it barely knows move further than five it has watched for a month") — so the
    > biggest single-game climb is a measurement of who the model knows least, not of who came back. After M7.9 it
    > gets worse: the MVP bonus multiplies the winner's delta by 1.25, so the award becomes "the newest player,
    > on a night they farmed vision". And it would move under **M7.11** and under every future rebuild, so the
    > answer to "who had the best comeback in September" would change in October.
    >
    > There is a number already stored that means what the ask meant. `splits.blue_win_prob` is the chance the
    > balancer gave blue on the night, written when the teams were posted (`lib/ingest/balance.ts`), publicly
    > readable, and **never rewritten by a rebuild**. Winning a game your side was given 31% in is a comeback in
    > the only sense a friend means it: the bot said you would lose and you did not.
    >
    > ### What a player sees
    >
    > A new group on `/fun`: **Won against the odds**.
    >
    > - A ranked list, one row a person: how many customs they won where their own side's posted chance was
    >   **under 45%**, with a `See games` expander listing them (`31% · Won · Tuesday`).
    > - Under it, the one-game record: the single least-likely win in the window, naming the five who did it and
    >   the number they beat.
    >
    > ### The rule
    >
    > - The odds come from the **chosen** split's `blue_win_prob` for the game's lobby — the same `oddsByLobby`
    >   read `lib/board/load.ts` already makes for the per-game expand (M5.30). Do not add a column and do not
    >   recompute a probability from today's ratings: the number on this page has to be the number the group was
    >   shown that night.
    > - A player's own chance is `side === 100 ? p : 1 - p`.
    > - The threshold is **one constant** beside the other `/fun` minimums, default `0.45`, with the ranked list
    >   requiring at least two such wins so a single fluke is not a trophy — the same instinct as every other
    >   floor on the page.
    >
    > ### Edge cases
    >
    > - **A backfilled game has no lobby and no split**, so it has no odds and is in neither list. Most of the
    >   group's history is backfilled; the section will be thin for a while and must say so with its empty
    >   sentence rather than looking broken.
    > - **A rerolled lobby** stored the chosen split's probability, which is the one the group played. Nothing
    >   special to do; check it, do not special-case it.
    > - **A 50% game** is not against the odds. The threshold is a strict `<`.
    > - **An ARAM night** has a lobby and a split like any other and is on the ARAM tab like everything else on
    >   this page (M5.26). It is not rated, which this section does not care about — it reads results, not ratings.
    > - **A tie in the ranked list** breaks on the longest odds beaten, then more games, then name.
    >
    > ### Copy (product; the group's ear overrules the Arabic)
    >
    > - Group heading: **Won against the odds** / `كسبوا وهما خسرانين`
    > - The record line: `Blue won at 31%.` — the posted number, the side, nothing else.
    > - No "upset", no "miracle", no exclamation mark. The bot was wrong and it says so plainly.
    >
    > ### Acceptance
    >
    > 1. A fixture where a side won at 31% puts all five on the list and names that game as the record.
    > 2. A game whose lobby has no split appears in neither list and breaks nothing.
    > 3. Nothing in this task reads `mu_before` or `mu_after` — a `grep` over the new code returns neither.
    > 4. Running `rebuild-ratings` against the local stack does not change one row of this section (test or a
    >    recorded manual check): that is the property the mu-swing version could not have had.
    > 5. The threshold and the minimum are one constant each, in `lib/stats/copy.ts` with the others.
    > 6. `/stats`, the awards and the rating model are untouched; `pnpm -r typecheck`, `pnpm -r test` and
    >    `pnpm --filter web build` pass; the status table is updated; the copy rows are in `05-design.md`.
    >
    > ### Out of scope
    >
    > A largest-mu-swing record anywhere, under any name — if the group wants it after reading this, it needs a
    > decision row that answers the "it always names the newest player" objection. A per-side or per-role cut.
    > Showing the odds on `/games`. Any new column.

- [x] **M8.3** (landed 2026-09-15: `/leaderboard` badges winners' rows on `Last week` and `Last month` only — `This week`, `This month` and `All time` are byte-identical to before, proven by a test client that throws on any query. The brief's escape hatch fired: the board's own loaded rows can't answer the awards' question (different game universe, no `main_role`, a season filter the awards read doesn't have), so `lib/stats/load.ts`'s new `loadAwardWinners` runs a second, parallel window read rather than folding a second `climbs()` into `lib/board/` — see the decision row. No award is computed twice, `lib/board/copy.ts` gains no string, and the badge sits inside the row's existing tap target with no nested control. Still owed: the designer's visual sign-off at 390/1280 the brief's acceptance 6 asks for.) The awards, on the page where people already look. Placement only: the existing three awards as labelled badges on `/leaderboard` rows, from `awardsView` and nothing new. **Does not change what an award means, its minimum, or the rating model.** *(owner: `designer` then `web-engineer`; after M7.4, which rewrites `mostImproved` for week windows)*

    > **Brief (product, 2026-09-15)**
    >
    > ### Read this before scoping anything: two thirds of the ask already shipped
    >
    > The ask was "surface most improved, longest win streak and best comeback as labelled award badges". Against
    > what is in the repo today:
    >
    > | Asked for | Where it already is |
    > |---|---|
    > | Most improved | An award since **M5.4** (`mostImproved` in `lib/stats/awards.ts`), on `/stats`, in the weekly and monthly Discord post, and as the `Most improved, September.` line on `/p/[puuid]` (**M5.20**). **M7.4 is changing what it reads on a week window.** |
    > | Longest win streak | On `/stats` since **M5.4** (`longestStreak(streaks, 'W')`), folded over the same window as the player page since **M5.21**. |
    > | Best comeback | Genuinely new, and it is **M8.2**, under a definition that survives a rebuild. |
    >
    > So there is no new statistic in this task. What is left is **placement**, and that is worth one small task
    > because it is true that nobody visits `/stats` to find out they won something.
    >
    > ### The collision to settle first — and it settles in favour of the existing rule
    >
    > Awards only exist on a **closed** window. `awardPeriod` returns `closed: false` for `this-week` and
    > `this-month`, and M5.4's reason is quoted in the file: "an award that changes every night is a statistic,
    > not an award". `/leaderboard`'s default window is `this-week`. **So on the board as a player usually opens
    > it, there are no awards to badge, and this task does not invent any.** A badge on an open window would
    > un-decide M5.4 to win a placement argument.
    >
    > The result is honest and small: on `Last week` and `Last month`, the winners' rows carry a badge. On
    > `This week`, `This month` and `All time`, nothing changes at all.
    >
    > ### What a player sees
    >
    > They tap `Last week` on the leaderboard. Three rows carry a small label — `Most improved`, `Best off-role`,
    > `Cursed duo` (both halves of the pair get it) — in the row's own size, in the board's own dim, no colour of
    > its own, no icon, no trophy, no `#1`. Tapping the row still opens the per-game expand (M5.30); the badge is
    > not a control.
    >
    > ### The rule
    >
    > - **No new computation and no new read.** The board loader calls `awardsView(kind, games, players)` with the
    >   window it already loaded, or takes the answer `/stats` computes, and matches winners to rows by PUUID. If
    >   it turns out the board's loader cannot reach the awards' game list without a second query, **stop and say
    >   so** rather than folding a second copy of `climbs()` into `lib/board/`.
    > - The three awards, their minimums, their tie rules, their "nobody won it" sentences and the Discord post
    >   are **untouched**.
    > - A row can carry two badges (most improved and cursed duo); they print in the awards' own order and wrap.
    >
    > ### The word `season` does not appear
    >
    > The ask said "named season awards". There are no seasons (**M5.14**, 2026-09-10; the one `season` row is a
    > container whose name is never printed). These are the **window's** awards and they are named after the
    > window the picker is on: `Last week`, `Last month`. No badge, no heading and no tooltip may say `season`.
    >
    > ### Edge cases
    >
    > - **Nobody won an award** (no player cleared the minimum): no badges, and the board is byte-identical to
    >   today's.
    > - **Two winners tie** and both are named today; both rows get the badge.
    > - **A cursed-duo winner who is not on the board** (fewer games than the board's own floor, or missing from
    >   the window's rows) is simply not badged. No ghost row is added.
    > - **The tonight rail** does not badge: it is a five-row snapshot of tonight, not a window's story.
    > - **The Discord post** is unchanged; it already prints the same three lines from the same function.
    >
    > ### Acceptance
    >
    > 1. On `Last week` and `Last month`, the winners' rows carry the label; the strings come from
    >    `lib/stats/copy.ts`'s existing award titles and no new copy constant is introduced.
    > 2. On `This week`, `This month` and `All time`, `/leaderboard` is byte-identical to today's output (test).
    > 3. The awards' own numbers, minimums and lines on `/stats` and in the Discord post are unchanged (test).
    > 4. No second implementation of any award: `grep` for `climbs(` outside `lib/stats/` returns nothing.
    > 5. `grep -ri season apps/web/app/_leaderboard apps/web/lib/board` finds no new occurrence.
    > 6. Floodlit: no emoji, no icon, no award colour, no `#1`; the designer signs the row off at 390 and 1280.
    > 7. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; the status table is updated; the
    >    badge row is in `05-design.md`.
    >
    > ### Out of scope
    >
    > A fourth award. Awards on an open window. Changing a minimum so somebody qualifies. A badge on
    > `/p/[puuid]` — **M5.20** already prints the award line there and a second treatment of the same fact on one
    > page is clutter. An all-time award. Storing awards.

- [ ] **M8.4** Guess the Award: a second daily game on the Daily Mystery engine, where the clues describe a standout stat line and the answer is who it belongs to. **The two games alternate days** (the user, 2026-09-15). Needs M7.7, M7.8 and M7.9. *(owner: `platform-engineer` for the service and the migration, `web-engineer` for the view; last in M8)*

    > **Brief (product, 2026-09-15; the rotation settled by the user the same day)**
    >
    > ### The rotation, settled
    >
    > **Daily Mystery and Guess the Award alternate civil days.** One game a day, never two, decided by the parity
    > of the civil date in `CUSTOMS_NIGHT_TZ` — the same `dayKey` the selector and the cron already agree on, so
    > the lazy create on first GET and the Vercel Cron cannot disagree about which game today is. Two cards on `/`
    > was rejected: it halves the attention each game gets, doubles the chance of an empty one, and makes the top
    > of the home page two guessing games above the thing the page is actually about.
    >
    > ### What that does and does not do to the schema
    >
    > It removes the **reshape**. `daily_mysteries.day` stays unique exactly as migration 0013 wrote it, because
    > there is still one challenge per civil day, and no table is duplicated. What is still owed is one small
    > **additive** migration (the next free number — 0014 is M7.7's):
    >
    > - `kind text not null default 'mystery'` with a check over the two values, and the existing rows take the
    >   default. **The kind is stored, not derived from the date's parity at read time**: a stored challenge has to
    >   keep meaning what it meant, and a rule that reinterprets last month's rows the day somebody changes the
    >   rotation is not a rule.
    > - The `category` check constraint widened (or replaced with a per-kind one) — today it allows only the five
    >   Daily Mystery categories, and the award game's categories are not among them.
    > - `challenge_number`'s unique becomes **`(kind, challenge_number)`**, and `ensure` takes the next number
    >   within the kind. `Daily Mystery #41` is printed in the heading and in the share string; under one shared
    >   counter it would become `#41`, `#43`, `#45` and a friend who plays every day would be counting cases that
    >   never existed. Each game counts its own.
    >
    > That is the whole of it: one column, one constraint, one unique. No second table, no second service.
    >
    > ### What a player sees
    >
    > On a Mystery day, exactly what they see now. On an Award day, the same card in the same place with a
    > different question: instead of "who played like this", the hook is a stat line that stood out — the most
    > damage in a custom, the most deaths, the widest KDA — and the six suspects are the six who could plausibly
    > own it. Progressive clues, one locked guess per anonymous visitor, `who did everyone blame` after lock-in,
    > rotation at civil midnight in `CUSTOMS_NIGHT_TZ`, no accounts and no named leaderboard. Every constraint
    > M5.32 wrote applies here word for word and none of them is renegotiated by this task.
    >
    > ### Copy (product; the designer adds the rows to `05-design.md`)
    >
    > - The award game's title is **Guess the Award**, headed `Guess the Award #7` in the shape
    >   `mysteryHeading` already prints. `MYSTERY_TITLE` is not edited; a second title constant sits beside it.
    > - `shareMissed` today ends `Tomorrow's another case.` **That sentence stops being true** under alternation —
    >   tomorrow is the other game. Both games' missed-share line says `There's another one tomorrow.` instead:
    >   true on either day, and it does not promise a case.
    > - Nothing anywhere names the rotation, prints "today is award day", or explains the parity rule. The card is
    >   whatever it is; a page that explains its own schedule is a page apologising for it.
    >
    > ### There is already a "standout stat line" function, and it is not in `/fun`
    >
    > The idea arrived paired with M8.3 on the assumption that the awards work would produce the scoring. It does
    > not: M8.3 is placement and M8.1 and M8.2 are counts. **M7.8's `performanceScores` and `mvpAce` are exactly
    > this function** — an op.gg-shaped six-component score over one game's own numbers, pure, tested, in
    > `packages/core`, already the thing that decides who carried a game. Use it. A second definition of
    > "standout" in `lib/mystery/` would be a second answer to the question this project spent M7 making
    > trustworthy.
    >
    > That is why this task's real dependency is **M7**, not M8: `performanceScores` needs the six components,
    > two of which (`vision_score`, `damage_self_mitigated`) only exist after **M7.7**, and the stored answer to
    > "who was the MVP" only exists after **M7.9**. Starting this before M7.9 means computing the score at read
    > time in the web app, which **M7.10's brief already forbids**.
    >
    > ### Reuse, do not fork
    >
    > - `select.ts` and `score.ts` gain a **second candidate strategy**, not a second file tree: `pickMystery`,
    >   `shuffleSuspects`, `dayIndex`, the recent-game and recent-player avoidance, the session and attempt
    >   tables, `ensureTodayMystery` and the service-role-only write all stay one implementation.
    > - The view: try the copy/label swap in `MysteryView.tsx` / `MysteryLive.tsx` first. If the two games need
    >   more than labels to diverge, duplicating the small view layer is the cheaper answer and is allowed —
    >   **but the service, the selection and the tables are not duplicated under any circumstances.** Say which
    >   way it went in the decision row.
    > - The clue ladder is per-kind: the award game's clues walk from the vaguest fact about the game to the
    >   narrowest fact about the player, the same shape `clues.ts` already builds.
    >
    > ### Edge cases
    >
    > - **No game in the window has all six components** (everything before M7.7), so today's Award day cannot be
    >   built: **fall back to a Daily Mystery for that day** rather than showing an empty card. The rotation is a
    >   schedule, not a promise, and a card that says "nothing to expose" on a morning when there was plenty to
    >   expose reads as broken. Only when *neither* game can be built does the card say there is nothing to
    >   expose, exactly as M5.32's empty state does, and `/` still loads.
    > - **The fallback does not shift the rotation.** Tomorrow is whatever the parity says tomorrow is; a
    >   fallback day does not "owe" an award day back. Two rules about which game it is would be one too many.
    > - **The answer is obvious** — the standout is the only jungler, or the clue names a champion only one person
    >   plays. The suspect pool is drawn from the same game's ten where possible, which is what keeps it a guess.
    > - **A player who has been the answer recently** is avoided by the existing `MYSTERY_RECENT_PLAYER_DAYS`
    >   rule, and **the two games share that memory**: being yesterday's Daily Mystery answer must exclude you
    >   from today's Guess the Award, or the pair of games leaks its own answer.
    > - **An ARAM custom** is fine as a subject — this reads a scoreboard, not a rating — but it is the one place
    >   a vision-weighted score means nothing, so the selector excludes ARAM and the decision row says why.
    > - **A visitor on two consecutive days** gets one locked guess on each day, in whichever game that day is.
    >   The session and attempt rows are per challenge id and already behave this way; check it, do not build it.
    > - **The rotation flips at civil midnight**, with the challenge, and not at the night's 06:00 boundary. The
    >   two games rotate on the same clock Daily Mystery already rotates on (M5.32), which is not the clock a
    >   *night* uses — that is a known and deliberate difference and it is not reopened here.
    > - **The answer never ships in the first GET**, the M5.32 rule and the reason 0013 is service-role only.
    >
    > ### Acceptance
    >
    > 1. One challenge exists per civil day, never two, and which game it is follows the date's parity: a test
    >    walks fourteen consecutive days and asserts the alternation and that `kind` is **stored**, not inferred.
    > 2. One service, one selection module, one set of tables, one additive migration (`kind`, the widened
    >    `category` check, the `(kind, challenge_number)` unique). `grep` finds no second `ensureToday*` and no
    >    second challenge table.
    > 3. `Daily Mystery #N` does not skip a number when an Award day passes (test), and neither does the award
    >    game's own count.
    > 4. The standout is scored by `performanceScores` from `packages/core` — no scoring function is added to
    >    `apps/web/lib/mystery/`.
    > 5. `GET` never contains the answer, the unrevealed clues or the guess distribution; a second visitor on the
    >    same civil day gets the same challenge id; a second guess from one visitor is refused and writes one row.
    > 6. Yesterday's answer in either game cannot be today's answer in either game (test).
    > 7. An Award day with no scorable game falls back to a Daily Mystery and the next day's kind is unchanged
    >    (test). Only an empty database gives the "nothing to expose" card, and `/` still loads.
    > 8. Floodlit: no emoji, no named leaderboard, no accounts; no surface names or explains the rotation.
    > 9. `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter web build` pass; migration applied locally
    >    (`pnpm db:reset`) and to the hosted project with `pnpm db:types` regenerated; the status table is updated;
    >    a decision row records the migration's exact shape and whether the view was reused or duplicated.
    >
    > ### Out of scope
    >
    > Accounts, sign-in, or a named leaderboard — in either game, for ever. A third game. Changing Daily
    > Mystery's selection, clues or copy beyond the one share sentence named above. Printing the performance
    > score as a number anywhere (M7.8's rule). Scoring ARAM. A per-kind cron schedule — the existing one runs
    > every day and builds whatever that day is.

Acceptance: `/fun` tells a person who beats them and who they win with, and names the nights the bot said they
would lose and they did not; last week's winners are labelled where the group actually looks; and every other
morning the thing to guess is which of the ten owns a stat line, scored by the same function that decides who
carried a game. Nothing in this milestone moved anybody's rating by one digit.

## M9 Does coming back after a break actually break the rating? (half a day, needs M7.11)

The user asked on 2026-09-15 for a pure `applyInactivityDecay(rating, daysSinceLastGame)` that widens `sigma` for
a player who has been away, called from `rebuild-ratings` before folding each of their games, so that a comeback
game cannot swing a rarely-played player too hard in either direction.

**It is a rating-model change that reaches team-forming, and M7's four deliberately did not.** M7's preamble draws
the line — "the all-time rating that forms teams is not reset by any of it" — and M7.8 refuses to touch `sigma` in
as many words, because "certainty is not something you earn by farming vision". Widening `sigma` moves `ordinal`,
which is **Proven**, which is what the leaderboard sorts on, and it changes what the balancer thinks it knows
about a player who has not played a game. It would also want its own rebuild, the week after M7.11 was meant to be
the only one.

So the milestone opens with a **read, not a build** (the user, 2026-09-15). M9.1 asks the database whether the
problem is real. What it finds is a finding for the lead and the user, and **M9.2 does not exist until they have
read it**.

- [ ] **M9.1** Measure it: how often does somebody come back after a long break, and does their next game move them harder than anyone else's? A query and a written report. **No behaviour changes and no rating moves.** *(owner: `platform-engineer`; after **M7.11**, because the numbers have to be read out of the model the group is actually on)*

    > **Brief (product, 2026-09-15)**
    >
    > ### What this is
    >
    > A diagnostic. It produces **numbers and a paragraph**, and nothing else: no decay function, no config
    > constant, no column, no migration, no change to the fold, the balancer or any page. A reader of the diff
    > should be able to say "this cannot have changed what anybody sees" without thinking about it.
    >
    > ### Why it runs after M7.11 and not before
    >
    > M7 un-rates ARAM and adds the MVP / ACE bonus, and M7.11 refolds the whole history under both. Measuring how
    > hard a comeback game swings somebody **before** that rebuild measures a model the group is about to stop
    > being on — and the MVP bonus multiplies exactly the deltas this task is measuring. Run it on the numbers the
    > group is living with.
    >
    > ### The question, in three parts
    >
    > Over every rated game in the database, per player, in `started_at` then `lcu_game_id` order — the rebuild's
    > own order, so this and the history agree:
    >
    > 1. **How often does it happen?** Count the gaps: for each player, each pair of consecutive rated games more
    >    than **14 days** apart. Report how many such returns there are, how many distinct players have one, and
    >    the distribution of gap lengths (the median and the longest are enough; this is a group of twenty, not a
    >    population study). If the honest answer is "three returns, two players", the rest of the report is short
    >    and the milestone is probably over.
    > 2. **How hard does the comeback game move them?** For each of those returns, the `|mu_after - mu_before|` of
    >    the **first game back**, in display points (`displayRating(mu_after) - displayRating(mu_before)`, the
    >    product's delta rule — the subtraction of two numbers the pages printed), alongside that player's
    >    `sigma` going into it.
    > 3. **Against what?** The same figure for games that are **not** a comeback: the median and the spread of
    >    per-game display movement across all other rated games, split by how settled the player was
    >    (`sigma >= 5.00` and `sigma < 5.00`, the product's own settled line). The comparison that matters is
    >    "a returner's first game back moves them X, a comparable player's ordinary game moves them Y".
    >
    > ### The trap the report must not fall into
    >
    > **A returner probably does move more, and that may be correct rather than broken.** Movement scales with
    > `sigma`, and somebody who has played four games in total and then vanished for a month has a high `sigma`
    > because the model genuinely does not know them — not because they were away. The comparison in part 3 is
    > therefore against players **at a similar `sigma`**, not against the group average. If returners move the same
    > as everyone else at their own uncertainty, the finding is "there is nothing here", and that is a good result
    > to come back with. The report says which of the two it is, in one sentence, at the top.
    >
    > ### Where it lives
    >
    > A script beside the two that exist (`apps/web/scripts/`), run the same way, reading the hosted project with
    > the service role and **writing nothing**. `pnpm --filter web inactivity-report` (add the line to `CLAUDE.md`'s
    > command list, the repo's rule for a new command). Printing to stdout is enough; the report goes in the task's
    > report and into the status table row, not into a dashboard.
    >
    > ### Edge cases
    >
    > - **A player's first ever rated game** is not a return. There is no gap before it.
    > - **A backfilled game** carries a real `started_at` and real `mu` columns after the rebuild, so it counts like
    >   any other. A game still stored unrated has no `mu` at either end and is skipped — say how many were skipped.
    > - **The whole group took a week off.** A gap everybody shares is not one person coming back; report those
    >   returns separately (or note that the dates cluster), or the finding is about a holiday.
    > - **ARAM games** are not rated after M7.1, so they are neither a return nor a gap-breaker: a person who played
    >   ARAM every night for three weeks and no Rift customs **is** a returner by this measure. Note it where it
    >   happens; it may be the most interesting row in the report.
    > - **Fewer than five returns in the whole history**: report exactly that and stop. Do not widen the threshold
    >   to find some.
    >
    > ### Acceptance
    >
    > 1. **Diagnostic only.** The diff adds one script and one command line and touches nothing under
    >    `packages/core`, `apps/web/lib/`, `apps/web/app/` or `packages/db/supabase/migrations/`. No write of any
    >    kind reaches the database — checked, not assumed.
    > 2. The report answers all three questions above with real numbers from the hosted project, and names the date
    >    it was run and that it was run **after** M7.11.
    > 3. The comparison in part 3 is against players at a similar `sigma`, and the report's first sentence says
    >    whether returners move more than that comparison or not.
    > 4. The numbers and that sentence are pasted into the M9 status-table row, so the finding survives the session.
    > 5. **The task ends with a recommendation and no decision.** It may say "this looks real" or "there is nothing
    >    here"; it may not add a decision row that opens M9.2, and it may not write `applyInactivityDecay`.
    > 6. `pnpm -r typecheck` and `pnpm lint` pass; the status table is updated.
    >
    > ### Out of scope
    >
    > The decay function, the threshold, the curve, the ceiling, the config block, the call site in
    > `rebuild-ratings`, and any rebuild. Changing anybody's rating by one digit. A page, a chart or an admin
    > screen. Deciding whether M9.2 happens — that is the user's, off this report.

- [ ] **M9.2** Skill decay itself, if M9.1 says it is real. **Not scoped: no brief, and not to be picked up.** *(blocked on M9.1's finding and the user's call on it)*

    > **Why there is nothing here yet (product, 2026-09-15)**
    >
    > M7 exists because the group spent a week saying the ratings were unfair. The way to not be back there is to
    > change the model when there is a reason and not when there is an idea. M9.1 is the reason, or it is the end
    > of it.
    >
    > If the user opens this after reading M9.1, it needs, before a line is written: the **threshold and the curve
    > and its ceiling** as a decision row (14 days and a cap at some multiple of the seed `sigma` were the user's
    > own starting suggestion, not a settled answer); the ask's own rules, which are already good ones — `mu` is
    > never touched, `sigma` never decreases, a gap under the threshold is a no-op, and two `rebuild-ratings` runs
    > back to back still produce identical output; whether it applies to the **weekly** track as well (M7.2's
    > second channel reseeds from rank every Sunday, so almost certainly not — and "almost certainly" is not an
    > answer that goes into a fold); and **its own rebuild, announced to the group first**, the way M7.11 was.

Acceptance: we know, in numbers, how often somebody comes back after a fortnight away and whether their first
game back moves them further than anyone else's game does at the same uncertainty — and nobody's rating, board
position or team changed while we found out.

## M6 Tray app and polish (when M2 has run for a month)

- [ ] **M6.1** Tauri v2 tray shell that runs the CLI as a sidecar: status icon (disconnected, watching, in game), open logs, edit token, start with Windows.
- [ ] **M6.2** Code signing or a clear "unsigned, built from this repo" note on the download page.
- [ ] **M6.3** Post-patch checklist automation: `smoke` runs on companion start after a client version change and reports shape diffs to the admin.

---

## Sequencing summary

```
M0 ----\
        >---- M2 ---- M3 ----+---- M4
M1 ----/                     \--- M5 ---- M7 ---- M8 ---- M6
```

M0 and M1 can be worked by two agents at the same time. M4 and M5 can too. **M7 comes before M6** although its
number is higher: M6 waits on a month of M2 and M7 is the night's complaint. **M8 comes after M7** and not
beside it: three of its four tasks edit `apps/web/lib/stats/*`, which is M7's busiest thread, and its fourth
needs M7.8's score and M7.9's stored answer.

```
M7.4 (awards read the weekly rating) ---- M8.1 (nemesis + best duo) ----\
                                     \--- M8.2 (won against the odds) ---->---- (M8.3 after M7.4)
M7.9 (the bonus in the fold) ------------ M8.4 (Guess the Award; alternates days with Daily Mystery)
M7.11 (the one rebuild) ----------------- M9.1 (measure the comeback swing; a read, nothing else)
```

**M3.31** (how even the teams are, as a percentage) is the fourth idea of 2026-09-15 and is not in M8: it is a
line under the teams on the tonight page, so it sits in M3. It waits only on **M7.2** and **M7.8**, which are
editing `packages/core/src/rating/index.ts` and `config.ts` beside where it adds two exports.

**M9.1** (measure the comeback swing) runs **after M7.11**, because it has to read the model the group is
actually on — M7 un-rates ARAM and adds the MVP bonus, and the rebuild refolds everything under both. It changes
nothing and can be worked beside any M8 task. **M9.2** (the decay itself) is in no thread, has no brief on
purpose, and does not open until the user has read M9.1's numbers.

Inside M7 the four threads are independent and only join at the one rebuild:

```
M7.1 (ARAM never rates) ---------------------------------------------\
M7.2 (the tuned fold, core) -- M7.3 (the weekly board) -- M7.4 (awards + the weekly post) --\
M7.5 (fill protection, core) -- M7.6 (the input, at the balance call) ------------------ >-- M7.11 (the one rebuild)
M7.7 (vision and mitigation stored) -----------\                                        /
                                                >-- M7.9 (apply it) -- M7.10 (name it) /
M7.8 (the score, core) -- M7.13 (three vectors) /                                      /
M7.14 (objectives: column, copy, 7th component) --------------------------------------/
```

**M7.12** (how good is `detectedTeamPosition`) is in none of those four threads and joins nothing: it is a read
that changes no file the others touch, so it can be worked at any point, including after M7.11. What waited on it
was everything role-aware, and the first of those is now scoped: **M7.13** revises M7.8's weights into three
role-bucketed vectors, in place, in `packages/core`, and **lands before M7.9** so no stored MVP is ever picked by
the flat formula. It owes no rebuild of its own — M7.11 is still the only run — and it adds no column, so it is
on M7.8's thread and nowhere else. **M7.14** (damage to objectives) is the one M7 task that is on two threads at
once: a migration, an ingest fill and a backwards copy on M7.7's thread, and a seventh component on M7.8's. It
**joins only at M7.11**, which is a hard deadline for it — after the one rebuild it would owe a second — while
M7.9 and M7.10 do not wait for it, since it adds to a formula M7.13 already settled rather than replacing one.
Its two halves are ordered against each other and not against anything else: the copy must report no stored row
still short before the core half merges, or every stored game loses its MVP until it does. **M5.35** (does the
client know the roles at `GameStart`?) is the other half
of the role question and is dispatched with the **M5.18** capture night, because the recording is its only input;
it is not a dependency of M7.13, which reads the role the end-of-game block already stores.

M7.1, M7.2, M7.5, M7.7 and M7.8 can be worked at the same time. M7.13 comes after M7.8 and before M7.9. M7.14
comes after M7.13's core half and before M7.11, beside M7.9 and M7.10 rather than in front of them. M7.9
lands in the same session as M7.7's backwards copy. **M5.34 (the week starts on Sunday) lands before M7.3**: it is not a rating task and it is not
in M7, but M7.3 reseeds the weekly rating on the week's own boundary and that boundary moves. **M7.11 is the
last task that changes a number and is the only `rebuild-ratings` run in the milestone** — no task before it
rebuilds the hosted project, so the group's numbers move once, and M7.12 after it moves none.

Inside M5, after the 2026-09-10 reshape (seasons out, windows in), the order is:

```
M5.9 (boundaries) ---- M5.12 (picker, pages, nightly post) ---- M5.4 (/stats + awards) ---- M5.10 (the embed) ---- M5.13 (the cron)
                                                            \-- M5.8 (designer pass, after M5.4) ---- M5.20 (the player page's own sections, after M5.8)
M5.14 (remove season creation) — independent, do it early; it is the smallest and it removes the only destructive button in the app.
M5.16 (infer roles, core) ---- M5.17 (store them, admin selectors out)
M5.18 (roles for backfilled games) — independent; it makes M5.4 and M5.17 richer, not correct.
M5.35 (is selectedPosition real at GameStart?) — rides on M5.18's capture night; no endpoint, no release.
M5.15 (how you got here) — needs only M3.5; exact once M5.7 lands.
```
