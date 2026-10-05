-- 0051_lobby_modes.sql (M22.4, decision rows M22 D5 and the 2026-10-05 "M22.2 rulings")
--
-- Each lobby has its own mode, by fork and fold. `group_modes` stays the card of the only live
-- table (a table is the night's `lobbies` rows of one `lcu_party_id`, M22 D4) and the starting card
-- for a new one. A table whose first row is created while another table of the group is live gets
-- a `lobby_modes` row, a copy of the group's card as it stands (owner answer 2): its pending rule
-- (with the class tag or the region pair) and its Rated switch. The standing mode (Normal or
-- Fearless) and its ban list stay group-wide (M22.2 rulings): a lobby_modes row never holds one.
-- A table with no row reads and writes `group_modes`, so one lobby is exactly today (M22 D2): no
-- row is ever written then, and every function below takes the `group_modes` path it took before.
--
--   lobby_modes             one row per forked table, keyed (group_id, lcu_party_id); no player
--                           names (set_by / pending_set_by are ids, hidden from anon like
--                           group_modes' since 0029), so it is published to supabase_realtime like
--                           group_modes (M19.13) where lobbies cannot be (0044). Public read of the
--                           card columns, service role writes.
--   lobbies_fork_mode       (trigger, after insert on lobbies) the fork: a row for a new table
--                           while another table of the group is live; a new table alone deletes a
--                           left-over row of its party (it reads group_modes). A new cycle of a live
--                           table (the previous row is live, or finished under 20 minutes ago)
--                           writes nothing. "Live" here is M22 D4 without the night boundary, over
--                           the last day: a stale lobby row can only cause a fork that the server's
--                           settle folds back, never a missing one.
--   lobby_mode_fold         the fold: the row's pending rule, pair and Rated onto group_modes, then
--                           the row deleted, in one transaction, unless the table's live row holds a
--                           lock (then the lock's hand-back still has its row to go to; the server
--                           folds on a later call). True when it folded.
--   lobby_modes_settle      the server's settle (apps/web/lib/mode/table.ts), with the live parties
--                           it read through liveTables: deletes the rows of ended tables (and any
--                           row created before p_since, an earlier night's), never one under a
--                           minute old (a fork the server's read could not see yet); with exactly
--                           one live party, folds it. Answers the folded party or null.
--   mode_take_lobby         mode_take (0047) for a forked table: under the lobby_modes row lock
--                           (and a share lock on group_modes for the standing mode), 'stale' when the
--                           row is not what the server read or is gone (folded: the server re-reads
--                           and takes from group_modes), 'exists' when the lobby has a lock or left
--                           the statuses, else the lock written and the row's pending fields
--                           emptied ('locked').
--   mode_hand_back_lobby    mode_hand_back (0047) on a lobby_modes row: only into empty fields,
--                           nothing once the row was written after the lock.
--   lobbies_drop_mode_lock  (trigger, replaced) teams coming down hand the lock back to the table's
--                           lobby_modes row when it has one, else to group_modes exactly as 0048.
--
-- Additive: the previous build never reads lobby_modes, and with no row every path is 0048's. A
-- rollback deploys the previous build; rows left behind are ignored by it.
--
-- One explicit transaction. Never edit this file once it has been applied. Add a new migration.

begin;

-- ---------------------------------------------------------------------------
-- lobby_modes
-- ---------------------------------------------------------------------------

create table public.lobby_modes (
  group_id            uuid        not null references public.groups (id) on delete cascade,
  lcu_party_id        text        not null,
  pending_rule        text        references public.modes (id),
  pending_class_tag   text,
  pending_region_blue text,
  pending_region_red  text,
  rated_override      boolean,
  pending_set_by      uuid        references public.players (id) on delete set null,
  set_by              uuid        references public.players (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (group_id, lcu_party_id),
  constraint lobby_modes_party_not_blank check (length(btrim(lcu_party_id)) > 0),
  constraint lobby_modes_pending_rule check (pending_rule is null or pending_rule in ('class', 'region', 'mirror')),
  constraint lobby_modes_pending_class_tag check (coalesce(
    (pending_rule = 'class' and pending_class_tag in ('Tank', 'Marksman', 'Mage', 'Assassin', 'Support'))
    or (pending_rule is distinct from 'class' and pending_class_tag is null),
    false)
  ),
  constraint lobby_modes_pending_regions check (coalesce(
    (pending_rule = 'region'
      and pending_region_blue is not null and pending_region_red is not null
      and pending_region_blue ~ '^[a-z][a-z-]{1,40}$' and pending_region_red ~ '^[a-z][a-z-]{1,40}$'
      and pending_region_blue <> pending_region_red
      and pending_region_blue <> 'unaffiliated' and pending_region_red <> 'unaffiliated')
    or (pending_rule is distinct from 'region' and pending_region_blue is null and pending_region_red is null),
    false)
  )
);

comment on table public.lobby_modes is
  'M22.4 (0051): a forked table''s next game (M22 D5): the pending rule with its class tag or region pair, and the Rated switch. Never the standing mode (group_modes.mode, group-wide). Forked by lobbies_fork_mode when a table starts while another is live, folded onto group_modes when it is the only live table left (lobby_mode_fold), deleted when its table ends. A row created before tonight is ignored. Service role writes; anon reads the card columns; published to supabase_realtime.';
comment on column public.lobby_modes.lcu_party_id is
  'The table''s party (lobbies.lcu_party_id): a table is the night''s lobbies rows of one party in one group (M22 D4).';
comment on column public.lobby_modes.rated_override is
  'The table''s Rated switch for its next game; null = the next game''s mode default (as group_modes.rated_override).';
comment on column public.lobby_modes.set_by is
  'players.id of the admin who last wrote this table''s card. Not readable by anon or authenticated (0029''s rule).';
comment on column public.lobby_modes.pending_set_by is
  'players.id of the admin who set the pending rule. Not readable by anon or authenticated (0029''s rule).';
comment on column public.lobby_modes.updated_at is
  'Set by lobby_modes_set_updated_at on every update. The client store''s ordering and mode_hand_back_lobby''s "written after the lock" test.';

create trigger lobby_modes_set_updated_at
  before update on public.lobby_modes
  for each row execute function public.set_updated_at();

alter table public.lobby_modes enable row level security;

create policy "lobby modes are publicly readable" on public.lobby_modes
  for select to anon, authenticated using (true);

revoke all on public.lobby_modes from anon, authenticated;

grant select (
  group_id,
  lcu_party_id,
  pending_rule,
  pending_class_tag,
  pending_region_blue,
  pending_region_red,
  rated_override,
  created_at,
  updated_at
) on public.lobby_modes to anon, authenticated;

alter publication supabase_realtime add table public.lobby_modes;

-- ---------------------------------------------------------------------------
-- The fold
-- ---------------------------------------------------------------------------

create function public.lobby_mode_fold(p_group_id uuid, p_party_id text) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  lm public.lobby_modes%rowtype;
begin
  select * into lm from public.lobby_modes
  where group_id = p_group_id and lcu_party_id = p_party_id
  for update;
  if not found then
    return false;
  end if;
  -- A live lock was taken from this row: its hand-back must find the row. Fold after it is gone.
  if exists (
    select 1 from public.lobbies l
    where l.group_id = p_group_id and l.lcu_party_id = p_party_id
      and l.lock_mode is not null and l.status in ('open', 'balanced', 'in_game')
  ) then
    return false;
  end if;

  update public.group_modes
  set pending_rule = lm.pending_rule,
      pending_class_tag = lm.pending_class_tag,
      pending_region_blue = lm.pending_region_blue,
      pending_region_red = lm.pending_region_red,
      rated_override = lm.rated_override,
      pending_set_by = lm.pending_set_by
  where group_id = p_group_id;
  if not found then
    insert into public.group_modes (group_id, pending_rule, pending_class_tag, pending_region_blue,
      pending_region_red, rated_override, pending_set_by)
    values (p_group_id, lm.pending_rule, lm.pending_class_tag, lm.pending_region_blue,
      lm.pending_region_red, lm.rated_override, lm.pending_set_by);
  end if;

  delete from public.lobby_modes where group_id = p_group_id and lcu_party_id = p_party_id;
  return true;
end;
$$;

comment on function public.lobby_mode_fold(uuid, text) is
  'M22.4 (0051): copies a forked table''s pending rule, pair and Rated onto group_modes (never the standing mode) and deletes its lobby_modes row, in one transaction; refuses (false) while the table''s live row holds a lock. Service role only.';

revoke all on function public.lobby_mode_fold(uuid, text) from public, anon, authenticated;
grant execute on function public.lobby_mode_fold(uuid, text) to service_role;

create function public.lobby_modes_settle(p_group_id uuid, p_live_parties text[], p_since timestamptz)
returns text
language plpgsql
set search_path = ''
as $$
begin
  delete from public.lobby_modes lm
  where lm.group_id = p_group_id
    and ((not (lm.lcu_party_id = any (coalesce(p_live_parties, '{}'::text[])))
          and lm.created_at < now() - interval '1 minute')
      or (p_since is not null and lm.created_at < p_since));
  if cardinality(coalesce(p_live_parties, '{}'::text[])) = 1
     and public.lobby_mode_fold(p_group_id, p_live_parties[1]) then
    return p_live_parties[1];
  end if;
  return null;
end;
$$;

comment on function public.lobby_modes_settle(uuid, text[], timestamptz) is
  'M22.4 (0051): with the live parties the server read (liveTables), deletes the lobby_modes rows of ended tables (never one under a minute old) and any created before p_since; with exactly one live party, folds it (lobby_mode_fold). Answers the folded party or null. Service role only.';

revoke all on function public.lobby_modes_settle(uuid, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.lobby_modes_settle(uuid, text[], timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- The fork
-- ---------------------------------------------------------------------------

create function public.lobbies_fork_mode() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev record;
begin
  -- A new cycle of a table that is still live keeps that table's card.
  select l.status, l.updated_at into prev
  from public.lobbies l
  where l.group_id = new.group_id and l.lcu_party_id = new.lcu_party_id and l.id <> new.id
  order by l.created_at desc, l.id desc
  limit 1;
  if found and (prev.status in ('open', 'balanced', 'in_game')
      or (prev.status = 'finished' and prev.updated_at > now() - interval '20 minutes')) then
    return null;
  end if;

  -- A new table: forks while another table of the group is live; alone, it reads group_modes.
  if exists (
    select 1
    from (
      select distinct on (l.lcu_party_id) l.status, l.updated_at
      from public.lobbies l
      where l.group_id = new.group_id
        and l.lcu_party_id <> new.lcu_party_id
        and l.created_at > now() - interval '1 day'
      order by l.lcu_party_id, l.created_at desc, l.id desc
    ) newest
    where newest.status in ('open', 'balanced', 'in_game')
      or (newest.status = 'finished' and newest.updated_at > now() - interval '20 minutes')
  ) then
    insert into public.lobby_modes as lm (group_id, lcu_party_id, pending_rule, pending_class_tag,
      pending_region_blue, pending_region_red, rated_override, pending_set_by)
    select new.group_id, new.lcu_party_id, gm.pending_rule, gm.pending_class_tag,
      gm.pending_region_blue, gm.pending_region_red, gm.rated_override, gm.pending_set_by
    from (select 1) one
    left join public.group_modes gm on gm.group_id = new.group_id
    on conflict (group_id, lcu_party_id) do update
    set pending_rule = excluded.pending_rule,
        pending_class_tag = excluded.pending_class_tag,
        pending_region_blue = excluded.pending_region_blue,
        pending_region_red = excluded.pending_region_red,
        rated_override = excluded.rated_override,
        pending_set_by = excluded.pending_set_by,
        set_by = null,
        created_at = now();
  else
    delete from public.lobby_modes where group_id = new.group_id and lcu_party_id = new.lcu_party_id;
  end if;
  return null;
end;
$$;

comment on function public.lobbies_fork_mode() is
  'M22.4 (0051): after a lobbies insert that starts a new table (the party''s previous row is not live), copies group_modes'' pending rule, pair and Rated into the party''s lobby_modes row while another table of the group is live (the last day''s rows, M22 D4''s statuses and 20-minute linger), and otherwise deletes a left-over row of the party. A new cycle of a live table writes nothing. Security definer so every lobbies writer forks. Trigger only.';

revoke all on function public.lobbies_fork_mode() from public, anon, authenticated;

create trigger lobbies_fork_mode
  after insert on public.lobbies
  for each row execute function public.lobbies_fork_mode();

-- ---------------------------------------------------------------------------
-- mode_take_lobby: Roll's move from a forked table's row
-- ---------------------------------------------------------------------------

create function public.mode_take_lobby(
  p_lobby_id uuid,
  p_group_id uuid,
  p_party_id text,
  p_statuses text[],
  p_read_standing text,
  p_read_rule text,
  p_read_class_tag text,
  p_read_region_blue text,
  p_read_region_red text,
  p_read_rated boolean,
  p_lock_mode text,
  p_lock_rule text,
  p_lock_class_tag text,
  p_lock_region_blue text,
  p_lock_region_red text,
  p_lock_rated boolean,
  p_empty_row boolean
) returns text
language plpgsql
set search_path = ''
as $$
declare
  lm public.lobby_modes%rowtype;
  standing text;
  locked uuid;
begin
  select * into lm from public.lobby_modes
  where group_id = p_group_id and lcu_party_id = p_party_id
  for update;
  if not found then
    -- Folded (or ended) since the server read it: re-read, the table is on group_modes now.
    return 'stale';
  end if;
  select gm.mode into standing from public.group_modes gm where gm.group_id = p_group_id for share;
  if not found then
    standing := 'normal';
  end if;
  if (standing, lm.pending_rule, lm.pending_class_tag, lm.pending_region_blue, lm.pending_region_red, lm.rated_override)
     is distinct from
     (p_read_standing, p_read_rule, p_read_class_tag, p_read_region_blue, p_read_region_red, p_read_rated) then
    return 'stale';
  end if;

  update public.lobbies
  set lock_mode = p_lock_mode,
      lock_rule = p_lock_rule,
      lock_class_tag = p_lock_class_tag,
      lock_region_blue = p_lock_region_blue,
      lock_region_red = p_lock_region_red,
      lock_rated = p_lock_rated,
      locked_at = now()
  where id = p_lobby_id
    and group_id = p_group_id
    and lcu_party_id = p_party_id
    and lock_mode is null
    and status::text = any (p_statuses)
  returning id into locked;
  if locked is null then
    return 'exists';
  end if;

  -- As mode_take: only a row with something to move is written, and then updated_at = locked_at.
  if p_empty_row and (lm.pending_rule is not null or lm.rated_override is not null) then
    update public.lobby_modes
    set pending_rule = null,
        pending_class_tag = null,
        pending_region_blue = null,
        pending_region_red = null,
        rated_override = null,
        pending_set_by = null
    where group_id = p_group_id and lcu_party_id = p_party_id;
  end if;
  return 'locked';
end;
$$;

comment on function public.mode_take_lobby(uuid, uuid, text, text[], text, text, text, text, text, boolean, text, text, text, text, text, boolean, boolean) is
  'M22.4 (0051): mode_take for a forked table. Under the lobby_modes row lock (share lock on group_modes for the standing mode): stale if the row is gone or not what the server read; exists if the lobby has a lock or is not in p_statuses; else writes the lock and, unless p_empty_row is false, empties the row''s pending fields. Service role only.';

revoke all on function public.mode_take_lobby(uuid, uuid, text, text[], text, text, text, text, text, boolean, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.mode_take_lobby(uuid, uuid, text, text[], text, text, text, text, text, boolean, text, text, text, text, text, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- mode_hand_back_lobby: core's handBack onto a forked table's row
-- ---------------------------------------------------------------------------

create function public.mode_hand_back_lobby(
  p_group_id uuid,
  p_party_id text,
  p_rule text,
  p_class_tag text,
  p_region_blue text,
  p_region_red text,
  p_rated boolean,
  p_locked_at timestamptz
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  wrote boolean;
begin
  update public.lobby_modes lm
  set pending_rule = case when lm.pending_rule is null and p_rule is not null then p_rule else lm.pending_rule end,
      pending_class_tag = case when lm.pending_rule is null and p_rule is not null then p_class_tag else lm.pending_class_tag end,
      pending_region_blue = case when lm.pending_rule is null and p_rule is not null then p_region_blue else lm.pending_region_blue end,
      pending_region_red = case when lm.pending_rule is null and p_rule is not null then p_region_red else lm.pending_region_red end,
      rated_override = case
        when lm.rated_override is null and p_rated is not null
          and (lm.pending_rule is null
            or (lm.pending_rule = p_rule and lm.pending_class_tag is not distinct from p_class_tag))
        then p_rated
        else lm.rated_override
      end
  where lm.group_id = p_group_id
    and lm.lcu_party_id = p_party_id
    and (p_locked_at is null or lm.updated_at <= p_locked_at)
    and ((lm.pending_rule is null and p_rule is not null)
      or (lm.rated_override is null and p_rated is not null
        and (lm.pending_rule is null
          or (lm.pending_rule = p_rule and lm.pending_class_tag is not distinct from p_class_tag))));
  get diagnostics wrote = row_count;
  return wrote;
end;
$$;

comment on function public.mode_hand_back_lobby(uuid, text, text, text, text, text, boolean, timestamptz) is
  'M22.4 (0051): mode_hand_back on a forked table''s lobby_modes row: the lock''s rule (with its pair) only into an empty pending rule, its Rated only into an empty rated_override while the row''s rule is empty or the same rule, nothing when the row was written after p_locked_at or is gone. True when it wrote. Service role; also called by lobbies_drop_mode_lock.';

revoke all on function public.mode_hand_back_lobby(uuid, text, text, text, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.mode_hand_back_lobby(uuid, text, text, text, text, text, boolean, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Teams coming down hand the lock back to the table's card
-- ---------------------------------------------------------------------------

create or replace function public.lobbies_drop_mode_lock() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'balanced' and new.status = 'open' then
    if old.lock_mode is not null then
      if exists (
        select 1 from public.lobby_modes lm
        where lm.group_id = old.group_id and lm.lcu_party_id = old.lcu_party_id
      ) then
        perform public.mode_hand_back_lobby(
          old.group_id, old.lcu_party_id, old.lock_rule, old.lock_class_tag, old.lock_region_blue,
          old.lock_region_red, old.lock_rated, old.locked_at
        );
      else
        perform public.mode_hand_back(
          old.group_id, old.lock_rule, old.lock_class_tag, old.lock_region_blue, old.lock_region_red,
          old.lock_rated, old.locked_at
        );
      end if;
    end if;
    new.lock_mode := null;
    new.lock_rule := null;
    new.lock_class_tag := null;
    new.lock_region_blue := null;
    new.lock_region_red := null;
    new.lock_rated := null;
    new.locked_at := null;
  end if;
  return new;
end;
$$;

comment on function public.lobbies_drop_mode_lock() is
  'M15.3 (0032), M15.17 (0035), M20.7 (0047/0048), M22.4 (0051): when a lobby goes balanced -> open (the teams came down), hands its mode lock back to its table''s card (the lobby_modes row when the table is forked, mode_hand_back_lobby; else group_modes, mode_hand_back: only into empty fields, never over an admin write after the lock) and clears it. Security definer so any writer of the status hands back. Trigger only.';

revoke all on function public.lobbies_drop_mode_lock() from public, anon, authenticated;

commit;
