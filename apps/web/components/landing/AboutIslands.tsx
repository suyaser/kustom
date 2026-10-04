'use client';

import { isGroupSlug } from '@customs/db/constants';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { backToGroup } from '@/lib/landing/backCopy';
import { groupHome } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { useKustomSession } from './useKustomSession';

/**
 * The parts of the static `/about` that depend on who is asking (about-static, after M19.18). The
 * page is prerendered for an anonymous visitor with no remembered group, served from the CDN, and
 * these islands correct it after hydration. With JavaScript off the prerendered page stands:
 * `Create your group` is the sign-in form (which still ends on `/new`), the `Free.` line is the
 * signed-out one, and there is no back bar (the wordmark still goes home).
 */

/** `GET /api/groups/remembered` (about-static): the group the HttpOnly `kustom_group` cookie names. */
export const REMEMBERED_GROUP_URL = '/api/groups/remembered';

export interface RememberedGroupView {
  slug: string;
  name: string;
}

/**
 * The response's group, or `null` for anything else. A hand check rather than the zod schema
 * (`rememberedGroupResponseSchema`, which the route parses its answer through), so zod stays out of
 * this page's bundle; `AboutIslands.test.tsx` holds the two to the same answers.
 */
export function readRememberedGroup(body: unknown): RememberedGroupView | null {
  if (typeof body !== 'object' || body === null) return null;
  const { ok, group } = body as { ok?: unknown; group?: unknown };
  if (ok !== true || typeof group !== 'object' || group === null) return null;
  const { slug, name } = group as { slug?: unknown; name?: unknown };
  if (typeof slug !== 'string' || !isGroupSlug(slug)) return null;
  if (typeof name !== 'string' || name.length === 0) return null;
  return { slug, name };
}

/**
 * `Back to <Group>`, the group this browser last opened. The cookie is HttpOnly, so the island
 * cannot tell whether one exists and always asks, once, after hydration: `/about` is reached mostly
 * from a group page's footer (`What's Kustom?`), where the cookie was just written, so a gate would
 * save the request for few visitors. Off the critical path either way: the page has painted.
 *
 * The band's 44px (plus its 1px rule, `box-content` so the link's own 44px tap height and the
 * empty band come out the same) are always reserved, so the bar arriving moves nothing. Empty, it is
 * blank space above the hero; filled, it takes the card surface and its rule. One line always: a
 * 40-character name is cut with an ellipsis on a phone rather than wrapping to a second line,
 * which would grow the band. The full name stays in the link's text for assistive tech.
 */
export function RememberedBackBar() {
  const [group, setGroup] = useState<RememberedGroupView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(REMEMBERED_GROUP_URL, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => setGroup(readRememberedGroup(body)))
      .catch(() => {
        // Offline, or the page is leaving: no bar, as for a browser that remembers nothing.
      });
    return () => controller.abort();
  }, []);

  return (
    <div
      data-remembered={group === null ? 'none' : group.slug}
      className={cn(
        'box-content min-h-11 border-b',
        group === null ? 'border-transparent' : 'border-border bg-card',
      )}
    >
      {group === null ? null : (
        <div className="mx-auto w-full max-w-7xl px-(--gutter)">
          <Link
            href={groupHome(group)}
            className="flex min-h-11 max-w-full items-center gap-1.5 font-bold text-primary-text underline underline-offset-3 sm:w-fit"
          >
            <span className="min-w-0 truncate">{backToGroup(group.name)}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * One of two server-rendered variants, by the visitor's session: `signedOut` in the prerendered
 * HTML and until the shared probe says otherwise. For `Create your group`, whose two variants (a
 * sign-in form, a link to `/new`) are the same button at the same size.
 */
export function AudienceSwitch({ signedIn, signedOut }: { signedIn: ReactNode; signedOut: ReactNode }) {
  return useKustomSession() === 'signed-in' ? signedIn : signedOut;
}

/**
 * Two lines of text in one grid cell, the one not in use `invisible` and `aria-hidden`, so turning
 * from one to the other cannot change the block's height (KustomSignIn's pattern). For the
 * `Free.` line under `Create your group`.
 */
export function AudienceText({
  signedIn,
  signedOut,
  className,
}: {
  signedIn: string;
  signedOut: string;
  className?: string | undefined;
}) {
  const on = useKustomSession() === 'signed-in';
  return (
    <p className={cn('grid', className)} data-session={on ? 'signed-in' : 'signed-out'}>
      <span aria-hidden={on} className={cn('col-start-1 row-start-1', on && 'invisible')}>
        {signedOut}
      </span>
      <span aria-hidden={!on} className={cn('col-start-1 row-start-1', !on && 'invisible')}>
        {signedIn}
      </span>
    </p>
  );
}
