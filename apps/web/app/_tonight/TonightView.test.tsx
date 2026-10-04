import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { START_LOBBY_BUTTON } from '@/lib/lobbyStartCopy';
import { groupHref } from '@/lib/nav';
import { HOW_SUMMARY, TITLE_BALANCED, TITLE_FINISHED, TITLE_IN_GAME } from '@/lib/receipt/copy';
import { lobbyView, snapshot, workedMembers, workedTeams } from '@/lib/testing/tonightFixtures';
import {
  IN_GAME_SENTENCE,
  MISSED_INVITE_LEAD,
  NAMELESS_HINT,
  REROLL_LABEL,
  ROLE_CONTROL_HEADING,
  ROLL_HINT,
  ROLL_LABEL,
} from '@/lib/tonight/copy';
import {
  EMPTY_GROUP_ADMIN_TITLE,
  EMPTY_GROUP_MEMBER,
  FINISH_SETUP,
  LAST_GAME_TITLE,
  NEW_TAG,
  showEarlierGames,
  TAPE_TITLE,
  TOP_TITLE,
  YOUR_SIDE_TAG,
} from '@/lib/tonight/screenCopy';
import { SIT_OUT_VIEWER_LEAD } from '@/lib/tonight/sitOut';
import {
  ADMIN_VIEWER,
  ANON_VIEWER,
  MEMBER_VIEWER,
  type TonightStateKey,
  tonightStateFixture,
  VIEWER_PUUID,
} from './fixtures';
import { TonightView, type TonightViewProps } from './TonightView';
import { yourNightFirstLine } from './YourNight';

/**
 * The 2.0 tonight page, one fixture per state (M14.9 acceptance 1 to 3), asserted by role and
 * text only (acceptance 7). The fixtures are `./fixtures.ts`, the same objects `/kit/tonight/<state>`
 * renders for the screenshots.
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');

function draw(key: TonightStateKey, overrides: Partial<TonightViewProps> = {}, realNames = false) {
  const { connection: _connection, ...fixture } = tonightStateFixture(key, { now: NOW, realNames });
  return render(<TonightView {...fixture} group={ORIGINAL_GROUP} {...overrides} />);
}

const h1 = () => screen.getByRole('heading', { level: 1 }).textContent;

describe('every state leads with its headline and its primary action', () => {
  it('empty group, a member: the one sentence, no poster, no board', () => {
    draw('empty');
    expect(h1()).toBe('NOBODY IN YET');
    expect(screen.getByText(EMPTY_GROUP_MEMBER)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: LAST_GAME_TITLE })).toBeNull();
  });

  it('empty group, an admin: Get your group ready and Finish setup', () => {
    draw('empty-admin');
    expect(screen.getByRole('heading', { name: EMPTY_GROUP_ADMIN_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: FINISH_SETUP })).toHaveAttribute(
      'href',
      groupHref(ORIGINAL_GROUP, { page: 'admin' }) ?? '',
    );
  });

  it('idle: the last game as a poster, the top five, Start a lobby and the Daily card', () => {
    draw('idle');
    expect(h1()).toBe('NOBODY IN YET');
    const last = screen.getByRole('region', { name: LAST_GAME_TITLE });
    expect(within(last).getByText(/Red won\./)).toBeInTheDocument();
    expect(within(last).getByRole('link', { name: 'See the game' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: START_LOBBY_BUTTON })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: TOP_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Guess the Award/ })).toBeInTheDocument();
  });

  it('idle, signed out: the sign-in line instead of the button', () => {
    draw('idle', { viewer: ANON_VIEWER });
    expect(screen.queryByRole('button', { name: START_LOBBY_BUTTON })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in with Discord' })).toBeInTheDocument();
  });

  it('filling: the count in the headline, one roster, the open seats as one line, still needed', () => {
    draw('filling');
    expect(h1()).toBe('6 IN THE LOBBY');
    expect(screen.getAllByText('Four more to go.').length).toBeGreaterThan(0);
    const roster = screen.getByRole('region', { name: 'In the lobby' });
    expect(within(roster).getAllByRole('listitem')).toHaveLength(6);
    expect(
      within(roster).getByText('4 open seats. They fill as people join the League lobby.'),
    ).toBeInTheDocument();
    expect(within(roster).getByText('Still needed:')).toBeInTheDocument();
    expect(screen.getByText(ROLL_HINT)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: new RegExp(ROLE_CONTROL_HEADING) })).toBeInTheDocument();
  });

  /** True when `a` comes before `b` in the page. */
  const comesBefore = (a: Element, b: Element) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('M14.65: an unlinked friend with a claimable row sees Which one is you? straight under the strip', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('filling', { now: NOW });
    const members = fixture.snapshot.lobby?.members ?? [];
    render(
      <TonightView
        {...fixture}
        group={ORIGINAL_GROUP}
        viewer={{ kind: 'unlinked', claimable: members.slice(1).map((m) => m.puuid) }}
      />,
    );
    const claim = screen.getByRole('heading', { level: 2, name: 'Which one is you?' });
    const roster = screen.getByRole('region', { name: 'In the lobby' });
    expect(comesBefore(claim, roster)).toBe(true);
    // Nothing between the strip's h1 and the card but the strip itself.
    expect(comesBefore(screen.getByRole('heading', { level: 1 }), claim)).toBe(true);
    expect(screen.getAllByRole('heading', { name: 'Which one is you?' })).toHaveLength(1);
  });

  it('M14.65: once balanced, the claim card stays first, folded to one line', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('balanced', { now: NOW });
    const members = fixture.snapshot.lobby?.members ?? [];
    const { container } = render(
      <TonightView
        {...fixture}
        group={ORIGINAL_GROUP}
        viewer={{ kind: 'unlinked', claimable: members.slice(1).map((m) => m.puuid) }}
      />,
    );
    const claim = screen.getByRole('heading', { level: 2, name: 'Which one is you?' });
    expect(claim.closest('details')).not.toBeNull();
    expect(comesBefore(claim, screen.getByRole('region', { name: 'Blue team' }))).toBe(true);
    expect(container.querySelectorAll('details summary h2')).toHaveLength(1);
  });

  it('M14.69: a same-name label prints on the team cards, muted', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('balanced', { now: NOW });
    const lobby = fixture.snapshot.lobby;
    if (lobby?.teams == null) throw new Error('fixture has no teams');
    const [first, ...rest] = lobby.teams.blue;
    if (first === undefined) throw new Error('no seat');
    const teams = { ...lobby.teams, blue: [{ ...first, name: 'Ali', nameSuffix: '(2)' }, ...rest] };
    render(
      <TonightView
        {...fixture}
        snapshot={{ ...fixture.snapshot, lobby: { ...lobby, teams } }}
        group={ORIGINAL_GROUP}
      />,
    );
    const blue = screen.getByRole('region', { name: 'Blue team' });
    expect(within(blue).getByText('(2)')).toHaveClass('font-normal', 'text-muted-foreground');
  });

  it('M14.65: linked and anonymous keep the role card where it was, after the roster', () => {
    const linked = draw('filling');
    const roster = () => screen.getByRole('region', { name: 'In the lobby' });
    expect(
      comesBefore(roster(), screen.getByRole('heading', { name: new RegExp(ROLE_CONTROL_HEADING) })),
    ).toBe(true);
    linked.unmount();
    draw('filling', { viewer: ANON_VIEWER });
    expect(comesBefore(roster(), screen.getByRole('heading', { name: ROLE_CONTROL_HEADING }))).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Which one is you?' })).toBeNull();
  });

  it('M14.65: an unlinked friend with nobody to claim keeps the old place and words', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('filling', { now: NOW });
    render(<TonightView {...fixture} group={ORIGINAL_GROUP} viewer={{ kind: 'unlinked', claimable: [] }} />);
    expect(screen.queryByRole('heading', { name: 'Which one is you?' })).toBeNull();
  });

  describe('M14.66: no host running says who to ask, before anyone taps', () => {
    const away = (hostNames: string[], hostSeenRecently = false) => {
      const { snapshot: base } = tonightStateFixture('idle', { now: NOW });
      return { snapshot: { ...base, hostNames, hostSeenRecently } };
    };

    it('idle, no host seen in ten minutes: the line under Start a lobby names the hosts', () => {
      draw('idle', { viewer: MEMBER_VIEWER, ...away(['Yasser', 'Omar']) });
      expect(screen.getByRole('button', { name: START_LOBBY_BUTTON })).toBeInTheDocument();
      expect(
        screen.getByText("Nobody's Kustom is running right now. Ask Yasser or Omar to open it."),
      ).toBeInTheDocument();
    });

    it('more than three hosts, or none named: whoever hosts', () => {
      const many = draw('idle', { viewer: MEMBER_VIEWER, ...away(['Yasser', 'Omar', 'Hana', 'Rami']) });
      expect(
        screen.getByText("Nobody's Kustom is running right now. Ask whoever hosts to open it."),
      ).toBeInTheDocument();
      many.unmount();
      draw('idle', { viewer: MEMBER_VIEWER, ...away([]) });
      expect(
        screen.getByText("Nobody's Kustom is running right now. Ask whoever hosts to open it."),
      ).toBeInTheDocument();
    });

    it('no line while a host was seen recently, for a visitor, or after a result', () => {
      const seen = draw('idle', { viewer: MEMBER_VIEWER, ...away(['Yasser'], true) });
      expect(screen.queryByText(/Nobody's Kustom is running/)).toBeNull();
      seen.unmount();
      const anon = draw('idle', { viewer: ANON_VIEWER, ...away(['Yasser']) });
      expect(screen.queryByText(/Nobody's Kustom is running/)).toBeNull();
      anon.unmount();
      const { snapshot: finished } = tonightStateFixture('finished', { now: NOW });
      draw('finished', {
        viewer: MEMBER_VIEWER,
        snapshot: { ...finished, hostNames: ['Yasser'], hostSeenRecently: false },
      });
      expect(screen.queryByText(/Nobody's Kustom is running/)).toBeNull();
    });
  });

  it('more than ten: who would sit out, in order, before the roll; and the roll for an admin', () => {
    draw('over-ten');
    expect(h1()).toBe('12 IN THE LOBBY');
    expect(screen.getByText('If the teams rolled now, Deniz and then Mo would sit out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ROLL_LABEL })).toBeInTheDocument();
  });

  it('balanced: TEAMS ARE SET, the answer band, the full receipt, two team cards', () => {
    draw('balanced');
    expect(h1()).toBe('TEAMS ARE SET');
    expect(screen.getByRole('region', { name: TITLE_BALANCED })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Blue team' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Red team' })).toBeInTheDocument();
    expect(screen.getByText(/, playing support/)).toBeInTheDocument();
  });

  it('in game: the timer from the start, Odds at kickoff, no role or sign-in control', () => {
    const { connection: _c, ...live } = tonightStateFixture('in-game', { now: Date.now() });
    const first = render(<TonightView {...live} group={ORIGINAL_GROUP} />);
    expect(h1()).toBe('IN GAME');
    expect(screen.getByText('23 min in')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(IN_GAME_SENTENCE))).toBeInTheDocument();
    expect(screen.getByRole('region', { name: TITLE_IN_GAME })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: new RegExp(ROLE_CONTROL_HEADING) })).toBeNull();
    first.unmount();
    draw('in-game', { viewer: ANON_VIEWER });
    expect(screen.queryAllByRole('button', { name: 'Sign in with Discord' })).toHaveLength(0);
  });

  it('finished: RED WINS, the odds were, the result line, deltas, MVP and ACE, Start the next lobby', () => {
    draw('finished');
    expect(h1()).toBe('RED WINS');
    const receipt = screen.getByRole('region', { name: TITLE_FINISHED });
    // M14.45: the headline names the winner once; the poster says the odds only.
    expect(within(receipt).getByText(/^(Red was \d+%\.( Upset!)?|50–50\.)$/)).toBeInTheDocument();
    expect(within(receipt).queryByText(/Red won\./)).toBeNull();
    expect(screen.getAllByText('MVP').length).toBeGreaterThan(0);
    expect(screen.getByText('ACE')).toBeInTheDocument();
    const deltas = ['Blue team', 'Red team'].flatMap((side) =>
      within(screen.getByRole('region', { name: side })).queryAllByText(/^(gained|lost) \d+$/),
    );
    expect(deltas.length).toBe(10);
    expect(screen.getByRole('button', { name: 'Start the next lobby' })).toBeInTheDocument();
    expect(screen.getByText('Won')).toBeInTheDocument();
  });

  it('finished: the viewer strip says their side, won or lost, and their change', () => {
    draw('finished');
    const band = screen.getByText(/ · (won|lost)/);
    expect(band.textContent).toMatch(/on (BLUE|RED) · (won|lost) · (\+|−)\d+/);
  });

  it('long nights: three games on the tape, the rest behind Show 4 earlier games', () => {
    draw('long-night');
    const tape = screen.getByRole('region', { name: TAPE_TITLE });
    expect(within(tape).getByText(showEarlierGames(4))).toBeInTheDocument();
    expect(within(tape).getByText('Game 7')).toBeInTheDocument();
    expect(within(tape).getByText('Game 1')).toBeInTheDocument();
  });

  it('a new player: settling · 4/10 on their seat', () => {
    draw('new-player');
    expect(screen.getByText('settling · 4/10')).toBeInTheDocument();
    expect(screen.getByText('settling · 0/10')).toBeInTheDocument();
  });

  it('a new player in the roster: the New tag', () => {
    const members = workedMembers(4).map((member, index) =>
      index === 0 ? { ...member, ratedGames: 0 } : member,
    );
    render(
      <TonightView
        snapshot={snapshot(lobbyView({ status: 'open', members }))}
        viewer={ANON_VIEWER}
        group={ORIGINAL_GROUP}
        topPlayers={[]}
      />,
    );
    expect(screen.getByText(NEW_TAG)).toBeInTheDocument();
  });
});

describe('the fairness receipt (STRATEGY §4)', () => {
  it('shows in balanced, in game and finished', () => {
    for (const [key, title] of [
      ['balanced', TITLE_BALANCED],
      ['in-game', TITLE_IN_GAME],
      ['finished', TITLE_FINISHED],
    ] as const) {
      const { unmount } = draw(key);
      expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
      unmount();
    }
  });

  it('opens How the bot decided to a signed-out visitor, with all three splits', () => {
    draw('balanced', { viewer: ANON_VIEWER });
    const summary = screen.getByText(HOW_SUMMARY);
    expect(summary.closest('details')).not.toBeNull();
    expect(screen.getByText(/The bot's note:/)).toBeInTheDocument();
  });

  it('is built from the columns only: a garbage explanation changes nothing but the bot note', () => {
    const fixture = tonightStateFixture('balanced', { now: NOW });
    const lobby = fixture.snapshot.lobby;
    if (lobby?.teams == null) throw new Error('fixture');
    const garbage = {
      ...fixture,
      snapshot: {
        ...fixture.snapshot,
        lobby: {
          ...lobby,
          teams: {
            ...lobby.teams,
            stored: lobby.teams.stored.map((split) => ({ ...split, explanation: 'Red 99%. Gap 9000. lol' })),
          },
        },
      },
    };
    const read = () => {
      const receipt = screen.getByRole('region', { name: TITLE_BALANCED });
      const text = receipt.textContent ?? '';
      return text.slice(0, text.indexOf(HOW_SUMMARY));
    };
    const first = render(<TonightView {...fixture} group={ORIGINAL_GROUP} />);
    const before = read();
    first.unmount();
    render(<TonightView {...garbage} group={ORIGINAL_GROUP} />);
    expect(read()).toBe(before);
    expect(screen.getByText(/Red 99%\. Gap 9000\. lol/)).toBeInTheDocument();
  });

  it('retires team totals and Teams are N% even', () => {
    draw('balanced');
    expect(document.body.textContent).not.toMatch(/% even/);
    expect(document.body.textContent).not.toMatch(/sum of the five ratings/);
  });

  it('a reroll: Reroll 1 of 2 · pick #2 on the receipt, for everybody', () => {
    draw('reroll', { viewer: ANON_VIEWER });
    const receipt = screen.getByRole('region', { name: TITLE_BALANCED });
    expect(receipt.textContent).toMatch(/Reroll 1 of 2/);
    expect(receipt.textContent).toMatch(/pick #2/);
  });
});

describe('which side am I on', () => {
  it("marks the viewer's seat by the word You, says Your side on their card, and lists it first", () => {
    draw('balanced');
    const seat = workedTeams().blue.some((one) => one.puuid === VIEWER_PUUID) ? 'Blue team' : 'Red team';
    const card = screen.getByRole('region', { name: seat });
    expect(within(card).getByText(YOUR_SIDE_TAG)).toBeInTheDocument();
    expect(within(card).getByText('You')).toBeInTheDocument();
    expect(within(card).getByText('(you)')).toBeInTheDocument();
  });

  it('tells a sitter first, above the receipt, in the second person', () => {
    const fixture = tonightStateFixture('balanced', { now: NOW });
    render(
      <TonightView
        {...fixture}
        viewer={{ kind: 'linked', puuid: 'puuid-deniz', isAdmin: false }}
        group={ORIGINAL_GROUP}
      />,
    );
    const sit = screen.getByText(new RegExp(`^${SIT_OUT_VIEWER_LEAD}`));
    const receipt = screen.getByRole('region', { name: TITLE_BALANCED });
    expect(sit.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('controls', () => {
  it('Reroll for an admin while balanced, never in game', () => {
    draw('balanced', { viewer: ADMIN_VIEWER });
    expect(screen.getByRole('button', { name: REROLL_LABEL })).toBeInTheDocument();
    const { unmount } = draw('in-game', { viewer: ADMIN_VIEWER });
    expect(screen.getAllByRole('button', { name: REROLL_LABEL })).toHaveLength(1);
    unmount();
  });

  it('no Reroll for a member', () => {
    draw('balanced', { viewer: MEMBER_VIEWER });
    expect(screen.queryByRole('button', { name: REROLL_LABEL })).toBeNull();
  });

  it('the missed-invite line for linked viewers only', () => {
    const anon = draw('balanced', { viewer: ANON_VIEWER });
    expect(document.body.textContent).not.toContain(MISSED_INVITE_LEAD);
    anon.unmount();
    draw('balanced', { viewer: MEMBER_VIEWER });
    expect(document.body.textContent).toContain(`${MISSED_INVITE_LEAD}Customs 08 Sep #1, password 4821.`);
  });
});

describe('Your night (M14.36)', () => {
  it('shows in idle and finished for a linked viewer with a game tonight', () => {
    const idle = draw('idle');
    expect(screen.getByRole('region', { name: 'Your night' })).toHaveTextContent(
      "Your night: 1 win, 1 loss, Rating −6.Best game: Kai'Sa, 12/2/8.MVP once.",
    );
    idle.unmount();
    draw('finished');
    expect(screen.getByRole('region', { name: 'Your night' })).toHaveTextContent(
      "Your night: 2 wins, 1 loss, Rating +38.Best game: Kai'Sa, 12/2/8.MVP once. ACE once.",
    );
  });

  it('idle: under the strip, above Last game; finished: after the odds and the awards, before the teams', () => {
    const follows = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const idle = draw('idle');
    expect(
      follows(
        screen.getByRole('region', { name: 'Your night' }),
        screen.getByRole('region', { name: 'Last game' }),
      ),
    ).toBe(true);
    idle.unmount();
    draw('finished');
    const night = screen.getByRole('region', { name: 'Your night' });
    expect(follows(screen.getByRole('region', { name: TITLE_FINISHED }), night)).toBe(true);
    expect(follows(screen.getByText('ACE'), night)).toBe(true);
    expect(follows(night, screen.getByRole('region', { name: 'Blue team' }))).toBe(true);
  });

  it('is not there for a visitor, nor in the other states', () => {
    const anon = draw('finished', { viewer: ANON_VIEWER });
    expect(screen.queryByRole('region', { name: 'Your night' })).toBeNull();
    anon.unmount();
    const { connection: _c, ...balanced } = tonightStateFixture('balanced', { now: NOW });
    render(
      <TonightView {...balanced} yourNight={tonightStateFixture('idle').yourNight} group={ORIGINAL_GROUP} />,
    );
    expect(screen.queryByRole('region', { name: 'Your night' })).toBeNull();
  });

  it('updates in place when the server sends the next game (M14.36 acceptance 5)', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('finished', { now: NOW });
    const night = fixture.yourNight;
    if (night == null) throw new Error('fixture');
    const { rerender } = render(<TonightView {...fixture} group={ORIGINAL_GROUP} />);
    expect(screen.getByText(yourNightFirstLine(night))).toBeInTheDocument();
    const next = { ...night, wins: night.wins + 1, ratingDelta: (night.ratingDelta ?? 0) + 12 };
    rerender(<TonightView {...fixture} yourNight={next} group={ORIGINAL_GROUP} />);
    expect(screen.getByText(yourNightFirstLine(next))).toBeInTheDocument();
    expect(screen.queryByText(yourNightFirstLine(night))).toBeNull();
  });

  it('says the same first line Tonight and You use (one function)', () => {
    const night = tonightStateFixture('idle').yourNight;
    if (night == null) throw new Error('fixture');
    draw('idle');
    expect(screen.getByText(yourNightFirstLine(night))).toBeInTheDocument();
  });
});

describe('the Mode card (M14.30)', () => {
  const states = ['idle', 'filling', 'balanced', 'in-game', 'finished'] as const;
  const card = () => screen.getByRole('region', { name: /^Mode / });

  it('is on Tonight in every state, in Fearless and in Normal, and no pool block is anywhere else', () => {
    for (const mode of ['fearless', 'normal'] as const) {
      for (const key of states) {
        const { connection: _c, ...fixture } = tonightStateFixture(key, { now: NOW, mode });
        const { unmount } = render(<TonightView {...fixture} group={ORIGINAL_GROUP} />);
        expect(within(card()).getByRole('heading', { name: mode === 'fearless' ? 'Fearless' : 'Normal' }));
        expect(within(card()).getByText('Rated')).toBeInTheDocument();
        // The pool lives in the panel: no find box and no lane control on Tonight.
        expect(screen.queryByLabelText('Find a champion')).toBeNull();
        expect(screen.queryByRole('group', { name: 'Lane' })).toBeNull();
        unmount();
      }
    }
  });

  it('says open first and banned second in Fearless, and Every champion is open. in Normal', () => {
    const fearless = draw('idle');
    expect(card().textContent).toMatch(/\d+ open\s*\d+ banned/);
    fearless.unmount();
    draw('idle', {}, false);
    const { connection: _c, ...normal } = tonightStateFixture('idle', { now: NOW, mode: 'normal' });
    render(<TonightView {...normal} group={ORIGINAL_GROUP} />);
    expect(screen.getAllByText('Every champion is open.').length).toBeGreaterThan(0);
  });

  it('links its row to the panel; balanced and seated, on the viewer lane, with Your lane', () => {
    draw('balanced');
    const link = screen.getByRole('link', { name: /See what.s open/ });
    expect(link.getAttribute('href')).toMatch(/\/g\/customs\/mode\?lane=support$/);
    expect(link.textContent).toMatch(/Your lane\s*support/);
  });

  it("gives the seated viewer one tap from the answer band: What's open for <role>", () => {
    draw('balanced');
    expect(screen.getByRole('link', { name: "What's open for support" }).getAttribute('href')).toMatch(
      /\/mode\?lane=support$/,
    );
  });

  it('gives a visitor All: no lane on the link and no jump link', () => {
    draw('balanced', { viewer: ANON_VIEWER });
    expect(screen.getByRole('link', { name: /See what.s open/ }).getAttribute('href')).toMatch(/\/mode$/);
    expect(screen.queryByRole('link', { name: /What's open for/ })).toBeNull();
  });

  it('in Normal: no jump link and no banned ten, for members, in every state', () => {
    for (const key of states) {
      const { connection: _c, ...fixture } = tonightStateFixture(key, { now: NOW, mode: 'normal' });
      const { unmount } = render(<TonightView {...fixture} group={ORIGINAL_GROUP} />);
      expect(screen.queryByRole('link', { name: /What's open for/ })).toBeNull();
      expect(screen.queryByText('Banned next game')).toBeNull();
      unmount();
    }
  });

  it('filling: five lane tiles, each opening the panel on its lane', () => {
    draw('filling');
    const jungle = within(card()).getByRole('link', { name: /^jungle \d+$/ });
    expect(jungle.getAttribute('href')).toMatch(/\/mode\?lane=jungle$/);
  });

  it("in game: This game's ten join the ban list when it ends.", () => {
    draw('in-game');
    expect(within(card()).getByText("This game's ten join the ban list when it ends.")).toBeInTheDocument();
  });

  it('finished: Banned next game leads with the ten this game added', () => {
    draw('finished');
    expect(within(card()).getByText('Banned next game')).toBeInTheDocument();
    expect(within(card()).getByText('from game 3')).toBeInTheDocument();
  });

  it('finished: no banned ten for a game that added nothing (an ARAM or a remake)', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('finished', { now: NOW });
    const champions = fixture.snapshot.fearless.champions.filter((c) => c.gameId !== 'game-1');
    render(
      <TonightView
        {...fixture}
        snapshot={{ ...fixture.snapshot, fearless: { ...fixture.snapshot.fearless, champions } }}
        group={ORIGINAL_GROUP}
      />,
    );
    expect(screen.queryByText('Banned next game')).toBeNull();
  });

  it('shows the picker to an admin in every state, Reset with a ban, and neither to a member or a visitor', async () => {
    for (const key of states) {
      const admin = draw(key, { viewer: ADMIN_VIEWER });
      // The admin foot is code-split (`ModeControlsLazy`): it arrives a tick after the card.
      expect(await screen.findByRole('combobox', { name: 'Mode' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset fearless' })).toBeInTheDocument();
      // M15.5: Spin and the Rated switch on the admin row.
      expect(screen.getByRole('switch', { name: 'Rated' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Spin' })).toBeInTheDocument();
      admin.unmount();
      for (const viewer of [MEMBER_VIEWER, ANON_VIEWER]) {
        const other = draw(key, { viewer });
        expect(screen.queryByRole('combobox', { name: 'Mode' })).toBeNull();
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Spin' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Reset fearless' })).toBeNull();
        expect(screen.queryByRole('form', { name: 'Mode settings' })).toBeNull();
        other.unmount();
      }
    }
  });

  it('hides Reset with an empty pool and in Normal', async () => {
    const { connection: _c, ...empty } = tonightStateFixture('idle', { now: NOW, pool: 'empty' });
    const a = render(<TonightView {...empty} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />);
    expect(await screen.findByRole('combobox', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset fearless' })).toBeNull();
    a.unmount();
    const { connection: _d, ...normal } = tonightStateFixture('idle', { now: NOW, mode: 'normal' });
    render(<TonightView {...normal} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />);
    expect(await screen.findByRole('combobox', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset fearless' })).toBeNull();
  });

  it('empty group: everyone sees it (design ruling on 8.2), the picker for admins only', async () => {
    const member = draw('empty');
    expect(screen.getByRole('region', { name: /^Mode / })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Mode' })).toBeNull();
    member.unmount();
    draw('empty-admin');
    expect(await screen.findByRole('combobox', { name: 'Mode' })).toBeInTheDocument();
  });

  it('switched to Normal tonight: members get the dashed note until a game lands', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('idle', {
      now: NOW,
      mode: 'normal',
      normalJustNow: true,
    });
    render(<TonightView {...fixture} group={ORIGINAL_GROUP} />);
    expect(screen.getByText('Normal mode now.')).toBeInTheDocument();
  });
});

describe('edges', () => {
  it('a player with no name: the fallback word and one hint line', () => {
    const members = workedMembers(3).map((member, index) =>
      index === 0 ? { ...member, name: null } : member,
    );
    render(
      <TonightView
        snapshot={snapshot(lobbyView({ status: 'open', members }))}
        viewer={ANON_VIEWER}
        group={ORIGINAL_GROUP}
        topPlayers={[]}
      />,
    );
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
  });

  it('one h1 in every state, and long names printed whole', () => {
    for (const key of ['balanced', 'filling', 'finished', 'idle'] as const) {
      const { unmount } = draw(key, {}, true);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      if (key !== 'idle') expect(screen.getAllByText('SYNDROMEAXESXXXX').length).toBeGreaterThan(0);
      unmount();
    }
  });
});

/* ---------------------------------------------------------------------------
 * M14.41: the scene walk's Tonight gaps (redesign/scene-walk.md gaps 1 to 6, 12).
 * ------------------------------------------------------------------------- */

/** Every four-digit number in an element's text, as a set. */
function fourDigits(text: string): Set<string> {
  return new Set(text.match(/(?<![\d.])\d{4}(?![\d.])/g) ?? []);
}

/**
 * No name sits beside two different four-digit numbers anywhere on the page: for every element
 * whose own text is exactly a player's name, the row around it (its nearest `li`, else `p`) and
 * every other such row for the same name, together, hold at most one four-digit number.
 */
function numbersBesideNames(container: HTMLElement, names: readonly string[]): Map<string, Set<string>> {
  const seen = new Map<string, Set<string>>();
  for (const element of Array.from(container.querySelectorAll('*'))) {
    const own = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    if (!names.includes(own)) continue;
    const row = element.closest('li') ?? element.closest('p');
    if (row === null) continue;
    const set = seen.get(own) ?? new Set<string>();
    for (const n of fourDigits(row.textContent ?? '')) set.add(n);
    seen.set(own, set);
  }
  return seen;
}

describe('M14.41 gap 1: one Rating per person', () => {
  it('Top this week shows W-L and the change, never a four-digit number', () => {
    draw('finished');
    const top = screen.getByRole('region', { name: TOP_TITLE });
    expect(fourDigits(top.textContent ?? '').size).toBe(0);
    expect(within(top).getAllByText('4W 2L')).toHaveLength(5);
    expect(within(top).getAllByText('gained 58')).toHaveLength(5);
  });

  it('finished, weekly rating != group rating: no name beside two different four-digit numbers', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('finished', { now: NOW });
    // Every top-five row's weekly Rating one point off the team cards' group Rating (the walk's 1341 vs 1342).
    const topPlayers = fixture.topPlayers.map((row) => ({
      ...row,
      rating: row.rating + 1,
      track: 'week' as const,
    }));
    const { container } = render(<TonightView {...fixture} topPlayers={topPlayers} group={ORIGINAL_GROUP} />);
    const names = ['Lena', 'Bilal', 'Rami', 'Iris', 'Karim', 'Omar', 'Hana', 'Theo', 'Nadia', 'Yuki'];
    const beside = numbersBesideNames(container, names);
    expect(beside.size).toBe(10);
    for (const [name, numbers] of beside) expect({ name, n: numbers.size }).toEqual({ name, n: 1 });
  });
});

describe('M14.41 gap 2: the admin press is in the strip', () => {
  const strip = () => {
    const header = screen.getByRole('heading', { level: 1 }).closest('header');
    if (header === null) throw new Error('no strip');
    return header;
  };

  it('Roll teams (over ten), Reroll (balanced), Start a lobby (finished) sit inside the strip', () => {
    const over = draw('over-ten', { viewer: ADMIN_VIEWER });
    expect(within(strip()).getByRole('button', { name: ROLL_LABEL })).toBeInTheDocument();
    over.unmount();
    const balanced = draw('balanced', { viewer: ADMIN_VIEWER });
    expect(within(strip()).getByRole('button', { name: REROLL_LABEL })).toBeInTheDocument();
    balanced.unmount();
    draw('finished');
    expect(within(strip()).getByRole('button', { name: 'Start the next lobby' })).toBeInTheDocument();
  });

  it('members and visitors get no new element: no roll, no reroll, anywhere', () => {
    for (const viewer of [MEMBER_VIEWER, ANON_VIEWER]) {
      for (const key of ['over-ten', 'balanced'] as const) {
        const { unmount } = draw(key, { viewer });
        expect(screen.queryByRole('button', { name: ROLL_LABEL })).toBeNull();
        expect(screen.queryByRole('button', { name: REROLL_LABEL })).toBeNull();
        unmount();
      }
    }
  });
});

describe('M14.41 gap 3: the ten by side, in the strip, for whoever is not seated', () => {
  it('signed out, balanced and in game: two lists of five names, under BLUE and RED', () => {
    for (const key of ['balanced', 'in-game'] as const) {
      const { unmount } = draw(key, { viewer: ANON_VIEWER }, true);
      const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
      const blue = within(header).getByRole('list', { name: 'Blue side' });
      const red = within(header).getByRole('list', { name: 'Red side' });
      expect(within(blue).getAllByRole('listitem')).toHaveLength(5);
      expect(within(red).getAllByRole('listitem')).toHaveLength(5);
      expect(within(header).getByText('BLUE')).toBeInTheDocument();
      expect(within(header).getByText('RED')).toBeInTheDocument();
      // 6.14's long names whole.
      expect(within(header).getByText('Jinxed Lad Who Wanders')).toBeInTheDocument();
      unmount();
    }
  });

  it('a seated linked viewer keeps the answer band, and the strip does not repeat the ten', () => {
    draw('balanced');
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    expect(within(header).queryByRole('list', { name: 'Blue side' })).toBeNull();
    expect(within(header).getByText(/, playing support/)).toBeInTheDocument();
  });

  it('not in the other states', () => {
    for (const key of ['filling', 'finished', 'idle'] as const) {
      const { unmount } = draw(key, { viewer: ANON_VIEWER });
      expect(screen.queryByRole('list', { name: 'Blue side' })).toBeNull();
      unmount();
    }
  });
});

describe('M14.41 gap 4: the sit-out card first, with the reason Discord gives', () => {
  it('is the first card after the strip, for everyone, naming the rule that decided', () => {
    for (const viewer of [ANON_VIEWER, MEMBER_VIEWER]) {
      const { unmount } = draw('balanced', { viewer });
      const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
      const card = screen.getByText(/sits this one out\./);
      expect(card.textContent).toBe(
        "Deniz sits this one out. They've gone longest without sitting out, and everyone's played 1 game tonight.",
      );
      const receipt = screen.getByRole('region', { name: TITLE_BALANCED });
      expect(header.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(card.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      unmount();
    }
  });

  it('the sitter reads it in the second person; no rule known prints the lead alone', () => {
    const fixture = tonightStateFixture('balanced', { now: NOW });
    const first = render(
      <TonightView
        {...fixture}
        viewer={{ kind: 'linked', puuid: 'puuid-deniz', isAdmin: false }}
        group={ORIGINAL_GROUP}
      />,
    );
    expect(
      screen.getByText(
        "You are sitting this one out. You've gone longest without sitting out, and everyone's played 1 game tonight. You are first in line for the next one.",
      ),
    ).toBeInTheDocument();
    first.unmount();
    render(<TonightView {...fixture} sitOutRule={null} group={ORIGINAL_GROUP} />);
    expect(screen.getByText(/sits this one out\./).textContent).toBe('Deniz sits this one out.');
  });
});

describe('M14.41 gap 5: every name is a link', () => {
  it('finished: ten seat links to their player pages, MVP and ACE, and Full scoreboard', () => {
    draw('finished');
    for (const side of ['Blue team', 'Red team']) {
      const card = screen.getByRole('region', { name: side });
      const links = within(card).getAllByRole('link');
      expect(links).toHaveLength(5);
      for (const link of links) expect(link.getAttribute('href')).toMatch(/^\/g\/customs\/p\/puuid-[a-z]+$/);
    }
    // MVP Lena · ACE Iris: their own links beside the stickers (plus the seat and top-five rows).
    expect(screen.getAllByRole('link', { name: 'Lena' }).length).toBeGreaterThanOrEqual(2);
    expect(new Set(screen.getAllByRole('link', { name: 'Lena' }).map((l) => l.getAttribute('href')))).toEqual(
      new Set(['/g/customs/p/puuid-lena']),
    );
    expect(screen.getAllByRole('link', { name: 'Iris' }).map((l) => l.getAttribute('href'))).toContain(
      '/g/customs/p/puuid-iris',
    );
    expect(screen.getByRole('link', { name: 'Full scoreboard' })).toHaveAttribute(
      'href',
      groupHref(ORIGINAL_GROUP, { page: 'game', gameId: 'game-1' }) ?? '',
    );
  });

  it('balanced and in game: the seat names link too, and the reroll still works beside them', () => {
    for (const key of ['balanced', 'in-game'] as const) {
      const { unmount } = draw(key, { viewer: ADMIN_VIEWER });
      expect(within(screen.getByRole('region', { name: 'Blue team' })).getAllByRole('link')).toHaveLength(5);
      // No nested interactive element: no link holds a button and no button holds a link.
      for (const link of screen.getAllByRole('link')) expect(link.querySelector('button, a')).toBeNull();
      unmount();
    }
  });
});

describe('M14.41 gap 6: main roles counted only among people who have one', () => {
  it('Main roles 6/6 · 4 new, said once (the chip, not a second sentence)', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('balanced', { now: NOW });
    const lobby = fixture.snapshot.lobby;
    if (lobby?.teams == null) throw new Error('fixture');
    // Four of the ten with no main role on record, none of them off-role (core: flexible).
    const fresh = new Set(
      [...lobby.teams.blue.slice(0, 2), ...lobby.teams.red.slice(0, 2)].map((s) => s.puuid),
    );
    const teams = {
      ...lobby.teams,
      blue: lobby.teams.blue.map((seat) => (fresh.has(seat.puuid) ? { ...seat, offRole: false } : seat)),
      red: lobby.teams.red.map((seat) => (fresh.has(seat.puuid) ? { ...seat, offRole: false } : seat)),
      stored: lobby.teams.stored.map((split) => ({
        ...split,
        offRoleCount: 0,
        // Core's own all-on-main sentence (explain.ts), which the receipt must not print beside `4 new`.
        explanation: 'Blue favored 54%. Everyone on a main role. Gap 60.',
      })),
    };
    const members = lobby.members.map((member) =>
      fresh.has(member.puuid)
        ? { ...member, mainRole: null, secondaryRole: null, roleOverride: null }
        : member,
    );
    render(
      <TonightView
        {...fixture}
        snapshot={{ ...fixture.snapshot, lobby: { ...lobby, members, teams } }}
        group={ORIGINAL_GROUP}
      />,
    );
    const receipt = screen.getByRole('region', { name: TITLE_BALANCED });
    expect(receipt.textContent).toMatch(/Main roles 6\/6 · 4 new/);
    // M14.45: the chip says it, so the sentence `4 people have no main role yet.` goes.
    expect(receipt.textContent).not.toMatch(/4 people have no main role yet\./);
    expect(receipt.textContent).not.toMatch(/Main roles 10\/10/);
    // M14.41 review: the disclosure's bot note follows the chip too.
    expect(receipt.textContent).not.toContain('Everyone on a main role');
    expect(receipt.textContent).toContain('Blue favored 54%. 4 new, the rest on a main role. Gap 60.');
  });
});

describe('M14.41 gap 12: the tape count', () => {
  it('says 2 earlier while a game is on the page, and 2 played on an idle page', () => {
    const finished = draw('finished');
    expect(
      within(screen.getByRole('region', { name: TAPE_TITLE })).getByText('2 earlier'),
    ).toBeInTheDocument();
    finished.unmount();
    draw('idle');
    expect(
      within(screen.getByRole('region', { name: TAPE_TITLE })).getByText('2 played'),
    ).toBeInTheDocument();
  });
});

/* M14.41 design round 1. */
describe('M14.41 design round 1', () => {
  const stripOf = () => screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;

  it('over ten, the admin who holds Roll teams never reads Waiting on; the hint is the rotation preview', () => {
    draw('over-ten', { viewer: ADMIN_VIEWER });
    const strip = stripOf();
    expect(strip.textContent).not.toMatch(/Waiting on/);
    expect(within(strip).getByText('Ten play, the rest sit out.')).toBeInTheDocument();
    expect(
      within(strip).getByText('If the teams rolled now, Deniz and then Mo would sit out.'),
    ).toBeInTheDocument();
    // Said once: the roster no longer repeats it for the admin.
    expect(screen.getAllByText('If the teams rolled now, Deniz and then Mo would sit out.')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Check everyone/);
  });

  it('over ten, a member keeps Waiting on and the preview under the roster', () => {
    draw('over-ten', { viewer: MEMBER_VIEWER });
    expect(stripOf().textContent).toMatch(/Waiting on/);
    const preview = screen.getByText('If the teams rolled now, Deniz and then Mo would sit out.');
    expect(stripOf().contains(preview)).toBe(false);
  });

  it('at exactly ten, the admin reads All ten are in. and the at-ten hint', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('over-ten', { now: NOW });
    const lobby = fixture.snapshot.lobby;
    if (lobby === null) throw new Error('fixture');
    const ten = { ...lobby, members: lobby.members.slice(0, 10) };
    render(
      <TonightView
        {...fixture}
        snapshot={{ ...fixture.snapshot, lobby: ten }}
        wouldSitOut={null}
        viewer={ADMIN_VIEWER}
        group={ORIGINAL_GROUP}
      />,
    );
    const strip = stripOf();
    expect(within(strip).getByText('All ten are in.')).toBeInTheDocument();
    expect(within(strip).getByText("Roll once everyone who's staying is in the lobby.")).toBeInTheDocument();
    expect(strip.textContent).not.toMatch(/Waiting on/);
  });

  it('finished: the sit-out card is past tense and after the team cards, on the lobby path too', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('balanced', { now: NOW });
    const lobby = fixture.snapshot.lobby;
    if (lobby?.teams == null) throw new Error('fixture');
    // A finished lobby with no result row yet: the lobby path (`Teams`) renders it.
    render(
      <TonightView
        {...fixture}
        snapshot={{ ...fixture.snapshot, lobby: { ...lobby, status: 'finished', result: null } }}
        group={ORIGINAL_GROUP}
      />,
    );
    const card = screen.getByText(/sat this one out\./);
    const red = screen.getByRole('region', { name: 'Red team' });
    const blue = screen.getByRole('region', { name: 'Blue team' });
    expect(red.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(blue.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/sits this one out\./)).toBeNull();
  });

  it("lead ruling (a): Tonight's finished poster counts main roles like the balanced receipt did", () => {
    const { connection: _c, ...fixture } = tonightStateFixture('finished', { now: NOW });
    const lobby = fixture.snapshot.lobby;
    if (lobby?.teams == null) throw new Error('fixture');
    const fresh = new Set(
      [...lobby.teams.blue.slice(0, 2), ...lobby.teams.red.slice(0, 2)].map((x) => x.puuid),
    );
    const members = lobby.members.map((m) =>
      fresh.has(m.puuid) ? { ...m, mainRole: null, secondaryRole: null, roleOverride: null } : m,
    );
    const teams = {
      ...lobby.teams,
      stored: lobby.teams.stored.map((split) => ({
        ...split,
        offRoleCount: 0,
        explanation: 'Blue favored 54%. Everyone on a main role. Gap 60.',
      })),
    };
    render(
      <TonightView
        {...fixture}
        snapshot={{ ...fixture.snapshot, lobby: { ...lobby, members, teams } }}
        group={ORIGINAL_GROUP}
      />,
    );
    const receipt = screen.getByRole('region', { name: TITLE_FINISHED });
    expect(receipt.textContent).toMatch(/Main roles 6\/6 · 4 new/);
    expect(receipt.textContent).not.toContain('Everyone on a main role');
  });
});

describe('M14.58 / M14.59 on the finished poster', () => {
  it("every seat's change opens why it was that size; yours says You", () => {
    draw('finished');
    const buttons = ['Blue team', 'Red team'].flatMap((side) =>
      within(screen.getByRole('region', { name: side })).getAllByRole('button', {
        name: /^(gained|lost) \d+\. Why\?$/,
      }),
    );
    expect(buttons).toHaveLength(10);
    for (const button of buttons) expect(button).toHaveAttribute('aria-expanded', 'false');
    const mine = screen.getAllByRole('listitem').find((item) => item.hasAttribute('data-you')) as HTMLElement;
    const button = within(mine).getByRole('button', { name: /Why\?$/ });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(mine).toHaveTextContent(/You (won|lost) \d+\./);
    expect(mine).toHaveTextContent('Upsets and new players move the most.');
    expect(mine.textContent).not.toMatch(/sigma|\d\.\d/i);
  });

  it("one odds number when the two agree; the points number on the winner's side when they differ", () => {
    const { unmount } = draw('finished');
    expect(screen.queryByText(/For points/)).toBeNull();
    unmount();
    const { connection: _c, ...fixture } = tonightStateFixture('finished', { now: NOW, oddsGap: true });
    render(<TonightView {...fixture} group={ORIGINAL_GROUP} />);
    const receipt = screen.getByRole('region', { name: TITLE_FINISHED });
    expect(
      within(receipt)
        .getByText(/For points, /)
        .closest('p'),
    ).toHaveTextContent(
      /^For points, Red was \d+%, because (new players start at 1200|ratings moved since the roll)\.$/,
    );
  });

  it("a breakdown for another game is ignored (the live refresh can't mix two games)", () => {
    const { connection: _c, ...fixture } = tonightStateFixture('finished', { now: NOW });
    render(
      <TonightView
        {...fixture}
        group={ORIGINAL_GROUP}
        breakdown={fixture.breakdown ? { ...fixture.breakdown, gameId: 'another-game' } : null}
      />,
    );
    expect(screen.queryByRole('button', { name: /Why\?$/ })).toBeNull();
  });
});
