import type { ReactNode } from 'react';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { Footer } from './Footer';
import { TopBar } from './TopBar';

/**
 * The app shell (05-design.md, "The app shell"): top bar, the page on the ink under the
 * floodlight, footer. Every page of `apps/web` outside `/admin` is inside it — it is what makes
 * the tonight page a page of a product rather than a document that happens to be dark.
 *
 * Mounted by `app/(group)/g/[slug]/layout.tsx` for a group's pages and by `app/(site)/layout.tsx`
 * for the pages that have not moved under `/g/<slug>` yet (the original group's), rather than by
 * the root layout, which is how `/admin` opts out: the admin area has its own Floodlit shell
 * (05-design.md, "The admin area") and a route group leaves every URL exactly where it was.
 *
 * **Every page belongs to one group** (M13.9), and the shell names it under the wordmark and
 * builds every link from it (`lib/nav.ts`), so nothing on one group's pages leads to another's.
 *
 * The ≥1080px two-column grid and its rail are `shell.css`'s (`.cn-grid`, `.cn-rail`), used by
 * the page that has something to put in the rail. The rail never carries state — no live data
 * under a thumb, no control — and it is `display: none` below 1080px, where its cards are in
 * the footer instead, so a phone loses nothing.
 */
export interface ShellProps {
  children: ReactNode;
  /** The group the page shows, resolved on the server from the URL. */
  group: PageGroup;
  viewerPuuid: string | null;
  /**
   * The viewer is an admin of {@link group}, decided on the server from the session
   * (`lib/viewer.ts`). Draws the `Admin` tab; the admin pages check again.
   */
  isAdmin?: boolean;
}

export function Shell({ children, group, viewerPuuid, isAdmin = false }: ShellProps) {
  return (
    <div className="cn-shell">
      <TopBar group={group} isAdmin={isAdmin} />
      <div className="cn-main">{children}</div>
      <Footer group={group} viewerPuuid={viewerPuuid} />
    </div>
  );
}
