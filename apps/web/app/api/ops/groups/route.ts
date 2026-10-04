import { opsGroupsRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Every group, for the operator's `/ops` table (M14.19). 403 unless the session is on `SUPER_ADMIN_USER_IDS`. */
export const GET = opsGroupsRoute();
