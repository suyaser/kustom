import type { WinLoss, YouLane } from './you';

/**
 * You vs them's words (M14.35). Every string here is [NEW COPY] from the brief. No gendered
 * phrasing anywhere (we don't know it). Records are `9–3`: wins first, an en dash, never a minus.
 */

export function record({ wins, losses }: WinLoss): string {
  return `${wins}–${losses}`;
}

/** The card on someone else's player page. */
export function youAndThem(name: string, together: WinLoss, against: WinLoss): string {
  return `You and ${name}: ${record(together)} together, ${record(against)} against.`;
}

/** One line per lane where the two met in the same role. */
export function laneLine(name: string, lane: YouLane): string {
  if (lane.you === lane.them) return `In lane: ${lane.role}, ${lane.you}–${lane.them}.`;
  return lane.you > lane.them
    ? `In lane: ${lane.role}, you lead ${lane.you}–${lane.them}.`
    : `In lane: ${lane.role}, ${name} leads ${lane.them}–${lane.you}.`;
}

export function neverMet(name: string): string {
  return `You haven't played with or against ${name} yet.`;
}

/** The everyone list on `/you`. */
export const YOU_VS_TITLE = 'You vs them';
export const WITH_LABEL = 'With';
export const AGAINST_LABEL = 'Against';
export const FRIEND_LABEL = 'Friend';
export const YOU_VS_EMPTY = 'Nobody to compare with yet. Play a game and everyone you met shows up here.';
export const YOU_VS_ALL_TIME = 'all time';

/** The pitch line under a finished game (Tonight, the game page). */
export const PITCH_SIGNED_OUT = 'Played tonight? Sign in and see how you did against everyone.';
/** Linked: the sentence around the `You` link. */
export const PITCH_LINKED_BEFORE = 'Tap anyone to see your record with them, or see everyone on ';
export const PITCH_LINKED_LINK = 'You';
export const PITCH_LINKED_AFTER = '.';
export const PITCH_DISMISS = 'Hide for tonight';
