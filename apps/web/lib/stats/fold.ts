import type { RoleValue, SideValue } from '@customs/db';
import { currentStreak } from '../board/streak';
import { gateGame, gateRatedGame } from '../ingest/fold';
import { LANE_ORDER } from '../laneOrder';
import { renderWebName } from '../tonight/copy';
import { MIN_DUO_GAMES, MIN_RECORD_GAMES, ON_A_STREAK_GAMES } from './copy';
import type {
  DuoRecord,
  PlayerRef,
  PlayerStreaks,
  RoleBlock,
  StatsGame,
  StatsPlayer,
  StatsRecord,
  StatsRow,
  StreakHolders,
} from './types';

/**
 * Every number on `/stats` (M5.4), as pure functions over a list of games.
 *
 * No client, no `Date.now()`, no environment: this is arithmetic, and it is tested as
 * arithmetic against a hand-built fixture (`stats.test.ts`). The loader in `load.ts` reads the
 * rows and hands them here; the page renders what comes back.
 *
 * Three rules the rest of the file exists to keep.
 *
 * - **The universe is the rating fold's.** A game counts here if and only if `gateRatedGame`
 *   counts it — ten rows, five a side, over 300 seconds, nobody twice, Summoner's Rift —
 *   imported from `lib/ingest/fold.ts` and never re-implemented in SQL or here. ARAM is stored
 *   and listed on `/games` / `/fun`; it is not a number on this page or the leaderboard. The
 *   reason is one product rule: the games number on `/stats` is the games number the fold used,
 *   so two pages can never print two different counts for the same player.
 * - **The order is the rebuild's.** `started_at` ascending, `lcu_game_id` ascending as the
 *   tie-break, so a streak and a rating history tell the same story about the same night.
 * - **The tie rule is stated once and used everywhere**: win rate descending, then games
 *   descending, then display name A–Z, then puuid.
 */

/* ---------------------------------------------------------------------------
 * The universe, and the two primitives every number below is built from.
 * ------------------------------------------------------------------------- */

/**
 * The games that count, oldest first.
 *
 * **`gateRatedGame` decides, and nothing else.** An unrated *Rift* game is *not* excluded here:
 * a backfilled ten-player game the rebuild has not folded yet has a scoreboard, a duration and
 * a winner, and every number on this page except a climb is answerable from it. What a game
 * with nine rows, a duplicate player, a five-minute duration or an ARAM `gameMode` cannot
 * answer is anything at all, which is exactly what the gate says.
 *
 * `/fun` passes `{ allMaps: true }` after it has already filtered by `?queue=`: Howling Abyss
 * still has records, they just are not this page's.
 */
export function countedGames(games: readonly StatsGame[], options?: { allMaps?: boolean }): StatsGame[] {
  return games
    .filter((game) => {
      const players = game.rows.map(toFoldPlayer);
      const gate =
        options?.allMaps === true
          ? gateGame(players, game.durationS)
          : gateRatedGame(players, game.durationS, game.gameMode, game.mapId);
      return gate.ok;
    })
    .sort(byStartedAt);
}

function toFoldPlayer(row: StatsRow) {
  return { playerId: row.playerId, puuid: row.puuid, side: row.side };
}

/**
 * The rebuild's ordering, and the streak's: `started_at`, then `lcu_game_id`.
 *
 * The id is a bigint in the database, so two ids are compared as **numbers** when both are —
 * `9` before `10`, which a string comparison gets backwards and which is exactly the case two
 * games in one night produce. A game with no id at all sorts first, and is only ever tied with
 * another game that has none.
 */
function byStartedAt(a: StatsGame, b: StatsGame): number {
  const started = Date.parse(a.startedAt) - Date.parse(b.startedAt);
  if (started !== 0) return started;

  const left = a.lcuGameId;
  const right = b.lcuGameId;
  if (left === null || right === null) return left === right ? 0 : left === null ? -1 : 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

/** A row won when its side is the game's winning side. The only definition of a win here. */
function won(row: StatsRow, game: StatsGame): boolean {
  return row.side === game.winningSide;
}

/**
 * `Math.round(wins / games * 100)`, or `null` under the minimum — the record then prints
 * without a percentage (`3W 1L`), so nobody is "100% mid" off one game.
 */
export function winRate(wins: number, games: number, minimum = MIN_RECORD_GAMES): number | null {
  if (games < minimum || games === 0) return null;
  return Math.round((wins / games) * 100);
}

/** How many people have a counted row in these games. */
export function playersWhoPlayed(games: readonly StatsGame[]): number {
  const seen = new Set<string>();
  for (const game of games) for (const row of game.rows) seen.add(row.playerId);
  return seen.size;
}

/**
 * **The tie rule, once**: win rate descending, then games descending, then display name A–Z,
 * then puuid.
 *
 * The rate it sorts on is the **printed** one — the rounded percentage — for the board's own
 * reason (`lib/board/order.ts`): a column read top to bottom must not go up. Two rows that both
 * print `71%` are then ordered by games, which is what a reader expects of two equal-looking
 * rows, rather than by a third decimal place nobody can see.
 */
export function compareRecords(a: StatsRecord, b: StatsRecord): number {
  return (
    (b.winRate ?? -1) - (a.winRate ?? -1) ||
    b.games - a.games ||
    renderWebName(a.name).localeCompare(renderWebName(b.name)) ||
    comparePuuid(a, b)
  );
}

function comparePuuid(a: PlayerRef, b: PlayerRef): number {
  return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
}

/** Name then puuid: the stable half of the tie rule, for lists that are not ranked by a rate. */
export function compareByName(a: PlayerRef, b: PlayerRef): number {
  return renderWebName(a.name).localeCompare(renderWebName(b.name)) || comparePuuid(a, b);
}

function refOf(player: StatsPlayer): PlayerRef {
  return { puuid: player.puuid, name: player.name };
}

function byPlayerId(players: readonly StatsPlayer[]): Map<string, StatsPlayer> {
  return new Map(players.map((player) => [player.playerId, player]));
}

/** A tally being built: the record before it knows its own win rate. */
interface Tally {
  games: number;
  wins: number;
}

function add(tally: Tally | undefined, win: boolean): Tally {
  const next = tally ?? { games: 0, wins: 0 };
  return { games: next.games + 1, wins: next.wins + (win ? 1 : 0) };
}

function toRecord(ref: PlayerRef, tally: Tally, minimum = MIN_RECORD_GAMES): StatsRecord {
  return {
    ...ref,
    games: tally.games,
    wins: tally.wins,
    losses: tally.games - tally.wins,
    winRate: winRate(tally.wins, tally.games, minimum),
  };
}

/* ---------------------------------------------------------------------------
 * 1. By role.
 * ------------------------------------------------------------------------- */

/**
 * The five blocks, in lane order, each a ranked list of the players with at least
 * {@link MIN_RECORD_GAMES} rows at that role.
 *
 * **There is no group-wide win rate by role and there must not be one**: every game has a blue
 * top and a red top, so any group-level role rate is 50.0% by construction. Five lists of
 * players is the honest shape of the question "who wins on jungle".
 *
 * Rows with `role: null` change no number here and are counted by {@link noRoleGames} instead.
 */
export function roleBlocks(games: readonly StatsGame[], players: readonly StatsPlayer[]): RoleBlock[] {
  const roster = byPlayerId(players);
  const tallies = new Map<RoleValue, Map<string, Tally>>();

  for (const game of games) {
    for (const row of game.rows) {
      if (row.role === null) continue;
      const byRole = tallies.get(row.role) ?? new Map<string, Tally>();
      byRole.set(row.playerId, add(byRole.get(row.playerId), won(row, game)));
      tallies.set(row.role, byRole);
    }
  }

  return LANE_ORDER.map((role) => {
    const byRole = tallies.get(role) ?? new Map<string, Tally>();
    const entries: StatsRecord[] = [];
    for (const [playerId, tally] of byRole) {
      const player = roster.get(playerId);
      // A scoreboard row whose player `players_public` cannot answer for is not a line we can
      // draw. The foreign key says it cannot happen.
      if (player === undefined || tally.games < MIN_RECORD_GAMES) continue;
      entries.push(toRecord(refOf(player), tally));
    }
    return { role, entries: entries.sort(compareRecords) };
  });
}

/**
 * One player's record at each role they actually played, in lane order — the shape
 * `/p/[puuid]` wants, and the one place a record under five games keeps its bare `1W 0L`.
 */
export function playerRoleRecords(
  games: readonly StatsGame[],
  player: StatsPlayer,
): (StatsRecord & { role: RoleValue })[] {
  const tallies = new Map<RoleValue, Tally>();
  for (const game of games) {
    for (const row of game.rows) {
      if (row.playerId !== player.playerId || row.role === null) continue;
      tallies.set(row.role, add(tallies.get(row.role), won(row, game)));
    }
  }

  return LANE_ORDER.flatMap((role) => {
    const tally = tallies.get(role);
    return tally === undefined ? [] : [{ role, ...toRecord(refOf(player), tally) }];
  });
}

/**
 * Counted games the role numbers know nothing about: the ones where **no row carries a role**.
 *
 * That is the shape product describes and the shape the data has — backfilled games carry
 * `role: null` on all ten (M5.1), and an end-of-game block either had the positions or it did
 * not. A game with nine roles and one gap is counted here as *in* the numbers, because nine of
 * its rows are; the tenth row simply belongs to no role, exactly as it does everywhere else on
 * this page.
 */
export function noRoleGames(games: readonly StatsGame[]): number {
  return games.filter((game) => game.rows.every((row) => row.role === null)).length;
}

/**
 * The same footnote's number for one person: **their own rows** with no role on them.
 *
 * On a page about one player the group's "a game where nobody's position was recorded" is the
 * wrong count — what this reader wants to know is how many of *their* games are missing from
 * the record above, and a game where the client caught nine positions and missed theirs is one
 * of them. It is the only per-player number on that page the group form cannot answer.
 */
export function playerNoRoleGames(games: readonly StatsGame[], player: StatsPlayer): number {
  return games.filter((game) =>
    game.rows.some((row) => row.playerId === player.playerId && row.role === null),
  ).length;
}

/* ---------------------------------------------------------------------------
 * 2. By side.
 * ------------------------------------------------------------------------- */

/** Blue wins ÷ counted games, and the count it is over. `null` rate at zero games. */
export function blueWinRate(games: readonly StatsGame[]): number | null {
  if (games.length === 0) return null;
  const blue = games.filter((game) => game.winningSide === 100).length;
  // The group rate is over every counted game, so it has no five-game minimum: it is one
  // number about the whole window and it is the headline of the section.
  return Math.round((blue / games.length) * 100);
}

/** One player's two side records, blue first. Under five games each prints without a rate. */
export function playerSideRecords(
  games: readonly StatsGame[],
  player: StatsPlayer,
): { side: SideValue; record: StatsRecord }[] {
  const tallies = new Map<SideValue, Tally>();
  for (const game of games) {
    for (const row of game.rows) {
      if (row.playerId !== player.playerId) continue;
      tallies.set(row.side, add(tallies.get(row.side), won(row, game)));
    }
  }

  const sides: SideValue[] = [100, 200];
  return sides.flatMap((side) => {
    const tally = tallies.get(side);
    return tally === undefined ? [] : [{ side, record: toRecord(refOf(player), tally) }];
  });
}

/* ---------------------------------------------------------------------------
 * 3. Duos.
 * ------------------------------------------------------------------------- */

/**
 * Every pair with at least `minimum` games **on the same side**, best first.
 *
 * A pair is credited with a game when both have a counted row in it on the same side: a game
 * they played against each other counts for neither the numerator nor the denominator.
 * Rivalries are a different question and are not in this milestone.
 */
export function duoRecords(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  minimum = MIN_DUO_GAMES,
): DuoRecord[] {
  const roster = byPlayerId(players);
  const tallies = new Map<string, { a: string; b: string; tally: Tally }>();

  for (const game of games) {
    for (const side of [100, 200] as const) {
      const ids = game.rows.filter((row) => row.side === side).map((row) => row.playerId);
      const win = game.winningSide === side;
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const first = ids[i] as string;
          const second = ids[j] as string;
          // Keyed on the two ids in a fixed order, so `{A, B}` and `{B, A}` are one pair.
          const [a, b] = first < second ? [first, second] : [second, first];
          const key = `${a}|${b}`;
          const entry = tallies.get(key);
          tallies.set(key, { a, b, tally: add(entry?.tally, win) });
        }
      }
    }
  }

  const records: DuoRecord[] = [];
  for (const { a, b, tally } of tallies.values()) {
    const first = roster.get(a);
    const second = roster.get(b);
    if (first === undefined || second === undefined || tally.games < minimum) continue;

    const pair = [refOf(first), refOf(second)].sort(compareByName) as [PlayerRef, PlayerRef];
    records.push({
      players: pair,
      games: tally.games,
      wins: tally.wins,
      losses: tally.games - tally.wins,
      // A pair only exists past its minimum, so its rate is never the bare-record `null`.
      winRate: winRate(tally.wins, tally.games, 1) as number,
    });
  }

  return records.sort(compareDuos);
}

/** The tie rule, on a pair: rate descending, games descending, then the two names. */
export function compareDuos(a: DuoRecord, b: DuoRecord): number {
  return b.winRate - a.winRate || b.games - a.games || comparePairNames(a, b);
}

/**
 * The same list read from the other end: rate **ascending**, then games descending — a pair
 * that has lost together eleven times is more cursed than one that has lost four, so the second
 * key does not flip with the first.
 */
export function compareDuosWorst(a: DuoRecord, b: DuoRecord): number {
  return a.winRate - b.winRate || b.games - a.games || comparePairNames(a, b);
}

/** Both names, in order: two pairs that share a player are still two rows in a fixed order. */
function comparePairNames(a: DuoRecord, b: DuoRecord): number {
  return compareByName(a.players[0], b.players[0]) || compareByName(a.players[1], b.players[1]);
}

/* ---------------------------------------------------------------------------
 * 4. Average game length.
 * ------------------------------------------------------------------------- */

/**
 * The mean of `duration_s` over counted games, to the nearest minute — `null` when there are
 * none, so the page prints its empty line and never `0 min` and never `NaN`.
 */
export function averageGameMinutes(games: readonly StatsGame[]): number | null {
  if (games.length === 0) return null;
  const total = games.reduce((sum, game) => sum + game.durationS, 0);
  return Math.round(total / games.length / 60);
}

/* ---------------------------------------------------------------------------
 * 5. Streaks.
 * ------------------------------------------------------------------------- */

/**
 * Every player's runs through the window: the one they are on now, and the longest of each
 * kind.
 *
 * The order is {@link countedGames}' — `started_at`, then `lcu_game_id` — so two games that
 * share an instant produce the same answer whatever order they were inserted in, and the
 * current run is `currentStreak`'s, the **same helper the leaderboard row's `L2` uses**
 * (`lib/board/streak.ts`). Two definitions of a streak in one app is a bug.
 */
export function playerStreaks(games: readonly StatsGame[], players: readonly StatsPlayer[]): PlayerStreaks[] {
  const roster = byPlayerId(players);
  const results = new Map<string, boolean[]>();

  // `games` is oldest first; the run at the front of `currentStreak`'s list is the newest, so
  // each player's results are unshifted rather than pushed.
  for (const game of games) {
    for (const row of game.rows) {
      const played = results.get(row.playerId) ?? [];
      played.unshift(won(row, game));
      results.set(row.playerId, played);
    }
  }

  const streaks: PlayerStreaks[] = [];
  for (const [playerId, played] of results) {
    const player = roster.get(playerId);
    if (player === undefined) continue;
    streaks.push({
      ...refOf(player),
      current: currentStreak(played),
      longestWin: longestRun(played, true),
      longestLoss: longestRun(played, false),
    });
  }
  return streaks.sort(compareByName);
}

/** The longest run of one outcome anywhere in the list. Direction does not matter to a maximum. */
function longestRun(results: readonly boolean[], outcome: boolean): number {
  let longest = 0;
  let run = 0;
  for (const result of results) {
    run = result === outcome ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}

/**
 * The window's longest run of a kind and **everyone** who is on it: a record two people share
 * is two names, not the first one alphabetically.
 */
export function longestStreak(streaks: readonly PlayerStreaks[], kind: 'W' | 'L'): StreakHolders | null {
  const lengthOf = (streak: PlayerStreaks) => (kind === 'W' ? streak.longestWin : streak.longestLoss);
  const length = streaks.reduce((longest, streak) => Math.max(longest, lengthOf(streak)), 0);
  if (length === 0) return null;

  return {
    length,
    holders: streaks
      .filter((streak) => lengthOf(streak) === length)
      .map((streak) => ({ puuid: streak.puuid, name: streak.name })),
  };
}

/** Anyone on a streak of three or more right now, longest first, then by name. */
export function onAStreak(streaks: readonly PlayerStreaks[], minimum = ON_A_STREAK_GAMES): PlayerStreaks[] {
  return streaks
    .filter((streak) => (streak.current?.length ?? 0) >= minimum)
    .sort((a, b) => (b.current?.length ?? 0) - (a.current?.length ?? 0) || compareByName(a, b));
}
