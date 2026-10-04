import type { ReactElement } from 'react';
import { type AdminPage, adminHref } from '@/lib/admin/adminNav';
import { currentAdminAccess } from '@/lib/admin/groupAdminPage';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { AdminHome } from './AdminHome';

/** Who is reading an admin section page, once they may. */
export type SectionReader =
  | { kind: 'runs-group'; role: 'owner' | 'admin'; playerId: string }
  | { kind: 'operator' };

/** The Discord page also lets the group's creator in before they pair (M14.40, the setup gate). */
export type DiscordSectionReader = SectionReader | { kind: 'creator-unlinked' };

type SectionGate<R> = { group: PageGroup; reader: R } | { refusal: ReactElement };

/**
 * The gate every admin section page (Members, Discord, Hosts, Games) starts with (M14.22, M14.23):
 * the group from the slug, then the server's access decision. Signed out: the sign-in, coming back to
 * this page. Not an admin: the not-an-admin page. The creator before they pair (no membership to act
 * from) gets the Discord page only -- Connect Discord is one of the setup writes the server allows them
 * (M14.40) -- and the not-an-admin page everywhere else. The owner, an admin, or the operator
 * (read-only) get the page.
 */
export async function sectionAccess(
  slug: string,
  page: 'discord',
): Promise<SectionGate<DiscordSectionReader>>;
export async function sectionAccess(
  slug: string,
  page: Exclude<AdminPage, 'discord'>,
): Promise<SectionGate<SectionReader>>;
export async function sectionAccess(
  slug: string,
  page: AdminPage,
): Promise<SectionGate<DiscordSectionReader>> {
  const group = await requirePageGroup(slug);
  const access = await currentAdminAccess(group);
  if (access.kind === 'signed-out') {
    return { refusal: <AdminHome kind="signed-out" group={group} here={adminHref(group, page)} /> };
  }
  if (access.kind === 'creator-unlinked' && page === 'discord') {
    return { group, reader: { kind: 'creator-unlinked' } };
  }
  if (access.kind === 'not-admin' || access.kind === 'creator-unlinked') {
    return { refusal: <AdminHome kind="not-admin" group={group} /> };
  }
  return {
    group,
    reader:
      access.kind === 'operator'
        ? { kind: 'operator' }
        : { kind: 'runs-group', role: access.role, playerId: access.playerId },
  };
}
