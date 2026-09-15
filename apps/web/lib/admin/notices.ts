/**
 * What `/admin` says **beside the control that was pressed**, when JavaScript is running
 * (M3.20).
 *
 * The route handlers under `app/api/admin/*` are the API and are untouched by this task. They
 * answer a browser form post with a 303 carrying `?notice=`, and a JSON caller with the
 * envelope — which has no sentence in it. So the sentence for the in-place path is composed
 * here, from what was submitted and from the response the route sent back.
 *
 * That is a second copy of a string, and the way it is kept honest is `notices.test.ts`: it
 * reads the handler sources and fails if a sentence here is not in the handler that owns it.
 * Refusals are **not** duplicated — a refused write answers `{ ok: false, error }` and the
 * page prints the route's own words.
 */

import { startLobbyResponseSchema } from '@/app/api/me/lobbies/start/schema';
import { openingOnPcLine } from '../lobbyStart';

export type AdminFormKind = 'players' | 'tokens' | 'discord' | 'reroll' | 'lobby-start';

/** What a form posted: every value is a string, exactly as the no-JS form post sends it. */
export type SubmittedValues = Record<string, string>;

export function adminNotice(kind: AdminFormKind, values: SubmittedValues, body: unknown): string {
  switch (kind) {
    case 'players':
      return playersNotice(values);
    case 'tokens':
      return values.action === 'revoke' ? 'token revoked' : 'token minted';
    case 'discord':
      return 'Discord config saved';
    case 'reroll':
      return rerollNotice(body);
    case 'lobby-start':
      return lobbyStartNotice(body);
  }
}

/**
 * `app/api/me/lobbies/start/handler.ts` — and **not a second copy of the sentence** (M4.2, moved
 * off the admin class by M4.13).
 *
 * The pending line is `openingOnPcLine`, which the handler itself calls, so the two surfaces
 * compose one function with one argument rather than spelling one string twice. The argument
 * is the host from the route's own answer, already through the admin name chain.
 */
function lobbyStartNotice(body: unknown): string {
  // Through the route's **own** response schema, not a hand-read of two fields (the reviewer,
  // 2026-09-10): one shape, validated at both ends of the wire.
  const answer = startLobbyResponseSchema.safeParse(body);
  return answer.success
    ? openingOnPcLine(answer.data.host.name)
    : // A 200 in a shape the schema does not allow. The row is written either way, and the
      // page re-reads it a moment later.
      'the lobby is being opened';
}

/** `app/api/admin/players/handler.ts`, `noticeFor`. */
function playersNotice(values: SubmittedValues): string {
  const cleared = (value: string | undefined): boolean => (value ?? '').trim().length === 0;

  // No `set-roles` (M5.17): that action answers 410 and the page prints the route's own
  // sentence, the way every refusal on this page does.
  switch (values.action) {
    case 'set-name':
      return cleared(values.displayName)
        ? 'name cleared: it follows the Riot ID again'
        : `name saved: ${values.displayName}`;
    case 'set-discord':
      return cleared(values.discordId) ? 'Discord id cleared' : 'Discord id linked';
    case 'set-admin':
      return values.isAdmin === 'true' ? 'admin granted' : 'admin removed';
    case 'set-backfill':
      return values.approved === 'true'
        ? 'backfill allowed. Backfilled games are not rated until the ratings are rebuilt.'
        : 'backfill revoked';
    default:
      return 'saved';
  }
}

/** `app/api/admin/lobbies/[lobbyId]/reroll/handler.ts`, `notice`. */
function rerollNotice(body: unknown): string {
  const rank = readNumber(body, 'rank');
  const splitCount = readNumber(body, 'splitCount');
  const promoted = readField(body, 'promoted');
  const post = readField(body, 'post');
  if (rank === null || splitCount === null) return 'the teams stand';

  if (promoted !== true) return `Split ${rank} was already the one on the board. Nothing was posted.`;

  const rerolls = Math.max(splitCount - 1, rank - 1);
  const which =
    rank === 1 ? 'Split 1 is back on the board.' : `Split ${rank} is up: reroll ${rank - 1} of ${rerolls}.`;

  switch (post) {
    case 'posted':
      return `${which} Posted to Discord.`;
    case 'skipped':
      return `${which} No webhook is configured, so nothing was posted.`;
    default:
      return `${which} Discord did not take the post, but the teams stand.`;
  }
}

/**
 * The refusal, in the route's own words. Every admin route answers `{ ok: false, error }`
 * (`lib/http.ts`), so nothing here invents a sentence for a rule it does not own.
 */
export function adminError(body: unknown, fallback: string): string {
  const error = readField(body, 'error');
  return typeof error === 'string' && error.length > 0 ? error : fallback;
}

/** The raw companion token, which exists in this one response and nowhere else (M1.5). */
export function mintedToken(body: unknown): string | null {
  const token = readField(body, 'token');
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function readField(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)[key];
}

function readNumber(body: unknown, key: string): number | null {
  const value = readField(body, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
