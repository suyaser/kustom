/**
 * Champion -> region, at Data Dragon 16.19.1 (M15.9). Region wars reads it (M15.10).
 *
 * Seeded once, offline, by `scripts/seed-regions.ts` from Meraki Analytics' lolstaticdata (MIT),
 * which takes it from the League of Legends Wiki; spot-checked against Riot's Universe site. The
 * script's header names the exact build. Do not edit by hand and never load this data at runtime:
 * a pin bump adds the new champions through the script.
 *
 * Words only: no crest, art or lore text (M15's rule, 05-design 8.10). Plain data with no imports,
 * so client panels may read it.
 *
 * Keyed by the numeric champion key (`game_players.champion_id`). `unaffiliated` is a real
 * region slug, a champion with no home region (never drawn, breaks any region rule); a key with no
 * row answers `null` (couldn't check). The Kustom home regions (M20 D1) sit beside this table in
 * `homeRegions.ts`, hand-kept and never written by the script; the champions per region, Universe
 * and with homes, are pinned in `regions.test.ts`.
 */

export type RegionId =
  | 'bandle-city'
  | 'bilgewater'
  | 'demacia'
  | 'freljord'
  | 'ionia'
  | 'ixtal'
  | 'mount-targon'
  | 'noxus'
  | 'piltover'
  | 'shadow-isles'
  | 'shurima'
  | 'void'
  | 'zaun'
  | 'unaffiliated';

/** Every region slug, `unaffiliated` last. */
export const REGION_IDS: readonly RegionId[] = [
  'bandle-city',
  'bilgewater',
  'demacia',
  'freljord',
  'ionia',
  'ixtal',
  'mount-targon',
  'noxus',
  'piltover',
  'shadow-isles',
  'shurima',
  'void',
  'zaun',
  'unaffiliated',
];

/** A region's display name: plain words. */
export const REGION_NAMES: Readonly<Record<RegionId, string>> = {
  'bandle-city': 'Bandle City',
  bilgewater: 'Bilgewater',
  demacia: 'Demacia',
  freljord: 'Freljord',
  ionia: 'Ionia',
  ixtal: 'Ixtal',
  'mount-targon': 'Targon',
  noxus: 'Noxus',
  piltover: 'Piltover',
  'shadow-isles': 'Shadow Isles',
  shurima: 'Shurima',
  void: 'The Void',
  zaun: 'Zaun',
  unaffiliated: 'Unaffiliated',
};

/** The credit line the region panel shows (M15.10, brief section 4; M20.1's words). */
export const REGION_CREDIT =
  "Regions from Meraki's lolstaticdata and the League of Legends Wiki. Where a champion has two, the second is our own call.";

const CHAMPION_REGIONS: Readonly<Record<number, RegionId>> = {
  1: 'unaffiliated', // Annie
  2: 'freljord', // Olaf
  3: 'demacia', // Galio
  4: 'bilgewater', // TwistedFate
  5: 'demacia', // XinZhao
  6: 'zaun', // Urgot
  7: 'noxus', // Leblanc
  8: 'noxus', // Vladimir
  9: 'unaffiliated', // Fiddlesticks
  10: 'demacia', // Kayle
  11: 'ionia', // MasterYi
  12: 'unaffiliated', // Alistar
  13: 'unaffiliated', // Ryze
  14: 'noxus', // Sion
  15: 'shurima', // Sivir
  16: 'mount-targon', // Soraka
  17: 'bandle-city', // Teemo
  18: 'bandle-city', // Tristana
  19: 'zaun', // Warwick
  20: 'freljord', // Nunu
  21: 'bilgewater', // MissFortune
  22: 'freljord', // Ashe
  23: 'freljord', // Tryndamere
  24: 'unaffiliated', // Jax
  25: 'demacia', // Morgana
  26: 'unaffiliated', // Zilean
  27: 'zaun', // Singed
  28: 'unaffiliated', // Evelynn
  29: 'zaun', // Twitch
  30: 'shadow-isles', // Karthus
  31: 'void', // Chogath
  32: 'shurima', // Amumu
  33: 'shurima', // Rammus
  34: 'freljord', // Anivia
  35: 'unaffiliated', // Shaco
  36: 'zaun', // DrMundo
  37: 'demacia', // Sona
  38: 'void', // Kassadin
  39: 'ionia', // Irelia
  40: 'zaun', // Janna
  41: 'bilgewater', // Gangplank
  42: 'bandle-city', // Corki
  43: 'ionia', // Karma
  44: 'mount-targon', // Taric
  45: 'bandle-city', // Veigar
  48: 'freljord', // Trundle
  50: 'noxus', // Swain
  51: 'piltover', // Caitlyn
  53: 'zaun', // Blitzcrank
  54: 'ixtal', // Malphite
  55: 'noxus', // Katarina
  56: 'unaffiliated', // Nocturne
  57: 'shadow-isles', // Maokai
  58: 'shurima', // Renekton
  59: 'demacia', // JarvanIV
  60: 'shadow-isles', // Elise
  61: 'piltover', // Orianna
  62: 'ionia', // MonkeyKing
  63: 'unaffiliated', // Brand
  64: 'ionia', // LeeSin
  67: 'demacia', // Vayne
  68: 'bandle-city', // Rumble
  69: 'noxus', // Cassiopeia
  72: 'ixtal', // Skarner
  74: 'piltover', // Heimerdinger
  75: 'shurima', // Nasus
  76: 'ixtal', // Nidalee
  77: 'freljord', // Udyr
  78: 'demacia', // Poppy
  79: 'freljord', // Gragas
  80: 'mount-targon', // Pantheon
  81: 'piltover', // Ezreal
  82: 'noxus', // Mordekaiser
  83: 'shadow-isles', // Yorick
  84: 'ionia', // Akali
  85: 'ionia', // Kennen
  86: 'demacia', // Garen
  89: 'mount-targon', // Leona
  90: 'void', // Malzahar
  91: 'noxus', // Talon
  92: 'noxus', // Riven
  96: 'void', // KogMaw
  98: 'ionia', // Shen
  99: 'demacia', // Lux
  101: 'shurima', // Xerath
  102: 'demacia', // Shyvana
  103: 'ionia', // Ahri
  104: 'bilgewater', // Graves
  105: 'unaffiliated', // Fizz
  106: 'freljord', // Volibear
  107: 'ixtal', // Rengar
  110: 'ionia', // Varus
  111: 'bilgewater', // Nautilus
  112: 'zaun', // Viktor
  113: 'freljord', // Sejuani
  114: 'demacia', // Fiora
  115: 'zaun', // Ziggs
  117: 'bandle-city', // Lulu
  119: 'noxus', // Draven
  120: 'shadow-isles', // Hecarim
  121: 'void', // Khazix
  122: 'noxus', // Darius
  126: 'piltover', // Jayce
  127: 'freljord', // Lissandra
  131: 'mount-targon', // Diana
  133: 'demacia', // Quinn
  134: 'ionia', // Syndra
  136: 'unaffiliated', // AurelionSol
  141: 'ionia', // Kayn
  142: 'mount-targon', // Zoe
  143: 'ixtal', // Zyra
  145: 'void', // Kaisa
  147: 'piltover', // Seraphine
  150: 'freljord', // Gnar
  154: 'zaun', // Zac
  157: 'ionia', // Yasuo
  161: 'void', // Velkoz
  163: 'shurima', // Taliyah
  164: 'piltover', // Camille
  166: 'shurima', // Akshan
  200: 'void', // Belveth
  201: 'freljord', // Braum
  202: 'ionia', // Jhin
  203: 'unaffiliated', // Kindred
  221: 'zaun', // Zeri
  222: 'zaun', // Jinx
  223: 'unaffiliated', // TahmKench
  233: 'noxus', // Briar
  234: 'shadow-isles', // Viego
  235: 'unaffiliated', // Senna
  236: 'unaffiliated', // Lucian
  238: 'ionia', // Zed
  240: 'noxus', // Kled
  245: 'zaun', // Ekko
  246: 'ixtal', // Qiyana
  254: 'piltover', // Vi
  266: 'unaffiliated', // Aatrox
  267: 'unaffiliated', // Nami
  268: 'shurima', // Azir
  350: 'bandle-city', // Yuumi
  360: 'noxus', // Samira
  412: 'shadow-isles', // Thresh
  420: 'bilgewater', // Illaoi
  421: 'void', // RekSai
  427: 'ionia', // Ivern
  429: 'shadow-isles', // Kalista
  432: 'unaffiliated', // Bard
  497: 'ionia', // Rakan
  498: 'ionia', // Xayah
  516: 'freljord', // Ornn
  517: 'demacia', // Sylas
  518: 'ixtal', // Neeko
  523: 'mount-targon', // Aphelios
  526: 'noxus', // Rell
  555: 'bilgewater', // Pyke
  711: 'shadow-isles', // Vex
  777: 'ionia', // Yone
  799: 'noxus', // Ambessa
  800: 'noxus', // Mel
  804: 'ionia', // Yunara
  805: 'demacia', // Locke (Universe, 2026-10-04)
  875: 'ionia', // Sett
  876: 'ionia', // Lillia
  887: 'shadow-isles', // Gwen
  888: 'zaun', // Renata
  893: 'freljord', // Aurora
  895: 'bilgewater', // Nilah
  897: 'shurima', // KSante
  901: 'unaffiliated', // Smolder
  902: 'ixtal', // Milio
  904: 'unaffiliated', // Zaahen (Universe, 2026-10-04)
  910: 'ionia', // Hwei
  950: 'shurima', // Naafiri
};

/** A champion's region slug; `null` for a key with no row (a champion newer than the table). */
export function championRegion(id: number): RegionId | null {
  return Object.hasOwn(CHAMPION_REGIONS, id) ? (CHAMPION_REGIONS[id] ?? null) : null;
}

/** A region's display name, e.g. `Shadow Isles`. */
export function regionName(region: RegionId): string {
  return REGION_NAMES[region];
}

/** Every key the table has, ascending. */
export function regionChampionIds(): number[] {
  return Object.keys(CHAMPION_REGIONS)
    .map(Number)
    .sort((a, b) => a - b);
}
