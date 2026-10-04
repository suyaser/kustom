import { discordCallbackRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Discord's OAuth callback (M14.20): verifies the state, stores the webhook, sends the test post, 303s to the page. */
export const GET = discordCallbackRoute();
