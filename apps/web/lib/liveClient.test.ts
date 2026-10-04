import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveClient, realtimeUrl } from './liveClient';

const URL_ = 'http://127.0.0.1:54321';
const KEY = 'anon-key-for-tests';

describe('createLiveClient (M14.44)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the socket URL the way supabase-js does', () => {
    expect(realtimeUrl(URL_)).toBe('ws://127.0.0.1:54321/realtime/v1');
    expect(realtimeUrl(`${URL_}/`)).toBe('ws://127.0.0.1:54321/realtime/v1');
    expect(realtimeUrl('https://abc.supabase.co')).toBe('wss://abc.supabase.co/realtime/v1');
  });

  it('authenticates exactly like the anon supabase-js client it replaces', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', KEY);
    const live = createLiveClient();
    const full = createClient(URL_, KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }).realtime;

    // Same socket, same apikey on it, same token on every channel join.
    expect(live.endpointURL()).toBe(full.endpointURL());
    expect(live.apiKey).toBe(KEY);
    await live.setAuth();
    await full.setAuth();
    expect(live.accessTokenValue).toBe(KEY);
    expect(live.accessTokenValue).toBe(full.accessTokenValue);
    live.disconnect();
    full.disconnect();
  });

  it('refuses to build without the public environment', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', KEY);
    expect(() => createLiveClient()).toThrow('NEXT_PUBLIC_SUPABASE_URL');
  });
});
