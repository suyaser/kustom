import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { assembleFunFacts } from '@/lib/stats/funView';
import { groupHasRoasts } from '@/lib/stats/roasts';
import { parseStatsParams, segmentHref, windowHref } from '@/lib/stats/segment';
import type { StatsGame } from '@/lib/stats/types';
import { statsView } from '@/lib/stats/view';
import { puuidOf, rosterFor, type Seat, statsGame } from '@/lib/testing/statsFixtures';
import { versusView } from '@/lib/versus/view';
import { ChampionsSegment } from './ChampionsSegment';
import type { StatsLinks } from './parts';
import { RecordsSegment } from './RecordsSegment';
import { StatsFrame } from './StatsFrame';
import { VersusSegment } from './VersusSegment';

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const BLUE = ['hana', 'iris', 'omar', 'lena', 'theo'];
const RED = ['yuki', 'mira', 'rami', 'sara', 'noor'];

/** Twelve Rift games of the same ten, a different champion in every seat so `Most picked` is long. */
function month(): StatsGame[] {
  return Array.from({ length: 12 }, (_, g) => {
    const seat = (key: string, i: number, side: 0 | 1): Seat => ({
      key,
      role: ROLES[i],
      championId: 1 + ((g * 10 + i + side * 5) % 60),
      kills: (g + i) % 9,
      deaths: 1 + ((g + i + side) % 7),
      assists: (g * 3 + i) % 15,
      gold: 9_000 + i * 500,
      damageToChamps: 10_000 + ((g * 977 + i * 331) % 20_000),
      cs: 100 + i * 20,
      visionScore: 20,
      damageSelfMitigated: 8_000,
      damageToObjectives: 3_000,
    });
    return statsGame({
      id: `game-${g}`,
      at: `2026-09-${String(g + 2).padStart(2, '0')}T20:00:00Z`,
      winner: g % 3 === 0 ? 200 : 100,
      blue: BLUE.map((key, i) => seat(key, i, 0)),
      red: RED.map((key, i) => seat(key, i, 1)),
    });
  });
}

const RANGE = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };

function views(options: { left?: string; right?: string } = {}) {
  const games = month();
  const players = rosterFor(games);
  const input = { window: 'all-time' as const, games, players, range: RANGE, capped: false, cap: 2_000 };
  return {
    stats: statsView(input),
    fun: assembleFunFacts(input, 'sr'),
    versus: versusView({
      ...input,
      ...(options.left === undefined ? {} : { leftPuuid: options.left }),
      ...(options.right === undefined ? {} : { rightPuuid: options.right }),
    }),
  };
}

function links(expanded: string | null = null, roasts = false): StatsLinks {
  return {
    player: (puuid) => `/g/x/p/${puuid}`,
    game: (id) => `/g/x/games/${id}`,
    playerGames: (puuid) => `/g/x/games?window=all-time&player=${puuid}`,
    showAll: (id) => `/g/x/stats?all=${id}#${id}`,
    showFewer: (id) => `/g/x/stats#${id}`,
    expanded,
    roasts,
  };
}

const h2s = (container: HTMLElement): string[] =>
  within(container)
    .queryAllByRole('heading', { level: 2 })
    .map((h) => h.textContent ?? '');

describe('Stats segments (M14.17)', () => {
  it('put no section in two segments, and the duos block only in 1v1 (acceptance 11)', () => {
    const { stats, fun, versus } = views();
    const records = h2s(render(<RecordsSegment stats={stats} fun={fun} links={links()} />).container);
    const champions = h2s(render(<ChampionsSegment fun={fun} links={links()} />).container);
    const oneVsOne = h2s(
      render(
        <VersusSegment versus={versus} stats={stats} fun={fun} links={links()} action="/g/x/stats/1v1" />,
      ).container,
    );
    const all = [...records, ...champions, ...oneVsOne];
    expect(new Set(all).size).toBe(all.length);
    expect(records).toEqual(
      expect.arrayContaining(['One game', 'Luck', 'Won against the odds', 'By role', 'Streaks']),
    );
    // No draft in the fixture: Champions leads with what was picked and says the bans once.
    expect(champions).toEqual(['Most picked', 'Who they lock']);
    expect(screen.getByText('No draft bans in this window.')).toBeInTheDocument();
    expect(oneVsOne).toEqual(
      expect.arrayContaining(['Pick two', 'Duos', 'Lane bully', 'Dead heat', 'Lane wars']),
    );
    // The retired second and third duos blocks.
    expect(screen.queryByText('Best duo')).not.toBeInTheDocument();
    expect(screen.queryByText('Friends and enemies')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Duos' })).toHaveLength(1);
  });

  it('opens Pick two filled from ?a=&b= (acceptance 12)', () => {
    const { stats, fun, versus } = views({ left: puuidOf('hana'), right: puuidOf('yuki') });
    render(<VersusSegment versus={versus} stats={stats} fun={fun} links={links()} action="/g/x/stats/1v1" />);
    expect(screen.getByRole('combobox', { name: 'Player one' })).toHaveValue(puuidOf('hana'));
    expect(screen.getByRole('combobox', { name: 'Player two' })).toHaveValue(puuidOf('yuki'));
    expect(screen.getByRole('combobox', { name: 'Player one' }).closest('form')).toHaveAttribute(
      'action',
      '/g/x/stats/1v1',
    );
    expect(screen.getByText('When they collide')).toBeInTheDocument();
  });

  it('never shows the same pair as best and worst together', () => {
    const { stats, fun, versus } = views();
    render(<VersusSegment versus={versus} stats={stats} fun={fun} links={links()} action="/g/x/stats/1v1" />);
    const duos = screen.getByRole('region', { name: 'Duos' });
    const pairsIn = (title: string): string[] => {
      const block = within(duos).getByRole('heading', { name: title }).parentElement
        ?.parentElement as HTMLElement;
      return within(block)
        .queryAllByRole('listitem')
        .map((li) => li.textContent ?? '');
    };
    const best = pairsIn('Best together');
    const worst = pairsIn('Worst together');
    expect(best.length).toBeGreaterThan(0);
    expect(worst.filter((line) => best.includes(line))).toEqual([]);
  });

  it('opens One game and folds every other Records section into a details with its count (the Records ruling)', () => {
    const { stats, fun } = views();
    const { container } = render(<RecordsSegment stats={stats} fun={fun} links={links()} />);
    const sections = [...container.querySelectorAll('details[id]')] as HTMLDetailsElement[];
    expect(sections.length).toBeGreaterThan(5);
    const oneGame = sections.find((section) => section.id === 'one-game');
    expect(oneGame?.open).toBe(true);
    expect(sections.filter((section) => section.id !== 'one-game').every((section) => !section.open)).toBe(
      true,
    );
    // The summary names the section and how many lines it holds.
    const summary = within(oneGame as HTMLElement)
      .getByRole('heading', { level: 2, name: 'One game' })
      .closest('summary');
    expect(summary?.textContent).toMatch(/One game.*\d+$/);
    // Each record is one row; its rule lives in `How these count`, once per section.
    expect(within(oneGame as HTMLElement).getByText('How these count')).toBeInTheDocument();
  });

  it('links a record to its game page instead of opening both scoreboards inline', () => {
    const { stats, fun } = views();
    render(<RecordsSegment stats={stats} fun={fun} links={links()} />);
    // A record is one row link to the game page it was set in: who · night · minutes.
    const gameLinks = screen
      .getAllByRole('link')
      .filter((link) => /^\/g\/x\/games\/game-\d+$/.test(link.getAttribute('href') ?? ''));
    expect(gameLinks.length).toBeGreaterThan(5);
    expect(gameLinks.some((link) => /\d{1,2} \w{3} · \d+ min/.test(link.textContent ?? ''))).toBe(true);
    expect(document.body.textContent).not.toMatch(/\b\d{1,2}:\d\d\b(?! )/);
    expect(screen.queryByText('Scoreboard')).not.toBeInTheDocument();
  });

  it('shows the top three per role with a See all link, and the whole role under ?all=role-<role>', () => {
    const base = views();
    // Six people at mid (the fixture has two a role): enough to cap.
    const record = (i: number) => ({
      puuid: `u-m${i}`,
      name: `Mid${i}`,
      games: 6,
      wins: 3,
      losses: 3,
      winRate: 50,
    });
    const stats = {
      ...base.stats,
      roles: base.stats.roles.map((block) =>
        block.role === 'mid' ? { ...block, entries: [0, 1, 2, 3, 4, 5].map(record) } : block,
      ),
    };
    const fun = base.fun;
    const mid = stats.roles.find((block) => block.role === 'mid');
    const total = mid?.entries.length ?? 0;
    const closed = render(<RecordsSegment stats={stats} fun={fun} links={links()} />);
    const block = closed.container.querySelector('#role-mid') as HTMLElement;
    expect(within(block).getAllByRole('listitem')).toHaveLength(4);
    expect(within(block).getByRole('link', { name: `See all ${total} at mid` })).toHaveAttribute(
      'href',
      '/g/x/stats?all=role-mid#role-mid',
    );
    closed.unmount();

    const open = render(<RecordsSegment stats={stats} fun={fun} links={links('role-mid')} />);
    const roles = open.container.querySelector('details#roles') as HTMLDetailsElement;
    expect(roles.open).toBe(true);
    const all = open.container.querySelector('#role-mid') as HTMLElement;
    expect(within(all).getAllByRole('listitem')).toHaveLength(total + 1);
    expect(within(all).getByRole('link', { name: 'Show fewer' })).toBeInTheDocument();
    open.unmount();

    // `?all=` naming no real role leaves the section closed (code review).
    const bogus = render(<RecordsSegment stats={stats} fun={fun} links={links('role-bogus')} />);
    expect((bogus.container.querySelector('details#roles') as HTMLDetailsElement).open).toBe(false);
    // The summary counts the rows on screen: three at mid, the fixture's two elsewhere.
    const summary = bogus.container.querySelector('details#roles > summary') as HTMLElement;
    const visible = stats.roles.reduce((sum, block) => sum + Math.min(3, block.entries.length), 0);
    expect(summary.textContent).toMatch(new RegExp(`${visible}$`));
    // A name is one line, the full name in its title.
    const name = within(bogus.container.querySelector('#role-mid') as HTMLElement).getByTitle('Mid0');
    expect(name).toHaveTextContent('Mid0');
  });

  it("links a role row to the group's player page", () => {
    const { stats, fun } = views();
    render(<RecordsSegment stats={stats} fun={fun} links={links()} />);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toContain(`/g/x/p/${puuidOf('hana')}`);
  });
});

describe('Arabic roast lines (M14.42, scene-walk gap 7)', () => {
  const OTHER_GROUP = { id: '11111111-2222-4333-8444-555555555555' };
  const arabic = (container: HTMLElement) => [...container.querySelectorAll('[lang="ar"]')];

  function renderAll(roasts: boolean) {
    const { stats, fun, versus } = views({ left: puuidOf('hana'), right: puuidOf('yuki') });
    return render(
      <>
        <RecordsSegment stats={stats} fun={fun} links={links(null, roasts)} />
        <ChampionsSegment fun={fun} links={links(null, roasts)} />
        <VersusSegment
          versus={versus}
          stats={stats}
          fun={fun}
          links={links(null, roasts)}
          action="/g/x/stats/1v1"
        />
      </>,
    );
  }

  it('render for customs, by id', () => {
    expect(groupHasRoasts(ORIGINAL_GROUP)).toBe(true);
    const { container } = renderAll(groupHasRoasts(ORIGINAL_GROUP));
    const lines = arabic(container);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toHaveAttribute('dir', 'rtl');
  });

  it('never render for any other group: the English heading stands alone', () => {
    expect(groupHasRoasts(OTHER_GROUP)).toBe(false);
    const { container } = renderAll(groupHasRoasts(OTHER_GROUP));
    expect(arabic(container)).toHaveLength(0);
    expect(container.textContent).not.toMatch(/[\u0600-\u06FF]/);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
  });
});

describe('StatsFrame', () => {
  const frame = (segment: 'records' | 'versus', search: Record<string, string>, range: string | null) => {
    const state = parseStatsParams(segment, search);
    return render(
      <StatsFrame
        segment={segment}
        segmentHref={(target) => segmentHref('/g/x/stats', state, target)}
        window={state.window}
        windowHref={(window) => windowHref('/g/x/stats', state, window)}
        range={range}
        games={12}
        capped={false}
        cap={2_000}
      >
        <p>body</p>
      </StatsFrame>,
    );
  };

  it('is one h1, three segments as links with aria-current, the window carried', () => {
    frame('records', { window: 'last-week' }, 'Sunday 30 Aug to Saturday 5 Sep');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Stats']);
    const segments = screen.getByRole('navigation', { name: 'Section' });
    expect(within(segments).getByRole('link', { name: 'Records' })).toHaveAttribute('aria-current', 'page');
    expect(within(segments).getByRole('link', { name: '1v1' })).toHaveAttribute(
      'href',
      '/g/x/stats/1v1?window=last-week',
    );
    expect(
      within(screen.getByRole('navigation', { name: 'Window' })).getByRole('link', { name: 'Last week' }),
    ).toHaveAttribute('aria-current', 'page');
    // The board's slot line (design round 2): the window bold, then range and count, numbers mono.
    const slot = screen.getByText(
      (_, el) =>
        el?.tagName === 'P' && el.textContent === 'Last week · Sunday 30 Aug to Saturday 5 Sep · 12 games',
    );
    expect(within(slot).getByText('Last week').tagName).toBe('SPAN');
    expect(within(slot).getByText('12')).toHaveClass('num');
  });

  it.each(['records', 'versus'] as const)(
    'offers three windows on %s, and an old month link opens on All time (M14.48)',
    (segment) => {
      frame(segment, { window: 'this-month' }, 'first game 8 Sep 2025');
      const picker = screen.getByRole('navigation', { name: 'Window' });
      expect(
        within(picker)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['This week', 'Last week', 'All time']);
      expect(within(picker).getByRole('link', { name: 'All time' })).toHaveAttribute('aria-current', 'page');
    },
  );

  it("says the window's empty sentence and draws no body on a window with no games", () => {
    frame('versus', {}, null);
    expect(screen.getByText('No games yet.')).toBeInTheDocument();
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    // All time already: no `See all time`.
    expect(screen.queryByRole('link', { name: 'See all time' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Map' })).not.toBeInTheDocument();
  });
});
