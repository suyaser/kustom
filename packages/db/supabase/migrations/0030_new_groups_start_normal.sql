-- 0030_new_groups_start_normal.sql (M14.46)
--
-- New groups start on Normal (the user, 2026-10-03: "new groups should start on normal"). Until
-- now a group was born on Fearless: `0024` gave `group_modes.mode` the column default
-- `'fearless'`, and its `groups_insert_mode()` trigger (the only thing that inserts a group's
-- row; `create_group` from `0021`/`0023` does not touch `group_modes`) inserted `(group_id)` and
-- took that default.
--
-- This migration changes the two places a new group's mode comes from, and the stamp's fallback:
--
--   group_modes.mode default   'fearless' -> 'normal'. Metadata only: no row is rewritten.
--   groups_insert_mode()       now names `mode = 'normal'` instead of leaning on the default, so
--                              a later default change cannot silently change what a group is
--                              born on.
--
-- **No existing row changes.** There is no update here: `customs` and every group created before
-- this migration keep whatever mode they are on (Fearless unless an admin picked Normal).
--
--   games_stamp_mode()         its fallback for a game whose group has no `group_modes` row is
--                              now `'normal'` (was `'fearless'`); the rest is 0024's body. Only a
--                              new group can lack a row (`groups_insert_mode` gives every group one
--                              at birth and `0024` backfilled the rest), and the app reads such a
--                              group as Normal (`NEW_GROUP_MODE`), so the stamp now agrees with it.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

alter table public.group_modes alter column mode set default 'normal';

comment on column public.group_modes.mode is
  'A public.modes id. Default normal since 0030 (M14.46): a new group starts on Normal; groups that existed before 0030 kept their mode. games.mode is stamped from this when a game is recorded.';

create or replace function public.groups_insert_mode() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.group_modes (group_id, mode) values (new.id, 'normal')
  on conflict (group_id) do nothing;
  return new;
end;
$$;

comment on function public.groups_insert_mode() is
  'M14.29, M14.46: inserts the new group''s group_modes row on Normal (0030). Trigger only.';

revoke all on function public.groups_insert_mode() from public, anon, authenticated;

create or replace function public.games_stamp_mode() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mode is null then
    select gm.mode into new.mode
    from public.group_modes gm
    where gm.group_id = new.group_id;

    new.mode := coalesce(new.mode, 'normal');
  end if;
  return new;
end;
$$;

comment on function public.games_stamp_mode() is
  'M14.29: stamps games.mode with the game''s group''s current group_modes.mode when the insert did not name one; M14.46 (0030): normal when the group has no row. Trigger only.';

revoke all on function public.games_stamp_mode() from public, anon, authenticated;

commit;
