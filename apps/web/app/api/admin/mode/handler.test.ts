import type { ChampionTable, ModeLock, ModeRow, Rng, TransitionContext } from '@customs/core';
import { setGroupModeResponseSchema } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import type { ServiceClient } from '@/lib/supabase';
import { memoryModeStore } from '@/lib/testing/modeStore';
import { type ModeRouteDeps, setGroupModeRoute } from './handler';

/**
 * `POST /api/admin/mode` (M15.3; every action since M20.7, Spin merged in) with an in-memory card
 * store: the gate, zod on the body, each action's patch, the `{ state, notice }` answer and the
 * form notices. The database half is `mode.integration.test.ts` and
 * `modeOfTheNight.integration.test.ts`.
 */

const GROUP = '00000000-0000-4000-8000-00000000000a';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const admin: AdminAuthResult = {
  ok: true,
  admin: {
    userId: 'e3b0c442-0000-4000-8000-000000000001',
    discordId: '1',
    playerId: PLAYER,
    groupId: GROUP,
    puuid: 'p',
    displayName: 'Hana',
    email: null,
    discordName: null,
  },
};
const notAdmin: AdminAuthResult = { ok: false, status: 403, error: 'not an admin of that group' };

/** A client that answers the slug lookup a form post makes, and nothing for every other read. */
const client = {
  from: (table: string) => {
    const answer = {
      data: table === 'groups' ? { id: GROUP, slug: 'crew', name: 'Crew' } : null,
      error: null,
    };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'not', 'gte', 'order', 'limit']) chain[method] = () => chain;
    chain.maybeSingle = async () => answer;
    return chain;
  },
  // `bump_group_live` (M19.9): logged with how many card writes had landed when it ran.
  rpc: async (name: string, args: { p_group: string; p_kind: string }) => {
    bumps.push({ name, group: args.p_group, kind: args.p_kind, writesBefore: current?.writes.length ?? -1 });
    return { data: bumps.length, error: null };
  },
} as unknown as ServiceClient;

const bumps: { name: string; group: string; kind: string; writesBefore: number }[] = [];
let current: ReturnType<typeof memoryModeStore> | null = null;

const REGIONS = ['ionia', 'noxus', 'zaun', 'targon'] as const;

/**
 * Ten champions in each of ionia, noxus and zaun, three in targon (never drawable); five tanks,
 * the rest mages: Tanks only is under core's minimum, Mages only is not.
 */
const table: ChampionTable = new Map(
  Array.from({ length: 33 }, (_, i) => [
    i + 1,
    {
      tags: [i < 5 ? ('Tank' as const) : ('Mage' as const)],
      region: [i < 10 ? 'ionia' : i < 20 ? 'noxus' : i < 30 ? 'zaun' : 'targon'],
    },
  ]),
);

const contextOf =
  (rng: Rng = () => 0, fearlessPool: readonly number[] = []) =>
  async (): Promise<TransitionContext> => ({ roster: table, regions: REGIONS, fearlessPool, rng });

const card = (over: Partial<ModeRow> = {}): ModeRow => ({
  standing: 'fearless',
  pending: null,
  rated: null,
  ...over,
});

function setup(initial: ModeRow | null = card(), deps: ModeRouteDeps = {}, auth = admin) {
  const t = memoryModeStore(initial);
  current = t;
  bumps.length = 0;
  const options = {
    getClient: () => client,
    authorize: async () => auth,
    store: t.store,
    context: contextOf(),
    spinFacts: async () => ({ previous: null, lobbyOpen: false }),
    ...deps,
  };
  return { t, mode: setGroupModeRoute(options) };
}

const json = (body: unknown) =>
  new Request('http://localhost/api/admin/mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const form = (fields: Record<string, string>) =>
  new Request('http://localhost/api/admin/mode', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

async function answer(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const noticeOf = (response: Response) => new URL(response.headers.get('location') ?? '').searchParams;

describe('POST /api/admin/mode: the gate and the body', () => {
  it('403 for somebody who is not an admin, and nothing written', async () => {
    const { t, mode } = setup(card(), {}, notAdmin);
    expect((await mode(json({ groupId: GROUP, mode: 'class:Mage' }))).status).toBe(403);
    expect(t.writes).toEqual([]);
  });

  it('400 for an unknown choice, for no action, for two at once, and a target without a region action', async () => {
    const { t, mode } = setup();
    for (const body of [
      { groupId: GROUP, mode: 'class:Fighter' },
      { groupId: GROUP, mode: 'class' },
      { groupId: GROUP },
      { groupId: GROUP, mode: 'normal', rated: true },
      { groupId: GROUP, rated: 'maybe' },
      { groupId: GROUP, side: 'blue' },
      { groupId: GROUP, rated: true, game: 'this' },
    ]) {
      expect((await mode(json(body))).status).toBe(400);
    }
    expect(t.writes).toEqual([]);
  });
});

describe('POST /api/admin/mode: each action is one patch of only its fields (M20.7 (1))', () => {
  it("M14's standing body: the standing mode, the rule and Rated emptied; one { state, notice } answer", async () => {
    const { t, mode } = setup(card({ pending: { id: 'mirror' }, rated: false }));
    const { status, body } = await answer(await mode(json({ groupId: GROUP, mode: 'normal' })));
    expect(status).toBe(200);
    const parsed = setGroupModeResponseSchema.parse(body);
    expect(parsed).toMatchObject({
      ok: true,
      state: { standing: 'normal', pending: null, rated: null, nextRated: true },
      notice: 'Rule cleared. Back to Normal.',
      changed: true,
    });
    // M20.8: the answer's `state` is the card; the old top-level `mode` field is gone.
    expect(parsed.state.standing).toBe('normal');
    expect(parsed).not.toHaveProperty('mode');
    expect(t.writes.map((w) => w.patch)).toEqual([{ standing: 'normal', pending: null, rated: null }]);
  });

  it('a repeat standing pick is changed: false and writes nothing', async () => {
    const { t, mode } = setup();
    const { body } = await answer(await mode(json({ groupId: GROUP, mode: 'fearless' })));
    expect(body).toMatchObject({ changed: false });
    expect(t.writes).toEqual([]);
  });

  it('a rule writes the rule and resets Rated, never the standing mode, and names the setter', async () => {
    const { t, mode } = setup(card({ rated: true }));
    const { body } = await answer(await mode(json({ groupId: GROUP, mode: 'class:Mage' })));
    expect(body).toMatchObject({
      state: { standing: 'fearless', pending: { id: 'class', tag: 'Mage' }, rated: null, nextRated: false },
      notice: 'Next game: Class wars, mages only. Not rated.',
    });
    expect(t.writes).toEqual([
      { patch: { pending: { id: 'class', tag: 'Mage' }, rated: null }, writer: { playerId: PLAYER } },
    ]);
  });

  it('the Rated switch writes only Rated, from JSON or a form', async () => {
    const { t, mode } = setup(card({ pending: { id: 'mirror' } }));
    const { body } = await answer(await mode(json({ groupId: GROUP, rated: false })));
    expect(body).toMatchObject({
      state: { pending: { id: 'mirror' }, rated: false },
      notice: 'Next game is not rated.',
    });
    await mode(form({ groupId: GROUP, rated: 'true' }));
    expect(t.writes.map((w) => w.patch)).toEqual([{ rated: false }, { rated: true }]);
    expect(t.row()).toEqual(card({ pending: { id: 'mirror' }, rated: true }));
  });

  it('a form post goes back with the notice', async () => {
    const { mode } = setup();
    const response = await mode(form({ groupId: GROUP, mode: 'class:Mage', redirectTo: '/g/crew' }));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/g/crew');
    expect(noticeOf(response).get('notice')).toBe('Next game: Class wars, mages only. Not rated.');
  });
});

describe('POST /api/admin/mode: region wars is drawn when it is chosen (M20 D9)', () => {
  it('choosing it writes the rule and its pair in one update, and the notice names them', async () => {
    const { t, mode } = setup(card({ standing: 'normal' }));
    const { body } = await answer(await mode(json({ groupId: GROUP, mode: 'region' })));
    expect(t.writes).toHaveLength(1);
    const pending = t.row()?.pending;
    expect(pending).toMatchObject({ id: 'region' });
    expect(pending?.id === 'region' && pending.blue !== pending.red).toBe(true);
    expect(body.notice).toMatch(
      /^Next game: Region wars\. Blue: (Ionia|Noxus|Zaun) · Red: (Ionia|Noxus|Zaun)\. Not rated\.$/,
    );
  });

  it('choosing it again keeps the pair (Redraw is the reroll)', async () => {
    const pair = { id: 'region', blue: 'zaun', red: 'noxus' } as const;
    const { t, mode } = setup(card({ pending: pair, rated: true }));
    await mode(json({ groupId: GROUP, mode: 'region' }));
    expect(t.row()).toMatchObject({ pending: pair, rated: null });
  });

  it('redraw next: a new pair, never the same unordered pair; only the rule written', async () => {
    const pair = { id: 'region', blue: 'zaun', red: 'noxus' } as const;
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const { t, mode } = setup(card({ pending: pair, rated: true }), { context: contextOf(() => r) });
      const { status, body } = await answer(await mode(json({ groupId: GROUP, redraw: true, game: 'next' })));
      expect(status).toBe(200);
      const next = t.row()?.pending;
      expect(next?.id).toBe('region');
      if (next?.id === 'region') expect([next.blue, next.red].sort()).not.toEqual(['noxus', 'zaun']);
      expect(t.writes.map((w) => Object.keys(w.patch))).toEqual([['pending']]);
      expect(t.row()?.rated).toBe(true);
      expect(body.notice).toMatch(/^Next game: \w+ vs \w+\.$/);
    }
  });

  it('set side next: the named region, the other side kept', async () => {
    const { t, mode } = setup(card({ pending: { id: 'region', blue: 'zaun', red: 'noxus' } }));
    const { body } = await answer(await mode(json({ groupId: GROUP, side: 'blue', region: 'ionia' })));
    expect(t.row()?.pending).toEqual({ id: 'region', blue: 'ionia', red: 'noxus' });
    expect(body.notice).toBe('Next game: Ionia vs Noxus.');
  });

  it("409 with M20.1's words: same region, a region under 8 open, no region wars pending", async () => {
    const pending = { id: 'region', blue: 'zaun', red: 'noxus' } as const;
    const cases: [ModeRow, Record<string, unknown>, string][] = [
      [card({ pending }), { side: 'blue', region: 'noxus' }, 'Pick two different regions.'],
      [
        card({ pending }),
        { side: 'red', region: 'targon' },
        'That region has too few champions open tonight.',
      ],
      [card(), { redraw: true }, 'Region wars is not on for that game.'],
    ];
    for (const [row, body, words] of cases) {
      const { t, mode } = setup(row);
      expect(await answer(await mode(json({ groupId: GROUP, ...body })))).toEqual({
        status: 409,
        body: { ok: false, error: words },
      });
      expect(t.writes).toEqual([]);
    }
  });

  it('M20.17: a next-game region tap that lost to Roll says the regions are this game now', async () => {
    const regionLock = (status: string, mode: ModeLock['mode']) => async () => ({
      lobbyId: 'lobby',
      status,
      stored: { lock: { standing: 'fearless', mode, rated: null } as ModeLock, lockedAt: null },
    });
    const region = { id: 'region', blue: 'zaun', red: 'noxus' } as const;
    const rolled = "Teams were just rolled, so those regions are this game's now.";
    const cases: [ModeRouteDeps, Record<string, unknown>, string][] = [
      [{ liveLock: regionLock('balanced', region) }, { redraw: true, game: 'next' }, rolled],
      [{ liveLock: regionLock('balanced', region) }, { side: 'blue', region: 'ionia' }, rolled],
      // Every other case keeps today's answer.
      [{ liveLock: regionLock('in_game', region) }, { redraw: true }, 'Region wars is not on for that game.'],
      [
        { liveLock: regionLock('balanced', { id: 'fearless' }) },
        { redraw: true },
        'Region wars is not on for that game.',
      ],
      [{ liveLock: async () => null }, { redraw: true }, 'Region wars is not on for that game.'],
    ];
    for (const [deps, body, words] of cases) {
      const { t, mode } = setup(card(), deps);
      expect(await answer(await mode(json({ groupId: GROUP, ...body })))).toEqual({
        status: 409,
        body: { ok: false, error: words },
      });
      expect(t.writes).toEqual([]);
    }
    // A form post goes back with the same words.
    const { mode } = setup(card(), { liveLock: regionLock('balanced', region) });
    const response = await mode(
      form({ groupId: GROUP, redraw: 'true', game: 'next', redirectTo: '/g/crew' }),
    );
    expect(noticeOf(response).get('error')).toBe(rolled);
  });

  it('a Fearless night counts the bans: a region the pool emptied is short', async () => {
    const bans = Array.from({ length: 5 }, (_, i) => i + 1); // five Ionia champions banned
    const { mode } = setup(card({ pending: { id: 'region', blue: 'zaun', red: 'noxus' } }), {
      context: contextOf(() => 0, bans),
    });
    expect((await mode(json({ groupId: GROUP, side: 'blue', region: 'ionia' }))).status).toBe(409);
  });
});

describe('POST /api/admin/mode: a rule with too few champions open (QA fix 2026-10-04)', () => {
  it('409 with the sentence, nothing written; a playable rule still queues', async () => {
    const { t, mode } = setup(card({ standing: 'normal' }));
    expect(await answer(await mode(json({ groupId: GROUP, mode: 'class:Tank' })))).toEqual({
      status: 409,
      body: { ok: false, error: 'That rule has too few champions open tonight.' },
    });
    expect(t.writes).toEqual([]);
    expect((await mode(json({ groupId: GROUP, mode: 'class:Mage' }))).status).toBe(200);
  });

  it('a no-JS pick goes back with the sentence as the error', async () => {
    const { t, mode } = setup(card({ standing: 'normal' }));
    const response = await mode(form({ groupId: GROUP, mode: 'class:Tank', redirectTo: '/g/crew' }));
    expect(response.status).toBe(303);
    expect(noticeOf(response).get('error')).toBe('That rule has too few champions open tonight.');
    expect(t.writes).toEqual([]);
  });

  it('the rule already pending stays pickable', async () => {
    const { mode } = setup(card({ pending: { id: 'class', tag: 'Tank' } }));
    expect((await mode(json({ groupId: GROUP, mode: 'class:Tank' }))).status).toBe(200);
  });
});

describe('Spin: POST /api/admin/mode { spin: true } (the spin route merged in, M20.7)', () => {
  it('writes the server pick and answers it', async () => {
    const { t, mode } = setup(card(), { context: contextOf(() => 0.1) });
    const { status, body } = await answer(await mode(json({ groupId: GROUP, spin: true })));
    expect(status).toBe(200);
    expect(body.spun).toMatch(/^(class:Mage|region|mirror)$/);
    expect(t.writes).toHaveLength(1);
  });

  it('landing on region wars writes its pair in the same update (seeded) and names it', async () => {
    for (const r of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.99]) {
      const { t, mode } = setup(card(), { context: contextOf(() => r) });
      const { body } = await answer(await mode(json({ groupId: GROUP, spin: true })));
      if (body.spun !== 'region') continue;
      expect(t.writes).toHaveLength(1);
      const pending = t.row()?.pending;
      expect(pending?.id === 'region' && pending.blue !== pending.red).toBe(true);
      expect(body.notice).toMatch(/^Spin says: Region wars\. Blue: \w+ · Red: \w+\.$/);
    }
  });

  it('a no-JS Spin is a form post that comes back with the result', async () => {
    const { mode } = setup(card(), { spinFacts: async () => ({ previous: null, lobbyOpen: true }) });
    const response = await mode(form({ groupId: GROUP, spin: 'true', redirectTo: '/g/crew' }));
    expect(response.status).toBe(303);
    expect(noticeOf(response).get('notice')).toMatch(/^Spin says: /);
  });

  it('never mirror while a lobby is open, never the previous rule', async () => {
    for (const r of [0, 0.2, 0.5, 0.7, 0.99]) {
      const { mode } = setup(card({ standing: 'normal' }), {
        context: contextOf(() => r),
        spinFacts: async () => ({ previous: { id: 'class', tag: 'Mage' }, lobbyOpen: true }),
      });
      const { status, body } = await answer(await mode(json({ groupId: GROUP, spin: true })));
      expect(status).toBe(200);
      expect(body.spun).toBe('region');
    }
  });

  it('409 when nothing is left to draw, and nothing written', async () => {
    const { t, mode } = setup(card(), {
      spinFacts: async () => ({ previous: { id: 'region', blue: 'ionia', red: 'noxus' }, lobbyOpen: true }),
      context: async () => ({ roster: new Map(), regions: REGIONS, fearlessPool: [], rng: () => 0 }),
    });
    expect((await mode(json({ groupId: GROUP, spin: true }))).status).toBe(409);
    expect(t.writes).toEqual([]);
  });
});

describe('two admins: last write wins, an action never overwrites fields it does not set (M20 D7)', () => {
  it('a Rated flip landing between a pick and its write keeps both', async () => {
    const { t, mode } = setup(card());
    t.beforeNextWrite(() => t.set(card({ rated: false })));
    await mode(json({ groupId: GROUP, mode: 'mirror' }));
    // The pick resets Rated (its own field): the later write wins on the field both touched.
    expect(t.row()).toEqual(card({ pending: { id: 'mirror' }, rated: null }));

    const two = setup(card());
    two.t.beforeNextWrite(() => two.t.set(card({ pending: { id: 'class', tag: 'Mage' } })));
    await two.mode(json({ groupId: GROUP, rated: true }));
    // A Rated flip never touches the rule another admin set meanwhile.
    expect(two.t.row()).toEqual(card({ pending: { id: 'class', tag: 'Mage' }, rated: true }));
  });
});

describe('the live signal (M19.9)', () => {
  it('a card write bumps `mode` once, after the write', async () => {
    const { mode } = setup();
    expect((await mode(json({ groupId: GROUP, mode: 'normal' }))).status).toBe(200);
    expect(bumps).toEqual([{ name: 'bump_group_live', group: GROUP, kind: 'mode', writesBefore: 1 }]);
  });

  it('Rated, Spin and a region action bump the same way', async () => {
    const rated = setup();
    expect((await rated.mode(json({ groupId: GROUP, rated: false }))).status).toBe(200);
    expect(bumps).toEqual([{ name: 'bump_group_live', group: GROUP, kind: 'mode', writesBefore: 1 }]);

    const spun = setup();
    expect((await spun.mode(json({ groupId: GROUP, spin: true }))).status).toBe(200);
    expect(bumps).toEqual([{ name: 'bump_group_live', group: GROUP, kind: 'mode', writesBefore: 1 }]);

    const redrawn = setup(card({ pending: { id: 'region', blue: 'zaun', red: 'noxus' } }));
    expect((await redrawn.mode(json({ groupId: GROUP, redraw: true }))).status).toBe(200);
    expect(bumps).toEqual([{ name: 'bump_group_live', group: GROUP, kind: 'mode', writesBefore: 1 }]);
  });

  it('a pick that changed nothing, a refusal and a 403 bump nothing', async () => {
    const same = setup();
    await same.mode(json({ groupId: GROUP, mode: 'fearless' }));
    expect(bumps).toEqual([]);

    const refused = setup(card({ standing: 'normal' }));
    expect((await refused.mode(json({ groupId: GROUP, mode: 'class:Tank' }))).status).toBe(409);
    expect(bumps).toEqual([]);

    const outsider = setup(card(), {}, notAdmin);
    await outsider.mode(json({ groupId: GROUP, mode: 'normal' }));
    expect(bumps).toEqual([]);
  });
});
