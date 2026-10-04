import { puuidSchema } from '@customs/db';
import { windowOrDefault } from '../board/window';
import { nightEnd, nightStart, type WindowKind, type WindowRange, windowRange } from '../night';
import type { QueueKind } from './queue';

/**
 * The Games list's whole state, read off the URL (M14.16; STRATEGY §6(c)). Pure: the page parses,
 * the loader filters, the view writes links back with {@link gamesListHref}, and nothing in
 * between keeps state of its own, so every filter survives a reload and a pasted link.
 *
 * - `?window=` is the date filter and **the same parameter every windowed page uses**, so a board
 *   link pasted here lands on the same week. The chips offer `Tonight`, `This week` and `All`
 *   (the brief's four, less `This month`, which M14.48 dropped); `last-week` is still honoured when
 *   a link carries it, with no chip lit. An unknown value is the default, never a 404 (05-design
 *   5.8; `windowOrDefault`), and that includes the retired `this-month` and `last-month`.
 * - `?mode=aram` is the ARAM list; absent (or `rift`) is Summoner's Rift.
 * - `?player=<puuid>` is one person's games. A value that is not a member of this group is
 *   dropped by the page (see `resolvePlayer`), never a 404.
 * - `?page=N`, 25 games a page, links not infinite scroll.
 *
 * The 1.0 page's `?p=` and `?queue=` are read too (`legacy`), so months of `/games?p=...` links
 * land on the right list; the page 308s them to the canonical spelling.
 */

export type GamesWindow = WindowKind | 'tonight';

/** The three date chips, in order. */
export const GAMES_WINDOW_CHIPS = [
  'tonight',
  'this-week',
  'all-time',
] as const satisfies readonly GamesWindow[];

/**
 * The list opens on **all time**: it is paginated, so the newest games are on top either way
 * (last night's are the first rows), and a quiet week never opens on an empty page. Decision row
 * proposed in the M14.16 report.
 */
export const GAMES_DEFAULT_WINDOW: WindowKind = 'all-time';

export const GAMES_PAGE_SIZE = 25;

export interface GamesFilters {
  window: GamesWindow;
  mode: QueueKind;
  /** A puuid, before the page checks it against the group's members. */
  player: string | null;
  /** 1-based. */
  page: number;
}

export type GamesSearchParams = Readonly<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseGamesWindow(value: string | string[] | undefined): GamesWindow {
  if (value === 'tonight') return 'tonight';
  return windowOrDefault(value, GAMES_DEFAULT_WINDOW);
}

function parseMode(params: GamesSearchParams): QueueKind {
  const mode = single(params.mode);
  if (mode === 'aram') return 'aram';
  if (mode === undefined && single(params.queue) === 'aram') return 'aram';
  return 'sr';
}

function parsePlayer(params: GamesSearchParams): string | null {
  const raw = single(params.player) ?? single(params.p);
  if (raw === undefined) return null;
  const parsed = puuidSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parsePage(value: string | string[] | undefined): number {
  const raw = single(value);
  if (raw === undefined || !/^\d{1,6}$/.test(raw)) return 1;
  const page = Number(raw);
  return page >= 1 ? page : 1;
}

/**
 * The filters, and whether the URL used the 1.0 spellings (`?p=`, `?queue=`), in which case the
 * page redirects to {@link gamesListHref} of the answer.
 */
export function parseGamesFilters(params: GamesSearchParams): { filters: GamesFilters; legacy: boolean } {
  return {
    filters: {
      window: parseGamesWindow(params.window),
      mode: parseMode(params),
      player: parsePlayer(params),
      page: parsePage(params.page),
    },
    legacy: params.p !== undefined || params.queue !== undefined,
  };
}

/**
 * The canonical link to a list: the window always named (every windowed page's rule,
 * `windowHref`), the mode only when ARAM, the player only when set, the page only past the first.
 */
export function gamesListHref(base: string, filters: GamesFilters): string {
  const query = new URLSearchParams({ window: filters.window });
  if (filters.mode === 'aram') query.set('mode', 'aram');
  if (filters.player !== null) query.set('player', filters.player);
  if (filters.page > 1) query.set('page', String(filters.page));
  return `${base}?${query.toString()}`;
}

/** `[start, end)` for a date filter. `Tonight` is the night containing `now` (06:00 to 06:00). */
export function gamesRange(window: GamesWindow, now: Date, timeZone: string): WindowRange {
  if (window === 'tonight') return { start: nightStart(now, timeZone), end: nightEnd(now, timeZone) };
  return windowRange(window, now, timeZone);
}

/** How many pages `total` games make; never 0, so `Page 1 of 1` is the empty list's answer too. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / GAMES_PAGE_SIZE));
}
