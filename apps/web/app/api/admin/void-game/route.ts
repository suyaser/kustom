import { gameVoidRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A void or a restore rebuilds the group's ratings in the request (the rebuild cron's ceiling). */
export const maxDuration = 60;

/** An admin's `Void game` / `Restore` on the game page (M23.1). See `handler.ts`. */
export const POST = gameVoidRoute();
