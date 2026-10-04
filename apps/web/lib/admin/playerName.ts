import { NAMELESS_PLAYER } from '../discord/embeds';

/**
 * The one place that turns a `players` row into something a human reads (M1.7).
 *
 * Every admin surface uses it, so no page can invent its own fallback and end up showing a
 * blank cell or a bare PUUID fragment where another page shows a name. The chain is
 * `display_name`, then the Riot ID, then `Someone` -- a row first seen in an end-of-game block has
 * no `gameName` at all until a lobby or rank post names it, so the last resort is reachable. It is
 * the same word every friend-facing surface uses, never a PUUID fragment (admin round 2).
 *
 * Pure and string-only: unit-tested next to the other admin rules, not through a page.
 */

export interface NameableRow {
  puuid: string;
  displayName: string | null;
  gameName: string | null;
  tagLine?: string | null;
}

/**
 * `Hamoodi`, else `Ahmed#EUW`, else `Someone` (`NAMELESS_PLAYER`; admin round 2: never a PUUID fragment).
 *
 * Whitespace-only values count as absent: an admin who saves a name of spaces gets the Riot ID
 * back rather than an empty cell (the route stores null for that, but a row written before this
 * existed, or by hand in Studio, can still hold one).
 */
export function playerLabel(row: NameableRow): string {
  const displayName = row.displayName?.trim();
  if (displayName) return displayName;

  const gameName = row.gameName?.trim();
  if (gameName) {
    const tagLine = row.tagLine?.trim();
    return tagLine ? `${gameName}#${tagLine}` : gameName;
  }

  return NAMELESS_PLAYER;
}
