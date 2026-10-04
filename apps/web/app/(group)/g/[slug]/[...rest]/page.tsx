import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { isOriginalGroup } from '@/lib/groups/pageGroup';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { unmovedDestination } from '@/lib/groups/unmovedPath';
import { groupHref } from '@/lib/nav';

export const dynamic = 'force-dynamic';

/**
 * Every path under `/g/<slug>` no page answers (M14.7). It exists so those paths 404 **inside the
 * group's shell**, with a reason (`../not-found.tsx`), instead of falling through to the site's bare
 * 404.
 *
 * One kindness on the way: a page that has not moved under `/g/<slug>` yet still lives at its old path
 * for the original group (`lib/nav.ts`), so `/g/customs/stats` sends the reader there with a temporary
 * redirect, until that page's task mounts it here.
 */
export default async function UnknownGroupPath({
  params,
}: {
  params: Promise<{ slug: string; rest: string[] }>;
}) {
  const { slug, rest } = await params;
  const group = await requirePageGroup(slug);
  if (!isOriginalGroup(group)) notFound();

  const destination = unmovedDestination(rest);
  const target = destination === null ? null : groupHref(group, destination);
  if (target === null) notFound();
  redirect(target as Route);
}
