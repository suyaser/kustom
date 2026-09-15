import type { AwardsView } from './types';

/**
 * Who won which of the window's awards, keyed by puuid (M8.3).
 *
 * **This computes no award.** It reads {@link AwardsView} — the same three blocks `/stats`
 * prints and the Sunday post carries, from `awardsView` — and turns "three awards, each with its
 * winners" into "each winner, with their awards", which is the shape a board row needs. The
 * awards' own numbers, minimums, tie rules and lines are untouched and are not repeated here;
 * this file would not know how to compute one.
 *
 * It is the same reading `/p/[puuid]`'s award line makes (`player.ts`, M5.20), taken once for
 * everybody instead of once for one person: a line is keyed on the winner's puuid, and a
 * cursed-duo line on both halves joined by `|`.
 */

/** The award titles somebody won, in {@link AwardsView}'s own block order. Never re-sorted. */
export type AwardWinners = ReadonlyMap<string, readonly string[]>;

/** Nobody won anything: the board draws no badge and is the board it was before M8.3. */
export const NO_AWARD_WINNERS: AwardWinners = new Map();

/**
 * The winners of a window's awards, by puuid.
 *
 * Empty for every window that hands nothing out — `This week` and `This month`, which are still
 * running (M5.4: *an award that changes every night is a statistic, not an award*), and
 * `All time`, which has no block at all — and empty for a closed window where nobody cleared a
 * minimum. Those are one case for the caller: no badge anywhere.
 *
 * **The order of each winner's list is the awards' order**, because the blocks are walked in the
 * order `awardBlocks` built them (`Most improved`, `Best off-role`, `Cursed duo`) and nothing
 * here sorts. A reader comparing two badged rows meets the same sequence on both.
 *
 * A player named twice inside one block — both halves of two tied duos, say — collects that
 * award once: the badge says which award was won, and saying it twice on one row says nothing.
 */
export function awardWinners(awards: AwardsView | null): AwardWinners {
  const won = new Map<string, string[]>();
  if (awards === null || awards.kind !== 'closed') return won;

  for (const block of awards.blocks) {
    // A block nobody won carries the "nobody qualifies" sentence, whose key is `nobody`.
    if (!block.won) continue;
    for (const line of block.lines) {
      // One puuid on most lines; a pair's two, joined, on a cursed duo — the split `player.ts`
      // already makes to decide whether an award names the person whose page it is.
      for (const puuid of line.key.split('|')) {
        const titles = won.get(puuid) ?? [];
        if (!titles.includes(block.label)) titles.push(block.label);
        won.set(puuid, titles);
      }
    }
  }
  return won;
}
