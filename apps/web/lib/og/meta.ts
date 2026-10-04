import type { Metadata } from 'next';
import { PAGE_DESCRIPTION, PAGE_TITLE } from '../landing/copy';
import { joinCardModel, kustomCardModel } from './cards';
import { joinShareTitle } from './titles';

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
/** A group's tonight card (M13.9): `/og/g/<slug>/tonight`. `/og/tonight` 308s to the original group's. */
export const tonightImagePath = (slug: string): string => `/og/g/${encodeURIComponent(slug)}/tonight`;
/** A game's card (M13.11, moved by M14.16): `/og/g/<slug>/games/<id>`. `/og/g/<id>` 308s here. */
export const gameImagePath = (slug: string, gameId: string): string =>
  `/og/g/${encodeURIComponent(slug)}/games/${encodeURIComponent(gameId)}`;
export const playerImagePath = (slug: string, puuid: string): string =>
  `/og/g/${encodeURIComponent(slug)}/p/${encodeURIComponent(puuid)}`;

/**
 * `og:image` (absolute, 1200×630, PNG) and `twitter:card` `summary_large_image` for one page.
 * `alt` is the card's own text: the strings painted on it, joined.
 */
export function shareMetadata(
  imagePath: string,
  alt: string,
  text: ShareText = {},
  base: URL = siteMetadataBase(),
): Metadata {
  const url = new URL(imagePath, base).toString();
  return {
    openGraph: { ...text, images: [{ url, ...OG_SIZE, alt, type: 'image/png' }] },
    twitter: { card: 'summary_large_image', ...text, images: [{ url, alt }] },
  };
}

/**
 * The unfurl's own title and description, when they differ from the tab's (M14.42): Tonight's tab is
 * `Tonight · <Group> · Kustom` but its preview reads `<Group> tonight · Kustom`. Left out, Next
 * copies the page's `<title>` and description into both.
 */
export interface ShareText {
  title?: string;
  description?: string;
}

/** The plain Kustom card (M14.42): `/`, `/about` and a dead invite. */
export const KUSTOM_IMAGE_PATH = '/og/kustom';

/** A card's alt: the strings painted on it, joined (the rule {@link shareMetadata} states). */
export const cardAlt = (card: { headline: string; sentence: string }): string =>
  `${card.headline} ${card.sentence}`;

/**
 * `/`, `/about` and a dead invite's preview (M14.42, scene-walk gap 9): `Kustom: fair teams for your
 * League customs`, the positioning line, and the plain Kustom card. Names no group.
 */
export function kustomShareMetadata(): Metadata {
  return shareMetadata(KUSTOM_IMAGE_PATH, cardAlt(kustomCardModel()), {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  });
}
/** A live invite's card (M14.42), by the group's slug, never by the invite code. */
export const joinImagePath = (slug: string): string => `/og/g/${encodeURIComponent(slug)}/join`;

/** `/join/<code>`'s tab title, live or dead: names no group, so a dead code gives nothing away. */
export const JOIN_TAB_TITLE = 'Join your group · Kustom';

/**
 * `/join/<code>`'s metadata (M14.42, scene-walk gap 9). A live code: `Join <Group> on Kustom`, the
 * join page's pitch, and the group's invite card. A dead one (`null`): the plain Kustom preview,
 * naming no group. Never indexed either way: a live invite in a search index would be an open door.
 */
export function joinMetadata(group: { slug: string; name: string } | null): Metadata {
  const robots = { index: false, follow: false };
  if (group === null) return { title: JOIN_TAB_TITLE, robots, ...kustomShareMetadata() };
  const card = joinCardModel(group.name);
  const title = joinShareTitle(group.name);
  return {
    title,
    description: card.sentence,
    robots,
    ...shareMetadata(joinImagePath(group.slug), cardAlt(card), { title, description: card.sentence }),
  };
}
