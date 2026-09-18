-- 0017_fearless.sql
--
-- Fearless draft (M10): the champions this group has played since an admin last cleared
-- the pool, banned from the next custom until that reset.
--
-- The pool is **derived, not stored**. `game_players.champion_id` already names who locked
-- what. This table is only the cursor: games with `started_at > reset_at` are in the pool,
-- unique champion ids, first-appearance order. A second companion posting the same game
-- cannot double-append, because nothing is appended.
--
--   id         always 1. A check and a primary key, so there is one cursor, not a log.
--   reset_at   when an admin last cleared the pool. **Default now() on first insert**, so
--              deploying this migration does not dump the group's whole history into the
--              ban list — the pool is empty until the next Rift custom lands.
--   reset_by   `players.id` of the admin who pressed it, or null for the migration row.
--   updated_at last write, same trigger as the other singleton tables.
--
-- The companion never auto-bans. Riot's line is that we do not touch champion select;
-- this list is for humans, on the tonight page and in Discord.
--
-- Summoner's Rift only, at read time: ARAM has no draft. Remakes and short games are
-- dropped by the same `gateGame` every other counted surface uses.
--
-- RLS: public read (the tonight page is anonymous), no write policy. The API writes with
-- the service role. Published to `supabase_realtime` so an admin reset replaces the card
-- the same way a game landing does.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

create table public.fearless_state (
  id         smallint    primary key check (id = 1),
  reset_at   timestamptz not null default now(),
  reset_by   uuid        references public.players (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.fearless_state is
  'Singleton cursor for the fearless-draft pool (M10). The pool itself is unique champion_id values from Rift games with started_at > reset_at. Service role writes; anon reads.';
comment on column public.fearless_state.id is
  'Always 1. The check is what makes this a singleton rather than a log.';
comment on column public.fearless_state.reset_at is
  'Games that started after this instant are in the pool. Seeded to now() so history does not flood the first list.';
comment on column public.fearless_state.reset_by is
  'The admin who last cleared the pool, or null for the row the migration inserted.';

create trigger fearless_state_set_updated_at
  before update on public.fearless_state
  for each row execute function public.set_updated_at();

insert into public.fearless_state (id) values (1);

alter table public.fearless_state enable row level security;

create policy "fearless state is publicly readable" on public.fearless_state
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.fearless_state from anon, authenticated;

alter publication supabase_realtime add table public.fearless_state;
