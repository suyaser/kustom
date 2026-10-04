import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WEEK_BOARD_SENTENCE_SHORT } from '../board/copy';
import type { BoardView } from '../board/types';
import { closedWindow } from '../night';
import type { ServiceClient } from '../supabase';
import { SETTLING_FOOTER, type WebhookPayload } from './embeds';

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
      // `last-week` is a week board (M14.57): the row prints net points and W–L.
      track: 'week',
      points: 86,
      sortKey: 34.8,
      rating: 2_088,
      games: 4,
      wins: 3,
      losses: 1,
      ratedGames: 40,
      climb: null,
      settling: false,
      settlingChip: false,
      // M8.3 is a badge on a web row; the post prints the same three award lines it always has.
      awards: [],
    },
  ],
  range: 'Sunday 6 Sep to Saturday 12 Sep',
  games: 4,
  everRated: true,
  notPlayed: 0,
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

/** M14.79: whether the closed week has a picture worth sending (`null` = nearly empty). */
const loadWeekNotes = vi.fn(async (): Promise<unknown> => ({ week: 'WEEK 1' }));
vi.mock('../og/weekNotesLoad', async (original) => ({
  ...(await original<typeof import('../og/weekNotesLoad')>()),
  loadWeekNotes: () => loadWeekNotes(),
}));

vi.mock('./webhook', () => ({
  postToWebhook: (_client: unknown, payload: WebhookPayload) => {
    sent = payload;
    return postToWebhook();
  },
}));

const { postClosedWindow } = await import('./post');

const WINDOW = closedWindow('last-week', new Date('2025-09-08T07:00:00Z'), 'Africa/Cairo');
/** Answers the one read the post makes besides the mocked loaders: the group's slug (M14.10). */
const client = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { slug: 'customs' }, error: null }) }) }),
  }),
} as unknown as ServiceClient;
const GROUP_ID = '00000000-0000-4000-8000-00000000000a';

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
        intro: 'Two awards for the week. Nobody votes; the numbers pick.',
        blocks: [
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

    await postClosedWindow(client, WINDOW, { now: new Date('2025-09-08T07:00:00Z'), groupId: GROUP_ID });

    const fields = (sent as unknown as { embeds: { fields: { name: string; value: string }[] }[] }).embeds[0]
      ?.fields;
    // One block field per award, its label the field's name (05-design 10.6, M14.61). A tie's
    // second line hangs under the first, with the label printed once.
    expect(fields).toHaveLength(3);
    expect(fields?.slice(1)).toEqual([
      { name: 'Best off-role', value: 'Nobody spent 4 games off their main.' },
      { name: 'Cursed duo', value: 'Yuki and Theo · 2W 9L · 18%\nIris and Omar · 2W 9L · 18%' },
    ]);
  });

  /**
   * **The Sunday post prints the week's own number** (M14.57): `last-week` is a week board, so
   * the line carries the row's net points and W–L — the board's sorted number, never a Rating —
   * and the footer is the week's sentence, not the settling line.
   */
  it('prints net points, W–L and the week footer, off the track the rows carry', async () => {
    loadStats.mockResolvedValue({ awards: null });

    await postClosedWindow(client, WINDOW, { now: new Date('2025-09-08T07:00:00Z'), groupId: GROUP_ID });

    const embed = (
      sent as unknown as {
        embeds: { fields: { value: string }[]; footer: { text: string } }[];
      }
    ).embeds[0];
    expect(embed?.fields[0]?.value).toBe('`1` **Lena** · +86 · 3W\u2060–\u20601L');
    expect(embed?.fields[0]?.value).not.toContain('2088');
    expect(embed?.footer.text).toBe(WEEK_BOARD_SENTENCE_SHORT);
    expect(embed?.footer.text).not.toBe(SETTLING_FOOTER);
  });

  /**
   * **A failed award read is not a failed post.** The board is the message and the awards are
   * three lines under it, so a Sunday with no post at all would be worse than a Sunday without
   * `Cursed duo` — and the reason goes in the log, where somebody can find it.
   */
  it('posts the board alone when the stats read throws, and says so once', async () => {
    loadStats.mockRejectedValue(new Error('PostgREST is having a day'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await postClosedWindow(client, WINDOW, {
      now: new Date('2025-09-08T07:00:00Z'),
      groupId: GROUP_ID,
    });

    expect(outcome.status).toBe('sent');
    const embed = (sent as unknown as { embeds: { fields: unknown[]; description: string }[] }).embeds[0];
    expect(embed?.fields).toHaveLength(1);
    // The board's own slot line, word for word (M5.12, named by M7.18): the post and the page
    // it links to count the same games and say so in the same word.
    expect(embed?.description).toBe('Sunday 6 Sep to Saturday 12 Sep · 4 rated games');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).toContain('last-week awards');
    logged.mockRestore();
  });
});

/**
 * M14.79: the Sunday post carries the week notes picture as E1's `image` on a public https origin,
 * addressed by the Sunday the closed week opens on, and none on localhost; the text is the same.
 */
describe('the week notes image', () => {
  const OPTIONS = { now: new Date('2025-09-08T07:00:00Z'), groupId: GROUP_ID, timeZone: 'Africa/Cairo' };

  it('is on E1 from a public origin, for the closed week, and the text is unchanged', async () => {
    loadStats.mockResolvedValue({ awards: null });
    await postClosedWindow(client, WINDOW, { ...OPTIONS, requestOrigin: 'http://localhost:3000' });
    const local = sent as unknown as WebhookPayload;
    await postClosedWindow(client, WINDOW, { ...OPTIONS, requestOrigin: 'https://kustom.example' });
    const pictured = sent as unknown as WebhookPayload;

    expect(pictured.embeds[0]?.image).toEqual({ url: 'https://kustom.example/og/g/customs/week/2025-08-31' });
    expect(local.embeds[0]?.image).toBeUndefined();
    expect(JSON.stringify(local)).not.toContain('/og/');
    // Same lines either way: only the links and the picture depend on the origin.
    expect(pictured.embeds[0]?.fields).toEqual(local.embeds[0]?.fields);
    expect(pictured.embeds[0]?.description).toBe(local.embeds[0]?.description);
    expect(pictured.embeds[0]?.footer).toEqual(local.embeds[0]?.footer);
  });

  it('is left off a nearly empty week (the route 404s for it), and off a failed read', async () => {
    loadStats.mockResolvedValue({ awards: null });
    loadWeekNotes.mockResolvedValueOnce(null);
    await postClosedWindow(client, WINDOW, { ...OPTIONS, requestOrigin: 'https://kustom.example' });
    expect((sent as unknown as WebhookPayload).embeds[0]?.image).toBeUndefined();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadWeekNotes.mockRejectedValueOnce(new Error('PostgREST is having a day'));
    await postClosedWindow(client, WINDOW, { ...OPTIONS, requestOrigin: 'https://kustom.example' });
    expect((sent as unknown as WebhookPayload).embeds[0]?.image).toBeUndefined();
    expect((sent as unknown as WebhookPayload).embeds[0]?.fields).toBeDefined();
    logged.mockRestore();
  });
});

/**
 * M16.5: the weekly storyline opens the post when present; **without one the post is today's,
 * byte for byte** (no hook, a hook with nothing, a hidden line: all the same request).
 */
describe('the weekly storyline', () => {
  const AWARDS = {
    awards: {
      kind: 'closed',
      intro: 'Two awards for the week. Nobody votes; the numbers pick.',
      blocks: [
        {
          label: 'Best off-role',
          rule: 'rule',
          won: true,
          note: null,
          lines: [{ key: 'puuid-lena', text: 'Lena · 3W 1L' }],
        },
      ],
    },
  };
  const OPTIONS = { now: new Date('2025-09-08T07:00:00Z'), groupId: GROUP_ID, timeZone: 'Africa/Cairo' };

  it('is missing: the post is byte-identical to the one without the hook (snapshot)', async () => {
    loadStats.mockResolvedValue(AWARDS);
    await postClosedWindow(client, WINDOW, OPTIONS);
    const before = JSON.stringify(sent);
    await postClosedWindow(client, WINDOW, OPTIONS, { storyline: async () => null });
    expect(JSON.stringify(sent)).toBe(before);
    expect(sent).toMatchSnapshot();
  });

  it('is present: it opens the post as its own embed, and the board embed is unchanged', async () => {
    loadStats.mockResolvedValue(AWARDS);
    await postClosedWindow(client, WINDOW, OPTIONS);
    const plain = sent as unknown as WebhookPayload;
    const seen: unknown[] = [];
    await postClosedWindow(client, WINDOW, OPTIONS, {
      storyline: async (source) => {
        seen.push(source);
        return 'Lena took the week with 3 wins from 4 games.';
      },
    });
    const withLine = sent as unknown as WebhookPayload;
    expect(withLine.embeds).toHaveLength(2);
    expect(withLine.embeds[0]).toEqual({
      color: 0x8b98ad,
      title: 'AI recap',
      description: 'Lena took the week with 3 wins from 4 games.',
    });
    expect(withLine.embeds[1]).toEqual(plain.embeds[0]);
    // The hook is handed the post's own numbers: the board rows, the count and the stats read.
    expect(seen).toEqual([
      expect.objectContaining({
        groupId: GROUP_ID,
        timeZone: 'Africa/Cairo',
        games: 4,
        rows: board.rows,
        stats: AWARDS,
      }),
    ]);
  });
});
