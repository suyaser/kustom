-- 0037_group_live.sql (M19.9)
--
-- Tonight's live signal (`04-decisions.md`, 2026-10-04: "Tonight's live signal is a per-group
-- `group_live(group_id, version, kind, changed_at)` row, bumped by each write route as its last
-- statement, published to Realtime under RLS and carrying no player data").
--
--   group_live           one row per group: a counter, a word and a time. Nothing else, ever: no
--                        player id, no lobby id, no name. Public read (Tonight is anonymous), in
--                        `supabase_realtime`, so a page subscribed with `group_id=eq.<id>` hears
--                        its own group's changes and nobody else's.
--   bump_group_live()    the only writer: `version + 1`, the kind, `now()`. Executable by
--                        `service_role` only. Each write route calls it once, as its last
--                        statement, after every other write of the request has committed, and not
--                        at all when it wrote nothing (`apps/web/lib/live/bump.ts`).
--
-- The kinds (`groupLiveKindSchema` in packages/db/src/schemas/live.ts is the same list):
--
--   lobby    a lobby roster, side, name or status moved; Start a lobby queued a command
--   split    Roll or Reroll put teams up
--   game     an end-of-game block (or a backfilled game) was stored, rated, or closed its lobby
--   mode     the Mode card changed (mode, Spin, Rated, fearless reset)
--   ratings  ratings moved without a new game (reset, the rebuild cron, rebuild-ratings)
--   roster   group membership or a player link moved
--
-- **Why one row per group and not an event log.** A subscriber that misses an event (a dropped
-- socket, a tab in the background) compares `version` with the version its page was rendered at
-- and re-reads when it moved; a log would have to be replayed. `kind` is a hint for the page
-- (the last change's kind), never a contract that every change of every kind arrives.
--
-- **Why the row is public.** Every column is one anyone could infer by watching the Tonight page
-- of a group whose slug they know: that something changed, roughly what, and when. A subscriber
-- unfiltered on `group_id` therefore learns only that some group they may not know changed, by
-- its uuid. That is the whole exposure, by design (M19.9 acceptance 1).
--
-- **Not in this migration:** taking `lobbies`, `lobby_members`, `splits`, `games`, `game_players`
-- and `ratings` out of `supabase_realtime`. That is M19.11, after Tonight listens to this row
-- only (M19.10) and has run a real night on it.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

create table public.group_live (
  group_id   uuid        primary key references public.groups (id) on delete cascade,
  version    bigint      not null default 0,
  kind       text        not null,
  changed_at timestamptz not null default now(),
  constraint group_live_kind check (kind in ('lobby', 'split', 'game', 'mode', 'ratings', 'roster')),
  constraint group_live_version check (version >= 0)
);

comment on table public.group_live is
  'M19.9 (0037): the group''s live signal for Tonight. One row per group (backfilled; groups_insert_live for a new group). Written only by bump_group_live (service role). Public read; published to supabase_realtime. Carries no player or lobby data.';
comment on column public.group_live.version is
  'Moves by one on every write route''s last statement. A page compares it with the version it was rendered at.';
comment on column public.group_live.kind is
  'The last change''s kind: lobby, split, game, mode, ratings or roster. A hint, not a log.';
comment on column public.group_live.changed_at is
  'When the last bump landed.';

-- Every group that exists now gets its row at version 0. `roster` is the birth kind: a group's
-- first fact is who is in it.
insert into public.group_live (group_id, version, kind)
select id, 0, 'roster' from public.groups
on conflict (group_id) do nothing;

alter table public.group_live enable row level security;

create policy "group live is publicly readable" on public.group_live
  for select to anon, authenticated using (true);

-- Select and nothing else: not insert, update, delete or truncate, and not references or trigger
-- either (Supabase's default privileges grant all of them on a new public table).
revoke all on public.group_live from anon, authenticated;
grant select on public.group_live to anon, authenticated;

alter publication supabase_realtime add table public.group_live;

-- Every new group gets its row at birth, whichever path creates it (`create_group`, a test, a
-- seed), the same way 0024's `groups_insert_mode` gives it a mode.
create function public.groups_insert_live() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.group_live (group_id, version, kind) values (new.id, 0, 'roster')
  on conflict (group_id) do nothing;
  return new;
end;
$$;

comment on function public.groups_insert_live() is
  'M19.9 (0037): inserts the new group''s group_live row (version 0, kind roster). Trigger only.';

revoke all on function public.groups_insert_live() from public, anon, authenticated;

create trigger groups_insert_live
  after insert on public.groups
  for each row execute function public.groups_insert_live();

-- The one writer. An upsert, so a group whose row somehow went missing gets one back instead of
-- the bump failing; a group that does not exist is the foreign key's error. A kind outside the
-- list is the check's error. Returns the new version.
create function public.bump_group_live(p_group uuid, p_kind text) returns bigint
language sql
set search_path = ''
as $$
  insert into public.group_live as live (group_id, version, kind, changed_at)
  values (p_group, 1, p_kind, now())
  on conflict (group_id) do update
    set version = live.version + 1, kind = excluded.kind, changed_at = excluded.changed_at
  returning version;
$$;

comment on function public.bump_group_live(uuid, text) is
  'M19.9 (0037): version + 1, kind, now() on the group''s group_live row. Service role only; each write route''s last statement (apps/web/lib/live/bump.ts).';

revoke all on function public.bump_group_live(uuid, text) from public, anon, authenticated;
grant execute on function public.bump_group_live(uuid, text) to service_role;

commit;
