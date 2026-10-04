import { CHAMPION_ICON_PX, ddragonChampionIconUrl } from './ddragon';

/**
 * A champion's own square through Next's image optimizer (M14.45): the Mode card on Tonight shows
 * at most ten icons, so it draws them one by one rather than downloading the six sprite sheets.
 * Data Dragon's square is 120px and ~28 KB as PNG; at the drawn 24px the optimizer serves a 32px
 * (1×) or 48px (2×) WebP of about 1 KB.
 *
 * The URL is the default loader's (`/_next/image?url=…&w=…&q=…`), written out here instead of
 * importing `next/image`'s `getImageProps`: that import pulls next/image's client component into
 * every bundle the chip reaches (Tonight's and the panel's). The widths must be in Next's default
 * `imageSizes` and the quality in its default `qualities`, and the source host in
 * `images.remotePatterns` (`next.config.ts`); `square.test.ts` holds them together.
 */

/** Next's default `imageSizes` entries at 1× and 2× of {@link CHAMPION_ICON_PX} (24 → 32, 48). */
export const SQUARE_WIDTHS = { x1: 32, x2: 48 } as const;
/** Next's default (and only allowed) quality. */
export const SQUARE_QUALITY = 75;

export function optimizedImageUrl(src: string, width: number): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${SQUARE_QUALITY}`;
}

export interface ChampionSquare {
  src: string;
  srcSet: string;
  size: number;
}

/** `null` for a key the pinned version does not ship: the chip then has no icon box. */
export function championSquare(key: number): ChampionSquare | null {
  const source = ddragonChampionIconUrl(key);
  if (source === null) return null;
  return {
    src: optimizedImageUrl(source, SQUARE_WIDTHS.x2),
    srcSet: `${optimizedImageUrl(source, SQUARE_WIDTHS.x1)} 1x, ${optimizedImageUrl(source, SQUARE_WIDTHS.x2)} 2x`,
    size: CHAMPION_ICON_PX,
  };
}
