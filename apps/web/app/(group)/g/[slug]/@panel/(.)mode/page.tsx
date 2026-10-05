import { loadModePanel } from '@/app/_mode/loadPanel';
import { ModeOverlay } from '@/app/_mode/ModeOverlay';
import { ModePanelBody } from '@/app/_mode/ModePanelBody';
import { modeTitle } from '@/lib/mode/copy';
import { modeCardHref } from '@/lib/mode/hrefs';
import { modeName } from '@/lib/mode/ruleCopy';

/**
 * The mode panel over Tonight (M14.30; 05-design.md 8.5.1): a soft navigation from `/g/<slug>`
 * to `/g/<slug>/mode` is intercepted here (`(.)mode`, a sibling of the `[slug]` segment's own
 * pages; the `(tonight)` route group does not count as a segment) and rendered in the layout's
 * `@panel` slot, over the page, which stays mounted with its scroll. A hard load of the same URL
 * skips this and renders `../../mode/page.tsx`, the full page. M15.5: the panel is about what the
 * Mode card is about (a rule pending or locked, else the standing mode).
 */
export const dynamic = 'force-dynamic';

export default async function ModePanelOverlay({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lane?: string | string[]; lobby?: string | string[] }>;
}) {
  const [{ slug }, { lane, lobby }] = await Promise.all([params, searchParams]);
  const data = await loadModePanel(slug, lane, lobby);
  const headingId = 'mode-panel-title';

  return (
    <ModeOverlay headingId={headingId} title={modeTitle(modeName(data.view.shown))}>
      <ModePanelBody
        mode={data.mode}
        fearless={data.fearless}
        view={data.view}
        lane={data.lane}
        viewerLane={data.viewerLane}
        viewerSide={data.viewerSide}
        isAdmin={data.isAdmin}
        poolSince={data.poolSince}
        liveTables={data.liveTables}
        cardHref={modeCardHref(data.group)}
        heading="h2"
        headingId={headingId}
      />
    </ModeOverlay>
  );
}
