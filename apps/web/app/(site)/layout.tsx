import type { ReactNode } from 'react';
import { ORIGINAL_GROUP, type PageGroup } from '@/lib/groups/pageGroup';
import { loadGroupById } from '@/lib/groups/resolve';
import { createPublicClient } from '@/lib/publicClient';
import { currentViewer } from '@/lib/viewer';
import { Shell } from '../_shell/Shell';
import '../shell.css';

/**
 * The public pages that have not moved under `/g/<slug>` yet — `/leaderboard`, `/p/[puuid]`,
 * `/games`, `/stats`, `/fun`, `/1v1`, `/mystery` — inside the Floodlit shell (M3.18). `/admin`
 * is outside this route group and therefore outside the shell, which is the whole reason the
 * group exists; the URLs are unchanged by it.
 *
 * **These pages are the original group's** until M13.10 to M13.12 move each one under
 * `app/(group)/g/[slug]/` (M13.9's brief: "an un-moved page keeps working at its old path for the
 * original group in between"), so the shell names that group and builds its links from it. The
 * tonight page has moved: `/` redirects (`app/page.tsx`), and the shell's `Tonight` is
 * `/g/customs`.
 *
 * `currentViewer()` is React-cached per request, so the footer's `Your games` link costs the
 * page nothing: the pages already ask the same question for the "you" rule.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [group, viewer] = await Promise.all([originalGroup(), currentViewer()]);

  return (
    <Shell group={group} viewerPuuid={viewer?.puuid ?? null} isAdmin={viewer?.isAdmin ?? false}>
      {children}
    </Shell>
  );
}

/**
 * The original group's row, for its name in the shell; the migration's literal when it cannot be
 * read, so a slow lookup costs these pages nothing (renames are out of scope in v1, so the two
 * agree).
 */
async function originalGroup(): Promise<PageGroup> {
  try {
    return (await loadGroupById(createPublicClient(), ORIGINAL_GROUP.id)) ?? ORIGINAL_GROUP;
  } catch (error) {
    console.error('shell: reading the original group failed', error);
    return ORIGINAL_GROUP;
  }
}
