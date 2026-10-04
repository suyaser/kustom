import { badgeResponse, KustomAvatar } from '../../../_og/Badges';

/**
 * `/og/kustom/avatar?v=2`: the webhook's avatar on every Kustom post (M14.61, 05-design 10.11
 * B1). Reads nothing. A year, immutable: bump `KUSTOM_AVATAR_VERSION` (`lib/siteUrl.ts`) to change
 * what Discord shows.
 */
export async function GET() {
  return badgeResponse(<KustomAvatar />, 'public, max-age=31536000, immutable');
}
