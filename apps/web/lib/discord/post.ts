import { boardSlotLine, WINDOW_LABELS } from '../board/copy';
import { loadBoard } from '../board/load';
import type { BoardRow, BoardView, RatingTrack } from '../board/types';
import { LEADERBOARD_WINDOW } from '../board/window';
import { loadFearless } from '../fearless/load';
import { activeSeasonId, loadPool } from '../ingest/balance';
import type { GameFinishedEvent, LobbyBalancedEvent, LobbyHook } from '../ingest/hooks';
import { compareForSitOut, type PoolMember, planSeats } from '../ingest/selection';
import { type ClosedWindow, DEFAULT_NIGHT_TIME_ZONE } from '../night';
import { leaderboardPageUrl, tonightPageUrl } from '../siteUrl';
import type { AwardRender } from '../stats/awards';
import { loadStats } from '../stats/load';
import { getServiceClient, type ServiceClient } from '../supabase';
import {
  buildResultInput,
  buildTeamsInput,
  loadNames,
  loadResultSource,
  readAssignments,
  type TeamsSource,
  teamsPuuids,
} from './assemble';
import {
  fearlessEmbed,
  fearlessResetEmbed,
  formatDelta,
  type LeaderboardEntry,
  leaderboardEmbed,
  renderName,
  resultEmbed,
  TOP_N,
  teamsEmbed,
  type WindowAward,
  windowSummaryEmbed,
} from './embeds';
import { postToWebhook, type WebhookOptions, type WebhookOutcome } from './webhook';

/**
 * The three posts and the hook that fires them (M3.1, M3.3).
 *
 * Every function here answers with a {@link WebhookOutcome} and none of them throws for a
 * Discord problem: a webhook that is down must cost the group nothing but a log line. The
 * lobby response, the stored splits and the rating fold are all finished before any of this
 * runs — `hooks.ts` is the seam and it awaits us only so a test can.
 */

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
}

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
  const names = await loadNames(client, teamsPuuids(event));
  const input = buildTeamsInput(event, names, {
    url: tonightPageUrl(options.requestOrigin ?? event.requestOrigin),
    timestamp: (options.now ?? new Date()).toISOString(),
  });
  return postToWebhook(client, teamsEmbed(input), 'teams embed', options);
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
  const source = await loadTeamsSource(client, splitId, options);
  if (source === null) return SKIPPED('no such split');

  const names = await loadNames(client, teamsPuuids(source));
  const input = buildTeamsInput(source, names, {
    url: tonightPageUrl(options.requestOrigin),
    timestamp: (options.now ?? new Date()).toISOString(),
  });
  return postToWebhook(client, teamsEmbed(input), 'teams embed', options);
}

/**
 * The result embed for a game the fold just rated. `skipped` when the game has no ratings —
 * a remake, a short surrender, or a block somebody else already rated — because the whole
 * message is what the game did to ten ratings.
 */
export async function postResultForGame(
  client: ServiceClient,
  gameId: string,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const source = await loadResultSource(client, gameId);
  if (source === null) return SKIPPED('no such game');

  const input = buildResultInput(source, {
    url: tonightPageUrl(options.requestOrigin),
    // The game's own end, not now: the embed is a record of something that happened.
    timestamp: source.endedAt,
  });
  if (input === null) return SKIPPED('game is not rated');

  return postToWebhook(client, resultEmbed(input), 'result embed', options);
}

/**
 * The fearless list after a rated Rift custom (M10). A second message, after the result:
 * the result is about what just happened to ten ratings, this is about what to ban next.
 * `skipped` when the pool is empty — there is nothing to ban yet, and a message that says
 * nothing is worse than silence.
 */
export async function postFearlessPool(
  client: ServiceClient,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const pool = await loadFearless(client);
  if (pool.champions.length === 0) return SKIPPED('fearless pool is empty');

  const url = tonightPageUrl(options.requestOrigin);
  return postToWebhook(
    client,
    fearlessEmbed({
      champions: pool.champions,
      timestamp: (options.now ?? new Date()).toISOString(),
      ...(url === undefined ? {} : { url }),
    }),
    'fearless embed',
    options,
  );
}

/**
 * An admin just cleared the pool. Always posted (or skipped for no webhook): the squad
 * needs to know the ban list is empty, which is a different fact from silence.
 */
export async function postFearlessReset(
  client: ServiceClient,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const url = tonightPageUrl(options.requestOrigin);
  return postToWebhook(
    client,
    fearlessResetEmbed({
      timestamp: (options.now ?? new Date()).toISOString(),
      ...(url === undefined ? {} : { url }),
    }),
    'fearless reset embed',
    options,
  );
}

/**
 * The nightly board (M3.5, windowed by M5.12). One post: **this week's** top ten by Proven, in
 * the same order `/leaderboard` puts them in, because it is the same `loadBoard` read through
 * the same window that page opens on.
 *
 * The title is `This week · leaderboard` and the link carries `?window=this-week`, so the tap
 * from the channel lands on the board the post printed. It stops naming a season: a season's
 * name would read as `gamesd · leaderboard` on the deployment that exists, and "the season" is
 * no longer a thing the product has.
 *
 * **Two ways to say nothing**, both `skipped`, neither an empty message — the result embed's
 * rule applied here, that a message that says nothing is worse than silence. Anything else is
 * the webhook's answer, and a webhook that is down costs a log line.
 *
 * **The schedule is not here.** This is a function and a route; something outside the app
 * calls it at a configured time (`GET /api/cron/leaderboard`, bearer `CRON_SECRET`), exactly
 * as the idle sweep works. The weekly and monthly posts are M5.10 and M5.13, with their own
 * route and their own window.
 */
export async function postNightlyLeaderboard(
  client: ServiceClient,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const board = await loadBoard(client, {
    window: NIGHTLY_WINDOW,
    now: options.now ?? new Date(),
    timeZone: options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
  });
  const skip = nightlyLeaderboardSkip(board);
  if (skip !== null) return SKIPPED(skip);

  const entries: LeaderboardEntry[] = board.rows.slice(0, TOP_N).map(boardEntry);

  const payload = leaderboardEmbed({
    windowLabel: WINDOW_LABELS[board.window],
    track: boardTrack(board),
    entries,
    url: leaderboardPageUrl(options.requestOrigin, board.window),
    timestamp: (options.now ?? new Date()).toISOString(),
  });
  return postToWebhook(client, payload, 'leaderboard embed', options);
}

/** The nightly post prints the board `/leaderboard` opens on, and follows it if it ever moves. */
const NIGHTLY_WINDOW = LEADERBOARD_WINDOW;

/**
 * One board row as one line of a board post (M3.5, M5.10; the number chosen by M7.3).
 *
 * **The line prints the number the board sorted on**, which the row already carries: Proven on
 * an all-time row and the weekly `Rating` on a weekly one. The post does not decide this and
 * does not read a window to work it out — the loader put both numbers and the track on the row,
 * and a post that picked a different one from the page would be the two surfaces disagreeing
 * about who won the week.
 *
 * The count is **the window's** games, like every other number on the row: `41 games` on a
 * Tuesday would be a whole history printed under a heading that says this week.
 */
function boardEntry(row: BoardRow): LeaderboardEntry {
  return {
    puuid: row.puuid,
    name: row.name,
    score: row.track === 'weekly' ? row.rating : row.proven,
    games: row.games,
  };
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
 * The post a closed week or month makes of itself (M5.10). One embed: the window's board,
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
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const board = await loadBoard(client, {
    window: window.kind,
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

  const entries: LeaderboardEntry[] = board.rows.slice(0, TOP_N).map(boardEntry);

  const payload = windowSummaryEmbed({
    windowLabel: WINDOW_LABELS[window.kind],
    // `last-week` is the weekly track and `last-month` is the all-time one (M7.3), read off the
    // rows rather than re-derived from `window.kind`.
    track: boardTrack(board),
    awards: await loadWindowAwards(client, window, options),
    // **The page's line, not a second one** (M5.12, M5.10): the slot under the picker and this
    // description are the same words about the same window, so the tap out of the channel
    // lands on a page that agrees with the post it came from. Since M7.18 those words name the
    // count — `Sunday 6 Sep to Saturday 12 Sep · 14 rated games` — and they still come from the
    // board's one formatter, so the post cannot say a different thing from the page it links to.
    description: boardSlotLine(board.range, board.games),
    entries,
    url: leaderboardPageUrl(options.requestOrigin, window.kind),
    // The moment the post is made, not the moment the window closed: Discord prints this as
    // "when this message is from", and the description is what says which week it covers.
    timestamp: (options.now ?? new Date()).toISOString(),
  });
  return postToWebhook(client, payload, `${window.kind} embed`, options);
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
  options: PostOptions,
): Promise<WindowAward[]> {
  const render: AwardRender = { name: renderName, delta: formatDelta };

  try {
    const stats = await loadStats(client, {
      window: window.kind,
      now: options.now ?? new Date(),
      timeZone: options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
      awardRender: render,
    });
    // A closed window always has the three; `running` and `null` belong to windows this
    // function is never called for (`ClosedWindow` is `last-week` or `last-month`).
    if (stats.awards === null || stats.awards.kind !== 'closed') return [];
    return stats.awards.blocks.map((block) => ({
      label: block.label,
      line: block.lines.map((line) => line.text).join('\n'),
    }));
  } catch (error) {
    console.error(`discord: reading ${window.kind} awards failed`, error);
    return [];
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
): Promise<TeamsSource | null> {
  const { data, error } = await client
    .from('splits')
    .select('rank, blue, red, explanation, lobbies!inner(id, lobby_name, lobby_password)')
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

  const blue = readAssignments(data.blue);
  const red = readAssignments(data.red);
  const ten = new Set([...blue, ...red].map((assignment) => assignment.puuid));

  const seasonId = await activeSeasonId(client);
  const pool = await loadPool(
    client,
    data.lobbies.id,
    seasonId,
    options.now ?? new Date(),
    options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
  );

  const playing = pool.filter((member) => ten.has(member.puuid));
  if (playing.length !== ten.size) return null;
  const sitters = pool.filter((member) => !ten.has(member.puuid)).sort(compareForSitOut);
  const first = pool[0]?.gamesTonight ?? 0;
  const tiedOnGames = pool.every((member: PoolMember) => member.gamesTonight === first);

  return {
    split: { blue, red },
    explanation: data.explanation,
    lobbyName: data.lobbies.lobby_name,
    lobbyPassword: data.lobbies.lobby_password,
    playing,
    sitters,
    seatMoves: planSeats({ playing, sitters, tiedOnGames }),
    tiedOnGames,
    promoted: { rank: data.rank, splitCount: count ?? data.rank },
  };
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
  onFinished: async (event: GameFinishedEvent): Promise<void> => {
    // Only a game the fold actually rated. The route already narrows this to the post that
    // changed something, so two companions in one game produce one message. Rated also means
    // counted Rift, which is the only map Fearless reads.
    if (!event.rated) return;
    const client = getServiceClient();
    const origin = { requestOrigin: event.requestOrigin ?? null };
    await postResultForGame(client, event.gameId, origin);
    await postFearlessPool(client, origin);
  },
};
