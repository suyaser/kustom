import { z } from 'zod';
import {
  gameSourceSchema,
  isPlaceholderPuuid,
  jsonObjectSchema,
  lcuGameIdSchema,
  puuidSchema,
  type RoleValue,
  roleSchema,
  type SideValue,
  sideSchema,
  summonerIdSchema,
} from './common';

/**
 * The three bodies the companion POSTs to `/api/companion/*`, aligned with the real 16.17
 * client shapes (M2.10). The companion imports these to build its requests and the API
 * imports them to parse the request body, so there is exactly one definition of each payload.
 *
 * **This file is the wire contract, not the client's shape.** The raw-LCU-to-payload mapper
 * lives in `packages/lcu` (`04-decisions.md`, 2026-09-08) and is the only thing that knows
 * about `gameConfig.customTeam100`, `detectedTeamPosition` or `CHAMPIONS_KILLED`. What the
 * mapper must produce is written field by field in the comments below and asserted, against
 * the committed fixtures, in `companion.contract.test.ts`. The `*Input` interfaces at the
 * bottom of each section are that mapper's return types.
 *
 * The API never trusts the identity claims in here beyond what the bearer token says the
 * companion is (architecture "Security"). These schemas only say the shape is well formed.
 */

/** Optional free text from the client: absent, null and "" all mean "not known". */
const optionalText = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value ? value : null));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// POST /api/companion/lobby
// ---------------------------------------------------------------------------

/**
 * One member of the lobby, as the mapper produces them from `GET /lol-lobby/v2/lobby`:
 *
 * - `puuid` — `members[].puuid`. Bots are dropped first (`isBot: true`, `puuid: ""`).
 * - `summonerId` — `members[].summonerId`, a JSON **number** on the wire from the client;
 *   this schema takes the number and stores a decimal string. Kept because M4's invites are
 *   the only thing that needs it.
 * - `gameName` / `tagLine` — **not in the lobby response at all** (`summonerName` is `""` on
 *   16.17). The mapper sends what it already has — its own `current-summoner`, or a
 *   `GET /lol-summoner/v2/summoners/puuid/{puuid}` it has already done — and `null` otherwise.
 *   **Posting a lobby never waits on a name lookup** (M2.10, point 2); the names arrive with
 *   the next end-of-game block or the M2.4 sweep.
 * - `side` — membership of `gameConfig.customTeam100` (100) or `customTeam200` (200), by
 *   puuid. **Never `members[].teamId`**, which is always `0` in a custom lobby (16.17,
 *   question 3). A puuid in neither array is `null`, which is a valid state: the client has
 *   not placed them yet.
 * - `isSpectator` — `members[].isSpectator`, which is also true for everyone in
 *   `gameConfig.customSpectators` (16.17, three captures): a spectator is `side: null` plus
 *   `isSpectator: true`.
 */
export const companionLobbyMemberSchema = z.object({
  puuid: puuidSchema,
  summonerId: summonerIdSchema,
  gameName: optionalText,
  tagLine: optionalText,
  /** `null` while the client has not placed them on a team yet, and for every spectator. */
  side: sideSchema.nullish().transform((value) => value ?? null),
  isSpectator: z.boolean().default(false),
});

/**
 * True for a posted lobby entry that is not a person: a bot slot (`isBot: true`, or the
 * client's `botId`/`botUuid` shape) or an entry whose puuid is the empty string or the
 * all-zero placeholder.
 *
 * A member with **no** `puuid` key at all is not dropped: that is a malformed payload, not a
 * bot, and it should fail validation loudly.
 */
export function isNonPlayerLobbyMember(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.isBot === true || value.botPlayer === true) return true;
  const { puuid } = value;
  return typeof puuid === 'string' && isPlaceholderPuuid(puuid);
}

/**
 * Drops the non-player entries *before* the member schema sees them and records how many went
 * (M2.10, point 4): a bot that leaks through an old companion must never cost the group the
 * other nine members, so this is a filter and not a 400.
 *
 * Order matters and it is this: filter here, then the route's M1.8 "caller is in `members`"
 * check, then `replaceMembers`. Filtering can leave fewer than ten members, which just means
 * the lobby is not ready to balance.
 */
function dropNonPlayerMembers(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.members)) return value;
  const kept = value.members.filter((member) => !isNonPlayerLobbyMember(member));
  return { ...value, members: kept, droppedMembers: value.members.length - kept.length };
}

/**
 * The full member list, posted every time it changes. The server debounces and decides when
 * the lobby is stable enough to balance; the companion just reports.
 *
 * `partyId` is `lobby.partyId`, which is stable across invites, joins and someone moving to
 * the spectator slot (16.17, three captures), so it is a sound dedupe key for `lcu_party_id`.
 *
 * The answer (`companionLobbyResponseSchema`) carries `ranksNeeded` — whose rank to fetch next
 * (M2.4) — and `recheckInMs`, the knock that measures the ten-second stability window on the
 * posts themselves (M2.2/M2.5). A companion that ignores either one still works today and
 * stops working the night M2.5 lands, so read both.
 */
export const companionLobbyPayloadSchema = z.preprocess(
  dropNonPlayerMembers,
  z.object({
    partyId: z.string().trim().min(1),
    lobbyName: optionalText,
    lobbyPassword: optionalText,
    members: z.array(companionLobbyMemberSchema).max(20),
    /**
     * Server-side bookkeeping, not a field the companion sends: how many bot or placeholder
     * entries the filter above removed. Whatever a caller puts here is overwritten. The route
     * logs it when it is non-zero.
     */
    droppedMembers: z.number().int().nonnegative().default(0),
  }),
);

/** What the mapper returns for one lobby member. `summonerId` may stay a client number. */
export interface CompanionLobbyMemberInput {
  puuid: string;
  summonerId?: number | string | null;
  gameName?: string | null;
  tagLine?: string | null;
  side?: SideValue | null;
  isSpectator?: boolean;
}

/** What the mapper returns for a lobby, and exactly what goes on the wire. */
export interface CompanionLobbyPayloadInput {
  partyId: string;
  lobbyName?: string | null;
  lobbyPassword?: string | null;
  members: readonly CompanionLobbyMemberInput[];
}

// ---------------------------------------------------------------------------
// POST /api/companion/game
// ---------------------------------------------------------------------------

/**
 * `detectedTeamPosition` (end-of-game block) to our role vocabulary. Anything else — `""`,
 * missing, `NONE`, a value we have not seen — is `null`, and `role` is nullable everywhere
 * for exactly that reason. A role is **never** inferred from the champion (M2.10, point 7).
 *
 * Exported so the mapper in `packages/lcu` uses this table rather than a second copy of it.
 */
export const DETECTED_TEAM_POSITION_ROLES: Readonly<Record<string, RoleValue>> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'mid',
  BOTTOM: 'adc',
  UTILITY: 'support',
};

/** The role for a `detectedTeamPosition`, or null for anything we do not recognise. */
export function roleFromDetectedTeamPosition(position: string | null | undefined): RoleValue | null {
  if (typeof position !== 'string') return null;
  return DETECTED_TEAM_POSITION_ROLES[position.trim().toUpperCase()] ?? null;
}

/**
 * One participant's line of the end-of-game block, already flattened by the mapper. Bot
 * players (`botPlayer: true`, the all-zero puuid) are dropped before this schema sees them;
 * if one leaks through, `puuidSchema` refuses it (M2.10, point 10).
 *
 * Every stat comes from the **uppercase** keys of `players[].stats`; the camelCase duplicates
 * beside them are not read. A missing key is 0 — one absent stat never costs us a game.
 *
 * | field | source |
 * |---|---|
 * | `puuid` | `players[].puuid` |
 * | `side` | `teams[].teamId` (100 / 200), not anything on the player |
 * | `role` | `detectedTeamPosition` through the table above |
 * | `championId` | `players[].championId` |
 * | `kills` | `stats.CHAMPIONS_KILLED` (**not** `KILLS`) |
 * | `deaths` | `stats.NUM_DEATHS` (**not** `DEATHS`) |
 * | `assists` | `stats.ASSISTS` |
 * | `gold` | `stats.GOLD_EARNED` |
 * | `damageToChamps` | `stats.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS` |
 * | `cs` | `stats.MINIONS_KILLED` **+** `stats.NEUTRAL_MINIONS_KILLED` |
 * | `win` | `stats.WIN === 1` (a number, never `"Win"`/`"Fail"`) |
 * | `visionScore` | `stats.VISION_SCORE` (M7.7) |
 * | `damageSelfMitigated` | `stats.TOTAL_DAMAGE_SELF_MITIGATED` (M7.7) |
 * | `gameName` / `tagLine` | `riotIdGameName` / `riotIdTagLine` |
 * | `summonerId` | `players[].summonerId` |
 *
 * The Riot ID fields are optional and are how a player first seen in a lobby (where the client
 * reports no name at all) gets a name without waiting for the M2.4 sweep.
 *
 * `visionScore` and `damageSelfMitigated` are the two M7.7 added, and they are the only two
 * stats here that default to **null** rather than 0 — null means "this block never said",
 * which is not the same fact as a game with no wards or a tank who mitigated nothing, and
 * M7.8 skips a game rather than scoring somebody at zero for a number nobody stored. **No
 * companion in the field fills them today and none has to**: ingest reads both off the posted
 * `raw` block, which every exe the group has ever run already carries
 * (`04-decisions.md`, 2026-09-15). They are named here so the boundary is honest about what
 * the server will accept, and a future mapper that fills them is believed when `raw` is silent.
 */
export const companionGameParticipantSchema = z.object({
  puuid: puuidSchema,
  side: sideSchema,
  role: roleSchema.nullish().transform((value) => value ?? null),
  championId: z.number().int().nonnegative().nullish().default(null),
  kills: z.number().int().nonnegative().default(0),
  deaths: z.number().int().nonnegative().default(0),
  assists: z.number().int().nonnegative().default(0),
  gold: z.number().int().nonnegative().default(0),
  damageToChamps: z.number().int().nonnegative().default(0),
  cs: z.number().int().nonnegative().default(0),
  /** M7.7. Null, not 0, when the block did not say — see the table above. */
  visionScore: z.number().int().nonnegative().nullish().default(null),
  /** M7.7. Null, not 0, when the block did not say — see the table above. */
  damageSelfMitigated: z.number().int().nonnegative().nullish().default(null),
  /**
   * `stats.WIN === 1`. Informational and redundant: `winningSide` is the authority for rating
   * and for `games.winning_side`, and when this is absent it is filled in from `side`.
   */
  win: z.boolean().nullish().default(null),
  gameName: optionalText,
  tagLine: optionalText,
  summonerId: summonerIdSchema,
});

/** The message the API answers with for a block that nobody won. */
export const NO_WINNING_TEAM_MESSAGE = 'no winning team; remake or terminated';

const eogPayloadSchema = z
  .object({
    phase: z.literal('eog'),
    /** `block.gameId`. Never `gameflow-session.gameData.gameId` read in phase `Lobby`. */
    gameId: lcuGameIdSchema,
    /** `lobby.partyId` the companion held for this game; null when it never saw the lobby. */
    partyId: z.string().trim().min(1).nullish(),
    /**
     * Where the game came from. `'eog'` (the default) is the end-of-game block captured live;
     * `'backfill'` is a match-history detail the companion walked later (M5.1), mapped into
     * this same body with `partyId` absent and `role: null` on every participant. The route
     * reads it: a backfill post is stored and not rated inline, and its participant check has
     * no lobby fallback (`04-decisions.md`, 2026-09-09).
     */
    source: gameSourceSchema.default('eog'),
    /** The block's own `gameType`. The API drops anything that is not `CUSTOM_GAME` (M2.5). */
    gameType: z.string().nullish(),
    /**
     * **The block has no start time** (M2.10, point 5), so the mapper derives it, in this
     * order:
     *
     * 1. the moment it observed gameflow `InProgress` for this `gameId` (the same moment it
     *    posted in the `in_progress` payload);
     * 2. otherwise `new Date(endOfGameTimestamp - gameLength * 1000)` —
     *    `endOfGameTimestamp` is epoch **milliseconds** and `gameLength` is **seconds**,
     *    both verified on 16.17. This fallback is not optional: a companion that started or
     *    reconnected mid-game has no `InProgress` moment.
     *
     * On the wire it is always an ISO 8601 string with an offset. Rating (M5.2) folds games
     * in `started_at` order, so a wrong one reorders history.
     */
    startedAt: z.iso.datetime({ offset: true }),
    /** `gameLength`, seconds (verified 16.17). */
    durationS: z.number().int().nonnegative(),
    /**
     * `teams[].teamId` of the team with `isWinningTeam: true`.
     *
     * **`null` when no team won.** A `TerminatedInError` block has no winning team; the
     * companion recognises that and does not post it at all. One that reaches the API anyway
     * is refused 422 with `NO_WINNING_TEAM_MESSAGE`, nothing is written and nothing is rated
     * (M2.10, point 6). The key is required so that "no winner" is a statement, never a
     * forgotten field.
     */
    winningSide: sideSchema.nullable(),
    participants: z.array(companionGameParticipantSchema).min(1).max(10),
    /**
     * The whole end-of-game block, stored in `games.raw`; every derived column can be
     * recomputed from it. The server runs `scrubRawEogBlock` over it before insert — `games`
     * is public-read under RLS and the block carries live chat credentials — and the
     * companion is welcome to scrub it too (M2.10, point 11).
     */
    raw: jsonObjectSchema,
  })
  .transform((payload) => ({
    ...payload,
    // `win` is redundant with `winningSide`; fill it in rather than carrying a null nobody
    // can act on. When the block disagrees with itself, `winningSide` is what counts.
    participants: payload.participants.map((participant) => ({
      ...participant,
      win:
        participant.win ?? (payload.winningSide === null ? null : participant.side === payload.winningSide),
    })),
  }));

/**
 * The companion posts twice per game: once when the client enters `InProgress` so the lobby
 * can move to `in_game`, and once with the end-of-game block. A discriminated union keeps the
 * two apart instead of a pile of optional fields.
 *
 * `z.discriminatedUnion` cannot hold a transformed member, so this is a plain union switched
 * on the same literal; a body with an unknown `phase` still fails both members.
 */
export const companionGamePayloadSchema = z.union([
  z.object({
    phase: z.literal('in_progress'),
    /**
     * `gameflow-session.gameData.gameId`, read from `GameStart` onward only. In phase
     * `Lobby` after a game the session still holds the **previous** game's id and roster
     * (16.17, verified), so a mapper that reads it there posts a stale game.
     */
    gameId: lcuGameIdSchema,
    partyId: z.string().trim().min(1).nullish(),
    /** When the client entered `InProgress`. The companion keeps it for `startedAt` below. */
    startedAt: z.iso.datetime({ offset: true }).nullish(),
  }),
  eogPayloadSchema,
]);

// ---------------------------------------------------------------------------
// POST /api/companion/rank
// ---------------------------------------------------------------------------

/** Tier strings the client uses for "no rank at all". Both normalise to null. */
const UNRANKED_TIERS = new Set(['', 'NONE', 'UNRANKED']);

/** Division strings that are not divisions. `"NA"` is what an unranked queue reports. */
const NON_DIVISIONS = new Set(['', 'NA', 'NONE']);

/**
 * A rank reading for one PUUID, from `queueMap[queue]` of `current-ranked-stats` (own rank)
 * or `ranked-stats/{puuid}` (anyone else). The body carries no puuid, so the mapper supplies
 * the one it asked about.
 *
 * Tier and division are otherwise kept as the client's own strings; `packages/core` maps them
 * to a seed and treats anything it does not recognise as unranked, so a new tier name never
 * breaks ingest.
 *
 * - Unranked is `tier: ""` with `division: "NA"` on 16.17 — both become `null`, and a null
 *   tier forces a null division and a null `lp` (M2.10, point 12).
 * - **`losses` is not in this payload and must not be added.** It reads `0` for everyone but
 *   yourself, so it is not truth. Wins and losses come from our own `games` rows.
 * - `gameName` / `tagLine` are optional and ride along from
 *   `GET /lol-summoner/v2/summoners/puuid/{puuid}` (M2.4): the rank sweep visits exactly the
 *   PUUIDs whose name we are missing, because lobby members carry no Riot ID at all, so one
 *   POST carries both. Absent means "I did not look it up", never "they have no name": the
 *   server only ever writes a name it was given, and never overwrites an admin's
 *   `display_name` override (M1.7).
 */
export const companionRankPayloadSchema = z
  .object({
    puuid: puuidSchema,
    tier: optionalText,
    division: optionalText,
    lp: z.number().int().nonnegative().nullish().default(null),
    queue: z.string().min(1).default('RANKED_SOLO_5x5'),
    /** From the summoner lookup the sweep did for this puuid, or null when it did none. */
    gameName: optionalText,
    tagLine: optionalText,
  })
  .transform((payload) => {
    const tier =
      payload.tier !== null && UNRANKED_TIERS.has(payload.tier.toUpperCase()) ? null : payload.tier;
    const division =
      tier === null || (payload.division !== null && NON_DIVISIONS.has(payload.division.toUpperCase()))
        ? null
        : payload.division;
    return { ...payload, tier, division, lp: tier === null ? null : payload.lp };
  });

/** What the mapper returns for one queue's rank reading. */
export interface CompanionRankPayloadInput {
  puuid: string;
  /** `queueMap[queue].tier`, verbatim: `"SILVER"`, or `""` for unranked. */
  tier?: string | null;
  /** `queueMap[queue].division`, verbatim: `"II"`, or `"NA"` for unranked. */
  division?: string | null;
  /** `queueMap[queue].leaguePoints`. */
  lp?: number | null;
  /** The `queueMap` key. Only `RANKED_SOLO_5x5` seeds a rating. */
  queue?: string;
  /** `summoners/puuid/{puuid}.gameName`, when the sweep looked it up (M2.4). */
  gameName?: string | null;
  /** `summoners/puuid/{puuid}.tagLine`, likewise. */
  tagLine?: string | null;
}

export type CompanionLobbyMember = z.infer<typeof companionLobbyMemberSchema>;
export type CompanionLobbyPayload = z.infer<typeof companionLobbyPayloadSchema>;
export type CompanionGameParticipant = z.infer<typeof companionGameParticipantSchema>;
export type CompanionGamePayload = z.infer<typeof companionGamePayloadSchema>;
export type CompanionGameEogPayload = Extract<CompanionGamePayload, { phase: 'eog' }>;
export type CompanionRankPayload = z.infer<typeof companionRankPayloadSchema>;

/** An end-of-game payload that named a winner: what ingest and rating are allowed to see. */
export type CompanionGameEogPayloadWithWinner = CompanionGameEogPayload & { winningSide: SideValue };

/**
 * Did anybody win? A block with no winning team is a remake or a `TerminatedInError` and is
 * refused before anything is written (M2.10, point 6). The lobby is left exactly where it is,
 * and it never becomes `abandoned`: that status keeps the M2.9 replace semantics and an
 * `in_game` roster is frozen. It does leave `in_game` two hours later, as `dropped` (M5.11) —
 * frozen roster kept, out of the live set so the party's next game gets its own cycle. M5.5
 * is the surface that lists a lobby whose game never landed. (This corrects the second half
 * of point 6 of the M2.10 brief; the refusal itself is unchanged.)
 */
export function hasWinningTeam(
  payload: CompanionGameEogPayload,
): payload is CompanionGameEogPayloadWithWinner {
  return payload.winningSide !== null;
}

/** What the mapper returns for one end-of-game participant. */
export interface CompanionGameParticipantInput {
  puuid: string;
  side: SideValue;
  role?: RoleValue | null;
  championId?: number | null;
  kills?: number;
  deaths?: number;
  assists?: number;
  gold?: number;
  damageToChamps?: number;
  cs?: number;
  win?: boolean | null;
  gameName?: string | null;
  tagLine?: string | null;
  summonerId?: number | string | null;
}

/** What the mapper returns for an end-of-game block. */
export interface CompanionGameEogPayloadInput {
  phase: 'eog';
  gameId: number | string;
  partyId?: string | null;
  source?: 'eog' | 'backfill';
  gameType?: string | null;
  /** ISO 8601 with an offset. See `startedAt` above for how it is derived. */
  startedAt: string;
  durationS: number;
  /** `null` only when no team has `isWinningTeam: true`, which the companion does not post. */
  winningSide: SideValue | null;
  participants: readonly CompanionGameParticipantInput[];
  raw: Record<string, unknown>;
}

/** What the mapper returns when the client enters a game. */
export interface CompanionGameInProgressPayloadInput {
  phase: 'in_progress';
  gameId: number | string;
  partyId?: string | null;
  startedAt?: string | null;
}

export type CompanionGamePayloadInput = CompanionGameInProgressPayloadInput | CompanionGameEogPayloadInput;
