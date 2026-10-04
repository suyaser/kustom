import type { NextResponse } from 'next/server';
import { revokeToken } from '@/lib/admin/tokens';
import { type AdminContext, type AdminRouteOptions, withAdminAuth } from '@/lib/adminRoute';
import { type AdminTokensRequest, adminTokensRequestSchema, revokeTokenResponseSchema } from './schema';

/**
 * Hand-minted host keys are gone (M17.12, shipped with Kustom 1.0): Kustom links itself with a code from the
 * admin home's `Set up your PC as host`, so `{ action: 'mint' }` is a 410 with this sentence and writes
 * nothing, JSON or form. Existing keys keep posting; `revoke` stays. [NEW COPY]
 */
export const MINT_GONE =
  "Kustom sets itself up with a code now. Open the admin home on the PC's owner's account and tap Get a code.";

/**
 * Separate from `route.ts` because a Next route file may only export HTTP verbs, and the
 * integration tests need the handler with a fake session wrapped around it (there is no way to
 * drive a real Discord OAuth flow from vitest).
 */
export async function handleAdminTokens(
  input: AdminTokensRequest,
  context: AdminContext,
): Promise<NextResponse> {
  if (input.action === 'revoke') {
    const result = await revokeToken(context.client, { tokenId: input.tokenId, groupId: context.groupId });
    if (!result.ok) return context.fail(result.status, result.error);

    return context.respond(
      revokeTokenResponseSchema,
      { ok: true, action: 'revoke', tokenId: result.value.tokenId, revokedAt: result.value.revokedAt },
      'token revoked',
    );
  }

  // `mint` (M17.12): refused after the admin gate and before any read or write, so a stale Hosts tab or
  // an old script learns where host setup lives now and no `companion_tokens` row is created.
  return context.fail(410, MINT_GONE);
}

/** The route, a form post going back to the checked group's Hosts page (M14.40). */
export function adminTokensRoute(
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(adminTokensRequestSchema, handleAdminTokens, { section: 'hosts', ...options });
}
