import { cookies } from 'next/headers';
import { type SessionUserLike, type SessionUserResolver, supabaseSessionUser } from '../adminAuth';
import { createAuthClient, readOnlyCookieJar } from '../supabaseAuth';
import { superAdminIds } from '../superAdmin';

/**
 * The operator gate for `/ops` and `GET /api/ops/groups` (M13.6 / M14.19): a verified session whose
 * auth user id is in `SUPER_ADMIN_USER_IDS`. Not group-scoped, so it is not the admin read gate.
 *
 * **The list is checked before the session.** Unset or empty, every caller is 403 without an auth
 * round trip, signed in or not (acceptance 2). With a list, no session is 401 and anyone not on it
 * is 403. The `/ops` page turns every refusal into a 404, so nobody else learns the page exists.
 */

export interface OperatorIdentity {
  userId: string;
  email: string | null;
}

export type OperatorAuthResult =
  | { ok: true; operator: OperatorIdentity }
  | { ok: false; status: 401 | 403; error: string };

export const OPERATOR_ONLY = 'operator only';

export async function authorizeOperator(options: {
  superAdminIds: ReadonlySet<string>;
  resolveSessionUser: SessionUserResolver;
}): Promise<OperatorAuthResult> {
  if (options.superAdminIds.size === 0) return { ok: false, status: 403, error: OPERATOR_ONLY };

  const user: SessionUserLike | null = await options.resolveSessionUser();
  if (user === null) return { ok: false, status: 401, error: 'sign in required' };
  if (!options.superAdminIds.has(user.id.toLowerCase()))
    return { ok: false, status: 403, error: OPERATOR_ONLY };

  return { ok: true, operator: { userId: user.id, email: user.email ?? null } };
}

/** For the `/ops` server component: the operator, or a refusal the page answers with `notFound()`. */
export async function currentOperator(): Promise<OperatorAuthResult> {
  const ids = superAdminIds();
  if (ids.size === 0) return { ok: false, status: 403, error: OPERATOR_ONLY };
  const store = await cookies();
  const jar = readOnlyCookieJar(store.getAll().map(({ name, value }) => ({ name, value })));
  return authorizeOperator({
    superAdminIds: ids,
    resolveSessionUser: supabaseSessionUser(createAuthClient(jar)),
  });
}
