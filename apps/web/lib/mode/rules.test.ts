import type { ChampionFacts, ChampionTable, ModeLock, ModeRow } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { championTable, regionIds } from './champions';
import { lockFromRow, modeLockOf, storedLockOf } from './lock';
import { type ModeRecord, recordResultOf, stampColumns } from './record';
import { serverRng } from './rng';
import {
  CLASS_PLURAL,
  nextPairNotice,
  ratedNotice,
  ruleChosenNotice,
  ruleLabel,
  shortPairRedrawnNotice,
  spinNotice,
  standingNotice,
  thisPairNotice,
} from './ruleNotices';
import { missingRow, missingState, rowFromColumns, stateFromRow, storedFromColumns } from './state';

/**
 * The server's mapping around core's one-row mode (M20.7): the card row's columns, the lobby's lock
 * columns, the stamp at record (core's `recordGame`), what a record writes, and the notices. Core's
 * own rules (`transition`, `take`, `handBack`, `recordGame`) are tested in core; these check the
 * mapping and the wiring. The database half (Roll's move, the hand-backs, the races) is
 * `app/api/admin/mode.integration.test.ts`.
 */

const row = (over: Partial<ModeRow> = {}): ModeRow => ({ standing: 'normal', pending: null, rated: null, ...over });

const columns = (over: Partial<Parameters<typeof rowFromColumns>[0]> = {}) => ({
  mode: 'normal',
  pending_rule: null,
  pending_class_tag: null,
  pending_region_blue: null,
  pending_region_red: null,
  rated_override: null,
  updated_at: '2026-10-05T18:00:00.000Z',
  ...over,
});

/** 12 tanks in Ionia (1..12), 12 mages in Noxus (21..32), 12 marksmen in Demacia (41..52), 2 others. */
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

describe('the card row (0047)', () => {
  it('reads every rule, region wars with its pair', () => {
    expect(rowFromColumns(columns({ mode: 'fearless', pending_rule: 'class', pending_class_tag: 'Tank', rated_override: true }))).toEqual({
      standing: 'fearless',
      pending: { id: 'class', tag: 'Tank' },
      rated: true,
    });
    expect(
      rowFromColumns(columns({ pending_rule: 'region', pending_region_blue: 'zaun', pending_region_red: 'noxus' })).pending,
    ).toEqual({ id: 'region', blue: 'zaun', red: 'noxus' });
  });

  it('reads a rule this build does not know, or a region with no pair, as no rule; a missing row as a new group', () => {
    expect(rowFromColumns(columns({ pending_rule: 'bravery' })).pending).toBeNull();
    expect(rowFromColumns(columns({ pending_rule: 'region' })).pending).toBeNull();
    expect(storedFromColumns(null)).toEqual({ row: missingRow(), exists: false, updatedAt: null });
    expect(missingRow()).toEqual({ standing: 'normal', pending: null, rated: null });
  });

  it('(pre-M20.8 adapter) the old card shape: region wars pairless, updated_at as the order', () => {
    const legacy = stateFromRow(
      columns({ pending_rule: 'region', pending_region_blue: 'zaun', pending_region_red: 'noxus', rated_override: false }),
    );
    expect(legacy).toEqual({
      standing: 'normal',
      pending: { id: 'region' },
      ratedOverride: false,
      version: Date.parse('2026-10-05T18:00:00.000Z'),
    });
    expect(missingState()).toEqual({ standing: 'normal', pending: null, ratedOverride: null, version: 0 });
  });
});

describe('the lock columns (0047: keyed on lock_mode, Rated as moved)', () => {
  const lockRow = {
    lock_mode: 'fearless',
    lock_rule: 'region',
    lock_class_tag: null,
    lock_region_blue: 'ionia',
    lock_region_red: 'noxus',
    lock_rated: null,
    locked_at: '2026-10-05T18:00:00.000Z',
  };

  it('reads the lock, a null Rated as the default, and no lock_mode as no lock', () => {
    expect(modeLockOf(lockRow)).toEqual({
      standing: 'fearless',
      mode: { id: 'region', blue: 'ionia', red: 'noxus' },
      rated: null,
    });
    expect(modeLockOf({ ...lockRow, lock_rated: false })?.rated).toBe(false);
    expect(modeLockOf({ ...lockRow, lock_mode: null })).toBeNull();
    expect(modeLockOf({ ...lockRow, lock_region_red: null })).toBeNull();
    expect(modeLockOf({ ...lockRow, lock_rule: null, lock_region_blue: null, lock_region_red: null })).toEqual({
      standing: 'fearless',
      mode: { id: 'fearless' },
      rated: null,
    });
    expect(storedLockOf(lockRow)?.lockedAt).toBe('2026-10-05T18:00:00.000Z');
  });

  it('(pre-M20.8 adapter) the old lock shape: the effective Rated, locked_at as the order', () => {
    expect(lockFromRow(lockRow)).toEqual({
      lock: {
        mode: { id: 'region', blue: 'ionia', red: 'noxus' },
        rated: false,
        version: Date.parse('2026-10-05T18:00:00.000Z'),
      },
    });
    expect(lockFromRow({ ...lockRow, lock_rule: null, lock_region_blue: null, lock_region_red: null })?.lock.rated).toBe(
      true,
    );
  });
});

describe('the stamp at record (core recordGame)', () => {
  const tanksLock: ModeLock = { standing: 'fearless', mode: { id: 'class', tag: 'Tank' }, rated: null };
  const seats = [
    ...[1, 2, 3, 4, 5].map((championId) => ({ side: 100 as const, championId, role: null })),
    ...[6, 7, 8, 21, 91].map((championId) => ({ side: 200 as const, championId, role: null })),
  ];
  const record = (over: Partial<ModeRecord>): ModeRecord => ({
    kind: 'rift',
    lock: tanksLock,
    live: true,
    row: row(),
    ...over,
  });

  it('a Rift rule game takes the lock: standing mode, rule, rated by its default, and the check', () => {
    const stamped = stampColumns({ ...record({}), seats, table: table() });
    expect(stamped).toMatchObject({
      mode: 'fearless',
      rule: 'class',
      rule_class_tag: 'Tank',
      rule_region_blue: null,
      rule_region_red: null,
      rated: false,
      rule_checked: true,
    });
    expect(stamped.rule_check).toEqual({
      kind: 'sides',
      blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
      red: { side: 200, verdict: 'broke', broke: [21], unknown: [91] },
    });
    expect(Object.keys(stamped)).not.toContain('rule_no_draw');
  });

  it('a mid-game choice changes neither the stamp nor anything a Rift record writes (R2, M20 D7)', () => {
    const now = row({ standing: 'normal', pending: { id: 'mirror' }, rated: true });
    expect(stampColumns({ ...record({ row: now }), seats, table: table() })).toMatchObject({
      mode: 'fearless',
      rule: 'class',
      rated: false,
    });
    expect(recordResultOf(record({ row: now })).patch).toEqual({});
  });

  it('a remake or an ARAM keeps the lock stamp, never rated nor checked, and hands the lock back', () => {
    for (const kind of ['remake', 'aram'] as const) {
      const lock = { ...tanksLock, rated: true };
      const stamped = stampColumns({ ...record({ kind, lock }), seats, table: table() });
      expect(stamped).toMatchObject({ rule: 'class', rated: false, rule_checked: false, rule_check: null });
      expect(recordResultOf(record({ kind, lock })).patch).toEqual({ pending: tanksLock.mode, rated: true });
    }
  });

  it('a live game with no lock plays the pending rule and Rated, and uses them up', () => {
    const now = row({ standing: 'fearless', pending: { id: 'class', tag: 'Tank' }, rated: true });
    const result = recordResultOf(record({ lock: null, row: now }));
    expect(result.stamp).toMatchObject({ mode: { id: 'class', tag: 'Tank' }, rated: true, checked: true });
    expect(result.patch).toEqual({ pending: null, rated: null });
  });

  it('a backfill (or a finished or dropped lobby with no lock) takes the standing default and touches nothing', () => {
    const now = row({ standing: 'fearless', pending: { id: 'class', tag: 'Tank' }, rated: false });
    const stamped = stampColumns({ ...record({ lock: null, live: false, row: now }), seats, table: table() });
    expect(stamped).toEqual({
      mode: 'fearless',
      rule: null,
      rule_class_tag: null,
      rule_region_blue: null,
      rule_region_red: null,
      rated: true,
      rule_checked: false,
      rule_check: null,
    });
    expect(recordResultOf(record({ lock: null, live: false, row: now })).patch).toEqual({});
  });

  it('a region wars no-draw lock is the standing mode, rated as the moved switch says (M20 D6 (d))', () => {
    const noDraw: ModeLock = { standing: 'fearless', mode: { id: 'fearless' }, rated: false };
    expect(stampColumns({ ...record({ lock: noDraw }), seats, table: table() })).toMatchObject({
      mode: 'fearless',
      rule: null,
      rated: false,
      rule_checked: false,
    });
  });
});

describe('the champion table and the RNG', () => {
  it('builds core table from the M15.4 tags and the M15.9 regions', () => {
    const roster = championTable();
    expect(roster.size).toBeGreaterThan(150);
    // Bard (432): a Mage with no region; Annie (1): no Universe region, Noxus by home (M20.3);
    // Garen (86): a Demacian tank and fighter.
    expect(roster.get(432)).toEqual({ tags: expect.arrayContaining(['Mage']), region: [] });
    expect(roster.get(1)?.region).toEqual(['noxus']);
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
  it("say the brief's announcer lines and M20.1's region lines", () => {
    expect(ruleChosenNotice({ id: 'class', tag: 'Tank' }, false)).toBe('Next game: Class wars, tanks only. Not rated.');
    expect(ruleChosenNotice({ id: 'mirror' }, true)).toBe('Next game: Mirror match. Rated.');
    expect(ruleChosenNotice({ id: 'region', blue: 'zaun', red: 'noxus' }, false)).toBe(
      'Next game: Region wars. Blue: Zaun · Red: Noxus. Not rated.',
    );
    expect(spinNotice({ id: 'class', tag: 'Marksman' })).toBe('Spin says: Marksmen only.');
    expect(spinNotice({ id: 'region', blue: 'zaun', red: 'noxus' })).toBe(
      'Spin says: Region wars. Blue: Zaun · Red: Noxus.',
    );
    expect(nextPairNotice({ blue: 'shurima', red: 'zaun' })).toBe('Next game: Shurima vs Zaun.');
    expect(thisPairNotice({ blue: 'shurima', red: 'zaun' })).toBe(
      'New regions: Shurima vs Zaun. Picks already made stay, and the check uses the new regions.',
    );
    expect(shortPairRedrawnNotice({ blue: 'targon', red: 'zaun' }, { blue: 'shurima', red: 'zaun' })).toBe(
      'Targon vs Zaun ran short after the bans, so Roll drew Shurima vs Zaun.',
    );
    expect(nextPairNotice({ blue: 'shadow-isles', red: 'bandle-city' })).toBe('Next game: Shadow Isles vs Bandle City.');
    expect(ratedNotice(true)).toBe('Next game is rated.');
    expect(ratedNotice(false)).toBe('Next game is not rated.');
    expect(standingNotice('fearless', true)).toBe('Rule cleared. Back to Fearless.');
    expect(ruleLabel({ id: 'class', tag: 'Support' })).toBe('Supports only');
    expect(Object.keys(CLASS_PLURAL)).toHaveLength(5);
  });
});
