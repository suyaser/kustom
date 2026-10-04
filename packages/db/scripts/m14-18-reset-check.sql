-- m14-18-reset-check.sql  (M14.18, THROWAWAY DATABASE ONLY, after 0026 and 0027)
--
-- Exercises reset_group_ratings() against a restore of the local stack, inside one transaction
-- that is rolled back. Every check raises on failure, so psql -v ON_ERROR_STOP=1 exits non-zero.
-- Run by m14-14-throwaway-check.sh when it is given 0027 and this file after 0026.
\set ON_ERROR_STOP 1
begin;

create temp table ctx as
select
  g.id as group_id,
  (select player_id from public.group_memberships where group_id = g.id and role = 'owner' limit 1) as owner_id,
  (select player_id from public.group_memberships where group_id = g.id and role = 'admin' limit 1) as admin_id,
  (select player_id from public.group_memberships where group_id = g.id and role = 'member' limit 1) as member_id,
  (select max(created_at) from public.games where group_id = g.id) as last_game_at,
  (select count(*) from public.ratings where group_id = g.id) as ratings_before
from public.groups g
where g.slug = 'customs';

-- A second group with one rating, which the reset must not touch.
insert into public.groups (id, slug, name) values ('00000000-0000-0000-0000-0000000000bb', 'reset-other', 'Other');
insert into public.ratings (group_id, player_id, mu, sigma, games, wins)
select '00000000-0000-0000-0000-0000000000bb', owner_id, 31.5, 4.25, 12, 7 from ctx;

do $$
declare
  c record;
  v text;
  v_lobby uuid;
begin
  select * into c from ctx;
  if c.owner_id is null or c.admin_id is null or c.member_id is null then
    raise exception 'fixture: customs needs an owner, an admin and a member';
  end if;
  if c.ratings_before = 0 then
    raise exception 'fixture: customs has no ratings to reset';
  end if;

  v := public.reset_group_ratings(gen_random_uuid(), c.owner_id, c.last_game_at + interval '1 hour');
  if v <> 'not_found' then raise exception 'no group: expected not_found, got %', v; end if;

  v := public.reset_group_ratings(c.group_id, gen_random_uuid(), c.last_game_at + interval '1 hour');
  if v <> 'forbidden' then raise exception 'stranger: expected forbidden, got %', v; end if;

  v := public.reset_group_ratings(c.group_id, c.member_id, c.last_game_at + interval '1 hour');
  if v <> 'forbidden' then raise exception 'member: expected forbidden, got %', v; end if;

  v := public.reset_group_ratings(c.group_id, c.admin_id, c.last_game_at + interval '1 hour');
  if v <> 'owner_only' then raise exception 'admin: expected owner_only, got %', v; end if;

  v := public.reset_group_ratings(c.group_id, c.owner_id, c.last_game_at + interval '5 minutes');
  if v <> 'busy' then raise exception 'game 5 minutes ago: expected busy, got %', v; end if;

  insert into public.lobbies (group_id, lcu_party_id, status)
  values (c.group_id, 'reset-check-party', 'balanced') returning id into v_lobby;
  v := public.reset_group_ratings(c.group_id, c.owner_id, c.last_game_at + interval '1 hour');
  if v <> 'busy' then raise exception 'live lobby: expected busy, got %', v; end if;
  delete from public.lobbies where id = v_lobby;

  if (select count(*) from public.ratings where group_id = c.group_id) <> c.ratings_before then
    raise exception 'a refused reset changed ratings';
  end if;
  if (select ratings_since from public.groups where id = c.group_id) is not null then
    raise exception 'a refused reset set ratings_since';
  end if;

  v := public.reset_group_ratings(c.group_id, c.owner_id, c.last_game_at + interval '1 hour');
  if v <> 'ok' then raise exception 'owner: expected ok, got %', v; end if;
  if (select count(*) from public.ratings where group_id = c.group_id) <> 0 then
    raise exception 'owner reset left ratings rows';
  end if;
  if (select ratings_since from public.groups where id = c.group_id) <> c.last_game_at + interval '1 hour' then
    raise exception 'owner reset did not set ratings_since';
  end if;
  if (select count(*) from public.ratings where group_id = '00000000-0000-0000-0000-0000000000bb' and mu = 31.5 and games = 12) <> 1 then
    raise exception 'the other group''s rating moved';
  end if;
  raise notice 'reset_group_ratings: not_found, forbidden x2, owner_only, busy x2, ok, other group untouched -- all as expected';
end;
$$;

-- anon reads the epoch through groups_public, and cannot call the function.
set local role anon;
select 'anon reads groups_public.ratings_since: ' || count(*) from public.groups_public where ratings_since is not null;
do $$
begin
  perform public.reset_group_ratings(gen_random_uuid(), gen_random_uuid(), now());
  raise exception 'anon could execute reset_group_ratings';
exception when insufficient_privilege then
  raise notice 'anon cannot execute reset_group_ratings -- as expected';
end;
$$;
reset role;

rollback;
