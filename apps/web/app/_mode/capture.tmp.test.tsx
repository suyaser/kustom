import { writeFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { it } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { resetModeStoreForTests } from '@/lib/mode/clientStore';
import {
  ADMIN_VIEWER,
  MEMBER_VIEWER,
  type TonightFixtureOptions,
  type TonightStateKey,
  tonightStateFixture,
} from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';

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

it('captures', async () => {
  const out: Record<string, unknown> = {};
  for (const [name, options] of CASES) {
    for (const key of KEYS) {
      for (const who of ['member', 'admin'] as const) {
        resetModeStoreForTests();
        const target = tonightStateFixture(key, { now: NOW, ...options });
        const { connection: _c, ...server } = target;
        const r = render(
          <TonightView
            {...server}
            viewer={who === 'admin' ? ADMIN_VIEWER : MEMBER_VIEWER}
            group={ORIGINAL_GROUP}
          />,
        );
        const card = screen.getByRole('region', { name: /^Mode / });
        const entry: Record<string, unknown> = { text: card.textContent ?? '' };
        if (who === 'admin') {
          const toggle = await screen.findByRole('switch', { name: 'Rated' });
          entry.select = (screen.getByRole('combobox', { name: 'Mode' }) as HTMLSelectElement).value;
          entry.rated = toggle.getAttribute('aria-checked');
        }
        entry.mirror = document.querySelector('[data-slot="mirror-host-line"]')?.textContent ?? null;
        out[`${name} | ${key} | ${who}`] = entry;
        r.unmount();
      }
    }
  }
  writeFileSync(process.env.CAPTURE_OUT as string, `${JSON.stringify(out, null, 2)}\n`);
}, 300_000);
