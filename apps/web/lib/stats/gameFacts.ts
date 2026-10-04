import {
  type GameFactsInsert,
  gameFactsRowSchema,
  type Json,
  type StoredGameFacts,
  type StoredPlayerFacts,
} from '@customs/db';
import { mapChunks } from '../chunks';
import type { PublicClient } from '../publicClient';
import type { ServiceClient } from '../supabase';
import { type RawGameFacts, type RawPlayerFacts, rawFactsFromUnknown } from './rawFacts';

/**
 * `public.game_facts` (0041): {@link rawFactsFromUnknown} of a game's `games.raw`, stored once at
 * ingest so the Stats folds, the `/games` cards and the daily game read about 5 KB a game instead
 * of detoasting the 60 KB block (`redesign/research/db-performance.md` finding 1).
 *
 * **One implementation.** The writer is `rawFactsFromUnknown` itself, so a stored row is exactly
 * what a reader of `raw` would compute. Nothing in SQL knows the shape.
 *
 * **Derived, never trusted over raw.** A reader takes a row only when it parses
 * (`gameFactsRowSchema`) and carries {@link GAME_FACTS_VERSION}; for anything else (no row yet,
 * an older version, a malformed hand edit) it reads that game's raw paths instead
 * ({@link factsFromRaw}). The deploy order can therefore cost speed, never a number.
 */

/**
 * Bump when `rawFactsFromUnknown` changes what it returns. Every stored row below it is then read
 * from raw until `pnpm --filter web backfill-game-facts` recomputes it.
 */
export const GAME_FACTS_VERSION = 1;

/* The stored shape is the function's shape, both ways: a drift is a compile error here. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _playerShape: Same<RawPlayerFacts, StoredPlayerFacts> = true;
const _gameShape: Same<RawGameFacts, StoredGameFacts> = true;
void _playerShape;
void _gameShape;

/** The row ingest and the backfill write for one game's stored raw. */
export function gameFactsInsert(
  game: { id: string; groupId: string },
  raw: unknown,
  /** Tests only: what a later code version would stamp. */
  version: number = GAME_FACTS_VERSION,
): GameFactsInsert {
  return {
    game_id: game.id,
    group_id: game.groupId,
    facts_version: version,
    facts: rawFactsFromUnknown(raw) as unknown as Json,
  };
}

/**
 * Writes facts rows. `replace` overwrites (a first post, a ban enrichment that rewrote raw, a
 * backfill recompute); `fill` only inserts a game that has no row, so a repeated post of a stored
 * game writes nothing.
 */
export async function writeGameFacts(
  client: ServiceClient,
  rows: readonly GameFactsInsert[],
  mode: 'replace' | 'fill',
): Promise<void> {
  if (rows.length === 0) return;
  const stamped = rows.map((row) => ({ ...row, updated_at: new Date().toISOString() }));
  const { error } = await client
    .from('game_facts')
    .upsert(stamped, { onConflict: 'game_id', ignoreDuplicates: mode === 'fill' });
  if (error) throw new Error(`game facts: write failed: ${error.message}`);
}

/**
 * The facts of an embedded `game_facts(facts_version, facts)` (an array of zero or one row through
 * the composite foreign key, or one object), when it is current; `null` sends the caller to raw.
 */
export function currentFacts(embed: unknown): RawGameFacts | null {
  const row = Array.isArray(embed) ? embed[0] : embed;
  if (row === undefined || row === null) return null;
  const parsed = gameFactsRowSchema.safeParse(row);
  if (!parsed.success) {
    console.warn('game facts: a stored row did not parse; reading raw for that game');
    return null;
  }
  if (parsed.data.facts_version !== GAME_FACTS_VERSION) return null;
  return parsed.data.facts;
}

/**
 * The fallback: the four top-level keys `rawFactsFromUnknown` and `gameModeFromRaw` read, as JSON
 * paths (never the column), for the games that have no current facts row. Empty in, no request.
 * This is the one list read of `raw->` paths left (`lib/perf/rawColumns.test.ts`), and once the
 * backfill has run it reads nothing.
 */
export async function factsFromRaw(
  client: PublicClient | ServiceClient,
  gameIds: readonly string[],
): Promise<Map<string, RawGameFacts>> {
  const facts = new Map<string, RawGameFacts>();
  const pages = await mapChunks(gameIds, async (chunk) => {
    const { data, error } = await client
      .from('games')
      .select(
        'id, gameMode:raw->gameMode, teams:raw->teams, participants:raw->participants, participantIdentities:raw->participantIdentities',
      )
      .in('id', chunk);
    if (error) throw new Error(`game facts: raw fallback failed: ${error.message}`);
    return data ?? [];
  });
  for (const page of pages) {
    for (const row of page) facts.set(row.id, rawFactsFromUnknown(rawFromPaths(row)));
  }
  return facts;
}

/**
 * Current facts for every game in `rows`, from its embed or (for the rest) from raw, in one extra
 * round trip at most.
 */
export async function resolveFacts(
  client: PublicClient | ServiceClient,
  rows: readonly { id: string; game_facts?: unknown }[],
): Promise<Map<string, RawGameFacts>> {
  const facts = new Map<string, RawGameFacts>();
  const missing: string[] = [];
  for (const row of rows) {
    const stored = currentFacts(row.game_facts);
    if (stored === null) missing.push(row.id);
    else facts.set(row.id, stored);
  }
  if (missing.length > 0) {
    for (const [id, value] of await factsFromRaw(client, missing)) facts.set(id, value);
  }
  return facts;
}

/**
 * The selected paths put back into the shape the two readers take (`gameModeFromRaw`,
 * `rawFactsFromUnknown`), which read only these four keys. A missing key, or a `raw` that is
 * null or not an object, comes back from PostgREST as `null` on every path, and both readers
 * treat a null key exactly as they treat a missing one or a missing column: no mode, no facts.
 */
export function rawFromPaths(row: {
  gameMode?: unknown;
  teams?: unknown;
  participants?: unknown;
  participantIdentities?: unknown;
}): Record<string, unknown> {
  return {
    gameMode: row.gameMode ?? null,
    teams: row.teams ?? null,
    participants: row.participants ?? null,
    participantIdentities: row.participantIdentities ?? null,
  };
}
