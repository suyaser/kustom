import 'server-only';
import { createHash, randomInt } from 'node:crypto';
import {
  type CompanionPairMode,
  type GroupSummary,
  isAtLeast,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  type PairingRequest,
  type PairingStatusResponse,
} from '@customs/db/schemas';
import { mintTokenForPlayer } from '../admin/tokens';
import type { ServiceClient } from '../supabase';
import {
  HOST_NOT_ADMIN,
  HOST_PAIRING_TOKEN_LABEL,
  hostCodeOtherAccount,
  INVITE_DEAD,
  NO_SUCH_GROUP,
  PAIRING_CODE_EXPIRED,
  PAIRING_CODE_UNKNOWN,
  PAIRING_NO_SUCH_CODE,
  PAIRING_NOT_CREATOR,
  PAIRING_PUUID_LINKED,
  pairingDiscordLinked,
} from './copy';
import { groupSummaryById } from './create';
import { groupByInviteCode } from './invites';
import { supabaseGroupRole } from './membership';
import { type GroupResult, groupFailed, groupOk } from './result';

/**
 * Pairing a Discord session to a PUUID through Kustom (M13.5; decision row 2026-10-03, "Joining
 * links a PUUID by pairing through Kustom, not by typing").
 *
 * 1. The join page (or `/new`, for an unlinked creator) asks `POST /api/me/pairing` and shows a
 *    six-character code. The row stores the code's SHA-256, the group, the session's auth user and
 *    its verified Discord id, and expires in 15 minutes.
 * 2. Kustom reads who is signed into League on that PC and sends `POST /api/companion/pair
 *    { code, puuid }`. `redeem_pairing_code` (`0021`) links the Discord id to that PUUID, adds the
 *    membership and uses the code, in one transaction.
 * 3. The page polls `GET /api/me/pairing/status` every 3 s and moves on when it reads `used`.
 *
 * There is no Riot API to resolve a typed Riot ID (hard rule), so the client on the person's own PC
 * is the only honest source of "who is this". The PUUID is never typed; the Discord account is
 * never re-linked and a PUUID is never stolen.
 *
 * The pair route has no token, so its only guard besides the code is a per-address rate limit,
 * 10 a minute (`pairing_attempt`). Six characters of a 32-letter alphabet are about a billion
 * codes, and at most a handful are live at once.
 */

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** Six characters from the alphabet, uniformly (`randomInt` is unbiased). */
export function generatePairingCode(random: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[random(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** SHA-256, hex: the only form of a pairing code the database ever holds, like a companion token. */
export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Issuing a code: POST /api/me/pairing
// ---------------------------------------------------------------------------

export interface PairingSession {
  userId: string;
  discordId: string;
}

export interface IssuedPairingCode {
  code: string;
  expiresAt: string;
  group: GroupSummary;
}

/** Postgres `unique_violation`: a fresh code's hash collided with another row's. */
const UNIQUE_VIOLATION = '23505';

/** Collisions are one in hundreds of millions; five tries is a bug long before it is bad luck. */
const ISSUE_ATTEMPTS = 5;

/** Codes this long past expiry are deleted whenever a new one is issued. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface IssueOptions {
  now?: Date;
  generate?: () => string;
}

/**
 * Who may get a code for which group: by `groupId`, the group's **creator** (the unlinked creator
 * on `/new`) or its **owner or an admin** (the admin home's `Set up your PC as host` card, M14.12);
 * by `inviteCode`, **anyone holding the live invite**. A new code for the same
 * session and group replaces the old one, so only the newest code on the page works.
 *
 * A session that is already linked may get one too: redeeming it from the same League account
 * simply adds the membership, and from another account is refused with its sentence. The page
 * offers linked visitors the one-tap join instead, so this is not a path anyone is shown.
 */
export async function issuePairingCode(
  client: ServiceClient,
  session: PairingSession,
  request: PairingRequest,
  options: IssueOptions = {},
): Promise<GroupResult<IssuedPairingCode>> {
  let group: GroupSummary;
  if ('groupId' in request) {
    const { data, error } = await client
      .from('groups')
      .select('id, slug, name, created_by')
      .eq('id', request.groupId)
      .maybeSingle();
    if (error) throw new Error(`pairing: group lookup failed: ${error.message}`);
    if (data === null) return groupFailed(404, NO_SUCH_GROUP);
    const isCreator = data.created_by !== null && data.created_by === session.userId;
    if (!isCreator && !(await sessionIsAdminOf(client, session.discordId, data.id))) {
      return groupFailed(403, PAIRING_NOT_CREATOR);
    }
    group = { id: data.id, slug: data.slug, name: data.name };
  } else {
    const found = await groupByInviteCode(client, request.inviteCode);
    if (found === null) return groupFailed(404, INVITE_DEAD);
    group = { id: found.id, slug: found.slug, name: found.name };
  }

  const now = options.now ?? new Date();
  const generate = options.generate ?? (() => generatePairingCode());
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString();

  const replaced = await client
    .from('pairing_codes')
    .delete()
    .eq('auth_user_id', session.userId)
    .eq('group_id', group.id);
  if (replaced.error) throw new Error(`pairing: replacing the old code failed: ${replaced.error.message}`);

  const pruned = await client
    .from('pairing_codes')
    .delete()
    .lt('expires_at', new Date(now.getTime() - PRUNE_AFTER_MS).toISOString());
  if (pruned.error) throw new Error(`pairing: pruning old codes failed: ${pruned.error.message}`);

  for (let attempt = 0; attempt < ISSUE_ATTEMPTS; attempt += 1) {
    const code = generate();
    const { error } = await client.from('pairing_codes').insert({
      code_hash: hashPairingCode(code),
      group_id: group.id,
      auth_user_id: session.userId,
      discord_id: session.discordId,
      created_at: now.toISOString(),
      expires_at: expiresAt,
    });
    if (error === null) return groupOk({ code, expiresAt, group });
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`pairing: issuing a code failed: ${error.message}`);
  }
  throw new Error(`pairing: ${ISSUE_ATTEMPTS} codes in a row collided`);
}

/** The player linked to a Discord account, or null when that account has not paired yet. */
async function playerByDiscordId(
  client: ServiceClient,
  discordId: string,
): Promise<{ id: string; puuid: string; name: string | null } | null> {
  const { data, error } = await client
    .from('players')
    .select('id, puuid, display_name, game_name')
    .eq('discord_id', discordId)
    .maybeSingle();
  if (error) throw new Error(`pairing: player lookup failed: ${error.message}`);
  if (data === null) return null;
  return { id: data.id, puuid: data.puuid, name: data.display_name ?? data.game_name };
}

/** Whether the Discord account's linked player is the group's owner or one of its admins. */
async function sessionIsAdminOf(client: ServiceClient, discordId: string, groupId: string): Promise<boolean> {
  const player = await playerByDiscordId(client, discordId);
  if (player === null) return false;
  return isAtLeast(await supabaseGroupRole(client)(player.id, groupId), 'admin');
}

// ---------------------------------------------------------------------------
// Polling: GET /api/me/pairing/status
// ---------------------------------------------------------------------------

/**
 * What became of a code **this session** was given. Another session's code, a replaced code and a
 * code nobody was given all read as 404: the poll is not a way to test codes.
 */
export async function pairingStatus(
  client: ServiceClient,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<GroupResult<PairingStatusResponse>> {
  const { data, error } = await client
    .from('pairing_codes')
    .select('group_id, expires_at, used_at')
    .eq('code_hash', hashPairingCode(code))
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`pairing status failed: ${error.message}`);
  if (data === null) return groupFailed(404, PAIRING_NO_SUCH_CODE);

  if (data.used_at !== null) {
    const group = await groupSummaryById(client, data.group_id);
    if (group === null) return groupFailed(404, PAIRING_NO_SUCH_CODE);
    return groupOk({ ok: true, status: 'used', group });
  }
  if (Date.parse(data.expires_at) <= now.getTime()) return groupOk({ ok: true, status: 'expired' });
  return groupOk({ ok: true, status: 'waiting', expiresAt: new Date(data.expires_at).toISOString() });
}

// ---------------------------------------------------------------------------
// Redeeming: POST /api/companion/pair
// ---------------------------------------------------------------------------

/** Attempts per address per window on the pair route (M13.5: 10 a minute). */
export const PAIR_RATE_LIMIT = 10;
export const PAIR_RATE_WINDOW_SECONDS = 60;

/**
 * The caller's address, for the rate limit only. On Vercel `x-forwarded-for` is written by the
 * platform (a client-sent value is overwritten), and its first entry is the client; `x-real-ip`
 * is the same address. Without either (a local `next dev`, a test) every caller is one bucket,
 * which is the safe direction for a limit to fail in.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  const real = request.headers.get('x-real-ip')?.trim();
  return real && real.length > 0 ? real : 'unknown';
}

/**
 * Records one attempt from `address` and answers whether it may proceed. The address is stored as
 * its SHA-256: the limit needs to recognise an address, not to know it.
 */
export async function allowPairAttempt(client: ServiceClient, address: string): Promise<boolean> {
  const { data, error } = await client.rpc('pairing_attempt', {
    p_ip_hash: createHash('sha256').update(address, 'utf8').digest('hex'),
    p_limit: PAIR_RATE_LIMIT,
    p_window_seconds: PAIR_RATE_WINDOW_SECONDS,
  });
  if (error) throw new Error(`pairing rate limit failed: ${error.message}`);
  return data === true;
}

const REDEEM_OUTCOMES = ['ok', 'unknown', 'expired', 'discord_linked', 'puuid_linked'] as const;
type RedeemOutcome = (typeof REDEEM_OUTCOMES)[number];

function isRedeemOutcome(value: unknown): value is RedeemOutcome {
  return typeof value === 'string' && (REDEEM_OUTCOMES as readonly string[]).includes(value);
}

/** What a redemption gives Kustom: the group, and in host mode a token or the reason there is none. */
export interface RedeemedPairing {
  group: GroupSummary;
  /** Host mode, an owner or admin pairing their own League account: shown once, stored only hashed. */
  companionToken?: string;
  /** Host mode, a member: linked and joined, but no token, and this is why. */
  hostRefusal?: string;
}

/** The code's row: whose session it was given to, for which group. Read after the SQL function. */
async function pairingCodeRow(
  client: ServiceClient,
  code: string,
): Promise<{ groupId: string; discordId: string } | null> {
  const { data, error } = await client
    .from('pairing_codes')
    .select('group_id, discord_id')
    .eq('code_hash', hashPairingCode(code))
    .maybeSingle();
  if (error) throw new Error(`pairing: code lookup failed: ${error.message}`);
  return data === null ? null : { groupId: data.group_id, discordId: data.discord_id };
}

/**
 * The whole redemption after the rate limit: `redeem_pairing_code` decides and writes; this maps
 * its answer to the status and the sentence Kustom prints verbatim. A refusal writes nothing and
 * leaves the code usable.
 *
 * **Host mode** (M14.12, decision row 2026-10-03) changes nothing about the linking -- the SQL
 * function runs exactly as in overlay mode, never re-linking and never stealing -- and adds one
 * step after it:
 *
 * - linked, the code's session is the group's owner or an admin, and the PUUID is that session's
 *   linked player: a host token for that PUUID in that group, through the same `mintTokenForPlayer`
 *   the Hosts page uses (32 random bytes, SHA-256 at rest, the raw value only in the return value);
 * - linked, but a member: no token, {@link HOST_NOT_ADMIN};
 * - refused because the code's Discord is linked to another PUUID, and that Discord's player is the
 *   group's owner or an admin: the same 409 with {@link hostCodeOtherAccount} instead of M13.5's
 *   sentence. A code typed on a friend's PC never mints the friend a token.
 *
 * The role is read after the SQL function commits, so an unlinked creator's first pairing (which
 * makes them the owner) mints too. The mint is a second write, outside the function's transaction:
 * if it fails the person is still linked and the route answers 500; a new code retries it.
 */
export async function redeemPairingCode(
  client: ServiceClient,
  code: string,
  puuid: string,
  mode: CompanionPairMode = 'overlay',
): Promise<GroupResult<RedeemedPairing>> {
  const { data, error } = await client.rpc('redeem_pairing_code', {
    p_code_hash: hashPairingCode(code),
    p_puuid: puuid,
  });
  if (error) throw new Error(`pairing redeem failed: ${error.message}`);
  const row = data?.[0];
  if (row === undefined || !isRedeemOutcome(row.outcome)) {
    throw new Error(`pairing redeem: unexpected answer ${JSON.stringify(data)}`);
  }

  switch (row.outcome) {
    case 'unknown':
      return groupFailed(404, PAIRING_CODE_UNKNOWN);
    case 'expired':
      return groupFailed(410, PAIRING_CODE_EXPIRED);
    case 'discord_linked': {
      const linkedName = (row.linked_name as string | null) ?? null;
      if (mode === 'host') {
        const codeRow = await pairingCodeRow(client, code);
        if (codeRow !== null && (await sessionIsAdminOf(client, codeRow.discordId, codeRow.groupId))) {
          return groupFailed(409, hostCodeOtherAccount(linkedName));
        }
      }
      return groupFailed(409, pairingDiscordLinked(linkedName));
    }
    case 'puuid_linked':
      return groupFailed(409, PAIRING_PUUID_LINKED);
    case 'ok': {
      const group = await groupSummaryById(client, row.group_id);
      if (group === null) throw new Error('pairing redeem: the group is not readable');
      if (mode !== 'host') return groupOk({ group });
      return groupOk(await hostStep(client, code, puuid, group));
    }
  }
}

/** Host mode after a successful link: mint for an owner or admin on their own account, else say why not. */
async function hostStep(
  client: ServiceClient,
  code: string,
  puuid: string,
  group: GroupSummary,
): Promise<RedeemedPairing> {
  const codeRow = await pairingCodeRow(client, code);
  if (codeRow === null) throw new Error('pairing redeem: the used code is not readable');
  const player = await playerByDiscordId(client, codeRow.discordId);
  // The SQL function just linked this Discord account to this PUUID or found it linked already, so a
  // mismatch is a bug; checked anyway, because it is the one rule that decides who gets a token.
  if (player === null || player.puuid !== puuid) {
    throw new Error('pairing redeem: the linked player is not the paired PUUID');
  }
  if (!isAtLeast(await supabaseGroupRole(client)(player.id, group.id), 'admin')) {
    return { group, hostRefusal: HOST_NOT_ADMIN };
  }

  const minted = await mintTokenForPlayer(client, {
    playerId: player.id,
    label: HOST_PAIRING_TOKEN_LABEL,
    groupId: group.id,
  });
  if (!minted.ok) throw new Error(`pairing redeem: minting the host token failed (${minted.status})`);
  return { group, companionToken: minted.value.token };
}
