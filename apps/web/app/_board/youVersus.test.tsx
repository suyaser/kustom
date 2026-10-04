import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerBoardView } from '@/lib/board/types';
import { workedPlayer } from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { PITCH_COOKIE, pitchDismissedFor } from '@/lib/versus/pitchDismiss';
import type { YouVersusRow } from '@/lib/versus/you';
import { VersusPitch } from './VersusPitch';
import { YouVsEveryone } from './YouVersus';

/**
 * You vs them on the pages (M14.35): the card on someone else's player page for a linked viewer
 * only, the everyone list on `/you` for a linked viewer only, rows that open Pick two filled, and
 * the once-per-night pitch line. Role and text queries; the routes run with their loaders mocked.
 */

const GROUP = { id: '00000000-0000-0000-0000-000000000001', slug: 'customs', name: 'Customs Night' };
const HANA = workedPuuid('Hana');
const IRIS = workedPuuid('Iris');

const viewer = vi.fn<() => Promise<unknown>>();
const viewerState = vi.fn<() => Promise<unknown>>();
const loadPlayerBoard = vi.fn<(...args: unknown[]) => Promise<PlayerBoardView | null>>();
const loadYouVersus = vi.fn<(...args: unknown[]) => Promise<YouVersusRow[]>>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/g/customs',
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/groups/requirePageGroup', () => ({ requirePageGroup: async () => GROUP }));
vi.mock('@/lib/viewer', () => ({ currentViewerState: () => viewerState(), currentViewer: () => viewer() }));
vi.mock('@/lib/publicClient', () => ({ createPublicClient: () => ({}) }));
vi.mock('@/lib/board/load', () => ({ loadPlayerBoard: (...args: unknown[]) => loadPlayerBoard(...args) }));
vi.mock('@/lib/stats/load', () => ({ loadPlayerStats: async () => ({ games: 0 }) }));
vi.mock('@/lib/versus/you', async (original) => ({
  ...(await original<typeof import('@/lib/versus/you')>()),
  loadYouVersus: (...args: unknown[]) => loadYouVersus(...args),
}));

/** The element whose own text is exactly `text`, however it is split into spans. */
const byText = (text: string) => (_: string, element: Element | null) =>
  element?.textContent === text && [...element.children].every((child) => child.textContent !== text);

const IRIS_ROW: YouVersusRow = {
  them: { puuid: IRIS, name: 'Iris' },
  together: { wins: 9, losses: 3 },
  against: { wins: 2, losses: 6 },
  lanes: [{ role: 'top', you: 2, them: 5 }],
  games: 20,
};

async function playerPage(puuid: string) {
  const { default: PlayerPage } = await import('../(group)/g/[slug]/p/[puuid]/page');
  return render(
    await PlayerPage({
      params: Promise.resolve({ slug: 'customs', puuid }),
      searchParams: Promise.resolve({}),
    }),
  );
}

async function youPage() {
  const { default: YouRoute } = await import('../(group)/g/[slug]/you/page');
  return render(
    await YouRoute({ params: Promise.resolve({ slug: 'customs' }), searchParams: Promise.resolve({}) }),
  );
}

beforeEach(() => {
  viewer.mockReset();
  viewerState.mockReset();
  loadPlayerBoard.mockReset();
  loadYouVersus.mockReset();
  loadYouVersus.mockResolvedValue([IRIS_ROW]);
});

describe("the card on someone else's player page", () => {
  it('says the record together and against, and the lane line, for a linked viewer', async () => {
    viewer.mockResolvedValue({ puuid: HANA, isAdmin: false });
    loadPlayerBoard.mockResolvedValue(workedPlayer('Iris'));
    await playerPage(IRIS);
    expect(screen.getByText('You and Iris: 9–3 together, 2–6 against.')).toBeInTheDocument();
    expect(screen.getByText(byText('In lane: top, Iris leads 5–2.'))).toBeInTheDocument();
    expect(loadYouVersus.mock.calls[0]?.[1]).toMatchObject({ groupId: GROUP.id, viewerPuuid: HANA });
  });

  it('says they never met when the pair has no game', async () => {
    viewer.mockResolvedValue({ puuid: HANA, isAdmin: false });
    loadPlayerBoard.mockResolvedValue(workedPlayer('Theo'));
    await playerPage(workedPuuid('Theo'));
    expect(screen.getByText("You haven't played with or against Theo yet.")).toBeInTheDocument();
  });

  it('is not drawn for a visitor, or for the player on their own page', async () => {
    viewer.mockResolvedValue(null);
    loadPlayerBoard.mockResolvedValue(workedPlayer('Iris'));
    const visitor = await playerPage(IRIS);
    expect(screen.queryByText(/^You and /)).not.toBeInTheDocument();
    visitor.unmount();

    viewer.mockResolvedValue({ puuid: IRIS, isAdmin: false });
    await playerPage(IRIS);
    expect(screen.queryByText(/^You and /)).not.toBeInTheDocument();
    expect(screen.queryByText(/haven't played with or against/)).not.toBeInTheDocument();
    expect(loadYouVersus).not.toHaveBeenCalled();
  });
});

describe('the everyone list on /you', () => {
  it('is drawn for a linked viewer, each row opening Pick two filled, and equals the card', async () => {
    viewerState.mockResolvedValue({ kind: 'linked', puuid: HANA, isAdmin: false });
    loadPlayerBoard.mockResolvedValue(workedPlayer('Hana'));
    await youPage();
    const row = screen.getByRole('link', { name: /Iris/ });
    expect(row).toHaveAttribute('href', `/g/customs/stats/1v1?a=${HANA}&b=${IRIS}`);
    expect(row).toHaveTextContent('9–3');
    expect(row).toHaveTextContent('2–6');
    expect(within(row).getByText(byText('In lane: top, Iris leads 5–2.'))).toBeInTheDocument();
  });

  it('is not drawn for a signed-out or a not-linked viewer', async () => {
    viewerState.mockResolvedValue({ kind: 'anonymous' });
    const anonymous = await youPage();
    expect(screen.queryByRole('heading', { name: 'You vs them' })).not.toBeInTheDocument();
    anonymous.unmount();
    viewerState.mockResolvedValue({ kind: 'unlinked' });
    await youPage();
    expect(screen.queryByRole('heading', { name: 'You vs them' })).not.toBeInTheDocument();
    expect(loadYouVersus).not.toHaveBeenCalled();
  });

  it('says nobody yet when the list is empty', () => {
    render(<YouVsEveryone rows={[]} pickTwo={() => '/x' as never} />);
    expect(
      screen.getByText('Nobody to compare with yet. Play a game and everyone you met shows up here.'),
    ).toBeInTheDocument();
  });
});

describe('the pitch line under a finished game', () => {
  afterEach(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: the test clears the pitch's own cookie.
    document.cookie = `${PITCH_COOKIE}=; path=/; max-age=0`;
  });
  /** What the server reads from the request: the pitch's cookie, as the browser holds it. */
  const cookieValue = () =>
    document.cookie
      .split('; ')
      .find((pair) => pair.startsWith(`${PITCH_COOKIE}=`))
      ?.slice(PITCH_COOKIE.length + 1);

  it('offers sign-in to a viewer who is not linked, coming back to the page', () => {
    render(
      <VersusPitch viewer="not-linked" nightKey="n1" here="/g/customs" you={'/g/customs/you' as never} />,
    );
    const button = screen.getByRole('button', {
      name: 'Played tonight? Sign in and see how you did against everyone.',
    });
    expect(button.closest('form')).toHaveAttribute('action', '/auth/signin');
  });

  it('points a linked viewer at You', () => {
    render(<VersusPitch viewer="linked" nightKey="n1" here="/g/customs" you={'/g/customs/you' as never} />);
    expect(
      screen.getByText(/Tap anyone to see your record with them, or see everyone on/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'You' })).toHaveAttribute('href', '/g/customs/you');
  });

  it('stays dismissed for the night (a cookie the server reads), and comes back the next night', () => {
    const first = render(
      <VersusPitch viewer="linked" nightKey="night-1" here="/g/customs" you={'/g/customs/you' as never} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide for tonight' }));
    expect(screen.queryByText(/Tap anyone/)).not.toBeInTheDocument();
    expect(pitchDismissedFor(cookieValue(), 'night-1')).toBe(true);
    first.unmount();

    const again = render(
      <VersusPitch
        viewer="linked"
        nightKey="night-1"
        here="/g/customs"
        you={'/g/customs/you' as never}
        dismissed={pitchDismissedFor(cookieValue(), 'night-1')}
      />,
    );
    expect(screen.queryByText(/Tap anyone/)).not.toBeInTheDocument();
    again.unmount();

    render(
      <VersusPitch
        viewer="linked"
        nightKey="night-2"
        here="/g/customs"
        you={'/g/customs/you' as never}
        dismissed={pitchDismissedFor(cookieValue(), 'night-2')}
      />,
    );
    expect(screen.getByText(/Tap anyone/)).toBeInTheDocument();
  });

  it('fix-result-cls: the first paint is the final one (the server HTML already has it, or not)', () => {
    // The line used to be rendered hidden and inserted after hydration, pushing the rail and the
    // footer down under a reader who had scrolled. Its space is now in the server's HTML.
    const shown = renderToString(
      <VersusPitch viewer="linked" nightKey="n1" here="/g/customs" you={'/g/customs/you' as never} />,
    );
    expect(shown).toContain('Tap anyone to see your record with them');
    const hidden = renderToString(
      <VersusPitch
        viewer="linked"
        nightKey="n1"
        here="/g/customs"
        you={'/g/customs/you' as never}
        dismissed
      />,
    );
    expect(hidden).toBe('');
  });

  it('is never a dialog or an alert', () => {
    render(<VersusPitch viewer="linked" nightKey="n1" here="/g/customs" you={'/g/customs/you' as never} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
