import { describe, expect, it, vi } from 'vitest';
import type { PageGroup } from '../groups/pageGroup';
import type { SessionPlayer } from '../viewer';
import { decideLanding, type LandingDeps } from './decide';

/**
 * M14.24 acceptance 1: the four `/` cases, and `/about` never redirecting. Replaces M13.9's
 * "signed out -> `/g/customs`" and "no group -> `/new`" rules (decision row, M14.24).
 */

const THURSDAY: PageGroup = { id: 'g2', slug: 'thursday-flex', name: 'Thursday Flex' };
const linked: SessionPlayer = { kind: 'linked', playerId: 'p1', puuid: 'puuid-1' };

function deps(over: Partial<LandingDeps> = {}): LandingDeps {
  return {
    session: { kind: 'anonymous' },
    cookieSlug: undefined,
    memberships: async () => [],
    groupBySlug: async (slug) => (slug === THURSDAY.slug ? THURSDAY : null),
    ...over,
  };
}

describe('/ for each kind of visitor', () => {
  it('sends a signed-in member to their group (307 by the page)', async () => {
    const decision = await decideLanding(
      'root',
      deps({
        session: linked,
        cookieSlug: 'thursday-flex',
        memberships: async () => [{ slug: 'customs' }, { slug: 'thursday-flex' }],
      }),
    );
    expect(decision).toEqual({ kind: 'redirect', to: '/g/thursday-flex' });
  });

  it('shows the landing page to a signed-in visitor in no group, with no back bar', async () => {
    expect(await decideLanding('root', deps({ session: linked, cookieSlug: 'thursday-flex' }))).toEqual({
      kind: 'landing',
      audience: 'signed-in',
      back: null,
    });
    // A Discord session with no player row is in no group, without a query.
    const memberships = vi.fn(async () => [{ slug: 'customs' }]);
    expect(await decideLanding('root', deps({ session: { kind: 'unlinked' }, memberships }))).toMatchObject({
      kind: 'landing',
      audience: 'signed-in',
    });
    expect(memberships).not.toHaveBeenCalled();
  });

  it('shows the landing page and `Back to <Group>` to a signed-out visitor with the cookie', async () => {
    expect(await decideLanding('root', deps({ cookieSlug: 'thursday-flex' }))).toEqual({
      kind: 'landing',
      audience: 'signed-out',
      back: THURSDAY,
    });
  });

  it('shows the plain landing page to a signed-out visitor with no cookie, or a cookie naming no group', async () => {
    const plain = { kind: 'landing', audience: 'signed-out', back: null };
    expect(await decideLanding('root', deps())).toEqual(plain);
    expect(await decideLanding('root', deps({ cookieSlug: 'gone' }))).toEqual(plain);
  });

  it('keeps a signed-in visitor on the landing page when their memberships cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const decision = await decideLanding(
      'root',
      deps({
        session: linked,
        memberships: async () => {
          throw new Error('down');
        },
      }),
    );
    expect(decision).toMatchObject({ kind: 'landing', audience: 'signed-in' });
  });
});

describe('/about', () => {
  it('never redirects, and shows a member the way back to the group they came from', async () => {
    const decision = await decideLanding(
      'about',
      deps({
        session: linked,
        cookieSlug: 'thursday-flex',
        memberships: async () => [{ slug: 'thursday-flex' }],
      }),
    );
    expect(decision).toEqual({ kind: 'landing', audience: 'signed-in', back: THURSDAY });
  });
});
