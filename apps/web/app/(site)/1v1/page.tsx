import { notFound } from 'next/navigation';
import { WINDOW_LABELS } from '@/lib/board/copy';
import { parseWindow, VERSUS_WINDOW } from '@/lib/board/window';
import { createPublicClient } from '@/lib/publicClient';
import { loadVersus } from '@/lib/stats/load';
import { nightTimeZone } from '@/lib/tonight/night';
import { VERSUS_LABEL } from '@/lib/versus/copy';
import { parsePlayerParam } from '@/lib/versus/query';
import { VersusView } from '../../_versus/VersusView';
import '../../board.css';
import '../../stats.css';
import '../../versus.css';

/**
 * `/1v1` (M5.34): who wins each lane, and any two people head to head.
 *
 * Same window picker, same anon read, same `gateRatedGame` universe as `/stats`.
 * `?window=`, `?a=` and `?b=` are the whole of the page's state. Default window is
 * `All time`, because a lane series wants more than a week of customs.
 */

export const dynamic = 'force-dynamic';

interface VersusPageProps {
  searchParams: Promise<{ window?: string | string[]; a?: string | string[]; b?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: VersusPageProps) {
  const params = await searchParams;
  const kind = parseWindow(params.window, VERSUS_WINDOW);
  if (kind === null) return { title: `Kustom · ${VERSUS_LABEL}` };
  return { title: `${WINDOW_LABELS[kind]} · ${VERSUS_LABEL} · Kustom` };
}

export default async function VersusPage({ searchParams }: VersusPageProps) {
  const params = await searchParams;
  const kind = parseWindow(params.window, VERSUS_WINDOW);
  const left = parsePlayerParam(params.a);
  const right = parsePlayerParam(params.b);
  if (kind === null || left === null || right === null) notFound();

  const view = await loadVersus(createPublicClient(), {
    window: kind,
    timeZone: nightTimeZone(),
    leftPuuid: left,
    rightPuuid: right,
  });

  return <VersusView view={view} />;
}
