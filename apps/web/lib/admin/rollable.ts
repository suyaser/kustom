import { lobbyRosterKey, selectMemberPuuids } from '../ingest/lobby';
import { PLAYERS_PER_GAME } from '../lobbyState';
import type { ServiceClient } from '../supabase';
import { playerLabel } from './playerName';

/**
 * What `/admin`'s Roll card needs to draw (2026-10-03): the lobby a press of `Roll teams`
 * would balance, the roster it would balance, and the key that names that roster.
 *
 * Read-only. The write is `POST /api/admin/lobbies/[lobbyId]/roll` (`lib/admin/roll.ts`), and
 * this exists so the page and the route agree before the press rather than after it:
 *
 *   - `rosterKey` is {@link lobbyRosterKey} over {@link selectMemberPuuids} — the **same two
 *     functions** the route calls to compute the key it expects, so a press made against what
 *     this render showed is exactly the roster the route compares with, and a friend joining or
 *     leaving in between is the route's 409, not a wrong ten;
 *   - `stage` mirrors the route's own refusals: `waiting` under ten (the route answers 409, so
 *     no button), `ready` at ten or more, and `repair` for a `balanced` lobby whose roll claimed
 *     it and never wrote a chosen split — the one balanced case the route re-rolls.
 */

export type AdminRollStage = 'waiting' | 'ready' | 'repair';

export interface RollableLobby {
  id: string;
  lobbyName: string | null;
  status: 'open' | 'balanced';
  stage: AdminRollStage;
  /** Distinct people around, spectators included. The route counts the same way. */
  around: number;
  /** What the form posts. `''` only for an empty lobby, which is `waiting` and draws no form. */
  rosterKey: string;
  /** Who the press names, for the admin to check before pressing. Spectators flagged. */
  members: readonly { puuid: string; label: string; spectator: boolean }[];
}

/**
 * The newest lobby a roll could act on, or `null` when there is none: no lobby at all, the newest
 * candidate already has teams (that is the Reroll card's), or it is past `balanced`.
 */
export async function getRollableLobby(client: ServiceClient): Promise<RollableLobby | null> {
  const { data: lobby, error } = await client
    .from('lobbies')
    .select('id, status, lobby_name')
    .in('status', ['open', 'balanced'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getRollableLobby: lobby lookup failed: ${error.message}`);
  if (!lobby || (lobby.status !== 'open' && lobby.status !== 'balanced')) return null;

  if (lobby.status === 'balanced' && (await hasChosenSplit(client, lobby.id))) return null;

  const [puuids, members] = await Promise.all([
    selectMemberPuuids(client, lobby.id),
    selectMemberLabels(client, lobby.id),
  ]);
  const around = new Set(puuids).size;

  return {
    id: lobby.id,
    lobbyName: lobby.lobby_name,
    status: lobby.status,
    stage: lobby.status === 'balanced' ? 'repair' : around >= PLAYERS_PER_GAME ? 'ready' : 'waiting',
    around,
    rosterKey: lobbyRosterKey(puuids),
    members,
  };
}

async function hasChosenSplit(client: ServiceClient, lobbyId: string): Promise<boolean> {
  const { data, error } = await client
    .from('splits')
    .select('id')
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getRollableLobby: chosen split lookup failed: ${error.message}`);
  return data !== null;
}

async function selectMemberLabels(client: ServiceClient, lobbyId: string): Promise<RollableLobby['members']> {
  const { data, error } = await client
    .from('lobby_members')
    .select('is_spectator, created_at, players!inner(puuid, display_name, game_name, tag_line)')
    .eq('lobby_id', lobbyId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getRollableLobby: member lookup failed: ${error.message}`);

  const seen = new Set<string>();
  const members: { puuid: string; label: string; spectator: boolean }[] = [];
  for (const row of data ?? []) {
    const player = row.players;
    if (seen.has(player.puuid)) continue;
    seen.add(player.puuid);
    members.push({
      puuid: player.puuid,
      label: playerLabel({
        puuid: player.puuid,
        displayName: player.display_name,
        gameName: player.game_name,
        tagLine: player.tag_line,
      }),
      spectator: row.is_spectator,
    });
  }
  return members;
}
