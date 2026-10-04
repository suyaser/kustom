import { chartGeometry } from '@/lib/board/chart';
import { chartReferenceLabel, trendSummary, weekTrendSummary } from '@/lib/board/copy';
import type { WindowKind } from '@/lib/night';
import { cn } from '@/lib/utils';

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
  const referenceLabel = chartReferenceLabel(kind === 'all-time' ? 'all-time' : 'week', reference);
  const geometry = chartGeometry(history, reference, referenceLabel.length);
  if (geometry === null) return null;

  const first = history[0] as number;
  const last = history[history.length - 1] as number;
  const label =
    kind === 'all-time'
      ? trendSummary(first, last, Math.max(1, history.length - 1))
      : weekTrendSummary(last, Math.max(1, history.length - 1), kind);
  const placement = geometry.labelPlacement;

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
      {placement === 'gutter' ? (
        // The line crosses both sides of the reference under the words (M18.7 design re-check), so
        // the label drops into the gutter under the plot, right-aligned like the in-plot one.
        <span
          aria-hidden="true"
          data-placement="gutter"
          className="num block pt-1 text-end text-2xs text-muted-foreground"
        >
          {referenceLabel}
        </span>
      ) : (
        <span
          aria-hidden="true"
          data-placement={placement}
          // On the side of the dashed line the path leaves clear across the label's span
          // (lib/board/chart.ts, labelPlacement), so the line never runs through the words.
          className={cn(
            'num absolute end-0 text-end text-2xs text-muted-foreground',
            placement === 'below' ? 'translate-y-0 pt-0.5' : '-translate-y-full pb-0.5',
          )}
          style={{ top: `${geometry.seedPercent}%` }}
        >
          {referenceLabel}
        </span>
      )}
    </figure>
  );
}
