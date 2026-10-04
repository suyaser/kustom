import type { Metadata } from 'next';
import { NEW_TITLE } from '@/lib/groups/pageCopy';
import { currentPageSession } from '@/lib/groups/pageSession';
import { NewGroupView } from './_components/NewGroupView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: `${NEW_TITLE} · Kustom` };

/**
 * `/new` (M13.13, M14.21): anyone signed in starts a group. Kustom-level, so the bare shell, and in
 * no group's nav. The create is the form's post to `POST /api/groups`; this page writes nothing.
 */
export default async function NewGroupPage() {
  const session = await currentPageSession();
  return <NewGroupView signedIn={session.kind === 'signed-in'} />;
}
