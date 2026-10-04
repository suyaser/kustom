import { cookies } from 'next/headers';
import { cache } from 'react';
import { getServiceClient } from '../supabase';
import { createAuthClient, readOnlyCookieJar } from '../supabaseAuth';
import { ANONYMOUS_SESSION, type LiveSession, liveSessionResolver } from './liveSession';

/**
 * This request's resolver, or `null` with no `sb-` cookie (the common case, and it costs nothing).
 * One per request, so the token is verified once however many groups are asked about.
 */
const requestResolver = cache(
  async (): Promise<((groupId: string | null) => Promise<LiveSession>) | null> => {
    const store = await cookies();
    const jar = readOnlyCookieJar(store.getAll().map(({ name, value }) => ({ name, value })));
    if (jar.getAll().every((cookie) => !cookie.name.startsWith('sb-'))) return null;
    return liveSessionResolver(createAuthClient(jar), getServiceClient());
  },
);

/**
 * The verified live session of the request being rendered (`liveSession.ts`), for one group or
 * none. React-cached per argument, so the layout, the page and every helper that asks about the
 * same group share one `session_player` call; `currentSessionPlayer`, `currentViewerState`,
 * `currentPageSession`, `currentAdminAccess`, `currentDiscordName` and `currentOperator` all read it.
 *
 * A failed lookup **throws**: each caller already decides whether that reads as signed out (the
 * public pages) or as an error page (the pages where a false "Sign in" would loop a signed-in
 * person).
 */
export const currentLiveSession: (groupId: string | null) => Promise<LiveSession> = cache(
  async (groupId: string | null) => {
    const resolve = await requestResolver();
    return resolve === null ? ANONYMOUS_SESSION : resolve(groupId);
  },
);
