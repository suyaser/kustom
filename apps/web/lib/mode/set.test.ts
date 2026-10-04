import type { ModeRow, TransitionContext } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { memoryModeStore } from '../testing/modeStore';
import { nextGameOf, writeModeCard } from './set';
import { columnsOfPatch, patchIsNoop } from './state';

const GROUP = '00000000-0000-0000-0000-0000000000aa';
const ADMIN = '00000000-0000-0000-0000-0000000000bb';

const row = (over: Partial<ModeRow> = {}): ModeRow => ({
  standing: 'fearless',
  pending: null,
  rated: null,
  ...over,
});
const context = async (): Promise<TransitionContext> => ({
  roster: new Map(),
  regions: [],
  fearlessPool: [],
  rng: () => 0,
});

describe('writeModeCard (M20.7): one patch, one write, no compare-and-set', () => {
  it('a standing pick writes exactly its patch and names the admin', async () => {
    const t = memoryModeStore(row({ pending: { id: 'mirror' }, rated: false }));
    const result = await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { type: 'standing', standing: 'normal' },
      context,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(t.writes).toEqual([
      { patch: { standing: 'normal', pending: null, rated: null }, writer: { playerId: ADMIN } },
    ]);
  });

  it('a repeat standing pick with nothing to empty writes nothing', async () => {
    const t = memoryModeStore(row());
    const result = await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { type: 'standing', standing: 'fearless' },
      context,
    });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(t.writes).toEqual([]);
  });

  it('a Rated flip writes even when it repeats (a tap is never dropped against a stale read)', async () => {
    const t = memoryModeStore(row({ rated: false }));
    await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { type: 'rated', rated: false },
      context,
    });
    expect(t.writes.map((w) => w.patch)).toEqual([{ rated: false }]);
  });

  it('a group with no row is written as a new group plus the patch', async () => {
    const t = memoryModeStore(null);
    await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { type: 'rated', rated: false },
      context,
    });
    expect(t.row()).toEqual({ standing: 'normal', pending: null, rated: false });
  });

  it("a write lands on the other admin's row as it is now: only its own fields change", async () => {
    const t = memoryModeStore(row());
    t.beforeNextWrite(() => t.set(row({ pending: { id: 'class', tag: 'Mage' } })));
    await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { type: 'rated', rated: true },
      context,
    });
    expect(t.row()).toEqual(row({ pending: { id: 'class', tag: 'Mage' }, rated: true }));
  });
});

describe('the patch as columns', () => {
  it('names only the fields the patch sets, a region rule with both its regions', () => {
    expect(columnsOfPatch({ rated: false }, { playerId: ADMIN })).toEqual({
      rated_override: false,
      set_by: ADMIN,
    });
    expect(
      columnsOfPatch({ pending: { id: 'region', blue: 'zaun', red: 'noxus' } }, { playerId: ADMIN }),
    ).toEqual({
      pending_rule: 'region',
      pending_class_tag: null,
      pending_region_blue: 'zaun',
      pending_region_red: 'noxus',
      pending_set_by: ADMIN,
      set_by: ADMIN,
    });
    expect(columnsOfPatch({ standing: 'normal', pending: null, rated: null }, {})).toEqual({
      mode: 'normal',
      pending_rule: null,
      pending_class_tag: null,
      pending_region_blue: null,
      pending_region_red: null,
      pending_set_by: null,
      rated_override: null,
    });
  });

  it('a no-op is a patch equal to the row on every field it names', () => {
    expect(patchIsNoop(row(), { standing: 'fearless', pending: null, rated: null })).toBe(true);
    expect(patchIsNoop(row({ rated: false }), { standing: 'fearless', pending: null, rated: null })).toBe(
      false,
    );
    expect(patchIsNoop(row({ pending: { id: 'mirror' } }), { pending: null })).toBe(false);
  });
});

describe('nextGameOf (the pre-M20.8 client answer)', () => {
  it('is the next game with the rule as the select string and updated_at as the order', () => {
    const at = '2026-10-05T18:00:00.000Z';
    expect(
      nextGameOf({ row: row({ pending: { id: 'class', tag: 'Tank' } }), exists: true, updatedAt: at }),
    ).toEqual({
      standing: 'fearless',
      rule: 'class:Tank',
      rated: false,
      ratedOverride: null,
      version: Date.parse(at),
    });
    expect(
      nextGameOf({
        row: row({ pending: { id: 'region', blue: 'zaun', red: 'noxus' } }),
        exists: true,
        updatedAt: at,
      }),
    ).toMatchObject({ rule: 'region', rated: false });
    expect(nextGameOf({ row: row({ rated: false }), exists: false, updatedAt: null })).toMatchObject({
      rule: null,
      rated: false,
      version: 0,
    });
  });
});
