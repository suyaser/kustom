import type { RuleCheck } from '@customs/db/schemas';
import { isRosterChampion } from '../champs/names';
import { storedChampionNames } from '../fearless/present';
import type { PublicClient } from '../publicClient';

/**
 * The client's own names for the champions a rule check names that the pinned table cannot
 * (M15.10). A champion newer than the Data Dragon pin has no class or region row, so the check
 * calls it `couldn't check`; without this the line then printed `couldn't check Champion 950`
 * although the end-of-game block carried its name, which the Fearless pool and the scoreboard
 * already print. Same source as the pool (`storedChampionNames` over `games.raw`), so the surfaces
 * agree. Champions only: nothing here reads or returns a person.
 */

/** Every champion key the stored check names (broke, unknown, mirror pairs). */
export function checkKeys(check: RuleCheck): number[] {
  if (check.kind === 'sides')
    return [...check.blue.broke, ...check.blue.unknown, ...check.red.broke, ...check.red.unknown];
  if (check.kind === 'lanes') {
    return check.lanes.flatMap((lane) => [lane.blue, lane.red]).filter((key): key is number => key !== null);
  }
  return [];
}

/** The keys of `check` the pinned table cannot name: the only ones worth a read. */
export function unnamedKeys(check: RuleCheck): Set<number> {
  return new Set(checkKeys(check).filter((key) => !isRosterChampion(key)));
}

/**
 * The client's names for this game's unnamed check keys, by key. One read, only when there is an
 * unnamed key; a failed read logs and answers none, so a line never goes missing over a name.
 */
export async function loadCheckNames(
  client: PublicClient,
  gameId: string,
  check: RuleCheck | null,
): Promise<Record<number, string>> {
  if (check === null) return {};
  const wanted = unnamedKeys(check);
  if (wanted.size === 0) return {};
  // Only the seats that played an unnamed champion; the blob is keyed by puuid, which anon reads
  // off `players_public` (the base `players` table is not granted to anon).
  const [game, seats] = await Promise.all([
    client.from('games').select('raw').eq('id', gameId).maybeSingle(),
    client
      .from('game_players')
      .select('player_id, champion_id')
      .eq('game_id', gameId)
      .in('champion_id', [...wanted]),
  ]);
  if (game.error || seats.error || game.data === null) {
    const message = game.error?.message ?? seats.error?.message;
    if (message !== undefined) console.error('mode: reading the client champion names failed', message);
    return {};
  }
  const ids = (seats.data ?? []).map((seat) => seat.player_id);
  const people = await client.from('players_public').select('id, puuid').in('id', ids);
  if (people.error) {
    console.error('mode: reading puuids for the client champion names failed', people.error.message);
    return {};
  }
  const puuidOf = new Map((people.data ?? []).map((row) => [row.id, row.puuid]));
  return Object.fromEntries(
    storedChampionNames(
      [
        {
          raw: game.data.raw,
          seats: (seats.data ?? []).map((seat) => ({
            championId: seat.champion_id,
            puuid: puuidOf.get(seat.player_id) ?? null,
          })),
        },
      ],
      wanted,
    ),
  );
}
