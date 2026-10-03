-- 0020_group_keys_web_and_defaults_off.sql (M13.4)
--
-- The last migration of M13's server half that removes a single-group assumption
-- (`02-milestones.md` M13.4, `04-decisions.md` 2026-10-03). `0018` added every per-group key beside
-- the old one and gave the ten `group_id` columns a temporary default so it could land with no app
-- change; `0019` dropped the two old keys the companion routes wrote through. This drops the rest,
-- in the commit whose code -- the session and admin routes, the three crons, the daily mystery --
-- writes through the per-group keys:
--
--   daily_mysteries  `(day)` and `(kind, challenge_number)` go. Each group has its own challenge per
--                    day and counts its own `#41` (`daily_mysteries_group_day_key`,
--                    `daily_mysteries_group_kind_challenge_number_key`, from 0018).
--   window_posts     the `(kind, window_start)` primary key goes and the 0018 unique
--                    `(group_id, kind, window_start)` becomes the primary key: each group's closed
--                    week is claimed and posted on its own.
--   discord_config   the `guild_id` primary key goes; `group_id` becomes the primary key, which is
--                    the unique 0018 deliberately did not add (see its header). Two groups may share
--                    a Discord server with different channels, so `guild_id` is no longer unique at
--                    all. Any second row a group already holds is collapsed first (below).
--
-- **And the ten temporary defaults go.** From here an insert into `ratings`, `lobbies`, `games`,
-- `game_players`, `companion_tokens`, `companion_commands`, `fearless_state`, `daily_mysteries`,
-- `window_posts` or `discord_config` that does not name its group fails with a not-null violation
-- instead of landing in the original group. That is the point: a writer that forgot the group is a
-- bug that would pour one group's data into another's, and it should be loud on the first try.
--
-- One function rides along, because the rule it enforces needs a lock the app cannot take:
--
--   set_group_member_role  promote or demote a member (`POST /api/admin/members/role`). A group can
--                          never be left with no admin (decision row 2026-10-03): demoting the last
--                          one answers `last_admin` and writes nothing. The group's row is locked
--                          for the duration, so two admins demoting each other at the same moment
--                          cannot both win and leave the group with nobody.
--
-- Unchanged on purpose: `games.lcu_game_id` and the live-party index on `lobbies.lcu_party_id` stay
-- global (a game belongs to exactly one group). `players.is_admin` and the two `players.backfill_*`
-- columns stay in place and are unread by the app from M13.4 on; dropping them is a later cleanup.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- ---------------------------------------------------------------------------
-- daily_mysteries: per-group keys only
-- ---------------------------------------------------------------------------

alter table public.daily_mysteries drop constraint daily_mysteries_day_key;
alter table public.daily_mysteries drop constraint daily_mysteries_kind_challenge_number_key;

comment on table public.daily_mysteries is
  'One daily challenge per group per civil date in CUSTOMS_NIGHT_TZ (M5.32, M8.4, per group since M13.4). Each group numbers its own challenges per kind. Service role only.';
comment on column public.daily_mysteries.group_id is
  'M13: the group whose games this challenge is drawn from. Unique with day (daily_mysteries_group_day_key) and with (kind, challenge_number).';

-- ---------------------------------------------------------------------------
-- window_posts: the per-group key becomes the primary key
--
-- The same move 0019 made on `ratings`: drop the old primary key and the 0018 unique, and put the
-- three columns back as the primary key, so the table keeps one and PostgREST's
-- `on_conflict=group_id,kind,window_start` infers it.
-- ---------------------------------------------------------------------------

alter table public.window_posts drop constraint window_posts_pkey;
alter table public.window_posts drop constraint window_posts_group_kind_window_start_key;
alter table public.window_posts
  add constraint window_posts_pkey primary key (group_id, kind, window_start);

comment on table public.window_posts is
  'One row per group per closed window the weekly/monthly Discord post has claimed (M5.13, per group since M13.4). The primary key (group_id, kind, window_start) is what makes GET /api/cron/window safe to call at any cadence. Service role only: no RLS policy at all.';
comment on column public.window_posts.group_id is
  'M13: the group whose channel this window was posted to. A group with no webhook gets no row.';

-- ---------------------------------------------------------------------------
-- discord_config: one row per group
--
-- Collapse first. Before M13 the table was keyed by guild and the app tolerated a second row (the
-- oldest row with a webhook posted, `/admin/discord` warned about the rest), and 0018 put every
-- existing row into the original group. The row kept for each group is **the one the app was
-- already posting with** -- the oldest row that has a webhook, else the oldest row -- so nothing a
-- channel receives changes. The others were already unread.
-- ---------------------------------------------------------------------------

delete from public.discord_config dc
using (
  select guild_id,
         row_number() over (
           partition by group_id
           order by (webhook_url is null), created_at, guild_id
         ) as rank
  from public.discord_config
) ranked
where dc.guild_id = ranked.guild_id
  and ranked.rank > 1;

alter table public.discord_config drop constraint discord_config_pkey;
alter table public.discord_config alter column guild_id set not null;
alter table public.discord_config
  add constraint discord_config_pkey primary key (group_id);

comment on table public.discord_config is
  'Webhook URL and channel ids, one row per group (M13.4). Two groups may share a guild with different channels, so guild_id is not unique. Contains a secret (the webhook URL); never readable by anon.';
comment on column public.discord_config.group_id is
  'M13: the group these channels belong to. The primary key: one Discord config per group.';

-- ---------------------------------------------------------------------------
-- The ten temporary defaults
-- ---------------------------------------------------------------------------

alter table public.ratings            alter column group_id drop default;
alter table public.lobbies            alter column group_id drop default;
alter table public.games              alter column group_id drop default;
alter table public.game_players       alter column group_id drop default;
alter table public.companion_tokens   alter column group_id drop default;
alter table public.companion_commands alter column group_id drop default;
alter table public.fearless_state     alter column group_id drop default;
alter table public.daily_mysteries    alter column group_id drop default;
alter table public.window_posts       alter column group_id drop default;
alter table public.discord_config     alter column group_id drop default;

comment on column public.ratings.group_id is
  'M13: ratings are per group -- one rating per person per group (ratings_pkey). No default since 0020: a writer names its group.';
comment on column public.lobbies.group_id is
  'M13: the group whose companion posted this lobby first; it keeps it. lcu_party_id stays globally deduped. No default since 0020.';
comment on column public.games.group_id is
  'M13: a game belongs to exactly one group (its lobby''s, or the token''s with no lobby). lcu_game_id stays globally unique. No default since 0020.';
comment on column public.game_players.group_id is
  'M13: always its game''s group, enforced by game_players_game_group_fkey (game_id, group_id) -> games (id, group_id). No default since 0020.';
comment on column public.companion_tokens.group_id is
  'M13: the one group this token posts to. The server takes the group from the token, never from a header or body. No default since 0020.';
comment on column public.companion_commands.group_id is
  'M13: the target token''s group. No default since 0020.';
comment on column public.fearless_state.group_id is
  'M13: one fearless cursor per group (fearless_state_group_id_key). No default since 0020.';

-- ---------------------------------------------------------------------------
-- set_group_member_role
--
-- The only writer of `group_memberships.role` outside `bootstrap_admin` and group creation. Returns
-- one word, which the route turns into a status:
--
--   'ok'          the role changed
--   'unchanged'   it already was that role (a repeat press: success, nothing written)
--   'not_member'  no such group, or the player is not a member of it (the route's 404)
--   'last_admin'  demoting the group's only admin (the route's 409); nothing written
--
-- `for update` on the group's row serializes every role change in that group, so the count of
-- admins read here is still true when the update lands. Locking the group row rather than the
-- admin rows also covers the insert-shaped races nobody has written yet (creation, M13.5).
-- ---------------------------------------------------------------------------

create or replace function public.set_group_member_role(p_group_id uuid, p_player_id uuid, p_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_admins  integer;
begin
  if p_role is null or p_role not in ('member', 'admin') then
    raise exception 'set_group_member_role: role must be member or admin';
  end if;

  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    return 'not_member';
  end if;

  select role into v_current
  from public.group_memberships
  where group_id = p_group_id and player_id = p_player_id
  for update;
  if not found then
    return 'not_member';
  end if;

  if v_current = p_role then
    return 'unchanged';
  end if;

  if v_current = 'admin' and p_role = 'member' then
    select count(*) into v_admins
    from public.group_memberships
    where group_id = p_group_id and role = 'admin';
    if v_admins <= 1 then
      return 'last_admin';
    end if;
  end if;

  update public.group_memberships
  set role = p_role
  where group_id = p_group_id and player_id = p_player_id;

  return 'ok';
end;
$$;

comment on function public.set_group_member_role(uuid, uuid, text) is
  'M13.4: promote or demote a member of a group. Returns ok | unchanged | not_member | last_admin; a group is never left with no admin. Locks the group row. Service role only.';

revoke all on function public.set_group_member_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_group_member_role(uuid, uuid, text) to service_role;
