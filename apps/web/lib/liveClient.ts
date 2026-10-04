import { RealtimeClient } from '@supabase/realtime-js';
import { readPublicSupabaseEnv } from './publicEnv';

/**
 * The tonight page's browser Realtime client (M14.44, `redesign/quality/REPORT.md` P5):
 * `@supabase/realtime-js` alone, with the anon key, instead of the whole `supabase-js`.
 *
 * Tonight's island only ever opens one channel and listens; it never reads a table, never signs
 * anybody in, never uploads. `createPublicClient()` (`lib/publicClient.ts`) brought GoTrue,
 * PostgREST, Storage and Functions into the phone's bundle to get at its `realtime` member. This
 * builds that member the way `supabase-js` 2.115 does for a client with no session
 * (`SupabaseClient._initRealtimeClient`):
 *
 * - the socket URL is `<project>/realtime/v1` with `http` swapped for `ws`;
 * - `params.apikey` is the anon key (sent on the socket URL);
 * - `accessToken` answers the anon key, which is what `supabase-js` answers with no session
 *   (`_getAccessToken` falls back to `supabaseKey`), so every channel join carries the same
 *   `access_token` as before and RLS sees the same anonymous reader.
 *
 * Reconnect and rejoin are `RealtimeClient`'s own behaviour in both cases (`supabase-js` adds
 * nothing there), so the page's `reconnecting` state and its re-read on every `SUBSCRIBED` work
 * unchanged. Server code keeps `createPublicClient()`.
 */
export function createLiveClient(): RealtimeClient {
  const env = readPublicSupabaseEnv();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return new RealtimeClient(realtimeUrl(env.NEXT_PUBLIC_SUPABASE_URL), {
    params: { apikey: anonKey },
    accessToken: () => Promise.resolve(anonKey),
  });
}

/** `http://127.0.0.1:54321` -> `ws://127.0.0.1:54321/realtime/v1`, as `supabase-js` builds it. */
export function realtimeUrl(supabaseUrl: string): string {
  const base = supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`;
  const url = new URL('realtime/v1', base);
  url.protocol = url.protocol.replace('http', 'ws');
  return url.href;
}
