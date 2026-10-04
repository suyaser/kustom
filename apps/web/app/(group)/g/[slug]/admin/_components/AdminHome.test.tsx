import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { adminNav } from '@/lib/admin/adminNav';
import { deriveChecklist } from '@/lib/admin/checklist';
import { CHECKLIST_READY, CREATOR_UNLINKED_LINE } from '@/lib/admin/homeCopy';
import { ADMIN_READ_ONLY_LINE, INVITE_HIDDEN } from '@/lib/admin/readView';
import { AdminHome } from './AdminHome';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/**
 * The admin home (M14.21 acceptance 6, M14.22 acceptance 12): one h1, the way back to the group, the
 * checklist, the invite card, Tonight, Members, the host card; the operator's read-only view. Role and
 * text queries only.
 */

const GROUP = { id: '11111111-1111-4111-8111-111111111111', slug: 'friday-five', name: 'Friday Five' };
const NOW = new Date('2026-10-03T21:00:00.000Z');
const context = { now: NOW, groupLink: 'kustom.gg/g/friday-five' };
const freshChecklist = deriveChecklist(
  {
    discord: { webhookSet: false, testPostAt: null, testPostError: null },
    members: 1,
    hosts: [],
    hasGame: false,
  },
  context,
);
const URL_ = 'https://kustom.gg/join/AbCdEfGhIjKlMnOpQrStUv';

type HomeProps = Extract<ComponentProps<typeof AdminHome>, { kind: 'home' }>;

function home(overrides: Partial<HomeProps> = {}) {
  const props: HomeProps = {
    kind: 'home',
    group: GROUP,
    access: 'owner',
    checklist: freshChecklist,
    discordHref: '/g/friday-five/admin/discord',
    invite: { state: 'shown', url: URL_ },
    origin: 'https://kustom.gg',
    members: 1,
    nav: adminNav(GROUP, 'home'),
    ...overrides,
  };
  return render(<AdminHome {...props} />);
}

/** Everything a person can read or hear: the text, plus the labels, titles and placeholders. */
function renderedWords(container: HTMLElement): string {
  const attributes = [...container.querySelectorAll('[aria-label],[title],[placeholder],[alt]')].flatMap(
    (element) =>
      ['aria-label', 'title', 'placeholder', 'alt'].map((name) => element.getAttribute(name) ?? ''),
  );
  return [container.textContent ?? '', ...attributes].join(' ');
}

describe('the admin home', () => {
  it("a fresh group's owner: Admin, back to the group, the checklist with row 1 done, and the host card", () => {
    home();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Admin');
    expect(screen.getByRole('link', { name: 'Back to Friday Five' })).toHaveAttribute(
      'href',
      '/g/friday-five',
    );

    const list = screen
      .getByRole('heading', { level: 2, name: 'Get your group ready' })
      .closest('[data-slot=card]');
    const rows = within(list as HTMLElement).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Done · Group created. Your link: kustom.gg/g/friday-five');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Connect Discord' })).toHaveAttribute(
      'href',
      '/g/friday-five/admin/discord',
    );
    // M14.43: install Kustom before the invite, which partly waits on it.
    expect(
      within(rows[2] as HTMLElement).getByRole('heading', { name: 'Install Kustom on one PC' }),
    ).toBeVisible();
    expect(
      within(rows[2] as HTMLElement).getByRole('link', { name: 'Set up your PC as host' }),
    ).toHaveAttribute('href', '#host');
    expect(rows[3]).toHaveTextContent('To do · Just you so far');
    expect(within(rows[3] as HTMLElement).getByRole('link', { name: 'Get the invite link' })).toHaveAttribute(
      'href',
      '#invite',
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Set up your PC as host' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get a code' })).toBeInTheDocument();
    // M14.42 (walk gap 12): the host's step 3 never points at the member flow's `Join a group`.
    expect(screen.getByText('Get a code, then type it in Kustom.')).toBeInTheDocument();
    expect(screen.queryByText(/Join a group/)).not.toBeInTheDocument();
    expect(screen.queryByText(CREATOR_UNLINKED_LINE)).not.toBeInTheDocument();
  });

  it('admin-fresh: no Reset ratings before the first rated game (M14.75)', () => {
    home({ ratingsReset: { lastResetDay: null, hasRatedGame: false } });
    expect(screen.queryByRole('button', { name: 'Reset ratings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reset ratings' })).not.toBeInTheDocument();
  });

  it('admin-ready: Reset ratings once the group has a rated game (M14.75)', () => {
    const ready = deriveChecklist(
      {
        discord: { webhookSet: true, testPostAt: NOW.toISOString(), testPostError: null },
        members: 11,
        hosts: [{ label: 'Hana PC', account: 'Hana', lastSeenAt: NOW.toISOString() }],
        hasGame: true,
      },
      context,
    );
    home({ checklist: ready, members: 11, ratingsReset: { lastResetDay: null, hasRatedGame: true } });
    expect(screen.getByRole('button', { name: 'Reset ratings' })).toBeInTheDocument();
  });

  it('the invite card: the full link, Copy link and New link', () => {
    home();
    const card = screen
      .getByRole('heading', { level: 2, name: 'Invite your group' })
      .closest('[data-slot=card]');
    expect(within(card as HTMLElement).getByText(URL_)).toBeInTheDocument();
    expect(within(card as HTMLElement).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(within(card as HTMLElement).getByRole('button', { name: 'New link' })).toBeInTheDocument();
  });

  it('Members points where the work is, with no Tonight card (M14.55); the admin nav links Home and Members', () => {
    home({ members: 9 });
    expect(screen.queryByRole('link', { name: 'Open Tonight' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tonight' })).not.toBeInTheDocument();
    expect(screen.getByText('9 people')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See everyone' })).toHaveAttribute(
      'href',
      '/g/friday-five/admin/members',
    );
    const nav = screen.getByRole('navigation', { name: 'Admin pages' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '/g/friday-five/admin/members',
    );
  });

  it('draws no mode picker and no fearless reset (they live on Tonight only)', () => {
    const { container } = home();
    expect(container.textContent).not.toMatch(/fearless/i);
    expect(container.textContent).not.toMatch(/\bmode\b/i);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    // The only reset on the admin home is the owner's `Reset ratings` (M14.18), never a fearless one.
    expect(screen.queryAllByRole('button', { name: /reset/i }).map((button) => button.textContent)).toEqual([
      'Reset ratings',
    ]);
  });

  it('the unlinked creator: owner line, Connect Discord and New link live (M14.40), no admin nav, the host card', () => {
    home({ access: 'creator-unlinked' });
    expect(screen.getByText(CREATOR_UNLINKED_LINE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New link' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin pages' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect Discord' })).toHaveAttribute(
      'href',
      '/g/friday-five/admin/discord',
    );
    expect(screen.queryByText('After you link your League account.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get a code' })).toBeInTheDocument();
    // Still nothing that needs a membership: no Members card, no Reset ratings.
    expect(screen.queryByRole('button', { name: 'Reset ratings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See members' })).not.toBeInTheDocument();
  });

  it('the operator reads it: the read-only line, the invite masked, no write control at all', () => {
    home({ access: 'operator', invite: { state: 'hidden', message: INVITE_HIDDEN } });
    expect(screen.getByText(ADMIN_READ_ONLY_LINE)).toBeInTheDocument();
    expect(screen.getByText(INVITE_HIDDEN)).toBeInTheDocument();
    expect(screen.queryByText(URL_)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect Discord' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up your PC as host' })).not.toBeInTheDocument();
  });

  it('a ready group: the card is one line, and Get a code is no longer the primary', () => {
    const ready = deriveChecklist(
      {
        discord: { webhookSet: true, testPostAt: '2026-10-03T20:00:00.000Z', testPostError: null },
        members: 9,
        hosts: [{ label: 'Hana PC', account: null, lastSeenAt: '2026-10-03T20:00:00.000Z' }],
        hasGame: true,
      },
      context,
    );
    const { container } = home({ checklist: ready });
    expect(screen.getByRole('heading', { level: 2, name: CHECKLIST_READY })).toBeInTheDocument();
    expect(screen.queryByText('Get your group ready')).not.toBeInTheDocument();
    // M14.55: the host card folds to `Set up another PC`, closed, in a native disclosure.
    const fold = screen.getByRole('heading', { level: 2, name: 'Set up another PC' }).closest('details');
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute('open');
    expect(fold?.querySelector('summary')).toHaveTextContent('Set up another PC');
    expect(screen.queryByRole('heading', { name: 'Set up your PC as host' })).not.toBeInTheDocument();
    // The order after the fold: the ready line, invite, members, the host fold, reset.
    const order = [...container.querySelectorAll('h2')].map((heading) => heading.textContent);
    expect(order).toEqual([
      CHECKLIST_READY,
      'Invite your group',
      'Members',
      'Set up another PC',
      'Reset ratings',
    ]);
  });

  it('a ready Premium group puts Kustom Premium after Members and before the host fold', () => {
    const ready = deriveChecklist(
      {
        discord: { webhookSet: true, testPostAt: '2026-10-03T20:00:00.000Z', testPostError: null },
        members: 9,
        hosts: [{ label: 'Hana PC', account: null, lastSeenAt: '2026-10-03T20:00:00.000Z' }],
        hasGame: true,
      },
      context,
    );
    const { container } = home({ checklist: ready, premium: { linesEnabled: true, pausedUntilDay: null } });
    expect([...container.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual([
      CHECKLIST_READY,
      'Invite your group',
      'Members',
      'Kustom Premium',
      'Set up another PC',
      'Reset ratings',
    ]);
  });

  it('says no paste and no key anywhere, in every host card state (M17.12, Kustom 1.0)', () => {
    const ready = deriveChecklist(
      {
        discord: { webhookSet: true, testPostAt: '2026-10-03T20:00:00.000Z', testPostError: null },
        members: 9,
        hosts: [{ label: 'Hana PC', account: 'Hana', lastSeenAt: '2026-10-03T20:00:00.000Z' }],
        hasGame: true,
      },
      context,
    );
    const states: Partial<HomeProps>[] = [
      {},
      { hostPreview: { kind: 'waiting', code: 'K7Q2MX' } },
      { hostPreview: { kind: 'expired' } },
      { access: 'creator-unlinked' },
      { access: 'admin' },
      { access: 'operator', invite: { state: 'hidden', message: INVITE_HIDDEN } },
      { checklist: ready, members: 9, ratingsReset: { lastResetDay: null, hasRatedGame: true } },
    ];
    for (const state of states) {
      const { container, unmount } = home(state);
      expect(renderedWords(container)).not.toMatch(/paste|key/i);
      unmount();
    }
  });

  it('signed out: a sign-in that comes back here', () => {
    render(<AdminHome kind="signed-out" group={GROUP} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Admin');
    expect(screen.getByDisplayValue('/g/friday-five/admin')).toHaveAttribute('name', 'next');
    expect(screen.queryByText('Get your group ready')).not.toBeInTheDocument();
  });

  it('not an admin: says whose page it is and goes back to tonight', () => {
    render(<AdminHome kind="not-admin" group={GROUP} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This page is for admins');
    expect(screen.getByText("Only Friday Five's admins can open it.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to tonight' })).toHaveAttribute('href', '/g/friday-five');
  });
});
