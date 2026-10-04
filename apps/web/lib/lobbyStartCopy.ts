/**
 * The friend-facing half of `lib/lobbyStart.ts` (M14.44): every sentence the tonight page and
 * `/admin` print about a press, and the one pure function that picks between them.
 *
 * **Its own file because `StartLobby` is a client component.** `lib/lobbyStart.ts` draws the
 * lobby password with `node:crypto`, and a client import of anything in it made the bundler ship
 * about 121 KB gzip of crypto polyfills to every phone that opened Tonight
 * (`redesign/quality/REPORT.md` P1). This file imports nothing, so a browser can have it;
 * `lib/lobbyStart.ts` re-exports all of it and carries `import 'server-only'`.
 */

// ---------------------------------------------------------------------------
// The words (product owns these, M4.2's brief; verbatim)
// ---------------------------------------------------------------------------

/** The control. */
export const START_LOBBY_BUTTON = 'Start a lobby';

/** A lobby of tonight is already `open`, `balanced` or `in_game`. */
export const LOBBY_ALREADY_OPEN = 'There is already a lobby open.';

/** Who to ask when nobody's Kustom is up and the hosts cannot be named (none, or more than three). */
export const WHOEVER_HOSTS = 'whoever hosts';

/**
 * Nobody's companion has been up in the last ten minutes, so there is nobody to run it (M14.66).
 * `who` is the group's hosts joined the way the strip names admins (`adminNames` in
 * `lib/tonight/copy.ts`: `Yasser`, `Yasser or Omar`, `Ali, Yasser or Omar`), or null for
 * {@link WHOEVER_HOSTS}. The 409 of `Start a lobby` and the idle line under it both print this.
 */
export function noKustomRunningLine(who: string | null): string {
  return `Nobody's Kustom is running right now. Ask ${who ?? WHOEVER_HOSTS} to open it.`;
}

/** The generic form: no host has a name to print, or more than three do. */
export const NO_COMPANION_AROUND = noKustomRunningLine(null);

/**
 * The double-tap guard: the pending row *is* the lock, so two taps produce one command.
 *
 * Two presses can say this, and they are indistinguishable from outside. The one that read the
 * pending row (`decideStart`) and the one that lost the insert to
 * `companion_commands_one_create_lobby_idx` (`0008`, M4.9) both answer 409 with this sentence.
 */
export const LOBBY_ALREADY_OPENING = 'A lobby is already being opened.';

/**
 * The refusal for a kind flagged off in `lib/commands/gate.ts` because its reference row is not
 * green. Unreachable in production since 2026-09-12 — both kinds this route needs are green — and
 * kept because the gate is one boolean away from being off again on the next patch.
 */
export const LOBBY_WRITES_UNVERIFIED = "Opening lobbies isn't verified on this patch yet.";

/** While the command is pending, on the page, naming the host that was picked. */
export function openingOnPcLine(hostName: string): string {
  return `Opening a lobby on ${hostName}'s PC…`;
}

/** The host's companion never answered and the command expired. Nothing was created. */
export const NO_CLIENT_ANSWERED = "Nobody's client answered. Try again.";

/** The host had made a lobby by hand a minute earlier (`already_in_lobby`). */
export function alreadyHasALobbyLine(hostName: string): string {
  return `${hostName} already has a lobby open — everyone can join that one.`;
}

/** Under the member list while the lobby is filling, until ten are in. */
export function invitedLine(count: number): string {
  return `Invited ${count} friend${count === 1 ? '' : 's'} — waiting for them to accept.`;
}

/** A `create_lobby` row as a page reads it: its status and, when it failed, the nack text. */
export interface CreateLobbyProgress {
  status: 'pending' | 'sent' | 'acked' | 'failed';
  /** The companion's prose (`already_in_lobby: partyId=…`) or the server's (`expired`). */
  error: string | null;
}

/**
 * What the page prints where the button was, from the row's own status. Pure, so the tonight
 * page and `/admin` cannot end up saying two different things about one command.
 *
 * - **pending / sent** — `Opening a lobby on <Name>'s PC…`, naming the host that was picked;
 * - **acked** — nothing. The member list appearing *is* the answer, and a toast on top of it is
 *   noise (product, M4.2);
 * - **failed with `already_in_lobby`** — the host made a lobby by hand a minute ago, so the
 *   group is told to join that one instead;
 * - **failed any other way** — `Nobody's client answered. Try again.` Product wrote that line
 *   for the expiry, and it is the only failure sentence there is: from the friend holding the
 *   phone, a `wrong_phase` (the host is in champion select) and a client that refused the POST
 *   are the same fact — nothing was created, press it again. Inventing a sentence per
 *   `commandFailureReasonSchema` word would put the queue's vocabulary on the tonight page.
 */
export function startLobbySentence(progress: CreateLobbyProgress | null, hostName: string): string | null {
  if (progress === null || progress.status === 'acked') return null;
  if (progress.status !== 'failed') return openingOnPcLine(hostName);
  return progress.error?.startsWith('already_in_lobby') ? alreadyHasALobbyLine(hostName) : NO_CLIENT_ANSWERED;
}
