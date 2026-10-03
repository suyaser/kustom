import { groupSlugSchema } from '@customs/db/schemas';
import { isGameId } from '../og/load';
import type { PublicClient } from '../publicClient';
import type { PageGroup } from './pageGroup';

/**
 * What a `/g/<x>` segment names (M13.9), read with the **anon key**: a group page is public by
 * link, so resolving it needs nothing the WhatsApp reader does not have.
 *
 * - A slug that `groups_public` knows: that group.
 * - A uuid that is a game: M11.4 put `/g/<games.id>` into Discord result posts, and those links
 *   must keep working, so the caller 308s to the game's group's `/g/<slug>/games/<id>`. Slugs
 *   are 3 to 32 characters and a uuid is 36 (`0018_groups.sql`), so the two never meet.
 * - Anything else -- an unknown slug, a uuid that is no game, a malformed segment: nothing. The
 *   caller 404s; **never another group's page**.
 */
export type GroupParam =
  | { kind: 'group'; group: PageGroup }
  | { kind: 'game'; gameId: string; slug: string }
  | { kind: 'none' };

const NONE: GroupParam = { kind: 'none' };

export async function resolveGroupParam(client: PublicClient, param: string): Promise<GroupParam> {
  if (isGameId(param)) return resolveGame(client, param);
  // A segment that cannot be a slug is not looked up: an uppercase `/g/Customs` or a 300-byte
  // path is a 404 for free, and the check is the one the database's own constraint makes.
  if (!groupSlugSchema.safeParse(param).success) return NONE;

  const { data, error } = await client
    .from('groups_public')
    .select('id, slug, name')
    .eq('slug', param)
    .maybeSingle();
  if (error) throw new Error(`group lookup failed: ${error.message}`);
  return toGroup(data);
}

/** A group by id, for a page that already knows which one it shows (the unmoved pages' shell). */
export async function loadGroupById(client: PublicClient, groupId: string): Promise<PageGroup | null> {
  const { data, error } = await client
    .from('groups_public')
    .select('id, slug, name')
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw new Error(`group lookup failed: ${error.message}`);
  const resolved = toGroup(data);
  return resolved.kind === 'group' ? resolved.group : null;
}

async function resolveGame(client: PublicClient, gameId: string): Promise<GroupParam> {
  const { data: game, error } = await client
    .from('games')
    .select('id, group_id')
    .eq('id', gameId)
    .maybeSingle();
  if (error) throw new Error(`game group lookup failed: ${error.message}`);
  if (game === null) return NONE;

  const { data: group, error: groupError } = await client
    .from('groups_public')
    .select('slug')
    .eq('id', game.group_id)
    .maybeSingle();
  if (groupError) throw new Error(`game group lookup failed: ${groupError.message}`);
  if (group?.slug == null) return NONE;
  return { kind: 'game', gameId: game.id, slug: group.slug };
}

/** The view's columns are all nullable to the generated types; a row missing one names nothing. */
function toGroup(row: { id: string | null; slug: string | null; name: string | null } | null): GroupParam {
  if (row === null || row.id === null || row.slug === null || row.name === null) return NONE;
  return { kind: 'group', group: { id: row.id, slug: row.slug, name: row.name } };
}
