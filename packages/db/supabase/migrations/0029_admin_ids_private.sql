-- 0029_admin_ids_private.sql (M14.40)
--
-- Two public-read columns that name a group's admin stop being readable with the public anon key:
--
--   group_modes.set_by       (0024) players.id of the admin or owner who last picked the mode.
--   fearless_state.reset_by  (0017; one row per group since 0019) players.id of the admin who last
--                            cleared the fearless pool.
--
-- `players_public` maps any player id to a name for anon, so until now anyone holding the anon key
-- could read "this player is an admin of that group" for every group -- exactly the fact `0018`
-- keeps out of `group_members_public` ("who is its admin ... is not" public). Nothing anon-facing
-- needs either column: the anon reads name their columns (`lib/mode/load.ts`: `mode, updated_at`;
-- `lib/fearless/load.ts`: `reset_at`), Tonight's Realtime subscriptions on both tables only use an
-- event to refresh, and both writers (`lib/mode/set.ts`, `lib/fearless/reset.ts`) run with the
-- service role.
--
-- **The 0028 pattern: column privileges, not a view.**
--   - `anon` and `authenticated` lose the table-wide SELECT on each table and get SELECT on every
--     column **except** the admin id. RLS and the "publicly readable" policies are unchanged, so the
--     same rows stay readable; one column of each does not.
--   - PostgREST: an explicit column list without the admin id works as before; a select naming it
--     (or `select=*`) is refused with 42501 instead of leaking.
--   - Realtime: both tables stay in `supabase_realtime`; Realtime only puts into a subscriber's
--     payload the columns its role may SELECT (checked for `lobbies` in M14.28), so anon events keep
--     firing and carry no admin id.
--   - The service role keeps its table-wide privileges and sees both columns as before.
--   - REFERENCES, TRIGGER and MAINTAIN for anon/authenticated are left exactly as they were.
--
-- **For later migrations:** a column added to `group_modes` or `fearless_state` is no longer
-- readable by anon until it is granted (`grant select (<column>) on public.<table> to anon,
-- authenticated;`).
--
-- One explicit transaction: the Supabase CLI applies a file statement by statement with no
-- enclosing transaction, and this file must be all-or-nothing (no window where anon reads nothing).
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

revoke select on public.group_modes from anon, authenticated;

grant select (
  group_id,
  mode,
  updated_at
) on public.group_modes to anon, authenticated;

comment on column public.group_modes.set_by is
  'players.id of the admin or owner who last picked the mode, or null for the row 0024 or a new group inserted. M14.40 (0029): not readable by anon or authenticated (column privileges) -- with players_public it would name a group''s admin; the server reads it with the service role.';

revoke select on public.fearless_state from anon, authenticated;

grant select (
  id,
  group_id,
  reset_at,
  updated_at
) on public.fearless_state to anon, authenticated;

comment on column public.fearless_state.reset_by is
  'The admin who last cleared the group''s pool (players.id), or null for a row nobody reset. M14.40 (0029): not readable by anon or authenticated (column privileges) -- with players_public it would name a group''s admin; the server reads it with the service role.';

commit;
