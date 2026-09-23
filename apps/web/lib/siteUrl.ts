import { readAuthEnv } from './env';
import type { WindowKind } from './night';

/**
 * The origin OAuth comes back to.
 *
 * `NEXT_PUBLIC_SITE_URL` wins when it is set (that is the one value a hosted deploy must pin,
 * because Supabase only redirects to allow-listed URLs). Otherwise it is taken from the
 * request: `x-forwarded-*` on Vercel, the request URL in `next dev`.
 */
export function siteOrigin(request: Request): string {
  try {
    const configured = readAuthEnv().NEXT_PUBLIC_SITE_URL;
    if (configured) return configured;
  } catch {
    // Not configured at all; fall through to the request.
  }

  const host = firstHeaderValue(request.headers.get('x-forwarded-host')) ?? request.headers.get('host');
  const proto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  if (host) {
    return `${proto ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')}://${host}`;
  }

  return new URL(request.url).origin;
}

/** Hosts that are real to the machine running the server and to nobody in the Discord channel. */
const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];

/**
 * The link a Discord embed may carry, or `undefined` (M3.1, "Tonight page URL").
 *
 * `NEXT_PUBLIC_SITE_URL` is what {@link siteOrigin} already prefers, so this takes the origin
 * of the request that triggered the transition and applies the one extra rule the channel
 * needs: **never post a localhost link**. No domain exists yet, and an embed with no `url` is
 * better than one that goes nowhere for everybody but the person who ran the server.
 */
export function tonightPageUrl(origin: string | null | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    if (LOCAL_HOSTS.includes(url.hostname)) return undefined;
    // The tonight page is `/`, so the origin is the whole link.
    return url.origin;
  } catch {
    return undefined;
  }
}

/**
 * One game's page, `/g/<games.id>` (M11.4), for the result embed's title link, under the same
 * localhost rule as {@link tonightPageUrl}. `/` moves on to the next lobby within minutes of a
 * result; this address keeps showing the game the message is about.
 */
export function gamePageUrl(origin: string | null | undefined, gameId: string): string | undefined {
  const base = tonightPageUrl(origin);
  return base === undefined ? undefined : `${base}/g/${encodeURIComponent(gameId)}`;
}

/**
 * The board's link for a Discord embed (M3.5), or `undefined` under the same localhost rule as
 * {@link tonightPageUrl}: no domain exists yet, and a link that works for one person is worse
 * in a channel than no link at all.
 *
 * **It carries the window the post printed** (M5.12): the nightly post links to
 * `?window=this-week`, and the Sunday post (M5.10) to `?window=last-week`. A tap from the
 * channel has to land on the board whose numbers are in the message above it, and the page's
 * own default would land on a different one every time the post is not about this week.
 */
export function leaderboardPageUrl(
  origin: string | null | undefined,
  window?: WindowKind,
): string | undefined {
  const base = tonightPageUrl(origin);
  if (base === undefined) return undefined;
  return window === undefined ? `${base}/leaderboard` : `${base}/leaderboard?window=${window}`;
}

function firstHeaderValue(value: string | null): string | null {
  if (value === null) return null;
  const first = value.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}
