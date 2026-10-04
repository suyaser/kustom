import { textWidth } from '../../app/_og/fit.ts';
import type { PatchNotesSection } from './notes.ts';

/**
 * The patch notes picture's geometry (1920×1080) and its one sizing rule: every line is set at the
 * largest size from `LINE_MAX` down to `LINE_MIN` at which the fullest column still fits above the
 * notice. Satori has no fit-to-height, so the columns are measured here with the faces' advance
 * widths (`app/_og/fit.ts`), which only ever over-measure.
 *
 * Size floor (05-design 5.16 ruling (g) item 4): the lines are must-read, so never under 32 at 1920
 * (8.7 px in a 520 px phone feed); the notice is 26.
 */

export const PATCH_NOTES_SIZE = { width: 1920, height: 1080 } as const;

export const PAD_X = 72;
export const PAD_Y = 48;
export const COLUMN_GAP = 56;
/** The wordmark row (38) + 16 + the `2.0` line box (144 × 0.9). */
export const HEADER_H = 38 + 16 + Math.ceil(144 * 0.9);
export const HEADER_GAP = 44;
/** The notice's band at the bottom: 26 px text 30 px off the edge, plus air above it. */
export const FOOTER_H = 30 + 34 + 24;

/** A section head: the 58 px title, its 14 px gap and 2 px rule (`SectionHead` in WeekNotes.tsx). */
export const HEAD_H = 58 + 14 + 2;
export const HEAD_GAP = 22;
export const ITEM_GAP = 18;
export const SECTION_GAP = 40;
export const LINE_HEIGHT = 1.25;
/** The square bullet and the indent the line sits at. */
export const BULLET = 10;
export const INDENT = 30;

export const LINE_MAX = 44;
export const LINE_MIN = 32;
export const NOTICE = 26;

export function columnWidth(columns: number): number {
  return Math.floor((PATCH_NOTES_SIZE.width - 2 * PAD_X - (columns - 1) * COLUMN_GAP) / columns);
}

/** The height the columns may fill. */
export const BODY_H = PATCH_NOTES_SIZE.height - PAD_Y - HEADER_H - HEADER_GAP - FOOTER_H;

/**
 * Greedy word wrap, the way Satori breaks a line at its spaces: the number of lines `text` takes. Only
 * a plain space breaks; a no-break space (U+00A0) in `notes.ts` keeps two words together.
 */
export function lineCount(text: string, size: number, width: number): number {
  const space = textWidth(' ', 'text-regular', size);
  let lines = 1;
  let used = 0;
  for (const word of text.split(' ').filter(Boolean)) {
    const w = textWidth(word, 'text-regular', size);
    if (used === 0) used = w;
    else if (used + space + w <= width) used += space + w;
    else {
      lines += 1;
      used = w;
    }
  }
  return lines;
}

/** One column's height at `size`. */
export function columnHeight(sections: readonly PatchNotesSection[], size: number, width: number): number {
  const room = width - INDENT;
  return sections.reduce((sum, section, index) => {
    const items = section.lines.reduce(
      (total, line, i) =>
        total + lineCount(line, size, room) * Math.ceil(size * LINE_HEIGHT) + (i === 0 ? 0 : ITEM_GAP),
      0,
    );
    return sum + (index === 0 ? 0 : SECTION_GAP) + HEAD_H + HEAD_GAP + items;
  }, 0);
}

export interface PatchNotesFit {
  size: number;
  /** `false` when even `LINE_MIN` overflows: too many words for one picture, so cut some. */
  fits: boolean;
}

/** The largest line size at which every column fits `BODY_H`. */
export function fitLines(columns: readonly (readonly PatchNotesSection[])[]): PatchNotesFit {
  const width = columnWidth(columns.length);
  for (let size = LINE_MAX; size >= LINE_MIN; size -= 1) {
    if (columns.every((column) => columnHeight(column, size, width) <= BODY_H)) return { size, fits: true };
  }
  return { size: LINE_MIN, fits: false };
}
