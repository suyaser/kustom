-- 0027_ratings_reset.sql (M14.18)
--
-- The owner's `Reset ratings` (STRATEGY §3.6): one per-group epoch, never per person, no archive.
-- Written for the schema after 0026 (no seasons; `ratings_pkey (group_id, player_id)`), and it
-- touches nothing 0026 changes, so it applies the same on a database still before 0026.
--
--   groups.ratings_since   null until the group's first reset, then the moment of the latest one.
--                          The live fold rates only games with `started_at >= ratings_since`, and
--                          `rebuild-ratings --group` folds only those, from seeds. Games before it
--                          keep their stored rating columns (history is untouched), the weekly
--                          rating ignores it (it restarts every Sunday anyway), calibration keeps
--                          every game.
--   groups_public          gains `ratings_since`, so the board's `Since <date>` reads it with
--                          the anon key. Still no `created_by`.
--   reset_group_ratings()  the reset, atomically, under the group's row lock:
--                            - the actor must be the group's owner (re-checked here, whatever the
--                              route already checked);
--                            - refused while a lobby of the group is live (open, balanced,
--                              in_game) or a game of the group landed in the last 15 minutes --
--                              the `rebuild-ratings` guard;
--                            - sets `ratings_since = p_now` and deletes the group's `ratings`
--                              rows. No row is the fold's own "start from the seed" state (M5.7,
--                              `provisionalSeed()`, 1200 for everyone since 2026-09-16), so the
--                              seed constants stay in packages/core and are not copied into SQL,
--                              and a rebuild from scratch after the reset reproduces exactly what
--                              the live fold does. Only this group's rows; nothing else moves.
--
--   Returns 'ok' | 'not_found' (no such group) | 'forbidden' (actor is not a member with admin or
--   owner) | 'owner_only' (an admin) | 'busy' (live lobby or a game in the last 15 minutes).
--
-- RLS and grants: `groups` stays service-role only; the function is service-role only, like every
-- other definer function here. Realtime: `ratings` is published, so the deletes are delivered as
-- DELETE events to open pages, which refetch.
--
-- One explicit transaction: the Supabase CLI applies a file statement by statement with no
-- enclosing transaction, and this file must be all-or-nothing.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

alter table public.groups add column ratings_since timestamptz;

comment on column public.groups.ratings_since is
  'M14.18: the moment of the group''s latest Reset ratings, or null. The live fold and rebuild-ratings count only games with started_at >= this; games before it keep their stored rating columns.';

create or replace view public.groups_public as
select id, slug, name, ratings_since
from public.groups;

comment on view public.groups_public is
  'groups without created_by. This is what anon and the web client read; the base table is service-role only. ratings_since (M14.18) is public: the board prints Since <date>.';

-- ---------------------------------------------------------------------------
-- reset_group_ratings
-- ---------------------------------------------------------------------------

create function public.reset_group_ratings(
  p_group_id uuid,
  p_actor_id uuid,
  p_now      timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    return 'not_found';
  end if;

  select role into v_role
  from public.group_memberships
  where group_id = p_group_id and player_id = p_actor_id;
  if not found or v_role not in ('owner', 'admin') then
    return 'forbidden';
  end if;
  if v_role <> 'owner' then
    return 'owner_only';
  end if;

  if exists (
    select 1 from public.lobbies
    where group_id = p_group_id and status in ('open', 'balanced', 'in_game')
  ) or exists (
    select 1 from public.games
    where group_id = p_group_id and created_at >= p_now - interval '15 minutes'
  ) then
    return 'busy';
  end if;

  update public.groups set ratings_since = p_now where id = p_group_id;
  delete from public.ratings where group_id = p_group_id;

  return 'ok';
end;
$$;

comment on function public.reset_group_ratings(uuid, uuid, timestamptz) is
  'M14.18: the owner resets the group''s ratings -- sets groups.ratings_since and deletes the group''s ratings rows (everyone back to the seed). Refused while a lobby is live or a game landed in the last 15 minutes. Returns ok | not_found | forbidden | owner_only | busy. Locks the group row. Service role only.';

revoke all on function public.reset_group_ratings(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reset_group_ratings(uuid, uuid, timestamptz) to service_role;

commit;
