-- 0039_games_game_mode.sql (database performance plan, redesign/research/db-performance.md findings 3, 4)
--
-- games.game_mode: the client's gameMode kept beside the blob, so no reader detoasts games.raw (60 to 70 KB
-- an end-of-game block) for one string. A STORED generated column: nothing writes it, and a raw rewrite (the
-- ban enrichment in lib/ingest/game.ts) keeps it right by construction.
--
-- String values only. `raw->>'gameMode'` alone would also turn a number or a boolean into text; the one
-- reader of the field, gameModeFromRaw (apps/web/lib/games/queue.ts), treats anything that is not a string as
-- "no mode" (old Rift), so the column does too and every reader agrees with it. The value is stored as the
-- client sent it (not trimmed, not upper-cased): readers still normalise through gameModeFromRaw and
-- matchesQueue, and the Games list filter keeps its case-insensitive pattern.
--
-- The group list index also covers the lcu_game_id tie-break every games reader orders by (started_at desc,
-- lcu_game_id desc), so a group's newest-first page is an index scan with no sort. (group_id, started_at
-- desc) is its prefix, so it replaces games_group_started_at_idx (0026).
--
-- The ADD COLUMN rewrites games under ACCESS EXCLUSIVE: run it off-night (docs/runbooks/db-performance.md).

begin;

alter table public.games
  add column game_mode text generated always as (
    case when jsonb_typeof(raw -> 'gameMode') = 'string' then raw ->> 'gameMode' end
  ) stored;

comment on column public.games.game_mode is
  '0039: raw->>''gameMode'' (string values only), kept beside the blob so no reader detoasts raw for one string. Generated; never written. Null when the block carried none (old Rift). Normalise with gameModeFromRaw.';

create index games_group_started_lcu_idx
  on public.games (group_id, started_at desc, lcu_game_id desc);
drop index public.games_group_started_at_idx;

commit;
