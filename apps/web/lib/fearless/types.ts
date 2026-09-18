/**
 * The fearless-draft pool: unique champions this group has locked since an admin last
 * cleared the list (M10). Derived from `game_players.champion_id`, never stored as a
 * second table of names.
 */

export interface FearlessChampion {
  id: number;
  /** Display name from `lib/champs/names.ts`. A missing id prints `Champion ${id}`. */
  name: string;
}

export interface FearlessView {
  /** First-appearance order. Empty until a counted Rift custom lands after the cursor. */
  champions: readonly FearlessChampion[];
  /** ISO 8601. Null only when the singleton row is missing, which is a failed read. */
  resetAt: string | null;
}

export const EMPTY_FEARLESS: FearlessView = { champions: [], resetAt: null };

/** Cap on the games the loader walks. Unique champs cannot exceed the roster anyway. */
export const FEARLESS_MAX_GAMES = 500;

/** The singleton `fearless_state.id`. */
export const FEARLESS_STATE_ID = 1;
