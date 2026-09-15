import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardView } from '../board/types';
import { closedWindow } from '../night';
import type { ServiceClient } from '../supabase';
import type { WebhookPayload } from './embeds';

/**
 * The Sunday post's **awards field**, at the seam where it can fail: `postClosedWindow` reads
 * the closed window twice — once for the board, once for M5.4's three award lines — and the
 * second read must never cost the group the first (M5.10, M5.4).
 *
 * The happy path is `window.integration.test.ts`, against real rows and a real webhook. This
 * file is the unhappy one, which no database can produce on demand: the stats read throwing.
 */

const board: BoardView = {
  window: 'last-week',
  rows: [
    {
      puuid: 'puuid-lena',
      name: 'Lena',
      proven: 1_548,
      sortKey: 25.8,
      rating: 2_088,
      games: 4,
      wins: 3,
      losses: 1,
      streak: null,
      climb: null,
      settling: false,
      breakdown: [],
    },
  ],
  range: 'Sunday 6 Sep to Saturday 12 Sep',
  games: 4,
};

const loadStats = vi.fn();
const postToWebhook = vi.fn(async (): Promise<{ status: string }> => ({ status: 'sent' }));
let sent: WebhookPayload | null = null;

vi.mock('../board/load', () => ({
  loadBoard: async () => board,
}));

vi.mock('../stats/load', () => ({
  loadStats: (...args: unknown[]) => loadStats(...args),
}));

vi.mock('./webhook', () => ({
  postToWebhook: (_client: unknown, payload: WebhookPayload) => {
    sent = payload;
    return postToWebhook();
  },
}));

const { postClosedWindow } = await import('./post');

const WINDOW = closedWindow('last-week', new Date('2025-09-08T07:00:00Z'), 'Africa/Cairo');
const client = {} as ServiceClient;

beforeEach(() => {
  sent = null;
  loadStats.mockReset();
  postToWebhook.mockClear();
});

describe('the awards field', () => {
  it('is the lines the page prints, one field entry per award', async () => {
    loadStats.mockResolvedValue({
      awards: {
        kind: 'closed',
        intro: 'Three awards for the week. Nobody votes; the numbers pick.',
        blocks: [
          {
            label: 'Most improved',
            rule: 'rule',
            won: true,
            note: null,
            lines: [{ key: 'puuid-nadia', text: 'Nadia · +212 · 1266 → 1478' }],
          },
          {
            label: 'Best off-role',
            rule: 'rule',
            won: false,
            note: null,
            lines: [{ key: 'nobody', text: 'Nobody spent 4 games off their main.' }],
          },
          {
            label: 'Cursed duo',
            rule: 'rule',
            won: true,
            note: null,
            // A tie: two lines under one bold label rather than the label printed twice.
            lines: [
              { key: 'a|b', text: 'Yuki and Theo · 2W 9L · 18%' },
              { key: 'c|d', text: 'Iris and Omar · 2W 9L · 18%' },
            ],
          },
        ],
      },
    });

    await postClosedWindow(client, WINDOW, { now: new Date('2025-09-08T07:00:00Z') });

    const fields = (sent as unknown as { embeds: { fields: { name: string; value: string }[] }[] }).embeds[0]
      ?.fields;
    expect(fields).toHaveLength(2);
    expect(fields?.[1]?.name).toBe('Awards');
    // A tie's second line hangs under the first, with the bold label printed once.
    expect(fields?.[1]?.value.split('\n')).toEqual([
      '**Most improved** Nadia · +212 · 1266 → 1478',
      '**Best off-role** Nobody spent 4 games off their main.',
      '**Cursed duo** Yuki and Theo · 2W 9L · 18%',
      'Iris and Omar · 2W 9L · 18%',
    ]);
  });

  /**
   * **A failed award read is not a failed post.** The board is the message and the awards are
   * three lines under it, so a Sunday with no post at all would be worse than a Sunday without
   * `Cursed duo` — and the reason goes in the log, where somebody can find it.
   */
  it('posts the board alone when the stats read throws, and says so once', async () => {
    loadStats.mockRejectedValue(new Error('PostgREST is having a day'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await postClosedWindow(client, WINDOW, { now: new Date('2025-09-08T07:00:00Z') });

    expect(outcome.status).toBe('sent');
    const embed = (sent as unknown as { embeds: { fields: unknown[]; description: string }[] }).embeds[0];
    expect(embed?.fields).toHaveLength(1);
    expect(embed?.description).toBe('Sunday 6 Sep to Saturday 12 Sep · 4 games');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).toContain('last-week awards');
    logged.mockRestore();
  });
});
