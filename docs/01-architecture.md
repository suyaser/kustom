# Architecture

## Components

```
+----------------------+        HTTPS (bearer token)        +---------------------------+
| Companion (Windows)  | --------------------------------> | apps/web on Vercel        |
|  packages/lcu        |   POST /api/companion/lobby        |  Next.js route handlers   |
|  lobby watcher       |   POST /api/companion/game         |  packages/core (balance,  |
|  eog capture         |   POST /api/companion/rank         |    rating)                |
|  rank sync           |   GET  /api/companion/me           |  Supabase client          |
|                      |   GET  /api/companion/commands     |                           |
|  lobby automation    | <-------------------------------- |                           |
+----------------------+   (create lobby, invite, switch)   +------------+--------------+
        |  local HTTPS + WSS                                             |
        v                                                               v
+----------------------+                                   +---------------------------+
| League client        |                                   | Supabase                  |
|  127.0.0.1:<port>    |                                   |  Postgres, Auth (Discord),|
+----------------------+                                   |  Realtime                 |
                                                           +------------+--------------+
                                                                        |
                        +---------------------------+                   |
                        | Discord                   | <-----------------+
                        |  webhook (M3): teams,     |   apps/web posts via webhook
                        |    results, leaderboard   |
                        |  bot (M4): voice split,   | <-- apps/discord subscribes to Supabase Realtime
                        |    presence               |
                        +---------------------------+
```

One API, one database, one companion binary, one thin bot. The companion never talks to Supabase directly and
never holds a database credential; it holds a per-player companion token.

## Why these choices

| Choice | Reason |
|---|---|
| Supabase | Hosted Postgres plus auth, realtime, and generated types. Discord OAuth for the web is a checkbox. Realtime drives the tonight page and the bot without polling. |
| API in Next.js route handlers, not edge functions | One runtime, one deploy, one place for `packages/core`. Edge functions would add Deno as a second toolchain for no gain at this scale. |
| Companion as a Node CLI first, tray app later | Keeps the whole project TypeScript. `packages/lcu` is shared with any future shell. Packaged with Node single-executable or `pkg`. A Tauri tray wrapper with the CLI as a sidecar is M6. |
| OpenSkill (`openskill` npm) | TrueSkill-family rating with team support, MIT licensed, has `predictWin`. Elo cannot model 5v5 with per-player uncertainty. |
| No Riot public API | The client exposes rank and match history for the logged-in player and rank lookups for others. Removes key approval and rate limits from the project entirely. |
| Discord webhook before bot | Posting messages needs no long-running process. The bot process exists only for voice moves and presence (M4). |

## Data model

Postgres, managed by Supabase migrations in `packages/db/supabase/migrations/`. `0001_init.sql` is the whole
schema below; the listing is kept in step with it.

```sql
seasons        (id, name, starts_at, ends_at, is_active, created_at)
players        (id, puuid unique, summoner_id, game_name, tag_line, display_name,
                discord_id null, is_admin, main_role, secondary_role,
                roles_inferred_at null, roles_counted,          -- 0010, M5.17
                rank_tier, rank_division, rank_lp, rank_updated_at, created_at)
ratings        (player_id, season_id, mu, sigma, ordinal generated (mu - 2 * sigma) stored,
                games, wins,
                seed_mu null, seed_sigma null,                  -- 0012, M5.7
                seed_rank_tier null, seed_rank_division null,   -- 0012, M5.7
                updated_at)  pk (player_id, season_id), index (season_id, ordinal desc)
lobbies        (id, lcu_party_id, status, reported_by_player_id, lobby_name, lobby_password,
                created_at, updated_at)  unique (lcu_party_id) where status in (open, balanced, in_game)
lobby_members  (lobby_id, player_id, side null, role null, role_override null, is_spectator, created_at)
splits         (id, lobby_id, rank, blue jsonb, red jsonb, gap, blue_win_prob, score, off_role_count,
                is_chosen, explanation, roster_key, created_at)
games          (id, lcu_game_id unique, lobby_id null, season_id, started_at, duration_s, winning_side,
                source 'eog' | 'backfill', raw jsonb, created_at)
game_players   (game_id, player_id, side, role null, champion_id, kills, deaths, assists, gold, damage_to_champs,
                cs, mu_before null, sigma_before null, mu_after null, sigma_after null,
                counts_for_role_inference,                      -- 0010, M5.17
                vision_score null, damage_self_mitigated null)  -- 0014, M7.7
companion_tokens (id, player_id, token_hash, label, last_seen_at, revoked_at null, created_at)
companion_commands (id, target_player_id, kind, payload jsonb, status, created_at, acked_at,
                sent_at, attempts, result jsonb, error, expires_at)   -- 0006, M4.1
discord_config (guild_id pk, webhook_url, results_channel_id, lobby_voice_channel_id,
                blue_voice_channel_id, red_voice_channel_id, created_at, updated_at)

players_public view (players minus discord_id; keeps is_admin)
```

Also in the schema:

- **Enums, not check constraints**, for the string unions: `lobby_status`, `player_role`, `game_source`,
  `companion_command_kind` (`create_lobby`, `invite`, `switch_side`), `companion_command_status` (`pending`,
  `sent`, `acked`, `failed`). The generated types then carry the same unions `packages/core` declares. `side`
  stays a smallint with a check, because 100 and 200 are the client's numbers, not a vocabulary of ours.
- **Season 1** is inserted by `0001_init.sql`, active, with the fixed id `00000000-0000-0000-0000-000000000001`
  (exported as `SEASON_ONE_ID`), so ratings and games always have a season to hang off.
- **Functions.** `active_season_id()` (the default for `games.season_id`), `bootstrap_admin(puuid)` (idempotent
  insert-or-promote, service role only, called by the API on start with `BOOTSTRAP_ADMIN_PUUID`), and
  `set_updated_at()` (the trigger behind every `updated_at`).
- **Realtime.** The `supabase_realtime` publication covers `lobbies`, `lobby_members`, `splits`, `games`,
  `game_players` and `ratings`. A table outside the publication never emits a change event, silently, and the
  tonight page (M3.4) and the bot (M4.4) are built on those events. `players` is left out; it is not publicly
  readable.

Rules:

- `players.puuid` is the identity. Riot IDs are display data refreshed from the client.
- **A `lobbies` row is one game cycle, not one party** (M2.14, `0003_lobby_cycles.sql`). The client keeps the
  same `partyId` all night, so `lcu_party_id` is unique only among `open`, `balanced` and `in_game` rows:
  a lobby post lands on the party's live row and starts a new one once the last cycle is `finished`,
  `dropped` or `abandoned`. A game post resolves to the newest row that already existed when the game started, so a late
  end-of-game block stays on the lobby it was played from. Closed rows are never rewritten or reused.
- A player row is created lazily the first time a PUUID appears in a lobby or a game. Discord linking is optional
  and done by an admin (`/admin/players`) or self-service via Discord OAuth.
- `ratings` is per season. Ratings never reset: there is one season row, and the board is viewed through automatic time windows (week, month, all time; M5.9, M5.12). `ordinal` is a
  stored generated column so the leaderboard sorts in one index scan and SQL cannot disagree with
  `packages/core` about the formula; `packages/core` stays the only place that computes a rating.
- `ratings.seed_mu` / `seed_sigma` are the `{ mu, sigma }` the **first fold that rated this player** started
  from, with `seed_rank_tier` / `seed_rank_division` the raw pair `seedFromRank` read to get them (0012, M5.7).
  Written once and never rewritten, by whichever fold creates the row; both folds read the stored pair in
  preference to the player's current rank, so a rank that moves later does not move anybody's history. A null
  `seed_mu` means "no seed stored yet" — a row written before 0012 — and the next `rebuild-ratings` fills it
  with the seed it used.
- `games.raw` keeps the full end-of-game block, with `mucJwtDto` and `multiUserChatPassword` replaced by
  `"[redacted]"` (M2.10). Every derived column can be recomputed from it.
- `game_players` rating columns are nullable: the API inserts the game and its ten players, then rates, and a
  rebuild (M5.2) overwrites them.
- `game_players.vision_score` and `damage_self_mitigated` are nullable **with no default** (0014, M7.7), and the
  null is the point: it means "this game never stored it", which is a different fact from a game with no wards
  or a tank who mitigated nothing, and M7.8's MVP / ACE bonus skips a game rather than scoring somebody at
  zero for a number nobody kept. Ingest reads both off the posted `raw` block — uppercase key first
  (`VISION_SCORE`, `TOTAL_DAMAGE_SELF_MITIGATED`), camelCase as the fallback (`visionScore`,
  `damageSelfMitigated`), which covers the live end-of-game block and the backfilled match detail — so no
  companion release is owed for them. Both writers pass every number through `storedStat`
  (`apps/web/lib/ingest/statValue.ts`) first, and that is not belt and braces for the column's `>= 0` check: the
  `games` row is written before `game_players`, so a value Postgres refuses — a negative, or one past int4,
  which no check could see — 500s the request on every retry and leaves the game stored, unratable and stuck. A
  number we cannot store honestly becomes null, exactly like a key that was never there. `pnpm --filter web
  copy-raw-stats` is the one-off that fills rows written before 0014 from the same blob; it only ever fills a
  null, is safe to run twice, and reports how many rows still have a null in either column.
- `splits` keeps the top three for every balance run so the explanation and reroll are reproducible. A rebalance
  appends a new set of three rather than replacing the old one, and a partial unique index allows at most one
  `is_chosen` split per lobby. `explanation` is the string core built; the embed and the tonight page render it,
  they never recompute it.
- `splits.roster_key` is the ten puuids of that split, sorted and joined with `,`. The API computes it with
  `rosterKey()` from `@customs/db` when it stores a split, and the `lastSplit` lookup is the newest chosen split
  with the same `roster_key` — one indexed lookup instead of a jsonb set comparison.
- A companion token is revoked by setting `companion_tokens.revoked_at`, never by deleting the row: the auth path
  filters on it and `last_seen_at` stays as the audit trail of a token that may have leaked.
- **At most one `create_lobby` command is live at a time, in the whole table** (M4.9,
  `0008_one_create_lobby_at_a_time.sql`): a partial unique index over `kind` where
  `kind = 'create_lobby' and status in ('pending', 'sent')`. That is the Start-a-lobby double-tap lock, global
  rather than per host so two admins pressing at once cannot open two lobbies and fan out two sets of invites.
  The API still reads the pending row first for the friendly refusal and maps a `23505` on this index to the same
  409. An ack, a non-retryable nack or the expiry sweep takes the row out of the two live statuses and releases the lock.

## Rating model (`packages/core/rating`)

OpenSkill, default Plackett-Luce model, two teams of five.

- Seed `mu` from the player's ranked tier at first sight:
  Iron 14, Bronze 17, Silver 20, Gold 23, Platinum 26, Emerald 29, Diamond 32, Master and above 35.
  Add 0.75 per division above IV. Unranked: 20.
- Seed `sigma` to 8.33 (OpenSkill default) so the first few games move fast. Unranked: 10.
- Rating movement is driven by uncertainty, not by rank: OpenSkill moves a player's `mu` in proportion to that
  player's own `sigma^2`, so a settled player's rating is sticky and a new player's moves fast. Rank does not
  affect the size of a win — two players with the same sigma on the same winning team gain exactly the same amount.
- Balance on `mu`. Leaderboard sorts on `ordinal = mu - 2 * sigma`. Display rating is `round(mu * 60)`.
- A game is rated only when its stored row has ten `game_players`, five a side, `duration_s` over 300
  seconds, **and its `games.raw` names Summoner's Rift** — `CLASSIC` or no mode at all, since every night
  captured before the companion stored one was Rift (M5.26, M7.1). M1.5 stores every `CUSTOM_GAME` block,
  remakes and ARAM included. The fold runs exactly once per game, claimed by the null `mu_after` column.
- **Two gates, in `apps/web/lib/ingest/fold.ts`, and they answer different questions** (M7.1). `gateGame` is
  "a game happened that can be read": ten rows, five a side, over 300 seconds, nobody twice. That is the
  universe `/stats`, `/fun`, `/p/[puuid]` and the board's streak fold through `countedGames`, and an ARAM
  night belongs in it. `gateRatedGame` is `gateGame` plus the mode, it adds one skip reason (`game-mode`),
  and it has exactly two callers: the live fold and the rebuild. An ARAM custom is stored whole — ten rows, a
  scoreboard, its `raw` — with four null rating columns for ever, the companion still gets a 2xx, and the
  lobby still finishes. **Discord posts no result embed for it**, per the 2026-09-08 rule that a result posts
  only for a rated game (`onFinished` returns early on `!rated`, and `buildResultInput` needs both `mu`
  columns on all ten): before M7.1 a long enough ARAM rated and so was announced, and from M7.1 it is not.
  Teams posts are unaffected — they come from the split, not the fold.
- After each game call `rate([blueTeam, redTeam], { rank: [winnerRank...] })`. Store before and after on
  `game_players`. Ratings are a pure fold over games ordered by `started_at`, so they can be rebuilt from scratch
  after a backfill or a model change (`pnpm --filter web rebuild-ratings`).

### Two channels: all-time and weekly (M7.2)

There are two folds of the same model and no more. `rateGame` is the all-time channel: it forms teams, it is what
`game_players` stores, and its numbers are pinned byte for byte by a test — it passes OpenSkill no options, so a
tuning change can never reach it by accident. `rateGameWeekly` is the weekly channel (M7.2): the same signature,
five and five in and out, throwing on anything else, tuned by `config.rating.weekly` and used only by the
`this-week` / `last-week` board, which folds it from scratch from the rank seed over that week's games (M7.3). It
never forms teams, is never persisted, and nothing under `apps/web/lib/ingest/` may import it.

| | `beta` (luck in one game) | `tau` (uncertainty added back per game) |
| --- | --- | --- |
| all-time (`rateGame`) | OpenSkill default `25 / 6` ≈ 4.17 | OpenSkill default `25 / 300` ≈ 0.083 |
| weekly (`rateGameWeekly`) | **2.00** | **0.30** |

**What the weekly channel is for is that it moves, not that it makes up its mind sooner.** The three measured
numbers, all pinned in `rating/index.test.ts` so a later `openskill` patch that moves them fails loudly (M7.2
acceptance 4):

| | All-time channel | Weekly channel |
| --- | --- | --- |
| `sigma < 5.00` — what "settles" means everywhere in this product (decision, 2026-09-10) | game 36 | game 30 |
| display points one game moves a **settled** player (`mu` 23, `sigma` 3.5, peers the same) | ~29 | ~32 |
| display points one game moves a player folded from a fresh **Sunday seed** (`seedFromRank`, `sigma` 8.33) | ~77 | ~79 |

Read the first row as "six games, which nobody would notice", not as good news: the weekly number is **not** a
faster or more trustworthy verdict on a player, and no surface should say it is. It is the same model taking the
same thirty-odd games to become confident. The row that matters is the third one: because M7.3 reseeds every
player from rank at the Sunday boundary and folds only that week's games, a weekly rating spends the whole week in
the fast part of the curve — about **three times** the movement per game of a settled all-time rating. That
difference is almost entirely the reseed and hardly at all `beta` and `tau`; compare the second row, which is what
the tuning alone buys.

The settling row is measured on M1.3's convergence setup (`P0` seeded Iron IV among settled Gold IVs, one sitter
per game, `P0`'s side wins every game); on that setup `mu` passes the field's 23.00 in game 4 on both channels
(23.6639 all-time, 24.1102 weekly), which is the seed's sigma doing the work, not the tuning.

**Why the constants stop here.** A player's `mu` step is `sigma^2 * (1 - p) / c` with
`c = sqrt(sum of the ten sigmas squared + 2 * beta^2)`, so on the setup above `beta` accounts for about 35 of a
`c^2` near 214 — the ten players' sigmas dominate it. Driving `beta` to zero moves `sigma < 5.00` only from game 36
to game 23, and below 2.00 the curve is flat, so there is nothing left to buy. `tau` is the stronger lever and it
pays for movement by refusing to converge: at `tau` 0.30 `sigma` reaches 5.00 in game 30, at 0.45 in game 59, and
from about **0.46 upward it never reaches 5.00 at all** (measured to 500 games). 0.30 is a knee and not a ceiling —
it keeps the week responsive while still settling inside a horizon a season can reach. Far past it the board stops
being about the week: at `tau` 10 one game moves a settled player **100 display points** and, for a settled player
trading wins and losses, `sigma` climbs instead of falling (10.5 after one game, 30.3 by game 10, about 74 by game
200), which is a board about the last game.
A skipped `TARGET` test in `rating/index.test.ts` records the original "settles in five games" target against the
measured counts, so the gap stays visible instead of looking closed.

### How even a split is, as a percentage (M3.31)

`evenness(blueWinProb)` is `round(100 - abs(blueWinProb - 0.5) * 200)`: 50% is 100, 54% is 92, 70% is 60, a
certainty either way is 0. `balanceScore(blue, red)` is `evenness(predictWin(blue, red))` and nothing else, for a
caller holding ratings rather than a stored probability. Both live beside `predictWin` in `rating/index.ts`.

**It is a display transform of a probability and never a second comparison of the two sides.** There is one
win-probability model in this product, `predictWin` (M1.3), and this is arithmetic on its output, so the tonight
page's `Teams are 92% even.` and `Blue favored 54%.` cannot disagree — they are one number read twice. If an
implementation ever computes a second comparison of the two sides, it is wrong however good that comparison is.
The score is symmetric (`evenness(p) === evenness(1 - p)`) because it is about the gap, not about who is ahead,
and monotonic: one side's mu sum growing never raises it.

Display surfaces call `evenness` on the chosen split's **stored** `splits.blue_win_prob`, not `balanceScore` on
live ratings, so the percentage on the screen is the one the group was shown on the night even after somebody's
rating has moved. No column stores the score and no API field carries it. `evenness` throws outside `[0, 1]`;
`balanceScore` is not five-and-five bound (two non-empty teams of any size) and throws on an empty team — a guard
of its own, since `predictWin` answers 0, 1 or 0.5 for an empty side (decision, 2026-09-15). Reading this score
must never feed back into `score` or `compareSplits`: it does not change which split the balancer picks.

### The performance score and the MVP / ACE bonus (M7.8)

`rating/performance.ts` is three pure functions — `performanceScores`, `mvpAce`, `applyMvpAceBonus` — over one
game's own numbers. **MVP** is the highest-scoring player on the winning team, **ACE** the highest-scoring player
on the losing team; those are op.gg's terms for op.gg's idea, whose formula is proprietary and unpublished, so
this one is a documented community approximation and a tunable like every other number in `config.ts`.

Six components, weighted, in `config.rating.performance`:

| component | weight |
|---|---|
| KDA | 0.10 |
| damage to champions | 0.20 |
| gold | 0.20 |
| vision score | 0.25 |
| damage self-mitigated | 0.15 |
| CS | 0.10 |

They sum to 1.00. **Each component is normalised inside the game**: a player's value divided by the best of the
ten for that component, so every term is in `[0, 1]` and gold does not swamp KDA by being a four-digit number.
KDA is `(kills + assists) / max(1, deaths)`. A component whose game-wide maximum is zero contributes zero to
everybody rather than dividing by zero. A score is therefore in `[0, 1]` and is comparable **only inside its own
game**, which is all MVP and ACE need. The six are summed in the table's order, which is part of the pinned
arithmetic. Ties go to the lower puuid, never to the array's order.

The adjustment is applied **after** `rateGame` (or `rateGameWeekly`) and never inside it, so the base rating maths
stays untouched and independently testable — `applyMvpAceBonus` takes the fold's `{ puuid, before, after }` and
gives back the same ten. With `delta = after.mu - before.mu`:

- MVP: `mu' = before.mu + delta * (1 + config.rating.mvp.bonusFraction)`, default **0.25**, so **1.25x**.
- ACE: `mu' = before.mu + delta * (1 - config.rating.mvp.aceReliefFraction)`, default **0.20**, so **0.80x**. The
  ACE's delta is negative, so this shrinks a loss and never turns one into a gain.
- Everybody else is untouched, and **`sigma` is never touched by any of this** — Proven must keep meaning "how sure
  the model is", and certainty is not something you earn by farming vision.

The bound is the construction: both factors are positive and fixed, so the sign of a delta never flips and no term
is unbounded. A winner always gains; a loser always loses.

**If any of the six components is missing for any of the ten** — a game stored before M7.7, a blob that never
carried vision, a `null`, a `NaN` — there is **no MVP and no ACE** (`mvpAce` returns `null`) and the game is rated
exactly as it was before M7.8. There is no partial scoring: it would rank a player who has a vision score against
one who does not.

The worked example's ten (`docs/00-product.md`, blue winning) score Bilal 0.7000, Lena 0.5875, Hana 0.5625, Rami
0.5500, Iris and Nadia 0.5000, Theo 0.4125, Omar 0.2750, Karim 0.2500, Yuki 0.0000 — so Bilal is the MVP and Lena
the ACE, pinned in `rating/performance.test.ts`.

## Balancer (`packages/core/balance`)

Input: ten players with `{ mu, mainRole, secondaryRole, roleOverride? }`, optional duo locks, the previous night's
split. Output: top three splits with role assignments and explanation.

- Effective skill on a role: `mu * 1.00` main, `mu * 0.93` secondary, `mu * 0.85` fill. A `roleOverride` for
  tonight counts as main for that role only.
- Enumerate all 126 distinct 5/5 partitions. For each team, choose the role assignment (120 permutations) that
  maximizes effective skill minus off-role penalty. 126 x 2 x 120 evaluations, well under 100 ms.
- `score = |sum(blueEff) - sum(redEff)| + sum(off-role cost of each filled seat) + 200 * isRepeatOfLastSplit +
  inf * duoSeparated` (in display-rating units, so divide `mu` sums by 1/60 or apply the weights in `mu` units,
  either is fine as long as tests pin it). One filled seat costs 120 unless fill protection scales it.
- **Fill protection** (M7.5). One off-role seat is priced per player, from how recently the balancer last filled
  them:

  ```
  cost(player) = config.balance.offRolePenalty * (1 + config.balance.fillProtectionFactor / (gamesSinceLastFill + 1))
  ```

  with `offRolePenalty` 120 and `fillProtectionFactor` **1.0**: 240 display points for somebody filled in their
  last game, 180 one game later, 150 after three, 132 after nine, decaying back to the flat 120. `gamesSinceLastFill`
  is a per-player input on `BalancePlayer` (`number | null`); `null`, absent, or not a finite number — never filled,
  or no history to read — is the flat 120, which is M1.4's behaviour unchanged, and the worked example does not move.
  A negative number reads as 0, so the term is bounded by `1 + fillProtectionFactor` and 240 is the maximum.
  `packages/core` never reads a database: the caller computes the number from
  `game_players.counts_for_role_inference = false` over the player's last twenty **rated** games (M7.6).
  Rated and not "counted": a fill *is* a `counts_for_role_inference = false` row, so a counted-games window could
  never contain one.
  That caller is `loadFills` in `apps/web/lib/ingest/balance.ts` (M7.6, landed 2026-09-15): **one** extra read per
  balance, over the player's last `config.roles.inferenceWindow` rated games (`mu_after is not null`, the same
  universe role inference folds), found inside the group's 200 most recent games because `game_players` carries no
  timestamp of its own. Same count and same universe as role inference, **not the same twenty rows**: `inferRoles`
  drops filled and null-role games before it slices, so for a player with a recent fill the two windows reach back
  different distances. A remake or an ARAM never rated, so it is not in the window at all — neither a fill nor a
  step away from one. The read is **not** behind `loadRotation`'s ten-or-fewer early return: sit-out order is
  meaningless at ten, fill protection matters most there. A read that fails logs and hands `null` to all ten, and
  the lobby still splits.
  **The price is charged in both places, from one per-player number**: `assignRoles`, which picks a team's role
  permutation, and the split score, which ranks partitions. Scaling one and not the other prices a seat one way
  and ranks the split another. A flexible player (`mainRole: null`) is never off-role, so protection never touches
  them. It is a soft cost and never a block: a lobby with one jungler still gets split, that player still takes the
  seat, and `offRoleCount` still counts them. Two things bound it, and only these two: the most protection ever adds
  to one seat is `offRolePenalty` (120, at `gamesSinceLastFill` 0), and a split-level **tie** still falls through to
  the lower `offRoleCount` in `compareSplits`. It is **not** true that protection can only change *who* is filled
  and never *how many* are. Splits differ in raw gap as well as in fill cost, so a protected player can tip the
  ranking onto a split with a different `offRoleCount`: in one measured lobby, protecting a player moved the chosen
  split from 2 fills at gap 83 to 3 fills at gap 23 — the balancer bought a fairer game with a third fill. Two
  sweeps of 4,000 random ten-player lobbies put the rate at 1.35% and 1.07% (both directions counted; the exact
  figure depends on how the lobbies are generated). Treat `offRoleCount` as free to move when reasoning about a
  tuning change.
- `blueWinProb` from OpenSkill `predictWin` on the actual `{ mu, sigma }` values.
- Explanation string is built in core. Split 1 of the worked example (`00-product.md`, full arithmetic in
  `02-milestones.md` M1.4) reads: `"Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and
  Omar, gap 170."` The "swap" line is derived by diffing split 1 and split 2.
- Reroll returns split 2, then 3. Never random.
- Fewer than ten or more than ten players is an error at this layer; the API decides who sits (see below).

## Role inference (`packages/core/roles`)

`inferRoles(games, window?)` reads a player's main and backup off their own games (M5.16); M5.17 writes the
pair into the same `players.main_role` / `secondary_role` the balancer already reads. Nobody sets a role.

- Input: the player's games as `{ role, startedAt, countsForInference }`. A game counts when `countsForInference`
  is true and `role` is not null. `countsForInference` is written at fold time: true when the balancer put the
  player on their then-main or backup, or when we did not balance the game (backfill). A filled game never counts,
  so being filled cannot change who you are; the role-for-tonight tap (M3.6) is the deliberate way to move.
- The function orders the counted games by `startedAt` itself (newest first) and keeps the newest
  `config.roles.inferenceWindow = 20`. Skipped games consume no slot. `startedAt` is epoch milliseconds or the
  ISO-8601 string the database hands over; an unparseable string sorts as the oldest.
- Main is the most frequent role in the window, backup the second. A tie goes to the role whose most recent game
  is later; two roles whose newest games share an instant fall to lane order (`ROLES`). Never the list order.
- Fewer than `config.roles.minGames = 3` counted games: `{ main: null, secondary: null }`, flexible, which the
  balancer already handles. One role only: a main and no backup, never an invented second.
- Output carries `counted`, the number of games the answer rests on, for the admin page.
- **Where the answer is stored** (M5.17, `0010_inferred_roles.sql`): `players.main_role` / `secondary_role`, plus
  `roles_counted` and `roles_inferred_at`. The M1-era hand-set pair is overwritten by the first recompute.
  `game_players.counts_for_role_inference` is the guard's input, written at fold time by the same update that
  claims the rating columns — it defaults to true, which is the honest answer for every game we did not balance.
- **When it runs** (`lib/ingest/roles.ts`): after a rated fold, for the ten who played, and at the end of
  `rebuild-ratings`, for everybody with a game in the season. Nowhere else — no cron, no button, no recompute on
  page load. It reads a player's rated games across every season, because a role is a fact about a person. Only
  rows whose pair, count or stamp actually move are written, so a second rebuild changes nothing; a failure after
  a rated fold is logged and swallowed, because the game is rated and the next game or rebuild fixes the pair.
  `/admin/players` shows the pair read-only and `POST /api/admin/players` answers 410 to `set-roles`.

## Lobby lifecycle (server side)

```
open ---(10 stable members reported)---> balanced ---(gameflow InProgress)---> in_game ---(eog captured)---> finished
  \                                          |
   \---(members change)---> open <-----------+ (rebalance, previous split kept as history)
   \---(lobby dissolved / 2h idle)---> abandoned

in_game ---(2h idle, no result)---> dropped ---(a late eog block)---> finished
```

- The companion posts the full member list every time it changes. The API debounces: a lobby is balanced when
  ten or more people around — spectators included — are unchanged for 10 seconds. There is no timer on the
  server: the roster's identity is `rosterKey()` over everyone around, the clock is the lobby row's own
  `updated_at`, and the answer carries `recheckInMs` telling the companion when to re-post the identical
  payload (M2.5). The transition itself is claimed with a compare-and-set on `status`, so two companions in one
  lobby produce one balance and one set of three splits.
- A companion may only post a lobby it is in (see "Security"), and the member list is frozen from `in_game` on
  and stays frozen in `dropped` and `finished`: a later post for that party is still accepted and still
  refreshes the lobby's name and password, but no member row is added, changed or removed and the response says
  `rosterFrozen: true`. Once the game has started a player's side comes from `game_players`, not from
  `lobby_members`.
- `open`, `balanced` and `abandoned` keep the replace semantics — the posted list is the roster, deletions
  included — because a lobby that dissolves without ever starting has no history worth keeping.
- An `open` or `balanced` lobby nobody has posted about for two hours is `abandoned`, swept by the next
  companion post or by `GET /api/cron/sweep` (bearer `CRON_SECRET`). An `in_game` lobby two hours unmentioned
  is `dropped` by the same sweep (M5.11): no game runs two hours, so that row lost its end-of-game block. It is
  never `abandoned` — that would unfreeze the record of who played, and it would say the lobby dissolved before
  it ever started. `dropped` keeps the frozen roster, sits outside `lobbies_active_party_idx` so the party's
  next post starts a clean cycle instead of landing on the stuck row for the rest of the night, and still
  accepts `dropped -> finished` from a block that arrives days late. M5.5 lists `in_game` and `dropped` as the
  games whose results never landed.
- Sit-outs: if more than ten people are "around" (in the lobby as spectators, or in the lobby voice channel
  once M4 exists), the API picks who sits: most games tonight first, then longest since they last sat out, then
  puuid. "Tonight" runs 06:00 to 06:00 in `CUSTOMS_NIGHT_TZ`, and a sit-out is derived, never stored — a
  `lobby_members` row of a lobby that reached `in_game` or `finished` with no `game_players` row for its game.
  When the chosen ten include somebody in the spectator slot, each sitter is paired with the person taking
  their seat; the API only says so, it never moves anyone.
- The `lastSplit` passed to the balancer is the five puuids on one side of the most recent chosen split whose
  lobby had the same ten players as tonight's; if there is no such split, `lastSplit` is null.
- Discord posting happens from the API on state transitions, through the webhook stored in `discord_config`.
- A split going on the board is what queues `switch_side` commands for the chosen ten whose client has them on
  the other side (M4.1/M4.3), and that happens in two places: reaching `balanced`, and a **reroll**, which
  promotes another split without the lobby ever leaving `balanced` (`promoteSplit` supersedes the old split's
  rows and queues the new ones in the same write). **Leaving** `balanced` — to `open`, `in_game`, `finished`,
  `abandoned` — fails the ones still pending with `superseded`, inside `moveLobby` itself. Nobody is dragged to
  a side from a split the group has moved on from. `create_lobby` and `invite` are never queued by a transition
  (they are M4.2's button) and never superseded by one; they expire on their own TTL.

## Companion (`apps/companion`)

Long-running process. State machine:

```
disconnected --(lockfile found)--> connected --(ws open)--> watching
watching: on lobby event -> POST /api/companion/lobby
          on gameflow InProgress -> mark lobby in_game
          on eog WS event -> POST /api/companion/game (GET eog-stats-block only as the connect-time fallback)
          every 6h -> POST /api/companion/rank for self; on lobby roster, for each unknown puuid
          every 5s -> GET /api/companion/commands -> execute (create lobby, invite, switch side) -> ack
```

- Config in `%APPDATA%/customs-night/config.json`: `{ apiBase, companionToken }`. First run prompts for a token
  minted on the web admin page.
- Reconnects forever with backoff. The client restarts between patches; the companion must not.
- Every LCU response is parsed with zod. Unknown shapes are logged with the endpoint and dropped.
- Logs to `%APPDATA%/customs-night/logs/` with daily rotation, and queues captured end-of-game payloads in
  `%APPDATA%/customs-night/queue/` until the API has them (M2.3: written before the first POST, replayed on
  start, deleted on a 2xx or a permanent 4xx), and keeps the backfill cache in
  `%APPDATA%/customs-night/backfill.json` (M5.1: which past customs were handled; deleting it costs fetches,
  nothing else), and the execute-once record `%APPDATA%/customs-night/commands-done.json` (M4.1: every
  command this companion finished, written after the client call and before the ack, so a lost ack is re-sent
  from it and never re-run; 200 entries, 24 h). `--verify-commands` writes its report beside them. Nothing
  else is written to disk.

## Web (`apps/web`)

- `/` Tonight: live lobby, teams, result. Public read. Realtime subscription on `lobbies`, `splits`, `games`.
- `/leaderboard` Season table by ordinal, wins, games, streak.
- `/p/[puuid]` Player page: rating history chart, role record, recent games.
- `/admin` Discord OAuth gated, `players.is_admin`. Link Discord IDs, see the inferred roles (M5.17), mint companion tokens, set Discord config, approve backfill.
- `/api/companion/*` bearer token, zod-validated. The command queue is three of them (M4.1):
  `GET /commands?clientConnected=`, `POST /commands/{id}/ack`, `POST /commands/{id}/nack`. The contract is one
  doc comment on `companionCommandsResponseSchema` in `packages/db/src/schemas/companionResponses.ts`; the
  rules are `apps/web/lib/commands/`. `clientConnected=false` is the one request in the whole API that does
  not write `companion_tokens.last_seen_at`, which is what makes that column mean "at their PC with League
  open".
- `/api/admin/*` session-gated.
- `/api/me/*` **the third route class** (M3.6): a Supabase session with a **linked player** and no
  `players.is_admin`. The caller is resolved the one way this project resolves anybody — session → Discord
  identity → `players.discord_id` → the player row — and no request body is ever part of that chain
  (`apps/web/lib/me/identity.ts`, `lib/me/route.ts`, which is `withAdminAuth` with the admin step removed).
  401 without a session, 403 for a session with no Discord identity. An **unlinked** session is not a failure:
  it is handed to the handler as `player: null`, because `POST /api/me/link` exists for exactly that visitor.
  - `POST /api/me/role-tonight` writes `lobby_members.role_override` for one player in one live lobby
    (`open`, `balanced`, `in_game`; anything else is refused). `role: null` clears it. The body's optional
    `puuid` names a **target** and is honoured **only for an admin** — 403 otherwise, decided before any read,
    and never a silent write to the caller's own row. Nothing rebalances and nothing is posted to Discord: a
    tap while the teams are up is stored for the next game.
  - `POST /api/me/link` is the self-link ("picking yourself, once"): the visitor claims one of **tonight's**
    lobby members as themselves and the route writes `players.discord_id` and nothing else. **One link per
    player and one player per session**: only a member of tonight's newest non-`abandoned` lobby may be
    claimed, a player who already carries a `discord_id` is neither offered nor accepted (409), the write is
    conditional on `discord_id is null` so the race cannot double-link, and `players_discord_id_key` catching a
    session that already has a player is the same 409 rather than a 500. Undoing a link stays an admin's job on
    `/admin/players`.
  - Which members may be claimed is decided **on the server** with the service role
    (`apps/web/lib/me/claimable.ts`): `discord_id` is not readable with the anon key, so the page is handed the
    PUUIDs of the unclaimed members only and never learns who is linked to what.

## Discord

- M3: webhook messages from the API. Teams embed, result embed, nightly leaderboard.
- M4: `apps/discord` bot. Subscribes to Supabase Realtime. On `lobbies.status -> balanced` moves members whose
  `discord_id` is known into blue/red voice. On `finished` moves everyone back to the lobby voice channel. Posts
  "N around" when lobby voice membership changes and no lobby is open. Hosted on Fly.io or Railway.

## Security

- Companion tokens are random 32 bytes, stored hashed, one per player, revocable from admin.
- The API never trusts a PUUID claim beyond what the companion reports; a companion can only report games and
  lobbies it was in. Both checks run before anything is written, so a refusal leaves no row behind.
  - Games: the token's player PUUID must appear among the participants of the posted game, **or** among the
    members of the lobby that game was played from — `is_spectator` included (M2.8) — or the API answers 403.
    The companion's end-of-game payload is flattened and carries no `localPlayer`, so participation is the
    check, and the lobby half is there because the friend sitting out a round is often the one running the
    companion. Backfill is the exception, and it is admin-approved the first time per player.
  - Lobbies: the token's player PUUID must appear in the posted `members` — `isSpectator: true` counts — or the
    caller must already be that lobby's `reported_by_player_id`, or the API answers 403. The posted list
    replaces the roster, so without this one stale companion could delete another lobby's members. The
    `reported_by_player_id` fallback is what lets the companion that owns the lobby post the "everyone left"
    empty list, which by definition cannot contain the caller.
- The end-of-game block carries the post-game chat room's credentials and `games` is public-read, so the API
  redacts `mucJwtDto` and `multiUserChatPassword` before the insert (`scrubRawEogBlock`, M2.10). The
  companion may redact them too; the server is the one that has to, because old companion binaries keep
  running for months.
- Supabase Row Level Security: public read on `seasons`, `ratings`, `lobbies`, `lobby_members`, `splits`, `games`
  and `game_players`, plus `players` through the `players_public` view. `companion_tokens`,
  `companion_commands` and `discord_config` have no read policy at all. Writes only through the service role
  used by the API.
- Public reads of players go through the `players_public` view, which is `players` without `discord_id` and with
  `is_admin` kept, so the tonight page can decide whether to draw the reroll button on the anon key. Anon and
  authenticated have no read privilege on the `players` table itself and get a 401 from it. The web app and the
  bot read `players_public`.

## Operational notes

- A League patch can break any LCU endpoint. `packages/lcu` has a `pnpm --filter lcu smoke` script that hits
  every endpoint we use against a running client and prints shape diffs. Run it after every patch Tuesday.
- CI (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` and `pnpm --filter web build` on ubuntu-latest for every pull request and every push to `main`, on the Node in `.nvmrc` and the pnpm in `packageManager`; it needs no secrets, and with no Supabase local stack on the runner the `*.integration.test.ts` files skip.
- Vercel free tier and Supabase free tier are enough. The bot needs a small always-on box (Fly.io free allowance).
- Backups: Supabase daily. `games.raw` makes everything else reproducible.
