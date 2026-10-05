import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { MODE_APPLIES_NEXT_GAME, MODE_READ_FAILED } from '@/lib/mode/copy';
import { RATED_OFF } from '@/lib/mode/ruleCopy';
import { ADMIN_VIEWER, type TonightFixtureOptions, tonightStateFixture } from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';

/**
 * The owner's Mode card bugs (2026-10-04) and the audit's state defects, through the real page:
 *
 * - **Owner bug 1, "the mode resets to Normal after Roll".** The controls were fed the state the
 *   record *would* leave (`upcomingState`), a prediction. M20.8: Roll moves the rule onto the
 *   lobby, so after Roll the card is this game (the lock) and the controls are the next game (the
 *   row, as set), under `Changes apply from the next game.`; nothing is predicted.
 * - **Owner bug 3, "picking it again doesn't stick".** After Roll the row is empty, so picking this
 *   game's rule again is a plain change and queues it for the next game.
 * - **Audit defect 2.** Tonight draws the card in a different place per phase, so a Roll mounted the
 *   controls afresh and lost an unsaved pick, a write in flight and the outcome line.
 * - **A failed mode read rendered as Normal.**
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');

function page(key: 'filling' | 'balanced' | 'in-game' | 'idle', options: TonightFixtureOptions = {}) {
  const { connection: _c, ...fixture } = tonightStateFixture(key, { now: NOW, ...options });
  return <TonightView {...fixture} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />;
}

const select = () => screen.getByRole('combobox', { name: /^(Mode|Next game)$/ }) as HTMLSelectElement;
const toggle = () => screen.getByRole('switch', { name: 'Rated' });
const card = () => screen.getByRole('region', { name: /^Mode / });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('owner bug 1: after Roll the controls show what is set for the next game, never a prediction', () => {
  for (const key of ['balanced', 'in-game'] as const) {
    it(`${key}: the card is this game; the select and the switch are the row, under the next-game line`, async () => {
      render(page(key, { rule: 'class:Tank', mode: 'normal' }));
      await screen.findByRole('switch', { name: 'Rated' });
      expect(within(card()).getByRole('heading', { level: 2 })).toHaveTextContent('Class wars');
      expect(within(card()).getByText('Not rated')).toBeInTheDocument();
      expect(within(card()).getByText(MODE_APPLIES_NEXT_GAME)).toBeInTheDocument();
      // Headed `Next game` after Roll (lead's call), so the select never reads as this game's.
      expect(screen.getByRole('combobox', { name: 'Next game' })).toBe(select());
      expect(select().value).toBe('normal');
      expect(toggle()).toHaveAttribute('aria-checked', 'true');
    });
  }

  it('before Roll the select is the pending rule and the switch its Rated', async () => {
    render(page('filling', { rule: 'class:Tank', mode: 'normal' }));
    await screen.findByRole('switch', { name: 'Rated' });
    expect(screen.getByRole('combobox', { name: 'Mode' })).toBe(select());
    expect(select().value).toBe('class:Tank');
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(toggle()).toHaveAccessibleDescription(RATED_OFF);
  });
});

describe('owner bug 3: the locked rule can be queued again for the next game', () => {
  it('after Roll, picking region wars again posts it, and the next-game line says so', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            state: {
              standing: 'fearless',
              pending: { id: 'region', blue: 'shurima', red: 'zaun' },
              rated: null,
              nextRated: false,
              updatedAt: '2026-09-08T20:29:00.000Z',
            },
            notice: 'Next game: Region wars. Blue: Shurima · Red: Zaun. Not rated.',
            changed: true,
          }),
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    render(page('balanced', { rule: 'region' }));
    await screen.findByRole('switch', { name: 'Rated' });
    expect(select().value).toBe('fearless');
    fireEvent.change(select(), { target: { value: 'region' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
    await act(async () => {});
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ groupId: ORIGINAL_GROUP.id, mode: 'region' });
    // Queued: the admin's line says the next game is region wars too; the button goes; the line
    // under the controls is the route's notice, with the next game's own pair.
    // 05-design 8.3.1: the `Next game` picker says it (no bold line in the foot).
    expect(select().value).toBe('region');
    expect(screen.queryByRole('button', { name: 'Set mode' })).toBeNull();
    expect(document.querySelector('[data-slot="mode-outcome"]')).toHaveTextContent(
      'Next game: Region wars. Blue: Shurima · Red: Zaun. Not rated.',
    );
    // This game's pair is the lock's, untouched (the card's status; the foot's region selects
    // list every region, M20.10).
    const status = card().querySelector('a') as HTMLElement;
    expect(within(status).getAllByText('Ionia').length).toBeGreaterThan(0);
    expect(within(status).queryByText('Shurima')).toBeNull();
  });

  it('before Roll, a choice equal to what is set still offers nothing', async () => {
    render(page('filling', { rule: 'region' }));
    await screen.findByRole('switch', { name: 'Rated' });
    expect(screen.queryByRole('button', { name: 'Set mode' })).toBeNull();
  });
});

describe('audit defect 2: the controls keep their state when Roll moves the card', () => {
  it('an unsaved pick survives filling -> teams', async () => {
    const view = render(page('filling'));
    await screen.findByRole('switch', { name: 'Rated' });
    fireEvent.change(select(), { target: { value: 'class:Mage' } });
    expect(screen.getByRole('button', { name: 'Set mode' })).toBeInTheDocument();
    view.rerender(page('balanced'));
    await screen.findByRole('switch', { name: 'Rated' });
    expect(select().value).toBe('class:Mage');
    expect(screen.getByRole('button', { name: 'Set mode' })).toBeInTheDocument();
  });

  it('a write in flight stays pending across the move, and its outcome shows after it', async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    const view = render(page('filling'));
    await screen.findByRole('switch', { name: 'Rated' });
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-disabled', 'true');
    view.rerender(page('balanced'));
    await screen.findByRole('switch', { name: 'Rated' });
    expect(toggle()).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      answer({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          state: {
            standing: 'fearless',
            pending: null,
            rated: false,
            nextRated: false,
            updatedAt: '2026-09-08T20:29:00.000Z',
          },
          notice: 'Next game is not rated.',
          changed: true,
        }),
      } as Response);
    });
    expect(toggle()).not.toHaveAttribute('aria-disabled');
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(document.querySelector('[data-slot="mode-outcome"]')).toHaveTextContent('Next game is not rated.');
  });
});

describe('a failed mode read never shows as Normal', () => {
  it('says it could not read the mode, hides the controls, and keeps the last good card', async () => {
    const { connection: _c, ...good } = tonightStateFixture('idle', { now: NOW, rule: 'class:Tank' });
    const view = render(<TonightView {...good} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />);
    await screen.findByRole('switch', { name: 'Rated' });
    view.rerender(
      <TonightView
        {...good}
        snapshot={{
          ...good.snapshot,
          mode: 'fearless',
          modeRow: { standing: 'normal', pending: null, rated: null },
          modeReadFailed: true,
        }}
        viewer={ADMIN_VIEWER}
        group={ORIGINAL_GROUP}
      />,
    );
    expect(within(card()).getByText(MODE_READ_FAILED)).toBeInTheDocument();
    expect(within(card()).getByRole('heading', { level: 2 })).toHaveTextContent('Class wars');
    expect(screen.queryByRole('switch', { name: 'Rated' })).toBeNull();
  });
});
