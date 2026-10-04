import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, refreshesSession, STATIC_FILE } from '@/proxy';

/** M14.40: which requests the proxy refreshes the session on. The live behaviour is in the integration file. */
function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3114${path}`, cookie ? { headers: { cookie } } : undefined);
}

describe('refreshesSession', () => {
  it('refreshes every page that carries a Supabase auth cookie', () => {
    for (const path of [
      '/',
      '/about',
      '/ops',
      '/g/customs/you',
      '/g/customs/admin',
      '/new',
      '/join/abc',
      '/g/customs/you.rsc',
    ]) {
      expect(refreshesSession(request(path, 'sb-127-auth-token=x')), path).toBe(true);
    }
  });

  it('costs nothing without one', () => {
    expect(refreshesSession(request('/g/customs/you'))).toBe(false);
    expect(refreshesSession(request('/g/customs/you', 'kustom_group=customs'))).toBe(false);
  });

  it('leaves API routes, auth handlers, OG images and files alone', () => {
    for (const path of [
      '/api/me',
      '/api',
      '/auth/callback',
      '/og/tonight',
      '/_next/static/x.js',
      '/favicon.ico',
    ]) {
      expect(refreshesSession(request(path, 'sb-127-auth-token=x')), path).toBe(false);
    }
  });
});

describe('the matcher', () => {
  it('spells out the same static-file list the proxy checks', () => {
    expect(config.matcher[0]).toContain(`.*\\.(?:${STATIC_FILE})$`);
  });
});
