import { describe, expect, it } from 'vitest';
import { formatLifeSpan, formatMinutes } from './duration';

describe('formatMinutes', () => {
  it('prints whole minutes, never a clock time', () => {
    expect(formatMinutes(21 * 60 + 46)).toBe('21 min');
    expect(formatMinutes(31 * 60 + 4)).toBe('31 min');
    expect(formatMinutes(30 * 60)).toBe('30 min');
  });

  it('keeps counting past an hour rather than switching to h:mm', () => {
    expect(formatMinutes(64 * 60 + 12)).toBe('64 min');
  });

  it('never says 0 min, and survives a bad stored value', () => {
    expect(formatMinutes(40)).toBe('1 min');
    expect(formatMinutes(0)).toBe('1 min');
    expect(formatMinutes(-5)).toBe('1 min');
    expect(formatMinutes(Number.NaN)).toBe('1 min');
  });

  it('never contains a colon', () => {
    for (const s of [59, 61, 599, 1306, 3599, 3601, 7322]) expect(formatMinutes(s)).not.toContain(':');
  });
});

describe('formatLifeSpan', () => {
  it('is m:ss, and h:mm:ss past the hour (a life span, where seconds matter)', () => {
    expect(formatLifeSpan(2_052)).toBe('34:12');
    expect(formatLifeSpan(59)).toBe('0:59');
    expect(formatLifeSpan(3_723)).toBe('1:02:03');
    expect(formatLifeSpan(0)).toBe('0:00');
  });
});
