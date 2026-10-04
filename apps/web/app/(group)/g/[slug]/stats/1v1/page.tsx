import { renderStatsSegment, type StatsRouteProps, statsMetadata } from '../../../../../_stats/render';

/** Stats → Versus (M14.17). The shared route body is `app/_stats/render.tsx`. */
export const dynamic = 'force-dynamic';

export function generateMetadata(props: StatsRouteProps) {
  return statsMetadata('versus', props);
}

export default function StatsVersusPage(props: StatsRouteProps) {
  return renderStatsSegment('versus', props);
}
