import { createGroupRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Create a group (M13.5). Session-gated: 401 without a session, 403 for a session with no Discord
 * identity. 201 with `{ group, role }` -- `role` is `admin` for a linked creator and `null` for
 * one who still has to pair. 400 with product's sentence per field, 409 `That link is taken.`
 */
export const POST = createGroupRoute();
