/**
 * The endpoint catalogue: every client path this project touches, in one place.
 *
 * Mirrors the "Endpoints we use" table in docs/03-lcu-reference.md. The smoke script walks
 * `READ_ENDPOINTS`; the write paths are listed so nothing else in the repo spells a client path.
 *
 * Path templates use `{puuid}`, `{gameName}`, `{tagLine}` and `{gameId}`; `fillPath` substitutes them
 * with URL-encoded values.
 */

export type PathParam = 'puuid' | 'gameName' | 'tagLine' | 'gameId';

export interface ReadEndpoint {
  /** Fixture file name (`fixtures/<patch>/<id>.json`) and table label. */
  readonly id: string;
  readonly purpose: string;
  /** Template path. Always GET. */
  readonly path: string;
  /** Template parameters that must be known before this endpoint can be hit. */
  readonly params: readonly PathParam[];
  /** Statuses that are normal when the client is idle (no lobby, not in a game). */
  readonly idleStatuses: readonly number[];
  /** True for the client's own OpenAPI documents, which may not be served at all. */
  readonly optional?: boolean;
}

export const READ_ENDPOINTS: readonly ReadEndpoint[] = [
  {
    id: 'game-version',
    purpose: 'Client patch version (fixture directory name)',
    path: '/lol-patch/v1/game-version',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'system-builds',
    purpose: 'Build info; fallback source for the version',
    path: '/system/v1/builds',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'current-summoner',
    purpose: 'Local player: puuid, summonerId, gameName, tagLine',
    path: '/lol-summoner/v1/current-summoner',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'alias-lookup',
    purpose: 'Riot ID -> puuid (probed with the local player)',
    path: '/lol-summoner/v1/alias/lookup?gameName={gameName}&tagLine={tagLine}',
    params: ['gameName', 'tagLine'],
    idleStatuses: [200],
  },
  {
    id: 'summoner-by-puuid',
    purpose: 'puuid -> summonerId (invites need it)',
    path: '/lol-summoner/v2/summoners/puuid/{puuid}',
    params: ['puuid'],
    idleStatuses: [200],
  },
  {
    id: 'current-ranked-stats',
    purpose: 'Own rank',
    path: '/lol-ranked/v1/current-ranked-stats',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'ranked-stats-by-puuid',
    purpose: 'Rank of a player by puuid',
    path: '/lol-ranked/v1/ranked-stats/{puuid}',
    params: ['puuid'],
    idleStatuses: [200],
  },
  {
    id: 'gameflow-phase',
    purpose: 'Gameflow phase',
    path: '/lol-gameflow/v1/gameflow-phase',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'gameflow-session',
    purpose: 'Gameflow session (gameId before end of game)',
    path: '/lol-gameflow/v1/session',
    params: [],
    idleStatuses: [200, 404],
  },
  {
    id: 'lobby',
    purpose: 'Current lobby (404 when not in one)',
    path: '/lol-lobby/v2/lobby',
    params: [],
    idleStatuses: [404],
  },
  {
    id: 'custom-game-queues',
    purpose:
      "Custom game config: the map/mode subcategories and the mutator ids the client's own Create Custom dialog offers (M4.1: what a create body's queueId/mutators.id come from)",
    path: '/lol-game-queues/v1/custom',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'game-queues',
    purpose: 'Every queue with its gameTypeConfig; names the custom mutator ids',
    path: '/lol-game-queues/v1/queues',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'eog-stats-block',
    purpose: 'End of game stats (only during EndOfGame)',
    path: '/lol-end-of-game/v1/eog-stats-block',
    params: [],
    idleStatuses: [404],
  },
  {
    id: 'match-history',
    purpose: 'Match history list for a puuid',
    path: '/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=20',
    params: ['puuid'],
    idleStatuses: [200],
  },
  {
    id: 'match-detail',
    purpose: 'Match detail by gameId (first game from the history list)',
    path: '/lol-match-history/v1/games/{gameId}',
    params: ['gameId'],
    idleStatuses: [200],
  },
  {
    id: 'swagger-v2',
    purpose: "The client's own OpenAPI v2 document, when enabled",
    path: '/swagger/v2/swagger.json',
    params: [],
    idleStatuses: [200, 404],
    optional: true,
  },
  {
    id: 'openapi-v3',
    purpose: "The client's own OpenAPI v3 document, when enabled",
    path: '/swagger/v3/openapi.json',
    params: [],
    idleStatuses: [200, 404],
    optional: true,
  },
];

/**
 * The in-game live data server. A different process on a fixed port, no auth, only while a game runs.
 * Not needed unless end-of-game capture proves unreliable (docs/03-lcu-reference.md).
 */
export const LIVE_CLIENT_DATA = {
  id: 'live-client-data',
  port: 2999,
  path: '/liveclientdata/allgamedata',
} as const;

/**
 * Lobby automation path (M4): switch side, `verified (16.18, 2026-09-12)`. Create and invite were removed in M22.11.
 *
 * The switch-side path is the one the client's own lobby UI uses on 16.17 (`rcp-fe-lol-parties`, read from
 * the installed plugin bundle on 2026-09-10): `POST /lol-lobby/v2/lobby/team/TEAM1|TEAM2` with no body moves
 * the local player to that side (and `SPECTATOR`, which we never send). The community `switch-teams` paths
 * (`/lol-lobby/v1|v2/lobby/custom/switch-teams`) are absent from the 16.17 schema and from the UI code, so
 * they are not candidates any more.
 */
export const WRITE_ENDPOINTS = {
  switchSide: {
    method: 'POST',
    template: '/lol-lobby/v2/lobby/team/{team}',
    paths: {
      100: '/lol-lobby/v2/lobby/team/TEAM1',
      200: '/lol-lobby/v2/lobby/team/TEAM2',
    },
  },
} as const;

/**
 * The match history list, one page (M5.1 backfill). `begIndex`/`endIndex` are positions in the player's
 * history, newest first; on 16.17 `begIndex=0&endIndex=20` answered 21 games, so the window is inclusive and
 * two consecutive pages built with `(puuid, 0, 20)` / `(puuid, 20, 40)` overlap by one game. Callers dedupe
 * on `gameId`. The same endpoint as the `match-history` row above, with the query filled in.
 */
export const MATCH_HISTORY_PAGE_TEMPLATE =
  '/lol-match-history/v1/products/lol/{puuid}/matches?begIndex={begIndex}&endIndex={endIndex}';

export function matchHistoryPagePath(puuid: string, begIndex: number, endIndex: number): string {
  if (!Number.isInteger(begIndex) || begIndex < 0 || !Number.isInteger(endIndex) || endIndex < begIndex) {
    throw new Error(`invalid match history window: begIndex=${begIndex} endIndex=${endIndex}`);
  }
  return MATCH_HISTORY_PAGE_TEMPLATE.replace('{puuid}', encodeURIComponent(puuid))
    .replace('{begIndex}', String(begIndex))
    .replace('{endIndex}', String(endIndex));
}

/** The catalogue row for an endpoint id. Throws for an id that is not in `READ_ENDPOINTS`: that is a typo, not a runtime condition. */
export function readEndpoint(id: string): ReadEndpoint {
  const endpoint = READ_ENDPOINTS.find((entry) => entry.id === id);
  if (endpoint === undefined) {
    throw new Error(`unknown read endpoint id: ${id}`);
  }
  return endpoint;
}

/** Substitutes `{param}` placeholders. Values are URL-encoded. Missing values are left as-is. */
export function fillPath(template: string, values: Partial<Record<PathParam, string>>): string {
  return template.replace(/\{(puuid|gameName|tagLine|gameId)\}/g, (match, name: PathParam) => {
    const value = values[name];
    return value === undefined ? match : encodeURIComponent(value);
  });
}

/** True when every template parameter has a value. */
export function canFill(endpoint: ReadEndpoint, values: Partial<Record<PathParam, string>>): boolean {
  return endpoint.params.every((param) => values[param] !== undefined);
}
