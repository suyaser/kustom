import { balance, type ScoreParts } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { storedScoreParts } from './scoreParts';

/** `splits.score_parts` (M18.13, 0045) as the receipt reads it back. */
describe('storedScoreParts', () => {
  const parts: ScoreParts = { gap: 12.5, offRole: 240, repeat: 200, variety: 50, repeatedPairs: 2 };

  it('reads what the roll path stores, through JSON as the jsonb column returns it', () => {
    expect(storedScoreParts(JSON.parse(JSON.stringify(parts)))).toEqual(parts);
  });

  it("reads every split core's balance returns", () => {
    const players = Array.from({ length: 10 }, (_, i) => ({
      puuid: `p${i}`,
      name: `P${i}`,
      r: 1150 + i * 20,
      n: 12,
      mainRole: null,
      secondaryRole: null,
    }));
    for (const split of balance({ players, recentTeammates: [['p0', 'p1']] }).splits) {
      expect(storedScoreParts(JSON.parse(JSON.stringify(split.scoreParts)))).toEqual(split.scoreParts);
    }
  });

  it('is null for a row from before 0045 and for anything malformed', () => {
    expect(storedScoreParts(null)).toBeNull();
    expect(storedScoreParts(undefined)).toBeNull();
    expect(storedScoreParts({ ...parts, gap: '12' })).toBeNull();
    expect(storedScoreParts({ ...parts, repeatedPairs: 1.5 })).toBeNull();
    expect(storedScoreParts({ ...parts, variety: -1 })).toBeNull();
    const { repeat: _repeat, ...missing } = parts;
    expect(storedScoreParts(missing)).toBeNull();
    expect(storedScoreParts([parts])).toBeNull();
  });

  it('drops keys it does not know', () => {
    expect(storedScoreParts({ ...parts, extra: 1 })).toEqual(parts);
  });
});
