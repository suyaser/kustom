-- 0026_remove_seasons.sql (M14.14)
--
-- Seasons are legacy (the user, 2026-10-03: "remove seasons, I don't care about old seasons, I care
-- about the current one that has data"). Every row of the ACTIVE season is kept; rows of any other
-- season are deleted; then the season key goes from the schema. Preview the counts first with
-- `packages/db/scripts/m14-14-season-drop-counts.sql` (read-only) -- on hosted too, before deploy.
--
-- What this deletes, and why, in this order:
--   1. daily_mysteries whose game is not in the active season. Their key to `games` is ON DELETE
--      RESTRICT (0013), so they must go before the games. Their clues, sessions and attempts go with
--      them by ON DELETE CASCADE (0013).
--   2. games not in the active season. Their game_players go with them by ON DELETE CASCADE
--      (game_players_game_group_fkey, 0018). `games -> seasons` is NO ACTION, hence games before
--      seasons.
--   3. ratings not in the active season (explicitly; the FK would cascade them anyway in step 6).
--   Nothing else references games, game_players, ratings or seasons (checked against pg_constraint
--   at 0025).
--
-- Then the schema, in a safe order:
--   4. games.season_id: default, index and column (the FK goes with the column). A
--      (group_id, started_at desc) index replaces games_season_started_at_idx: every reader that
--      filtered on season then started_at now filters on group then started_at.
--   5. ratings: the primary key is rebuilt as (group_id, player_id) in the same ALTER that drops
--      season_id, so the table is never left without one -- `ratings` is in the supabase_realtime
--      publication, and a published table with no primary key (replica identity default) refuses
--      every UPDATE (see 0019). A (group_id, ordinal desc) index replaces ratings_season_ordinal_idx.
--      After step 3 there is at most one row per (group_id, player_id), so the new key cannot clash.
--   6. start_season(text) and set_active_season(uuid) (both return public.seasons, so they go before
--      the table), active_season_id(), then the seasons table with its RLS policy and indexes.
--
-- Unchanged: RLS on games and ratings and their public-read policies, every grant on both tables,
-- the supabase_realtime publication (it lists the tables without a column list, so the dropped
-- columns simply stop being sent), the games_stamp_mode and ratings_set_updated_at triggers.
--
-- A guard aborts the whole migration unless exactly one season is active.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- ---------------------------------------------------------------------------
-- Guard and locks
--
-- One explicit transaction: the Supabase CLI applies a migration file statement by statement
-- with no enclosing transaction (`LOCK TABLE can only be used in transaction blocks`, seen on a
-- throwaway stack), and this file must be all-or-nothing.
-- ---------------------------------------------------------------------------

begin;

lock table public.seasons, public.games, public.ratings in access exclusive mode;

do $$
declare
  v_active integer;
begin
  select count(*) into v_active from public.seasons where is_active;
  if v_active <> 1 then
    raise exception '0026_remove_seasons: expected exactly one active season, found %. Nothing was changed.', v_active;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1-3. Delete every row that belongs to a non-active season
-- ---------------------------------------------------------------------------

delete from public.daily_mysteries d
using public.games g
where g.id = d.game_id
  and g.season_id <> (select id from public.seasons where is_active);

delete from public.games
where season_id <> (select id from public.seasons where is_active);

delete from public.ratings
where season_id <> (select id from public.seasons where is_active);

-- ---------------------------------------------------------------------------
-- 4. games.season_id
-- ---------------------------------------------------------------------------

alter table public.games alter column season_id drop default;
drop index public.games_season_started_at_idx;
alter table public.games drop column season_id;

create index games_group_started_at_idx on public.games (group_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 5. ratings: one row per person per group
-- ---------------------------------------------------------------------------

drop index public.ratings_season_ordinal_idx;

alter table public.ratings
  drop constraint ratings_pkey,
  drop column season_id,
  add constraint ratings_pkey primary key (group_id, player_id);

create index ratings_group_ordinal_idx on public.ratings (group_id, ordinal desc);

comment on table public.ratings is
  'OpenSkill rating per player per group (M13; seasons removed in M14.14). Balance on mu, leaderboard on ordinal.';

-- ---------------------------------------------------------------------------
-- 6. Season functions and the seasons table
-- ---------------------------------------------------------------------------

drop function public.start_season(text);
drop function public.set_active_season(uuid);
drop function public.active_season_id();

drop table public.seasons;

commit;
