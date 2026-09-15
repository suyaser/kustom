import { LOST, WON } from '../board/copy';
import { championName } from '../champs/names';
import type { HistoryGame } from '../games/types';
import { historyGameOf } from '../games/view';
import { LANE_ORDER } from '../laneOrder';
import { renderWebName } from '../tonight/copy';
import { MIN_DUO_GAMES, MIN_RECORD_GAMES, NO_DUOS, pairLabel } from './copy';
import { countedGames, duoRecords } from './fold';
import {
  BEST_DUO_INTRO,
  BEST_DUO_RULE,
  BEST_DUO_TITLE,
  CLEAN_KDA,
  CLEAN_KDA_RULE,
  champTimesLine,
  csCountLine,
  csValue,
  DEATHLESS_GAMES,
  DEATHLESS_GAMES_RULE,
  DEATHLESS_STREAK,
  DEATHLESS_STREAK_RULE,
  DOUBLE_EMPTY,
  DOUBLE_INTRO,
  DOUBLE_MANY,
  DOUBLE_ONE,
  DOUBLE_TITLE,
  damageLine,
  duoRecordLine,
  FEAR_BAN_EMPTY,
  FEAR_BAN_INTRO,
  FEAR_BAN_TITLE,
  FIRST_BLOOD_EMPTY,
  FIRST_BLOOD_INTRO,
  FIRST_BLOOD_TAKEN_EMPTY,
  FIRST_BLOOD_TAKEN_INTRO,
  FIRST_BLOOD_TAKEN_MANY,
  FIRST_BLOOD_TAKEN_ONE,
  FIRST_BLOOD_TAKEN_TITLE,
  FIRST_BLOOD_TITLE,
  FOUNTAIN,
  FOUNTAIN_RULE,
  fearBanLine,
  GHOST,
  GHOST_RULE,
  GLUE,
  GLUE_RULE,
  GREEDY_SUP,
  GREEDY_SUP_RULE,
  goldLine,
  kdaLine,
  kdaRatioLine,
  kpLine,
  LONGEST,
  LONGEST_RULE,
  LONGEST_SPREE,
  LONGEST_SPREE_RULE,
  LOST_JUNGLE,
  LOST_JUNGLE_RULE,
  LOST_PRETTY,
  LOST_PRETTY_RULE,
  LUCKY_TRASH,
  LUCKY_TRASH_RULE,
  MOST_ASSISTS,
  MOST_ASSISTS_RULE,
  MOST_BANNED_EMPTY,
  MOST_BANNED_INTRO,
  MOST_BANNED_TITLE,
  MOST_BARONS,
  MOST_BARONS_RULE,
  MOST_DAMAGE,
  MOST_DAMAGE_RULE,
  MOST_DEATHS,
  MOST_DEATHS_RULE,
  MOST_DEATHS_WINDOW,
  MOST_DEATHS_WINDOW_RULE,
  MOST_DRAGONS,
  MOST_DRAGONS_RULE,
  MOST_KILLS,
  MOST_KILLS_RULE,
  MOST_PICKED_EMPTY,
  MOST_PICKED_INTRO,
  MOST_PICKED_TITLE,
  MOST_STEALS,
  MOST_STEALS_RULE,
  MOST_STEALS_WINDOW,
  MOST_STEALS_WINDOW_RULE,
  matchDetail,
  minutesLine,
  NEMESIS_INTRO,
  NEMESIS_RULE,
  NEMESIS_TITLE,
  NEVER_MISSES,
  NEVER_MISSES_RULE,
  NO_NEMESIS,
  NOBODY_THIS,
  nemesisLine,
  OTP_INTRO,
  OTP_RULE,
  OTP_TITLE,
  ofGamesLine,
  otpLine,
  PAPER,
  PAPER_RULE,
  PENTA_EMPTY,
  PENTA_INTRO,
  PENTA_MANY,
  PENTA_ONE,
  PENTA_TITLE,
  POOL_EMPTY,
  QUADRA_EMPTY,
  QUADRA_INTRO,
  QUADRA_MANY,
  QUADRA_ONE,
  QUADRA_TITLE,
  RICH_WRONG,
  RICH_WRONG_RULE,
  ROBBED,
  ROBBED_RULE,
  SHORTEST,
  SHORTEST_LIFE,
  SHORTEST_LIFE_RULE,
  SHORTEST_RULE,
  spreeLine,
  TRIPLE_EMPTY,
  TRIPLE_INTRO,
  TRIPLE_MANY,
  TRIPLE_ONE,
  TRIPLE_TITLE,
  TURRET_EMPTY,
  TURRET_INTRO,
  TURRET_MANY,
  TURRET_ONE,
  TURRET_TITLE,
  timesLine,
  VARIETY_INTRO,
  VARIETY_RULE,
  VARIETY_TITLE,
  varietyLine,
  WON_UGLY,
  WON_UGLY_RULE,
  ZERO_X,
  ZERO_X_RULE,
} from './funCopy';
import { playerFacts, type RawPlayerFacts, stealLine } from './rawFacts';
import type {
  FunBloodGroup,
  FunBloodRow,
  FunChampRow,
  FunDuoRow,
  FunFactsView,
  FunFearBan,
  FunHolder,
  FunOpening,
  FunPool,
  FunPoolRow,
  FunRecord,
  FunRivalRow,
  FunRivalsView,
  FunSection,
  PlayerRef,
  RoleCsPair,
  StatsGame,
  StatsPlayer,
  StatsRow,
} from './types';

/**
 * `/fun` (M5.24): single-game records from the scoreboard columns `/stats` does not fold.
 *
 * Pure. The universe is `countedGames` — the same `gateGame` `/stats` uses — so a remake that
 * is not a game on the board is not a record here either.
 *
 * First blood, steals and draft bans come from {@link StatsGame.rawFacts}, parsed out of
 * `games.raw`. The killer is stored; the victim and the in-game first-death clock are not.
 */

const LONG_GAME_S = 25 * 60;
const FOUNTAIN_GAME_S = 20 * 60;
const CLEAN_TAKEDOWNS = 8;
const ZERO_X_DEATHS = 8;
const PRETTY_TAKEDOWNS = 6;
const GHOST_TEAM_KILLS = 8;
const GLUE_TEAM_KILLS = 5;
const FOUNTAIN_CS = 30;
const FOUNTAIN_TAKEDOWNS = 4;
const FEAR_BAN_LIMIT = 5;
const CHAMP_TABLE_LIMIT = 10;
const POOL_TABLE_LIMIT = 10;
const FATE_TABLE_LIMIT = 10;
const DEATHLESS_STREAK_MIN = 2;
const SPREE_MIN = 3;

interface Play {
  game: StatsGame;
  row: StatsRow;
  player: StatsPlayer;
}

function minutes(game: StatsGame): number {
  return Math.max(1, game.durationS / 60);
}

function kda(row: StatsRow): number {
  return (row.kills + row.assists) / Math.max(1, row.deaths);
}

function takedowns(row: StatsRow): number {
  return row.kills + row.assists;
}

function teamKills(game: StatsGame, side: StatsRow['side']): number {
  return game.rows.filter((row) => row.side === side).reduce((sum, row) => sum + row.kills, 0);
}

function kp(row: StatsRow, game: StatsGame): number {
  return takedowns(row) / Math.max(1, teamKills(game, row.side));
}

function won(row: StatsRow, game: StatsGame): boolean {
  return row.side === game.winningSide;
}

function playsOf(games: readonly StatsGame[], players: readonly StatsPlayer[]): Play[] {
  const roster = new Map(players.map((player) => [player.playerId, player]));
  const out: Play[] = [];
  for (const game of games) {
    for (const row of game.rows) {
      const player = roster.get(row.playerId);
      if (player === undefined) continue;
      out.push({ game, row, player });
    }
  }
  return out;
}

function ref(player: StatsPlayer): PlayerRef {
  return { puuid: player.puuid, name: player.name };
}

type BindGame = (game: StatsGame) => HistoryGame;

function openingOf(game: StatsGame, bind: BindGame, label: string | null = null): FunOpening {
  return { label, detail: matchDetail(game.startedAt, game.durationS), game: bind(game) };
}

function holder(
  player: StatsPlayer,
  valueLabel: string,
  game: StatsGame | null = null,
  bind: BindGame | null = null,
  openings: readonly FunOpening[] = [],
): FunHolder {
  const listed =
    openings.length > 0 ? [...openings] : game === null || bind === null ? [] : [openingOf(game, bind)];
  return {
    ...ref(player),
    valueLabel,
    detail: listed[0]?.detail ?? (game === null ? null : matchDetail(game.startedAt, game.durationS)),
    game: listed[0]?.game ?? null,
    openings: listed,
  };
}

function pickMax(plays: readonly Play[], score: (play: Play) => number): Play | null {
  let best: Play | null = null;
  let bestScore = -Infinity;
  for (const play of plays) {
    const value = score(play);
    if (value > bestScore) {
      best = play;
      bestScore = value;
    }
  }
  return best;
}

function pickMin(plays: readonly Play[], score: (play: Play) => number): Play | null {
  let best: Play | null = null;
  let bestScore = Infinity;
  for (const play of plays) {
    const value = score(play);
    if (value < bestScore) {
      best = play;
      bestScore = value;
    }
  }
  return best;
}

function record(
  id: string,
  title: string,
  rule: string,
  play: Play | null,
  valueLabel: (play: Play) => string,
  bind: BindGame,
): FunRecord {
  return {
    id,
    title,
    rule,
    holders: play === null ? [] : [holder(play.player, valueLabel(play), play.game, bind)],
    empty: NOBODY_THIS,
  };
}

function csByRole(plays: readonly Play[], bind: BindGame): RoleCsPair[] {
  return LANE_ORDER.map((role) => {
    const atRole = plays.filter((play) => play.row.role === role);
    const highest = pickMax(atRole, (play) => play.row.cs);
    const lowest = pickMin(atRole, (play) => play.row.cs);
    const label = (play: Play) => csValue(play.row.cs, play.row.cs / minutes(play.game));
    return {
      role,
      highest: highest === null ? null : holder(highest.player, label(highest), highest.game, bind),
      lowest: lowest === null ? null : holder(lowest.player, label(lowest), lowest.game, bind),
    };
  });
}

interface ChampPool {
  player: StatsPlayer;
  games: number;
  champs: Map<number, number>;
  mainId: number;
  mainCount: number;
  rate: number;
  unique: number;
}

function champPoolsOf(plays: readonly Play[]): ChampPool[] {
  const byPlayer = new Map<string, { player: StatsPlayer; games: number; champs: Map<number, number> }>();
  for (const play of plays) {
    if (play.row.championId === null || play.row.championId <= 0) continue;
    const row = byPlayer.get(play.player.playerId) ?? {
      player: play.player,
      games: 0,
      champs: new Map<number, number>(),
    };
    row.games += 1;
    row.champs.set(play.row.championId, (row.champs.get(play.row.championId) ?? 0) + 1);
    byPlayer.set(play.player.playerId, row);
  }

  return [...byPlayer.values()]
    .filter((row) => row.games >= MIN_RECORD_GAMES)
    .map((row) => {
      const [mainId, mainCount] = [...row.champs.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [
        0, 0,
      ];
      return {
        ...row,
        mainId,
        mainCount,
        rate: mainCount / row.games,
        unique: row.champs.size,
      };
    });
}

function poolRow(pool: ChampPool, valueLabel: string): FunPoolRow {
  return {
    ...ref(pool.player),
    valueLabel,
    champs: [...pool.champs.entries()]
      .sort((a, b) => b[1] - a[1] || championName(a[0]).localeCompare(championName(b[0])))
      .map(([championId, count]) => ({
        championId,
        champion: championName(championId),
        count,
        valueLabel: champTimesLine(count),
      })),
  };
}

function byName(left: ChampPool, right: ChampPool): number {
  return renderWebName(left.player.name).localeCompare(renderWebName(right.player.name));
}

function championPools(plays: readonly Play[]): FunPool[] {
  const pools = champPoolsOf(plays);
  const otp = [...pools]
    .sort((a, b) => b.rate - a.rate || b.games - a.games || byName(a, b))
    .slice(0, POOL_TABLE_LIMIT);
  const variety = [...pools]
    .sort(
      (a, b) =>
        b.unique - a.unique || b.unique / b.games - a.unique / a.games || b.games - a.games || byName(a, b),
    )
    .slice(0, POOL_TABLE_LIMIT);

  return [
    {
      id: 'otp',
      title: OTP_TITLE,
      intro: OTP_INTRO,
      rule: OTP_RULE,
      rows: otp.map((row) => poolRow(row, otpLine(championName(row.mainId), row.mainCount, row.games))),
      empty: POOL_EMPTY,
    },
    {
      id: 'variety',
      title: VARIETY_TITLE,
      intro: VARIETY_INTRO,
      rule: VARIETY_RULE,
      rows: variety.map((row) => poolRow(row, varietyLine(row.unique, row.games))),
      empty: POOL_EMPTY,
    },
  ];
}

function attendanceRecord(plays: readonly Play[]): FunRecord {
  const counts = new Map<string, { player: StatsPlayer; games: number }>();
  for (const play of plays) {
    const row = counts.get(play.player.playerId) ?? { player: play.player, games: 0 };
    row.games += 1;
    counts.set(play.player.playerId, row);
  }
  const top = [...counts.values()].sort(
    (a, b) => b.games - a.games || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
  )[0];
  if (top === undefined) {
    return {
      id: 'attendance',
      title: NEVER_MISSES,
      rule: NEVER_MISSES_RULE,
      holders: [],
      empty: NOBODY_THIS,
    };
  }
  return {
    id: 'attendance',
    title: NEVER_MISSES,
    rule: NEVER_MISSES_RULE,
    holders: [holder(top.player, gamesCountLineFrom(top.games))],
    empty: NOBODY_THIS,
  };
}

function gamesCountLineFrom(games: number): string {
  return games === 1 ? '1 custom' : `${games} customs`;
}

function pickFirst(plays: readonly Play[], compare: (left: Play, right: Play) => number): Play | null {
  let best: Play | null = null;
  for (const play of plays) {
    if (best === null || compare(play, best) < 0) best = play;
  }
  return best;
}

function byPlayerName(left: Play, right: Play): number {
  return renderWebName(left.player.name).localeCompare(renderWebName(right.player.name));
}

/** Lower KDA, then more deaths, then fewer takedowns, then name. */
function worseKda(left: Play, right: Play): number {
  const kd = kda(left.row) - kda(right.row);
  if (kd !== 0) return kd;
  if (left.row.deaths !== right.row.deaths) return right.row.deaths - left.row.deaths;
  const takes = takedowns(left.row) - takedowns(right.row);
  if (takes !== 0) return takes;
  return byPlayerName(left, right);
}

/** Higher KDA, then fewer deaths, then more takedowns, then name. */
function betterKda(left: Play, right: Play): number {
  return worseKda(right, left) || byPlayerName(left, right);
}

function rankFate(picks: readonly Play[], bind: BindGame): FunHolder[] {
  const groups = new Map<string, { player: StatsPlayer; plays: Play[] }>();
  for (const play of picks) {
    const slot = groups.get(play.player.playerId) ?? { player: play.player, plays: [] };
    slot.plays.push(play);
    groups.set(play.player.playerId, slot);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.plays.length - a.plays.length ||
        renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
    )
    .slice(0, FATE_TABLE_LIMIT)
    .map((row) =>
      holder(
        row.player,
        timesLine(row.plays.length),
        null,
        bind,
        row.plays.map((play) =>
          openingOf(
            play.game,
            bind,
            `${kdaLine(play.row.kills, play.row.deaths, play.row.assists)} · ${champOf(play)}`,
          ),
        ),
      ),
    );
}

function fatesOf(counted: readonly StatsGame[], plays: readonly Play[], bind: BindGame): FunRecord[] {
  const byGame = new Map<string, Play[]>();
  for (const play of plays) {
    const list = byGame.get(play.game.id) ?? [];
    list.push(play);
    byGame.set(play.game.id, list);
  }

  const lucky: Play[] = [];
  const robbed: Play[] = [];
  for (const game of [...counted].reverse()) {
    const seats = byGame.get(game.id) ?? [];
    const trash = pickFirst(
      seats.filter((play) => won(play.row, game)),
      worseKda,
    );
    const hardLuck = pickFirst(
      seats.filter((play) => !won(play.row, game)),
      betterKda,
    );
    if (trash !== null) lucky.push(trash);
    if (hardLuck !== null) robbed.push(hardLuck);
  }

  return [
    {
      id: 'lucky-trash',
      title: LUCKY_TRASH,
      rule: LUCKY_TRASH_RULE,
      holders: rankFate(lucky, bind),
      empty: NOBODY_THIS,
    },
    {
      id: 'robbed',
      title: ROBBED,
      rule: ROBBED_RULE,
      holders: rankFate(robbed, bind),
      empty: NOBODY_THIS,
    },
  ];
}

/**
 * The page's answer, over counted games only.
 *
 * `games` is already the window's list; this applies the gate once and reads that list.
 */
export function funFactsView(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  timeZone?: string,
): Omit<FunFactsView, 'window' | 'queue' | 'range' | 'capped' | 'cap'> {
  const counted = countedGames(games);
  const plays = playsOf(counted, players);
  const long = plays.filter((play) => play.game.durationS >= LONG_GAME_S);
  const rosterByPuuid = new Map(players.map((player) => [player.puuid, player]));
  const bind: BindGame = (game) => historyGameOf(game, rosterByPuuid, null, timeZone);
  const rec = (
    id: string,
    title: string,
    rule: string,
    play: Play | null,
    valueLabel: (play: Play) => string,
  ) => record(id, title, rule, play, valueLabel, bind);

  const records: FunRecord[] = [
    rec(
      'kills',
      MOST_KILLS,
      MOST_KILLS_RULE,
      pickMax(plays, (play) => play.row.kills),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    rec(
      'assists',
      MOST_ASSISTS,
      MOST_ASSISTS_RULE,
      pickMax(plays, (play) => play.row.assists),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    rec(
      'spree',
      LONGEST_SPREE,
      LONGEST_SPREE_RULE,
      pickMax(
        plays.filter((play) => (extrasOf(play)?.largestKillingSpree ?? 0) >= SPREE_MIN),
        (play) => extrasOf(play)?.largestKillingSpree ?? 0,
      ),
      (play) => spreeLine(extrasOf(play)?.largestKillingSpree ?? 0),
    ),
    rec(
      'clean',
      CLEAN_KDA,
      CLEAN_KDA_RULE,
      pickMax(
        plays.filter((play) => takedowns(play.row) >= CLEAN_TAKEDOWNS),
        (play) => kda(play.row),
      ),
      (play) => kdaRatioLine(kda(play.row), play.row.kills, play.row.deaths, play.row.assists),
    ),
    rec(
      'zero-x',
      ZERO_X,
      ZERO_X_RULE,
      pickMax(
        plays.filter((play) => play.row.kills === 0 && play.row.deaths >= ZERO_X_DEATHS),
        (play) => play.row.deaths,
      ),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    rec(
      'damage',
      MOST_DAMAGE,
      MOST_DAMAGE_RULE,
      pickMax(plays, (play) => play.row.damageToChamps),
      (play) => damageLine(play.row.damageToChamps),
    ),
    rec(
      'paper',
      PAPER,
      PAPER_RULE,
      pickMin(
        long.filter((play) => play.row.role !== 'support'),
        (play) => play.row.damageToChamps,
      ),
      (play) => damageLine(play.row.damageToChamps),
    ),
    rec(
      'won-ugly',
      WON_UGLY,
      WON_UGLY_RULE,
      pickMin(
        plays.filter((play) => won(play.row, play.game)),
        (play) => kda(play.row),
      ),
      (play) => `${kdaLine(play.row.kills, play.row.deaths, play.row.assists)} · still a win`,
    ),
    rec(
      'lost-pretty',
      LOST_PRETTY,
      LOST_PRETTY_RULE,
      pickMax(
        plays.filter((play) => !won(play.row, play.game) && takedowns(play.row) >= PRETTY_TAKEDOWNS),
        (play) => kda(play.row),
      ),
      (play) => `${kdaLine(play.row.kills, play.row.deaths, play.row.assists)} · still a loss`,
    ),
    rec(
      'rich-wrong',
      RICH_WRONG,
      RICH_WRONG_RULE,
      pickMax(
        plays.filter((play) => !won(play.row, play.game)),
        (play) => play.row.gold,
      ),
      (play) => goldLine(play.row.gold),
    ),
    rec(
      'lost-jungle',
      LOST_JUNGLE,
      LOST_JUNGLE_RULE,
      pickMin(
        long.filter((play) => play.row.role === 'jungle'),
        (play) => play.row.cs,
      ),
      (play) => csCountLine(play.row.cs),
    ),
    rec(
      'greedy-sup',
      GREEDY_SUP,
      GREEDY_SUP_RULE,
      pickMax(
        plays.filter((play) => play.row.role === 'support'),
        (play) => play.row.cs,
      ),
      (play) => csCountLine(play.row.cs),
    ),
    rec(
      'fountain',
      FOUNTAIN,
      FOUNTAIN_RULE,
      pickMin(
        plays.filter(
          (play) =>
            play.game.durationS >= FOUNTAIN_GAME_S &&
            play.row.cs < FOUNTAIN_CS &&
            takedowns(play.row) < FOUNTAIN_TAKEDOWNS,
        ),
        (play) => play.row.cs,
      ),
      (play) => `${play.row.cs} CS · ${kdaLine(play.row.kills, play.row.deaths, play.row.assists)}`,
    ),
    rec(
      'ghost',
      GHOST,
      GHOST_RULE,
      pickMin(
        plays.filter((play) => teamKills(play.game, play.row.side) >= GHOST_TEAM_KILLS),
        (play) => kp(play.row, play.game),
      ),
      (play) => kpLine(Math.round(kp(play.row, play.game) * 100)),
    ),
    rec(
      'glue',
      GLUE,
      GLUE_RULE,
      pickMax(
        plays.filter((play) => teamKills(play.game, play.row.side) >= GLUE_TEAM_KILLS),
        (play) => kp(play.row, play.game),
      ),
      (play) => kpLine(Math.round(kp(play.row, play.game) * 100)),
    ),
  ];

  const longest = [...counted].sort((a, b) => b.durationS - a.durationS)[0];
  const longestMvp =
    longest === undefined
      ? null
      : pickMax(
          plays.filter((play) => play.game.id === longest.id),
          (play) => takedowns(play.row),
        );
  records.push({
    id: 'longest',
    title: LONGEST,
    rule: LONGEST_RULE,
    holders:
      longest === undefined || longestMvp === null
        ? []
        : [holder(longestMvp.player, minutesLine(longest.durationS), longest, bind)],
    empty: NOBODY_THIS,
  });

  const shortest = [...counted].sort((a, b) => a.durationS - b.durationS)[0];
  const shortestSeat =
    shortest === undefined ? null : (plays.find((play) => play.game.id === shortest.id) ?? null);
  records.push({
    id: 'shortest',
    title: SHORTEST,
    rule: SHORTEST_RULE,
    holders:
      shortest === undefined || shortestSeat === null
        ? []
        : [holder(shortestSeat.player, minutesLine(shortest.durationS), shortest, bind)],
    empty: NOBODY_THIS,
  });

  records.push(attendanceRecord(plays));

  return {
    games: counted.length,
    players: new Set(plays.map((play) => play.player.playerId)).size,
    tables: [],
    museum: firstBloodMuseum(counted, plays, bind, {
      title: FIRST_BLOOD_TITLE,
      intro: FIRST_BLOOD_INTRO,
      empty: FIRST_BLOOD_EMPTY,
      pick: (play) => extrasOf(play)?.firstBloodKill === true,
      foe: (play) => extrasOf(play)?.firstBloodDeath === true,
      foeVerb: 'over',
      one: '1 first blood',
      many: 'first bloods',
    }),
    donated: firstBloodMuseum(counted, plays, bind, {
      title: FIRST_BLOOD_TAKEN_TITLE,
      intro: FIRST_BLOOD_TAKEN_INTRO,
      empty: FIRST_BLOOD_TAKEN_EMPTY,
      pick: (play) => extrasOf(play)?.firstBloodDeath === true,
      foe: (play) => extrasOf(play)?.firstBloodKill === true,
      foeVerb: 'to',
      one: FIRST_BLOOD_TAKEN_ONE,
      many: FIRST_BLOOD_TAKEN_MANY,
    }),
    halls: [
      countMuseum(counted, plays, bind, {
        title: PENTA_TITLE,
        intro: PENTA_INTRO,
        empty: PENTA_EMPTY,
        amount: (play) => extrasOf(play)?.pentaKills ?? 0,
        one: PENTA_ONE,
        many: PENTA_MANY,
      }),
      countMuseum(counted, plays, bind, {
        title: QUADRA_TITLE,
        intro: QUADRA_INTRO,
        empty: QUADRA_EMPTY,
        amount: (play) => extrasOf(play)?.quadraKills ?? 0,
        one: QUADRA_ONE,
        many: QUADRA_MANY,
      }),
      countMuseum(counted, plays, bind, {
        title: TRIPLE_TITLE,
        intro: TRIPLE_INTRO,
        empty: TRIPLE_EMPTY,
        amount: (play) => extrasOf(play)?.tripleKills ?? 0,
        one: TRIPLE_ONE,
        many: TRIPLE_MANY,
      }),
      countMuseum(counted, plays, bind, {
        title: DOUBLE_TITLE,
        intro: DOUBLE_INTRO,
        empty: DOUBLE_EMPTY,
        amount: (play) => extrasOf(play)?.doubleKills ?? 0,
        one: DOUBLE_ONE,
        many: DOUBLE_MANY,
      }),
      firstBloodMuseum(counted, plays, bind, {
        title: TURRET_TITLE,
        intro: TURRET_INTRO,
        empty: TURRET_EMPTY,
        pick: (play) => extrasOf(play)?.firstTowerKill === true,
        foe: () => false,
        foeVerb: 'over',
        one: TURRET_ONE,
        many: TURRET_MANY,
      }),
    ],
    deathHall: deathHall(counted, plays, bind),
    thieves: objectiveThieves(plays, bind),
    fearBans: fearBans(plays),
    mostBanned: mostBanned(plays),
    mostPicked: mostPicked(plays),
    pools: championPools(plays),
    fates: fatesOf(counted, plays, bind),
    csByRole: csByRole(plays, bind),
    records,
    rivals: rivalsView(counted, players, plays, bind),
    notes: [],
  };
}

function extrasOf(play: Play): RawPlayerFacts | null {
  return play.game.rawFacts?.byPuuid[play.row.puuid] ?? null;
}

function stealLabel(play: Play): string {
  return stealLine(extrasOf(play) ?? playerFacts());
}

function champOf(play: Play): string {
  const extras = extrasOf(play);
  return championName(play.row.championId, extras?.championName ?? null);
}

function firstBloodMuseum(
  counted: readonly StatsGame[],
  plays: readonly Play[],
  bind: BindGame,
  spec: {
    title: string;
    intro: string;
    empty: string;
    pick: (play: Play) => boolean;
    foe: (play: Play) => boolean;
    foeVerb: FunBloodRow['foeVerb'];
    one: string;
    many: string;
  },
): FunSection<FunBloodGroup> {
  const byGame = new Map<string, Play[]>();
  for (const play of plays) {
    const list = byGame.get(play.game.id) ?? [];
    list.push(play);
    byGame.set(play.game.id, list);
  }

  const groups = new Map<string, FunBloodGroup>();
  for (const game of [...counted].reverse()) {
    const seats = byGame.get(game.id) ?? [];
    const seat = seats.find(spec.pick);
    if (seat === undefined) continue;
    const foe = seats.find(spec.foe);
    const opening: FunBloodRow = {
      gameId: game.id,
      taker: ref(seat.player),
      champion: champOf(seat),
      victim: foe === undefined ? null : ref(foe.player),
      foeVerb: spec.foeVerb,
      opponent: foe === undefined ? null : champOf(foe),
      haul: null,
      when: matchDetail(game.startedAt, game.durationS),
      game: bind(game),
    };
    const existing = groups.get(seat.player.playerId);
    if (existing === undefined) {
      groups.set(seat.player.playerId, {
        taker: opening.taker,
        count: 1,
        countLabel: spec.one,
        openings: [opening],
      });
      continue;
    }
    existing.openings.push(opening);
    existing.count += 1;
    existing.countLabel = `${existing.count} ${spec.many}`;
  }

  const rows = [...groups.values()].sort(
    (a, b) => b.count - a.count || renderWebName(a.taker.name).localeCompare(renderWebName(b.taker.name)),
  );

  return {
    title: spec.title,
    intro: spec.intro,
    rows,
    empty: spec.empty,
  };
}

/**
 * One row per person, count is the sum of a stored field. Several people can
 * hit in the same custom; one person can hit twice in one custom.
 */
function countMuseum(
  counted: readonly StatsGame[],
  plays: readonly Play[],
  bind: BindGame,
  spec: {
    title: string;
    intro: string;
    empty: string;
    amount: (play: Play) => number;
    one: string;
    many: string;
  },
): FunSection<FunBloodGroup> {
  const byGame = new Map<string, Play[]>();
  for (const play of plays) {
    const list = byGame.get(play.game.id) ?? [];
    list.push(play);
    byGame.set(play.game.id, list);
  }

  const groups = new Map<string, FunBloodGroup>();
  for (const game of [...counted].reverse()) {
    for (const play of byGame.get(game.id) ?? []) {
      const n = spec.amount(play);
      if (n <= 0) continue;
      const opening: FunBloodRow = {
        gameId: game.id,
        taker: ref(play.player),
        champion: champOf(play),
        victim: null,
        foeVerb: 'over',
        opponent: null,
        haul: n === 1 ? null : `${n} ${spec.many}`,
        when: matchDetail(game.startedAt, game.durationS),
        game: bind(game),
      };
      const existing = groups.get(play.player.playerId);
      if (existing === undefined) {
        groups.set(play.player.playerId, {
          taker: opening.taker,
          count: n,
          countLabel: n === 1 ? spec.one : `${n} ${spec.many}`,
          openings: [opening],
        });
        continue;
      }
      existing.openings.push(opening);
      existing.count += n;
      existing.countLabel = existing.count === 1 ? spec.one : `${existing.count} ${spec.many}`;
    }
  }

  const rows = [...groups.values()].sort(
    (a, b) => b.count - a.count || renderWebName(a.taker.name).localeCompare(renderWebName(b.taker.name)),
  );

  return {
    title: spec.title,
    intro: spec.intro,
    rows,
    empty: spec.empty,
  };
}

function deathHall(counted: readonly StatsGame[], plays: readonly Play[], bind: BindGame): FunRecord[] {
  const shortest = pickMin(
    plays.filter((play) => play.row.deaths >= 1 && extrasOf(play)?.longestLivedS != null),
    (play) => extrasOf(play)?.longestLivedS ?? Number.POSITIVE_INFINITY,
  );

  const playsByGame = new Map<string, Play[]>();
  for (const play of plays) {
    const list = playsByGame.get(play.game.id) ?? [];
    list.push(play);
    playsByGame.set(play.game.id, list);
  }

  const totals = new Map<
    string,
    {
      player: StatsPlayer;
      deaths: number;
      deathless: number;
      current: number;
      best: number;
      clean: Play[];
    }
  >();
  for (const game of counted) {
    for (const play of playsByGame.get(game.id) ?? []) {
      const slot = totals.get(play.player.playerId) ?? {
        player: play.player,
        deaths: 0,
        deathless: 0,
        current: 0,
        best: 0,
        clean: [],
      };
      slot.deaths += play.row.deaths;
      if (play.row.deaths === 0) {
        slot.deathless += 1;
        slot.current += 1;
        slot.best = Math.max(slot.best, slot.current);
        slot.clean.push(play);
      } else {
        slot.current = 0;
      }
      totals.set(play.player.playerId, slot);
    }
  }

  const mostDead = [...totals.values()].sort(
    (a, b) => b.deaths - a.deaths || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
  )[0];
  const longestClean = [...totals.values()]
    .filter((row) => row.best >= DEATHLESS_STREAK_MIN)
    .sort(
      (a, b) => b.best - a.best || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
    )[0];
  const mostClean = [...totals.values()]
    .filter((row) => row.deathless >= 1)
    .sort(
      (a, b) =>
        b.deathless - a.deathless || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
    )[0];

  return [
    record(
      'deaths',
      MOST_DEATHS,
      MOST_DEATHS_RULE,
      pickMax(plays, (play) => play.row.deaths),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
      bind,
    ),
    {
      id: 'deaths-window',
      title: MOST_DEATHS_WINDOW,
      rule: MOST_DEATHS_WINDOW_RULE,
      holders:
        mostDead === undefined || mostDead.deaths === 0
          ? []
          : [holder(mostDead.player, `${mostDead.deaths} deaths`)],
      empty: NOBODY_THIS,
    },
    record(
      'shortest-life',
      SHORTEST_LIFE,
      SHORTEST_LIFE_RULE,
      shortest,
      (play) => minutesLine(extrasOf(play)?.longestLivedS ?? 0),
      bind,
    ),
    {
      id: 'deathless-streak',
      title: DEATHLESS_STREAK,
      rule: DEATHLESS_STREAK_RULE,
      holders: longestClean === undefined ? [] : [holder(longestClean.player, `${longestClean.best} games`)],
      empty: NOBODY_THIS,
    },
    {
      id: 'deathless-games',
      title: DEATHLESS_GAMES,
      rule: DEATHLESS_GAMES_RULE,
      holders:
        mostClean === undefined
          ? []
          : [
              holder(
                mostClean.player,
                gamesCountLineFrom(mostClean.deathless),
                null,
                bind,
                mostClean.clean.map((play) => openingOf(play.game, bind, champOf(play))),
              ),
            ],
      empty: NOBODY_THIS,
    },
  ];
}

function objectiveThieves(plays: readonly Play[], bind: BindGame): FunRecord[] {
  const stolen = (play: Play) => extrasOf(play)?.objectivesStolen ?? 0;
  const dragons = (play: Play) => extrasOf(play)?.dragonKills ?? 0;
  const barons = (play: Play) => extrasOf(play)?.baronKills ?? 0;

  const totals = new Map<string, { player: StatsPlayer; stolen: number; heists: Play[] }>();
  for (const play of plays) {
    const take = stolen(play);
    const row = totals.get(play.player.playerId) ?? { player: play.player, stolen: 0, heists: [] };
    row.stolen += take;
    if (take > 0) row.heists.push(play);
    totals.set(play.player.playerId, row);
  }
  const career = [...totals.values()].sort(
    (a, b) => b.stolen - a.stolen || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
  )[0];

  const blocks: FunRecord[] = [
    record(
      'steals',
      MOST_STEALS,
      MOST_STEALS_RULE,
      pickMax(
        plays.filter((play) => stolen(play) > 0),
        stolen,
      ),
      stealLabel,
      bind,
    ),
    {
      id: 'steals-window',
      title: MOST_STEALS_WINDOW,
      rule: MOST_STEALS_WINDOW_RULE,
      holders:
        career === undefined || career.stolen === 0
          ? []
          : [
              holder(
                career.player,
                career.stolen === 1 && career.heists[0] !== undefined
                  ? stealLabel(career.heists[0])
                  : `${career.stolen} steals`,
                null,
                bind,
                career.heists.map((play) => openingOf(play.game, bind, stealLabel(play))),
              ),
            ],
      empty: NOBODY_THIS,
    },
    record(
      'dragons',
      MOST_DRAGONS,
      MOST_DRAGONS_RULE,
      pickMax(
        plays.filter((play) => dragons(play) > 0),
        dragons,
      ),
      (play) => (dragons(play) === 1 ? '1 dragon' : `${dragons(play)} dragons`),
      bind,
    ),
    record(
      'barons',
      MOST_BARONS,
      MOST_BARONS_RULE,
      pickMax(
        plays.filter((play) => barons(play) > 0),
        barons,
      ),
      (play) => (barons(play) === 1 ? '1 baron' : `${barons(play)} barons`),
      bind,
    ),
  ];
  return blocks.filter((block) => block.holders.length > 0);
}

function fearBans(plays: readonly Play[]): FunSection<FunFearBan> {
  const byPlayer = new Map<
    string,
    { player: StatsPlayer; games: number; champs: Map<number, number>; banned: Map<number, number> }
  >();

  for (const play of plays) {
    const row = byPlayer.get(play.player.playerId) ?? {
      player: play.player,
      games: 0,
      champs: new Map<number, number>(),
      banned: new Map<number, number>(),
    };
    row.games += 1;
    if (play.row.championId !== null) {
      row.champs.set(play.row.championId, (row.champs.get(play.row.championId) ?? 0) + 1);
    }
    const enemyBans = new Set(
      (play.game.rawFacts?.bans ?? [])
        .filter((ban) => ban.teamId !== play.row.side)
        .map((ban) => ban.championId),
    );
    for (const championId of enemyBans) {
      row.banned.set(championId, (row.banned.get(championId) ?? 0) + 1);
    }
    byPlayer.set(play.player.playerId, row);
  }

  const rows: FunFearBan[] = [...byPlayer.values()]
    .filter((row) => row.games >= MIN_RECORD_GAMES)
    .map((row) => {
      const [championId] = [...row.champs.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
      const banned = row.banned.get(championId) ?? 0;
      const rate = Math.round((banned / row.games) * 100);
      const champion = championName(championId);
      return {
        player: ref(row.player),
        champion,
        banned,
        available: row.games,
        rate,
        line: fearBanLine(renderWebName(row.player.name), champion, rate, banned, row.games),
      };
    })
    .filter((row) => row.banned > 0)
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        b.banned - a.banned ||
        renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
    )
    .slice(0, FEAR_BAN_LIMIT);

  return {
    title: FEAR_BAN_TITLE,
    intro: FEAR_BAN_INTRO,
    rows,
    empty: FEAR_BAN_EMPTY,
  };
}

function mostBanned(plays: readonly Play[]): FunSection<FunChampRow> {
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  for (const play of plays) {
    if (seen.has(play.game.id)) continue;
    seen.add(play.game.id);
    for (const ban of play.game.rawFacts?.bans ?? []) {
      counts.set(ban.championId, (counts.get(ban.championId) ?? 0) + 1);
    }
  }
  return {
    title: MOST_BANNED_TITLE,
    intro: MOST_BANNED_INTRO,
    rows: rankChamps(counts, 'ban', 'bans'),
    empty: MOST_BANNED_EMPTY,
  };
}

function mostPicked(plays: readonly Play[]): FunSection<FunChampRow> {
  const counts = new Map<number, number>();
  for (const play of plays) {
    if (play.row.championId === null || play.row.championId <= 0) continue;
    counts.set(play.row.championId, (counts.get(play.row.championId) ?? 0) + 1);
  }
  return {
    title: MOST_PICKED_TITLE,
    intro: MOST_PICKED_INTRO,
    rows: rankChamps(counts, 'pick', 'picks'),
    empty: MOST_PICKED_EMPTY,
  };
}

function rankChamps(counts: Map<number, number>, one: string, many: string): FunChampRow[] {
  return [...counts.entries()]
    .filter(([championId, count]) => championId > 0 && count > 0)
    .sort((left, right) => right[1] - left[1] || championName(left[0]).localeCompare(championName(right[0])))
    .slice(0, CHAMP_TABLE_LIMIT)
    .map(([championId, count]) => ({
      championId,
      champion: championName(championId),
      count,
      valueLabel: count === 1 ? `1 ${one}` : `${count} ${many}`,
    }));
}

/* ---------------------------------------------------------------------------
 * Friends and enemies (M8.1): nemesis, and best duo.
 *
 * **Best duo is not new maths.** It is {@link duoRecords} — the same call `/p/[puuid]`'s
 * `Partners` block and the cursed-duo award make, with `compareDuos`' order already applied. A
 * second pair fold here would be two answers to one question, and the first night they disagreed
 * would be the last night anybody believed either. The only thing this file adds to a pair is
 * the **list of customs behind it**, which is a read and not a number.
 *
 * **Nemesis is new**, and it is the mirror of `duoRecords`' own note: a pair fold counts the
 * games two people played on the *same* side, and says in as many words that a game they played
 * against each other counts for neither half of it. This is that game. It is **per player and
 * asymmetric** — Yuki's nemesis is Lena, Lena's is somebody else — so it is a list of people,
 * not a table of pairs.
 * ------------------------------------------------------------------------- */

/** How many rows either list prints: the page's own table size (OTP, Luck, most picked). */
const RIVAL_TABLE_LIMIT = 10;

/** One person's record against one opponent, and every custom it was folded from. */
interface RivalTally {
  opponent: StatsPlayer;
  /** Counted customs the two were on opposite sides of. */
  games: number;
  /** How many of those the subject lost. */
  losses: number;
  /** Those customs, newest first, with whether the subject lost that one. */
  met: { game: StatsGame; lost: boolean }[];
}

/**
 * The tie rule for a rivalry: **more losses**, then a worse record against them, then more games
 * against, then the opponent's name.
 *
 * The middle two keys can only separate two tallies that a later key would have separated
 * anyway (equal losses at an equal rate is an equal count of games), and they are here because
 * the order is stated the same way everywhere else in this file and a reader should not have to
 * prove that to themselves.
 */
function worseRival(left: RivalTally, right: RivalTally): number {
  return (
    right.losses - left.losses ||
    right.losses / right.games - left.losses / left.games ||
    right.games - left.games ||
    renderWebName(left.opponent.name).localeCompare(renderWebName(right.opponent.name))
  );
}

/** `Won` / `Lost`, the board's own two words, on every custom either list reopens. */
function metLabel(lost: boolean): string {
  return lost ? LOST : WON;
}

function playsByGame(plays: readonly Play[]): Map<string, Play[]> {
  const byGame = new Map<string, Play[]>();
  for (const play of plays) {
    const list = byGame.get(play.game.id) ?? [];
    list.push(play);
    byGame.set(play.game.id, list);
  }
  return byGame;
}

/**
 * One row per person who has one: the opponent who has beaten them most.
 *
 * The minimum is {@link MIN_DUO_GAMES} — `duoRecords`' own, not a second floor — and a perfect
 * record against somebody is never a nemesis, because the list is about losses.
 */
function nemesisRows(counted: readonly StatsGame[], plays: readonly Play[], bind: BindGame): FunRivalRow[] {
  const byGame = playsByGame(plays);
  const subjects = new Map<string, { player: StatsPlayer; foes: Map<string, RivalTally> }>();

  // Newest first, so every row's openings come out in the order the page prints them.
  for (const game of [...counted].reverse()) {
    const seats = byGame.get(game.id) ?? [];
    for (const seat of seats) {
      const lost = !won(seat.row, game);
      const subject = subjects.get(seat.player.playerId) ?? {
        player: seat.player,
        foes: new Map<string, RivalTally>(),
      };
      for (const foe of seats) {
        if (foe.row.side === seat.row.side) continue;
        const tally = subject.foes.get(foe.player.playerId) ?? {
          opponent: foe.player,
          games: 0,
          losses: 0,
          met: [],
        };
        tally.games += 1;
        if (lost) tally.losses += 1;
        tally.met.push({ game, lost });
        subject.foes.set(foe.player.playerId, tally);
      }
      subjects.set(seat.player.playerId, subject);
    }
  }

  const ranked: { row: FunRivalRow; tally: RivalTally }[] = [];
  for (const subject of subjects.values()) {
    const nemesis = [...subject.foes.values()]
      .filter((tally) => tally.games >= MIN_DUO_GAMES && tally.losses > 0)
      .sort(worseRival)[0];
    if (nemesis === undefined) continue;
    ranked.push({
      tally: nemesis,
      row: {
        player: ref(subject.player),
        rival: ref(nemesis.opponent),
        games: nemesis.games,
        losses: nemesis.losses,
        countLabel: ofGamesLine(nemesis.losses, nemesis.games),
        valueLabel: nemesisLine(renderWebName(nemesis.opponent.name), nemesis.losses, nemesis.games),
        openings: nemesis.met.map((met) => openingOf(met.game, bind, metLabel(met.lost))),
      },
    });
  }

  return ranked
    .sort(
      (a, b) =>
        worseRival(a.tally, b.tally) ||
        renderWebName(a.row.player.name).localeCompare(renderWebName(b.row.player.name)),
    )
    .slice(0, RIVAL_TABLE_LIMIT)
    .map((entry) => entry.row);
}

/**
 * The customs a pair shared a side in, newest first.
 *
 * This is the `See games` list and **nothing else**: the record above it is `duoRecords`', and
 * the two agree because they read the same universe (`counted`) under the same rule — both rows
 * on one side.
 */
function duoOpenings(counted: readonly StatsGame[], pair: FunDuoRow['players'], bind: BindGame) {
  const openings: FunOpening[] = [];
  for (const game of [...counted].reverse()) {
    const first = game.rows.find((row) => row.puuid === pair[0].puuid);
    const second = game.rows.find((row) => row.puuid === pair[1].puuid);
    if (first === undefined || second === undefined || first.side !== second.side) continue;
    openings.push(openingOf(game, bind, metLabel(first.side !== game.winningSide)));
  }
  return openings;
}

/** `duoRecords`, already in `compareDuos`' order, with each pair's customs attached. */
function bestDuoRows(
  counted: readonly StatsGame[],
  players: readonly StatsPlayer[],
  bind: BindGame,
): FunDuoRow[] {
  return duoRecords(counted, players)
    .slice(0, RIVAL_TABLE_LIMIT)
    .map((duo) => ({
      players: duo.players,
      games: duo.games,
      wins: duo.wins,
      losses: duo.losses,
      winRate: duo.winRate,
      pairLabel: pairLabel(renderWebName(duo.players[0].name), renderWebName(duo.players[1].name)),
      valueLabel: duoRecordLine(duo.wins, duo.losses, duo.winRate),
      openings: duoOpenings(counted, duo.players, bind),
    }));
}

function rivalsView(
  counted: readonly StatsGame[],
  players: readonly StatsPlayer[],
  plays: readonly Play[],
  bind: BindGame,
): FunRivalsView {
  return {
    nemesis: {
      title: NEMESIS_TITLE,
      intro: NEMESIS_INTRO,
      rule: NEMESIS_RULE,
      rows: nemesisRows(counted, plays, bind),
      empty: NO_NEMESIS,
    },
    duos: {
      title: BEST_DUO_TITLE,
      intro: BEST_DUO_INTRO,
      rule: BEST_DUO_RULE,
      rows: bestDuoRows(counted, players, bind),
      empty: NO_DUOS,
    },
  };
}
