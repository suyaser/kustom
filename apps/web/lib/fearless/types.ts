/**
 * The fearless-draft pool: unique champions this group has locked since an admin last
 * cleared the list (M10). Derived from `game_players.champion_id`, never stored as a
 * second table of names.
 */

import type { RoleValue } from '@customs/db';

export interface FearlessChampion {
  id: number;
  /** Display name from `lib/champs/names.ts`. A missing id prints `Champion ${id}`. */
  name: string;
  /** Role on the seat that first locked this id. Null is an `other` group, never a guess. */
  role: RoleValue | null;
}

export interface FearlessView {
  /** Lane then A–Z (M10.2). Empty until a counted Rift custom lands after the cursor. */
  champions: readonly FearlessChampion[];
  /** ISO 8601. Null only when the singleton row is missing, which is a failed read. */
  resetAt: string | null;
}

export const EMPTY_FEARLESS: FearlessView = { champions: [], resetAt: null };

/** Cap on the games the loader walks. Unique champs cannot exceed the roster anyway. */
export const FEARLESS_MAX_GAMES = 500;

/** The singleton `fearless_state.id`. */
export const FEARLESS_STATE_ID = 1;
