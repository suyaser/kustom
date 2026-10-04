import { renderStatsSegment, type StatsRouteProps, statsMetadata } from '../../../../../_stats/render';

/** Stats → Champions (M14.17). The shared route body is `app/_stats/render.tsx`. */
export const dynamic = 'force-dynamic';

export function generateMetadata(props: StatsRouteProps) {
  return statsMetadata('champions', props);
}

export default function StatsChampionsPage(props: StatsRouteProps) {
  return renderStatsSegment('champions', props);
}
