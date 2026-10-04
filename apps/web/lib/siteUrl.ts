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

/** Names that are real to the machine running the server and to nobody in the Discord channel. */
const LOCAL_NAMES: readonly string[] = ['localhost', 'localhost.localdomain'];
const LOCAL_SUFFIXES: readonly string[] = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.lan',
  '.home.arpa',
];

/** An IPv4 address in a range nobody in a Discord channel can reach, or `false` for a public one. */
function isPrivateIpv4(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT, 100.64/10
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

/**
 * The one host rule for every Discord link and image (M14.61 r2): **true** when the host is local
 * or private, so nothing may point at it. `host` is a `URL.hostname`.
 *
 * - One trailing `.` is stripped first: `localhost.` and `foo.local.` are `localhost` and `foo.local`.
 * - Local names and suffixes: `localhost`, `localhost.localdomain`, `*.localhost`, `*.local`,
 *   `*.internal`, `*.localdomain`, `*.lan`, `*.home.arpa`, and any bare host with no dot.
 * - IPv4 loopback, private, link-local, CGNAT (100.64/10), `0/8`, multicast and reserved.
 * - Every IPv6 literal (loopback, ULA, link-local and IPv4-mapped `::ffff:` forms among them): a
 *   site Discord can reach has a name.
 */
export function isLocalOrPrivateHost(host: string): boolean {
  let name = host.toLowerCase();
  if (name.endsWith('.')) name = name.slice(0, -1);
  if (name.length === 0) return true;
  if (name.startsWith('[') || name.includes(':')) return true;
  if (LOCAL_NAMES.includes(name)) return true;
  if (LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  if (!name.includes('.')) return true;
  const ipv4 = name.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4 !== null) return isPrivateIpv4(Number(ipv4[1]), Number(ipv4[2]));
  return false;
}

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
    if (isLocalOrPrivateHost(url.hostname)) return undefined;
    // The tonight page is `/`, so the origin is the whole link.
    return url.origin;
  } catch {
    return undefined;
  }
}

/**
 * A group's own space, `/g/<slug>` (M13.9), under the same localhost rule as
 * {@link tonightPageUrl}: every link a Discord post carries is the group's (M13.11, folded into
 * M14.10), so the teams and fearless posts land on that group's tonight page, never on `/`.
 * `anchor` is a fragment on that page (the receipt's disclosure, STRATEGY §4.9).
 */
export function groupPageUrl(
  origin: string | null | undefined,
  slug: string,
  anchor?: string,
): string | undefined {
  const base = tonightPageUrl(origin);
  if (base === undefined) return undefined;
  const page = `${base}/g/${encodeURIComponent(slug)}`;
  return anchor === undefined ? page : `${page}#${encodeURIComponent(anchor)}`;
}

/**
 * One game's page, `/g/<slug>/games/<games.id>` (M13.11, M14.16), for the result embed's title
 * link. The group's tonight page moves on to the next lobby within minutes of a result; this
 * address keeps showing the game the message is about.
 */
export function gamePageUrl(
  origin: string | null | undefined,
  slug: string,
  gameId: string,
): string | undefined {
  const group = groupPageUrl(origin, slug);
  return group === undefined ? undefined : `${group}/games/${encodeURIComponent(gameId)}`;
}

/**
 * The group's mode panel, `/g/<slug>/mode` (M14.30), for both fearless posts' title link
 * (M14.31). A click from Discord is a hard load, so it opens as the direct page.
 */
export function modePageUrl(origin: string | null | undefined, slug: string): string | undefined {
  const group = groupPageUrl(origin, slug);
  return group === undefined ? undefined : `${group}/mode`;
}

/**
 * The group's board for a Discord embed (M3.5, under `/g/<slug>` since M14.10), or `undefined`
 * under the same localhost rule as {@link tonightPageUrl}.
 *
 * **It carries the window the post printed** (M5.12): the nightly post links to
 * `?window=this-week`, and the Sunday post (M5.10) to `?window=last-week`. A tap from the
 * channel has to land on the board whose numbers are in the message above it.
 */
export function leaderboardPageUrl(
  origin: string | null | undefined,
  slug: string,
  window?: WindowKind,
): string | undefined {
  const group = groupPageUrl(origin, slug);
  if (group === undefined) return undefined;
  return window === undefined ? `${group}/leaderboard` : `${group}/leaderboard?window=${window}`;
}

/**
 * The origin a Discord **image** may be fetched from (M14.61, 05-design 10.11), or `undefined`.
 *
 * Stricter than the link rule ({@link tonightPageUrl}), because a link that goes nowhere costs a
 * tap and an image Discord's proxy cannot fetch costs a broken square in every post: the origin
 * must be `https`, and its host must not be local or private (`localhost`, loopback, `0.0.0.0`,
 * `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `*.local`, `*.internal`, or a bare host with
 * no dot). Anything else, including no origin at all, sends no image and the post is complete
 * without it.
 */
export function publicImageOrigin(origin: string | null | undefined): string | undefined {
  const base = tonightPageUrl(origin);
  if (base === undefined) return undefined;
  // The host rule is `tonightPageUrl`'s (`isLocalOrPrivateHost`); an image also needs https.
  const url = new URL(base);
  return url.protocol === 'https:' ? url.origin : undefined;
}

/** Bump to change the avatar Discord caches (05-design 10.11 B1). */
export const KUSTOM_AVATAR_VERSION = 2;

/** `<origin>/og/kustom/avatar?v=2`, the webhook's `avatar_url`, or `undefined` off a public origin. */
export function kustomAvatarUrl(origin: string | null | undefined): string | undefined {
  const base = publicImageOrigin(origin);
  return base === undefined ? undefined : `${base}/og/kustom/avatar?v=${KUSTOM_AVATAR_VERSION}`;
}

/**
 * `<origin>/og/g/<slug>/games/<id>/badge`, the result post's thumbnail (05-design 10.11 B2), or
 * `undefined` off a public origin.
 */
export function resultBadgeUrl(
  origin: string | null | undefined,
  slug: string,
  gameId: string,
): string | undefined {
  const base = publicImageOrigin(origin);
  if (base === undefined) return undefined;
  return `${base}/og/g/${encodeURIComponent(slug)}/games/${encodeURIComponent(gameId)}/badge`;
}

/**
 * `<origin>/og/g/<slug>/week/<weekStart>`, the Sunday post's "Week N notes" picture (M14.79,
 * E1 `image`), or `undefined` off a public origin. `weekStart` is the Sunday the week opens on,
 * `2026-09-27` (`weekKey`).
 */
export function weekNotesImageUrl(
  origin: string | null | undefined,
  slug: string,
  weekStart: string,
): string | undefined {
  const base = publicImageOrigin(origin);
  if (base === undefined) return undefined;
  return `${base}/og/g/${encodeURIComponent(slug)}/week/${encodeURIComponent(weekStart)}`;
}

function firstHeaderValue(value: string | null): string | null {
  if (value === null) return null;
  const first = value.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}
