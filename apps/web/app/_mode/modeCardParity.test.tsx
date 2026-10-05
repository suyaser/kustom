import type { ModeRow } from '@customs/core';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { applyModeRow, resetModeStoreForTests } from '@/lib/mode/clientStore';
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
 * **different, older** row (M20.8: gated on `updated_at`), then feeds the target row in as the
 * `group_modes` row the page's channel would receive (a control's route answer goes through the
 * same `applyModeRow`): the card must end up with the identical text. The pool, the lobby's lock
 * and the night are the same in both, as they are when only the mode moves.
 *
 * Not here: `Normal mode now.` (M20.8: only a switch the page heard shows it, so a render and a
 * heard row differ by design; `rules.test.tsx` covers it). The older row never moves Fearless to
 * Normal, so it never triggers the note.
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');
const KEYS: readonly TonightStateKey[] = ['idle', 'filling', 'balanced', 'in-game', 'finished'];
const CLASSES = ['Tank', 'Marksman', 'Mage', 'Assassin', 'Support'] as const;

const CASES: readonly [string, TonightFixtureOptions][] = [
  ['Normal', { mode: 'normal' }],
  ['Normal, not rated', { mode: 'normal', rated: false }],
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

const OLDER = '2026-09-08T20:20:00.000Z';
/** The target row's `updated_at`: the fixture's when it has one (a choice after Roll), else before the lock. */
const newer = (target: TonightStateFixture) => target.snapshot.modeSince ?? '2026-09-08T20:25:00.000Z';

const targetRow = (target: TonightStateFixture) => target.snapshot.modeRow as ModeRow;

/**
 * The same night with an older, different row: what the page showed before the change. A Fearless
 * target is preceded by Normal; a Normal one by another Normal row (a rule more or less), so no
 * Fearless-to-Normal switch is ever heard.
 */
function olderNight(target: TonightStateFixture): TonightStateFixture {
  const row = targetRow(target);
  const older: ModeRow =
    row.standing === 'fearless'
      ? { standing: 'normal', pending: null, rated: null }
      : { standing: 'normal', pending: row.pending === null ? { id: 'mirror' } : null, rated: null };
  return {
    ...target,
    snapshot: { ...target.snapshot, mode: older.standing, modeRow: older, modeSince: OLDER },
  };
}

afterEach(() => {
  resetModeStoreForTests();
});

const cardText = () => {
  const card = screen.getByRole('region', { name: /^Mode / });
  return card.textContent ?? '';
};

async function admin(): Promise<{ text: string; select: string; rated: string | null }> {
  const toggle = await screen.findByRole('switch', { name: 'Rated' });
  const select = screen.getByRole('combobox', { name: /^(Mode|Next game)$/ }) as HTMLSelectElement;
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
          applyModeRow(ORIGINAL_GROUP.id, { row: targetRow(target), updatedAt: newer(target) });
        });
        expect({ card: cardText(), mirror: mirrorLine() }).toEqual(expected);
      });

      it(`${name}, ${key}: an admin's card and controls are identical`, async () => {
        const target = tonightStateFixture(key, { now: NOW, ...options });
        const { connection: _c, ...server } = target;
        const first = render(<TonightView {...server} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />);
        const expected = await admin();
        first.unmount();

        const { connection: _b, ...old } = olderNight(target);
        render(<TonightView {...old} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />);
        expect((await admin()).select).not.toBe(expected.select);
        act(() => {
          applyModeRow(ORIGINAL_GROUP.id, { row: targetRow(target), updatedAt: newer(target) });
        });
        expect(await admin()).toEqual(expected);
      });
    }
  }
});
