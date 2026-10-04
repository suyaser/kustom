import type { Database } from '@customs/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readPublicSupabaseEnv } from './publicEnv';

/**
 * The Supabase client the **public** pages read with: the anon key and nothing else.
 *
 * Two callers, one factory. The tonight page server-renders its first paint with this (so the
 * WhatsApp link never opens on a spinner) and the same client runs in the browser to hold the
 * Realtime subscription. Using the anon key on both sides is the point: what the page can see
 * is exactly what RLS lets an anonymous reader see, so `players.discord_id` cannot reach the
 * page by accident and acceptance check 10 ("with the anon key only, every state renders") is
 * true by construction rather than by review.
 *
 * Never `getServiceClient()` from a page. That key bypasses RLS and belongs to `app/api`.
 *
 * No session storage: this client never signs anybody in. The admin session is read separately
 * and server-side (`lib/viewer.ts`), and it decides one thing on this page — whether the reroll
 * control is drawn.
 */
export type PublicClient = SupabaseClient<Database>;

export function createPublicClient(): PublicClient {
  // zod-free (M14.44): this module can reach a browser bundle.
  const env = readPublicSupabaseEnv();

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
