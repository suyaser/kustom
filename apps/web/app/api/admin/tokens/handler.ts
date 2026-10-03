import { NextResponse } from 'next/server';
import { renderMintedTokenPage } from '@/lib/admin/tokenPage';
import { mintTokenForPlayer, revokeToken } from '@/lib/admin/tokens';
import type { AdminContext } from '@/lib/adminRoute';
import { type AdminTokensRequest, mintTokenResponseSchema, revokeTokenResponseSchema } from './schema';

/** See `app/api/admin/players/handler.ts` for why the handler is not inside `route.ts`. */
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

  const result = await mintTokenForPlayer(context.client, {
    playerId: input.playerId,
    label: input.label,
    // The request's group, already checked: the session is an admin of it (M13.4).
    groupId: context.groupId,
  });
  if (!result.ok) return context.fail(result.status, result.error);

  const minted = result.value;
  if (context.form) {
    // Not a redirect: a token in a query string would land in browser history and every proxy
    // log between here and the admin's phone. This response is the only place it exists.
    return new NextResponse(
      renderMintedTokenPage({
        token: minted.token,
        puuid: minted.puuid,
        label: minted.label,
        backTo: context.redirectTo,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store, max-age=0',
          'referrer-policy': 'no-referrer',
        },
      },
    );
  }

  return context.respond(
    mintTokenResponseSchema,
    {
      ok: true,
      action: 'mint',
      tokenId: minted.tokenId,
      playerId: minted.playerId,
      puuid: minted.puuid,
      label: minted.label,
      token: minted.token,
    },
    'token minted',
  );
}
