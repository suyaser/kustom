import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { championLane } from '@/lib/champs/lanes';
import { regionName } from '@/lib/champs/regions';
import { NOT_RATED_RESULT_LINE, resultModeLines } from '@/lib/discord/modeLines';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { LANE_ORDER } from '@/lib/laneOrder';
import { START_LOBBY_BUTTON } from '@/lib/lobbyStartCopy';
import { modeCardView } from '@/lib/mode/card';
import { championTable, regionIds } from '@/lib/mode/champions';
import { MODE_NOW_NORMAL_BODY } from '@/lib/mode/copy';
import { MIRROR_HOST_FILLING_LINE, MIRROR_HOST_LEAD, mirrorStatus } from '@/lib/mode/ruleCopy';
import { fearlessCounts } from '@/lib/mode/view';
import { Announcer } from '../_tonight/Announcer';
import {
  ADMIN_VIEWER,
  ANON_VIEWER,
  demoPool,
  fixtureCheck,
  MEMBER_VIEWER,
  type TonightFixtureOptions,
  type TonightStateKey,
  tonightStateFixture,
} from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';
import { ModePanelBody } from './ModePanelBody';
import { ruleLineOf } from './RuleLine';
import { SpinReveal } from './SpinReveal';

/**
 * M15.5: the rules on Tonight, by role and text. The card per state and per rule, the host line,
 * the poster's line, the controls only for admins, the Spin reveal, and the panels.
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');

function draw(key: TonightStateKey, options: TonightFixtureOptions = {}, viewer = MEMBER_VIEWER) {
  const { connection: _c, ...fixture } = tonightStateFixture(key, { now: NOW, ...options });
  return render(<TonightView {...fixture} viewer={viewer} group={ORIGINAL_GROUP} />);
}
const card = () => screen.getByRole('region', { name: /^Mode / });

afterEach(() => {
  vi.useRealTimers();
});

describe('the card per state, class wars', () => {
  it('idle: title, Not rated, the rule, the one-game line and See the tanks', () => {
    draw('idle', { rule: 'class:Tank' });
    const c = within(card());
    expect(c.getByRole('heading', { name: 'Class wars' })).toBeInTheDocument();
    expect(c.getByText('Not rated')).toBeInTheDocument();
    expect(card().textContent).toMatch(/Tanks only · \d+ open/);
    expect(c.getByText('This game only. Then back to Fearless.')).toBeInTheDocument();
    expect(c.getByRole('link', { name: /See the tanks/ })).toHaveAttribute('href', '/g/customs/mode');
  });

  it('under standing Normal the status has no count', () => {
    draw('idle', { rule: 'class:Tank', mode: 'normal' });
    expect(within(card()).getByText('Tanks only')).toBeInTheDocument();
    expect(within(card()).getByText('This game only. Then back to Normal.')).toBeInTheDocument();
  });

  it('filling: lane tiles with the class count per lane', () => {
    draw('filling', { rule: 'class:Tank', mode: 'normal' });
    expect(within(card()).getByRole('link', { name: 'top 18' })).toHaveAttribute(
      'href',
      '/g/customs/mode?lane=top',
    );
    expect(within(card()).getByRole('link', { name: 'adc 0' })).toBeInTheDocument();
  });

  it('balanced: your lane and the answer band say tanks for support', () => {
    draw('balanced', { rule: 'class:Tank', mode: 'normal' });
    expect(within(card()).getByText('11 tanks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tanks for support' })).toHaveAttribute(
      'href',
      '/g/customs/mode?lane=support',
    );
  });

  it('in game: This game: tanks only.', () => {
    draw('in-game', { rule: 'class:Tank' });
    expect(within(card()).getByText('This game: tanks only.')).toBeInTheDocument();
    expect(within(card()).queryByText("This game's ten join the ban list when it ends.")).toBeNull();
  });

  it('finished: the card is back on the standing mode, the poster carries the line', () => {
    draw('finished', { rule: 'class:Tank' });
    expect(within(card()).getByRole('heading', { name: 'Fearless' })).toBeInTheDocument();
    expect(screen.getByText("Tanks only: Blue kept the rule. Red: Jinx isn't a tank.")).toBeInTheDocument();
    // Said once, by the strip, under the headline (design round 1); the poster line does not repeat it.
    expect(screen.getAllByText('Not rated, so no Rating change.')).toHaveLength(1);
    expect(document.querySelector('[data-slot="rule-line"]')).not.toHaveTextContent('Not rated');
  });

  it('in game, a game locked not rated says so in the strip, never the rated sentence', () => {
    draw('in-game', { rule: 'class:Tank' });
    expect(screen.getByText(/Not rated, so no Rating change\./)).toBeInTheDocument();
  });

  it('a Normal game switched to not rated: a result, no deltas, Ratings unchanged, strip says so', () => {
    const { container } = draw('finished', { mode: 'normal', rated: false });
    expect(screen.getByText('Not rated, so no Rating change.')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="rule-line"]')).toBeNull();
    // No signed delta anywhere on the team cards: nobody moved.
    const teams = screen
      .getAllByRole('region')
      .filter((r) => /^(Blue|Red)\b/i.test(r.getAttribute('aria-label') ?? ''));
    for (const team of teams) expect(team.textContent ?? '').not.toMatch(/[+−-]\d+/);
  });
});

describe('region wars and mirror match', () => {
  it('before Roll: sides drawn when teams are rolled, See both pools', () => {
    draw('idle', { rule: 'region' });
    expect(within(card()).getByRole('heading', { name: 'Region wars' })).toBeInTheDocument();
    expect(within(card()).getByText('Sides drawn when teams are rolled.')).toBeInTheDocument();
    expect(within(card()).getByRole('link', { name: /See both pools/ })).toBeInTheDocument();
  });

  it('after Roll: BLUE Ionia vs RED Noxus, your side’s region for your lane', () => {
    draw('balanced', { rule: 'region' });
    const c = within(card());
    expect(c.getByText('BLUE')).toBeInTheDocument();
    expect(c.getAllByText('Ionia').length).toBeGreaterThan(0);
    expect(c.getAllByText('Noxus').length).toBeGreaterThan(0);
    // Theo sits on blue in this split.
    expect(screen.getByRole('link', { name: 'Ionia for support' })).toBeInTheDocument();
    draw('in-game', { rule: 'region' });
    expect(screen.getByText('This game: Ionia vs Noxus.')).toBeInTheDocument();
  });

  it("no draw at Roll: the card says the rule didn't apply", () => {
    draw('balanced', { rule: 'region', noDraw: true });
    expect(within(card()).getByText(/Region wars didn't apply to this game/)).toBeInTheDocument();
  });

  it('mirror: rated, the status, How it works; Start a lobby stays', () => {
    draw('idle', { rule: 'mirror' });
    expect(within(card()).getByText('Rated')).toBeInTheDocument();
    // M15.14: the fixture's night is Fearless, so the status carries the pool's open count.
    expect(card().textContent).toMatch(/Same champion as your lane opponent · \d+ open/);
    expect(within(card()).getByRole('link', { name: /How it works/ })).toBeInTheDocument();
    // M17.17: the companion opens the Blind Pick lobby itself, so the control stays.
    expect(screen.getByRole('button', { name: START_LOBBY_BUTTON })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Mirror match next|Host: open a Blind Pick/);
  });

  it('filling with mirror next: the host line says what to do if this lobby is Draft Pick (QA fix 2026-10-04)', () => {
    const filling = draw('filling', { rule: 'mirror' });
    expect(screen.getByText(MIRROR_HOST_LEAD, { selector: 'b' })).toBeInTheDocument();
    expect(document.body.textContent).toContain(MIRROR_HOST_FILLING_LINE);
    expect(document.body.textContent).toContain(
      'Mirror match next. It needs a Blind Pick lobby. If this one is Draft Pick, the host opens a Blind Pick custom in League and everyone moves to it.',
    );
    filling.unmount();
    // Not for anyone with no linked account, same as Start a lobby.
    const anon = draw('filling', { rule: 'mirror' }, ANON_VIEWER);
    expect(document.body.textContent).not.toContain(MIRROR_HOST_LEAD);
    anon.unmount();
    // Another rule while filling: no line.
    const tanks = draw('filling', { rule: 'class:Tank' });
    expect(document.body.textContent).not.toContain(MIRROR_HOST_LEAD);
    tanks.unmount();
  });

  it('M17.17: idle and finished keep Start a lobby (it makes the Blind Pick lobby itself), no host line', () => {
    const idle = draw('idle', { rule: 'mirror' });
    expect(document.body.textContent).not.toMatch(/Mirror match next|needs a Blind Pick lobby/);
    idle.unmount();
    draw('finished', { rule: 'mirror' });
    expect(document.body.textContent).not.toContain(MIRROR_HOST_LEAD);
    expect(screen.getByRole('button', { name: /lobby/i })).toBeInTheDocument();
  });

  it('a mirror game posts its lane line and rates', () => {
    draw('finished', { rule: 'mirror' });
    expect(screen.getByText('Mirror match: kept in 4 lanes. Mid: Ahri vs Syndra.')).toBeInTheDocument();
    expect(screen.queryByText('Not rated, so no Rating change.')).toBeNull();
  });
});

describe('M15.14: mirror match on a Fearless night shows the Fearless pool', () => {
  const openOf = (pool = demoPool(false)) => fearlessCounts(pool);

  it('pending or locked, the status reads the open count', () => {
    const idle = draw('idle', { rule: 'mirror' });
    expect(card().textContent).toContain(mirrorStatus(openOf().open));
    idle.unmount();
    draw('balanced', { rule: 'mirror' });
    expect(card().textContent).toContain(mirrorStatus(openOf().open));
  });

  it('filling: the five lane tiles with the Fearless open count per lane', () => {
    draw('filling', { rule: 'mirror' });
    const laneOpen = openOf().laneOpen;
    expect(within(card()).getByRole('link', { name: `top ${laneOpen.top}` })).toHaveAttribute(
      'href',
      '/g/customs/mode?lane=top',
    );
    expect(within(card()).getByRole('link', { name: `support ${laneOpen.support}` })).toBeInTheDocument();
  });

  it("balanced, seated: Your lane support · n open, and What's open for support", () => {
    draw('balanced', { rule: 'mirror' });
    const c = within(card());
    expect(c.getByText('Your lane')).toBeInTheDocument();
    expect(c.getByText(`${openOf().laneOpen.support} open`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "What's open for support" })).toHaveAttribute(
      'href',
      '/g/customs/mode?lane=support',
    );
  });

  it("in game: this game's champions join the ban list, not the ten", () => {
    draw('in-game', { rule: 'mirror' });
    expect(
      within(card()).getByText("This game's champions join the ban list when it ends."),
    ).toBeInTheDocument();
    expect(within(card()).queryByText("This game's ten join the ban list when it ends.")).toBeNull();
  });

  it('finished: Banned next game lists each champion the mirror game locked once', () => {
    draw('finished', { rule: 'mirror' });
    const c = within(card());
    expect(c.getByText('Banned next game')).toBeInTheDocument();
    const banned = demoPool(true, 1).champions.filter((one) => one.gameId === 'game-1');
    expect(banned).toHaveLength(5);
    for (const champion of banned) expect(c.getAllByText(champion.name)).toHaveLength(1);
  });

  it('a mirror game on a Normal night is unchanged', () => {
    const idle = draw('idle', { rule: 'mirror', mode: 'normal' });
    expect(within(card()).getByText('Same champion as your lane opponent')).toBeInTheDocument();
    idle.unmount();
    const filling = draw('filling', { rule: 'mirror', mode: 'normal' });
    expect(within(card()).queryByRole('link', { name: /^top \d+$/ })).toBeNull();
    filling.unmount();
    const balanced = draw('balanced', { rule: 'mirror', mode: 'normal' });
    expect(within(card()).queryByText('Your lane')).toBeNull();
    expect(screen.queryByRole('link', { name: /What's open for/ })).toBeNull();
    balanced.unmount();
    draw('in-game', { rule: 'mirror', mode: 'normal' });
    expect(within(card()).queryByText(/join the ban list/)).toBeNull();
  });
});

describe('M15.15: a not-rated game never promises bans', () => {
  const NOT_RATED_IN_GAME = "This game isn't rated, so it bans nothing.";
  const NOT_RATED_FINISHED = 'Not rated, so this game banned nothing.';
  const TEN = "This game's ten join the ban list when it ends.";

  it('Rated off on Fearless, in game: bans nothing, never the ten', () => {
    draw('in-game', { rated: false });
    const c = within(card());
    expect(c.getByRole('heading', { name: 'Fearless' })).toBeInTheDocument();
    expect(c.getByText(NOT_RATED_IN_GAME)).toBeInTheDocument();
    expect(c.queryByText(TEN)).toBeNull();
  });

  it('Rated off on Fearless, in game: the strip and the card agree it is not rated', () => {
    draw('in-game', { rated: false });
    expect(screen.getByText(/Not rated, so no Rating change\./)).toBeInTheDocument();
    expect(within(card()).getByText('Not rated')).toBeInTheDocument();
    expect(within(card()).getByText(NOT_RATED_IN_GAME)).toBeInTheDocument();
  });

  it('Rated off on Fearless, finished: the sentence sits where Banned next game would be', () => {
    draw('finished', { rated: false });
    const c = within(card());
    expect(c.getByText(NOT_RATED_FINISHED)).toBeInTheDocument();
    expect(c.queryByText('Banned next game')).toBeNull();
    // It leads the card, before the next game's row.
    const head = c.getByText('Next game');
    expect(
      c.getByText(NOT_RATED_FINISHED).compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('region wars not drawn at Roll, in game: the Fearless game it fell back to bans nothing', () => {
    draw('in-game', { rule: 'region', noDraw: true });
    const c = within(card());
    expect(c.getByText(/Region wars didn't apply to this game/)).toBeInTheDocument();
    expect(c.getByText(NOT_RATED_IN_GAME)).toBeInTheDocument();
    expect(c.queryByText(TEN)).toBeNull();
  });

  it('a not-rated rule game on Fearless keeps its rule line and adds that it bans nothing', () => {
    draw('in-game', { rule: 'class:Tank' });
    expect(within(card()).getByText('This game: tanks only.')).toBeInTheDocument();
    expect(within(card()).getByText(NOT_RATED_IN_GAME)).toBeInTheDocument();
    draw('in-game', { rule: 'mirror', rated: false });
    expect(screen.queryByText("This game's champions join the ban list when it ends.")).toBeNull();
  });

  it('balanced with an empty pool and Rated off: no promise of next-game bans', () => {
    draw('balanced', { rated: false, pool: 'empty' });
    const c = within(card());
    expect(
      c.getByText(
        "Nothing banned yet, so every champion is open. This game isn't rated, so it bans nothing.",
      ),
    ).toBeInTheDocument();
    expect(c.queryByText(/banned next game\.$/)).toBeNull();
  });

  it('rated Fearless is unchanged: the ten, then Banned next game', () => {
    const inGame = draw('in-game');
    expect(within(card()).getByText(TEN)).toBeInTheDocument();
    expect(within(card()).queryByText(NOT_RATED_IN_GAME)).toBeNull();
    inGame.unmount();
    draw('finished');
    expect(within(card()).getByText('Banned next game')).toBeInTheDocument();
    expect(within(card()).queryByText(NOT_RATED_FINISHED)).toBeNull();
  });

  it('the finished card heads its row Next game, so its Rated chip is the next game’s', () => {
    const finished = draw('finished', { rated: false });
    expect(within(card()).getByText('Next game')).toBeInTheDocument();
    expect(within(card()).getByText('Rated')).toBeInTheDocument();
    finished.unmount();
    for (const key of ['idle', 'balanced', 'in-game'] as const) {
      const other = draw(key);
      expect(within(card()).queryByText('Next game')).toBeNull();
      other.unmount();
    }
  });
});

describe('who gets controls', () => {
  it('admins get the select, Spin and Rated; after Roll, the next game line; members and visitors none', async () => {
    const admin = draw('in-game', { rule: 'class:Tank', queued: 'class:Mage' }, ADMIN_VIEWER);
    expect(await screen.findByRole('button', { name: 'Spin' })).toBeInTheDocument();
    expect(screen.getByText('Next game: Mages only.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveValue('class:Mage');
    admin.unmount();
    for (const viewer of [MEMBER_VIEWER, ANON_VIEWER]) {
      const other = draw('idle', { rule: 'class:Tank' }, viewer);
      expect(screen.queryByRole('button', { name: 'Spin' })).toBeNull();
      expect(screen.queryByRole('switch')).toBeNull();
      expect(screen.queryByText('Next game: Mages only.')).toBeNull();
      other.unmount();
    }
  });
});

describe("M14's switched-off note after a rule game", () => {
  it('does not show when the card went back to Normal because a game landed', () => {
    const { connection: _c, ...fixture } = tonightStateFixture('filling', {
      now: NOW,
      mode: 'normal',
      normalJustNow: true,
    });
    const since = fixture.snapshot.modeSince ?? '';
    const shown = render(<TonightView {...fixture} group={ORIGINAL_GROUP} />);
    expect(screen.getByText(MODE_NOW_NORMAL_BODY)).toBeInTheDocument();
    shown.unmount();
    // The compare-and-clear wrote the card two seconds after the rule game was recorded.
    const landed = new Date(Date.parse(since) - 2_000).toISOString();
    render(
      <TonightView
        {...fixture}
        snapshot={{ ...fixture.snapshot, lastGameAt: landed }}
        group={ORIGINAL_GROUP}
      />,
    );
    expect(screen.queryByText(MODE_NOW_NORMAL_BODY)).toBeNull();
  });

  it('the announcer says the rule is done instead', () => {
    const before = {
      standing: 'normal' as const,
      pending: { id: 'class' as const, tag: 'Tank' as const },
      nextRated: false,
      lockedRule: { id: 'class' as const, tag: 'Tank' as const },
      lobbyStatus: 'in_game',
    };
    const { rerender } = render(<Announcer text="" mode="normal" speech={before} />);
    rerender(
      <Announcer
        text=""
        mode="normal"
        speech={{
          standing: 'normal',
          pending: null,
          nextRated: true,
          lockedRule: null,
          lobbyStatus: 'finished',
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent("This game's rule is done. Back to Normal.");
  });
});

describe('the Spin reveal', () => {
  const labels = { 'class:Tank': 'Tanks only', region: 'Region wars' };
  const spin = (rule: string, source: 'local' | 'broadcast' = 'local') =>
    act(() => {
      window.dispatchEvent(new CustomEvent('kustom:spin-reveal', { detail: { rule, source } }));
    });
  const reveal = () => document.querySelector('[data-slot="spin-reveal"]');
  const reduced = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));

  afterEach(() => vi.unstubAllGlobals());

  it("reduced motion: the admin's own result at once once the card agrees, said by the announcer", () => {
    reduced();
    render(
      <>
        <Announcer text="" mode="fearless" />
        <SpinReveal labels={labels} pendingKey="class:Tank">
          <span>Tanks only</span>
        </SpinReveal>
      </>,
    );
    spin('class:Tank');
    expect(reveal()).toHaveTextContent('Spin says: Tanks only.');
    expect(screen.getByRole('status')).toHaveTextContent('Spin says: Tanks only.');
  });

  it('with motion: cycles for at most 1.5 s and lands on the same result', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<SpinReveal labels={labels} pendingKey="region" />);
    spin('region');
    expect(screen.queryByText('Spin says: Region wars.')).toBeNull();
    act(() => vi.advanceTimersByTime(1_500));
    expect(screen.getByText('Spin says: Region wars.')).toBeInTheDocument();
  });

  it('ignores a rule it does not know', () => {
    render(<SpinReveal labels={labels} pendingKey={null} />);
    spin('class:Fighter');
    expect(reveal()).toBeNull();
  });

  it('a forged broadcast for a rule that is not pending: no reveal, no announcement', () => {
    vi.useFakeTimers();
    reduced();
    const view = render(
      <>
        <Announcer text="" mode="fearless" />
        <SpinReveal labels={labels} pendingKey="region" />
      </>,
    );
    spin('class:Tank', 'broadcast');
    expect(reveal()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('');
    // Long after, a refresh that still does not name it plays nothing either.
    act(() => vi.advanceTimersByTime(10_000));
    view.rerender(
      <>
        <Announcer text="" mode="fearless" />
        <SpinReveal labels={labels} pendingKey="class:Tank" />
      </>,
    );
    expect(reveal()).toBeNull();
  });

  it('a matching broadcast before the refresh: revealed once the refresh confirms it', () => {
    reduced();
    const view = render(<SpinReveal labels={labels} pendingKey={null} />);
    spin('class:Tank', 'broadcast');
    expect(reveal()).toBeNull();
    view.rerender(<SpinReveal labels={labels} pendingKey="class:Tank" />);
    expect(reveal()).toHaveTextContent('Spin says: Tanks only.');
  });

  it("M19.13: the admin's own Spin plays the route's answer at once (local); then the status is back", () => {
    vi.useFakeTimers();
    reduced();
    const view = render(
      <SpinReveal labels={labels} pendingKey={null}>
        <span>Every champion is open.</span>
      </SpinReveal>,
    );
    // The controls put the answer in the client mode store and dispatch `local` in the same tick,
    // before the card's `pendingKey` has re-rendered: it still plays, with no wait for a row.
    spin('class:Tank', 'local');
    expect(reveal()).toHaveTextContent('Spin says: Tanks only.');
    view.rerender(
      <SpinReveal labels={labels} pendingKey="class:Tank">
        <span>Tanks only</span>
      </SpinReveal>,
    );
    // In the status slot: the landing replaces the status line, no box of its own.
    expect(reveal()).toHaveTextContent('Spin says: Tanks only.');
    expect(screen.queryByText('Tanks only')).toBeNull();
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByText('Tanks only')).toBeInTheDocument();
  });

  it('hides what would spoil the result while it cycles, and shows it again on landing (design round 2)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { container, unmount } = render(
      <section data-slot="mode-card">
        <span data-spin-hide="">Class wars</span>
        <SpinReveal labels={labels} pendingKey="class:Tank">
          <span>Tanks only</span>
        </SpinReveal>
      </section>,
    );
    const card = container.querySelector('[data-slot="mode-card"]') as HTMLElement;
    expect(card).not.toHaveAttribute('data-spin-cycling');
    spin('class:Tank');
    act(() => vi.advanceTimersByTime(300));
    expect(card).toHaveAttribute('data-spin-cycling');
    act(() => vi.advanceTimersByTime(1_200));
    expect(reveal()).toHaveTextContent('Spin says: Tanks only.');
    expect(card).not.toHaveAttribute('data-spin-cycling');
    spin('class:Tank');
    act(() => vi.advanceTimersByTime(300));
    unmount();
    expect(card).not.toHaveAttribute('data-spin-cycling');
  });

  it('a matching broadcast after the refresh: revealed', () => {
    reduced();
    render(<SpinReveal labels={labels} pendingKey="class:Tank" />);
    spin('class:Tank', 'broadcast');
    expect(reveal()).toHaveTextContent('Spin says: Tanks only.');
  });
});

describe('the poster line', () => {
  it('equals the line the result post builds for the same verdict', () => {
    for (const rule of ['class:Tank', 'region', 'mirror'] as const) {
      const mode =
        rule === 'class:Tank'
          ? ({ id: 'class', tag: 'Tank' } as const)
          : rule === 'region'
            ? ({ id: 'region', blue: 'ionia', red: 'noxus' } as const)
            : ({ id: 'mirror' } as const);
      const check = fixtureCheck(mode.id === 'class' ? mode : { id: mode.id });
      const rated = mode.id === 'mirror';
      // The poster prints the check line; `Not rated, so no Rating change.` is the strip's (round 1).
      const line = ruleLineOf({ rule: mode, rated, rift: true, check });
      expect([line]).toEqual(
        resultModeLines({ rated, rule: { mode, check } }).filter((one) => one !== NOT_RATED_RESULT_LINE),
      );
    }
  });

  it('says nothing for a rated standing game, and nothing about rating for an ARAM or remake', () => {
    expect(ruleLineOf({ rule: null, rated: true, rift: true, check: null })).toBeNull();
    expect(ruleLineOf({ rule: null, rated: false, rift: false, check: null })).toBeNull();
  });

  it('sits inside the finished poster, after the headline and before the answer row (design round 2)', () => {
    draw('finished', { rule: 'class:Tank' });
    const poster = screen.getByRole('banner');
    const line = within(poster).getByText("Tanks only: Blue kept the rule. Red: Jinx isn't a tank.");
    const answer = within(poster).getByText('lost', { exact: false });
    expect(line.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(poster).getByRole('heading', { level: 1 }).compareDocumentPosition(line) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('the panels', () => {
  const panel = (
    rule: string,
    extra: {
      drawn?: boolean;
      standing?: 'normal' | 'fearless';
      side?: 'red';
      regions?: { blue: string; red: string };
    } = {},
  ) => {
    const standing = extra.standing ?? 'normal';
    const fearless = standing === 'fearless' ? demoPool(false) : { champions: [], resetAt: null, games: 0 };
    const pending =
      rule === 'class:Tank'
        ? ({ id: 'class', tag: 'Tank' } as const)
        : rule === 'region'
          ? ({ id: 'region' } as const)
          : ({ id: 'mirror' } as const);
    const view = modeCardView({
      state: { standing, pending, ratedOverride: null, version: 1 },
      lobbyStatus: extra.drawn ? 'balanced' : null,
      lock: extra.drawn
        ? {
            mode: { id: 'region', ...(extra.regions ?? { blue: 'ionia', red: 'noxus' }) },
            rated: false,
            version: 1,
          }
        : null,
      bans: fearless.champions.map((c) => c.id),
      table: championTable(),
    });
    return render(
      <ModePanelBody
        mode={standing}
        fearless={fearless}
        view={view}
        lane="all"
        viewerLane={null}
        viewerSide={extra.side ?? null}
        isAdmin={false}
        poolSince={null}
        cardHref="/g/customs#mode"
        heading="h2"
        headingId="t"
      />,
    );
  };

  it('class: heading, rule, sentence, counts and an empty lane in words', () => {
    panel('class:Tank');
    expect(screen.getByRole('heading', { level: 2, name: 'Class wars' })).toBeInTheDocument();
    expect(screen.getByText('Tanks only')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Everyone picks a tank this game: any champion Riot lists as a Tank. Nobody is stopped in champ select; the result post says which side kept the rule. Not rated: Ratings don't move.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^46 tanks of \d{3} champions$/)).toBeInTheDocument();
    expect(
      screen.getByText('No tank is usually played here. Any tank on this list may go adc.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Banned/)).toBeNull();
  });

  it('class under standing Fearless folds the banned tanks underneath', () => {
    panel('class:Tank', { standing: 'fearless' });
    expect(screen.getAllByText('Banned').length).toBeGreaterThan(0);
  });

  it('region before Roll, then both pools with the viewer side first, and the credit', () => {
    const before = panel('region');
    expect(screen.getByText('The two regions are drawn when teams are rolled.')).toBeInTheDocument();
    expect(
      screen.getByText("Regions from Meraki's lolstaticdata and the League of Legends Wiki."),
    ).toBeInTheDocument();
    before.unmount();
    panel('region', { drawn: true, side: 'red' });
    expect(screen.getByText(/^Blue picks only from Ionia, Red only from Noxus\./)).toBeInTheDocument();
    const pools = screen
      .getAllByRole('region')
      .filter((r) => /^(BLUE|RED) \w+$/.test(r.getAttribute('aria-label') ?? ''));
    // Blue then red in the DOM (blue left at ≥1024); the seated viewer's side is marked to go first
    // below 1024 (round 1).
    expect(pools.map((r) => r.getAttribute('aria-label'))).toEqual(['BLUE Ionia', 'RED Noxus']);
    expect(
      pools.filter((r) => r.hasAttribute('data-viewer-side')).map((r) => r.getAttribute('aria-label')),
    ).toEqual(['RED Noxus']);
    expect(within(pools[0] as HTMLElement).getByText('Yasuo')).toBeInTheDocument();
    expect(within(pools[1] as HTMLElement).queryByText('Yasuo')).toBeNull();
  });

  it('region: a lane where none of a side usually plays keeps its row, with the sentence (QA fix 2026-10-04)', () => {
    const table = championTable();
    // A real region with a lane none of its champions usually plays, and one with every lane.
    const lanesOf = (region: string) =>
      new Set(
        [...table]
          .filter(([, facts]) => facts.region === region)
          .map(([id]) => championLane(id))
          .filter((role) => role !== null),
      );
    const sparse = regionIds().find((region) => lanesOf(region).size > 0 && lanesOf(region).size < 5);
    const full = regionIds().find((region) => lanesOf(region).size === 5);
    if (sparse === undefined || full === undefined) throw new Error('no region with a missing lane');
    const missing = LANE_ORDER.find((role) => !lanesOf(sparse).has(role)) as string;
    panel('region', { drawn: true, regions: { blue: sparse, red: full } });
    const pools = screen
      .getAllByRole('region')
      .filter((r) => /^(BLUE|RED) /.test(r.getAttribute('aria-label') ?? ''));
    const blue = within(pools[0] as HTMLElement);
    const name = regionName(sparse as Parameters<typeof regionName>[0]);
    const sentence = `No champion from ${name} usually plays here. Any of them will do.`;
    const title = `BLUE ${name}`;
    const lane = blue.getByRole('region', { name: `${title} ${missing}` });
    expect(within(lane).getByText(sentence)).toBeInTheDocument();
    // Every lane has its row on that side: no empty column on the board.
    expect(blue.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining(LANE_ORDER.map((role) => `${title} ${role}`)),
    );
    // The full side says it nowhere.
    expect(within(pools[1] as HTMLElement).queryByText(/usually plays here/)).toBeNull();
  });

  it('mirror on a Fearless night: the sentence above the Fearless pool, bans folded by lane', () => {
    panel('mirror', { standing: 'fearless' });
    const sentence = screen.getByText(/^You and your lane opponent play the same champion\./);
    const pool = screen.getByText(/Every champion locked/);
    // The mirror sentence comes first, then the pool head.
    expect(sentence.compareDocumentPosition(pool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const counts = fearlessCounts(demoPool(false));
    expect(screen.getByText(String(counts.open))).toBeInTheDocument();
    expect(screen.getAllByText('Banned').length).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: 'Lane' })).toBeInTheDocument();
  });

  it('Fearless not rated: the panel makes no promise of bans (M15.15)', () => {
    const fearless = demoPool(false);
    const view = (drawn: boolean) =>
      modeCardView({
        state: { standing: 'fearless', pending: null, ratedOverride: false, version: 1 },
        lobbyStatus: drawn ? 'balanced' : null,
        lock: drawn ? { mode: { id: 'fearless' }, rated: false, version: 1 } : null,
        bans: fearless.champions.map((c) => c.id),
        table: championTable(),
      });
    const body = (drawn: boolean) =>
      render(
        <ModePanelBody
          mode="fearless"
          fearless={fearless}
          view={view(drawn)}
          lane="all"
          viewerLane={null}
          isAdmin={false}
          poolSince={null}
          cardHref="/g/customs#mode"
          heading="h2"
          headingId="t"
        />,
      );
    const next = body(false);
    expect(
      screen.getByText("Still open, by lane. Next game isn't rated, so it bans nothing."),
    ).toBeInTheDocument();
    next.unmount();
    body(true);
    expect(
      screen.getByText("Still open, by lane. This game isn't rated, so it bans nothing."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Played champions are banned next game/)).toBeNull();
  });

  it('mirror on a Normal night: the sentence alone', () => {
    panel('mirror');
    expect(screen.queryByText(/Every champion locked/)).toBeNull();
    expect(screen.queryByText('Banned')).toBeNull();
  });

  it('mirror: the sentence; Normal lists the rules', () => {
    const mirror = panel('mirror');
    expect(
      screen.getByText(/^You and your lane opponent play the same champion\. It needs a Blind Pick lobby\./),
    ).toBeInTheDocument();
    mirror.unmount();
  });
});
