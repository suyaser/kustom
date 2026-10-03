-- 0021_invites_and_pairing.sql (M13.5)
--
-- Creating a group, its one invite link, and pairing a Discord session to the PUUID a Kustom on
-- somebody's PC reads from League (`04-decisions.md`, 2026-10-03: "Self-serve groups" and
-- "Joining links a PUUID by pairing through Kustom, not by typing").
--
--   group_invites      one live invite code per group, the `/join/<code>` link. Stored as is: an
--                      admin pastes it into a group chat and must be able to see it again.
--   pairing_codes      the six-character code the join page shows and Kustom sends back with a
--                      PUUID. Stored hashed like a companion token, 15 minutes, single use.
--   pairing_attempts   the per-IP rate limit on `POST /api/companion/pair`, the one companion
--                      route with no token (10 a minute). A table and not process memory, because
--                      every Vercel instance has its own memory and a limit that resets per
--                      instance is no limit.
--
-- Five functions, each the whole of one write so its rules hold under concurrency:
--
--   new_invite_code()                 22 url-safe characters from 128 random bits.
--   create_group(...)                 the group, its fearless cursor, its invite and (when the
--                                     creator is already linked) their admin membership, or
--                                     `slug_taken`. One transaction, so a group never exists
--                                     without its cursor or its invite.
--   rotate_group_invite(...)          replaces the code (the old link stops) and expires every
--                                     unused pairing code a non-creator got through it.
--   redeem_pairing_code(...)          the whole of `POST /api/companion/pair` after the rate
--                                     limit: checks, link, membership, used, under a row lock.
--   pairing_attempt(...)              the rate limit itself.
--
-- All five are service role only. All three tables: RLS on, no policy, no grant to anon or
-- authenticated -- nothing here is public.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- ---------------------------------------------------------------------------
-- new_invite_code
--
-- 16 bytes of `gen_random_uuid()` (122 random bits from pg_strong_random, with the version and
-- variant nibbles fixed) as unpadded base64url: exactly 22 characters of [A-Za-z0-9_-]. Not
-- pgcrypto's `gen_random_bytes`: that lives in the `extensions` schema on Supabase and this file
-- runs with an empty search path.
-- ---------------------------------------------------------------------------

create or replace function public.new_invite_code() returns text
language sql
volatile
set search_path = ''
as $$
  select translate(
    rtrim(encode(decode(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='),
    '+/',
    '-_'
  );
$$;

comment on function public.new_invite_code() is
  'M13.5: a fresh /join/<code> code, 22 url-safe characters. Service role only.';

revoke all on function public.new_invite_code() from public, anon, authenticated;
grant execute on function public.new_invite_code() to service_role;

-- ---------------------------------------------------------------------------
-- group_invites
-- ---------------------------------------------------------------------------

create table public.group_invites (
  group_id   uuid        primary key references public.groups (id) on delete cascade,
  code       text        not null unique,
  rotated_at timestamptz not null default now(),
  rotated_by uuid        references auth.users (id) on delete set null,
  constraint group_invites_code_shape check (code ~ '^[A-Za-z0-9_-]{22}$')
);

comment on table public.group_invites is
  'M13.5: the one live invite code per group (/join/<code>). Stored as is so an admin can see it again. Rotating replaces it and the old link stops. Service role only.';
comment on column public.group_invites.rotated_at is
  'When this code was made: at creation, or by the last rotation.';
comment on column public.group_invites.rotated_by is
  'The auth user who made this code (the creator, or the admin who rotated it), or null for a backfilled one.';

-- Every group that exists already gets its invite: the original group, and whatever test groups a
-- local stack holds. M13.14's invite card has a code to show from the first day.
insert into public.group_invites (group_id, code)
select g.id, public.new_invite_code()
from public.groups g
on conflict (group_id) do nothing;

-- ---------------------------------------------------------------------------
-- pairing_codes
--
-- `discord_id` is the issuing session's Discord snowflake, copied from the verified identity when
-- the code is issued, so the redeeming request -- which has no session, only the code -- knows
-- which Discord account to link without a call to the auth admin API.
--
-- `auth_user_id` is what makes a code the session's: a new code for the same session and group
-- replaces the old one, and the page's status poll only sees its own codes.
-- ---------------------------------------------------------------------------

create table public.pairing_codes (
  code_hash    text        primary key,
  group_id     uuid        not null references public.groups (id) on delete cascade,
  auth_user_id uuid        not null references auth.users (id) on delete cascade,
  discord_id   text        not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  constraint pairing_codes_hash_shape check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint pairing_codes_discord_id_not_blank check (length(discord_id) > 0)
);

create index pairing_codes_session_group_idx on public.pairing_codes (auth_user_id, group_id);
create index pairing_codes_expires_at_idx on public.pairing_codes (expires_at);

comment on table public.pairing_codes is
  'M13.5: six-character pairing codes, SHA-256 hex of the code, 15 minutes, single use. Kustom sends one with the PUUID it reads from League; the server links the issuing Discord session to that PUUID. Service role only.';
comment on column public.pairing_codes.discord_id is
  'The issuing session''s Discord snowflake, from its verified identity (never user metadata).';
comment on column public.pairing_codes.used_at is
  'Set when Kustom redeemed it. A used code is refused with 410, like an expired one.';

-- ---------------------------------------------------------------------------
-- pairing_attempts
--
-- One row per `POST /api/companion/pair`, refused or not. `ip_hash` is the SHA-256 of the
-- caller's address: the limit needs to recognise an address, not to know it. Rows older than an
-- hour are deleted by `pairing_attempt` itself.
-- ---------------------------------------------------------------------------

create table public.pairing_attempts (
  id           bigint      generated always as identity primary key,
  ip_hash      text        not null,
  attempted_at timestamptz not null default now()
);

create index pairing_attempts_ip_hash_attempted_at_idx on public.pairing_attempts (ip_hash, attempted_at);
create index pairing_attempts_attempted_at_idx on public.pairing_attempts (attempted_at);

comment on table public.pairing_attempts is
  'M13.5: the per-IP rate limit on POST /api/companion/pair (no token). ip_hash is SHA-256 of the address. Pruned after an hour. Service role only.';

-- ---------------------------------------------------------------------------
-- create_group
--
-- Answers one row, `(outcome, group_id)`:
--
--   ('ok', id)              the group, its fearless cursor (reset now, so a new group's pool
--                           starts empty), its invite and -- when `p_player_id` is given -- the
--                           creator's `admin` membership exist
--   ('slug_taken', null)    another group has that slug; nothing written
--   ('invalid', null)       a check refused the slug or the name; nothing written (the route
--                           validates both first, so this is the backstop)
--
-- The name is stored trimmed. The slug is stored exactly as given: the database never rewrites
-- one.
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
    values (v_id, p_player_id, 'admin');
  end if;

  return query select 'ok'::text, v_id;
end;
$$;

comment on function public.create_group(text, text, uuid, uuid) is
  'M13.5: a new group with its fearless cursor, its invite and (for a linked creator) their admin membership, in one transaction. Returns (ok | slug_taken | invalid, group_id). Service role only.';

revoke all on function public.create_group(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_group(text, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- rotate_group_invite
--
-- Replaces the group's code (inserting one if the group somehow has none) and answers the new
-- code, or null for a group that does not exist. The old link stops at once.
--
-- It also expires every **unused** pairing code of the group issued to anyone but the group's
-- creator: a code got through the old link would otherwise keep working for up to 15 minutes
-- after an admin rotated the link precisely to stop it. Expired rather than deleted, so Kustom
-- answers `That code ran out.` and the page's poll reads `expired`, instead of a code that
-- suddenly "doesn't match". The creator's own codes stay, because the creator never needed the
-- link to get one.
-- ---------------------------------------------------------------------------

create or replace function public.rotate_group_invite(p_group_id uuid, p_rotated_by uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created_by uuid;
  v_code       text;
begin
  select created_by into v_created_by from public.groups where id = p_group_id for update;
  if not found then
    return null;
  end if;

  v_code := public.new_invite_code();

  insert into public.group_invites (group_id, code, rotated_at, rotated_by)
  values (p_group_id, v_code, now(), p_rotated_by)
  on conflict (group_id) do update
    set code = excluded.code, rotated_at = excluded.rotated_at, rotated_by = excluded.rotated_by;

  update public.pairing_codes pc
  set expires_at = least(pc.expires_at, now())
  where pc.group_id = p_group_id
    and pc.used_at is null
    and pc.auth_user_id is distinct from v_created_by;

  return v_code;
end;
$$;

comment on function public.rotate_group_invite(uuid, uuid) is
  'M13.5: a new invite code for the group (the old link stops) and every unused pairing code a non-creator got through it expired. Returns the code, or null for no such group. Service role only.';

revoke all on function public.rotate_group_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rotate_group_invite(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- redeem_pairing_code
--
-- Answers one row, `(outcome, group_id, linked_name)`:
--
--   ('ok', group, null)                the PUUID's `players` row exists (inserted if new), carries
--                                      the code's Discord id, is a member of the code's group
--                                      (`admin` when the code's session created the group), and
--                                      the code is used
--   ('unknown', null, null)            no code with that hash
--   ('expired', null, null)            used, or past `expires_at`
--   ('discord_linked', null, name)     the code's Discord account is on another PUUID's row;
--                                      `name` is that row's display name or Riot name, may be null
--   ('puuid_linked', null, null)       the PUUID's row carries a different Discord id (M3.6's
--                                      never-steal rule)
--
-- A refusal writes nothing and does not use the code: the person can sign into the right League
-- account and type it again. A PUUID already a member keeps its role -- except that the group's
-- creator is always made `admin`, because that is what the creator's pairing is for and a group
-- with no admin cannot be run.
--
-- The code's row is locked first, so the same code redeemed twice at once is one success and one
-- `expired`. One Discord account racing two codes onto two PUUIDs is settled by
-- `players_discord_id_key`, answered as `discord_linked`.
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

  select g.created_by into v_created_by from public.groups g where g.id = v_code.group_id;
  v_role := case when v_created_by is not distinct from v_code.auth_user_id then 'admin' else 'member' end;

  insert into public.group_memberships (group_id, player_id, role)
  values (v_code.group_id, v_player.id, v_role)
  on conflict on constraint group_memberships_pkey do update
    set role = 'admin'
    where excluded.role = 'admin';

  update public.pairing_codes set used_at = now() where code_hash = p_code_hash;

  return query select 'ok'::text, v_code.group_id, null::text;
end;
$$;

comment on function public.redeem_pairing_code(text, text) is
  'M13.5: POST /api/companion/pair after the rate limit. Links the code''s Discord account to the PUUID, adds the membership, uses the code. Returns (ok | unknown | expired | discord_linked | puuid_linked, group_id, linked_name). Service role only.';

revoke all on function public.redeem_pairing_code(text, text) from public, anon, authenticated;
grant execute on function public.redeem_pairing_code(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- pairing_attempt
--
-- Records one attempt from `p_ip_hash` and answers whether it is within `p_limit` attempts in
-- the last `p_window_seconds` (this one included): the 11th in a minute with a limit of 10 is
-- false. A refused attempt is recorded too, so hammering keeps the address refused. A
-- transaction-scoped advisory lock on the address serializes its attempts, so ten parallel
-- requests cannot all read nine.
-- ---------------------------------------------------------------------------

create or replace function public.pairing_attempt(p_ip_hash text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pairing_attempt:' || p_ip_hash, 0));

  delete from public.pairing_attempts where attempted_at < now() - interval '1 hour';

  insert into public.pairing_attempts (ip_hash) values (p_ip_hash);

  select count(*) into v_count
  from public.pairing_attempts
  where ip_hash = p_ip_hash
    and attempted_at > now() - make_interval(secs => p_window_seconds);

  return v_count <= p_limit;
end;
$$;

comment on function public.pairing_attempt(text, integer, integer) is
  'M13.5: record a POST /api/companion/pair attempt from an address hash; true while within p_limit attempts in p_window_seconds. Service role only.';

revoke all on function public.pairing_attempt(text, integer, integer) from public, anon, authenticated;
grant execute on function public.pairing_attempt(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.group_invites enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.pairing_attempts enable row level security;

revoke all on public.group_invites from anon, authenticated;
revoke all on public.pairing_codes from anon, authenticated;
revoke all on public.pairing_attempts from anon, authenticated;
