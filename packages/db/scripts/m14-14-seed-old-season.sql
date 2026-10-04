-- m14-14-seed-old-season.sql  (M14.14 acceptance 3, THROWAWAY DATABASE ONLY)
--
-- Run by m14-14-throwaway-check.sh against a throwaway restore, never against the shared local
-- stack or hosted. Adds a NON-active season holding everything 0026 must delete:
--   3 games (copies of the three oldest, new ids and lcu ids), their game_players, one
--   daily_mystery on an old game with one attempt, and a ratings row for every existing
--   (group_id, player_id) -- duplicates that would break 0026's new primary key if the delete
--   missed any.
\set ON_ERROR_STOP 1
begin;
insert into public.seasons (id, name, starts_at, is_active)
values ('00000000-0000-0000-0000-0000000000aa', 'Old season', now() - interval '1 year', false);

create temp table src as
  select id as old_id, gen_random_uuid() as new_id from public.games order by started_at limit 3;

insert into public.games (id, lcu_game_id, lobby_id, season_id, started_at, duration_s, winning_side, source, raw, created_at, group_id, mode)
select s.new_id, g.lcu_game_id + 900000000000, null, '00000000-0000-0000-0000-0000000000aa',
       g.started_at - interval '1 year', g.duration_s, g.winning_side, g.source, g.raw, g.created_at, g.group_id, g.mode
from public.games g join src s on s.old_id = g.id;

insert into public.game_players
select (jsonb_populate_record(gp, jsonb_build_object('game_id', s.new_id))).*
from public.game_players gp join src s on s.old_id = gp.game_id;

insert into public.daily_mysteries (day, challenge_number, game_id, mystery_player_id, interesting_score, category,
  suspect_ids, hook, active_from, expires_at, kind, group_id)
select d.day - 365, d.challenge_number + 100, (select new_id from src limit 1), gp.player_id, d.interesting_score,
       d.category, d.suspect_ids, d.hook, d.active_from - interval '1 year', d.expires_at - interval '1 year', d.kind, d.group_id
from public.daily_mysteries d
cross join lateral (select player_id from public.game_players where game_id = (select new_id from src limit 1) limit 1) gp
limit 1;

insert into public.daily_mystery_attempts (challenge_id, visitor_id, guessed_player_id, correct, clues_used, completion_time_ms)
select d.id, 'throwaway-visitor', d.mystery_player_id, true, 1, 1000
from public.daily_mysteries d where d.challenge_number > 100;

insert into public.ratings (player_id, season_id, mu, sigma, games, wins, group_id)
select player_id, '00000000-0000-0000-0000-0000000000aa', mu + 1, sigma, games, wins, group_id from public.ratings;
commit;
