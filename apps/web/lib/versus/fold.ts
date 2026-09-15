import type { RoleValue } from '@customs/db';
import { championName } from '../champs/names';
import { LANE_ORDER } from '../laneOrder';
import { MIN_RECORD_GAMES } from '../stats/copy';
import { compareByName, countedGames, noRoleGames, playersWhoPlayed, winRate } from '../stats/fold';
import type { PlayerRef, StatsGame, StatsPlayer, StatsRow } from '../stats/types';
import { renderWebName } from '../tonight/copy';
import {
  LANES_SHOWN,
  MIN_LANE_GAMES,
  TYRANT_RATE,
  verdictAlliesOnly,
  verdictEven,
  verdictLeads,
  verdictNone,
  verdictOwns,
  verdictTogetherCursed,
  verdictTogetherHot,
} from './copy';
import type {
  HeadToHead,
  LaneBoard,
  LaneMatchup,
  VersusChamp,
  VersusKda,
  VersusMeeting,
  VersusStreak,
} from './types';

/**
 * Lane 1v1 and head-to-head arithmetic for `/1v1` (M5.34).
 *
 * Pure: no client, no clock. A lane meeting is exactly one player on each side with that
 * role; two tops on one side, or a missing role, is not a 1v1 and does not count. The
 * universe is `countedGames` — the same Rift gate `/stats` uses.
 */

interface PairTally {
  role: RoleValue;
  aId: string;
  bId: string;
  aWins: number;
  bWins: number;
}

function refOf(player: StatsPlayer): PlayerRef {
  return { puuid: player.puuid, name: player.name };
}

function byPlayerId(players: readonly StatsPlayer[]): Map<string, StatsPlayer> {
  return new Map(players.map((player) => [player.playerId, player]));
}

function pairKey(role: RoleValue, first: string, second: string): string {
  const [a, b] = first < second ? [first, second] : [second, first];
  return `${role}|${a}|${b}`;
}

/**
 * The two people who played `role` on opposite sides, or `null` when the lane is empty,
 * doubled, or missing a role. One a side is the only shape a 1v1 can answer.
 */
export function lanePair(game: StatsGame, role: RoleValue): [StatsRow, StatsRow] | null {
  const blue = game.rows.filter((row) => row.side === 100 && row.role === role);
  const red = game.rows.filter((row) => row.side === 200 && row.role === role);
  const left = blue[0];
  const right = red[0];
  if (blue.length !== 1 || red.length !== 1 || left === undefined || right === undefined) return null;
  return [left, right];
}

function addMeeting(
  tallies: Map<string, PairTally>,
  game: StatsGame,
  role: RoleValue,
  left: StatsRow,
  right: StatsRow,
) {
  const [low, high] = left.playerId < right.playerId ? [left, right] : [right, left];
  const key = pairKey(role, low.playerId, high.playerId);
  const entry = tallies.get(key) ?? { role, aId: low.playerId, bId: high.playerId, aWins: 0, bWins: 0 };
  if (left.side === game.winningSide) {
    if (left.playerId === entry.aId) entry.aWins += 1;
    else entry.bWins += 1;
  } else if (right.side === game.winningSide) {
    if (right.playerId === entry.aId) entry.aWins += 1;
    else entry.bWins += 1;
  }
  tallies.set(key, entry);
}

function toMatchup(roster: Map<string, StatsPlayer>, tally: PairTally): LaneMatchup | null {
  const first = roster.get(tally.aId);
  const second = roster.get(tally.bId);
  if (first === undefined || second === undefined) return null;
  const games = tally.aWins + tally.bWins;
  const tied = tally.aWins === tally.bWins;
  const firstLeads = tally.aWins > tally.bWins || (tied && compareByName(refOf(first), refOf(second)) <= 0);
  const leader = firstLeads ? first : second;
  const trailer = firstLeads ? second : first;
  const aWins = firstLeads ? tally.aWins : tally.bWins;
  const bWins = firstLeads ? tally.bWins : tally.aWins;
  return {
    role: tally.role,
    a: refOf(leader),
    b: refOf(trailer),
    games,
    aWins,
    bWins,
    winRate: winRate(aWins, games),
    tied,
  };
}

function compareLaneSeries(a: LaneMatchup, b: LaneMatchup): number {
  return (
    b.games - a.games ||
    b.aWins - a.aWins ||
    renderWebName(a.a.name).localeCompare(renderWebName(b.a.name)) ||
    a.a.puuid.localeCompare(b.a.puuid)
  );
}

function compareTyrants(a: LaneMatchup, b: LaneMatchup): number {
  return (
    (b.winRate ?? -1) - (a.winRate ?? -1) ||
    b.games - a.games ||
    renderWebName(a.a.name).localeCompare(renderWebName(b.a.name)) ||
    a.a.puuid.localeCompare(b.a.puuid)
  );
}

function compareHeats(a: LaneMatchup, b: LaneMatchup): number {
  const spreadA = Math.abs(a.aWins - a.bWins);
  const spreadB = Math.abs(b.aWins - b.bWins);
  return (
    spreadA - spreadB ||
    b.games - a.games ||
    renderWebName(a.a.name).localeCompare(renderWebName(b.a.name)) ||
    a.a.puuid.localeCompare(b.a.puuid)
  );
}

/** Every same-role opposite-side series in the window, no minimum. */
export function allLaneSeries(games: readonly StatsGame[], players: readonly StatsPlayer[]): LaneMatchup[] {
  const roster = byPlayerId(players);
  const tallies = new Map<string, PairTally>();
  for (const game of games) {
    for (const role of LANE_ORDER) {
      const pair = lanePair(game, role);
      if (pair === null) continue;
      addMeeting(tallies, game, role, pair[0], pair[1]);
    }
  }
  const out: LaneMatchup[] = [];
  for (const tally of tallies.values()) {
    const matchup = toMatchup(roster, tally);
    if (matchup !== null) out.push(matchup);
  }
  return out;
}

/** Five boards, lane order, each the five longest series past {@link MIN_LANE_GAMES}. */
export function laneBoards(games: readonly StatsGame[], players: readonly StatsPlayer[]): LaneBoard[] {
  const series = allLaneSeries(games, players);
  return LANE_ORDER.map((role) => ({
    role,
    entries: series
      .filter((row) => row.role === role && row.games >= MIN_LANE_GAMES)
      .sort(compareLaneSeries)
      .slice(0, LANES_SHOWN),
  }));
}

/** Highest win rate in a lane, five meetings, at least {@link TYRANT_RATE}. */
export function laneTyrants(games: readonly StatsGame[], players: readonly StatsPlayer[]): LaneMatchup[] {
  return allLaneSeries(games, players)
    .filter(
      (row) =>
        !row.tied && row.games >= MIN_RECORD_GAMES && row.winRate !== null && row.winRate >= TYRANT_RATE,
    )
    .sort(compareTyrants)
    .slice(0, LANES_SHOWN);
}

/** Longest series whose score is within one game, five meetings. */
export function laneHeats(games: readonly StatsGame[], players: readonly StatsPlayer[]): LaneMatchup[] {
  return allLaneSeries(games, players)
    .filter((row) => row.games >= MIN_RECORD_GAMES && Math.abs(row.aWins - row.bWins) <= 1)
    .sort(compareHeats)
    .slice(0, LANES_SHOWN);
}

function meanKda(rows: readonly StatsRow[]): VersusKda | null {
  if (rows.length === 0) return null;
  const n = rows.length;
  const kills = rows.reduce((sum, row) => sum + row.kills, 0) / n;
  const deaths = rows.reduce((sum, row) => sum + row.deaths, 0) / n;
  const assists = rows.reduce((sum, row) => sum + row.assists, 0) / n;
  return { kills, deaths, assists };
}

function topChamp(rows: readonly StatsRow[]): VersusChamp | null {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.championId === null) continue;
    counts.set(row.championId, (counts.get(row.championId) ?? 0) + 1);
  }
  let bestId: number | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    const named = championName(id);
    const bestNamed = bestId === null ? '' : championName(bestId);
    if (count > bestCount || (count === bestCount && named.localeCompare(bestNamed) < 0)) {
      bestId = id;
      bestCount = count;
    }
  }
  if (bestId === null) return null;
  return { champion: championName(bestId), count: bestCount };
}

function rowOf(game: StatsGame, playerId: string): StatsRow | undefined {
  return game.rows.find((row) => row.playerId === playerId);
}

function decideVerdict(series: {
  a: PlayerRef;
  b: PlayerRef;
  enemies: number;
  aWins: number;
  bWins: number;
  allies: number;
  allyWinRate: number | null;
}): string {
  if (series.enemies === 0 && series.allies === 0) return verdictNone();
  if (series.enemies === 0) {
    if (series.allyWinRate !== null && series.allyWinRate >= 70)
      return verdictTogetherHot(series.allyWinRate);
    if (series.allyWinRate !== null && series.allyWinRate <= 30)
      return verdictTogetherCursed(series.allyWinRate);
    return verdictAlliesOnly();
  }
  if (series.aWins === series.bWins) {
    if (series.allyWinRate !== null && series.allyWinRate >= 70)
      return verdictTogetherHot(series.allyWinRate);
    if (series.allyWinRate !== null && series.allyWinRate <= 30)
      return verdictTogetherCursed(series.allyWinRate);
    return verdictEven();
  }
  const leader = series.aWins > series.bWins ? series.a : series.b;
  const trailer = series.aWins > series.bWins ? series.b : series.a;
  const leadWins = Math.max(series.aWins, series.bWins);
  const rate = winRate(leadWins, series.enemies, 1);
  if (rate !== null && rate >= TYRANT_RATE && series.enemies >= MIN_RECORD_GAMES) {
    return verdictOwns(leader.name, trailer.name);
  }
  if (series.allyWinRate !== null && series.allyWinRate >= 70 && series.allies >= MIN_RECORD_GAMES) {
    return verdictTogetherHot(series.allyWinRate);
  }
  if (series.allyWinRate !== null && series.allyWinRate <= 30 && series.allies >= MIN_RECORD_GAMES) {
    return verdictTogetherCursed(series.allyWinRate);
  }
  return verdictLeads(leader.name);
}

function currentStreak(
  meetings: readonly { winnerId: string }[],
  roster: Map<string, StatsPlayer>,
): VersusStreak | null {
  const newest = meetings[meetings.length - 1];
  if (newest === undefined) return null;
  let length = 0;
  for (let index = meetings.length - 1; index >= 0; index -= 1) {
    if (meetings[index]?.winnerId !== newest.winnerId) break;
    length += 1;
  }
  const holder = roster.get(newest.winnerId);
  if (holder === undefined || length === 0) return null;
  return { holder: refOf(holder), length };
}

function lastMeetingOf(
  game: StatsGame | undefined,
  winnerId: string | undefined,
  roster: Map<string, StatsPlayer>,
): VersusMeeting | null {
  if (game === undefined || winnerId === undefined) return null;
  const holder = roster.get(winnerId);
  if (holder === undefined) return null;
  return { startedAt: game.startedAt, durationS: game.durationS, winner: refOf(holder) };
}

/**
 * One pair, in pick order: `left` is `?a=`, `right` is `?b=`. Enemy games are opposite sides;
 * ally games are the same side. Lane rows are only the meetings they played the same role.
 */
export function headToHead(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  leftId: string,
  rightId: string,
): HeadToHead | null {
  const roster = byPlayerId(players);
  const left = roster.get(leftId);
  const right = roster.get(rightId);
  if (left === undefined || right === undefined || leftId === rightId) return null;

  const a = refOf(left);
  const b = refOf(right);
  let aWins = 0;
  let bWins = 0;
  let allyWins = 0;
  let allyLosses = 0;
  const aEnemyRows: StatsRow[] = [];
  const bEnemyRows: StatsRow[] = [];
  const enemyMeetings: { game: StatsGame; winnerId: string; aWon: boolean }[] = [];
  const laneTallies = new Map<string, PairTally>();

  for (const game of games) {
    const aRow = rowOf(game, leftId);
    const bRow = rowOf(game, rightId);
    if (aRow === undefined || bRow === undefined) continue;

    if (aRow.side === bRow.side) {
      if (aRow.side === game.winningSide) allyWins += 1;
      else allyLosses += 1;
      continue;
    }

    const aWon = aRow.side === game.winningSide;
    if (aWon) aWins += 1;
    else bWins += 1;
    aEnemyRows.push(aRow);
    bEnemyRows.push(bRow);
    enemyMeetings.push({ game, winnerId: aWon ? leftId : rightId, aWon });

    if (aRow.role !== null && aRow.role === bRow.role) {
      addMeeting(laneTallies, game, aRow.role, aRow, bRow);
    }
  }

  const enemies = aWins + bWins;
  const allies = allyWins + allyLosses;
  const lanes: LaneMatchup[] = [];
  for (const tally of laneTallies.values()) {
    const matchup = toMatchup(roster, tally);
    if (matchup === null) continue;
    // Re-orient onto the pick: `a` is always the left player, even when they trail.
    const leftIsLeader = matchup.a.puuid === a.puuid;
    lanes.push({
      ...matchup,
      a,
      b,
      aWins: leftIsLeader ? matchup.aWins : matchup.bWins,
      bWins: leftIsLeader ? matchup.bWins : matchup.aWins,
      winRate: winRate(leftIsLeader ? matchup.aWins : matchup.bWins, matchup.games),
      tied: matchup.tied,
    });
  }
  lanes.sort((leftLane, rightLane) => LANE_ORDER.indexOf(leftLane.role) - LANE_ORDER.indexOf(rightLane.role));

  const last = enemyMeetings[enemyMeetings.length - 1];
  const allyWinRate = winRate(allyWins, allies);
  const series = {
    a,
    b,
    enemies,
    aWins,
    bWins,
    allies,
    allyWinRate,
  };

  return {
    a,
    b,
    enemies,
    aWins,
    bWins,
    allies,
    allyWins,
    allyLosses,
    allyWinRate,
    lanes,
    aKda: meanKda(aEnemyRows),
    bKda: meanKda(bEnemyRows),
    aChamp: topChamp(aEnemyRows),
    bChamp: topChamp(bEnemyRows),
    lastMeeting: lastMeetingOf(last?.game, last?.winnerId, roster),
    streak: currentStreak(
      enemyMeetings.map((meeting) => ({ winnerId: meeting.winnerId })),
      roster,
    ),
    form: enemyMeetings.slice(-5).map((meeting) => meeting.aWon),
    verdict: decideVerdict(series),
  };
}

export function versusRoster(games: readonly StatsGame[], players: readonly StatsPlayer[]): PlayerRef[] {
  const seen = new Set<string>();
  for (const game of games) for (const row of game.rows) seen.add(row.playerId);
  return players
    .filter((player) => seen.has(player.playerId))
    .map(refOf)
    .sort(compareByName);
}

export { countedGames, noRoleGames, playersWhoPlayed };
