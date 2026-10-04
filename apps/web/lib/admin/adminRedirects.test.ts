import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { legacyRedirects } from '../../next.config';

/** The 1.0 admin is retired; its addresses 308 to the original group's (M13.14 acceptance 5, M14.23). */
describe('the old admin addresses', () => {
  const to = (source: string) => legacyRedirects.find((row) => row.source === source);

  it('308 to the original group, page by page, and /admin/login stays a page', () => {
    expect(to('/admin')).toMatchObject({ destination: '/g/customs/admin', permanent: true });
    expect(to('/admin/players')).toMatchObject({ destination: '/g/customs/admin/members', permanent: true });
    expect(to('/admin/tokens')).toMatchObject({ destination: '/g/customs/admin/hosts', permanent: true });
    expect(to('/admin/discord')).toMatchObject({ destination: '/g/customs/admin/discord', permanent: true });
    expect(to('/admin/games')).toMatchObject({ destination: '/g/customs/admin/games', permanent: true });
    expect(to('/admin/seasons')).toMatchObject({ destination: '/g/customs/admin', permanent: true });
    expect(to('/admin/login')).toBeUndefined();
    expect(existsSync(fileURLToPath(new URL('../../app/admin/login/page.tsx', import.meta.url)))).toBe(true);
  });

  it('point at pages that exist', () => {
    for (const page of ['', '/members', '/hosts', '/discord', '/games']) {
      const file = new URL(`../../app/(group)/g/[slug]/admin${page}/page.tsx`, import.meta.url);
      expect(existsSync(fileURLToPath(file)), page).toBe(true);
    }
    expect(existsSync(fileURLToPath(new URL('../../app/admin/(dashboard)', import.meta.url)))).toBe(false);
  });
});
