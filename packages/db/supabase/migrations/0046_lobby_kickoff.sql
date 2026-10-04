-- 0046_lobby_kickoff.sql (M21.4; decision rows M21 D1 and 2026-10-05 "M21 owner calls")
--
-- The kickoff record: the teams that actually started the game, whether they are the bot's roll,
-- and Kustom's odds for them when they are not. Written once, by `POST /api/companion/game`
-- `in_progress` (apps/web/lib/ingest/kickoff.ts, service role), in the request that moves the
-- lobby to `in_game`, from the frozen `lobby_members` sides (the client's sides as champ select
-- began; the M21.1 audit found them equal to the end-of-game sides in 95 of 96 ten-sided games).
-- Never rewritten: the write is conditional on `kickoff_kind is null`, so a retry or a second
-- companion writes nothing. The end-of-game block's sides stay final for every surface; a kickoff
-- record that disagrees with them is logged by the reader and otherwise ignored.
--
--   kickoff_kind           rolled    a chosen split exists and the sided members are its teams
--                                    (roles ignored), on its sides or on swapped sides;
--                          custom    a chosen split exists and the teams differ;
--                          unrolled  no chosen split.
--                          null      no kickoff record: the lobby never started under this build,
--                                    or its sided members were not two non-empty equal sides of at
--                                    most five (a 5v4, a 3v0); the page behaves as before M21.
--   kickoff_blue/red       the puuids on side 100 / 200 at kickoff (spectators and sitters, side
--                          null or is_spectator, are on no team). Equal sizes, 1 to 5 each, no
--                          puuid on both sides: a 2v2 to 4v4 gets a record too (M21.1 note b).
--   kickoff_swapped        rolled only: the split's teams played on swapped sides (M21.1 note a).
--                          The split's odds are blue's; a reader flips them for the real sides.
--   kickoff_blue_win_prob  custom / unrolled only: core's `winProbability` over the summed
--                          all-time `ratings.r` of each side (1200 for no row), the balancer's and
--                          the fold's inputs. Stored for a not-rated or ARAM game too; whether it
--                          is shown is the reader's rule (M15.18). Null for rolled: the split's
--                          stored `blue_win_prob` is the number, never recomputed.
--   kickoff_odds_model     'kustom' beside a stored probability, else null (as `splits.odds_model`).
--   kickoff_at             when the record was written.
--
-- `splits` is never rewritten (M21 rules): `custom` is what marks the chosen split as not played.
-- Ratings are unchanged: the fold reads `game_players.side`, never these columns.
--
-- Reads: `lobbies` is column-granted (0028); the new columns are granted to anon and authenticated
-- like the lock columns (Tonight reads them). They name players by puuid only, which
-- `lobby_members` already publishes, and odds, which `splits` already publishes.
--
-- No function, no trigger: nothing here needs a throwaway check. Additive and nullable (the
-- boolean defaults false): the previous build ignores the columns, so a rollback needs nothing.
-- One explicit transaction, so a column without its grant or its checks never exists.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

alter table public.lobbies
  add column kickoff_kind text,
  add column kickoff_blue text[],
  add column kickoff_red text[],
  add column kickoff_swapped boolean not null default false,
  add column kickoff_blue_win_prob double precision,
  add column kickoff_odds_model text,
  add column kickoff_at timestamptz;

alter table public.lobbies
  add constraint lobbies_kickoff_kind check (kickoff_kind in ('rolled', 'custom', 'unrolled')),
  -- All or nothing: a record has its kind, both sides and its time.
  add constraint lobbies_kickoff_whole check (
    (kickoff_kind is null and kickoff_blue is null and kickoff_red is null and kickoff_at is null)
    or (kickoff_kind is not null and kickoff_blue is not null and kickoff_red is not null and kickoff_at is not null)
  ),
  add constraint lobbies_kickoff_sides check (
    kickoff_kind is null
    or (
      cardinality(kickoff_blue) between 1 and 5
      and cardinality(kickoff_blue) = cardinality(kickoff_red)
      and not (kickoff_blue && kickoff_red)
      and array_position(kickoff_blue, null) is null
      and array_position(kickoff_red, null) is null
    )
  ),
  add constraint lobbies_kickoff_swapped check (not kickoff_swapped or kickoff_kind = 'rolled'),
  add constraint lobbies_kickoff_odds check (
    (
      (kickoff_kind is null or kickoff_kind = 'rolled')
      and kickoff_blue_win_prob is null
      and kickoff_odds_model is null
    )
    or (
      kickoff_kind in ('custom', 'unrolled')
      and kickoff_blue_win_prob is not null
      and kickoff_blue_win_prob between 0 and 1
      and kickoff_odds_model = 'kustom'
    )
  );

comment on column public.lobbies.kickoff_kind is
  'M21.4 (0046): rolled (the chosen split''s teams, sides swapped or not), custom (a chosen split, other teams) or unrolled (no chosen split), classified once at the move to in_game from the frozen lobby_members sides. Null: no kickoff record.';
comment on column public.lobbies.kickoff_blue is
  'M21.4 (0046): the puuids on side 100 when the game started (frozen lobby_members, spectators excluded). Same size as kickoff_red, 1 to 5.';
comment on column public.lobbies.kickoff_red is
  'M21.4 (0046): the puuids on side 200 when the game started (frozen lobby_members, spectators excluded). Same size as kickoff_blue, 1 to 5.';
comment on column public.lobbies.kickoff_swapped is
  'M21.4 (0046): rolled only. The chosen split''s teams played on swapped sides; the split''s blue_win_prob is then the real red side''s chance.';
comment on column public.lobbies.kickoff_blue_win_prob is
  'M21.4 (0046): custom / unrolled only. Blue''s chance from core winProbability over each side''s summed all-time ratings.r (1200 for no row) at kickoff. Null for rolled: read the split''s blue_win_prob.';
comment on column public.lobbies.kickoff_odds_model is
  'M21.4 (0046): ''kustom'' beside kickoff_blue_win_prob, else null.';
comment on column public.lobbies.kickoff_at is
  'M21.4 (0046): when the kickoff record was written (the in_progress post that moved the lobby to in_game, or its retry).';

grant select (
  kickoff_kind,
  kickoff_blue,
  kickoff_red,
  kickoff_swapped,
  kickoff_blue_win_prob,
  kickoff_odds_model,
  kickoff_at
) on public.lobbies to anon, authenticated;

commit;
