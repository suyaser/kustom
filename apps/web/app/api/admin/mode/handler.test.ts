import type { ModeState } from '@customs/core';
import { setGroupModeResponseSchema } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import type { ServiceClient } from '@/lib/supabase';
import { memoryModeStore } from '@/lib/testing/modeStore';
import { type ModeRouteDeps, setGroupModeRoute, spinModeRoute } from './handler';

/**
 * `POST /api/admin/mode` and `POST /api/admin/mode/spin` (M15.3) with an in-memory card store: the
 * gate, zod on the body, each write, the answers and the form notices. The database half is
 * `mode.integration.test.ts` and `modeOfTheNight.integration.test.ts`.
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

/**
 * A client that answers the slug lookup a form post makes, and nothing for every other read
 * (Spin's previous-rule lookups: no live lobby, no rule game tonight).
 */
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
} as unknown as ServiceClient;

const card = (over: Partial<ModeState> = {}): ModeState => ({
  standing: 'fearless',
  pending: null,
  ratedOverride: null,
  version: 1,
  ...over,
});

function setup(initial: ModeState | null = card(), deps: ModeRouteDeps = {}, auth = admin) {
  const t = memoryModeStore(initial);
  const options = { getClient: () => client, authorize: async () => auth, store: t.store, ...deps };
  return { t, mode: setGroupModeRoute(options), spin: spinModeRoute(options) };
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

describe('POST /api/admin/mode: the gate and the body', () => {
  it('403 for somebody who is not an admin, and nothing written', async () => {
    const { t, mode } = setup(card(), {}, notAdmin);
    expect((await mode(json({ groupId: GROUP, mode: 'class:Tank' }))).status).toBe(403);
    expect(t.writes).toEqual([]);
  });

  it('400 for an unknown choice, for no action, and for two at once', async () => {
    const { t, mode } = setup();
    for (const body of [
      { groupId: GROUP, mode: 'class:Fighter' },
      { groupId: GROUP, mode: 'class' },
      { groupId: GROUP },
      { groupId: GROUP, mode: 'normal', rated: true },
      { groupId: GROUP, rated: 'maybe' },
    ]) {
      expect((await mode(json(body))).status).toBe(400);
    }
    expect(t.writes).toEqual([]);
  });
});

describe('POST /api/admin/mode: the writes', () => {
  it("M14's standing body answers as before, plus the card", async () => {
    const { mode } = setup();
    const { status, body } = await answer(await mode(json({ groupId: GROUP, mode: 'normal' })));
    expect(status).toBe(200);
    expect(setGroupModeResponseSchema.parse(body)).toEqual({
      ok: true,
      mode: 'normal',
      changed: true,
      next: { standing: 'normal', rule: null, rated: true, ratedOverride: null, version: 2 },
    });
  });

  it('a repeat standing pick is changed: false and writes nothing', async () => {
    const { t, mode } = setup();
    const { body } = await answer(await mode(json({ groupId: GROUP, mode: 'fearless' })));
    expect(body).toMatchObject({ changed: false });
    expect(t.writes).toEqual([]);
  });

  it('a rule queues the next game, not rated by default, and names the setter', async () => {
    const { t, mode } = setup();
    const { body } = await answer(await mode(json({ groupId: GROUP, mode: 'class:Tank' })));
    expect(body).toMatchObject({
      mode: 'fearless',
      changed: true,
      next: { standing: 'fearless', rule: 'class:Tank', rated: false, version: 2 },
    });
    expect(t.writes[0]?.writer).toEqual({ playerId: PLAYER, setsRule: true });
  });

  it('the Rated switch, in any mode, from JSON or a form', async () => {
    const { t, mode } = setup();
    const { body } = await answer(await mode(json({ groupId: GROUP, rated: false })));
    expect(body).toMatchObject({ next: { rule: null, rated: false, ratedOverride: false } });
    await mode(form({ groupId: GROUP, rated: 'true' }));
    expect(t.row()).toMatchObject({ ratedOverride: true, version: 3 });
  });

  it('a form post goes back with the announcer line', async () => {
    const { mode } = setup();
    const response = await mode(form({ groupId: GROUP, mode: 'class:Mage', redirectTo: '/g/crew' }));
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/g/crew');
    expect(location.searchParams.get('notice')).toBe('Next game: Class wars, mages only. Not rated.');
  });

  it('picking the standing mode with a rule pending says the rule was cleared', async () => {
    const { mode } = setup(card({ pending: { id: 'region' } }));
    const response = await mode(form({ groupId: GROUP, mode: 'fearless', redirectTo: '/g/crew' }));
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('notice')).toBe(
      'Rule cleared. Back to Fearless.',
    );
  });
});

describe('POST /api/admin/mode: a rule with too few champions open (QA fix 2026-10-04)', () => {
  // Five tanks, thirty mages: Tanks only is under core's minimum, Mages only is not.
  const table = new Map(
    Array.from({ length: 35 }, (_, i) => [
      i + 1,
      { tags: [i < 5 ? ('Tank' as const) : ('Mage' as const)], region: i < 20 ? 'ionia' : 'noxus' },
    ]),
  );

  it('409 with the sentence, nothing written; a playable rule still queues', async () => {
    const { t, mode } = setup(card({ standing: 'normal' }), { table });
    const refused = await answer(await mode(json({ groupId: GROUP, mode: 'class:Tank' })));
    expect(refused).toEqual({
      status: 409,
      body: { ok: false, error: 'That rule has too few champions open tonight.' },
    });
    expect(t.writes).toEqual([]);
    expect((await mode(json({ groupId: GROUP, mode: 'class:Mage' }))).status).toBe(200);
  });

  it('a no-JS pick goes back with the sentence as the error', async () => {
    const { t, mode } = setup(card({ standing: 'normal' }), { table });
    const response = await mode(form({ groupId: GROUP, mode: 'class:Tank', redirectTo: '/g/crew' }));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'That rule has too few champions open tonight.',
    );
    expect(t.writes).toEqual([]);
  });

  it('counts the bans the check is given, and the rule already pending stays pickable', async () => {
    const asked: string[] = [];
    const playable = async (state: ModeState) => {
      asked.push(state.standing);
      return false;
    };
    const { t, mode } = setup(card({ pending: { id: 'class', tag: 'Mage' } }), { playable });
    expect((await mode(json({ groupId: GROUP, mode: 'region' }))).status).toBe(409);
    expect(asked).toEqual(['fearless']);
    expect((await mode(json({ groupId: GROUP, mode: 'class:Mage' }))).status).toBe(200);
    expect(t.writes).toHaveLength(1);
    // Standing picks and the switch are never checked.
    expect((await mode(json({ groupId: GROUP, mode: 'normal' }))).status).toBe(200);
    expect((await mode(json({ groupId: GROUP, rated: false }))).status).toBe(200);
    expect(asked).toEqual(['fearless']);
  });
});

describe('Spin: POST /api/admin/mode { spin: true } and POST /api/admin/mode/spin', () => {
  it('both write the server pick and answer it', async () => {
    const draws: ModeState[] = [];
    const deps: ModeRouteDeps = {
      draw: async (state) => {
        draws.push(state);
        return { id: 'class', tag: 'Assassin' };
      },
    };
    const one = setup(card(), deps);
    const viaMode = await answer(await one.mode(json({ groupId: GROUP, spin: true })));
    expect(viaMode.body).toMatchObject({
      spun: 'class:Assassin',
      next: { rule: 'class:Assassin', rated: false },
    });

    const two = setup(card(), deps);
    const viaSpin = await answer(await two.spin(json({ groupId: GROUP })));
    expect(viaSpin.body).toEqual(viaMode.body);
    expect(draws).toHaveLength(2);
  });

  it('a no-JS Spin is a form post that comes back with the result', async () => {
    const { spin } = setup(card(), { draw: async () => ({ id: 'region' }) });
    const response = await spin(form({ groupId: GROUP, redirectTo: '/g/crew' }));
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('notice')).toBe(
      'Spin says: Region wars.',
    );
  });

  it('409 when nothing is left to draw, and nothing written', async () => {
    const { t, spin } = setup(card(), { draw: async () => null });
    expect((await spin(json({ groupId: GROUP }))).status).toBe(409);
    expect(t.writes).toEqual([]);
  });

  it('the default draw may land on mirror since M17.17 (core SPIN_FAMILIES), whatever the RNG', async () => {
    for (const r of [0, 0.2, 0.5, 0.7, 0.99]) {
      const { spin } = setup(card({ standing: 'normal' }), {
        rng: () => r,
        timeZone: 'Africa/Cairo',
        table: new Map(
          Array.from({ length: 40 }, (_, i) => [
            i + 1,
            { tags: ['Tank', 'Mage'], region: i < 20 ? 'ionia' : 'noxus' },
          ]),
        ),
      });
      // `spinDraw` reads the previous rule from the database: this client answers nothing.
      const { status, body } = await answer(await spin(json({ groupId: GROUP })));
      expect(status).toBe(200);
      expect(body.spun).toMatch(/^(class:|region$|mirror$)/);
    }
  });
});
