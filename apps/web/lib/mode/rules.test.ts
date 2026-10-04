import type { ChampionFacts, ChampionTable, ModeState, Rng } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { memoryModeStore } from '../testing/modeStore';
import { championTable, regionIds } from './champions';
import { type LockInputs, lockFor, lockFromRow, rowFromLock, type StoredLock } from './lock';
import { clearAfterRecord, recordedGame, stampColumns } from './record';
import { serverRng } from './rng';
import {
  CLASS_PLURAL,
  ratedNotice,
  ruleChosenNotice,
  ruleLabel,
  spinNotice,
  standingNotice,
} from './ruleNotices';
import { spinFor } from './spin';
import { missingState, rowFromState, stateFromRow } from './state';

/**
 * M15.3's server helpers around core's mode model: the card row, the lock at Roll, the stamp at
 * record, the compare-and-clear, Spin's inputs and the notices. Core's own rules are tested in
 * core; these check the mapping and the wiring.
 */

const state = (over: Partial<ModeState> = {}): ModeState => ({
  standing: 'normal',
  pending: null,
  ratedOverride: null,
  version: 7,
  ...over,
});

/** 12 tanks in Ionia (1..12), 12 mages in Noxus (21..32), 12 marksmen in Demacia (41..52), 3 others. */
function table(): ChampionTable {
  const rows = new Map<number, ChampionFacts>();
  for (let i = 0; i < 12; i += 1) {
    rows.set(1 + i, { tags: ['Tank'], region: ['ionia'] });
    rows.set(21 + i, { tags: ['Mage'], region: ['noxus'] });
    rows.set(41 + i, { tags: ['Marksman', 'Assassin'], region: ['demacia'] });
  }
  rows.set(90, { tags: ['Support'], region: [] });
  rows.set(91, { tags: null, region: null });
  return rows;
}

/** An RNG that hands back the listed numbers in turn (the last repeats). */
function seq(...values: number[]): Rng {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] as number;
}

const lockInputs = (over: Partial<LockInputs> = {}): LockInputs => ({
  table: table(),
  regions: ['ionia', 'noxus', 'demacia', 'unaffiliated'],
  bans: [],
  rng: seq(0),
  ...over,
});

describe('the card row', () => {
  it('maps both ways', () => {
    const tanks = state({ standing: 'fearless', pending: { id: 'class', tag: 'Tank' }, ratedOverride: true });
    expect(rowFromState(tanks)).toEqual({
      mode: 'fearless',
      pending_rule: 'class',
      pending_class_tag: 'Tank',
      rated_override: true,
      version: 7,
    });
    expect(stateFromRow(rowFromState(tanks))).toEqual(tanks);
    const region = state({ pending: { id: 'region' } });
    expect(stateFromRow(rowFromState(region))).toEqual(region);
  });

  it('reads a rule this build does not know as no rule, and a missing row as a new group', () => {
    expect(
      stateFromRow({
        mode: 'normal',
        pending_rule: 'bravery',
        pending_class_tag: null,
        rated_override: null,
        version: 1,
      }).pending,
    ).toBeNull();
    expect(missingState()).toEqual({ standing: 'normal', pending: null, ratedOverride: null, version: 0 });
  });
});

describe('the lock at Roll', () => {
  it('locks the standing mode with the card rated flag and version (R2)', () => {
    expect(lockFor(state({ standing: 'fearless' }), null, lockInputs())).toEqual({
      standing: 'fearless',
      lock: { mode: { id: 'fearless' }, rated: true, version: 7 },
      noDraw: false,
    });
    expect(lockFor(state({ ratedOverride: false }), null, lockInputs()).lock.rated).toBe(false);
  });

  it('locks a class rule not rated by default, rated when the switch says so', () => {
    const tanks = state({ pending: { id: 'class', tag: 'Tank' } });
    expect(lockFor(tanks, null, lockInputs()).lock).toEqual({
      mode: { id: 'class', tag: 'Tank' },
      rated: false,
      version: 7,
    });
    expect(lockFor({ ...tanks, ratedOverride: true }, null, lockInputs()).lock.rated).toBe(true);
  });

  it('draws two regions for region wars, never unaffiliated nor one under 8 open', () => {
    const regionState = state({ pending: { id: 'region' } });
    const drawn = lockFor(regionState, null, lockInputs({ rng: seq(0, 0) })).lock.mode;
    expect(drawn).toEqual({ id: 'region', blue: 'demacia', red: 'ionia' });
    // Under standing Fearless, five Ionia bans leave Ionia under 8: only Demacia and Noxus remain.
    const fearless = { ...regionState, standing: 'fearless' as const };
    const banned = lockFor(fearless, null, lockInputs({ bans: [1, 2, 3, 4, 5], rng: seq(0.99, 0.99) })).lock
      .mode;
    expect(banned).toEqual({ id: 'region', blue: 'noxus', red: 'demacia' });
    // The bans count only on a Fearless night.
    const normal = lockFor(regionState, null, lockInputs({ bans: [1, 2, 3, 4, 5], rng: seq(0.5, 0) })).lock
      .mode;
    expect(normal).toEqual({ id: 'region', blue: 'ionia', red: 'demacia' });
  });

  it('with no possible region draw, locks the standing mode and keeps the card rated flag', () => {
    const lock = lockFor(state({ pending: { id: 'region' } }), null, lockInputs({ regions: ['ionia'] }));
    expect(lock.lock).toEqual({ mode: { id: 'normal' }, rated: false, version: 7 });
    // M15.17: and it remembers region wars was attempted.
    expect(lock.noDraw).toBe(true);
    // A region wars that was drawn, a class rule and a plain game are not no-draws.
    expect(lockFor(state({ pending: { id: 'region' } }), null, lockInputs()).noDraw).toBe(false);
    expect(lockFor(state({ pending: { id: 'class', tag: 'Tank' } }), null, lockInputs()).noDraw).toBe(false);
    expect(lockFor(state(), null, lockInputs()).noDraw).toBe(false);
  });

  it('keeps an existing copy as it was (a roll repair)', () => {
    const existing: StoredLock = {
      standing: 'normal',
      lock: { mode: { id: 'region', blue: 'ionia', red: 'noxus' }, rated: false, version: 2 },
      noDraw: false,
    };
    expect(lockFor(state({ pending: { id: 'class', tag: 'Mage' } }), existing, lockInputs())).toBe(existing);
  });

  it('maps the lobby columns both ways, and a half lock reads as none', () => {
    const stored: StoredLock = {
      standing: 'fearless',
      lock: { mode: { id: 'region', blue: 'ionia', red: 'noxus' }, rated: false, version: 9 },
      noDraw: false,
    };
    const row = rowFromLock(stored, new Date('2026-10-04T18:00:00.000Z'));
    expect(row).toEqual({
      lock_mode: 'fearless',
      lock_rule: 'region',
      lock_class_tag: null,
      lock_region_blue: 'ionia',
      lock_region_red: 'noxus',
      lock_rated: false,
      lock_version: 9,
      locked_at: '2026-10-04T18:00:00.000Z',
      lock_no_draw: false,
    });
    expect(lockFromRow(row)).toEqual(stored);
    expect(lockFromRow({ ...row, lock_rated: null })).toBeNull();
    expect(lockFromRow({ ...row, lock_region_red: null })).toBeNull();
    expect(
      lockFromRow({ ...row, lock_rule: null, lock_region_blue: null, lock_region_red: null })?.lock.mode,
    ).toEqual({ id: 'fearless' });
    // M15.17: the no-draw flag both ways; a read without the column reads false.
    const noDraw: StoredLock = {
      standing: 'fearless',
      lock: { mode: { id: 'fearless' }, rated: false, version: 3 },
      noDraw: true,
    };
    const noDrawRow = rowFromLock(noDraw, new Date('2026-10-04T18:00:00.000Z'));
    expect(noDrawRow).toMatchObject({ lock_rule: null, lock_no_draw: true });
    expect(lockFromRow(noDrawRow)).toEqual(noDraw);
    const { lock_no_draw: _flag, ...withoutColumn } = noDrawRow;
    expect(lockFromRow(withoutColumn)?.noDraw).toBe(false);
  });
});

describe('the stamp at record', () => {
  const tanksLock: StoredLock = {
    standing: 'fearless',
    lock: { mode: { id: 'class', tag: 'Tank' }, rated: false, version: 5 },
    noDraw: false,
  };
  const seats = [
    ...[1, 2, 3, 4, 5].map((championId) => ({ side: 100 as const, championId, role: null })),
    ...[6, 7, 8, 21, 91].map((championId) => ({ side: 200 as const, championId, role: null })),
  ];

  it('a rolled Rift rule game takes the lock: standing mode, rule, rated, and the check', () => {
    const columns = stampColumns({ kind: 'rift', lock: tanksLock, state: state(), seats, table: table() });
    expect(columns).toMatchObject({
      mode: 'fearless',
      rule: 'class',
      rule_class_tag: 'Tank',
      rule_region_blue: null,
      rule_region_red: null,
      rated: false,
      rule_checked: true,
    });
    expect(columns.rule_check).toEqual({
      kind: 'sides',
      blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
      red: { side: 200, verdict: 'broke', broke: [21], unknown: [91] },
    });
  });

  it('a mid-game switch does not change the stamp: the card now is ignored when there is a lock (R2)', () => {
    const now = state({ standing: 'normal', pending: { id: 'mirror' }, ratedOverride: true, version: 99 });
    const columns = stampColumns({ kind: 'rift', lock: tanksLock, state: now, seats, table: table() });
    expect(columns).toMatchObject({ mode: 'fearless', rule: 'class', rated: false });
  });

  it('a remake or an ARAM keeps the lock stamp but is never rated nor checked', () => {
    for (const kind of ['remake', 'aram'] as const) {
      const columns = stampColumns({
        kind,
        lock: { ...tanksLock, lock: { ...tanksLock.lock, rated: true } },
        state: state(),
        seats,
        table: table(),
      });
      expect(columns).toMatchObject({ rule: 'class', rated: false, rule_checked: false, rule_check: null });
    }
  });

  it('a game with no lock takes the standing mode at its default and no rule', () => {
    const columns = stampColumns({
      kind: 'rift',
      lock: null,
      state: state({ standing: 'fearless', pending: { id: 'class', tag: 'Tank' }, ratedOverride: false }),
      seats,
      table: table(),
    });
    expect(columns).toEqual({
      mode: 'fearless',
      rule: null,
      rule_class_tag: null,
      rule_region_blue: null,
      rule_region_red: null,
      rated: true,
      rule_checked: false,
      rule_check: null,
      rule_no_draw: false,
    });
  });

  it('a no-draw lock stamps the standing mode, not rated, with rule_no_draw (M15.17)', () => {
    const noDraw: StoredLock = {
      standing: 'fearless',
      lock: { mode: { id: 'fearless' }, rated: false, version: 4 },
      noDraw: true,
    };
    expect(stampColumns({ kind: 'rift', lock: noDraw, state: state(), seats, table: table() })).toMatchObject(
      {
        mode: 'fearless',
        rule: null,
        rated: false,
        rule_checked: false,
        rule_no_draw: true,
      },
    );
    expect(
      stampColumns({ kind: 'rift', lock: tanksLock, state: state(), seats, table: table() }).rule_no_draw,
    ).toBe(false);
  });
});

describe('the compare-and-clear after record', () => {
  const lock: StoredLock = {
    standing: 'normal',
    lock: { mode: { id: 'class', tag: 'Tank' }, rated: false, version: 7 },
    noDraw: false,
  };

  it('clears the rule and the switch when nothing moved since Roll', async () => {
    const t = memoryModeStore(state({ pending: { id: 'class', tag: 'Tank' }, ratedOverride: false }));
    expect(await clearAfterRecord(t.store, 'g', recordedGame('rift', lock))).toBe(true);
    expect(t.row()).toEqual(state({ version: 8 }));
    // The server's write keeps the last admin's set_by.
    expect(t.writes[0]?.writer).toEqual({});
  });

  it('keeps a rule queued mid-game (the version moved)', async () => {
    const t = memoryModeStore(state({ pending: { id: 'class', tag: 'Mage' }, version: 8 }));
    expect(await clearAfterRecord(t.store, 'g', recordedGame('rift', lock))).toBe(false);
    expect(t.row()?.pending).toEqual({ id: 'class', tag: 'Mage' });
  });

  it('a remake, an ARAM or a game with no lock leaves the rule pending', async () => {
    for (const game of [
      recordedGame('remake', lock),
      recordedGame('aram', lock),
      recordedGame('rift', null),
    ]) {
      const t = memoryModeStore(state({ pending: { id: 'class', tag: 'Tank' } }));
      expect(await clearAfterRecord(t.store, 'g', game)).toBe(false);
      expect(t.writes).toEqual([]);
    }
  });

  it('a second post of the same game is a no-op', async () => {
    const t = memoryModeStore(state({ pending: { id: 'class', tag: 'Tank' } }));
    await clearAfterRecord(t.store, 'g', recordedGame('rift', lock));
    expect(await clearAfterRecord(t.store, 'g', recordedGame('rift', lock))).toBe(false);
    expect(t.writes).toHaveLength(1);
  });
});

describe('Spin', () => {
  const inputs = { table: table(), bans: [] as number[], previous: null, rng: seq(0, 0) };

  it('never returns a standing mode, and returns mirror too (M17.17), over every RNG value', () => {
    const seen = new Set<string | undefined>();
    for (let a = 0; a < 1; a += 0.05) {
      for (let b = 0; b < 1; b += 0.1) {
        const rule = spinFor(state(), { ...inputs, rng: seq(a, b) });
        expect(rule).not.toBeNull();
        expect(['class', 'region', 'mirror']).toContain(rule?.id);
        seen.add(rule?.id);
      }
    }
    expect(seen.has('mirror')).toBe(true);
  });

  it('never hands mirror to a lobby that is already open (made as it was, likely Draft Pick)', () => {
    const seen = new Set<string | undefined>();
    for (let a = 0; a < 1; a += 0.05) {
      for (let b = 0; b < 1; b += 0.1) {
        const rule = spinFor(state(), { ...inputs, lobbyOpen: true, rng: seq(a, b) });
        expect(rule?.id).not.toBe('mirror');
        seen.add(rule?.id);
      }
    }
    expect([...seen].sort()).toEqual(['class', 'region']);
    // With nothing else playable, Spin says there is nothing to spin rather than mirror.
    const onlyMirrorLeft = spinFor(state({ standing: 'fearless' }), {
      ...inputs,
      bans: [...Array.from({ length: 60 }, (_, i) => i + 1)],
      lobbyOpen: true,
      rng: seq(0, 0),
    });
    expect(onlyMirrorLeft).toBeNull();
    expect(
      spinFor(state({ standing: 'fearless' }), {
        ...inputs,
        bans: [...Array.from({ length: 60 }, (_, i) => i + 1)],
        lobbyOpen: false,
        rng: seq(0, 0),
      }),
    ).toEqual({ id: 'mirror' });
  });

  it('never returns the previous rule, nor an option too small to play', () => {
    // The table has no Support champion besides one: Supports only is never drawn.
    for (let a = 0; a < 1; a += 0.05) {
      for (let b = 0; b < 1; b += 0.05) {
        const rule = spinFor(state(), {
          ...inputs,
          previous: { id: 'class', tag: 'Tank' },
          rng: seq(a, b),
        });
        expect(rule).not.toEqual({ id: 'class', tag: 'Tank' });
        expect(rule).not.toEqual({ id: 'class', tag: 'Support' });
      }
    }
  });

  it('counts the Fearless bans only on a Fearless night', () => {
    const bans = [1, 2, 3, 21, 22, 23, 41, 42, 43];
    // Under Fearless every class drops to 9 open (under 10), while each region keeps 9 (8 or more).
    const fearless = spinFor(state({ standing: 'fearless' }), { ...inputs, bans, rng: seq(0, 0) });
    expect(fearless).toEqual({ id: 'region' });
    const normal = spinFor(state(), { ...inputs, bans, rng: seq(0, 0) });
    expect(normal?.id).toBe('class');
  });
});

describe('the champion table and the RNG', () => {
  it('builds core table from the M15.4 tags and the M15.9 regions', () => {
    const roster = championTable();
    expect(roster.size).toBeGreaterThan(150);
    // Annie (1): a Mage with no region; Garen (86): a Demacian tank and fighter.
    expect(roster.get(1)).toEqual({ tags: expect.arrayContaining(['Mage']), region: [] });
    expect(roster.get(86)?.region).toEqual(['demacia']);
    expect(regionIds()).toContain('unaffiliated');
  });

  it('the server RNG stays in [0, 1)', () => {
    for (let i = 0; i < 1000; i += 1) {
      const r = serverRng();
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });
});

describe('the notices', () => {
  it("say the brief's announcer lines", () => {
    expect(ruleChosenNotice({ id: 'class', tag: 'Tank' }, false)).toBe(
      'Next game: Class wars, tanks only. Not rated.',
    );
    expect(ruleChosenNotice({ id: 'mirror' }, true)).toBe('Next game: Mirror match. Rated.');
    expect(spinNotice({ id: 'class', tag: 'Marksman' })).toBe('Spin says: Marksmen only.');
    expect(spinNotice({ id: 'region' })).toBe('Spin says: Region wars.');
    expect(ratedNotice(true)).toBe('Next game is rated.');
    expect(ratedNotice(false)).toBe('Next game is not rated.');
    expect(standingNotice('fearless', true)).toBe('Rule cleared. Back to Fearless.');
    expect(ruleLabel({ id: 'class', tag: 'Support' })).toBe('Supports only');
    expect(Object.keys(CLASS_PLURAL)).toHaveLength(5);
  });
});
