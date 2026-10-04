import { companionPairRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pair the Discord session behind a code with the PUUID signed into League on this PC (M13.5).
 * No token in. 429 after 10 attempts a minute from one address; 404, 410 and 409 with the sentence
 * Kustom prints. `{ group }` on success; in host mode also `companionToken` (an owner or admin on
 * their own account, M14.12) or `hostRefusal` (a member).
 */
export const POST = companionPairRoute();
