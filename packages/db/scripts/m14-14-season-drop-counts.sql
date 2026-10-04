-- m14-14-season-drop-counts.sql  (M14.14 step 1)
--
-- READ-ONLY. Lists, per table, how many rows migration 0026_remove_seasons.sql would delete
-- and how many it keeps. One SELECT: no writes, no DDL, no function that writes. Safe to paste
-- into the hosted project's Supabase SQL editor, or to run on the local stack:
--
--   docker exec -i supabase_db_customs-night psql -U postgres -X -v ON_ERROR_STOP=1 \
--     -c 'set default_transaction_read_only = on' -f - < packages/db/scripts/m14-14-season-drop-counts.sql
--
-- The rule (the user's decision, 2026-10-03): every row of the ACTIVE season
-- (`seasons.is_active`) is kept; rows of any other season are deleted. If `active seasons` is
-- not exactly 1, STOP and report: 0026 aborts in that case too.
--
-- What goes with a deleted game (from the migrations, checked against pg_constraint at 0025):
--   game_players            -> games (id, group_id) ON DELETE CASCADE    (0018)
--   daily_mysteries         -> games (id)           ON DELETE RESTRICT   (0013)  0026 deletes these first
--   daily_mystery_clues     -> daily_mysteries      ON DELETE CASCADE    (0013)
--   daily_mystery_sessions  -> daily_mysteries      ON DELETE CASCADE    (0013)
--   daily_mystery_attempts  -> daily_mysteries      ON DELETE CASCADE    (0013)
-- ratings -> seasons is ON DELETE CASCADE; games -> seasons is NO ACTION (0026 deletes the games
-- first). Nothing else references games, game_players, ratings or seasons.
--
-- Never run 0026 itself to "see what happens"; this file is the preview.

with
  a as (select id from public.seasons where is_active),
  dg as (select id from public.games where season_id not in (select id from a)),
  dm as (select id from public.daily_mysteries where game_id in (select id from dg))
select 'active seasons (must be 1)' as what, count(*)::bigint as n from a
union all select 'active season id: ' || coalesce((select id::text from a limit 1), 'NONE'), null
union all select '-- DROP --', null
union all select 'seasons to drop', count(*) from public.seasons where id not in (select id from a)
union all select 'games to drop', count(*) from dg
union all select 'game_players to drop (cascade)', count(*)
  from public.game_players where game_id in (select id from dg)
union all select 'daily_mysteries to drop (restrict; deleted first)', count(*) from dm
union all select 'daily_mystery_clues to drop (cascade)', count(*)
  from public.daily_mystery_clues where challenge_id in (select id from dm)
union all select 'daily_mystery_sessions to drop (cascade)', count(*)
  from public.daily_mystery_sessions where challenge_id in (select id from dm)
union all select 'daily_mystery_attempts to drop (cascade)', count(*)
  from public.daily_mystery_attempts where challenge_id in (select id from dm)
union all select 'ratings to drop', count(*) from public.ratings where season_id not in (select id from a)
union all select '-- KEEP --', null
union all select 'games kept', count(*) from public.games where season_id in (select id from a)
union all select 'game_players kept', count(*)
  from public.game_players gp join public.games g on g.id = gp.game_id where g.season_id in (select id from a)
union all select 'daily_mysteries kept', count(*) from public.daily_mysteries where game_id not in (select id from dg)
union all select 'ratings kept', count(*) from public.ratings where season_id in (select id from a)
union all select 'ratings kept: duplicate (group_id, player_id) keys (must be 0)', count(*) from (
    select 1 from public.ratings where season_id in (select id from a)
    group by group_id, player_id having count(*) > 1
  ) d
union all select 'ratings kept: round(sum(mu) * 1000)', round(coalesce(sum(mu), 0) * 1000)::bigint
  from public.ratings where season_id in (select id from a)
union all select 'ratings kept: round(sum(sigma) * 1000)', round(coalesce(sum(sigma), 0) * 1000)::bigint
  from public.ratings where season_id in (select id from a);
