import { headers } from 'next/headers';

/**
 * The host this site answers on, for a server component that prints a link people will type or
 * paste (`Group created. Your link: kustom.gg/g/<slug>`, the invite link). `NEXT_PUBLIC_SITE_URL`
 * when it is set, the value a hosted deploy pins (`lib/siteUrl.ts`), else the request's own host.
 */
export async function pageOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && URL.canParse(configured)) return new URL(configured).origin;
  const store = await headers();
  const host = store.get('x-forwarded-host')?.split(',')[0]?.trim() || store.get('host') || 'localhost:3000';
  const proto =
    store.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** `https://kustom.gg` → `kustom.gg`: the way people say a link out loud. */
export function bareHost(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
