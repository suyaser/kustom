import { rememberedGroupResponseSchema } from '@customs/db/schemas';
import type { NextRequest, NextResponse } from 'next/server';
import { GROUP_COOKIE_NAME, type PageGroup } from '@/lib/groups/pageGroup';
import { jsonOk } from '@/lib/http';
import { rememberedGroup } from '@/lib/landing/decide';

export interface RememberedGroupRouteOptions {
  /** The `groups_public` read; `landingGroupBySlug` in production. */
  groupBySlug(slug: string): Promise<PageGroup | null>;
}

/**
 * `GET /api/groups/remembered` (about-static): the group the HttpOnly `kustom_group` cookie names,
 * `{ ok: true, group: { slug, name } | null }`, for the static `/about`'s `Back to <Group>` island.
 * The rule is `decideLanding`'s own ({@link rememberedGroup}): no cookie is no read, an unknown slug
 * or a failed read is `null`. Never a 4xx or 5xx, so the island has one shape to read.
 *
 * No session needed: the cookie is a hint, never a credential, and the answer is a public slug and
 * name the visitor's own browser already holds. `private, no-store`, because the answer is per
 * browser and a shared cache must never hand one visitor's group to the next.
 */
export function rememberedGroupRoute(options: RememberedGroupRouteOptions) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const group = await rememberedGroup(request.cookies.get(GROUP_COOKIE_NAME)?.value, options.groupBySlug);
    const response = jsonOk(rememberedGroupResponseSchema, {
      ok: true,
      group: group === null ? null : { slug: group.slug, name: group.name },
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  };
}
