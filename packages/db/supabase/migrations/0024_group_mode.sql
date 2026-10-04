-- 0024_group_mode.sql (M14.29)
--
-- The group's mode (`04-decisions.md`, 2026-10-03: "A generic Mode card on Tonight ... replaces
-- the fearless on/off switch"). In M14 there are exactly two modes, `normal` and `fearless`.
-- Fearless "off" is the mode `normal`. Every existing group and every new one starts on
-- `fearless`, so nothing changes for anybody until an admin picks `Normal`.
--
--   modes          the list of mode values, one row each. `normal` and `fearless` here; M15 adds
--                  `class`, `region` and `mirror` by inserting rows. Public read.
--   group_modes    one row per group: the group's standing mode, who set it, when. Public read
--                  (Tonight is anonymous) and in `supabase_realtime`, so every open Tonight page
--                  hears a change. Service role writes (`POST /api/admin/mode`).
--   games.mode     the mode in force **when the server recorded the game**, stamped by a
--                  `before insert` trigger from the game's group's `group_modes` row. Every game
--                  already stored is backfilled `fearless`, which is what it was played under.
--
-- **The fearless pool** stays derived (0017): unique champions of the group's counted Rift games
-- with `started_at > fearless_state.reset_at`, and from now on only games stamped `fearless`. A
-- game recorded in Normal never joins the list, not then and not after Fearless is picked again;
-- picking Fearless brings the list back exactly as it stood. Every game stored before this
-- migration is stamped `fearless`, so **every group's pool after this migration equals its pool
-- before it.**
--
-- **Why a separate table and not `groups.mode`.** `groups` is service-role only (0018: RLS on, no
-- policy, anon reads the `groups_public` view). Supabase Realtime only delivers a row to a client
-- that may select it, and a view is never published, so a mode column on `groups` would never
-- reach an open Tonight page without either a public policy on `groups` (which would expose
-- `created_by`) or a second write to some published table. `group_modes` is public-read and
-- published, like `fearless_state`.
--
-- **Why a `modes` table and not a check.** M15 must extend this by adding, never by rewriting
-- (M14.29's constraint). With a check, every new mode value is a `drop constraint` / `add
-- constraint` on 0024's columns. With a referenced list it is an `insert into public.modes`, and
-- a per-mode fact M15 needs (a default `rated`, a label) is a new column on `modes`. M15's other
-- two additions also land beside this, not in it: a one-game mode on top of the standing one is a
-- new column (on `lobbies`, per M15.3, or on `group_modes`), and a rated stamp is a new
-- `games.rated` column. The trigger fills `games.mode` only when the insert left it null, so
-- M15's ingest can stamp a one-game mode explicitly without replacing the trigger.
--
-- **Why `games.mode` is nullable with a not-null check.** A `not null` column with no default
-- is a required field in the generated `Insert` type, which would turn every typed insert of a
-- game (the ingest and ~60 test fixtures) into a type error although the trigger always fills
-- it. A column default (`'fearless'`) would stamp a game whose insert forgot its group's mode as
-- Fearless without anybody noticing, and the trigger could not tell a default from a choice.
-- So the column is nullable for the type generator, the trigger fills it, and
-- `games_mode_stamped` refuses a null, which is the same guarantee as `not null`.
--
-- **Who stamps.** The trigger reads `group_modes` in the inserting transaction, so the stamp is
-- the mode in force when the row is written: an admin who picks Normal mid-game keeps that game
-- out; a backfilled game takes the mode in force when it is recorded. A second companion's
-- duplicate post is `on conflict (lcu_game_id) do nothing`, so the stored stamp is the first
-- write's. A group with no `group_modes` row (impossible after this migration: the backfill and
-- `groups_insert_mode` give every group one) is stamped `fearless`, the default every group has.
--
-- **Rating is untouched.** Both M14 modes are rated exactly as today (decision row 2026-10-03:
-- no rated toggle and no rated column in M14). Nothing here is read by the rating fold.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- ---------------------------------------------------------------------------
-- modes: the list of mode values
-- ---------------------------------------------------------------------------

create table public.modes (
  id         text        primary key,
  created_at timestamptz not null default now(),
  -- Lowercase words; `groupModeSchema` in packages/db/src/schemas/modes.ts is the same list.
  constraint modes_id_shape check (id ~ '^[a-z][a-z_]{1,30}$')
);

comment on table public.modes is
  'M14.29: every mode a group can be on or a game can be stamped with. normal and fearless in M14; M15 inserts its modes as rows. Service role writes; anon reads.';

insert into public.modes (id) values ('normal'), ('fearless')
on conflict (id) do nothing;

alter table public.modes enable row level security;

create policy "modes are publicly readable" on public.modes
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.modes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- group_modes: one standing mode per group
-- ---------------------------------------------------------------------------

create table public.group_modes (
  group_id   uuid        primary key references public.groups (id) on delete cascade,
  mode       text        not null default 'fearless' references public.modes (id),
  set_by     uuid        references public.players (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.group_modes is
  'M14.29: the group''s standing mode, one row per group, inserted with the group (groups_insert_mode). Stays until an admin changes it. Service role writes; anon reads; published to supabase_realtime.';
comment on column public.group_modes.mode is
  'A public.modes id. Default fearless: every group starts on Fearless. games.mode is stamped from this when a game is recorded.';
comment on column public.group_modes.set_by is
  'players.id of the admin or owner who last picked the mode, or null for the row this migration or a new group inserted.';

create trigger group_modes_set_updated_at
  before update on public.group_modes
  for each row execute function public.set_updated_at();

-- Every group that exists now starts on Fearless, which is what it is playing today.
insert into public.group_modes (group_id)
select id from public.groups
on conflict (group_id) do nothing;

alter table public.group_modes enable row level security;

create policy "group modes are publicly readable" on public.group_modes
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.group_modes from anon, authenticated;

alter publication supabase_realtime add table public.group_modes;

-- Every new group gets its row at birth, whichever path creates it (`create_group`, a test, a
-- seed), without replacing 0023's `create_group`.
create function public.groups_insert_mode() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.group_modes (group_id) values (new.id)
  on conflict (group_id) do nothing;
  return new;
end;
$$;

comment on function public.groups_insert_mode() is
  'M14.29: inserts the new group''s group_modes row (mode fearless). Trigger only.';

revoke all on function public.groups_insert_mode() from public, anon, authenticated;

create trigger groups_insert_mode
  after insert on public.groups
  for each row execute function public.groups_insert_mode();

-- ---------------------------------------------------------------------------
-- games.mode: the mode in force when the game was recorded
-- ---------------------------------------------------------------------------

-- `default 'fearless'` here only fills the rows that exist now (a metadata-only default, no table
-- rewrite and no per-row update, so no trigger or Realtime event fires per game). It is dropped
-- straight after: from here on the stamp comes from the trigger below.
alter table public.games
  add column mode text default 'fearless' references public.modes (id);

alter table public.games alter column mode drop default;

alter table public.games
  add constraint games_mode_stamped check (mode is not null);

comment on column public.games.mode is
  'M14.29: the group''s mode when the server recorded this game (games_stamp_mode), never changed after. Every game stored before 0024 is fearless. The fearless pool counts only fearless games. Never null (games_mode_stamped); nullable only so the generated Insert type leaves it to the trigger.';

create function public.games_stamp_mode() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mode is null then
    select gm.mode into new.mode
    from public.group_modes gm
    where gm.group_id = new.group_id;

    new.mode := coalesce(new.mode, 'fearless');
  end if;
  return new;
end;
$$;

comment on function public.games_stamp_mode() is
  'M14.29: stamps games.mode with the game''s group''s current group_modes.mode when the insert did not name one. Trigger only.';

revoke all on function public.games_stamp_mode() from public, anon, authenticated;

create trigger games_stamp_mode
  before insert on public.games
  for each row execute function public.games_stamp_mode();
