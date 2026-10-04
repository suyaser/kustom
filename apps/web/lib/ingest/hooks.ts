import type { Split } from '@customs/core';
import type { LobbyKickoff } from '@customs/db/schemas';
import type { PoolMember, SeatMove } from './selection';

/**
 * The seam M3.1 fills (Discord), and nothing else.
 *
 * Ingest and the admin's roll (`lib/admin/roll.ts`, the only thing that fires `balanced` since
 * 2026-10-03) decide what happened; something else decides who is told. The state machine must
 * pass every acceptance check with the webhook switched off, so posting is not allowed to be
 * inline: a hook that throws, or a webhook that is down, must not cost the group its teams.
 *
 * **M3.1**: call `registerLobbyHook({ onBalanced })` once at module load with the teams-embed
 * poster, and `onFinished` with the result embed (M3.3). Everything the embeds need is on the
 * events below — the chosen split, the explanation verbatim from core, who sits and who has
 * to change seats — so neither hook re-derives anything ingest already worked out. The
 * copy for the sit-out and seat lines is M2.15's, and `05-design.md` owns the layout.
 */

/** A lobby just reached `balanced` and its three splits are stored. */
export interface LobbyBalancedEvent {
  lobbyId: string;
  /** The lobby's group (M13.3): whose Discord channel the teams go to, whose tokens get commands. */
  groupId: string;
  /** `splits.id` of the chosen split (rank 1). */
  splitId: string;
  /** The ten puuids, sorted and joined with ',': `splits.roster_key`. */
  rosterKey: string;
  /** The chosen split, exactly as core returned it. */
  split: Split;
  /** Core's sentence for that split. Rendered verbatim, never recomposed. */
  explanation: string;
  /** The lobby's name, when the client reported one. */
  lobbyName: string | null;
  /** Null until M4.1 creates lobbies itself (`04-decisions.md`). */
  lobbyPassword: string | null;
  /** Everyone around minus the ten, first to sit first. Empty on a ten-player night. */
  sitters: PoolMember[];
  /** Who has to change seats, paired (M2.15's `Swap:` lines). */
  seatMoves: SeatMove[];
  /** True when everyone around has the same number of games tonight (M2.15's reason clause). */
  tiedOnGames: boolean;
  /** The ten who play, in the order the rotation put them. */
  playing: PoolMember[];
  /**
   * The origin of the request that triggered the transition, for the embed's `url` when
   * `NEXT_PUBLIC_SITE_URL` is unset (M3.1). Set by the route, not by ingest; `siteUrl.ts`
   * decides whether it is a link worth posting.
   */
  requestOrigin?: string | null;
}

/** An end-of-game block was stored, and the fold either rated it or said why not. */
export interface GameFinishedEvent {
  /** `games.id`, not the client's `lcu_game_id`. */
  gameId: string;
  lobbyId: string | null;
  /** The game's group (M13.3): whose Discord channel the result and fearless posts go to. */
  groupId: string;
  /** False for a remake, a short surrender, or a game that was already rated (M2.5's gate). */
  rated: boolean;
  /**
   * The fold's reason when `rated` is false (`RatingSkipReason`). `not-rated` (M15.3) marks a
   * clean Rift game played not rated, which still gets a result post (M15.6). Absent reads as
   * no reason.
   */
  reason?: string | null;
  /** As on {@link LobbyBalancedEvent}: the triggering request's origin, for the embed `url`. */
  requestOrigin?: string | null;
}

/**
 * A lobby's kickoff record was just written (M21.4): the game started and these are the teams
 * playing. Fired once per game, by the one `in_progress` post whose conditional write landed
 * (`writeKickoffAtStart`), so a retry or a second companion fires nothing (M21.6).
 */
export interface LobbyStartedEvent {
  lobbyId: string;
  /** The lobby's group: whose channel hears about it. */
  groupId: string;
  /** The record as written: kind, the two teams and, for `custom` / `unrolled`, Kustom's odds. */
  kickoff: LobbyKickoff;
  /** As on {@link LobbyBalancedEvent}: the triggering request's origin, for the embed `url`. */
  requestOrigin?: string | null;
}

export interface LobbyHook {
  onBalanced?: (event: LobbyBalancedEvent) => void | Promise<void>;
  onStarted?: (event: LobbyStartedEvent) => void | Promise<void>;
  onFinished?: (event: GameFinishedEvent) => void | Promise<void>;
}

const hooks: LobbyHook[] = [];

/** Register a listener. Idempotent per object; M3.1 calls this once at module load. */
export function registerLobbyHook(hook: LobbyHook): void {
  if (!hooks.includes(hook)) hooks.push(hook);
}

/** Tests only: forget every listener. */
export function clearLobbyHooks(): void {
  hooks.length = 0;
}

async function emit<E>(
  event: E,
  pick: (hook: LobbyHook) => ((event: E) => void | Promise<void>) | undefined,
  label: string,
): Promise<void> {
  for (const hook of hooks) {
    const handler = pick(hook);
    if (!handler) continue;
    try {
      await handler(event);
    } catch (error) {
      // One line and on with the night: the tonight page is the other surface and it must not
      // depend on Discord having accepted anything (M3.1, "Webhook missing").
      console.error(`lobby hook ${label} failed`, error);
    }
  }
}

export function emitLobbyBalanced(event: LobbyBalancedEvent): Promise<void> {
  return emit(event, (hook) => hook.onBalanced, 'onBalanced');
}

export function emitLobbyStarted(event: LobbyStartedEvent): Promise<void> {
  return emit(event, (hook) => hook.onStarted, 'onStarted');
}

export function emitGameFinished(event: GameFinishedEvent): Promise<void> {
  return emit(event, (hook) => hook.onFinished, 'onFinished');
}
