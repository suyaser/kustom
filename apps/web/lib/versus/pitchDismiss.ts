/**
 * The You-vs-them pitch's dismissal (M14.35), as a cookie the server reads (fix-result-cls).
 *
 * The pitch used to keep the dismissal in `localStorage`, which only the browser can read, so the
 * server rendered the pitch hidden and the client inserted it after hydration: 66 to 100 px that
 * pushed the rail (phones) or the footer (desktop) down under a reader who had already scrolled,
 * CLS 0.011 to 0.047 on the finished screen. The cookie lets the first paint be the final one.
 *
 * The value is the night the dismissal is for (the page's `nightKey`), so it lasts that night only,
 * as before. No name, no id: one ISO time.
 */
export const PITCH_COOKIE = 'kustom_versus_pitch';

/** Two days: past any night, so the cookie never outlives the night it names by much. */
export const PITCH_COOKIE_MAX_AGE_S = 2 * 24 * 60 * 60;

/** Whether the cookie's value dismisses the pitch for `nightKey`. */
export function pitchDismissedFor(cookieValue: string | null | undefined, nightKey: string): boolean {
  if (cookieValue == null || cookieValue === '') return false;
  let value = cookieValue;
  try {
    value = decodeURIComponent(cookieValue);
  } catch {
    return false;
  }
  return value === nightKey;
}

/** The `document.cookie` string that dismisses the pitch for `nightKey`. */
export function pitchDismissCookie(nightKey: string): string {
  return `${PITCH_COOKIE}=${encodeURIComponent(nightKey)}; path=/; max-age=${PITCH_COOKIE_MAX_AGE_S}; samesite=lax`;
}
