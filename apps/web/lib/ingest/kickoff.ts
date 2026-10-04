import { winProbability } from '@customs/core';
import {
  KICKOFF_COLUMNS,
  KICKOFF_MAX_SIDE,
  kickoffFromRow,
  kickoffRowOf,
  type LobbyKickoff,
} from '@customs/db/schemas';
import { readAssignments } from '../discord/assemble';
import { splitSidesOf } from '../games/receipt';
import type { ServiceClient } from '../supabase';
import { selectRatings } from './balance';
import { KUSTOM_FRESH } from './fold';

/**
 * The kickoff record (M21.4, `0046_lobby_kickoff.sql`; decision rows M21 D1 and 2026-10-05): the
 * teams that started the game, their kind and, when they are not the roll, Kustom's odds for them.
 * Written once, by the `in_progress` post, from the frozen `lobby_members` sides (the client's
 * sides as champ select began; M21.1 found them equal to the eog sides in 95 of 96 games).
 *
 * The rules, in one place:
 * - **Teams.** Members with `side` 100 or 200 and not `is_spectator`. Both sides non-empty, the
 *   same size and at most five (a 2v2 to 4v4 is a kickoff too, M21.1 note b). Anything else (a
 *   5v4 with someone in the spectator slot, a 3v0) is no record: logged, the lobby still moves,
 *   and every surface behaves as before M21 until the eog.
 * - **Kind.** {@link splitSidesOf} against the chosen split: `same` or `swapped` is `rolled`
 *   (`swapped` flagged; M21.1 note a), `different` is `custom`, no chosen split is `unrolled`.
 * - **Odds.** `rolled` stores none: the split's `blue_win_prob` is the number. `custom` and
 *   `unrolled` store core's `winProbability` over each side's summed all-time `ratings.r`, 1200
 *   for no row ({@link selectRatings}, the balancer's own read). Stored for a not-rated or ARAM
 *   game too; showing them is the reader's rule (M15.18).
 *
 * No balancing or rating maths here: the comparison is the receipt's, the odds are core's.
 */

export interface KickoffMember {
  puuid: string;
  side: number | null;
  isSpectator: boolean;
}

export type KickoffTeams =
  | { ok: true; blue: string[]; red: string[] }
  | { ok: false; reason: 'empty-side' | 'unequal-sides' | 'too-many'; blue: number; red: number };

/** The two teams at kickoff from the frozen members, or why there are none (pure). */
export function kickoffTeamsOf(members: readonly KickoffMember[]): KickoffTeams {
  const blue: string[] = [];
  const red: string[] = [];
  for (const member of members) {
    if (member.isSpectator) continue;
    if (member.side === 100) blue.push(member.puuid);
    else if (member.side === 200) red.push(member.puuid);
  }
  const counts = { blue: blue.length, red: red.length };
  if (blue.length === 0 || red.length === 0) return { ok: false, reason: 'empty-side', ...counts };
  if (blue.length !== red.length) return { ok: false, reason: 'unequal-sides', ...counts };
  if (blue.length > KICKOFF_MAX_SIDE) return { ok: false, reason: 'too-many', ...counts };
  // Sorted so the stored arrays do not depend on the order the database returned the rows in.
  return { ok: true, blue: blue.sort(), red: red.sort() };
}

/** The kickoff record for these teams (pure). `ratingOf` is a puuid's all-time `r` going in. */
export function classifyKickoff(input: {
  teams: { blue: readonly string[]; red: readonly string[] };
  /** The lobby's chosen split, or null when it has none (never rolled, or the teams came down). */
  chosen: { blue: readonly { puuid: string }[]; red: readonly { puuid: string }[] } | null;
  ratingOf: (puuid: string) => number;
  at: Date;
}): LobbyKickoff {
  const blue = [...input.teams.blue];
  const red = [...input.teams.red];
  const at = input.at.toISOString();
  if (input.chosen !== null) {
    const seats = [
      ...blue.map((puuid) => ({ puuid, side: 100 as const })),
      ...red.map((puuid) => ({ puuid, side: 200 as const })),
    ];
    const sides = splitSidesOf(input.chosen, seats);
    if (sides !== 'different') return { kind: 'rolled', blue, red, at, swapped: sides === 'swapped' };
  }
  const sum = (side: readonly string[]) => side.reduce((total, puuid) => total + input.ratingOf(puuid), 0);
  return {
    kind: input.chosen === null ? 'unrolled' : 'custom',
    blue,
    red,
    at,
    blueWinProb: winProbability(sum(blue), sum(red)),
    oddsModel: 'kustom',
  };
}

export type KickoffOutcome =
  | { outcome: 'written'; record: LobbyKickoff }
  /** A record was already there (a retry, a second companion): nothing written. */
  | { outcome: 'exists' }
  /** The lobby is not `in_game` (the move did not happen): nothing to record. */
  | { outcome: 'not-in-game' }
  /** No two equal non-empty sides: no record (logged). */
  | { outcome: 'no-teams'; reason: Extract<KickoffTeams, { ok: false }>['reason'] }
  /** Another writer stored a record between this call's read and its write. */
  | { outcome: 'lost-race' };

/**
 * Write the lobby's kickoff record if it is `in_game` and has none. Single conditional writer, as
 * `lockLobbyAtStart`: the update only lands on `status = 'in_game' and kickoff_kind is null`, so a
 * retry (whose move found the lobby already `in_game`) finishes a write a 500 cut short, and a
 * second companion writes nothing. `onWrite` runs only when this call wrote (the live signal).
 */
export async function writeKickoffAtStart(
  client: ServiceClient,
  input: { lobbyId: string; now: Date; onWrite?: () => void },
): Promise<KickoffOutcome> {
  const { data: lobby, error: lobbyError } = await client
    .from('lobbies')
    .select(`status, group_id, ${KICKOFF_COLUMNS}`)
    .eq('id', input.lobbyId)
    .maybeSingle();
  if (lobbyError) throw new Error(`kickoff: lobby read failed: ${lobbyError.message}`);
  if (lobby === null || lobby.status !== 'in_game') return { outcome: 'not-in-game' };
  if (lobby.kickoff_kind !== null) return { outcome: 'exists' };

  const [members, chosen] = await Promise.all([
    client
      .from('lobby_members')
      .select('player_id, side, is_spectator, players!inner(puuid)')
      .eq('lobby_id', input.lobbyId),
    client.from('splits').select('blue, red').eq('lobby_id', input.lobbyId).eq('is_chosen', true).maybeSingle(),
  ]);
  if (members.error) throw new Error(`kickoff: member read failed: ${members.error.message}`);
  if (chosen.error) throw new Error(`kickoff: split read failed: ${chosen.error.message}`);

  const rows = members.data ?? [];
  const teams = kickoffTeamsOf(
    rows.map((row) => ({ puuid: row.players.puuid, side: row.side, isSpectator: row.is_spectator })),
  );
  if (!teams.ok) {
    console.info(
      `kickoff: lobby ${input.lobbyId} has no kickoff teams (${teams.reason}, ${teams.blue} blue, ${teams.red} red)`,
    );
    return { outcome: 'no-teams', reason: teams.reason };
  }

  const split =
    chosen.data === null ? null : { blue: readAssignments(chosen.data.blue), red: readAssignments(chosen.data.red) };
  // Ratings only matter when the record carries odds; a rolled game reads the split's.
  const playing = new Set([...teams.blue, ...teams.red]);
  const ratings = await selectRatings(
    client,
    rows.filter((row) => playing.has(row.players.puuid)).map((row) => row.player_id),
    lobby.group_id,
  );
  const rByPuuid = new Map<string, number>();
  for (const row of rows) {
    rByPuuid.set(row.players.puuid, (ratings.get(row.player_id) ?? KUSTOM_FRESH).r);
  }
  const record = classifyKickoff({
    teams,
    chosen: split,
    ratingOf: (puuid) => rByPuuid.get(puuid) ?? KUSTOM_FRESH.r,
    at: input.now,
  });

  const { data, error } = await client
    .from('lobbies')
    .update(kickoffRowOf(record))
    .eq('id', input.lobbyId)
    .eq('status', 'in_game')
    .is('kickoff_kind', null)
    .select('id');
  if (error) throw new Error(`kickoff: lobby write failed: ${error.message}`);
  if ((data ?? []).length === 0) return { outcome: 'lost-race' };
  input.onWrite?.();
  return { outcome: 'written', record };
}

/**
 * The lobby's kickoff record, or null for none: the one read Tonight (M21.5) and the `Game on`
 * post (M21.6) go through, parsed by `kickoffFromRow` so every reader sees the same shape.
 */
export async function readLobbyKickoff(client: ServiceClient, lobbyId: string): Promise<LobbyKickoff | null> {
  const { data, error } = await client.from('lobbies').select(KICKOFF_COLUMNS).eq('id', lobbyId).maybeSingle();
  if (error) throw new Error(`kickoff: lobby read failed: ${error.message}`);
  return data === null ? null : kickoffFromRow(data);
}
