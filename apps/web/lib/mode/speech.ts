import type { RuleOption, StandingModeId } from '@customs/core';
import { MODE_ANNOUNCEMENTS } from './copy';
import { ruleDoneLine } from './ruleCopy';
import { ratedNotice, ruleChosenNotice, standingNotice } from './ruleNotices';

/**
 * What Tonight's announcer says when the Mode card changes under the page (M15.5; brief §4,
 * "Announcer"). The server sends the card's facts with every render; the announcer keeps the last
 * one and asks {@link modeSpeechLine} what changed. Pure and client-safe (no zod).
 */
export interface ModeSpeech {
  standing: StandingModeId;
  /** The pending rule for the next game. */
  pending: RuleOption | null;
  /** Whether the next game is rated (the switch, else the default). */
  nextRated: boolean;
  /** The rule locked on tonight's live lobby (balanced, in game), or null. */
  lockedRule: RuleOption | null;
  /** The lobby's status, or null with none. */
  lobbyStatus: string | null;
}

const key = (rule: RuleOption | null) =>
  rule === null ? '' : rule.id === 'class' ? `class:${rule.tag}` : rule.id;

/** The line to say for the change from `prev` to `next`, or null when the card did not change. */
export function modeSpeechLine(prev: ModeSpeech, next: ModeSpeech): string | null {
  // A rule game landed: the lock went with the game and the lobby is finished.
  if (prev.lockedRule !== null && next.lockedRule === null && next.lobbyStatus === 'finished') {
    if (next.pending === null) return ruleDoneLine(next.standing);
  }
  if (prev.standing !== next.standing) return standingNotice(next.standing, prev.pending !== null);
  if (key(prev.pending) !== key(next.pending)) {
    if (next.pending !== null) return ruleChosenNotice(next.pending, next.nextRated);
    // Cleared without a game landing: an admin picked the standing mode again.
    return prev.lockedRule !== null && next.lobbyStatus === 'finished'
      ? ruleDoneLine(next.standing)
      : standingNotice(next.standing, true);
  }
  if (prev.nextRated !== next.nextRated) return ratedNotice(next.nextRated);
  return null;
}

/** M14's line for a standing mode, kept for the M14 tests' wording. */
export function standingLine(standing: StandingModeId): string {
  return MODE_ANNOUNCEMENTS[standing];
}
