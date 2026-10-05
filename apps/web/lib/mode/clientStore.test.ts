import type { ModeState } from '@customs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFearlessReset,
  applyModeAnswer,
  applyModeRow,
  beginOptimistic,
  confirmedVersion,
  endOptimistic,
  type ModeSlice,
  mergeSlice,
  pendingOfRow,
  poolClearedSince,
  resetModeStoreForTests,
} from './clientStore';
import { parseFearlessRow, parseModeRow } from './liveRowSchemas';
import { stateFromRow } from './state';

/**
 * The client mode store (M19.13 acceptance 2): gated on `group_modes.version`. An older row is
 * ignored, another admin's newer row moves the card, the render's props win again once they are at
 * least as new, a tap in flight sits on top and goes when it answers, and the slice never holds a
 * player id.
 */

const GROUP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const state = (version: number, extra: Partial<ModeState> = {}): ModeState => ({
  standing: 'fearless',
  pending: null,
  ratedOverride: null,
  version,
  ...extra,
});
const server = (version: number, extra: Partial<ModeState> = {}): ModeSlice => ({
  state: state(version, extra),
  updatedAt: '2026-10-04T19:00:00.000Z',
  resetAt: '2026-10-01T16:00:00.000Z',
});

afterEach(() => {
  resetModeStoreForTests();
});

describe('version gating', () => {
  it('a newer row moves the card; an older one is ignored; an equal one is taken', () => {
    expect(applyModeRow(GROUP, { state: state(5, { standing: 'normal' }), updatedAt: 'a' })).toBe(true);
    expect(confirmedVersion(GROUP)).toBe(5);
    // A late echo of an earlier write.
    expect(applyModeRow(GROUP, { state: state(4), updatedAt: 'b' })).toBe(false);
    expect(confirmedVersion(GROUP)).toBe(5);
    // The same version again (the row after the route's answer): taken, it is the same state.
    expect(applyModeRow(GROUP, { state: state(5, { standing: 'normal' }), updatedAt: 'c' })).toBe(true);
    // Another admin's newer write.
    expect(applyModeRow(GROUP, { state: state(6, { ratedOverride: false }), updatedAt: 'd' })).toBe(true);
    expect(confirmedVersion(GROUP)).toBe(6);
  });

  it("a route answer is taken only when newer; one group's rows never touch another's", () => {
    expect(applyModeAnswer(GROUP, { standing: 'normal', rule: null, ratedOverride: null, version: 5 })).toBe(
      true,
    );
    expect(applyModeAnswer(GROUP, { standing: 'normal', rule: null, ratedOverride: null, version: 5 })).toBe(
      false,
    );
    expect(confirmedVersion(OTHER)).toBeNull();
  });

  it("the Fearless pool's reset time only moves forward", () => {
    expect(applyFearlessReset(GROUP, '2026-10-04T20:00:00.000Z')).toBe(true);
    expect(applyFearlessReset(GROUP, '2026-10-04T19:00:00.000Z')).toBe(false);
    expect(applyFearlessReset(GROUP, 'not a date')).toBe(false);
  });
});

describe('the merge with the render', () => {
  it('the store wins while newer than the render; the render wins again once it catches up', () => {
    const entries = new Map([
      [
        GROUP,
        {
          confirmed: { state: state(6, { standing: 'normal' }), updatedAt: 'x' },
          resetAt: null,
          optimistic: null,
        },
      ],
    ]);
    expect(mergeSlice(server(5), GROUP, entries).state.standing).toBe('normal');
    expect(mergeSlice(server(6), GROUP, entries).state).toEqual(server(6).state);
    expect(mergeSlice(server(7, { standing: 'fearless' }), GROUP, entries).state.version).toBe(7);
    expect(mergeSlice(server(5), OTHER, entries).state).toEqual(server(5).state);
  });

  it("a tap in flight sits on top with core's own transition, and is left out for the announcer", () => {
    const entries = new Map([
      [
        GROUP,
        {
          confirmed: null,
          resetAt: null,
          optimistic: { action: { kind: 'choice' as const, choice: 'class:Tank' }, token: 1 },
        },
      ],
    ]);
    const shown = mergeSlice(server(5), GROUP, entries);
    expect(shown.state.pending).toEqual({ id: 'class', tag: 'Tank' });
    expect(shown.state.version).toBe(6);
    expect(shown.confirmedVersion).toBe(5);
    expect(mergeSlice(server(5), GROUP, entries, false).state.pending).toBeNull();
    const rated = new Map([
      [
        GROUP,
        {
          confirmed: null,
          resetAt: null,
          optimistic: { action: { kind: 'rated' as const, rated: false }, token: 1 },
        },
      ],
    ]);
    expect(mergeSlice(server(5), GROUP, rated).state.ratedOverride).toBe(false);
  });

  it('a reset heard after the render clears the pool; the render that shows it does not', () => {
    const entries = new Map([
      [GROUP, { confirmed: null, resetAt: '2026-10-04T20:00:00.000Z', optimistic: null }],
    ]);
    const later = mergeSlice(server(5), GROUP, entries);
    expect(poolClearedSince(server(5), later)).toBe(true);
    const caughtUp = { ...server(5), resetAt: '2026-10-04T20:00:00.000Z' };
    expect(poolClearedSince(caughtUp, mergeSlice(caughtUp, GROUP, entries))).toBe(false);
  });

  it('beginOptimistic / endOptimistic: only the tap that began it ends it', () => {
    const first = beginOptimistic(GROUP, { kind: 'rated', rated: false });
    const second = beginOptimistic(GROUP, { kind: 'rated', rated: true });
    endOptimistic(GROUP, first);
    endOptimistic(GROUP, second);
    expect(confirmedVersion(GROUP)).toBeNull();
  });
});

describe('the rows as the store takes them', () => {
  it("reads a row's rule exactly as the server's `stateFromRow` does", () => {
    for (const [rule, tag] of [
      [null, null],
      ['region', null],
      ['mirror', null],
      ['class', 'Tank'],
      ['class', 'Fighter'],
      ['class', null],
      ['aram', null],
    ] as const) {
      // M20.7: region wars is never on the row without its pair.
      const row = {
        mode: 'fearless',
        pending_rule: rule,
        pending_class_tag: tag,
        pending_region_blue: rule === 'region' ? 'zaun' : null,
        pending_region_red: rule === 'region' ? 'noxus' : null,
        rated_override: null,
        updated_at: '2026-10-05T18:00:00.000Z',
      };
      expect(pendingOfRow(rule, tag)).toEqual(stateFromRow(row).pending);
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
        // M20.7: no version column; the store orders by `updated_at`.
        state: {
          standing: 'normal',
          pending: { id: 'class', tag: 'Mage' },
          ratedOverride: true,
          version: Date.parse('2026-10-04T20:00:00.000+00:00'),
        },
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

  it('drops a malformed row (a mode this build does not know, no version)', () => {
    expect(parseModeRow({ group_id: GROUP, mode: 'aram', version: 1 })).toBeNull();
    expect(parseFearlessRow({ group_id: GROUP, reset_at: 'yesterday' })).toBeNull();
  });
});
