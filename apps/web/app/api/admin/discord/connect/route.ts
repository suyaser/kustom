import { discordConnectRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `Connect Discord` (M14.20): 303 to Discord's consent screen with scope=webhook.incoming. Group admin only. */
export const GET = discordConnectRoute();
