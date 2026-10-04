-- 0035_region_no_draw.sql (M15.17)
--
-- A region wars game that could not be drawn is named as such. At Roll, region wars draws two
-- regions with at least 8 open champions (Fearless counted); with fewer than two, core's
-- `lockAtRoll` locks the standing mode and the game is played as that, not rated by region wars'
-- default. Until now nothing remembered that region wars was attempted, so admin Recording read
-- `No · Rated was off` and the teams post `This game: not rated.`
--
-- Shape: one flag beside the lock and one beside the stamp. Extends 0032, never reshapes it.
--
--   lobbies.lock_no_draw  true when the lock was taken for a pending region wars that could not be
--                         drawn (the lock is the standing mode, lock_rule null). Part of the lock:
--                         false with no lock, dropped with the teams by lobbies_drop_mode_lock.
--                         Granted to anon like the other lock columns (0032's rule: a lock column
--                         with no grant must never exist).
--   games.rule_no_draw    stamped from the lobby's lock at record: the game was meant to be region
--                         wars and was played as the standing mode (rule null).
--
-- Every existing row reads false, which is what they were: no game before this migration was a
-- region wars no-draw that anything could tell apart.

begin;

alter table public.lobbies
  add column lock_no_draw boolean not null default false;

alter table public.lobbies
  add constraint lobbies_lock_no_draw check (not lock_no_draw or (lock_mode is not null and lock_rule is null));

comment on column public.lobbies.lock_no_draw is
  'M15.17 (0035): true when region wars was pending at Roll and could not be drawn (fewer than two regions with 8 open); the lock is then the standing mode with lock_rule null. False with no lock.';

grant select (lock_no_draw) on public.lobbies to anon, authenticated;

create or replace function public.lobbies_drop_mode_lock() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'balanced' and new.status = 'open' then
    new.lock_mode := null;
    new.lock_rule := null;
    new.lock_class_tag := null;
    new.lock_region_blue := null;
    new.lock_region_red := null;
    new.lock_rated := null;
    new.lock_version := null;
    new.locked_at := null;
    new.lock_no_draw := false;
  end if;
  return new;
end;
$$;

comment on function public.lobbies_drop_mode_lock() is
  'M15.3 (0032), M15.17 (0035): clears the lobby''s mode lock, lock_no_draw included, when it goes balanced -> open (the teams came down). Trigger only.';

revoke all on function public.lobbies_drop_mode_lock() from public, anon, authenticated;

alter table public.games
  add column rule_no_draw boolean not null default false;

alter table public.games
  add constraint games_rule_no_draw check (not rule_no_draw or rule is null);

comment on column public.games.rule_no_draw is
  'M15.17 (0035): the game''s lobby locked a region wars that could not be drawn, so it was played as the standing mode (rule null). Stamped from lobbies.lock_no_draw at record.';

commit;
