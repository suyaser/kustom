-- 0048_mode_one_row_contract.sql (M20.7, the contract half of 0047)
--
-- **Applied only after the M20.7 build is live and every pre-M20.7 tab is gone** (an old tab posts
-- a body the new route answers, but an old server would read these columns). The M20.7 build reads
-- and writes none of what this drops, and works the same before and after it.
--
--   (c) a pending region wars with no pair (written by the pre-M20.7 build, before or during the
--       rollout) is emptied with its rated_override and pending_set_by, before the pair check.
--       One admin tap re-chooses it, and the pair is drawn then.
--   (b) group_modes_pending_regions: both regions set, different, never unaffiliated, exactly when
--       the pending rule is region wars; both null otherwise. coalesce(..., false): a CHECK passes
--       on NULL, and `null ~ '...'` is NULL.
--   (d) group_modes.version goes (with its check). updated_at stays (no write path reads it; the
--       client store orders by it and mode_hand_back compares it with locked_at).
--   (e) lobbies.lock_version and lobbies.lock_no_draw go (with lobbies_lock_no_draw);
--       lobbies_lock_whole is re-made without lock_version (dropping the column would drop the
--       whole check), and the teams-down trigger without the two columns: every lock left is an
--       M20.7 lock and is handed back. A pre-M20.7 lock still on a live lobby at this moment is
--       handed back like any other: its rule never left the row, so only an empty field fills.
--   (f) games.rule_no_draw goes (with games_rule_no_draw). Hosted read 2026-10-04 (owner): 0 rows
--       true.
--
-- One explicit transaction. Never edit this file once it has been applied. Add a new migration.

begin;

-- ---------------------------------------------------------------------------
-- (c) then (b): no region rule without its pair
-- ---------------------------------------------------------------------------

update public.group_modes
set pending_rule = null,
    pending_class_tag = null,
    pending_region_blue = null,
    pending_region_red = null,
    rated_override = null,
    pending_set_by = null
where pending_rule = 'region'
  and (pending_region_blue is null or pending_region_red is null);

-- A pair left on a row whose rule is not region wars (none can be written, but a hand fix could).
update public.group_modes
set pending_region_blue = null,
    pending_region_red = null
where pending_rule is distinct from 'region'
  and (pending_region_blue is not null or pending_region_red is not null);

alter table public.group_modes
  add constraint group_modes_pending_regions check (coalesce(
    (pending_rule = 'region'
      and pending_region_blue is not null and pending_region_red is not null
      and pending_region_blue ~ '^[a-z][a-z-]{1,40}$' and pending_region_red ~ '^[a-z][a-z-]{1,40}$'
      and pending_region_blue <> pending_region_red
      and pending_region_blue <> 'unaffiliated' and pending_region_red <> 'unaffiliated')
    or (pending_rule is distinct from 'region' and pending_region_blue is null and pending_region_red is null),
    false)
  );

-- ---------------------------------------------------------------------------
-- (d) no version
-- ---------------------------------------------------------------------------

alter table public.group_modes drop constraint group_modes_version_nonnegative;
alter table public.group_modes drop column version;

comment on column public.group_modes.pending_rule is
  'M15.3 (0032), M20.7 (0047/0048): the next game''s rule (class, region, mirror), or null. Moved onto the lobby''s lock by Roll (mode_take), handed back by teams coming down, a remake or an ARAM (mode_hand_back), emptied by a standing pick.';
comment on column public.group_modes.rated_override is
  'M15.3 (0032), M20.7 (0047/0048): the Rated switch for the next game (R9); null means the next game''s mode default. Moved with the rule by Roll; reset by any mode pick.';
comment on column public.group_modes.updated_at is
  'Set by group_modes_set_updated_at on every update. M20.7: the client mode store''s ordering, and mode_hand_back''s "written after the lock" test; no write path reads it otherwise.';

-- ---------------------------------------------------------------------------
-- (e) the lock: no version, no no-draw flag
-- ---------------------------------------------------------------------------

alter table public.lobbies drop constraint lobbies_lock_whole;
alter table public.lobbies drop constraint lobbies_lock_no_draw;
alter table public.lobbies drop column lock_no_draw;
alter table public.lobbies drop column lock_version;

alter table public.lobbies
  add constraint lobbies_lock_whole check (coalesce(
    (lock_mode is null and lock_rule is null and lock_class_tag is null and lock_region_blue is null
      and lock_region_red is null and lock_rated is null and locked_at is null)
    or (lock_mode in ('normal', 'fearless') and locked_at is not null),
    false)
  );

create or replace function public.lobbies_drop_mode_lock() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'balanced' and new.status = 'open' then
    if old.lock_mode is not null then
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
    new.locked_at := null;
  end if;
  return new;
end;
$$;

comment on function public.lobbies_drop_mode_lock() is
  'M15.3 (0032), M15.17 (0035), M20.7 (0047/0048): when a lobby goes balanced -> open (the teams came down), hands its mode lock back to group_modes (mode_hand_back: only into empty fields, never over an admin write after the lock) and clears it. Security definer so any writer of the status hands back. Trigger only.';

revoke all on function public.lobbies_drop_mode_lock() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (f) games: no no-draw flag
-- ---------------------------------------------------------------------------

alter table public.games drop constraint games_rule_no_draw;
alter table public.games drop column rule_no_draw;

commit;
