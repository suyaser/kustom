import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';
import { AiRecap } from '@/components/ai/AiRecap';
import { AI_SCOUTING_LABEL, AI_SCOUTING_TAP } from '@/lib/ai/recapCopy';
import type { PlayerBoardView } from '@/lib/board/types';
import type { KustomReason } from '@/lib/breakdown/read';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { workedPlayer, workedRecentGame } from '@/lib/testing/boardFixtures';
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

  it('M14.57: a week tab says +86 this week · W-L beside the all-time Rating', () => {
    draw(
      workedPlayer('Hana', {
        window: 'this-week',
        track: 'week',
        points: 86,
        wins: 5,
        losses: 2,
        settling: false,
      }),
    );
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '+86gained 86 this week · 5W 2L'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/games ·/)).toBeNull();
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
    expect(button.closest('li')).toHaveTextContent(
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
