import type { ReactNode } from 'react';
import { Footer } from './Footer';
import { TopBar } from './TopBar';

/**
 * The app shell (05-design.md, "The app shell"): top bar, the page on the ink under the
 * floodlight, footer. Every page of `apps/web` outside `/admin` is inside it — it is what makes
 * the tonight page a page of a product rather than a document that happens to be dark.
 *
 * Mounted by `app/(site)/layout.tsx` rather than by the root layout, which is how `/admin` opts
 * out: the admin area has its own Floodlit shell (05-design.md, "The admin area") and a
 * route group leaves every URL exactly where it was.
 *
 * The ≥1080px two-column grid and its rail are `shell.css`'s (`.cn-grid`, `.cn-rail`), used by
 * the page that has something to put in the rail. The rail never carries state — no live data
 * under a thumb, no control — and it is `display: none` below 1080px, where its cards are in
 * the footer instead, so a phone loses nothing.
 */
export function Shell({ children, viewerPuuid }: { children: ReactNode; viewerPuuid: string | null }) {
  return (
    <div className="cn-shell">
      <TopBar />
      <div className="cn-main">{children}</div>
      <Footer viewerPuuid={viewerPuuid} />
    </div>
  );
}
