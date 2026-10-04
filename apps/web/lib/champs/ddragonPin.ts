/**
 * Data Dragon's pin and sheet URLs, with no tables (M14.45): what Tonight's client code needs to
 * preload the sprite sheets on intent, without pulling the champion id and sprite-cell tables into
 * Tonight's bundle. `ddragon.ts` re-exports all of it; import from there everywhere else.
 */

/** Picked from https://ddragon.leagueoflegends.com/api/versions.json on 2026-10-03. */
export const DDRAGON_VERSION = '16.19.1';

/** The origin the icons load from, for `<link rel="preconnect">`. */
export const DDRAGON_ORIGIN = 'https://ddragon.leagueoflegends.com';

/** The six sprite sheets at the pin (05-design.md 8.8): 480 x 144 each, 48px cells. */
export const DDRAGON_SPRITE_SHEETS = 6;

export function ddragonSpriteSheetUrl(sheet: number): string {
  return `${DDRAGON_ORIGIN}/cdn/${DDRAGON_VERSION}/img/sprite/champion${sheet}.png`;
}
