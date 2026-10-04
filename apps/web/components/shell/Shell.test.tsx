import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP, type PageGroup } from '@/lib/groups/pageGroup';
import { Shell } from './Shell';
import type { ShellAccount } from './TopBar';

/**
 * The 2.0 shell (M14.7, five tabs since M14.7b). Role and text queries only (acceptance 6). Both
 * renderings of the five sections are in the DOM (CSS shows one per width), so tests read the bottom bar as the first `Main`
 * nav and the top bar's as the second.
 */

const pathname = vi.hoisted(() => ({ current: '/g/customs' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const GROUP_A: PageGroup = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'thursday-flex',
  name: 'Thursday Flex',
};

function draw(
  path: string,
  { group = ORIGINAL_GROUP, isAdmin = false, account = 'anonymous' as ShellAccount } = {},
) {
  pathname.current = path;
  return render(
    <Shell group={group} isAdmin={isAdmin} account={account}>
      <p>page body</p>
    </Shell>,
  );
}

const bottomBar = () => screen.getAllByRole('navigation', { name: 'Main' })[0] as HTMLElement;
const topNav = () => screen.getAllByRole('navigation', { name: 'Main' })[1] as HTMLElement;

describe('the 2.0 shell', () => {
  it('starts with a skip link to <main>, and puts the Main nav before <main> (acceptance 2)', () => {
    draw('/g/customs');
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent('Skip to content');
    expect(links[0]).toHaveAttribute('href', '#main');

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    for (const nav of screen.getAllByRole('navigation', { name: 'Main' })) {
      expect(nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(main).getByText('page body')).toBeInTheDocument();
  });

  it('draws no h1 of its own: the page has the one h1', () => {
    draw('/g/customs');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('shows Tonight, Board, Games, Stats and You, in that order, on both bars', () => {
    draw('/g/customs');
    const names = within(bottomBar())
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual(['Tonight', 'Board', 'Games', 'Stats', 'You']);
    expect(
      within(topNav())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(names);
    expect(within(bottomBar()).getByRole('link', { name: 'Tonight' })).toHaveAttribute('href', '/g/customs');
    expect(within(bottomBar()).getByRole('link', { name: 'Stats' })).toHaveAttribute(
      'href',
      '/g/customs/stats',
    );
    expect(within(bottomBar()).getByRole('link', { name: 'You' })).toHaveAttribute('href', '/g/customs/you');
    expect(screen.queryByRole('link', { name: 'More' })).not.toBeInTheDocument();
  });

  it.each([
    ['/g/customs', 'Tonight'],
    ['/leaderboard', 'Board'],
    ['/p/puuid-hana', 'Board'],
    ['/g/customs/games/abc', 'Games'],
    ['/games', 'Games'],
    ['/g/customs/you', 'You'],
    ['/stats', 'Stats'],
    ['/fun', 'Stats'],
    ['/1v1', 'Stats'],
    ['/mystery', 'Tonight'],
  ])('marks the section of %s as current: %s', (path, current) => {
    draw(path);
    for (const nav of [bottomBar(), topNav()]) {
      const marked = within(nav)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(marked.map((link) => link.textContent)).toEqual([current]);
    }
  });

  it('marks nothing current on a path no section owns', () => {
    draw('/g/customs/zzz');
    expect(screen.queryAllByRole('link', { current: 'page' })).toHaveLength(0);
  });

  it('names the group beside the wordmark, as one link home, printed as text', () => {
    draw('/g/thursday-flex', { group: { ...GROUP_A, name: '<b>Flex</b>' } });
    const lockup = screen.getByRole('link', { name: 'KUSTOM <b>Flex</b>' });
    expect(lockup).toHaveAttribute('href', '/g/thursday-flex');
  });

  it('gives another group only the sections it has, and never leaves /g/<slug>/', () => {
    draw('/g/thursday-flex', { group: GROUP_A, isAdmin: true, account: 'signed-in' });
    expect(
      within(bottomBar())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Tonight', 'Board', 'Games', 'Stats', 'You']);
    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      const inside = href === '#main' || href === '/g/thursday-flex' || href.startsWith('/g/thursday-flex/');
      // The footer's Kustom-level pages (STRATEGY 2.5, M14.24) belong to no group, so they are no other group's.
      const kustom = ['/how', '/download', '/about'].includes(href);
      expect(inside || kustom || href.startsWith('https://'), href).toBe(true);
    }
  });

  it('shows Admin to an admin of the group only, and no Admin to a signed-out visitor', () => {
    const anonymous = draw('/g/customs');
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    anonymous.unmount();

    const member = draw('/g/customs', { account: 'signed-in' });
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    member.unmount();

    draw('/g/customs', { isAdmin: true, account: 'signed-in' });
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/g/customs/admin');
  });

  it('offers Sign in as a real form to a signed-out visitor, beside You, and no Sign in once signed in', () => {
    const anonymous = draw('/g/customs/leaderboard');
    const signIn = screen.getByRole('button', { name: 'Sign in' });
    expect(signIn.closest('form')).toHaveAttribute('action', '/auth/signin');
    expect(signIn.closest('form')).toHaveAttribute('method', 'post');
    expect(within(topNav()).getByRole('link', { name: 'You' })).toHaveAttribute('href', '/g/customs/you');
    anonymous.unmount();

    draw('/g/customs', { account: 'signed-in' });
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(within(topNav()).getByRole('link', { name: 'You' })).toHaveAttribute('href', '/g/customs/you');
  });

  it('has no theme switch in the bar: it lives on You', () => {
    draw('/g/customs');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('hides the bottom bar while a text field has focus, and brings it back after', () => {
    pathname.current = '/g/customs';
    render(
      <Shell group={ORIGINAL_GROUP} isAdmin={false} account="anonymous">
        <label>
          Search
          <input type="text" />
        </label>
        <input type="checkbox" aria-label="Tick" />
      </Shell>,
    );
    const field = screen.getByRole('textbox', { name: 'Search' });
    fireEvent.focusIn(field);
    expect(bottomBar()).toHaveAttribute('data-typing');
    fireEvent.focusOut(field);
    expect(bottomBar()).not.toHaveAttribute('data-typing');
    fireEvent.focusIn(screen.getByRole('checkbox', { name: 'Tick' }));
    expect(bottomBar()).not.toHaveAttribute('data-typing');
  });
});
