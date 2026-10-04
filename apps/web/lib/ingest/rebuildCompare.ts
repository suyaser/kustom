import { SETTLING_GAMES } from '@customs/core';

/**
 * What a `rebuild-ratings --dry-run` prints for the M18.10 gate (M18.5; research
 * `rating-systems.md` §7.1, `rating-real.md` M18.3): the stored numbers, which friends saw, beside the
 * numbers the Kustom fold is about to write, over the same games. Pure and read-only: `rebuild.ts`
 * collects the inputs from its snapshot and its in-memory fold, this computes, and nothing is written.
 *
 * - **Log loss** of the Kustom all-time expected (each game predicted from the Ratings before it)
 *   against the stored OpenSkill odds (`fold_p` of an OpenSkill-era row, or `foldWinProbability` of
 *   the stored befores, which is the same number, M14.59), over the games that have both. Coin 0.693.
 * - **Spearman** of the new all-time board (`round(r)`) against the current one (`round(mu × 60)`),
 *   over players with `SETTLING_GAMES` or more rated games and over everyone on both boards.
 * - **Top-3 overlap** and **places moved** (mean, max) on the 10+ board.
 * - **Side by side**: the board in new order with each player's old place and Rating, and the last
 *   two weeks' old and new per-game changes for the three players with the most games in them.
 */

export interface CompareGame {
  /** Blue won. */
  blueWon: boolean;
  /** Blue's stored OpenSkill odds, or null when the game has none (it is then left out of both). */
  oldBlueP: number | null;
  /** Blue's Kustom all-time expected from this fold. */
  newBlueP: number;
}

export interface CompareChange {
  playerId: string;
  startedAt: string;
  /** The stored printed change (`round(mu_after × 60) − round(mu_before × 60)`), null with no stored rating. */
  oldChange: number | null;
  /** `printedChange(r_before, r_after)` from this fold. */
  newChange: number;
}

export interface ComparePlayer {
  playerId: string;
  name: string;
  /** Rated games since the epoch, as this fold counted them. */
  games: number;
  /** The current board's Rating (`round(ratings.mu × 60)`), null with no stored OpenSkill rating. */
  oldRating: number | null;
  /** The new all-time Rating, `round(r)`. */
  newRating: number;
}

export interface BoardLine {
  newPlace: number;
  oldPlace: number | null;
  name: string;
  newRating: number;
  oldRating: number | null;
}

export interface RecentLine {
  name: string;
  changes: { old: number | null; new: number }[];
}

export interface RebuildComparison {
  /** Games with both odds: the log loss is over exactly these. */
  games: number;
  logLoss: { kustom: number; openSkill: number; coin: number } | null;
  spearman: { settled: number | null; settledPlayers: number; all: number | null; allPlayers: number };
  /** Of the 10+ board's top three, how many are in both. Null under three such players. */
  top3Overlap: number | null;
  placesMoved: { mean: number; max: number } | null;
  /** The 10+ board (everyone on both boards when fewer than three qualify), new order, at most `BOARD_LINES`. */
  board: BoardLine[];
  recent: RecentLine[];
}

export const BOARD_LINES = 10;
export const RECENT_PLAYERS = 3;
export const RECENT_CHANGES = 8;
const COIN = Math.log(2);

function logLoss(ps: readonly number[], ys: readonly boolean[]): number {
  let total = 0;
  ps.forEach((raw, index) => {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, raw));
    total += ys[index] ? -Math.log(p) : -Math.log(1 - p);
  });
  return total / ps.length;
}

/** Places on a board, highest first, ties by player id so two runs agree. */
function places(players: readonly ComparePlayer[], value: (p: ComparePlayer) => number): Map<string, number> {
  const sorted = [...players].sort(
    (a, b) => value(b) - value(a) || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );
  return new Map(sorted.map((p, index) => [p.playerId, index + 1]));
}

function spearman(players: readonly ComparePlayer[]): number | null {
  const n = players.length;
  if (n < 2) return null;
  const old = places(players, (p) => p.oldRating as number);
  const neu = places(players, (p) => p.newRating);
  const d2 = players.reduce(
    (sum, p) => sum + ((old.get(p.playerId) as number) - (neu.get(p.playerId) as number)) ** 2,
    0,
  );
  return 1 - (6 * d2) / (n * (n * n - 1));
}

export function compareRebuild(input: {
  games: readonly CompareGame[];
  changes: readonly CompareChange[];
  players: readonly ComparePlayer[];
  /** The start of the last two weeks (the previous week's boundary before the last game's). */
  recentSince: string | null;
}): RebuildComparison {
  const scored = input.games.filter((g) => g.oldBlueP !== null);
  const ys = scored.map((g) => g.blueWon);
  const loss =
    scored.length === 0
      ? null
      : {
          kustom: logLoss(
            scored.map((g) => g.newBlueP),
            ys,
          ),
          openSkill: logLoss(
            scored.map((g) => g.oldBlueP as number),
            ys,
          ),
          coin: COIN,
        };

  const onBoth = input.players.filter((p) => p.oldRating !== null);
  const settled = onBoth.filter((p) => p.games >= SETTLING_GAMES);
  const boardSet = settled.length >= 3 ? settled : onBoth;

  let top3Overlap: number | null = null;
  let placesMoved: RebuildComparison['placesMoved'] = null;
  if (settled.length >= 3) {
    const old = places(settled, (p) => p.oldRating as number);
    const neu = places(settled, (p) => p.newRating);
    const top = (m: Map<string, number>) =>
      new Set([...m].filter(([, place]) => place <= 3).map(([id]) => id));
    const oldTop = top(old);
    top3Overlap = [...top(neu)].filter((id) => oldTop.has(id)).length;
    const moved = settled.map((p) =>
      Math.abs((old.get(p.playerId) as number) - (neu.get(p.playerId) as number)),
    );
    placesMoved = { mean: moved.reduce((a, b) => a + b, 0) / moved.length, max: Math.max(...moved) };
  }

  const oldPlaces = places(boardSet, (p) => p.oldRating as number);
  const newPlaces = places(boardSet, (p) => p.newRating);
  const board: BoardLine[] = [...boardSet]
    .sort((a, b) => (newPlaces.get(a.playerId) as number) - (newPlaces.get(b.playerId) as number))
    .slice(0, BOARD_LINES)
    .map((p) => ({
      newPlace: newPlaces.get(p.playerId) as number,
      oldPlace: oldPlaces.get(p.playerId) ?? null,
      name: p.name,
      newRating: p.newRating,
      oldRating: p.oldRating,
    }));

  const since = input.recentSince === null ? null : Date.parse(input.recentSince);
  const recentChanges = input.changes
    .filter((c) => since === null || Date.parse(c.startedAt) >= since)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const byPlayer = new Map<string, CompareChange[]>();
  for (const c of recentChanges) byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c]);
  const nameOf = new Map(input.players.map((p) => [p.playerId, p.name]));
  const recent: RecentLine[] = [...byPlayer]
    .sort(
      ([a, ca], [b, cb]) => cb.length - ca.length || ((nameOf.get(a) ?? a) < (nameOf.get(b) ?? b) ? -1 : 1),
    )
    .slice(0, RECENT_PLAYERS)
    .map(([playerId, list]) => ({
      name: nameOf.get(playerId) ?? playerId,
      changes: list.slice(-RECENT_CHANGES).map((c) => ({ old: c.oldChange, new: c.newChange })),
    }));

  return {
    games: scored.length,
    logLoss: loss,
    spearman: {
      settled: spearman(settled),
      settledPlayers: settled.length,
      all: spearman(onBoth),
      allPlayers: onBoth.length,
    },
    top3Overlap,
    placesMoved,
    board,
    recent,
  };
}

const signed = (n: number | null) => (n === null ? '?' : n > 0 ? `+${n}` : `${n}`);
const fixed = (n: number | null, digits = 3) => (n === null ? '-' : n.toFixed(digits));

/** The gate lines of the dry-run report: one place, so the unit test reads what the owner reads. */
export function formatComparison(c: RebuildComparison): string[] {
  const lines = [
    c.logLoss === null
      ? 'gate          log loss: no game with stored OpenSkill odds'
      : `gate          log loss ${fixed(c.logLoss.kustom)} kustom vs ${fixed(c.logLoss.openSkill)} stored openskill fold_p over ${c.games} game${c.games === 1 ? '' : 's'} (coin ${fixed(c.logLoss.coin)})`,
    `              spearman ${fixed(c.spearman.settled)} over ${c.spearman.settledPlayers} with ${SETTLING_GAMES}+ games, ${fixed(
      c.spearman.all,
    )} over all ${c.spearman.allPlayers}; top 3 ${c.top3Overlap === null ? '-' : `${c.top3Overlap} of 3`}; places moved ${
      c.placesMoved === null ? '-' : `mean ${c.placesMoved.mean.toFixed(1)}, max ${c.placesMoved.max}`
    }`,
  ];
  if (c.board.length > 0) {
    lines.push('board         new  old  player                 new Rating  old Rating');
    for (const b of c.board) {
      lines.push(
        `              ${String(b.newPlace).padEnd(5)}${String(b.oldPlace ?? '-').padEnd(5)}${b.name.slice(0, 22).padEnd(23)}${String(
          b.newRating,
        ).padEnd(12)}${b.oldRating ?? '-'}`,
      );
    }
  }
  for (const [index, r] of c.recent.entries()) {
    lines.push(
      `${index === 0 ? 'last 2 weeks  ' : '              '}${r.name.slice(0, 22).padEnd(23)}old ${r.changes
        .map((x) => signed(x.old))
        .join(' ')}  new ${r.changes.map((x) => signed(x.new)).join(' ')}`,
    );
  }
  return lines;
}
