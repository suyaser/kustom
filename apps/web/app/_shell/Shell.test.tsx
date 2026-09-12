import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RELEASES_URL } from '@/lib/nav';
import { HOW_THIS_WORKS_LINES } from '@/lib/shellCopy';
import { THEME_LABELS, THEME_PICKER_LABEL } from '@/lib/theme';
import { Shell } from './Shell';

/**
 * The shell (M3.18): what every public page says about itself before the page says anything.
 *
 * `usePathname` is the one thing the top bar needs from Next, and it is mocked per test so the
 * underline rule is checked on the two routes that exist rather than on a rendered app.
 */

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

function draw(path: string, viewerPuuid: string | null = null) {
  pathname.current = path;
  return render(
    <Shell viewerPuuid={viewerPuuid}>
      <p>page</p>
    </Shell>,
  );
}

describe('the top bar', () => {
  it('says KUSTOM and never the repo codename', () => {
    const { container } = draw('/');

    expect(screen.getByText('KUSTOM')).toBeInTheDocument();
    // The repo's codename appears on no friend-facing surface (M3.21). Checked on the word
    // rather than the phrase so the phrase itself is not in `apps/web` at all.
    expect(container.textContent).not.toContain('Customs');
  });

  it('renders only the routes that exist, and underlines the one being read', () => {
    draw('/');

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toContain('Tonight');
    // `Stats` is a route since M5.4, so it is a tab; the rule is unchanged and the list is
    // still the routes that exist.
    expect(screen.getByRole('link', { name: 'Games' })).toHaveAttribute('href', '/games');
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: 'Tonight' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Leaderboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Games' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Stats' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Fun' })).toHaveAttribute('href', '/fun');
    expect(screen.getByRole('link', { name: 'Fun' })).not.toHaveAttribute('aria-current');
  });

  it('underlines Games on the games page', () => {
    draw('/games');

    expect(screen.getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Leaderboard' })).not.toHaveAttribute('aria-current');
  });

  it('underlines Stats on the stats page', () => {
    draw('/stats');

    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Leaderboard' })).not.toHaveAttribute('aria-current');
  });

  it('underlines Fun on the fun page', () => {
    draw('/fun');

    expect(screen.getByRole('link', { name: 'Fun' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Stats' })).not.toHaveAttribute('aria-current');
  });

  it('moves the underline to the leaderboard on a player page', () => {
    draw('/p/puuid-hana');

    expect(screen.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('points the companion tab at the releases page, not at a 90MB download', () => {
    draw('/');

    const companion = screen.getByRole('link', { name: 'Companion ↗' });
    expect(companion).toHaveAttribute('href', RELEASES_URL);
    expect(companion).toHaveAttribute('target', '_blank');
  });

  it('offers Day, Night and Current, with Day marked', () => {
    draw('/');

    expect(screen.getByRole('group', { name: THEME_PICKER_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: THEME_LABELS.day })).toBeChecked();
    expect(screen.getByRole('radio', { name: THEME_LABELS.night })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: THEME_LABELS.current })).toBeInTheDocument();
  });
});

describe('the footer', () => {
  it('explains the whole system in four lines, closed by default', () => {
    draw('/');

    expect(screen.getByText('How this works')).toBeInTheDocument();
    for (const line of HOW_THIS_WORKS_LINES) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    // A `<details>` renders its content in the DOM and hides it until it is tapped: it is the
    // one element on the page allowed to change height, because a person asked it to.
    expect(document.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('sends Get the companion at the releases page', () => {
    draw('/');

    expect(screen.getByRole('link', { name: 'Get the companion' })).toHaveAttribute('href', RELEASES_URL);
  });

  it('offers Your games only to a viewer who has a player row, and points it at their page', () => {
    const anonymous = draw('/');
    expect(screen.queryByRole('link', { name: 'Your games' })).not.toBeInTheDocument();
    anonymous.unmount();

    draw('/', 'puuid-hana');
    expect(screen.getByRole('link', { name: 'Your games' })).toHaveAttribute('href', '/p/puuid-hana');
  });
});
