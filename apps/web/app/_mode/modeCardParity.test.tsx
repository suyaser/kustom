import type { ModeState } from '@customs/core';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { applyModeAnswer, applyModeRow, resetModeStoreForTests } from '@/lib/mode/clientStore';
import {
  ADMIN_VIEWER,
  MEMBER_VIEWER,
  type TonightFixtureOptions,
  type TonightStateFixture,
  type TonightStateKey,
  tonightStateFixture,
} from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';

/**
 * M19.13 acceptance (1): the Mode card rendered from the server's props and rendered from the
 * client mode store say the same thing, for every mode and rule, in every Tonight state, for a
 * member and for an admin (the controls' select, switch and `Next game: …` line included).
 *
 * The server path renders the fixture as it is. The store path renders the same night with a
 * **different, older** card state (another standing mode, nothing pending, one version lower),
 * then feeds the target state in as the `group_modes` row the page's channel would receive (and,
 * for admins, again as a route answer): the card must end up with the identical text. The pool,
 * the lobby's lock and the night are the same in both, as they are when only the mode moves.
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');
const KEYS: readonly TonightStateKey[] = ['idle', 'filling', 'balanced', 'in-game', 'finished'];
const CLASSES = ['Tank', 'Marksman', 'Mage', 'Assassin', 'Support'] as const;

const CASES: readonly [string, TonightFixtureOptions][] = [
  ['Normal', { mode: 'normal' }],
  ['Normal, not rated', { mode: 'normal', rated: false }],
  ['Normal, just switched (members see the note)', { mode: 'normal', normalJustNow: true }],
  ['Fearless with bans', { mode: 'fearless' }],
  ['Fearless, nothing banned', { mode: 'fearless', pool: 'empty' }],
  ['Fearless, not rated', { mode: 'fearless', rated: false }],
  ...CLASSES.flatMap((tag): [string, TonightFixtureOptions][] => [
    [`class wars ${tag}, Fearless night`, { rule: `class:${tag}` }],
    [`class wars ${tag}, Normal night`, { rule: `class:${tag}`, mode: 'normal' }],
  ]),
  ['class wars, rated on', { rule: 'class:Tank', rated: true }],
  ['region wars', { rule: 'region' }],
  ['region wars, Normal night', { rule: 'region', mode: 'normal' }],
  ['region wars that could not be drawn', { rule: 'region', noDraw: true }],
  ['mirror match, Fearless night', { rule: 'mirror' }],
  ['mirror match, Normal night', { rule: 'mirror', mode: 'normal' }],
  ['mirror match, not rated', { rule: 'mirror', rated: false }],
  ['after Roll, a rule queued since', { rule: 'class:Tank', queued: 'class:Mage' }],
  ['after Roll, Fearless queued over a Normal game', { mode: 'normal', queued: 'region' }],
];

/** The same night with an older, different card state: what the page showed before the change. */
function olderNight(target: TonightStateFixture): TonightStateFixture {
  const state = target.snapshot.modeState as ModeState;
  const standing = state.standing === 'normal' ? 'fearless' : 'normal';
  const older: ModeState = { standing, pending: null, ratedOverride: null, version: state.version - 1 };
  return {
    ...target,
    snapshot: { ...target.snapshot, mode: standing, modeState: older, modeSince: null },
  };
}

const cardText = () => {
  const card = screen.getByRole('region', { name: /^Mode / });
  return card.textContent ?? '';
};

async function admin(): Promise<{ text: string; select: string; rated: string | null }> {
  const toggle = await screen.findByRole('switch', { name: 'Rated' });
  const select = screen.getByRole('combobox', { name: 'Mode' }) as HTMLSelectElement;
  return { text: cardText(), select: select.value, rated: toggle.getAttribute('aria-checked') };
}

function mirrorLine(): string | null {
  return document.querySelector('[data-slot="mirror-host-line"]')?.textContent ?? null;
}

describe('the Mode card from server props and from the client mode store (M19.13)', () => {
  for (const [name, options] of CASES) {
    for (const key of KEYS) {
      it(`${name}, ${key}: a member sees identical text`, () => {
        const target = tonightStateFixture(key, { now: NOW, ...options });
        const { connection: _c, ...server } = target;
        const first = render(<TonightView {...server} viewer={MEMBER_VIEWER} group={ORIGINAL_GROUP} />);
        const expected = { card: cardText(), mirror: mirrorLine() };
        first.unmount();

        const { connection: _b, ...old } = olderNight(target);
        render(<TonightView {...old} viewer={MEMBER_VIEWER} group={ORIGINAL_GROUP} />);
        // Before Roll the card is the next game, so the older state reads differently: the row
        // has something to move (after Roll the card is the lobby's lock either way).
        if (key === 'idle' || key === 'filling' || key === 'finished') {
          expect(cardText()).not.toBe(expected.card);
        }
        act(() => {
          applyModeRow(ORIGINAL_GROUP.id, {
            state: target.snapshot.modeState as ModeState,
            updatedAt: target.snapshot.modeSince,
          });
        });
        expect({ card: cardText(), mirror: mirrorLine() }).toEqual(expected);
      });

      it(`${name}, ${key}: an admin's card and controls are identical (row, then route answer)`, async () => {
        const target = tonightStateFixture(key, { now: NOW, ...options });
        const { connection: _c, ...server } = target;
        const first = render(<TonightView {...server} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />);
        const expected = await admin();
        first.unmount();

        const state = target.snapshot.modeState as ModeState;
        const { connection: _b, ...old } = olderNight(target);
        const second = render(<TonightView {...old} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />);
        expect((await admin()).select).not.toBe(expected.select);
        act(() => {
          applyModeRow(ORIGINAL_GROUP.id, { state, updatedAt: target.snapshot.modeSince });
        });
        expect(await admin()).toEqual(expected);
        second.unmount();

        // The same state arriving as the admin's own route answer instead of a row.
        resetModeStoreForTests();
        const third = render(<TonightView {...old} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />);
        await admin();
        act(() => {
          applyModeAnswer(ORIGINAL_GROUP.id, {
            standing: state.standing,
            rule:
              state.pending === null
                ? null
                : state.pending.id === 'class'
                  ? `class:${state.pending.tag}`
                  : state.pending.id,
            ratedOverride: state.ratedOverride,
            version: state.version,
          });
        });
        expect(await admin()).toEqual(expected);
        third.unmount();
      });
    }
  }
});
