/**
 * Every sentence the champ-select overlay says (M12), matching `05-design.md`.
 */

import { FEARLESS_SENTENCE, FEARLESS_TITLE } from '../fearless/copy';
import { MIN_DUO_GAMES } from '../stats/copy';

export const OVERLAY_FEARLESS_TITLE = FEARLESS_TITLE;
export const OVERLAY_FEARLESS_SENTENCE = FEARLESS_SENTENCE;
export const OVERLAY_FEARLESS_EMPTY = 'No champions banned yet.';
export const OVERLAY_LOBBY_TITLE = 'This lobby';
export const OVERLAY_THIN_RECORD = `Under ${MIN_DUO_GAMES} games together.`;
export const OVERLAY_LANE_MARK = 'lane';
export const OVERLAY_WAITING = 'Waiting for the League client…';
export const OVERLAY_NO_LOBBY = 'No lobby yet.';

/** `With 7–2` — en dash, wins then losses. */
export function overlayWith(wins: number, losses: number): string {
  return `With ${wins}–${losses}`;
}

/** `Against 3–5` — viewer's wins then the other's. */
export function overlayAgainst(wins: number, losses: number): string {
  return `Against ${wins}–${losses}`;
}
