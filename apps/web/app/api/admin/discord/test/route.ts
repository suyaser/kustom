import { discordTestRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Send the test post to the stored webhook now (M14.20, the paste fallback). Group admin, or the unlinked creator (M14.40). */
export const POST = discordTestRoute();
