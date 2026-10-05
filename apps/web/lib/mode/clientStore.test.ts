import type { ModeRow } from '@customs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFearlessReset,
  applyModeRow,
  beginOptimistic,
  draftRow,
  endOptimistic,
  type ModeSlice,
  mergeSlice,
  modeCardKey,
  modeStoreForTests,
  poolClearedSince,
  resetModeStoreForTests,
} from './clientStore';
import { parseFearlessRow, parseModeRow } from './liveRowSchemas';
import { rowFromColumns } from './state';

/**
 * The client mode store (M19.13 acceptance 2, M20.8): gated on `group_modes.updated_at` (no
 * version since M20.7). An older row is ignored, another admin's newer row moves the card, the
 * render's props win again once they are at least as new, a tap in flight sits on top and goes when
 * it answers, and the slice never holds a player id.
 */

const GROUP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const at = (minute: number) => `2026-10-05T19:${String(minute).padStart(2, '0')}:00.000Z`;
const row = (extra: Partial<ModeRow> = {}): ModeRow => ({
  standing: 'fearless',
  pending: null,
  rated: null,
  ...extra,
});
const server = (minute: number, extra: Partial<ModeRow> = {}): ModeSlice => ({
  row: row(extra),
  updatedAt: at(minute),
  resetAt: '2026-10-01T16:00:00.000Z',
});
type Entries = Parameters<typeof mergeSlice>[2];
const entries = (entry: Record<string, unknown>): Entries =>
  new Map([
    [GROUP, { confirmed: null, resetAt: null, optimistic: null, normalSince: null, ...entry }],
  ]) as unknown as Entries;

afterEach(() => {
  resetModeStoreForTests();
});

describe('updated_at gating', () => {
  it('a newer row moves the card; an older one is ignored; an equal one is taken', () => {
    expect(applyModeRow(GROUP, { row: row({ standing: 'normal' }), updatedAt: at(5) })).toBe(true);
    // A late echo of an earlier write.
    expect(applyModeRow(GROUP, { row: row(), updatedAt: at(4) })).toBe(false);
    // The same row again (the channel's copy of the route's answer): taken, it is the same row.
    expect(applyModeRow(GROUP, { row: row({ standing: 'normal' }), updatedAt: at(5) })).toBe(true);
    // Another admin's newer write.
    expect(applyModeRow(GROUP, { row: row({ rated: false }), updatedAt: at(6) })).toBe(true);
    expect(applyModeRow(GROUP, { row: row(), updatedAt: at(5) })).toBe(false);
  });

  it("one group's rows never touch another's", () => {
    expect(applyModeRow(GROUP, { row: row({ standing: 'normal' }), updatedAt: at(9) })).toBe(true);
    expect(applyModeRow(OTHER, { row: row(), updatedAt: at(1) })).toBe(true);
  });

  it("M22.4: a group_modes row never lands on a forked lobby's card", () => {
    const forked = modeCardKey(GROUP, 'party-b');
    expect(modeCardKey(GROUP)).toBe(GROUP);
    expect(forked).not.toBe(GROUP);
    expect(applyModeRow(forked, { row: row({ rated: false }), updatedAt: at(3) })).toBe(true);
    expect(applyModeRow(GROUP, { row: row({ standing: 'normal' }), updatedAt: at(9) })).toBe(true);
    expect(modeStoreForTests().get(forked)?.confirmed).toEqual({
      row: row({ rated: false }),
      updatedAt: at(3),
    });
  });

  it("the Fearless pool's reset time only moves forward", () => {
    expect(applyFearlessReset(GROUP, '2026-10-04T20:00:00.000Z')).toBe(true);
    expect(applyFearlessReset(GROUP, '2026-10-04T19:00:00.000Z')).toBe(false);
    expect(applyFearlessReset(GROUP, 'not a date')).toBe(false);
  });
});

describe('the merge with the render', () => {
  it('the store wins while newer than the render; the render wins again once it catches up', () => {
    const held = entries({ confirmed: { row: row({ standing: 'normal' }), updatedAt: at(6) } });
    expect(mergeSlice(server(5), GROUP, held).row.standing).toBe('normal');
    expect(mergeSlice(server(6), GROUP, held).row).toEqual(server(6).row);
    expect(mergeSlice(server(7, { rated: false }), GROUP, held).row.rated).toBe(false);
    expect(mergeSlice(server(5), OTHER, held).row).toEqual(server(5).row);
  });

  it('a tap in flight sits on top as a draft, and is left out for the announcer', () => {
    const tap = entries({ optimistic: { action: { kind: 'choice', choice: 'class:Tank' }, token: 1 } });
    expect(mergeSlice(server(5), GROUP, tap).row.pending).toEqual({ id: 'class', tag: 'Tank' });
    expect(mergeSlice(server(5), GROUP, tap).updatedAt).toBe(at(5));
    expect(mergeSlice(server(5), GROUP, tap, false).row.pending).toBeNull();
    const rated = entries({ optimistic: { action: { kind: 'rated', rated: false }, token: 1 } });
    expect(mergeSlice(server(5), GROUP, rated).row.rated).toBe(false);
  });

  it('a reset heard after the render clears the pool; the render that shows it does not', () => {
    const held = entries({ resetAt: '2026-10-04T20:00:00.000Z' });
    const later = mergeSlice(server(5), GROUP, held);
    expect(poolClearedSince(server(5), later)).toBe(true);
    const caughtUp = { ...server(5), resetAt: '2026-10-04T20:00:00.000Z' };
    expect(poolClearedSince(caughtUp, mergeSlice(caughtUp, GROUP, held))).toBe(false);
  });

  it('beginOptimistic / endOptimistic: only the tap that began it ends it', () => {
    const first = beginOptimistic(GROUP, { kind: 'rated', rated: false });
    const second = beginOptimistic(GROUP, { kind: 'rated', rated: true });
    endOptimistic(GROUP, first);
    // The newer tap is still drafted.
    expect(mergeSlice(server(0), GROUP, modeStoreForTests()).row.rated).toBe(true);
    endOptimistic(GROUP, second);
    expect(mergeSlice(server(0), GROUP, modeStoreForTests()).row.rated).toBeNull();
  });
});

describe('the draft of a tap (never a guess the client cannot make)', () => {
  const zaun = { id: 'region', blue: 'zaun', red: 'noxus' } as const;

  it('a standing pick empties the rule and Rated; a rule pick resets Rated; a flip sets it', () => {
    const before = row({ pending: { id: 'class', tag: 'Mage' }, rated: false });
    expect(draftRow(before, { kind: 'choice', choice: 'normal' })).toEqual(row({ standing: 'normal' }));
    expect(draftRow(before, { kind: 'choice', choice: 'mirror' })).toEqual(
      row({ pending: { id: 'mirror' } }),
    );
    expect(draftRow(before, { kind: 'rated', rated: true }).rated).toBe(true);
  });

  it('region wars keeps its pair when already pending, else waits for the answer (the server draws)', () => {
    expect(draftRow(row({ pending: zaun, rated: true }), { kind: 'choice', choice: 'region' })).toEqual(
      row({ pending: zaun }),
    );
    const before = row({ pending: { id: 'mirror' } });
    expect(draftRow(before, { kind: 'choice', choice: 'region' })).toBe(before);
    expect(draftRow(before, { kind: 'choice', choice: 'nonsense' })).toBe(before);
  });
});

describe("the members' Normal note keys on the admin write (M20.8)", () => {
  const since = () => mergeSlice(server(0), GROUP, modeStoreForTests()).normalSince;

  it('records the write that moved Fearless to Normal, and only that one', () => {
    applyModeRow(GROUP, { row: row(), updatedAt: at(1) });
    expect(since()).toBeNull();
    applyModeRow(GROUP, { row: row({ standing: 'normal' }), updatedAt: at(2) });
    expect(since()).toBe(at(2));
    // Roll or a hand-back moves `updated_at` on a Normal row: the note keeps the switch's time.
    applyModeRow(GROUP, { row: row({ standing: 'normal', rated: false }), updatedAt: at(3) });
    expect(since()).toBe(at(2));
    // Back on Fearless: no note.
    applyModeRow(GROUP, { row: row(), updatedAt: at(4) });
    expect(since()).toBeNull();
  });

  it('a page that never saw Fearless has no switch to show', () => {
    applyModeRow(GROUP, { row: row({ standing: 'normal' }), updatedAt: at(2) });
    expect(since()).toBeNull();
  });
});

describe('the rows as the store takes them', () => {
  it("reads a row exactly as the server's `rowFromColumns` does", () => {
    for (const [rule, tag, blue, red] of [
      [null, null, null, null],
      ['region', null, 'zaun', 'noxus'],
      ['region', null, null, null],
      ['mirror', null, null, null],
      ['class', 'Tank', null, null],
      ['class', null, null, null],
    ] as const) {
      const columns = {
        mode: 'fearless',
        pending_rule: rule,
        pending_class_tag: tag,
        pending_region_blue: blue,
        pending_region_red: red,
        rated_override: false,
        updated_at: '2026-10-05T18:00:00.000Z',
      };
      expect(parseModeRow({ group_id: GROUP, ...columns })?.slice.row).toEqual(rowFromColumns(columns));
    }
  });

  it('drops a row whose rule or class this build does not know (the next render reads it)', () => {
    for (const [rule, tag] of [
      ['class', 'Fighter'],
      ['aram', null],
    ] as const) {
      const columns = {
        mode: 'fearless',
        pending_rule: rule,
        pending_class_tag: tag,
        pending_region_blue: null,
        pending_region_red: null,
        rated_override: null,
        updated_at: '2026-10-05T18:00:00.000Z',
      };
      expect(parseModeRow({ group_id: GROUP, ...columns })).toBeNull();
      // The server reads the same row as no rule, never a crash.
      expect(rowFromColumns(columns).pending).toBeNull();
    }
  });

  it('never reads set_by, pending_set_by or reset_by into the slice', () => {
    const parsed = parseModeRow({
      group_id: GROUP,
      mode: 'normal',
      pending_rule: 'class',
      pending_class_tag: 'Mage',
      pending_region_blue: null,
      pending_region_red: null,
      rated_override: true,
      updated_at: '2026-10-04T20:00:00.000+00:00',
      set_by: '33333333-3333-4333-8333-333333333333',
      pending_set_by: '33333333-3333-4333-8333-333333333333',
    });
    expect(parsed).toEqual({
      groupId: GROUP,
      slice: {
        row: { standing: 'normal', pending: { id: 'class', tag: 'Mage' }, rated: true },
        updatedAt: '2026-10-04T20:00:00.000+00:00',
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('33333333');
    const fearless = parseFearlessRow({
      group_id: GROUP,
      id: 1,
      reset_at: '2026-10-04T20:00:00+00:00',
      reset_by: '33333333-3333-4333-8333-333333333333',
      updated_at: '2026-10-04T20:00:00+00:00',
    });
    expect(fearless).toEqual({ groupId: GROUP, resetAt: '2026-10-04T20:00:00+00:00' });
  });

  it('drops a malformed row (a mode this build does not know, no updated_at)', () => {
    expect(parseModeRow({ group_id: GROUP, mode: 'aram', updated_at: at(1) })).toBeNull();
    expect(parseFearlessRow({ group_id: GROUP, reset_at: 'yesterday' })).toBeNull();
  });
});
