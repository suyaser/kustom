import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { YouPage } from './YouPage';

/** The You tab's body (M14.7b). Role and text queries only. */

const common = { group: ORIGINAL_GROUP, here: '/g/customs/you', daily: '/mystery' } as const;

describe('the You page', () => {
  it('signed out: one h1 asking them to sign in, the pitch, a real sign-in form, and the theme', () => {
    render(<YouPage kind="anonymous" {...common} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('See it from where you stand.');
    expect(
      screen.getByText(
        "Sign in and this page becomes yours: every game you've played with Customs Night, your Rating, and your record with and against each friend.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nothing here is hidden. Every game and every number is already public; signing in just puts you at the centre of it.',
      ),
    ).toBeInTheDocument();
    // Signing in alone does not let you start a lobby (you have to be linked): no such promise.
    expect(document.body.textContent).not.toMatch(/start a lobby/i);
    const button = screen.getByRole('button', { name: 'Sign in with Discord' });
    const form = button.closest('form');
    expect(form).toHaveAttribute('action', '/auth/signin');
    expect(within(form as HTMLElement).getByDisplayValue('/g/customs/you')).toHaveAttribute('name', 'next');
    expect(screen.getByRole('switch', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Admin/ })).not.toBeInTheDocument();
  });

  it('linked admin: Admin first, then the self lens it is given, the public page link, Daily, and sign out', () => {
    render(
      <YouPage
        kind="linked"
        {...common}
        admin="/admin"
        playerPage="/g/customs/p/puuid-hana"
        self={<h1>TheSHADOWREAPER</h1>}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/admin');
    expect(links[0]).toHaveTextContent('You help run Customs Night.');
    expect(links[0]).toHaveTextContent('Open admin');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('TheSHADOWREAPER');
    expect(screen.getByRole('link', { name: 'See your public page' })).toHaveAttribute(
      'href',
      '/g/customs/p/puuid-hana',
    );
    expect(screen.getByRole('link', { name: 'Daily' })).toHaveAttribute('href', '/mystery');
    expect(screen.getByRole('button', { name: 'Sign out' }).closest('form')).toHaveAttribute(
      'action',
      '/auth/signout',
    );
  });

  it("the owner's card says they run the group", () => {
    render(<YouPage kind="linked" {...common} admin="/admin" owner playerPage={null} self={<h1>Hana</h1>} />);
    expect(screen.getAllByRole('link')[0]).toHaveTextContent('You run Customs Night.');
  });

  it('linked, the player page unreadable and not an admin: the tab word as the h1, no Admin card', () => {
    render(<YouPage kind="linked" {...common} admin={null} playerPage={null} self={null} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You');
    expect(screen.queryByRole('link', { name: /Admin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /public page/ })).not.toBeInTheDocument();
  });

  it('signed in with no player row: says so as the h1, and offers sign out', () => {
    render(<YouPage kind="unlinked" {...common} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Which League account is yours?');
    expect(
      screen.getByText(/Next time you're in the group's lobby, open Tonight and tap That's me\.$/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open admin/ })).not.toBeInTheDocument();
  });

  it('N7: the account row says whose Discord it is, and is dropped without a name', () => {
    const { unmount } = render(<YouPage kind="unlinked" {...common} discordName="hana_" />);
    expect(screen.getByText('Signed in as hana_')).toBeInTheDocument();
    unmount();
    render(<YouPage kind="unlinked" {...common} />);
    expect(screen.queryByText(/Signed in/)).not.toBeInTheDocument();
  });

  it("M14.51: the group's creator before linking gets the Admin card first, as its owner", () => {
    render(<YouPage kind="unlinked" {...common} admin="/g/customs/admin" />);
    const card = screen.getByRole('link', { name: /Open admin/ });
    expect(card).toHaveAttribute('href', '/g/customs/admin');
    expect(card).toHaveTextContent('You run Customs Night.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Which League account is yours?');
  });
});
