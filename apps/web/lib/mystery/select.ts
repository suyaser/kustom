import { type PerformancePlayer, performanceScores } from '@customs/core';
import { AWARD_CATEGORIES, type AwardCategory, type ChallengeCategory, type MysteryKind } from './types';

/**
 * Pick one performance from a scored list. Deterministic for a civil-day key so the
 * cron and the first GET agree, and so two simultaneous first visitors cannot fork
 * the day.
 *
 * **One selection module for both daily games** (M8.4). Daily Mystery and Guess the Award
 * differ only in how a candidate is built — `scorePerformance` for one, `performanceScores`
 * from `@customs/core` for the other. `pickMystery`, `shuffleSuspects`, `dayIndex` and the
 * recent-game / recent-player avoidance are shared, which is also what makes the two games
 * share one memory of who has just been the answer: being yesterday's Daily Mystery excludes
 * you from today's Guess the Award.
 */

export const MYSTERY_RECENT_GAME_DAYS = 21;
export const MYSTERY_RECENT_PLAYER_DAYS = 7;
export const MYSTERY_TOP_SLICE = 20;

export interface MysteryCandidate {
  gameId: string;
  playerId: string;
  score: number;
  category: ChallengeCategory;
  startedAt: Date;
}

/**
 * Which game a civil day is. **Parity of the day itself, not of the day of the month**:
 * counting days since the epoch keeps the alternation running across a 31st into a 1st,
 * which a `day % 2` would break twice a year and nobody would notice until the same game
 * ran two days in a row.
 *
 * This decides what to *create*; what a stored row **is** is the `kind` column, which is
 * written once and never re-derived (migration 0016). An award day that could not be built
 * stores a mystery, and tomorrow is still whatever the parity says.
 */
export function kindForDay(dayKey: string): MysteryKind {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (match === null) return 'mystery';
  const [, year, month, day] = match;
  const epochDay = Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000);
  return epochDay % 2 === 0 ? 'mystery' : 'award';
}

/**
 * The standout of one game, the answer a Guess the Award day is about.
 *
 * The scoring is `performanceScores` from `@customs/core` and nothing else — M7.8's
 * seven-component, role-weighted, in-game-normalised score, the one this project already
 * trusts to say who carried a game. **No second definition of "standout" lives here.** It
 * returns `null` for a game missing any of the seven components or any of the ten roles,
 * which is every game stored before M7.7 and every backfilled one, and that is exactly the
 * "not scorable today" that makes an award day fall back to a Daily Mystery.
 *
 * `players[].puuid` is an opaque key to core, so the caller passes `game_players.player_id`:
 * that is what `daily_mysteries.mystery_player_id` stores and what the suspects are named by.
 *
 * The number that comes back is the **gap** to the runner-up, not the winner's own score. A
 * score is comparable only inside its own game (`docs/01-architecture.md`), and the ranking
 * here is across games; how far clear of the rest of the lobby somebody finished is the
 * closest honest reading of "stood out", and it is used to order a puzzle's candidates and
 * for nothing else. It is never printed (M7.8's rule that the score is not a public number).
 */
export function pickAwardStandout(
  players: readonly PerformancePlayer[],
): { playerId: string; score: number; category: AwardCategory } | null {
  if (players.length < 2) return null;
  const scores = performanceScores(players);
  if (scores === null) return null;

  const ranked = [...scores].sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.puuid < b.puuid ? -1 : 1,
  );
  const top = ranked[0];
  const second = ranked[1];
  if (top === undefined || second === undefined) return null;
  const winner = players.find((player) => player.puuid === top.puuid);
  if (winner === undefined) return null;

  return {
    playerId: top.puuid,
    score: top.score - second.score,
    category: standoutCategory(winner, players),
  };
}

/** The raw value of one component for one player. Not a score: the number off the scoreboard. */
function componentValue(player: PerformancePlayer, category: AwardCategory): number {
  const num = (value: number | null | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  switch (category) {
    case 'kda':
      return (num(player.kills) + num(player.assists)) / Math.max(1, num(player.deaths));
    case 'damage':
      return num(player.damageToChamps);
    case 'gold':
      return num(player.gold);
    case 'vision':
      return num(player.visionScore);
    case 'mitigation':
      return num(player.damageSelfMitigated);
    case 'cs':
      return num(player.cs);
    case 'objectives':
      return num(player.damageToObjectives);
  }
}

/**
 * Which stat the clues will talk about: the one this player led the game in by the widest
 * margin, or — for a standout who tops nothing outright — their biggest share of somebody
 * else's best.
 *
 * This is **not a second score**. It weighs nothing and ranks nobody; it picks which raw
 * number off the same scoreboard is worth printing about a player `performanceScores` has
 * already chosen. Ties fall to the order of `AWARD_CATEGORIES`.
 */
function standoutCategory(winner: PerformancePlayer, players: readonly PerformancePlayer[]): AwardCategory {
  let bestCategory: AwardCategory = 'kda';
  let bestLead = -1;
  let bestShare = -1;
  for (const category of AWARD_CATEGORIES) {
    const mine = componentValue(winner, category);
    let best = 0;
    let runnerUp = 0;
    for (const player of players) {
      const value = componentValue(player, category);
      if (value > best) {
        runnerUp = best;
        best = value;
      } else if (value > runnerUp) {
        runnerUp = value;
      }
    }
    if (best <= 0) continue;
    const share = mine / best;
    // Leading the game outright is worth more than any share of somebody else's best, so a
    // lead is compared against leads and a share against shares.
    const lead = mine >= best ? (best - runnerUp) / best : -1;
    if (lead > bestLead || (lead === bestLead && share > bestShare)) {
      bestLead = lead;
      bestShare = share;
      bestCategory = category;
    }
  }
  return bestCategory;
}

export interface SelectAvoid {
  recentGameIds: ReadonlySet<string>;
  recentPlayerIds: ReadonlySet<string>;
}

export function dayIndex(dayKey: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < dayKey.length; i += 1) {
    hash = (hash * 31 + dayKey.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

export function pickMystery(
  candidates: readonly MysteryCandidate[],
  dayKey: string,
  avoid: SelectAvoid,
): MysteryCandidate | null {
  const filtered = candidates.filter(
    (row) => !avoid.recentGameIds.has(row.gameId) && !avoid.recentPlayerIds.has(row.playerId),
  );
  const pool = filtered.length > 0 ? filtered : [...candidates];
  if (pool.length === 0) return null;

  const ranked = [...pool].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.gameId !== b.gameId) return a.gameId < b.gameId ? -1 : 1;
    return a.playerId < b.playerId ? -1 : 1;
  });
  const slice = ranked.slice(0, Math.min(MYSTERY_TOP_SLICE, ranked.length));
  return slice[dayIndex(dayKey, slice.length)] ?? null;
}

/** Stable shuffle so every visitor sees the same six names in the same order. */
export function shuffleSuspects<T>(items: readonly T[], dayKey: string): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = dayIndex(`${dayKey}:${i}`, i + 1);
    const current = copy[i];
    const swap = copy[j];
    if (current === undefined || swap === undefined) continue;
    copy[i] = swap;
    copy[j] = current;
  }
  return copy;
}
