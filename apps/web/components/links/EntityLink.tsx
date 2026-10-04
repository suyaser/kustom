import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A link to one **entity page** (a player `/g/<slug>/p/<puuid>`, a game `/g/<slug>/games/<id>`, a
 * 1v1 pair) from inside a list, a card, a row or a scoreboard: `next/link` with prefetch **off**
 * (app-perf, 2026-10-04; the prefetch rule, `docs/04-decisions.md`).
 *
 * Why off: a prefetch of a dynamic page runs its layout and `generateMetadata` on the server, and a
 * list prints many of these links at once. Every `router.refresh()` (Tonight's live updates) drops
 * the router's prefetches, so the whole list is prefetched again on each event: on Tonight's result
 * screen that was 39 of a refresh's 95 queries. The tap is still instant to feel (the press state
 * is the link's own), the page then renders once.
 *
 * Navigation chrome (the tab bar, the top bar, the admin nav), in-page controls (window chips,
 * sort, pagers, back links) and calls to action keep `next/link`'s default prefetch: they are few,
 * cheap (the group lookup, cached per request) and the next tap is likely.
 *
 * `lib/perf/prefetchPolicy.test.ts` fails a `<Link>` to an entity page that is neither this nor
 * `prefetch={false}`.
 */
export function EntityLink({
  href,
  className,
  children,
}: {
  href: Route;
  className?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <Link href={href} prefetch={false} {...(className === undefined ? {} : { className })}>
      {children}
    </Link>
  );
}
