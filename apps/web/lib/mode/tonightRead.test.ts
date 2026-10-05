import { describe, expect, it } from 'vitest';
import { GAME_STAMP_COLUMNS, type GameStampRow, stampFromRow } from './tonightRead';

/** M23.2: Tonight's stamp carries why a game was voided, read in the same select as the rest. */
const row = (over: Partial<GameStampRow> = {}): GameStampRow => ({
  duration_s: 632,
  gameMode: 'CLASSIC',
  rule: null,
  rule_class_tag: null,
  rule_region_blue: null,
  rule_region_red: null,
  rated: false,
  rule_checked: false,
  rule_check: null,
  ...over,
});

describe('stampFromRow', () => {
  it('reads void_reason in the stamp columns, no extra request', () => {
    expect(GAME_STAMP_COLUMNS).toContain('void_reason');
  });

  it('carries the void reason: early-end and admin', () => {
    expect(stampFromRow(row({ void_reason: 'early-end' }), null, {}).voidReason).toBe('early-end');
    expect(stampFromRow(row({ void_reason: 'admin', duration_s: 1_800 }), null, {}).voidReason).toBe('admin');
  });

  it('leaves it out for a game not voided, or a row read before 0052', () => {
    expect(stampFromRow(row({ void_reason: null }), null, {})).not.toHaveProperty('voidReason');
    expect(stampFromRow(row(), null, {})).not.toHaveProperty('voidReason');
  });

  it('an ended-early game is a Rift game past the remake line, played not rated', () => {
    expect(stampFromRow(row({ void_reason: 'early-end' }), null, {})).toMatchObject({
      rift: true,
      rated: false,
    });
  });
});
