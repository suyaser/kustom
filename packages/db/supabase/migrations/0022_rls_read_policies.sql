-- 0022_rls_read_policies.sql (M14.5)
--
-- RLS **read** policies as defence in depth (`04-decisions.md`, 2026-10-03: "Security stays
-- route-enforced; RLS read policies are added as defence in depth"). Service-role route handlers
-- and the locked `security definer` functions stay the only enforcement point for writes. This
-- adds reads a signed-in session is allowed to make, so a leaked anon key or a future client-side
-- read cannot see what it should not:
--
--   group_memberships   a session reads its own rows (every group it is in, with its role); a
--                       group admin reads every row of that group.
--   group_invites       a group admin reads that group's invite. Nobody else.
--
-- anon gains nothing. No write is granted to anyone: the `revoke insert, update, delete,
-- truncate` of `0001_init.sql` and the `revoke all` of `0018`/`0021` still hold for writes, and
-- with no insert/update/delete policy a future write grant would still be refused by RLS.
-- `groups_public`, `group_members_public` and every public-read table are unchanged. Nothing in
-- `apps/web` reads through these policies yet: every route still reads with the service role,
-- which bypasses RLS.
--
-- Two helpers, locked like the existing definer functions:
--
--   current_player_id()         the session's `players.id`: `auth.uid()` -> its Discord identity
--                               in `auth.identities` (`provider_id`, written only by an OAuth
--                               round trip, never `user_metadata`, which the user can edit) ->
--                               `players.discord_id`. Null for anon, for a session with no
--                               Discord identity, and for one not yet paired to a PUUID.
--   is_group_admin(group_id)    whether the session's player is `owner` or `admin` of the group.
--                               `owner` is not a legal role yet (the check on
--                               `group_memberships.role` still says member | admin); it is
--                               written here so M14.11 does not have to touch this function.
--
-- **Why `authenticated` may execute both.** A function called inside a policy runs with the
-- privileges of the querying role, so a policy that calls a helper `authenticated` cannot execute
-- would make every read of the table fail with `permission denied for function`. The grant also
-- exposes both through PostgREST as `/rpc/current_player_id` and `/rpc/is_group_admin`, which is
-- harmless by construction: neither takes a player, both answer only about the caller's own
-- session (its own player id; whether it administers a given group), and both read `auth.uid()`
-- from the verified JWT, so a session cannot ask about anybody else. anon gets neither: no anon
-- policy uses them and anon has no session to ask about.
--
-- **No recursion.** The `group_memberships` policy calls `is_group_admin`, which reads
-- `group_memberships`. The helper is `security definer`, owned by the migration role, which owns
-- the table and so is not subject to its (unforced) RLS: the inner read sees the table as is.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- ---------------------------------------------------------------------------
-- current_player_id
-- ---------------------------------------------------------------------------

create or replace function public.current_player_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from auth.identities i
  join public.players p on p.discord_id = i.provider_id
  where i.user_id = auth.uid()
    and i.provider = 'discord'
  limit 1;
$$;

comment on function public.current_player_id() is
  'M14.5: the signed-in session''s players.id, through its Discord identity (auth.identities.provider_id = players.discord_id). Null for anon, a session without a Discord identity, or one not paired to a PUUID. Answers only about the caller. Executable by authenticated (RLS policies call it) and service_role.';

revoke all on function public.current_player_id() from public, anon, authenticated;
grant execute on function public.current_player_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- is_group_admin
-- ---------------------------------------------------------------------------

create or replace function public.is_group_admin(p_group_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_memberships m
    where m.group_id = p_group_id
      and m.player_id = public.current_player_id()
      and m.role in ('owner', 'admin')
  );
$$;

comment on function public.is_group_admin(uuid) is
  'M14.5: whether the signed-in session''s player is owner or admin of the group (owner is written for M14.11). False for anon and for an unpaired session. Answers only about the caller. Executable by authenticated (RLS policies call it) and service_role.';

revoke all on function public.is_group_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_group_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read policies
--
-- RLS is already enabled on both tables (`0018`, `0021`), with no policy, so today even a grant
-- would show nothing. The policies decide which rows; the grant below is what lets the query run
-- at all (without it `authenticated` gets `permission denied for table` instead of its rows).
-- Whole-table select, not column grants: column grants break PostgREST's `select=*`, and every
-- column of a row a policy lets you see is yours to see (your own role and backfill dates; your
-- group's members and its invite code).
--
-- `(select public.current_player_id())` is wrapped so Postgres evaluates it once per query, not
-- once per row.
-- ---------------------------------------------------------------------------

create policy "a session reads its own memberships" on public.group_memberships
  for select to authenticated
  using (player_id = (select public.current_player_id()));

create policy "group admins read their group's memberships" on public.group_memberships
  for select to authenticated
  using (public.is_group_admin(group_id));

create policy "group admins read their group's invite" on public.group_invites
  for select to authenticated
  using (public.is_group_admin(group_id));

grant select on public.group_memberships to authenticated;
grant select on public.group_invites to authenticated;

-- Writes stay with the service role. Restated so the boundary is visible in the file that opened
-- the reads: nothing above may be read as a write grant.
revoke insert, update, delete, truncate on public.group_memberships from anon, authenticated;
revoke insert, update, delete, truncate on public.group_invites from anon, authenticated;
