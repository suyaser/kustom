import { z } from 'zod';
import {
  type companionCommandKindSchema,
  jsonObjectSchema,
  lobbyStatusSchema,
  puuidSchema,
  sideSchema,
} from './common';

/**
 * What `/api/companion/*` answers. These live here, beside the request schemas, so
 * `apps/companion` parses the same definition the route validated its answer against
 * (M2.1): a response the companion cannot parse is a bug we want at compile time, not at
 * three in the morning in a friend's tray.
 *
 * Every route answers the same envelope: `{ ok: true, ... }` or `{ ok: false, error, issues? }`
 * (`apps/web/lib/http.ts`), so the companion branches on `ok` and nothing else. The error
 * half is the same for every route and is not repeated per response.
 */

/** The `{ ok: false }` half of every companion answer, whatever the status code. */
export const companionErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

/**
 * `GET /api/companion/me`: who the bearer token says the caller is. The companion calls this
 * on first run to check the token it was pasted, and on start to log which player it is
 * reporting as. It writes nothing.
 */
export const companionMeResponseSchema = z.object({
  ok: z.literal(true),
  /** The identity. Everything the companion posts is attributed to this PUUID by the server. */
  puuid: z.string().min(1),
  playerId: z.uuid(),
  /** `players.display_name`, null until a name is known (M1.7). For a log line, nothing else. */
  displayName: z.string().nullable(),
});

/**
 * `POST /api/companion/lobby`.
 *
 * `status` is echoed so the companion can log it; the companion never sends a status. Who
 * moves a lobby between statuses is the server's business (M2.5).
 */
export const companionLobbyResponseSchema = z.object({
  ok: z.literal(true),
  lobbyId: z.uuid(),
  status: lobbyStatusSchema,
  /** False when this party id was already known: the second identical post. */
  created: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  /**
   * True when the lobby has left `open`/`balanced` and its roster is now history (M2.9):
   * this post changed no `lobby_members` row and `memberCount` is what is stored.
   */
  rosterFrozen: z.boolean(),
  /**
   * **Knock again in this many milliseconds** (M2.5). Vercel gives the API no timer, so
   * "the roster has not changed for ten seconds" is measured on the posts we already get:
   * when the lobby is still `open` and holds ten or more people around — spectators included,
   * because the eleventh friend has nowhere else to stand — the server answers with the
   * milliseconds left on the stability clock (at least 1000, the full window when the roster
   * just changed) and the companion re-posts the *identical* payload after that delay unless a
   * real lobby event has produced a newer one first (M2.2).
   *
   * `null` means do nothing: fewer than ten, already `balanced`, or any other state.
   */
  recheckInMs: z.number().int().nonnegative().nullable(),
  /**
   * **PUUIDs the server would like a rank for** (M2.4), drawn from the members just posted:
   * those whose `players` row has no `rank_updated_at`, or one older than seven days, or no
   * row at all yet. Spectators are included — they play the next round, and a name is worth
   * having either way.
   *
   * This is the whole of "once, then weekly": the staleness rule is about our data, so it
   * lives where our data is, and a puuid drops off the list the moment its rank POST lands.
   * The companion holds no schedule, only an in-process de-duplicator so a burst of lobby
   * posts cannot ask the client for the same puuid twice.
   *
   * Order is the posted member order. An empty array means everyone is fresh.
   */
  ranksNeeded: z.array(z.string().min(1)),
});

/**
 * `POST /api/companion/game`, both phases.
 *
 * One flat shape for both so the companion does not have to branch twice. The `in_progress`
 * phase stores nothing yet — moving the lobby to `in_game` is M2.5 — so it answers with
 * `created: false` and no ids.
 *
 * A 2xx here, `created: false` included, means the server has the game and the companion may
 * delete its queued copy (M2.3).
 */
export const companionGameResponseSchema = z.object({
  ok: z.literal(true),
  phase: z.enum(['in_progress', 'eog']),
  /**
   * False when this `lcu_game_id` was already stored. A later backfill of the same id
   * may still copy `teams[].bans` onto a live eog row that never stored them.
   */
  created: z.boolean(),
  gameId: z.uuid().nullable(),
  lobbyId: z.uuid().nullable(),
  /** Rows in `game_players` for this game. */
  participants: z.number().int().nonnegative(),
  /**
   * Whether the rating fold ran for this post (M5.1). Optional so an older companion, and the
   * `in_progress` phase, are unaffected: the field the companion acts on is still `created`.
   *
   * A `source: 'backfill'` game is always `{ rated: false, reason: 'backfill' }` — stored, in
   * order, waiting for `pnpm --filter web rebuild-ratings` (M5.2). For an end-of-game post
   * `reason` names the gate when it did not rate: `duration`, `participant-count`,
   * `side-split`, `duplicate-player`, `already-rated`, and — M7.1 — `game-mode`, which is an
   * ARAM or any other map: stored whole, never rated, and still a 2xx.
   */
  rated: z.boolean().optional(),
  reason: z.string().nullable().optional(),
});

/**
 * `POST /api/companion/rank`.
 *
 * `stored` is false when the payload was for a queue we do not seed ratings from: the player
 * row still exists (it may have been created by this very request), but its rank columns were
 * left alone.
 */
export const companionRankResponseSchema = z.object({
  ok: z.literal(true),
  playerId: z.uuid(),
  stored: z.boolean(),
});

/** Ids per scan call. The companion batches at this size; the route refuses more. */
export const BACKFILL_SCAN_BATCH_SIZE = 100;

/**
 * `POST /api/companion/backfill/scan` (M5.1): "which of these games do you already have, and may I send
 * the rest?" **This comment is the whole backfill contract**; the companion (`apps/companion/src/backfill.ts`)
 * and the route implement it and nothing else restates it.
 *
 * Request: `{ gameIds: number[] }`, 1 to 100 positive integer `lcu_game_id`s, companion bearer token.
 *
 * Answer, 2xx: `{ ok: true, approved, unknown }`.
 * - `approved: true`: `unknown` is the subset of `gameIds` with no `games` row, in any order. The
 *   companion fetches a match detail for each and posts it; the others go into its local cache and are
 *   never asked about again.
 * - `approved: false`: `unknown` is always `[]`, the route sets `players.backfill_requested_at` once
 *   (a second scan does not move it), and the companion logs one sentence and stops until its next pass.
 *
 * Not approved is **either** `approved: false` **or** an HTTP 403. Any other non-2xx, a network error, or
 * a 2xx body that does not match this schema is "the scan failed": one log line and the pass comes back in
 * ten minutes with the same ids. A 404 while the route is not deployed is therefore a wait, never a refusal.
 *
 * The games themselves go to the existing `POST /api/companion/game` as the unchanged `phase: 'eog'` body
 * with `source: 'backfill'`, **no `partyId` key** and `role: null` on every participant
 * (`companionGamePayloadSchema`, `mapMatchDetail` in `@customs/lcu`). The route stores such a game without
 * rating it inline, requires the token's player among the participants with no lobby fallback (403
 * otherwise), never replaces a row it already has (it may copy `teams[].bans` onto a live
 * eog block that never stored them), and **must answer 2xx with the usual
 * `companionGameResponseSchema` fields (`created` true or false) for a stored-but-unrated game**: a 2xx is
 * what deletes the companion's queue file, and a 400/403/404/422 deletes it as a permanent refusal.
 */
export const companionBackfillScanRequestSchema = z.object({
  gameIds: z.array(z.number().int().positive()).min(1).max(BACKFILL_SCAN_BATCH_SIZE),
});

export const companionBackfillScanResponseSchema = z.object({
  ok: z.literal(true),
  approved: z.boolean(),
  unknown: z.array(z.number().int().positive()),
});

// ---------------------------------------------------------------------------
// The command queue (M4.1)
// ---------------------------------------------------------------------------

/** How often the companion asks for work while its client is up. The server may dial it with `nextPollInMs`. */
export const COMMANDS_POLL_INTERVAL_MS = 5_000;
/** Commands per poll, oldest first. The route never answers more; the companion refuses a longer page. */
export const COMMANDS_PAGE_SIZE = 10;
/** Time to live per kind, set by whoever writes the row (M4.2, M4.3). Expired rows are `failed` with `expired`. */
export const COMPANION_COMMAND_TTL_MS = {
  create_lobby: 60_000,
  invite: 5 * 60_000,
  switch_side: 3 * 60_000,
} as const satisfies Record<z.infer<typeof companionCommandKindSchema>, number>;

/**
 * `GET /api/companion/commands`, `POST /api/companion/commands/{id}/ack`, `POST /api/companion/commands/{id}/nack`
 * (M4.1). **This comment is the whole command-queue contract**; the runner (`apps/companion/src/commandRunner.ts`)
 * and the routes implement it and nothing else restates it. Companion bearer token on all three, the usual
 * `{ ok: true, ... }` / `{ ok: false, error }` envelope.
 *
 * **GET `/api/companion/commands?clientConnected=true|false`** (the query parameter is required).
 * Answer: `{ ok: true, commands: [{ id, kind, payload, createdAt, expiresAt }], nextPollInMs? }` —
 * `companionCommandsResponseSchema`. Rows are the token's player's only (`target_player_id`), status `pending`
 * or `sent`, not past `expires_at`, oldest `created_at` first, at most `COMMANDS_PAGE_SIZE` (10). There is no
 * way to ask for another player's queue. Handing a row out marks it `sent` (`sent_at`, `attempts + 1`); a `sent`
 * row is offered again after 30 s, and the fourth delivery fails it instead (`not acked after 3 deliveries`).
 * Every call, whatever `clientConnected` says, first sweeps expired rows to `failed` / `error = 'expired'`.
 * `clientConnected=false` then answers `{ ok: true, commands: [] }` and **moves nothing else** — no `sent`, no
 * `attempts`, no `last_seen_at` — so `last_seen_at` means "at their PC with League open". `nextPollInMs` is
 * optional; absent means `COMMANDS_POLL_INTERVAL_MS`.
 *
 * `payload` per kind (`companionCommandPayloadSchemas`):
 * - `create_lobby`: `{ lobbyName: string(1..30), lobbyPassword: string(4..16) }`
 * - `invite`: `{ puuid, summonerId: string | null }` (digits; null when the server has none)
 * - `switch_side`: `{ targetSide: 100 | 200 }`
 * The companion applies the kind's schema itself and nacks `malformed_payload` for a kind it does not know or
 * a payload that does not parse, so one bad row never blocks a page.
 *
 * **POST `/api/companion/commands/{id}/ack`**, body `{ result }` (`companionCommandAckRequestSchema`), where
 * `result` matches the kind's result schema (`companionCommandResultSchemas`):
 * - `create_lobby`: `{ partyId, lobbyName }`
 * - `invite`: `{ puuid, method: 'summonerId' | 'puuid', state: 'Pending' | 'Accepted' }`
 * - `switch_side`: `{ side: 100 | 200 }`
 * Answer `{ ok: true }`: the row is `acked`, `acked_at` set, `result` stored, and the `onAcked` hooks run
 * (M4.2 hangs the invite fan-out there). 404 for an id that does not exist **or belongs to another player**
 * (never 403: a 403 would confirm somebody else's id exists). 409 when the row is already `acked` or `failed`;
 * nothing changes. 422 when `result` fails the kind's schema; the row is left alone.
 *
 * **POST `/api/companion/commands/{id}/nack`**, body `{ error: string(1..500), retryable: boolean }`
 * (`companionCommandNackRequestSchema`). `error` is **prose, stored verbatim and not validated beyond length**:
 * the companion writes a `commandFailureReasonSchema` word first, then a detail after `: `
 * (`already_in_lobby: partyId=...`, `client_rejected: 404 LOBBY_NOT_FOUND`, `wrong_phase: ChampSelect`), never
 * a body, and a page that wants the reason takes the text up to the first `:`; the route must not reject a
 * prefix it does not know (an older exe may be running). Answer `{ ok: true }`.
 * - `retryable: false`: the row is `failed`, `acked_at = now()`, `error` stored, `result` null, hooks run.
 * - `retryable: true`: **nothing was executed** — the row goes back to `pending` with `attempts` unchanged and
 *   `sent_at` cleared, so it is offered again on the next poll inside its TTL and the expiry sweep is what
 *   gives up on it; `error` is stored for the log, no hook runs. The companion sends it only for
 *   `not_connected` and for a client that gave no HTTP answer before anything could have happened.
 * Same 404 and 409 as ack (a 409 on a retryable nack means the sweep already failed the row).
 *
 * The companion treats a 409 on either as "already recorded" (a lost ack re-sent after a restart), a 404 as
 * "nothing more to do", and any other failure as "try the ack again on the next poll" from its local
 * `commands-done.json` record, without a second client call.
 */
export const commandFailureReasonSchema = z.enum([
  'not_connected',
  'wrong_phase',
  'no_lobby',
  'not_custom_lobby',
  'already_in_lobby',
  'not_on_a_team',
  'side_full',
  'endpoint_unverified',
  'client_rejected',
  'expired',
  'malformed_payload',
]);

export const createLobbyCommandPayloadSchema = z.object({
  lobbyName: z.string().trim().min(1).max(30),
  lobbyPassword: z.string().min(4).max(16),
});

export const inviteCommandPayloadSchema = z.object({
  puuid: puuidSchema,
  summonerId: z.string().regex(/^\d+$/).nullable(),
});

export const switchSideCommandPayloadSchema = z.object({
  targetSide: sideSchema,
});

export const companionCommandPayloadSchemas = {
  create_lobby: createLobbyCommandPayloadSchema,
  invite: inviteCommandPayloadSchema,
  switch_side: switchSideCommandPayloadSchema,
} as const;

export const createLobbyCommandResultSchema = z.object({
  partyId: z.string().min(1),
  lobbyName: z.string(),
});

export const inviteCommandResultSchema = z.object({
  puuid: puuidSchema,
  method: z.enum(['summonerId', 'puuid']),
  state: z.enum(['Pending', 'Accepted']),
});

export const switchSideCommandResultSchema = z.object({
  side: sideSchema,
});

export const companionCommandResultSchemas = {
  create_lobby: createLobbyCommandResultSchema,
  invite: inviteCommandResultSchema,
  switch_side: switchSideCommandResultSchema,
} as const;

/**
 * One command as the writer creates it and the server stores it: the kind decides the payload. The poll
 * response below is deliberately looser (`kind: string`, `payload: object`) so the companion can nack a kind
 * it does not know instead of dropping the whole page.
 */
export const companionCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create_lobby'), payload: createLobbyCommandPayloadSchema }),
  z.object({ kind: z.literal('invite'), payload: inviteCommandPayloadSchema }),
  z.object({ kind: z.literal('switch_side'), payload: switchSideCommandPayloadSchema }),
]);

export const companionCommandEnvelopeSchema = z.object({
  id: z.uuid(),
  kind: z.string().min(1),
  payload: jsonObjectSchema,
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
});

/**
 * The poll's query string, which is a boundary like any other body: `clientConnected` is
 * **required** and is one of the two words. A missing or misspelt one is a 400 rather than a
 * default, because the two answers differ in what they write — `true` hands out work and
 * touches `last_seen_at`, `false` moves nothing at all — and guessing wrong drains a queue
 * into a client that is not there. The companion builds the string by hand
 * (`?clientConnected=true|false`); this is what the route parses it with.
 */
export const companionCommandsQuerySchema = z.object({
  clientConnected: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

export const companionCommandsResponseSchema = z.object({
  ok: z.literal(true),
  commands: z.array(companionCommandEnvelopeSchema).max(COMMANDS_PAGE_SIZE),
  nextPollInMs: z.number().int().positive().optional(),
});

export const companionCommandAckRequestSchema = z.object({
  result: jsonObjectSchema,
});

export const companionCommandNackRequestSchema = z.object({
  error: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
});

export const companionCommandAckResponseSchema = z.object({
  ok: z.literal(true),
});

export type CommandFailureReason = z.infer<typeof commandFailureReasonSchema>;
export type CreateLobbyCommandPayload = z.infer<typeof createLobbyCommandPayloadSchema>;
export type InviteCommandPayload = z.infer<typeof inviteCommandPayloadSchema>;
export type SwitchSideCommandPayload = z.infer<typeof switchSideCommandPayloadSchema>;
export type CreateLobbyCommandResult = z.infer<typeof createLobbyCommandResultSchema>;
export type InviteCommandResult = z.infer<typeof inviteCommandResultSchema>;
export type SwitchSideCommandResult = z.infer<typeof switchSideCommandResultSchema>;
export type CompanionCommand = z.infer<typeof companionCommandSchema>;
export type CompanionCommandEnvelope = z.infer<typeof companionCommandEnvelopeSchema>;
export type CompanionCommandsResponse = z.infer<typeof companionCommandsResponseSchema>;
export type CompanionCommandsQuery = z.infer<typeof companionCommandsQuerySchema>;
export type CompanionCommandAckRequest = z.infer<typeof companionCommandAckRequestSchema>;
export type CompanionCommandNackRequest = z.infer<typeof companionCommandNackRequestSchema>;
export type CompanionCommandAckResponse = z.infer<typeof companionCommandAckResponseSchema>;

export type CompanionErrorResponse = z.infer<typeof companionErrorResponseSchema>;
export type CompanionBackfillScanRequest = z.infer<typeof companionBackfillScanRequestSchema>;
export type CompanionBackfillScanResponse = z.infer<typeof companionBackfillScanResponseSchema>;
export type CompanionMeResponse = z.infer<typeof companionMeResponseSchema>;
export type CompanionLobbyResponse = z.infer<typeof companionLobbyResponseSchema>;
export type CompanionGameResponse = z.infer<typeof companionGameResponseSchema>;
export type CompanionRankResponse = z.infer<typeof companionRankResponseSchema>;
