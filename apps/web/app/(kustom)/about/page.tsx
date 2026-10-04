import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { PAGE_DESCRIPTION, PAGE_TITLE } from '@/lib/landing/copy';
import { landingData } from '@/lib/landing/server';
import { kustomShareMetadata } from '@/lib/og/meta';

/**
 * `/about` (M14.24; STRATEGY §2.2): the landing page, and it never redirects anybody. Every group
 * page's footer links here as `What's Kustom?`.
 *
 * Incremental static (about-static, after M19.18), like `/how`: prerendered for an anonymous
 * visitor and rebuilt in the background at most every five minutes, the landing data's own cache
 * window. What depends on the visitor is client islands (`components/landing/AboutIslands.tsx`):
 * the `Back to <Group>` bar asks `GET /api/groups/remembered` (the `kustom_group` cookie is
 * HttpOnly), and `Create your group` and the `Free.` line turn for a signed-in visitor on the
 * session probe the top bar's `KustomSignIn` already makes. Was `force-dynamic`, a function
 * invocation and a session read per hit.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ...kustomShareMetadata(),
};

export default async function About() {
  return <LandingPage data={await landingData()} islands />;
}
