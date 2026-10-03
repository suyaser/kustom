import { pairingStatusRoute } from '../handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Whether this session's pairing code was used yet (M13.5). The page polls every 3 s. */
export const GET = pairingStatusRoute();
