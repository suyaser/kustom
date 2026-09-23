/**
 * What "tonight" means (M2.5).
 *
 * A night runs **06:00 to 06:00** in the timezone named by `CUSTOMS_NIGHT_TZ`, not midnight
 * to midnight: the group plays late, and a midnight boundary would reset "games tonight"
 * while people are still in the lobby — which is exactly when the sit-out rotation is read.
 * 06:00 is an hour nobody is playing. Recorded in `04-decisions.md`.
 *
 * Pure: every function here takes the instant it is asked about. No `Date.now()`.
 */

/** Where the group is. Overridable per deployment with `CUSTOMS_NIGHT_TZ` (an IANA name). */
export const DEFAULT_NIGHT_TIME_ZONE = 'Africa/Cairo';

/** The local hour a night starts and the previous one ends. */
export const NIGHT_START_HOUR = 6;

interface CivilTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * The locale every date on a public page is formatted in, whatever the reader's browser says.
 *
 * Fixed on purpose (`05-design.md`, the status strip's slug): a date formatted in the visitor's
 * locale is formatted differently by the server than by the browser that re-renders it, and the
 * line changes under the reader. One locale, one timezone, one string, decided on the server.
 */
export const DISPLAY_LOCALE = 'en-GB';

const dayMonthFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `9 Sep`: the short date a page puts beside a game (M3.5, `/p/[puuid]`'s recent games).
 *
 * The same locale and the same configured timezone the night's slug line uses, and the same
 * reason for both — `CUSTOMS_NIGHT_TZ` is where the group is, so a game that started at 01:00
 * their time is dated the day they played it and not the day UTC had.
 *
 * Built from parts rather than from `format()` because `en-GB`'s short month is **`Sept`** on
 * current ICU and three letters everywhere else, so a column of dates would have one four-letter
 * entry a year. Cutting to three gives `Sep` and leaves the other eleven untouched, and it is
 * stable across the ICU versions that disagree about September.
 *
 * This is the only date formatter in the app. Anything else that needs one takes different
 * `Intl` options from here rather than building a second `DateTimeFormat` somewhere else.
 */
export function formatDayMonth(instant: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): string {
  const cached = dayMonthFormatters.get(timeZone);
  const formatter =
    cached ?? new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, day: 'numeric', month: 'short' });
  if (cached === undefined) dayMonthFormatters.set(timeZone, formatter);

  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('day')} ${read('month').slice(0, 3)}`;
}

const nightLabelFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `Tuesday 9 September`: the tonight page's slug line (M3.18, `05-design.md`, "The status
 * strip"), rendered upper case by the stylesheet and left as a readable date in the DOM.
 *
 * Same locale and same configured timezone as every other date on a public page, and for the
 * same reason: this is formatted **on the server** and travels in the snapshot, because a date
 * the browser formatted in the reader's own locale would disagree with the server's render and
 * the line would change under them.
 *
 * It is given the night's start, not the current instant, so a game at 01:00 still says
 * Tuesday.
 */
export function formatNightLabel(
  nightStartInstant: Date,
  timeZone: string = DEFAULT_NIGHT_TIME_ZONE,
): string {
  const cached = nightLabelFormatters.get(timeZone);
  const formatter =
    cached ??
    new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, weekday: 'long', day: 'numeric', month: 'long' });
  if (cached === undefined) nightLabelFormatters.set(timeZone, formatter);
  return formatter.format(nightStartInstant);
}

const dayNameFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `Tuesday`: the day of the week on its own, for a row that is about **which night** rather than
 * which date (M8.2's `31% · Won · Tuesday`).
 *
 * `formatDayName` and not `formatWeekday`, which is taken further down by the week range's
 * `Sunday 13 Sep` — two different strings and neither is the other's prefix by accident.
 *
 * Same locale and same configured timezone as {@link formatDayMonth} and {@link formatNightLabel},
 * and rendered on the server for the same reason — a weekday the browser computed in its own zone
 * would read `Wednesday` for a game that started at 01:00 and change under the reader.
 *
 * The instant is the game's `started_at`, not the night's 06:00 boundary, so a custom that began
 * after midnight is dated the calendar day it began on. That is the same latitude every other
 * per-game date on a public page already takes (`historyGameOf`'s `startedLabel`); the night
 * boundary is a window rule, not a label rule.
 */
export function formatDayName(instant: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): string {
  const cached = dayNameFormatters.get(timeZone);
  const formatter = cached ?? new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, weekday: 'long' });
  if (cached === undefined) dayNameFormatters.set(timeZone, formatter);
  return formatter.format(instant);
}

/**
 * The configured zone's offset across one night, computed **on the server** so a browser can
 * turn an instant into `22:41` with arithmetic alone (M11.2, the night tape).
 *
 * The tonight snapshot is re-read in the browser on every Realtime event, and the browser has
 * no `CUSTOMS_NIGHT_TZ`. Carrying the offset — and the one instant it changes, on the two nights
 * a year daylight saving does (Africa/Cairo shifts at midnight, mid-session) — means the clock
 * the browser prints is the one the server printed, from the server's tzdata, with no `Intl`.
 */
export interface NightClock {
  /** Milliseconds to add to UTC for local time at the night's start. */
  offsetMs: number;
  /** When the offset changes inside this night, and what it changes to. `null` on 363 nights. */
  shift: { at: string; offsetMs: number } | null;
}

export function nightClock(nightStartInstant: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): NightClock {
  const start = nightStartInstant.getTime();
  const end = nightEnd(nightStartInstant, timeZone).getTime() - 1_000;
  const before = offsetMsAt(new Date(start), timeZone);
  const after = offsetMsAt(new Date(end), timeZone);
  if (before === after) return { offsetMs: before, shift: null };

  // A night holds at most one transition. Find its first second.
  let lo = start;
  let hi = end;
  while (hi - lo > 1_000) {
    const mid = lo + Math.floor((hi - lo) / 2_000) * 1_000;
    if (offsetMsAt(new Date(mid), timeZone) === before) lo = mid;
    else hi = mid;
  }
  return { offsetMs: before, shift: { at: new Date(hi).toISOString(), offsetMs: after } };
}

/** `22:41`, h23, from a {@link NightClock}. After midnight it reads `00:40`. */
export function formatClock(instant: Date, clock: NightClock): string {
  const at = instant.getTime();
  const offset =
    clock.shift !== null && at >= Date.parse(clock.shift.at) ? clock.shift.offsetMs : clock.offsetMs;
  const local = new Date(at + offset);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** Is this a timezone `Intl` knows? Used to validate `CUSTOMS_NIGHT_TZ` at the boundary. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // `h23` and not `hour12: false`: the latter prints midnight as 24 in some runtimes.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/** The wall-clock reading of `instant` in `timeZone`. */
function civilTimeIn(instant: Date, timeZone: string): CivilTime {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Milliseconds to add to UTC to get local time at this instant (the zone's offset). */
function offsetMsAt(instant: Date, timeZone: string): number {
  const civil = civilTimeIn(instant, timeZone);
  const asIfUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second);
  // The formatter drops milliseconds, so round the instant to the second before subtracting.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the clock in `timeZone` reads this wall-clock time.
 *
 * Two passes: the first guesses with the offset that applies at the same numbers read as
 * UTC, the second corrects it with the offset that actually applies there. That is what
 * makes the answer right on the two days a year the offset changes (Africa/Cairo has kept
 * DST since 2023).
 */
function instantOfCivilTime(civil: CivilTime, timeZone: string): Date {
  const asIfUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second);
  const firstGuess = asIfUtc - offsetMsAt(new Date(asIfUtc), timeZone);
  return new Date(asIfUtc - offsetMsAt(new Date(firstGuess), timeZone));
}

/**
 * The start of the night containing `now`: 06:00 local on the day it belongs to. Anything
 * before 06:00 belongs to the night that started the previous morning, so a session running
 * to 01:30 is still one night.
 */
export function nightStart(now: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): Date {
  const civil = civilTimeIn(now, timeZone);
  // Civil-date arithmetic through UTC so month and year ends carry correctly. This is a
  // calendar calculation, not an instant: the zone is applied afterwards.
  const civilDay = Date.UTC(civil.year, civil.month - 1, civil.day);
  const nightDay = new Date(civil.hour < NIGHT_START_HOUR ? civilDay - 24 * 60 * 60 * 1000 : civilDay);

  return instantOfCivilTime(
    {
      year: nightDay.getUTCFullYear(),
      month: nightDay.getUTCMonth() + 1,
      day: nightDay.getUTCDate(),
      hour: NIGHT_START_HOUR,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

/**
 * The end of the night containing `now`: the 06:00 the next one starts at (M3.6).
 *
 * It is what `players.role_tonight_until` is set to, so "this lasts the night" is one stored
 * instant rather than a rule every reader has to re-derive.
 *
 * 26 hours past this night's 06:00 lands between 07:00 and 09:00 the next morning whatever DST
 * did in between — a shift is at most an hour either way — and the night containing *that*
 * instant starts at the 06:00 this one ends on. One definition of 06:00 local, used twice.
 */
export function nightEnd(now: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): Date {
  return nightStart(new Date(nightStart(now, timeZone).getTime() + 26 * 60 * 60 * 1000), timeZone);
}

/**
 * Daily Mystery (M5.32) rotates on the **civil midnight**, not the 06:00 night boundary.
 * The group asked for one calendar-day challenge (`13 September → Mystery #N`) and a
 * countdown to 12:00 AM. Sit-out and windows stay on 06:00; this clock is only the puzzle.
 */
export function civilDayStart(now: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): Date {
  const civil = civilTimeIn(now, timeZone);
  return instantOfCivilTime(
    { year: civil.year, month: civil.month, day: civil.day, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/** `2026-09-13` in the configured zone — the unique key for today's mystery. */
export function civilDayKey(now: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): string {
  const civil = civilTimeIn(now, timeZone);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${civil.year}-${pad(civil.month)}-${pad(civil.day)}`;
}

/** The next 00:00 in `timeZone`. DST-safe the same way {@link nightEnd} is. */
export function nextCivilMidnight(now: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): Date {
  return civilDayStart(new Date(civilDayStart(now, timeZone).getTime() + 26 * 60 * 60 * 1000), timeZone);
}

/* ---------------------------------------------------------------------------
 * Window boundaries (M5.9): which week and which month a game belongs to.
 *
 * Nobody sees this half of the file. They see `This week` on the leaderboard and the Sunday
 * post in Discord, and both are only ever as right as these twenty lines. It lives here rather
 * than in `packages/core` for the reason the top of the file already gives: the zone comes
 * from `CUSTOMS_NIGHT_TZ` and core takes no environment.
 *
 * **The week opens on Sunday** (M5.34, 2026-09-15): the group's week runs Sunday to Thursday —
 * Egypt's working week — and the ISO Monday this file cut on until then was a default nobody
 * chose. The anchor day is the only thing that moved; the hour, the night and the month did not.
 *
 * **A game belongs to the week and the month its `started_at` falls in, by the 06:00
 * boundary** — the night's own boundary (M2.5), for the night's own reason: a Saturday-night
 * game that starts at 01:40 belongs to the week that is ending, with the rest of that night's
 * games. Windows are half-open, `[start, end)`, and every one of them starts at 06:00 local.
 *
 * No column, no migration, no backfill: the window is computed at read time from
 * `games.started_at`, which is what makes a game backfilled three weeks late land in the week
 * it was actually played, on every page and in every past post, with nothing rewritten.
 * ------------------------------------------------------------------------- */

/** The five windows the board is read through (M5.12). The parameter is the same word everywhere. */
export type WindowKind = 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'all-time';

/**
 * A half-open interval `[start, end)`. `all-time` is `{ start: null, end: null }` — one
 * predicate for every caller and no branch, which is what stops five surfaces each inventing
 * an "except all time" clause.
 */
export interface WindowRange {
  start: Date | null;
  end: Date | null;
}

/** A civil date, with no time and no zone: the calendar arithmetic below works in these. */
interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** The civil date of the **night** containing `instant` — 01:40 Monday is still Sunday's date. */
function nightDate(instant: Date, timeZone: string): CivilDate {
  const civil = civilTimeIn(nightStart(instant, timeZone), timeZone);
  return { year: civil.year, month: civil.month, day: civil.day };
}

/** Calendar arithmetic through UTC, so month and year ends carry themselves. */
function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * 1 for Sunday … 7 for Saturday, of a civil date. No instant and no zone are involved.
 *
 * **Sunday-first, because the week is** (M5.34). The numbering is the week's anchor day written
 * once: `weekStart` rolls back `weekdayOf - 1` days and there is no second place that knows
 * which day opens a week. `getUTCDay()` is already Sunday-first, so this is `+ 1` and the ISO
 * shuffle that used to be here is gone.
 */
function weekdayOf(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 1;
}

/** The instant at which the clock in `timeZone` reads 06:00 on this civil date. */
function boundaryOf(date: CivilDate, timeZone: string): Date {
  return instantOfCivilTime({ ...date, hour: NIGHT_START_HOUR, minute: 0, second: 0 }, timeZone);
}

/** The civil date a 06:00 boundary sits on, so a range can step a week or a month off it. */
function dateOfBoundary(boundary: Date, timeZone: string): CivilDate {
  const civil = civilTimeIn(boundary, timeZone);
  return { year: civil.year, month: civil.month, day: civil.day };
}

/**
 * The Sunday 06:00 that opens the week containing `instant` (M5.34; it was Monday until then).
 *
 * **One step off `nightStart`, deliberately.** It reads the weekday of the *night's* 06:00
 * boundary, not of the instant: taken from the instant directly, a 02:00 Sunday game would
 * open a new week six hours before the night it was played in had ended. Same reasoning as
 * M2.5's, for the two games a year somebody actually notices.
 */
export function weekStart(instant: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): Date {
  const date = nightDate(instant, timeZone);
  return boundaryOf(addDays(date, 1 - weekdayOf(date)), timeZone);
}

/** The 1st at 06:00 that opens the month containing `instant`, by the same night boundary. */
export function monthStart(instant: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): Date {
  const date = nightDate(instant, timeZone);
  return boundaryOf({ year: date.year, month: date.month, day: 1 }, timeZone);
}

/**
 * The window's bounds, half-open and both ends at 06:00 local.
 *
 * `this-week` and `this-month` **end in the future** — the end is the next boundary, not `now`
 * — so a game that lands mid-evening is inside the window it was played in without the range
 * moving under it.
 *
 * **Daylight saving is `nightStart`'s answer, not a second one.** The boundary is a local wall
 * clock, so a week can be 167 or 169 hours; this adds nothing to that and must not "fix" it by
 * working in UTC offsets. `Africa/Cairo` is the configured zone and it does observe DST.
 *
 * Pure: the instant is a parameter and so is the zone. Nothing here reads `Date.now()` or the
 * environment; `nightTimeZone()` in `lib/tonight/night.ts` is the one place the variable is read.
 */
export function windowRange(
  kind: WindowKind,
  now: Date,
  timeZone: string = DEFAULT_NIGHT_TIME_ZONE,
): WindowRange {
  if (kind === 'all-time') return { start: null, end: null };

  if (kind === 'this-week' || kind === 'last-week') {
    const thisWeek = weekStart(now, timeZone);
    const date = dateOfBoundary(thisWeek, timeZone);
    if (kind === 'this-week') return { start: thisWeek, end: boundaryOf(addDays(date, 7), timeZone) };
    return { start: boundaryOf(addDays(date, -7), timeZone), end: thisWeek };
  }

  const thisMonth = monthStart(now, timeZone);
  const date = dateOfBoundary(thisMonth, timeZone);
  const next = boundaryOf({ year: date.year, month: date.month + 1, day: 1 }, timeZone);
  if (kind === 'this-month') return { start: thisMonth, end: next };
  return { start: boundaryOf({ year: date.year, month: date.month - 1, day: 1 }, timeZone), end: thisMonth };
}

/** Is this game inside this window? Half-open: the start is in, the end is not. */
export function isInWindow(startedAt: Date, range: WindowRange): boolean {
  const at = startedAt.getTime();
  if (range.start !== null && at < range.start.getTime()) return false;
  if (range.end !== null && at >= range.end.getTime()) return false;
  return true;
}

/** The two windows that close by themselves and post themselves (M5.10, M5.13). */
export type ClosedWindowKind = 'last-week' | 'last-month';

/**
 * The window of that kind that most recently **closed**, for the cron route that posts it
 * (M5.13): its kind, its bounds, and the key its dedupe row is written under.
 *
 * `key` is the window's start as an ISO instant, which is `window_posts.window_start` — the
 * other half of that table's primary key. It is derived here rather than in the route so that
 * "which week have we already posted" and "which week are we about to post" cannot be computed
 * two different ways.
 */
export interface ClosedWindow {
  kind: ClosedWindowKind;
  start: Date;
  end: Date;
  /** `2026-09-06T03:00:00.000Z` — the `window_start` of the dedupe row. */
  key: string;
}

export function closedWindow(
  kind: ClosedWindowKind,
  now: Date,
  timeZone: string = DEFAULT_NIGHT_TIME_ZONE,
): ClosedWindow {
  const range = windowRange(kind, now, timeZone);
  // `last-week` and `last-month` are always bounded; the nulls belong to `all-time` alone.
  const start = range.start as Date;
  const end = range.end as Date;
  return { kind, start, end, key: start.toISOString() };
}

/* ---------------------------------------------------------------------------
 * Naming a window out loud (M5.12's slot, M5.10's post description).
 *
 * The three formatters below are the only place a window's dates become words. `05-design.md`'s
 * board copy table fixes the strings; **the week form is M5.10's post description byte for
 * byte**, which is the whole reason it is exported from here rather than assembled twice.
 * ------------------------------------------------------------------------- */

const rangeDayFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `Sunday 13 Sep`: one end of a week, in the fixed locale and the configured zone.
 *
 * Same three-letter month cut as {@link formatDayMonth} and for the same reason — `en-GB`'s
 * short month is `Sept` on current ICU and three letters everywhere else, so one range a year
 * would be a character longer than the other fifty-one.
 */
function formatWeekday(instant: Date, timeZone: string): string {
  const cached = rangeDayFormatters.get(timeZone);
  const formatter =
    cached ??
    new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, weekday: 'long', day: 'numeric', month: 'short' });
  if (cached === undefined) rangeDayFormatters.set(timeZone, formatter);

  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('weekday')} ${read('day')} ${read('month').slice(0, 3)}`;
}

/**
 * `Sunday 13 Sep to Saturday 19 Sep`: a week, named by its first and **last night**.
 *
 * `end` is the window's exclusive boundary — the next Sunday 06:00 — and the last day named is
 * the night before it, because that Saturday's games run past midnight into the Sunday morning
 * this window ends on. Naming the boundary itself would print a Sunday nobody played on.
 *
 * The month prints on both ends (`Sunday 27 Sep to Saturday 3 Oct`) rather than only when it
 * changes: a range with one month in it reads as a range with a missing half.
 */
export function formatWeekRange(start: Date, end: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): string {
  const lastNight = boundaryOf(addDays(dateOfBoundary(end, timeZone), -1), timeZone);
  return `${formatWeekday(start, timeZone)} to ${formatWeekday(lastNight, timeZone)}`;
}

const monthNameFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `September`: a month, by its name and nothing else (product, 2026-09-10). A day range would
 * spell out what a calendar already says, and no year, because a month window is always this
 * one or the one before it.
 */
export function formatMonthName(instant: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): string {
  const cached = monthNameFormatters.get(timeZone);
  const formatter = cached ?? new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, month: 'long' });
  if (cached === undefined) monthNameFormatters.set(timeZone, formatter);
  return formatter.format(instant);
}

const dayMonthYearFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `8 Sep 2025`: a date that can be years old, for `All time`'s `Since …`.
 *
 * The only window form that carries a year, because it is the only one that can reach one.
 * Same month cut as the others.
 */
export function formatDayMonthYear(instant: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): string {
  const cached = dayMonthYearFormatters.get(timeZone);
  const formatter =
    cached ??
    new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
  if (cached === undefined) dayMonthYearFormatters.set(timeZone, formatter);

  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('day')} ${read('month').slice(0, 3)} ${read('year')}`;
}
