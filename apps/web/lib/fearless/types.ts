/**
 * The fearless-draft pool: unique champions this group has locked since an admin last
 * cleared the list (M10). Derived from `game_players.champion_id`, never stored as a
 * second table of names.
 */

import type { RoleValue } from '@customs/db';
import type { GroupMode } from '@customs/db/schemas';

export interface FearlessChampion {
  id: number;
  /** Display name from `lib/champs/names.ts`. A missing id prints `Champion ${id}`. */
  name: string;
  /** Role on the seat that first locked this id. Null is an `other` group, never a guess. */
  role: RoleValue | null;
  /**
   * The 24px icon (`championIconUrl`), resolved where the client's stored name is still in
   * hand, so a champion newer than `lib/champs/names.ts` keeps its face. `null` means nobody
   * could name it: no icon. Absent means "derive it from the id table" — see
   * {@link fearlessIconUrl} — which is every roster champion built in the browser.
   */
  iconUrl?: string | null;
  /**
   * `games.id` of the game that first locked this id (M14.31), so the fearless post can bold the
   * ten a game added. Absent on roster champions built in the browser and in hand-made lists.
   */
  gameId?: string;
}

export interface FearlessView {
  /** Lane then A–Z (M10.2). Empty until a counted Rift custom lands after the cursor. */
  champions: readonly FearlessChampion[];
  /** ISO 8601. Null only when the singleton row is missing, which is a failed read. */
  resetAt: string | null;
  /** How many counted games the pool was folded from (M14.30: `Pool since …, 4 games.`). */
  games?: number;
}

export const EMPTY_FEARLESS: FearlessView = { champions: [], resetAt: null };

/**
 * What the one pool read ({@link loadFearless}) answers (M14.29): the pool, counted only over
 * games stamped `games.mode = 'fearless'`, and the group's standing `mode`. On `normal` the
 * champions are the **paused** pool (what picking Fearless again brings back, and what the Mode
 * card counts), not bans in force: a surface that shows bans checks `isFearlessMode(mode)` first.
 */
export interface FearlessPool extends FearlessView {
  mode: GroupMode;
  /** `group_modes.updated_at` (M14.30), or `null` when unknown. */
  modeSince?: string | null;
}

/** Cap on the games the loader walks. Unique champs cannot exceed the roster anyway. */
export const FEARLESS_MAX_GAMES = 500;
