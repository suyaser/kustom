import { resolveRoles } from '@customs/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NO_MORE_SPLITS } from '@/lib/admin/reroll';
import type { BoardRow } from '@/lib/board/types';
import { SWITCH_SIDE_ENABLED } from '@/lib/commands/gate';
import {
  FEARLESS_OPEN,
  FEARLESS_SEARCH,
  FEARLESS_SEARCH_EMPTY,
  FEARLESS_SENTENCE,
  FEARLESS_TITLE,
  fearlessAvailable,
  fearlessBanned,
} from '@/lib/fearless/copy';
import { invitedLine, openingOnPcLine, START_LOBBY_BUTTON } from '@/lib/lobbyStart';
import { MYSTERY_EMPTY, MYSTERY_TITLE } from '@/lib/mystery/copy';
import type { MysteryPageState } from '@/lib/mystery/service';
import { NO_ACTIVE_SEASON_MESSAGE, NO_ACTIVE_SEASON_TONIGHT_MESSAGE } from '@/lib/season';
import {
  extraMember,
  FIXTURE_NIGHT_START,
  lobbyView,
  offRoleFixture,
  seatedOnTheirSides,
  snapshot,
  workedMembers,
  workedResult,
  workedTeams,
} from '@/lib/testing/tonightFixtures';
import {
  ALL_FLEXIBLE_HINT,
  HEAD_SEPARATOR,
  IDLE_SENTENCE,
  missedInviteSentence,
  NAMELESS_HINT,
  OFF_ROLE_LEGEND,
  OFF_ROLE_LEGEND_SUFFIX,
  SIGN_IN_LABEL,
  START_LOBBY_SIGN_IN,
  sideLine,
} from '@/lib/tonight/copy';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';
import type { SeatView, TonightSnapshot } from '@/lib/tonight/types';
import type { ViewerState } from '@/lib/tonight/viewer';
import { TonightView } from './TonightView';

/**
 * The tonight page's states, from fixture data (M3.4, restyled by M3.18).
 *
 * The acceptance checks these stand in for are the ones a night cannot be run to re-check: the
 * copy is product's word for word, the rack is ten rows at every count, the sit-out strip is
 * *above* the cards, a `-0` prints as `(−0)`, and the reroll control exists only for an admin
 * and only while there is a split left to promote. Realtime itself is exercised against the
 * local stack by hand.
 *
 * The page has **no `<h1>`**: the one heading is the shell's wordmark, so the strip's headline
 * is a `<p>` and every assertion here reads text rather than a heading role.
 */

function draw(
  state: TonightSnapshot,
  viewer: {
    puuid?: string;
    isAdmin?: boolean;
    topPlayers?: readonly BoardRow[];
    /** Tonight's `create_lobby`, which only a linked viewer's render is ever given (M4.13). */
    lobbyStart?: LobbyStartView | null;
    mystery?: MysteryPageState | null;
  } = {},
) {
  // Anonymous unless the test names a puuid or an admin: `null` used to mean both "signed
  // out" and "signed in with no player row", and M3.6 needs the two apart
  // (`lib/tonight/viewer.ts`). An admin with no puuid is a linked viewer who is not in this
  // lobby — which is what the reroll tests mean by "an admin is looking".
  const who: ViewerState =
    viewer.puuid === undefined && viewer.isAdmin !== true
      ? { kind: 'anonymous' }
      : {
          kind: 'linked',
          puuid: viewer.puuid ?? 'puuid-not-in-this-lobby',
          isAdmin: viewer.isAdmin ?? false,
        };

  return render(
    <TonightView
      snapshot={state}
      viewer={who}
      topPlayers={viewer.topPlayers ?? []}
      lobbyStart={viewer.lobbyStart ?? null}
      mystery={viewer.mystery ?? null}
    />,
  );
}

/**
 * The strip's three lines, in order, as a reader sees them. A line's own parts are joined with
 * a space: the count, the headline and the live pill are three elements with no whitespace
 * between them in the markup, and `11IN THE LOBBYlive` is not what anybody reads.
 */
function strip(container: HTMLElement): string[] {
  return [...(container.querySelector('.cn-strip')?.children ?? [])].map((line) => {
    const parts =
      line.childElementCount === 0
        ? [line.textContent ?? '']
        : [...line.querySelectorAll(':scope > *')].map((part) => part.textContent ?? '');
    return parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(' ');
  });
}

describe('idle: no lobby tonight', () => {
  it('says the night, the state and the shipped sentence, and shows an empty rack', () => {
    const { container } = draw(snapshot(null));

    expect(strip(container)).toEqual(['Tuesday 8 September', 'NOBODY IN YET', IDLE_SENTENCE]);
    // The rack is the idle page's body: ten `open` seats, the shape the page will have later.
    expect(container.querySelectorAll('.cn-rack-open')).toHaveLength(10);
    expect(screen.getByText('SEATS · 0 of 10')).toBeInTheDocument();
    // The v1 idle link is gone: `Leaderboard` is a tab in the shell. One destination, one place.
    expect(screen.queryByText('Last night and the board')).not.toBeInTheDocument();
    // Nothing is rendered under the rack at zero: the fact is said once, in the strip.
    expect(screen.queryByText('Nobody in the lobby yet.')).not.toBeInTheDocument();
    expect(screen.queryByText(ALL_FLEXIBLE_HINT)).not.toBeInTheDocument();
  });

  /**
   * M3.30: at 1280 the idle column is 44rem, not the 1300px the two-column grid gives it.
   * The class is the whole of the mechanism — `tonight.css` caps `.cn-grid-idle > .cn-col`
   * inside the ≥1080px block — so what a test can check is that it is on the idle page and on
   * no other, and that the rail's own track is untouched.
   */
  it('caps its column at 44rem beside the rail, and only in idle', () => {
    const { container, unmount } = draw(snapshot(null));
    expect(container.querySelector('.cn-grid')?.className).toBe('cn-grid cn-grid-rail cn-grid-idle');
    unmount();

    for (const state of [
      snapshot(lobbyView({ members: workedMembers(3) })),
      snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })),
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
    ]) {
      const busy = draw(state);
      expect(busy.container.querySelector('.cn-grid')?.className).toBe('cn-grid cn-grid-rail');
      busy.unmount();
    }
  });

  it('carries the two cards inline, because there is nothing else to read', () => {
    draw(snapshot(null));

    expect(screen.getAllByText('How this works').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Run the companion').length).toBeGreaterThan(0);
  });

  it('puts Daily Mystery above the empty rack, so the idle page still has something to play', () => {
    const { container } = draw(snapshot(null), {
      mystery: { kind: 'empty', empty: { empty: true, expiresAt: '2026-09-14T21:00:00.000Z' } },
    });

    expect(screen.getByRole('heading', { name: MYSTERY_TITLE })).toBeInTheDocument();
    expect(screen.getByText(MYSTERY_EMPTY)).toBeInTheDocument();
    const blocks = [...container.querySelectorAll('.cn-col > .cn-block')];
    expect(blocks[0]?.classList.contains('cn-mystery-home')).toBe(true);
  });

  /**
   * **The slug is the night and nothing else** (M5.12, product 2026-09-10), and the page says
   * nothing about a season until the one thing a friend can act on is true: that tonight's
   * games are not being saved. The two cases were separate tests while the slug carried a
   * season name; there is one line to check now.
   */
  it('is the night alone in the slug, and one sentence when games are not being saved', () => {
    const { container, unmount } = draw(snapshot(null));
    expect(container.querySelector('.cn-slug')).toHaveTextContent('Tuesday 8 September');
    expect(container.querySelector('.cn-slug')?.textContent).not.toContain('·');
    expect(document.body.textContent?.toLowerCase()).not.toContain('season');
    expect(screen.queryByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).not.toBeInTheDocument();
    unmount();

    const { container: broken } = draw(snapshot(null, { seasonActive: false }));
    expect(broken.querySelector('.cn-slug')).toHaveTextContent('Tuesday 8 September');
    expect(screen.getByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).toBeInTheDocument();
    // Never the admin sentence: it is written for whoever can open a database console (M3.17).
    expect(screen.queryByText(NO_ACTIVE_SEASON_MESSAGE)).not.toBeInTheDocument();
  });

  it('puts the no-season line directly under the status strip, not at the foot of the page', () => {
    const { container } = draw(
      snapshot(lobbyView({ status: 'balanced', teams: workedTeams() }), { seasonActive: false }),
    );

    const main = container.querySelector('main');
    expect([...(main?.children ?? [])].map((child) => child.className)).toEqual([
      'cn-strip',
      'cn-notice',
      'cn-block',
      // M3.6's card, and it is deliberately **last**: for a signed-out reader it is the one
      // control that starts the Discord round trip, and it may never sit above the teams.
      'cn-card cn-role-card',
    ]);
  });

  it('carries the no-season line in every state, and in none of them when a season is live', () => {
    const states = [
      snapshot(null),
      snapshot(lobbyView({ members: workedMembers(3) })),
      snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })),
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
    ];

    for (const state of states) {
      const live = draw(state);
      expect(screen.queryByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).not.toBeInTheDocument();
      live.unmount();

      const without = draw({ ...state, seasonActive: false });
      expect(screen.getByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).toBeInTheDocument();
      without.unmount();
    }
  });
});

describe('filling: the lobby is open', () => {
  it('counts the people around and seats them in join order with their ratings', () => {
    const { container } = draw(snapshot(lobbyView({ members: workedMembers(3) })));

    expect(strip(container)).toEqual(['Tuesday 8 September', '3 IN THE LOBBY live', 'Seven more to go.']);
    const rows = [...container.querySelectorAll('.cn-rack-row')];
    expect(rows.slice(0, 3).map((row) => row.textContent)).toEqual([
      'Bilaladc · mid1713',
      'Hanatop · mid1434',
      'Irisjungle · top1578',
    ]);
    // Ten seats, always: the seven that are open are seats and not blank rows.
    expect(rows).toHaveLength(10);
    expect(container.querySelectorAll('.cn-rack-open')).toHaveLength(7);
  });

  it('has an empty state that is a rack of ten open seats and one sentence in the strip', () => {
    const { container } = draw(snapshot(lobbyView({ members: [] })));

    expect(strip(container)[1]).toBe('0 IN THE LOBBY live');
    expect(strip(container)[2]).toBe('Nobody in the lobby yet.');
    expect(container.querySelectorAll('.cn-rack-open')).toHaveLength(10);
    // Said once. The old under-the-rack copy of the same sentence is gone.
    expect(screen.getAllByText('Nobody in the lobby yet.')).toHaveLength(1);
  });

  it('puts the eleventh person under the Around divider, not among the ten', () => {
    const { container } = draw(snapshot(lobbyView({ members: [...workedMembers(), extraMember()] })));

    expect(strip(container)[1]).toBe('11 IN THE LOBBY live');
    expect(strip(container)[2]).toBe('Ten play, the rest sit out this game.');
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    expect(within(lists[1] as HTMLElement).getByText('Deniz')).toBeInTheDocument();
    expect(screen.getByText('Around')).toBeInTheDocument();
    // Nothing is reserved for them: the second list is one row long.
    expect((lists[1] as HTMLElement).querySelectorAll('li')).toHaveLength(1);
  });

  it('shows no teams, no prediction and no countdown before the balance', () => {
    draw(snapshot(lobbyView({ members: workedMembers(9) })));

    expect(screen.queryByText('BLUE')).not.toBeInTheDocument();
    expect(screen.queryByText(/favored/)).not.toBeInTheDocument();
    expect(screen.queryByText(/waiting/i)).not.toBeInTheDocument();
  });

  it('marks a member who joined in the last three seconds, and lets it fade', async () => {
    const [first, ...rest] = workedMembers();
    if (first === undefined) throw new Error('no member');
    const { container } = draw(
      snapshot(lobbyView({ members: [{ ...first, joinedAt: new Date().toISOString() }, ...rest] })),
    );

    // The marker is always in the DOM — only its opacity changes — so the row never resizes.
    expect(container.querySelectorAll('.cn-new')).toHaveLength(10);
    await waitFor(() => expect(container.querySelectorAll('.cn-new-on')).toHaveLength(1));
    expect(container.querySelectorAll('.cn-new-on')[0]?.closest('li')).toHaveTextContent('Bilal');
  });

  it('marks nobody when the lobby filled up minutes ago', () => {
    const { container } = draw(snapshot(lobbyView({ members: workedMembers() })));
    expect(container.querySelectorAll('.cn-new-on')).toHaveLength(0);
  });

  it('marks the signed-in viewer, and nobody else', () => {
    const { container } = draw(snapshot(lobbyView({ members: workedMembers() })), {
      puuid: 'puuid-hana',
    });

    const mine = container.querySelectorAll('.cn-you');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toHaveTextContent('Hana');
  });
});

describe('the role column only appears when it distinguishes', () => {
  const flexible = workedMembers(6).map((member) => ({
    ...member,
    mainRole: null,
    secondaryRole: null,
  }));

  it('drops the column and says it once when nobody on screen has a role', () => {
    const { container } = draw(snapshot(lobbyView({ members: flexible })));

    expect(container.querySelectorAll('.cn-rack-roles')).toHaveLength(0);
    expect(screen.getAllByText(ALL_FLEXIBLE_HINT)).toHaveLength(1);
    // Never a column of nine identical grey words.
    expect(container.textContent).not.toContain('flexible');
  });

  it('says it once for an admin too: the `Set roles` link went with M5.17', () => {
    const { container } = draw(snapshot(lobbyView({ members: flexible })), { isAdmin: true });

    expect(screen.getAllByText(ALL_FLEXIBLE_HINT)).toHaveLength(1);
    // The hint is a sentence, not a signpost. `/admin/players` shows the inferred pair
    // read-only, so there is no longer a page for an admin to go and set a role on.
    expect(container.querySelector('.cn-hint a')).toBeNull();
    expect(container.textContent).not.toContain('Set roles');
  });

  it('shows the column, with `flexible` on the rows that have none, as soon as one does', () => {
    const [first, ...rest] = flexible;
    if (first === undefined) throw new Error('no member');
    const { container } = draw(snapshot(lobbyView({ members: [{ ...first, mainRole: 'jungle' }, ...rest] })));

    expect(container.querySelectorAll('.cn-rack-roles')).toHaveLength(6);
    expect(screen.getAllByText('flexible')).toHaveLength(5);
    expect(screen.queryByText(ALL_FLEXIBLE_HINT)).not.toBeInTheDocument();
  });

  it('turns the column on for an override alone: a tap is a role on screen', () => {
    const [first, ...rest] = flexible;
    if (first === undefined) throw new Error('no member');
    const { container } = draw(
      snapshot(lobbyView({ members: [{ ...first, roleOverride: 'adc' }, ...rest] })),
    );

    expect(container.querySelectorAll('.cn-rack-roles')).toHaveLength(6);
    // A flexible player who taps has a main for tonight and no backup.
    expect(container.querySelector('.cn-rack-roles')?.textContent).toBe('adc');
  });
});

describe("the rack prints tonight's roles, not the profile's (M3.6)", () => {
  /** Iris mains jungle with top as her backup, from the worked example. */
  const iris = workedMembers(3)[2];

  it('shows `<override> · <old main>` for a row that has tapped a role', () => {
    if (iris === undefined) throw new Error('no member');
    const { container } = draw(
      snapshot(lobbyView({ members: [{ ...iris, roleOverride: 'support' }, ...workedMembers(2)] })),
    );

    // Core's `resolveRoles`, rendered: the tap is the main and the usual main is the backup,
    // which is exactly what the balancer will do with it.
    expect(resolveRoles({ ...iris, roleOverride: 'support' })).toEqual({
      main: 'support',
      secondary: 'jungle',
    });
    expect(container.querySelector('.cn-rack-roles')?.textContent).toBe('support · jungle');
  });

  it('leaves a row alone when the tap names the role they already main', () => {
    if (iris === undefined) throw new Error('no member');
    const { container } = draw(
      snapshot(lobbyView({ members: [{ ...iris, roleOverride: iris.mainRole }, ...workedMembers(2)] })),
    );

    // Core treats an override equal to the main as a no-op, so the backup stays.
    expect(container.querySelector('.cn-rack-roles')?.textContent).toBe('jungle · top');
  });
});

describe('teams: balanced and in_game are the same block', () => {
  const balanced = snapshot(lobbyView({ status: 'balanced', teams: workedTeams() }));

  it('renders the promoted split verbatim, blue first, in lane order', () => {
    const { container } = draw(balanced);

    expect(strip(container)[1]).toBe('TEAMS ARE SET live');
    const cards = container.querySelectorAll('.cn-team');
    expect(cards).toHaveLength(2);

    const blue = cards[0] as HTMLElement;
    expect(within(blue).getByRole('heading', { level: 2 })).toHaveTextContent('BLUE');
    expect(within(blue).getByText('7695')).toBeInTheDocument();
    expect(
      within(blue)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['topHana1434', 'jungleIris1578', 'midKarim1551', 'adcBilal1713', 'supportTheo1419']);
  });

  it('prints the stored explanation as one paragraph, never recomposed', () => {
    const { container } = draw(balanced);

    expect(container.querySelector('.cn-explain-text')).toHaveTextContent(
      'Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
    );
  });

  it('changes only the headline word and the pill between balanced and in_game', () => {
    const { container: first } = draw(balanced);
    const balancedCards = first.querySelector('.cn-cards')?.innerHTML;

    const { container: second } = draw(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })));
    expect(strip(second)[1]).toBe('IN GAME live');
    expect(second.querySelector('.cn-cards')?.innerHTML).toBe(balancedCards);
  });

  it('draws a role icon beside every role word, and never in place of one', () => {
    const { container } = draw(balanced);

    const roles = [...container.querySelectorAll('.cn-seat-role')];
    expect(roles).toHaveLength(10);
    for (const role of roles) {
      expect(role.querySelector('svg')).not.toBeNull();
      expect(role.textContent?.length ?? 0).toBeGreaterThan(0);
      // The word beside it is the accessible name.
      expect(role.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('marks every off-role row, in words and not only in colour, and says so in the sentence', () => {
    // Ten friends who all main mid: `balance()` has to put nine of them somewhere else, and
    // the stored explanation says which (M3.7).
    const offRole = offRoleFixture();
    const marked = [...offRole.teams.blue, ...offRole.teams.red].filter((seat) => seat.offRole);
    expect(marked.length).toBeGreaterThan(0);

    const { container } = draw(
      snapshot(lobbyView({ status: 'balanced', members: offRole.members, teams: offRole.teams })),
    );

    expect(container.querySelectorAll('.cn-off')).toHaveLength(marked.length);
    // The per-seat hidden word, one per marked seat. Counted through the seats rather than
    // through `getAllByText`: Testing Library matches an element on its **direct** text nodes,
    // so the header legend — whose own text node is `off-role`, with the rest in a `cn-sr`
    // suffix — matches that query too (the designer, 2026-09-10). Both are asserted, neither
    // is a coincidence.
    const seatWords = [...container.querySelectorAll('.cn-seat .cn-sr')].filter(
      (node) => node.textContent?.trim() === 'off-role',
    );
    expect(seatWords).toHaveLength(marked.length);
    expect(screen.getAllByText('off-role')).toHaveLength(marked.length + 2);
    expect(container.querySelectorAll('.cn-off-legend')).toHaveLength(2);
    // The clause is the stored string's, rendered verbatim: `N off-role: Name at role, ...`.
    expect(container.querySelector('.cn-explain-text')?.textContent).toContain(`${marked.length} off-role:`);
  });

  /**
   * The side line (M4.7 (b)): **one line under both cards**, not one per card, and the sentence
   * the verification gate chooses. Both of the gate's states are tested in `SideLine.test.tsx`;
   * what is asserted here is where it sits and which states draw it at all.
   */
  describe('the side line under the cards', () => {
    it('is one line under both cards while the teams are set', () => {
      const { container } = draw(snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })));
      const lines = container.querySelectorAll('.cn-side-line');

      expect(lines).toHaveLength(1);
      expect(lines[0]?.textContent).toBe(sideLine(SWITCH_SIDE_ENABLED));
      // Under the cards and above the explanation: an instruction about the seats you have
      // just read, before the sentence about why they are those seats.
      const block = [...(container.querySelector('.cn-block')?.children ?? [])];
      expect(block.findIndex((node) => node.classList.contains('cn-side-line'))).toBe(
        block.findIndex((node) => node.classList.contains('cn-cards')) + 1,
      );
      expect(block.findIndex((node) => node.classList.contains('cn-explain'))).toBeGreaterThan(
        block.findIndex((node) => node.classList.contains('cn-side-line')),
      );
    });

    /**
     * **`balanced` only** (product, 2026-09-11). The game has launched, the lobby is gone, and
     * `Move to your side in the lobby.` names a room that does not exist — so the line goes with
     * the lobby, exactly as M4.10's `Missed the invite?` line does in the same block.
     */
    it('is gone the moment the game starts, with the same cards still up', () => {
      const { container } = draw(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })));

      expect(container.querySelector('.cn-side-line')).toBeNull();
      // Nothing else about the teams moved: the cards are the balanced ones, unchanged.
      expect(container.querySelectorAll('.cn-team')).toHaveLength(2);
      expect(container.querySelector('.cn-explain-text')).not.toBeNull();
    });

    it('is gone once the game is over, including on a finish the fold did not rate', () => {
      // The same block draws an unrated finish with the teams still up (M3.4), and telling
      // somebody to move to their side after `GAME OVER` is the one place it would be wrong.
      const unrated = snapshot(
        lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ rated: false }) }),
      );
      const { container: over } = draw(unrated);
      expect(over.querySelector('.cn-side-line')).toBeNull();

      const { container: result } = draw(
        snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
      );
      expect(result.querySelector('.cn-side-line')).toBeNull();
    });

    it('is absent before there are sides to move to', () => {
      const { container: idle } = draw(snapshot(null));
      expect(idle.querySelector('.cn-side-line')).toBeNull();

      const { container: filling } = draw(snapshot(lobbyView({ status: 'open' })));
      expect(filling.querySelector('.cn-side-line')).toBeNull();
    });

    /**
     * **And it goes when the sides are right** (M4.11, which is M4.3's acceptance check 7).
     *
     * The three cases are one fixture apart: the same balanced lobby, the same ten, the same
     * split — only where the client has each person sitting differs. That is deliberate, because
     * the third assertion below is that the cards cannot tell the difference.
     */
    describe('once the ten are where the split put them', () => {
      const balanced = (teams: ReturnType<typeof workedTeams>) =>
        snapshot(lobbyView({ status: 'balanced', teams }));

      function cardsMarkup(container: HTMLElement): string {
        const cards = container.querySelector('.cn-cards');
        expect(cards).not.toBeNull();
        return cards?.innerHTML ?? '';
      }

      it('draws nothing at all when all ten match', () => {
        const { container } = draw(balanced(seatedOnTheirSides(workedTeams())));

        // Absent, not hidden and not an empty paragraph holding a gap open: the explanation
        // strip closes up under the cards (`05-design.md`, "the height it leaves behind is not
        // reserved").
        expect(container.querySelector('.cn-side-line')).toBeNull();
        expect(container.textContent).not.toContain(sideLine(SWITCH_SIDE_ENABLED));
        // Everything else about the block is untouched: this removes a line, not a state.
        expect(container.querySelectorAll('.cn-cards .cn-team')).toHaveLength(2);
        expect(container.querySelector('.cn-explain-text')).not.toBeNull();
      });

      it('is back the moment one of the ten is on the wrong side', () => {
        const teams = workedTeams();
        const stray = teams.blue[0];
        expect(stray).toBeDefined();
        // One blue seat still sitting on red. Nine people being right is not the condition.
        const { container } = draw(balanced(seatedOnTheirSides(teams, { [stray?.puuid ?? '']: 200 })));

        const lines = container.querySelectorAll('.cn-side-line');
        expect(lines).toHaveLength(1);
        expect(lines[0]?.textContent).toBe(sideLine(SWITCH_SIDE_ENABLED));
      });

      /**
       * **The cards are byte-identical across the change** (M4.11's acceptance). Nothing in a
       * team card reads `liveSide`, so the only DOM that differs between a sorted lobby and a
       * lobby with one person out of place is the line itself — no name moves, no rating
       * re-renders, and React's reconciler has nothing to touch inside `.cn-cards` when the
       * `lobby_members` event lands.
       */
      it('changes the line and not one byte of the two cards', () => {
        const teams = workedTeams();
        const stray = teams.blue[0];
        const matched = draw(balanced(seatedOnTheirSides(teams)));
        const mismatched = draw(balanced(seatedOnTheirSides(teams, { [stray?.puuid ?? '']: 200 })));

        expect(cardsMarkup(mismatched.container)).toBe(cardsMarkup(matched.container));
        // …and the assertion above is not passing because both are empty.
        expect(cardsMarkup(matched.container)).toContain('cn-seat');
        // The one difference between the two documents is the side line.
        expect(matched.container.querySelector('.cn-side-line')).toBeNull();
        expect(mismatched.container.querySelector('.cn-side-line')).not.toBeNull();
      });

      /**
       * **A side we were never told is not a side that matches.** A spectator among the chosen
       * ten has `lobby_members.side` null and the queue cannot move them (`switchSide.ts`
       * clause (c)) — the line is exactly what tells that person to move, so it stays.
       */
      it('stays up for a seat the client has not placed', () => {
        const teams = workedTeams();
        const unplaced = teams.red[2];
        expect(unplaced).toBeDefined();
        const { container } = draw(balanced(seatedOnTheirSides(teams, { [unplaced?.puuid ?? '']: null })));

        expect(container.querySelector('.cn-side-line')).not.toBeNull();
      });

      /** The default fixture — a lobby nobody has moved in yet — still prints it. */
      it('is up on a split nobody has moved for', () => {
        const { container } = draw(balanced(workedTeams()));

        expect(container.querySelectorAll('.cn-side-line')).toHaveLength(1);
      });

      /** Matched sides do not resurrect the line in the states that never draw it. */
      it('does not come back in `in_game` because everybody matches', () => {
        const { container } = draw(
          snapshot(lobbyView({ status: 'in_game', teams: seatedOnTheirSides(workedTeams()) })),
        );

        expect(container.querySelector('.cn-side-line')).toBeNull();
      });
    });
  });
});

/**
 * The `· off-role` legend in a team card's header, and the amber threshold (the designer,
 * 2026-09-10; `05-design.md`, "Teams").
 *
 * Both rules are **per card**: a card with a marked seat carries the legend, a card without one
 * does not — including when the other card has some — and each card counts its own five before
 * deciding whether the mark keeps its colour.
 */
describe('the off-role legend and the amber threshold', () => {
  /** The fixture's split, with each side's marked seats forced to a chosen count. */
  function withMarked(blue: number, red: number) {
    const base = offRoleFixture();
    const mark = (seats: readonly SeatView[], count: number): SeatView[] =>
      seats.map((seat, index) => ({ ...seat, offRole: index < count }));
    return {
      ...base,
      teams: {
        ...base.teams,
        blue: mark(base.teams.blue, blue),
        red: mark(base.teams.red, red),
      },
    };
  }

  function cards(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('.cn-cards .cn-team')];
  }

  function drawTeams(blue: number, red: number) {
    const fixture = withMarked(blue, red);
    return draw(snapshot(lobbyView({ status: 'balanced', members: fixture.members, teams: fixture.teams })));
  }

  it('carries the legend on the card that has a marked seat, and not on the one that has none', () => {
    const { container } = drawTeams(2, 0);

    const [blue, red] = cards(container);
    expect(blue?.querySelectorAll('.cn-off-legend')).toHaveLength(1);
    expect(red?.querySelectorAll('.cn-off-legend')).toHaveLength(0);
  });

  it('reads `off-role seats in this card`, with the dot and the middot hidden', () => {
    const { container } = drawTeams(1, 0);

    const legend = container.querySelector('.cn-off-legend');
    expect(legend?.textContent).toBe(`${OFF_ROLE_LEGEND}${OFF_ROLE_LEGEND_SUFFIX}`);
    expect(legend?.querySelector('.cn-off-dot')).toHaveAttribute('aria-hidden', 'true');
    // The separator is punctuation in its own hidden span, never a CSS `::before`.
    expect(container.querySelector('.cn-head-sep')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.cn-head-sep')?.textContent).toBe(HEAD_SEPARATOR);
  });

  it('leaves the sum the header last child, legend or no legend', () => {
    const { container } = drawTeams(2, 0);

    for (const card of cards(container)) {
      const head = card.querySelector('.cn-team-head');
      expect(head?.children).toHaveLength(2);
      expect(head?.lastElementChild).toHaveClass('cn-sum');
      expect(head?.firstElementChild).toHaveClass('cn-team-heading');
    }
  });

  it('never puts the legend on a result card', () => {
    const { container } = draw(snapshot(lobbyView({ status: 'finished', result: workedResult() })));

    expect(container.querySelectorAll('.cn-off-legend')).toHaveLength(0);
  });

  /**
   * Three of five is the majority: below it the marked seats are the minority and colour is
   * the fastest way to find them; at or above it the colour is a wash. The class is a **colour
   * override, not a removal** — every marked seat keeps its `.cn-off`, its underline, its dot
   * and its hidden word on both cards.
   */
  it('drops the amber at three marked seats in a card, and only in that card', () => {
    const { container } = drawTeams(3, 1);

    const [blue, red] = cards(container);
    expect(blue).toHaveClass('cn-team-many-off');
    expect(red).not.toHaveClass('cn-team-many-off');
    expect(blue?.querySelectorAll('.cn-off')).toHaveLength(3);
    expect(red?.querySelectorAll('.cn-off')).toHaveLength(1);
    // Both cards still carry the legend: the key survives the threshold.
    expect(container.querySelectorAll('.cn-off-legend')).toHaveLength(2);
  });

  it('keeps the amber at two, and needs no threshold at none', () => {
    const { container: two } = drawTeams(2, 2);
    for (const card of cards(two)) expect(card).not.toHaveClass('cn-team-many-off');

    const { container: none } = drawTeams(0, 0);
    expect(none.querySelectorAll('.cn-off-legend')).toHaveLength(0);
    expect(none.querySelectorAll('.cn-off')).toHaveLength(0);
    for (const card of cards(none)) expect(card).not.toHaveClass('cn-team-many-off');
  });
});

describe('the sit-out strip', () => {
  const eleven = snapshot(
    lobbyView({
      status: 'balanced',
      members: [...workedMembers(), extraMember()],
      teams: workedTeams({ sitters: [extraMember()] }),
    }),
  );

  it('sits above the cards: what is under it is not about the person sitting', () => {
    const { container } = draw(eleven);
    const blocks = [...container.querySelectorAll('.cn-sitout, .cn-cards, .cn-explain')].map((element) =>
      element.className.includes('cn-sitout')
        ? 'cn-sitout'
        : element.className.includes('cn-cards')
          ? 'cn-cards'
          : 'cn-explain',
    );

    expect(blocks).toEqual(['cn-sitout', 'cn-cards', 'cn-explain']);
    // The card is its 3px brand rule and the sentence: no header bar saying the same words
    // again (the designer, 2026-09-09).
    expect(screen.queryByText('SITTING OUT')).not.toBeInTheDocument();
  });

  it('reads the general sentence for everybody who is not sitting', () => {
    draw(eleven);

    expect(
      screen.getByText(
        'Sitting out this game: Deniz. Each game goes to whoever has played least tonight, so they are first in line for the next one.',
      ),
    ).toBeInTheDocument();
  });

  it('reads the second-person one for the viewer who is sitting, and nobody else changes', () => {
    draw(eleven, { puuid: 'puuid-deniz' });

    expect(
      screen.getByText(
        'You are sitting this one out. Each game goes to whoever has played least tonight, so you are first in line for the next one.',
      ),
    ).toBeInTheDocument();
  });

  it('is absent when ten are around and nobody sits', () => {
    const { container } = draw(snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })));
    expect(container.querySelector('.cn-sitout')).toBeNull();
  });
});

describe('result: the game is over', () => {
  const finished = snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() }));

  it('leads with the winner, the duration, the prediction and the top damage, in one card', () => {
    const { container } = draw(finished);

    expect(strip(container)[1]).toBe('GAME OVER');
    expect(strip(container)[2]).toBe('Ratings are updated. The leaderboard has the rest.');

    const card = container.querySelector('.cn-result');
    expect(card).toHaveTextContent('RED WINS');
    expect(card).toHaveTextContent('34:12');
    expect(card).toHaveTextContent('Blue was favored 54%.');
    expect(card).toHaveTextContent('Top damage: Lena, 47.3k');
  });

  it('prints one rating per player: the after number and its delta, and no second pair of cards', () => {
    const { container } = draw(finished);

    expect(container.querySelectorAll('.cn-team')).toHaveLength(2);
    const blue = container.querySelectorAll('.cn-team')[0] as HTMLElement;
    expect(
      within(blue)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'topHana1393 (−41)',
      'jungleIris1531 (−47)',
      'midKarim1508 (−43)',
      'adcBilal1668 (−45)',
      'supportTheo1372 (−47)',
    ]);
  });

  it('rings the winner and drops the loser to a hairline, both structurally', () => {
    const { container } = draw(finished);

    const cards = [...container.querySelectorAll('.cn-team')];
    expect(cards[0]?.className).toContain('cn-team-lost');
    expect(cards[1]?.className).toContain('cn-team-won');
  });

  it('keeps the sign on a change too small to round: (−0), never (0) and never (+0)', () => {
    // A rating that fell by less than half a point. `displayDelta` answers -0, which does not
    // survive JSON — this is why the delta is computed where it is rendered (05-design.md).
    const result = workedResult();
    const seat = result.blue[0];
    if (seat === undefined) throw new Error('no seat');
    const nudged = { ...result, blue: [{ ...seat, muBefore: 25, muAfter: 24.999 }, ...result.blue.slice(1)] };

    const { container } = draw(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: nudged })),
    );

    const row = container.querySelector('.cn-team .cn-seat');
    expect(row?.textContent).toContain('1500 (−0)');
    // Never `(0)`: one unsigned entry in a column of ten signed ones reads as a bug.
    expect(container.textContent).not.toContain('(0)');
    expect(container.textContent).not.toContain('(+0)');
  });

  it('prints no side sums: a team total of deltas must not be computable from the screen', () => {
    const { container } = draw(finished);

    // The teams block has them; the result card does not (05-design.md, "Result card").
    expect(container.querySelectorAll('.cn-sum')).toHaveLength(0);
    expect(screen.queryByText('6465')).not.toBeInTheDocument();
  });

  it('keeps the explanation line of the split they played under the result', () => {
    const { container } = draw(finished);
    expect(container.querySelector('.cn-explain-text')).toHaveTextContent('Blue favored 54%.');
  });

  it('shows the teams, no deltas and an empty sentence slot for a game the fold did not rate', () => {
    const unrated = workedResult({ rated: false });
    const { container } = draw(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: unrated })),
    );

    expect(strip(container)[1]).toBe('GAME OVER');
    expect(strip(container)[2]).toBe('');
    expect(container.querySelector('.cn-delta')).toBeNull();
    expect(screen.queryByText(/did not count/i)).not.toBeInTheDocument();
    // The teams they played are still up, with their before ratings.
    expect(screen.getByText('1434')).toBeInTheDocument();
  });
});

describe('a player the database has no name for', () => {
  const nameless = workedMembers().map((member, index) => (index === 0 ? { ...member, name: null } : member));

  it('renders Someone, with one hint line under the block and never one per row', () => {
    draw(snapshot(lobbyView({ members: nameless })));

    expect(screen.getAllByText('Someone')).toHaveLength(1);
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
  });

  it('drops the hint as soon as every row has a name', () => {
    draw(snapshot(lobbyView({ members: workedMembers() })));
    expect(screen.queryByText(NAMELESS_HINT)).not.toBeInTheDocument();
  });
});

describe('the reroll control', () => {
  const balanced = (chosen: number) =>
    snapshot(lobbyView({ status: 'balanced', teams: workedTeams({ chosen }) }));

  it('is not drawn for a reader with no session', () => {
    draw(balanced(0));
    expect(screen.queryByRole('button', { name: 'Reroll' })).not.toBeInTheDocument();
  });

  it('is drawn for an admin and names the next split down the list', () => {
    const { container } = draw(balanced(0), { isAdmin: true });

    expect(screen.getByRole('button', { name: 'Reroll' })).toBeEnabled();
    expect(container.querySelector('form')).toHaveAttribute('action', '/api/admin/lobbies/lobby-1/reroll');
    expect(container.querySelector('input[name="splitId"]')).toHaveValue('split-2');
  });

  it('is disabled on the last split, with the sentence for the friend who presses again', () => {
    draw(balanced(2), { isAdmin: true });

    expect(screen.getByRole('button', { name: 'Reroll' })).toBeDisabled();
    expect(screen.getByText(NO_MORE_SPLITS)).toBeInTheDocument();
  });

  it('is not drawn once the game has started: the teams on the rift are the teams', () => {
    draw(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })), { isAdmin: true });
    expect(screen.queryByRole('button', { name: 'Reroll' })).not.toBeInTheDocument();
  });
});

/**
 * `Start a lobby` (M4.2's control, M4.7's placement). Where it is drawn, and for whom — the
 * control's own behaviour is `StartLobby.test.tsx`.
 */
/** Tonight's `create_lobby` as the page reads it: pending on Hamoodi's PC by default. */
function startRow(overrides: Partial<LobbyStartView> = {}): LobbyStartView {
  return {
    status: 'pending',
    error: null,
    hostName: 'Hamoodi',
    lobbyName: 'Customs 10 Sep #1',
    lobbyPassword: '4821',
    invited: 0,
    ...overrides,
  };
}

describe('the Start a lobby control', () => {
  const startButton = { name: START_LOBBY_BUTTON } as const;

  it('is on the idle page for an admin, above the rack and under the strip', () => {
    const { container } = draw(snapshot(null), { isAdmin: true });

    expect(screen.getByRole('button', startButton)).toBeInTheDocument();
    // **Above** the rack, not below it (the designer, 2026-09-10): ten empty seats are 480px,
    // so a button under them is under the fold on the phone this page is designed for.
    const column = [...(container.querySelector('.cn-col')?.children ?? [])].map((child) => child.className);
    expect(column.indexOf('cn-start')).toBeLessThan(column.indexOf('cn-block'));
    // And the block below it is untouched: rack, then the two explainer cards.
    const block = container.querySelector('.cn-block');
    expect([...(block?.children ?? [])].map((child) => child.className)).toEqual([
      'cn-card cn-rack',
      'cn-idle-cards',
    ]);
  });

  it('is a readout with no button while the lobby fills: there is a lobby already', () => {
    const { container } = draw(snapshot(lobbyView({ members: workedMembers(7) })), {
      isAdmin: true,
      lobbyStart: startRow({ status: 'acked', invited: 6 }),
    });

    // No button: the route could only answer `There is already a lobby open.`
    expect(screen.queryByRole('button', startButton)).not.toBeInTheDocument();
    // The block still carries what is worth saying, under the rack.
    expect(screen.getByText(invitedLine(6))).toBeInTheDocument();
    const block = container.querySelector('.cn-block');
    expect([...(block?.children ?? [])].map((child) => child.className)).toEqual([
      'cn-card cn-rack',
      'cn-start',
      'cn-missed',
    ]);
  });

  it('draws nothing at all while filling when nobody pressed it tonight', () => {
    const { container } = draw(snapshot(lobbyView({ members: workedMembers(7) })), { isAdmin: true });

    expect(container.querySelector('.cn-start')).not.toBeInTheDocument();
  });

  it('is gone once the teams are set: the only answer left would be a refusal', () => {
    const teams = workedTeams();
    draw(snapshot(lobbyView({ status: 'balanced', teams, members: workedMembers() })), {
      isAdmin: true,
    });

    expect(screen.queryByRole('button', startButton)).not.toBeInTheDocument();
    expect(document.querySelector('.cn-start')).not.toBeInTheDocument();
  });

  /**
   * M4.13's acceptance 7, both states and all four viewers, in one place. Who may press is the
   * whole of what that task changed on this page, and it is four rows of a table.
   */
  const VIEWERS: Record<string, ViewerState> = {
    anonymous: { kind: 'anonymous' },
    unlinked: { kind: 'unlinked', claimable: [] },
    linked: { kind: 'linked', puuid: 'puuid-not-in-this-lobby', isAdmin: false },
    admin: { kind: 'linked', puuid: 'puuid-not-in-this-lobby', isAdmin: true },
  };

  function drawAs(viewer: ViewerState, state: TonightSnapshot, lobbyStart: LobbyStartView | null = null) {
    return render(<TonightView snapshot={state} viewer={viewer} topPlayers={[]} lobbyStart={lobbyStart} />);
  }

  it('is drawn on the idle page for every linked player, admin or not', () => {
    for (const kind of ['linked', 'admin'] as const) {
      const { unmount } = drawAs(VIEWERS[kind] as ViewerState, snapshot(null));
      expect(screen.getByRole('button', startButton)).toBeInTheDocument();
      // And never the anonymous sentence beside it: they are signed in.
      expect(document.body.textContent).not.toContain(START_LOBBY_SIGN_IN);
      unmount();
    }
  });

  it('gives a signed-out visitor the sentence and a sign-in button, in idle only', () => {
    // Back from the 2026-09-10 suspension (M4.13): on an idle page `RoleTonight` draws nothing
    // at all for this reader, so without it there is no door into the site on the screen.
    const { unmount } = drawAs(VIEWERS.anonymous as ViewerState, snapshot(null));
    expect(screen.getByText(START_LOBBY_SIGN_IN)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SIGN_IN_LABEL })).toBeInTheDocument();
    // **Never a disabled `Start a lobby`** (M3.20, and the designer's amber-control rules).
    expect(screen.queryByRole('button', startButton)).not.toBeInTheDocument();
    unmount();

    // `filling` is a readout, not a control: there is nothing to sign in for.
    drawAs(VIEWERS.anonymous as ViewerState, snapshot(lobbyView({ members: workedMembers(7) })));
    expect(document.querySelector('.cn-start')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(START_LOBBY_SIGN_IN);
  });

  it('says nothing at all to a signed-in visitor with no player row, in either state', () => {
    // They are signed in, so inviting them to sign in is noise; `SIGNED_IN_NO_LOBBY` at the
    // foot of the column is the true sentence for them and it is already there (M3.6).
    const { unmount } = drawAs(VIEWERS.unlinked as ViewerState, snapshot(null));
    expect(screen.queryByRole('button', startButton)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(START_LOBBY_SIGN_IN);
    unmount();

    drawAs(
      VIEWERS.unlinked as ViewerState,
      snapshot(lobbyView({ members: workedMembers(7) })),
      startRow({ status: 'acked', invited: 6 }),
    );
    expect(document.querySelector('.cn-start')).not.toBeInTheDocument();
  });

  it('gives both linked viewers the readout while the lobby fills, and nobody else', () => {
    for (const kind of ['linked', 'admin'] as const) {
      const { unmount } = drawAs(
        VIEWERS[kind] as ViewerState,
        snapshot(lobbyView({ members: workedMembers(7) })),
        startRow({ status: 'acked', invited: 6 }),
      );
      expect(screen.getByText(invitedLine(6))).toBeInTheDocument();
      expect(screen.queryByRole('button', startButton)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('prints what became of tonight’s press, for the admin who did not make it', () => {
    draw(snapshot(null), { isAdmin: true, lobbyStart: startRow() });

    expect(screen.getByText(openingOnPcLine('Hamoodi'))).toBeInTheDocument();
    // And the button goes quiet while the command is live — `aria-disabled`, never the
    // attribute, so the focus stays where the keyboard left it (the designer, M3.20).
    const button = screen.getByRole('button', { name: START_LOBBY_BUTTON });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveClass('cn-button-quiet');
    expect(button).not.toBeDisabled();
  });
});

/**
 * `Missed the invite? The lobby is Customs 08 Sep #1, password 4821.` (M4.10).
 *
 * Five cases, and the fifth is the one that matters: the password is for the people who play,
 * not for whoever the WhatsApp link was forwarded to (product and the designer, 2026-09-10).
 */
describe('the lobby a latecomer can still join', () => {
  const me = workedMembers(1)[0]?.puuid ?? '';
  const filling = () => snapshot(lobbyView({ members: workedMembers(7) }));

  it('names the lobby and the password while it fills, for a linked viewer', () => {
    const { container } = draw(filling(), { puuid: me });

    const line = container.querySelector('.cn-missed');
    expect(line?.textContent).toBe(missedInviteSentence('Customs 08 Sep #1', '4821'));
    // The two values a person has to type are mono; the sentence around them is not.
    expect([...(line?.querySelectorAll('.cn-num') ?? [])].map((node) => node.textContent)).toEqual([
      'Customs 08 Sep #1',
      '4821',
    ]);
    // One tap selects all four digits on a phone.
    expect(line?.querySelector('.cn-missed-password')?.textContent).toBe('4821');
  });

  it('drops to the name alone when no companion has told us a password', () => {
    const { container } = draw(snapshot(lobbyView({ members: workedMembers(7), lobbyPassword: null })), {
      puuid: me,
    });

    expect(container.querySelector('.cn-missed')?.textContent).toBe(
      missedInviteSentence('Customs 08 Sep #1', null),
    );
    expect(container.querySelector('.cn-missed')?.textContent).not.toContain('password');
  });

  it('is absent, not empty, when we do not know the lobby’s name', () => {
    const { container } = draw(
      snapshot(lobbyView({ members: workedMembers(7), lobbyName: null, lobbyPassword: '4821' })),
      { puuid: me },
    );

    expect(container.querySelector('.cn-missed')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('4821');
  });

  it('is the last line of the primary block while the teams are up, and gone in game', () => {
    const teams = workedTeams();
    const balanced = lobbyView({ status: 'balanced', teams, members: workedMembers() });
    const { container, unmount } = draw(snapshot(balanced), { puuid: me });

    // Under the explanation strip, last in the block, above `Your role tonight`.
    const block = container.querySelector('.cn-block');
    expect(block?.lastElementChild?.className).toBe('cn-missed');
    unmount();

    // The game has started: there is nothing left to join.
    draw(snapshot(lobbyView({ status: 'in_game', teams, members: workedMembers() })), { puuid: me });
    expect(document.querySelector('.cn-missed')).not.toBeInTheDocument();
  });

  it('is drawn for nobody who is not signed in and matched to a player row', () => {
    const { unmount } = draw(filling());
    expect(document.querySelector('.cn-missed')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('4821');
    unmount();

    // Signed in with Discord, matching no player row: still not one of the twenty.
    render(
      <TonightView
        snapshot={filling()}
        viewer={{ kind: 'unlinked', claimable: [] }}
        topPlayers={[]}
        lobbyStart={null}
      />,
    );
    expect(document.querySelector('.cn-missed')).not.toBeInTheDocument();
  });
});

describe('fearless, the ban list', () => {
  it('is absent while the pool is empty', () => {
    draw(snapshot(null));
    expect(document.body.textContent).not.toContain(FEARLESS_TITLE);
    expect(document.body.textContent).not.toContain(FEARLESS_SENTENCE);
  });

  it('lists the champions and says to ban them next game', () => {
    draw(
      snapshot(null, {
        fearless: {
          resetAt: FIXTURE_NIGHT_START,
          champions: [
            { id: 103, name: 'Ahri', role: 'mid' },
            { id: 222, name: 'Jinx', role: 'adc' },
          ],
        },
      }),
    );
    const card = document.querySelector('.cn-fearless');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain(FEARLESS_TITLE);
    expect(card?.textContent).toContain(FEARLESS_SENTENCE);
    expect(card?.textContent).toContain('Ahri');
    expect(card?.textContent).toContain('Jinx');
    expect(card?.textContent).toContain('mid');
    expect(card?.textContent).toContain('adc');
    expect(card?.textContent).toContain('2 champions.');
  });

  it('finds a name instantly and says when it is on the list', () => {
    draw(
      snapshot(null, {
        fearless: {
          resetAt: FIXTURE_NIGHT_START,
          champions: [
            { id: 103, name: 'Ahri', role: 'mid' },
            { id: 222, name: 'Jinx', role: 'adc' },
          ],
        },
      }),
    );
    const box = screen.getByRole('searchbox', { name: FEARLESS_SEARCH });
    fireEvent.change(box, { target: { value: 'jinx' } });
    const card = document.querySelector('.cn-fearless');
    expect(card?.textContent).toContain(fearlessBanned('Jinx'));
    expect(card?.textContent).toContain('Jinx');
    expect(card?.textContent).not.toContain('Ahri');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(card?.textContent).toContain(FEARLESS_SEARCH_EMPTY);
  });

  it('lists who is still open at the end of each lane, and says so when the name is exact', () => {
    draw(
      snapshot(null, {
        fearless: {
          resetAt: FIXTURE_NIGHT_START,
          champions: [
            { id: 103, name: 'Ahri', role: 'mid' },
            { id: 222, name: 'Jinx', role: 'adc' },
          ],
        },
      }),
    );
    const card = document.querySelector('.cn-fearless');
    const open = [...document.querySelectorAll('.cn-fearless-open-chip')].map((chip) => chip.textContent);
    expect(card?.textContent).toContain(FEARLESS_OPEN);
    expect(open).toContain('Garen');
    expect(open).toContain('Annie');
    expect(open).not.toContain('Ahri');
    expect(open).not.toContain('Jinx');

    const mid = [...(card?.querySelectorAll('.cn-fearless-lane') ?? [])].find((lane) =>
      lane.querySelector('h3')?.textContent?.includes('mid'),
    );
    const midOpen = [...(mid?.querySelectorAll('.cn-fearless-open-chip') ?? [])].map(
      (chip) => chip.textContent,
    );
    expect(mid?.textContent).toContain('Ahri');
    expect(midOpen).toContain('Annie');
    expect(midOpen).not.toContain('Garen');

    const box = screen.getByRole('searchbox', { name: FEARLESS_SEARCH });
    fireEvent.change(box, { target: { value: 'garen' } });
    expect(card?.textContent).toContain(fearlessAvailable('Garen'));
    expect(card?.textContent).not.toContain('Ahri');
    expect(card?.textContent).not.toContain(fearlessBanned('Garen'));
  });
});
