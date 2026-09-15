import type { RoleValue } from '@customs/db';
import { formatDamage, formatDuration } from '../discord/embeds';
import {
  awardStatLabel,
  clueTypeLabel,
  HOOK_CS,
  HOOK_DAMAGE,
  HOOK_DAMAGE_TAKEN,
  HOOK_DEATHS,
  HOOK_DURATION,
  HOOK_KP,
  historicalChampLine,
  historicalGamesLine,
  roleWord,
} from './copy';
import type {
  AwardCategory,
  MysteryCategory,
  MysteryClueType,
  MysteryClueView,
  MysteryHookLine,
} from './types';

/**
 * Progressive clues, built once when the day is created and stored server-side.
 * The public GET never receives these values. Each POST returns the next row only.
 *
 * **The ladder is per kind, the storage is not** (M8.4): both games write the same
 * `daily_mystery_clues` rows with the same clue types, revealed one at a time by the same
 * endpoint. Daily Mystery opens on the champion and narrows to the stat line; Guess the Award
 * opens on the rest of the stat line — the vaguest thing left about the game — and narrows to
 * the role, the champion and finally this player's own history.
 */

export interface ClueSource {
  category: MysteryCategory;
  champion: string | null;
  role: RoleValue | null;
  damage: number;
  cs: number;
  gold: number;
  damageTaken: number | null;
  longestLivedS: number | null;
  championTimes: number | null;
  gamesPlayed: number;
}

export interface StoredClue {
  type: MysteryClueType;
  value: string;
  revealOrder: number;
}

export function buildStoredClues(source: ClueSource): StoredClue[] {
  const rows: StoredClue[] = [];
  const push = (type: MysteryClueType, value: string | null): void => {
    if (value === null || value.trim() === '') return;
    rows.push({ type, value, revealOrder: rows.length + 1 });
  };

  push('champion', source.champion);
  push('role', source.role === null ? null : roleWord(source.role));
  if (source.category === 'farming') {
    push('cs', String(source.cs));
    push('damage', formatDamage(source.damage));
  } else if (source.category === 'raid_boss' && source.damageTaken !== null) {
    push('damage_taken', formatDamage(source.damageTaken));
    push('damage', formatDamage(source.damage));
  } else {
    push('damage', formatDamage(source.damage));
    push('cs', String(source.cs));
  }
  push('gold', formatDamage(source.gold));
  if (source.longestLivedS !== null && source.longestLivedS > 0) {
    push('longest_life', formatDuration(source.longestLivedS));
  }

  const historical =
    source.champion !== null && source.championTimes !== null && source.championTimes > 0
      ? historicalChampLine(source.champion, source.championTimes)
      : source.gamesPlayed > 0
        ? historicalGamesLine(source.gamesPlayed)
        : null;
  const capped = rows.slice(0, historical === null ? 5 : 4);
  if (historical !== null) {
    capped.push({ type: 'historical', value: historical, revealOrder: capped.length + 1 });
  }
  return capped;
}

export interface AwardClueSource {
  category: AwardCategory;
  champion: string | null;
  role: RoleValue | null;
  damage: number;
  cs: number;
  gold: number;
  damageTaken: number | null;
  championTimes: number | null;
  gamesPlayed: number;
}

/**
 * Guess the Award's ladder. The award's own number is the hook, so it never appears as a
 * clue: what walks down is two more of the same scoreboard's numbers, then the role, then
 * the champion, then the one fact about this player that is not about this game at all.
 */
export function buildAwardClues(source: AwardClueSource): StoredClue[] {
  const rows: StoredClue[] = [];
  const push = (type: MysteryClueType, value: string | null): void => {
    if (value === null || value.trim() === '') return;
    rows.push({ type, value, revealOrder: rows.length + 1 });
  };

  const spent = new Map<MysteryClueType, string>([
    ['damage', formatDamage(source.damage)],
    ['gold', formatDamage(source.gold)],
    ['cs', String(source.cs)],
  ]);
  if (source.damageTaken !== null) spent.set('damage_taken', formatDamage(source.damageTaken));
  // Whichever stat the hook already printed is not a clue about anything.
  const skip: MysteryClueType | null =
    source.category === 'damage'
      ? 'damage'
      : source.category === 'gold'
        ? 'gold'
        : source.category === 'cs'
          ? 'cs'
          : null;
  let taken = 0;
  for (const type of ['damage', 'gold', 'cs', 'damage_taken'] as const) {
    if (type === skip || taken >= 2) continue;
    const value = spent.get(type);
    if (value === undefined) continue;
    push(type, value);
    taken += 1;
  }

  push('role', source.role === null ? null : roleWord(source.role));
  push('champion', source.champion);

  const historical =
    source.champion !== null && source.championTimes !== null && source.championTimes > 0
      ? historicalChampLine(source.champion, source.championTimes)
      : source.gamesPlayed > 0
        ? historicalGamesLine(source.gamesPlayed)
        : null;
  const capped = rows.slice(0, historical === null ? 5 : 4);
  if (historical !== null) {
    capped.push({ type: 'historical', value: historical, revealOrder: capped.length + 1 });
  }
  return capped;
}

/** The one line the award card opens on: the number that stood out, and the game's length. */
export function awardHookLines(input: {
  category: AwardCategory;
  value: number;
  durationS: number;
}): MysteryHookLine[] {
  return [
    { label: awardStatLabel(input.category), value: awardStatValue(input.category, input.value) },
    { label: HOOK_DURATION, value: formatDuration(input.durationS) },
  ];
}

/**
 * A scoreboard row, as far as the award's own number is concerned. `MysteryPerformance` and
 * `BuildSeat` both satisfy it, so the card's reveal and the day's hook read one function and
 * cannot print two different numbers for one award.
 */
export interface AwardStatSource {
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  gold: number;
  cs: number;
  visionScore: number | null;
  damageSelfMitigated: number | null;
  damageToObjectives: number | null;
}

/**
 * The raw number an award was won on. **Null, never zero**, when the column behind it was not
 * stored — vision score, damage mitigated and objective damage all arrived with migrations
 * 0014 / 0015, and a game older than those has no number rather than a score of none.
 */
export function awardStatNumber(source: AwardStatSource, category: AwardCategory): number | null {
  switch (category) {
    case 'kda':
      return (source.kills + source.assists) / Math.max(1, source.deaths);
    case 'damage':
      return source.damage;
    case 'gold':
      return source.gold;
    case 'cs':
      return source.cs;
    case 'vision':
      return source.visionScore;
    case 'mitigation':
      return source.damageSelfMitigated;
    case 'objectives':
      return source.damageToObjectives;
  }
}

/** `41.2k`, `312`, `5.50` — the shape each award stat is read in. */
export function awardStatValue(category: AwardCategory, value: number): string {
  switch (category) {
    case 'kda':
      return value.toFixed(2);
    case 'vision':
    case 'cs':
      return String(Math.round(value));
    case 'damage':
    case 'gold':
    case 'mitigation':
    case 'objectives':
      return formatDamage(Math.round(value));
  }
}

export function clueView(clue: StoredClue): MysteryClueView {
  return {
    order: clue.revealOrder,
    type: clue.type,
    label: clueTypeLabel(clue.type),
    value: clue.value,
  };
}

export function hookLines(input: {
  category: MysteryCategory;
  deaths: number;
  kp: number | null;
  cs: number;
  damage: number;
  damageTaken: number | null;
  durationS: number;
}): MysteryHookLine[] {
  const duration = { label: HOOK_DURATION, value: formatDuration(input.durationS) };
  switch (input.category) {
    case 'disaster':
      return [
        { label: HOOK_DEATHS, value: String(input.deaths) },
        ...(input.kp === null ? [] : [{ label: HOOK_KP, value: `${input.kp}%` }]),
        duration,
      ];
    case 'monster':
      return [
        ...(input.kp === null ? [] : [{ label: HOOK_KP, value: `${input.kp}%` }]),
        { label: HOOK_DAMAGE, value: formatDamage(input.damage) },
        duration,
      ];
    case 'farming':
      return [{ label: HOOK_CS, value: String(input.cs) }, duration];
    case 'raid_boss':
      return [
        ...(input.damageTaken === null
          ? []
          : [{ label: HOOK_DAMAGE_TAKEN, value: formatDamage(input.damageTaken) }]),
        duration,
      ];
    case 'ghost':
      return [{ label: HOOK_DAMAGE, value: formatDamage(input.damage) }, duration];
  }
}
