import { z } from 'zod';
import { roleSchema, sideSchema } from './common';

/**
 * `public.game_facts.facts` (0041): what `rawFactsFromUnknown` (`apps/web/lib/stats/rawFacts.ts`)
 * returns for one game's `games.raw`, stored at ingest so no reader detoasts the 60 KB block for
 * about 5 KB of facts (`redesign/research/db-performance.md` finding 1).
 *
 * The writer is the TypeScript reader itself, so this schema is the shape it returns, field for
 * field. It is the boundary a reader checks a stored row against: a row that does not parse is
 * treated like a missing one and the game's raw is read instead (`lib/stats/gameFacts.ts`), so a
 * hand-edited or half-written row is never a wrong number. `rawFacts.test.ts` pins that the
 * function's output parses and that the inferred type is the function's own.
 *
 * `facts_version` is the code's `GAME_FACTS_VERSION`: bumped when the function changes what it
 * returns, which makes every older row a recompute for `backfill-game-facts` and a raw read for the
 * reader meanwhile.
 */

const count = z.number().int();
const nullableInt = z.number().int().nullable();

export const storedPlayerFactsSchema = z.object({
  firstBloodKill: z.boolean(),
  firstBloodAssist: z.boolean(),
  firstBloodDeath: z.boolean(),
  visionScore: nullableInt,
  damageSelfMitigated: nullableInt,
  damageToObjectives: nullableInt,
  objectivesStolen: count,
  objectivesStolenAssists: count,
  baronKills: count,
  dragonKills: count,
  riftHeraldKills: count,
  hordeKills: count,
  atakhanKills: count,
  longestLivedS: nullableInt,
  championName: z.string().nullable(),
  role: roleSchema.nullable(),
  smite: z.boolean(),
  timelineLane: z.string().nullable(),
  timelineRole: z.string().nullable(),
  pentaKills: count,
  quadraKills: count,
  tripleKills: count,
  doubleKills: count,
  largestKillingSpree: count,
  firstTowerKill: z.boolean(),
  damageTaken: nullableInt,
});

export const storedBanSchema = z.object({
  championId: z.number().int().positive(),
  teamId: sideSchema,
});

/** `game_facts.facts`. */
export const storedGameFactsSchema = z.object({
  byPuuid: z.record(z.string(), storedPlayerFactsSchema),
  bans: z.array(storedBanSchema),
});

export type StoredPlayerFacts = z.infer<typeof storedPlayerFactsSchema>;
export type StoredGameFacts = z.infer<typeof storedGameFactsSchema>;

/** `game_facts.facts_version`: a smallint, at least 1 (0041's check). */
export const gameFactsVersionSchema = z.number().int().min(1).max(32_767);

/** One `game_facts` row as a reader selects it (`facts_version, facts`). */
export const gameFactsRowSchema = z.object({
  facts_version: gameFactsVersionSchema,
  facts: storedGameFactsSchema,
});

export type GameFactsRow = z.infer<typeof gameFactsRowSchema>;

/**
 * `public.group_member_game_counts` (0042), one row per (group, player): every stored game the player
 * is on in that group, rated or not, and the newest one's start. Service role only. The view's columns
 * are nullable to PostgREST's type generator (every view column is); they never are, which this checks.
 */
export const memberGameCountRowSchema = z.object({
  player_id: z.string().min(1),
  games: z.number().int().min(1),
  last_played_at: z.string(),
});

export type MemberGameCountRow = z.infer<typeof memberGameCountRowSchema>;
