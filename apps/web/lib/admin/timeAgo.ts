/**
 * `5 minutes ago`, `yesterday`, `3 days ago`: how long since `then`, for the admin checklist's
 * `Kustom seen …` and `test post sent …` (STRATEGY 3.2). Pure: `now` is passed in. Under a minute
 * reads `just now`; a time in the future (clock skew between the server and the database) too.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const JUST_NOW = 'just now';

/** {@link timeAgo} standing alone in a cell: `Just now`, `Yesterday`, `Last month` (designer round 1). */
export function timeAgoLabel(then: Date | string, now: Date): string {
  const text = timeAgo(then, now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function timeAgo(then: Date | string, now: Date): string {
  const elapsed = now.getTime() - new Date(then).getTime();
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return JUST_NOW;
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 30 * DAY) return relative.format(-Math.floor(elapsed / DAY), 'day');
  if (elapsed < 365 * DAY) return relative.format(-Math.floor(elapsed / (30 * DAY)), 'month');
  return relative.format(-Math.floor(elapsed / (365 * DAY)), 'year');
}
