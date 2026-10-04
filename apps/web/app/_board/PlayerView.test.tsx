import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';
import { AiRecap } from '@/components/ai/AiRecap';
import { AI_SCOUTING_LABEL, AI_SCOUTING_TAP } from '@/lib/ai/recapCopy';
import type { PlayerBoardView, RecentGame } from '@/lib/board/types';
import type { KustomReason } from '@/lib/breakdown/read';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { workedPlayer, workedRecentGame } from '@/lib/testing/boardFixtures';
import { visibleText, withoutSrOnly } from '@/lib/testing/visibleText';
import { workedPuuid } from '@/lib/testing/workedExample';
import { PlayerView, type PlayerViewProps } from './PlayerView';

/**
 * The player page in its two lenses (M14.15; STRATEGY §5, §6(b), §6(b3)). Role and text queries
 * only.
 */

const HANA = workedPuuid('Hana');

function draw(player: PlayerBoardView = workedPlayer(), overrides: Partial<PlayerViewProps> = {}) {
  return render(
    <PlayerView
      lens="public"
      player={player}
      group={ORIGINAL_GROUP}
      viewerPuuid={null}
      path={`/g/customs/p/${player.puuid}`}
      gameHref={(gameId) => `/g/customs/games/${gameId}` as Route}
      allGamesHref={`/g/customs/games?player=${player.puuid}` as Route}
      timeZone="Africa/Cairo"
      {...overrides}
    />,
  );
}

describe('the public lens', () => {
  it('is the name as the one h1, the window chips with All time current, and one big Rating', () => {
    const player = workedPlayer();
    draw(player);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hana');
    const nav = screen.getByRole('navigation', { name: 'Time window' });
    expect(within(nav).getByRole('link', { name: 'All time' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'This week' })).toHaveAttribute(
      'href',
      `/g/customs/p/${HANA}?window=this-week`,
    );
    expect(screen.getByText(String(player.rating))).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '19W 18L · 37 games'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/proven|ordinal/i);
  });

  it('says where the rating started and draws the trend as an image with words', () => {
    const player = workedPlayer();
    draw(player);
    expect(screen.getByText(`Started at ${player.reference}, 37 rated games since.`)).toBeInTheDocument();
    const chart = screen.getByRole('img');
    expect(chart).toHaveAccessibleName(
      `Rating went from ${player.history[0]} to ${player.history.at(-1)} over 3 rated games.`,
    );
  });

  it('carries the settling chip under 10 rated games, and none at 10', () => {
    draw(workedPlayer('Hana', { ratedGames: 9, settling: true, games: 9, wins: 5, losses: 4 }));
    expect(screen.getByText('settling · 9/10')).toBeInTheDocument();
  });

  it('carries no chip at 10 rated games', () => {
    draw(workedPlayer('Hana', { ratedGames: 10, settling: false, games: 10, wins: 5, losses: 5 }));
    expect(screen.queryByText(/settling ·/)).not.toBeInTheDocument();
  });

  it('is the new-player state with no game in the group', () => {
    draw(
      workedPlayer('Hana', {
        games: 0,
        wins: 0,
        losses: 0,
        ratedGames: 0,
        settling: true,
        range: null,
        history: [],
        recent: [],
      }),
    );
    expect(
      screen.getByText('No games with Customs Night yet. Their first one shows up here.'),
    ).toBeInTheDocument();
    expect(screen.getByText('settling · 0/10')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent games' })).not.toBeInTheDocument();
  });

  it("puts the YOU sticker on the viewer's own public page", () => {
    draw(workedPlayer(), { viewerPuuid: HANA });
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('M18.7: a week tab leads with Points this week, the all-time Rating in the meta line (11.5)', () => {
    const player = workedPlayer('Hana', {
      window: 'this-week',
      track: 'week',
      points: 86,
      games: 7,
      wins: 5,
      losses: 2,
      settling: false,
      reference: 0,
      history: [0, 19, 3, 86],
    });
    const { container } = draw(player);
    const lead = container.querySelector('[data-slot="week-points"]');
    expect(visibleText(lead)).toBe('Points this week+86');
    expect(within(lead as HTMLElement).getByText('gained 86')).toBeInTheDocument();
    expect(visibleText(container.querySelector('[data-slot="week-meta"]'))).toBe(
      `7 games · 5W 2L · Rating ${player.rating}`,
    );
    // No `Started the week at` line: every week starts at 0 and the note says so.
    expect(screen.queryByText(/Started the week at/)).toBeNull();
    // The chart's reference line is `Week start`, and its words are the week's points.
    expect(screen.getByText('Week start')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Points this week went from 0 to +86 over 3 rated games.',
    );
  });

  it('M18.7: a week with no game keeps the Rating card and prints no ±0', () => {
    draw(
      workedPlayer('Hana', {
        window: 'this-week',
        track: 'week',
        points: 0,
        games: 0,
        wins: 0,
        losses: 0,
        settling: false,
        history: [],
        recent: [],
      }),
    );
    expect(screen.queryByText('Points this week')).toBeNull();
    expect(document.body.textContent).not.toContain('±0');
  });

  it('prints a week with its points note and no settling chip', () => {
    draw(workedPlayer('Hana', { window: 'this-week', track: 'week', points: 86, settling: false }));
    expect(
      screen.getByText(/Everyone starts each week at zero and only that week's games count\. Rating is/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/settling ·/)).not.toBeInTheDocument();
  });
});

describe('M14.58 / M14.59: each game explains its change', () => {
  const reason: KustomReason = {
    track: 'all-time',
    gamesBefore: 36,
    allTime: null,
    parts: {
      side: 100,
      result: 'loss',
      expectedPct: 58,
      k: 16,
      firstTenGames: false,
      shareRank: 3,
      share: 1,
      award: 'none',
      points: -42,
    },
  };
  const gap = {
    botBluePct: 58,
    ratingBluePct: 63,
    differ: true,
    pointsBluePct: 63,
    ratingBlueWinProb: 0.63,
  };

  it("the change is a button beside the row's link; it opens the reason in the player's name", () => {
    draw(workedPlayer('Hana', { recent: [workedRecentGame({ reason, odds: gap })] }));
    const button = screen.getByRole('button', { name: 'lost 42. Why?' });
    expect(within(screen.getByRole('link', { name: /Lost/ })).queryByRole('button')).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(withoutSrOnly(button.closest('li'))).toHaveTextContent(
      "Hana's side lost as the 58% favourite, so the loss cost 16 × 58% = 9. Their game was 3rd best on their team: ×1.",
    );
  });

  it('says You on your own page', () => {
    draw(workedPlayer('Hana', { recent: [workedRecentGame({ reason })] }), { viewerPuuid: HANA });
    fireEvent.click(screen.getByRole('button', { name: 'lost 42. Why?' }));
    expect(screen.getByText(/Your side lost as the/)).toBeInTheDocument();
  });

  it("the history line names the points number on the winner's side when they differ", () => {
    draw(workedPlayer('Hana', { recent: [workedRecentGame({ reason, odds: gap })] }));
    expect(screen.getByRole('link', { name: /Lost/ })).toHaveTextContent('For points, Red was 37%.');
  });

  it('a game with no reason keeps a plain number', () => {
    draw();
    expect(screen.queryByRole('button', { name: /Why\?$/ })).toBeNull();
  });
});

describe('the games list', () => {
  it('links each game to its page, with the result word, the date, minutes and the compact receipt', () => {
    draw();
    const list = screen.getByRole('heading', { name: 'Recent games' }).closest('section') as HTMLElement;
    const row = within(list).getByRole('link', { name: /Lost/ });
    expect(row).toHaveAttribute('href', '/g/customs/games/game-1');
    expect(row).toHaveTextContent('8 Sep · 34 min');
    expect(row).not.toHaveTextContent('34:12');
    // Hana was blue, blue was 58%, red won: the compact receipt says it from the winner's side,
    // and red at 42% winning is an upset.
    expect(within(row).getByText('Red was 42%. Red won.')).toBeInTheDocument();
    expect(within(row).getByText('Upset')).toBeInTheDocument();
    // M14.58: the change sits beside the link (it is its own button), in the same row.
    expect(within(row.closest('li') as HTMLElement).getByText('lost 42')).toBeInTheDocument();
  });

  it('marks a reroll, an MVP, an unrated game and an ARAM', () => {
    draw(
      workedPlayer('Hana', {
        recent: [
          workedRecentGame({ gameId: 'g-reroll', pickRank: 2, won: true, winningSide: 100, award: 'mvp' }),
          workedRecentGame({ gameId: 'g-aram', aram: true, rBefore: null, rAfter: null }),
        ],
      }),
    );
    const reroll = screen.getByRole('link', { name: /Won/ });
    expect(within(reroll).getByText('pick #2')).toBeInTheDocument();
    expect(within(reroll.closest('li') as HTMLElement).getByText('MVP')).toBeInTheDocument();
    const aram = screen.getByRole('link', { name: /ARAM/ });
    expect(within(aram.closest('li') as HTMLElement).getByText('not rated')).toBeInTheDocument();
    expect(screen.getByText(/Some games don't move ratings/)).toBeInTheDocument();
  });

  it("shows pre-game odds for a game with no split, and nothing when anyone's rating is missing", () => {
    // M18.5: the pre-game odds read the all-time Kustom Rating going in (`r_before`).
    const seat = { r: 1500 };
    draw(
      workedPlayer('Hana', {
        recent: [
          workedRecentGame({
            gameId: 'g-backfill',
            blueWinProb: null,
            pickRank: null,
            ratingsBefore: { blue: Array(5).fill(seat), red: Array(5).fill(seat) },
          }),
          workedRecentGame({
            gameId: 'g-unknown',
            blueWinProb: null,
            pickRank: null,
            ratingsBefore: {
              blue: Array(5).fill(seat),
              red: [...Array(4).fill(seat), { r: null }],
            },
          }),
        ],
      }),
    );
    const [backfill, unknown] = screen.getAllByRole('link', { name: /Lost/ });
    expect(backfill).toHaveTextContent('50–50. Red won.');
    expect(unknown).not.toHaveTextContent(/won\./);
  });

  it('ends with the way to all their games', () => {
    draw();
    expect(screen.getByRole('link', { name: 'All their games' })).toHaveAttribute(
      'href',
      `/g/customs/games?player=${HANA}`,
    );
  });
});

describe('the self lens', () => {
  it("is STRATEGY §6(b3)'s header: the name, YOU, and three tiles, then the trend and the games", () => {
    const player = workedPlayer();
    draw(player, { lens: 'self', viewerPuuid: HANA, tonightDelta: 38 });
    expect(screen.getByText('You in Customs Night')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hana');
    expect(screen.getByText('You')).toBeInTheDocument();
    const tiles = screen.getByText('Rating, #4').closest('dl') as HTMLElement;
    expect(within(tiles).getByText('Rating, #4')).toBeInTheDocument();
    expect(within(tiles).getByText(String(player.rating))).toBeInTheDocument();
    expect(within(tiles).getByText('19W 18L')).toBeInTheDocument();
    expect(within(tiles).getByText('37 games')).toBeInTheDocument();
    expect(within(tiles).getByText('tonight')).toBeInTheDocument();
    expect(within(tiles).getByText('gained 38')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All your games' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Time window' })).not.toBeInTheDocument();
  });

  it('shows the settling chip instead of a rank, and no tonight tile without a game tonight', () => {
    draw(workedPlayer('Hana', { ratedGames: 4, settling: true, rank: null }), {
      lens: 'self',
      viewerPuuid: HANA,
      tonightDelta: null,
    });
    expect(screen.getByText('settling · 4/10')).toBeInTheDocument();
    expect(screen.queryByText(/Rating, #/)).not.toBeInTheDocument();
    expect(screen.queryByText('tonight')).not.toBeInTheDocument();
  });

  it('prints the same Rating, record and games as the public lens of the same player (acceptance 13)', () => {
    const player = workedPlayer();
    const pub = draw(player).container.textContent ?? '';
    document.body.innerHTML = '';
    const self = draw(player, { lens: 'self', viewerPuuid: HANA }).container.textContent ?? '';
    for (const text of [pub, self]) {
      expect(text).toContain(String(player.rating));
      expect(text).toContain('37 games');
    }
    expect(pub).toContain('19W 18L');
    expect(self).toContain('19W 18L');
  });

  it('says no games yet for a linked player with none in the group', () => {
    draw(
      workedPlayer('Hana', {
        games: 0,
        wins: 0,
        losses: 0,
        ratedGames: 0,
        history: [],
        recent: [],
        rank: null,
      }),
      { lens: 'self', viewerPuuid: HANA },
    );
    expect(
      screen.getByText('No games with this group yet. Your first one shows up here.'),
    ).toBeInTheDocument();
  });
});

describe('the AI scouting report (M16.6)', () => {
  const TEXT = 'Hana means Lee Sin: 31 games on it at 68 percent. Over the week Hana went 6 wins in 9 games.';
  const report = (canHide: boolean) => (
    <AiRecap
      recap={{ kind: 'line', lineId: '10000000-0000-4000-8000-0000000000c1', text: TEXT }}
      groupId="00000000-0000-4000-8000-00000000000a"
      label={AI_SCOUTING_LABEL}
      tap={AI_SCOUTING_TAP}
      footnote="Written Sunday 4 Oct"
      canHide={canHide}
      hideRedirect="/g/customs/p/x"
    />
  );
  const stats = <section aria-label="Records">records</section>;
  const follows = (a: Node, b: Node) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('sits under the header block, above the records, labelled, with its written date', () => {
    draw(workedPlayer(), { scouting: report(false), stats });
    const section = screen.getByRole('region', { name: AI_SCOUTING_LABEL });
    expect(within(section).getByText(TEXT)).toBeInTheDocument();
    expect(within(section).getByText('Written Sunday 4 Oct')).toBeInTheDocument();
    expect(within(section).getByText(AI_SCOUTING_TAP)).toBeInTheDocument();
    expect(follows(screen.getByText(/^Started at /), section)).toBe(true);
    expect(follows(section, screen.getByRole('region', { name: 'Records' }))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
  });

  it("an admin gets Hide beside it; a member doesn't", () => {
    draw(workedPlayer(), { scouting: report(true) });
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('is never drawn for a settling player', () => {
    draw(workedPlayer('Hana', { ratedGames: 9, settling: true, games: 9, wins: 5, losses: 4 }), {
      scouting: report(true),
    });
    expect(screen.queryByRole('region', { name: AI_SCOUTING_LABEL })).not.toBeInTheDocument();
  });

  it('on /you (self lens): under the trend, above the games, no Hide; none while settling', () => {
    draw(workedPlayer(), { lens: 'self', viewerPuuid: HANA, scouting: report(false) });
    const section = screen.getByRole('region', { name: AI_SCOUTING_LABEL });
    expect(within(section).getByText(TEXT)).toBeInTheDocument();
    expect(within(section).getByText('Written Sunday 4 Oct')).toBeInTheDocument();
    expect(follows(screen.getByRole('img'), section)).toBe(true);
    expect(follows(section, screen.getByRole('heading', { name: /games/i }))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
    cleanup();
    draw(workedPlayer('Hana', { ratedGames: 9, settling: true, games: 9, wins: 5, losses: 4 }), {
      lens: 'self',
      viewerPuuid: HANA,
      scouting: report(false),
    });
    expect(screen.queryByRole('region', { name: AI_SCOUTING_LABEL })).not.toBeInTheDocument();
  });

  it('draws nothing at all when the page passes none (a group without Premium)', () => {
    draw(workedPlayer());
    expect(document.body.textContent).not.toMatch(/AI scouting report|AI recap|Premium/);
  });
});

describe('M18.7: the week tab (05-design 11.5, 11.6.3)', () => {
  const firstOfWeek: KustomReason = {
    track: 'week',
    gamesBefore: 0,
    allTime: { points: 8, rating: 1300 },
    parts: {
      side: 200,
      result: 'win',
      expectedPct: 50,
      k: 32,
      firstTenGames: true,
      shareRank: 1,
      share: 1.2,
      award: 'mvp',
      points: 19,
    },
  };
  const thirdOfWeek: KustomReason = {
    track: 'week',
    gamesBefore: 2,
    allTime: { points: 7, rating: 1307 },
    parts: {
      side: 200,
      result: 'win',
      expectedPct: 56,
      k: 28.8,
      firstTenGames: true,
      shareRank: 3,
      share: 1,
      award: 'none',
      points: 13,
    },
  };
  const allTimeReason: KustomReason = {
    track: 'all-time',
    gamesBefore: 30,
    allTime: null,
    parts: { ...firstOfWeek.parts, expectedPct: 56, k: 16, firstTenGames: false, points: 8 },
  };
  // Three games, newest first: +13, −16, +19 printed weekly changes; the week reads +16.
  const games = [
    workedRecentGame({
      gameId: 'g3',
      side: 200,
      winningSide: 200,
      won: true,
      blueWinProb: 0.44,
      rBefore: 1300.4,
      rAfter: 1307.2,
      weekRBefore: 1203.1,
      weekRAfter: 1216.4,
      reason: thirdOfWeek,
    }),
    workedRecentGame({
      gameId: 'g2',
      side: 100,
      winningSide: 200,
      won: false,
      rBefore: 1308,
      rAfter: 1300.4,
      weekRBefore: 1219.2,
      weekRAfter: 1203.1,
      reason: null,
    }),
    workedRecentGame({
      gameId: 'g1',
      side: 200,
      winningSide: 200,
      won: true,
      blueWinProb: 0.44,
      award: 'mvp',
      rBefore: 1291.6,
      rAfter: 1300,
      weekRBefore: 1200,
      weekRAfter: 1219.2,
      reason: firstOfWeek,
    }),
  ];
  const weekPlayer = (overrides: Partial<PlayerBoardView> = {}) =>
    workedPlayer('Hana', {
      window: 'this-week',
      track: 'week',
      points: 16,
      games: 3,
      wins: 2,
      losses: 1,
      settling: false,
      reference: 0,
      history: [0, 19, 3, 16],
      weekTotal: 16,
      recent: games,
      ...overrides,
    });
  const openPanel = (name: string): HTMLElement => {
    const button = screen.getByRole('button', { name });
    fireEvent.click(button);
    return document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement;
  };
  const gameRows = () =>
    within(screen.getByRole('region', { name: 'Recent games' })).getAllByRole('listitem');
  /** A row as it reads closed: no spoken words, no (hidden) Why panel. */
  const rowText = (row: HTMLElement): string => {
    const clone = withoutSrOnly(row);
    for (const panel of Array.from(clone.querySelectorAll('[data-slot="why-panel"]'))) panel.remove();
    return clone.textContent ?? '';
  };

  it('prints only the weekly change per game under a This week label, and the total equals the header', () => {
    const { container } = draw(weekPlayer(), { viewerPuuid: HANA });
    expect(visibleText(container.querySelector('[data-slot="week-column-label"]'))).toBe('This week');
    const changes = gameRows().map((row) => rowText(row).match(/[+−]\d+/g));
    // One change per row, and no all-time Rating after (that lives on All time).
    expect(changes).toEqual([['+13'], ['−16'], ['+19']]);
    expect(gameRows().map((row) => /\b1[23]\d\d\b/.test(rowText(row)))).toEqual([false, false, false]);
    const sum = changes.reduce((total, found) => total + Number((found?.[0] ?? '0').replace('−', '-')), 0);
    expect(sum).toBe(16);
    expect(visibleText(container.querySelector('[data-slot="week-total"]'))).toBe('Week total+16');
    expect(visibleText(container.querySelector('[data-slot="week-points"]'))).toBe('Points this week+16');
  });

  it('says the track in every spoken change', () => {
    draw(weekPlayer(), { viewerPuuid: HANA });
    expect(screen.getByRole('button', { name: 'gained 19 this week. Why?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'gained 13 this week. Why?' })).toBeInTheDocument();
    expect(screen.getByText('lost 16 this week')).toBeInTheDocument();
    expect(
      screen.getByText('16 points this week', { selector: '[data-slot="week-total"] *' }),
    ).toBeInTheDocument();
  });

  it("explains the weekly change with the week's numbers, then the all-time change in one labelled clause", () => {
    draw(weekPlayer(), { viewerPuuid: HANA });
    const panel = openPanel('gained 19 this week. Why?');
    expect(withoutSrOnly(panel)).toHaveTextContent(
      "On this week's numbers it was an even game (50%), so the win was worth 32 × 50% = 16. You had the best game on your team (MVP): ×1.2. Everyone's first 10 games of a week count extra (×32 instead of ×16). All time: +8, to 1300.",
    );
  });

  it("drops On this week's numbers when the week's odds are the row's printed roll odds", () => {
    draw(weekPlayer(), { viewerPuuid: HANA });
    // Red was 56% on the row (blue 44%), and the week's own odds said 56% too.
    expect(withoutSrOnly(openPanel('gained 13 this week. Why?'))).toHaveTextContent(
      /^Your side won as the 56% favourite/,
    );
  });

  it('a paged week (no weekTotal) drops the total row', () => {
    const { container } = draw(weekPlayer({ weekTotal: null }));
    expect(container.querySelector('[data-slot="week-total"]')).toBeNull();
  });

  it('All time keeps the Rating after and the all-time change, with no week clause and no column label', () => {
    const lastGame = games[2] as RecentGame;
    const { container } = draw(workedPlayer('Hana', { recent: [{ ...lastGame, reason: allTimeReason }] }), {
      viewerPuuid: HANA,
    });
    expect(container.querySelector('[data-slot="week-column-label"]')).toBeNull();
    expect(rowText(gameRows()[0] as HTMLElement)).toContain('1300');
    const panel = openPanel('gained 8. Why?');
    expect(withoutSrOnly(panel)).toHaveTextContent(
      'Your side won as the 56% favourite, so the win was worth 16 × 44% = 7. You had the best game on your team (MVP): ×1.2.',
    );
    expect(panel.textContent).not.toContain('All time:');
  });
});
