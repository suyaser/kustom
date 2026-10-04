import type { Metadata } from 'next';
import { DownloadPage } from '@/components/landing/DownloadPage';
import { DOWNLOAD_TITLE } from '@/lib/landing/copy';

/**
 * `/download`, Get Kustom (M14.24). Dynamic only because the bare shell's top bar reads the
 * session (`Sign in` / `Sign out`); `currentSessionPlayer` swallows the build-time cookies error,
 * so without this the page would prerender with `Sign in` for everybody.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: `${DOWNLOAD_TITLE} · Kustom` };

export default function Download() {
  return <DownloadPage />;
}
