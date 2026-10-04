-- 0028_lobby_password_private.sql (M14.28)
--
-- `lobbies.lobby_password` stops being readable with the public anon key. The product shows the
-- custom lobby's password to signed-in members of the group (`00-product.md`, Start a lobby; the
-- Discord post), never to every visitor of a public group's page. Until now any holder of the
-- anon key could `select lobby_password from lobbies` for every group, and every open Tonight page
-- received it in each Realtime `lobbies` event.
--
-- **Column privileges, not a view or a second table** (the smallest change that closes both
-- holes):
--   - `anon` and `authenticated` lose the table-wide SELECT on `lobbies` and get SELECT on every
--     column **except** `lobby_password`. RLS and the row policy "lobbies are publicly readable"
--     are unchanged, so the same rows stay readable; one column of them does not.
--   - PostgREST: an explicit column list without `lobby_password` works as before for anon; a
--     select naming `lobby_password` (or `select=*`) is refused with 42501 instead of leaking.
--     No anon read in the app uses `*` on `lobbies`; the one anon read that names the password
--     (`lib/tonight/load.ts`, the Tonight loader) moves to a service-role read for linked members
--     of the group in the same step as this migration is applied (M14.28 / M14.14 step 2b).
--   - Realtime: `lobbies` stays in `supabase_realtime`, and Realtime only puts into a subscriber's
--     payload the columns that subscriber's role may SELECT, so anon events keep firing (the
--     Tonight page only uses them to refresh) and carry no `lobby_password` (checked on a
--     throwaway stack: see the M14.28 report).
--   - The service role (every server writer and reader: ingest, the Discord post, the roll) keeps
--     its table-wide privileges and sees the column as before.
--   - REFERENCES, TRIGGER and MAINTAIN for anon/authenticated are left exactly as they were.
--
-- **For later migrations:** a column added to `lobbies` is no longer readable by anon until it is
-- granted (`grant select (<column>) on public.lobbies to anon, authenticated;`). That is the point.
--
-- One explicit transaction: the Supabase CLI applies a file statement by statement with no
-- enclosing transaction, and this file must be all-or-nothing (no window where anon reads nothing).
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

revoke select on public.lobbies from anon, authenticated;

grant select (
  id,
  lcu_party_id,
  status,
  reported_by_player_id,
  lobby_name,
  created_at,
  updated_at,
  group_id
) on public.lobbies to anon, authenticated;

comment on column public.lobbies.lobby_password is
  'The custom lobby''s password. M14.28 (0028): not readable by anon or authenticated (column privileges); the server reads it with the service role, for linked members of the group only.';

commit;
