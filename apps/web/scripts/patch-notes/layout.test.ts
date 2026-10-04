import { describe, expect, it } from 'vitest';
import { BODY_H, columnHeight, columnWidth, fitLines, LINE_MIN, lineCount } from './layout.ts';
import { PATCH_NOTES, type PatchNotesSection } from './notes.ts';

describe('patch notes layout', () => {
  it('fits the committed notes at or above the 32 px floor', () => {
    const fit = fitLines(PATCH_NOTES.columns);
    expect(fit.fits).toBe(true);
    expect(fit.size).toBeGreaterThanOrEqual(LINE_MIN);
    const width = columnWidth(PATCH_NOTES.columns.length);
    for (const column of PATCH_NOTES.columns)
      expect(columnHeight(column, fit.size, width)).toBeLessThanOrEqual(BODY_H);
  });

  it('breaks only at plain spaces, never at a no-break space', () => {
    const width = 300;
    expect(lineCount('short', 34, width)).toBe(1);
    expect(lineCount('one two three four five six seven eight nine ten', 34, width)).toBeGreaterThan(1);
    // A run joined by U+00A0 is one word: wider than the column, so it takes one line of its own.
    expect(lineCount('aaaa\u00a0bbbb\u00a0cccc\u00a0dddd\u00a0eeee\u00a0ffff', 34, width)).toBe(1);
  });

  it('says so when even the floor overflows', () => {
    const long: PatchNotesSection = {
      kind: 'new',
      title: 'NEW',
      lines: Array.from(
        { length: 12 },
        () => 'A line long enough to wrap onto a second and a third line here.',
      ),
    };
    expect(fitLines([[long]])).toEqual({ size: LINE_MIN, fits: false });
  });
});
