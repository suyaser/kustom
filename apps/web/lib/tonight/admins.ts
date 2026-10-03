import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { groupAdminNames } from '../groups/membership';
import { getServiceClient, type ServiceClient } from '../supabase';
import type { PlayerName } from './types';

/**
 * The admins' display names, for the strip's `Waiting on Yasser or Omar to roll the teams.`
 * (2026-10-03). A night with no admin online stalls at ten; naming who can roll is the fix that
 * was chosen, and it changes nobody's permissions.
 *
 * **The group's admins** (M13.4): `group_memberships.role = 'admin'` in the page's group, oldest
 * player first. Read with the service role on the server — the role column is not public — and
 * only the names reach the page, which is the same fact the strip has always printed.
 *
 * Read **once with the page** and never on a Realtime event: who the admins are does not change
 * during a night.
 */
export async function loadAdminNames(client: ServiceClient, groupId: string): Promise<PlayerName[]> {
  return groupAdminNames(client, groupId);
}

/**
 * The same, and an empty list on any failure: the page's answer to "is the night happening" may
 * not depend on a sentence that names admins, and with none the strip says `an admin`.
 *
 * The group defaults to the original one: the tonight page is the original group's until M13.9
 * moves it under `/g/<slug>` and passes the slug's group.
 */
export async function loadAdminNamesOrNone(groupId: string = ORIGINAL_GROUP_ID): Promise<PlayerName[]> {
  try {
    return await loadAdminNames(getServiceClient(), groupId);
  } catch (error) {
    console.error('tonight: reading the admins failed', error);
    return [];
  }
}
