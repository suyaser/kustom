import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { mintCompanionToken } from '../companionAuth';
import type { ServiceClient } from '../supabase';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * Reads and writes behind `/admin/tokens`, the button that replaces
 * `pnpm --filter web mint-token` (M1.5).
 *
 * Minting goes through `mintCompanionToken()` so the admin page and the companion auth path
 * cannot disagree about how a token is hashed. The raw token exists for exactly the length of
 * {@link mintTokenForPlayer}'s return value; only the SHA-256 hash is stored.
 */

export interface AdminTokenRow {
  id: string;
  playerId: string;
  puuid: string;
  /** The three fields `playerLabel` needs: the page must never print a bare PUUID (M1.7). */
  displayName: string | null;
  gameName: string | null;
  tagLine: string | null;
  label: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  /** Set means revoked. The row is never deleted (`docs/04-decisions.md`). */
  revokedAt: string | null;
}

export async function listAdminTokens(client: ServiceClient): Promise<AdminTokenRow[]> {
  const { data, error } = await client
    .from('companion_tokens')
    .select(
      'id, player_id, label, created_at, last_seen_at, revoked_at, players!inner(puuid, display_name, game_name, tag_line)',
    )
    .order('created_at', { ascending: false });

  if (error) throw new Error(`listAdminTokens failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    playerId: row.player_id,
    puuid: row.players.puuid,
    displayName: row.players.display_name,
    gameName: row.players.game_name,
    tagLine: row.players.tag_line,
    label: row.label,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }));
}

export interface MintedToken {
  tokenId: string;
  playerId: string;
  puuid: string;
  label: string | null;
  /** Shown once, on the response page, and never stored. */
  token: string;
}

export interface MintTokenInput {
  playerId: string;
  label: string | null;
  /**
   * The group the token posts to (M13.3). The original group until `/api/admin/tokens` carries
   * the request's group (M13.4). Inserting the token makes its player a member of the group if
   * they were not (`0019`'s `companion_tokens_add_membership`), because a token whose player is
   * not a member is refused.
   */
  groupId?: string;
}

export async function mintTokenForPlayer(
  client: ServiceClient,
  input: MintTokenInput,
): Promise<AdminWriteResult<MintedToken>> {
  const { data: player, error: playerError } = await client
    .from('players')
    .select('id, puuid')
    .eq('id', input.playerId)
    .maybeSingle();
  if (playerError) throw new Error(`mintTokenForPlayer lookup failed: ${playerError.message}`);
  if (player === null) return writeFailed(404, 'no such player');

  const { token, tokenHash } = mintCompanionToken();
  const { data, error } = await client
    .from('companion_tokens')
    .insert({
      player_id: player.id,
      token_hash: tokenHash,
      label: input.label,
      group_id: input.groupId ?? ORIGINAL_GROUP_ID,
    })
    .select('id, label')
    .single();

  if (error) throw new Error(`mintTokenForPlayer insert failed: ${error.message}`);

  return writeOk({
    tokenId: data.id,
    playerId: player.id,
    puuid: player.puuid,
    label: data.label,
    token,
  });
}

/**
 * Revoking is a timestamp, never a delete: the auth path filters on `revoked_at` and
 * `last_seen_at` stays as the audit trail of a token that may have leaked. Revoking an already
 * revoked token keeps the original timestamp, so the button is idempotent.
 */
export async function revokeToken(
  client: ServiceClient,
  tokenId: string,
  now: Date = new Date(),
): Promise<AdminWriteResult<{ tokenId: string; revokedAt: string }>> {
  const { data: existing, error: readError } = await client
    .from('companion_tokens')
    .select('id, revoked_at')
    .eq('id', tokenId)
    .maybeSingle();
  if (readError) throw new Error(`revokeToken lookup failed: ${readError.message}`);
  if (existing === null) return writeFailed(404, 'no such token');
  if (existing.revoked_at !== null) {
    return writeOk({ tokenId: existing.id, revokedAt: existing.revoked_at });
  }

  const { data, error } = await client
    .from('companion_tokens')
    .update({ revoked_at: now.toISOString() })
    .eq('id', tokenId)
    .select('id, revoked_at')
    .single();

  if (error) throw new Error(`revokeToken failed: ${error.message}`);
  if (data.revoked_at === null) throw new Error('revokeToken: revoked_at was not written');

  return writeOk({ tokenId: data.id, revokedAt: data.revoked_at });
}
