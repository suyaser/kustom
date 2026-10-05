import { type LobbyStatus, ROLES, type Role, type Side } from '@customs/core';
import { z } from 'zod';

/**
 * The primitives every other schema is built from. The literal values here are the same
 * values the database enums use (`0001_init.sql`) and the same unions `@customs/core`
 * declares, so a drift is a compile error rather than a runtime surprise.
 */

/**
 * The PUUID every bot in every game shares in an end-of-game block (16.17, verified
 * 2026-09-08). It is not a player and it must never reach `players.puuid`: PUUID is the
 * identity, so one row keyed on this would be every bot that has ever played, forever.
 */
export const ZERO_PUUID = '00000000-0000-0000-0000-000000000000';

/**
 * True for the two values the client uses where a person's PUUID would go and no person is
 * there: `""` (a lobby bot slot) and the all-zero PUUID (a bot on a scoreboard).
 *
 * This is *not* how bots are detected — that is `isBot` in a lobby and `botPlayer` in an
 * end-of-game block, and it is the mapper's job (`04-decisions.md`, 2026-09-08). This is the
 * value check that refuses the placeholder if one gets past the mapper anyway.
 */
export function isPlaceholderPuuid(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 || trimmed === ZERO_PUUID;
}

/**
 * A Riot PUUID. This is the identity for a player everywhere in the system; never a summoner
 * name, a Riot ID or a Discord ID (CLAUDE.md "Hard rules").
 *
 * Deliberately loose about *shape*: the client is the only source of PUUIDs and we do not
 * want a length or format assumption to drop a real player. Strict about the two placeholder
 * values above, which are known not to be people (M2.10, point 10).
 */
export const puuidSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !isPlaceholderPuuid(value),
    'puuid is a placeholder (empty or all-zero): a bot or an empty slot, never a player',
  )
  .brand<'Puuid'>();

export type Puuid = z.infer<typeof puuidSchema>;

/**
 * `players.summoner_id`, as the client reports it and as we store it.
 *
 * The client sends a JSON **number** (`members[].summonerId` is `47890856` in the 16.17 lobby
 * fixture) and it is not 32-bit: an invitee's id read `2686822975473024`, which is above
 * 2^51 and still a safe JS integer. `players.summoner_id` is `text` in `0001_init.sql`, so
 * this normalises to a decimal string and **no migration is needed** — the number never
 * becomes a bigint column, so no precision is at risk.
 *
 * Absent, null, `""` and `0` all mean "not known": `0` is what the client puts on a bot slot,
 * and storing it would make every bot look like the same summoner. Anything that is not a
 * run of digits is refused, because a summoner id that is not a number is not a summoner id.
 */
export const summonerIdSchema = z
  .union([
    z
      .number()
      .int()
      .nonnegative()
      .refine((value) => Number.isSafeInteger(value), 'summonerId is outside the safe integer range'),
    z.string().trim().regex(/^\d*$/, 'summonerId must be digits'),
  ])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const text = typeof value === 'number' ? String(value) : value;
    return text === '' || /^0+$/.test(text) ? null : text;
  });

/** `'top' | 'jungle' | 'mid' | 'adc' | 'support'`, straight from `@customs/core`. */
export const roleSchema = z.enum(ROLES);

/** Team side, matching the League client: 100 blue, 200 red. */
export const sideSchema = z.union([z.literal(100), z.literal(200)]);

/**
 * Every lobby status, in lifecycle order — the same order as the `lobby_status` enum in the
 * database, so `Constants.public.Enums.lobby_status` and this array read alike. Pinned
 * against `LobbyStatus` from core.
 *
 * `dropped` (M5.11, `0005_lobby_dropped.sql`) sits between `in_game` and `finished` because
 * that is where it happens: reached `in_game`, no result, roster frozen for good, and out of
 * the live set so the party's next post starts the night's next cycle.
 */
export const LOBBY_STATUSES = [
  'open',
  'balanced',
  'in_game',
  'dropped',
  'finished',
  'abandoned',
] as const satisfies readonly LobbyStatus[];

export const lobbyStatusSchema = z.enum(LOBBY_STATUSES);

/** How a game reached us: the companion's end-of-game block, or a match-history backfill. */
export const gameSourceSchema = z.enum(['eog', 'backfill']);

/** Commands the server queues for a companion to execute (M4.1). */
export const companionCommandKindSchema = z.enum(['switch_side']);

/** Lifecycle of a queued command. */
export const companionCommandStatusSchema = z.enum(['pending', 'sent', 'acked', 'failed']);

/**
 * An LCU game id. The client sends a number; some transports stringify it. Both are
 * accepted and normalised to a number, which is what `games.lcu_game_id` (bigint) holds.
 */
export const lcuGameIdSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value))
    .refine((value) => Number.isSafeInteger(value) && value > 0, 'game id is out of range'),
]);

/**
 * An arbitrary JSON object we keep verbatim (`games.raw`, `companion_commands.payload`).
 * Passthrough by design: we assert it is an object and nothing more, so a client patch
 * that adds fields never drops a game.
 */
export const jsonObjectSchema = z.record(z.string(), z.unknown());

/** An OpenSkill rating as stored on `ratings` and `game_players`. */
export const ratingSchema = z.object({
  mu: z.number().finite(),
  sigma: z.number().finite().positive(),
});

export type RoleValue = z.infer<typeof roleSchema>;
export type SideValue = z.infer<typeof sideSchema>;
export type LobbyStatusValue = z.infer<typeof lobbyStatusSchema>;
export type GameSourceValue = z.infer<typeof gameSourceSchema>;
export type CompanionCommandKind = z.infer<typeof companionCommandKindSchema>;
export type CompanionCommandStatus = z.infer<typeof companionCommandStatusSchema>;
export type JsonObject = z.infer<typeof jsonObjectSchema>;

// The schemas above are the database's and core's vocabulary or they are nothing. These
// three lines fail the build if any of them drifts.
type _RoleMatchesCore = RoleValue extends Role ? (Role extends RoleValue ? true : never) : never;
type _SideMatchesCore = SideValue extends Side ? (Side extends SideValue ? true : never) : never;
type _LobbyStatusMatchesCore = LobbyStatusValue extends LobbyStatus
  ? LobbyStatus extends LobbyStatusValue
    ? true
    : never
  : never;

export const SCHEMA_VOCABULARY_MATCHES_CORE: [_RoleMatchesCore, _SideMatchesCore, _LobbyStatusMatchesCore] = [
  true,
  true,
  true,
];
