import { formatWebDelta } from '@/lib/ratingDisplay';
import {
  YOUR_NIGHT_TITLE,
  yourNightAwards,
  yourNightBestParts,
  yourNightLine,
} from '@/lib/tonight/screenCopy';
import type { YourNight as YourNightData } from '@/lib/tonight/yourNight';

/** The first line, shared by Tonight's card and You's summary (M14.36: the same words, one loader). */
export function yourNightFirstLine(night: YourNightData): string {
  return yourNightLine(
    night.wins,
    night.losses,
    night.ratingDelta === null ? null : formatWebDelta(night.ratingDelta),
    night.notRated === true,
  );
}

/**
 * Your night on Tonight (M14.36): at the top of the page in idle and finished, for a linked viewer
 * with a counted game tonight. "So far" while the night runs, the same card after; it goes at the
 * 06:00 boundary. A server component: each game landing re-renders it through `TonightLive`.
 */
export function YourNight({ night }: { night: YourNightData }) {
  const awards = yourNightAwards(night.mvp, night.ace);
  return (
    <section
      aria-labelledby="your-night-title"
      data-slot="your-night"
      className="flex flex-col gap-1 rounded-card border border-border bg-card p-(--card-pad)"
    >
      <h2 id="your-night-title" className="sr-only">
        {YOUR_NIGHT_TITLE}
      </h2>
      <p className="text-md font-bold">{yourNightFirstLine(night)}</p>
      {night.best === null ? null : (
        <p className="text-sm text-muted-foreground">
          <BestGame best={night.best} />
        </p>
      )}
      {awards === null ? null : <p className="text-sm text-muted-foreground">{awards}</p>}
    </section>
  );
}

function BestGame({ best }: { best: NonNullable<YourNightData['best']> }) {
  const parts = yourNightBestParts(best.champion, best.kills, best.deaths, best.assists);
  return (
    <>
      {parts.lead}
      <span className="num font-stretch-85%">{parts.kda}</span>
      {parts.end}
    </>
  );
}
