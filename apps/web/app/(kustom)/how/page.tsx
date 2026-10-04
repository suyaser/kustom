import type { Metadata } from 'next';
import { HowPage } from '@/components/landing/HowPage';
import { HOW_TITLE } from '@/lib/landing/copy';
import { landingData } from '@/lib/landing/server';

/**
 * `/how`, How the bot decides (M14.24). The demo group's calibration line comes from the landing
 * data, the same for every visitor (anon reads), so the page is incremental static (M19.18):
 * prerendered, and rebuilt in the background at most every five minutes, the landing data's own
 * cache window. The top bar's account control is a client island (`KustomSignIn`).
 */
export const revalidate = 300;

export const metadata: Metadata = { title: `${HOW_TITLE} · Kustom` };

export default async function How() {
  const data = await landingData();
  return <HowPage demo={data.demo} calibration={data.calibration} />;
}
