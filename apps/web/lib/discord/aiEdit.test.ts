import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceClient } from '../supabase';
import {
  AI_RECAP_FIELD_NAME,
  discordRecapText,
  editResultWithRecap,
  forgetResultPosts,
  RECAP_EDIT_WINDOW_MS,
  recapPayload,
  rememberResultPost,
  resultPostOf,
} from './aiEdit';
import type { WebhookPayload } from './embeds';
import { postWebhookPayload } from './webhook';

/** M16.4: the Discord half of the recap line. No real webhook is ever called. */

const WEBHOOK = 'https://discord.com/api/webhooks/123/secret-token';
const GROUP = '11111111-1111-4111-8111-111111111111';
const GAME = '22222222-2222-4222-8222-222222222222';
const POSTED_AT = new Date('2026-10-20T20:00:00Z');

/** A result post as M14.61 sends it: E1, then the two sides. */
const PAYLOAD: WebhookPayload = {
  username: 'Kustom',
  embeds: [
    {
      color: 0x3b82f6,
      author: { name: 'Customs Night · game 3' },
      title: 'Blue wins · 31 min',
      description: '**MVP** Nadia · **ACE** Ziad',
    },
    { color: 3_054_591, title: '🟦 BLUE', description: 'a' },
    { color: 16_739_125, title: '🟥 RED', description: 'b' },
  ],
};

/** `discord_config` read: `.from().select().eq().not().order().limit().maybeSingle()`. */
function fakeClient(url: string | null): ServiceClient {
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'not', 'order', 'limit']) chain[name] = () => chain;
  chain.maybeSingle = async () => ({ data: url === null ? null : { webhook_url: url }, error: null });
  return { from: () => chain } as unknown as ServiceClient;
}

function okFetch(body: unknown = {}) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function remember(at = POSTED_AT) {
  rememberResultPost(
    GAME,
    {
      groupId: GROUP,
      outcome: { status: 'posted', httpStatus: 200, reason: null, attempts: 1, messageId: '987654321' },
      payload: PAYLOAD,
    },
    at,
  );
}

afterEach(() => {
  forgetResultPosts();
  vi.restoreAllMocks();
});

describe('recapPayload', () => {
  it('adds the labelled line as its own last embed, slate, and changes nothing else (M14.61)', () => {
    const edited = recapPayload(PAYLOAD, 'Nadia put up 9 kills.');
    expect(edited).toMatchSnapshot();
    expect(edited.embeds.slice(0, 3)).toEqual(PAYLOAD.embeds);
    expect(edited.embeds.at(-1)).toEqual({
      color: 9_148_589,
      title: 'AI recap',
      description: 'Nadia put up 9 kills.',
    });
    expect(edited.embeds[0]).not.toHaveProperty('fields');
    expect(AI_RECAP_FIELD_NAME).toBe('AI recap');
  });

  it('never adds the block twice', () => {
    const twice = recapPayload(recapPayload(PAYLOAD, 'one'), 'two');
    expect(twice.embeds.filter((embed) => embed.title === AI_RECAP_FIELD_NAME)).toHaveLength(1);
    expect(twice.embeds).toHaveLength(4);
  });
});

describe('discordRecapText', () => {
  it('escapes names the way every post does, and the text around them', () => {
    const text = discordRecapText('\u00000\u0000 out-farmed \u00001\u0000 [twice](x) as *Blue* won.', [
      '**Bold_Guy**',
      '@everyone',
    ]);
    expect(text).toBe('\\*\\*Bold\\_Guy\\*\\* out-farmed @everyone \\[twice\\](x) as \\*Blue\\* won.');
  });

  it('prints the nameless fallback for a player with no name, and nothing for a missing slot', () => {
    expect(discordRecapText('\u00000\u0000 won.', [null])).not.toContain('\u0000');
    expect(discordRecapText('\u00003\u0000 won.', ['A'])).toBeNull();
  });
});

describe('editResultWithRecap (fake clock)', () => {
  it('edits the same message within 15 minutes, with mentions off', async () => {
    remember();
    const fetchImpl = okFetch();
    const outcome = await editResultWithRecap(
      fakeClient(WEBHOOK),
      { gameId: GAME, line: 'Nadia won.', now: new Date(POSTED_AT.getTime() + 14 * 60_000) },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(outcome).toEqual({ status: 'edited' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${WEBHOOK}/messages/987654321`);
    expect(init?.method).toBe('PATCH');
    const body = JSON.parse(String(init?.body));
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toBeUndefined();
    // The recap is its own last embed, slate (M14.61); the posted stack is unchanged above it.
    expect(body.embeds.at(-1)).toEqual({ color: 9_148_589, title: 'AI recap', description: 'Nadia won.' });
    expect(body.embeds.slice(0, 3)).toEqual(PAYLOAD.embeds);
    expect(body.username).toBe('Kustom');
  });

  it('is exactly on time at 15:00 and late at 15:01: no edit after the window', async () => {
    const fetchImpl = okFetch();
    const record = {
      groupId: GROUP,
      messageId: '987654321',
      postedAt: POSTED_AT,
      payload: PAYLOAD,
    };
    const atLimit = await editResultWithRecap(
      fakeClient(WEBHOOK),
      { gameId: GAME, line: 'x', now: new Date(POSTED_AT.getTime() + RECAP_EDIT_WINDOW_MS) },
      { fetchImpl: fetchImpl as unknown as typeof fetch, record },
    );
    expect(atLimit).toEqual({ status: 'edited' });
    const late = await editResultWithRecap(
      fakeClient(WEBHOOK),
      { gameId: GAME, line: 'x', now: new Date(POSTED_AT.getTime() + RECAP_EDIT_WINDOW_MS + 60_000) },
      { fetchImpl: fetchImpl as unknown as typeof fetch, record },
    );
    expect(late).toEqual({ status: 'skipped', reason: 'late' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('forgets a post once the window has passed', () => {
    remember();
    expect(resultPostOf(GAME, new Date(POSTED_AT.getTime() + 60_000))).not.toBeNull();
    expect(resultPostOf(GAME, new Date(POSTED_AT.getTime() + RECAP_EDIT_WINDOW_MS + 1))).toBeNull();
  });

  it('skips when the post was never made here, or landed without an id', async () => {
    const fetchImpl = okFetch();
    rememberResultPost(
      GAME,
      {
        groupId: GROUP,
        outcome: { status: 'posted', httpStatus: 204, reason: null, attempts: 1 },
        payload: PAYLOAD,
      },
      POSTED_AT,
    );
    const outcome = await editResultWithRecap(
      fakeClient(WEBHOOK),
      { gameId: GAME, line: 'x', now: POSTED_AT },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(outcome).toEqual({ status: 'skipped', reason: 'no_post' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a refused edit without throwing', async () => {
    remember();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const outcome = await editResultWithRecap(
      fakeClient(WEBHOOK),
      { gameId: GAME, line: 'x', now: POSTED_AT },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(outcome).toEqual({ status: 'failed', reason: 'HTTP 404' });
  });
});

describe('the result post itself', () => {
  it('is the plain request it always was unless the group asked for the id', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const outcome = await postWebhookPayload(WEBHOOK, PAYLOAD, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome).toEqual({ status: 'posted', httpStatus: 204, reason: null, attempts: 1 });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(WEBHOOK);
  });

  it('asks for the message with wait=true and returns its id when the group needs it', async () => {
    const fetchImpl = okFetch({ id: '555', channel_id: '1' });
    const outcome = await postWebhookPayload(WEBHOOK, PAYLOAD, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      wait: true,
    });
    expect(outcome.messageId).toBe('555');
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`${WEBHOOK}?wait=true`);
  });
});
