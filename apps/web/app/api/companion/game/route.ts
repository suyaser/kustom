import { scrubRawEogBlock } from '@customs/db';
import {
  type CompanionGamePayload,
  companionGamePayloadSchema,
  companionGameResponseSchema,
  hasWinningTeam,
  NO_WINNING_TEAM_MESSAGE,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { scheduleGameLine } from '@/lib/ai/afterIngest';
import { invalidateGroup } from '@/lib/cache/tags';
import { type CompanionContext, withCompanionAuth } from '@/lib/companionRoute';
import { jsonError, jsonOk } from '@/lib/http';
import {
  CUSTOM_GAME_TYPE,
  findDuplicateParticipant,
  ingestEogGame,
  isCustomGame,
  isParticipant,
} from '@/lib/ingest/game';
import { type LiveChanges, noteWrite, withLiveSignal } from '@/lib/live/bump';
// Registers the Discord listeners on `hooks.ts` at module load (M3.1, M3.3). Side-effect
// import: remove it and this route behaves identically, minus the message.
import '@/lib/ingest/discord';
import { emitGameFinished } from '@/lib/ingest/hooks';
import { writeKickoffAtStart } from '@/lib/ingest/kickoff';
import { isLobbyMemberOfGame, selectActiveLobby } from '@/lib/ingest/lobby';
import {
  BACKFILL_NOT_RATED,
  FOREIGN_DUPLICATE_NOT_RATED,
  NOT_THIS_GROUP_REASON,
  rateStoredGame,
} from '@/lib/ingest/rating';
import { moveLobbyLogged, sweepIdleLobbies } from '@/lib/lobbyState';
import { lockLobbyAtStart } from '@/lib/mode/lock';
import { applyModeRecord } from '@/lib/mode/record';
import { siteOrigin } from '@/lib/siteUrl';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * M16.4: `after()` work is bounded by this function's timeout. The recap can take two model
 * attempts (20 s each) plus a transient retry and the Discord edit, past a 10-15 s default, so the
 * route allows 60 s. The companion's answer still goes out at once; only the background task uses it.
 */
export const maxDuration = 60;

/**
 * Two posts per game from the companion: `in_progress` when the client enters the game, and
 * `eog` with the end-of-game block.
 *
 * `in_progress` moves the party's live lobby to `in_game`, which freezes its roster (M2.9)
 * for good — from here the row is only ever `finished` by an eog block or `dropped` by the
 * two-hour sweep (M5.11).
 * `eog` writes the game, runs the rating fold and moves the lobby to `finished` (M2.5). Both
 * are idempotent: `eog` dedupes on `lcu_game_id` and the fold claims the game with the null
 * `mu_after` columns, so everyone in the lobby who runs a companion posts the same block and
 * only the first post changes anything.
 *
 * Refused here, before anything is written:
 * - 422 when `gameType` is not `CUSTOM_GAME` — we only track our own customs;
 * - 422 when no team won: a remake or a `TerminatedInError` block (M2.10, point 6). The
 *   companion is not supposed to post one; if it does, nothing is written, nothing is rated
 *   and no lobby moves. A lobby already at `in_game` stays there until the 2-hour sweep marks
 *   it `dropped` (M5.11), which is what lets the party's next post open a new cycle; M5.5
 *   lists it, and a later block for that same game still moves it `dropped -> finished`;
 * - 422 when the same PUUID appears twice on the scoreboard;
 * - 403 when the token's player is neither on the scoreboard nor a member of the lobby this
 *   game was played from, spectators included (M2.8);
 *
 * The raw block is scrubbed of its chat credentials before it goes anywhere near the database:
 * `games.raw` is public-read under RLS (M2.10, point 11).
 *
 * **`source: 'backfill'` (M5.1)** is the same body walked out of match history months later,
 * and it takes three turns off this path: the participant check has no lobby fallback, the game
 * is linked to no lobby, and the rating fold does not run — the answer says
 * `{ rated: false, reason: 'backfill' }` and the daily `/api/cron/rebuild` (M14.63) folds the
 * group the next morning. Nothing is posted to Discord for one. There is no approval step:
 * every member's companion may send them (`04-decisions.md`, 2026-10-03, reversing M5.1's
 * gate), and the participant check is what limits a token to games its player played.
 *
 * **Groups (M13.3).** The group is the token's. A game already stored anywhere is the usual
 * no-op, and from another group's token it writes nothing, rates nothing and moves no lobby. A
 * live game is stored in its lobby's group; a game with no lobby in the token's. A backfilled
 * game with fewer than six of its players already members of the token's group is not stored
 * at all: the answer is a 2xx with `created: false`, `reason: 'not-this-group'` and
 * `skippedNotThisGroup: 1`, and the next daily scan offers it again.
 *
 * **Live signal (M19.9).** One `group_live` bump per group this post changed, after every write
 * (the game, its players, the fold's ratings, the lobby's `finished`, the card's record write and
 * the Discord post): `game` for an eog that wrote anything, `lobby` for an `in_progress` that moved
 * its lobby (its start lock and kickoff record, M21.4, ride the same bump) and for a lobby the
 * idle sweep moved. A second companion's identical block writes
 * nothing and bumps nothing. `after()` work (the AI line) is not waited for and does not bump.
 */
export const POST = withCompanionAuth(companionGamePayloadSchema, async (payload, context) =>
  withLiveSignal(context.client, (live) => handleGamePost(payload, context, live)),
);

async function handleGamePost(
  payload: CompanionGamePayload,
  { client, identity, request }: CompanionContext,
  live: LiveChanges,
): Promise<NextResponse> {
  // The same sweep the lobby route runs: two hours idle and a lobby is given up on, as
  // `abandoned` if it never started and as `dropped` if its game never reported (M5.11).
  await sweepIdleLobbies(client, new Date(), live);

  if (payload.phase === 'in_progress') {
    const lobby = payload.partyId ? await selectActiveLobby(client, payload.partyId) : null;
    if (lobby !== null) {
      // From here the roster is history (M2.9), and it stays history: the only way out of
      // `in_game` is `finished` (the eog block) or `dropped` (the two-hour sweep, M5.11).
      //
      // Through `noteWrite`, so a move whose answer is lost after the row changed (a dropped
      // connection, a 5xx on the way back) still bumps: the throw is a 500, the companion's retry
      // finds the lobby already `in_game`, moves nothing and would never bump, and Tonight would
      // sit on the teams until something else changed (fix-start-pending).
      await noteWrite(
        live,
        lobby.groupId,
        'lobby',
        () =>
          moveLobbyLogged(
            client,
            { lobbyId: lobby.id, from: ['open', 'balanced'], to: 'in_game' },
            `game ${payload.gameId} in_progress`,
          ),
        (moved) => moved,
      );
      // Rolling is a suggestion (owner bug 2026-10-04): a lobby whose teams were made by hand has
      // no lock (never rolled, or `balanced -> open` dropped it), so the game takes the card now,
      // Rated switch and pending rule included. A Roll's lock is kept. Idempotent: a retry or a
      // second companion finds the lock and writes nothing.
      await lockLobbyAtStart(client, {
        lobbyId: lobby.id,
        groupId: lobby.groupId,
        status: lobby.status,
        now: new Date(),
        onWrite: () => live.touch(lobby.groupId, 'lobby'),
      });
      // M21.4: the teams that started, their kind and (when they are not the roll) Kustom's odds,
      // from the roster frozen a moment ago. Same single-writer style as the lock: it lands only on
      // an `in_game` lobby with no record, so a retry finishes a write a 500 cut short and a second
      // companion writes nothing. The touch is the move's kind, so the request still bumps once.
      await writeKickoffAtStart(client, {
        lobbyId: lobby.id,
        now: new Date(),
        requestOrigin: siteOrigin(request),
        onWrite: () => live.touch(lobby.groupId, 'lobby'),
      });
    }

    return jsonOk(companionGameResponseSchema, {
      ok: true,
      phase: 'in_progress',
      created: false,
      gameId: null,
      lobbyId: lobby?.id ?? null,
      participants: 0,
    });
  }

  if (!isCustomGame(payload)) {
    return jsonError(422, `gameType must be ${CUSTOM_GAME_TYPE}`);
  }

  if (!hasWinningTeam(payload)) {
    return jsonError(422, NO_WINNING_TEAM_MESSAGE);
  }

  const duplicate = findDuplicateParticipant(payload);
  if (duplicate !== null) {
    return jsonError(422, 'the same puuid appears twice in participants');
  }

  // A backfilled game is one this player played months ago, so M2.8's lobby fallback cannot
  // apply to it: nobody sat out a round of a game there is no lobby row for. The token's
  // player must be on the scoreboard or nothing is written (M5.1, `04-decisions.md`).
  const backfill = payload.source === 'backfill';
  const onScoreboard = isParticipant(payload, identity.puuid);

  // M2.8: a friend who sits out a round and watches is a real reporter. Their PUUID is not on
  // the scoreboard, but it is in `lobby_members` for the lobby this game was played from
  // (spectators are in the client's `members[]`, confirmed on 16.17 by M2.13).
  if (
    !onScoreboard &&
    (backfill ||
      !(await isLobbyMemberOfGame(
        client,
        payload.partyId ?? null,
        identity.playerId,
        payload.startedAt,
        payload.participants.map((participant) => participant.puuid),
      )))
  ) {
    return jsonError(403, 'a companion may only report a game its own player was in');
  }

  // The group comes from the token (M13.3); `ingestEogGame` decides where the game lands:
  // an id stored anywhere keeps its group, a live game follows its lobby, and a backfilled one
  // needs six of its ten to be members of the token's group.
  // A throw part way (the game stored, its players not) may already have written: bump the token's
  // group, where a game with no lobby lands (M19.9). The retry then finishes and bumps again.
  const ingested = await noteWrite(
    live,
    identity.groupId,
    'game',
    () =>
      ingestEogGame(
        client,
        { ...payload, raw: scrubRawEogBlock(payload.raw) },
        { groupId: identity.groupId },
      ),
    () => false,
  );

  if (ingested.outcome === 'skipped-not-this-group') {
    // A 2xx, so the companion drops its queue file: nothing is wrong with the game, it is just
    // not this group's yet. Nothing was stored, so the next daily scan offers it again.
    console.info(
      `backfill: game ${payload.gameId} skipped for group ${identity.groupId}: ${ingested.members} of ${payload.participants.length} are members`,
    );
    return jsonOk(companionGameResponseSchema, {
      ok: true,
      phase: 'eog',
      created: false,
      gameId: null,
      lobbyId: null,
      participants: 0,
      rated: false,
      reason: NOT_THIS_GROUP_REASON,
      skippedNotThisGroup: 1,
    });
  }
  const result = ingested;
  // Noted now, flushed at the very end: a fold that throws below still leaves a stored game.
  if (!result.foreignDuplicate && result.wrote) live.touch(result.groupId, 'game');

  // The fold: ten rows, five a side, over five minutes, and exactly once per game (M2.5).
  //
  // Never for a backfilled game (M5.1): ratings are a fold in `started_at` order and backfill
  // delivers games out of order by definition, so the four `game_players` rating columns stay
  // null and `ratings` does not move until the daily `/api/cron/rebuild` (M14.63) folds the
  // group. The answer is still a 2xx with `created` — a 2xx is what lets the companion
  // delete its queue file.
  //
  // Never for another group's game either (M13.3): that post is a no-op, and the fold reads
  // and writes the game's own group's ratings when its own companions post it.
  let fold: Awaited<ReturnType<typeof rateStoredGame>>;
  try {
    fold = backfill
      ? BACKFILL_NOT_RATED
      : result.foreignDuplicate
        ? FOREIGN_DUPLICATE_NOT_RATED
        : await rateStoredGame(client, result.gameId);
  } finally {
    // The group's Stats and games caches (top five, last game, roster labels, calibration): a
    // game stored, rated, renamed or given its bans changes them. In a `finally`, so a fold that
    // throws after the game was stored still expires them (the retry that follows the 500
    // expires them again once the fold lands).
    if (!result.foreignDuplicate) invalidateGroup(result.groupId, ['stats', 'games']);
  }

  // A lobby that is already `finished` (the second companion's post) or that the sweep
  // abandoned between resolving it and here claims nothing and says so in the log.
  //
  // `dropped` is in the `from` list on purpose (M5.11): a block that sat in a companion's
  // queue file for days still closes the lobby it was played from, so the row leaves M5.5's
  // missed list by itself and the night's later cycles are untouched.
  let lobbyFinished = false;
  if (result.lobbyId !== null && !result.foreignDuplicate) {
    lobbyFinished = await moveLobbyLogged(
      client,
      { lobbyId: result.lobbyId, from: ['open', 'balanced', 'in_game', 'dropped'], to: 'finished' },
      `game ${result.gameId}`,
    );
  }

  // M21.11: the party's `in_game` row this game was refused from (its sided members did not all
  // play) is another game's lobby, and that game is over: a party is in one game at a time. Dropped
  // now rather than at the two-hour sweep, so the party's next lobby post opens a fresh cycle
  // instead of landing on the frozen roster (the 2026-10-02 stale match). A late block for that
  // row's own game still moves it `dropped -> finished`. A second companion's post finds it
  // already dropped and moves nothing.
  if (result.staleLobby !== null && !result.foreignDuplicate) {
    const stale = result.staleLobby;
    await noteWrite(
      live,
      stale.groupId,
      'lobby',
      () =>
        moveLobbyLogged(
          client,
          { lobbyId: stale.id, from: ['in_game'], to: 'dropped' },
          `game ${result.gameId} (lobby roster did not play it)`,
        ),
      (moved) => moved,
    );
  }

  // M3.3's seam. Only the post that actually did something announces it, so two companions in
  // one game produce one result. A backfilled game announces nothing at all: it is unrated
  // until a rebuild, and a result embed for a custom from three weeks ago would read as
  // tonight's game in the channel (M5.1).
  if (!backfill && (result.created || fold.rated)) {
    await emitGameFinished({
      gameId: result.gameId,
      lobbyId: result.lobbyId,
      // Discord posts to the game's group's channel (M13.3), not the token's.
      groupId: result.groupId,
      rated: fold.rated,
      // `not-rated` still gets a result post (M15.6): the rule line lives there.
      reason: fold.reason,
      // Only used for the result embed's `url` (M3.3).
      requestOrigin: siteOrigin(request),
    });
  }

  // M16.4: the game's AI recap line, after the result is announced and without holding this
  // answer or the post: `after()` runs it once the response is sent, and nothing it does can
  // fail ingest. Live games of the game's own group only; a repeat post is a no-op (no call).
  if (!backfill && !result.foreignDuplicate) {
    scheduleGameLine({ groupId: result.groupId, gameId: result.gameId });
  }

  // M20.7: what the recorded game writes to the Mode card (core's `recordGame`): nothing for a Rift
  // game from a locked lobby (a choice made after Roll is the next game's and is never cleared); a
  // remake or ARAM hands the lock back into empty fields; a live game with no lock uses the pending
  // state up. Only the post that stored the game writes it, so a second companion's post (or a
  // replay after an admin re-queued the same rule) never clears or hands back twice.
  let modeWritten = false;
  if (result.created && !result.foreignDuplicate) {
    modeWritten = await applyModeRecord(client, result.groupId, result.modeRecord);
  }

  // The game's group hears this post once, after everything above (`withLiveSignal` flushes when
  // this returns): only when something was written, so the second companion's post is silent.
  if (!result.foreignDuplicate && (result.wrote || fold.claimed > 0 || lobbyFinished || modeWritten)) {
    live.touch(result.groupId, 'game');
  }

  return jsonOk(companionGameResponseSchema, {
    ok: true,
    phase: 'eog',
    created: result.created,
    gameId: result.gameId,
    lobbyId: result.lobbyId,
    participants: result.participants,
    rated: fold.rated,
    reason: fold.reason,
  });
}
