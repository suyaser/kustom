-- 0047_mode_one_row.sql (M20.7; decision rows M20 D6, D7, D9 to D11, and the 2026-10-05 rows
-- "Rolling is a suggestion" and "M20.6 core transition")
--
-- The Mode card on one row with no version (core's `mode/transition.ts`). `group_modes` is the next
-- game (`standing`, the pending rule with its class tag or its region pair, `rated`); a lobby's
-- `lock_*` columns are this game. Roll moves the pending fields onto the lock and empties them on
-- the row in one statement; teams coming down, a remake and an ARAM record hand them back into
-- empty fields only. Every admin action is one update of only the fields it sets (last write wins,
-- D7): there is no compare-and-set, so the version token and its columns go.
--
-- The lettered list of M20.7:
--
--   (a) group_modes keeps mode (standing), pending_rule, pending_class_tag, rated_override,
--       set_by (private since 0029) and pending_set_by (never granted).
--   (b) group_modes gains pending_region_blue / pending_region_red: both set and different exactly
--       when the pending rule is region wars, both null otherwise (`group_modes_pending_regions`).
--       Region wars is drawn when it is chosen (D9); there is no region rule without its pair.
--       Granted to anon like the other card columns (0029: a new group_modes column is unreadable
--       until granted).
--   (c) a pending region wars written before this migration has no pair (the columns did not
--       exist): those rules are emptied with their rated_override and pending_set_by, before the
--       check is added. One admin tap re-chooses it, and the pair is drawn then. Local stack at
--       authoring: 0 rows.
--   (d) group_modes.version goes (and its check). updated_at (0024, set by the
--       `group_modes_set_updated_at` trigger on every update) stays; no write path reads it.
--   (e) lobbies drops lock_version and lock_no_draw (with lobbies_lock_no_draw). Lock existence
--       is keyed on lock_mode: lock_rated becomes optional in `lobbies_lock_whole` (it is the Rated
--       switch as it was moved, null = the locked mode's default). lock_region_blue/red unchanged;
--       `lobbies_lock_regions` is re-made so a region lock with a null region is refused (0032's
--       version passed it: a CHECK passes on NULL).
--   (f) games.rule_no_draw goes (with games_rule_no_draw). Hosted read 2026-10-04 (owner): 0 rows
--       true. games.rated, games.rule* and the fold are untouched.
--
-- Functions (service role only; the server's `lib/mode/` calls them):
--
--   mode_hand_back(group, lock...)   core's `handBack` as one conditional UPDATE: the lock's rule
--                                    (its pair as locked) only into an empty pending rule, its
--                                    Rated only into an empty rated_override and only while the
--                                    row's rule is empty or the same rule. A newer admin choice
--                                    always wins; twice is once. Returns whether it wrote. Used by
--                                    the trigger below and by a remake / ARAM record.
--   mode_take(lobby, group, ...)     Roll's move (core's `take`, computed by the server from the
--                                    row it read): under the row's lock, if the row is still what
--                                    the server read, write the lock onto the lobby (only one with
--                                    no lock, in one of the given statuses) and, unless it is the
--                                    no-draw path, empty the row's pending fields. 'stale' when an
--                                    admin wrote in between (the server re-reads and re-takes, so a
--                                    pick racing Roll ends in the lock or still pending, never
--                                    lost), 'exists' when the lobby already had a lock or left the
--                                    statuses, 'locked' when it wrote.
--   lobbies_drop_mode_lock()         (trigger, replaced) teams coming down (balanced -> open) hand
--                                    the lock back through mode_hand_back, then drop it.
--
-- Rollback: the previous build reads `version` and `lock_version` and would fail; this ships with
-- M20.7's code, never ahead of it.
--
-- One explicit transaction: a dropped column with its readers' grants gone and no replacement
-- check, or a trigger calling a missing function, must never exist.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

-- ---------------------------------------------------------------------------
-- (c) pending region wars with no pair
-- ---------------------------------------------------------------------------

update public.group_modes
set pending_rule = null,
    pending_class_tag = null,
    rated_override = null,
    pending_set_by = null
where pending_rule = 'region';

-- ---------------------------------------------------------------------------
-- (b) the pending pair
-- ---------------------------------------------------------------------------

alter table public.group_modes
  add column pending_region_blue text,
  add column pending_region_red text;

alter table public.group_modes
  -- `coalesce(..., false)`: a CHECK passes on NULL, and `null ~ '...'` is NULL, so without it a
  -- region rule with no pair would pass (the hole 0032's lobbies_lock_regions has; fixed below).
  add constraint group_modes_pending_regions check (coalesce(
    (pending_rule = 'region'
      and pending_region_blue is not null and pending_region_red is not null
      and pending_region_blue ~ '^[a-z][a-z-]{1,40}$' and pending_region_red ~ '^[a-z][a-z-]{1,40}$'
      and pending_region_blue <> pending_region_red
      and pending_region_blue <> 'unaffiliated' and pending_region_red <> 'unaffiliated')
    or (pending_rule is distinct from 'region' and pending_region_blue is null and pending_region_red is null),
    false)
  );

comment on column public.group_modes.pending_region_blue is
  'M20.7 (0047): Blue''s region of a pending region wars, drawn when it was chosen (M20 D9) or set by an admin. Set exactly when pending_rule = region (group_modes_pending_regions).';
comment on column public.group_modes.pending_region_red is
  'M20.7 (0047): Red''s region of a pending region wars. Set exactly when pending_rule = region; never equal to pending_region_blue.';

grant select (pending_region_blue, pending_region_red) on public.group_modes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- (d) no version
-- ---------------------------------------------------------------------------

alter table public.group_modes drop constraint group_modes_version_nonnegative;
alter table public.group_modes drop column version;

comment on column public.group_modes.pending_rule is
  'M15.3 (0032), M20.7 (0047): the next game''s rule (class, region, mirror), or null. Moved onto the lobby''s lock by Roll (mode_take), handed back by teams coming down, a remake or an ARAM (mode_hand_back), emptied by a standing pick.';
comment on column public.group_modes.rated_override is
  'M15.3 (0032), M20.7 (0047): the Rated switch for the next game (R9); null means the next game''s mode default. Moved with the rule by Roll; reset by any mode pick.';
comment on column public.group_modes.updated_at is
  'Set by group_modes_set_updated_at on every update. M20.7 (0047): the client mode store''s ordering only (M19.13); no write path reads it.';

-- ---------------------------------------------------------------------------
-- (e) the lock: no version, no no-draw flag, Rated as moved
-- ---------------------------------------------------------------------------

alter table public.lobbies drop constraint lobbies_lock_no_draw;
alter table public.lobbies drop constraint lobbies_lock_whole;
alter table public.lobbies drop column lock_no_draw;
alter table public.lobbies drop column lock_version;

alter table public.lobbies
  add constraint lobbies_lock_whole check (
    (lock_mode is null and lock_rule is null and lock_class_tag is null and lock_region_blue is null
      and lock_region_red is null and lock_rated is null and locked_at is null)
    or (lock_mode in ('normal', 'fearless') and locked_at is not null)
  );

-- 0032's lobbies_lock_regions passes a region lock with a null region (a CHECK passes on NULL).
-- The lock's pair is always concrete (M20.7 (e): a hand-back returns exactly the locked pair), so
-- the check is re-made to refuse it. Every existing row satisfies it: the draw always wrote both.
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
  'M15.3 (0032), M20.7 (0047): the Rated switch as Roll moved it; null = the locked mode''s default (core lockRated). Kept raw so a hand-back restores the row exactly.';

-- ---------------------------------------------------------------------------
-- (f) games: no no-draw flag
-- ---------------------------------------------------------------------------

alter table public.games drop constraint games_rule_no_draw;
alter table public.games drop column rule_no_draw;

-- ---------------------------------------------------------------------------
-- mode_hand_back: core's handBack as one statement
-- ---------------------------------------------------------------------------

create function public.mode_hand_back(
  p_group_id uuid,
  p_rule text,
  p_class_tag text,
  p_region_blue text,
  p_region_red text,
  p_rated boolean
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
    and ((gm.pending_rule is null and p_rule is not null)
      or (gm.rated_override is null and p_rated is not null
        and (gm.pending_rule is null
          or (gm.pending_rule = p_rule and gm.pending_class_tag is not distinct from p_class_tag))));
  get diagnostics wrote = row_count;
  return wrote;
end;
$$;

comment on function public.mode_hand_back(uuid, text, text, text, text, boolean) is
  'M20.7 (0047): core handBack as one conditional UPDATE of group_modes: the lock''s rule (with its region pair) only into an empty pending rule; its Rated only into an empty rated_override while the row''s rule is empty or the same rule. True when it wrote. Service role; also called by lobbies_drop_mode_lock.';

revoke all on function public.mode_hand_back(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mode_hand_back(uuid, text, text, text, text, boolean) to service_role;

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
  -- "Normal mode now." note reads it as the last admin switch).
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
-- Teams coming down hand the lock back, then drop it
-- ---------------------------------------------------------------------------

create or replace function public.lobbies_drop_mode_lock() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'balanced' and new.status = 'open' then
    if old.lock_mode is not null then
      perform public.mode_hand_back(
        old.group_id, old.lock_rule, old.lock_class_tag, old.lock_region_blue, old.lock_region_red, old.lock_rated
      );
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
  'M15.3 (0032), M15.17 (0035), M20.7 (0047): when a lobby goes balanced -> open (the teams came down), hands its mode lock back to group_modes (mode_hand_back: only into empty fields) and clears it. Security definer so any writer of the status hands back. Trigger only.';

revoke all on function public.lobbies_drop_mode_lock() from public, anon, authenticated;

commit;
