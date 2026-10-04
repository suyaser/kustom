import { describe, expect, it } from 'vitest';
import { windowRange } from '../night';
import { WINDOW_LABELS, windowLabel } from './copy';
import { epochRange, windowRangeLabel, windowRangeLabelSince } from './window';

/**
 * The board after a `Reset ratings` (M14.18, STRATEGY 3.6): `All time`'s chip reads `Since <day>`
 * and the two weeks never change. (The month that contained the reset read from it until M14.48
 * dropped the month windows.)
 */
const ZONE = 'UTC';
const NOW = new Date('2026-11-20T12:00:00.000Z');
const RESET = new Date('2026-11-05T18:30:00.000Z');

describe('windowLabel', () => {
  it('is the plain label for a group that never reset', () => {
    expect(windowLabel('all-time', null)).toBe('All time');
    expect(windowLabel('last-week', null)).toBe(WINDOW_LABELS['last-week']);
  });

  it('turns only All time into Since <day> after a reset', () => {
    expect(windowLabel('all-time', '5 Nov')).toBe('Since 5 Nov');
    expect(windowLabel('this-week', '5 Nov')).toBe('This week');
    expect(windowLabel('last-week', '5 Nov')).toBe('Last week');
  });
});

describe('epochRange', () => {
  it('starts All time at the reset', () => {
    expect(epochRange('all-time', windowRange('all-time', NOW, ZONE), RESET)).toEqual({
      start: RESET,
      end: null,
    });
  });

  it('leaves the weeks alone, and every window of a group that never reset', () => {
    const week = windowRange('last-week', NOW, ZONE);
    expect(epochRange('last-week', week, RESET)).toEqual(week);
    const running = windowRange('this-week', NOW, ZONE);
    expect(epochRange('this-week', running, RESET)).toEqual(running);
    expect(epochRange('all-time', windowRange('all-time', NOW, ZONE), null)).toEqual({
      start: null,
      end: null,
    });
  });
});

describe('windowRangeLabelSince', () => {
  it('has no range half on All time after a reset (the chip carries the date)', () => {
    expect(
      windowRangeLabelSince('all-time', windowRange('all-time', NOW, ZONE), RESET, RESET, ZONE),
    ).toBeNull();
  });

  it('is windowRangeLabel unchanged for a week and for a group that never reset', () => {
    const week = windowRange('this-week', NOW, ZONE);
    expect(windowRangeLabelSince('this-week', week, null, RESET, ZONE)).toBe(
      windowRangeLabel('this-week', week, null, ZONE),
    );
    const all = windowRange('all-time', NOW, ZONE);
    const first = new Date('2026-09-08T18:00:00.000Z');
    expect(windowRangeLabelSince('all-time', all, first, null, ZONE)).toBe(
      windowRangeLabel('all-time', all, first, ZONE),
    );
  });
});
