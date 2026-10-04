import 'server-only';
import { createHash } from 'node:crypto';
import { preGameOdds, SETTLING_GAMES } from '@customs/core';
import type { RoleValue } from '@customs/db';
import type {
  AiClaim,
  AiFact,
  AiFactUnit,
  AiFactValue,
  AiLineKind,
  AiTokenMap,
  PlayerToken,
} from '@customs/db/schemas';
import { championName, listChampions } from '../champs/names';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { readScoreRows, readSplitRuns } from '../games/read';
import { type GameReceipt, gameReceiptOf } from '../games/receipt';
import { aiGateOpen, readAiGate } from '../premium';
import { resultOdds } from '../receipt/copy';
import { killParticipation } from '../stats/killParticipation';
import type { ServiceClient } from '../supabase';
import { AI_FEATURES, type AiModel } from './meter';

/**
 * The fact builder (M16.3; brief 4.1 to 4.3, decisions M16.1 D4 to D6). It turns rows Kustom
 * already stores into the **closed** list of numbered facts a line may be written from, and the
 * prompt that carries them. The model writes words; every number, champion and player it may
 * use is here, and the checker (`check.ts`) rejects anything that is not.
 *
 * What the structure guarantees, before any prompt says a word:
 * - **No names.** Players are `P1..Pn`; the inputs carry `players.id` only for the token map,
 *   which stays on the server. No Riot ID, game name, PUUID, Discord name or group name is in any
 *   input type, so none can reach a request body (`facts.test.ts` checks every prompt builder).
 * - **Tease up, never down** (D5). Winners get their whole line; a losing player gets only their
 *   best numbers (a top-three or team-best kills, assists, CS, damage or vision), never deaths, a
 *   low stat or their team's total.
 * - **No odds, no MVP/ACE, no ratings on a game** (D4). The inputs do not carry them; the one
 *   fairness fact is the `Upset` flag, read off the receipt the game page already shows.
 * - **Opted-out players are absent** (D6): no token, no fact. Team totals still include their
 *   numbers, and a superlative they hold is given to nobody.
 * - Numbers in facts are whole as the site prints them; notes carry no digits (asserted).
 */

export const PROMPT_VERSION = 'm16.8-1';

/** Where a fact list came from, and how its tokens map back to players. */
export interface FactList {
  kind: AiLineKind;
  facts: AiFact[];
  tokenMap: AiTokenMap;
  /** The upset note is present: `underdog` / `upset` are allowed in the line. */
  upset: boolean;
}

/* ---------------------------------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------------------------------- */

const ROLE_ORDER: readonly RoleValue[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const ROLE_WORD: Record<RoleValue, string> = {
  top: 'top lane',
  jungle: 'jungle',
  mid: 'mid lane',
  adc: 'bot lane carry (ADC)',
  support: 'support',
};

function sideWord(side: 100 | 200): 'Blue' | 'Red' {
  return side === 100 ? 'Blue' : 'Red';
}

function value(label: string, n: number, unit: AiFactUnit, of?: number): AiFactValue {
  return of === undefined ? { label, value: n, unit } : { label, value: n, unit, of };
}

function claim(kind: AiClaim, text: string): AiFact['claims'][number] {
  return { claim: kind, text };
}

/** A champion the line may name: a roster champion's Data Dragon spelling, else none. */
function knownChampion(name: string | null): string | null {
  if (name === null) return null;
  const roster = ROSTER_NAMES.has(name);
  return roster ? name : null;
}

const ROSTER_NAMES: ReadonlySet<string> = new Set(listChampions().map((entry) => entry.name));

function numberFacts(facts: Omit<AiFact, 'id'>[]): AiFact[] {
  return facts.map((fact, index) => {
    for (const note of fact.notes) {
      if (/\d/.test(note)) throw new Error(`facts: a note carries a digit: ${note}`);
    }
    return { id: `F${index + 1}`, ...fact };
  });
}

function token(index: number): PlayerToken {
  return `P${index + 1}`;
}

/* ---------------------------------------------------------------------------------------------
 * Game facts
 * ------------------------------------------------------------------------------------------- */

/** One seat of a finished game, as much as a recap may know. No name, no rating, no award. */
export interface GameSeatInput {
  playerId: string;
  side: 100 | 200;
  role: RoleValue | null;
  /** Data Dragon spelling, or null when the row named none (or a champion the roster lacks). */
  champion: string | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damageToChamps: number;
  visionScore: number | null;
  /** What this game means against the player's own history in the group (M16.8). */
  history?: GameHistoryInput;
}

/**
 * A seat's history facts (M16.8), read from the group's earlier games by the loader. Each is only
 * a fact when it is praise: a win streak only for a winner, a first or a personal best for anyone.
 */
export interface GameHistoryInput {
  /**
   * Wins in a row ending with this game (this game included), or null. Only when it is news
   * (M16.15): {@link STREAK_NEWS_MIN} or more, or a new longest run for them from
   * {@link STREAK_RECORD_MIN}.
   */
  winStreak: number | null;
  /** The streak is longer than any earlier run of theirs in the group (M16.15). */
  longestStreak?: boolean;
  /** Their first game on this champion in the group. */
  firstOnChampion: boolean;
  /** Stats on which this game beat every earlier game of theirs in the group. */
  personalBests: SeatStat[];
}

export interface GameFactsInput {
  gameId: string;
  aram: boolean;
  durationS: number;
  winningSide: 100 | 200;
  /** The receipt's `Upset` flag: the side the odds favoured lost. The only fairness fact. */
  upset: boolean;
  seats: GameSeatInput[];
}

export type SeatStat = 'kills' | 'assists' | 'cs' | 'damage' | 'vision';

const SEAT_STATS: readonly { stat: SeatStat; label: string; unit: AiFactUnit; claim: string }[] = [
  { stat: 'kills', label: 'kills', unit: 'kills', claim: 'most kills in the game' },
  { stat: 'assists', label: 'assists', unit: 'assists', claim: 'most assists in the game' },
  { stat: 'cs', label: 'CS', unit: 'cs', claim: 'most CS in the game' },
  {
    stat: 'damage',
    label: 'damage to champions',
    unit: 'damage',
    claim: 'most damage to champions in the game',
  },
  { stat: 'vision', label: 'vision score', unit: 'vision', claim: 'highest vision score in the game' },
];

function statOf(seat: GameSeatInput, stat: SeatStat): number | null {
  switch (stat) {
    case 'kills':
      return seat.kills;
    case 'assists':
      return seat.assists;
    case 'cs':
      return seat.cs;
    case 'damage':
      return seat.damageToChamps;
    case 'vision':
      return seat.visionScore;
  }
}

/** 1-based rank of `seat` on `stat` among `pool` (ties share the better rank), or null. */
function rankOf(pool: readonly GameSeatInput[], seat: GameSeatInput, stat: SeatStat): number | null {
  const mine = statOf(seat, stat);
  if (mine === null) return null;
  return 1 + pool.filter((other) => (statOf(other, stat) ?? Number.NEGATIVE_INFINITY) > mine).length;
}

/** The one seat that holds the game's highest `stat` alone, or null on a tie or no data. */
function soleLeader(seats: readonly GameSeatInput[], stat: SeatStat): GameSeatInput | null {
  let best: GameSeatInput | null = null;
  let tie = false;
  for (const seat of seats) {
    const mine = statOf(seat, stat);
    if (mine === null) continue;
    const top = best === null ? null : statOf(best, stat);
    if (top === null || mine > top) {
      best = seat;
      tie = false;
    } else if (mine === top) {
      tie = true;
    }
  }
  return tie || best === null || (statOf(best, stat) ?? 0) <= 0 ? null : best;
}

function seatOrder(winningSide: 100 | 200) {
  return (a: GameSeatInput, b: GameSeatInput): number => {
    if (a.side !== b.side) return a.side === winningSide ? -1 : 1;
    const ra = a.role === null ? ROLE_ORDER.length : ROLE_ORDER.indexOf(a.role);
    const rb = b.role === null ? ROLE_ORDER.length : ROLE_ORDER.indexOf(b.role);
    if (ra !== rb) return ra - rb;
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  };
}

/** Whole minutes as the site prints a game's length (`formatMinutes`). */
function gameMinutes(durationS: number): number {
  return Math.max(1, Math.floor(Math.max(0, durationS) / 60));
}

/** The floor for a win-streak fact (M16.15: history only hands over streaks that are news). */
export const WIN_STREAK_MIN = 4;
/** A streak is news from this many wins in a row (M16.15; was 3, which turned up most nights). */
export const STREAK_NEWS_MIN = 5;
/** ...or from this many when it is the player's longest run in the group (M16.15). */
export const STREAK_RECORD_MIN = 4;
/** Under this many minutes a game is short; from the second this many, long. */
export const SHORT_GAME_MINUTES = 20;
export const LONG_GAME_MINUTES = 45;
/** The winners took at least this many times the losers' kills: one-sided. */
export const ONE_SIDED_RATIO = 2.5;
/** Team kills this close (or closer): a close game. */
export const CLOSE_KILLS = 3;

/** The one seat with the most deaths in the game, or null on a tie or nobody dying. */
function soleMaxDeaths(seats: readonly GameSeatInput[]): GameSeatInput | null {
  let best: GameSeatInput | null = null;
  let tie = false;
  for (const seat of seats) {
    if (best === null || seat.deaths > best.deaths) {
      best = seat;
      tie = false;
    } else if (seat.deaths === best.deaths) tie = true;
  }
  return tie || best === null || best.deaths <= 0 ? null : best;
}

/**
 * The game's shape in words (no digits): short or long, one-sided or close, won with fewer kills.
 * Read off the team kills on both sides, but never printing the losers' total (D5).
 */
export function gameShape(input: GameFactsInput, winnerKills: number, loserKills: number): string[] {
  const notes: string[] = [];
  const minutes = gameMinutes(input.durationS);
  if (minutes < SHORT_GAME_MINUTES) notes.push('short game');
  else if (minutes >= LONG_GAME_MINUTES) notes.push('long game');
  if (winnerKills < loserKills) notes.push('the winners had fewer team kills than the losers');
  else if (winnerKills - loserKills <= CLOSE_KILLS && winnerKills + loserKills >= 10)
    notes.push('close game: the team kills were nearly level');
  else if (winnerKills >= ONE_SIDED_RATIO * Math.max(1, loserKills)) notes.push('lopsided game');
  return notes;
}

/** A losing seat's number is earned from this place in the game for that stat (M16.16). */
export const LOSER_TOP_RANK = 2;

/**
 * The numbers a losing seat earned (M16.16): each stat where they are top {@link LOSER_TOP_RANK}
 * in the game (ties share the better place), and each personal best in the group. Pure.
 */
export function earnedLoserValues(all: readonly GameSeatInput[], seat: GameSeatInput): AiFactValue[] {
  const values: AiFactValue[] = [];
  for (const entry of SEAT_STATS) {
    const n = statOf(seat, entry.stat);
    if (n === null || n <= 0) continue;
    const gameRank = rankOf(all, seat, entry.stat);
    const best = (seat.history?.personalBests ?? []).includes(entry.stat);
    if ((gameRank !== null && gameRank <= LOSER_TOP_RANK) || best)
      values.push(value(entry.label, n, entry.unit));
  }
  return values;
}

/**
 * The game recap's facts, or null when nobody is left to write about (everyone opted out, or an
 * empty scoreboard).
 */
export function buildGameFacts(input: GameFactsInput, optedOut: ReadonlySet<string>): FactList | null {
  const all = input.seats;
  const seated = [...all].filter((seat) => !optedOut.has(seat.playerId)).sort(seatOrder(input.winningSide));
  // M16.16: someone who lost is named only for a number they earned. The rest keep their place in
  // the token order (so tokens stay stable) but get no token in the map and no fact, so a line
  // cannot name them at all.
  const earns = (seat: GameSeatInput) =>
    seat.side === input.winningSide || earnedLoserValues(all, seat).length > 0;
  const named = seated.filter(earns);
  if (named.length === 0) return null;

  const tokens = new Map<string, PlayerToken>(
    seated.flatMap((seat, index) => (earns(seat) ? [[seat.playerId, token(index)] as const] : [])),
  );
  const tokenMap: AiTokenMap = Object.fromEntries(
    seated.flatMap((seat, index) => (earns(seat) ? [[token(index), seat.playerId] as const] : [])),
  );

  const winner = sideWord(input.winningSide);
  const teamKills = (side: 100 | 200) =>
    all.filter((seat) => seat.side === side).reduce((sum, seat) => sum + seat.kills, 0);

  const leaders = new Map<SeatStat, GameSeatInput | null>(
    SEAT_STATS.map(({ stat }) => [stat, soleLeader(all, stat)]),
  );
  const zeroDeathWinners = all.filter((seat) => seat.side === input.winningSide && seat.deaths === 0);
  // Teasing material, winners only (D5): the one winner who died more than anyone in the game.
  const mostDeaths = soleMaxDeaths(all);
  const mostDeathsWinner = mostDeaths !== null && mostDeaths.side === input.winningSide ? mostDeaths : null;

  const facts: Omit<AiFact, 'id'>[] = [];
  facts.push({
    token: null,
    side: null,
    notes: [
      input.aram ? 'ARAM custom game' : "Summoner's Rift custom game",
      `${winner} won`,
      ...(input.upset ? ['upset: the underdog won'] : []),
    ],
    champions: [],
    values: [value('game length', gameMinutes(input.durationS), 'minutes')],
    claims: [],
  });
  facts.push({
    token: null,
    side: input.winningSide,
    notes: [`${winner} team`, 'won'],
    champions: [],
    values: [value('team kills', teamKills(input.winningSide), 'kills')],
    claims: [],
  });

  for (const seat of named) {
    const won = seat.side === input.winningSide;
    const notes = [`${sideWord(seat.side)} team`, won ? 'won' : 'lost'];
    if (seat.role !== null) notes.push(ROLE_WORD[seat.role]);
    const champion = knownChampion(seat.champion);
    const claims: AiFact['claims'] = [];
    for (const { stat, claim: text } of SEAT_STATS) {
      if (leaders.get(stat) === seat) claims.push(claim('max', text));
    }

    const values: AiFactValue[] = [];
    if (won) {
      values.push(value('kills', seat.kills, 'kills'));
      values.push(value('deaths', seat.deaths, 'deaths'));
      values.push(value('assists', seat.assists, 'assists'));
      values.push(value('CS', seat.cs, 'cs'));
      values.push(value('damage to champions', seat.damageToChamps, 'damage'));
      if (seat.visionScore !== null) values.push(value('vision score', seat.visionScore, 'vision'));
      const kills = teamKills(seat.side);
      // M14.77: only when the side's kills cover this player's takedowns (never over 100%).
      if (killParticipation(seat.kills, seat.assists, kills) !== null)
        values.push(value('team kills they took part in', seat.kills + seat.assists, 'kills', kills));
      if (seat.deaths === 0) {
        claims.push(claim('all', 'no deaths all game'));
        if (zeroDeathWinners.length === 1) claims.push(claim('min', 'fewest deaths in the game'));
      }
      if (mostDeathsWinner === seat) {
        claims.push(claim('max', 'most deaths in the game, on the winning team'));
        notes.push('still won');
      }
      const streak = seat.history?.winStreak ?? null;
      if (streak !== null && streak >= WIN_STREAK_MIN) {
        values.push(value('wins in a row', streak, 'streak'));
        if (seat.history?.longestStreak === true)
          claims.push(claim('max', 'their longest run of wins in a row in the group'));
      }
    } else {
      // The losing side (M16.16): only numbers they earned -- top 2 in the game for that stat (the
      // lead included) or a personal best in the group. Never deaths, never their total; a loser
      // with no such number is not in the facts at all (`loserEarns`).
      for (const value_ of earnedLoserValues(all, seat)) values.push(value_);
      if (claims.length > 0) notes.push('standout on the losing side');
    }

    // History (M16.8): a first on a champion and personal bests, for either side (both are praise).
    if (seat.history?.firstOnChampion === true && champion !== null) {
      claims.push(claim('first', `first game on ${champion} in the group`));
    }
    for (const stat of seat.history?.personalBests ?? []) {
      const entry = SEAT_STATS.find((candidate) => candidate.stat === stat);
      const n = statOf(seat, stat);
      if (entry === undefined || n === null || n <= 0) continue;
      claims.push(claim('max', `personal best: their most ${entry.label} in the group`));
    }

    facts.push({
      token: tokens.get(seat.playerId) ?? null,
      side: seat.side,
      notes,
      champions: champion === null ? [] : [champion],
      values,
      claims,
    });
  }

  // The game's shape (M16.8), last so the ids above never move: words only, never the losers' total.
  const shape = gameShape(
    input,
    teamKills(input.winningSide),
    teamKills(input.winningSide === 100 ? 200 : 100),
  );
  if (shape.length > 0) {
    facts.push({ token: null, side: null, notes: shape, champions: [], values: [], claims: [] });
  }

  return { kind: 'game', facts: numberFacts(facts), tokenMap, upset: input.upset };
}

/* ---------------------------------------------------------------------------------------------
 * Week facts (M16.5 wires the Sunday post's numbers in)
 * ------------------------------------------------------------------------------------------- */

export interface WeekFactsInput {
  /** `YYYY-MM-DD`, the week's Sunday on the group clock. */
  weekStart: string;
  /** Rated games in the week, as the Sunday post counts them. */
  ratedGames: number;
  /**
   * The closed week's board, best first, as the Sunday post prints it (ranked by week points since
   * M18.6, `round(weekly R) − 1200`). No Rating: the week post prints none (M16.5).
   */
  board: { playerId: string; games: number; wins: number }[];
  /** Week points (the board's sorted number, `round(weekly R) − 1200`, M18.6). Only positive ones become facts. */
  climbs: { playerId: string; climb: number }[];
  /** Longest win streaks of the week (3 or more become facts). */
  streaks: { playerId: string; wins: number }[];
  /** The three awards, as the post names them. `label` lowercase words, no digits. */
  awards: { label: string; playerId: string | null; value: number | null; unit: AiFactUnit | null }[];
}

/** How many of the board's top rows the storyline may talk about. */
export const WEEK_BOARD_ROWS = 5;
export const WEEK_STREAK_MIN = 3;
/** A week won game for game becomes a claim from this many games (M16.13). */
export const WEEK_PERFECT_MIN = 5;

export function buildWeekFacts(input: WeekFactsInput, optedOut: ReadonlySet<string>): FactList | null {
  const top = input.board.slice(0, WEEK_BOARD_ROWS);
  const people = new Set<string>();
  for (const row of top) people.add(row.playerId);
  for (const climb of input.climbs) if (climb.climb > 0) people.add(climb.playerId);
  for (const streak of input.streaks) if (streak.wins >= WEEK_STREAK_MIN) people.add(streak.playerId);
  for (const award of input.awards) if (award.playerId !== null) people.add(award.playerId);
  const order = [...people].filter((id) => !optedOut.has(id));
  if (order.length === 0) return null;

  // Tokens in board order first, then the rest as they appear.
  const ordered = [
    ...top.map((row) => row.playerId).filter((id) => order.includes(id)),
    ...order.filter((id) => !top.some((row) => row.playerId === id)),
  ];
  const tokens = new Map(ordered.map((id, index) => [id, token(index)]));
  const tokenMap: AiTokenMap = Object.fromEntries(ordered.map((id, index) => [token(index), id]));

  const positive = input.climbs.filter((entry) => entry.climb > 0);
  const biggest = positive.reduce<{ playerId: string; climb: number } | null>(
    (best, entry) => (best === null || entry.climb > best.climb ? entry : best),
    null,
  );
  const biggestTied =
    biggest !== null && positive.filter((entry) => entry.climb === biggest.climb).length > 1;

  // The one player who played more games than anyone on the whole board, or nobody on a tie.
  const maxGames = Math.max(0, ...input.board.map((row) => row.games));
  const mostGamesRows = input.board.filter((row) => row.games === maxGames);
  const mostGames = maxGames > 0 && mostGamesRows.length === 1 ? (mostGamesRows[0] ?? null) : null;

  const facts: Omit<AiFact, 'id'>[] = [
    {
      token: null,
      side: null,
      notes: ['the closed week of custom games'],
      champions: [],
      values: [value('rated games in the week', input.ratedGames, 'games')],
      claims: [],
    },
  ];
  for (const id of ordered) {
    const values: AiFactValue[] = [];
    const claims: AiFact['claims'] = [];
    const notes: string[] = [];
    const place = top.findIndex((row) => row.playerId === id);
    if (place >= 0) {
      const row = top[place] as (typeof top)[number];
      values.push(value("place on the week's board", place + 1, 'place'));
      values.push(value('games in the week', row.games, 'games'));
      values.push(value('wins in the week', row.wins, 'wins'));
      if (place === 0) {
        claims.push(claim('first', "first on the week's board"));
        claims.push(claim('max', "top of the week's board, most points in the week"));
      }
      // M16.13: what the board shows and the model kept reaching for, now as facts it may use.
      if (mostGames?.playerId === id) claims.push(claim('max', 'most games played in the week'));
      if (row.games >= WEEK_PERFECT_MIN && row.wins === row.games)
        claims.push(claim('all', 'won every game they played in the week'));
    }
    const climb = positive.find((entry) => entry.playerId === id);
    if (climb !== undefined) {
      values.push(value('points in the week', climb.climb, 'rating'));
      if (biggest?.playerId === id && !biggestTied) claims.push(claim('max', 'biggest climb of the week'));
    }
    const streak = input.streaks.find((entry) => entry.playerId === id && entry.wins >= WEEK_STREAK_MIN);
    if (streak !== undefined) values.push(value('wins in a row', streak.wins, 'streak'));
    for (const award of input.awards) {
      if (award.playerId !== id) continue;
      const label = award.label.toLowerCase();
      notes.push(`won the ${label} award`);
      if (/\b(most|best|top|highest|biggest)\b/.test(label)) claims.push(claim('max', `${label} award`));
      if (award.value !== null && award.unit !== null) values.push(value(label, award.value, award.unit));
    }
    facts.push({ token: tokens.get(id) ?? null, side: null, notes, champions: [], values, claims });
  }
  return { kind: 'week', facts: numberFacts(facts), tokenMap, upset: false };
}

/* ---------------------------------------------------------------------------------------------
 * Player facts (M16.6 wires the per-player counts in)
 * ------------------------------------------------------------------------------------------- */

export interface PlayerFactsInput {
  playerId: string;
  /** `YYYY-MM-DD`: the Sunday the report is written for. */
  weekStart: string;
  /** Rated games in this group, all time. Under `SETTLING_GAMES` there is no report. */
  ratedGames: number;
  wins: number;
  weekGames: number;
  weekWins: number;
  champions: { name: string; games: number; wins: number }[];
  roles: { role: RoleValue; games: number; wins: number }[];
  /**
   * What the page does not already lead with (M16.19): each optional, each from the group's own
   * rated games. Built by `scoutingExtrasOf` (`lib/ai/scouting.ts`).
   */
  extras?: PlayerExtras;
}

export interface PlayerExtras {
  /** The teammate they won most with, over {@link DUO_MIN_GAMES}+ games together; never opted out. */
  duo?: { partnerId: string; games: number; wins: number };
  /** Their best game in the week before the report (most kills plus assists), with its numbers. */
  bestGame?: { champion: string | null; kills: number; assists: number; won: boolean };
  /** A champion they played for the first time in the group during that week. */
  newChampion?: { name: string; games: number };
  /** The week's main role, when it is not their usual one ({@link ROLE_SHIFT_MIN_GAMES}+ games). */
  roleShift?: { weekRole: RoleValue; weekGames: number; usualRole: RoleValue };
}

/** A duo partner needs this many games together (M16.19). */
export const DUO_MIN_GAMES = 5;
/** A role shift needs this many games in the week's role (M16.19). */
export const ROLE_SHIFT_MIN_GAMES = 3;

/** A champion or role figure needs this many games behind it (brief 4.1). */
export const PLAYER_FIGURE_MIN_GAMES = 5;
const PLAYER_FIGURES = 3;

function winPercent(wins: number, games: number): number {
  return games === 0 ? 0 : Math.round((wins / games) * 100);
}

export function buildPlayerFacts(input: PlayerFactsInput, optedOut: ReadonlySet<string>): FactList | null {
  if (optedOut.has(input.playerId) || input.ratedGames < SETTLING_GAMES) return null;
  const me: PlayerToken = 'P1';
  const facts: Omit<AiFact, 'id'>[] = [];
  const overall: AiFactValue[] = [
    value('rated games in the group', input.ratedGames, 'games'),
    value('wins in the group', input.wins, 'wins'),
  ];
  const pct = winPercent(input.wins, input.ratedGames);
  if (pct >= 50) overall.push(value('win rate in the group', pct, 'percent'));
  if (input.weekGames > 0) {
    overall.push(value('games in the week before this report', input.weekGames, 'games'));
    overall.push(value('wins in the week before this report', input.weekWins, 'wins'));
  }
  facts.push({
    token: me,
    side: null,
    notes: ['the player this report is about'],
    champions: [],
    values: overall,
    claims: [],
  });

  const champions = input.champions
    .filter((entry) => entry.games >= PLAYER_FIGURE_MIN_GAMES && knownChampion(entry.name) !== null)
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
    .slice(0, PLAYER_FIGURES);
  champions.forEach((entry, index) => {
    const values = [
      value(`games on ${entry.name}`, entry.games, 'games'),
      value(`wins on ${entry.name}`, entry.wins, 'wins'),
    ];
    const p = winPercent(entry.wins, entry.games);
    if (p >= 50) values.push(value(`win rate on ${entry.name}`, p, 'percent'));
    const tied = champions.filter((other) => other.games === entry.games).length > 1;
    facts.push({
      token: me,
      side: null,
      notes: ['champion pool'],
      champions: [entry.name],
      values,
      claims: index === 0 && !tied ? [claim('max', `most played champion, ${entry.name}`)] : [],
    });
  });

  const roles = input.roles
    .filter((entry) => entry.games >= PLAYER_FIGURE_MIN_GAMES)
    .sort((a, b) => b.games - a.games || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
    .slice(0, PLAYER_FIGURES);
  roles.forEach((entry, index) => {
    const values = [
      value(`games in ${ROLE_WORD[entry.role]}`, entry.games, 'games'),
      value(`wins in ${ROLE_WORD[entry.role]}`, entry.wins, 'wins'),
    ];
    const tied = roles.filter((other) => other.games === entry.games).length > 1;
    facts.push({
      token: me,
      side: null,
      notes: [`role: ${ROLE_WORD[entry.role]}`],
      champions: [],
      values,
      claims: index === 0 && !tied ? [claim('max', `most played role, ${ROLE_WORD[entry.role]}`)] : [],
    });
  });

  // M16.19: the facts the page does not lead with. The duo partner is a second token.
  const tokenMap: AiTokenMap = { [me]: input.playerId };
  const extras = input.extras ?? {};
  if (extras.duo !== undefined && !optedOut.has(extras.duo.partnerId) && extras.duo.games >= DUO_MIN_GAMES) {
    const partner: PlayerToken = 'P2';
    tokenMap[partner] = extras.duo.partnerId;
    facts.push({
      token: partner,
      side: null,
      notes: ['the teammate the player this report is about wins with most, in the group'],
      champions: [],
      values: [
        value('games together on the same team', extras.duo.games, 'games'),
        value('wins together on the same team', extras.duo.wins, 'wins'),
      ],
      claims: [claim('max', 'most wins together with the player this report is about, of any teammate')],
    });
  }
  if (extras.bestGame !== undefined) {
    const champion = knownChampion(extras.bestGame.champion);
    facts.push({
      token: me,
      side: null,
      notes: [
        'their best game in the week before this report',
        extras.bestGame.won ? 'it was a win' : 'it was a loss',
      ],
      champions: champion === null ? [] : [champion],
      values: [
        value('kills in that game', extras.bestGame.kills, 'kills'),
        value('assists in that game', extras.bestGame.assists, 'assists'),
      ],
      claims: [claim('max', 'their best game of the week before this report')],
    });
  }
  if (extras.newChampion !== undefined && knownChampion(extras.newChampion.name) !== null) {
    facts.push({
      token: me,
      side: null,
      notes: ['new to their pool in the week before this report'],
      champions: [extras.newChampion.name],
      values: [
        value(
          `games on ${extras.newChampion.name} in the week before this report`,
          extras.newChampion.games,
          'games',
        ),
      ],
      claims: [
        claim(
          'first',
          `first games on ${extras.newChampion.name} in the group, in the week before this report`,
        ),
      ],
    });
  }
  if (extras.roleShift !== undefined && extras.roleShift.weekGames >= ROLE_SHIFT_MIN_GAMES) {
    facts.push({
      token: me,
      side: null,
      notes: [
        `in the week before this report: mostly ${ROLE_WORD[extras.roleShift.weekRole]}, away from their usual ${ROLE_WORD[extras.roleShift.usualRole]}`,
      ],
      champions: [],
      values: [
        value(
          `games in ${ROLE_WORD[extras.roleShift.weekRole]} in the week before this report`,
          extras.roleShift.weekGames,
          'games',
        ),
      ],
      claims: [],
    });
  }

  return { kind: 'player', facts: numberFacts(facts), tokenMap, upset: false };
}

/* ---------------------------------------------------------------------------------------------
 * Loading a game's facts from the store (existing loaders, core's odds)
 * ------------------------------------------------------------------------------------------- */

/** What generation needs to decide whether a game may have a line at all. */
export interface GameMeta {
  id: string;
  groupId: string;
  source: 'eog' | 'backfill';
  createdAt: string;
}

export async function readGameMeta(
  service: ServiceClient,
  groupId: string,
  gameId: string,
): Promise<GameMeta | null> {
  const { data, error } = await service
    .from('games')
    .select('id, group_id, source, created_at')
    .eq('id', gameId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`ai facts: game lookup failed: ${error.message}`);
  if (data === null) return null;
  return { id: data.id, groupId: data.group_id, source: data.source, createdAt: data.created_at };
}

/**
 * The recap's `upset` fact, by the receipt's own `Upset` rule: the rolled split's odds, or core's
 * `preGameOdds` for a game with no roll. A receipt with no odds (an ARAM, or since M15.18 a game
 * played not rated whose teams are not the bot's) is never an upset.
 */
export function receiptUpset(receipt: GameReceipt, winningSide: 100 | 200): boolean {
  let blueWinProb: number | null = null;
  if (receipt.kind === 'rolled') blueWinProb = receipt.chosen.blueWinProb;
  else if (receipt.kind === 'pre-game')
    blueWinProb = preGameOdds(receipt.ratingsBefore.blue, receipt.ratingsBefore.red);
  return blueWinProb !== null && Number.isFinite(blueWinProb) && resultOdds(blueWinProb, winningSide).upset;
}

/**
 * One stored game as a {@link GameFactsInput}, through the game page's own readers
 * (`readScoreRows`, `readSplitRuns`, `gameReceiptOf`) and the receipt's own `Upset` rule
 * (`resultOdds` over the rolled split's odds, or core's `preGameOdds` when there was no roll), so
 * the line can never disagree with the page it sits on. Null for a game of another group, an
 * unfinished one, or an empty scoreboard. **Checks the gate first** and reads nothing for a group
 * whose AI is off.
 */
export async function loadGameFactsInput(
  service: ServiceClient,
  groupId: string,
  gameId: string,
  /** Players who opted out (D6): their history is never read; they are left out of the facts anyway. */
  optedOut: ReadonlySet<string> = new Set(),
): Promise<GameFactsInput | null> {
  if (!aiGateOpen(await readAiGate(service, groupId))) return null;
  const { data: game, error } = await service
    .from('games')
    .select('id, duration_s, winning_side, lobby_id, raw, started_at, rated')
    .eq('id', gameId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`ai facts: game lookup failed: ${error.message}`);
  if (game === null || (game.winning_side !== 100 && game.winning_side !== 200)) return null;
  const winningSide: 100 | 200 = game.winning_side;

  const [rows, runs] = await Promise.all([
    readScoreRows(service, [game.id]),
    game.lobby_id === null ? Promise.resolve(new Map()) : readSplitRuns(service, [game.lobby_id]),
  ]);
  if (rows.length === 0) return null;
  const aram = matchesQueue(gameModeFromRaw(game.raw), 'aram');

  const receipt = gameReceiptOf({
    aram,
    // M15.18: a game played not rated keeps its rolled odds (and its `Upset`), never pre-game odds.
    rated: game.rated,
    seats: rows.map((row) => ({
      puuid: row.playerId,
      side: row.side,
      rBefore: row.rBefore,
    })),
    splits: game.lobby_id === null ? [] : (runs.get(game.lobby_id) ?? []),
  });
  const upset = receiptUpset(receipt, winningSide);

  const histories = await Promise.all(
    rows.map((row) =>
      optedOut.has(row.playerId)
        ? Promise.resolve(null)
        : readSeatHistory(service, groupId, row.playerId, game.started_at),
    ),
  );

  return {
    gameId: game.id,
    aram,
    durationS: game.duration_s,
    winningSide,
    upset,
    seats: rows.map((row, index) => {
      const seat: GameSeatInput = {
        playerId: row.playerId,
        side: row.side,
        role: row.role,
        champion: row.championId === null ? null : knownChampion(championName(row.championId, null)),
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        cs: row.cs,
        damageToChamps: row.damageToChamps,
        visionScore: row.visionScore,
      };
      const history = gameHistoryOf(
        { ...seat, championId: row.championId, won: row.side === winningSide, aram },
        histories[index] ?? null,
      );
      return history === null ? seat : { ...seat, history };
    }),
  };
}

/* ---------------------------------------------------------------------------------------------
 * History facts (M16.8): streaks, firsts, personal bests
 * ------------------------------------------------------------------------------------------- */

/** One earlier game of a player in the group, as the history fold needs it. */
export interface HistoryRow {
  startedAt: string;
  won: boolean;
  aram: boolean;
  championId: number | null;
  kills: number;
  assists: number;
  cs: number;
  damageToChamps: number;
  visionScore: number | null;
}

/** "First time on a champion" only means something after this many earlier games in the group. */
export const FIRST_CHAMPION_MIN_GAMES = 5;
/** A personal best only counts against at least this many earlier Rift games in the group. */
export const PERSONAL_BEST_MIN_GAMES = 10;

function historyStat(row: HistoryRow | GameSeatInput, stat: SeatStat): number | null {
  switch (stat) {
    case 'kills':
      return row.kills;
    case 'assists':
      return row.assists;
    case 'cs':
      return row.cs;
    case 'damage':
      return row.damageToChamps;
    case 'vision':
      return row.visionScore;
  }
}

/**
 * A seat's history facts from its earlier games in the group (pure). Null when nothing applies
 * or the history could not be read (`earlier` null): a missing history is no fact, never a guess.
 * - **Win streak**: wins in a row ending with this game, any mode, winners only, from
 *   {@link WIN_STREAK_MIN}.
 * - **First on a champion**: no earlier game on it, after {@link FIRST_CHAMPION_MIN_GAMES} games.
 * - **Personal best**: a Rift stat above every earlier Rift game, against at least
 *   {@link PERSONAL_BEST_MIN_GAMES} of them (ARAM numbers are another game, never compared).
 */
export function gameHistoryOf(
  seat: GameSeatInput & { championId: number | null; won: boolean; aram: boolean },
  earlier: readonly HistoryRow[] | null,
): GameHistoryInput | null {
  if (earlier === null) return null;
  const ordered = [...earlier].sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
  );
  let winStreak: number | null = null;
  let longestStreak = false;
  if (seat.won) {
    let run = 1;
    for (const row of ordered) {
      if (!row.won) break;
      run += 1;
    }
    // The longest run of wins in their earlier games, oldest first.
    let longestBefore = 0;
    let current = 0;
    for (const row of [...ordered].reverse()) {
      current = row.won ? current + 1 : 0;
      longestBefore = Math.max(longestBefore, current);
    }
    const record = run > longestBefore;
    if (run >= STREAK_NEWS_MIN || (record && run >= STREAK_RECORD_MIN)) {
      winStreak = run;
      longestStreak = record;
    }
  }
  const firstOnChampion =
    seat.championId !== null &&
    seat.champion !== null &&
    earlier.length >= FIRST_CHAMPION_MIN_GAMES &&
    !earlier.some((row) => row.championId === seat.championId);
  const personalBests: SeatStat[] = [];
  const rift = earlier.filter((row) => !row.aram);
  if (!seat.aram && rift.length >= PERSONAL_BEST_MIN_GAMES) {
    for (const { stat } of SEAT_STATS) {
      const mine = historyStat(seat, stat);
      if (mine === null || mine <= 0) continue;
      const before = rift.map((row) => historyStat(row, stat)).filter((n): n is number => n !== null);
      if (before.length >= PERSONAL_BEST_MIN_GAMES && before.every((n) => mine > n)) personalBests.push(stat);
    }
  }
  if (winStreak === null && !firstOnChampion && personalBests.length === 0) return null;
  return { winStreak, ...(longestStreak ? { longestStreak } : {}), firstOnChampion, personalBests };
}

const HISTORY_PAGE = 1000;
/**
 * At most this many pages of one player's history (5,000 games). Past it the history is not read
 * whole, and a partial history could hand out a false first or personal best: no history facts.
 */
export const HISTORY_MAX_PAGES = 5;

/**
 * A player's games in the group before `before`, or null when the read fails or the history is
 * longer than {@link HISTORY_MAX_PAGES} pages (the line is then written without history facts;
 * never a failed line). Paged in a stable order (`game_id`); the fold sorts by `started_at`.
 */
export async function readSeatHistory(
  service: ServiceClient,
  groupId: string,
  playerId: string,
  before: string,
): Promise<HistoryRow[] | null> {
  try {
    const rows: HistoryRow[] = [];
    for (let page = 0; ; page += 1) {
      if (page >= HISTORY_MAX_PAGES) {
        console.info(`ai facts: history over ${HISTORY_MAX_PAGES} pages, no history facts`);
        return null;
      }
      const from = page * HISTORY_PAGE;
      const { data, error } = await service
        .from('game_players')
        .select(
          'side, champion_id, kills, assists, cs, damage_to_champs, vision_score, games!inner(group_id, started_at, winning_side, game_mode:raw->>gameMode)',
        )
        .eq('player_id', playerId)
        .eq('games.group_id', groupId)
        .lt('games.started_at', before)
        .order('game_id', { ascending: true })
        .range(from, from + HISTORY_PAGE - 1);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const g = row.games as unknown as {
          started_at: string;
          winning_side: number;
          game_mode: string | null;
        } | null;
        if (g === null) continue;
        rows.push({
          startedAt: g.started_at,
          won: g.winning_side === row.side,
          aram: matchesQueue(g.game_mode, 'aram'),
          championId: row.champion_id,
          kills: row.kills,
          assists: row.assists,
          cs: row.cs,
          damageToChamps: row.damage_to_champs,
          visionScore: row.vision_score,
        });
      }
      if ((data ?? []).length < HISTORY_PAGE) break;
    }
    return rows;
  } catch (error) {
    console.error('ai facts: no history facts', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

/* ---------------------------------------------------------------------------------------------
 * Rendering facts, the prompt, and the hash
 * ------------------------------------------------------------------------------------------- */

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Damage as the line should print it (M16.8): `29.9k`, rounded to the nearest hundred, which the
 * checker matches against the exact value (`sameNumber`). A model left to round 29880 itself wrote
 * `29.8k` and lost the line.
 */
export function thousands(n: number): string {
  if (Math.abs(n) < 1000) return formatNumber(n);
  const k = Math.round(n / 100) / 10;
  return `${Number.isInteger(k) ? String(k) : k.toFixed(1)}k`;
}

/** `F3: P4 | Blue team | won | jungle | champion Lee Sin | 9 kills | 14 of 19 team kills ... | most kills in the game` */
export function renderFact(fact: AiFact): string {
  return renderFactWith(fact, {});
}

/** {@link renderFact}, with damage in thousands (`29.9k`) when asked: what the game prompt prints. */
export function renderFactWith(fact: AiFact, options: { thousands?: boolean }): string {
  const parts: string[] = [`${fact.id}:`];
  if (fact.token !== null) parts.push(fact.token);
  else if (fact.side !== null) parts.push(`${sideWord(fact.side)} team`);
  else parts.push('game');
  const head = parts.join(' ');
  const body = [
    ...fact.notes.filter(
      (note) => !(fact.token === null && fact.side !== null && note === `${sideWord(fact.side)} team`),
    ),
    ...fact.champions.map((name) => `champion ${name}`),
    ...fact.values.map((v) =>
      v.of === undefined
        ? `${options.thousands === true && v.unit === 'damage' ? thousands(v.value) : formatNumber(v.value)} ${v.label}`
        : `${formatNumber(v.value)} of ${formatNumber(v.of)} ${v.label}`,
    ),
    ...fact.claims.map((c) => c.text),
  ];
  return [head, ...body].join(' | ');
}

/**
 * The strongest stories in a game's facts, best first (M16.8): what a friend would bring up after
 * the game. Read off the facts alone (claims, notes, the streak value), so it can only point at
 * what the line may say. At most four, so the model picks one rather than reciting all of them.
 */
/**
 * What a game line leads with (M16.15): the kind of its first sentence's story, read off the words.
 * `other` is anything the rotation does not track. Pure; used on stored lines and new ones alike.
 */
export type AngleKind =
  | 'upset'
  | 'streak'
  | 'best'
  | 'first'
  | 'deathless'
  | 'loser'
  | 'deaths'
  | 'shape'
  | 'other';

const LEAD_PATTERNS: readonly [AngleKind, RegExp][] = [
  ['upset', /\b(upset|underdogs?)\b/i],
  ['streak', /\bin a row\b|\bstraight wins\b|\bwinning run\b/i],
  ['best', /\bpersonal best\b|\btheir (best|most)\b.*\bin the group\b/i],
  ['first', /\bfirst (time|game)\b/i],
  ['loser', /\blosing (side|team)\b|\bin a loss\b|\bstill lost\b/i],
  ['deathless', /\bwithout (a single )?(death|dying)\b|\b0 deaths\b|\bno deaths\b|\bnever died\b/i],
  ['deaths', /\bmost deaths\b|\b\d+ deaths\b/i],
  ['shape', /\b(minutes|lopsided|close game|fewer team kills)\b/i],
];

export function leadAngleOf(text: string): AngleKind {
  const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  for (const [kind, re] of LEAD_PATTERNS) if (re.test(first)) return kind;
  return 'other';
}

/**
 * Whether this game's angle of `kind` is news enough to lead again right after a line that led
 * with the same kind (M16.15): a streak of 7+ or a new longest run. An upset is not: two lines in a
 * row opening `Red took the upset` read alike (the month rerun); the second can say it later.
 */
export function exceptionalAngle(list: FactList, kind: AngleKind): boolean {
  if (kind === 'streak')
    return list.facts.some(
      (fact) =>
        fact.values.some((v) => v.unit === 'streak' && v.value >= 7) ||
        fact.claims.some((c) => c.text.startsWith('their longest run')),
    );
  return false;
}

interface Angle {
  rank: number;
  kind: AngleKind;
  text: string;
}

function rankedAngles(list: FactList): Angle[] {
  if (list.kind !== 'game') return [];
  const ranked: Angle[] = [];
  const add = (rank: number, kind: AngleKind, text: string) => ranked.push({ rank, kind, text });
  for (const fact of list.facts) {
    if (fact.token === null) {
      if (fact.notes.includes('upset: the underdog won')) add(1, 'upset', 'the underdog won: an upset');
      for (const note of fact.notes) {
        if (note === 'lopsided game') add(8, 'shape', 'a lopsided game');
        else if (note.startsWith('the winners had fewer team kills'))
          add(7, 'shape', 'the winners won with fewer team kills (say it without numbers)');
        else if (note === 'short game') add(9, 'shape', 'a short game');
        else if (note === 'long game') add(9, 'shape', 'a long game');
        else if (note.startsWith('close game')) add(9, 'shape', 'a close game');
      }
      continue;
    }
    const who = fact.token;
    for (const c of fact.claims) {
      if (c.text.startsWith('personal best')) add(2, 'best', `${who}: ${c.text}`);
      else if (c.claim === 'first') add(4, 'first', `${who}: ${c.text}`);
      else if (c.text === 'no deaths all game') add(5, 'deathless', `${who}: no deaths all game, and won`);
      else if (c.text.startsWith('most deaths'))
        add(6, 'deaths', `${who}: most deaths in the game and still won (a gentle dig is fine)`);
    }
    const streak = fact.values.find((v) => v.unit === 'streak');
    if (streak !== undefined) add(3, 'streak', `${who}: ${streak.value} wins in a row`);
    if (fact.notes.includes('standout on the losing side')) {
      const best = fact.claims.filter((c) => c.claim === 'max' && c.text.endsWith('in the game'));
      if (best.length > 0)
        add(5, 'loser', `${who}: ${best.map((c) => c.text).join(' and ')}, on the losing side (credit them)`);
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank);
}

/**
 * The strongest stories in a game's facts, best first (M16.8): what a friend would bring up after
 * the game. Read off the facts alone (claims, notes, the streak value), so it can only point at
 * what the line may say. At most four, so the model picks one rather than reciting all of them.
 * `avoid` (M16.15): the kind that led the group's previous line is left out unless exceptional.
 */
export function storyAngles(list: FactList, avoid: AngleKind | null = null): string[] {
  return rankedAngles(list)
    .filter(
      (angle) => avoid === null || avoid === 'other' || angle.kind !== avoid || exceptionalAngle(list, avoid),
    )
    .slice(0, 4)
    .map((entry) => entry.text);
}

const ANGLE_WORDS: Record<AngleKind, string> = {
  upset: 'an upset',
  streak: 'a win streak',
  best: 'a personal best',
  first: 'a first game on a champion',
  deathless: 'a game without a death',
  loser: 'someone on the losing side',
  deaths: 'a winner with the most deaths',
  shape: "the game's length or shape",
  other: '',
};

const TASK: Record<AiLineKind, string> = {
  game: 'Write the recap line for this one finished custom game: one or two short sentences, at most 220 characters in total, 80 to 160 is best.',
  week: 'Write the opening paragraph of the Sunday post about the week that just closed: at most 600 characters. It is read all through the next week, so call it the week or last week, never this week.',
  player:
    'Write a short scouting report on this player: two or three sentences, at most 300 characters. Describe what the numbers show; never advise or explain why.',
};

/** The rules, the same for every line. No data here: the data is the user turn's fact list. */
/**
 * How a game line should read (M16.8, tuned on games): one angle, not a box score. The examples
 * are for other games; the checker still rejects any number they would carry over.
 */
const GAME_STYLE: readonly string[] = [
  "You write the one-line recap Kustom posts in a friends group's Discord right after each League of Legends custom game. They all just played it; they read your line to laugh, brag and rib each other.",
  'How a good line reads:',
  '- One angle, not a box score. Build the line around the strongest angle listed under Angles, or a better one you see in the facts. Name one or two players. Use at most three numbers in the whole line; leave the rest out.',
  '- Sound like a friend in the group chat: short, punchy, casual. Gentle teasing is welcome, but only of players whose team won (a winner with the most deaths, or no kills, who still won). Players who lost only get credit: never say what they could not do, or that it was not enough. Tease a winner only about their numbers in that game: never say they got carried, got lucky, were boosted or scripting, or that a run of wins was not earned.',
  '- Write damage as the facts print it, like 31.2k damage. Write deaths as 7 deaths, never as died 7 times; a single one is 1 kill, 1 death, 1 assist. Never write a score like 27-9, and never use the word one.',
  '- At most one most, best or highest per line: a pile of superlatives reads like a stat sheet.',
  '- Never he, she, his or her: use the token, they or them.',
  "- A sentence with a number names that number's player token in the same sentence; never carry a player's number into the next sentence.",
  '- Never use the words ever, one or W (say the win). Say first time, not first ever.',
  '- Start every sentence with a player token, Blue, Red, or a plain word such as The, That, What, Not, Nobody or Just. Never start one with They, It or a one-word aside like Respect, Credit or Gentle; a second sentence about the same player repeats the token: {P3} also had 6 deaths, not They also had 6 deaths.',
  '- Avoid stock words like orchestrated, dominated, went off, racked up, led the charge, covered the bill, respawn timers, from the losing side. Vary your wording and your opening from game to game; never open the way a recent line opened, and never reuse an example line. The words after the first token are an opening too: {P3} set a and {P3} put up are worn out, so open with the champion, the team, the game or the number instead.',
  '- A win streak is only worth leading with when the facts list one; the Angles say which story this game has. A record run is their longest run, never the longest run in the group.',
  'Examples of the style, from other games (never copy their numbers or wording):',
  '- {P2} played 22 minutes of Lee Sin without a single death: 12 kills, 0 deaths.',
  '- {P1} finished with 9 deaths on Sett and a win anyway. {P3} handled the scoring with 13 kills.',
  '- Top damage in the game went to {P8}: 38.4k damage on Akali, from the losing side.',
  '- Somebody stop {P4}: 5 wins in a row now.',
  '- {P6} picked up Yasuo for the first time in the group and dropped 10 kills like it was their main.',
  '- {P5} got the win with 0 kills and 21 assists, the purest team player on the map.',
];

/**
 * How the Sunday storyline should read (M16.8, tuned on weeks): the week's story, not the board
 * the post prints right under it.
 */
/**
 * How the scouting report should read (M16.6, tuned on scenario players): who this player is in
 * the group, in a friend's words, not their stat line. Describes, never advises.
 */
const PLAYER_STYLE: readonly string[] = [
  "You write the short scouting report on a player's page for a friends group that plays League of Legends custom games together. Friends read it to size each other up before the next game.",
  'How a good report reads:',
  '- The page above you already shows their Rating, record, most played champion and role. Lead with something it does not: their duo partner, their best game of the week, a champion new to their pool, or a role shift, whichever the facts have. Then one more true thing about how they play, in two or three sentences.',
  '- Use at most four numbers in the whole report; a win rate is written like 68 percent. Write a record as 6 wins in 7 games, never 6 of 7 or won 6 games; every number has its unit word right after it (7 games on Zed, not 7 more on Zed); a single one is 1 win, 1 game; never a number word like three, not even in three deep.',
  '- Sound like a friend sizing them up: confident, warm, a little playful. Describe what the numbers show; never advise, never explain why, never guess at anything the facts do not say.',
  '- A week with fewer wins than losses is just the count, 6 wins in 18 games, with no word about how it felt (never rough, tough, quiet or cold). A winning week can be called warm.',
  '- The report stays on the page for weeks, beside a This week tab, under a line saying the day it was written. Call that stretch the week or over the week, in the past tense (went, was). Never this week, last week, lately, recently, right now or these days.',
  "- Every sentence with a number or a percent names the player's token, like {P1}, in that same sentence. Name the duo partner only by their token, like {P2}, and keep them in a sentence of their own that carries only their games and wins together with {P1}; the subject's other numbers go in other sentences. Never he, she, his or her: use the token, they or them.",
  '- Start every sentence with a token or a plain word such as The, When, Not, Nobody or Just; never with a number, never with Overall or Teammate, and never open the report with the champion or role the page already shows. Do not open with {P1} and {P2} or with The duo: vary how the report starts.',
  '- Never use most, best, only, never, ever or every unless a fact says it.',
  'Examples of the style, about other players (never copy their numbers or wording):',
  '- {P1} and {P2} are the pair to split up: 9 wins in 12 games on the same team. Over the week {P1} went 6 wins in 9 games, the best of them 11 kills on Lee Sin.',
  '- {P1} spent the week away from the jungle, 5 games in top lane, and picked up Ornn for the first time in the group. The week ended at 4 wins in 9 games.',
];

const WEEK_STYLE: readonly string[] = [
  "You write the opening of the Sunday post in a friends group's Discord, about the week of League of Legends custom games that just closed. The post prints the full board right under you, so never recite the standings.",
  'How a good paragraph reads:',
  '- The week as a story in two to four sentences: who ran away with it, a win streak, a tight race at the top, someone who climbed big from few games, the award. Name at most three players and use at most five numbers.',
  '- Sound like the group chat sportscaster: punchy, warm, a little teasing of the people at the top. Nobody lower down gets teased.',
  '- Places as 1st, 2nd or 3rd place. A single one is 1 win, 1 game. A streak is written 6 wins in a row, never with the word streak.',
  '- Every number is followed straight away by its unit word: 14 wins in 14 games, never won all 14, won 12 of them, or 14, a perfect run; points as 70 points. Never a number word (three, four), not even top four or a three-way race; top three is the only exception. Never a gap like separated by 3 points: say it without the number.',
  "- Every sentence that has a number, a place or a word like biggest names that player's token in the same sentence. Never start a sentence with That, They or It to point back at a player: repeat the token instead.",
  "- Never use most, best, only, never, ever or every outside the facts' own claims (top three and made the most of are fine). Never write win rate.",
  '- Never he, she, his or her: use the token, they or them. No sign-off like Good week, everyone.',
  '- Start every sentence with a player token or a plain word such as The, What, Nobody or Just; never with an adverb or a phrase like Quietly, Further down, Elsewhere or Hats off (Down the board is fine), and never with a number. A sentence about a run or a record names its player token, even right after a sentence about them.',
  'Example of the style, from another week (never copy its numbers or wording):',
  '- {P1} spent the week refusing to lose: 6 wins in a row and 212 points, a comfortable 1st place. {P2} chased with 13 wins and settled for 2nd place, while {P3} picked up the best off-role award on the side.',
  '- The race at the top went to the wire: {P1} took 1st place on 70 points, with {P2} right behind on 68 points. Nobody else came close, though {P4} put together 7 wins in a row on the way to the best off-role award.',
];

export function systemPrompt(kind: AiLineKind): string {
  return [
    ...(kind === 'game' ? GAME_STYLE : kind === 'week' ? WEEK_STYLE : PLAYER_STYLE),
    'Rules, all of them strict; a line that breaks one is thrown away:',
    '- Use only the facts given. Every number you write must appear in a fact, written exactly as it appears there, next to its unit word (kills, deaths, assists, CS, damage, vision, minutes, games, wins, Rating, place).',
    '- A number belongs to the player of its fact: put that player token in the same sentence.',
    '- Name players only with their tokens in braces, like {P3}. Never invent a name or nickname.',
    '- Name a champion only if a fact names it, and only for the player it belongs to.',
    '- Only tease players whose team won. Players who lost may only be praised.',
    "- Never explain why something happened (no 'because', 'thanks to', 'due to', 'cost them').",
    '- Never mention anything that is not in the facts: no objectives, Barons, dragons, towers, teamfights, ganks, steals, throws, comebacks, first blood or moments in the game.',
    '- Never mention odds, chances, favourites, predictions, ratings or rank, MVP or ACE, unless a fact says it.',
    '- Use words like most, best, first, only, never, always, every only when a fact says so for that player.',
    '- Nothing about anyone as a person: no skill, rank, looks, age, real life.',
    '- Plain sentences: no emoji, no links, no hashtags, no markdown, no quotation marks, no line breaks.',
    `- ${TASK[kind]}`,
    'Reply with the line only: no note about the rules or the facts, no correction, no comment on your own line.',
  ].join('\n');
}

/** How many of the group's latest lines a new game line is told not to echo (M16.8). */
export const RECENT_LINES = 6;

/**
 * A stored line as the "do not repeat" list shows it (M16.8): tokens become `someone` and digits
 * `N`, so no other game's player or number is offered to the model. Stored lines carry tokens,
 * never names, so nothing identifying reaches the request.
 */
export function recentLineForPrompt(text: string): string {
  return text
    .replace(/\{P[1-9]\d?\}/g, 'someone')
    .replace(/\d[\d.,]*k?/g, 'N')
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, 240);
}

/** The first three words of a masked recent line, `someone set a` (M16.15). */
export function openingOf(maskedLine: string): string {
  return maskedLine
    .split(/\s+/)
    .slice(0, 3)
    .join(' ')
    .replace(/[.,:;!?]+$/, '');
}

/** The user turn: the fact list, the task, and on a second attempt why the first was refused. */
export function userPrompt(
  list: FactList,
  retryReason: string | null,
  recent: readonly string[] = [],
): string {
  // M16.15: the angle that led the group's previous line is dropped this time, unless exceptional.
  const previousLead = list.kind === 'game' && recent[0] !== undefined ? leadAngleOf(recent[0]) : null;
  const rotate =
    previousLead !== null && previousLead !== 'other' && !exceptionalAngle(list, previousLead)
      ? previousLead
      : null;
  const angles = storyAngles(list, rotate);
  const avoid = list.kind !== 'week' ? recent.slice(0, RECENT_LINES).map(recentLineForPrompt) : [];
  const lines = [
    'Facts:',
    ...list.facts.map((fact) => renderFactWith(fact, { thousands: list.kind === 'game' })),
    ...(angles.length > 0 ? ['', 'Angles, strongest first:', ...angles.map((angle) => `- ${angle}`)] : []),
    ...(avoid.length > 0
      ? [
          '',
          list.kind === 'player'
            ? "Other reports just written for this group's players: do not reuse their openings or phrases."
            : "Recent lines in this group's Discord (other games): do not reuse their openings or phrases.",
          ...avoid.map((line) => `- ${line}`),
          // M16.15: the openings, spelled out, because "someone set a" kept coming back.
          `Openings already used, do not start with any of them: ${[...new Set(avoid.map(openingOf))].join(' / ')}.`,
        ]
      : []),
    ...(rotate !== null
      ? ['', `The previous line led with ${ANGLE_WORDS[rotate]}. Lead with something else this time.`]
      : []),
    '',
    TASK[list.kind],
  ];
  if (retryReason !== null) {
    lines.push(
      '',
      `Your previous line was refused by the checker (${retryReason}). Write a new line that follows every rule.`,
    );
  }
  return lines.join('\n');
}

export interface BuiltPrompt {
  model: AiModel;
  system: string;
  user: string;
  maxTokens: number;
}

/** The whole request body's text for one attempt. The only prompt builder there is. */
export function buildPrompt(
  list: FactList,
  retryReason: string | null = null,
  recent: readonly string[] = [],
): BuiltPrompt {
  const feature = AI_FEATURES[list.kind];
  return {
    model: feature.model,
    system: systemPrompt(list.kind),
    user: userPrompt(list, retryReason, recent),
    maxTokens: feature.maxTokens,
  };
}

/** sha256 over the prompt version, the model and the facts: what makes a line the same line. */
export function factHash(list: FactList): string {
  const feature = AI_FEATURES[list.kind];
  return createHash('sha256')
    .update(JSON.stringify({ v: PROMPT_VERSION, model: feature.model, kind: list.kind, facts: list.facts }))
    .digest('hex');
}
