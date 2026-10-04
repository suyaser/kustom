-- 0032_mode_of_the_night.sql (M15.3)
--
-- Mode of the night (brief `redesign/briefs/m15.1-mode-of-the-night.md`, decision rows R1 to R10 of
-- 2026-10-04 and the version-token row). Extends `0024`, never reshapes it: no column, row,
-- constraint or default `0024` made is altered or dropped. Everything below is a new row, a new
-- column, a new constraint on a new column, or a new trigger.
--
-- Two layers (R1): the group's **standing mode** (`group_modes.mode`, `normal` or `fearless`,
-- unchanged) and at most one pending **rule** for the next game (class wars, region wars, mirror
-- match). The rule logic is `@customs/core`'s `mode/lifecycle.ts`; these are its columns.
--
--   modes            + rows `class`, `region`, `mirror` (R1, D4) and `rated_default`, the per-mode
--                    default rated fact (R4/D5; the same table as core's `config.modes.ratedDefault`,
--                    `modes.test.ts` keeps the two in step).
--
--   group_modes      the card state core calls `ModeState`:
--                    + pending_rule, pending_class_tag   the next game's rule (`RuleOption`); region
--                                                        wars has no sides until Roll.
--                    + rated_override                    the Rated switch for the next game; null is
--                                                        the effective mode's default (R9).
--                    + version                           the compare-and-clear token: every card
--                                                        write moves it (decision row 2026-10-04).
--                    + pending_set_by                    who set the pending rule (players.id).
--                    `group_modes.mode` gains a check that it is a standing mode: `public.modes` now
--                    lists the rules too, and a rule is never a group's standing mode.
--
--   lobbies          the lobby's copy taken at Roll teams (core's `LockedMode`), for the standing
--                    mode too (R2): lock_mode (the standing mode at Roll), lock_rule +
--                    lock_class_tag / lock_region_blue / lock_region_red (the locked rule, region
--                    wars with its drawn pair), lock_rated, lock_version, locked_at. All null =
--                    no lock. Reroll never touches the row, so it keeps the copy; **teams coming
--                    down (balanced -> open) drops it** (`lobbies_drop_mode_lock`, below), whoever
--                    writes the status.
--
--   games            `games.mode` keeps meaning what `0024` made it: the **standing** mode the game
--                    was played under (the fearless pool reads it). Added beside it:
--                    + rule, rule_class_tag, rule_region_blue, rule_region_red   the rule played.
--                    + rated            false = never in the rating fold, board, calibration,
--                                       Fearless pool or role learning (R4). Every existing game is
--                                       `true` (the metadata-only default), so nothing rated before
--                                       moves on a rebuild; ARAM, remakes and short games stay
--                                       excluded by the gates that already exclude them.
--                    + rule_checked, rule_check   whether the post-game check ran (a rolled Rift
--                                       rule game) and core's `ModeCheck` verdict as JSON (champion
--                                       keys and sides only, never a player: R7).
--
-- **The R2 fix.** Until now `games_stamp_mode` stamped `games.mode` from `group_modes` at record
-- time, so an admin who switched mid-game changed the running game. Ingest now stamps every
-- column explicitly from the lobby's lock (`lib/mode/record.ts`), and the trigger, which only fills
-- a null `mode`, prefers the lobby's `lock_mode` over `group_modes` too; `group_modes` (then
-- `normal`) is the fallback only for a game with no locked lobby (backfill, hand-made teams).
--
-- **Reads.** `games` and `modes` are table-wide public reads, so the new game and mode columns are
-- public: mode, rule, rated and the check are on the poster for everyone and name no admin.
-- `lobbies` (0028) and `group_modes` (0029) are column grants: the lock columns and the card state
-- are granted to anon (Tonight shows them), `pending_set_by` is not (0029's rule: nothing anon can
-- read names a group's admin).
--
-- One explicit transaction: the Supabase CLI runs a file statement by statement, and a half-applied
-- version of this (a lock column with no grant, a trigger with no column) must never exist.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

-- ---------------------------------------------------------------------------
-- modes: the three rules and the default rated fact
-- ---------------------------------------------------------------------------

alter table public.modes
  add column rated_default boolean not null default true;

comment on column public.modes.rated_default is
  'M15.3 (0032): whether a game in this mode is rated when nobody flips the Rated switch (R4/D5). Same table as @customs/core config.modes.ratedDefault.';

insert into public.modes (id, rated_default) values
  ('class', false),
  ('region', false),
  ('mirror', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- group_modes: the pending rule, the Rated switch, the version token
-- ---------------------------------------------------------------------------

alter table public.group_modes
  add column pending_rule text references public.modes (id),
  add column pending_class_tag text,
  add column rated_override boolean,
  add column version bigint not null default 0,
  add column pending_set_by uuid references public.players (id) on delete set null;

alter table public.group_modes
  add constraint group_modes_standing check (mode in ('normal', 'fearless')),
  add constraint group_modes_pending_rule check (pending_rule is null or pending_rule in ('class', 'region', 'mirror')),
  add constraint group_modes_pending_class_tag check (
    (pending_rule = 'class' and pending_class_tag in ('Tank', 'Marksman', 'Mage', 'Assassin', 'Support'))
    or (pending_rule is distinct from 'class' and pending_class_tag is null)
  ),
  add constraint group_modes_version_nonnegative check (version >= 0);

comment on column public.group_modes.pending_rule is
  'M15.3 (0032): the next game''s rule (class, region, mirror), or null for a plain standing-mode game. Cleared by picking a standing mode, or by the recorded game that locked it (compare-and-clear on version).';
comment on column public.group_modes.pending_class_tag is
  'M15.3 (0032): the Data Dragon tag of a pending class wars rule (Tank, Marksman, Mage, Assassin, Support); null otherwise.';
comment on column public.group_modes.rated_override is
  'M15.3 (0032): the Rated switch for the next game (R9); null means the effective mode''s modes.rated_default. Reset by any mode pick and by the recorded game.';
comment on column public.group_modes.version is
  'M15.3 (0032): the compare-and-clear token. Every card write (standing mode, rule, Spin, Rated) moves it; a lobby''s lock records it; a recorded game clears the rule and the switch only if it is unchanged.';
comment on column public.group_modes.pending_set_by is
  'M15.3 (0032): players.id of the admin who set the pending rule. Not readable by anon or authenticated (0029''s rule: it would name an admin).';

grant select (
  pending_rule,
  pending_class_tag,
  rated_override,
  version
) on public.group_modes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- lobbies: the copy taken at Roll teams
-- ---------------------------------------------------------------------------

alter table public.lobbies
  add column lock_mode text references public.modes (id),
  add column lock_rule text references public.modes (id),
  add column lock_class_tag text,
  add column lock_region_blue text,
  add column lock_region_red text,
  add column lock_rated boolean,
  add column lock_version bigint,
  add column locked_at timestamptz;

alter table public.lobbies
  add constraint lobbies_lock_whole check (
    (lock_mode is null and lock_rule is null and lock_class_tag is null and lock_region_blue is null
      and lock_region_red is null and lock_rated is null and lock_version is null and locked_at is null)
    or (lock_mode in ('normal', 'fearless') and lock_rated is not null and lock_version is not null
      and locked_at is not null)
  ),
  add constraint lobbies_lock_rule check (lock_rule is null or lock_rule in ('class', 'region', 'mirror')),
  add constraint lobbies_lock_class_tag check (
    (lock_rule = 'class' and lock_class_tag in ('Tank', 'Marksman', 'Mage', 'Assassin', 'Support'))
    or (lock_rule is distinct from 'class' and lock_class_tag is null)
  ),
  add constraint lobbies_lock_regions check (
    (lock_rule = 'region' and lock_region_blue ~ '^[a-z][a-z-]{1,40}$' and lock_region_red ~ '^[a-z][a-z-]{1,40}$'
      and lock_region_blue <> lock_region_red and lock_region_blue <> 'unaffiliated' and lock_region_red <> 'unaffiliated')
    or (lock_rule is distinct from 'region' and lock_region_blue is null and lock_region_red is null)
  );

comment on column public.lobbies.lock_mode is
  'M15.3 (0032): the standing mode locked at Roll teams (R2), or null for no lock. The game played from this lobby is stamped with the lock, not with group_modes at record time. Dropped when the teams come down (lobbies_drop_mode_lock).';
comment on column public.lobbies.lock_rule is
  'M15.3 (0032): the rule locked at Roll (class, region, mirror), or null for a standing-mode game. Region wars carries its drawn pair in lock_region_blue / lock_region_red.';
comment on column public.lobbies.lock_rated is
  'M15.3 (0032): whether the game is rated, locked at Roll (R9): nobody un-rates a game after seeing the teams.';
comment on column public.lobbies.lock_version is
  'M15.3 (0032): group_modes.version when the lock was taken: the compare-and-clear token for the recorded game.';

grant select (
  lock_mode,
  lock_rule,
  lock_class_tag,
  lock_region_blue,
  lock_region_red,
  lock_rated,
  lock_version,
  locked_at
) on public.lobbies to anon, authenticated;

-- Teams coming down drop the copy (R1, D2.2): the rule stays pending on the group and the next
-- Roll locks it again (region wars draws again). A trigger, not app code, so every writer of the
-- status (moveLobby, ingest's roster change, a hand fix) keeps the rule.
create function public.lobbies_drop_mode_lock() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'balanced' and new.status = 'open' then
    new.lock_mode := null;
    new.lock_rule := null;
    new.lock_class_tag := null;
    new.lock_region_blue := null;
    new.lock_region_red := null;
    new.lock_rated := null;
    new.lock_version := null;
    new.locked_at := null;
  end if;
  return new;
end;
$$;

comment on function public.lobbies_drop_mode_lock() is
  'M15.3 (0032): clears the lobby''s mode lock when it goes balanced -> open (the teams came down). Trigger only.';

revoke all on function public.lobbies_drop_mode_lock() from public, anon, authenticated;

create trigger lobbies_drop_mode_lock
  before update of status on public.lobbies
  for each row execute function public.lobbies_drop_mode_lock();

-- ---------------------------------------------------------------------------
-- games: the rule played, the rated stamp, the check
-- ---------------------------------------------------------------------------

alter table public.games
  add column rule text references public.modes (id),
  add column rule_class_tag text,
  add column rule_region_blue text,
  add column rule_region_red text,
  add column rated boolean not null default true,
  add column rule_checked boolean not null default false,
  add column rule_check jsonb;

alter table public.games
  add constraint games_rule check (rule is null or rule in ('class', 'region', 'mirror')),
  add constraint games_rule_class_tag check (
    (rule = 'class' and rule_class_tag in ('Tank', 'Marksman', 'Mage', 'Assassin', 'Support'))
    or (rule is distinct from 'class' and rule_class_tag is null)
  ),
  add constraint games_rule_regions check (
    (rule = 'region' and rule_region_blue ~ '^[a-z][a-z-]{1,40}$' and rule_region_red ~ '^[a-z][a-z-]{1,40}$'
      and rule_region_blue <> rule_region_red)
    or (rule is distinct from 'region' and rule_region_blue is null and rule_region_red is null)
  ),
  add constraint games_rule_check_shape check (
    (rule_checked and rule is not null and jsonb_typeof(rule_check) = 'object')
    or (not rule_checked and rule_check is null)
  );

comment on column public.games.rule is
  'M15.3 (0032): the rule this game was played under, from its lobby''s lock at Roll (class, region, mirror), or null for a standing-mode game. games.mode stays the standing mode.';
comment on column public.games.rated is
  'M15.3 (0032): false = never in the rating fold, rebuild-ratings, the board, calibration, the Fearless pool or role learning (R4). Stamped from the lobby''s lock (core gameStamp); every game before 0032 is true. ARAM, remakes and short games stay excluded by their own gates.';
comment on column public.games.rule_checked is
  'M15.3 (0032): whether the post-game rule check ran (a rolled Rift game with a rule).';
comment on column public.games.rule_check is
  'M15.3 (0032): @customs/core checkMode''s verdict as JSON (kind sides: blue/red kept|broke|unknown with champion keys; kind lanes: per lane). Champion keys and sides only, never a player (R7).';

-- The R2 fix in the fallback: a game whose insert names no mode takes its lobby's lock first,
-- then the group's standing mode (0024/0030's body), then normal.
create or replace function public.games_stamp_mode() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mode is null and new.lobby_id is not null then
    select l.lock_mode into new.mode
    from public.lobbies l
    where l.id = new.lobby_id;
  end if;

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
  'M14.29, M14.46, M15.3 (0032): stamps games.mode when the insert did not name one: the lobby''s lock_mode (taken at Roll, R2), else the group''s group_modes.mode, else normal. Trigger only.';

revoke all on function public.games_stamp_mode() from public, anon, authenticated;

commit;
