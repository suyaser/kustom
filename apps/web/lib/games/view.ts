import { LOST, WON } from '../board/copy';
import { windowRangeLabel } from '../board/window';
import { championLabel } from '../champs/names';
import { formatDamage, formatDuration } from '../discord/embeds';
import { inLaneOrder } from '../laneOrder';
import { formatDayMonth, type WindowKind, type WindowRange } from '../night';
import { csCountLine, kdaLine } from '../stats/funCopy';
import type { StatsGame, StatsPlayer, StatsRow } from '../stats/types';
import type { PlayerName } from '../tonight/types';
import { focusMetaLine, resultForWinner, scoreLine, teamHeading } from './copy';
import { withDisplayRoles } from './displayRoles';
import { GAMES_QUEUE, matchesQueue, type QueueKind } from './queue';
import type { GamesHistoryView, HistoryGame, HistorySeat, HistoryTeam } from './types';

/**
 * `/games`, assembled from the same window `/stats` reads — **pure**, so the list and the
 * scoreboard are a unit test with a hand-built fixture and not a night of waiting.
 *
 * The universe here is **every captured game of this map in the window**, not `gateGame`. A
 * remake and a nine-player custom still happened; the player page already lists those under
 * Recent games, and a history page that hid them would disagree with it. `/stats` and `/fun`
 * keep the gate because their numbers are a fold, and they still mix the maps.
 */

export interface GamesHistoryInput {
  window: WindowKind;
  games: readonly StatsGame[];
  players: readonly StatsPlayer[];
  range: WindowRange;
  capped: boolean;
  cap: number;
  timeZone?: string | undefined;
  /** `?p=`. Absent is the group list. */
  focusPuuid?: string | null | undefined;
  /** `?queue=`. Absent is Summoner's Rift. */
  queue?: QueueKind | undefined;
}

export function gamesHistoryView(input: GamesHistoryInput): GamesHistoryView {
  const focusPuuid = input.focusPuuid ?? null;
  const queue = input.queue ?? GAMES_QUEUE;
  const roster = new Map(input.players.map((player) => [player.puuid, player]));
  const listed = newestFirst(input.games).filter((game) => {
    if (!matchesQueue(game.gameMode, queue, game.mapId)) return false;
    return focusPuuid === null ? true : game.rows.some((row) => row.puuid === focusPuuid);
  });
  const oldest = listed.length === 0 ? undefined : listed[listed.length - 1];
  const focusName = focusPuuid === null ? null : (roster.get(focusPuuid)?.name ?? null);

  return {
    window: input.window,
    queue,
    range:
      listed.length === 0
        ? null
        : windowRangeLabel(
            input.window,
            input.range,
            oldest === undefined ? null : new Date(oldest.startedAt),
            input.timeZone,
          ),
    games: listed.length,
    capped: input.capped,
    cap: input.cap,
    focusPuuid,
    focusName,
    items: listed.map((game) => historyGameOf(game, roster, focusPuuid, input.timeZone)),
  };
}

/** One custom as `/games` draws it. `/fun` attaches the same object to a one-game record. */
export function historyGameOf(
  game: StatsGame,
  roster: ReadonlyMap<string, StatsPlayer>,
  focusPuuid: string | null,
  timeZone: string | undefined,
): HistoryGame {
  const painted = { ...game, rows: withDisplayRoles(game) };
  const peakDamage = Math.max(0, ...painted.rows.map((row) => row.damageToChamps));
  const blue = teamOf(painted, 100, roster, peakDamage);
  const red = teamOf(painted, 200, roster, peakDamage);
  const focusRow = focusPuuid === null ? undefined : painted.rows.find((row) => row.puuid === focusPuuid);
  const focusSide = focusRow?.side;
  const focusSeat =
    focusSide === 100
      ? blue.seats.find((seat) => seat.puuid === focusPuuid)
      : focusSide === 200
        ? red.seats.find((seat) => seat.puuid === focusPuuid)
        : undefined;
  const teammates =
    focusSeat === undefined || focusSide === undefined ? [] : (focusSide === 100 ? blue : red).seats;

  return {
    id: game.id,
    startedAt: game.startedAt,
    startedLabel: formatDayMonth(new Date(game.startedAt), timeZone),
    durationLabel: formatDuration(game.durationS),
    winningSide: game.winningSide,
    result:
      focusSeat === undefined
        ? resultForWinner(game.winningSide)
        : focusSide === game.winningSide
          ? WON
          : LOST,
    score: scoreLine(blue.kills, red.kills),
    ruleSide: focusSide ?? game.winningSide,
    blue,
    red,
    focus: focusSeat ?? null,
    focusMeta:
      focusSeat === undefined
        ? null
        : focusMetaLine(focusSeat.kills, focusSeat.deaths, focusSeat.assists, focusSeat.kp, focusSeat.cs),
    teammates,
  };
}

function teamOf(
  game: StatsGame,
  side: 100 | 200,
  roster: ReadonlyMap<string, StatsPlayer>,
  peakDamage: number,
): HistoryTeam {
  const rows = game.rows.filter((row) => row.side === side);
  const kills = rows.reduce((sum, row) => sum + row.kills, 0);
  const gold = rows.reduce((sum, row) => sum + row.gold, 0);
  const seats = inLaneOrder(
    rows.map((row) => seatOf(row, roster.get(row.puuid)?.name ?? null, kills, peakDamage, game)),
  );

  return {
    side,
    label: teamHeading(side, kills),
    kills,
    gold,
    goldLabel: formatDamage(gold),
    won: game.winningSide === side,
    seats,
  };
}

function seatOf(
  row: StatsRow,
  name: PlayerName,
  teamKills: number,
  peakDamage: number,
  game: StatsGame,
): HistorySeat {
  const kp = teamKills === 0 ? null : Math.round(((row.kills + row.assists) / teamKills) * 100);

  return {
    puuid: row.puuid,
    name,
    role: row.role,
    champion: championLabel(row.championId, game.rawFacts?.byPuuid[row.puuid]?.championName),
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    kda: kdaLine(row.kills, row.deaths, row.assists),
    kp,
    gold: row.gold,
    damageToChamps: row.damageToChamps,
    cs: row.cs,
    goldLabel: formatDamage(row.gold),
    damageLabel: formatDamage(row.damageToChamps),
    csLabel: csCountLine(row.cs),
    damageShare: peakDamage === 0 ? 0 : Math.round((row.damageToChamps / peakDamage) * 100),
  };
}

/**
 * Newest first, with the rebuild's `lcu_game_id` tie-break reversed so two games that share
 * an instant stay in one order on every surface that lists them.
 */
function newestFirst(games: readonly StatsGame[]): StatsGame[] {
  return [...games].sort((a, b) => {
    const started = Date.parse(b.startedAt) - Date.parse(a.startedAt);
    if (started !== 0) return started;
    return compareLcuId(b.lcuGameId, a.lcuGameId);
  });
}

function compareLcuId(left: StatsGame['lcuGameId'], right: StatsGame['lcuGameId']): number {
  if (left === null || right === null) return left === right ? 0 : left === null ? -1 : 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}
