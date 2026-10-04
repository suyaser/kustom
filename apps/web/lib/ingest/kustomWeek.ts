import { weekStart } from '../night';
import { nightTimeZone } from '../tonight/night';

/**
 * The week a game's weekly Kustom track folds in (M18.5): `night.ts` `weekStart` (Sunday 06:00
 * in the night's zone, `Africa/Cairo` unless `CUSTOMS_NIGHT_TZ` says otherwise; M5.34,
 * owner-confirmed 2026-10-04), as an ISO instant. The one definition of the boundary is
 * `weekStart`; this only names the zone the board's week windows use, so a game's weekly row and
 * the week tab it is printed on cannot disagree about which week it is in.
 */
export function kustomWeekStart(startedAt: string, timeZone: string = nightTimeZone()): string {
  return weekStart(new Date(startedAt), timeZone).toISOString();
}
