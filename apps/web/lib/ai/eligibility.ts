import 'server-only';
import type { AiGate } from '../premium';
import type { GameMeta } from './facts';

/**
 * Whether a game may ever get a recap line (M16.4), apart from `generate.ts` so the pages that show
 * a line (Tonight, the game page) never load the generator or the model client (M16.6 code review).
 */

/**
 * A game line is only written for a game ingested **live** (`source = 'eog'`), recorded after
 * Premium was switched on, and while it is fresh: this long after the game row was written. Covers
 * the brief's "retry for up to 10 minutes" with room for the first try, and keeps a late ingest,
 * a backfill or a second companion hours later from ever writing a retroactive line.
 */
export const GAME_LINE_WINDOW_MS = 15 * 60 * 1000;

export type SkipReason =
  | 'no_key'
  | 'gate_closed'
  | 'no_game'
  | 'not_live'
  | 'before_premium'
  | 'stale'
  | 'no_facts'
  | 'finished';

/** Whether a stored game may ever get a line: live, after Premium, still fresh. */
export function gameLineEligibility(
  game: GameMeta | null,
  gate: AiGate,
  now: Date,
): { ok: true } | { ok: false; reason: SkipReason } {
  if (game === null) return { ok: false, reason: 'no_game' };
  if (game.source !== 'eog') return { ok: false, reason: 'not_live' };
  const created = Date.parse(game.createdAt);
  const since = gate.premiumChangedAt === null ? Number.NaN : Date.parse(gate.premiumChangedAt);
  if (!Number.isFinite(since) || created < since) return { ok: false, reason: 'before_premium' };
  if (now.getTime() - created > GAME_LINE_WINDOW_MS) return { ok: false, reason: 'stale' };
  return { ok: true };
}
