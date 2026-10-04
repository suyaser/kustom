/**
 * A `ratings` row's OpenSkill pair, or `null` when the row has none (M18.4, `0036_kustom_rating.sql`).
 *
 * Since 0036 `ratings.mu` and `sigma` are nullable: a row the Kustom fold writes for a player whose
 * first game is after the M18 switch carries `ratings.r` and no OpenSkill numbers. The OpenSkill
 * build reads such a row as "no stored OpenSkill rating" (a first game, seeded as today), which is
 * also what that build's own `rebuild-ratings` needs on a rollback. The two columns are a pair
 * (`ratings_openskill_pair`), so a half pair does not occur; it reads as `null` all the same.
 */
export function openSkillPair(row: {
  mu: number | null;
  sigma: number | null;
}): { mu: number; sigma: number } | null {
  if (row.mu === null || row.sigma === null) return null;
  return { mu: row.mu, sigma: row.sigma };
}
