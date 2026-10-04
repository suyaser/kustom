import { resolveGroupParam } from '@/lib/groups/resolve';
import { loadWeekNotes, WEEK_NOTES_CACHE, weekFromParam } from '@/lib/og/weekNotesLoad';
import { createPublicClient } from '@/lib/publicClient';
import { nightTimeZone } from '@/lib/tonight/night';
import { NOT_FOUND } from '../../../../../_og/Cards';
import { weekNotesResponse } from '../../../../../_og/WeekNotes';

/**
 * `/og/g/<slug>/week/<weekStart>`: the "Week N notes" image (M14.79), 1920×1080, the Sunday post's
 * E1 `image` (05-design 10.6) and nowhere on the site. `weekStart` is the Sunday the week opens on
 * (`2026-09-27`). The game card's 404 rules: an unknown group, a malformed date or one that opens
 * no week, a week that has not closed, or a week with no counted game is a 404, which leaves
 * Discord laying the post out without the image.
 *
 * Node runtime (the fonts are read from disk). Cached for a day and not immutable
 * ({@link WEEK_NOTES_CACHE}): a closed week only changes when `rebuild-ratings` refolds it.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; weekStart: string }> },
) {
  const { slug, weekStart } = await params;
  const timeZone = nightTimeZone();
  const week = weekFromParam(weekStart, timeZone, new Date());
  if (week === null) return NOT_FOUND();
  const client = createPublicClient();
  const resolved = await resolveGroupParam(client, slug);
  if (resolved.kind !== 'group') return NOT_FOUND();
  const model = await loadWeekNotes(client, resolved.group, week, timeZone);
  if (model === null) return NOT_FOUND();
  return weekNotesResponse(model, WEEK_NOTES_CACHE);
}
