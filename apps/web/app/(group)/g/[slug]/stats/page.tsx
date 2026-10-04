import { renderStatsSegment, type StatsRouteProps, statsMetadata } from '../../../../_stats/render';

/** Stats → Records (M14.17). The shared route body is `app/_stats/render.tsx`. */
export const dynamic = 'force-dynamic';

export function generateMetadata(props: StatsRouteProps) {
  return statsMetadata('records', props);
}

export default function StatsRecordsPage(props: StatsRouteProps) {
  return renderStatsSegment('records', props);
}
