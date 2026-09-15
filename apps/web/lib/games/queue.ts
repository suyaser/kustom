import { z } from 'zod';

/**
 * Which customs `/games` and `/fun` are listing.
 *
 * **Summoner's Rift is the default.** Howling Abyss is the other list, labelled ARAM because
 * that is what the group calls those customs. The client does not: a Howling Abyss custom in
 * this group's match history is `gameMode: "KIWI"` / `mapId: 12` / queue 3270, not `"ARAM"`
 * (that string is the matched ARAM queue, which we never ingest). M5.26 left KIWI on neither
 * list, so the ARAM chip was empty and those nights vanished from `/games` and `/fun`.
 *
 * Map id wins when `games.raw` has it (match-history). Mode is the fallback (the end-of-game
 * block has `gameMode` and no `mapId`).
 */

export const QUEUE_ORDER = ['sr', 'aram'] as const;

export type QueueKind = (typeof QUEUE_ORDER)[number];

/** Summoner's Rift. Match-history `mapId`. */
export const SUMMONERS_RIFT_MAP_ID = 11;

/** Howling Abyss. Match-history `mapId`. */
export const HOWLING_ABYSS_MAP_ID = 12;

/** `/games` and `/fun` open on Rift. One tap is Howling Abyss. */
export const GAMES_QUEUE: QueueKind = 'sr';

export const queueKindSchema = z.enum(QUEUE_ORDER);

/**
 * The `?queue=` value, or `null` for anything that is not one of the two.
 *
 * Absent is the page's default (Rift). An unknown value is a 404, same rule as `?window=`.
 */
export function parseQueue(value: string | string[] | undefined, fallback: QueueKind): QueueKind | null {
  if (value === undefined) return fallback;
  const parsed = queueKindSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The client's `gameMode` off `games.raw`: `CLASSIC`, `ARAM`, `KIWI`, or null when the
 * block never named one.
 */
export function gameModeFromRaw(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const mode = (raw as { gameMode?: unknown }).gameMode;
  if (typeof mode !== 'string') return null;
  const trimmed = mode.trim();
  return trimmed === '' ? null : trimmed.toUpperCase();
}

/**
 * The client's `mapId` off `games.raw`. Present on match-history detail; absent on the
 * end-of-game block.
 */
export function mapIdFromRaw(raw: unknown): number | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = (raw as { mapId?: unknown }).mapId;
  return typeof id === 'number' && Number.isInteger(id) ? id : null;
}

/**
 * Which of the two lists a stored custom belongs on, or `null` when it is neither map.
 *
 * Howling Abyss is map 12, or `ARAM` / `KIWI` when the blob has no map. Rift is map 11, or
 * `CLASSIC` / a missing mode (every night captured before this page existed was Rift).
 */
export function queueKindOf(gameMode: string | null | undefined, mapId?: number | null): QueueKind | null {
  if (mapId === HOWLING_ABYSS_MAP_ID) return 'aram';
  if (mapId === SUMMONERS_RIFT_MAP_ID) return 'sr';
  const mode = (gameMode ?? '').trim().toUpperCase();
  if (mode === 'ARAM' || mode === 'KIWI') return 'aram';
  if (mode === '' || mode === 'CLASSIC') return 'sr';
  return null;
}

export function matchesQueue(
  gameMode: string | null | undefined,
  queue: QueueKind,
  mapId?: number | null,
): boolean {
  return queueKindOf(gameMode, mapId) === queue;
}

/**
 * Whether a stored custom is one the rating fold counts: Summoner's Rift only.
 *
 * Same rule `/games` uses for the default list. Howling Abyss (ARAM / KIWI / map 12) is still
 * stored — it just does not move Proven, Rating, or the leaderboard record.
 */
export function isRatedGameMode(gameMode: string | null | undefined, mapId?: number | null): boolean {
  return queueKindOf(gameMode, mapId) === 'sr';
}
