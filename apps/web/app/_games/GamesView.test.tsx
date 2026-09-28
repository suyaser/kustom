import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ACE_LABEL, MVP_LABEL, WINDOW_EMPTY } from '@/lib/board/copy';
import { GAMES_LABEL } from '@/lib/games/copy';
import type { GamesHistoryView } from '@/lib/games/types';
import { gamesHistoryView } from '@/lib/games/view';
import { gatedGameAward } from '@/lib/ingest/fold';
import type { StatsGame } from '@/lib/stats/types';
import {
  rosterFor,
  scoredSeats,
  statsGame,
  tenPlayerGame,
  withoutAwardColumns,
} from '@/lib/testing/statsFixtures';
import { GamesView } from './GamesView';

const WEEK = { start: new Date('2026-09-07T03:00:00Z'), end: new Date('2026-09-14T03:00:00Z') };

function history(options: { focusPuuid?: string | null } = {}): GamesHistoryView {
  const game = tenPlayerGame({
    id: 'g-1',
    at: '2026-09-09T20:00:00Z',
    durationS: 1_456,
    winner: 100,
    blue: [
      {
        key: 'hana',
        role: 'top',
        championId: 122,
        kills: 9,
        deaths: 6,
        assists: 5,
        cs: 154,
        gold: 12_000,
        damageToChamps: 31_115,
      },
    ],
    red: [
      {
        key: 'lena',
        role: 'adc',
        championId: 222,
        kills: 15,
        deaths: 5,
        assists: 6,
        cs: 28,
        gold: 25_527,
        damageToChamps: 35_685,
      },
    ],
  });
  return gamesHistoryView({
    window: 'this-week',
    games: [game],
    players: rosterFor([game]),
    range: WEEK,
    capped: false,
    cap: 2_000,
    timeZone: 'Africa/Cairo',
    focusPuuid: options.focusPuuid,
  });
}

describe('GamesView', () => {
  it('names the window and the page', () => {
    render(<GamesView history={history()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`This week ${GAMES_LABEL}`);
    expect(screen.getByText('Blue won')).toBeInTheDocument();
    expect(screen.getByText('9/6/5')).toBeInTheDocument();
  });

  it('keeps the scoreboard inside a closed details until it is opened', () => {
    const { container } = render(<GamesView history={history()} />);
    const card = container.querySelector('details');
    expect(card).not.toBeNull();
    expect(card).not.toHaveAttribute('open');
    expect(within(card as HTMLElement).getByText('Blue · 9')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('Darius')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('Jinx')).toBeInTheDocument();
  });

  it('links a name to that player and keeps the focused row as plain text', () => {
    render(<GamesView history={history({ focusPuuid: 'u-hana' })} />);
    expect(screen.getByText("Showing Hana's games.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Everyone' })).toHaveAttribute('href', '/games?window=this-week');
    expect(screen.getByRole('link', { name: "Summoner's Rift" })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'ARAM' })).toHaveAttribute(
      'href',
      '/games?window=this-week&p=u-hana&queue=aram',
    );
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Hana' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Lena' })[0]).toHaveAttribute('href', '/p/u-lena');
  });

  it('draws nothing under the strip on an empty window', () => {
    const empty = gamesHistoryView({
      window: 'last-week',
      games: [],
      players: [],
      range: { start: new Date('2026-08-31T03:00:00Z'), end: new Date('2026-09-07T03:00:00Z') },
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<GamesView history={empty} />);
    expect(screen.getByText(WINDOW_EMPTY['last-week'])).toBeInTheDocument();
    expect(screen.queryByText('Blue won')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ARAM' })).toHaveAttribute(
      'href',
      '/games?window=last-week&queue=aram',
    );
  });

  it('keeps ARAM on the Everyone link and the window chips', () => {
    const game = tenPlayerGame({
      id: 'g-aram',
      at: '2026-09-09T20:00:00Z',
      winner: 100,
      gameMode: 'ARAM',
      blue: [{ key: 'hana', role: 'top', kills: 9, deaths: 6, assists: 5 }],
      red: [{ key: 'lena', role: 'adc', kills: 15, deaths: 5, assists: 6 }],
    });
    render(
      <GamesView
        history={gamesHistoryView({
          window: 'this-week',
          games: [game],
          players: rosterFor([game]),
          range: WEEK,
          capped: false,
          cap: 2_000,
          timeZone: 'Africa/Cairo',
          focusPuuid: 'u-hana',
          queue: 'aram',
        })}
      />,
    );
    expect(screen.getByRole('link', { name: 'ARAM' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Everyone' })).toHaveAttribute(
      'href',
      '/games?window=this-week&queue=aram',
    );
    expect(screen.getByRole('link', { name: 'Last week' })).toHaveAttribute(
      'href',
      '/games?window=last-week&p=u-hana&queue=aram',
    );
  });
});

/**
 * M7.23: the word beside the name in the opened scoreboard, M7.10's dress, and nothing else.
 */
describe('GamesView MVP / ACE (M7.23)', () => {
  function page(game: StatsGame, focusPuuid: string | null = null) {
    return render(
      <GamesView
        history={gamesHistoryView({
          window: 'this-week',
          games: [game],
          players: rosterFor([game]),
          range: WEEK,
          capped: false,
          cap: 2_000,
          timeZone: 'Africa/Cairo',
          focusPuuid,
        })}
      />,
    );
  }

  const scored = () =>
    statsGame({ id: 'g-scored', at: '2026-09-09T20:00:00Z', winner: 100, ...scoredSeats() });

  it('prints MVP beside the named winner and ACE beside the named loser, once each', () => {
    const game = scored();
    const answer = gatedGameAward(game.rows, game.durationS, game.winningSide);
    const { container } = page(game);

    const words = [...container.querySelectorAll('.cn-game-award')];
    expect(words.map((word) => word.textContent)).toEqual([` ${MVP_LABEL}`, ` ${ACE_LABEL}`]);
    const rowOf = (label: string) =>
      words.find((word) => word.textContent?.trim() === label)?.closest('.cn-sheet-row') as HTMLElement;
    const nameOf = (puuid: string | undefined) =>
      rosterFor([game]).find((p) => p.puuid === puuid)?.name ?? '';
    expect(within(rowOf(MVP_LABEL)).getByRole('link', { name: nameOf(answer?.mvp) })).toBeInTheDocument();
    expect(within(rowOf(ACE_LABEL)).getByRole('link', { name: nameOf(answer?.ace) })).toBeInTheDocument();
    expect(rowOf(MVP_LABEL).closest('.cn-sheet-blue')).not.toBeNull();
    expect(rowOf(ACE_LABEL).closest('.cn-sheet-red')).not.toBeNull();
  });

  it('dresses the word as the word: no icon, no badge, no trophy, no "#1"', () => {
    const { container } = page(scored());
    for (const word of container.querySelectorAll('.cn-game-award')) {
      expect(word.children).toHaveLength(0);
      expect(word.getAttribute('style')).toBeNull();
      expect(word.className).toBe('cn-game-award');
      expect(word.textContent).toMatch(/^ (MVP|ACE)$/);
    }
    expect(container.textContent).not.toMatch(/#1|\u{1F3C6}|\u{2B50}/u);
  });

  it("keeps the word on the focused player's own row as plain text", () => {
    const game = scored();
    const answer = gatedGameAward(game.rows, game.durationS, game.winningSide);
    const { container } = page(game, answer?.mvp ?? null);
    const you = container.querySelector('.cn-sheet-row.cn-you') as HTMLElement;
    expect(you.querySelector('.cn-game-award')?.textContent?.trim()).toBe(MVP_LABEL);
  });

  it('prints neither word on a game with no award, and leaves its markup as it was', () => {
    for (const game of [
      statsGame({ id: 'g-x', at: '2026-09-09T20:00:00Z', ...scoredSeats(), unrated: true }),
      statsGame({ id: 'g-x', at: '2026-09-09T20:00:00Z', ...scoredSeats(), durationS: 200 }),
      withoutAwardColumns(scored()),
    ]) {
      const { container, unmount } = page(game);
      expect(container.querySelector('.cn-game-award')).toBeNull();
      expect(container.querySelector('.cn-sheet-name')).toBeNull();
      expect(container.textContent).not.toMatch(/\b(MVP|ACE)\b/);
      unmount();
    }
  });
});
