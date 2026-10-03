import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { idSchema, nullableTextSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/tokens`: mint a companion token for a player, or revoke one.
 *
 * The raw token is in the mint response and nowhere else — `companion_tokens` stores only its
 * SHA-256 hash — so a JSON caller must keep what it is given, and the browser gets the
 * one-time page in `handler.ts`.
 *
 * Both variants name their group (M13.4): a mint is for a member of it and posts to it, a revoke
 * is of one of its tokens. Anything outside it is a 404.
 */

export const mintTokenRequestSchema = z.object({
  action: z.literal('mint'),
  groupId: groupIdSchema,
  playerId: idSchema,
  /** What this token is for ("bilal's desktop"). Optional. */
  label: nullableTextSchema,
});

export const revokeTokenRequestSchema = z.object({
  action: z.literal('revoke'),
  groupId: groupIdSchema,
  tokenId: idSchema,
});

export const adminTokensRequestSchema = z.discriminatedUnion('action', [
  mintTokenRequestSchema,
  revokeTokenRequestSchema,
]);

export type AdminTokensRequest = z.infer<typeof adminTokensRequestSchema>;

export const mintTokenResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal('mint'),
  tokenId: z.uuid(),
  playerId: z.uuid(),
  puuid: z.string().min(1),
  label: z.string().nullable(),
  /** Shown once. Not recoverable: only the hash is stored. */
  token: z.string().min(1),
});

export const revokeTokenResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal('revoke'),
  tokenId: z.uuid(),
  revokedAt: z.iso.datetime({ offset: true }),
});

export type MintTokenResponse = z.infer<typeof mintTokenResponseSchema>;
export type RevokeTokenResponse = z.infer<typeof revokeTokenResponseSchema>;
