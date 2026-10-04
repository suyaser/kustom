import type { ModeState, RuleOption } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { memoryModeStore } from '../testing/modeStore';
import { nextGameOf, writeModeCard } from './set';

const GROUP = '00000000-0000-0000-0000-0000000000aa';
const ADMIN = '00000000-0000-0000-0000-0000000000bb';
const TANKS: RuleOption = { id: 'class', tag: 'Tank' };
const MAGES: RuleOption = { id: 'class', tag: 'Mage' };

const state = (over: Partial<ModeState> = {}): ModeState => ({
  standing: 'fearless',
  pending: null,
  ratedOverride: null,
  version: 3,
  ...over,
});

describe('writeModeCard: the standing mode (M14.29)', () => {
  it('switches fearless to normal and moves the version', async () => {
    const t = memoryModeStore(state());
    const result = await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'standing', standing: 'normal' },
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(t.row()).toEqual(state({ standing: 'normal', version: 4 }));
    expect(t.writes[0]?.writer).toEqual({ playerId: ADMIN, setsRule: false });
  });

  it('a repeat of the standing mode with nothing pending writes nothing', async () => {
    const t = memoryModeStore(state());
    const result = await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'standing', standing: 'fearless' },
    });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(t.writes).toEqual([]);
  });

  it('picking the standing mode with a rule pending clears the rule and the switch (R1)', async () => {
    const t = memoryModeStore(state({ pending: TANKS, ratedOverride: true }));
    await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'standing', standing: 'fearless' },
    });
    expect(t.row()).toEqual(state({ version: 4 }));
  });

  it('a group with no row reads as normal: writing normal changes nothing, fearless inserts', async () => {
    const quiet = memoryModeStore(null);
    expect(
      await writeModeCard(quiet.store, {
        groupId: GROUP,
        playerId: ADMIN,
        action: { kind: 'standing', standing: 'normal' },
      }),
    ).toMatchObject({ ok: true, changed: false });
    expect(quiet.writes).toEqual([]);

    const loud = memoryModeStore(null);
    await writeModeCard(loud.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'standing', standing: 'fearless' },
    });
    expect(loud.row()).toEqual({ standing: 'fearless', pending: null, ratedOverride: null, version: 1 });
  });
});

describe('writeModeCard: a rule, the Rated switch, Spin (M15.3)', () => {
  it('a rule keeps the standing mode, resets the switch and names the setter', async () => {
    const t = memoryModeStore(state({ ratedOverride: false }));
    const result = await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'rule', rule: TANKS },
    });
    expect(result).toMatchObject({ ok: true, changed: true, spun: null });
    expect(t.row()).toEqual(state({ pending: TANKS, version: 4 }));
    expect(t.writes[0]?.writer.setsRule).toBe(true);
  });

  it('re-queuing the same rule still moves the version (it must survive the running game)', async () => {
    const t = memoryModeStore(state({ pending: TANKS }));
    await writeModeCard(t.store, { groupId: GROUP, playerId: ADMIN, action: { kind: 'rule', rule: TANKS } });
    expect(t.row()?.version).toBe(4);
  });

  it('the Rated switch works either way in any mode, and always moves the version', async () => {
    const t = memoryModeStore(state());
    await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'rated', rated: false },
    });
    expect(t.row()).toEqual(state({ ratedOverride: false, version: 4 }));
    await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'rated', rated: false },
    });
    expect(t.row()?.version).toBe(5);
  });

  it('Spin writes the drawn rule as the pending rule', async () => {
    const t = memoryModeStore(state());
    const result = await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'spin', draw: async () => MAGES },
    });
    expect(result).toMatchObject({ ok: true, changed: true, spun: MAGES });
    expect(t.row()?.pending).toEqual(MAGES);
  });

  it('Spin with nothing to draw writes nothing', async () => {
    const t = memoryModeStore(state());
    const result = await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'spin', draw: async () => null },
    });
    expect(result).toMatchObject({ ok: false, reason: 'nothing-to-spin' });
    expect(t.writes).toEqual([]);
  });

  it('a rule the check refuses writes nothing (too-few-open); the pending rule is never re-checked', async () => {
    const t = memoryModeStore(state({ pending: MAGES }));
    const checked: RuleOption[] = [];
    const playable = async (_state: ModeState, rule: RuleOption) => {
      checked.push(rule);
      return false;
    };
    const refused = await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'rule', rule: TANKS, playable },
    });
    expect(refused).toMatchObject({ ok: false, reason: 'too-few-open' });
    expect(t.writes).toEqual([]);
    const again = await writeModeCard(t.store, {
      groupId: GROUP,
      playerId: ADMIN,
      action: { kind: 'rule', rule: MAGES, playable },
    });
    expect(again).toMatchObject({ ok: true, changed: true });
    expect(checked).toEqual([TANKS]);
  });
});

describe('writeModeCard: two admins at once', () => {
  it('a write that loses the compare-and-set re-reads and applies on top: last write wins', async () => {
    const t = memoryModeStore(state());
    // Another admin flips Rated between this write's read and its write.
    t.beforeNextWrite(() => t.set(state({ ratedOverride: false, version: 4 })));
    await writeModeCard(t.store, { groupId: GROUP, playerId: ADMIN, action: { kind: 'rule', rule: TANKS } });
    // The rule landed on the other admin's state (version 4 -> 5); chooseRule resets the switch.
    expect(t.row()).toEqual(state({ pending: TANKS, version: 5 }));
  });
});

describe('nextGameOf', () => {
  it("is core's nextGame with the standing mode, the rule as the select's string and the token", () => {
    expect(nextGameOf(state({ pending: TANKS }))).toEqual({
      standing: 'fearless',
      rule: 'class:Tank',
      rated: false,
      ratedOverride: null,
      version: 3,
    });
    expect(nextGameOf(state({ ratedOverride: false }))).toMatchObject({ rule: null, rated: false });
    expect(nextGameOf(state({ pending: { id: 'mirror' } }))).toMatchObject({ rule: 'mirror', rated: true });
  });
});
