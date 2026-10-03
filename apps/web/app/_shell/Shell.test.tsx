import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP, type PageGroup } from '@/lib/groups/pageGroup';
import { RELEASES_URL } from '@/lib/nav';
import { COMPANION_CARD_BODY, HOW_THIS_WORKS_LINES } from '@/lib/shellCopy';
import { THEME_PICKER_LABEL } from '@/lib/theme';
import { Shell } from './Shell';

/**
 * The shell (M3.18): what every public page says about itself before the page says anything.
 *
 * `usePathname` is the one thing the top bar needs from Next, and it is mocked per test so the
 * underline rule is checked on the two routes that exist rather than on a rendered app.
 */

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

/** A group that is not the original one, with a name nothing else on the page could print. */
const GROUP_A: PageGroup = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'thursday-flex',
  name: 'Thursday Flex',
};

function draw(
  path: string,
  viewerPuuid: string | null = null,
  group: PageGroup = ORIGINAL_GROUP,
  isAdmin = false,
) {
  pathname.current = path;
  return render(
    <Shell group={group} viewerPuuid={viewerPuuid} isAdmin={isAdmin}>
      <p>page</p>
    </Shell>,
  );
}

describe('the top bar', () => {
  it('says KUSTOM and never the repo codename of its own accord', () => {
    const { container } = draw('/g/thursday-flex', null, GROUP_A);

    expect(screen.getByText('KUSTOM')).toBeInTheDocument();
    // The repo's codename appears on no friend-facing surface (M3.21). Checked on the word
    // rather than the phrase so the phrase itself is not in `apps/web` at all. (The original
    // group is itself called that -- its name is data, printed as the group line below.)
    expect(container.textContent).not.toContain('Customs');
  });

  /** 05-design.md, "The group in the shell" (M13.7). */
  it('names the group under the wordmark, as one link to the group home', () => {
    draw('/g/thursday-flex', null, GROUP_A);

    const lockup = screen.getByRole('link', { name: 'KUSTOM Thursday Flex' });
    expect(lockup).toHaveAttribute('href', '/g/thursday-flex');
    expect(lockup.querySelector('.cn-wordmark-group')).toHaveTextContent('Thursday Flex');
  });

  it('prints a group name as text, never as markup', () => {
    draw('/g/x', null, { ...GROUP_A, name: '<b>Flex</b> 🎮' });

    expect(document.querySelector('.cn-wordmark-group')?.textContent).toBe('<b>Flex</b> 🎮');
    expect(document.querySelector('.cn-wordmark-group b')).toBeNull();
  });

  /** M13.9 acceptance 4, over the whole shell: tabs, wordmark and footer, every viewer. */
  it('renders no link on /g/a/* that leaves /g/a/ except to another site', () => {
    for (const [viewerPuuid, isAdmin] of [
      [null, false],
      ['puuid-hana', false],
      ['puuid-hana', true],
    ] as const) {
      const { unmount } = draw('/g/thursday-flex', viewerPuuid, GROUP_A, isAdmin);
      for (const link of screen.getAllByRole('link')) {
        const href = link.getAttribute('href') ?? '';
        const inside = href === '/g/thursday-flex' || href.startsWith('/g/thursday-flex/');
        expect(inside || href.startsWith('https://'), href).toBe(true);
      }
      unmount();
    }
  });

  it('shows a group admin the Admin tab, and nobody else', () => {
    const member = draw('/g/customs', 'puuid-hana', ORIGINAL_GROUP, false);
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    member.unmount();

    draw('/g/customs', 'puuid-hana', ORIGINAL_GROUP, true);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('renders only the routes that exist, and underlines the one being read', () => {
    draw('/g/customs');

    // No `Tonight` tab: the wordmark lockup is the way home (the product owner, M13.9).
    expect(screen.queryByRole('link', { name: 'Tonight' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'KUSTOM Customs Night' })).toHaveAttribute('href', '/g/customs');
    // `Stats` is a route since M5.4, so it is a tab; the rule is unchanged and the list is
    // still the routes that exist.
    expect(screen.getByRole('link', { name: 'Games' })).toHaveAttribute('href', '/games');
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: 'Leaderboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Games' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Stats' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Fun' })).toHaveAttribute('href', '/fun');
    expect(screen.getByRole('link', { name: 'Fun' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: '1v1' })).toHaveAttribute('href', '/1v1');
    expect(screen.getByRole('link', { name: '1v1' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Daily' })).toHaveAttribute('href', '/mystery');
    expect(screen.getByRole('link', { name: 'Daily' })).not.toHaveAttribute('aria-current');
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

  it('underlines 1v1 on the 1v1 page', () => {
    draw('/1v1');

    expect(screen.getByRole('link', { name: '1v1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Fun' })).not.toHaveAttribute('aria-current');
  });

  it('underlines the daily game on the mystery page', () => {
    draw('/mystery');

    expect(screen.getByRole('link', { name: 'Daily' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Fun' })).not.toHaveAttribute('aria-current');
  });

  it('moves the underline to the leaderboard on a player page', () => {
    draw('/p/puuid-hana');

    expect(screen.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('points the companion tab at the releases page, not at a 90MB download', () => {
    draw('/g/customs');

    const companion = screen.getByRole('link', { name: 'Companion ↗' });
    expect(companion).toHaveAttribute('href', RELEASES_URL);
    expect(companion).toHaveAttribute('target', '_blank');
  });

  it('offers a Day / Night switch, Night on', () => {
    draw('/g/customs');

    const toggle = screen.getByRole('switch', { name: THEME_PICKER_LABEL });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveTextContent('Day');
    expect(toggle).toHaveTextContent('Night');
  });
});

describe('the footer', () => {
  it('explains the whole system in four lines, closed by default', () => {
    draw('/g/customs');

    expect(screen.getByText('How this works')).toBeInTheDocument();
    for (const line of HOW_THIS_WORKS_LINES) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    // A `<details>` renders its content in the DOM and hides it until it is tapped: it is the
    // one element on the page allowed to change height, because a person asked it to.
    expect(document.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  /**
   * The twin of `lib/board/board.test.ts`'s `promises a gap that settles` guard, over the one
   * line that says the same thing to every visitor on every page (M7.19, product 2026-09-16).
   *
   * Three retired claims, one string: a rating **does not** start from a League rank
   * (`provisionalSeed()` gives everybody the same one), only a **Summoner's Rift** result moves
   * it (M7.1 took ARAM out of the fold), and the Proven gap **settles** — `catches up` is the
   * verb M3.19 retired on 2026-09-10, because it promises a day that never comes.
   */
  it('starts everybody on the same rating, off Rift results, and promises a gap that settles', () => {
    const line = HOW_THIS_WORKS_LINES[3];

    expect(line).toContain("Summoner's Rift");
    expect(line).toContain('settles');
    expect(line).not.toContain('from your rank');
    expect(line).not.toContain('catches up');
  });

  it('sends Get the companion at the releases page', () => {
    draw('/g/customs');

    expect(screen.getByRole('link', { name: 'Get the companion' })).toHaveAttribute('href', RELEASES_URL);
  });

  it('offers Your games only to a viewer who has a player row, and points it at their page', () => {
    const anonymous = draw('/g/customs');
    expect(screen.queryByRole('link', { name: 'Your games' })).not.toBeInTheDocument();
    anonymous.unmount();

    draw('/g/customs', 'puuid-hana');
    expect(screen.getByRole('link', { name: 'Your games' })).toHaveAttribute('href', '/p/puuid-hana');
  });

  it('offers no Your games on a group whose player page has not moved yet', () => {
    draw('/g/thursday-flex', 'puuid-hana', GROUP_A);
    expect(screen.queryByRole('link', { name: 'Your games' })).not.toBeInTheDocument();
  });
});

/**
 * `Run the companion` (corrected 2026-10-03). Since the companion split into Host and Overlay,
 * most people run Overlay mode with no token; only the one or two Host PCs need one. The card
 * used to tell every player to get a token from an admin.
 */
describe('the companion card', () => {
  it('says most people need no token, and only Host mode needs one', () => {
    expect(COMPANION_CARD_BODY).toContain('Overlay mode');
    expect(COMPANION_CARD_BODY).toContain('no token');
    expect(COMPANION_CARD_BODY).toContain('Host mode need a token from an admin');
    expect(COMPANION_CARD_BODY).not.toMatch(/paste in the token an admin gives you/);
  });
});
