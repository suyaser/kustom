-- 0036_kustom_rating.sql (M18.4)
--
-- Storage for the Kustom rating (M18, decision rows of 2026-10-04 "M18: ..."): `change = K ×
-- (result − expected) × share` on the Rating scale, everyone from 1200, on two tracks -- all-time
-- (never resets on its own; the owner's Reset ratings, M14.18, is still the only reset) and weekly
-- (everyone 1200 at the week boundary, `apps/web/lib/night.ts` `weekStart`, K restarting with the
-- week, ignoring `groups.ratings_since`).
--
-- **Additive, nullable, no default, one transaction.** The build that is live when this lands
-- (OpenSkill) never reads or writes a column added here and keeps running unchanged; the Kustom
-- fold (M18.5) fills them, and the one `rebuild-ratings` of the switch (M18.10) fills every rated
-- game. The OpenSkill columns stay as they are, unread after the switch, so rollback is the
-- previous build plus its own rebuild, until M18.12 drops them.
--
-- game_players, all-time track (written beside today's breakdown, reusing it):
--   r_before, r_after   the unrounded all-time Rating before and after this game. The printed change
--                       is round(r_after) - round(r_before); never stored rounded.
--   k                   the K this game used, K(n) of the player's all-time `n`.
--   share_rank          1..5: this player's place inside their own team by the performance score
--                       (best first, ties by PUUID). Null when the game had no performance score
--                       (every share 1.0, nobody named). The same rank drives both tracks, so it is
--                       stored once.
--   fold_p              (0034, reused) the expected score for THIS ROW'S SIDE, now Kustom's
--                       `winProbability` on all-time Ratings once the switch has refolded the row.
--   award               (0034, reused) mvp | ace | none: on a Kustom row, rank 1 on the winning
--                       side is mvp, rank 1 on the losing side ace, and nobody is named without a
--                       share rank.
--   rated_games_before  (0034, reused) the all-time `n` K was read from.
--
-- game_players, weekly track:
--   week_r_before, week_r_after, week_k, week_fold_p, week_games_before: the same facts on the
--   weekly track (week_games_before is `n` this week, so the week's first game is K 32 and 50/50).
--
-- ratings.r: the current all-time R. The current weekly Rating is derived, not stored: a player's
--   last week_r_after in the week (1200 with no game). No week_ratings table: no read needs one yet.
--
-- ratings.mu / sigma become nullable, so the Kustom fold need not invent OpenSkill numbers for a
--   player whose first game is after the switch. They stay a pair, and a row carries at least one
--   rating. `ordinal` (generated, mu - 2 * sigma) reads null on a row with no OpenSkill pair.
--
-- splits.odds_model: which function made `blue_win_prob`. Every existing split, and every split the
--   current build writes, is 'openskill' by the column default; rolls after the switch write
--   'kustom', so the receipt's calibration line counts only odds made by the function it checks.
--
-- Checks (each refused by a test in `src/kustomRating.integration.test.ts`):
--   game_players_kustom_together     r_before, r_after, k together or not at all, and an all-time
--                                    Kustom row carries its fold_p, award and rated_games_before
--                                    (fold_p alone is legal: an OpenSkill row from 0034).
--   game_players_week_together       the weekly five together or not at all, and a weekly row
--                                    carries its award (the share is shared by both tracks).
--   game_players_share_rank          share_rank never stands without its award. Which rank is
--                                    named (rank 1: mvp or ace) is the fold's rule, not a check:
--                                    the row does not carry the team's scores or result, and a
--                                    rebuild that rewrites `award` through `mvpAce` must not be
--                                    refused over a tie it orders differently.
--   game_players_breakdown_together  (replaces 0034's) base_mu_after is the OpenSkill bonus split,
--                                    so it is now allowed null beside a filled r_after; otherwise as
--                                    before: an OpenSkill breakdown is fold_p + base_mu_after +
--                                    award, and fold_p never stands without its award.
--   game_players_breakdown_needs_rating
--                                    (replaces 0034's, which was keyed on mu_after alone) the
--                                    all-time parts (fold_p, base_mu_after, rated_games_before)
--                                    need an all-time rating (mu_after or r_after); the shared
--                                    parts (award, share_rank) need a rating on some track.
--   So no set outlives the rating it explains: an un-rate nulls every column of the row in one
--   statement, as the rebuild's `nulled` row already does for 0034's four.
--
--   **Rollback.** The OpenSkill build's rebuild does NOT leave the Kustom columns in place safely:
--   its `nulled()` row nulls only the OpenSkill and 0034 columns, which on a row holding Kustom
--   values leaves r_after without fold_p, and `game_players_kustom_together` refuses it (the
--   rebuild aborts). A rollback therefore runs `packages/db/scripts/m18-rollback-prestep.sql` per
--   group before that rebuild: it nulls every 0036 column of game_players, and 0034's fold_p /
--   award / rated_games_before on rows with no mu_after (not ratings.r, which a Kustom-only
--   ratings row needs for `ratings_has_a_rating` and the OpenSkill build ignores).
--
--   The one row with a weekly set and no all-time rating is legal on purpose: a game before the
--   group's `ratings_since` but inside the current week is folded on the weekly track only (the
--   weekly track ignores the reset; `00-product.md` "a reset does not touch the week's points").
--
-- No RLS change: `game_players`, `ratings` and `splits` are publicly readable column by column
-- already (0001), and these are public game facts derivable from the public before-ratings and
-- stat columns. No view selects these tables. No Realtime change (all three are published, 0001).

begin;

-- ---------------------------------------------------------------------------
-- game_players
-- ---------------------------------------------------------------------------

alter table public.game_players
  add column r_before double precision,
  add column r_after double precision,
  add column k double precision check (k > 0),
  add column share_rank smallint check (share_rank between 1 and 5),
  add column week_r_before double precision,
  add column week_r_after double precision,
  add column week_k double precision check (week_k > 0),
  add column week_fold_p double precision check (week_fold_p >= 0 and week_fold_p <= 1),
  add column week_games_before integer check (week_games_before >= 0);

alter table public.game_players
  drop constraint game_players_breakdown_together,
  drop constraint game_players_breakdown_needs_rating;

alter table public.game_players
  add constraint game_players_kustom_together check (
    (r_before is null) = (r_after is null)
    and (r_after is null) = (k is null)
    and (r_after is null or (fold_p is not null and award is not null and rated_games_before is not null))
  ),
  add constraint game_players_week_together check (
    (week_r_before is null) = (week_r_after is null)
    and (week_r_after is null) = (week_k is null)
    and (week_k is null) = (week_fold_p is null)
    and (week_fold_p is null) = (week_games_before is null)
    and (week_r_after is null or award is not null)
  ),
  add constraint game_players_share_rank check (share_rank is null or award is not null),
  add constraint game_players_breakdown_together check (
    (base_mu_after is null or (fold_p is not null and award is not null))
    and (fold_p is null or award is not null)
    and (fold_p is null or base_mu_after is not null or r_after is not null)
  ),
  add constraint game_players_breakdown_needs_rating check (
    (mu_after is not null or r_after is not null
      or (fold_p is null and base_mu_after is null and rated_games_before is null))
    and (mu_after is not null or r_after is not null or week_r_after is not null
      or (award is null and share_rank is null))
  );

comment on column public.game_players.r_before is
  'M18.4 (0036): the unrounded all-time Kustom Rating before this game. Null: not folded under Kustom (an OpenSkill-era row until the switch rebuild, or an unrated game).';
comment on column public.game_players.r_after is
  'M18.4 (0036): the unrounded all-time Kustom Rating after this game. Printed change = round(r_after) - round(r_before).';
comment on column public.game_players.k is
  'M18.4 (0036): the K this game used on the all-time track, K(n) of rated_games_before.';
comment on column public.game_players.share_rank is
  'M18.4 (0036): 1..5, this player''s place inside their team by the performance score (ties by PUUID); drives the share on both tracks. Null: the game had no performance score (every share 1.0, award none).';
comment on column public.game_players.week_r_before is
  'M18.4 (0036): the unrounded weekly Kustom Rating before this game (1200 at the week''s first game).';
comment on column public.game_players.week_r_after is
  'M18.4 (0036): the unrounded weekly Kustom Rating after this game. A player''s current weekly Rating is their last week_r_after in the week (derived, not stored).';
comment on column public.game_players.week_k is
  'M18.4 (0036): the K this game used on the weekly track, K(n) of week_games_before.';
comment on column public.game_players.week_fold_p is
  'M18.4 (0036): the weekly track''s expected score for this row''s side, from weekly Ratings (0.5 at everyone''s first game of a week).';
comment on column public.game_players.week_games_before is
  'M18.4 (0036): this player''s rated games in the same week before this one (the weekly n).';
comment on column public.game_players.fold_p is
  'M14.58/M14.59 (0034); M18.4 (0036): the win probability the rating fold gave this row''s side. On a row with r_after it is Kustom''s all-time expected score (winProbability); on an OpenSkill-era row, foldWinProbability. Not splits.blue_win_prob (the bot''s roll-time odds). Null: not folded with a breakdown.';
comment on column public.game_players.rated_games_before is
  'M14.58 (0034); M18.4 (0036): this player''s rated games in the group before this one, since the ratings epoch, as the fold counted them: the all-time n that K is read from.';

-- ---------------------------------------------------------------------------
-- ratings
-- ---------------------------------------------------------------------------

alter table public.ratings
  add column r double precision,
  alter column mu drop not null,
  alter column sigma drop not null;

alter table public.ratings
  add constraint ratings_openskill_pair check ((mu is null) = (sigma is null)),
  add constraint ratings_has_a_rating check (mu is not null or r is not null);

comment on column public.ratings.r is
  'M18.4 (0036): the current unrounded all-time Kustom Rating (displayed as round(r)); the balancer and the fold read it. Null until the Kustom fold first writes the row.';
comment on column public.ratings.mu is
  'OpenSkill mu (0001). Nullable since 0036: a Kustom-only row carries r and no OpenSkill pair. Kept, unread after the M18 switch, as the rollback path until M18.12.';

-- ---------------------------------------------------------------------------
-- splits
-- ---------------------------------------------------------------------------

alter table public.splits
  add column odds_model text not null default 'openskill'
    constraint splits_odds_model_known check (odds_model in ('openskill', 'kustom'));

comment on column public.splits.odds_model is
  'M18.4 (0036): which function made blue_win_prob: openskill (every split before the switch) or kustom (winProbability). The receipt''s calibration line counts only kustom rolls.';

commit;
