import { nextRated } from '@customs/core';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { selectValue } from '@/lib/mode/cardView';
import { resetModeStoreForTests } from '@/lib/mode/clientStore';
import {
  ADMIN_VIEWER,
  MEMBER_VIEWER,
  type TonightFixtureOptions,
  type TonightStateKey,
  tonightStateFixture,
} from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';
import before from './modeCardText.pre-m20-8.json';

/**
 * M20.8 acceptance (1): the Mode card's text on the one-row model against the text the version
 * model printed (`modeCardText.pre-m20-8.json`, captured from the same fixtures before the rewrite),
 * for every 05-design 8.3 state, every mode and rule, a member and an admin. Identical except the
 * changes listed in {@link CHANGES}, each applied to the old text before the comparison:
 *
 * 1. The region option's label: `Region wars, sides drawn at roll` -> `Region wars` (M20 D10: no
 *    choice is made at Roll).
 * 2. Region wars before Roll: `Sides drawn when teams are rolled.` -> its pair, the same look as
 *    after Roll (M20 D9; the fixture's pair is Ionia vs Noxus).
 * 3. Region wars with no pair at Roll: this game is the standing mode rated as the moved switch
 *    says, by default rated (M20 D6 (d)); it used to stay not rated.
 * 4. The members' `Normal mode now.` note: only from a switch the page heard (normalNote's `since`
 *    is the admin write, M20.8), never from a render, so a page opened after the switch has none.
 * 5. After Roll an admin's controls are the next game, the row as set (M20 D6: Roll moved the rule
 *    onto the lock), so the select and the switch read the row and `Set mode` is no longer offered
 *    for this game's rule (queuing it again is a plain change). The picker is headed `Next game`,
 *    not `Mode` (lead's call), under the kept `Changes apply from the next game.`. The card above
 *    them is unchanged.
 * 7. M20.10 design round 1: before Roll the card's one-game line is the next game's form,
 *    `For the next game only. Then back to Fearless.` (it read `This game only.` with no game yet).
 * 6. M20.10: an admin's foot gains region wars' pair controls (`Redraw regions`, `Blue's region`,
 *    `Red's region`) wherever a pair can still change; they are cut out before the comparison and
 *    checked on their own: present exactly when the row's pending rule is region wars or the
 *    balanced lobby's lock is.
 *
 * One entry of the capture was fixed by hand: `Normal | empty | admin` was read before the lazy
 * admin controls had loaded (the first admin render of the run), so it lacked them; it now holds
 * the same text as `Normal | empty-admin | admin` and `Normal, rated | empty | admin`, which were
 * captured identical.
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');
const KEYS: readonly TonightStateKey[] = [
  'empty',
  'empty-admin',
  'idle',
  'filling',
  'over-ten',
  'balanced',
  'in-game',
  'finished',
];
const CLASSES = ['Tank', 'Marksman', 'Mage', 'Assassin', 'Support'] as const;
const CASES: readonly [string, TonightFixtureOptions][] = [
  ['Normal', { mode: 'normal' }],
  ['Normal, not rated', { mode: 'normal', rated: false }],
  ['Normal, rated', { mode: 'normal', rated: true }],
  ['Normal, just switched', { mode: 'normal', normalJustNow: true }],
  ['Fearless with bans', { mode: 'fearless' }],
  ['Fearless, nothing banned', { mode: 'fearless', pool: 'empty' }],
  ['Fearless, not rated', { mode: 'fearless', rated: false }],
  ['Fearless, nothing banned, not rated', { mode: 'fearless', pool: 'empty', rated: false }],
  ...CLASSES.flatMap((tag): [string, TonightFixtureOptions][] => [
    [`class wars ${tag}, Fearless night`, { rule: `class:${tag}` }],
    [`class wars ${tag}, Normal night`, { rule: `class:${tag}`, mode: 'normal' }],
  ]),
  ['class wars, rated on', { rule: 'class:Tank', rated: true }],
  ['class wars, rated on, Normal night', { rule: 'class:Tank', rated: true, mode: 'normal' }],
  ['region wars', { rule: 'region' }],
  ['region wars, Normal night', { rule: 'region', mode: 'normal' }],
  ['region wars, rated on', { rule: 'region', rated: true }],
  ['region wars that could not be drawn', { rule: 'region', noDraw: true }],
  ['mirror match, Fearless night', { rule: 'mirror' }],
  ['mirror match, Normal night', { rule: 'mirror', mode: 'normal' }],
  ['mirror match, not rated', { rule: 'mirror', rated: false }],
  ['mirror match, nothing banned', { rule: 'mirror', pool: 'empty' }],
  ['after Roll, a rule queued since', { rule: 'class:Tank', queued: 'class:Mage' }],
  ['after Roll, region queued over a Normal game', { mode: 'normal', queued: 'region' }],
];

interface Entry {
  text: string;
  select?: string;
  rated?: string | null;
  mirror: string | null;
}

const ADMIN_FOOT = 'Admins and the owner';
const AFTER_ROLL: ReadonlySet<TonightStateKey> = new Set(['balanced', 'in-game']);

/** The listed changes, applied to the old text. */
function CHANGES(name: string, key: TonightStateKey, old: Entry): Entry {
  let text = old.text
    // 1.
    .replace('Region wars, sides drawn at roll', 'Region wars')
    // 2.
    .replace('Sides drawn when teams are rolled.', 'BLUEIoniavsREDNoxus')
    // 4.
    .replace('Normal mode now. An admin switched off Fearless, so every champion is open.', '');
  if (!AFTER_ROLL.has(key)) {
    // 7.
    text = text.replace(
      /This game only\. Then back to (Fearless|Normal)\./,
      'For the next game only. Then back to $1.',
    );
  }
  if (name === 'region wars that could not be drawn' && AFTER_ROLL.has(key)) {
    // 3.
    text = text
      .replace('FearlessNot rated', 'FearlessRated')
      .replace(
        "This game isn't rated, so it bans nothing.",
        "This game's ten join the ban list when it ends.",
      );
  }
  return { ...old, text };
}

function renderEntry(options: TonightFixtureOptions, key: TonightStateKey, admin: boolean) {
  const target = tonightStateFixture(key, { now: NOW, ...options });
  const { connection: _c, ...server } = target;
  return {
    target,
    view: render(
      <TonightView {...server} viewer={admin ? ADMIN_VIEWER : MEMBER_VIEWER} group={ORIGINAL_GROUP} />,
    ),
  };
}

afterEach(() => {
  resetModeStoreForTests();
});

const expected = before as Record<string, Entry>;

describe('the Mode card text before and after the one-row rewrite (M20.8)', () => {
  for (const [name, options] of CASES) {
    for (const key of KEYS) {
      it(`${name} | ${key} | member`, () => {
        const { view } = renderEntry(options, key, false);
        const card = screen.getByRole('region', { name: /^Mode / });
        const mirror = document.querySelector('[data-slot="mirror-host-line"]')?.textContent ?? null;
        const old = CHANGES(name, key, expected[`${name} | ${key} | member`] as Entry);
        expect({ text: card.textContent ?? '', mirror }).toEqual({ text: old.text, mirror: old.mirror });
        view.unmount();
      });

      it(`${name} | ${key} | admin`, async () => {
        const { target, view } = renderEntry(options, key, true);
        const toggle = await screen.findByRole('switch', { name: 'Rated' });
        const card = screen.getByRole('region', { name: /^Mode / });
        // 6.
        const trimmed = card.cloneNode(true) as HTMLElement;
        const pairs = trimmed.querySelectorAll('[data-slot^="region-controls-"]');
        for (const one of pairs) one.remove();
        const text = trimmed.textContent ?? '';
        const lock = target.snapshot.lobby?.lock ?? null;
        const pairOpen =
          target.snapshot.modeRow?.pending?.id === 'region' ||
          (target.snapshot.lobby?.status === 'balanced' && lock?.mode.id === 'region');
        expect(pairs.length > 0).toBe(pairOpen);
        const select = (screen.getByRole('combobox', { name: /^(Mode|Next game)$/ }) as HTMLSelectElement)
          .value;
        const rated = toggle.getAttribute('aria-checked');
        const mirror = document.querySelector('[data-slot="mirror-host-line"]')?.textContent ?? null;
        const old = CHANGES(name, key, expected[`${name} | ${key} | admin`] as Entry);
        const row = target.snapshot.modeRow;
        if (AFTER_ROLL.has(key) && row !== undefined) {
          // 5. The card is unchanged; the controls are the row.
          const cut = (t: string) => t.slice(0, t.indexOf(ADMIN_FOOT));
          expect({ card: cut(text), mirror }).toEqual({ card: cut(old.text), mirror: old.mirror });
          expect(select).toBe(selectValue(row));
          // The picker says whose game it is (lead's call on OPEN 1): `Next game`, never `Mode`.
          expect(screen.getByRole('combobox', { name: 'Next game' })).toBeInTheDocument();
          expect(screen.queryByRole('combobox', { name: 'Mode' })).toBeNull();
          // 05-design 8.3.1 (M20.10): the caption always heads the next-game group after Roll and
          // the foot's bold `Next game: …` line is gone (the picker says it).
          expect(text.includes('Changes apply from the next game.')).toBe(true);
          expect(rated).toBe(String(nextRated(row)));
        } else {
          expect({ text, select, rated, mirror }).toEqual({
            text: old.text,
            select: old.select,
            rated: old.rated,
            mirror: old.mirror,
          });
        }
        view.unmount();
      });
    }
  }
});
