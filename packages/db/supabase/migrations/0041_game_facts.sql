-- 0041_game_facts.sql (database performance plan, redesign/research/db-performance.md finding 1, option J)
--
-- game_facts: rawFactsFromUnknown(games.raw) (apps/web/lib/stats/rawFacts.ts), stored by the TypeScript
-- reader itself, so the Stats Records and Champions folds, the /games cards and the daily game stop reading
-- about 60 KB of raw per game for about 5 KB of facts. One row per game; `facts` is exactly what the function
-- returns ({ byPuuid, bans }).
--
-- Derived and rebuildable from raw, never a source of truth:
--   - written at ingest (lib/ingest/game.ts: the first post, and the ban enrichment that rewrites raw);
--   - `pnpm --filter web backfill-game-facts` fills every game without a row and recomputes every row whose
--     facts_version is below the code's (GAME_FACTS_VERSION, apps/web/lib/stats/gameFacts.ts);
--   - a reader that meets a missing or older row reads that game's raw instead, so a deploy before the
--     backfill is slower for those games, never wrong.
--
-- The composite foreign key keeps the row in its game's group and deletes it with the game.
--
-- Public read like games (the same facts are in games.raw, which anon already reads). Written by the
-- service role only. Not in supabase_realtime: nothing listens for it.

begin;

create table public.game_facts (
  game_id uuid primary key,
  group_id uuid not null references public.groups(id),
  facts_version smallint not null check (facts_version >= 1),
  facts jsonb not null check (
    jsonb_typeof(facts) = 'object'
    -- `is not distinct from`: a missing key is null, and a plain = would let null through the check.
    and jsonb_typeof(facts -> 'byPuuid') is not distinct from 'object'
    and jsonb_typeof(facts -> 'bans') is not distinct from 'array'
  ),
  updated_at timestamptz not null default now(),
  constraint game_facts_game_group_fkey foreign key (game_id, group_id)
    references public.games(id, group_id) on delete cascade
);

comment on table public.game_facts is
  '0041: rawFactsFromUnknown(games.raw), stored at ingest by the TypeScript reader (lib/stats/gameFacts.ts). Derived; rebuildable from raw with backfill-game-facts. A facts_version below the code''s means recompute.';

create index game_facts_group_id_idx on public.game_facts (group_id);

alter table public.game_facts enable row level security;

create policy "game facts are publicly readable" on public.game_facts
  for select to anon, authenticated using (true);

revoke all on public.game_facts from public, anon, authenticated;
grant select on public.game_facts to anon, authenticated;
grant select, insert, update, delete on public.game_facts to service_role;

commit;
