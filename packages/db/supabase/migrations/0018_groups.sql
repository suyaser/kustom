-- 0018_groups.sql (M13.2)
--
-- Kustom stops assuming one friend group. A **group** is its own world: its own lobbies, games,
-- ratings, fearless list, daily guess, Discord channel and admins (`04-decisions.md`, the
-- 2026-10-03 rows). A **person** is still one `players` row keyed by PUUID, whichever groups they
-- are in, and that table gains and loses no column here.
--
-- This migration is the schema and the one backfill, and nothing else. **It lands with no app
-- change:** every new `group_id` column carries a temporary default of the original group's id,
-- every new key is added beside the old one rather than instead of it, and every `on conflict`
-- target the app uses today -- `ratings (player_id, season_id)`, `fearless_state.id = 1`,
-- `daily_mysteries (day)`, `window_posts (kind, window_start)`, `discord_config (guild_id)` -- is
-- still a real key. With exactly one group in the table the old keys and the new ones accept and
-- refuse exactly the same rows, so nothing the app writes can tell the difference.
--
-- What comes after, so nobody "finishes" this file by editing it:
--
--   0019 (M13.3)  drops the old `ratings` primary key and the `fearless_state` singleton check,
--                 in the commit whose code upserts on the per-group keys added here.
--   0020 (M13.4)  drops the rest of the old keys and **every temporary default below**. From then
--                 on an insert that forgets its group fails, which is the point.
--
-- **One key is deliberately not added here: `discord_config unique (group_id)`.** The brief lists
-- it, but unlike every other per-group key it is *stricter* than the key it sits beside: today
-- `discord_config` is keyed by `guild_id` and the app tolerates more than one row (the oldest row
-- with a webhook posts, and `/admin/discord` warns when there is a second). `POST
-- /api/admin/discord-config` upserts on `guild_id`, and `admin.integration.test.ts` writes two
-- guilds' rows on purpose. With every row defaulted into the one group, a unique on `group_id`
-- would turn a second guild into a 23505 -- an app change and a test change, which is exactly
-- what this migration exists not to be -- and it would fail outright on any deployment that
-- already holds two rows. So the column, its default and its not-null land here; the unique goes
-- in M13.4's `0020`, the same migration that drops the `guild_id` key and the code that upserts
-- on it, after collapsing any second row.
--
-- **Unchanged on purpose.** `games.lcu_game_id` and the live-party index on
-- `lobbies.lcu_party_id` stay global: a game belongs to exactly one group, and a second companion
-- in the same game is a no-op even when it posts for another group (decision row 2026-10-03).
-- `players.is_admin`, `players.backfill_requested_at` and `players.backfill_approved_at` are
-- copied onto memberships below and left in place, unread from M13.4 on, dropped by a later
-- cleanup that is not this milestone. `lobby_members`, `splits` and the three
-- `daily_mystery_*` child tables reach their group through their parent and get no column. The
-- Realtime publication is unchanged (filtering by group is M13.9's).
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------

create table public.groups (
  id         uuid        primary key default gen_random_uuid(),
  slug       text        not null unique,
  name       text        not null,
  created_by uuid        references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- 3 to 32 lowercase letters, digits and dashes, not starting or ending with a dash. The
  -- 32-character cap is load-bearing: a uuid is 36, so a slug can never look like the
  -- `/g/<gameId>` links M11.4 already put in Discord (M13.9 redirects those).
  -- `groupSlugSchema` in packages/db/src/schemas/groups.ts is the same rule, and
  -- `groups.integration.test.ts` checks the two agree on one table of cases.
  constraint groups_slug_shape check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  -- Words the app's own routes use under `/g/` or at the root. `og` and `g` cannot pass the
  -- length rule anyway; they are listed so the list is the list.
  constraint groups_slug_not_reserved check (
    slug <> all (array['new', 'join', 'admin', 'api', 'og', 'auth', 'ops', 'g'])
  ),
  -- Decision row 2026-10-03 (self-serve groups): a name is 1 to 40 characters.
  constraint groups_name_length check (length(btrim(name)) between 1 and 40)
);

comment on table public.groups is
  'M13: one friend group -- its own lobbies, games, ratings, fearless list, daily guess, Discord channel and admins. Service role only; anon reads groups_public.';
comment on column public.groups.slug is
  'The /g/<slug> path segment. 3 to 32 of [a-z0-9-], no leading or trailing dash, not a reserved word. Immutable in v1: it is in every pasted link.';
comment on column public.groups.created_by is
  'The Supabase auth user who created the group (M13.5), or null for the original group. An auth id, not a public fact: not in groups_public.';

-- The original group. Fixed id so local resets, tests and the temporary defaults below are
-- deterministic. The slug is the one literal the user may change **before** this is applied.
insert into public.groups (id, slug, name, created_by)
values ('00000000-0000-0000-0000-000000000001', 'customs', 'Customs Night', null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- group_memberships
--
-- `role` is the discriminated union, not a boolean (`groupRoleSchema`). Text with a check rather
-- than an enum, like `window_posts.kind`: one migration to widen instead of a type plus an alter.
-- The two backfill columns are M5.1's per-player approval (`0004`) moved to per group per player,
-- because approving somebody's history is a group admin's call about their group.
-- ---------------------------------------------------------------------------

create table public.group_memberships (
  group_id              uuid        not null references public.groups (id),
  player_id             uuid        not null references public.players (id) on delete cascade,
  role                  text        not null default 'member' check (role in ('member', 'admin')),
  created_at            timestamptz not null default now(),
  backfill_requested_at timestamptz,
  backfill_approved_at  timestamptz,
  primary key (group_id, player_id)
);

-- "Which groups is this PUUID in" (M13.3's overlay/groups, M13.8's picker) and the cascade from
-- a deleted player. The primary key already serves "who is in this group".
create index group_memberships_player_id_idx on public.group_memberships (player_id);

comment on table public.group_memberships is
  'M13: who is in which group, and as what. Service role only -- who is a group''s admin is not public; anon reads group_members_public (group_id, player_id).';
comment on column public.group_memberships.role is
  'member | admin. A group can never have zero admins (M13.4 refuses demoting the last one).';
comment on column public.group_memberships.backfill_requested_at is
  'M5.1, per group: when this player''s companion first asked to send match history to this group. Set once, never moved.';
comment on column public.group_memberships.backfill_approved_at is
  'M5.1, per group: when a group admin allowed it. Null means no; revoking sets it back to null.';

-- ---------------------------------------------------------------------------
-- group_id on the ten tables
--
-- Each column is added with the original group's id as its default, which fills every existing
-- row, then backfilled explicitly (a no-op after the default, written down so the intent is in
-- the file and not in Postgres's fast-default behaviour), then made not null. The default stays:
-- it is what lets every insert the app does today keep working without naming a group. **M13.4's
-- 0020 drops all ten defaults.**
-- ---------------------------------------------------------------------------

alter table public.ratings
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);
alter table public.lobbies
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);
alter table public.games
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);
alter table public.game_players
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);
alter table public.companion_tokens
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);
alter table public.companion_commands
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);
alter table public.fearless_state
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);
alter table public.daily_mysteries
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);
alter table public.window_posts
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);
alter table public.discord_config
  add column group_id uuid default '00000000-0000-0000-0000-000000000001' references public.groups (id);

update public.ratings            set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;
update public.lobbies            set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;
update public.games              set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;
update public.game_players       set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;
update public.companion_tokens   set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;
update public.companion_commands set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;
update public.fearless_state     set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;
update public.daily_mysteries    set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;
update public.window_posts       set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;
update public.discord_config     set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;

alter table public.ratings            alter column group_id set not null;
alter table public.lobbies            alter column group_id set not null;
alter table public.games              alter column group_id set not null;
alter table public.game_players       alter column group_id set not null;
alter table public.companion_tokens   alter column group_id set not null;
alter table public.companion_commands alter column group_id set not null;
alter table public.fearless_state     alter column group_id set not null;
alter table public.daily_mysteries    alter column group_id set not null;
alter table public.window_posts       alter column group_id set not null;
alter table public.discord_config     alter column group_id set not null;

comment on column public.ratings.group_id is
  'M13: ratings are per group -- one rating per person per group (ratings_group_player_season_key). Temporary default = the original group until M13.4''s 0020.';
comment on column public.lobbies.group_id is
  'M13: the group whose companion posted this lobby first; it keeps it. lcu_party_id stays globally deduped. Temporary default until 0020.';
comment on column public.games.group_id is
  'M13: a game belongs to exactly one group (its lobby''s, or the token''s with no lobby). lcu_game_id stays globally unique. Temporary default until 0020.';
comment on column public.game_players.group_id is
  'M13: always its game''s group, enforced by game_players_game_group_fkey (game_id, group_id) -> games (id, group_id). Temporary default until 0020.';
comment on column public.companion_tokens.group_id is
  'M13: the one group this token posts to. The server takes the group from the token, never from a header or body. Temporary default until 0020.';
comment on column public.companion_commands.group_id is
  'M13: the target token''s group. Temporary default until 0020.';
comment on column public.fearless_state.group_id is
  'M13: one fearless cursor per group (fearless_state_group_id_key). The id = 1 singleton is dropped by M13.3''s 0019. Temporary default until 0020.';
comment on column public.daily_mysteries.group_id is
  'M13: each group has its own daily challenge and counts its own #41. Temporary default until 0020.';
comment on column public.window_posts.group_id is
  'M13: each group''s weekly and monthly post is claimed separately. Temporary default until 0020.';
comment on column public.discord_config.group_id is
  'M13: the group these channels belong to. Two groups may share a Discord server with different channels. Unique per group from M13.4''s 0020 (not here: see the header of 0018). Temporary default until 0020.';

-- ---------------------------------------------------------------------------
-- Keys, added beside the old ones
--
-- Each is the per-group form of a key the app already relies on. With one group they are
-- equivalent to the old key, which is why adding them changes nothing; 0019 and 0020 drop the
-- old ones with the code that stops using them.
-- ---------------------------------------------------------------------------

-- One rating per person per group (decision row 2026-10-03). Beside the old primary key
-- (player_id, season_id), which 0019 drops.
alter table public.ratings
  add constraint ratings_group_player_season_key unique (group_id, player_id, season_id);

-- One fearless cursor per group, inserted with the group (M13.5). Beside `id = 1`, which 0019
-- drops.
alter table public.fearless_state
  add constraint fearless_state_group_id_key unique (group_id);

-- Each group has its own challenge per day and counts its own `#41`. Beside `day` and
-- `(kind, challenge_number)`, which 0020 drops.
alter table public.daily_mysteries
  add constraint daily_mysteries_group_day_key unique (group_id, day);
alter table public.daily_mysteries
  add constraint daily_mysteries_group_kind_challenge_number_key unique (group_id, kind, challenge_number);

-- Each group's closed week is posted once. Beside the primary key (kind, window_start), which
-- 0020 drops.
alter table public.window_posts
  add constraint window_posts_group_kind_window_start_key unique (group_id, kind, window_start);

-- A game_players row is always in its game's group, as a constraint and not a trigger. The
-- composite foreign key needs a unique on the pair it points at; `id` alone is already unique,
-- so this one costs an index and refuses nothing.
alter table public.games
  add constraint games_id_group_id_key unique (id, group_id);

-- The composite key **replaces** the plain `game_players_game_id_fkey` from `0001` rather than
-- sitting beside it. Two foreign keys between the same two tables are two PostgREST
-- relationships, and every embed the app does between them -- `games!inner(started_at)` from
-- `game_players`, `game_players!inner(...)` from `games`, in the board, the rebuild, balance,
-- fearless and admin -- would answer PGRST201 "more than one relationship was found" (seen on
-- the local stack with both in place). Nothing is lost by the swap: `game_id` and `group_id` are
-- both not null, so the composite key checks that the game exists exactly as the plain one did,
-- and it cascades the same way.
--
-- `on update` is left at no action on purpose: moving a game between groups is reserved for v1,
-- and while its players point at it the database refuses to do it by accident.
alter table public.game_players
  drop constraint game_players_game_id_fkey;
alter table public.game_players
  add constraint game_players_game_group_fkey
  foreign key (game_id, group_id) references public.games (id, group_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Backfill the memberships of the original group
--
-- Who was in the group's nights:
--   * everybody in `lobby_members` (a player only ever in a lobby, never a game, still was), or
--   * everybody in `game_players`, or
--   * everybody who holds a companion token, revoked or not -- an admin minted it for this group,
--     and the M5.1 backfill request columns only ever get set through one, or
--   * everybody with `players.is_admin`, who is `admin` rather than `member`.
-- A player row with none of those (a lobby-less, game-less, token-less row) gets no membership;
-- M13.3's lazy rule adds one the first time they appear in a lobby or a game.
--
-- The M5.1 approval pair is copied as it stands, so a companion that was approved yesterday is
-- approved for the original group today.
-- ---------------------------------------------------------------------------

insert into public.group_memberships (group_id, player_id, role, backfill_requested_at, backfill_approved_at)
select
  '00000000-0000-0000-0000-000000000001',
  p.id,
  case when p.is_admin then 'admin' else 'member' end,
  p.backfill_requested_at,
  p.backfill_approved_at
from public.players p
where p.is_admin
   or exists (select 1 from public.lobby_members lm where lm.player_id = p.id)
   or exists (select 1 from public.game_players gp where gp.player_id = p.id)
   or exists (select 1 from public.companion_tokens ct where ct.player_id = p.id)
on conflict (group_id, player_id) do nothing;

-- ---------------------------------------------------------------------------
-- bootstrap_admin, new body
--
-- `BOOTSTRAP_ADMIN_PUUID` keeps working: as before, insert the player or promote them, and now
-- also upsert an `admin` membership in the original group. Still idempotent; the return type is
-- unchanged, so the caller in apps/web does not move. `create or replace` keeps the owner and the
-- grants; they are restated below anyway so the privilege is visible in the file that changed it.
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_admin(p_puuid text) returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  if p_puuid is null or length(p_puuid) = 0 then
    raise exception 'bootstrap_admin: puuid is required';
  end if;

  insert into public.players (puuid, is_admin)
  values (p_puuid, true)
  on conflict (puuid) do update set is_admin = true
  returning * into v_player;

  insert into public.group_memberships (group_id, player_id, role)
  values ('00000000-0000-0000-0000-000000000001', v_player.id, 'admin')
  on conflict (group_id, player_id) do update set role = 'admin';

  return v_player;
end;
$$;

comment on function public.bootstrap_admin(text) is
  'Insert-or-promote the player with this PUUID to admin, and make them an admin of the original group (M13.2). Idempotent. Service role only.';

revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_admin(text) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Both new tables: RLS on, **no policy at all**, every grant taken from anon and authenticated.
-- The public shape of each is a view, the same way `players_public` is the public shape of
-- `players` (`0001_init.sql`): column grants on the base table would break PostgREST's
-- `select=*`, and the views run as their owner (security_invoker off) so they can read a base
-- table anon cannot.
--
--   groups_public          id, slug, name. `created_by` is an auth user id, not a public fact.
--   group_members_public   group_id, player_id. Who is in a group is the leaderboard; who is
--                          its admin, and whose history is approved, is not.
--
-- The ten tables that gained a column keep exactly the policies they had: the public-read ones
-- stay public-read and the private ones stay private.
-- ---------------------------------------------------------------------------

alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;

revoke all on public.groups from anon, authenticated;
revoke all on public.group_memberships from anon, authenticated;

create view public.groups_public as
select id, slug, name
from public.groups;

comment on view public.groups_public is
  'groups without created_by. This is what anon and the web client read; the base table is service-role only.';

create view public.group_members_public as
select group_id, player_id
from public.group_memberships;

comment on view public.group_members_public is
  'Who is in which group, without role or the backfill columns. The base table is service-role only.';

revoke all on public.groups_public from anon, authenticated;
revoke all on public.group_members_public from anon, authenticated;
grant select on public.groups_public to anon, authenticated;
grant select on public.group_members_public to anon, authenticated;
