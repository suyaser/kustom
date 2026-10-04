import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { MODE_READ_FAILED } from '@/lib/mode/copy';
import { RATED_OFF } from '@/lib/mode/ruleCopy';
import { ADMIN_VIEWER, type TonightFixtureOptions, tonightStateFixture } from '../_tonight/fixtures';
import { TonightView } from '../_tonight/TonightView';

/**
 * The owner's Mode card bugs (2026-10-04) and the audit's state defects, through the real page:
 *
 * - **Owner bug 1, "the mode resets to Normal after Roll".** The controls were fed the state the
 *   record *would* leave (`upcomingState`), which drops the rule the game just locked: the select
 *   jumped to Normal and the Rated switch to on while the card said Class wars, not rated.
 * - **Owner bug 3, "picking it again doesn't stick".** After Roll the pending rule could not be
 *   picked again (the Set button hid while the choice equalled it), so it could not be queued for
 *   the next game too.
 * - **Audit defect 2.** Tonight draws the card in a different place per phase, so a Roll mounted the
 *   controls afresh and lost an unsaved pick, a write in flight and the outcome line.
 * - **A failed mode read rendered as Normal.**
 */

const NOW = Date.parse('2026-09-08T20:30:00.000Z');

function page(key: 'filling' | 'balanced' | 'in-game' | 'idle', options: TonightFixtureOptions = {}) {
  const { connection: _c, ...fixture } = tonightStateFixture(key, { now: NOW, ...options });
  return <TonightView {...fixture} viewer={ADMIN_VIEWER} group={ORIGINAL_GROUP} />;
}

const select = () => screen.getByRole('combobox', { name: 'Mode' }) as HTMLSelectElement;
const toggle = () => screen.getByRole('switch', { name: 'Rated' });
const card = () => screen.getByRole('region', { name: /^Mode / });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('owner bug 1: after Roll the controls show what is set, not a prediction', () => {
  for (const key of ['balanced', 'in-game'] as const) {
    it(`${key}: the select is the pending rule and the switch is its Rated, as the card says`, async () => {
      render(page(key, { rule: 'class:Tank', mode: 'normal' }));
      await screen.findByRole('switch', { name: 'Rated' });
      expect(within(card()).getByRole('heading', { level: 2 })).toHaveTextContent('Class wars');
      expect(select().value).toBe('class:Tank');
      expect(toggle()).toHaveAttribute('aria-checked', 'false');
      expect(toggle()).toHaveAccessibleDescription(RATED_OFF);
    });
  }

  it('region wars too: the select stays on Region wars after Roll', async () => {
    render(page('balanced', { rule: 'region' }));
    await screen.findByRole('switch', { name: 'Rated' });
    expect(select().value).toBe('region');
  });
});

describe('owner bug 3: the locked rule can be queued again for the next game', () => {
  it('after Roll, Set mode is offered for the pending rule and posts it', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            mode: 'fearless',
            changed: true,
            next: { standing: 'fearless', rule: 'region', rated: false, ratedOverride: null, version: 4 },
          }),
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    render(page('balanced', { rule: 'region' }));
    await screen.findByRole('switch', { name: 'Rated' });
    fireEvent.click(screen.getByRole('button', { name: 'Set mode' }));
    await act(async () => {});
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ groupId: ORIGINAL_GROUP.id, mode: 'region' });
    // Queued: the admin's line says the next game is region wars too; the button goes.
    expect(screen.getByText('Next game: Region wars.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set mode' })).toBeNull();
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
          mode: 'fearless',
          changed: true,
          next: { standing: 'fearless', rule: null, rated: false, ratedOverride: false, version: 4 },
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
          modeState: { standing: 'normal', pending: null, ratedOverride: null, version: 0 },
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
