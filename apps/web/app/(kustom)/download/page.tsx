import type { Metadata } from 'next';
import { DownloadPage } from '@/components/landing/DownloadPage';
import { DOWNLOAD_TITLE } from '@/lib/landing/copy';

/**
 * `/download`, Get Kustom (M14.24). Static (M19.18): nothing on it depends on who is asking, so the
 * build prerenders it and the CDN serves it. The top bar's `Sign in` / `Sign out` is the
 * `KustomSignIn` client island, which asks the server after hydration. Was `force-dynamic` for that
 * one control, a function invocation per hit.
 */
export const metadata: Metadata = { title: `${DOWNLOAD_TITLE} · Kustom` };

export default function Download() {
  return <DownloadPage />;
}
