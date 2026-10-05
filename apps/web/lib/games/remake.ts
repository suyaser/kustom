import { MIN_RATED_DURATION_S } from '../lobbyRules';

/**
 * A remake: a game of 300 s or less (`MIN_RATED_DURATION_S`, ingest's `recordedKind`). Never rated,
 * never a result post (`announcesResult`), and no result anywhere (05-design.md 15): no winner, no
 * side colour, no odds, no MVP, never in the night record. It still has a scoreboard and a page.
 * Tonight and `/games` both read this one threshold.
 */
export function isRemake(durationS: number): boolean {
  return durationS <= MIN_RATED_DURATION_S;
}

/**
 * 05-design.md 15 [NEW COPY]: a remake's word on the tape tile, the Games row and the game page h1.
 * Here, beside the threshold, so Tonight's copy can read it without `./copy`'s imports
 * (`lib/games/copy.ts` re-exports it).
 */
export const REMAKE = 'Remake';
