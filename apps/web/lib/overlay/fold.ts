/**
 * Pure overlay assembly (M12): fearless chips plus posted seats with with/against records.
 *
 * Synergy is {@link headToHead}'s ally and enemy counts — the same folds `/1v1` and Partners
 * already use. No new formula. Below {@link MIN_DUO_GAMES} both records are null and the
 * panel prints {@link OVERLAY_THIN_RECORD}.
 */

import type { RoleValue, SideValue } from '@customs/db';
import { championIconUrl } from '../champs/names';
import { groupFearless } from '../fearless/present';
import type { FearlessChampion } from '../fearless/types';
import { MIN_DUO_GAMES } from '../stats/copy';
import type { StatsGame, StatsPlayer } from '../stats/types';
import type { SeatView } from '../tonight/types';
import { headToHead, versusGames } from '../versus/fold';
import type {
  OverlayFearlessChampion,
  OverlayLaneRecord,
  OverlayLobby,
  OverlayRecord,
  OverlaySeat,
  OverlayTeams,
  OverlayView,
} from './types';

export interface OverlaySeatInput {
  puuid: string;
  name: string | null;
  role: RoleValue | null;
  rating: number;
  side: SideValue;
}

export interface OverlayFoldInput {
  viewerPuuid: string;
  fearless: readonly FearlessChampion[];
  resetAt: string | null;
  /** Null when there is no tonight lobby. */
  lobby: {
    status: OverlayLobby['status'];
    blue: readonly OverlaySeatInput[];
    red: readonly OverlaySeatInput[];
    /** False while the lobby is open and no split is posted yet. */
    hasPostedTeams: boolean;
  } | null;
  games: readonly StatsGame[];
  players: readonly StatsPlayer[];
}

export function overlayView(input: OverlayFoldInput): OverlayView {
  const champions = presentOverlayFearless(input.fearless);
  if (input.lobby === null) {
    return {
      viewerPuuid: input.viewerPuuid,
      fearless: { champions, resetAt: input.resetAt },
      lobby: null,
    };
  }

  if (!input.lobby.hasPostedTeams) {
    return {
      viewerPuuid: input.viewerPuuid,
      fearless: { champions, resetAt: input.resetAt },
      lobby: { status: input.lobby.status, teams: null },
    };
  }

  const counted = versusGames(input.games);
  const byPuuid = new Map(input.players.map((player) => [player.puuid, player]));
  const viewer = byPuuid.get(input.viewerPuuid);
  const viewerSeat = [...input.lobby.blue, ...input.lobby.red].find(
    (seat) => seat.puuid === input.viewerPuuid,
  );
  const laneOpponentPuuid =
    viewerSeat?.role !== null && viewerSeat?.role !== undefined
      ? laneOpponentOf(viewerSeat, input.lobby.blue, input.lobby.red)
      : null;

  const teams: OverlayTeams = {
    blue: input.lobby.blue.map((seat) => seatRow(seat, viewer, counted, input.players, laneOpponentPuuid)),
    red: input.lobby.red.map((seat) => seatRow(seat, viewer, counted, input.players, laneOpponentPuuid)),
  };

  return {
    viewerPuuid: input.viewerPuuid,
    fearless: { champions, resetAt: input.resetAt },
    lobby: { status: input.lobby.status, teams },
  };
}

/** Lane then A–Z, with icon URLs for the panel. */
export function presentOverlayFearless(champions: readonly FearlessChampion[]): OverlayFearlessChampion[] {
  const out: OverlayFearlessChampion[] = [];
  for (const group of groupFearless(champions)) {
    for (const champion of group.champions) {
      out.push({
        id: champion.id,
        name: champion.name,
        role: champion.role,
        iconUrl: championIconUrl(champion.id),
      });
    }
  }
  return out;
}

export function seatsFromTonight(
  blue: readonly SeatView[],
  red: readonly SeatView[],
): {
  blue: OverlaySeatInput[];
  red: OverlaySeatInput[];
} {
  return {
    blue: blue.map((seat) => withSide(seat, 100)),
    red: red.map((seat) => withSide(seat, 200)),
  };
}

export function withSide(seat: SeatView, side: SideValue): OverlaySeatInput {
  return {
    puuid: seat.puuid,
    name: seat.name,
    role: seat.role,
    rating: seat.rating,
    side,
  };
}

function seatRow(
  seat: OverlaySeatInput,
  viewer: StatsPlayer | undefined,
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  laneOpponentPuuid: string | null,
): OverlaySeat {
  const isLaneOpponent = laneOpponentPuuid !== null && seat.puuid === laneOpponentPuuid;
  if (viewer === undefined || seat.puuid === viewer.puuid) {
    return {
      ...seat,
      with: null,
      against: null,
      isLaneOpponent: false,
      lane: null,
    };
  }

  const other = players.find((player) => player.puuid === seat.puuid);
  if (other === undefined) {
    return {
      ...seat,
      with: null,
      against: null,
      isLaneOpponent,
      lane: null,
    };
  }

  const series = headToHead(games, players, viewer.playerId, other.playerId);
  if (series === null) {
    return {
      ...seat,
      with: null,
      against: null,
      isLaneOpponent,
      lane: null,
    };
  }

  const withRecord = toRecord(series.allies, series.allyWins, series.allyLosses);
  const againstRecord = toRecord(series.enemies, series.aWins, series.bWins);
  const lane = isLaneOpponent ? laneRecord(series.lanes, viewer.puuid) : null;

  return {
    ...seat,
    with: withRecord,
    against: againstRecord,
    isLaneOpponent,
    lane,
  };
}

function toRecord(games: number, wins: number, losses: number): OverlayRecord | null {
  if (games < MIN_DUO_GAMES) return null;
  return { games, wins, losses };
}

function laneRecord(
  lanes: readonly { a: { puuid: string }; games: number; aWins: number; bWins: number }[],
  viewerPuuid: string,
): OverlayLaneRecord | null {
  const match = lanes[0];
  if (match === undefined || match.games < MIN_DUO_GAMES) return null;
  const viewerIsA = match.a.puuid === viewerPuuid;
  return {
    games: match.games,
    wins: viewerIsA ? match.aWins : match.bWins,
    losses: viewerIsA ? match.bWins : match.aWins,
  };
}

function laneOpponentOf(
  viewer: OverlaySeatInput,
  blue: readonly OverlaySeatInput[],
  red: readonly OverlaySeatInput[],
): string | null {
  if (viewer.role === null) return null;
  const otherSide = viewer.side === 100 ? red : blue;
  const match = otherSide.find((seat) => seat.role === viewer.role);
  return match?.puuid ?? null;
}
