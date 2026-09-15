import type { PerformancePlayer } from '@customs/core';
import type { RoleValue } from '@customs/db';
import { mysteryPublicHookSchema } from '@customs/db/schemas';
import { formatDuration } from '../discord/embeds';
import { awardHookLines, buildAwardClues, buildStoredClues, hookLines, type StoredClue } from './clues';
import { kdaLine } from './copy';
import { MYSTERY_MIN_DURATION_S, scorePerformance } from './score';
import {
  kindForDay,
  type MysteryCandidate,
  pickAwardStandout,
  pickMystery,
  type SelectAvoid,
  shuffleSuspects,
} from './select';
import type {
  AwardCategory,
  ChallengeCategory,
  MysteryHookLine,
  MysteryKind,
  MysteryPublicHook,
} from './types';

/**
 * Building the day's challenge, for either game, with no database in the room (M5.32, M8.4).
 *
 * `ensure.ts` reads the rows and writes the row; everything between — which game today is,
 * which performance it is about, who the suspects are, what the hook says and what the clue
 * ladder holds — is here and is pure, so the rotation, the fallback and the shared memory of
 * recent answers are testable without a stack.
 *
 * **One builder, two candidate strategies.** The mystery strategy is `scorePerformance`
 * (M5.32, unchanged by M8.4). The award strategy is `performanceScores` from
 * `@customs/core` by way of `pickAwardStandout` — no second definition of "standout" exists
 * in this directory, and none may be added here.
 */

export interface BuildSeat {
  playerId: string;
  side: number;
  role: RoleValue | null;
  championId: number | null;
  /** From `games.raw` where the blob carried it, else the id's name. */
  championName: string | null;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damageToChamps: number;
  cs: number;
  /** M7.7 / M7.14's three. Null for anything stored before them — never 0. */
  visionScore: number | null;
  damageSelfMitigated: number | null;
  damageToObjectives: number | null;
  damageTaken: number | null;
  longestLivedS: number | null;
}

export interface BuildGame {
  id: string;
  startedAt: Date;
  durationS: number;
  /**
   * Summoner's Rift, by the stored `gameMode` (a missing mode counts as Rift, as everywhere
   * else). Daily Mystery prefers Rift and takes ARAM when there is nothing else; Guess the
   * Award refuses ARAM outright, because a vision-weighted, objective-weighted score means
   * nothing on a map with one lane and no dragons.
   */
  isRift: boolean;
  seats: BuildSeat[];
}

export interface BuildInput {
  dayKey: string;
  games: readonly BuildGame[];
  avoid: SelectAvoid;
}

export interface BuiltChallenge {
  kind: MysteryKind;
  gameId: string;
  playerId: string;
  score: number;
  category: ChallengeCategory;
  suspectIds: string[];
  hook: MysteryPublicHook;
  clues: StoredClue[];
}

/** Six names on the card, the answer among them. */
const SUSPECT_COUNT = 6;

/**
 * Today's challenge: the game the date's parity asks for, or a Daily Mystery when an award
 * day has nothing scorable in the window.
 *
 * **The fallback does not shift the rotation.** Tomorrow is whatever `kindForDay` says
 * tomorrow is; a fallback day does not owe an award day back. `null` — neither game can be
 * built — is the empty card, and only an empty database gets there.
 */
export function planChallenge(input: BuildInput): BuiltChallenge | null {
  const kind = kindForDay(input.dayKey);
  const wanted = buildChallenge(input, kind);
  if (wanted !== null) return wanted;
  return kind === 'award' ? buildChallenge(input, 'mystery') : null;
}

export function buildChallenge(input: BuildInput, kind: MysteryKind): BuiltChallenge | null {
  const candidates = kind === 'award' ? awardCandidates(input.games) : mysteryCandidates(input.games);
  // One pool, one picker, one avoidance rule for both games: being yesterday's answer in
  // either game keeps you out of today's in either game.
  const picked = pickMystery(candidates, input.dayKey, input.avoid);
  if (picked === null) return null;

  const game = input.games.find((row) => row.id === picked.gameId);
  const seat = game?.seats.find((row) => row.playerId === picked.playerId);
  if (game === undefined || seat === undefined) return null;

  const hook = mysteryPublicHookSchema.parse(
    kind === 'award'
      ? awardHook(game, seat, picked.category as AwardCategory)
      : mysteryHook(game, seat, picked.category as Exclude<ChallengeCategory, AwardCategory>),
  ) as MysteryPublicHook;

  const history = playerHistory(input.games, seat);
  const clues =
    kind === 'award'
      ? buildAwardClues({
          category: picked.category as AwardCategory,
          champion: seat.championName,
          role: seat.role,
          damage: seat.damageToChamps,
          cs: seat.cs,
          gold: seat.gold,
          damageTaken: seat.damageTaken,
          championTimes: history.championTimes,
          gamesPlayed: history.gamesPlayed,
        })
      : buildStoredClues({
          category: picked.category as Exclude<ChallengeCategory, AwardCategory>,
          champion: seat.championName,
          role: seat.role,
          damage: seat.damageToChamps,
          cs: seat.cs,
          gold: seat.gold,
          damageTaken: seat.damageTaken,
          longestLivedS: seat.longestLivedS,
          championTimes: history.championTimes,
          gamesPlayed: history.gamesPlayed,
        });

  return {
    kind,
    gameId: picked.gameId,
    playerId: picked.playerId,
    score: picked.score,
    category: picked.category,
    suspectIds: pickSuspects(seat.playerId, game, input.games, input.dayKey),
    hook,
    clues,
  };
}

/**
 * Daily Mystery's candidates: every seat `scorePerformance` finds unusual, Rift first and
 * ARAM only when Rift has nothing. Exactly M5.32's rule, moved and not rewritten.
 */
function mysteryCandidates(games: readonly BuildGame[]): MysteryCandidate[] {
  const all: MysteryCandidate[] = [];
  const riftFirst: MysteryCandidate[] = [];
  for (const game of games) {
    for (const seat of game.seats) {
      const scored = scorePerformance({
        kills: seat.kills,
        deaths: seat.deaths,
        assists: seat.assists,
        cs: seat.cs,
        damage: seat.damageToChamps,
        damageTaken: seat.damageTaken,
        durationS: game.durationS,
      });
      if (scored === null) continue;
      const candidate: MysteryCandidate = {
        gameId: game.id,
        playerId: seat.playerId,
        score: scored.score,
        category: scored.category,
        startedAt: game.startedAt,
      };
      all.push(candidate);
      if (game.isRift) riftFirst.push(candidate);
    }
  }
  return riftFirst.length > 0 ? riftFirst : all;
}

/**
 * Guess the Award's candidates: one per game, the player `performanceScores` puts furthest
 * clear of the rest of their lobby.
 *
 * A game is out when it is ARAM, when it is shorter than a Daily Mystery would accept, when
 * it has fewer than six seats stored (the six suspects come from the game's own ten, which is
 * what keeps it a guess), or when core declines to score it — which is every game stored
 * before M7.7 and every backfilled one, since those carry no role.
 */
function awardCandidates(games: readonly BuildGame[]): MysteryCandidate[] {
  const out: MysteryCandidate[] = [];
  for (const game of games) {
    if (!game.isRift) continue;
    if (game.durationS < MYSTERY_MIN_DURATION_S) continue;
    if (game.seats.length < SUSPECT_COUNT) continue;
    const standout = pickAwardStandout(game.seats.map(toPerformancePlayer));
    if (standout === null) continue;
    out.push({
      gameId: game.id,
      playerId: standout.playerId,
      score: standout.score,
      category: standout.category,
      startedAt: game.startedAt,
    });
  }
  return out;
}

/**
 * A `game_players` row as `@customs/core` reads it. A rename, never a computation — and the
 * key core normalises by is the player id, because that is what the challenge row stores.
 */
function toPerformancePlayer(seat: BuildSeat): PerformancePlayer {
  return {
    puuid: seat.playerId,
    side: seat.side === 200 ? 200 : 100,
    role: seat.role,
    kills: seat.kills,
    deaths: seat.deaths,
    assists: seat.assists,
    damageToChamps: seat.damageToChamps,
    gold: seat.gold,
    cs: seat.cs,
    visionScore: seat.visionScore,
    damageSelfMitigated: seat.damageSelfMitigated,
    damageToObjectives: seat.damageToObjectives,
  };
}

function mysteryHook(
  game: BuildGame,
  seat: BuildSeat,
  category: Exclude<ChallengeCategory, AwardCategory>,
): MysteryPublicHook {
  const teamKills = game.seats
    .filter((row) => row.side === seat.side)
    .reduce((sum, row) => sum + row.kills, 0);
  const kp = teamKills <= 0 ? null : Math.round(((seat.kills + seat.assists) / teamKills) * 100);
  return baseHook(game, seat, [
    ...hookLines({
      category,
      deaths: seat.deaths,
      kp,
      cs: seat.cs,
      damage: seat.damageToChamps,
      damageTaken: seat.damageTaken,
      durationS: game.durationS,
    }),
  ]);
}

function awardHook(game: BuildGame, seat: BuildSeat, category: AwardCategory): MysteryPublicHook {
  return baseHook(game, seat, [
    ...awardHookLines({
      category,
      value: awardStatOf(seat, category),
      durationS: game.durationS,
    }),
  ]);
}

function baseHook(game: BuildGame, seat: BuildSeat, lines: MysteryHookLine[]): MysteryPublicHook {
  return {
    kills: seat.kills,
    deaths: seat.deaths,
    assists: seat.assists,
    kda: kdaLine(seat.kills, seat.deaths, seat.assists),
    durationS: game.durationS,
    durationLabel: formatDuration(game.durationS),
    lines,
  };
}

/** The raw number the award is about, off the same scoreboard the reveal prints. */
export function awardStatOf(seat: BuildSeat, category: AwardCategory): number {
  switch (category) {
    case 'kda':
      return (seat.kills + seat.assists) / Math.max(1, seat.deaths);
    case 'damage':
      return seat.damageToChamps;
    case 'gold':
      return seat.gold;
    case 'vision':
      return seat.visionScore ?? 0;
    case 'mitigation':
      return seat.damageSelfMitigated ?? 0;
    case 'cs':
      return seat.cs;
    case 'objectives':
      return seat.damageToObjectives ?? 0;
  }
}

function playerHistory(
  games: readonly BuildGame[],
  seat: BuildSeat,
): { championTimes: number | null; gamesPlayed: number } {
  let championTimes = 0;
  let gamesPlayed = 0;
  for (const game of games) {
    let played = false;
    for (const row of game.seats) {
      if (row.playerId !== seat.playerId) continue;
      played = true;
      if (seat.championId !== null && row.championId === seat.championId) championTimes += 1;
    }
    if (played) gamesPlayed += 1;
  }
  return {
    championTimes: seat.championName === null || seat.championId === null ? null : championTimes,
    gamesPlayed,
  };
}

/**
 * The six names, the answer among them, in an order every visitor sees the same way. The
 * game's own roster first — a suspect list of strangers is not a guess, it is a coin toss —
 * then the players who show up most often, so a four-player scrim still fills the card.
 */
function pickSuspects(
  answerId: string,
  game: BuildGame,
  games: readonly BuildGame[],
  dayKey: string,
): string[] {
  const counts = new Map<string, number>();
  for (const row of games) {
    for (const seat of row.seats) counts.set(seat.playerId, (counts.get(seat.playerId) ?? 0) + 1);
  }
  const sameGame = game.seats.map((row) => row.playerId).filter((id) => id !== answerId);
  const frequent = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id)
    .filter((id) => id !== answerId);
  const unique: string[] = [answerId];
  for (const id of [...sameGame, ...frequent]) {
    if (unique.includes(id)) continue;
    unique.push(id);
    if (unique.length >= SUSPECT_COUNT) break;
  }
  return shuffleSuspects(unique, dayKey);
}
