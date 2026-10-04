import { adminGroupRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The admin home's header read (M14.19): `{ group, access, invite }`. 401 without a session, 403
 * for anyone who is neither an admin of the query's `groupId` nor on `SUPER_ADMIN_USER_IDS`.
 * Read only: this route has no POST.
 */
export const GET = adminGroupRoute();
