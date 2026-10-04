-- 0034_fold_breakdown.sql (M14.58, M14.59)
--
-- Why each game moved a rating by as much as it did, stored by the fold that moved it. Today the
-- only per-game text is `As the N% side.` and nothing records what moved the number: the MVP/ACE
-- flags are recomputed at read time and the bonus share of a delta is computed nowhere. Decision
-- rows 2026-10-04 (M14.58: store the breakdown; M14.59 option (a): store the fold's own odds).
--
-- Four columns on `game_players`, written by the fold in the same write as `mu_after` (the live
-- fold, `lib/ingest/rating.ts`, and `rebuild-ratings`, `lib/ingest/rebuild.ts`):
--
--   fold_p              the win probability the fold's model gave THIS ROW'S SIDE, from the exact
--                       before-ratings handed to `rateGame` (core's `foldWinProbability`, which is
--                       the balancer's own `predictWin`). The game's blue probability is the blue
--                       rows' value; a red row stores 1 - it. Not `splits.blue_win_prob`: that is
--                       the bot's roll-time claim, where a newcomer is rated from rank, while the
--                       fold rates everybody from the stored rating or the 1200 seed (M14.59).
--   base_mu_after       `rateGame`'s mu_after BEFORE the MVP/ACE bonus, so the base delta and the
--                       award's effect are both exact (`mu_after` keeps the bonus).
--   award               the award that moved THIS rating: 'mvp', 'ace' or 'none'. 'none' is a real
--                       value (including a backfilled game whose roles were unknown, so nobody
--                       could be scored); null is "stored before 0034", never the same thing.
--   rated_games_before  this player's rated games in the group before this one, since the group's
--                       ratings epoch (`ratings.games` as the live fold read it; the rebuild's own
--                       running count). Core's `explainDelta` reads it for certainty (games 1-3
--                       new, the 10th settled), the same line the settling chip draws. Stored, not
--                       recounted at read time: it is the count the fold saw when it moved the
--                       number, and a read-time recount needs every earlier game of the group per
--                       row (and a backfill waiting for rebuild-ratings would shift it under rows
--                       whose numbers did not move).
--
-- **Nullable, no default, additive.** A row with base_mu_after null was stored before 0034, and
-- stays null until `pnpm --filter web rebuild-ratings` fills every rated game it folds (the web
-- falls back to `explainLegacyDelta` for those). Two checks keep the shape honest for a hand-written
-- UPDATE: the three breakdown columns are written together or not at all, and none of the four
-- outlives the rating it explains (a row whose `mu_after` is nulled by a rebuild gate is nulled
-- whole, in the same statement).
--
-- No RLS change: `public.game_players` is publicly readable column by column already
-- (`policy "game players are publicly readable"`, 0001_init.sql), and these are public game facts
-- (the same odds and award are already derivable from the public befores and stat columns).

begin;

alter table public.game_players
  add column fold_p double precision check (fold_p >= 0 and fold_p <= 1),
  add column base_mu_after double precision,
  add column award text check (award in ('mvp', 'ace', 'none')),
  add column rated_games_before integer check (rated_games_before >= 0);

alter table public.game_players
  add constraint game_players_breakdown_together check (
    (fold_p is null) = (base_mu_after is null) and (base_mu_after is null) = (award is null)
  ),
  add constraint game_players_breakdown_needs_rating check (
    mu_after is not null
    or (fold_p is null and base_mu_after is null and award is null and rated_games_before is null)
  );

comment on column public.game_players.fold_p is
  'M14.58/M14.59 (0034): the win probability the rating fold gave this row''s side, from the exact before-ratings handed to rateGame (core foldWinProbability = predictWin). A blue row stores the game''s blue probability; a red row 1 - it. Not splits.blue_win_prob (the bot''s roll-time odds). Null: stored before 0034.';
comment on column public.game_players.base_mu_after is
  'M14.58 (0034): rateGame''s mu_after before the MVP/ACE bonus; mu_after keeps the bonus. Null means the row was stored before 0034 (rebuild-ratings fills it).';
comment on column public.game_players.award is
  'M14.58 (0034): the award that moved this rating: mvp, ace or none (none includes a game nobody could be scored in). Null is unknown (stored before 0034), never the same as none.';
comment on column public.game_players.rated_games_before is
  'M14.58 (0034): this player''s rated games in the group before this one, since the ratings epoch, as the fold counted them. Drives the explanation''s certainty (games 1-3 new, the 10th settled). Null: stored before 0034.';

commit;
