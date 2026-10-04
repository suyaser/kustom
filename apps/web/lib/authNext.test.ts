import { describe, expect, it } from 'vitest';
import { DEFAULT_NEXT_PATH, nextCookieOptions, nextUrl, safeNextPath } from './authNext';

/**
 * The redirect target of the sign-in round trip (M1.11).
 *
 * Everything here is about one rule: the only place a signed-in admin may be sent is a page on
 * this site. The cookie carrying it is ours, but it is still a value that comes back from a
 * browser, so it is validated on the way out as if it were not.
 */

describe('the default destination (M14.23 review)', () => {
  it('is the group-neutral landing, never the bare /admin', () => {
    expect(DEFAULT_NEXT_PATH).toBe('/');
    expect(nextUrl(null, 'https://kustom.example').toString()).toBe('https://kustom.example/');
  });
});

describe('safeNextPath', () => {
  it('accepts a path on this site', () => {
    for (const value of ['/admin', '/admin/tokens', '/admin/players?q=1', '/', '/admin#top']) {
      expect(safeNextPath(value)).toBe(value);
    }
  });

  it('rejects anything that could leave this origin', () => {
    for (const value of [
      'https://example.com/x',
      'http://example.com/x',
      '//example.com/x',
      '/\\example.com/x',
      'admin',
      'javascript:alert(1)',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(safeNextPath(value)).toBeNull();
    }
  });

  it('rejects a header-splitting attempt and an absurdly long value', () => {
    expect(safeNextPath('/admin\r\nSet-Cookie: x=1')).toBeNull();
    expect(safeNextPath(`/admin/${'a'.repeat(600)}`)).toBeNull();
  });
});

describe('nextUrl', () => {
  const origin = 'https://playkustom.com';

  it('resolves a valid path against the site origin', () => {
    expect(nextUrl('/admin/tokens', origin).toString()).toBe(`${origin}/admin/tokens`);
  });

  it('falls back to /admin for a foreign, absent or malformed destination', () => {
    for (const value of ['https://example.com/x', '//example.com/x', 'nope', null, undefined]) {
      expect(nextUrl(value, origin).toString()).toBe(`${origin}${DEFAULT_NEXT_PATH}`);
    }
  });

  it('never returns another origin, whatever it is handed', () => {
    for (const value of ['/admin', 'https://example.com', '/\\example.com']) {
      expect(nextUrl(value, origin).origin).toBe(origin);
    }
  });
});

describe('nextCookieOptions', () => {
  it('is HttpOnly, same-site, scoped to the callback and short-lived', () => {
    expect(nextCookieOptions('https://playkustom.com')).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/auth/callback',
      maxAge: 600,
    });
  });

  it('drops Secure only for a plain-http origin, which is `next dev`', () => {
    expect(nextCookieOptions('http://localhost:3000').secure).toBe(false);
    expect(nextCookieOptions('https://localhost:3000').secure).toBe(true);
  });
});
