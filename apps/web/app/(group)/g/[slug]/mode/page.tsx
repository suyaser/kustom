import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { loadModePanel } from '@/app/_mode/loadPanel';
import { ModePanelBody } from '@/app/_mode/ModePanelBody';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { MODE_NAMES, PANEL_CRUMB_TONIGHT } from '@/lib/mode/copy';
import { modeCardHref } from '@/lib/mode/hrefs';
import { loadGroupMode } from '@/lib/mode/load';
import { modeName } from '@/lib/mode/ruleCopy';
import { loadModeState } from '@/lib/mode/tonightRead';
import { groupHome } from '@/lib/nav';
import { groupPageTitle } from '@/lib/og/titles';
import { createPublicClient } from '@/lib/publicClient';

/**
 * The mode panel as a full page (M14.30; 05-design.md 8.5.3): what `/g/<slug>/mode` renders on a
 * hard load (a Discord link, a reload, a pasted link, no JS). The same body as the overlay, in the
 * group shell, under a breadcrumb back to Tonight, with the mode's name as the h1. Never a 404 for a
 * group that exists and never a redirect. The overlay is `../@panel/(.)mode`.
 */
export const dynamic = 'force-dynamic';

interface ModePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lane?: string | string[]; lobby?: string | string[] }>;
}

export async function generateMetadata({ params }: ModePageProps): Promise<Metadata> {
  const group = await requirePageGroup((await params).slug);
  const client = createPublicClient();
  const [mode, state] = await Promise.all([loadGroupMode(client, group.id), loadModeState(client, group.id)]);
  // M15.5: a pending rule names the page (`Class wars`), else the standing mode.
  const name = state?.pending ? modeName(state.pending) : MODE_NAMES[mode];
  return { title: { absolute: groupPageTitle(group, name) } };
}

export default async function ModePage({ params, searchParams }: ModePageProps) {
  const [{ slug }, { lane, lobby }] = await Promise.all([params, searchParams]);
  const data = await loadModePanel(slug, lane, lobby);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-(--gutter) pt-4 pb-8 lg:pt-6">
      <nav aria-label="Breadcrumb" className="mb-3 text-[0.9375rem] text-muted-foreground">
        <span className="[overflow-wrap:anywhere]">{data.group.name}</span>
        <span aria-hidden="true">{' · '}</span>
        <Link
          href={
            data.lobby === null
              ? groupHome(data.group)
              : (`${groupHome(data.group)}?lobby=${data.lobby.id}` as Route)
          }
          className="inline-flex min-h-11 items-center underline underline-offset-3"
        >
          {PANEL_CRUMB_TONIGHT}
        </Link>
        {data.lobby === null ? null : (
          <>
            <span aria-hidden="true">{' · '}</span>
            <span className="[overflow-wrap:anywhere]">{data.lobby.label}</span>
          </>
        )}
      </nav>
      <div className="rounded-card border border-border bg-card p-(--card-pad)">
        <ModePanelBody
          mode={data.mode}
          fearless={data.fearless}
          view={data.view}
          viewerSide={data.viewerSide}
          lane={data.lane}
          viewerLane={data.viewerLane}
          isAdmin={data.isAdmin}
          poolSince={data.poolSince}
          liveTables={data.liveTables}
          cardHref={modeCardHref(data.group)}
          heading="h1"
          headingId="mode-panel-title"
        />
      </div>
    </div>
  );
}
