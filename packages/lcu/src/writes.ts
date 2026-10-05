/**
 * The lobby write: switch side. This is the only file in the repo that POSTs to the League client, and it can
 * only POST to the paths in `LOBBY_WRITE_PATHS`: every call goes through `post()` below, which throws for any
 * other path. Nothing else, ever (`CLAUDE.md` "Never automate gameplay").
 *
 * Create lobby and invite lived here until M22.11 removed Start a lobby and the invite fan-out: the server no
 * longer queues either kind. Their recorded evidence stays as fixtures under `fixtures/16.17` and `16.18`
 * and in docs/03-lcu-reference.md, marked no longer used.
 *
 * Switch side is `verified (16.18, 2026-09-12)` in docs/03-lcu-reference.md: the bare `POST .../team/TEAM2`
 * answered 204. The response body is never depended on: the companion re-reads `GET /lol-lobby/v2/lobby`
 * (verified) after the write and builds its result from that.
 *
 * `LOBBY_WRITE_VERIFICATION` is the per-kind gate the companion reads. It is flipped by hand, in the same
 * edit that turns the reference row green, and `writes.test.ts` refuses a `verified: true` whose row in
 * docs/03 is still `unverified`, so the flag can never run ahead of the doc.
 */

import type { LcuClient, LcuResponse } from './client.js';
import { WRITE_ENDPOINTS } from './endpoints.js';
import { JsonValueSchema, type TeamId } from './schemas.js';

export type LobbyWriteKind = 'switch_side';

export type WriteVerification =
  | { readonly verified: false }
  | { readonly verified: true; readonly patch: string; readonly date: string };

/**
 * The gate. `verified: true` only after the companion's `--verify-commands` report has been pasted back and
 * the row in docs/03-lcu-reference.md ("Endpoints we use") reads `verified (<patch>, <date>)` for that kind.
 * While false, the companion answers `endpoint_unverified` for that kind and makes no client call.
 */
export const LOBBY_WRITE_VERIFICATION: Readonly<Record<LobbyWriteKind, WriteVerification>> = {
  switch_side: { verified: true, patch: '16.18', date: '2026-09-12' },
};

export function isLobbyWriteVerified(kind: LobbyWriteKind): boolean {
  return LOBBY_WRITE_VERIFICATION[kind].verified;
}

/** The reference row each kind depends on, for the log line that says what to verify. */
export const LOBBY_WRITE_REFERENCE_ROW: Readonly<Record<LobbyWriteKind, string>> = {
  switch_side: 'Switch side (POST /lol-lobby/v2/lobby/team/{team})',
};

/** The whole allow-list. A POST to anything else throws. */
export const LOBBY_WRITE_PATHS: readonly string[] = [
  WRITE_ENDPOINTS.switchSide.paths[100],
  WRITE_ENDPOINTS.switchSide.paths[200],
];

export function isLobbyWritePath(path: string): boolean {
  return LOBBY_WRITE_PATHS.includes(path);
}

/** Throws for a path outside the allow-list. The only way out of this file to the client is through it. */
export function assertLobbyWritePath(path: string): void {
  if (!isLobbyWritePath(path)) {
    throw new Error(`refusing to POST outside the lobby allow-list: ${path}`);
  }
}

// --- the wire ----------------------------------------------------------------------------------------------

/** One write as it went over the wire, for the verify report and the fixture. */
export interface LobbyWrite {
  readonly method: 'POST';
  readonly path: string;
  /** Undefined when the request had no body (the side switch). */
  readonly body: unknown;
  readonly response: LcuResponse<unknown>;
}

function post(client: LcuClient, path: string, body: unknown): Promise<LcuResponse<unknown>> {
  assertLobbyWritePath(path);
  return client.post(path, body, JsonValueSchema);
}

/** `/lol-lobby/v2/lobby/team/TEAM1` for 100, `/TEAM2` for 200: the side the local player moves to. */
export function switchSidePath(side: TeamId): string {
  return WRITE_ENDPOINTS.switchSide.paths[side];
}

/**
 * `POST /lol-lobby/v2/lobby/team/TEAM1|TEAM2` with no body: not a toggle, the target side is in the path.
 * Callers read the lobby first and refuse when the local player is already there, when that side holds
 * five, or when the local player is a spectator; and read it again after, because the answer body is unknown.
 */
export async function postSwitchSide(client: LcuClient, side: TeamId): Promise<LobbyWrite> {
  const path = switchSidePath(side);
  return { method: 'POST', path, body: undefined, response: await post(client, path, undefined) };
}

/** `status` and, for an HTTP answer, the client's `message`, for a log line or a nack. Never a body. */
export function describeWriteResponse(response: LcuResponse<unknown>): string {
  if (response.ok) {
    return `${response.status}`;
  }
  switch (response.reason) {
    case 'http': {
      const json = response.json;
      const message =
        json && typeof json === 'object' && 'message' in json && typeof json.message === 'string'
          ? json.message
          : json && typeof json === 'object' && 'errorCode' in json && typeof json.errorCode === 'string'
            ? json.errorCode
            : '';
      return message.length > 0 ? `${response.status} ${message}` : `${response.status}`;
    }
    case 'network':
      return `no answer (${response.code ?? response.message})`;
    case 'malformed':
      return `${response.status} (body is not JSON)`;
    case 'schema':
      return `${response.status} (unexpected shape)`;
  }
}
