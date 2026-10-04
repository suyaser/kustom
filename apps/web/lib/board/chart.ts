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
}

/**
 * The path and the seed line, or `null` for a player with no history to draw.
 *
 * `series` is already in display units and in `started_at` order: the loader hands over
 * display values (`round(R)` or week points), so nothing here rounds a Rating.
 */
export function chartGeometry(series: readonly number[], seed: number): ChartGeometry | null {
  if (series.length === 0) return null;

  const { low, high } = range(series, seed);
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
  };
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
