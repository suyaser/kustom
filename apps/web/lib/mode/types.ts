import type { Mode } from '@customs/core';
import type { RuleCheck } from '@customs/db/schemas';

/** A recorded game's mode stamp as the poster reads it (M15.5; `games.rule*`, `rated`, `rule_check`). */
export interface GameStampView {
  /** The rule the game was played under, or null for a standing-mode game. */
  rule: Mode | null;
  /** `games.rated`: false for a not-rated game (a rule's default or the Rated switch). */
  rated: boolean;
  /** A Summoner's Rift game past the remake line: only then does `Not rated` mean someone chose it. */
  rift: boolean;
  /** The stored check, or null when the game was not checked (remake, ARAM, standing mode). */
  check: RuleCheck | null;
  /** M23.2: `games.void_reason` (`early-end`, `admin`), or null/absent when it is not voided. */
  voidReason?: string | null | undefined;
  /** M15.10: the client's names for checked champions newer than the pinned table, by key. */
  names?: Readonly<Record<number, string>> | undefined;
}
