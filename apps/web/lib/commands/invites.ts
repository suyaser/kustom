import { COMPANION_COMMAND_TTL_MS, inviteCommandPayloadSchema } from '@customs/db/schemas';
import { DEFAULT_NIGHT_TIME_ZONE, nightStart } from '../night';
import { getServiceClient, type ServiceClient } from '../supabase';
import { type CommandGate, isCommandKindEnabled } from './gate';
import type { CommandAckedEvent, CommandHook } from './hooks';
import { type CommandToQueue, enqueueCommands } from './queue';

/**
 * Who is "around", and the `invite` rows that follow a lobby being opened (M4.2's fan-out).
 *
 * The scene this serves: somebody taps **Start a lobby**, a host's client opens one, and the
 * invite popup appears for everybody who is around — nobody typed a name, nobody read a
 * password out loud, nobody was asked to accept anything on a web page first.
 *
 * **Voice presence is the real answer and it is M4.5.** Until then "around" is the brief's two
 * clauses, and clause (b) is not decoration: `00-product.md` says one or two friends run the
 * companion, so a companion-only definition would invite two people and call it a night. An
 * invite that reaches somebody who is not around costs them one popup that expires on its own;
 * a missing invite costs a person their game.
 *
 * - **a.** a companion token seen in the last {@link INVITE_COMPANION_WINDOW_MS} (an hour) —
 *   `last_seen_at` means "at their PC with League open" from M4.1 on;
 * - **b.** anybody who appeared in a custom on one of the last {@link INVITE_NIGHTS} nights,
 *   counted by the 06:00 boundary in `CUSTOMS_NIGHT_TZ`, either as a `game_players` row or as a
 *   member of a lobby that reached `in_game`;
 *
 * minus the host, minus anyone already in tonight's live lobby, most recently active first,
 * capped at {@link MAX_INVITES}.
 *
 * **Every read here is bounded by `now` at both ends** (`04-decisions.md`, 2026-09-10): the
 * window is `[the night's 06:00, now]` and never "everything up to the end of time". In
 * production the upper bound is a no-op — nothing is created in the future — and it is what
 * makes an injected clock name exactly one night, which the tests rely on.
 *
 * All of it is gated, and **the `invite` row went green on 16.18 (2026-09-12)**, so this module
 * reads and writes for real from here on. The gate stays in the code because it is the thing that
 * turns it all off again in one edit: a `gate` override in a test, or the reference row going back
 * to `unverified` after a patch breaks the path, and this module reads nothing and writes nothing.
 */

/** Clause (a): a companion token seen this recently means their client was up. */
export const INVITE_COMPANION_WINDOW_MS = 60 * 60_000;

/** Clause (b): tonight and the six nights before it, by the 06:00 boundary. */
export const INVITE_NIGHTS = 7;

/**
 * At most nineteen invites. Ten play; the rest are the spectator slot and the next cycle. A
 * bigger number is a client popping up twenty invitations, which is a different product.
 */
export const MAX_INVITES = 19;

/** Statuses that prove a lobby actually reached the rift, for clause (b). */
const PLAYED_LOBBY_STATUSES = ['in_game', 'dropped', 'finished'] as const;

/** Statuses of a lobby that is live right now: its members are already in and never invited. */
const LIVE_LOBBY_STATUSES = ['open', 'balanced', 'in_game'] as const;

/** The half-open window a night's reads are scoped to: 06:00 local, up to `now`. */
export interface NightWindow {
  /** 06:00 in `CUSTOMS_NIGHT_TZ` of the night containing `now`. */
  start: string;
  /** `now`. Nothing is created in the future, so this only ever excludes another clock's rows. */
  until: string;
}

export function nightWindow(now: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): NightWindow {
  return { start: nightStart(now, timeZone).toISOString(), until: now.toISOString() };
}

/** The start of the night `nights - 1` nights before the one containing `now`. */
export function nightsAgo(now: Date, nights: number, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): Date {
  const back = new Date(now.getTime() - (nights - 1) * 24 * 60 * 60 * 1000);
  return nightStart(back, timeZone);
}

// ---------------------------------------------------------------------------
// The around set, as a pure function
// ---------------------------------------------------------------------------

/** One piece of evidence that somebody is around, and when it was. */
export interface AroundPlayer {
  playerId: string;
  lastActiveAt: Date;
}

export interface ChooseInviteesInput {
  /** Every clause's rows, in any order. The same player may appear more than once. */
  candidates: readonly AroundPlayer[];
  /** Never invited to their own lobby. */
  hostPlayerId: string;
  /** Already in the live lobby: their client is in it, an invite would be noise. */
  excludePlayerIds?: readonly string[];
  limit?: number;
}

export interface ChooseInviteesResult {
  /** Player ids to invite, most recently active first. */
  playerIds: string[];
  /** How many the cap dropped, for the log line. */
  trimmed: number;
}

/**
 * The around set, ordered and capped: dedupe on the player (their most recent evidence wins),
 * drop the host and anyone already in the lobby, most recently active first, at most `limit`.
 *
 * Ties break on the player id so two runs of the same night queue the same rows in the same
 * order — the queue is a table somebody reads at 21:40, not a set.
 */
export function chooseInvitees(input: ChooseInviteesInput): ChooseInviteesResult {
  const limit = input.limit ?? MAX_INVITES;
  const excluded = new Set(input.excludePlayerIds ?? []);
  excluded.add(input.hostPlayerId);

  const best = new Map<string, number>();
  for (const candidate of input.candidates) {
    if (excluded.has(candidate.playerId)) continue;
    const at = candidate.lastActiveAt.getTime();
    if (Number.isNaN(at)) continue;
    const seen = best.get(candidate.playerId);
    if (seen === undefined || at > seen) best.set(candidate.playerId, at);
  }

  const ordered = [...best.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([playerId]) => playerId);

  return { playerIds: ordered.slice(0, limit), trimmed: Math.max(0, ordered.length - limit) };
}

// ---------------------------------------------------------------------------
// The reads
// ---------------------------------------------------------------------------

export interface AroundOptions {
  now?: Date;
  timeZone?: string;
  nights?: number;
  companionWindowMs?: number;
}

/**
 * Both clauses, three selects, no join across them: a player id and the most recent instant we
 * have evidence for. Rows the caller has no use for (the host, the lobby's own members) are
 * dropped by {@link chooseInvitees} rather than by three more filters here.
 *
 * **One group's people** (M13.3): this group's tokens, this group's games, this group's lobbies.
 * The friend who plays in another group this week is not around for this one.
 */
export async function readAroundCandidates(
  client: ServiceClient,
  groupId: string,
  options: AroundOptions = {},
): Promise<AroundPlayer[]> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE;
  const nowIso = now.toISOString();
  const seenSince = new Date(now.getTime() - (options.companionWindowMs ?? INVITE_COMPANION_WINDOW_MS));
  const playedSince = nightsAgo(now, options.nights ?? INVITE_NIGHTS, timeZone).toISOString();

  const [tokens, played, lobbied] = await Promise.all([
    client
      .from('companion_tokens')
      .select('player_id, last_seen_at')
      .eq('group_id', groupId)
      .is('revoked_at', null)
      .gte('last_seen_at', seenSince.toISOString())
      .lte('last_seen_at', nowIso),
    client
      .from('game_players')
      .select('player_id, games!inner(started_at)')
      // `game_players.group_id` is always its game's (`game_players_game_group_fkey`).
      .eq('group_id', groupId)
      .gte('games.started_at', playedSince)
      .lte('games.started_at', nowIso),
    client
      .from('lobby_members')
      .select('player_id, lobbies!inner(status, created_at, group_id)')
      .eq('lobbies.group_id', groupId)
      .in('lobbies.status', [...PLAYED_LOBBY_STATUSES])
      .gte('lobbies.created_at', playedSince)
      .lte('lobbies.created_at', nowIso),
  ]);

  if (tokens.error) throw new Error(`readAroundCandidates: tokens: ${tokens.error.message}`);
  if (played.error) throw new Error(`readAroundCandidates: games: ${played.error.message}`);
  if (lobbied.error) throw new Error(`readAroundCandidates: lobbies: ${lobbied.error.message}`);

  const candidates: AroundPlayer[] = [];
  for (const row of tokens.data ?? []) {
    if (row.last_seen_at === null) continue;
    candidates.push({ playerId: row.player_id, lastActiveAt: new Date(row.last_seen_at) });
  }
  for (const row of played.data ?? []) {
    candidates.push({ playerId: row.player_id, lastActiveAt: new Date(row.games.started_at) });
  }
  for (const row of lobbied.data ?? []) {
    candidates.push({ playerId: row.player_id, lastActiveAt: new Date(row.lobbies.created_at) });
  }
  return candidates;
}

/** Everybody in one of this group's lobbies that is live right now: already in, never invited. */
export async function readLiveLobbyMemberIds(
  client: ServiceClient,
  groupId: string,
  options: { now?: Date | undefined; timeZone?: string | undefined } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const window = nightWindow(now, options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE);

  const { data, error } = await client
    .from('lobby_members')
    .select('player_id, lobbies!inner(status, created_at, group_id)')
    .eq('lobbies.group_id', groupId)
    .in('lobbies.status', [...LIVE_LOBBY_STATUSES])
    .gte('lobbies.created_at', window.start)
    .lte('lobbies.created_at', window.until);
  if (error) throw new Error(`readLiveLobbyMemberIds: ${error.message}`);
  return [...new Set((data ?? []).map((row) => row.player_id))];
}

// ---------------------------------------------------------------------------
// The fan-out
// ---------------------------------------------------------------------------

export interface FanOutOptions extends AroundOptions {
  gate?: CommandGate;
  limit?: number;
  /** Tests only: the client the hook writes with. Production reads the service-role one. */
  getClient?: () => ServiceClient;
}

export interface FanOutResult {
  /** Player ids that got an `invite` row, in the order they were queued. */
  invited: string[];
  /** Around, but already carrying a live `invite` for this host: a second ack writes nothing. */
  alreadyQueued: number;
  /** Dropped by the cap. */
  trimmed: number;
  /** True when `invite` is gated off: nothing was read and nothing was written. */
  gated: boolean;
}

/**
 * The invites for a lobby that has just been opened, all of them targeted at the **host's**
 * companion: the client invites into whatever lobby it is in, so the invitee needs no companion
 * at all. That is the whole reason a friend with no exe still gets a popup.
 *
 * Idempotent by construction, twice over. The ack that calls this is a compare-and-set, so one
 * `create_lobby` fans out once; and a player who already holds a live `invite` for this host is
 * skipped, so a second `create_lobby` for the same night adds no second popup.
 *
 * The payload carries the invitee's puuid **and** their `summoner_id` when we have one, because
 * the verification pass has not yet said which body the client takes (`03-lcu-reference.md`,
 * question 6) and the executor picks whichever it needs. A `summoner_id` that is not digits is
 * sent as null rather than as a string the payload schema would refuse.
 */
export async function fanOutInvites(
  client: ServiceClient,
  /**
   * `groupId` is the `create_lobby`'s group, which is its host token's (M13.3): the invite list
   * is people around in that group's games this week, and the rows are written in that group.
   */
  input: { hostPlayerId: string; groupId: string },
  options: FanOutOptions = {},
): Promise<FanOutResult> {
  const empty: FanOutResult = { invited: [], alreadyQueued: 0, trimmed: 0, gated: false };
  if (!isCommandKindEnabled('invite', options.gate)) return { ...empty, gated: true };

  const now = options.now ?? new Date();
  const [candidates, inLobby] = await Promise.all([
    readAroundCandidates(client, input.groupId, options),
    readLiveLobbyMemberIds(client, input.groupId, { now, timeZone: options.timeZone }),
  ]);

  const chosen = chooseInvitees({
    candidates,
    hostPlayerId: input.hostPlayerId,
    excludePlayerIds: inLobby,
    limit: options.limit ?? MAX_INVITES,
  });
  if (chosen.trimmed > 0) {
    console.info(
      `invite fan-out: ${chosen.playerIds.length + chosen.trimmed} around, invited the ${chosen.playerIds.length} most recently active`,
    );
  }
  if (chosen.playerIds.length === 0) return { ...empty, trimmed: chosen.trimmed };

  const { data: players, error } = await client
    .from('players')
    .select('id, puuid, summoner_id')
    .in('id', chosen.playerIds);
  if (error) throw new Error(`fanOutInvites: players: ${error.message}`);

  const byId = new Map((players ?? []).map((row) => [row.id, row]));
  const already = await readQueuedInvitePuuids(client, input.hostPlayerId, input.groupId, now);

  const commands: CommandToQueue[] = [];
  const invited: string[] = [];
  let alreadyQueued = 0;
  // `chosen.playerIds` order, not the select's: most recently active first.
  for (const playerId of chosen.playerIds) {
    const player = byId.get(playerId);
    if (player === undefined) continue;
    if (already.has(player.puuid)) {
      alreadyQueued += 1;
      continue;
    }
    // Parsed here rather than left to `enqueueCommands` so a placeholder puuid — a bot row that
    // got in before M2.10's filter existed — is dropped with a line instead of a silent skip.
    const payload = inviteCommandPayloadSchema.safeParse({
      puuid: player.puuid,
      summonerId: digitsOrNull(player.summoner_id),
    });
    if (!payload.success) {
      console.warn(`invite fan-out: ${playerId} has no invitable puuid; not queued`);
      continue;
    }
    commands.push({
      targetPlayerId: input.hostPlayerId,
      groupId: input.groupId,
      kind: 'invite',
      payload: payload.data,
    });
    invited.push(playerId);
  }

  const { queued } = await enqueueCommands(client, commands, { now, gate: options.gate });
  if (queued.length > 0) {
    console.info(`invite fan-out: queued ${queued.length} invite(s) on the host's companion`);
  }
  return { invited, alreadyQueued, trimmed: chosen.trimmed, gated: false };
}

/** The puuids this host is already holding a live `invite` for, in this group. */
async function readQueuedInvitePuuids(
  client: ServiceClient,
  hostPlayerId: string,
  groupId: string,
  now: Date,
): Promise<Set<string>> {
  const { data, error } = await client
    .from('companion_commands')
    .select('payload')
    .eq('target_player_id', hostPlayerId)
    .eq('group_id', groupId)
    .eq('kind', 'invite')
    .in('status', ['pending', 'sent'])
    // Live now, and no further ahead than one TTL: the same both-ends bound every other read
    // here uses, so an injected clock sees its own rows and nobody else's.
    .gt('expires_at', now.toISOString())
    .lte('expires_at', new Date(now.getTime() + COMPANION_COMMAND_TTL_MS.invite).toISOString());
  if (error) throw new Error(`fanOutInvites: live invites: ${error.message}`);

  const puuids = new Set<string>();
  for (const row of data ?? []) {
    const payload = row.payload;
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      const puuid = (payload as Record<string, unknown>).puuid;
      if (typeof puuid === 'string') puuids.add(puuid);
    }
  }
  return puuids;
}

/** `players.summoner_id` is free text; the payload schema takes digits or null. */
function digitsOrNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * M4.1's `onAcked` seam, filled (M4.2). A `create_lobby` that came back `done` **is** the proof
 * that a lobby exists, and it is the only moment the invites are worth sending:
 *
 * - a `create_lobby` that was nacked, or that expired, queues **zero** invites. No lobby, no
 *   invites, no half state;
 * - an ack of any other kind is ignored here;
 * - a hook that throws is logged by `emitCommandAcked` and the companion's ack still answers
 *   200 — the work is already done and a listener must never cost it its ack.
 *
 * A factory rather than an object so the clock, the gate and the client can be injected: the
 * integration test drives a real ack through the real route into this, at a fixed instant.
 */
export function inviteFanOutHook(options: FanOutOptions = {}): CommandHook {
  return {
    onAcked: async (event: CommandAckedEvent): Promise<void> => {
      if (event.kind !== 'create_lobby' || event.status !== 'acked') return;

      const partyId = typeof event.result?.partyId === 'string' ? event.result.partyId : null;
      if (partyId === null) {
        console.warn(`invite fan-out: create_lobby ${event.commandId} acked with no partyId; not inviting`);
        return;
      }

      // The gate before the client: with `invite` not green there is nothing to read, nothing
      // to write and no reason to need Supabase keys at all.
      if (!isCommandKindEnabled('invite', options.gate)) {
        console.info(`lobby ${partyId}: opened, but invites are not verified on this patch yet`);
        return;
      }

      // `getServiceClient` reads the environment when it is called, never at import, so this
      // module can be imported by a build that has no Supabase keys (same as `register.ts`).
      const client = options.getClient ? options.getClient() : getServiceClient();
      const result = await fanOutInvites(
        client,
        { hostPlayerId: event.targetPlayerId, groupId: event.groupId },
        options,
      );
      console.info(`lobby ${partyId}: invite fan-out queued ${result.invited.length} invite(s)`);
    },
  };
}
