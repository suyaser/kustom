import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_READY,
  FIXTURE_NAMES,
  RATINGS_KNOWN,
  RATINGS_MISSING,
  THREE_SPLITS,
} from '@/components/receipt/fixtures';
import type { GameBreakdown } from '@/lib/breakdown/load';
import type { KustomReason } from '@/lib/breakdown/read';
import type { DetailSeat, DetailTeam, GameDetailView } from '@/lib/games/detail';
import { visibleText, withoutSrOnly } from '@/lib/testing/visibleText';

import { GameDetail } from './GameDetail';

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

function seat(puuid: string, i: number, overrides: Partial<DetailSeat> = {}): DetailSeat {
  return {
    puuid,
    name: FIXTURE_NAMES[puuid] ?? null,
    role: ROLES[i] ?? null,
    champion: 'Ahri',
    kills: 5,
    deaths: 3,
    assists: 7,
    kda: '5/3/7',
    kp: 60,
    gold: 11_200,
    damageToChamps: 18_400,
    cs: 182,
    vision: 24,
    goldLabel: '11.2k',
    damageLabel: '18.4k',
    csLabel: '182 CS',
    damageShare: 70,
    award: null,
    delta: 14,
    isViewer: false,
    ...overrides,
  };
}

const PUUIDS = Object.keys(FIXTURE_NAMES);

function team(side: 100 | 200, won: boolean, seats?: DetailSeat[]): DetailTeam {
  const ids = side === 100 ? PUUIDS.slice(0, 5) : PUUIDS.slice(5, 10);
  return { side, kills: side === 100 ? 31 : 22, won, seats: seats ?? ids.map((id, i) => seat(id, i)) };
}

function game(overrides: Partial<GameDetailView> = {}): GameDetailView {
  return {
    gameId: 'g-1',
    winningSide: 200,
    nightLabel: 'Tuesday 22 September',
    durationLabel: '31 min',
    remake: false,
    aram: false,
    rated: true,
    ratedStamp: true,
    voidReason: null,
    blue: team(100, false),
    red: team(200, true),
    receipt: {
      kind: 'rolled',
      splits: THREE_SPLITS,
      chosen: THREE_SPLITS[0] as (typeof THREE_SPLITS)[number],
      swapped: false,
    },
    names: FIXTURE_NAMES,
    calibration: CALIBRATION_READY,
    ...overrides,
  };
}

const draw = (view: GameDetailView) => render(<GameDetail game={view} backHref="/g/customs/games" />);

describe('GameDetail', () => {
  it('is one page: the result as the only h1, the finished receipt, both scoreboards', () => {
    draw(game());
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Red won']);
    expect(screen.getByRole('region', { name: 'The odds were' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scoreboard' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Blue team' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Red team' })).toBeInTheDocument();
    expect(screen.getByText('How the bot decided')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All games' })).toHaveAttribute('href', '/g/customs/games');
  });

  it('a voided game says so under the result, and the admin slot sits in the header (M23.1)', () => {
    draw(game());
    expect(screen.queryByText('Not rated · voided')).not.toBeInTheDocument();
    render(
      <GameDetail
        game={game({ voidReason: 'admin', ratedStamp: false })}
        backHref="/g/customs/games"
        admin={<button type="button">Restore</button>}
      />,
    );
    expect(screen.getByText('Not rated · voided')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' }).closest('header')).not.toBeNull();
  });

  it('a remake: h1 Remake, no receipt, the teams and scoreboard stay (05-design.md 15.4)', () => {
    draw(game({ remake: true, rated: false, ratedStamp: false, durationLabel: '4 min' }));
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Remake']);
    expect(screen.queryByRole('region', { name: 'The odds were' })).toBeNull();
    expect(screen.queryByText('How the bot decided')).toBeNull();
    expect(screen.getByRole('region', { name: 'Scoreboard' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Blue team' })).toBeInTheDocument();
  });

  it('a game that ended early says so (M23.1)', () => {
    draw(game({ voidReason: 'early-end', ratedStamp: false, rated: false }));
    expect(screen.getByText('Not rated · ended early')).toBeInTheDocument();
    expect(screen.queryByText('Not rated · voided')).not.toBeInTheDocument();
  });

  it('prints the duration as minutes', () => {
    draw(game());
    expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '31 min'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b\d{1,2}:\d\d\b/);
  });

  it('shows KDA, damage, gold, CS and vision for every seat, and the winner tag', () => {
    draw(game());
    const red = screen.getByRole('region', { name: 'Red team' });
    const seats = within(red).getAllByRole('listitem');
    expect(seats).toHaveLength(5);
    const first = seats[0] as HTMLElement;
    for (const [term, value] of [
      ['KDA', '5/3/7'],
      ['Damage', '18.4k'],
      ['Gold', '11.2k'],
      ['CS', '182'],
      ['Vision', '24'],
    ] as const) {
      const dt = within(first).getByText(term, { selector: 'dt' });
      expect(dt.nextElementSibling).toHaveTextContent(value);
    }
    expect(within(red).getByText('Won')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Blue team' })).queryByText('Won'),
    ).not.toBeInTheDocument();
  });

  it('names the MVP and the ACE on their seats, and marks the viewer with a word', () => {
    const blue = team(
      100,
      false,
      PUUIDS.slice(0, 5).map((id, i) => seat(id, i, i === 2 ? { award: 'ace', isViewer: true } : {})),
    );
    const red = team(
      200,
      true,
      PUUIDS.slice(5, 10).map((id, i) => seat(id, i, i === 0 ? { award: 'mvp' } : {})),
    );
    draw(game({ blue, red }));
    const mvpSeat = within(screen.getByRole('region', { name: 'Red team' }))
      .getByText('MVP')
      .closest('li') as HTMLElement;
    expect(mvpSeat).toHaveTextContent('H4RDC0R33');
    const aceSeat = within(screen.getByRole('region', { name: 'Blue team' }))
      .getByText('ACE')
      .closest('li') as HTMLElement;
    expect(aceSeat).toHaveTextContent('Ramzyinhović');
    expect(within(aceSeat).getByText('You')).toBeInTheDocument();
    expect(within(aceSeat).getByText('(you)')).toBeInTheDocument();
  });

  it('a backfilled game shows pre-game odds and says Kustom did not pick the teams', () => {
    draw(
      game({
        receipt: {
          kind: 'pre-game',
          reason: 'no-split',
          ratingsBefore: RATINGS_KNOWN,
          rolled: null,
          kickoffBlueWinProb: null,
        },
      }),
    );
    expect(screen.getByRole('region', { name: 'Pre-game odds' })).toBeInTheDocument();
    expect(
      screen.getByText("Kustom didn't pick these teams. Odds from everyone's ratings going in."),
    ).toBeInTheDocument();
    expect(screen.queryByText('How the bot decided')).not.toBeInTheDocument();
  });

  it('teams changed after the roll: pre-game odds, the other line, and the rolled splits', () => {
    draw(
      game({
        receipt: {
          kind: 'pre-game',
          reason: 'teams-changed',
          ratingsBefore: RATINGS_KNOWN,
          rolled: THREE_SPLITS,
          kickoffBlueWinProb: null,
        },
      }),
    );
    expect(
      screen.getByText(
        'Teams changed in the lobby after the roll, so these are the odds for the teams that actually played.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('How the bot decided')).toBeInTheDocument();
  });

  it('a missing mu_before says No odds for this game and draws no receipt', () => {
    draw(
      game({
        receipt: {
          kind: 'pre-game',
          reason: 'no-split',
          ratingsBefore: RATINGS_MISSING,
          rolled: null,
          kickoffBlueWinProb: null,
        },
      }),
    );
    expect(screen.getByText('No odds for this game.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pre-game odds' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scoreboard' })).toBeInTheDocument();
  });

  it('an ARAM carries its label and makes no rating claim', () => {
    const blue = team(
      100,
      false,
      PUUIDS.slice(0, 5).map((id, i) => seat(id, i, { delta: null })),
    );
    const red = team(
      200,
      true,
      PUUIDS.slice(5, 10).map((id, i) => seat(id, i, { delta: null })),
    );
    draw(game({ aram: true, rated: false, receipt: { kind: 'none' }, blue, red }));
    expect(screen.getByText('ARAM')).toBeInTheDocument();
    expect(screen.getByText('No odds for this game.')).toBeInTheDocument();
    expect(screen.queryByText(/gained|lost/)).not.toBeInTheDocument();
  });
});

describe('M14.41 gap 5: scoreboard names link to their player pages', () => {
  it('every seat name is a link to /g/<slug>/p/<puuid>', () => {
    render(<GameDetail game={game()} backHref="/g/customs/games" group={{ id: 'g', slug: 'customs' }} />);
    const scoreboard = screen.getByRole('region', { name: 'Scoreboard' });
    const links = within(scoreboard).getAllByRole('link');
    expect(links).toHaveLength(10);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(PUUIDS.map((id) => `/g/customs/p/${id}`));
  });

  it('with no group, plain names (the kit and older callers)', () => {
    render(<GameDetail game={game()} backHref="/g/customs/games" />);
    expect(within(screen.getByRole('region', { name: 'Scoreboard' })).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('M14.58 / M14.59: why this many points, and the odds the rating used', () => {
  const blueFirst = PUUIDS[0] as string;
  const redFirst = PUUIDS[5] as string;
  const example: KustomReason = {
    track: 'all-time',
    gamesBefore: 30,
    allTime: null,
    parts: {
      side: 100,
      result: 'loss',
      expectedPct: 62,
      k: 16,
      firstTenGames: false,
      shareRank: 1,
      share: 0.8,
      award: 'ace',
      points: -8,
    },
  };
  const early: KustomReason = {
    track: 'all-time',
    gamesBefore: 3,
    allTime: null,
    parts: {
      side: 200,
      result: 'win',
      expectedPct: 50,
      k: 27.2,
      firstTenGames: true,
      shareRank: null,
      share: 1,
      award: 'none',
      points: 14,
    },
  };
  function breakdown(odds: GameBreakdown['odds'] = null): GameBreakdown {
    return {
      gameId: 'g-1',
      odds,
      reasons: new Map([
        [blueFirst, example],
        [redFirst, early],
      ]),
    };
  }
  const viewerGame = () =>
    game({
      blue: team(
        100,
        false,
        PUUIDS.slice(0, 5).map((id, i) => seat(id, i, i === 0 ? { delta: -8, isViewer: true } : {})),
      ),
    });

  it('the change is a closed disclosure button; opening it says the example sentence', () => {
    render(<GameDetail game={viewerGame()} backHref="/g/customs/games" breakdown={breakdown()} />);
    const button = screen.getByRole('button', { name: 'lost 8. Why?' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement;
    expect(panel).not.toBeVisible();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(withoutSrOnly(panel)).toHaveTextContent(
      'Your side lost as the 62% favourite, so the loss cost 16 × 62% = 10. You had the best game on your team (ACE), so you gave back least: ×0.8.',
    );
    expect(panel).toHaveTextContent('Upsets and first games move the most.');
  });

  it("a first-ten game with no performance score, in the player's name", () => {
    render(<GameDetail game={game()} backHref="/g/customs/games" breakdown={breakdown()} />);
    const name = FIXTURE_NAMES[redFirst] as string;
    const redTeam = screen.getByRole('region', { name: 'Red team' });
    fireEvent.click(within(redTeam).getByRole('button', { name: 'gained 14. Why?' }));
    expect(withoutSrOnly(redTeam)).toHaveTextContent(
      `It was an even game for ${name}'s side (50%), so the win was worth 27 × 50% = 14. This game couldn't be scored player by player, so everyone counts ×1. Their first 10 games count extra while their Rating finds its level (×27 instead of ×16).`,
    );
  });

  it('only the seats with a reason are buttons, and no sigma or decimal is ever printed', () => {
    render(<GameDetail game={game()} backHref="/g/customs/games" breakdown={breakdown()} />);
    const buttons = screen.getAllByRole('button', { name: /Why\?$/ });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) fireEvent.click(button);
    const text = visibleText(screen.getByRole('region', { name: 'Scoreboard' }));
    expect(text).not.toMatch(/sigma|σ/i);
    // The one decimal allowed is a share multiplier (`×0.8`, 05-design 11.6).
    expect(text.replace(/\d+\.\d+k/g, '').replace(/×\d\.\d/g, '')).not.toMatch(/\d\.\d/);
  });

  it('without a breakdown the changes are plain numbers', () => {
    draw(game());
    expect(screen.queryByRole('button', { name: /Why\?$/ })).not.toBeInTheDocument();
  });

  it("names the points number on the winner's side when they differ, and nothing extra when they agree", () => {
    const { unmount } = render(
      <GameDetail
        game={game()}
        backHref="/g/customs/games"
        breakdown={breakdown({
          botBluePct: 49,
          ratingBluePct: 55,
          differ: true,
          pointsBluePct: 55,
          ratingBlueWinProb: 0.55,
        })}
      />,
    );
    expect(screen.getByRole('region', { name: 'The odds were' })).toHaveTextContent(
      'For points, Red was 45%.',
    );
    unmount();
    render(
      <GameDetail
        game={game()}
        backHref="/g/customs/games"
        breakdown={breakdown({
          botBluePct: 49,
          ratingBluePct: 49,
          differ: false,
          pointsBluePct: 49,
          ratingBlueWinProb: 0.49,
        })}
      />,
    );
    expect(screen.getByRole('region', { name: 'The odds were' })).not.toHaveTextContent(/For points/);
  });

  it("a game the bot didn't pick draws the fold's stored number", () => {
    render(
      <GameDetail
        game={game({
          receipt: {
            kind: 'pre-game',
            reason: 'no-split',
            ratingsBefore: RATINGS_KNOWN,
            rolled: null,
            kickoffBlueWinProb: null,
          },
        })}
        backHref="/g/customs/games"
        breakdown={breakdown({
          botBluePct: null,
          ratingBluePct: 71,
          differ: false,
          pointsBluePct: 71,
          ratingBlueWinProb: 0.71,
        })}
      />,
    );
    expect(screen.getByRole('region', { name: 'Pre-game odds' })).toHaveTextContent(/71%/);
  });
});
