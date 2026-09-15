-- 0015_damage_to_objectives.sql (M7.14)
--
-- The one number a jungler's job is actually made of and that `game_players` has never kept:
-- damage dealt to towers, dragons and barons.
--
-- M7.13's performance score reads a role bucket, and none of its six components reads an
-- objective at all — so the jungler was scored on fights and farm, and M7's own acceptance
-- sentence ("the jungler on objectives and fights") was a claim the numbers did not support.
-- M7.14 adds a seventh component weighted `0.15` in the `jungle` vector and `0.00` in `carry`
-- and `support`: no laner's and no support's score moves by one digit, and a jungler who took
-- the map can win MVP for taking it.
--
-- **Nullable, no default, for `0014`'s reason and it is the whole point.** `null` means "this
-- game never stored it", which is not the fact `0` states — a jungler who never contested a
-- dragon really did do zero objective damage, and the two must not read the same. The
-- missing-input rule is all-or-nothing and **universal**: with this number missing for any of
-- the ten — including a carry, whose weight on it is 0.00 — the game has no MVP and no ACE and
-- rates exactly as it does today. The denominator is the whole game (every component is
-- normalised against the best of the ten), so a laner's missing number would silently change
-- what the jungler's share is measured against; and a weight-scoped rule would let a nudge in
-- `config.ts` change which past games are scorable at all. `not null default 0` would erase all
-- of that and score a real jungle carry at nothing.
--
-- **The name follows our own convention, not the client's words, and that is a deliberate
-- exception to `0014`'s rule.** 0014 said names follow the client (`damage_self_mitigated` from
-- `damageSelfMitigated`); this one has a sibling that outranks the rule. Damage to champions is
-- already `damage_to_champs` / `damageToChamps` here and in `packages/core`, from a client key
-- called `TOTAL_DAMAGE_DEALT_TO_CHAMPIONS`. Damage to objectives is the same stat family read
-- against a different target, and the two may not be named by two conventions in one weights
-- table. So: `damage_to_objectives`, `damageToObjectives`.
--
-- The client says it twice and ingest reads both, uppercase first:
-- `TOTAL_DAMAGE_DEALT_TO_OBJECTIVES` on the end-of-game block and `damageDealtToObjectives` on
-- the match-history detail. **The fallback is load-bearing here, unlike 0014's two:** the
-- match-history detail carries *only* the camelCase key — the uppercase one is null on every
-- row of a backfilled game — so a reader that required it would fill live games and leave every
-- backfilled game silently null (`03-lcu-reference.md`, M7.13 step 1, 2026-09-15: present on
-- 100% of rows on both shapes, non-zero on 98.6% of live rows and 96.3% of backfilled ones, and
-- genuinely per-player, not a team total copied ten times). Values come off the posted `raw`
-- block rather than a new mapped-participant field, so no companion release is owed and the
-- history is filled backwards from `games.raw` by the same reader
-- (`pnpm --filter web copy-raw-stats`; `04-decisions.md`, 2026-09-15).
--
-- The `>= 0` check is a floor on nonsense, not the gate — `0014`'s reasoning, unchanged. A
-- check constraint cannot be what catches a bad number, because by the time Postgres refuses
-- the insert the request has already failed and the `games` row is already stored, so the
-- companion would retry that game into the same 500 for ever. The writers clamp first
-- (`storedStat`, `apps/web/lib/ingest/statValue.ts`): a negative, or a value past int4 that no
-- check here could see at all, is stored as `null` — the same thing a missing key stores — and
-- the game lands and rates. This check only keeps a hand-written UPDATE honest.
--
-- No RLS change, for `0014`'s reason: `public.game_players` is publicly readable column by
-- column already (`policy "game players are publicly readable"`, `0001_init.sql`), the
-- identical number is already public inside `games.raw`, and no policy names columns one by one.

alter table public.game_players
  add column damage_to_objectives integer check (damage_to_objectives >= 0);

comment on column public.game_players.damage_to_objectives is
  'M7.14: damage this player dealt to towers, dragons and barons, from the posted raw block (`TOTAL_DAMAGE_DEALT_TO_OBJECTIVES` on an end-of-game block, `damageDealtToObjectives` on a match-history detail, which carries only that camelCase spelling). Named after its sibling `damage_to_champs`, not after the client key. Null means this game never stored it — not a jungler who never touched an objective. The performance score skips a game with any of its inputs null, for any of the ten, whatever that player''s bucket weight on this one is.';
