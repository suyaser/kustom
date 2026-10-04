import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookOutcome } from '@/lib/discord/webhook';
import type { WindowClaim } from '@/lib/discord/windowPosts';
import { type ClosedWindow, closedWindow, DEFAULT_NIGHT_TIME_ZONE } from '@/lib/night';
import { nightTimeZone } from '@/lib/tonight/night';
import { GET, responseSchema, windowsToConsider } from './route';

/**
 * The weekly post's door and the answer it gives a scheduler (M5.13), plus the one calendar
 * rule that is only true here: **which windows a call even looks at**.
 *
 * Everything downstream is mocked on purpose. That a window posts exactly once is a claim
 * about a database and is tested against the local stack in `window.integration.test.ts`;
 * what the post says is `lib/discord/embeds.test.ts`. What is only true at this seam is the
 * door, the zone, and the shape of the body.
 */

const stub = vi.hoisted(() => ({
  /** The groups the route loops over (M13.4); one unless a test adds a second. */
  groups: [{ id: '00000000-0000-4000-8000-00000000000a', slug: 'a' }] as { id: string; slug: string }[],
  /** A group with no webhook, beside the default answer. */
  noWebhookFor: null as string | null,
  /** A group whose post fails, beside the default outcome. */
  failFor: null as string | null,
  webhook: 'https://discord.example/webhook' as string | null,
  claim: { ok: true, attempts: 1 } as WindowClaim,
  outcome: { status: 'posted', httpStatus: 204, reason: null, attempts: 1 } as WebhookOutcome,
  /** What the route asked for, so the window and the zone it posts can be asserted here. */
  posts: [] as { window: ClosedWindow; timeZone?: string; now?: Date; groupId?: string }[],
  claims: [] as ClosedWindow[],
  claimGroups: [] as string[],
  marked: [] as { window: ClosedWindow; reason: string | null }[],
  failures: [] as { window: ClosedWindow; reason: string }[],
}));

vi.mock('@/lib/groups/list', () => ({
  listGroups: async () => stub.groups,
}));

vi.mock('@/lib/discord/webhook', () => ({
  selectWebhookUrl: async (_client: unknown, groupId: string): Promise<string | null> =>
    groupId === stub.noWebhookFor ? null : stub.webhook,
}));

vi.mock('@/lib/discord/windowPosts', () => ({
  claimWindowPost: async (_client: unknown, groupId: string, window: ClosedWindow): Promise<WindowClaim> => {
    stub.claims.push(window);
    stub.claimGroups.push(groupId);
    return stub.claim;
  },
  markWindowPosted: async (
    _client: unknown,
    _groupId: string,
    window: ClosedWindow,
    _now: Date,
    reason: string | null = null,
  ): Promise<void> => {
    stub.marked.push({ window, reason });
  },
  recordWindowPostFailure: async (
    _client: unknown,
    _groupId: string,
    window: ClosedWindow,
    reason: string,
  ): Promise<void> => {
    stub.failures.push({ window, reason });
  },
}));

vi.mock('@/lib/discord/post', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/discord/post')>();
  return {
    NO_GAMES_IN_WINDOW: original.NO_GAMES_IN_WINDOW,
    postClosedWindow: async (
      _client: unknown,
      window: ClosedWindow,
      options: { timeZone?: string; now?: Date; groupId?: string },
    ): Promise<WebhookOutcome> => {
      stub.posts.push({ window, ...options });
      if (options.groupId === stub.failFor) {
        return { status: 'failed', httpStatus: 500, reason: 'HTTP 500', attempts: 2 };
      }
      return stub.outcome;
    },
  };
});

const GROUP_A = '00000000-0000-4000-8000-00000000000a';
const GROUP_B = '00000000-0000-4000-8000-00000000000b';

/** The body for the one default group. */
function one(posted: string[], skipped: { kind: string; reason: string }[]) {
  return { ok: true, groups: [{ groupId: GROUP_A, posted, skipped }] };
}

function get(authorization?: string): Request {
  return new Request('http://localhost/api/cron/window', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('GET /api/cron/window', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.CRON_SECRET = '';
    stub.groups = [{ id: GROUP_A, slug: 'a' }];
    stub.noWebhookFor = null;
    stub.failFor = null;
    stub.claimGroups = [];
    stub.webhook = 'https://discord.example/webhook';
    stub.claim = { ok: true, attempts: 1 };
    stub.outcome = { status: 'posted', httpStatus: 204, reason: null, attempts: 1 };
    stub.posts = [];
    stub.claims = [];
    stub.marked = [];
    stub.failures = [];
  });

  afterEach(() => {
    process.env = { ...saved };
    vi.useRealTimers();
  });

  it('is closed when no secret is configured, rather than open', async () => {
    const response = await GET(get('Bearer anything'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'the window post is not configured',
    });
    expect(stub.claims).toHaveLength(0);
  });

  it('answers 401 without a bearer token, and writes nothing', async () => {
    process.env.CRON_SECRET = 'secret-value';

    const missing = await GET(get());
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ ok: false, error: 'missing bearer token' });

    const wrongScheme = await GET(get('Basic secret-value'));
    expect(wrongScheme.status).toBe(401);

    expect(stub.claims).toHaveLength(0);
    expect(stub.posts).toHaveLength(0);
  });

  it('answers 401 for the wrong secret, and writes nothing', async () => {
    process.env.CRON_SECRET = 'secret-value';

    const response = await GET(get('Bearer not-the-secret'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'bad cron secret' });
    expect(stub.claims).toHaveLength(0);
  });

  it('answers 500 when the process cannot reach the database at all', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';

    const response = await GET(get('Bearer secret-value'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'server is not configured' });
  });

  it('reports the week it posted, under the response schema', async () => {
    process.env.CRON_SECRET = 'secret-value';

    const response = await GET(get('Bearer secret-value'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(one(['last-week'], []));
    expect(responseSchema.safeParse(body).success).toBe(true);
    expect(stub.marked.map((mark) => mark.reason)).toEqual([null]);
  });

  it('says which window it skipped and why, without ever naming the webhook', async () => {
    process.env.CRON_SECRET = 'secret-value';
    stub.claim = { ok: false, reason: 'already posted' };

    const response = await GET(get('Bearer secret-value'));
    const body = await response.json();

    expect(body).toEqual(one([], [{ kind: 'last-week', reason: 'already posted' }]));
    expect(stub.posts).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain('http');
  });

  /**
   * **A failed post is not a posted week** (M5.13): the row keeps `posted_at` null so a later
   * call retries it, and the scheduler is told what happened rather than left to guess from a
   * bare `ok`.
   */
  it('leaves a failed post retryable and reports the failure', async () => {
    process.env.CRON_SECRET = 'secret-value';
    stub.outcome = { status: 'failed', httpStatus: 500, reason: 'HTTP 500', attempts: 2 };

    const body = await (await GET(get('Bearer secret-value'))).json();

    expect(body).toEqual(one([], [{ kind: 'last-week', reason: 'HTTP 500' }]));
    expect(stub.marked).toHaveLength(0);
    expect(stub.failures.map((failure) => failure.reason)).toEqual(['HTTP 500']);
  });

  /**
   * **An empty window is stamped posted** (M5.13, edge case 2): left unstamped it would be
   * retried every hour for the next seven days, and there is nothing there to find.
   */
  it('records a window with no games as posted, with the reason', async () => {
    process.env.CRON_SECRET = 'secret-value';
    stub.outcome = {
      status: 'skipped',
      httpStatus: null,
      reason: 'no games in the window',
      attempts: 0,
    };

    const body = await (await GET(get('Bearer secret-value'))).json();

    expect(body).toEqual(one([], [{ kind: 'last-week', reason: 'no games in the window' }]));
    expect(stub.marked.map((mark) => mark.reason)).toEqual(['no games in the window']);
    expect(stub.failures).toHaveLength(0);
  });

  /**
   * **Nothing is claimed on a deployment with no webhook** (edge case 5): a `window_posts` row
   * says "the group has been told", and writing one with nowhere to tell them would silently
   * eat the first week after somebody finally configures Discord.
   */
  it('writes nothing at all when no webhook is configured', async () => {
    process.env.CRON_SECRET = 'secret-value';
    stub.webhook = null;

    const response = await GET(get('Bearer secret-value'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(one([], [{ kind: 'last-week', reason: 'no webhook configured' }]));
    expect(stub.claims).toHaveLength(0);
    expect(stub.posts).toHaveLength(0);
  });

  /**
   * **Every group, independently** (M13.4): a group with no webhook is skipped with no claim, a
   * group whose webhook fails keeps its claim retryable, and neither stops the next group.
   */
  it('posts each group on its own: no webhook and a failing webhook do not stop the next group', async () => {
    process.env.CRON_SECRET = 'secret-value';
    const GROUP_C = '00000000-0000-4000-8000-00000000000c';
    stub.groups = [
      { id: GROUP_A, slug: 'a' },
      { id: GROUP_B, slug: 'b' },
      { id: GROUP_C, slug: 'c' },
    ];
    stub.noWebhookFor = GROUP_A;
    stub.failFor = GROUP_B;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const body = await (await GET(get('Bearer secret-value'))).json();
    spy.mockRestore();

    expect(body).toEqual({
      ok: true,
      groups: [
        { groupId: GROUP_A, posted: [], skipped: [{ kind: 'last-week', reason: 'no webhook configured' }] },
        { groupId: GROUP_B, posted: [], skipped: [{ kind: 'last-week', reason: 'HTTP 500' }] },
        { groupId: GROUP_C, posted: ['last-week'], skipped: [] },
      ],
    });
    expect(responseSchema.safeParse(body).success).toBe(true);
    // No claim for the group with nowhere to post; B's claim is left for a retry, C's stamped.
    expect(stub.claimGroups).toEqual([GROUP_B, GROUP_C]);
    expect(stub.failures.map((failure) => failure.reason)).toEqual(['HTTP 500']);
    expect(stub.marked).toHaveLength(1);
    expect(stub.posts.map((post) => post.groupId)).toEqual([GROUP_B, GROUP_C]);
  });

  /**
   * **The zone decides which week this is** (M5.9, M5.12, and the reviewer's catch on the
   * nightly route): the claim, the board and the link all have to name one window.
   */
  it('reads the configured zone and posts the week the pages read', async () => {
    process.env.CRON_SECRET = 'secret-value';
    process.env.CUSTOMS_NIGHT_TZ = 'America/New_York';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-09-09T12:00:00Z'));

    await GET(get('Bearer secret-value'));

    expect(stub.posts[0]?.timeZone).toBe('America/New_York');
    expect(stub.posts[0]?.timeZone).toBe(nightTimeZone());
    expect(stub.posts[0]?.window.key).toBe(
      closedWindow('last-week', new Date('2025-09-09T12:00:00Z'), 'America/New_York').key,
    );
    // The window it claimed and the window it posted are the same object, so the row and the
    // channel can never be two different weeks.
    expect(stub.claims[0]?.key).toBe(stub.posts[0]?.window.key);
  });

  it("falls back to the group's own zone when the variable is not set", async () => {
    process.env.CRON_SECRET = 'secret-value';
    delete process.env.CUSTOMS_NIGHT_TZ;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-09-09T12:00:00Z'));

    await GET(get('Bearer secret-value'));

    expect(stub.posts[0]?.timeZone).toBe(DEFAULT_NIGHT_TIME_ZONE);
  });

  /** M14.48: the month windows are gone, so the 1st posts the week and nothing else. */
  it('posts the week alone on the 1st, with no month post', async () => {
    process.env.CRON_SECRET = 'secret-value';
    process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';
    vi.useFakeTimers({ toFake: ['Date'] });
    // Wednesday 1 October 2025, 10:00 Cairo: September closed four hours ago.
    vi.setSystemTime(new Date('2025-10-01T07:00:00Z'));

    const body = await (await GET(get('Bearer secret-value'))).json();

    expect(body.groups[0].posted).toEqual(['last-week']);
    expect(stub.posts.map((post) => post.window.kind)).toEqual(['last-week']);
  });
});

/**
 * **`last-week` always, and nothing else** (M14.48 dropped the month post on the 1st). Only the
 * most recently closed week, which keeps a deployment that was down all Sunday posting last week
 * on Monday, and never a backlog.
 */
describe('windowsToConsider', () => {
  const CAIRO = 'Africa/Cairo';

  it('considers only the week on an ordinary day', () => {
    const windows = windowsToConsider(new Date('2025-09-09T12:00:00Z'), CAIRO);

    expect(windows.map((window) => window.kind)).toEqual(['last-week']);
    // The one most recently closed week, and never a backlog of every week since March. Tuesday
    // the 9th sits in the week that opened on Sunday the 7th (M5.34), so the closed one opened
    // on Sunday 31 August at 06:00 Cairo.
    expect(windows[0]?.key).toBe('2025-08-31T03:00:00.000Z');
  });

  it('considers only the week on the 1st, the 2nd and the 15th too', () => {
    for (const instant of [
      // 06:00 Cairo on the 1st, the instant September closes; late on the 1st; the 2nd; the 15th.
      '2025-10-01T03:00:00Z',
      '2025-10-01T22:00:00Z',
      '2025-10-02T09:00:00Z',
      '2025-10-15T09:00:00Z',
    ]) {
      expect(
        windowsToConsider(new Date(instant), CAIRO).map((window) => window.kind),
        instant,
      ).toEqual(['last-week']);
    }
  });
});
