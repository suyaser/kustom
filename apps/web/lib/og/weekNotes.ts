import type { RoleValue } from '@customs/db';
import { formatWebDelta } from '../ratingDisplay';
import { renderWebName } from '../tonight/copy';
import type { PlayerName } from '../tonight/types';

/**
 * The "Week N notes" image's text (M14.79; variant A of `redesign/research/patch-image.md`): the
 * 1920×1080 patch-board picture the Sunday post carries under the board. Every string the card
 * paints is decided here, from the week the loader read (`weekNotesLoad.ts`); the card
 * (`app/_og/WeekNotes.tsx`) only lays it out. Pure, so the rules are unit tests.
 *
 * - **BUFFS**: the week's top point gainers (net points > 0, the board's own number and order), up
 *   to {@link BUFFS_MAX}.
 * - **NERFS**: up to {@link NERFS_MAX} who gave points back, only with {@link NERFS_MIN_GAMES}+ rated
 *   games that week and never a settling player (newcomers go under NEW). Nobody is ever in NERFS
 *   alone: under {@link NERFS_MIN_ROWS} qualifying, the section is not drawn. Plain numbers.
 * - **SYSTEMS**: the week's Mode of the night runs and the Fearless list.
 * - **NEW**: first nights, group records set this week, first picks for the group; topped up with
 *   the week's awards when there is room.
 *
 * **No PUUID ever reaches the model**: players arrive keyed by puuid (the loader's join key) and
 * leave as initials, a name and numbers. No champion art, no Riot mark: champion *names* only.
 */

export const BUFFS_MAX = 5;
export const NERFS_MAX = 3;
export const NERFS_MIN_GAMES = 3;
export const NERFS_MIN_ROWS = 2;
/** Tiles under NEW: the right column's room. */
export const NEW_MAX = 3;
/** Champion names a first-picks tile spells out before `+N`. */
export const FIRST_PICKS_NAMED = 3;
/** First nights a tile names before `+N`. */
const FIRST_NIGHTS_NAMED = 2;

/* ---------------------------------------------------------------------------
 * Copy (research §5; [NEW COPY] marked)
 * ------------------------------------------------------------------------- */

export const WEEK_NOTES_COPY = {
  notes: 'NOTES',
  buffs: 'BUFFS',
  buffsSub: 'most points this week',
  /** [NEW COPY] A week where nobody finished up. */
  buffsEmpty: 'Nobody finished the week up.',
  nerfs: 'NERFS',
  nerfsSub: 'gave some points back',
  key: 'KEY',
  keyLine: 'Points: Rating won or lost in the week’s games. Mark: most-played role.',
  systems: 'SYSTEMS',
  /** [NEW COPY] No rule game and no Fearless game all week. */
  systemsEmpty: 'Plain customs all week.',
  modeLabel: 'MODE OF THE NIGHT',
  fearlessLabel: 'FEARLESS',
  news: 'NEW',
  /** [NEW COPY] Nothing new and no award won. */
  newsEmpty: 'Nothing new this week.',
  firstNight: 'FIRST NIGHT',
  /** [NEW COPY] The plural label. */
  firstNights: 'FIRST NIGHTS',
  /** [NEW COPY] The sub line under two or more first nights. */
  firstNightsSub: 'first games in the group',
  record: 'RECORD',
  firstPicks: 'FIRST PICKS FOR THE GROUP',
  firstPicksSub: 'champions nobody here had played before',
  footer: 'Made by Kustom from this group’s own games. Not affiliated with or endorsed by Riot Games.',
} as const;

const ROLE_ORDER: readonly RoleValue[] = ['top', 'jungle', 'mid', 'adc', 'support'];

/* ---------------------------------------------------------------------------
 * Input: what the loader read
 * ------------------------------------------------------------------------- */

/** One row of the week board, with the week's most-played role. */
export interface WeekNotesPlayer {
  /** The join key. Never copied into the model. */
  puuid: string;
  /** The roster label's base (`lib/names/roster.ts`), as the board prints it. */
  name: PlayerName;
  /** The same-name suffix (`#EUW`, `(2)`), or null. */
  nameSuffix?: string | null | undefined;
  /** Net points in the week (the board's number). */
  points: number;
  wins: number;
  losses: number;
  /** Rated games in the week. */
  games: number;
  /** All-time rated games in the group (`ratings.games`), for `settling 4/10`. */
  ratedGames: number;
  /** The all-time settling chip. */
  settling: boolean;
  /** The role played most in the week's rated games, or null when none was detected. */
  role: RoleValue | null;
}

export interface WeekNotesFirstNight {
  puuid: string;
  /** `Tuesday`: the night of their first game in the group. */
  day: string;
}

export interface WeekNotesRecord {
  /** `Most damage`: the Records title, verbatim. */
  title: string;
  puuid: string;
  /** Used only when the holder is not on the week board. */
  name: PlayerName;
  /** `48,213 damage`: the Records value, verbatim. */
  valueLabel: string;
}

export interface WeekNotesMode {
  /** `Tanks only`, `Ionia vs Noxus`, `Mirror match` (`ruleRowName`). */
  name: string;
  count: number;
  /** False when none of these games moved a Rating. */
  rated: boolean;
}

export interface WeekNotesInput {
  group: string;
  /** Weeks since the group's first game, counting that week as 1: the group's own patch number. */
  weekNumber: number;
  /** `Sunday 27 Sep to Saturday 3 Oct`. */
  range: string;
  /** Counted (rated) games in the week. */
  games: number;
  /** Nights with a counted game. */
  nights: number;
  /** The week board's rows, in its order. */
  players: readonly WeekNotesPlayer[];
  firstNights: readonly WeekNotesFirstNight[];
  /** Group-best records whose game was this week, best first. */
  records: readonly WeekNotesRecord[];
  /** Champions first played in the group this week, in order of first pick. */
  firstPicks: readonly string[];
  modes: readonly WeekNotesMode[];
  /** The Fearless list, when the week had a rated Fearless game; else null. */
  fearless: { total: number; added: number; open: number } | null;
  /** The week's won awards (label and line, verbatim). */
  awards: readonly { label: string; line: string }[];
  /** SETTLING_GAMES from core, passed in to keep this file free of it. */
  settlingGames: number;
}

/* ---------------------------------------------------------------------------
 * Output: what the card paints
 * ------------------------------------------------------------------------- */

export interface WeekNotesMedal {
  initials: string;
  name: string;
  suffix: string | null;
  role: RoleValue | null;
  /** `+212`, `−61` (U+2212). */
  points: string;
  /** `5W 2L`. */
  record: string;
}

export interface WeekNotesTile {
  label: string;
  value: string;
  sub: string | null;
}

export interface WeekNotesModel {
  group: string;
  /** `WEEK 12`. */
  week: string;
  notes: string;
  range: string;
  /** `14 rated games · 4 nights`. */
  counts: string;
  buffs: { title: string; sub: string; medals: WeekNotesMedal[]; empty: string | null };
  /** Null: no section (fewer than {@link NERFS_MIN_ROWS} qualify). */
  nerfs: { title: string; sub: string; medals: WeekNotesMedal[] } | null;
  key: { title: string; roles: readonly RoleValue[]; line: string };
  systems: { title: string; tiles: WeekNotesTile[]; empty: string | null };
  news: { title: string; tiles: WeekNotesTile[]; empty: string | null };
  footer: string;
}

/* ---------------------------------------------------------------------------
 * The model
 * ------------------------------------------------------------------------- */

export function weekNotesModel(input: WeekNotesInput): WeekNotesModel {
  const byPuuid = new Map(input.players.map((player) => [player.puuid, player]));
  const C = WEEK_NOTES_COPY;

  const buffs = buffRows(input.players).map(medal);
  const nerfs = nerfRows(input.players).map(medal);
  const systems = systemTiles(input);
  const news = newTiles(input, byPuuid);

  return {
    group: input.group,
    week: `WEEK ${input.weekNumber}`,
    notes: C.notes,
    range: input.range,
    counts: `${plural(input.games, 'rated game')} · ${plural(input.nights, 'night')}`,
    buffs: {
      title: C.buffs,
      sub: C.buffsSub,
      medals: buffs,
      empty: buffs.length === 0 ? C.buffsEmpty : null,
    },
    nerfs: nerfs.length === 0 ? null : { title: C.nerfs, sub: C.nerfsSub, medals: nerfs },
    key: { title: C.key, roles: ROLE_ORDER, line: C.keyLine },
    systems: { title: C.systems, tiles: systems, empty: systems.length === 0 ? C.systemsEmpty : null },
    news: { title: C.news, tiles: news, empty: news.length === 0 ? C.newsEmpty : null },
    footer: C.footer,
  };
}

/** Net points above zero, most first (the board's order breaks ties). */
export function buffRows(players: readonly WeekNotesPlayer[]): WeekNotesPlayer[] {
  return stableSort(
    players.filter((player) => player.points > 0),
    (a, b) => b.points - a.points,
  ).slice(0, BUFFS_MAX);
}

/**
 * Net points below zero, most given back first; only {@link NERFS_MIN_GAMES}+ rated games that
 * week, never settling; none at all when fewer than {@link NERFS_MIN_ROWS} qualify.
 */
export function nerfRows(players: readonly WeekNotesPlayer[]): WeekNotesPlayer[] {
  const qualifying = stableSort(
    players.filter((player) => player.points < 0 && player.games >= NERFS_MIN_GAMES && !player.settling),
    (a, b) => a.points - b.points,
  );
  return qualifying.length < NERFS_MIN_ROWS ? [] : qualifying.slice(0, NERFS_MAX);
}

function medal(player: WeekNotesPlayer): WeekNotesMedal {
  const name = renderWebName(player.name);
  return {
    initials: initials(name),
    name,
    suffix: player.nameSuffix ?? null,
    role: player.role,
    points: formatWebDelta(player.points),
    record: `${player.wins}W ${player.losses}L`,
  };
}

/**
 * `SA` for `Syndrome Axes` (the first letters of the first two words); for one word, its first
 * character and its first digit (`H4` for `H4RDC0R33`, `P7` for `PerfPlayer7`), else its next capital
 * (`FH` for `FoxHound`), else its second letter (`RA` for `Ramzyinhović`). Upper case.
 */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return '?';
  const [first = '', second] = words;
  const chars = [...first];
  if (second !== undefined) return `${chars[0]}${[...second][0]}`.toUpperCase();
  const rest = chars.slice(1);
  const marked = rest.find((char) => /\p{N}/u.test(char)) ?? rest.find((char) => /\p{Lu}/u.test(char));
  return `${chars[0]}${marked ?? chars[1] ?? ''}`.toUpperCase();
}

function systemTiles(input: WeekNotesInput): WeekNotesTile[] {
  const tiles: WeekNotesTile[] = [];
  const modes = stableSort([...input.modes], (a, b) => b.count - a.count);
  const [top, ...rest] = modes;
  if (top !== undefined) {
    const shown = rest.slice(0, 2).map(modeRun);
    const more = rest.length - shown.length;
    tiles.push({
      label: WEEK_NOTES_COPY.modeLabel,
      value: modeRun({ ...top, rated: true }),
      sub: joinDot([...(top.rated ? [] : ['not rated']), ...shown, ...(more > 0 ? [`+${more} more`] : [])]),
    });
  }
  if (input.fearless !== null) {
    tiles.push({
      label: WEEK_NOTES_COPY.fearlessLabel,
      value: `${input.fearless.total} banned`,
      sub:
        input.fearless.added === 0
          ? `${input.fearless.open} still open`
          : `${input.fearless.added} this week · ${input.fearless.open} still open`,
    });
  }
  return tiles;
}

/** `Tanks only ×2`, `Ionia vs Noxus ×1 · not rated`. */
function modeRun(mode: WeekNotesMode): string {
  const run = `${mode.name} ×${mode.count}`;
  return mode.rated ? run : `${run} · not rated`;
}

function newTiles(input: WeekNotesInput, byPuuid: ReadonlyMap<string, WeekNotesPlayer>): WeekNotesTile[] {
  const C = WEEK_NOTES_COPY;
  const tiles: WeekNotesTile[] = [];
  const nameOf = (puuid: string, fallback: PlayerName): string => {
    const player = byPuuid.get(puuid);
    const name = renderWebName(player === undefined ? fallback : player.name);
    return player?.nameSuffix ? `${name} ${player.nameSuffix}` : name;
  };

  const firsts = input.firstNights.filter((first) => byPuuid.has(first.puuid));
  const [only] = firsts;
  if (firsts.length === 1 && only !== undefined) {
    const player = byPuuid.get(only.puuid);
    const settling = player?.settling ? ` · settling ${player.ratedGames}/${input.settlingGames}` : '';
    tiles.push({
      label: C.firstNight,
      value: nameOf(only.puuid, null),
      sub: `joined on ${only.day}${settling}`,
    });
  } else if (firsts.length > 1) {
    tiles.push({
      label: C.firstNights,
      value: namedList(
        firsts.map((first) => nameOf(first.puuid, null)),
        FIRST_NIGHTS_NAMED,
      ),
      sub: C.firstNightsSub,
    });
  }

  const [record, ...otherRecords] = input.records;
  if (record !== undefined) {
    tiles.push({
      label: C.record,
      value: `${nameOf(record.puuid, record.name)} · ${record.valueLabel}`,
      sub: joinDot([
        `${record.title}, new group best`,
        ...(otherRecords.length > 0 ? [`+${otherRecords.length} more`] : []),
      ]),
    });
  }

  if (input.firstPicks.length > 0) {
    tiles.push({
      label: C.firstPicks,
      value: namedList(input.firstPicks, FIRST_PICKS_NAMED),
      sub: C.firstPicksSub,
    });
  }

  // Room left: the week's awards, verbatim (research §5, "A only, if room").
  for (const award of input.awards) {
    if (tiles.length >= NEW_MAX) break;
    const [line, ...tie] = award.line.split('\n');
    if (line === undefined || line.trim() === '') continue;
    tiles.push({
      label: award.label.toUpperCase(),
      value: line,
      sub: tie.length > 0 ? `+${tie.length} tied` : null,
    });
  }

  return tiles.slice(0, NEW_MAX);
}

/** `Smolder, Aurora, Ambessa +6`. */
function namedList(names: readonly string[], named: number): string {
  const shown = names.slice(0, named).join(', ');
  return names.length > named ? `${shown} +${names.length - named}` : shown;
}

function joinDot(parts: readonly string[]): string | null {
  return parts.length === 0 ? null : parts.join(' · ');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function stableSort<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/* ---------------------------------------------------------------------------
 * The week's address
 * ------------------------------------------------------------------------- */

/** `2026-09-27`: the Sunday a week opens on, as the route's `[weekStart]` segment. */
export const WEEK_START_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The most-played role of a list of detected roles; ties go to lane order; none is null. */
export function mostPlayedRole(roles: readonly (RoleValue | null)[]): RoleValue | null {
  let best: RoleValue | null = null;
  let bestCount = 0;
  for (const role of ROLE_ORDER) {
    const count = roles.filter((seen) => seen === role).length;
    if (count > bestCount) {
      best = role;
      bestCount = count;
    }
  }
  return best;
}
