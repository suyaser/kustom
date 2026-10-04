import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as signOut } from './signout/route';

/**
 * Sign-out's landing page (M14.7): More's `Sign out` sends the page it was on as `next`, and only a
 * path on this site is followed (the sign-in's `safeNextPath` rule). No session cookie is sent, so
 * the client signs nobody out and makes no network call.
 */

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-for-tests',
  NEXT_PUBLIC_SITE_URL: undefined,
} satisfies Record<string, string | undefined>;

const previous: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ORIGIN = 'https://playkustom.com';

function request(next?: string): Request {
  const body = new URLSearchParams();
  if (next !== undefined) body.set('next', next);
  return new Request(`${ORIGIN}/auth/signout`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('sign-out', () => {
  it('lands on the page it was sent from', async () => {
    const response = await signOut(request('/g/customs/more'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/g/customs/more`);
  });

  it('lands on the sign-in page with no next, or one that is not a path on this site', async () => {
    for (const next of [undefined, 'https://evil.example/', '//evil.example', '/\\evil.example']) {
      const response = await signOut(request(next));
      expect(response.headers.get('location'), String(next)).toBe(`${ORIGIN}/admin/login`);
    }
  });
});
