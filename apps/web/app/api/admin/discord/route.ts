import { adminDiscordRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The admin Discord page's state (M14.20). Read gate: group admins, and the operator read-only. Never the webhook. */
export const GET = adminDiscordRoute();
