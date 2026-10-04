import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INVITE_DEAD } from '@/lib/groups/copy';
import {
  DONT_HAVE_KUSTOM_LINE,
  DONT_HAVE_KUSTOM_TITLE,
  HAVE_KUSTOM_LINE,
  HAVE_KUSTOM_TITLE,
  INVITE_DEAD_LINE,
  INVITE_DEAD_TITLE,
  PAIRING_EXPIRED_LINE,
  PAIRING_TTL_LINE,
  WHICH_ACCOUNT_TITLE,
} from '@/lib/groups/pageCopy';
import { RELEASES_URL } from '@/lib/nav';
import { JoinView } from './JoinView';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/** `/join/<code>`, each state's exact copy (M13.13 acceptance 1, M14.21 acceptance 7). */

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const GROUP = { id: '11111111-1111-4111-8111-111111111111', slug: 'friday-five', name: 'Friday Five' };

describe('the join page', () => {
  it("dead code: M13.13's sentence, as the h1 and the line under it, and a way back", () => {
    render(<JoinView kind="dead" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("This link doesn't work anymore.");
    expect(screen.getByText('Ask your group for the new one.')).toBeInTheDocument();
    expect(`${INVITE_DEAD_TITLE} ${INVITE_DEAD_LINE}`).toBe(INVITE_DEAD);
    expect(screen.getByRole('link', { name: 'Back to Kustom' })).toHaveAttribute('href', '/');
  });

  it('signed out: the pitch and a sign-in that comes back here', () => {
    render(<JoinView kind="signed-out" code={CODE} group={GROUP} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Friday Five uses Kustom to pick fair teams for your customs.',
    );
    const button = screen.getByRole('button', { name: 'Sign in with Discord' });
    const form = button.closest('form') as HTMLElement;
    expect(form).toHaveAttribute('action', '/auth/signin');
    expect(within(form).getByDisplayValue(`/join/${CODE}`)).toHaveAttribute('name', 'next');
  });

  it('signed in and linked: one Join button', () => {
    render(<JoinView kind="linked" code={CODE} group={GROUP} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Friday Five');
    expect(screen.getByRole('button', { name: 'Join Friday Five' })).toBeInTheDocument();
    expect(screen.queryByText(WHICH_ACCOUNT_TITLE)).not.toBeInTheDocument();
  });

  it('signed in, not linked: which account, with the two cards', () => {
    render(
      <JoinView kind="unlinked" code={CODE} group={GROUP} preview={{ kind: 'waiting', code: 'K7QX2M' }} />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Which League account is yours?');

    const kustom = screen.getByRole('heading', { level: 2, name: HAVE_KUSTOM_TITLE })
      .parentElement as HTMLElement;
    expect(within(kustom).getByText(HAVE_KUSTOM_LINE)).toBeInTheDocument();
    expect(within(kustom).getByText('K7QX2M')).toBeInTheDocument();
    expect(within(kustom).getByText(PAIRING_TTL_LINE)).toBeInTheDocument();
    expect(within(kustom).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    // M17.18: Kustom 1.0's own wording, and no download link on the join page.
    expect(HAVE_KUSTOM_LINE).toBe(
      'Open Kustom on your PC with League running and type this code where it asks for one:',
    );
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
    expect(document.querySelector(`a[href="${RELEASES_URL}"]`)).toBeNull();

    const dont = screen.getByRole('heading', { level: 2, name: DONT_HAVE_KUSTOM_TITLE })
      .parentElement as HTMLElement;
    expect(within(dont).getByText(DONT_HAVE_KUSTOM_LINE)).toBeInTheDocument();
    // M14.73: the group's lobby, the Tonight tab, and the button by its label.
    expect(DONT_HAVE_KUSTOM_LINE).toBe(
      "No problem. Play a game with the group. Next time you're in the group's lobby, open Tonight and tap That's me.",
    );
    expect(within(dont).getByRole('link', { name: 'Open Friday Five' })).toHaveAttribute(
      'href',
      '/g/friday-five',
    );
  });

  it('signed in, not linked, the code ran out: the sentence and New code', () => {
    render(<JoinView kind="unlinked" code={CODE} group={GROUP} preview={{ kind: 'expired' }} />);
    // No instruction dangling over a code that is not there (designer round 1).
    expect(screen.queryByText(HAVE_KUSTOM_LINE)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(PAIRING_EXPIRED_LINE);
    expect(screen.getByRole('button', { name: 'New code' })).toBeInTheDocument();
  });
});
