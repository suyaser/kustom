import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StoredSplit } from '@/components/receipt/types';
import { Footer } from '@/components/shell/Footer';
import type { LandingData } from '@/lib/landing/load';
import { RELEASE_ASSET, RELEASES_URL } from '@/lib/nav';
import { DownloadPage } from './DownloadPage';
import { HowPage } from './HowPage';
import { LandingPage } from './LandingPage';

/**
 * The landing page, `/how`, `/download` and the footer's links (M14.24). Role and text queries
 * only. The data and routing halves are `lib/landing/load.test.ts` and `decide.test.ts`.
 */

const DEMO = { id: 'g1', slug: 'customs', name: 'Customs Night' };

const RUN: StoredSplit[] = [
  {
    rank: 1,
    isChosen: true,
    blueWinProb: 0.46,
    gap: 40,
    offRoleCount: 0,
    blue: [
      { puuid: 'a', role: 'top' },
      { puuid: 'b', role: 'jungle' },
      { puuid: 'c', role: 'mid' },
      { puuid: 'd', role: 'adc' },
      { puuid: 'e', role: 'support' },
    ],
    red: [
      { puuid: 'f', role: 'top' },
      { puuid: 'g', role: 'jungle' },
      { puuid: 'h', role: 'mid' },
      { puuid: 'i', role: 'adc' },
      { puuid: 'j', role: 'support' },
    ],
    explanation: 'Red favored 54%. Everyone on a main role. Gap 40.',
  },
];

const LIVE: LandingData = {
  demo: DEMO,
  demoGames: 137,
  hero: {
    kind: 'live',
    gameId: 'game-1',
    startedAt: '2026-10-02T20:00:00Z',
    winner: 100,
    splits: RUN,
    names: {},
  },
  calibration: { n: 48, favoredWon: 27, actualPct: 56, expectedPct: 55 },
  counters: { games: 487, players: 23 },
};

const EMPTY: LandingData = {
  demo: DEMO,
  demoGames: 0,
  hero: { kind: 'example' },
  calibration: null,
  counters: null,
};

describe('the landing page', () => {
  it('names every landmark once: the demo receipt is a group, not a region (M14.42, quality A7)', () => {
    for (const data of [LIVE, EMPTY]) {
      const { unmount } = render(<LandingPage data={data} audience="signed-out" back={null} />);
      const regions = screen.queryAllByRole('region').map((region) => region.getAttribute('aria-labelledby'));
      const names = screen
        .queryAllByRole('region')
        .map((region) => document.getElementById(region.getAttribute('aria-labelledby') ?? '')?.textContent);
      expect(new Set(names).size).toBe(regions.length);
      const title = data === LIVE ? 'The odds were' : 'Win chance';
      expect(screen.getAllByRole('group', { name: title })).toHaveLength(1);
      expect(screen.queryByRole('region', { name: title })).toBeNull();
      unmount();
    }
  });

  it('has one h1, the pitch, and both hero actions', () => {
    render(<LandingPage data={LIVE} audience="signed-out" back={null} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // A soft hyphen sits in `argu-ments` for 200% text (M14.42); it breaks only at a line end.
    expect(screen.getByRole('heading', { level: 1 }).textContent?.replace(/\u00AD/g, '')).toBe(
      'Fair teams. No arguments.',
    );
    expect(screen.getByRole('link', { name: 'See a real group' })).toHaveAttribute('href', '/g/customs');
    for (const heading of [
      'Sound familiar?',
      'How it works',
      'Every split shows its odds.',
      'Look around a real group.',
      'The one download, and what it does.',
      'Start your group in two minutes.',
      'Questions',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    }
  });

  it('signed out: Create your group is a Discord sign-in form that comes back to /new', () => {
    render(<LandingPage data={LIVE} audience="signed-out" back={null} />);
    const buttons = screen.getAllByRole('button', { name: 'Create your group' });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const form = button.closest('form') as HTMLElement;
      expect(form).toHaveAttribute('action', '/auth/signin');
      expect(within(form).getByDisplayValue('/new')).toHaveAttribute('name', 'next');
    }
    expect(screen.getByText('Free. Sign in with Discord to start.')).toBeInTheDocument();
  });

  it('the final call lists four steps, installing Kustom third (M14.67)', () => {
    render(<LandingPage data={LIVE} audience="signed-out" back={null} />);
    const section = screen.getByRole('region', { name: 'Start your group in two minutes.' });
    const steps = within(section)
      .getAllByRole('listitem')
      .map((item) => item.textContent?.replace(/^\d+/, ''));
    expect(steps).toEqual([
      'Name it.',
      'Connect your Discord channel.',
      'Install Kustom on one Windows PC.',
      'Send your friends one link.',
    ]);
  });

  it('signed in with no group: Create your group is a plain link to /new', () => {
    render(<LandingPage data={LIVE} audience="signed-in" back={null} />);
    const links = screen.getAllByRole('link', { name: 'Create your group' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/new');
    expect(screen.queryByRole('button', { name: 'Create your group' })).not.toBeInTheDocument();
    expect(screen.queryByText('Free. Sign in with Discord to start.')).not.toBeInTheDocument();
  });

  it('draws the Back to <Group> bar only when given a group', () => {
    const { unmount } = render(<LandingPage data={LIVE} audience="signed-out" back={null} />);
    expect(screen.queryByRole('link', { name: /Back to/ })).not.toBeInTheDocument();
    unmount();
    render(
      <LandingPage
        data={LIVE}
        audience="signed-out"
        back={{ id: 'g2', slug: 'thursday-flex', name: 'Thursday Flex' }}
      />,
    );
    expect(screen.getByRole('link', { name: /Back to Thursday Flex/ })).toHaveAttribute(
      'href',
      '/g/thursday-flex',
    );
  });

  it('live: the real receipt, dated, linked to its game, with How the bot decided open in the proof', () => {
    render(<LandingPage data={LIVE} audience="signed-out" back={null} />);
    expect(screen.getAllByText('A real split from Customs Night, 2 Oct.')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'See this game' })[0]).toHaveAttribute(
      'href',
      '/g/customs/games/game-1',
    );
    expect(screen.getAllByText('Blue was 46%. Blue won. Upset!').length).toBeGreaterThan(0);
    const disclosures = document.querySelectorAll('details[id^="landing-"]');
    expect(disclosures).toHaveLength(1);
    expect(document.getElementById('landing-hero-how')).toBeNull();
    expect(document.getElementById('landing-proof-how')).toHaveAttribute('open');
  });

  it('live: the calibration line from 20 games, the rounded counters and the demo count', () => {
    render(<LandingPage data={LIVE} audience="signed-out" back={null} />);
    expect(screen.getByText(/In Customs Night, the side the bot favored won/)).toHaveTextContent(
      'In Customs Night, the side the bot favored won 27 of 48 games (56%). It expected about 55%.',
    );
    const counters = screen.getByLabelText('Kustom so far');
    expect(within(counters).getByText('480+')).toBeInTheDocument();
    expect(within(counters).getByText('20+')).toBeInTheDocument();
    expect(within(counters).getByText('results typed in')).toBeInTheDocument();
    // The counters say it; the demo count would say it twice (designer round 1).
    expect(screen.queryByText(/has played/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Customs Night' })).toHaveAttribute('href', '/g/customs');
  });

  it("counters hidden: the demo group's own count, rounded down", () => {
    render(<LandingPage data={{ ...LIVE, counters: null }} audience="signed-out" back={null} />);
    expect(screen.queryByLabelText('Kustom so far')).not.toBeInTheDocument();
    expect(screen.getByText(/has played/)).toHaveTextContent(
      'Customs Night has played 130+ games with Kustom.',
    );
    expect(screen.getByText(/has played/)).toHaveTextContent(
      'Customs Night has played 130+ games with Kustom. Their tonight page, board and every game are public.',
    );
    expect(screen.queryByText(/Customs Night's tonight page/)).not.toBeInTheDocument();
  });

  it('no rolled game: the worked example, captioned, and no calibration, counters or zero anywhere', () => {
    render(<LandingPage data={EMPTY} audience="signed-out" back={null} />);
    expect(screen.getAllByText('An example split: ten friends on an ordinary Tuesday.')).toHaveLength(1);
    expect(screen.getAllByText('Close. Blue has a slight edge.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/favored won/)).not.toBeInTheDocument();
    expect(screen.queryByText('games refereed')).not.toBeInTheDocument();
    expect(screen.queryByText(/has played/)).not.toBeInTheDocument();
    expect(screen.getByText(/Customs Night's tonight page, board/)).toBeInTheDocument();
  });

  it('no demo group: no real-group links at all', () => {
    render(<LandingPage data={{ ...EMPTY, demo: null }} audience="signed-out" back={null} />);
    expect(screen.queryByRole('link', { name: 'See a real group' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Look around a real group.' })).not.toBeInTheDocument();
  });

  it('links the companion explanation to /download, never the exe', () => {
    render(<LandingPage data={LIVE} audience="signed-out" back={null} />);
    expect(screen.getByRole('link', { name: 'Get Kustom for Windows' })).toHaveAttribute('href', '/download');
    expect(screen.getByText('What it never touches')).toBeInTheDocument();
    // M17.12: Kustom 1.0 has no Overlay mode, so the landing no longer offers one.
    expect(screen.queryByText(/overlay/i)).not.toBeInTheDocument();
  });

  it("That's it names the pre-roll powers too (M14.68)", () => {
    const { container } = render(<LandingPage data={LIVE} audience="signed-out" back={null} />);
    expect(
      screen.getByText(
        "Admins can set the mode and whether a game is rated before its teams are rolled, then roll, and reroll to the bot's next pick. The owner can reset everyone's ratings at once, never one person's. That's it.",
      ),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/never after/);
  });

  it('the FAQ is native details, closed', () => {
    render(<LandingPage data={LIVE} audience="signed-out" back={null} />);
    const summary = screen.getByText('Is this allowed by Riot?');
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText(/Everyone starts at 1200\./)).toBeInTheDocument();
  });
});

/** An element's spoken pieces in DOM order: text and image alts, skipping `aria-hidden` subtrees. */
function spoken(root: Element): string[] {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim() ?? '';
      if (text !== '') out.push(text);
      return;
    }
    if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') return;
    if (node.tagName === 'IMG') out.push(node.getAttribute('alt') ?? '');
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out;
}

describe('the hero example game (05-design 12)', () => {
  const heroOf = () => document.getElementById('hero-title')?.closest('section') as HTMLElement;

  it('is a figure with a lane-by-lane table, captioned as an example, and no receipt in the hero', () => {
    for (const data of [LIVE, EMPTY]) {
      const { unmount } = render(<LandingPage data={data} audience="signed-out" back={null} />);
      const hero = heroOf();
      const figure = within(hero).getByRole('figure');
      expect(within(figure).getByText('An example game: ten friends on an ordinary Tuesday.').tagName).toBe(
        'FIGCAPTION',
      );
      expect(within(figure).getByText('Red won')).toBeInTheDocument();
      expect(within(figure).getByText('32:40')).toBeInTheDocument();
      expect(within(figure).getByText('Blue 54 percent, Red 46 percent.')).toBeInTheDocument();

      const table = within(figure).getByRole('table', { name: 'Example game, lane by lane. Red won.' });
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((th) => th.textContent),
      ).toEqual(['Blue team', 'Lane', 'Red team']);
      const rowHeaders = within(table).getAllByRole('rowheader');
      expect(rowHeaders.map((th) => th.textContent)).toEqual(['top', 'jungle', 'mid', 'adc', 'support']);
      for (const th of rowHeaders) expect(th).toHaveAttribute('scope', 'row');
      expect(table.querySelectorAll('tbody tr')).toHaveLength(5);
      // What a screen reader hears, cell by cell: ‹top · Hana, Garen, lost 18 · Omar, Darius, gained 17›.
      const first = within(table).getAllByRole('row')[1] as HTMLElement;
      expect([...first.children].map(spoken)).toEqual([
        ['Hana', 'Garen', 'lost 18'],
        ['top'],
        ['Omar', 'Darius', 'gained 17'],
      ]);

      // No receipt, no disclosure, no live caption up here; the Proof section keeps the receipt.
      expect(within(hero).queryByRole('group')).toBeNull();
      expect(hero.querySelector('details')).toBeNull();
      expect(within(hero).queryByText(/A real split|An example split/)).toBeNull();
      const proof = screen.getByRole('region', { name: 'Every split shows its odds.' });
      expect(
        within(proof).getByRole('group', { name: data === LIVE ? 'The odds were' : 'Win chance' }),
      ).toBeInTheDocument();
      expect(document.getElementById('landing-proof-how')).toHaveAttribute('open');
      unmount();
    }
  });

  it('draws the ten champion squares in lane order, named, sized, eager, from our own origin', () => {
    render(<LandingPage data={EMPTY} audience="signed-out" back={null} />);
    const images = within(heroOf()).getAllByRole('img');
    expect(images.map((img) => img.getAttribute('alt'))).toEqual([
      'Garen',
      'Darius',
      'Lee Sin',
      'Amumu',
      'Ahri',
      'Yasuo',
      'Jinx',
      'Ezreal',
      'Thresh',
      'Lux',
    ]);
    for (const img of images) {
      expect(img).toHaveAttribute('width', '40');
      expect(img).toHaveAttribute('height', '40');
      expect(img).toHaveAttribute('loading', 'eager');
      expect(img).toHaveAttribute('decoding', 'async');
      expect(img).toHaveAttribute('fetchpriority', 'low');
      const src = img.getAttribute('src') ?? '';
      expect(src).not.toBe('');
      expect(src).not.toMatch(/ddragon|\/_next\/image/);
    }
    // Nowhere else on the page draws a champion (12.4).
    expect(document.querySelectorAll('img')).toHaveLength(10);
  });
});

describe('/how', () => {
  it("What admins can't do names the pre-roll powers too (M14.68)", () => {
    const { container } = render(<HowPage demo={DEMO} calibration={null} />);
    const section = screen
      .getByRole('heading', { level: 2, name: "What admins can't do" })
      .closest('section');
    expect(section).toHaveTextContent(
      'What they can do: set the mode and whether a game is rated, before its teams are rolled; tap Roll teams;',
    );
    expect(container).not.toHaveTextContent(/never after/);
  });

  it('explains the rating, the receipt on the worked example, and what admins cannot do', () => {
    render(<HowPage demo={DEMO} calibration={null} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('How the bot decides');
    expect(screen.getByRole('heading', { level: 2, name: 'Your rating' })).toBeInTheDocument();
    expect(screen.getByText(/a win never lowers it and a loss never raises it/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/OpenSkill/);
    const index = screen.getByRole('navigation', { name: 'On this page' });
    const targets = within(index)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(targets).toEqual(['#rating', '#splits', '#receipt', '#calibration', '#admins']);
    for (const target of targets) expect(document.getElementById((target ?? '').slice(1))).not.toBeNull();
    expect(document.getElementById('how-example')).toHaveAttribute('open');
    expect(screen.getByRole('heading', { level: 2, name: "What admins can't do" })).toBeInTheDocument();
    expect(screen.queryByText(/favored won/)).not.toBeInTheDocument();
  });

  it("shows the demo group's calibration when it has one", () => {
    render(<HowPage demo={DEMO} calibration={{ n: 48, favoredWon: 27, actualPct: 56, expectedPct: 55 }} />);
    expect(screen.getAllByText(/favored won/).length).toBeGreaterThan(0);
  });
});

describe('/download', () => {
  it('links the releases page, never the exe, and says Windows only', () => {
    render(<DownloadPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Get Kustom');
    const link = screen.getByRole('link', { name: 'Download Kustom' });
    expect(link).toHaveAttribute('href', RELEASES_URL);
    expect(link.getAttribute('href')).not.toMatch(/\.exe$/);
    // M17.12 (Kustom 1.0): one app, set up with a code, updating itself; no modes.
    expect(screen.getByText('Link it with a code')).toBeInTheDocument();
    expect(screen.getByText('It updates itself')).toBeInTheDocument();
    expect(screen.queryByText(/Host mode|Overlay mode/)).not.toBeInTheDocument();
    expect(screen.getByText(/There is no Mac version yet/)).toBeInTheDocument();
  });

  it('names the file the release offers, from the same switch as the direct link (M17.12)', () => {
    render(<DownloadPage />);
    expect(screen.getByText(/^Opens the download page on GitHub\./)).toHaveTextContent(
      `Grab ${RELEASE_ASSET} there, on the Windows PC that will run it.`,
    );
    // The Rust Kustom 1.0 installer: 2.0 and 1.0 ship together (decision row 2026-10-04).
    expect(RELEASE_ASSET).toBe('Kustom-setup.exe');
  });

  it('walks a stranger past SmartScreen and says no token, paste or overlay (M14.42, M17.12)', () => {
    const { container } = render(<DownloadPage />);
    const warning = screen.getByText(/^Windows may warn you because Kustom isn't signed yet\./);
    expect(warning).toHaveTextContent(
      "Windows may warn you because Kustom isn't signed yet. Click More info, then Run anyway.",
    );
    expect(within(warning).getByText('More info').tagName).toBe('B');
    expect(within(warning).getByText('Run anyway').tagName).toBe('B');
    expect(container.textContent).not.toMatch(/pairing|token|paste|overlay/i);
    // Hosting is admins only, so /download sends nobody to an invite link for a code (product, M17.12).
    expect(container.textContent).not.toMatch(/invite link/i);
    expect(screen.getByText(/^Kustom asks for a code the first time\./)).toHaveTextContent(
      "Kustom asks for a code the first time. On the site, open your group's admin home and tap Get a code under Set up your PC as host. Open League signed in to your own account, type the code into Kustom and press Link. When Kustom shows your group's name, that's all the setup there is.",
    );
  });
});

describe('the footer', () => {
  it('links /how and /download everywhere, and /about on group pages only', () => {
    const { unmount } = render(<Footer />);
    expect(screen.getByRole('link', { name: 'How the bot decides' })).toHaveAttribute('href', '/how');
    expect(screen.getByRole('link', { name: 'Get Kustom' })).toHaveAttribute('href', '/download');
    expect(screen.queryByRole('link', { name: "What's Kustom?" })).not.toBeInTheDocument();
    unmount();
    render(<Footer inGroup />);
    expect(screen.getByRole('link', { name: "What's Kustom?" })).toHaveAttribute('href', '/about');
  });
});
