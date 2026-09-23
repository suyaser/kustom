/**
 * Champion id → display name. `/fun` reads ids off `games.raw` (bans, first blood)
 * and needs a word, not `35`. The client already stores the name on an end-of-game
 * block; this table covers match-history raw, which only has the id.
 *
 * Not Data Dragon and not an asset pipeline. A missing id prints `Champion ${id}`
 * until the next roster pass adds it.
 *
 * `championIconUrl` (M11.1) reads the same ids: a Community Dragon URL for an id this
 * table names, fetched by the browser at runtime. Still no asset pipeline, no vendored
 * PNGs, no proxy. Only the fearless card on `/` draws it.
 */

const CHAMPIONS: Record<number, string> = {
  1: 'Annie',
  2: 'Olaf',
  3: 'Galio',
  4: 'Twisted Fate',
  5: 'Xin Zhao',
  6: 'Urgot',
  7: 'LeBlanc',
  8: 'Vladimir',
  9: 'Fiddlesticks',
  10: 'Kayle',
  11: 'Master Yi',
  12: 'Alistar',
  13: 'Ryze',
  14: 'Sion',
  15: 'Sivir',
  16: 'Soraka',
  17: 'Teemo',
  18: 'Tristana',
  19: 'Warwick',
  20: 'Nunu',
  21: 'Miss Fortune',
  22: 'Ashe',
  23: 'Tryndamere',
  24: 'Jax',
  25: 'Morgana',
  26: 'Zilean',
  27: 'Singed',
  28: 'Evelynn',
  29: 'Twitch',
  30: 'Karthus',
  31: "Cho'Gath",
  32: 'Amumu',
  33: 'Rammus',
  34: 'Anivia',
  35: 'Shaco',
  36: 'Dr. Mundo',
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
  59: 'Jarvan IV',
  60: 'Elise',
  61: 'Orianna',
  62: 'Wukong',
  63: 'Brand',
  64: 'Lee Sin',
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
  96: "Kog'Maw",
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
  121: "Kha'Zix",
  122: 'Darius',
  126: 'Jayce',
  127: 'Lissandra',
  131: 'Diana',
  133: 'Quinn',
  134: 'Syndra',
  136: 'Aurelion Sol',
  141: 'Kayn',
  142: 'Zoe',
  143: 'Zyra',
  145: "Kai'Sa",
  147: 'Seraphine',
  150: 'Gnar',
  154: 'Zac',
  157: 'Yasuo',
  161: "Vel'Koz",
  163: 'Taliyah',
  164: 'Camille',
  166: 'Akshan',
  200: "Bel'Veth",
  201: 'Braum',
  202: 'Jhin',
  203: 'Kindred',
  221: 'Zeri',
  222: 'Jinx',
  223: 'Tahm Kench',
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
  421: "Rek'Sai",
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
  875: 'Sett',
  876: 'Lillia',
  887: 'Gwen',
  888: 'Renata Glasc',
  893: 'Aurora',
  895: 'Nilah',
  897: "K'Sante",
  901: 'Smolder',
  902: 'Milio',
  910: 'Hwei',
  950: 'Naafiri',
};

/** Every id this table names, ascending. Fearless uses it for who is still open. */
export function listChampions(): readonly { id: number; name: string }[] {
  return Object.entries(CHAMPIONS)
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.id - b.id);
}

const CHAMPION_ICON_BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons';

/** Square icon for a named champion, or `null` for an id this table does not know. */
export function championIconUrl(id: number): string | null {
  if (!Number.isInteger(id) || CHAMPIONS[id] === undefined) return null;
  return `${CHAMPION_ICON_BASE}/${id}.png`;
}

/** A skipped draft slot. Match history stores this as `championId: -1`. */
export const NO_BAN = -1;

export function championName(id: number | null | undefined, fallback: string | null = null): string {
  if (id === null || id === undefined || id === NO_BAN) return fallback ?? 'Unknown';
  return CHAMPIONS[id] ?? fallback ?? `Champion ${id}`;
}

/**
 * The word a scoreboard prints, or `null` when the row never named a champion.
 * Prefers the client's own `championName` on an end-of-game block.
 */
export function championLabel(
  id: number | null | undefined,
  storedName: string | null | undefined = null,
): string | null {
  const stored = storedName?.trim() ?? '';
  if (stored !== '') return stored;
  if (id === null || id === undefined || id === NO_BAN) return null;
  return championName(id);
}
