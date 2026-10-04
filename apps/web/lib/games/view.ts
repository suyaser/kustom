import { LOST, WON } from '../board/copy';
import type { RecentAward } from '../board/types';
import { windowRangeLabel } from '../board/window';
import { championLabel } from '../champs/names';
import { formatDamage } from '../discord/embeds';
import { type FoldAwardPlayer, gatedGameAward } from '../ingest/fold';
import { inLaneOrder } from '../laneOrder';
import { formatDayMonth, type WindowKind, type WindowRange } from '../night';
import { csCountLine, kdaLine } from '../stats/funCopy';
import { killParticipationPercent } from '../stats/killParticipation';
import type { StatsGame, StatsPlayer, StatsRow } from '../stats/types';
import type { PlayerName } from '../tonight/types';
import { focusMetaLine, resultForWinner, scoreLine, teamHeading } from './copy';
import { withDisplayRoles } from './displayRoles';
import { formatMinutes } from './duration';
import { GAMES_QUEUE, matchesQueue, type QueueKind } from './queue';
import type { GamesHistoryView, HistoryGame, HistorySeat, HistoryTeam } from './types';

/**
 * `/games`, assembled from the same window `/stats` reads — **pure**, so the list and the
 * scoreboard are a unit test with a hand-built fixture and not a night of waiting.
 *
 * The universe here is **every captured game of this map in the window**, not `gateGame`. A
 * remake and a nine-player custom still happened; the player page already lists those under
 * Recent games, and a history page that hid them would disagree with it. `/stats` and `/fun`
 * keep the gate because their numbers are a fold, and they still mix the maps.
 *
 * The MVP / ACE word on a scoreboard (M7.23) is the one thing here that *is* gated — see
 * {@link seatAwards} — and a game outside the gate simply carries no word.
 */

export interface GamesHistoryInput {
  window: WindowKind;
  games: readonly StatsGame[];
  players: readonly StatsPlayer[];
  range: WindowRange;
  capped: boolean;
  cap: number;
  timeZone?: string | undefined;
  /** `?p=`. Absent is the group list. */
  focusPuuid?: string | null | undefined;
  /** `?queue=`. Absent is Summoner's Rift. */
  queue?: QueueKind | undefined;
}

export function gamesHistoryView(input: GamesHistoryInput): GamesHistoryView {
  const focusPuuid = input.focusPuuid ?? null;
  const queue = input.queue ?? GAMES_QUEUE;
  const roster = new Map(input.players.map((player) => [player.puuid, player]));
  const listed = newestFirst(input.games).filter((game) => {
    if (!matchesQueue(game.gameMode, queue)) return false;
    return focusPuuid === null ? true : game.rows.some((row) => row.puuid === focusPuuid);
  });
  const oldest = listed.length === 0 ? undefined : listed[listed.length - 1];
  const focusName = focusPuuid === null ? null : (roster.get(focusPuuid)?.name ?? null);

  return {
    window: input.window,
    queue,
    range:
      listed.length === 0
        ? null
        : windowRangeLabel(
            input.window,
            input.range,
            oldest === undefined ? null : new Date(oldest.startedAt),
            input.timeZone,
          ),
    games: listed.length,
    capped: input.capped,
    cap: input.cap,
    focusPuuid,
    focusName,
    items: listed.map((game) => historyGameOf(game, roster, focusPuuid, input.timeZone, { award: true })),
  };
}

export interface HistoryGameOptions {
  /**
   * Name the MVP and the ACE on the seats (M7.23). `/games` asks; `/fun`'s one-game records do
   * not, so every `/fun` seat carries `award: null` and its sheet renders exactly as before.
   */
  award?: boolean | undefined;
}

/** One custom as `/games` draws it. `/fun` attaches the same object to a one-game record. */
export function historyGameOf(
  game: StatsGame,
  roster: ReadonlyMap<string, StatsPlayer>,
  focusPuuid: string | null,
  timeZone: string | undefined,
  options: HistoryGameOptions = {},
): HistoryGame {
  const awards = options.award === true ? seatAwards(game, roster) : NO_AWARDS;
  const painted = { ...game, rows: withDisplayRoles(game) };
  const peakDamage = Math.max(0, ...painted.rows.map((row) => row.damageToChamps));
  const blue = teamOf(painted, 100, roster, peakDamage, awards);
  const red = teamOf(painted, 200, roster, peakDamage, awards);
  const focusRow = focusPuuid === null ? undefined : painted.rows.find((row) => row.puuid === focusPuuid);
  const focusSide = focusRow?.side;
  const focusSeat =
    focusSide === 100
      ? blue.seats.find((seat) => seat.puuid === focusPuuid)
      : focusSide === 200
        ? red.seats.find((seat) => seat.puuid === focusPuuid)
        : undefined;
  const teammates =
    focusSeat === undefined || focusSide === undefined ? [] : (focusSide === 100 ? blue : red).seats;

  return {
    id: game.id,
    startedAt: game.startedAt,
    startedLabel: formatDayMonth(new Date(game.startedAt), timeZone),
    durationLabel: formatMinutes(game.durationS),
    winningSide: game.winningSide,
    result:
      focusSeat === undefined
        ? resultForWinner(game.winningSide)
        : focusSide === game.winningSide
          ? WON
          : LOST,
    score: scoreLine(blue.kills, red.kills),
    ruleSide: focusSide ?? game.winningSide,
    blue,
    red,
    focus: focusSeat ?? null,
    focusMeta:
      focusSeat === undefined
        ? null
        : focusMetaLine(focusSeat.kills, focusSeat.deaths, focusSeat.assists, focusSeat.kp, focusSeat.cs),
    teammates,
  };
}

const NO_AWARDS: ReadonlyMap<string, RecentAward> = new Map();

/**
 * Who was named MVP and ACE in this game, by puuid (M7.23) — **`gatedGameAward`'s answer and
 * nothing else**, the function the Discord result post, `/p/[puuid]`'s recent games and the
 * tonight page all call. Nothing here scores, ranks or re-derives anything.
 *
 * This page's universe is every captured game, not `gateGame`, so it hands that function
 * remakes and nine-player customs routinely; the *gated* wrapper is what makes that safe — it
 * answers `null` for anything that is not a clean five a side, where the unguarded `gameAward`
 * would throw. The two questions it leaves to its callers are answered here exactly as
 * `recentAward` in `lib/board/load.ts` answers them:
 *
 * - **Did the fold rate it?** Every row carries `mu_after`, or there is no award. A remake, a
 *   short surrender, a backfilled game waiting for a rebuild and an ARAM (M7.1) all stop here.
 * - **Can we name all ten?** A row whose player `players_public` did not return has no puuid,
 *   only the id the loader fell back to, so the game has no award rather than a guessed one.
 *
 * The ten go in with their **stored** roles — `game.rows`, never `withDisplayRoles`' painted
 * ones — because a role the fold never saw must not produce an MVP the fold never named. A null
 * role or a null stat column anywhere is core's universal missing-input rule and comes back `null`.
 */
function seatAwards(
  game: StatsGame,
  roster: ReadonlyMap<string, StatsPlayer>,
): ReadonlyMap<string, RecentAward> {
  if (game.rows.some((row) => row.muAfter === null || !roster.has(row.puuid))) return NO_AWARDS;
  const award = gatedGameAward(game.rows.map(toAwardPlayer), game.durationS, game.winningSide);
  if (award === null) return NO_AWARDS;
  return new Map<string, RecentAward>([
    [award.mvp, 'mvp'],
    [award.ace, 'ace'],
  ]);
}

/** A rename, not a computation: the stored stat line under the fold's spellings. */
function toAwardPlayer(row: StatsRow): FoldAwardPlayer {
  return {
    puuid: row.puuid,
    side: row.side,
    role: row.role,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    damageToChamps: row.damageToChamps,
    gold: row.gold,
    cs: row.cs,
    visionScore: row.visionScore,
    damageSelfMitigated: row.damageSelfMitigated,
    damageToObjectives: row.damageToObjectives,
  };
}

function teamOf(
  game: StatsGame,
  side: 100 | 200,
  roster: ReadonlyMap<string, StatsPlayer>,
  peakDamage: number,
  awards: ReadonlyMap<string, RecentAward>,
): HistoryTeam {
  const rows = game.rows.filter((row) => row.side === side);
  const kills = rows.reduce((sum, row) => sum + row.kills, 0);
  const gold = rows.reduce((sum, row) => sum + row.gold, 0);
  const seats = inLaneOrder(
    rows.map((row) =>
      seatOf(
        row,
        roster.get(row.puuid)?.name ?? null,
        kills,
        peakDamage,
        game,
        awards.get(row.puuid) ?? null,
      ),
    ),
  );

  return {
    side,
    label: teamHeading(side, kills),
    kills,
    gold,
    goldLabel: formatDamage(gold),
    won: game.winningSide === side,
    seats,
  };
}

function seatOf(
  row: StatsRow,
  name: PlayerName,
  teamKills: number,
  peakDamage: number,
  game: StatsGame,
  award: RecentAward | null,
): HistorySeat {
  // M14.77: never over 100%, and null for a side whose rows do not add up.
  const kp = killParticipationPercent(row.kills, row.assists, teamKills);

  return {
    puuid: row.puuid,
    name,
    role: row.role,
    champion: championLabel(row.championId, game.rawFacts?.byPuuid[row.puuid]?.championName),
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    kda: kdaLine(row.kills, row.deaths, row.assists),
    kp,
    gold: row.gold,
    damageToChamps: row.damageToChamps,
    cs: row.cs,
    vision: row.visionScore,
    goldLabel: formatDamage(row.gold),
    damageLabel: formatDamage(row.damageToChamps),
    csLabel: csCountLine(row.cs),
    damageShare: peakDamage === 0 ? 0 : Math.round((row.damageToChamps / peakDamage) * 100),
    award,
  };
}

/**
 * Newest first, with the rebuild's `lcu_game_id` tie-break reversed so two games that share
 * an instant stay in one order on every surface that lists them.
 */
function newestFirst(games: readonly StatsGame[]): StatsGame[] {
  return [...games].sort((a, b) => {
    const started = Date.parse(b.startedAt) - Date.parse(a.startedAt);
    if (started !== 0) return started;
    return compareLcuId(b.lcuGameId, a.lcuGameId);
  });
}

function compareLcuId(left: StatsGame['lcuGameId'], right: StatsGame['lcuGameId']): number {
  if (left === null || right === null) return left === right ? 0 : left === null ? -1 : 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}
