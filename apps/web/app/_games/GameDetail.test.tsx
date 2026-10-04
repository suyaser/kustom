import type { DeltaReason } from '@customs/core';
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
import type { DetailSeat, DetailTeam, GameDetailView } from '@/lib/games/detail';

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
    aram: false,
    rated: true,
    blue: team(100, false),
    red: team(200, true),
    receipt: {
      kind: 'rolled',
      splits: THREE_SPLITS,
      chosen: THREE_SPLITS[0] as (typeof THREE_SPLITS)[number],
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

  it('prints the duration as minutes', () => {
    draw(game());
    expect(screen.getByText('31 min')).toBeInTheDocument();
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
      game({ receipt: { kind: 'pre-game', reason: 'no-split', ratingsBefore: RATINGS_KNOWN, rolled: null } }),
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
        receipt: { kind: 'pre-game', reason: 'no-split', ratingsBefore: RATINGS_MISSING, rolled: null },
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
  const example: DeltaReason = {
    basis: 'stored',
    result: 'lost',
    points: -50,
    basePoints: -62,
    odds: { pct: 62, stance: 'favourite' },
    certainty: 'settled',
    award: { kind: 'ace', effect: 12, fraction: 0.2 },
  };
  const old: DeltaReason = {
    basis: 'legacy',
    result: 'won',
    points: 14,
    odds: { pct: 50, stance: 'even' },
    certainty: 'new',
    award: 'unknown',
  };
  function breakdown(odds: GameBreakdown['odds'] = null): GameBreakdown {
    return {
      gameId: 'g-1',
      odds,
      reasons: new Map([
        [blueFirst, example],
        [redFirst, old],
      ]),
    };
  }
  const viewerGame = () =>
    game({
      blue: team(
        100,
        false,
        PUUIDS.slice(0, 5).map((id, i) => seat(id, i, i === 0 ? { delta: -50, isViewer: true } : {})),
      ),
    });

  it('the change is a closed disclosure button; opening it says the example sentence', () => {
    render(<GameDetail game={viewerGame()} backHref="/g/customs/games" breakdown={breakdown()} />);
    const button = screen.getByRole('button', { name: 'lost 50. Why?' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement;
    expect(panel).not.toBeVisible();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent(
      "You lost 50. Your side was the 62% favourite, so a loss costs more. You're settled, so swings are small. ACE softened it by a fifth.",
    );
    expect(panel).toHaveTextContent('Upsets and new players move the most.');
  });

  it("an old game says the bonus isn't included, in the player's name", () => {
    render(<GameDetail game={game()} backHref="/g/customs/games" breakdown={breakdown()} />);
    const name = FIXTURE_NAMES[redFirst] as string;
    const redTeam = screen.getByRole('region', { name: 'Red team' });
    fireEvent.click(within(redTeam).getByRole('button', { name: 'gained 14. Why?' }));
    expect(redTeam).toHaveTextContent(
      `${name} won 14. It was an even game. They're new, so their number moves fast. This game is from before Kustom kept the bonus, so MVP or ACE isn't included.`,
    );
  });

  it('only the seats with a reason are buttons, and no sigma or decimal is ever printed', () => {
    render(<GameDetail game={game()} backHref="/g/customs/games" breakdown={breakdown()} />);
    const buttons = screen.getAllByRole('button', { name: /Why\?$/ });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) fireEvent.click(button);
    const text = screen.getByRole('region', { name: 'Scoreboard' }).textContent ?? '';
    expect(text).not.toMatch(/sigma|σ/i);
    expect(text.replace(/\d+\.\d+k/g, '')).not.toMatch(/\d\.\d/);
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
          reason: 'new-players',
          pointsBluePct: 55,
          ratingBlueWinProb: 0.55,
        })}
      />,
    );
    expect(screen.getByRole('region', { name: 'The odds were' })).toHaveTextContent(
      'For points, Red was 45%, because new players start at 1200.',
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
          reason: null,
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
          receipt: { kind: 'pre-game', reason: 'no-split', ratingsBefore: RATINGS_KNOWN, rolled: null },
        })}
        backHref="/g/customs/games"
        breakdown={breakdown({
          botBluePct: null,
          ratingBluePct: 71,
          differ: false,
          reason: null,
          pointsBluePct: 71,
          ratingBlueWinProb: 0.71,
        })}
      />,
    );
    expect(screen.getByRole('region', { name: 'Pre-game odds' })).toHaveTextContent(/71%/);
  });
});
