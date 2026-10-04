/**
 * Kill participation (M14.77): a player's kills plus assists over their side's kills, never over
 * 100%.
 *
 * A side's kills are summed from its stored rows, so a game whose rows do not add up -- a seat
 * missing from a backfilled block, a row the client reported short -- can leave the team total
 * below one player's takedowns, which is how a `112%` reached a page. Such a game says nothing
 * true about anybody's share of the kills, so it is **skipped** (null) rather than rounded down to
 * a confident 100%; the clamp after that is only the belt to those braces.
 *
 * Every surface that prints or ranks on KP reads it from here: the game page's seats, the Fun
 * cards' Ghost and Glue, the daily mystery's hook and the AI recap's facts.
 */

/** The share, 0 to 1, or null when the side scored no kills or its kills are fewer than this player's takedowns. */
export function killParticipation(kills: number, assists: number, teamKills: number): number | null {
  const takedowns = kills + assists;
  if (!(teamKills > 0) || teamKills < takedowns) return null;
  return Math.min(1, Math.max(0, takedowns / teamKills));
}

/** {@link killParticipation} as a whole percent, 0 to 100, or null for the same skipped games. */
export function killParticipationPercent(kills: number, assists: number, teamKills: number): number | null {
  const share = killParticipation(kills, assists, teamKills);
  return share === null ? null : Math.min(100, Math.round(share * 100));
}
