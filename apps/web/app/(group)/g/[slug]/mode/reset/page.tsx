import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import {
  FEARLESS_RESET_BUTTON,
  FEARLESS_RESET_CANCEL,
  FEARLESS_RESET_TITLE,
  fearlessResetBody,
} from '@/lib/fearless/copy';
import { loadFearless } from '@/lib/fearless/load';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { loadTonightLobbyLock } from '@/lib/mode/tonightRead';
import { fearlessCounts } from '@/lib/mode/view';
import { groupHome } from '@/lib/nav';
import { createPublicClient } from '@/lib/publicClient';
import { tonightStart } from '@/lib/tonight/night';
import { resetBodyLobbies } from '@/lib/tonight/switcher';
import { cn } from '@/lib/utils';
import { currentViewerState } from '@/lib/viewer';

/**
 * `Reset fearless` without JavaScript (M14.30; 05-design.md 5.13 "No-JS"): the Mode card's Reset is
 * a link here, so a reset is never one tap away. The same question as the AlertDialog, then a real
 * POST to `/api/admin/fearless/reset` that comes back to Tonight with its notice, and `Cancel` back
 * to Tonight. Admins and the owner only: anybody else gets a 404, and the route re-checks the
 * session and the group before it writes anyway. With JavaScript nobody lands here.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: `${FEARLESS_RESET_TITLE} | Kustom` },
  robots: { index: false },
};

export default async function ResetFearlessConfirm({ params }: { params: Promise<{ slug: string }> }) {
  const group = await requirePageGroup((await params).slug);
  const viewer = await currentViewerState(group.id);
  if (viewer.kind !== 'linked' || !viewer.isAdmin) notFound();

  const client = createPublicClient();
  // M22.6 (14.11): with two or more lobbies live, the question names them all.
  const [pool, lobby] = await Promise.all([
    loadFearless(client, group.id),
    loadTonightLobbyLock(client, group.id, tonightStart()),
  ]);
  const lobbies = lobby?.liveTables ?? 0;
  const banned = fearlessCounts(pool).banned;
  const tonight = groupHome(group);

  return (
    <div className="mx-auto w-full max-w-md px-(--gutter) pt-8 pb-12">
      <section
        aria-labelledby="reset-title"
        className="flex flex-col gap-4 rounded-card border border-border-strong bg-card p-(--card-pad)"
      >
        <h1 id="reset-title" className="text-xl font-bold">
          {FEARLESS_RESET_TITLE}
        </h1>
        <p className="text-base text-muted-foreground">
          {lobbies >= 2 ? resetBodyLobbies(banned, lobbies) : fearlessResetBody(banned)}
        </p>
        <div className="flex flex-col gap-3 md:flex-row-reverse md:justify-start">
          <form method="post" action="/api/admin/fearless/reset">
            <input type="hidden" name="groupId" value={group.id} />
            <input type="hidden" name="redirectTo" value={tonight} />
            <button
              type="submit"
              className={cn(buttonVariants({ variant: 'destructive' }), 'w-full md:w-auto')}
            >
              {FEARLESS_RESET_BUTTON}
            </button>
          </form>
          <Link
            prefetch="auto"
            href={tonight}
            className={cn(buttonVariants({ variant: 'secondary' }), 'w-full md:w-auto')}
          >
            {FEARLESS_RESET_CANCEL}
          </Link>
        </div>
      </section>
    </div>
  );
}
