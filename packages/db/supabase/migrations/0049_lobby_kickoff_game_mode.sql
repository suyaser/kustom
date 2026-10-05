-- 0049_lobby_kickoff_game_mode.sql (M21.12)
--
-- The game mode the companion read from the gameflow session at game start, stored beside the kickoff
-- record (0046). The server used to learn a game was an ARAM only at the end of game, so an ARAM played
-- on custom or unrolled teams showed kickoff odds in game (M21.5) and got a `Game on` post (M21.6).
--
--   kickoff_game_mode  text, null: upper case word as the client names it (`CLASSIC`, `ARAM`, ...) from
--                      `gameData.queue.gameMode`, else `map.gameMode`. Written in the same conditional
--                      update as the rest of the record (apps/web/lib/ingest/kickoff.ts), so it is
--                      never rewritten. Null: an older companion (no field), a session that named no
--                      mode, or no kickoff record. Readers treat null as "not known, as before".
--
-- Additive and nullable; the previous build ignores the column, so a rollback needs nothing. Granted
-- to anon and authenticated like the other kickoff columns (Tonight reads it; it is a public word).
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

alter table public.lobbies
  add column kickoff_game_mode text;

alter table public.lobbies
  add constraint lobbies_kickoff_game_mode check (
    kickoff_game_mode is null
    or (kickoff_kind is not null and kickoff_game_mode ~ '^[A-Z0-9_]{1,32}$')
  );

comment on column public.lobbies.kickoff_game_mode is
  'M21.12 (0049): the session''s game mode at game start (upper case: CLASSIC, ARAM, ...), written with the kickoff record. Null: an older companion, no mode named, or no kickoff record.';

grant select (kickoff_game_mode) on public.lobbies to anon, authenticated;

commit;
