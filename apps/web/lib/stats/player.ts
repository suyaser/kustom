import { formatDayMonth, formatMonthName, type WindowKind, type WindowRange } from '../night';
import { awardPeriod, awardsView, WEB_AWARD_RENDER, type WeeklySeeds } from './awards';
import { awardWonLine, weekOfLabel } from './copy';
import {
  averageGameMinutes,
  compareDuos,
  compareDuosWorst,
  countedGames,
  duoRecords,
  playerNoRoleGames,
  playerRoleRecords,
  playerSideRecords,
  playerStreaks,
} from './fold';
import type { DuoRecord, PartnerRecord, PlayerStatsView, StatsGame, StatsPlayer, StatsRecord } from './types';

/**
 * The sections under the rating chart on `/p/[puuid]` (M5.20), assembled from the **same list
 * of games `/stats` folds** — pure, so every clause of the brief is a fixture test rather than
 * a night of waiting and a database.
 *
 * `/stats` answers "who is best on jungle"; this answers "how do **I** do on jungle", which is
 * the question the M3.5 brief said belongs on a person's page and not in a second board. It is
 * therefore a **rendering task and not a second fold**: every number below comes out of a
 * function `view.ts` already calls, with one player picked out of the answer.
 *
 * Three rules it inherits whole and may not restate:
 *
 * - **The universe is the rating fold's**, `gateGame`, applied once by `countedGames`. A page
 *   that counted a remake would print a different game count from the row that linked to it.
 * - **The minimums are product's**: five rows for a percentage, five games together for a
 *   partner to appear at all.
 * - **The streak is the leaderboard row's**, from `currentStreak` through `playerStreaks`. Two
 *   definitions of a streak in one app is a bug.
 */

/** How many partners each list shows. Product's number: three best, three worst. */
export const PARTNERS_SHOWN = 3;

export interface PlayerStatsInput {
  window: WindowKind;
  /** Whose page this is. The identity everything here is keyed on (CLAUDE.md). */
  puuid: string;
  /** The window's games, as read: this applies the gate, exactly as `/stats` does. */
  games: readonly StatsGame[];
  players: readonly StatsPlayer[];
  /** The window's bounds, for the award line's calendar (`September`, `week of 1 Sep`). */
  range: WindowRange;
  capped: boolean;
  cap: number;
  timeZone?: string | undefined;
  /**
   * The week's seeds (M7.4), straight from the same loader read. This page hands out no award of
   * its own — it reads whether the group's award names this person — so the one thing it must not
   * do is compute `Most improved` over a different track from `/stats` and name somebody else.
   */
  seeds?: WeeklySeeds | undefined;
}

export function playerStatsView(input: PlayerStatsInput): PlayerStatsView {
  const counted = countedGames(input.games);
  const player = input.players.find((entry) => entry.puuid === input.puuid);
  const empty: PlayerStatsView = {
    window: input.window,
    games: 0,
    roles: [],
    noRoleGames: 0,
    sides: [],
    bestPartners: [],
    worstPartners: [],
    streaks: null,
    averageMinutes: null,
    awards: [],
    capped: input.capped,
    cap: input.cap,
  };

  /**
   * **Nobody the window's scoreboards name is nobody with a number here.** The roster is read
   * by the ids on those scoreboards, so a player with no counted game in the window is simply
   * absent from it — which is the same answer as `games: 0` and is reached without a second
   * query for a person the page above already loaded.
   */
  if (player === undefined) return empty;

  /**
   * **Their** counted games, and the list every number below is folded over.
   *
   * The role and side helpers filter by player themselves and would give the same answer over
   * the whole window; the mean and the streak would not, and a page whose average game length
   * was the group's would be the quietest wrong number on it.
   */
  const mine = counted.filter((game) => game.rows.some((row) => row.puuid === input.puuid));
  if (mine.length === 0) return empty;

  const streaks = playerStreaks(mine, [player])[0] ?? null;
  const partners = partnerRecords(mine, input.players, player);
  /**
   * **One list, cut in two, and nobody is in both** (the designer, 2026-09-11).
   *
   * `Best together` takes the top three; `Worst together` takes the bottom three **of what is
   * left**, so with four qualifying partners the worst list holds one name and with three it
   * holds none — and `Best together` is then the whole truth, printed alone. A name in both
   * lists is a page saying `Theo · 6W 4L · 60%` twice, forty pixels apart, under two headings
   * that contradict each other; on a group of twenty most people will have four or five
   * partners over the bar, so it is the common case and not the edge.
   */
  const ranked = [...partners].sort(compareRecordsWithSelf);
  const best = ranked.slice(0, PARTNERS_SHOWN);
  const rest = ranked.slice(PARTNERS_SHOWN);

  return {
    ...empty,
    games: mine.length,
    roles: playerRoleRecords(mine, player),
    noRoleGames: playerNoRoleGames(mine, player),
    sides: playerSideRecords(mine, player),
    bestPartners: best,
    /**
     * The remainder read from the other end, **not the best three reversed**: the worst list is
     * ordered rate ascending, then games descending, so a partner they have lost eleven with
     * outranks one they have lost four with.
     */
    worstPartners: [...rest].sort(compareRecordsWorst).slice(0, PARTNERS_SHOWN),
    streaks,
    averageMinutes: averageGameMinutes(mine),
    awards: awardsWon(input, counted),
  };
}

/**
 * The other end of every pair this player is in, at five games together on the same side.
 *
 * `duoRecords` is the pair fold `/stats` uses, run over **this player's** games — every pair
 * that includes them is inside that list, and the pairs that do not are dropped on the way
 * out. A game the two of them played against each other is in neither list, because the fold
 * credits a pair only on one side.
 */
function partnerRecords(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  player: StatsPlayer,
): PartnerRecord[] {
  const pairs = duoRecords(games, players);
  const mine: PartnerRecord[] = [];

  for (const pair of pairs) {
    const other = otherHalf(pair, player.puuid);
    if (other === null) continue;
    mine.push({
      puuid: other.puuid,
      name: other.name,
      games: pair.games,
      wins: pair.wins,
      losses: pair.losses,
      // A pair only exists past its minimum, so a partner's rate is never the bare-record
      // `null` — which is why these rows always print one.
      winRate: pair.winRate,
    });
  }
  return mine;
}

function otherHalf(pair: DuoRecord, puuid: string) {
  const [first, second] = pair.players;
  if (first.puuid === puuid) return second;
  if (second.puuid === puuid) return first;
  return null;
}

/**
 * The tie rule on a partner row — the pair rule, read off the record: rate descending, games
 * descending, then the partner's name and puuid.
 *
 * It is `compareDuos` with the pair's own names replaced by the one name the row prints, so the
 * order a reader sees is the order the pair list would put them in.
 */
function compareRecordsWithSelf(a: StatsRecord, b: StatsRecord): number {
  return compareDuos(asPair(a), asPair(b));
}

function compareRecordsWorst(a: StatsRecord, b: StatsRecord): number {
  return compareDuosWorst(asPair(a), asPair(b));
}

/** A one-name row, in the shape the pair comparators read. The second half is never compared. */
function asPair(record: StatsRecord): DuoRecord {
  const ref = { puuid: record.puuid, name: record.name };
  return {
    players: [ref, ref],
    games: record.games,
    wins: record.wins,
    losses: record.losses,
    winRate: record.winRate ?? 0,
  };
}

/**
 * The award lines: one per award **this player won**, on a window that has closed.
 *
 * The awards are `awardsView`'s — the same three blocks `/stats` prints and the Sunday post
 * carries — computed over the window's whole list, because an award is a fact about the group's
 * month and not about one page. This only reads whether the winner is the person whose page
 * this is: a most-improved line is keyed on their puuid, a cursed-duo line on both halves.
 *
 * `This week`, `This month` and `All time` hand out nothing, so they print nothing here.
 */
function awardsWon(input: PlayerStatsInput, counted: readonly StatsGame[]): string[] {
  const awards = awardsView(input.window, counted, input.players, WEB_AWARD_RENDER, input.seeds);
  if (awards === null || awards.kind !== 'closed') return [];

  const period = awardPeriodLabel(input);
  const lines: string[] = [];
  for (const block of awards.blocks) {
    if (!block.won) continue;
    const won = block.lines.some((line) => line.key.split('|').includes(input.puuid));
    if (won) lines.push(awardWonLine(block.label, period));
  }
  return lines;
}

/**
 * `September`, or `week of 1 Sep`: which calendar the award was won in.
 *
 * The month's name is the window slot's own (`formatMonthName`), so the line and the range half
 * above it name one month with one string; the week says which Sunday it started on rather than
 * repeating the slot's `Sunday 6 Sep to Saturday 12 Sep`, which is product's own form.
 */
function awardPeriodLabel(input: PlayerStatsInput): string {
  const period = awardPeriod(input.window);
  // Only a closed window reaches here, and every closed window is bounded (M5.9).
  const start = input.range.start as Date;
  return period?.period === 'month'
    ? formatMonthName(start, input.timeZone)
    : weekOfLabel(formatDayMonth(start, input.timeZone));
}
