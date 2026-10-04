-- 0040_games_raw_lz4.sql (database performance plan, redesign/research/db-performance.md finding 11)
--
-- games.raw stored with lz4 instead of the default pglz. On the plan's seed the table went from 293 MB to
-- 116 MB and a detoast got about 3x faster, which every remaining raw reader pays (the one-game readers and
-- the ban enrichment read).
--
-- SET COMPRESSION only affects values written afterwards, so the UPDATE re-stores every existing value.
-- `raw || '{}'` builds a new datum with identical content (jsonb concatenation with an empty object), and a
-- new datum is compressed with the column's method. Nothing else about a row changes; the generated
-- game_mode (0039) recomputes to the same value. No trigger fires on a games UPDATE (games_stamp_mode is
-- BEFORE INSERT only).
--
-- Run off-night, together with 0039 (both rewrite games): until M19.11 takes games out of the Realtime
-- publication, every re-stored row is one UPDATE event to every subscribed Tonight page.
--
-- Needs a server built with lz4 (Postgres 14+ with --with-lz4; every Supabase image is). On a server
-- without it the ALTER fails and the transaction rolls back. Check first: docs/runbooks/db-performance.md.

begin;

alter table public.games alter column raw set compression lz4;
update public.games set raw = raw || '{}'::jsonb;

commit;
