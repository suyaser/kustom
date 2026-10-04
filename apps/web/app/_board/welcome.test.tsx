import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerBoardView } from '@/lib/board/types';
import { workedPlayer } from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';

/**
 * The welcome card (M14.33): `/g/<slug>/you?welcome=1` for a linked viewer, built from the self
 * lens's own `loadPlayerBoard` view (acceptance 3), in its three variants (acceptance 4), and for
 * nobody else (acceptance 2). The route is rendered with its loaders mocked.
 */

const GROUP = { id: '00000000-0000-0000-0000-000000000001', slug: 'customs', name: 'Customs Night' };
const HANA = workedPuuid('Hana');

const viewerState = vi.fn<() => Promise<unknown>>();
const loadPlayerBoard = vi.fn<(...args: unknown[]) => Promise<PlayerBoardView | null>>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/g/customs/you',
}));
vi.mock('@/lib/groups/requirePageGroup', () => ({ requirePageGroup: async () => GROUP }));
vi.mock('@/lib/viewer', () => ({ currentViewerState: () => viewerState(), currentViewer: async () => null }));
vi.mock('@/lib/publicClient', () => ({ createPublicClient: () => ({}) }));
vi.mock('@/lib/board/load', () => ({ loadPlayerBoard: (...args: unknown[]) => loadPlayerBoard(...args) }));
vi.mock('@/lib/stats/load', () => ({ loadPlayerStats: async () => ({ games: 0 }) }));

async function you(welcome: string | undefined) {
  const { default: YouRoute } = await import('../(group)/g/[slug]/you/page');
  const element = await YouRoute({
    params: Promise.resolve({ slug: 'customs' }),
    searchParams: Promise.resolve(welcome === undefined ? {} : { welcome }),
  });
  return render(element);
}

const linked = { kind: 'linked', puuid: HANA, isAdmin: false };

beforeEach(() => {
  viewerState.mockReset();
  loadPlayerBoard.mockReset();
  window.history.replaceState(null, '', '/g/customs/you?welcome=1');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('the welcome card on /you?welcome=1', () => {
  it("says the page's own games, wins and Rating, with a way back to tonight", async () => {
    viewerState.mockResolvedValue(linked);
    const player = workedPlayer('Hana');
    loadPlayerBoard.mockResolvedValue(player);
    await you('1');
    expect(
      screen.getByText(`That's you. ${player.games} games, ${player.wins} wins, Rating ${player.rating}.`),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to tonight' })).toHaveAttribute('href', '/g/customs');
    // The numbers came from the one read the self lens makes, in this group.
    expect(loadPlayerBoard).toHaveBeenCalledTimes(1);
    expect(loadPlayerBoard.mock.calls[0]?.[2]).toMatchObject({ window: 'all-time', groupId: GROUP.id });
  });

  it('drops ?welcome=1 from the address bar on the first render, and keeps the card', async () => {
    viewerState.mockResolvedValue(linked);
    loadPlayerBoard.mockResolvedValue(workedPlayer('Hana'));
    await you('1');
    expect(window.location.search).toBe('');
    expect(screen.getByText(/^That's you\./)).toBeInTheDocument();
  });

  it('carries the settling chip for a settling player', async () => {
    viewerState.mockResolvedValue(linked);
    loadPlayerBoard.mockResolvedValue(
      workedPlayer('Hana', { games: 4, wins: 3, losses: 1, ratedGames: 4, settling: true, rank: null }),
    );
    await you('1');
    expect(screen.getByText(/That's you\. 4 games, 3 wins, Rating \d+\./)).toBeInTheDocument();
    expect(screen.getAllByText('settling · 4/10').length).toBeGreaterThan(0);
  });

  it('says no games yet, once, for a linked player with none in the group', async () => {
    viewerState.mockResolvedValue(linked);
    loadPlayerBoard.mockResolvedValue(
      workedPlayer('Hana', {
        games: 0,
        wins: 0,
        losses: 0,
        ratedGames: 0,
        history: [],
        recent: [],
        rank: null,
      }),
    );
    await you('1');
    expect(
      screen
        .getAllByText(/No games with this group yet\. Your first one shows up here\./)
        .map((el) => el.textContent),
    ).toEqual(["That's you. No games with this group yet. Your first one shows up here."]);
  });

  it('is not drawn without ?welcome=1', async () => {
    viewerState.mockResolvedValue(linked);
    loadPlayerBoard.mockResolvedValue(workedPlayer('Hana'));
    await you(undefined);
    expect(screen.queryByText(/^That's you\./)).not.toBeInTheDocument();
  });

  it('is not drawn for a signed-out or a not-linked viewer on the same URL', async () => {
    viewerState.mockResolvedValue({ kind: 'anonymous' });
    const anonymous = await you('1');
    expect(screen.queryByText(/^That's you\./)).not.toBeInTheDocument();
    anonymous.unmount();

    viewerState.mockResolvedValue({ kind: 'unlinked' });
    await you('1');
    expect(screen.queryByText(/^That's you\./)).not.toBeInTheDocument();
    expect(loadPlayerBoard).not.toHaveBeenCalled();
  });
});

describe('the public player page', () => {
  it('shows no card on /p/<you>?welcome=1, even for that player', async () => {
    loadPlayerBoard.mockResolvedValue(workedPlayer('Hana'));
    const { default: PlayerPage } = await import('../(group)/g/[slug]/p/[puuid]/page');
    const element = await PlayerPage({
      params: Promise.resolve({ slug: 'customs', puuid: HANA }),
      searchParams: Promise.resolve({ welcome: '1' } as { window?: string }),
    });
    render(element);
    expect(screen.queryByText(/^That's you\./)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to tonight' })).not.toBeInTheDocument();
  });
});
