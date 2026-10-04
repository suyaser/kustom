import {
  DISPLAY_WIDEST,
  DISPLAY_WIDTHS,
  METRICS_FIRST,
  TEXT_BOLD_WIDEST,
  TEXT_BOLD_WIDTHS,
  TEXT_REGULAR_WIDEST,
  TEXT_REGULAR_WIDTHS,
} from './metrics';

/**
 * Shrink before cutting off (M14.42, scene-walk gap 11; 05-design 6.14's names). Satori has no
 * fit-to-width, so a card measures a name with its face's advance widths (`./metrics`, generated
 * from the TTFs) and picks the largest size that fits. Kerning is ignored, which only ever
 * over-measures, and a glyph outside the table measures at the face's widest, so the answer can
 * be a pixel small but never too big.
 *
 * Layout only: nothing here composes copy.
 */

export type OgFace = 'text-bold' | 'text-regular' | 'display' | 'mono';

const TABLES: Record<OgFace, { widths: readonly number[]; widest: number; upper: boolean }> = {
  'text-bold': { widths: TEXT_BOLD_WIDTHS, widest: TEXT_BOLD_WIDEST, upper: false },
  'text-regular': { widths: TEXT_REGULAR_WIDTHS, widest: TEXT_REGULAR_WIDEST, upper: false },
  // The display cut is always set upper case (`display()` in Cards.tsx).
  display: { widths: DISPLAY_WIDTHS, widest: DISPLAY_WIDEST, upper: true },
  // Martian Mono 85 (500 and 600) is monospaced: every glyph advances 640 per 1000 em (M14.79).
  mono: { widths: [], widest: 640, upper: false },
};

/** Two per cent of slack for rounding in the renderer. */
const SAFETY = 1.02;

/** The width in px of `text` set in `face` at `size`, with `letterSpacing` in em. */
export function textWidth(text: string, face: OgFace, size: number, letterSpacing = 0): number {
  const { widths, widest, upper } = TABLES[face];
  const set = upper ? text.toUpperCase() : text;
  let units = 0;
  let count = 0;
  for (const char of set) {
    const code = char.codePointAt(0) ?? 0;
    const index = code - METRICS_FIRST;
    units += index >= 0 && index < widths.length ? (widths[index] ?? widest) : widest;
    count += 1;
  }
  return ((units / 1000) * size + count * letterSpacing * size) * SAFETY;
}

export interface Fit {
  /** The px size to set the text at. */
  size: number;
  /**
   * `false` when even `min` is too wide: the caller then lets the text wrap rather than cut it
   * off. Only a pathological name (wider than 05-design 6.14's sixteen all-caps characters) does.
   */
  fits: boolean;
}

/** The largest whole px size from `base` down to `min` at which `text` fits in `maxWidth`. */
export function fitSize(
  text: string,
  face: OgFace,
  maxWidth: number,
  base: number,
  min: number,
  letterSpacing = 0,
): Fit {
  for (let size = base; size >= min; size -= 1) {
    if (textWidth(text, face, size, letterSpacing) <= maxWidth) return { size, fits: true };
  }
  return { size: min, fits: false };
}
