import { preconnect, preload } from 'react-dom';
import { DDRAGON_ORIGIN, DDRAGON_SPRITE_SHEETS, ddragonSpriteSheetUrl } from '@/lib/champs/ddragonPin';

/**
 * The six sprite sheets (05-design.md 8.8), as `<link rel="preload" as="image">`, so the panel paints
 * its icons on open. Called by the panel when it renders (server or client) and, since M14.45, by
 * the Mode card's links on intent (`SpriteIntent`, handed `spriteSheetUrls()`); never by Tonight's render. `preload` dedupes
 * and React hoists it into `<head>`, on the server and from a client event handler alike.
 */
export function preloadChampionSprites(): void {
  preconnectDataDragon();
  for (const href of spriteSheetUrls()) preload(href, { as: 'image', fetchPriority: 'low' });
}

/** The six sheets' URLs at the pin, in order. */
export function spriteSheetUrls(): string[] {
  return Array.from({ length: DDRAGON_SPRITE_SHEETS }, (_, sheet) => ddragonSpriteSheetUrl(sheet));
}

/** The connection to Data Dragon, opened early wherever Fearless shows (8.8). */
export function preconnectDataDragon(): void {
  preconnect(DDRAGON_ORIGIN);
}
