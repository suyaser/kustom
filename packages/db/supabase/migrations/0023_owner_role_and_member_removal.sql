-- 0023_owner_role_and_member_removal.sql (M14.11)
--
-- The `owner` role and removing a member (`redesign/STRATEGY.md` §3.5; `04-decisions.md`,
-- 2026-10-03: exactly one owner per group; removal is not a ban; `customs`'s owner is the
-- bootstrap admin).
--
--   group_memberships.role   widens to owner | admin | member. A partial unique index allows at
--                            most one `owner` per group, so "exactly one owner" can never become
--                            two, whoever writes.
--   backfill                 every group with a `created_by` gets that auth user's linked player
--                            as its owner. The original group (`customs`, `created_by` null) gets
--                            its owner from `bootstrap_admin` (below), not from a literal here.
--   bootstrap_admin          makes the `BOOTSTRAP_ADMIN_PUUID` player the owner of `customs` while
--                            `customs` has no owner, and otherwise leaves every membership alone
--                            (it no longer forces `admin`, which would demote an owner on every
--                            cold start). The app calls it on the first admin or companion request
--                            of every process, so the first request after this migration settles
--                            `customs`'s owner from the deployment's own environment.
--   create_group             a linked creator's membership is `owner` (was `admin`).
--   redeem_pairing_code      the creator's pairing makes them `owner` while the group has none
--                            (was: always raised to `admin`). Anyone else keeps their role.
--
-- Three locked definer functions, each the whole of one write, each re-checking the actor's own
-- role under the group's row lock (the route's gate checked it too; this is what makes two
-- presses in the same second safe):
--
--   set_group_member_role_v2(group, actor, player, role)   replaces `set_group_member_role`.
--   transfer_group_ownership(group, actor, player)         the owner hands the group to an admin.
--   remove_group_member(group, actor, player)              deletes the membership and revokes the
--                                                          player's companion tokens in that group.
--
-- `set_group_member_role` (0020) is dropped: it knows nothing of `owner`, and left in place it
-- would let an admin turn the owner into an admin and leave the group with none.
--
-- **A group with no owner** (the original group until `bootstrap_admin` runs; a group whose
-- creator has never paired) keeps M13.4's rules: its admins promote, demote and remove admins, and
-- its last admin can be neither demoted nor removed. The owner-only rules apply once it has one.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- ---------------------------------------------------------------------------
-- group_memberships.role: owner | admin | member, at most one owner per group
-- ---------------------------------------------------------------------------

alter table public.group_memberships drop constraint group_memberships_role_check;
alter table public.group_memberships
  add constraint group_memberships_role_check check (role in ('owner', 'admin', 'member'));

create unique index group_memberships_one_owner_idx
  on public.group_memberships (group_id)
  where role = 'owner';

comment on index public.group_memberships_one_owner_idx is
  'M14.11: at most one owner per group. Ownership moves only through transfer_group_ownership.';
comment on column public.group_memberships.role is
  'owner | admin | member (M14.11). One owner per group (group_memberships_one_owner_idx); the owner can be neither demoted nor removed, only replaced by transfer_group_ownership. A group with no owner can never be left with no admin.';

-- ---------------------------------------------------------------------------
-- Backfill: a self-serve group's owner is its creator's linked player
--
-- `groups.created_by` is an auth user; its Discord identity's `provider_id` is the snowflake on
-- `players.discord_id` (the same join as `current_player_id()`, 0022). A creator who is linked but
-- somehow has no membership gets one. A creator who never linked gets nothing here: their group
-- keeps its admins, and their first pairing makes them the owner (`redeem_pairing_code` below).
-- The original group has `created_by` null and is not touched by this statement.
-- ---------------------------------------------------------------------------

insert into public.group_memberships (group_id, player_id, role)
select g.id, p.id, 'owner'
from public.groups g
join auth.identities i on i.user_id = g.created_by and i.provider = 'discord'
join public.players p on p.discord_id = i.provider_id
where g.created_by is not null
on conflict (group_id, player_id) do update set role = 'owner';

-- ---------------------------------------------------------------------------
-- bootstrap_admin, new body
--
-- Insert-or-flag the player exactly as before. Then, under the original group's row lock: if the
-- original group has no owner, this player becomes it (their membership inserted or raised).
-- If it has one -- this player or anybody they handed it to -- nothing about any membership
-- changes. The env variable stops overriding the group's own decisions the moment there is an
-- owner to make them. Still idempotent; the return type is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_admin(p_puuid text) returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  if p_puuid is null or length(p_puuid) = 0 then
    raise exception 'bootstrap_admin: puuid is required';
  end if;

  insert into public.players (puuid, is_admin)
  values (p_puuid, true)
  on conflict (puuid) do update set is_admin = true
  returning * into v_player;

  perform 1 from public.groups where id = '00000000-0000-0000-0000-000000000001' for update;

  if not exists (
    select 1 from public.group_memberships
    where group_id = '00000000-0000-0000-0000-000000000001' and role = 'owner'
  ) then
    insert into public.group_memberships (group_id, player_id, role)
    values ('00000000-0000-0000-0000-000000000001', v_player.id, 'owner')
    on conflict (group_id, player_id) do update set role = 'owner';
  end if;

  return v_player;
end;
$$;

comment on function public.bootstrap_admin(text) is
  'Insert-or-flag the player with this PUUID, and make them the owner of the original group while it has none (M14.11). Never changes a membership once the group has an owner. Idempotent. Service role only.';

revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_admin(text) to service_role;

-- ---------------------------------------------------------------------------
-- create_group: a linked creator is the owner
--
-- Same body as 0021 but for the role. A brand-new group has no other membership, so the index
-- cannot refuse it.
-- ---------------------------------------------------------------------------

create or replace function public.create_group(
  p_slug       text,
  p_name       text,
  p_created_by uuid,
  p_player_id  uuid
)
returns table (outcome text, group_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  begin
    insert into public.groups (slug, name, created_by)
    values (p_slug, btrim(p_name), p_created_by)
    returning id into v_id;
  exception
    when unique_violation then
      return query select 'slug_taken'::text, null::uuid;
      return;
    when check_violation then
      return query select 'invalid'::text, null::uuid;
      return;
  end;

  insert into public.fearless_state (group_id) values (v_id);

  insert into public.group_invites (group_id, code, rotated_by)
  values (v_id, public.new_invite_code(), p_created_by);

  if p_player_id is not null then
    insert into public.group_memberships (group_id, player_id, role)
    values (v_id, p_player_id, 'owner');
  end if;

  return query select 'ok'::text, v_id;
end;
$$;

comment on function public.create_group(text, text, uuid, uuid) is
  'M13.5, owner since M14.11: a new group with its fearless cursor, its invite and (for a linked creator) their owner membership, in one transaction. Returns (ok | slug_taken | invalid, group_id). Service role only.';

revoke all on function public.create_group(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_group(text, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- redeem_pairing_code: the creator's pairing makes them owner while the group has none
--
-- Same body as 0021 up to the membership. The group row is now locked (`for update`), which
-- serializes this with the three role functions below, so "has no owner" is still true when the
-- insert lands. The creator becomes `owner` only while the group has no owner: a creator who
-- handed ownership on, or was removed after handing it on, is not raised again. Everyone else is
-- inserted as `member` and an existing membership keeps its role.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_pairing_code(p_code_hash text, p_puuid text)
returns table (outcome text, group_id uuid, linked_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code       public.pairing_codes;
  v_created_by uuid;
  v_owner      public.players;
  v_player     public.players;
  v_role       text;
begin
  if p_puuid is null or length(btrim(p_puuid)) = 0 then
    raise exception 'redeem_pairing_code: puuid is required';
  end if;

  select * into v_code from public.pairing_codes where code_hash = p_code_hash for update;
  if not found then
    return query select 'unknown'::text, null::uuid, null::text;
    return;
  end if;

  if v_code.used_at is not null or v_code.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::text;
    return;
  end if;

  select * into v_owner from public.players where discord_id = v_code.discord_id;
  if found and v_owner.puuid <> p_puuid then
    return query select 'discord_linked'::text, null::uuid, coalesce(v_owner.display_name, v_owner.game_name);
    return;
  end if;

  insert into public.players (puuid) values (p_puuid) on conflict (puuid) do nothing;
  select * into v_player from public.players where puuid = p_puuid for update;

  if v_player.discord_id is not null and v_player.discord_id <> v_code.discord_id then
    return query select 'puuid_linked'::text, null::uuid, null::text;
    return;
  end if;

  if v_player.discord_id is null then
    begin
      update public.players set discord_id = v_code.discord_id where id = v_player.id;
    exception
      when unique_violation then
        select * into v_owner from public.players where discord_id = v_code.discord_id;
        return query select 'discord_linked'::text, null::uuid, coalesce(v_owner.display_name, v_owner.game_name);
        return;
    end;
  end if;

  select g.created_by into v_created_by from public.groups g where g.id = v_code.group_id for update;

  v_role := 'member';
  if v_created_by is not distinct from v_code.auth_user_id
     and not exists (
       select 1 from public.group_memberships m
       where m.group_id = v_code.group_id and m.role = 'owner'
     ) then
    v_role := 'owner';
  end if;

  insert into public.group_memberships (group_id, player_id, role)
  values (v_code.group_id, v_player.id, v_role)
  on conflict on constraint group_memberships_pkey do update
    set role = 'owner'
    where excluded.role = 'owner';

  update public.pairing_codes set used_at = now() where code_hash = p_code_hash;

  return query select 'ok'::text, v_code.group_id, null::text;
end;
$$;

comment on function public.redeem_pairing_code(text, text) is
  'M13.5, owner since M14.11: POST /api/companion/pair after the rate limit. Links the code''s Discord account to the PUUID, adds the membership (owner for the group''s creator while the group has none), uses the code. Returns (ok | unknown | expired | discord_linked | puuid_linked, group_id, linked_name). Service role only.';

revoke all on function public.redeem_pairing_code(text, text) from public, anon, authenticated;
grant execute on function public.redeem_pairing_code(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- set_group_member_role_v2
--
-- Make a member an admin or an admin a member. Never touches ownership (that is
-- transfer_group_ownership). Answers one word, which the route turns into a status:
--
--   'ok'           the role changed
--   'unchanged'    it already was that role (a repeat press; nothing written)
--   'not_member'   no such group, or the player is not a member of it (404)
--   'forbidden'    the actor is not an admin or the owner of the group any more (403)
--   'owner_only'   demoting an admin, by an admin, in a group that has an owner (403)
--   'is_owner'     the player is the owner, who cannot be demoted (409)
--   'last_admin'   demoting the only admin of a group that has no owner (409)
--
-- An admin may step down themselves (actor = player): it uses no power over anybody else.
-- ---------------------------------------------------------------------------

drop function public.set_group_member_role(uuid, uuid, text);

create or replace function public.set_group_member_role_v2(
  p_group_id  uuid,
  p_actor_id  uuid,
  p_player_id uuid,
  p_role      text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   text;
  v_current text;
  v_admins  integer;
begin
  if p_role is null or p_role not in ('member', 'admin') then
    raise exception 'set_group_member_role_v2: role must be member or admin';
  end if;

  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    return 'not_member';
  end if;

  select role into v_actor
  from public.group_memberships
  where group_id = p_group_id and player_id = p_actor_id;
  if not found or v_actor not in ('owner', 'admin') then
    return 'forbidden';
  end if;

  select role into v_current
  from public.group_memberships
  where group_id = p_group_id and player_id = p_player_id
  for update;
  if not found then
    return 'not_member';
  end if;

  if v_current = 'owner' then
    return 'is_owner';
  end if;

  if v_current = p_role then
    return 'unchanged';
  end if;

  if v_current = 'admin' and p_role = 'member' then
    if exists (
      select 1 from public.group_memberships
      where group_id = p_group_id and role = 'owner'
    ) then
      if v_actor <> 'owner' and p_actor_id <> p_player_id then
        return 'owner_only';
      end if;
    else
      select count(*) into v_admins
      from public.group_memberships
      where group_id = p_group_id and role = 'admin';
      if v_admins <= 1 then
        return 'last_admin';
      end if;
    end if;
  end if;

  update public.group_memberships
  set role = p_role
  where group_id = p_group_id and player_id = p_player_id;

  return 'ok';
end;
$$;

comment on function public.set_group_member_role_v2(uuid, uuid, uuid, text) is
  'M14.11: promote a member to admin (any admin or the owner) or demote an admin (the owner, or the admin themselves). Never touches the owner. Returns ok | unchanged | not_member | forbidden | owner_only | is_owner | last_admin. Locks the group row. Service role only.';

revoke all on function public.set_group_member_role_v2(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_group_member_role_v2(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- transfer_group_ownership
--
-- The owner hands the group to one of its admins; the old owner stays an admin. The old owner is
-- demoted before the new one is raised, so the one-owner index never sees two.
--
--   'ok'           done
--   'unchanged'    the owner named themselves
--   'not_member'   no such group, or the player is not a member of it (404)
--   'owner_only'   the actor is not the owner (403)
--   'not_admin'    the player is a member, not an admin: promote them first (409)
-- ---------------------------------------------------------------------------

create or replace function public.transfer_group_ownership(
  p_group_id  uuid,
  p_actor_id  uuid,
  p_player_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  text;
  v_target text;
begin
  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    return 'not_member';
  end if;

  select role into v_actor
  from public.group_memberships
  where group_id = p_group_id and player_id = p_actor_id
  for update;
  if not found or v_actor <> 'owner' then
    return 'owner_only';
  end if;

  if p_player_id = p_actor_id then
    return 'unchanged';
  end if;

  select role into v_target
  from public.group_memberships
  where group_id = p_group_id and player_id = p_player_id
  for update;
  if not found then
    return 'not_member';
  end if;

  if v_target <> 'admin' then
    return 'not_admin';
  end if;

  update public.group_memberships
  set role = 'admin'
  where group_id = p_group_id and player_id = p_actor_id;

  update public.group_memberships
  set role = 'owner'
  where group_id = p_group_id and player_id = p_player_id;

  return 'ok';
end;
$$;

comment on function public.transfer_group_ownership(uuid, uuid, uuid) is
  'M14.11: the owner hands the group to one of its admins and stays an admin. Returns ok | unchanged | not_member | owner_only | not_admin. Locks the group row. Service role only.';

revoke all on function public.transfer_group_ownership(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- remove_group_member
--
-- Deletes the membership and revokes every live companion token the player holds **in this
-- group** (their tokens in other groups are untouched). Their `ratings` row, their games and the
-- names on them stay: removal is not a ban, and M13.3's playing-is-joining rule re-adds them as a
-- `member`, with that rating, the next time they are in one of the group's lobbies.
--
--   'ok'           removed
--   'not_member'   no such group, or the player is not a member of it (404; a repeat press)
--   'forbidden'    the actor is not an admin or the owner of the group any more (403)
--   'owner_only'   removing an admin, by an admin, in a group that has an owner (403)
--   'is_owner'     the player is the owner (409)
--   'last_admin'   removing the only admin of a group that has no owner (409)
-- ---------------------------------------------------------------------------

create or replace function public.remove_group_member(
  p_group_id  uuid,
  p_actor_id  uuid,
  p_player_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  text;
  v_target text;
  v_admins integer;
begin
  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    return 'not_member';
  end if;

  select role into v_actor
  from public.group_memberships
  where group_id = p_group_id and player_id = p_actor_id;
  if not found or v_actor not in ('owner', 'admin') then
    return 'forbidden';
  end if;

  select role into v_target
  from public.group_memberships
  where group_id = p_group_id and player_id = p_player_id
  for update;
  if not found then
    return 'not_member';
  end if;

  if v_target = 'owner' then
    return 'is_owner';
  end if;

  if v_target = 'admin' then
    if exists (
      select 1 from public.group_memberships
      where group_id = p_group_id and role = 'owner'
    ) then
      if v_actor <> 'owner' then
        return 'owner_only';
      end if;
    else
      select count(*) into v_admins
      from public.group_memberships
      where group_id = p_group_id and role = 'admin';
      if v_admins <= 1 then
        return 'last_admin';
      end if;
    end if;
  end if;

  delete from public.group_memberships
  where group_id = p_group_id and player_id = p_player_id;

  update public.companion_tokens
  set revoked_at = now()
  where group_id = p_group_id and player_id = p_player_id and revoked_at is null;

  return 'ok';
end;
$$;

comment on function public.remove_group_member(uuid, uuid, uuid) is
  'M14.11: remove a player from a group -- admins remove members, the owner removes admins, nobody removes the owner. Revokes their companion tokens in that group; keeps their ratings and games. Returns ok | not_member | forbidden | owner_only | is_owner | last_admin. Locks the group row. Service role only.';

revoke all on function public.remove_group_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_group_member(uuid, uuid, uuid) to service_role;
