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
import type { AiProvider } from '../env';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { readScoreRows, readSplitRuns } from '../games/read';
import { type GameReceipt, gameReceiptOf } from '../games/receipt';
import { aiGateOpen, readAiGate } from '../premium';
import { resultOdds } from '../receipt/copy';
import { killParticipation } from '../stats/killParticipation';
import type { ServiceClient } from '../supabase';
import { AI_FEATURES, AI_MODELS, type AiModel } from './meter';

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
/** Roles the way a friend says them (round-2 read, 2026-10-04): `bot lane carry (ADC)` was copied verbatim. */
const ROLE_WORD: Record<RoleValue, string> = {
  top: 'top',
  jungle: 'jungle',
  mid: 'mid',
  adc: 'bot lane',
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
        // 2026-10-04: `run` alone, so a line that copies the claim never says `in a row` twice.
        if (seat.history?.longestStreak === true) claims.push(claim('max', 'their longest run in the group'));
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
/**
 * The margin at the top of the week (A/B read, 2026-10-04; every provider): 1st place this many
 * points or fewer ahead of 2nd is a close race; at least {@link CLEAR_LEAD_POINTS} ahead, and a
 * quarter more than 2nd's points, is a clear lead. In between is neither, and the checker allows
 * neither closeness words (`a squeeze`) nor margin words (`ran away`) without the matching note.
 * Only the note reaches the model, never the gap as a number: a printed `N points ahead of the
 * runner-up` was copied verbatim into line after line, and the checker needs only the note.
 */
export const CLOSE_RACE_POINTS = 5;
export const CLEAR_LEAD_POINTS = 20;
export const CLOSE_RACE_NOTE = 'close race at the top: first and second place were a few points apart';
export const CLEAR_LEAD_NOTE = 'clear lead at the top: first place finished well ahead of second place';

/** The week's margin note for 1st place's points over 2nd's, or null when it is neither. */
export function weekMarginNote(first: number, second: number): string | null {
  const gap = first - second;
  if (gap < 0) return null;
  if (gap <= CLOSE_RACE_POINTS) return CLOSE_RACE_NOTE;
  if (gap >= CLEAR_LEAD_POINTS && gap >= 0.25 * Math.max(0, second)) return CLEAR_LEAD_NOTE;
  return null;
}

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

  // The margin at the top (2026-10-04): 1st's net points over 2nd's, both from the board.
  const pointsOf = (row: (typeof input.board)[number] | undefined) =>
    row === undefined ? undefined : input.climbs.find((entry) => entry.playerId === row.playerId)?.climb;
  const firstPoints = pointsOf(input.board[0]);
  const secondPoints = pointsOf(input.board[1]);
  const marginNote =
    firstPoints !== undefined && secondPoints !== undefined && firstPoints > 0
      ? weekMarginNote(firstPoints, secondPoints)
      : null;

  const facts: Omit<AiFact, 'id'>[] = [
    {
      token: null,
      side: null,
      notes: ['the closed week of custom games', ...(marginNote !== null ? [marginNote] : [])],
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
    overall.push(value('games over the week', input.weekGames, 'games'));
    overall.push(value('wins over the week', input.weekWins, 'wins'));
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
      notes: ['their best game of the week', extras.bestGame.won ? 'it was a win' : 'it was a loss'],
      champions: champion === null ? [] : [champion],
      values: [
        value('kills in that game', extras.bestGame.kills, 'kills'),
        value('assists in that game', extras.bestGame.assists, 'assists'),
      ],
      claims: [claim('max', 'their best game of the week')],
    });
  }
  if (extras.newChampion !== undefined && knownChampion(extras.newChampion.name) !== null) {
    facts.push({
      token: me,
      side: null,
      notes: ['new to their pool over the week'],
      champions: [extras.newChampion.name],
      values: [value(`games on ${extras.newChampion.name} over the week`, extras.newChampion.games, 'games')],
      claims: [claim('first', `first games on ${extras.newChampion.name} in the group, over the week`)],
    });
  }
  if (extras.roleShift !== undefined && extras.roleShift.weekGames >= ROLE_SHIFT_MIN_GAMES) {
    facts.push({
      token: me,
      side: null,
      notes: [
        `over the week: mostly ${ROLE_WORD[extras.roleShift.weekRole]}, away from their usual ${ROLE_WORD[extras.roleShift.usualRole]}`,
      ],
      champions: [],
      values: [
        value(
          `games in ${ROLE_WORD[extras.roleShift.weekRole]} over the week`,
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
          'side, champion_id, kills, assists, cs, damage_to_champs, vision_score, games!inner(group_id, started_at, winning_side, game_mode)',
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
/** `1st`, `2nd`, `3rd`, `4th`, `11th`, `22nd`. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ending = n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${ending}`;
}

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
        ? v.unit === 'place'
          ? // 2026-10-04: a place prints with its ending (`1st place`), the way the line must write it.
            `${ordinal(v.value)} ${v.label}`
          : `${options.thousands === true && v.unit === 'damage' ? thousands(v.value) : formatNumber(v.value)} ${v.label}`
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
  "- Never he, she, him, his or her, not even for a champion or a champion's first game (Elise was new for {P4}, never Elise made her debut or on her): use the token, the champion name, they or them.",
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
  "- Every sentence with a number or a percent names the player's token, like {P1}, in that same sentence. Name the duo partner only by their token, like {P2}, and keep them in a sentence of their own that carries only their games and wins together with {P1}; the subject's other numbers go in other sentences. Never he, she, him, his or her, not even for a champion or a champion's first game (Elise was new for {P4}, never Elise made her debut or on her): use the token, the champion name, they or them.",
  '- Start every sentence with a token or a plain word such as The, When, Not, Nobody or Just; never with a number, never with Overall or Teammate, and never open the report with the champion or role the page already shows. Do not open with {P1} and {P2} or with The duo: vary how the report starts.',
  '- Never use most, best, only, never, ever or every unless a fact says it.',
  '- Never let one stand in for a game, a win or a week (never a warm one, a big one): write the fact itself, like 9 wins in 14 games.',
  'Examples of the style, about other players (never copy their numbers or wording):',
  '- {P1} and {P2} are the pair to split up: 9 wins in 12 games on the same team. Over the week {P1} went 6 wins in 9 games, the best of them 11 kills on Lee Sin.',
  '- {P1} spent the week away from the jungle, 5 games in top lane, and picked up Ornn for the first time in the group. The week ended at 4 wins in 9 games.',
];

const WEEK_STYLE: readonly string[] = [
  "You write the opening of the Sunday post in a friends group's Discord, about the week of League of Legends custom games that just closed. The post prints the full board right under you, so never recite the standings.",
  'How a good paragraph reads:',
  '- The week as a story in two to four sentences: a clear lead or a close race at the top when a fact says so, a win streak, someone who climbed big from few games, the award. Name at most three players and use at most five numbers.',
  '- Sound like the group chat sportscaster: punchy, warm, a little teasing of the people at the top. Nobody lower down gets teased.',
  '- Places as 1st, 2nd or 3rd place. A single one is 1 win, 1 game. A streak is written 6 wins in a row, never with the word streak.',
  '- Never let one stand in for a game, a win or a week (never a big one, a warm one): write the fact itself, like 6 wins in a row.',
  '- The size of the win at the top comes only from the facts: ran away, comfortable or nobody came close only when a fact says clear lead; tight, a squeeze or to the wire only when a fact says close race; with neither, just 1st place and the points. Nothing about when in the week something happened (early, all week, put it to bed).',
  '- Every number is followed straight away by its unit word: 14 wins in 14 games, never won all 14, won 12 of them, or 14, a perfect run; points as 70 points. Never a number word (three, four), not even top four or a three-way race; top three is the only exception. Never a gap like separated by 3 points: say it without the number.',
  "- Every sentence that has a number, a place or a word like biggest names that player's token in the same sentence. Never start a sentence with That, They or It to point back at a player: repeat the token instead.",
  "- Never use most, best, only, never, ever or every outside the facts' own claims (top three and made the most of are fine). Never write win rate.",
  "- Never he, she, him, his or her, not even for a champion or a champion's first game (Elise was new for {P4}, never Elise made her debut or on her): use the token, the champion name, they or them. No sign-off like Good week, everyone.",
  '- Start every sentence with a player token or a plain word such as The, What, Nobody or Just; never with an adverb or a phrase like Quietly, Further down, Elsewhere or Hats off (Down the board is fine), and never with a number. A sentence about a run or a record names its player token, even right after a sentence about them.',
  'Examples of the style, from other weeks (never copy their numbers or wording):',
  '- With a clear lead in the facts: {P1} spent the week refusing to lose: 6 wins in a row and 212 points, a comfortable 1st place. {P2} chased with 13 wins and settled for 2nd place, while {P3} picked up the best off-role award on the side.',
  '- With a close race in the facts: the race at the top went to the wire, {P1} took 1st place on 70 points, with {P2} right behind on 68 points. {P4} put together 7 wins in a row on the way to the best off-role award.',
  '- With neither in the facts: {P1} took 1st place on 106 points with 12 wins in 18 games, and {P2} followed in 2nd place on 92 points. {P3} put together 6 wins in a row on the way to 4th place.',
];

/* ---------------------------------------------------------------------------------------------
 * DeepSeek's wording (the user's 2026-10-04 move to DeepSeek). The Claude prompts above stay
 * byte for byte what M16.8-M16.19 tuned; DeepSeek gets its own style and a block of binding rules
 * at the very end, where a model that drifts from instructions still reads them last. The eval
 * found it binds a champion or number to the wrong token, drops unit words (`with 13`), reaches
 * for box-score verbs (`put up`, `answered with`) and writes dashes the checker refuses. The
 * checker is the same for both: these words only make a pass likelier, never a line looser.
 * ------------------------------------------------------------------------------------------- */

const DEEPSEEK_GAME_STYLE: readonly string[] = [
  GAME_STYLE[0] as string,
  'How a good line reads:',
  '- A reaction in the group chat, not a match report: the one story of this game (the user turn says which), told with one or two numbers, and why it matters in a few plain words. Name one or two players, never more; at most three numbers in the whole line.',
  '- Why it matters, from the facts only: a first try that paid off, a run nobody has stopped, a support with more assists than anyone, a win with the most deaths, a loser who still had the best number in the game. Not a closer bolted on: the reason is part of the sentence.',
  '- One or two short sentences, 80 to 160 characters. Never a list of stats strung together with and. Every sentence carries a player token, a number, a champion, Blue or Red: no sentence of banter on its own.',
  '- Gentle teasing only of players whose team won, and only about their numbers in that game: never carried, lucky, boosted or scripting. Players who lost only get credit: never say what they could not do or that it was not enough.',
  '- Still is for a player who lost or a winner who won despite a number (still won with 9 deaths): never still on a plain winner (never {P3} still had 12 assists when Blue won).',
  '- Close words (close game, tight, nearly, edged, kept it close) only when a fact says close game, and never about a player who won. Margin words (cruised, easy, comfortable) only when a fact says lopsided game.',
  '- Worn out, never use: in the loss, in a losing game, even as, saw more of the map than anyone, saw the whole map, a new high, to keep it close, let it slide, a true team player, somebody check the replay, made it look easy, put up, answered with, gets the credit, gets the nod, topped, led everyone, led all, debuted, dropped, racked up, orchestrated, dominated, went off, from the losing side, on the other side, across the board, game-high, stat line, their longest run of wins in a row, the close one, a close one. Never the words one, every, bad or worst.',
  '- A first game on a champion: write it a new way each time (was new for them, their first Draven in the group, picked up Draven for the first time); never on her or on him.',
  '- Start every sentence with a player token, Blue, Red, or a plain word such as The, That, What, Not, Nobody or Just; never with They, It, a number, and never with a champion: the player owns the champion, so the token comes first.',
  '- The user turn shows a few example lines from other subjects: they show the range, never a shape to copy; this line must read differently from every one of them.',
];

const DEEPSEEK_WEEK_STYLE: readonly string[] = [
  WEEK_STYLE[0] as string,
  'How a good paragraph reads:',
  '- The week as a story in two to four sentences, led by the story the user turn names. Name at most three players and use at most five numbers. Not a list of everyone on the board.',
  '- Say why it mattered: how big the margin was (only as a fact states it), a run that carried someone up the board, a perfect week, an award earned on the side.',
  '- Sound like the group chat sportscaster: punchy, warm, a little teasing of the people at the top. Nobody lower down gets teased.',
  '- The size of the win at the top comes only from the facts: ran away, comfortable, by a distance or nobody came close only when a fact says clear lead; a squeeze, tight or close race only when a fact says close race; otherwise just say 1st place and the points. Nothing about when in the week something happened (early, from start to finish, put it to bed, the whole way).',
  '- Worn out, never use: ran away with the week, owned the week, refused to lose, What a week, What a run, chased, settled for, down the board, made the most of, The race was, The race at the top was.',
  '- Every sentence names a player token or carries a number: no sign-off and no sentence of banter on its own. Start every sentence with a player token or a plain word such as The, Nobody or Just; never with That, They, It, What, a number, or a phrase like Quietly, Elsewhere or Hats off.',
  '- The user turn shows a few example lines from other subjects: they show the range, never a shape to copy; this line must read differently from every one of them.',
];

const DEEPSEEK_PLAYER_STYLE: readonly string[] = [
  PLAYER_STYLE[0] as string,
  'How a good report reads:',
  '- The page above already shows their Rating, record, most played champion and role. Lead with the story the user turn names, then one more true thing about how they play, in two or three sentences. Leave out anything the user turn does not ask for: not every report needs the duo partner, the week record or the best game.',
  '- Say why it matters in a few words, from the facts only: a new champion that already won, a role they keep drifting to, the teammate they win with.',
  '- Sound like a friend sizing them up: confident, warm, a little playful. Describe what the numbers show; never advise, never explain why, never guess, and no claim about the whole group (nobody in the group, the best in the group) unless a fact says it.',
  '- A losing week (fewer wins than games lost) is just the count, 6 wins in 18 games, with no word about how it felt: never rough, tough, quiet, cold, slow, worst or a struggle. A winning week can be called warm.',
  '- The report stays up for weeks: say the week or over the week, in the past tense. Never this week, last week, lately, recently or right now, and nothing about when in the week.',
  '- Worn out, never use: duo to watch, pair to split up, the teammate they win with most, partnership to fear, in the pool of, joined the pool, comfort pick, warm stretch, the best of them, on a heater. Never write a champion twice (Elise joined with 1 game on Elise).',
  '- Start every sentence with {P1}, {P2} or a plain word such as The, When, Not, Nobody or Just; never with a number, a champion, Overall or Teammate. Never open with {P1} and {P2} or with the most played champion.',
  '- The user turn shows a few example lines from other subjects: they show the range, never a shape to copy; this line must read differently from every one of them.',
];

/** Example pools (2026-10-04): the user turn shows three, chosen from the facts, so no one shape is copied. */
const DEEPSEEK_EXAMPLES: Record<AiLineKind, readonly string[]> = {
  game: [
    '{P2} went 22 minutes on Lee Sin without dying once, 12 kills and 0 deaths, and Blue never had to worry about the jungle.',
    '{P1} won with 9 deaths on Sett, the most deaths in the game, and nobody on Blue is bringing it up.',
    'Red closed it out in 18 minutes, and {P4} was the reason: 13 kills on Jinx, the most kills in the game.',
    'Their first Draven in the group, and {P6} made it count with 10 kills for Red.',
    '{P5} won without a single kill: 0 kills and 21 assists on Thresh.',
    'Somebody stop {P4}: 5 wins in a row now.',
    'Nobody in the game did more damage than {P8}, 30.6k damage on Kassadin, even on the team that went down.',
    'Blue won with fewer team kills than Red, and {P3} had the 36.2k damage on Yasuo that made the difference.',
    "{P7} had a hand in 22 of Blue's 31 team kills on Rakan, which is most of the game.",
    '{P9} found a personal best on Caitlyn, 312 CS, their most CS in the group.',
    'The underdogs took it, and {P2} led Red with 11 kills on Vi.',
    '{P10} saw the whole map for Blue: 88 vision score on Leona, the highest vision score in the game.',
  ],
  week: [
    '{P1} finished 1st place on 212 points, and 6 wins in a row did most of the work. {P2} held 2nd place on 122 points.',
    'The race at the top went to the wire: {P1} took 1st place on 70 points, with {P2} on 68 points in 2nd place. {P4} picked up the best off-role award with 7 wins in a row.',
    'Nobody lost a game like {P1}: 14 wins in 14 games and 1st place on 200 points. {P2} took 2nd place on 101 points.',
    '{P3} turned 7 wins in a row into the biggest climb of the week and 2nd place on 88 points. {P1} kept 1st place on 120 points.',
    '{P2} played 19 games, more than anyone, and turned them into 3rd place on 64 points. {P1} took 1st place on 106 points.',
    'The best off-role award went to {P4}, who also strung together 5 wins in a row. {P1} took 1st place on 150 points.',
  ],
  player: [
    '{P1} picked up Nidalee for the first time in the group and went 2 wins in 3 games on Nidalee. {P1} finished the week at 4 wins in 9 games.',
    '{P1} spent the week away from the jungle, 6 games in top lane, and still went 7 wins in 10 games.',
    '{P1} had the biggest game of their week on Riven, 14 kills and 9 assists in a win.',
    '{P1} lives in support: 41 wins in 70 games in support, with Janna at 64 percent over 22 games.',
    '{P1} and {P2} win together: 9 wins in 12 games on the same team. {P1} went 5 wins in 8 games over the week.',
    '{P1} kept going back to Darius, 18 games on Darius, and it shows in 11 wins on Darius.',
    'Nobody had to guess where {P1} would be: 30 games in mid lane, 17 wins there.',
    '{P1} went 6 wins in 7 games over the week, the best of it 9 kills and 14 assists on Sona.',
  ],
};

/** Three examples from a kind's pool, picked by the seed. */
function pickExamples(kind: AiLineKind, seed: number): string[] {
  const pool = DEEPSEEK_EXAMPLES[kind];
  const start = seed % pool.length;
  const step = 1 + ((seed >>> 8) % (pool.length - 1));
  const picked: string[] = [];
  for (let i = 0; picked.length < Math.min(3, pool.length); i += 1) {
    const example = pool[(start + i * step) % pool.length] as string;
    if (!picked.includes(example)) picked.push(example);
    if (i > pool.length * 3) break;
  }
  return picked;
}

/** The rules DeepSeek reads last, per line kind. Each is a check the program runs. */
const DEEPSEEK_BINDING: Record<AiLineKind, readonly string[]> = {
  game: [
    '- Every number is copied exactly from a fact and followed straight away by its unit word: 9 kills, 0 deaths, 1 death, 1 kill, 24 assists, 290 CS, 31.2k damage, 66 vision, 41 minutes, 5 wins in a row. Never a bare number (with 13, at 29, 392 on Ashe), never died 7 times, never a score like 27-9, never the word one.',
    "- Write a player's token before their numbers and their champion, in the same sentence, with no other token in between: {P3} took 10 kills on Yasuo. A number or a champion belongs to the nearest token before it. Never bring a player's number back in a later sentence (not even the 6 deaths); game minutes and team kills go with Blue, Red or The game.",
    '- A champion goes only with the player whose fact names it. Not sure whose it is? Leave the champion out. Team kills belong to Blue or Red, never to a player.',
    "- Most, best, highest, longest and first only when that player's own fact says so. A record run is their own longest run, never the group's.",
  ],
  week: [
    '- Every number is copied from a fact and followed straight away by its unit word: 14 wins in 23 games, 70 points, 6 wins in a row. A single one is 1 win, 1 game. Never a bare number (the most wins with 14, won 11 of them), never a number word.',
    '- A place is always written with its ending: 1st place, 2nd place, 3rd place, 4th place, 5th place. Never 1 place or 4 place.',
    '- Every sentence with a number or a place starts with the token of the player it belongs to, and every sentence names a player token. Never put another token between a player and their number: {P4} also had 7 wins in a row, never {P4} matched {P1} with 7 wins in a row. Say 1st place, never at the top or on top.',
    "- A place, a number or an award goes only in a sentence with the token of the player whose fact has it, and only if their fact has it. Never put two players' numbers in one sentence unless each number comes right after its own token: {P2} on 68 points and {P3} on 67 points, never {P2} and {P3} with 68 points and 67 points.",
    "- Never compare players yourself: most wins, more wins than, led the board in wins or never got close only where a fact says exactly that for that player. Most, best, biggest, only, never and every only where that player's fact says so; never the word one (not even at one point); never write win rate. A run is written 6 wins in a row, never with the word streak, and its sentence names its player's token. Never a gap like separated by 3 points.",
  ],
  player: [
    "- Every number is copied from a fact and followed straight away by its unit word: 6 wins in 18 games, 14 kills, 2 games on Ornn, 79 percent. A single one is always singular: 1 game, 1 win, 1 kill, never 1 games or 1 kills. Never a bare number (won 24 of them, a 57 win rate), and the words win rate never appear in the report: a fact prints 65 win rate, you write Kai'Sa at 65 percent.",
    '- At most 300 characters, about 45 words: three sentences only when all three are short.',
    '- The best game is written the best of them 11 kills on Lee Sin, never the best of them was a win or the best game a win: the word best never sits near the word win.',
    "- Every sentence with a number names {P1} in it, or {P2} for the games and wins together. Tokens are always written in braces, {P1}, never P1. A champion goes only with the player whose fact names it; the duo partner's sentence carries only their games and wins together.",
    '- Most, best, only, never, ever and every only where a fact says so.',
  ],
};

const DEEPSEEK_COMMON: readonly string[] = [
  '- Never he, she, him, his or her, not even for a champion (on Caitlyn, never on her): use the token, they, them or the champion name.',
  '- A single one is always singular: 1 kill, 1 death, 1 game, 1 win.',
  '- Plain ASCII only: no dashes like \u2014 or \u2013, no curly quotes, no emoji.',
];

/** Which provider a line kind's model belongs to in this process. */
function providerOf(kind: AiLineKind): AiProvider {
  return AI_MODELS[AI_FEATURES[kind].model].provider;
}

export function systemPrompt(kind: AiLineKind, provider: AiProvider = providerOf(kind)): string {
  const deepseek = provider === 'deepseek';
  const style = deepseek
    ? kind === 'game'
      ? DEEPSEEK_GAME_STYLE
      : kind === 'week'
        ? DEEPSEEK_WEEK_STYLE
        : DEEPSEEK_PLAYER_STYLE
    : kind === 'game'
      ? GAME_STYLE
      : kind === 'week'
        ? WEEK_STYLE
        : PLAYER_STYLE;
  return [
    ...style,
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
    ...(deepseek
      ? [
          'Binding rules, checked by a program before anything is posted:',
          ...DEEPSEEK_BINDING[kind],
          ...DEEPSEEK_COMMON,
        ]
      : []),
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

/* ---------------------------------------------------------------------------------------------
 * DeepSeek's user turn (A/B read, 2026-10-04): it holds one shape once it finds it, so the turn
 * picks the story and the line's shape for it (deterministically, from the facts, so a retry and a
 * rerun ask for the same thing), and lists the exact phrases the group's recent lines already used.
 * Nothing new leaves the server: the same facts, the same masked recent lines.
 * ------------------------------------------------------------------------------------------- */

/** Phrases DeepSeek reached for again and again on the eval month; listed when a recent line has one. */
const STOCK_PHRASES: readonly string[] = [
  'in the loss',
  'in a losing game',
  'in a loss',
  'for the first time in the group',
  'first game on',
  'the most damage in the game',
  'the most kills in the game',
  'the highest vision score in the game',
  'their longest run',
  'made it',
  'personal best',
  'still found',
  'still had',
  'still won',
  'finished with',
  'set the table',
  'duo to watch',
  'pair to split up',
  'the teammate',
  'on the same team',
  'together on the same team',
  'joined the pool',
  'new to the pool',
  'comfort pick',
  'warm week',
  'warm stretch',
  'over the week',
  'the best of them',
  'their best game',
  'ran away with',
  'refusing to lose',
  'settled for',
  'took 1st place',
  'on the way to',
  'lost, but',
  'nobody on',
  'on either team',
  'still fell',
  'still lost',
  'in the win',
  'team kills in',
  'the race at the top',
  'a clear leader',
  'made the gap',
  'went with it',
  'ahead of the runner-up',
  'held 2nd place',
  'on the side',
  'joins the same team',
  'games together',
  'lives in',
  'sits at',
  'even as',
  'saw more of the map',
  'the whole map',
  'a new high',
  'nobody came close',
  'the biggest climb of the week',
  'saved',
  'owns',
  'holds',
  'runs the',
  'peaked',
  'standout',
  'nobody',
];

/** The phrases a set of masked recent lines already used: stock ones, and any three words two lines share. */
export function usedPhrases(masked: readonly string[], max = 14): string[] {
  const lower = masked.map((line) => line.toLowerCase());
  const found = new Set(STOCK_PHRASES.filter((phrase) => lower.some((line) => line.includes(phrase))));
  const grams = new Map<string, number>();
  for (const line of lower) {
    const words = line
      .replace(/[^a-z' ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const seen = new Set<string>();
    for (let i = 0; i + 3 <= words.length; i += 1) {
      const gram = words.slice(i, i + 3).join(' ');
      if (/\b(someone|n)\b/.test(gram) || seen.has(gram)) continue;
      seen.add(gram);
      grams.set(gram, (grams.get(gram) ?? 0) + 1);
    }
  }
  for (const [gram, count] of grams) if (count >= 2) found.add(gram);
  return [...found].slice(0, max);
}

/** A stable number from the facts, so the same game always asks for the same story and shape. */
function factSeed(list: FactList): number {
  return Number.parseInt(
    createHash('sha256').update(JSON.stringify(list.facts)).digest('hex').slice(0, 8),
    16,
  );
}

const GAME_SHAPES: readonly string[] = [
  'Open with the player token and the number, then why it matters, in one sentence.',
  'Open with Blue, Red or The game, then bring in the player and their number.',
  'Open with what made it unusual (a first try, no deaths, fewer team kills, a run), then who and the number.',
  'Two short sentences: the story with its number, then a second player or the team with one number.',
  'One sentence that reads like a friend reacting, the number in the middle of it.',
];
const WEEK_SHAPES: readonly string[] = [
  'Open with the 1st place token and their points, then the one other story.',
  'Open with the story (a run, a perfect week, the margin, the award), then whose it is.',
  'Open with the player in 2nd place and their points, then 1st place.',
  'Open with the award or the run of someone outside 1st place, then 1st place.',
  "Open with The and the week's standout number, the player token in the same sentence.",
];
const PLAYER_SHAPES: readonly string[] = [
  'Two sentences.',
  'Three short sentences.',
  'Two sentences, the second starting with When or The.',
];

/** What a week line may lead with, from its facts. */
function weekLeads(list: FactList): string[] {
  const leads: string[] = [];
  const notes = list.facts.flatMap((fact) => (fact.token === null ? fact.notes : []));
  if (notes.includes(CLEAR_LEAD_NOTE))
    leads.push('the margin at the top: a clear lead, in words, never as a points gap');
  if (notes.includes(CLOSE_RACE_NOTE))
    leads.push('the close race at the top, in words, never as a points gap');
  for (const fact of list.facts) {
    if (fact.token === null) continue;
    if (fact.claims.some((c) => c.claim === 'all')) leads.push(`${fact.token}: won every game they played`);
    const streak = fact.values.find((v) => v.unit === 'streak');
    if (streak !== undefined) leads.push(`${fact.token}: ${streak.value} wins in a row`);
    if (fact.claims.some((c) => c.text === 'biggest climb of the week'))
      leads.push(`${fact.token}: the biggest climb of the week`);
    for (const note of fact.notes) if (note.startsWith('won the ')) leads.push(`${fact.token}: ${note}`);
  }
  return leads.length > 0 ? leads : ['1st place and the points'];
}

/** What a scouting report may lead with, from its facts (never the page's own record). */
function playerLeads(list: FactList): { leads: string[]; duo: boolean } {
  const leads: string[] = [];
  let duo = false;
  for (const fact of list.facts) {
    if (fact.notes.some((note) => note.startsWith('new to their pool')))
      leads.push(`the champion new to their pool (${fact.champions[0] ?? 'the new champion'})`);
    if (fact.claims.some((c) => c.text.startsWith('their best game')))
      leads.push('their best game of the week, with its kills and assists');
    if (fact.notes.some((note) => note.includes('away from their usual')))
      leads.push('the role they played most of the week, away from their usual one');
    if (fact.notes.some((note) => note.startsWith('the teammate'))) duo = true;
    const role = fact.claims.find((c) => c.text.startsWith('most played role'));
    if (role !== undefined)
      leads.push(
        `who they are in the group: their ${role.text.replace('most played role, ', '')} games and wins`,
      );
  }
  return { leads: leads.length > 0 ? leads : ['how the week went'], duo };
}

/** The duo partner is a second beat only, and on about half the reports (`duo to watch` 16 of 17). */
const DUO_BEAT = 'the teammate {P1} wins with most ({P2}), their games and wins together';

/** A highest kill-participation winner, as an extra angle: a number the facts already carry. */
function participationAngle(list: FactList): string | null {
  let best: { token: string; value: number; of: number } | null = null;
  for (const fact of list.facts) {
    if (fact.token === null || !fact.notes.includes('won')) continue;
    const v = fact.values.find((entry) => entry.of !== undefined);
    if (v === undefined || v.of === undefined) continue;
    if (best === null || v.value / v.of > best.value / best.of)
      best = { token: fact.token, value: v.value, of: v.of };
  }
  return best === null ? null : `${best.token}: took part in ${best.value} of ${best.of} team kills`;
}

function deepseekUserPrompt(list: FactList, retryReason: string | null, recent: readonly string[]): string {
  const seed = factSeed(list);
  const masked = recent.slice(0, RECENT_LINES).map(recentLineForPrompt);
  let lead: string;
  let shape: string;
  /** What else the line may carry, besides the lead (null: nothing else). */
  let second: string | null = null;
  if (list.kind === 'game') {
    const previousLead = recent[0] !== undefined ? leadAngleOf(recent[0]) : null;
    const rotate =
      previousLead !== null && previousLead !== 'other' && !exceptionalAngle(list, previousLead)
        ? previousLead
        : null;
    const angles = storyAngles(list, rotate);
    const extra = participationAngle(list);
    if (extra !== null && angles.length < 4) angles.push(extra);
    const first = rankedAngles(list)[0];
    const keepFirst = first !== undefined && (first.kind === 'upset' || exceptionalAngle(list, first.kind));
    lead =
      angles.length === 0
        ? 'the best number in the game'
        : keepFirst && angles[0] !== undefined
          ? angles[0]
          : (angles[seed % Math.min(3, angles.length)] as string);
    shape = GAME_SHAPES[(seed >>> 4) % GAME_SHAPES.length] as string;
    const rest = angles.filter((angle) => angle !== lead);
    second =
      (seed >>> 12) % 3 === 0 || rest.length === 0 ? null : (rest[(seed >>> 6) % rest.length] as string);
  } else if (list.kind === 'week') {
    const leads = weekLeads(list);
    lead = leads[seed % leads.length] as string;
    shape = WEEK_SHAPES[(seed >>> 4) % WEEK_SHAPES.length] as string;
    const rest = leads.filter((entry) => entry !== lead);
    second = rest.length === 0 ? null : (rest[(seed >>> 6) % rest.length] as string);
  } else {
    const { leads, duo } = playerLeads(list);
    lead = leads[seed % leads.length] as string;
    shape = PLAYER_SHAPES[(seed >>> 4) % PLAYER_SHAPES.length] as string;
    const rest = leads.filter((entry) => entry !== lead);
    second =
      duo && (seed >>> 10) % 2 === 0
        ? DUO_BEAT
        : rest.length === 0
          ? null
          : (rest[(seed >>> 6) % rest.length] as string);
  }
  const used = usedPhrases(masked);
  const lines = [
    'Facts:',
    ...list.facts.map((fact) => renderFactWith(fact, { thousands: list.kind === 'game' })),
    '',
    `The story to lead with: ${lead}.`,
    second === null
      ? 'Nothing else: this line is that story alone, told well.'
      : `The one other thing it may carry: ${second}. Nothing else from the facts.`,
    ...(list.kind === 'game'
      ? [
          'Leave out the game length and the team kills unless the story is about the game itself.',
          // 2026-10-04: the checker refuses a recap that names nobody from the winning team.
          'Always name someone from the winning team (their token) or the winning side (Blue or Red), even when the story is about a player who lost.',
        ]
      : list.kind === 'week'
        ? [
            'Also name 1st place with their points and 2nd place with their points, if the story has not already: three or four sentences in all, each with its own player.',
          ]
        : []),
    `The shape: ${shape}`,
    '',
    'Example lines from other subjects (the range, not a shape to copy; read differently from all of them):',
    ...pickExamples(list.kind, seed >>> 16).map((example) => `- ${example}`),
    ...(masked.length > 0
      ? [
          '',
          list.kind === 'game'
            ? "Recent lines in this group's Discord (other games), for what not to repeat:"
            : list.kind === 'week'
              ? "This group's earlier Sunday paragraphs, for what not to repeat:"
              : "Other reports just written for this group's players, for what not to repeat:",
          ...masked.map((line) => `- ${line}`),
          `Openings already used, do not start with any of them: ${[...new Set(masked.map(openingOf))].join(' / ')}.`,
        ]
      : []),
    ...(used.length > 0 ? [`Phrases already used, do not write any of them: ${used.join(' / ')}.`] : []),
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

/** The user turn: the fact list, the task, and on a second attempt why the first was refused. */
export function userPrompt(
  list: FactList,
  retryReason: string | null,
  recent: readonly string[] = [],
  provider: AiProvider = providerOf(list.kind),
): string {
  if (provider === 'deepseek') return deepseekUserPrompt(list, retryReason, recent);
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
