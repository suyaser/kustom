import { hideAiLineRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** An admin's `Hide` on an AI line (M16.4). See `handler.ts`. */
export const POST = hideAiLineRoute();
