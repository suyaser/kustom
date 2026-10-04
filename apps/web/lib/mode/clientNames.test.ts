import type { RuleCheck } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import { checkKeys, unnamedKeys } from './clientNames';

/** M15.10: which checked champions need the client's name (only those the pinned table lacks). */
describe('checkKeys and unnamedKeys', () => {
  it('collects broke and unknown keys from both sides; only keys off the pinned table are unnamed', () => {
    const check: RuleCheck = {
      kind: 'sides',
      blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
      red: { side: 200, verdict: 'broke', broke: [1], unknown: [9950] },
    };
    expect(checkKeys(check)).toEqual([1, 9950]);
    expect([...unnamedKeys(check)]).toEqual([9950]);
  });

  it('collects both champions of every mirror lane, skipping missing seats', () => {
    const check = {
      kind: 'lanes',
      lanes: [
        { lane: 'top', verdict: 'kept', blue: 86, red: 86 },
        { lane: 'jungle', verdict: 'unknown', blue: null, red: 64 },
        { lane: 'mid', verdict: 'broke', blue: 103, red: 9951 },
        { lane: 'adc', verdict: 'kept', blue: 222, red: 222 },
        { lane: 'support', verdict: 'kept', blue: 89, red: 89 },
      ],
    } as RuleCheck;
    expect(checkKeys(check)).toEqual([86, 86, 64, 103, 9951, 222, 222, 89, 89]);
    expect([...unnamedKeys(check)]).toEqual([9951]);
  });

  it('a check that says nothing names nothing', () => {
    expect(checkKeys({ kind: 'none' } as RuleCheck)).toEqual([]);
  });
});
