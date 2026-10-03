import { myGroupsRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The session's groups with its role in each (M13.5). 401 without a session. */
export const GET = myGroupsRoute();
