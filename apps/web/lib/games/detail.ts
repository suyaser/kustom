import type { Calibration } from '@customs/core';
import type { ReceiptNames, StoredSplit } from '@/components/receipt/types';
import { formatNightLabel, nightStart } from '../night';
import { isGameId } from '../og/load';
import type { PublicClient } from '../publicClient';
import { displayDelta } from '../ratingDisplay';
import { rawFactsFromUnknown } from '../stats/rawFacts';
import type { StatsGame, StatsPlayer } from '../stats/types';
import { renderWebName } from '../tonight/copy';
import { formatMinutes } from './duration';
import { readKickoffs } from './kickoffs';
import { gameModeFromRaw, matchesQueue } from './queue';
import {
  readGroupCalibration,
  readNamesByPuuid,
  readPlayersById,
  readScoreRows,
  readSplitRuns,
} from './read';
import { type GameReceipt, gameReceiptOf } from './receipt';
import type { HistorySeat } from './types';
import { historyGameOf } from './view';

/**
 * `/g/<slug>/games/<id>` (M14.16): one stored game with its full receipt and both scoreboards.
 * A game of another group under this slug is `null` (the page's 404, never a redirect across
 * groups, M13.11). The scoreboard is `historyGameOf`, the function `/fun`'s one-game records
 * already use, so MVP and ACE are `gatedGameAward`'s and nobody else's.
 */

export interface DetailSeat extends HistorySeat {
  /** `displayDelta` for the game, or `null` when it was not rated (ARAM, unrated backfill). */
  delta: number | null;
  isViewer: boolean;
}

export interface DetailTeam {
  side: 100 | 200;
  kills: number;
  won: boolean;
  seats: DetailSeat[];
}

export interface GameDetailView {
  gameId: string;
  winningSide: 100 | 200;
  /** `Tuesday 22 September`: the night it was played. */
  nightLabel: string;
  /** `21 min`. */
  durationLabel: string;
  aram: boolean;
  /** Every row was rated by the fold. */
  rated: boolean;
  blue: DetailTeam;
  red: DetailTeam;
  receipt: GameReceipt;
  /** puuid -> printed name, for every person the receipt can name (the scoreboard and the run). */
  names: ReceiptNames;
  calibration: Calibration;
}

export async function loadGameDetail(
  client: PublicClient,
  options: {
    gameId: string;
    groupId: string;
    viewerPuuid: string | null;
    timeZone: string;
    /** As `loadGamesList`'s: pages pass `cachedGroupCalibration`; the default reads with `client`. */
    calibration?: (groupId: string) => Promise<Calibration>;
  },
): Promise<GameDetailView | null> {
  const { gameId, groupId, timeZone } = options;
  if (!isGameId(gameId)) return null;

  // app-perf (2026-10-04): the game, its scoreboard and the calibration line in one round (the
  // scoreboard is keyed by the game id the URL already gave), then the run and the names.
  const [{ data: game, error }, rows, calibration] = await Promise.all([
    // The one page that reads `raw` whole: one row, for the scoreboard's client facts.
    client
      .from('games')
      .select('id, started_at, duration_s, winning_side, lobby_id, lcu_game_id, raw, rated')
      .eq('id', gameId)
      .eq('group_id', groupId)
      .maybeSingle(),
    readScoreRows(client, [gameId]),
    options.calibration?.(groupId) ?? readGroupCalibration(client, groupId),
  ]);
  if (error) throw new Error(`games: game lookup failed: ${error.message}`);
  if (game === null || (game.winning_side !== 100 && game.winning_side !== 200)) return null;
  const winningSide: 100 | 200 = game.winning_side;
  if (rows.length === 0) return null;

  const [runs, players, kickoffs] = await Promise.all([
    game.lobby_id === null
      ? Promise.resolve(new Map<string, StoredSplit[]>())
      : readSplitRuns(client, [game.lobby_id]),
    readPlayersById(
      client,
      rows.map((row) => row.playerId),
    ),
    readKickoffs(client, game.lobby_id === null ? [] : [game.lobby_id]),
  ]);
  const run = game.lobby_id === null ? [] : (runs.get(game.lobby_id) ?? []);

  const puuidOf = (playerId: string): string => players.get(playerId)?.puuid ?? `id:${playerId}`;
  const aram = matchesQueue(gameModeFromRaw(game.raw), 'aram');
  const rated = rows.every((row) => row.rAfter !== null);

  const statsGame: StatsGame = {
    id: game.id,
    startedAt: game.started_at,
    lcuGameId: game.lcu_game_id,
    durationS: game.duration_s,
    winningSide,
    gameMode: gameModeFromRaw(game.raw),
    rawFacts: rawFactsFromUnknown(game.raw),
    rows: rows.map((row) => ({
      playerId: row.playerId,
      puuid: puuidOf(row.playerId),
      side: row.side,
      role: row.role,
      rBefore: row.rBefore,
      rAfter: row.rAfter,
      championId: row.championId,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      gold: row.gold,
      damageToChamps: row.damageToChamps,
      cs: row.cs,
      visionScore: row.visionScore,
      damageSelfMitigated: row.damageSelfMitigated,
      damageToObjectives: row.damageToObjectives,
    })),
  };
  const roster = new Map<string, StatsPlayer>(
    [...players.values()].map((player) => [player.puuid, { ...player }]),
  );
  const history = historyGameOf(statsGame, roster, null, timeZone, { award: true });

  const byPuuid = new Map(statsGame.rows.map((row) => [row.puuid, row]));
  const team = (side: 100 | 200): DetailTeam => {
    const source = side === 100 ? history.blue : history.red;
    return {
      side,
      kills: source.kills,
      won: source.won,
      seats: source.seats.map((seat) => {
        const row = byPuuid.get(seat.puuid);
        return {
          ...seat,
          delta:
            aram || row === undefined || row.rBefore === null || row.rAfter === null
              ? null
              : displayDelta(row.rBefore, row.rAfter),
          isViewer: options.viewerPuuid !== null && seat.puuid === options.viewerPuuid,
        };
      }),
    };
  };

  const receipt = gameReceiptOf({
    aram,
    // `games.rated` (M15.18), not `rated` above: a game played not rated shows no after-the-fact odds.
    rated: game.rated,
    seats: rows.map((row) => ({
      puuid: puuidOf(row.playerId),
      side: row.side,
      rBefore: row.rBefore,
    })),
    splits: run,
    kickoff: game.lobby_id === null ? null : (kickoffs.get(game.lobby_id) ?? null),
  });

  const names: Record<string, string> = {};
  for (const player of players.values()) names[player.puuid] = renderWebName(player.name);
  const missing = run
    .flatMap((split) => [...split.blue, ...split.red].map((a) => a.puuid))
    .filter((p) => !(p in names));
  if (missing.length > 0) {
    for (const [puuid, name] of await readNamesByPuuid(client, missing)) names[puuid] = renderWebName(name);
  }

  const started = new Date(game.started_at);
  return {
    gameId: game.id,
    winningSide,
    nightLabel: formatNightLabel(nightStart(started, timeZone), timeZone),
    durationLabel: formatMinutes(game.duration_s),
    aram,
    rated,
    blue: team(100),
    red: team(200),
    receipt,
    names,
    calibration,
  };
}
