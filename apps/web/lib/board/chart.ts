/**
 * The rating history chart's geometry (M3.5, `05-design.md`, "Rating history").
 *
 * Pure arithmetic, no SVG and no React: the page renders one `<path>` and one `<line>` from
 * what this returns, on the server, with no charting library. The rules it encodes, all from
 * the design doc, because none of them is obvious from the picture:
 *
 * - **The plotted series is the printed number**: `round(R)` on All time, week points on a week
 *   (M18.6). The reference line is in the same units (1200, or 0 on a week).
 * - X is the game index, not a date: nights are uneven and a date axis makes a settled player
 *   look erratic.
 * - Y is the series min/max padded by 5%, at least {@link MIN_SPAN} tall, and the seed is always
 *   inside the range even when that widens it. A chart whose reference line is off-screen is a chart with no reference.
 */

/** The viewBox. Width is arbitrary — the SVG stretches to the column and the stroke does not. */
export const CHART_WIDTH = 320;

/** `05-design.md`: 140px on a phone, and the same on a laptop. */
export const CHART_HEIGHT = 140;

/**
 * Half the stroke plus a hair, top and bottom, so the highest and lowest points are drawn
 * whole. Without it a peak at the top of the range is clipped down its middle.
 */
const INSET = 2;

/** The 5% the design pads the series range by, on each side. */
const PAD = 0.05;

/**
 * The padding on the side the **seed** widened, as a fraction of the span it widened to.
 *
 * 0.15, not the series' own 0.05 (the designer's M3.5 review): at 5% a seed that sits outside
 * the series lands two or three pixels inside a 140px plot, so the hairline draws under the
 * edge of the stroke and the `seed` label sits half off the box. A reference line the reader
 * cannot see is a chart with no reference, which is the rule this pad exists to keep.
 */
const SEED_PAD = 0.15;

/** The smallest y span drawn, in display points (05-design 11.2, the Kustom scale). */
export const MIN_SPAN = 100;

/** The reference label's room beside the dashed line, in viewBox units (about 14px at 140px tall). */
export const LABEL_ROOM = 14;

/**
 * The label's horizontal span, estimated in CSS pixels because the viewBox stretches to the column:
 * mono `--fs-2xs` (13px) runs about 0.6em a character, and the narrowest chart is a 320px phone less
 * the page and card padding. Over-estimating the span only moves a label to the gutter sooner;
 * under-estimating it is the collision this exists to prevent.
 */
const LABEL_CHAR_PX = 13 * 0.6;
const NARROWEST_CHART_PX = 256;
/** Air either side of the words, so a line passing just left of the label does not touch it. */
const LABEL_PAD_PX = 8;

/** The default label length: `Start 1200` and `Week start` are both ten characters. */
export const DEFAULT_LABEL_CHARS = 10;

/**
 * Where the reference label sits: over the dashed line, under it, or in the gutter under the plot
 * when the line passes through both sides within the label's span (M18.7 design re-check).
 */
export type LabelPlacement = 'above' | 'below' | 'gutter';

export interface ChartGeometry {
  width: number;
  height: number;
  /** The one series: `M0,120 L32,110 …`. No fill, no points, no grid. */
  path: string;
  /** Where the `seed` hairline sits, in viewBox units. */
  seedY: number;
  /** The same position as a percentage of the height, for the HTML label beside the line. */
  seedPercent: number;
  /** The range actually drawn, after padding and after taking the seed in. */
  low: number;
  high: number;
  /** Where the reference label goes; see {@link labelPlacement}. */
  labelPlacement: LabelPlacement;
}

/**
 * The path and the seed line, or `null` for a player with no history to draw.
 *
 * `series` is already in display units and in `started_at` order: the loader hands over
 * display values (`round(R)` or week points), so nothing here rounds a Rating.
 */
export function chartGeometry(
  series: readonly number[],
  seed: number,
  labelChars: number = DEFAULT_LABEL_CHARS,
): ChartGeometry | null {
  if (series.length === 0) return null;

  const { placement, low, high } = labelPlacement(series, seed, labelChars);
  const span = high - low;
  const plot = CHART_HEIGHT - 2 * INSET;
  const y = (value: number): number => INSET + (1 - (value - low) / span) * plot;
  const x = (index: number): number =>
    series.length === 1 ? CHART_WIDTH / 2 : (index * CHART_WIDTH) / (series.length - 1);

  // A single point is a dot nobody can see, so one game (which is two points: the rating
  // before it and the rating after) is the smallest chart. A one-point series is drawn as a
  // flat line across the width rather than as nothing.
  const points =
    series.length === 1
      ? [`M0,${round(y(series[0] as number))}`, `L${CHART_WIDTH},${round(y(series[0] as number))}`]
      : series.map((value, index) => `${index === 0 ? 'M' : 'L'}${round(x(index))},${round(y(value))}`);

  const seedY = y(seed);
  return {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    path: points.join(' '),
    seedY: round(seedY),
    seedPercent: round((seedY / CHART_HEIGHT) * 100),
    low,
    high,
    labelPlacement: placement,
  };
}

/**
 * The x where the label's span starts, in viewBox units: the label is right-aligned, so it covers
 * `[labelStartX, CHART_WIDTH]`, padding included.
 */
export function labelStartX(labelChars: number): number {
  const fraction = Math.min(1, (labelChars * LABEL_CHAR_PX + 2 * LABEL_PAD_PX) / NARROWEST_CHART_PX);
  return CHART_WIDTH * (1 - fraction);
}

/**
 * The series' lowest and highest value along the drawn path over `[fromX, CHART_WIDTH]`: every
 * point inside the span, plus the line's value where it enters the span (interpolated), so a dip
 * between two points either side of the span's edge still counts.
 */
export function pathExtentFrom(series: readonly number[], fromX: number): { min: number; max: number } {
  if (series.length === 1) {
    const only = series[0] as number;
    return { min: only, max: only };
  }
  const step = CHART_WIDTH / (series.length - 1);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const take = (value: number): void => {
    if (value < min) min = value;
    if (value > max) max = value;
  };
  for (let index = 0; index < series.length; index++) {
    const x = index * step;
    const value = series[index] as number;
    if (x >= fromX) {
      take(value);
    } else if (index + 1 < series.length && (index + 1) * step > fromX) {
      const next = series[index + 1] as number;
      take(value + ((next - value) * (fromX - x)) / step);
    }
  }
  return { min, max };
}

/**
 * Which side of the dashed line the label goes on, judged from the line's path across the label's
 * whole span (M18.7 design re-check), not from one point: a line that dips under the reference and
 * recovers inside the span would otherwise run through the words.
 *
 * A side clears when the path within the span stays out of the {@link LABEL_ROOM} band on that side
 * of the reference. The side away from the last point is tried first (the M18.7 review's rule),
 * then the other; each try first widens the range so that side has room to the plot's edge, and the
 * band is measured in the widened range. If neither clears, the label goes in the gutter under the
 * plot and the range is left as the series and seed need it.
 */
export function labelPlacement(
  series: readonly number[],
  seed: number,
  labelChars: number = DEFAULT_LABEL_CHARS,
): { placement: LabelPlacement; low: number; high: number } {
  const base = range(series, seed);
  const { min, max } = pathExtentFrom(series, labelStartX(labelChars));
  const preferBelow = (series[series.length - 1] as number) >= seed;
  const order: readonly ('above' | 'below')[] = preferBelow ? ['below', 'above'] : ['above', 'below'];
  for (const side of order) {
    const widened = roomForLabel(base, seed, side === 'below');
    const band = (LABEL_ROOM / (CHART_HEIGHT - 2 * INSET)) * (widened.high - widened.low);
    const clear = side === 'above' ? max <= seed || min >= seed + band : min >= seed || max <= seed - band;
    if (clear) return { placement: side, ...widened };
  }
  return { placement: 'gutter', ...base };
}

/**
 * Room for the reference line's label (05-design 11.2, M18.7 design review): the label sits on the
 * side of the dashed line away from the last point (under it when the line ends at or above the
 * reference, over it otherwise), so the range is widened until that side has {@link LABEL_ROOM}
 * viewBox units between the line and the plot's edge.
 */
function roomForLabel(
  { low, high }: { low: number; high: number },
  seed: number,
  labelBelow: boolean,
): { low: number; high: number } {
  const f = LABEL_ROOM / (CHART_HEIGHT - 2 * INSET);
  if (labelBelow && seed - low < f * (high - low)) return { low: (seed - f * high) / (1 - f), high };
  if (!labelBelow && high - seed < f * (high - low)) return { low, high: (seed - f * low) / (1 - f) };
  return { low, high };
}

/**
 * The series padded by 5%, then widened to take the seed in — and padded again on that side by
 * {@link SEED_PAD} of the span, so a seed outside the series is a hairline with air around it
 * rather than a half-drawn one on the boundary with its label off the box. A flat series (one
 * game, or a player whose rating has not moved) gets a range of one display point either way so
 * there is something to divide by.
 */
function range(series: readonly number[], seed: number): { low: number; high: number } {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const pad = Math.max((max - min) * PAD, 1);

  let low = min - pad;
  let high = max + pad;
  // 05-design 11.2 (M18): at least MIN_SPAN points tall, centred on the data, so a line of +8, -7,
  // +9 reads as the small movement it is rather than a sawtooth.
  if (high - low < MIN_SPAN) {
    const mid = (min + max) / 2;
    low = mid - MIN_SPAN / 2;
    high = mid + MIN_SPAN / 2;
  }
  if (seed < low) low = seed - (high - seed) * SEED_PAD;
  if (seed > high) high = seed + (seed - low) * SEED_PAD;
  return { low, high };
}

/** Two decimals: enough for a 320-unit box, and a string that does not move between renders. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
