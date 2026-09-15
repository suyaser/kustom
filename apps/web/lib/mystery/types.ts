import type { RoleValue } from '@customs/db';

/**
 * The daily game (M5.32): one accountless guessing game per civil day.
 *
 * The League player on the scoreboard and the website visitor are different people.
 * Visitors are a random id in a cookie / localStorage. Nobody signs in to play.
 *
 * **Two games, alternating civil days** (M8.4): Daily Mystery asks who played like this,
 * Guess the Award asks who a standout stat line belongs to. One challenge a day, one
 * service, one set of tables. The kind is stored on the row, never re-derived from the
 * date, so a stored challenge keeps meaning what it meant.
 */

export const MYSTERY_KINDS = ['mystery', 'award'] as const;

export type MysteryKind = (typeof MYSTERY_KINDS)[number];

export const MYSTERY_CATEGORIES = ['disaster', 'monster', 'farming', 'raid_boss', 'ghost'] as const;

export type MysteryCategory = (typeof MYSTERY_CATEGORIES)[number];

/**
 * Guess the Award's categories: which of `performanceScores`' seven components the day's
 * standout led their game in. Disjoint from the five above, and checked per kind by
 * migration 0016.
 */
export const AWARD_CATEGORIES = [
  'kda',
  'damage',
  'gold',
  'vision',
  'mitigation',
  'cs',
  'objectives',
] as const;

export type AwardCategory = (typeof AWARD_CATEGORIES)[number];

export type ChallengeCategory = MysteryCategory | AwardCategory;

export const MYSTERY_CLUE_TYPES = [
  'champion',
  'role',
  'damage',
  'cs',
  'gold',
  'damage_taken',
  'longest_life',
  'historical',
] as const;

export type MysteryClueType = (typeof MYSTERY_CLUE_TYPES)[number];

export interface MysterySuspect {
  playerId: string;
  name: string;
}

export interface MysteryHookLine {
  label: string;
  value: string;
}

export interface MysteryClueView {
  order: number;
  type: MysteryClueType;
  label: string;
  value: string;
}

export interface MysteryPublicHook {
  kills: number;
  deaths: number;
  assists: number;
  kda: string;
  durationS: number;
  durationLabel: string;
  lines: MysteryHookLine[];
}

export interface MysteryPerformance {
  kills: number;
  deaths: number;
  assists: number;
  kda: string;
  champion: string | null;
  role: RoleValue | null;
  damage: number;
  damageLabel: string;
  cs: number;
  gold: number;
  goldLabel: string;
  damageTaken: number | null;
  damageTakenLabel: string | null;
  /** M7.7 / M7.14's three columns. Null for every game stored before them. */
  visionScore: number | null;
  damageSelfMitigated: number | null;
  damageToObjectives: number | null;
  durationS: number;
  durationLabel: string;
  won: boolean;
  startedLabel: string;
}

export interface MysteryGuessShare {
  playerId: string;
  name: string;
  count: number;
  percent: number;
}

export interface MysteryCommunity {
  attempts: number;
  correct: number;
  wrong: number;
  accuracyPercent: number;
  wrongPercent: number;
  averageCluesUsed: number | null;
  zeroClueCorrect: number;
  fastestCorrectMs: number | null;
  mostFalselyAccused: { playerId: string; name: string; count: number } | null;
  distribution: MysteryGuessShare[];
  firstDetectiveClaimed: boolean;
}

export type MysteryPercentileBucket = 'top-5' | 'top-10' | 'top-15' | 'top-25' | 'top-50';

export interface MysteryPersonal {
  guessedPlayerId: string;
  guessedName: string;
  actualPlayerId: string;
  actualName: string;
  correct: boolean;
  cluesUsed: number;
  completionTimeMs: number;
  firstDetective: boolean;
  percentile: MysteryPercentileBucket | null;
}

export interface MysteryPlayView {
  challengeId: string;
  challengeNumber: number;
  day: string;
  /** Which game today is. The view picks its title and its question off this. */
  kind: MysteryKind;
  category: ChallengeCategory;
  expiresAt: string;
  hook: MysteryPublicHook;
  suspects: MysterySuspect[];
  cluesRevealed: number;
  revealedClues: MysteryClueView[];
  clueCount: number;
  completed: boolean;
}

export interface MysteryResultView {
  challengeId: string;
  challengeNumber: number;
  day: string;
  kind: MysteryKind;
  category: ChallengeCategory;
  expiresAt: string;
  hook: MysteryPublicHook;
  suspects: MysterySuspect[];
  revealedClues: MysteryClueView[];
  clueCount: number;
  performance: MysteryPerformance;
  personal: MysteryPersonal;
  community: MysteryCommunity;
}

export interface MysteryEmptyView {
  empty: true;
  expiresAt: string;
}
