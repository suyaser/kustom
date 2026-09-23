import type { Metadata } from 'next';

/** Every share card is this size (05-design.md, "Share cards — Open Graph images"). */
export const OG_SIZE = { width: 1200, height: 630 } as const;

/**
 * The origin every `og:image` is made absolute against. WhatsApp and Discord do not resolve a
 * relative image URL, so this never returns a path: `NEXT_PUBLIC_SITE_URL` when it is set (the
 * value a hosted deploy pins), then Vercel's own production and deployment hosts, then the dev
 * server's.
 */
export function siteMetadataBase(env: Record<string, string | undefined> = process.env): URL {
  const configured = env.NEXT_PUBLIC_SITE_URL;
  if (configured && URL.canParse(configured)) return new URL(configured);
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL('http://localhost:3000');
}

/** The image routes, one per card. Route handlers, not `opengraph-image` files, so nothing cascades. */
export const tonightImagePath = (): string => '/og/tonight';
export const gameImagePath = (gameId: string): string => `/og/g/${encodeURIComponent(gameId)}`;
export const playerImagePath = (puuid: string): string => `/og/p/${encodeURIComponent(puuid)}`;

/**
 * `og:image` (absolute, 1200×630, PNG) and `twitter:card` `summary_large_image` for one page.
 * `alt` is the card's own text: the strings painted on it, joined.
 */
export function shareMetadata(imagePath: string, alt: string, base: URL = siteMetadataBase()): Metadata {
  const url = new URL(imagePath, base).toString();
  return {
    openGraph: { images: [{ url, ...OG_SIZE, alt, type: 'image/png' }] },
    twitter: { card: 'summary_large_image', images: [{ url, alt }] },
  };
}
