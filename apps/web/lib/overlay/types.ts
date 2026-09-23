/**
 * What `GET /api/overlay` returns (M12): the fearless pool and the posted lobby with
 * same-side / against records for the viewer.
 */

import type { LobbyStatusValue, RoleValue, SideValue } from '@customs/db';

/** A W–L past {@link MIN_DUO_GAMES}, or null when the floor is not met. */
export interface OverlayRecord {
  games: number;
  wins: number;
  losses: number;
}

/** Same-role opposite-side series for the posted lane opponent, when one exists. */
export interface OverlayLaneRecord {
  games: number;
  wins: number;
  losses: number;
}

export interface OverlayFearlessChampion {
  id: number;
  name: string;
  role: RoleValue | null;
  /** Community Dragon URL, or null when the id is unknown. */
  iconUrl: string | null;
}

export interface OverlaySeat {
  puuid: string;
  name: string | null;
  role: RoleValue | null;
  rating: number;
  side: SideValue;
  with: OverlayRecord | null;
  against: OverlayRecord | null;
  /** True when this seat is the viewer's posted lane opponent. */
  isLaneOpponent: boolean;
  /** Same-role series vs the viewer when {@link isLaneOpponent}, else null. */
  lane: OverlayLaneRecord | null;
}

export interface OverlayTeams {
  blue: OverlaySeat[];
  red: OverlaySeat[];
}

export interface OverlayLobby {
  status: LobbyStatusValue;
  /** Null until a split is posted (`balanced` / `in_game` / finished with teams). */
  teams: OverlayTeams | null;
}

export interface OverlayView {
  viewerPuuid: string;
  fearless: {
    champions: readonly OverlayFearlessChampion[];
    resetAt: string | null;
  };
  /** Null when tonight has no live lobby, or the viewer is unknown to the board. */
  lobby: OverlayLobby | null;
}
