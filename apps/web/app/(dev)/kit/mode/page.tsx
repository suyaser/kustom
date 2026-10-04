import type { Mode } from '@customs/core';
import { notFound } from 'next/navigation';
import { ModePanelBody } from '@/app/_mode/ModePanelBody';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { demoPool } from '@/app/_tonight/fixtures';
import { Shell } from '@/components/shell/Shell';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { modeCardView } from '@/lib/mode/card';
import { championTable } from '@/lib/mode/champions';
import { modeCardHref } from '@/lib/mode/hrefs';
import { ruleFromKey } from '@/lib/mode/spinEvents';
import { parseLane } from '@/lib/mode/view';

/**
 * Dev-only: the mode panel's body as the direct page renders it (M14.30, M15.5), from fixtures, for
 * the states the local data cannot reach without writing to the shared stack: `?mode=normal`,
 * `?pool=empty`, `?lane=<role>`, `?admin=1`; M15.5 `?rule=class:Tank|region|mirror`,
 * `?drawn=1` (region wars after Roll: Ionia vs Noxus; M20.5 `?pair=piltover:zaun` for another pair),
 * `?side=red` (seated on red), `?rated=0|1`.
 * A 404 in production.
 */
export default async function KitModePage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    pool?: string;
    lane?: string;
    admin?: string;
    rule?: string;
    drawn?: string;
    pair?: string;
    side?: string;
    rated?: string;
  }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { mode, pool, lane, admin, rule, drawn, pair, side, rated } = await searchParams;
  const [blue = 'ionia', red = 'noxus'] = (pair ?? '').split(':').filter((one) => one.length > 0);
  const group = ORIGINAL_GROUP;
  const standing = mode === 'normal' ? 'normal' : 'fearless';
  const fearless = pool === 'empty' ? { champions: [], resetAt: null, games: 0 } : demoPool(false);
  const pending = ruleFromKey(rule);
  const override = rated === '1' ? true : rated === '0' ? false : null;
  const state = { standing, pending, ratedOverride: override, version: 2 } as const;
  const view = modeCardView({
    state,
    lobbyStatus: drawn === '1' ? 'balanced' : null,
    lock:
      drawn === '1' && pending !== null
        ? {
            mode: pending.id === 'region' ? ({ id: 'region', blue, red } as Mode) : pending,
            rated: override ?? pending.id === 'mirror',
            version: 2,
          }
        : null,
    bans: fearless.champions.map((champion) => champion.id),
    table: championTable(),
  });
  const chosen = parseLane(lane);
  return (
    <PageGroupProvider group={group}>
      <Shell group={group} isAdmin={admin === '1'} account="anonymous">
        <div className="mx-auto w-full max-w-[1180px] px-(--gutter) pt-4 pb-8 lg:pt-6">
          <div className="rounded-card border border-border bg-card p-(--card-pad)">
            <ModePanelBody
              mode={standing}
              fearless={fearless}
              view={view}
              lane={parseLane(lane)}
              viewerLane={chosen === 'all' ? null : chosen}
              viewerSide={side === 'red' ? 'red' : side === 'blue' ? 'blue' : null}
              isAdmin={admin === '1'}
              poolSince="Thu 1 Oct"
              cardHref={modeCardHref(group)}
              heading="h1"
              headingId="mode-panel-title"
            />
          </div>
        </div>
      </Shell>
    </PageGroupProvider>
  );
}
