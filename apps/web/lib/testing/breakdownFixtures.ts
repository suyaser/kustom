import { type DeltaReason, foldWinProbability, winProbability } from '@customs/core';
import type { GameBreakdown } from '../breakdown/load';
import { type BreakdownGame, type BreakdownRow, resultOdds, rowReason } from '../breakdown/read';
import type { ResultView } from '../tonight/types';

/**
 * A finished fixture game's stored breakdown (M14.58 / M14.59), as the fold would have written it:
 * `fold_p` from the ten befores (`foldWinProbability`), the base `mu_after` equal to the stored one
 * (the fixture's ratings carry no bonus, so the award is none), and `rated_games_before` from
 * `ratedGames` when given. Pure, for tests and the dev kit; read through the same `rowReason` /
 * `resultOdds` the page's loader uses.
 */
export function breakdownFromResult(
  result: ResultView,
  options: { ratedGames?: ReadonlyMap<string, number>; botBlueWinProb?: number | null } = {},
): GameBreakdown {
  const seats = [...result.blue, ...result.red];
  const known = (list: typeof seats) =>
    list.flatMap((seat) =>
      seat.muBefore === null || seat.sigmaBefore === null
        ? []
        : [{ mu: seat.muBefore, sigma: seat.sigmaBefore }],
    );
  const blue = known(result.blue);
  const red = known(result.red);
  // M18.5: a Kustom-folded game's `fold_p` is `winProbability` of the ten all-time Ratings going in
  // (`r_before`); a seat list without them is an OpenSkill-era game, folded by `foldWinProbability`.
  const kustom = (list: typeof seats) =>
    list.flatMap((seat) => (typeof seat.rBefore === 'number' ? [seat.rBefore] : []));
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  const blueR = kustom(result.blue);
  const redR = kustom(result.red);
  const blueP =
    blueR.length === 5 && redR.length === 5
      ? winProbability(sum(blueR), sum(redR))
      : blue.length === 5 && red.length === 5
        ? foldWinProbability(blue, red, 100)
        : null;

  const rows: BreakdownRow[] = seats.map((seat) => ({
    playerId: seat.puuid,
    side: seat.side,
    muBefore: seat.muBefore,
    sigmaBefore: seat.sigmaBefore,
    muAfter: seat.muAfter,
    foldP: blueP === null || seat.muAfter === null ? null : seat.side === 100 ? blueP : 1 - blueP,
    baseMuAfter: seat.muAfter,
    award: seat.muAfter === null ? null : 'none',
    ratedGamesBefore: options.ratedGames?.get(seat.puuid) ?? null,
  }));
  const game: BreakdownGame = {
    winningSide: result.winningSide,
    botBlueWinProb: options.botBlueWinProb === undefined ? result.blueWinProb : options.botBlueWinProb,
    rows,
  };
  const reasons = new Map<string, DeltaReason | null>(
    rows.map((row) => [row.playerId, rowReason(game, row.playerId)]),
  );
  return { gameId: result.gameId, odds: resultOdds(game), reasons };
}
