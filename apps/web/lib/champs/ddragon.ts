/**
 * Data Dragon, Riot's static asset CDN, at one pinned version (M14.8).
 *
 * Riot's developer policies list Data Dragon as the asset source to use. It is a static CDN
 * with no key, not the Riot public API ("No Riot public API" stands). The version is pinned, not
 * `latest`, so an icon never moves under us between patches. Bumping it is three edits that
 * `ddragon.test.ts` holds together: this constant, a fresh `fixtures/ddragon-<version>-champion.json`
 * (trimmed to id/key/name/image full+sprite+x+y, plus tags and stats.attackrange since M15.4; written
 * by `pnpm --filter web ddragon-fixture` with `tags.ts`), and the tables regenerated from it (this one
 * and `spriteCells.ts`, M14.30).
 *
 * Only the fearless pool draws champion icons ("The fearless icon exception",
 * docs/05-design.md). Nothing here fetches: the browser loads the PNG.
 */

import { DDRAGON_ORIGIN, DDRAGON_VERSION, ddragonSpriteSheetUrl } from './ddragonPin';
import { CHAMPION_SPRITE_CELLS } from './spriteCells';

// The pin itself lives in `ddragonPin.ts` (M14.45), so client code can reach the sheet URLs
// without these tables; it is re-exported here and this is still where it is read from.
export { DDRAGON_ORIGIN, DDRAGON_SPRITE_SHEETS, DDRAGON_VERSION, ddragonSpriteSheetUrl } from './ddragonPin';

/**
 * Numeric champion key (what the client and `games.raw` carry) to Data Dragon id, which is the
 * image file name. Every champion the pinned version ships, copied from its `champion.json`.
 * Most ids are the name without punctuation; the odd ones are why this is a table and not a
 * rule: Wukong is `MonkeyKing`, Nunu & Willump `Nunu`, Renata Glasc `Renata`, LeBlanc
 * `Leblanc`, Kai'Sa `Kaisa`, Bel'Veth `Belveth`, Cho'Gath `Chogath`, Kha'Zix `Khazix`,
 * Vel'Koz `Velkoz`.
 */
const DDRAGON_CHAMPION_IDS: Readonly<Record<number, string>> = {
  1: 'Annie',
  2: 'Olaf',
  3: 'Galio',
  4: 'TwistedFate',
  5: 'XinZhao',
  6: 'Urgot',
  7: 'Leblanc',
  8: 'Vladimir',
  9: 'Fiddlesticks',
  10: 'Kayle',
  11: 'MasterYi',
  12: 'Alistar',
  13: 'Ryze',
  14: 'Sion',
  15: 'Sivir',
  16: 'Soraka',
  17: 'Teemo',
  18: 'Tristana',
  19: 'Warwick',
  20: 'Nunu',
  21: 'MissFortune',
  22: 'Ashe',
  23: 'Tryndamere',
  24: 'Jax',
  25: 'Morgana',
  26: 'Zilean',
  27: 'Singed',
  28: 'Evelynn',
  29: 'Twitch',
  30: 'Karthus',
  31: 'Chogath',
  32: 'Amumu',
  33: 'Rammus',
  34: 'Anivia',
  35: 'Shaco',
  36: 'DrMundo',
  37: 'Sona',
  38: 'Kassadin',
  39: 'Irelia',
  40: 'Janna',
  41: 'Gangplank',
  42: 'Corki',
  43: 'Karma',
  44: 'Taric',
  45: 'Veigar',
  48: 'Trundle',
  50: 'Swain',
  51: 'Caitlyn',
  53: 'Blitzcrank',
  54: 'Malphite',
  55: 'Katarina',
  56: 'Nocturne',
  57: 'Maokai',
  58: 'Renekton',
  59: 'JarvanIV',
  60: 'Elise',
  61: 'Orianna',
  62: 'MonkeyKing',
  63: 'Brand',
  64: 'LeeSin',
  67: 'Vayne',
  68: 'Rumble',
  69: 'Cassiopeia',
  72: 'Skarner',
  74: 'Heimerdinger',
  75: 'Nasus',
  76: 'Nidalee',
  77: 'Udyr',
  78: 'Poppy',
  79: 'Gragas',
  80: 'Pantheon',
  81: 'Ezreal',
  82: 'Mordekaiser',
  83: 'Yorick',
  84: 'Akali',
  85: 'Kennen',
  86: 'Garen',
  89: 'Leona',
  90: 'Malzahar',
  91: 'Talon',
  92: 'Riven',
  96: 'KogMaw',
  98: 'Shen',
  99: 'Lux',
  101: 'Xerath',
  102: 'Shyvana',
  103: 'Ahri',
  104: 'Graves',
  105: 'Fizz',
  106: 'Volibear',
  107: 'Rengar',
  110: 'Varus',
  111: 'Nautilus',
  112: 'Viktor',
  113: 'Sejuani',
  114: 'Fiora',
  115: 'Ziggs',
  117: 'Lulu',
  119: 'Draven',
  120: 'Hecarim',
  121: 'Khazix',
  122: 'Darius',
  126: 'Jayce',
  127: 'Lissandra',
  131: 'Diana',
  133: 'Quinn',
  134: 'Syndra',
  136: 'AurelionSol',
  141: 'Kayn',
  142: 'Zoe',
  143: 'Zyra',
  145: 'Kaisa',
  147: 'Seraphine',
  150: 'Gnar',
  154: 'Zac',
  157: 'Yasuo',
  161: 'Velkoz',
  163: 'Taliyah',
  164: 'Camille',
  166: 'Akshan',
  200: 'Belveth',
  201: 'Braum',
  202: 'Jhin',
  203: 'Kindred',
  221: 'Zeri',
  222: 'Jinx',
  223: 'TahmKench',
  233: 'Briar',
  234: 'Viego',
  235: 'Senna',
  236: 'Lucian',
  238: 'Zed',
  240: 'Kled',
  245: 'Ekko',
  246: 'Qiyana',
  254: 'Vi',
  266: 'Aatrox',
  267: 'Nami',
  268: 'Azir',
  350: 'Yuumi',
  360: 'Samira',
  412: 'Thresh',
  420: 'Illaoi',
  421: 'RekSai',
  427: 'Ivern',
  429: 'Kalista',
  432: 'Bard',
  497: 'Rakan',
  498: 'Xayah',
  516: 'Ornn',
  517: 'Sylas',
  518: 'Neeko',
  523: 'Aphelios',
  526: 'Rell',
  555: 'Pyke',
  711: 'Vex',
  777: 'Yone',
  799: 'Ambessa',
  800: 'Mel',
  804: 'Yunara',
  805: 'Locke',
  875: 'Sett',
  876: 'Lillia',
  887: 'Gwen',
  888: 'Renata',
  893: 'Aurora',
  895: 'Nilah',
  897: 'KSante',
  901: 'Smolder',
  902: 'Milio',
  904: 'Zaahen',
  910: 'Hwei',
  950: 'Naafiri',
};

/** The Data Dragon id for a numeric key, or `null` when the pinned version has no such champion. */
export function ddragonChampionId(key: number): string | null {
  if (!Number.isInteger(key)) return null;
  return DDRAGON_CHAMPION_IDS[key] ?? null;
}

/** Every numeric key the pinned version ships, ascending. */
export function ddragonChampionKeys(): readonly number[] {
  return Object.keys(DDRAGON_CHAMPION_IDS)
    .map(Number)
    .sort((a, b) => a - b);
}

/** The square icon at the pinned version, or `null` when the pinned version has no such champion. */
export function ddragonChampionIconUrl(key: number): string | null {
  const id = ddragonChampionId(key);
  return id === null ? null : `${DDRAGON_ORIGIN}/cdn/${DDRAGON_VERSION}/img/champion/${id}.png`;
}

/** One champion's 48px cell on a sprite sheet. */
export interface ChampionSprite {
  sheet: number;
  /** Pixel offset of the 48px cell on its 480 x 144 sheet. */
  x: number;
  y: number;
}

/** The size the web draws an icon at (05-design.md 8.7.3): 24px, exactly half a 48px cell. */
export const CHAMPION_ICON_PX = 24;

/** CSS for a {@link CHAMPION_ICON_PX} icon cut from its sheet: the sheet scaled to match, and the offset. */
export interface ChampionSpriteStyle {
  sheetUrl: string;
  backgroundSize: string;
  backgroundPosition: string;
}

/** `championSprite`, scaled to the drawn size: `null` for a key the pinned version does not ship. */
export function championSpriteStyle(
  key: number,
  size: number = CHAMPION_ICON_PX,
): ChampionSpriteStyle | null {
  const cell = championSprite(key);
  if (cell === null) return null;
  const scale = size / 48;
  return {
    sheetUrl: ddragonSpriteSheetUrl(cell.sheet),
    backgroundSize: `${480 * scale}px ${144 * scale}px`,
    backgroundPosition: `-${cell.x * scale}px -${cell.y * scale}px`,
  };
}

/**
 * Where a champion sits on Data Dragon's sprite sheets at the pin (M14.30; on the web this replaces
 * one image per champion: 6 sheets, 842 KB, against ~4.9 MB). `null` for a key the pinned version
 * does not ship: the chip is then name-only, with no icon box. The overlay API keeps
 * {@link ddragonChampionIconUrl} (its payload is untouched while the companion UI is deferred).
 */
export function championSprite(key: number): ChampionSprite | null {
  if (!Number.isInteger(key)) return null;
  const cell = CHAMPION_SPRITE_CELLS[key];
  return cell === undefined ? null : { sheet: cell[0], x: cell[1], y: cell[2] };
}
