import { companionBackfillScanRequestSchema, companionBackfillScanResponseSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonOk } from '@/lib/http';
import { selectUnknownGameIds } from '@/lib/ingest/backfill';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/companion/backfill/scan` (M5.1): "which of these games do you already have, and
 * may I send the rest?"
 *
 * One round trip answers both, which is what keeps the walker off the client's back: an id we
 * already have is never worth a `GET /lol-match-history/v1/games/{gameId}`, and the detail
 * fetch is the expensive part of a backfill pass.
 *
 * **The contract is the doc comment on `companionBackfillScanRequestSchema`**
 * (`packages/db/src/schemas/companionResponses.ts`) and is deliberately not restated here.
 *
 * **There is no approval step** (`04-decisions.md`, 2026-10-03, reversing M5.1's gate): any
 * valid token whose player is a member of its group gets the answer. The body still carries
 * `approved: true` — always true now — because companions already shipped parse it.
 *
 * `unknown` is still "no `games` row anywhere": an id another group already stored is the usual
 * no-op and is not offered. A game that is offered and turns out not to be this group's (fewer
 * than six members) is skipped by the game route and, since nothing was stored, offered again
 * by the next scan.
 *
 * This route writes nothing. The games themselves go to `POST /api/companion/game` with
 * `source: 'backfill'`, which stores them and does not rate them: `pnpm --filter web
 * rebuild-ratings` (M5.2) is what turns a batch into ratings.
 */
export const POST = withCompanionAuth(companionBackfillScanRequestSchema, async (payload, { client }) => {
  const unknown = await selectUnknownGameIds(client, payload.gameIds);
  return jsonOk(companionBackfillScanResponseSchema, { ok: true, approved: true, unknown });
});
