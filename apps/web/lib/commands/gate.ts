import type { CompanionCommandKind } from '@customs/db/schemas';

/**
 * The server's half of the per-kind verification gate (`04-decisions.md`, 2026-09-09 and
 * 2026-09-10; M4.1).
 *
 * A command kind whose row in `docs/03-lcu-reference.md` is still `unverified` is disabled at
 * **both** ends: the server does not queue it and the companion answers `endpoint_unverified`
 * for it (`LOBBY_WRITE_VERIFICATION` in `packages/lcu/src/writes.ts`). Two flags rather than
 * one because companion binaries keep running for months — a stale exe must never be the
 * thing that POSTs an unverified path, and a fresh exe must never be sent work by an old
 * server that has forgotten why the flag was off.
 *
 * This file is deliberately a table of booleans and nothing else. Flipping one is the same
 * edit as writing the reference row green, and it belongs in the same commit.
 *
 * **All three rows went green on 2026-09-12, patch 16.18** (M4.1). The first run, on 16.17
 * with the community create body, got `500 INVALID_LOBBY`; 0.1.4's corrected body — built from
 * the client's own lobby dialog, top-level `queueId` equal to `mutators.id` — was accepted
 * first try, and with a real lobby to work in the invite and the side switch were exercised too
 * (200 / 200 / 204). So the queue writes rows from here on. A test that wants the old zero-row
 * behavior passes a `gate` override; it must not read the constant and hope.
 *
 * **`create_lobby` and `invite` are off since M22.11**, for a different reason: the lobby press
 * that queued the one and the fan-out that queued the other are removed (lobbies are the customs
 * hosts open). Both kinds stay in the companion contract, so a shipped Kustom still parses them;
 * the server simply never writes one.
 */
export const COMMAND_KIND_ENABLED: Readonly<Record<CompanionCommandKind, boolean>> = {
  create_lobby: false,
  invite: false,
  switch_side: true,
};

/** M4.3 reads this one by name: the auto side switch is on only when the row is green. */
export const SWITCH_SIDE_ENABLED = COMMAND_KIND_ENABLED.switch_side;

/** A per-kind override. Tests pass one; nothing in production does. */
export type CommandGate = Partial<Record<CompanionCommandKind, boolean>>;

export function isCommandKindEnabled(kind: CompanionCommandKind, gate?: CommandGate): boolean {
  return gate?.[kind] ?? COMMAND_KIND_ENABLED[kind];
}
