import { isSettling, lockRated } from '@customs/core';
import { isFearlessMode, kickoffIsAram } from '@customs/db/schemas';
import { boardSlotLine, WINDOW_LABELS } from '../board/copy';
import { loadBoard } from '../board/load';
import type { BoardRow, BoardView, RatingTrack } from '../board/types';
import { LEADERBOARD_WINDOW } from '../board/window';
import { loadFearless } from '../fearless/load';
import { loadGroupPool, selectRatings } from '../ingest/balance';
import { KUSTOM_FRESH } from '../ingest/fold';
import type { GameFinishedEvent, LobbyBalancedEvent, LobbyHook, LobbyStartedEvent } from '../ingest/hooks';
import { compareForSitOut, type PoolMember, planSeats } from '../ingest/selection';
import { liveTables } from '../liveTables';
import { lobbyLabels } from '../lobbyLabel';
import { loadGroupMode } from '../mode/load';
import { readLobbyLock } from '../mode/lock';
import { modeTableOfLobby, readTableModeRow } from '../mode/table';
import { type ClosedWindow, civilDayKey, DEFAULT_NIGHT_TIME_ZONE } from '../night';
import { loadWeekNotes, weekFromParam } from '../og/weekNotesLoad';
import { RECEIPT_ANCHOR } from '../receipt/copy';
import {
  gamePageUrl,
  groupPageUrl,
  leaderboardPageUrl,
  modePageUrl,
  resultBadgeUrl,
  weekNotesImageUrl,
} from '../siteUrl';
import type { AwardRender } from '../stats/awards';
import { loadStats } from '../stats/load';
import type { StatsView } from '../stats/types';
import { getServiceClient, type ServiceClient } from '../supabase';
import { rememberResultPost, resultPostWantsId } from './aiEdit';
import {
  buildGameOnInput,
  buildResultInput,
  buildTeamsInput,
  type GameOnKickoff,
  type GameOnSource,
  loadLobbyReceipt,
  loadNames,
  loadPostGroup,
  loadResultSource,
  type PostGroup,
  postIdentity,
  type ResultSource,
  readAssignments,
  type TeamsSource,
  teamsPuuids,
} from './assemble';
import {
  fearlessEmbed,
  fearlessResetEmbed,
  formatDelta,
  gameOnEmbed,
  type LeaderboardEntry,
  leaderboardEmbed,
  type PostLobbyLabel,
  renderName,
  resultEmbed,
  type SettlingEntry,
  TOP_N,
  teamsEmbed,
  type WebhookPayload,
  type WindowAward,
  windowSummaryEmbed,
} from './embeds';
import type { TeamsModeInput } from './modeLines';
import { postToWebhook, type WebhookOptions, type WebhookOutcome } from './webhook';

/**
 * The three posts and the hook that fires them (M3.1, M3.3).
 *
 * Every function here answers with a {@link WebhookOutcome} and none of them throws for a
 * Discord problem: a webhook that is down must cost the group nothing but a log line. The
 * lobby response, the stored splits and the rating fold are all finished before any of this
 * runs — `hooks.ts` is the seam and it awaits us only so a test can.
 */

/** Why a fearless post (the pool, or a reset) is not sent while the group is on Normal (M14.29). */
export const FEARLESS_SKIPPED_NORMAL = 'group mode is normal';

const SKIPPED = (reason: string): WebhookOutcome => ({
  status: 'skipped',
  httpStatus: null,
  reason,
  attempts: 0,
});

export interface PostOptions extends WebhookOptions {
  /** Injected in tests. */
  now?: Date;
  /** IANA name for "tonight" (M2.5), when the pool has to be rebuilt. */
  timeZone?: string;
  /**
   * The origin of the request behind this post, for the embed `url`. `siteOrigin(request)`
   * already prefers `NEXT_PUBLIC_SITE_URL`; `tonightPageUrl` drops a localhost one.
   */
  requestOrigin?: string | null;
  /**
   * M20.9: the teams post again after an admin redrew or changed this game's regions; a region
   * lock's rule line reads `This game: region wars, new regions.` (M20.1).
   */
  newRegions?: boolean;
}

/**
 * A post that is about one group and is not given a lobby or a game to read the group off
 * (M13.4): the fearless pool and its reset, the nightly board, a closed window. The caller names
 * the group; there is no default.
 */
export type GroupPostOptions = PostOptions & { groupId: string };

/**
 * The teams embed for a balance that just happened. Everything comes off the event — ingest
 * worked out the ten, the sitters and the seat moves and this does not re-derive any of it —
 * except the names, which are read fresh.
 */
export async function postTeamsForEvent(
  client: ServiceClient,
  event: LobbyBalancedEvent,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const [names, group, receipt, mode, lobbyLabel] = await Promise.all([
    loadNames(client, teamsPuuids(event)),
    loadPostGroup(client, event.groupId),
    // The receipt is drawn from the rows the balance just stored, not from the event's copy of
    // core's answer: every surface reads the same `splits` columns (STRATEGY §4.2 rule 5).
    loadLobbyReceipt(client, event.lobbyId, event.splitId),
    // The lock Roll wrote before balancing (M15.3), for the rule line (M15.6).
    loadTeamsMode(client, event.lobbyId),
    // M22.7: which lobby, while two or more are live.
    loadPostLobby(client, event.groupId, event.lobbyId, options.now ?? new Date()),
  ]);
  const origin = options.requestOrigin ?? event.requestOrigin;
  const input = buildTeamsInput({ ...event, receipt, mode }, names, teamsContext(origin, group, lobbyLabel));
  // The lobby's group's channel (M13.3).
  return postToWebhook(client, teamsEmbed(input), 'teams embed', { ...options, groupId: event.groupId });
}

/**
 * The teams embed for a split that is already stored — the re-post M3.2's reroll needs, one
 * call away: promote a split, then `postTeamsForSplit(client, splitId)`.
 *
 * The sitters and the seat moves are rebuilt from the lobby's members with the same pure
 * functions M2.5 used (`selection.ts`), so a reroll's embed says the same things about who
 * sits as the first one did. It is a new message and never an edit of the earlier one; the
 * title carries the promoted split's rank, so the channel reads how far down the list the
 * group has gone (M3.2).
 */
export async function postTeamsForSplit(
  client: ServiceClient,
  splitId: string,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const loaded = await loadTeamsSource(client, splitId, options);
  if (loaded === null) return SKIPPED('no such split');
  const { source, groupId, lobbyId } = loaded;

  const [names, group, lobbyLabel] = await Promise.all([
    loadNames(client, teamsPuuids(source)),
    loadPostGroup(client, groupId),
    loadPostLobby(client, groupId, lobbyId, options.now ?? new Date()),
  ]);
  const input = buildTeamsInput(source, names, teamsContext(options.requestOrigin, group, lobbyLabel));
  // The split's lobby's group's channel (M13.3), whoever pressed the reroll.
  return postToWebhook(client, teamsEmbed(input), 'teams embed', { ...options, groupId });
}

/**
 * The teams post's identity and links (M14.61, 05-design 10.4): E1's title links the group's
 * tonight page, E4's the receipt's disclosure on it (STRATEGY §4.9), the rule line the mode
 * panel. No group, no link: never a link to `/` or to another group's page. The builders add
 * `?lobby=` to every one of them when `lobbyLabel` is given (M22.7).
 */
function teamsContext(
  origin: string | null | undefined,
  group: PostGroup | null,
  lobbyLabel?: PostLobbyLabel | undefined,
) {
  const slug = group?.slug ?? null;
  return {
    identity: postIdentity(group, origin),
    url: slug === null ? undefined : groupPageUrl(origin, slug),
    receiptUrl: slug === null ? undefined : groupPageUrl(origin, slug, RECEIPT_ANCHOR),
    modeUrl: fearlessUrl(origin, slug),
    ...(lobbyLabel === undefined ? {} : { lobbyLabel }),
  };
}

/**
 * **Which lobby a post is about** (M22.7, 05-design 14.10): the label and `?lobby=` id for a post
 * about `lobbyId`, or `undefined` when fewer than two tables are live at `now` (the post's own
 * table counted), when `lobbyId` is not a row of a live table, or when the read fails (logged: the
 * post goes out as the one-lobby post rather than not at all). `liveTables` is the one reader of
 * "the live lobbies"; the label is the table's first reporter's name tonight (`lib/lobbyLabel.ts`).
 */
export async function loadPostLobby(
  client: ServiceClient,
  groupId: string,
  lobbyId: string | null,
  now: Date,
): Promise<PostLobbyLabel | undefined> {
  if (lobbyId === null) return undefined;
  try {
    const tables = await liveTables(client, groupId, now);
    if (tables.length < 2) return undefined;
    const own = tables.find((table) => table.rowIds.includes(lobbyId));
    if (own === undefined) return undefined;
    const hosts = await loadPlayerNamesById(
      client,
      tables.flatMap((table) => (table.label.hostPlayerId === null ? [] : [table.label.hostPlayerId])),
    );
    const labels = lobbyLabels(
      tables.map((table) => ({
        key: table.partyId,
        hostName: table.label.hostPlayerId === null ? null : (hosts.get(table.label.hostPlayerId) ?? null),
        openedAt: table.openedAt,
      })),
      renderName,
    );
    const label = labels.get(own.partyId);
    return label === undefined ? undefined : { lobbyId, label, live: tables.length };
  } catch (error) {
    console.error('discord: reading the live lobbies failed; posting without a lobby label', error);
    return undefined;
  }
}

/** How many tables are live at `now` (M22.7: the Fearless reset's `both`/`every`), or 0 on a failed read. */
async function loadLiveLobbyCount(client: ServiceClient, groupId: string, now: Date): Promise<number> {
  try {
    return (await liveTables(client, groupId, now)).length;
  } catch (error) {
    console.error(
      'discord: reading the live lobbies failed; posting the reset without the lobbies line',
      error,
    );
    return 0;
  }
}

/** `players.id` -> the name every post prints (`display_name`, else `game_name`), as `loadNames` reads it. */
async function loadPlayerNamesById(
  client: ServiceClient,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)];
  const names = new Map<string, string | null>();
  if (unique.length === 0) return names;
  const { data, error } = await client.from('players').select('id, display_name, game_name').in('id', unique);
  if (error) throw new Error(`host name lookup failed: ${error.message}`);
  for (const row of data ?? []) names.set(row.id, row.display_name ?? row.game_name ?? null);
  return names;
}

/**
 * The group's mode panel, for both fearless posts (M14.31) and the teams post's rule line
 * (M15.6), under the same no-slug rule. Never the retired `/fearless` page.
 */
function fearlessUrl(origin: string | null | undefined, slug: string | null): string | undefined {
  return slug === null ? undefined : modePageUrl(origin, slug);
}

/**
 * The lobby's mode lock as the teams post's rule line needs it (M15.6), or `null` when the lobby
 * has none (a balance with no Roll) or the read fails: the post goes out without the line rather
 * than not at all. Reroll never touches the lock, so a Reroll post reads the same copy.
 *
 * **No-draw without a column** (M20.7, M20 D6 (d)): region wars that could not be drawn at Roll
 * locked the standing mode and left the rule (with its stale pair) pending on the row, which Roll
 * did not write. So a standing lock with region wars pending on a row last written before the lock
 * is the no-draw case; one written after it is a choice for the next game and says nothing here.
 */
export async function loadTeamsMode(client: ServiceClient, lobbyId: string): Promise<TeamsModeInput | null> {
  try {
    const stored = await readLobbyLock(client, lobbyId);
    if (stored === null) return null;
    const { lock } = stored;
    const noDraw =
      lock.mode.id === lock.standing && (await regionLeftPending(client, lobbyId, stored.lockedAt));
    return {
      mode: lock.mode,
      rated: lockRated(lock),
      standing: lock.standing,
      ...(noDraw ? { noDraw: true } : {}),
    };
  } catch (error) {
    console.error('discord: reading the lobby mode lock failed; posting without the rule line', error);
    return null;
  }
}

/** Whether the lobby's group still has region wars pending from before the lock was taken. */
async function regionLeftPending(
  client: ServiceClient,
  lobbyId: string,
  lockedAt: string | null,
): Promise<boolean> {
  if (lockedAt === null) return false;
  const { data: lobby, error } = await client
    .from('lobbies')
    .select('group_id')
    .eq('id', lobbyId)
    .maybeSingle();
  if (error || lobby === null) return false;
  // M22.4: the lobby's own card (group_modes unless the night is forked).
  const table = await modeTableOfLobby(client, lobby.group_id, lobbyId, new Date());
  const stored = await readTableModeRow(client, lobby.group_id, table);
  return (
    stored.row.pending?.id === 'region' &&
    stored.updatedAt !== null &&
    Date.parse(stored.updatedAt) <= Date.parse(lockedAt)
  );
}

/**
 * Whether a kickoff gets a `Game on` post (M21.6, owner 2026-10-05): `custom` (rolled, then the
 * teams changed) and `unrolled` (nobody rolled) do; `rolled` does not, the teams post is right.
 */
export function announcesKickoff(kickoff: LobbyStartedEvent['kickoff']): kickoff is GameOnKickoff {
  // M21.12: an ARAM gets no post, as its result gets none (the mode is the one the session named at start).
  return kickoff.kind !== 'rolled' && !kickoffIsAram(kickoff);
}

/**
 * The `Game on` post (M21.6): one **new** message to the lobby's group's channel, never an edit
 * (no teams-post message id is stored, and an edit notifies nobody). Once per game because the
 * event is: only the `in_progress` post whose kickoff write landed fires it. `skipped` for a
 * `rolled` kickoff or a group with no channel; never throws for a Discord problem.
 */
export async function postGameOnForLobby(
  client: ServiceClient,
  event: LobbyStartedEvent,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const { kickoff } = event;
  if (!announcesKickoff(kickoff)) {
    return SKIPPED(kickoffIsAram(kickoff) ? 'an ARAM gets no Game on post' : 'kickoff teams are the roll');
  }
  const puuids = [...kickoff.blue, ...kickoff.red];
  const [names, group, mode, split, ratingOf, lobbyLabel] = await Promise.all([
    loadNames(client, puuids),
    loadPostGroup(client, event.groupId),
    loadTeamsMode(client, event.lobbyId),
    kickoff.kind === 'custom' ? loadChosenSplit(client, event.lobbyId) : Promise.resolve(null),
    loadKickoffRatings(client, event.groupId, puuids),
    loadPostLobby(client, event.groupId, event.lobbyId, options.now ?? new Date()),
  ]);
  const origin = options.requestOrigin ?? event.requestOrigin;
  const context = teamsContext(origin, group, lobbyLabel);
  const input = buildGameOnInput({ kickoff, split, ratingOf, mode }, names, context);
  return postToWebhook(client, gameOnEmbed(input), 'game on embed', { ...options, groupId: event.groupId });
}

/** The lobby's chosen split's two sides, or `null` (none, or the read failed: no roles then). */
async function loadChosenSplit(client: ServiceClient, lobbyId: string): Promise<GameOnSource['split']> {
  const { data, error } = await client
    .from('splits')
    .select('blue, red')
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true)
    .maybeSingle();
  if (error) {
    console.error('discord: reading the chosen split failed; posting Game on without roles', error);
    return null;
  }
  return data === null ? null : { blue: readAssignments(data.blue), red: readAssignments(data.red) };
}

/**
 * Each kickoff player's all-time `r` in the group, through the balancer's own read
 * (`selectRatings`, 1200 for no row): the same numbers the kickoff odds were taken over.
 *
 * M21.6 follow-up (M21.7): a failed lookup (the players read, the ratings read, or a thrown
 * request) degrades to 1200 for everyone, logged, instead of dropping the post: the odds on it are
 * the stored kickoff odds, only the printed Ratings fall back, and a `Game on` post is never retried.
 */
export async function loadKickoffRatings(
  client: ServiceClient,
  groupId: string,
  puuids: readonly string[],
): Promise<(puuid: string) => number> {
  const fresh = (why: unknown): ((puuid: string) => number) => {
    console.error('discord: kickoff rating lookup failed; Game on prints 1200 for everyone', why);
    return () => KUSTOM_FRESH.r;
  };
  try {
    const { data, error } = await client
      .from('players')
      .select('id, puuid')
      .in('puuid', [...puuids]);
    if (error) return fresh(error.message);
    const idOf = new Map((data ?? []).map((row) => [row.puuid, row.id]));
    const ratings = await selectRatings(client, [...idOf.values()], groupId);
    return (puuid) => {
      const id = idOf.get(puuid);
      return (id === undefined ? undefined : ratings.get(id))?.r ?? KUSTOM_FRESH.r;
    };
  } catch (error) {
    return fresh(error);
  }
}

/**
 * The result embed for a game the fold just rated, or one played not rated on the Rift (M15.6).
 * `skipped` when the game has neither — a remake, a short surrender, an ARAM, or a block somebody
 * else already rated.
 */
export async function postResultForGame(
  client: ServiceClient,
  gameId: string,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const source = await loadResultSource(client, gameId);
  if (source === null) return SKIPPED('no such game');

  // The game's own group's channel (M13.3), read off the row: a game belongs to one group.
  const owner = await gameOwner(client, gameId);
  if (owner === null) return SKIPPED('no such game');
  const { groupId } = owner;

  const [group, lobbyLabel] = await Promise.all([
    loadPostGroup(client, groupId),
    // M22.7: the game's lobby's label, while two or more are live (a finished table lingers).
    loadPostLobby(client, groupId, owner.lobbyId, options.now ?? new Date()),
  ]);
  const payload = resultPayload(source, gameId, group, options.requestOrigin, lobbyLabel);
  if (payload === null) return SKIPPED('game is not rated');

  // M16.4: a group whose AI recap may edit this post asks for the message id; nobody else does.
  const wait = await resultPostWantsId(client, groupId);
  const outcome = await postToWebhook(client, payload, 'result embed', {
    ...options,
    groupId,
    ...(wait ? { wait } : {}),
  });
  if (wait) rememberResultPost(gameId, { groupId, outcome, payload }, new Date());
  return outcome;
}

/** `games.group_id` and `games.lobby_id`, or null for a game that does not exist. */
async function gameOwner(
  client: ServiceClient,
  gameId: string,
): Promise<{ groupId: string; lobbyId: string | null } | null> {
  const { data, error } = await client
    .from('games')
    .select('group_id, lobby_id')
    .eq('id', gameId)
    .maybeSingle();
  if (error) throw new Error(`discord: game group lookup failed: ${error.message}`);
  return data === null ? null : { groupId: data.group_id, lobbyId: data.lobby_id };
}

/**
 * The result embed for one loaded game, or `null` when it is not rated. Its title links to that
 * game's own page under its group, `/g/<slug>/games/<id>` (M13.11, folded into M14.10), not to
 * the tonight page, which shows the next lobby minutes later; nothing printed depends on the
 * link. With no slug there is no link. `lobbyLabel` (M22.7, two or more live) leads the title with
 * the label and points the author link at the lobby; the title link stays the game's.
 */
export function resultPayload(
  source: ResultSource,
  gameId: string,
  group: PostGroup | null,
  requestOrigin: string | null | undefined,
  lobbyLabel?: PostLobbyLabel | undefined,
): WebhookPayload | null {
  const input = buildResultInput(source, {
    ...(lobbyLabel === undefined ? {} : { lobbyLabel }),
    identity: postIdentity(group, requestOrigin),
    url: group === null ? undefined : gamePageUrl(requestOrigin, group.slug, gameId),
    // The badge is an image: sent only on a public origin (05-design 10.11), else no thumbnail.
    badgeUrl: group === null ? undefined : resultBadgeUrl(requestOrigin, group.slug, gameId),
  });
  return input === null ? null : resultEmbed(input);
}

/**
 * The fearless list after a rated Rift custom (M10). A second message, after the result:
 * the result is about what just happened to ten ratings, this is about what to ban next.
 * `skipped` when the pool is empty — there is nothing to ban yet, and a message that says
 * nothing is worse than silence.
 *
 * `skipped` too while the group is on Normal (M14.29): there is no ban list in force, so there is
 * nothing to post. The result post before it is unchanged either way.
 *
 * `gameId` names the game the post is about (M14.31): the ids it first locked are bolded and
 * counted as `<n> more`. The pool already knows which game first locked each id
 * (`FearlessChampion.gameId`), so a repeat lock is not counted twice and no second read is made.
 * Without a `gameId` nothing is bold and `<n>` is 0.
 */
export async function postFearlessPool(
  client: ServiceClient,
  options: GroupPostOptions & { gameId?: string; lobbyId?: string | null },
): Promise<WebhookOutcome> {
  // The group's own pool, posted to the group's own channel (M13.3): `options.groupId` is the
  // game's group when the result hook calls this.
  const pool = await loadFearless(client, options.groupId);
  if (!isFearlessMode(pool.mode)) return SKIPPED(FEARLESS_SKIPPED_NORMAL);
  if (pool.champions.length === 0) return SKIPPED('fearless pool is empty');

  const [group, lobbyLabel] = await Promise.all([
    loadPostGroup(client, options.groupId),
    // M22.7: the line naming the game's lobby, while two or more are live.
    loadPostLobby(client, options.groupId, options.lobbyId ?? null, options.now ?? new Date()),
  ]);
  return postToWebhook(
    client,
    fearlessEmbed({
      identity: postIdentity(group, options.requestOrigin),
      champions: pool.champions,
      added: addedBy(pool.champions, options.gameId),
      url: fearlessUrl(options.requestOrigin, group?.slug ?? null),
      ...(lobbyLabel === undefined ? {} : { lobbyLabel }),
    }),
    'fearless embed',
    options,
  );
}

/** The pool's ids that `gameId` locked first: the ones that game added (M14.31). */
export function addedBy(
  champions: readonly { id: number; gameId?: string }[],
  gameId: string | undefined,
): Set<number> {
  if (gameId === undefined) return new Set();
  return new Set(champions.filter((champion) => champion.gameId === gameId).map((champion) => champion.id));
}

/**
 * An admin just cleared the pool. Always posted (or skipped for no webhook): the squad
 * needs to know the ban list is empty, which is a different fact from silence.
 *
 * Except on Normal (M14.29): the cursor still moves, but nobody is drafting under fearless, so
 * "the ban list is empty" is not news. `skipped`, and the reset route answers `post: 'skipped'`.
 */
export async function postFearlessReset(
  client: ServiceClient,
  options: GroupPostOptions,
): Promise<WebhookOutcome> {
  if (!isFearlessMode(await loadGroupMode(client, options.groupId))) return SKIPPED(FEARLESS_SKIPPED_NORMAL);

  const [group, live] = await Promise.all([
    loadPostGroup(client, options.groupId),
    loadLiveLobbyCount(client, options.groupId, options.now ?? new Date()),
  ]);
  return postToWebhook(
    client,
    fearlessResetEmbed({
      identity: postIdentity(group, options.requestOrigin),
      url: fearlessUrl(options.requestOrigin, group?.slug ?? null),
      // M22.7: `For both lobbies.` while two or more are live.
      ...(live >= 2 ? { liveLobbies: live } : {}),
    }),
    'fearless reset embed',
    options,
  );
}

/**
 * The nightly board (M3.5, windowed by M5.12). One post: **this week's** top ten by week points
 * (M18.6, `round(weekly R) − 1200`), in the same order the board puts them in, because it is the
 * same `loadBoard` read through the same window that page opens on.
 *
 * The title is `This week · board` (M14.72) and the link carries `?window=this-week`, so the tap
 * from the channel lands on the board the post printed.
 *
 * **Two ways to say nothing**, both `skipped`, neither an empty message — the result embed's
 * rule applied here, that a message that says nothing is worse than silence. Anything else is
 * the webhook's answer, and a webhook that is down costs a log line.
 *
 * **The schedule is not here.** This is a function and a route; something outside the app
 * calls it at a configured time (`GET /api/cron/leaderboard`, bearer `CRON_SECRET`), exactly
 * as the idle sweep works. The weekly post is M5.10 and M5.13, with its own route and its own
 * window.
 */
export async function postNightlyLeaderboard(
  client: ServiceClient,
  options: GroupPostOptions,
): Promise<WebhookOutcome> {
  const board = await loadBoard(client, {
    window: NIGHTLY_WINDOW,
    now: options.now ?? new Date(),
    timeZone: options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
    // The group's own board, to the group's own channel (M13.4).
    groupId: options.groupId,
  });
  const skip = nightlyLeaderboardSkip(board);
  if (skip !== null) return SKIPPED(skip);

  const track = boardTrack(board);
  const [group, ratedGames] = await Promise.all([
    loadPostGroup(client, options.groupId),
    track === 'week' ? null : loadRatedGames(client, options.groupId),
  ]);
  const { entries, settling } = boardPostEntries(board.rows, track, ratedGames);

  const payload = leaderboardEmbed({
    identity: postIdentity(group, options.requestOrigin),
    windowLabel: WINDOW_LABELS[board.window],
    track,
    entries,
    settling,
    url: group === null ? undefined : leaderboardPageUrl(options.requestOrigin, group.slug, board.window),
  });
  return postToWebhook(client, payload, 'leaderboard embed', options);
}

/** The nightly post prints the board `/leaderboard` opens on, and follows it if it ever moves. */
const NIGHTLY_WINDOW = LEADERBOARD_WINDOW;

/**
 * A board's rows as a board post's lines (M3.5, M5.10; Rating since M14.10, STRATEGY §5). Pure.
 *
 * **A week line prints week points and W–L and the post keeps the board's own order** (M18.6: week
 * points, then the tie-break), one list, with the all-time settling chip on a line whose player
 * has fewer than `SETTLING_GAMES` rated games (the row's own `settlingChip` and `ratedGames`). On
 * the all-time track every line prints `Rating` and the post is ordered on it: (`All time`, the
 * months) the rows are re-sorted on Rating, and anybody under `SETTLING_GAMES` rated games in the
 * group (`ratedGames`, the group's `ratings.games`; a player missing from it counts as 0) is moved
 * out of the numbered list into `settling`, by Rating, unnumbered. Ties on Rating keep the board's
 * own order. At most {@link TOP_N} of each.
 *
 * **`ratedGames` null on the all-time track means the counts could not be read**: everybody is
 * ranked, by Rating, with no settling split. Calling a 40-game regular `settling · 0/10` would be
 * a false statement; numbering a newcomer only leaves a qualifier off, in the true order.
 *
 * The count on a ranked line is **the window's** games, like every other number on the row.
 */
export function boardPostEntries(
  rows: readonly BoardRow[],
  track: RatingTrack,
  ratedGames: ReadonlyMap<string, number> | null,
): { entries: LeaderboardEntry[]; settling: SettlingEntry[] } {
  const entry = (row: BoardRow): LeaderboardEntry => ({
    puuid: row.puuid,
    name: row.name,
    rating: row.rating,
    games: row.games,
  });
  if (track === 'week') {
    return {
      entries: rows.slice(0, TOP_N).map((row) => ({
        ...entry(row),
        week: {
          points: row.points ?? 0,
          wins: row.wins,
          losses: row.losses,
          settlingGames: row.settlingChip ? row.ratedGames : null,
        },
      })),
      settling: [],
    };
  }

  const byRating = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.rating - a.row.rating || a.index - b.index)
    .map(({ row }) => row);
  if (ratedGames === null) return { entries: byRating.slice(0, TOP_N).map(entry), settling: [] };
  const count = (row: BoardRow): number => ratedGames.get(row.puuid) ?? 0;
  return {
    entries: byRating
      .filter((row) => !isSettling(count(row)))
      .slice(0, TOP_N)
      .map(entry),
    settling: byRating
      .filter((row) => isSettling(count(row)))
      .slice(0, TOP_N)
      .map((row) => ({ puuid: row.puuid, name: row.name, rating: row.rating, ratedGames: count(row) })),
  };
}

/**
 * Rated games per puuid in one group (`ratings.games`), for the settling
 * rule. A failed read is logged and returns `null`, and the post goes out with everybody ranked
 * and no settling split (see {@link boardPostEntries}).
 *
 * The count is the **current** one. Only the all-time track has a settling split, and the
 * nightly post reads the all-time board, so the current count is the right one.
 */
async function loadRatedGames(client: ServiceClient, groupId: string): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  try {
    const { data, error } = await client
      .from('ratings')
      .select('games, players!inner(puuid)')
      .eq('group_id', groupId);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) counts.set(row.players.puuid, row.games);
  } catch (error) {
    console.error(
      'discord: reading rated-game counts failed; posting the board with no settling split',
      error,
    );
    return null;
  }
  return counts;
}

/** The track every row on this board came from; an empty board never reaches a post. */
function boardTrack(board: BoardView): RatingTrack {
  return board.rows[0]?.track ?? 'all-time';
}

/**
 * Why tonight's board is not worth posting, or `null` when it is. Pure, so the rules are a
 * unit test rather than a week nobody can arrange.
 *
 * With the board windowed, the two rules are one fact from two directions: **membership is the
 * games**, so a week nobody has played has no rows at all. The `every(games === 0)` rule is
 * kept because `All time` — the window a future caller might pass — still seeds every known
 * player from their rank, and posting that is a ranking of games that have not happened.
 */
export function nightlyLeaderboardSkip(board: BoardView): string | null {
  if (board.rows.length === 0) return 'nobody on the board';
  if (board.rows.every((row) => row.games === 0)) return 'nobody has played in this window';
  return null;
}

/**
 * The reason a closed window is not worth posting, and the one reason the caller must be able
 * to recognise (M5.13): a window with no games is stamped posted rather than retried hourly
 * for seven days, because there is nothing there to find. Every other skip is retryable.
 */
export const NO_GAMES_IN_WINDOW = 'no games in the window';

/**
 * The post a closed week makes of itself (M5.10; the month post went with M14.48). One embed: the window's board,
 * under the days it covers, linking to the same board on the web.
 *
 * `GET /api/cron/window` (M5.13) decides **when** this runs and that it runs once; this
 * decides what it says. The window is passed in rather than computed here so that the row
 * written in `window_posts` and the board printed in the channel cannot be two different
 * weeks.
 *
 * **Silence when the window is empty**, `skipped` with {@link NO_GAMES_IN_WINDOW}: the nightly
 * post's rule (a message that says nothing is worse than silence) applies harder here, because
 * `No games last week.` is a true sentence for a page somebody chose to open and a bad one for
 * a channel it arrives in unasked.
 *
 * **The awards are M5.4's, quoted** (M5.10's rule): `lib/stats` computes the same three lines
 * the page prints and this hands them to the embed's seam. Nothing here re-derives a number, a
 * minimum or a sentence — including the one an award nobody won prints, so the block always has
 * three lines and the group can see the bar it missed.
 */
export async function postClosedWindow(
  client: ServiceClient,
  window: ClosedWindow,
  options: GroupPostOptions,
  hooks: ClosedWindowHooks = {},
): Promise<WebhookOutcome> {
  const board = await loadBoard(client, {
    window: window.kind,
    // The group's own window, to the group's own channel (M13.4).
    groupId: options.groupId,
    // The board recomputes the window's bounds from `now` the same way `closedWindow` did, so
    // the row written in `window_posts` and the board printed in the channel are one week by
    // construction.
    now: options.now ?? new Date(),
    timeZone: options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
  });

  // Membership in a window *is* its counted games, so the board answers "was anything played"
  // without a second query. `range` is null on exactly that case (M5.12's slot), and the three
  // are checked together because a post with any one of them missing would be a message that
  // says nothing.
  if (board.rows.length === 0 || board.games === 0 || board.range === null) {
    return SKIPPED(NO_GAMES_IN_WINDOW);
  }

  // `last-week` is a week board (week points, M18.6), read off the rows rather than re-derived
  // from `window.kind`; the all-time branch was `last-month`'s until M14.48 and stays harmless.
  const track = boardTrack(board);
  const [group, ratedGames] = await Promise.all([
    loadPostGroup(client, options.groupId),
    track === 'week' ? null : loadRatedGames(client, options.groupId),
  ]);
  const { entries, settling } = boardPostEntries(board.rows, track, ratedGames);
  const read = await loadWindowAwards(client, window, options);

  // M16.5: the weekly storyline, read before the post is built so it goes in as E0 (05-design
  // 10.6, M14.61's `windowSummaryEmbed({ storyline })`). With none (no hook, not Premium, no
  // line, hidden) the post is the board alone, byte for byte; the message guard drops E0 whole
  // first if it would take the message past 6000.
  const storyline =
    hooks.storyline === undefined
      ? null
      : await hooks.storyline({
          groupId: options.groupId,
          window,
          timeZone: options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
          rows: board.rows,
          games: board.games,
          stats: read.stats,
        });

  const payload = windowSummaryEmbed({
    identity: postIdentity(group, options.requestOrigin),
    windowLabel: WINDOW_LABELS[window.kind],
    track,
    settling,
    awards: read.awards,
    // **The page's line, not a second one** (M5.12, M5.10): the slot under the picker and this
    // description are the same words about the same window, so the tap out of the channel
    // lands on a page that agrees with the post it came from. Since M7.18 those words name the
    // count — `Sunday 6 Sep to Saturday 12 Sep · 14 rated games` — and they still come from the
    // board's one formatter, so the post cannot say a different thing from the page it links to.
    description: boardSlotLine(board.range, board.games),
    entries,
    url: group === null ? undefined : leaderboardPageUrl(options.requestOrigin, group.slug, window.kind),
    storyline: storyline ?? undefined,
    image: group === null ? undefined : await weekNotesImage(client, window, group, options),
  });
  return postToWebhook(client, payload, `${window.kind} embed`, options);
}

/**
 * M14.79: the week notes picture under the board, or `undefined`. Only from a public https origin,
 * and only for a week the route will draw: a week with nothing worth a picture (`isNearlyEmpty`)
 * sends no image, so Discord never shows a broken square. A failed read is no image, never a
 * failed post.
 */
async function weekNotesImage(
  client: ServiceClient,
  window: ClosedWindow,
  group: PostGroup,
  options: GroupPostOptions,
): Promise<string | undefined> {
  const timeZone = options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE;
  // The Sunday the week opens on (`2026-09-27`), the route's `[weekStart]`.
  const key = civilDayKey(window.start, timeZone);
  const url = weekNotesImageUrl(options.requestOrigin, group.slug, key);
  if (url === undefined) return undefined;
  try {
    const week = weekFromParam(key, timeZone, options.now ?? new Date());
    if (week === null) return undefined;
    const model = await loadWeekNotes(client, { id: options.groupId, name: group.name }, week, timeZone);
    return model === null ? undefined : url;
  } catch (error) {
    console.error('discord: reading the week notes failed; posting without the image', error);
    return undefined;
  }
}

/**
 * What the Sunday post read, handed to the storyline (M16.5) so its facts are the post's own
 * numbers: the closed week's board rows in the post's order, its game count, and the stats read
 * the awards came from (`null` when that read failed).
 */
export interface WeekPostSource {
  groupId: string;
  window: ClosedWindow;
  timeZone: string;
  rows: readonly BoardRow[];
  games: number;
  stats: StatsView | null;
}

export interface ClosedWindowHooks {
  /**
   * The weekly storyline (M16.5, `lib/ai/storyline.ts`): Discord-ready text or null. Must never
   * throw; the cron route passes it, every other caller (tests) gets today's post.
   */
  storyline?: (source: WeekPostSource) => Promise<string | null>;
}

/**
 * The **web page's own award lines**, in Discord's glyphs (M5.4, M5.10).
 *
 * One computation, two renderings: `loadStats` reads the same window through the same
 * `gateGame` universe the page reads it through, and the only thing this passes in is how a
 * name and a delta are spelled — markdown escaped, and an ASCII minus in a message that gets
 * copy-pasted (`05-design.md` keeps U+2212 out of the embeds).
 *
 * A tie names two winners, and two lines go into one field entry under one bold label rather
 * than printing the label twice.
 *
 * **A failed award read is not a failed post.** The board is the message; the awards are three
 * lines under it. If the second read throws, the post goes out as the board alone and the
 * reason is in the log — a Sunday with no post at all would be worse than a Sunday without
 * `Cursed duo`.
 */
async function loadWindowAwards(
  client: ServiceClient,
  window: ClosedWindow,
  options: GroupPostOptions,
): Promise<{ awards: WindowAward[]; stats: StatsView | null }> {
  const render: AwardRender = { name: renderName, delta: formatDelta };

  try {
    const stats = await loadStats(client, {
      window: window.kind,
      now: options.now ?? new Date(),
      timeZone: options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
      awardRender: render,
      groupId: options.groupId,
    });
    // A closed window always has the three; `running` and `null` belong to windows this
    // function is never called for (`ClosedWindow` is `last-week`).
    if (stats.awards === null || stats.awards.kind !== 'closed') return { awards: [], stats };
    return {
      awards: stats.awards.blocks.map((block) => ({
        label: block.label,
        line: block.lines.map((line) => line.text).join('\n'),
      })),
      stats,
    };
  } catch (error) {
    console.error(`discord: reading ${window.kind} awards failed`, error);
    return { awards: [], stats: null };
  }
}

/**
 * The stored split, the lobby it belongs to, and the pool around it, in the shape the pure
 * builder wants. `null` when the split is gone.
 */
async function loadTeamsSource(
  client: ServiceClient,
  splitId: string,
  options: PostOptions,
): Promise<{ source: TeamsSource; groupId: string; lobbyId: string } | null> {
  const { data, error } = await client
    .from('splits')
    .select('rank, blue, red, explanation, lobbies!inner(id, lobby_name, lobby_password, group_id)')
    .eq('id', splitId)
    .maybeSingle();
  if (error) throw new Error(`discord: split lookup failed: ${error.message}`);
  if (!data) return null;

  // How many the lobby stored, so the title can say `of 2` without assuming core returned
  // three (`teamsTitle`). One count, on the same index the promotion uses.
  const { count, error: countError } = await client
    .from('splits')
    .select('id', { count: 'exact', head: true })
    .eq('lobby_id', data.lobbies.id);
  if (countError) throw new Error(`discord: split count failed: ${countError.message}`);
  const [receipt, mode] = await Promise.all([
    loadLobbyReceipt(client, data.lobbies.id, splitId),
    // Reroll keeps the lobby's copy (M15.3), so its post carries the same rule line (M15.6).
    loadTeamsMode(client, data.lobbies.id),
  ]);
  const shownMode =
    mode !== null && options.newRegions === true && mode.mode.id === 'region'
      ? { ...mode, newRegions: true }
      : mode;

  const blue = readAssignments(data.blue);
  const red = readAssignments(data.red);
  const ten = new Set([...blue, ...red].map((assignment) => assignment.puuid));

  const pool = await loadGroupPool(
    client,
    data.lobbies.id,
    options.now ?? new Date(),
    options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
    data.lobbies.group_id,
  );

  const playing = pool.filter((member) => ten.has(member.puuid));
  if (playing.length !== ten.size) return null;
  const sitters = pool.filter((member) => !ten.has(member.puuid)).sort(compareForSitOut);
  const first = pool[0]?.gamesTonight ?? 0;
  const tiedOnGames = pool.every((member: PoolMember) => member.gamesTonight === first);

  return {
    groupId: data.lobbies.group_id,
    lobbyId: data.lobbies.id,
    source: {
      split: { blue, red },
      explanation: data.explanation,
      lobbyName: data.lobbies.lobby_name,
      lobbyPassword: data.lobbies.lobby_password,
      playing,
      sitters,
      seatMoves: planSeats({ playing, sitters, tiedOnGames }),
      tiedOnGames,
      promoted: { rank: data.rank, splitCount: count ?? data.rank },
      receipt,
      mode: shownMode,
    },
  };
}

/**
 * Whether a finished game gets a result post: rated, or skipped by the fold for `not-rated`
 * alone (M15.6). `not-rated` is only ever the fold's answer for a game that passed every other
 * gate (ten, five a side, over five minutes, Rift), so ARAM (`game-mode`) and a remake
 * (`duration`) never reach it.
 */
export function announcesResult(event: Pick<GameFinishedEvent, 'rated' | 'reason'>): boolean {
  return event.rated || event.reason === 'not-rated';
}

/**
 * The listener. One object, so `registerLobbyHook` deduplicates it and calling
 * {@link registerDiscordHooks} twice registers one hook.
 */
export const discordLobbyHook: LobbyHook = {
  onBalanced: async (event: LobbyBalancedEvent): Promise<void> => {
    // `getServiceClient` reads the environment when it is called, never at import, so this
    // module can be imported by a build that has no Supabase keys.
    await postTeamsForEvent(getServiceClient(), event);
  },
  onStarted: async (event: LobbyStartedEvent): Promise<void> => {
    // M21.6: teams Kustom did not roll get a `Game on` post; a rolled kickoff gets nothing. The
    // event fires once per game (the kickoff write is the claim), so two companions send one.
    if (!announcesKickoff(event.kickoff)) return;
    await postGameOnForLobby(getServiceClient(), event);
  },
  onFinished: async (event: GameFinishedEvent): Promise<void> => {
    // A game the fold actually rated, or a clean Rift game played not rated (M15.6: it gets a
    // result post, because the rule line lives there; ARAM, remakes and short games still none).
    // The route already narrows this to the post that changed something, so two companions in
    // one game produce one message.
    if (!announcesResult(event)) return;
    const client = getServiceClient();
    // Both posts go to the game's group (M13.3): its channel, and its own fearless pool.
    const origin = { requestOrigin: event.requestOrigin ?? null, groupId: event.groupId };
    await postResultForGame(client, event.gameId, origin);
    // Only a rated game adds to the pool (R4), so a not-rated one has no new pool to post.
    if (event.rated)
      await postFearlessPool(client, { ...origin, gameId: event.gameId, lobbyId: event.lobbyId });
  },
};
