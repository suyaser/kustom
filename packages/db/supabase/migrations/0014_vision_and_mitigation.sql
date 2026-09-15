-- 0014_vision_and_mitigation.sql (M7.7)
--
-- Two numbers the scoreboard has always had and `game_players` has never kept: vision score
-- and damage self-mitigated.
--
-- M7.8's performance score weights vision at 0.25 and mitigation at 0.15 — four tenths of it.
-- Without these two columns the MVP / ACE bonus would be a KDA-and-gold score, which crowns
-- the same carry every night and is exactly the second truth this project keeps refusing
-- (`04-decisions.md`, 2026-09-15).
--
-- **Nullable, no default, and that is the whole point.** `null` means "this game never stored
-- it", which is not the same fact as `0`. A tank who mitigated 199k damage and a tank whose
-- block we never read must not both read as zero: M7.8's rule is all-or-nothing — with any of
-- its six inputs missing for any of the ten there is no MVP and no ACE and the game rates
-- exactly as it does today. `not null default 0` would erase the difference and silently
-- score a real tank at nothing.
--
-- Names follow the client's own words (`damageSelfMitigated`), not the formula's shorthand.
-- The client says it twice, and ingest reads both: `VISION_SCORE` /
-- `TOTAL_DAMAGE_SELF_MITIGATED` on the end-of-game block and `visionScore` /
-- `damageSelfMitigated` on the match-history detail (both verified/corroborated for real
-- ten-player customs, `03-lcu-reference.md`, 2026-09-15). Values come off the posted `raw`
-- block rather than a new mapped-participant field, so no companion release is owed and the
-- history can be filled backwards from `games.raw` by the same reader
-- (`04-decisions.md`, 2026-09-15).
--
-- The `>= 0` checks are a floor on nonsense, not the gate. Both numbers are non-negative in
-- every fixture and in every hosted row read on 2026-09-15, and a negative would be a client
-- bug; but a check constraint cannot be what catches one, because by the time Postgres refuses
-- the insert the request has already failed and the `games` row is already stored — the
-- companion would then retry that game into the same 500 for ever. So the writers clamp first
-- (`storedStat`, `apps/web/lib/ingest/statValue.ts`): a negative, or a value past int4 that no
-- check here could see at all, is stored as `null` — the same thing a missing key stores —
-- and the game lands and rates. These checks only keep a hand-written UPDATE honest.
--
-- No RLS change, and note what that means here: `public.game_players` is **publicly readable**
-- like every other column on the table (`policy "game players are publicly readable"`,
-- `0001_init.sql`), so these two are public too. That is not a leak — the identical numbers
-- are already public in `games.raw`, which anon can select today — and no policy names columns
-- one by one, so nothing needed changing.

alter table public.game_players
  add column vision_score           integer check (vision_score >= 0),
  add column damage_self_mitigated  integer check (damage_self_mitigated >= 0);

comment on column public.game_players.vision_score is
  'M7.7: the game''s own vision score for this player, from the posted raw block (`VISION_SCORE` on an end-of-game block, `visionScore` on a match-history detail). Null means this game never stored it — not zero vision. M7.8 skips a game with any of its inputs null rather than scoring somebody at nothing.';
comment on column public.game_players.damage_self_mitigated is
  'M7.7: damage this player mitigated, from the posted raw block (`TOTAL_DAMAGE_SELF_MITIGATED` on an end-of-game block, `damageSelfMitigated` on a match-history detail). Null means this game never stored it — not a tank who mitigated nothing.';
