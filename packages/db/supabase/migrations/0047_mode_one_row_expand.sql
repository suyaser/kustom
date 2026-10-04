-- 0047_mode_one_row_expand.sql (M20.7, the expand half; 0048 is the contract half)
--
-- Decision rows M20 D6, D7, D9 to D11, the 2026-10-05 rows "Rolling is a suggestion" and "M20.6
-- core transition", and the M20.7 review (expand/contract; an admin write after the lock wins).
--
-- The Mode card on one row with no version (core's `mode/transition.ts`). `group_modes` is the next
-- game (`standing`, the pending rule with its class tag or its region pair, `rated`); a lobby's
-- `lock_*` columns are this game. Roll moves the pending fields onto the lock and empties them on
-- the row in one statement (`mode_take`); teams coming down, a remake and an ARAM record hand them
-- back into empty fields only (`mode_hand_back`), and not at all once an admin wrote the row after
-- the lock. Every admin action is one update of only the fields it sets (last write wins, D7).
--
-- **Additive only, applied BEFORE the M20.7 code.** The pre-M20.7 build keeps working on this
-- schema: every column it reads or writes stays (`group_modes.version`, `lobbies.lock_version`,
-- `lobbies.lock_no_draw`, `games.rule_no_draw`), it may still write a region wars with no pair (no
-- pair check yet), and its locks (always with `lock_version`) are dropped by the teams-down trigger
-- exactly as before, with nothing handed back. The M20.7 build never writes those four columns
-- (their defaults fill an insert) and never reads them. 0048 drops them, adds the pair check and
-- empties a pairless pending region wars, once the M20.7 build is live and old tabs are gone.
--
--   (b) group_modes gains pending_region_blue / pending_region_red (nullable region ids), granted
--       to anon like the other card columns (0029: a new group_modes column is unreadable until
--       granted). The check that both are set exactly when region wars is pending is 0048's.
--   (e) lobbies_lock_whole no longer asks for lock_version or lock_rated: a lock exists exactly when
--       lock_mode is set (with locked_at); lock_rated is the Rated switch as Roll moved it, null =
--       the locked mode's default. Wrapped in coalesce(..., false): a CHECK passes on NULL, and
--       0032's version accepted lock_mode null with lock_rule 'mirror' and lock_rated true.
--       lobbies_lock_regions is re-made the same way (0032's accepted a region lock with a null
--       region); every existing row satisfies it, the draw always wrote both.
--
-- Functions (service role only; the server's `lib/mode/` calls them):
--
--   mode_hand_back(group, lock..., locked_at)   core's `handBack` as one conditional UPDATE: the
--                                    lock's rule (its pair as locked) only into an empty pending
--                                    rule, its Rated only into an empty rated_override while the
--                                    row's rule is empty or the same rule, and nothing at all when
--                                    group_modes.updated_at > locked_at (an admin wrote the next
--                                    game after the lock; Roll's own empty-out has updated_at =
--                                    locked_at, one transaction). Twice is once. True when it
--                                    wrote. Used by the trigger below and by a remake / ARAM record.
--   mode_take(lobby, group, ...)     Roll's move (core's `take`, computed by the server from the
--                                    row it read): under the row's lock, if the row is still what
--                                    the server read, write the lock onto the lobby (only one with
--                                    no lock, in one of the given statuses) and, unless it is the
--                                    no-draw path, empty the row's pending fields (only a row with
--                                    something to empty is written). 'stale' when an admin wrote in
--                                    between (the server re-reads and re-takes, so a pick racing
--                                    Roll ends in the lock or still pending, never lost), 'exists'
--                                    when the lobby already had a lock or left the statuses,
--                                    'locked' when it wrote.
--   lobbies_drop_mode_lock()         (trigger, replaced) teams coming down (balanced -> open) drop
--                                    the lock as before; a lock the M20.7 build took (no
--                                    lock_version) is first handed back through mode_hand_back.
--
-- Rollback: nothing to undo for the old build (it ignores the new columns and functions).
--
-- One explicit transaction. Never edit this file once it has been applied. Add a new migration.

begin;

-- ---------------------------------------------------------------------------
-- (b) the pending pair
-- ---------------------------------------------------------------------------

alter table public.group_modes
  add column pending_region_blue text,
  add column pending_region_red text;

comment on column public.group_modes.pending_region_blue is
  'M20.7 (0047): Blue''s region of a pending region wars, drawn when it was chosen (M20 D9) or set by an admin. Set exactly when pending_rule = region (checked from 0048).';
comment on column public.group_modes.pending_region_red is
  'M20.7 (0047): Red''s region of a pending region wars. Set exactly when pending_rule = region; never equal to pending_region_blue.';

grant select (pending_region_blue, pending_region_red) on public.group_modes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- (e) the lock: keyed on lock_mode, Rated as moved, no NULL holes
-- ---------------------------------------------------------------------------

alter table public.lobbies drop constraint lobbies_lock_whole;
alter table public.lobbies
  add constraint lobbies_lock_whole check (coalesce(
    (lock_mode is null and lock_rule is null and lock_class_tag is null and lock_region_blue is null
      and lock_region_red is null and lock_rated is null and lock_version is null and locked_at is null)
    or (lock_mode in ('normal', 'fearless') and locked_at is not null),
    false)
  );

alter table public.lobbies drop constraint lobbies_lock_regions;
alter table public.lobbies
  add constraint lobbies_lock_regions check (coalesce(
    (lock_rule = 'region'
      and lock_region_blue is not null and lock_region_red is not null
      and lock_region_blue ~ '^[a-z][a-z-]{1,40}$' and lock_region_red ~ '^[a-z][a-z-]{1,40}$'
      and lock_region_blue <> lock_region_red
      and lock_region_blue <> 'unaffiliated' and lock_region_red <> 'unaffiliated')
    or (lock_rule is distinct from 'region' and lock_region_blue is null and lock_region_red is null),
    false)
  );

comment on column public.lobbies.lock_mode is
  'M15.3 (0032), M20.7 (0047): the standing mode locked at Roll (or at game start with no Roll), or null for no lock. A lock exists exactly when this is set. Handed back and dropped when the teams come down (lobbies_drop_mode_lock).';
comment on column public.lobbies.lock_rated is
  'M15.3 (0032), M20.7 (0047): the Rated switch as Roll moved it; null = the locked mode''s default (core lockRated). Kept raw so a hand-back restores the row exactly. The pre-M20.7 build stored the effective flag.';

-- ---------------------------------------------------------------------------
-- mode_hand_back: core's handBack as one statement
-- ---------------------------------------------------------------------------

create function public.mode_hand_back(
  p_group_id uuid,
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
  -- One UPDATE: the conditions read the row as locked (a concurrent admin write is waited for and
  -- re-read), so a choice made before this statement always wins and one made after overwrites.
  update public.group_modes gm
  set pending_rule = case when gm.pending_rule is null and p_rule is not null then p_rule else gm.pending_rule end,
      pending_class_tag = case when gm.pending_rule is null and p_rule is not null then p_class_tag else gm.pending_class_tag end,
      pending_region_blue = case when gm.pending_rule is null and p_rule is not null then p_region_blue else gm.pending_region_blue end,
      pending_region_red = case when gm.pending_rule is null and p_rule is not null then p_region_red else gm.pending_region_red end,
      rated_override = case
        when gm.rated_override is null and p_rated is not null
          and (gm.pending_rule is null
            or (gm.pending_rule = p_rule and gm.pending_class_tag is not distinct from p_class_tag))
        then p_rated
        else gm.rated_override
      end
  where gm.group_id = p_group_id
    -- An admin write after the lock wins outright (M20.7 review): nothing comes back.
    and (p_locked_at is null or gm.updated_at <= p_locked_at)
    and ((gm.pending_rule is null and p_rule is not null)
      or (gm.rated_override is null and p_rated is not null
        and (gm.pending_rule is null
          or (gm.pending_rule = p_rule and gm.pending_class_tag is not distinct from p_class_tag))));
  get diagnostics wrote = row_count;
  return wrote;
end;
$$;

comment on function public.mode_hand_back(uuid, text, text, text, text, boolean, timestamptz) is
  'M20.7 (0047): core handBack as one conditional UPDATE of group_modes: the lock''s rule (with its region pair) only into an empty pending rule; its Rated only into an empty rated_override while the row''s rule is empty or the same rule; nothing when the row was written after p_locked_at. True when it wrote. Service role; also called by lobbies_drop_mode_lock.';

revoke all on function public.mode_hand_back(uuid, text, text, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.mode_hand_back(uuid, text, text, text, text, boolean, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- mode_take: Roll's move in one transaction
-- ---------------------------------------------------------------------------

create function public.mode_take(
  p_lobby_id uuid,
  p_group_id uuid,
  p_statuses text[],
  -- The row as the server read it (no row reads as normal, nothing pending, null).
  p_read_standing text,
  p_read_rule text,
  p_read_class_tag text,
  p_read_region_blue text,
  p_read_region_red text,
  p_read_rated boolean,
  -- The lock core's take computed from that row.
  p_lock_mode text,
  p_lock_rule text,
  p_lock_class_tag text,
  p_lock_region_blue text,
  p_lock_region_red text,
  p_lock_rated boolean,
  -- False on the no-draw path: the row keeps its rule, pair and Rated.
  p_empty_row boolean
) returns text
language plpgsql
set search_path = ''
as $$
declare
  gm public.group_modes%rowtype;
  has_row boolean;
  locked uuid;
begin
  select * into gm from public.group_modes where group_id = p_group_id for update;
  has_row := found;
  if has_row then
    if (gm.mode, gm.pending_rule, gm.pending_class_tag, gm.pending_region_blue, gm.pending_region_red, gm.rated_override)
       is distinct from
       (p_read_standing, p_read_rule, p_read_class_tag, p_read_region_blue, p_read_region_red, p_read_rated) then
      return 'stale';
    end if;
  elsif (p_read_standing, p_read_rule, p_read_rated) is distinct from ('normal'::text, null::text, null::boolean) then
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
    and lock_mode is null
    and status::text = any (p_statuses)
  returning id into locked;
  if locked is null then
    return 'exists';
  end if;

  -- Only a row with something to move is written: an empty row keeps its updated_at (the members'
  -- "Normal mode now." note reads it as the last admin switch). A written row gets updated_at =
  -- now() = locked_at, which mode_hand_back reads as "not touched since the lock".
  if p_empty_row and has_row and (gm.pending_rule is not null or gm.rated_override is not null) then
    update public.group_modes
    set pending_rule = null,
        pending_class_tag = null,
        pending_region_blue = null,
        pending_region_red = null,
        rated_override = null,
        pending_set_by = null
    where group_id = p_group_id;
  end if;
  return 'locked';
end;
$$;

comment on function public.mode_take(uuid, uuid, text[], text, text, text, text, text, boolean, text, text, text, text, text, boolean, boolean) is
  'M20.7 (0047): Roll''s move (core take). Under the group_modes row lock: stale if the row is not what the server read; exists if the lobby has a lock or is not in p_statuses; else writes the lock and, unless p_empty_row is false (no-draw), empties the row''s pending fields. Service role only.';

revoke all on function public.mode_take(uuid, uuid, text[], text, text, text, text, text, boolean, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.mode_take(uuid, uuid, text[], text, text, text, text, text, boolean, text, text, text, text, text, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Teams coming down hand an M20.7 lock back, then drop it (an older lock is only dropped)
-- ---------------------------------------------------------------------------

create or replace function public.lobbies_drop_mode_lock() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'balanced' and new.status = 'open' then
    -- A lock with lock_version is the pre-M20.7 build's: its rule never left the row, so there is
    -- nothing to hand back. The M20.7 build never writes lock_version.
    if old.lock_mode is not null and old.lock_version is null then
      perform public.mode_hand_back(
        old.group_id, old.lock_rule, old.lock_class_tag, old.lock_region_blue, old.lock_region_red,
        old.lock_rated, old.locked_at
      );
    end if;
    new.lock_mode := null;
    new.lock_rule := null;
    new.lock_class_tag := null;
    new.lock_region_blue := null;
    new.lock_region_red := null;
    new.lock_rated := null;
    new.lock_version := null;
    new.locked_at := null;
    new.lock_no_draw := false;
  end if;
  return new;
end;
$$;

comment on function public.lobbies_drop_mode_lock() is
  'M15.3 (0032), M15.17 (0035), M20.7 (0047): when a lobby goes balanced -> open (the teams came down), hands an M20.7 lock back to group_modes (mode_hand_back: only into empty fields, never over an admin write after the lock) and clears the lock. Security definer so any writer of the status hands back. Trigger only.';

revoke all on function public.lobbies_drop_mode_lock() from public, anon, authenticated;

commit;
