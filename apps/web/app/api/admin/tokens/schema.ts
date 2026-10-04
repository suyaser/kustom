import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { idSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/tokens`: revoke a companion token. `mint` still parses, so an old caller gets the 410
 * sentence (`MINT_GONE`, M17.12) instead of a bare validation error; anything else it carries
 * (`playerId`, `label`) is stripped and ignored. Kustom 1.0 gets its token from pairing with a code
 * (`POST /api/companion/pair`).
 *
 * Both variants name their group (M13.4): the admin gate runs on it before the handler answers. A revoke
 * of a token outside it is a 404.
 */

export const mintTokenRequestSchema = z.object({
  action: z.literal('mint'),
  groupId: groupIdSchema,
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

export const revokeTokenResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal('revoke'),
  tokenId: z.uuid(),
  revokedAt: z.iso.datetime({ offset: true }),
});

export type RevokeTokenResponse = z.infer<typeof revokeTokenResponseSchema>;
