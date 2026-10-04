import type { Metadata } from 'next';
import { HowPage } from '@/components/landing/HowPage';
import { HOW_TITLE } from '@/lib/landing/copy';
import { landingData } from '@/lib/landing/server';

/** `/how`, How the bot decides (M14.24). The demo group's calibration line comes from the landing data. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: `${HOW_TITLE} · Kustom` };

export default async function How() {
  const data = await landingData();
  return <HowPage demo={data.demo} calibration={data.calibration} />;
}
