import { chartGeometry } from '@/lib/board/chart';
import { SEED_LABEL, START_LABEL, trendSummary } from '@/lib/board/copy';
import type { WindowKind } from '@/lib/night';

/**
 * The trend line (M3.5; 2.0 since M14.15): a server SVG with `role="img"` and a `<title>`
 * (05-design 5.0, "Chart: ban recharts"). The geometry is `lib/board/chart.ts`'s, the numbers are the
 * loader's display ratings: nothing is computed here.
 *
 * A hairline marks the reference (the seed on `All time`, where the window found them on the
 * others), labelled in words, so the line reads against where they began.
 */
export function RatingChart({
  history,
  reference,
  window: kind,
}: {
  history: readonly number[];
  reference: number;
  window: WindowKind;
}) {
  const geometry = chartGeometry(history, reference);
  if (geometry === null) return null;

  const first = history[0] as number;
  const last = history[history.length - 1] as number;
  const label = trendSummary(first, last, Math.max(1, history.length - 1));
  const referenceLabel = kind === 'all-time' ? SEED_LABEL : START_LABEL;

  return (
    <figure className="relative">
      <svg
        className="block h-36 w-full overflow-visible text-foreground"
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        <line
          x1={0}
          x2={geometry.width}
          y1={geometry.seedY}
          y2={geometry.seedY}
          stroke="var(--border-strong)"
          strokeWidth={1}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={geometry.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        aria-hidden="true"
        className="num absolute end-0 -translate-y-full pb-0.5 text-2xs text-muted-foreground"
        style={{ top: `${geometry.seedPercent}%` }}
      >
        {`${referenceLabel} ${reference}`}
      </span>
    </figure>
  );
}
