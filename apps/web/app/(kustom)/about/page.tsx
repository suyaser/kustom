import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';
import { PAGE_DESCRIPTION, PAGE_TITLE } from '@/lib/landing/copy';
import { landingData, landingDecision } from '@/lib/landing/server';
import { kustomShareMetadata } from '@/lib/og/meta';

/**
 * `/about` (M14.24; STRATEGY §2.2): the landing page, and it never redirects anybody. Every group
 * page's footer links here as `What's Kustom?`.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ...kustomShareMetadata(),
};

export default async function About() {
  const decision = await landingDecision('about');
  // `decideLanding` never redirects `/about`; the narrowing is for the types.
  if (decision.kind !== 'landing') throw new Error('about: a redirect decision for /about');
  return <LandingPage data={await landingData()} audience={decision.audience} back={decision.back} />;
}
