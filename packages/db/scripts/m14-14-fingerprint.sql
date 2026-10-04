-- m14-14-fingerprint.sql  (M14.14 acceptance 3)
--
-- A hash of every row 0026 must keep. Read-only. Run with `-v before=1` before 0026 (filters to
-- the active season) and `-v before=0` after it (no season left to filter on). The two outputs
-- must be identical: same row counts, same md5 over every column of games (raw by its md5),
-- game_players and ratings, same sum(mu) and sum(sigma).
\set ON_ERROR_STOP 1
\if :before
create temp view kept_games as
  select * from public.games where season_id = (select id from public.seasons where is_active);
create temp view kept_ratings as
  select * from public.ratings where season_id = (select id from public.seasons where is_active);
\else
create temp view kept_games as select * from public.games;
create temp view kept_ratings as select * from public.ratings;
\endif

select 'games' t, count(*) n,
  md5(string_agg(concat_ws('|', id, lcu_game_id, lobby_id, started_at, duration_s, winning_side, source, group_id, mode, md5(raw::text)), ',' order by id)) h
from kept_games
union all
select 'game_players', count(*),
  md5(string_agg(concat_ws('|', game_id, player_id, side, role, champion_id, kills, deaths, assists, mu_before, sigma_before, mu_after, sigma_after, group_id), ',' order by game_id, player_id))
from public.game_players where game_id in (select id from kept_games)
union all
select 'ratings', count(*),
  md5(string_agg(concat_ws('|', group_id, player_id, mu, sigma, ordinal, games, wins, seed_mu, seed_sigma, updated_at), ',' order by group_id, player_id))
from kept_ratings
union all
select 'ratings sum mu*1e6 / sum sigma*1e6', round(sum(mu) * 1e6)::bigint, round(sum(sigma) * 1e6)::text from kept_ratings
union all
select 'daily_mysteries', count(*), md5(string_agg(id::text, ',' order by id))
from public.daily_mysteries where game_id in (select id from kept_games)
union all
select 'daily_mystery_attempts', count(*), md5(string_agg(id::text, ',' order by id))
from public.daily_mystery_attempts
where challenge_id in (select id from public.daily_mysteries where game_id in (select id from kept_games));
