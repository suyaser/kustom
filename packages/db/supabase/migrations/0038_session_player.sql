-- 0038_session_player.sql (verified session lookup, "option 4" of the M19.12 auth-claims research)
--
-- Numbered 0038 on purpose: 0036 is taken on branch kustom-rating (M18.4) and 0037 on branch
-- m19-9-live. This file depends on neither and on nothing after 0023 (the owner role).
--
-- One service-role-only lookup that replaces, on every signed-in render and every session route,
-- the chain GoTrue `getUser()` -> `players` by discord_id -> `group_memberships`. The web app first
-- verifies the access token's signature locally (`auth.getClaims()`, asymmetric project keys), then
-- calls this with the token's verified `sub` and `session_id`. Because it requires the session row,
-- revocation stays as immediate as `getUser()`: a signed-out session (rows deleted), a deleted, soft-
-- deleted or banned auth user, and an unlinked Discord identity all fail here at once, not when the
-- token expires.
--
-- Returns at most one row, and never an auth row:
--
--   no row                         the session is not live: no auth.sessions row with this id for
--                                  this user, past its not_after, the user banned or deleted, or
--                                  either argument null. The caller answers "signed out" (401).
--   discord_id null                a live session with no Discord identity (the operator, M14.19, may
--                                  sign in that way).
--   player_id null                 Discord linked to no player: M3.6's `That's me` case.
--   role null                      not a member of p_group_id, or no group asked.
--
-- discord_id is the one value read from auth.identities (provider = 'discord', provider_id: the
-- snowflake only an OAuth round trip can write). It is returned because the link and pairing writes
-- store it on players.discord_id, which is where every other gate already reads it. puuid and
-- display_name are the player row's own columns. No email, no metadata, no session or user columns.
--
-- security definer, owned by the migration role (postgres), which can select auth.sessions,
-- auth.identities and auth.users (checked locally; the hosted check is in
-- docs/runbooks/jwt-signing-keys.md). Executable by service_role only.

begin;

create function public.session_player(p_user_id uuid, p_session_id uuid, p_group_id uuid default null)
returns table (discord_id text, player_id uuid, puuid text, display_name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select u.id as user_id
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.id = p_session_id
      and s.user_id = p_user_id
      and (s.not_after is null or s.not_after > pg_catalog.now())
      and (u.banned_until is null or u.banned_until <= pg_catalog.now())
      and u.deleted_at is null
  ),
  discord as (
    select nullif(pg_catalog.btrim(i.provider_id), '') as provider_id
    from auth.identities i
    join live on live.user_id = i.user_id
    where i.provider = 'discord'
    order by i.created_at nulls last, i.id
    limit 1
  )
  select d.provider_id, p.id, p.puuid, p.display_name, m.role
  from live
  left join discord d on true
  left join public.players p on p.discord_id = d.provider_id
  left join public.group_memberships m on m.player_id = p.id and m.group_id = p_group_id
$$;

comment on function public.session_player(uuid, uuid, uuid) is
  '0038: the verified session lookup. Given a signature-verified access token''s sub and session_id, returns one row (discord_id, player_id, puuid, display_name, role in p_group_id) only while the auth.sessions row is live and the user is neither banned nor deleted; no row otherwise. Service role only.';

revoke all on function public.session_player(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.session_player(uuid, uuid, uuid) to service_role;

commit;
