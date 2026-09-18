import { describe, expect, it } from 'vitest';
import {
  HEATS_HEADING,
  LANES_HEADING,
  PICK_HEADING,
  TYRANTS_HEADING,
  versusKdaLine,
  versusRoast,
  versusScore,
} from './copy';
import { parsePlayerParam } from './query';

describe('versus copy', () => {
  it('roasts the English titles in Egyptian 3ameya', () => {
    expect(versusRoast(LANES_HEADING)).toBe('حرب اللين');
    expect(versusRoast(TYRANTS_HEADING)).toBe('بيأكل اللين');
    expect(versusRoast(HEATS_HEADING)).toBe('محدش بيكسب');
    expect(versusRoast(PICK_HEADING)).toBe('هات اتنين');
    expect(versusRoast('not a /1v1 title')).toBeNull();
  });

  it('prints a series score with an en dash, and KDA to one decimal', () => {
    expect(versusScore(12, 7)).toBe('12–7');
    expect(versusKdaLine(8.24, 4, 6.05)).toBe('8.2 / 4.0 / 6.1');
  });
});

describe('the two player parameters', () => {
  it('treats absent and empty as nobody picked', () => {
    expect(parsePlayerParam(undefined)).toBeUndefined();
    expect(parsePlayerParam('')).toBeUndefined();
    expect(parsePlayerParam('  ')).toBeUndefined();
  });

  it('keeps a puuid, and refuses a repeated parameter', () => {
    expect(parsePlayerParam('u-omar')).toBe('u-omar');
    expect(parsePlayerParam(['u-omar', 'u-ahmed'])).toBeNull();
    expect(parsePlayerParam('x'.repeat(129))).toBeNull();
  });
});
