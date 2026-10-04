import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { cookies } from 'next/headers';
import { civilDayKey } from '../night';
import { getServiceClient } from '../supabase';
import { nightTimeZone } from '../tonight/night';
import { emptyMysteryPage, loadMysteryPage, type MysteryPageState } from './service';
import { MYSTERY_KINDS, type MysteryKind } from './types';
import { isVisitorId, MYSTERY_VISITOR_COOKIE } from './visitor';

/**
 * The kind of today's challenge **if it already exists**, for the page title (app-perf,
 * 2026-10-04): one row, read only. `generateMetadata` runs on every prefetch of `/mystery`, and
 * {@link loadMysteryOrNone} builds the day's challenge and touches the visitor's session, which a
 * prefetch must never do. `null` before the day's first visit, with no games, or on a failed read:
 * the title is then the plain `Daily`.
 */
export async function loadTodayMysteryKind(
  groupId: string,
  now: Date = new Date(),
): Promise<MysteryKind | null> {
  try {
    const { data, error } = await getServiceClient()
      .from('daily_mysteries')
      .select('kind')
      .eq('group_id', groupId)
      .eq('day', civilDayKey(now, nightTimeZone()))
      .maybeSingle();
    if (error) throw new Error(error.message);
    const kind = data?.kind;
    return MYSTERY_KINDS.find((known) => known === kind) ?? null;
  } catch (error) {
    console.error('daily mystery: reading the title failed', error);
    return null;
  }
}

/**
 * Today's mystery for a public page. Failures log and return the empty card so
 * `/` never 500s because the puzzle could not be built — and never omits the
 * block the `/mystery` tab still shows.
 *
 * The group defaults to the original one: `/` and `/mystery` are the original group's pages until
 * M13.9 and M13.12 move them under `/g/<slug>` and pass the slug's group.
 */
export async function loadMysteryOrNone(
  now: Date = new Date(),
  groupId: string = ORIGINAL_GROUP_ID,
): Promise<MysteryPageState> {
  const timeZone = nightTimeZone();
  try {
    const jar = await cookies();
    const visitor = jar.get(MYSTERY_VISITOR_COOKIE)?.value;
    return await loadMysteryPage(getServiceClient(), {
      now,
      timeZone,
      visitorId: isVisitorId(visitor) ? visitor : null,
      groupId,
    });
  } catch (error) {
    console.error('daily mystery: page load failed', error);
    return emptyMysteryPage(now, timeZone);
  }
}
