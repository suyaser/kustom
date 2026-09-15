import type { RoleValue, SideValue } from '@customs/db';
import type { Streak } from '../board/streak';
import type { QueueKind } from '../games/queue';
import type { HistoryGame } from '../games/types';
import type { WindowKind } from '../night';
import type { PlayerName } from '../tonight/types';
import type { RawGameFacts } from './rawFacts';

/**
 * What `/stats` is made of (M5.4): the rows the loader reads, and the answer the page renders.
 *
 * Everything below the loader is **pure arithmetic over these two input types** — one game, one
 * scoreboard row — so every number on the page is a unit test with a hand-built fixture rather
 * than a night of waiting and a database. `lib/stats/fold.ts` and `lib/stats/awards.ts` take
 * `StatsGame[]` and `StatsPlayer[]` and take nothing else.
 */

/** One `game_players` row, reduced to what the stats fold reads. */
export interface StatsRow {
  playerId: string;
  /** The fold's own tie-break, and the identity every number here is keyed on (CLAUDE.md). */
  puuid: string;
  side: SideValue;
  /**
   * The position the client detected — **what they actually played**. `null` on every
   * backfilled game (M5.1) and on an end-of-game block that carried none, which is why the
   * role numbers carry a footnote instead of quietly counting fewer games.
   */
  role: RoleValue | null;
  /** `null` on a game the fold has not rated: it still counts, but it carries no climb. */
  muBefore: number | null;
  muAfter: number | null;
  /**
   * Scoreboard columns the companion already stores (`0001_init`). `/stats` does not fold them
   * — M5.4 left KDA, gold, damage and CS out of that page on purpose. `/fun` reads them.
   */
  championId: number | null;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damageToChamps: number;
  cs: number;
}

/** One `games` row and its scoreboard. */
export interface StatsGame {
  id: string;
  /** ISO 8601, as stored. The window filter and the streak order both read it. */
  startedAt: string;
  /**
   * The client's own id for the game. **The streak order's tie-break**, so a streak and the
   * rating history tell the same story: `rebuild-ratings` folds in `started_at` then
   * `lcu_game_id` ascending, and this file is not allowed to invent a second ordering.
   *
   * `number` as the database stores it (a bigint), `string` where a fixture or a future caller
   * carries it as text — the same latitude `inferRoles` takes with `startedAt`, and the
   * comparison below is numeric whenever both ends are numbers.
   */
  lcuGameId: string | number | null;
  durationS: number;
  winningSide: SideValue;
  /**
   * The client's `gameMode` (`CLASSIC`, `ARAM`, `KIWI`), or `null` when `games.raw` never
   * named one. Howling Abyss customs in this group are `KIWI`, not `ARAM`.
   */
  gameMode?: string | null;
  /** Match-history `mapId`. 11 is Rift, 12 is Howling Abyss. Absent on a live end-of-game block. */
  mapId?: number | null;
  /**
   * First blood, steals, vision and draft bans parsed from `games.raw`. Absent when the
   * loader did not select `raw` (`/stats`) or when the blob named none of those keys.
   */
  rawFacts?: RawGameFacts | null;
  rows: readonly StatsRow[];
}

/** One player, as `players_public` answers for them. */
export interface StatsPlayer {
  playerId: string;
  puuid: string;
  /** `null` for a player the database has no name for: rendered `Someone` (M3.10). */
  name: PlayerName;
  /**
   * Their main, inferred from their own games since M5.17. `null` is *flexible* — every role is
   * theirs — and a flexible player is in no off-role number at all, exactly as the balancer
   * counts them.
   */
  mainRole: RoleValue | null;
}

/** A player, as a line on this page names them. */
export interface PlayerRef {
  puuid: string;
  name: PlayerName;
}

/**
 * One player's record at something — a role, a side, a partner.
 *
 * `winRate` is `Math.round(wins / games * 100)` and is **`null` under the minimum**: under five
 * games the record prints without a percentage (`3W 1L`), so nobody is "100% mid" off one game.
 */
export interface StatsRecord extends PlayerRef {
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

/** One of the five role blocks: the players with at least the minimum rows at that role. */
export interface RoleBlock {
  role: RoleValue;
  /** Ordered by the tie rule. Empty when nobody has reached the minimum. */
  entries: StatsRecord[];
}

/** A pair that played on the same side, and how it went. */
export interface DuoRecord {
  /** The two, ordered by the same name-then-puuid rule every list on this page uses. */
  players: [PlayerRef, PlayerRef];
  games: number;
  wins: number;
  losses: number;
  /** Never `null`: a pair is only ever built once it has reached the minimum to appear. */
  winRate: number;
}

/** One player's runs: the one they are on now, and the longest of each kind in the window. */
export interface PlayerStreaks extends PlayerRef {
  /** The run ending at their most recent counted game. `null` for nobody's games. */
  current: Streak | null;
  longestWin: number;
  longestLoss: number;
}

/** The window's best or worst run, and everyone who is on it. */
export interface StreakHolders {
  length: number;
  holders: PlayerRef[];
}

/**
 * One award, rendered: its label, the rule it was won under, and the line — or the sentence
 * nobody qualifying prints.
 *
 * **The same object feeds the page and the Monday Discord post** (M5.10), which is the whole
 * reason the awards are rendered in `lib/stats` rather than in a component: the group reads
 * these three lines in the channel and then opens the page to argue with them, and two
 * renderings of one award is a bug nobody would find until the argument.
 */
export interface AwardLine {
  /**
   * Who the line is about: a winner's puuid, a pair's two joined, or `nobody` for the sentence
   * an award nobody won prints. **The React key of the line**, so a page that names two tied
   * winners keys them on the people and not on the sentence they happen to share.
   */
  key: string;
  text: string;
}

export interface AwardBlock {
  /** `Most improved`. Bold at the front of the line in Discord, a label on the page. */
  label: string;
  /** `Biggest climb in Rating from a first game to a last one, over at least 15 games.` */
  rule: string;
  /**
   * One line per winner — two when the tie rule names two — or exactly one "nobody qualifies"
   * sentence. Never empty.
   */
  lines: AwardLine[];
  /** False when {@link lines} is the "nobody qualifies" sentence. */
  won: boolean;
  /** `Players with no main role are not in this one — every role is theirs.` */
  note: string | null;
}

/**
 * The awards section, which is one of three things and never a fourth: three awards on a window
 * that has **closed**, one line on a window that is still running, and nothing at all on
 * `All time` (`null`) — a window that never closes has no last night to read them on.
 */
export type AwardsView =
  | { kind: 'closed'; intro: string; blocks: AwardBlock[] }
  | { kind: 'running'; line: string };

/** Everything `/stats` prints, computed on the server and rendered from this and nothing else. */
export interface StatsView {
  window: WindowKind;
  /**
   * The window slot's range half (`September`, `Monday 1 Sep to Sunday 7 Sep`), or `null` when
   * the window holds no counted game — in which case the page prints the window's own empty
   * sentence and draws no section at all (M5.12's slot rule).
   */
  range: string | null;
  /** Counted games in the window: the fold's universe, `gateRatedGame`, and nothing else. */
  games: number;
  /** How many people have a counted row in the window. */
  players: number;
  /** True when the window holds more games than the read's cap, which prints one line. */
  capped: boolean;
  /** The cap the read used, so the line names the number it actually applied. */
  cap: number;
  /** Blue wins ÷ counted games, as a percentage. `null` only when there are no games. */
  blueWinRate: number | null;
  /** The mean of `duration_s` over counted games, to the nearest minute. `null` at zero games. */
  averageMinutes: number | null;
  roles: RoleBlock[];
  /** Counted games that are not wholly in the role numbers, for the footnote. */
  noRoleGames: number;
  bestDuos: DuoRecord[];
  worstDuos: DuoRecord[];
  longestWin: StreakHolders | null;
  longestLoss: StreakHolders | null;
  /** Anyone whose current streak is three or longer, longest first. */
  onAStreak: PlayerStreaks[];
  awards: AwardsView | null;
}

/* ---------------------------------------------------------------------------
 * `/fun` (M5.24): single-game records and shame tables from the scoreboard
 * columns `/stats` deliberately does not fold.
 * ------------------------------------------------------------------------- */

/** One counted custom under a record that can reopen more than one night. */
export interface FunOpening {
  /** Champion, steal name, or null when the row already said the number. */
  label: string | null;
  detail: string;
  game: HistoryGame;
}

/** One named line on `/fun`: a person, a number, and optional match context. */
export interface FunHolder extends PlayerRef {
  valueLabel: string;
  detail: string | null;
  /**
   * The counted custom this number came from. Null on a habit (attendance, a
   * window total). The page opens both scoreboards from this.
   */
  game: HistoryGame | null;
  /**
   * Every counted custom behind a window total (deathless games, career
   * steals). Empty when there is no night to reopen. One opening is the
   * same expand as {@link game}; more than one nests under See games.
   */
  openings: FunOpening[];
}

/** A champion the group banned or picked, or one person locked, with a count. */
export interface FunChampRow {
  championId: number;
  champion: string;
  count: number;
  valueLabel: string;
}

/** One person on the one-trick or variety list, and every champion they locked. */
export interface FunPoolRow extends PlayerRef {
  valueLabel: string;
  champs: FunChampRow[];
}

/** OTP or variety: ranked people, each with a collapsed champion × games pool. */
export interface FunPool {
  id: string;
  title: string;
  intro: string;
  rule: string;
  rows: FunPoolRow[];
  empty: string;
}

/** A ranked season table — first-blood totals still use this shape. */
export interface FunTable {
  id: string;
  title: string;
  intro: string;
  rows: FunHolder[];
  empty: string;
}

/** One opening in the First Blood Museum: who took it, on which champion, which night. */
export interface FunBloodRow {
  gameId: string;
  taker: PlayerRef;
  champion: string;
  /**
   * The other person the block also named. Killer museum: who died. Donated
   * museum: who killed. Null when that flag is missing — never a guess.
   */
  victim: PlayerRef | null;
  /** `over` on a kill, `to` on a donation. Unused when {@link victim} is null. */
  foeVerb: 'over' | 'to';
  opponent: string | null;
  /**
   * A count that is not 1, printed next to the champion (`2 triples`). Null on
   * a single first blood or a single multi-kill.
   */
  haul: string | null;
  when: string;
  game: HistoryGame | null;
}

/** One killer's first bloods, grouped so two people are not one undivided list. */
export interface FunBloodGroup {
  taker: PlayerRef;
  count: number;
  countLabel: string;
  openings: FunBloodRow[];
}

/** One fear-ban sentence: a person's champion, banned by the other side while they were in. */
export interface FunFearBan {
  player: PlayerRef;
  champion: string;
  banned: number;
  available: number;
  rate: number;
  line: string;
}

export interface FunSection<T> {
  title: string;
  intro: string;
  rows: T[];
  empty: string;
}

/** Highest and lowest CS in one counted game at a role. */
export interface RoleCsPair {
  role: RoleValue;
  highest: FunHolder | null;
  lowest: FunHolder | null;
}

/** One single-game (or season-habit) record. Empty holders print {@link empty}. */
export interface FunRecord {
  id: string;
  title: string;
  rule: string;
  holders: FunHolder[];
  empty: string;
}

/** Everything `/fun` prints, computed on the server from the same window `/stats` reads. */
export interface FunFactsView {
  window: WindowKind;
  /** Which map the records are from. Default Rift; `?queue=aram` is the other picker. */
  queue: QueueKind;
  range: string | null;
  games: number;
  players: number;
  capped: boolean;
  cap: number;
  tables: FunTable[];
  museum: FunSection<FunBloodGroup>;
  donated: FunSection<FunBloodGroup>;
  /**
   * Pentakill, quadrakill, triple, double, then first turret. Same grouping as
   * the first-blood museums. Empty sections still print so the lobby knows
   * the category exists.
   */
  halls: FunSection<FunBloodGroup>[];
  deathHall: FunRecord[];
  thieves: FunRecord[];
  fearBans: FunSection<FunFearBan>;
  mostBanned: FunSection<FunChampRow>;
  mostPicked: FunSection<FunChampRow>;
  /**
   * Who locks the same champion and who never repeats one. Ranked people, each
   * with a collapsed champion × games pool.
   */
  pools: FunPool[];
  /**
   * Lowest KDA on a winning side, highest KDA on a losing side. Ranked by
   * how often, each with the customs that did it.
   */
  fates: FunRecord[];
  csByRole: RoleCsPair[];
  records: FunRecord[];
  notes: string[];
}

/* ---------------------------------------------------------------------------
 * The per-player sections on `/p/[puuid]` (M5.20).
 *
 * The same numbers as above, read for one person out of the same answer: `load.ts` makes one
 * read, `player.ts` picks the player out of it, and the page renders this and decides nothing.
 * There is no second fold and no second query — every field below comes from a function
 * `/stats` already calls (`playerRoleRecords`, `playerSideRecords`, `duoRecords`,
 * `playerStreaks`, `averageGameMinutes`, `awardsView`).
 * ------------------------------------------------------------------------- */

/** One row of `By role` on a person's page: their record at a position they actually played. */
export interface PlayerRoleRecord extends StatsRecord {
  role: RoleValue;
}

/** One row of `By side`: their record on blue, or on red. */
export interface PlayerSideRecord {
  side: SideValue;
  record: StatsRecord;
}

/**
 * One row of `Partners`: **the other person**, and how the two of them did on the same side.
 *
 * `games` is games *together*, not games played — a pair is credited with a game only when both
 * have a counted row in it on **one** side, so a night they spent against each other is in
 * neither the numerator nor the denominator.
 */
export type PartnerRecord = StatsRecord;

/**
 * Everything the sections under the rating chart print (M5.20), for one player and one window.
 *
 * **Zero counted games in the window is `games: 0` and nothing else** — no roles, no sides, no
 * partners, no streak and no mean. The page draws no card at all there: the window's own empty
 * sentence is already in the header strip and is the only true line about that window.
 */
export interface PlayerStatsView {
  window: WindowKind;
  /** This player's counted games inside the window. The universe every number below reads. */
  games: number;
  /** Lane order, and only the roles the scoreboard gave them. Under five rows, no percentage. */
  roles: PlayerRoleRecord[];
  /** Their counted games whose **own row** carries no role, for the section's footnote. */
  noRoleGames: number;
  /** Blue first, and only the sides they played. Same five-game minimum for a percentage. */
  sides: PlayerSideRecord[];
  /** Their three best partners at five games together on the same side, best first. */
  bestPartners: PartnerRecord[];
  /** The same list from the other end. With fewer than six partners a name is in both. */
  worstPartners: PartnerRecord[];
  /** The run they are on and the longest of each kind. `null` with no counted games. */
  streaks: PlayerStreaks | null;
  /** The mean of `duration_s` over their counted games, to the minute. Never `0`, never `NaN`. */
  averageMinutes: number | null;
  /**
   * One line per award this player won in a **closed** window: `Most improved, September.`
   * Empty on `This week`, `This month` and `All time`, which hand out nothing.
   */
  awards: string[];
  /** True when the window holds more games than the read's cap, which prints one line. */
  capped: boolean;
  cap: number;
}
