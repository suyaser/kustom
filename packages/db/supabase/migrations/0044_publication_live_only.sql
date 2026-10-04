-- 0044_publication_live_only.sql (M19.11)
--
-- Player and lobby rows leave the anon Realtime publication (`04-decisions.md`, 2026-10-04: a
-- per-group `group_live` signal replaces the table subscriptions, after which player and lobby
-- tables leave the anon Realtime publication).
--
--   removed   lobbies, lobby_members, splits, games, game_players, ratings
--   kept      group_live (0037), group_modes (0024), fearless_state (0017)
--
-- **Why (security, not cost).** `lobby_members` and `splits` carry no `group_id`, so a Realtime
-- filter cannot scope them to a group and their RLS lets anon select every row: every change to
-- either reached any anon subscriber of any group. The other four are filterable, but an
-- unfiltered anon subscriber heard them for every group too. Nothing needs them any more: Tonight
-- listens to its own group's `group_live` row (M19.10) and re-reads through the server, and the
-- Mode card's `group_modes` / `fearless_state` subscriptions are filtered `group_id=eq.<id>`.
-- PostgREST reads are unchanged: the tables stay publicly readable under the same RLS and column
-- privileges; only their change events stop.
--
-- **No column list on group_modes and fearless_state** (verified on the local stack 2026-10-04,
-- Realtime v2.73.2, Postgres 17.6). Realtime's postgres_changes decodes the WAL with wal2json
-- (`realtime.list_changes`: `add-tables` from `pg_publication_tables`, table names only) and never
-- reads a publication's column list: with `group_modes` published as
-- `(group_id, mode, updated_at, pending_rule, pending_class_tag, rated_override, version)` a
-- service-role subscriber still received `set_by` and `pending_set_by`. A column list would be a
-- protection that does not protect. What keeps `set_by`, `pending_set_by` and `reset_by` out of an
-- anon or authenticated payload is the column privilege (0029, and the later grants that left
-- `pending_set_by` out): Realtime only puts into a payload the columns the subscriber's role may
-- select, and the same probe's anon subscriber received neither id. The M19.11 test asserts that.
--
-- `drop table` refuses a table that is not in the publication, which is right: this file runs once,
-- on a database where all six are published (0001). One explicit transaction, so no window where
-- some are gone and some are not.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

alter publication supabase_realtime drop table
  public.lobbies,
  public.lobby_members,
  public.splits,
  public.games,
  public.game_players,
  public.ratings;

commit;
