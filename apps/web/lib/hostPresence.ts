import 'server-only';
import type { ServiceClient } from './supabase';
import { isNameless, renderWebName } from './tonight/copy';

/**
 * The group's hosts and whether any of them is up (M14.66): who Tonight names when nobody's Kustom
 * is running, and the window lobby ingest uses. Moved out of the retired `lib/lobbyStart.ts`
 * (M22.11, Start a lobby removed) unchanged.
 */

/**
 * How recently a companion must have been seen for its player to count as up.
 *
 * Ten minutes, and `last_seen_at` means "at their PC with League open" from M4.1 on — the
 * commands poll writes it only when the client is up. `lib/commands/switchSide.ts` uses the same
 * window for the same reason.
 */
export const HOST_WINDOW_MS = 10 * 60_000;

/** One unrevoked token of the group, as {@link readHostPresence} reads it. */
interface HostTokenRow {
  player_id: string;
  last_seen_at: string | null;
  players: { display_name: string | null; game_name: string | null; created_at: string };
}

async function selectGroupHostTokens(client: ServiceClient, groupId: string): Promise<HostTokenRow[]> {
  const { data, error } = await client
    .from('companion_tokens')
    .select('player_id, last_seen_at, players!inner(display_name, game_name, created_at)')
    .eq('group_id', groupId)
    .is('revoked_at', null);
  if (error) throw new Error(`group hosts: ${error.message}`);
  return data ?? [];
}

/**
 * The group's hosts by name (M14.66): every player with an unrevoked companion token **of this
 * group**, seen or not, oldest player first, named the way the strip names admins
 * (`display_name`, else the Riot game name, through `renderWebName`). Nameless hosts are dropped
 * rather than printed as `Someone`: `Ask Someone to open it` names nobody.
 */
function hostNamesOf(rows: readonly HostTokenRow[]): string[] {
  const byPlayer = new Map<string, HostTokenRow['players']>();
  for (const row of rows) byPlayer.set(row.player_id, row.players);
  return [...byPlayer.entries()]
    .sort(
      ([leftId, left], [rightId, right]) =>
        left.created_at.localeCompare(right.created_at) || leftId.localeCompare(rightId),
    )
    .map(([, player]) => player.display_name ?? player.game_name ?? null)
    .filter((name) => !isNameless(name))
    .map(renderWebName);
}

export async function readGroupHostNames(client: ServiceClient, groupId: string): Promise<string[]> {
  return hostNamesOf(await selectGroupHostTokens(client, groupId));
}

/** What Tonight shows before anyone taps (M14.66): who hosts, and whether any of them is up. */
export interface HostPresence {
  /** {@link readGroupHostNames}: every named host of the group, oldest player first. */
  hostNames: string[];
  /** An unrevoked token of the group seen inside {@link HOST_WINDOW_MS}: somebody can host. */
  hostSeenRecently: boolean;
}

/** One read for both facts; "recently" is {@link HOST_WINDOW_MS}. */
export async function readHostPresence(
  client: ServiceClient,
  options: { groupId: string; now?: Date | undefined },
): Promise<HostPresence> {
  return hostPresenceFrom(await readHostFacts(client, options.groupId), options.now);
}

/**
 * The stored facts behind {@link HostPresence}, before "recently" is decided: the named hosts and
 * every unrevoked token's `last_seen_at`. Plain JSON, so Tonight may keep it in the server cache for
 * a few seconds and still decide "recently" against its own clock on every render.
 */
export interface HostFacts {
  hostNames: string[];
  lastSeen: (string | null)[];
}

export async function readHostFacts(client: ServiceClient, groupId: string): Promise<HostFacts> {
  const rows = await selectGroupHostTokens(client, groupId);
  return { hostNames: hostNamesOf(rows), lastSeen: rows.map((row) => row.last_seen_at) };
}

/** {@link HostPresence} from its facts at `now`. Pure. */
export function hostPresenceFrom(facts: HostFacts, now: Date = new Date()): HostPresence {
  const at = now.getTime();
  return {
    hostNames: facts.hostNames,
    hostSeenRecently: facts.lastSeen.some((seen) => seen !== null && Date.parse(seen) >= at - HOST_WINDOW_MS),
  };
}

