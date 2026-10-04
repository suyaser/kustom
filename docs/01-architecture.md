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
| Companion as a Node engine + Tauri tray (M6) | TypeScript engine in `apps/companion`; Tauri shell for Host/Overlay setup and tray. Node SEA still packs the engine for CLI/`build:win`. |

| OpenSkill (`openskill` npm) | TrueSkill-family rating with team support, MIT licensed, has `predictWin`. Elo cannot model 5v5 with per-player uncertainty. |
| No Riot public API | The client exposes rank and match history for the logged-in player and rank lookups for others. Removes key approval and rate limits from the project entirely. |
| Discord webhook before bot | Posting messages needs no long-running process. The bot process exists only for voice moves and presence (M4). |

## Data model

Postgres, managed by Supabase migrations in `packages/db/supabase/migrations/`. The listing below is the schema
after `0028` (plus `0029`'s column grants, M14.40, under Security); it is kept in step with the migrations, and each
later change is tagged with the file that made it.

```sql
players        (id, puuid unique, summoner_id, game_name, tag_line, display_name,
                discord_id null, is_admin, main_role, secondary_role,
                roles_inferred_at null, roles_counted,          -- 0010, M5.17
                rank_tier, rank_division, rank_lp, rank_updated_at, created_at)
ratings        (group_id, player_id, mu, sigma,                  -- group_id 0018, M13
                ordinal generated (mu - 2 * sigma) stored, games, wins,
                seed_mu null, seed_sigma null,                  -- 0012, M5.7
                seed_rank_tier null, seed_rank_division null,   -- 0012, M5.7
                updated_at)  pk (group_id, player_id)           -- 0026, M14.14: one rating per person per group
                             index (group_id, ordinal desc)
lobbies        (id, lcu_party_id, status, reported_by_player_id, lobby_name, lobby_password,
                created_at, updated_at)  unique (lcu_party_id) where status in (open, balanced, in_game)
lobby_members  (lobby_id, player_id, side null, role null, role_override null, is_spectator, created_at)
splits         (id, lobby_id, rank, blue jsonb, red jsonb, gap, blue_win_prob, score, off_role_count,
                is_chosen, explanation, roster_key, created_at)
games          (id, lcu_game_id unique, lobby_id null, group_id, started_at, duration_s, winning_side,
                source 'eog' | 'backfill', mode -> modes.id,    -- mode 0024, M14.29: stamped at insert
                raw jsonb, created_at)  index (group_id, started_at desc)   -- 0026
game_players   (game_id, player_id, side, role null, champion_id, kills, deaths, assists, gold, damage_to_champs,
                cs, mu_before null, sigma_before null, mu_after null, sigma_after null,
                counts_for_role_inference,                      -- 0010, M5.17
                vision_score null, damage_self_mitigated null,  -- 0014, M7.7
                damage_to_objectives null)                      -- 0015, M7.14
companion_tokens (id, player_id, token_hash, label, last_seen_at, revoked_at null, created_at)
companion_commands (id, target_player_id, kind, payload jsonb, status, created_at, acked_at,
                sent_at, attempts, result jsonb, error, expires_at)   -- 0006, M4.1
discord_config (group_id pk, guild_id, webhook_url, results_channel_id,   -- pk group_id 0020, M13.4
                lobby_voice_channel_id, blue_voice_channel_id, red_voice_channel_id,
                test_post_at null, test_post_error null,        -- 0025, M14.20
                created_at, updated_at)   -- one row per group; two groups may share a guild
discord_connect_states (state_hash pk -- sha256 of the OAuth state nonce, group_id, auth_user_id,
                created_at, expires_at -- 10 min, used_at)      -- 0025, M14.20
window_posts   (group_id, kind, window_start, claimed_at, posted_at, attempts, reason)
                pk (group_id, kind, window_start)                 -- 0011, per group 0020
daily_mysteries (id, group_id, day, kind, challenge_number, ...)  -- 0013/0016;
                unique (group_id, day), unique (group_id, kind, challenge_number)   -- 0020
groups         (id, slug unique, name, created_by null -- an auth.users id, not a player,
                ratings_since null,                             -- 0027, M14.18
                created_at)                                     -- 0018, M13
group_memberships (group_id, player_id, role 'owner' | 'admin' | 'member', created_at,   -- owner 0023, M14.11
                backfill_requested_at, backfill_approved_at -- unread since 2026-10-03)  pk (group_id, player_id)
                unique (group_id) where role = 'owner'          -- 0023: at most one owner per group
modes          (id pk -- 'normal' | 'fearless', created_at)    -- 0024, M14.29; M15 adds rows
group_modes    (group_id pk, mode -> modes.id default 'normal', set_by null -> players.id,
                updated_at)                                     -- 0024, M14.29: one standing mode per group;
                                                                -- 0030, M14.46: a new group starts on 'normal'
                                                                -- (was 'fearless'); existing rows kept their mode
group_invites  (group_id pk, code unique -- 22 url-safe chars, stored as is, rotated_at, rotated_by)  -- 0021, M13.5
pairing_codes  (code_hash pk -- sha256 of 6 chars, group_id, auth_user_id, discord_id, created_at,
                expires_at -- 15 min, used_at)                                        -- 0021, M13.5
pairing_attempts (id, ip_hash, attempted_at) -- the per-address limit on POST /api/companion/pair  -- 0021

players_public view (players minus discord_id; still carries the retired is_admin, unread since M13.4)
groups_public view (id, slug, name, ratings_since)  -- 0018, ratings_since 0027; never created_by
group_members_public view (group_id, player_id)     -- 0018; never role
```

**`group_id` on the ten tables** (`ratings`, `lobbies`, `games`, `game_players`, `companion_tokens`,
`companion_commands`, `fearless_state`, `daily_mysteries`, `window_posts`, `discord_config`) is `not null` with
**no default** since `0020` (M13.4): an insert that does not name its group fails, on purpose. `players.is_admin`
and the two `players.backfill_*` columns are still in the table and read by nothing; admin is
`group_memberships.role` (M13.3, M13.4). Backfill has no approval step since 2026-10-03, so the two
`group_memberships.backfill_*` columns are read and written by nothing either; a later cleanup drops all five.

Also in the schema:

- **Enums, not check constraints**, for the string unions: `lobby_status`, `player_role`, `game_source`,
  `companion_command_kind` (`create_lobby`, `invite`, `switch_side`), `companion_command_status` (`pending`,
  `sent`, `acked`, `failed`). The generated types then carry the same unions `packages/core` declares. `side`
  stays a smallint with a check, because 100 and 200 are the client's numbers, not a vocabulary of ours.
- **Functions.** Every `security definer` function is `set search_path = ''`, has execute revoked from public,
  anon and authenticated, and is granted to the service role only (the two RLS helpers are the exception, below).
  Each is the whole of one write, so a route never composes a write out of several statements.
  - `bootstrap_admin(puuid)`: insert-or-link the `BOOTSTRAP_ADMIN_PUUID` player, called on the first admin or
    companion request of every process. Since `0023` it makes that player the **owner** of `customs` while
    `customs` has no owner, and otherwise leaves every membership alone (it never demotes an owner).
  - Groups and pairing (`0021`, owner rules `0023`): `create_group(slug, name, created_by, player)` (a linked
    creator's membership is `owner`), `new_invite_code()`, `rotate_group_invite(group, rotated_by)` (also expires
    every unused pairing code a non-creator got through the old link), `redeem_pairing_code(code_hash, puuid)`
    (the creator's pairing makes them `owner` while the group has none), `pairing_attempt(ip_hash, limit,
    window)` (the per-address limit).
  - Owner-only writes (`0023`, M14.11), each re-checking the actor's role under the group's row lock:
    `set_group_member_role_v2(group, actor, player, role)` (replaced `0020`'s `set_group_member_role`, dropped),
    `transfer_group_ownership(group, actor, player)`, `remove_group_member(group, actor, player)` (deletes the
    membership and revokes that player's companion tokens in the group). A group with no owner yet keeps
    M13.4's rules: its admins manage admins, and its last admin can be neither demoted nor removed.
  - `reset_group_ratings(group, actor, now)` (`0027`, M14.18): owner only; refused while a lobby is live or a
    game landed in the last 15 minutes; sets `groups.ratings_since` and deletes the group's `ratings` rows.
    Returns `ok | not_found | forbidden | owner_only | busy`.
  - Triggers: `set_updated_at()` (every `updated_at`), `companion_token_add_membership()` (`0019`),
    `groups_insert_mode()` (every new group gets its `group_modes` row, `0024`; on `normal` since `0030`), `games_stamp_mode()` (stamps
    `games.mode` from the group's `group_modes.mode` when the insert names none, `0024`),
    `discord_config_clear_test_post()` (clears both test-post columns whenever `webhook_url` changes, `0025`).
  - RLS helpers (`0022`): `current_player_id()` and `is_group_admin(group)`, executable by `authenticated` too,
    because a function called inside a policy runs as the querying role. Both answer only about the caller's own
    verified session.
- **Realtime.** The `supabase_realtime` publication covers `lobbies`, `lobby_members`, `splits`, `games`,
  `game_players`, `ratings`, `fearless_state` (`0017`) and `group_modes` (`0024`). Realtime only puts into a
  subscriber's payload the columns its role may select, so `0028` (and `0029`) keep the hidden columns out of anon
  events while the events still fire. A table outside the publication never emits a change event, silently, and the
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
  and self-service: tapping your name (`/api/me/link`) or host pairing. The admin link (`/admin/players`) is
  retired (M14.56).
- History: seasons (a table, a `season_id` key on `ratings` and `games`, `active_season_id()`) existed from `0001`
  until `0026` (M14.14) kept the active one's rows and dropped the concept.
- `ratings` is one row per person per group, keyed `(group_id, player_id)` (`0026`, M14.14). A group's ratings
  reset only when its owner presses `Reset ratings` (`reset_group_ratings`, `0027`): the group's rows are deleted
  and `groups.ratings_since` is set, so the live fold and `rebuild-ratings` rate only games with
  `started_at >= ratings_since` and start everyone from the seed; older games keep their stored rating columns.
  Otherwise the board is viewed through automatic time windows (This week, Last week, All time; M5.9, M5.12;
  the month windows were removed in M14.48). `ordinal` is a
  stored generated column so the leaderboard sorts in one index scan and SQL cannot disagree with
  `packages/core` about the formula; `packages/core` stays the only place that computes a rating.
- `ratings.seed_mu` / `seed_sigma` are the `{ mu, sigma }` the **first fold that rated this player** started
  from, with `seed_rank_tier` / `seed_rank_division` the rank the client reported at that moment (0012, M5.7).
  Written once and never rewritten, by whichever fold creates the row; both folds read the stored pair in
  preference to anything they could recompute, so a rank that moves later does not move anybody's history. A
  null `seed_mu` means "no seed stored yet" — a row written before 0012 — and the next `rebuild-ratings` fills
  it with the seed it used. Since 2026-09-16 that seed is `provisionalSeed()`, `20 / 12`, for everybody
  (`lib/ingest/seed.ts`, one function, called by the live fold, the rebuild and the weekly fold alike), and the
  two rank columns are **informational only**: they record what the client said that night and no number is
  computed from them. Seeds already stored from the rank rule stay until a retroactive reset and a rebuild
  replace them, so until then two players can still hold different seeds.
- `games.raw` keeps the full end-of-game block, with `mucJwtDto` and `multiUserChatPassword` replaced by
  `"[redacted]"` (M2.10). Every derived column can be recomputed from it.
- `game_players` rating columns are nullable: the API inserts the game and its ten players, then rates, and a
  rebuild (M5.2) overwrites them.
- `game_players.vision_score` and `damage_self_mitigated` (0014, M7.7) and `damage_to_objectives` (0015, M7.14)
  are nullable **with no default**, and the
  null is the point: it means "this game never stored it", which is a different fact from a game with no wards,
  a tank who mitigated nothing or a jungler who never contested a dragon, and the MVP / ACE bonus (M7.8) skips a
  game rather than scoring somebody at
  zero for a number nobody kept. It skips a game with a null `game_players.role` the same way (M7.13). The
  missing-input rule is **universal and not scoped to where a weight is above zero**: a null on a carry, whose
  objectives weight is `0.00`, still takes the MVP off the game, because every component is normalised against
  the best of the ten and a weight-scoped rule would let a `config.ts` nudge change which past games are
  scorable at all (M7.14). Ingest reads all three off the posted `raw` block — uppercase key first
  (`VISION_SCORE`, `TOTAL_DAMAGE_SELF_MITIGATED`, `TOTAL_DAMAGE_DEALT_TO_OBJECTIVES`), camelCase as the fallback
  (`visionScore`, `damageSelfMitigated`, `damageDealtToObjectives`), which covers the live end-of-game block and
  the backfilled match detail — so no
  companion release is owed for them. The fallback is load-bearing for the third one: a match-history detail
  carries only its camelCase spelling, so a reader that required the uppercase key would fill live games and
  leave every backfilled game null. `damage_to_objectives` is named after its sibling `damage_to_champs` rather
  than after the client key, which is the one deliberate exception to 0014's "names follow the client's words":
  the two are the same stat family read against different targets and may not carry two conventions into one
  weights table. Both writers — ingest and `copy-raw-stats` — pass all three numbers through `storedStat`
  (`apps/web/lib/ingest/statValue.ts`) first, and that is not belt and braces for the column's `>= 0` check: the
  `games` row is written before `game_players`, so a value Postgres refuses — a negative, or one past int4,
  which no check could see — 500s the request on every retry and leaves the game stored, unratable and stuck. A
  number we cannot store honestly becomes null, exactly like a key that was never there. `pnpm --filter web
  copy-raw-stats` is the one-off that fills rows written before 0014 and 0015 from the same blob; it only ever
  fills a null, is safe to run twice, and reports how many rows still have a null — combined, and then one
  count per column, so a single column's shortfall can be read on its own.
- `splits` keeps the top three for every balance run so the explanation and reroll are reproducible. A rebalance
  appends a new set of three rather than replacing the old one, and a partial unique index allows at most one
  `is_chosen` split per lobby. `explanation` is the string core built; the embed and the tonight page render it,
  they never recompute it.
- `splits.roster_key` is the ten puuids of that split, sorted and joined with `,`. The API computes it with
  `rosterKey()` from `@customs/db` when it stores a split, and the `lastSplit` lookup is the newest chosen split
  with the same `roster_key` — one indexed lookup instead of a jsonb set comparison.
- A companion token is revoked by setting `companion_tokens.revoked_at`, never by deleting the row: the auth path
  filters on it and `last_seen_at` stays as the audit trail of a token that may have leaked.
- **At most one `create_lobby` command is live at a time per group** (M4.9,
  `0008_one_create_lobby_at_a_time.sql`; per group since M13.3's `0019`): a partial unique index over
  `(group_id, kind)` where `kind = 'create_lobby' and status in ('pending', 'sent')`. That is the Start-a-lobby
  double-tap lock, per group rather than per host so two admins pressing at once cannot open two lobbies and fan
  out two sets of invites, and per group rather than global so one group's press never blocks another's.
  The API still reads the pending row first for the friendly refusal and maps a `23505` on this index to the same
  409. An ack, a non-retryable nack or the expiry sweep takes the row out of the two live statuses and releases the lock.

### The daily game (`daily_mysteries`, M5.32; two games from M8.4)

One challenge per civil date in `CUSTOMS_NIGHT_TZ`, in four tables (`0013`): `daily_mysteries` (the challenge and
its answer), `daily_mystery_clues`, `daily_mystery_sessions` and `daily_mystery_attempts`. All four have RLS on
with **no policy at all** and the grants revoked, like `window_posts` and `companion_tokens`: the answer, the
unrevealed clues and the visitor ids are not public facts, so every read goes through the API with the service
role and the answer never ships in the first GET.

**There are two games and they alternate civil days** (M8.4): Daily Mystery asks who played like a stat line,
Guess the Award asks who a standout stat line belongs to. One a day, never two — `daily_mysteries.day` keeps its
unique — decided by the parity of the day counted from the epoch (`kindForDay`), which keeps alternating across a
31st into a 1st where a day-of-month parity would not. `0016` added `kind text not null default 'mystery'`, made
the `category` check **per kind**, and moved the unique to `(kind, challenge_number)` so `Daily Mystery #41` does
not become `#43` because two award days fell between.

**The kind is stored, never re-derived from the date.** A parity rule decides what to *create*; the column is
what a row *is*. An award day the window cannot fill falls back to a Daily Mystery and stores `mystery`, and the
fallback does not shift the rotation — tomorrow is whatever the parity says.

The award game's standout is `performanceScores` from `@customs/core` and nothing else, by way of
`pickAwardStandout`: one candidate per game, the player who scores highest, ranked across games by their gap to
the runner-up, with the card's category the component they led the game in by the widest margin. So every game
stored before M7.7 and every backfilled game (no role) is unscorable and simply not a candidate, and **ARAM is
excluded outright** — four of the seven components mean nothing on that map. Daily Mystery keeps M5.32's own
`scorePerformance` and its Rift-preferred, ARAM-allowed pool.

One implementation, not two: `ensureTodayMystery` (`lib/mystery/ensure.ts`) is the only writer, `build.ts` is the
only day builder and is pure, `select.ts` is the only selector, and the recent-game and recent-player avoidance
is **shared across the kinds** — being yesterday's Daily Mystery answer keeps you out of today's Guess the Award,
or the pair of games leaks its own answer. The Vercel Cron warms the day and the first GET creates it lazily;
both agree because both ask `civilDayKey` for the same string.

## Rating model (`packages/core/rating`)

OpenSkill, default Plackett-Luce model, two teams of five.

- **Every rating starts at the same number: `provisionalSeed()`, `mu` 20 and `sigma` 12** (user, 2026-09-16).
  A player's first rated game — all-time or weekly — is folded from it, and a League rank starts nothing that is
  written down. Two halves, two different claims:
  - `mu` 20 (`config.rating.unrankedMu`) is **"we have no idea how good you are"**. A weekly board is supposed
    to measure the week, and there is no principled reason the all-time track's first number should come from a
    different game either.
  - `sigma` 12 (`config.rating.provisionalSigma`, a third constant, deliberately larger than both `rankedSigma`
    8.33 and `unrankedSigma` 10) is **"and we are less sure of that than of anyone we have watched"**. OpenSkill
    moves `mu` in proportion to a player's own `sigma^2`, and `sigma` shrinks fastest while it is large, so a
    higher start is all it takes for a new player's first games to move hard and their tenth to move normally.
    **No phase, no branch, no per-match special case**: `rateGame` still passes OpenSkill nothing, and a lobby
    mixing a newcomer with nine veterans is rated by the same call as any other.
  - 12 is measured, not guessed. A simulated newcomer of known true skill (Iron to Master) plays nine settled
    opponents, wins at the rate their skill implies, and we score the **worst** mean `|mu − true mu|` after five
    games: 7.92 from the old 8.33 seed, 6.08 at 10, **5.17 at 11**, 5.59 at 12, 6.68 at 14, 9.60 at 20 — the
    curve has a bottom, and past it the extra step is spent on win/loss noise rather than on getting the number
    right. Against a lobby that is itself unsettled (`sigma` 6) the bottom sits nearer 13. 12 is the round
    number between the two, within 0.5 mu of the best of either. `rating/index.test.ts` keeps the simulation as
    a guard and `04-decisions.md` keeps the full table.
- `seedFromRank(tier, division)` still exists, still maps Iron 14, Bronze 17, Silver 20, Gold 23, Platinum 26,
  Emerald 29, Diamond 32, Master and above 35, plus 0.75 per division above IV, `sigma` 8.33 — and has exactly
  one caller left: `apps/web/lib/ingest/balance.ts`, which needs *some* estimate of a brand-new face to form
  tonight's teams and has nothing else to go on. That guess lives for one evening, forms one split and is never
  persisted.
- **A rating surface shows what the model holds; a lobby surface shows what tonight's split was formed from.**
  For a player with no `ratings` row the two differ by exactly one evening, so the line is drawn once, here:
  `/leaderboard`'s rows and both numbers at the top of `/p/[puuid]` read `provisionalSeed()` — 1200, Proven 0,
  `0 games`, the `settling` chip — which is the number their first fold will store and the number the seed line
  under the chart already prints. `apps/web/lib/tonight/load.ts` keeps the rank estimate, because every seat
  number on that page is also in the Discord teams embed and both are built from `loadPool`'s one pool; a page
  that disagreed with the message about the same ten people would be the worse bug.
- Rating movement is driven by uncertainty, not by rank: OpenSkill moves a player's `mu` in proportion to that
  player's own `sigma^2`, so a settled player's rating is sticky and a new player's moves fast. Rank does not
  affect the size of a win — two players with the same sigma on the same winning team gain exactly the same amount.
- Balance on `mu`. Leaderboard sorts on `ordinal = mu - 2 * sigma`. Display rating is `round(mu * 60)`.
  **The two week windows are the one carve-out** (M7.3, user 2026-09-15): `This week` and `Last week` sort and
  print the weekly channel's `Rating` (`round(mu * 60)`) and print no Proven at all, because a week is a handful
  of games and the `- 2σ` subtraction would rank a 4W 4L week above a clean 2W 0L one. `All time` sorts on
  `Rating` with players under 10 rated games in a settling section (M14.4); there are no month windows (M14.48).
- `SETTLING_GAMES = 10` (`config.rating.settlingGames`); boards rank players at >= 10 rated games (M14.4,
  `isSettling`).
- **Why this many points** (M14.58, `rating/explain.ts`). `explainDelta` turns one row's stored breakdown (the
  side's fold probability, `sigma_before`, optional rated-game count, `mu_before`, base and final `mu_after`,
  award, result) into structure: `points` and `basePoints` (both differences of displayed Ratings, so
  `points = basePoints + award.effect`), `odds { pct, stance }` with `even` at 48-52% on `favoredSide`'s
  rounding, `certainty` (`new` / `settling` / `settled`) and `award { kind, effect, fraction } | 'none'`.
  Certainty: a rated-game count decides when given (games 1-3 `new`, game 10 the first `settled`, the chip's
  line); otherwise `sigma_before` > 10.6 is `new`, <= 8.4 is `settled` (`config.rating.explain`, fitted so a
  seed newcomer in M1.3's reference lobby reads new for three games and settles on the tenth).
  `explainLegacyDelta` covers pre-`0034` rows: odds from the ten stored befores, `award: 'unknown'`, or
  `lead-only` when any before is missing. The stored probability is `foldWinProbability` = `predictWin` over the
  exact befores handed to `rateGame` (M14.59 option (a), one function with the balancer). It is not OpenSkill's
  internal Plackett-Luce share that scales the update (a logistic of the same mu gap, e.g. 57% where `predictWin`
  says 62%); the two always name the same favourite, which is all the sentence claims, and a test pins that.
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

### Kustom rating (M18, not yet wired)

`packages/core/src/rating/kustom.ts` (M18.1) is the rating that replaces OpenSkill at the M18 switch deploy
(M18.2, M18.5). Until then it is exported from `@customs/core` and tested, and **nothing outside `packages/core`
imports it**; everything above this subsection still describes what runs. Decision rows: `M18:` in
`04-decisions.md`.

- **Formula.** `change = K × (result − expected) × share` on the Rating scale. `result` is 1 for a win, 0 for a
  loss. Everyone starts at `KUSTOM_START` = 1200; no decay, a Rating moves only when its owner plays a rated game.
  Displayed Rating `displayKustom(r) = round(r)`; printed change `printedChange = round(r_after) − round(r_before)`,
  so a column of printed changes adds up to the difference of the printed Ratings.
- **Odds, one function.** `winProbability(Σblue, Σred, calib = { a: 0, b: 1 })` =
  `1 / (1 + exp(−(a + b × (Σblue − Σred) / 400)))`, Σ the five unrounded Ratings on the track being folded. Red's
  expected is one minus blue's. Every caller passes `(0, 1)` until M18.11. Gap 0 / 50 / 100 / 200 / 400 reads
  50 / 53 / 56 / 62 / 73%.
- **K.** `kFor(n) = 16 + 16 × max(0, 10 − n) / 10`, `n` the player's own rated games on that track before this
  one: 32, 30.4, … 17.6, then 16 from game eleven for ever. Throws on a negative or non-integer `n`.
- **Share.** `shareRanks` orders each side's five by the performance score (`rating/performance.ts`, unchanged),
  best first, ties by PUUID ascending; `shareFor(rank, won)` gives winners 1.2 / 1.1 / 1.0 / 0.9 / 0.8 and losers
  the reverse. Each side's shares sum to 5, so with all ten at `n ≥ 10` a game is zero-sum and 1200 stays the
  mean. MVP is rank 1 on the winners, ACE rank 1 on the losers. If any of the ten has no score, every share is
  1.0 and nobody is named.
- **`rateGameKustom({ players, winningSide }, calib?)`** folds one game on one track (the caller passes all-time
  or weekly `r` and `n`) and returns, per player in input order, `{ puuid, side, won, rBefore, rAfter, k,
  expected, shareRank, share, base, award }` with `base = k × (result − expected)` and
  `rAfter = rBefore + base × share`. It throws `KustomInputError` on anything but five distinct players a side, a
  non-finite `r`, a bad `n` or a `winningSide` not 100 or 200: the fold's gates exclude those, so a throw is a bug.
- **`explainKustomDelta(row)`** returns parts, not copy: side, result, the side's expected as a whole percent
  (red is 100 minus blue's rounding, as on the receipt), K and `firstTenGames` (K above 16), share rank, share,
  award and the printed points. Nothing about sigma or anyone else's numbers.
- Constants: `config.kustom` `{ start: 1200, kNew: 32, kSettled: 16, kSettleGames: 10, oddsScale: 400,
  winnerShares: [1.2, 1.1, 1.0, 0.9, 0.8] }`. Bounds by construction: a settled player moves at most
  16 × 1.2 = 19.2 (printed at most 20), anyone's first game on a track at most 32 × 1.2 = 38.4; an even settled
  game is ±8 at the middle share, +9.6 for the MVP, −6.4 for the ACE.

### One channel (M14.57; the weekly track M7.2 is retired)

There is one fold: `rateGame`. It forms teams, it is what `game_players` stores, and its numbers are pinned byte
for byte by a test (it passes OpenSkill no options, so a tuning change can never reach it by accident). The
separate weekly track (`rateGameWeekly`, `config.rating.weekly`, `apps/web/lib/board/weekly.ts`) is deleted
(M14.57, decision row 2026-10-04): every per-game gain or loss on every surface is the all-time `displayDelta`,
and the `this-week` / `last-week` boards rank by **net points**, the sum of those printed per-game deltas in the
window (`sumDisplayDeltas`), with W–L; tie-break points, more wins, fewer games, higher all-time Rating, name.
`Most improved` is retired with it (it would always be the board's #1); the weekly awards are `Best off-role` and
`Cursed duo`, which read games and roles and no rating at all.

| | `beta` (luck in one game) | `tau` (uncertainty added back per game) |
| --- | --- | --- |
| `rateGame` | OpenSkill default `25 / 6` ≈ 4.17 | OpenSkill default `25 / 300` ≈ 0.083 |

**Why a game moved by as much as it did (M14.58, `0034`).** The fold stores, per `game_players` row, the win
probability it used for that side (`fold_p`, core `foldWinProbability` = the balancer's `predictWin` over the
exact befores), the `mu_after` before the MVP/ACE bonus (`base_mu_after`), the `award` (mvp / ace / none) and
`rated_games_before`. Core `explainDelta` turns that into odds stance, certainty (games 1–3 new, the 10th
settled, as the chip) and the award's effect; `explainLegacyDelta` covers rows from before `0034` (odds and
certainty only). `rebuild-ratings` fills and re-checks all four.

**What the weekly channel is for is that it moves, not that it makes up its mind sooner.** The three measured
numbers, all pinned in `rating/index.test.ts` so a later `openskill` patch that moves them fails loudly (M7.2
acceptance 4):

| | All-time channel | Weekly channel |
| --- | --- | --- |
| `sigma < 5.00` — what "settles" means everywhere in this product (decision, 2026-09-10) | game 36 | game 30 |
| display points one game moves a **settled** player (`mu` 23, `sigma` 3.5, peers the same) | ~29 | ~32 |
| display points one game moves a player folded from a fresh **Sunday seed**, `sigma` 8.33 (a seed stored under the pre-2026-09-16 rank rule) | ~77 | ~79 |
| the same from the **provisional first seed**, `mu` 20 `sigma` 12, among nine of the same — what a fresh group's Sunday is now | 112 | 114 |

Read the first row as "six games, which nobody would notice", not as good news: the weekly number is **not** a
faster or more trustworthy verdict on a player, and no surface should say it is. It is the same model taking the
same thirty-odd games to become confident. The rows that matter are the last two: because M7.3 reseeds every
player at the Sunday boundary and folds only that week's games, a weekly rating spends the whole week in
the fast part of the curve — three times or more the movement per game of a settled all-time rating. That
difference is almost entirely the reseed and hardly at all `beta` and `tau`; compare the second row, which is what
the tuning alone buys. The provisional seed's `sigma` 12 widens the gap again — 114 display points a game
against the 79 M7.3's copy was written against — so a week swings more than that copy says, not less.

The settling row is measured on M1.3's convergence setup (`P0` seeded Iron IV among settled Gold IVs, one sitter
per game, `P0`'s side wins every game); on that setup `mu` passes the field's 23.00 in game 4 on both channels
(23.6639 all-time, 24.1102 weekly), which is the seed's sigma doing the work, not the tuning.

**Why the constants stop here.** A player's `mu` step is `sigma^2 * (1 - p) / c` with
`c = sqrt(sum of the ten sigmas squared + 2 * beta^2)`, so on the setup above `beta` accounts for about 35 of a
`c^2` near 214 — the ten players' sigmas dominate it. Driving `beta` to zero moves `sigma < 5.00` only from game 36
to game 23, and below 2.00 the curve is flat, so there is nothing left to buy. `tau` is the stronger lever and it
pays for movement by refusing to converge: at `tau` 0.30 `sigma` reaches 5.00 in game 30, at 0.45 in game 59, and
from about **0.46 upward it never reaches 5.00 at all** (measured to 500 games). 0.30 is a knee and not a ceiling —
it keeps the week responsive while still settling inside a horizon a group's history can reach. Far past it the board stops
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

### The performance score and the MVP / ACE bonus (M7.8, weights revised by M7.13, seventh component by M7.14)

`rating/performance.ts` is three pure functions — `performanceScores`, `mvpAce`, `applyMvpAceBonus` — over one
game's own numbers. **MVP** is the highest-scoring player on the winning team, **ACE** the highest-scoring player
on the losing team; those are op.gg's terms for op.gg's idea, whose formula is proprietary and unpublished, so
this one is hand-reasoned, fitted to nothing, and a tunable like every other number in `config.ts`.

Seven components — and **three weight vectors over them, picked by the player's role** (M7.13), in
`config.rating.performance`:

| component | `carry` (top/mid/adc) | `jungle` | `support` |
|---|---|---|---|
| KDA | 0.15 | 0.20 | 0.25 |
| damage to champions | 0.30 | 0.20 | 0.05 |
| gold | 0.20 | 0.10 | 0.05 |
| vision score | 0.05 | 0.15 | 0.40 |
| damage self-mitigated | 0.10 | 0.10 | 0.15 |
| CS | 0.20 | 0.10 | 0.10 |
| damage to objectives | 0.00 | 0.15 | 0.00 |

**Damage to objectives is the seventh and newest** (M7.14, from `game_players.damage_to_objectives`): a jungler's
job is the map, and the six above read only fights and farm. It is the **one component weighted for a single
bucket**. The 0.15 came off the jungle row's gold, CS and KDA, 0.05 each — gold and CS because objective damage
is a second reading of the same farming clock, KDA by one notch because a jungler taking objectives is doing the
thing ganks were a proxy for — so `carry` and `support` scores are **bit-for-bit what they were under M7.13**,
pinned by a test. A `0.00` weight is not an exemption from the missing-input rule below.

Every row sums to 1.00. The role-to-bucket map is `config.rating.performanceBucket` and lives **only** there:
top, mid and adc are all `carry`, jungle is `jungle`, support is `support`. **Three buckets, not five**, because
M7.12 measured that nothing in the stored end-of-game block separates top from mid — a bucket that never has to
tell them apart cannot be wrong about it — while jungle and support, the two roles the single M7.8 vector
misread, were pinned 46 of 46 sides with an independent Smite check. A single flat vector scored a support and
an adc on the same weights, which asked each to win MVP on the other's terms.

**Each component is still normalised inside the game**: a player's value divided by the best of the ten for that
component — the whole ten, never the best within their own bucket — so every term is in `[0, 1]` and gold does
not swamp KDA by being a four-digit number. KDA is `(kills + assists) / max(1, deaths)`. A component whose
game-wide maximum is zero contributes zero to everybody rather than dividing by zero, whatever that player's
bucket weights say about it. A score is therefore in `[0, 1]` and is comparable **only inside its own game**,
which is all MVP and ACE need. The seven are summed in the table's order, which is part of the pinned arithmetic
— damage to objectives last, which is the other half of why adding it left `carry` and `support` scores exactly
where they were. Ties go to the lower puuid, never to the array's order.

A game where **all ten did zero objective damage** — a twelve-minute surrender with no plates — hits the same
`maximum is zero` branch as any other component: it contributes zero to everybody, the jungle row's remaining six
weights then sum to 0.85 for everybody in that bucket, and nothing is renormalised. Renormalising per game would
mean the weights differ game to game, which is a second model.

Nothing here requires a side to hold five distinct roles: buckets are read per player, and a side with two
supports and no top is scored as it comes. The balancer's view of roles is not involved.

The adjustment is applied **after** `rateGame` and never inside it, so the base rating maths
stays untouched and independently testable — `applyMvpAceBonus` takes the fold's `{ puuid, before, after }` and
gives back the same ten. With `delta = after.mu - before.mu`:

- MVP: `mu' = before.mu + delta * (1 + config.rating.mvp.bonusFraction)`, default **0.25**, so **1.25x**.
- ACE: `mu' = before.mu + delta * (1 - config.rating.mvp.aceReliefFraction)`, default **0.20**, so **0.80x**. The
  ACE's delta is negative, so this shrinks a loss and never turns one into a gain.
- Everybody else is untouched, and **`sigma` is never touched by any of this** — Proven must keep meaning "how sure
  the model is", and certainty is not something you earn by farming vision.

The bound is the construction: both factors are positive and fixed, so the sign of a delta never flips and no term
is unbounded. A winner always gains; a loser always loses.

**If any of the seven components is missing for any of the ten** — a game stored before M7.7 or M7.14, a blob
that never carried vision, a `null`, a `NaN` — there is **no MVP and no ACE** (`mvpAce` returns `null`) and the
game is rated exactly as it was before M7.8. There is no partial scoring: it would rank a player who has a vision
score against one who does not.

**The rule is universal and is not scoped to where the weight is above zero** (M7.14). A carry with no objectives
number, whose weight on it is `0.00`, takes the MVP off the game exactly as a jungler with none does.
`componentsOf` checks all nine of its inputs for every player before any bucket is consulted, and the reasons are
that the denominator is the whole game (a player who drops out of a component's maximum changes what everybody
else is measured against, so the jungler's score would depend on whether we happened to store a *laner's*
number), that a weight-scoped rule would let a `config.ts` nudge reach back and change which past games are
scorable at all, and that one rule is explainable where two are not. A weight may change what a score is; it may
never change whether a game has one.

**And if any of the ten has no role, the same three answers** (M7.13): `performanceScores` returns `null`,
`mvpAce` returns `null`, and `applyMvpAceBonus` gives back an untouched copy of the fold. Role is an input like
the other nine numbers and it declines the same way — per game, never per player. `null`, `undefined` and a
value outside the five roles all count as no role; it **never falls back to `carry`**, because a silent default
is a guess printed as a fact. The cost is accepted and real: every backfilled game carries `role = null` for all
ten (decision, 2026-09-09; M5.18 is unresolved), so the backfilled half of the history never has an MVP. The
games that keep one are the live end-of-game ones. Only the shape guard still throws: anything that is not five
a side, or a puuid twice, is a caller bug rather than missing data.

The worked example's ten (`docs/00-product.md`, blue winning, on the roles the balancer gave them, with the
objectives column the test file gives them) score Bilal 0.8875, Lena 0.7000, Rami 0.5750, Iris 0.5375, Nadia
0.5000, Theo 0.4875, Hana 0.3875, Omar 0.2875, Karim 0.2500, Yuki 0.0000 — so Bilal is the MVP and Lena the ACE,
pinned in `rating/performance.test.ts`. M7.14 moved the two junglers there and nobody else (Rami 0.4875 ->
0.5750, Iris 0.5000 -> 0.5375). That game has no support who ran the map, so the buckets reorder the middle and
not the top; the test file also pins a hand-built ten where the support has the best vision and the worst damage
and wins MVP under these weights, having lost it under M7.8's single vector, and a second one where a jungler
who is exactly mid-table on the other six wins MVP on objective damage alone, having lost it under M7.13's six.

**Where it is applied (M7.9): inside `foldGame` in `apps/web/lib/ingest/fold.ts`, once.** That function is the
one implementation both rating callers share — `rating.ts` folds a game as it lands, `rebuild.ts` replays a group's
whole history — so a game the live fold amplified and a rebuild did not is not a bug that can happen. It calls
`performanceScores` → `mvpAce` → `applyMvpAceBonus` in that order and writes the adjusted `mu` into the same four
`game_players` columns as before: **no new column, no stored marker, nothing about the award is written down**.
Both callers select the nine stat columns and `role` for this and read them for nothing else; `lib/stats/fold.ts`
still gates with the three-field `FoldPlayer`, because "did a game happen" never needed a stat line.

Two consequences worth naming. **The surfaces needed no change**: `/leaderboard`'s expand and `/p/[puuid]`'s
recent games print `mu_after - mu_before` off the stored row, so the adjusted delta reached them the day the fold
started writing it. Week boards (M14.57) sum those same stored deltas, so the bonus counts there too; the separate weekly fold that once skipped it is retired.

**Where it is named (M7.10): two surfaces, one function, at read time.** Nothing distinguishes an amplified
`mu_after` from a plain one once it is stored — that was checked, and it is why `fold.ts` exports `gameAward` at
all — so a surface that wants to print an MVP recomputes the *answer* by calling the fold's own function, never
by folding a second copy of the formula. `gatedGameAward(players, durationS, winningSide)` is `gameAward` behind
`gateGame`, because `mvpAce` **throws** on anything that is not five a side with ten distinct puuids and the
rating callers are the only ones with a gate in front of them already. The Discord result post
(`lib/discord/assemble.ts` → the last field of `resultEmbed`) and `/p/[puuid]`'s recent games
(`lib/board/load.ts` → `RecentGame.award`) both call it, on the same columns of the same game, so the two cannot
disagree about who carried a night.

Three rules those two share, and they are the reason the surfaces stay honest rather than merely consistent.
**"The fold rated this" is "all ten rows carry `mu_after`"** — the only signal there is, and the one that keeps a
remake, a four-minute surrender and an ARAM (four null rating columns, for ever) from ever growing an MVP.
**The award reads `game_players.role` and takes no fallback**, unlike the role the result embed's two columns
print, which falls back to the stored split when the client reported no position: the fold read the column, so a
game with no MVP in the fold must have none on a page, or a post would name a player whose delta was never
amplified. And **the read is the same query, wider** — nine more integer columns on a select that was already
being made — never a second round trip; the board's own all-time read of `game_players` is left alone, because
it prints no award and would be carrying those columns for a thousand games to say so.

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
  `rebuild-ratings`, for everybody with a game in the group. Nowhere else — no cron, no button, no recompute on
  page load. It reads a player's rated games across every group, because a role is a fact about a person. Only
  rows whose pair, count or stamp actually move are written, so a second rebuild changes nothing; a failure after
  a rated fold is logged and swallowed, because the game is rated and the next game or rebuild fixes the pair.
  No admin surface sets roles; the 1.0 players page and its write route are retired (M14.23, M14.56).

## Mode model (`packages/core/mode`, M15.2)

The standing mode (`normal` | `fearless`) and at most one **rule** for the next game (`class` with a
`CLASS_TAGS` tag, `region`, `mirror`), per the M15.1 brief. Champion facts (Data Dragon tags, region slug) are
input as a `ChampionTable` keyed by `champion_id`; core imports no fixture.

- `config.modes.ratedDefault`: normal, fearless, mirror rated; class, region not rated. An admin may flip Rated
  for the next game in any mode; choosing a mode or rule resets it.
- Pools: a class counts **any** tag; `modePool(mode, roster, fearlessBans)` subtracts the bans the caller passes
  (pass none on a Normal night). `rulePlayable`: a class needs `config.modes.classMinOpen = 10` open; region
  wars needs two regions (never `unaffiliated`) with `config.modes.regionMinOpen = 8` open; mirror always.
- `drawSpin(options, previousRule, playable, rng)`: a family uniformly from `SPIN_FAMILIES` (`class`, `region`,
  `mirror`; M17.17), then an option; never the previous rule, an unplayable option or a standing mode. Mirror joined
  once Start a lobby began opening the Blind Pick lobby itself. `drawRegions(regions, openCounts, rng)`: blue, then red from the
  rest. Both sort candidates by a stable key; `rng` returns `[0, 1)` or the draw throws `RangeError`.
- `checkMode(mode, seats, table)`: per side `kept` | `broke` | `unknown` with champion keys (mirror: per lane).
  A champion with no tags or no region row is `unknown`, never `broke`; seats carry no player.
- Lifecycle: `chooseStanding` / `chooseRule` / `setRated` move a `version`; `lockAtRoll` copies the effective
  mode and rated flag with that version (a Reroll passes the existing lock back); `afterRecord` clears the rule
  and the switch only for a Rift game with a lock whose version still matches, so anything changed after Roll
  survives. Remake, ARAM and no-lobby games consume nothing; a dropped lobby is no record at all.

## Lobby lifecycle (server side)

```
open ---(admin roll, >= 10 around)---> balanced ---(gameflow InProgress)---> in_game ---(eog captured)---> finished
  \                                          |
   \---(members change)---> open <-----------+ (next teams need another roll; previous split kept as history)
   \---(lobby dissolved / 2h idle)---> abandoned

in_game ---(2h idle, no result)---> dropped ---(a late eog block)---> finished
```

- The companion posts the full member list every time it changes; ingest never balances (2026-10-03, see
  `04-decisions.md`). `open -> balanced` is an admin's press, `POST /api/admin/lobbies/[lobbyId]/roll` with
  `{ rosterKey }` — `rosterKey()` over every member puuid, spectators included, as the presser's page saw it.
  The route refuses (409, nothing written) a key that is not the stored roster, fewer than ten around, or a
  lobby past `balanced`, and a repeat press on a `balanced` lobby answers the split already chosen. The claim is
  a compare-and-set on `status` and on the row's `updated_at`, which ingest moves on every roster-identity
  change, so two presses produce one balance and one set of three splits, and a press that raced a leave loses.
  The lobby answer still carries `recheckInMs` for installed companions; it is always `null`.
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
  their seat; the API only says so, it never moves anyone. Both numbers count **the lobby's group only**
  (M14.43): another group's games move neither games tonight nor the last sit-out. **The lobby's host never
  sits** (M14.43): the player whose companion first reported the lobby (`lobbies.reported_by_player_id`)
  is taken out of the sitting end and plays, until a real client shows that a spectator still gets the
  end-of-game block (`03-lcu-reference.md`, unverified).
- The `lastSplit` passed to the balancer is the five puuids on one side of the most recent chosen split whose
  lobby had the same ten players as tonight's; if there is no such split, `lastSplit` is null.
- Discord posting happens from the API on state transitions, through the webhook stored in `discord_config`.
- A split going on the board is what queues `switch_side` commands for the chosen ten whose client has them on
  the other side (M4.1/M4.3), and that happens in two places: reaching `balanced` (the roll), and a **reroll**, which
  promotes another split without the lobby ever leaving `balanced` (`promoteSplit` supersedes the old split's
  rows and queues the new ones in the same write). **Leaving** `balanced` — to `open`, `in_game`, `finished`,
  `abandoned` — fails the ones still pending with `superseded`, inside `moveLobby` itself. Nobody is dragged to
  a side from a split the group has moved on from. `create_lobby` and `invite` are never queued by a transition
  (they are M4.2's button) and never superseded by one; they expire on their own TTL.

## Overlay panel (inside `apps/companion`)

Champ-select panel is a mode of `Kustom.exe`, not a second product (M6 / M12, 2026-09-23). Overlay mode
needs no companion token. Polls `current-summoner` and `gameflow-phase` only; on `Lobby` / `ChampSelect`
fetches `GET /api/overlay?puuid=` and shows the fearless pool plus with/against records for the posted
teams. Hides at `GameStart`. Host mode runs the same panel beside the companion watchers. Config:
`%APPDATA%/customs-night/config.json` with `{ mode: 'host' | 'overlay', apiBase, companionToken? }`.
Write powers require a token — Overlay mode never stores one. `apps/overlay/` is retired as a ship target.

## Companion (`apps/companion`)

Long-running process (Node engine) plus optional Tauri tray shell (M6). State machine (Host mode):

```
disconnected --(lockfile found)--> connected --(ws open)--> watching
watching: on lobby event -> POST /api/companion/lobby
          on gameflow InProgress -> mark lobby in_game
          on eog WS event -> POST /api/companion/game (GET eog-stats-block only as the connect-time fallback)
          every 6h -> POST /api/companion/rank for self; on lobby roster, for each unknown puuid
          every 5s -> GET /api/companion/commands -> execute (create lobby, invite, switch side) -> ack
```

- Config in `%APPDATA%/customs-night/config.json`: `{ mode, apiBase, companionToken? }`. Host pastes a token
  minted on the web admin page; Overlay writes `mode: 'overlay'` with no token. Pre-M6 files with a token and
  no `mode` are treated as host.
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

- `/g/<slug>` Tonight (M13.9): one group's live lobby, teams, result, tape and fearless list. Public read by
  link, no directory. The slug resolves through `groups_public` (`lib/groups/requirePageGroup.ts`): an unknown
  slug is 404; a uuid that names a game 308s to `/g/<its slug>/games/<id>` (M11.4's Discord links). Realtime
  subscription filtered `group_id=eq.<id>` on every published table that has the column (`lobbies`, `games`,
  `game_players`, `ratings`, `fearless_state`; `lobby_members` and `splits` have none and stay unfiltered).
  Every in-app link comes from `lib/nav.ts`'s `groupHref`, which knows which pages have moved under the prefix;
  an unmoved page is linked at its old path on the original group's pages only and not at all on any other
  group's. `/` is a permanent redirect (`lib/groups/landing.ts`): signed out to `/g/customs`, a member to the
  `kustom_group` cookie's group (written by `proxy.ts` on every group page, followed only when the session's
  player is a member) or their oldest group, a signed-in person in no group to `/new`.
- `/leaderboard` The board through one of three windows: by `Rating` with a settling section on `All time`, and by
  the weekly `Rating` on `This week` (the default) and `Last week`, which are folded from each player's seed at read
  time (M7.3) — the stored one, else `provisionalSeed()`, never their League rank. Wins, games, streak.
- `/p/[puuid]` Player page: rating history chart, role record, recent games.
- `/admin` Discord OAuth gated, admin membership (`group_memberships.role = 'admin'`) in the page's group — the
  original group until M13.14 moves the pages under `/g/<slug>/admin`. Link Discord IDs, see the inferred roles (M5.17), mint companion tokens, set Discord config.
- `/api/companion/*` bearer token, zod-validated. The command queue is three of them (M4.1):
  `GET /commands?clientConnected=`, `POST /commands/{id}/ack`, `POST /commands/{id}/nack`. The contract is one
  doc comment on `companionCommandsResponseSchema` in `packages/db/src/schemas/companionResponses.ts`; the
  rules are `apps/web/lib/commands/`. `clientConnected=false` is the one request in the whole API that does
  not write `companion_tokens.last_seen_at`, which is what makes that column mean "at their PC with League
  open".
- `/api/admin/*` session-gated, **per group** (M13.4). Every body names a `groupId` (`groupIdSchema`, a guid:
  the original group's fixed id is not a v1-v8 uuid and `z.uuid()` refuses it). `lib/adminRoute.ts` reads the
  body once, resolves the session (401 / 403 as before), checks that the session's player has `role = 'admin'`
  in **that** group (400 without a `groupId`, 403 `not an admin of this group` otherwise — an admin of A naming
  B, or a member who is not an admin), and only then runs the route's own schema. Handlers act on
  `context.groupId` and nothing else: a lobby, player or token outside it is **404**, never 403, so an admin of
  A does not learn which of B's ids exist. `POST /api/admin/members/role { groupId, playerId, role }` promotes
  or demotes a member through `set_group_member_role` (`0020`), which locks the group's row and refuses to
  demote the last admin (409 `This group needs at least one admin.`); it is the only role write since M14.56
  retired the players route. `players.is_admin` is read by nothing (`lib/groups/isAdminUnread.test.ts` walks the sources).
- **Crons loop over groups** (M13.4): `cron/leaderboard`, `cron/window` and `cron/mystery` serve every group,
  oldest first, each on its own — one group's failure is its own line in the response and the next group
  still runs. `window_posts` is claimed per `(group_id, kind, window_start)` and a group with no webhook gets
  no claim row. The daily mystery is one challenge per group per day from that group's games, numbered per
  group per kind; `GET /api/daily-mystery?group=<id>` is the group's (no membership; `group` is optional on
  the challenge routes and a mismatch is 404). `cron/sweep` stays global.
- `/api/me/*` **the third route class** (M3.6): a Supabase session with a **linked player**, scoped to the
  body's `groupId` since M13.4 — after the parse, `lib/me/route.ts` hands the handler `context.role`, the
  player's membership role in that group or `null`. `start` and `role-tonight` refuse a non-member (403
  `NOT_IN_THIS_GROUP`); `link` asks nothing of a visitor who has no player row yet and only claims out of that
  group's tonight lobby. The caller is resolved the one way this project resolves anybody — session → Discord
  identity → `players.discord_id` → the player row — and no request body is ever part of that chain
  (`apps/web/lib/me/identity.ts`, `lib/me/route.ts`, which is `withAdminAuth` with the admin step removed).
  401 without a session, 403 for a session with no Discord identity. An **unlinked** session is not a failure:
  it is handed to the handler as `player: null`, because `POST /api/me/link` exists for exactly that visitor.
  - `POST /api/me/role-tonight` writes `lobby_members.role_override` for one player in one live lobby
    (`open`, `balanced`, `in_game`; anything else is refused). `role: null` clears it. The body's optional
    `puuid` names a **target** and is honoured **only for an admin of the body's group** — 403 otherwise, decided before any read,
    and never a silent write to the caller's own row. Nothing rebalances and nothing is posted to Discord: a
    tap while the teams are up is stored for the next game.
  - `POST /api/me/link` is the self-link ("picking yourself, once"): the visitor claims one of **tonight's**
    lobby members as themselves and the route writes `players.discord_id` and nothing else. **One link per
    player and one player per session**: only a member of tonight's newest non-`abandoned` lobby may be
    claimed, a player who already carries a `discord_id` is neither offered nor accepted (409), the write is
    conditional on `discord_id is null` so the race cannot double-link, and `players_discord_id_key` catching a
    session that already has a player is the same 409 rather than a 500. Undoing a link has no in-app path
    since M14.56: it is cleared by hand (`players.discord_id` to null).
  - Which members may be claimed is decided **on the server** with the service role
    (`apps/web/lib/me/claimable.ts`): `discord_id` is not readable with the anon key, so the page is handed the
    PUUIDs of the unclaimed members only and never learns who is linked to what.
  - `POST /api/me/lobbies/start` is `Start a lobby` (M4.2's rules, moved onto this class by M4.13): one
    `create_lobby` command for the host the server picked (payload `{ lobbyName, lobbyPassword, pickType }`, M17.17:
    `pickType` is `blind` when the group's next rule is mirror match and `draft` otherwise; a payload without it
    reads as draft, and the companion resolves that entry from the client's own custom-queue list), with the
    invites following off its ack. The presser
    is `context.me.player.playerId` from the session and never the body, which carries nothing but a
    `redirectTo` for the no-JavaScript path; a session with no player row is a 403 with
    `START_LOBBY_NOT_LINKED` rather than a 500. **There is no admin branch**: an admin of the group is a member
    of it, so `/admin`'s one button posts here too and the old
    `/api/admin/lobbies/start` was deleted rather than aliased. The rules and every string it answers with are
    `apps/web/lib/lobbyStart.ts`, imported by both surfaces.
- **Creating, joining and pairing** (M13.5; `lib/groups/`, schemas in `packages/db/src/schemas/invites.ts`).
  Session routes that come before a group is the caller's, so they carry no `groupId` to check and use
  `lib/groups/sessionRoute.ts` (`resolveMe` without `withViewerAuth`'s membership step): `POST /api/groups
  { name, slug }` (`create_group`: the group, its `fearless_state`, its invite and a linked creator's `admin`
  membership in one transaction; 409 `That link is taken.`), `GET /api/groups/mine`, `POST /api/groups/join
  { code }` (linked sessions only; never a token), `POST /api/me/pairing { groupId | inviteCode }` (the
  creator, or a holder of the live invite) and `GET /api/me/pairing/status?code=` (the session's own codes
  only). `POST /api/admin/invite/rotate { groupId }` is an ordinary admin write. **`POST /api/companion/pair
  { code, puuid }` is the one companion route with no token**: rate limited per address first
  (`pairing_attempt`, 10 a minute, every attempt counted), then `redeem_pairing_code` links the code's Discord
  id (copied from the issuing session's verified identity) to the PUUID Kustom read from League, adds the
  membership (`admin` for the group's creator) and uses the code, under a row lock. It never re-links a
  Discord account and never takes a PUUID linked to someone else; a refusal writes nothing.

## Discord

- M3: webhook messages from the API. Teams embed, result embed, nightly leaderboard.
- M4: `apps/discord` bot. Subscribes to Supabase Realtime. On `lobbies.status -> balanced` moves members whose
  `discord_id` is known into blue/red voice. On `finished` moves everyone back to the lobby voice channel. Posts
  "N around" when lobby voice membership changes and no lobby is open. Hosted on Fly.io or Railway.

## Security

- Companion tokens are random 32 bytes, stored hashed, one per player, revocable from admin.
- Pairing codes (M13.5) are six characters of a 32-letter alphabet, stored as SHA-256 like a token, 15
  minutes, single use, and the only key to `POST /api/companion/pair`, which has no token. What guards that
  route is the code's lifetime plus a per-address limit kept in the database (`pairing_attempts`, so every
  Vercel instance shares it). The PUUID in the body is trusted only as "who is signed into League on the PC the
  person is at"; who they are on Discord comes from the code, which only their own signed-in session can get.
  Rotating an invite link expires every unused code a non-creator got through it.
- The API never trusts a PUUID claim beyond what the companion reports; a companion can only report games and
  lobbies it was in. Both checks run before anything is written, so a refusal leaves no row behind.
  - Games: the token's player PUUID must appear among the participants of the posted game, **or** among the
    members of the lobby that game was played from — `is_spectator` included (M2.8) — or the API answers 403.
    The companion's end-of-game payload is flattened and carries no `localPlayer`, so participation is the
    check, and the lobby half is there because the friend sitting out a round is often the one running the
    companion. Backfill is the exception: no lobby fallback, only the participant check, and no approval step
    (2026-10-03 reversed M5.1's per-player admin approval; every member's companion backfills).
  - Lobbies: the token's player PUUID must appear in the posted `members` — `isSpectator: true` counts — or the
    caller must already be that lobby's `reported_by_player_id`, or the API answers 403. The posted list
    replaces the roster, so without this one stale companion could delete another lobby's members. The
    `reported_by_player_id` fallback is what lets the companion that owns the lobby post the "everyone left"
    empty list, which by definition cannot contain the caller.
- The end-of-game block carries the post-game chat room's credentials and `games` is public-read, so the API
  redacts `mucJwtDto` and `multiUserChatPassword` before the insert (`scrubRawEogBlock`, M2.10). The
  companion may redact them too; the server is the one that has to, because old companion binaries keep
  running for months.
- Supabase Row Level Security is on for every table. Writes only through the service role used by the API and
  the locked definer functions; anon and authenticated hold no insert, update, delete or truncate anywhere.
  - **Public read** (anon and authenticated, `using (true)`): `ratings`, `lobbies`, `lobby_members`, `splits`,
    `games`, `game_players`, `fearless_state`, `modes`, `group_modes`; and three views that run as their owner
    so they can read a base table anon cannot: `players_public` (`players` without `discord_id`),
    `groups_public` (`id, slug, name, ratings_since`, never `created_by`) and `group_members_public`
    (`group_id, player_id`, never `role`: who is in a group is the leaderboard, who runs it is not).
  - **Column grants inside a public table.** `lobbies.lobby_password` (`0028`, M14.28): anon and authenticated
    get SELECT on every other column, so a select naming it, or `select=*`, is a 42501, and anon Realtime
    payloads carry no password; the server reads it with the service role for linked members only.
    `group_modes.set_by` and `fearless_state.reset_by` (`0029_admin_ids_private.sql`, M14.40, applied
    locally): the same pattern, because with `players_public` a player id names a group's admin. A column
    added to any of the three tables later is private until granted.
  - **Signed-in reads** (`0022`, M14.5, defence in depth; the app still reads with the service role):
    `group_memberships` (a session reads its own rows; a group's owner or admin reads every row of that group)
    and `group_invites` (a group's owner or admin reads its invite), through `current_player_id()` and
    `is_group_admin()`. anon gains nothing.
  - **No read policy at all** (service role only): `players` (anon gets a 401), `groups`, `companion_tokens`,
    `companion_commands`, `discord_config`, `discord_connect_states`, `window_posts`, `daily_mysteries` and its
    tables, `pairing_codes`, `pairing_attempts`.
- `discord_connect_states` (`0025`, M14.20) stores only the sha256 of the OAuth `state` nonce, bound to the auth
  user and group that pressed `Connect Discord`, ten minutes, single use (the callback's one conditional update);
  the URL's state also carries an HMAC over (nonce, group, user) keyed from the Discord client secret. The
  `webhook.incoming` exchange's access and refresh tokens are dropped, never stored; only the webhook is kept.
- Admin writes go through `authorizeAdmin` (an `owner` or `admin` membership in the request's group). Four
  **setup writes** go through `authorizeSetupWrite` instead (M14.40): Connect Discord (connect and callback), the
  Discord test post, `discord-config` and the invite rotate also accept the session whose auth user id is the
  group's `groups.created_by` while no player is linked to its Discord account, so a creator can connect Discord
  and share the invite before pairing. It is an allow-list pinned by `lib/setupGate.test.ts`; host tokens,
  roles, remove, transfer, reset, mode and roll never read `created_by`.
- Sessions: `proxy.ts` refreshes the Supabase session on every page navigation that carries an `sb-` cookie
  (M14.40; not `/api`, `/auth`, `/og`, `_next` or static files) and writes the rotated tokens onto the response, because
  a server component cannot write cookies.
- Public reads of players go through the `players_public` view, which is `players` without `discord_id`. It
  still carries the retired `is_admin`, which nothing reads since M13.4: the tonight page decides whether to draw
  the roll and reroll controls on the server from the viewer's membership role, and names the group's admins
  with a service-role read of `group_memberships` (only the names reach the page). Anon and
  authenticated have no read privilege on the `players` table itself and get a 401 from it. The web app and the
  bot read `players_public`.

## Operational notes

- A League patch can break any LCU endpoint. `packages/lcu` has a `pnpm --filter lcu smoke` script that hits
  every endpoint we use against a running client and prints shape diffs. Run it after every patch Tuesday.
- CI (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` and `pnpm --filter web build` on ubuntu-latest for every pull request and every push to `main`, on the Node in `.nvmrc` and the pnpm in `packageManager`; it needs no secrets, and with no Supabase local stack on the runner the `*.integration.test.ts` files skip.
- Vercel free tier and Supabase free tier are enough. The bot needs a small always-on box (Fly.io free allowance).
- Backups: Supabase daily. `games.raw` makes everything else reproducible.


### Mode of the night (M15.3, `0032`)

`group_modes` carries the standing mode (`normal` / `fearless`), the one pending rule (`pending_rule`, `pending_class_tag`), the admin's
Rated override and a `version` that every card write bumps (compare-and-set). Roll copies the card onto the lobby (`lobbies.lock_*`: the
standing mode in `lock_mode`, the rule, the drawn regions, `lock_rated`, `lock_version`); Reroll keeps it; a `balanced → open` trigger drops
it. A recorded game is stamped from that lock, not from the card at record time: `games.mode` stays the **standing** mode, the rule lives in
`games.rule*`, `games.rated` is fixed at insert, and `rule_check` holds core's kept / broke / unknown verdict (champion keys only). After
record the pending rule and override clear only if the card's version still equals the lock's. A game with `rated = false` never reaches the
fold or `rebuild-ratings` (`gateRatedGame` → `not-rated`, also a rebuild fence), so it has no `mu_after` and stays off the boards,
calibration, the Fearless pool (`mode = 'fearless' and rated`) and role learning.
