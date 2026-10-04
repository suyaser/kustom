import { describe, expect, it } from 'vitest';
import { firstGameLabel, sinceLabel, windowLabel } from './copy';
import { playerHrefFor } from './hrefs';
import { windowRangeLabelSince } from './window';

const GROUP = { slug: 'customs' };

describe('windows follow you between pages (M14.42, scene-walk gap 13)', () => {
  it("a board row opens the player on the board's window", () => {
    expect(playerHrefFor(GROUP, 'this-week')('puuid-lena')).toBe('/g/customs/p/puuid-lena?window=this-week');
    expect(playerHrefFor(GROUP, 'all-time')('puuid-lena')).toBe('/g/customs/p/puuid-lena?window=all-time');
  });

  it('a link with no window is the bare player page', () => {
    expect(playerHrefFor(GROUP)('puuid-lena')).toBe('/g/customs/p/puuid-lena');
  });

  it('says Since only after a reset, and first game before one', () => {
    const first = new Date('2026-10-03T18:00:00Z');
    const range = { start: null, end: null };
    expect(windowRangeLabelSince('all-time', range, first, null, 'Africa/Cairo')).toBe(
      firstGameLabel('3 Oct 2026'),
    );
    expect(windowLabel('all-time', null)).toBe('All time');
    // After a reset the chip carries the date and the range half is gone.
    expect(windowLabel('all-time', '1 Nov')).toBe(sinceLabel('1 Nov'));
    expect(
      windowRangeLabelSince('all-time', range, first, new Date('2026-11-01T03:00:00Z'), 'Africa/Cairo'),
    ).toBeNull();
  });
});
