-- m18-rollback-prestep.sql  (M18.4 / M18.10: the step before an OpenSkill rollback's rebuild)
--
-- WHEN: only on a rollback of the M18 switch, after the previous (OpenSkill) build is deployed and
-- BEFORE its `pnpm --filter web rebuild-ratings`. Once per group being rolled back. Never during
-- normal running, never after M18.12.
--
-- WHY: the OpenSkill build's rebuild un-rates a gated game by writing `nulled()`
-- (apps/web/lib/ingest/rebuild.ts), which nulls mu_*/sigma_* and 0034's fold_p, base_mu_after,
-- award and rated_games_before but knows nothing of 0036's columns. On a row the Kustom fold wrote,
-- that leaves r_after without fold_p, and `game_players_kustom_together` refuses the write, so the
-- rebuild aborts. Nulling the Kustom columns first (and, on a row with no mu_after, the Kustom
-- breakdown it left in fold_p / award / rated_games_before) makes every row OpenSkill-only again,
-- and the old rebuild's writes (rated and nulled alike) pass. Proven in src/kustomRating.integration.test.ts.
--
-- WHAT IT DOES NOT TOUCH: `ratings.r`. A Kustom-only ratings row (mu and sigma null) must keep r,
-- or `ratings_has_a_rating` refuses the update; the OpenSkill build ignores r and its rebuild
-- writes mu/sigma onto every played player's row anyway. The next Kustom rebuild rewrites
-- everything, so a later re-switch needs no step of its own.
--
-- RUN (the owner, from the M18.10 runbook; the group id is groups.id):
--   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
--     -v group_id=<groups.id> -f packages/db/scripts/m18-rollback-prestep.sql
-- or paste it into the Supabase SQL editor with the id substituted for :'group_id'.

update public.game_players
set r_before = null,
    r_after = null,
    k = null,
    share_rank = null,
    week_r_before = null,
    week_r_after = null,
    week_k = null,
    week_fold_p = null,
    week_games_before = null,
    -- A Kustom-only row (no OpenSkill rating) carries a Kustom breakdown in 0034's columns; with
    -- r_after gone it would explain nothing, and `game_players_breakdown_needs_rating` refuses it.
    -- A row that still has mu_after keeps its OpenSkill breakdown.
    fold_p = case when mu_after is null then null else fold_p end,
    award = case when mu_after is null then null else award end,
    rated_games_before = case when mu_after is null then null else rated_games_before end
where group_id = :'group_id'
  and (r_after is not null or week_r_after is not null or share_rank is not null);
