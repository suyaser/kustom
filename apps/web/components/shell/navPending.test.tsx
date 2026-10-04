import { act, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { FRAME_DELAY_MS } from './navPending';
import { Shell } from './Shell';

/**
 * Tab feedback and pending frames (05-design.md 5.9a, M19.15). `next/link` is replaced by a plain
 * anchor whose `useLinkStatus` answers from a store, so a test can hold one link's navigation
 * pending the way Next does between the tap and the commit.
 */

const pathname = vi.hoisted(() => ({ current: '/g/customs' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const linkStore = vi.hoisted(() => ({
  pending: null as string | null,
  listeners: new Set<() => void>(),
}));

vi.mock('next/link', async () => {
  const React = await import('react');
  const Href = React.createContext<string | null>(null);
  function Link({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: { href: string; children?: ReactNode; prefetch?: unknown } & Record<string, unknown>) {
    return React.createElement(
      Href.Provider,
      { value: href },
      React.createElement('a', { href, ...rest }, children),
    );
  }
  function useLinkStatus() {
    const href = React.useContext(Href);
    const pending = React.useSyncExternalStore(
      (listener) => {
        linkStore.listeners.add(listener);
        return () => linkStore.listeners.delete(listener);
      },
      () => linkStore.pending,
    );
    return { pending: href !== null && pending === href };
  }
  return { default: Link, useLinkStatus };
});

/** Next marks one link pending on the tap, and clears it on the commit or when another nav starts. */
function setPending(href: string | null) {
  act(() => {
    linkStore.pending = href;
    for (const listener of linkStore.listeners) listener();
  });
}

function draw(body: ReactNode = <p>page body</p>, { isAdmin = false } = {}) {
  return render(
    <Shell group={ORIGINAL_GROUP} isAdmin={isAdmin} account={isAdmin ? 'signed-in' : 'anonymous'}>
      {body}
    </Shell>,
  );
}

const bottomBar = () => screen.getAllByRole('navigation', { name: 'Main' })[0] as HTMLElement;
const topNav = () => screen.getAllByRole('navigation', { name: 'Main' })[1] as HTMLElement;
const tab = (name: string, nav = bottomBar()) => within(nav).getByRole('link', { name });
const frame = () => document.querySelector('[data-slot="tab-frame"]');
const pageBox = () => document.querySelector('[data-slot="page"]') as HTMLElement;

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  pathname.current = '/g/customs';
  linkStore.pending = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the pressed tab (5.9a)', () => {
  it('marks the tapped tab pending in the same commit, and leaves aria-current on the page still shown', () => {
    draw();
    setPending('/g/customs/leaderboard');
    for (const nav of [bottomBar(), topNav()]) {
      expect(tab('Board', nav)).toHaveAttribute('data-pending');
      expect(tab('Board', nav)).not.toHaveAttribute('aria-current');
      expect(tab('Tonight', nav)).toHaveAttribute('aria-current', 'page');
      expect(tab('Tonight', nav)).not.toHaveAttribute('data-pending');
    }
    // The bottom bar's pending tab draws the neutral bar, the current one keeps the amber bar.
    expect(tab('Board').className).toContain('before:bg-border-strong');
    expect(tab('Board').className).not.toContain('before:bg-primary-text');
    expect(tab('Tonight').className).toContain('before:bg-primary-text');
    // Desktop: the neutral underline on the pending link, amber on the current.
    expect(tab('Board', topNav()).className).toContain('border-border-strong');
    expect(tab('Tonight', topNav()).className).toContain('border-primary-text');
  });

  it('says nothing new: no live region, no text change on the tab', () => {
    draw();
    setPending('/g/customs/games');
    expect(tab('Games')).toHaveTextContent(/^Games$/);
    expect(document.querySelector('[aria-live]')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does nothing when the tab already on screen is tapped', () => {
    draw();
    setPending('/g/customs');
    expect(tab('Tonight')).not.toHaveAttribute('data-pending');
    advance(FRAME_DELAY_MS * 3);
    expect(frame()).toBeNull();
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
  });

  it('gives the desktop Admin link the pressed state, and never a frame', () => {
    draw(<p>page body</p>, { isAdmin: true });
    setPending('/g/customs/admin');
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('data-pending');
    advance(FRAME_DELAY_MS * 3);
    expect(frame()).toBeNull();
    expect(pageBox()).not.toHaveAttribute('hidden');
  });
});

describe('the pending frame (5.9a)', () => {
  it('does not appear under 300 ms, then replaces the page without unmounting it', () => {
    draw();
    const body = screen.getByText('page body');
    tab('Board').focus();
    setPending('/g/customs/leaderboard');

    advance(FRAME_DELAY_MS - 1);
    expect(frame()).toBeNull();
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
    expect(pageBox()).not.toHaveAttribute('hidden');

    advance(1);
    expect(frame()).toHaveAttribute('data-tab', 'board');
    expect(frame()).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(pageBox()).toHaveAttribute('hidden');
    // Hidden, not unmounted: the same node, still in the DOM.
    expect(pageBox()).toContainElement(body);
    // Focus stays on the pressed tab.
    expect(document.activeElement).toBe(tab('Board'));
    // The footer after a busy <main> is not drawn (its CSS), so a shorter landing never moves it.
    expect(document.querySelector('main[aria-busy="true"] ~ footer')?.className).toContain(
      '[main[aria-busy=true]~&]:hidden',
    );
  });

  it('goes on landing: the new page is shown, aria-busy removed, the amber bar on the new tab', () => {
    const view = draw();
    setPending('/g/customs/leaderboard');
    advance(FRAME_DELAY_MS);
    expect(frame()).not.toBeNull();

    pathname.current = '/g/customs/leaderboard';
    act(() => {
      linkStore.pending = null;
      view.rerender(
        <Shell group={ORIGINAL_GROUP} isAdmin={false} account="anonymous">
          <p>the board</p>
        </Shell>,
      );
    });
    expect(frame()).toBeNull();
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
    expect(pageBox()).not.toHaveAttribute('hidden');
    expect(screen.getByText('the board')).toBeVisible();
    expect(tab('Board')).toHaveAttribute('aria-current', 'page');
    expect(tab('Board')).not.toHaveAttribute('data-pending');
  });

  it('shows the old page again, unchanged, when the navigation is abandoned', () => {
    draw();
    const body = screen.getByText('page body');
    setPending('/g/customs/stats');
    advance(FRAME_DELAY_MS);
    expect(frame()).toHaveAttribute('data-tab', 'stats');

    setPending(null);
    expect(frame()).toBeNull();
    expect(pageBox()).not.toHaveAttribute('hidden');
    expect(screen.getByText('page body')).toBe(body);
    expect(tab('Tonight')).toHaveAttribute('aria-current', 'page');
  });

  it('gives a second tap its own 300 ms, and the frame of the tab tapped last', () => {
    draw();
    setPending('/g/customs/leaderboard');
    advance(200);
    setPending('/g/customs/games');
    advance(200);
    expect(frame()).toBeNull();
    expect(tab('Board')).not.toHaveAttribute('data-pending');
    expect(tab('Games')).toHaveAttribute('data-pending');
    advance(100);
    expect(frame()).toHaveAttribute('data-tab', 'games');
  });

  it('never shows a frame for router.refresh(): a refresh is not a link navigation', () => {
    // A refresh (Tonight's live updates) re-renders the same pathname with new server children and
    // touches no link status: nothing goes pending and the shown page stays until the new one is in.
    const view = draw(<p>game 3</p>);
    for (const line of ['game 4', 'game 5']) {
      act(() => {
        view.rerender(
          <Shell group={ORIGINAL_GROUP} isAdmin={false} account="anonymous">
            <p>{line}</p>
          </Shell>,
        );
      });
      advance(FRAME_DELAY_MS * 4);
      expect(frame()).toBeNull();
      expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
      expect(screen.getByText(line)).toBeVisible();
      expect(document.querySelector('[data-pending]')).toBeNull();
    }
  });
});
