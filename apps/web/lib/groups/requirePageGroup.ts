import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { cachedRead } from '../cache/cached';
import { GROUPS_TAG } from '../cache/tags';
import { groupHref } from '../nav';
import { isGameId } from '../og/load';
import { createPublicClient } from '../publicClient';
import type { PageGroup } from './pageGroup';
import { type GroupParam, resolveGroupParam } from './resolve';

/**
 * A slug's group, kept in the server cache (performance plan, phase 2): every `/g/<slug>` request
 * and prefetch asks, and the answer changes about never (slugs are immutable in v1 and no route
 * renames a group). A slug that names nothing is cached too, so `POST /api/groups` drops the tag
 * when it creates one (`invalidateGroups`). A game id is never looked up through here: a game
 * that lands later must start redirecting at once.
 */
const cachedSlug = cachedRead(
  'page-group-v1',
  (slug: string) => resolveGroupParam(createPublicClient(), slug),
  {
    tags: () => [GROUPS_TAG],
    revalidate: 3_600,
  },
);

/**
 * The group a `/g/[slug]/...` request shows, or the request ends here (M13.9):
 *
 * - an unknown slug is `notFound()` -- never another group's page;
 * - a uuid that names a game is a **308** to `/g/<its group's slug>/games/<id>`, which is what
 *   keeps every M11.4 result link already posted in Discord working;
 * - a uuid that names nothing is `notFound()`.
 *
 * React-cached per request, so the layout (the shell's group line), the page and its metadata
 * share one lookup. The layout calls it first, so the redirect and the 404 happen before any
 * markup is sent.
 */
export const requirePageGroup: (param: string) => Promise<PageGroup> = cache(async (param: string) => {
  const resolved: GroupParam = isGameId(param)
    ? await resolveGroupParam(createPublicClient(), param)
    : await cachedSlug(param);
  if (resolved.kind === 'game') {
    const target = groupHref({ id: '', slug: resolved.slug }, { page: 'game', gameId: resolved.gameId });
    // The game page has moved (it is mounted under the group by M13.9), so this is never null.
    if (target !== null) permanentRedirect(target);
  }
  if (resolved.kind !== 'group') notFound();
  return resolved.group;
});
