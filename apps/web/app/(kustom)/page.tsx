import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LandingPage } from '@/components/landing/LandingPage';
import { PAGE_DESCRIPTION, PAGE_TITLE } from '@/lib/landing/copy';
import { landingData, landingDecision } from '@/lib/landing/server';
import { kustomShareMetadata } from '@/lib/og/meta';

/**
 * `/` (M14.24; STRATEGY §2.2): a signed-in member is sent on to their group (307, `redirect()`:
 * temporary, because where it goes depends on the session and the cookie); everybody else gets
 * the landing page. Replaces M13.9's permanent redirect of everybody. Dynamic, so the answer is
 * never cached as one response for everybody.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ...kustomShareMetadata(),
};

export default async function Landing() {
  const decision = await landingDecision('root');
  if (decision.kind === 'redirect') redirect(decision.to);
  return <LandingPage data={await landingData()} audience={decision.audience} back={decision.back} />;
}
