import { ROLES } from '@customs/core';
import type { RoleValue } from '@customs/db';
import { isRosterChampion, listChampions } from '../champs/names';
import { availableFearless } from '../fearless/present';
import type { FearlessChampion, FearlessView } from '../fearless/types';
import { DISPLAY_LOCALE } from '../night';
import type { TonightSnapshot } from '../tonight/types';
import type { NormalNoteFacts } from './cardView';

/**
 * The Mode card's and the mode panel's derived facts (M14.30; 05-design.md 8.3, 8.7). Pure, so
 * every count is a unit test and the card and the panel can never disagree.
 */

export interface FearlessCounts {
  /** The roster, 172 at the pin. */
  total: number;
  /** Roster champions not in the pool. */
  open: number;
  /** Every id in the pool: an id outside the roster counts as banned, never open (8.7.5). */
  banned: number;
  /** Open champions per lane. */
  laneOpen: Record<RoleValue, number>;
}

export function fearlessCounts(fearless: FearlessView): FearlessCounts {
  const total = listChampions().length;
  const bannedRoster = new Set(fearless.champions.filter((c) => isRosterChampion(c.id)).map((c) => c.id));
  const laneOpen = Object.fromEntries(ROLES.map((role) => [role, 0])) as Record<RoleValue, number>;
  for (const champion of availableFearless(fearless.champions)) {
    if (champion.role !== null) laneOpen[champion.role] += 1;
  }
  return {
    total,
    open: total - bannedRoster.size,
    banned: new Set(fearless.champions.map((c) => c.id)).size,
    laneOpen,
  };
}

/** The champions one game added to the pool (the finished state's `Banned next game`). */
export function bannedByGame(fearless: FearlessView, gameId: string): FearlessChampion[] {
  return fearless.champions.filter((champion) => champion.gameId === gameId);
}

/** `?lane=`: a lane, or `all` for anything else (an unknown value falls back, 8.5.1). */
export type LaneChoice = RoleValue | 'all';

export function parseLane(value: string | string[] | undefined | null): LaneChoice {
  const raw = Array.isArray(value) ? value[0] : value;
  return (ROLES as readonly string[]).includes(raw ?? '') ? (raw as RoleValue) : 'all';
}

/** `Thu 1 Oct`: the pool's reset day in the group's zone, for the panel head. `null` with none. */
export function poolSinceLabel(resetAt: string | null, timeZone: string): string | null {
  if (resetAt === null) return null;
  const at = new Date(resetAt);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(at)
    .replace(',', '');
}

/** The night's facts behind the members' `Normal mode now.` note (M19.13: the client card reads them). */
export function normalNoteFactsOf(snapshot: TonightSnapshot): NormalNoteFacts {
  let lastResultAt: number | null = null;
  for (const entry of snapshot.tape) {
    if (entry.result === null) continue;
    const at = Date.parse(entry.createdAt);
    if (Number.isFinite(at) && (lastResultAt === null || at > lastResultAt)) lastResultAt = at;
  }
  return {
    lastResultAt,
    finishedNow: snapshot.lobby?.status === 'finished' || snapshot.lobby?.status === 'in_game',
  };
}
