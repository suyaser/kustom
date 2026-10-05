import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CALIBRATION_EARLY, CALIBRATION_READY, RATINGS_KNOWN } from '@/components/receipt/fixtures';
import type { GameListItem, GamesListView } from '@/lib/games/list';
import { CalibrationLine, GamesList } from './GamesList';

const BASE = '/g/customs/games';
const LENA = '11111111-1111-4111-8111-111111111111';

function item(overrides: Partial<GameListItem> = {}): GameListItem {
  return {
    id: 'game-1',
    dateLabel: '22 Sep',
    durationLabel: '21 min',
    winningSide: 100,
    aram: false,
    odds: { kind: 'rolled', blueWinProb: 0.54, rank: 1 },
    ruleNote: null,
    lines: [],
    ...overrides,
  };
}

function view(overrides: Partial<GamesListView> = {}): GamesListView {
  return {
    filters: { window: 'all-time', mode: 'sr', player: null, page: 1 },
    total: 1,
    pages: 1,
    members: [
      { puuid: LENA, name: 'Lena' },
      { puuid: '22222222-2222-4222-8222-222222222222', name: 'TheSHADOWREAPER' },
    ],
    focusName: null,
    items: [item()],
    calibration: CALIBRATION_READY,
    groupHasGames: true,
    ...overrides,
  };
}

describe('GamesList rows name the rule (M15.19)', () => {
  it.each(['Tanks only · not rated', 'Ionia vs Noxus · not rated', 'Mirror match'])('%s', (note) => {
    render(<GamesList view={view({ items: [item({ ruleNote: note })] })} base={BASE} />);
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it('a game with no rule prints no note', () => {
    render(<GamesList view={view()} base={BASE} />);
    expect(screen.queryByText(/only ·|Mirror match/)).toBeNull();
  });
});

describe('GamesList', () => {
  it('has one h1 and links every row, whole, to its game page', () => {
    render(
      <GamesList
        view={view({ items: [item(), item({ id: 'game-2', winningSide: 200 })], total: 2 })}
        base={BASE}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Blue won/ })).toHaveAttribute('href', `${BASE}/game-1`);
    expect(screen.getByRole('link', { name: /Red won/ })).toHaveAttribute('href', `${BASE}/game-2`);
  });

  it('prints the date and the duration as minutes, never a clock time', () => {
    render(<GamesList view={view()} base={BASE} />);
    const row = screen.getByRole('link', { name: /Blue won/ });
    expect(row).toHaveTextContent('22 Sep · 21 min');
    expect(row.textContent).not.toMatch(/\d+:\d\d/);
  });

  it('puts the compact receipt on a rolled row and on a backfilled one (pre-game odds)', () => {
    render(
      <GamesList
        view={view({
          items: [
            item({ odds: { kind: 'rolled', blueWinProb: 0.46, rank: 2 }, winningSide: 100 }),
            item({
              id: 'game-2',
              odds: { kind: 'pre-game', ratingsBefore: RATINGS_KNOWN, kickoffBlueWinProb: null },
              winningSide: 200,
            }),
          ],
          total: 2,
        })}
        base={BASE}
      />,
    );
    const rolled = screen.getByRole('link', { name: /Blue won/ });
    expect(within(rolled).getByText('Blue was 46%.')).toBeInTheDocument();
    expect(within(rolled).getByText('Upset')).toBeInTheDocument();
    expect(within(rolled).getByText('pick #2')).toBeInTheDocument();
    const backfilled = screen.getByRole('link', { name: /Red won/ });
    expect(within(backfilled).getByText(/^(?:(?:Blue|Red) was \d+%\.|50–50\.)$/)).toBeInTheDocument();
  });

  it('says who won once per row: the title, never again in the odds line (M14.42)', () => {
    render(
      <GamesList
        view={view({
          items: [
            item({ odds: { kind: 'rolled', blueWinProb: 0.54, rank: 1 }, winningSide: 100 }),
            item({ id: 'game-2', odds: { kind: 'rolled', blueWinProb: 0.5, rank: 1 }, winningSide: 200 }),
          ],
          total: 2,
        })}
        base={BASE}
      />,
    );
    for (const [name, odds] of [
      [/Blue won/, 'Blue was 54%.'],
      [/Red won/, '50–50.'],
    ] as const) {
      const row = screen.getByRole('link', { name });
      expect(row.textContent?.match(/(?:Blue|Red) won/g)).toHaveLength(1);
      expect(within(row).getByText(odds)).toBeInTheDocument();
    }
  });

  it("adds the viewer's own line on a game they played, and the filtered player's", () => {
    render(
      <GamesList
        view={view({
          focusName: 'Lena',
          filters: { window: 'all-time', mode: 'sr', player: LENA, page: 1 },
          items: [
            item({
              lines: [
                {
                  who: 'focus',
                  name: 'Lena',
                  champion: 'Ahri',
                  role: 'mid',
                  kda: '15/5/6',
                  won: true,
                  delta: 12,
                },
                {
                  who: 'you',
                  name: 'Omar',
                  champion: 'Leona',
                  role: 'support',
                  kda: '1/7/20',
                  won: false,
                  delta: -9,
                },
              ],
            }),
          ],
        })}
        base={BASE}
      />,
    );
    const row = screen.getByRole('link', { name: /Blue won/ });
    expect(row).toHaveTextContent('Lena');
    expect(row).toHaveTextContent('Ahri · mid');
    expect(row).toHaveTextContent('15/5/6');
    expect(row).toHaveTextContent('gained 12');
    expect(within(row).getByText('You')).toBeInTheDocument();
    expect(row).toHaveTextContent('lost 9');
    expect(screen.getByText(/Showing Lena's games\./)).toBeInTheDocument();
  });

  it('keeps every filter in the URL: chips are links with aria-current, the player is a GET form', () => {
    render(
      <GamesList
        view={view({ filters: { window: 'this-week', mode: 'aram', player: LENA, page: 3 } })}
        base={BASE}
      />,
    );
    const date = screen.getByRole('navigation', { name: 'Date' });
    expect(within(date).getByRole('link', { name: 'This week' })).toHaveAttribute('aria-current', 'page');
    expect(within(date).getByRole('link', { name: 'Tonight' })).toHaveAttribute(
      'href',
      `${BASE}?window=tonight&mode=aram&player=${LENA}`,
    );
    const mode = screen.getByRole('navigation', { name: 'Map' });
    expect(within(mode).getByRole('link', { name: 'ARAM' })).toHaveAttribute('aria-current', 'page');
    expect(within(mode).getByRole('link', { name: 'Rift' })).toHaveAttribute(
      'href',
      `${BASE}?window=this-week&player=${LENA}`,
    );
    const select = screen.getByRole('combobox', { name: 'Player' });
    expect(select).toHaveValue(LENA);
    expect(select.closest('form')).toHaveAttribute('method', 'get');
    expect(select.closest('form')).toHaveAttribute('action', BASE);
    expect(screen.getByRole('option', { name: 'Everyone' })).toHaveValue('');
  });

  it('paginates with links, 25 a page', () => {
    render(
      <GamesList
        view={view({
          total: 60,
          pages: 3,
          filters: { window: 'all-time', mode: 'sr', player: null, page: 2 },
        })}
        base={BASE}
      />,
    );
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(pages).toHaveTextContent('Page 2 of 3');
    expect(within(pages).getByRole('link', { name: 'Newer' })).toHaveAttribute(
      'href',
      `${BASE}?window=all-time`,
    );
    expect(within(pages).getByRole('link', { name: 'Older' })).toHaveAttribute(
      'href',
      `${BASE}?window=all-time&page=3`,
    );
  });

  it('says no games match, with a way to every date, when the filters empty the list', () => {
    render(
      <GamesList
        view={view({
          items: [],
          total: 0,
          filters: { window: 'tonight', mode: 'sr', player: null, page: 1 },
        })}
        base={BASE}
      />,
    );
    expect(screen.getByText('No games match. Try a wider date range.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all dates' })).toHaveAttribute(
      'href',
      `${BASE}?window=all-time`,
    );
  });

  it('tells an empty group apart from an empty filter', () => {
    render(<GamesList view={view({ items: [], total: 0, groupHasGames: false })} base={BASE} />);
    expect(screen.getByText('No games yet. They show up here when a custom ends.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See all dates' })).not.toBeInTheDocument();
  });
});

describe('CalibrationLine', () => {
  it('shows the line and its follow-up from 20 qualifying games', () => {
    render(<CalibrationLine calibration={CALIBRATION_READY} />);
    expect(screen.getByText(/The side the bot favored won/)).toHaveTextContent(
      'The side the bot favored won 58 of 103 games (56%). It expected about 55%.',
    );
    expect(screen.getByText('The odds are honest when those two numbers are close.')).toBeInTheDocument();
  });

  it('hides the percentages under 20 and says how far along it is', () => {
    render(<CalibrationLine calibration={CALIBRATION_EARLY} />);
    expect(screen.getByText(/Not enough games yet/)).toHaveTextContent(
      "Not enough games yet to check the bot's odds (7 of 20).",
    );
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
