import { KUSTOM_START } from '@customs/core';
import { leaderboardPageUrl } from '../siteUrl';
import type { ServiceClient } from '../supabase';
import { loadPostGroup, postIdentity } from './assemble';
import { joinNames, noticeEmbed, type PlayerName, type PostIdentity, type WebhookPayload } from './embeds';
import type { GroupPostOptions } from './post';
import { postToWebhook, type WebhookOutcome } from './webhook';

/**
 * The owner's `Reset ratings` in the group's channel (M14.18, STRATEGY §3.6). **The only record**
 * of the old board: nothing is archived on the site, so the post names the top three as they
 * stood the moment before the reset.
 *
 * Copy: STRATEGY §3.6's `Ratings were reset. Everyone starts at 1200 again. Top 3 before the
 * reset: …`. The 1200 is core's `KUSTOM_START` (M18.6), never a literal here.
 * No ranked player before the reset (a group that never got anyone past settling): the top-3
 * sentence is left off rather than printed empty.
 */

/** [NEW COPY] The embed title. */
export const RATINGS_RESET_TITLE = 'Ratings reset';

export function ratingsResetDescription(topThree: readonly PlayerName[]): string {
  const start = `Ratings were reset. Everyone starts at ${KUSTOM_START} again.`;
  return topThree.length === 0 ? start : `${start} Top 3 before the reset: ${joinNames(topThree)}.`;
}

export interface RatingsResetEmbedInput {
  identity: PostIdentity;
  /** The top three ranked players on `All time` just before the reset, best first. At most 3. */
  topThree: readonly PlayerName[];
  /** The all-time board, or `undefined` with no honest URL. */
  url?: string | undefined;
}

/**
 * Pure: the payload (05-design 10.10). One amber embed, the group as author, the linked title and
 * the sentence; no footer, no timestamp. Snapshot-tested.
 */
export function ratingsResetEmbed(input: RatingsResetEmbedInput): WebhookPayload {
  return noticeEmbed({
    identity: input.identity,
    title: RATINGS_RESET_TITLE,
    description: ratingsResetDescription(input.topThree.slice(0, 3)),
    url: input.url,
  });
}

/** The one I/O: post it to the group's webhook. Never throws (a webhook that is down costs a log line). */
export async function postRatingsReset(
  client: ServiceClient,
  topThree: readonly PlayerName[],
  options: GroupPostOptions,
): Promise<WebhookOutcome> {
  const group = await loadPostGroup(client, options.groupId);
  return postToWebhook(
    client,
    ratingsResetEmbed({
      identity: postIdentity(group, options.requestOrigin),
      topThree,
      url: group === null ? undefined : leaderboardPageUrl(options.requestOrigin, group.slug, 'all-time'),
    }),
    'ratings reset embed',
    options,
  );
}
