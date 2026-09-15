import type { RoleValue } from '@customs/db';
import { MIN_RECORD_GAMES } from '../stats/copy';
import { renderWebName } from '../tonight/copy';
import type { PlayerName } from '../tonight/types';

/**
 * Every word `/1v1` says (M5.34). The page and its tests read these strings; a component
 * does not invent a second sentence for the same fact.
 */

/** The nav tab, the heading beside the window's name, the `<title>`. */
export const VERSUS_LABEL = '1v1';

/** The page's own sentence under the strip: what this tab is for. */
export const VERSUS_INTRO = "Who wins the lane, and who has whose number. Summoner's Rift customs only.";

export const LANES_HEADING = 'Lane wars';
export const LANES_INTRO = 'Same role, opposite sides. The five series with the most meetings in each lane.';
export const LANES_EMPTY = 'Nobody has faced the same role often enough yet.';

export const TYRANTS_HEADING = 'Lane bully';
export const TYRANTS_INTRO = `Highest win rate in a lane, over at least ${MIN_RECORD_GAMES} meetings.`;
export const TYRANTS_EMPTY = `Nobody owns a lane over ${MIN_RECORD_GAMES} meetings yet.`;

export const HEATS_HEADING = 'Dead heat';
export const HEATS_INTRO = `The longest series that will not settle, over at least ${MIN_RECORD_GAMES} meetings.`;
export const HEATS_EMPTY = 'No close series has gone long enough yet.';

export const PICK_HEADING = 'Pick two';
export const PICK_INTRO = 'Any two people. The URL is the argument you paste in the chat.';
export const PICK_PLAYER = 'Pick a player';
export const PICK_LEFT = 'Player one';
export const PICK_RIGHT = 'Player two';
export const COMPARE = 'Compare';
export const PICK_IDLE = 'Pick two people to open the series.';
export const PICK_ONE = 'Pick the other player.';
export const PICK_SAME = 'Pick two different people.';
export const VERSUS_WORD = 'vs';

export const COLLIDE_HEADING = 'When they collide';
export const TOGETHER_HEADING = 'When they queue together';
export const SAME_LANE_HEADING = 'Same lane';
export const LAST_MEETING = 'Last meeting';
export const SERIES_STREAK = 'Streak';
export const SERIES_FORM = 'Form';
export const LOCKS_HEADING = 'Into each other';
export const NO_ENEMIES = 'They have not played on opposite sides in this window.';
export const NO_ALLIES = 'They have not queued on the same side in this window.';
export const NO_SAME_LANE = 'They have not faced in the same role.';
export const NO_LAST = 'No meeting yet.';
export const NO_STREAK = 'No run.';
export const NO_FORM = 'No meetings yet.';
export const NO_LOCK = 'No champion recorded.';

/**
 * How many meetings in one lane before a pair appears on that lane's board.
 *
 * Lower than `/stats`'s five: a role-vs-role series is rarer than a person's games at a role,
 * and three nights is already a grudge.
 */
export const MIN_LANE_GAMES = 3;

/** How many rows each lane, and each spice list, prints. */
export const LANES_SHOWN = 5;

/** A bully: at least five meetings and this win rate. */
export const TYRANT_RATE = 70;

export function noLaneEntries(role: RoleValue): string {
  return `No ${role} series has ${MIN_LANE_GAMES} meetings yet.`;
}

export function versusScore(leftWins: number, rightWins: number): string {
  return `${leftWins}–${rightWins}`;
}

export function versusKdaLine(kills: number, deaths: number, assists: number): string {
  return `${formatAvg(kills)} / ${formatAvg(deaths)} / ${formatAvg(assists)}`;
}

export function champIntoLine(champion: string, count: number): string {
  return count === 1 ? `${champion} × 1` : `${champion} × ${count}`;
}

export function formMark(win: boolean): string {
  return win ? 'W' : 'L';
}

export function streakLine(name: PlayerName, length: number): string {
  return `${renderWebName(name)} W${length}`;
}

export function lastMeetingLine(when: string, winner: PlayerName): string {
  return `${when} · ${renderWebName(winner)}`;
}

export function verdictNone(): string {
  return 'They have not shared a custom in this window.';
}

export function verdictAlliesOnly(): string {
  return 'They only ever play together.';
}

export function verdictEven(): string {
  return 'Dead even.';
}

export function verdictOwns(winner: PlayerName, loser: PlayerName): string {
  return `${renderWebName(winner)} has ${renderWebName(loser)}'s number.`;
}

export function verdictLeads(winner: PlayerName): string {
  return `${renderWebName(winner)} leads the series.`;
}

export function verdictTogetherHot(rate: number): string {
  return `They wreck the map together · ${rate}%.`;
}

export function verdictTogetherCursed(rate: number): string {
  return `Cursed when stacked · ${rate}%.`;
}

function formatAvg(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

const VERSUS_ROAST: Record<string, string> = {
  [LANES_HEADING]: 'حرب اللين',
  [TYRANTS_HEADING]: 'بيأكل اللين',
  [HEATS_HEADING]: 'محدش بيكسب',
  [PICK_HEADING]: 'هات اتنين',
  [COLLIDE_HEADING]: 'مين بياكل التاني',
  [TOGETHER_HEADING]: 'لما بيلعبوا مع بعض',
  [SAME_LANE_HEADING]: 'نفس اللين',
};

export function versusRoast(title: string): string | null {
  return VERSUS_ROAST[title] ?? null;
}
