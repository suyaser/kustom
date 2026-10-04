import { kFor, winProbability } from '@customs/core';
import type { GameBreakdown } from '../breakdown/load';
import {
  type BreakdownGame,
  type BreakdownRow,
  type KustomReason,
  resultOdds,
  rowReason,
} from '../breakdown/read';
import type { ResultView } from '../tonight/types';

/**
 * A finished fixture game's stored all-time breakdown (M14.58 / M14.59, Kustom since M18.6), as the
 * fold would have written it: `fold_p` from the ten `r_before`s (`winProbability`), every share 1
 * (the fixture has no performance score, so the award is none), and `k` from `ratedGames`
 * (`kFor`, 10 games and so K 16 by default). Pure, for
 * tests and the dev kit; read through the same `rowReason` / `resultOdds` the page's loader uses.
 */
export function breakdownFromResult(
  result: ResultView,
  options: {
    ratedGames?: ReadonlyMap<string, number>;
    botBlueWinProb?: number | null;
    botOddsModel?: 'openskill' | 'kustom' | null;
  } = {},
): GameBreakdown {
  const seats = [...result.blue, ...result.red];
  const ratings = (list: typeof seats) =>
    list.flatMap((seat) => (seat.rBefore === null ? [] : [seat.rBefore]));
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  const blueR = ratings(result.blue);
  const redR = ratings(result.red);
  const blueP = blueR.length === 5 && redR.length === 5 ? winProbability(sum(blueR), sum(redR)) : null;

  const rows: BreakdownRow[] = seats.map((seat) => {
    const rated = blueP !== null && seat.rBefore !== null && seat.rAfter !== null;
    const expected = blueP === null ? null : seat.side === 100 ? blueP : 1 - blueP;
    const n = options.ratedGames?.get(seat.puuid) ?? 10;
    return {
      playerId: seat.puuid,
      side: seat.side,
      rBefore: rated ? seat.rBefore : null,
      rAfter: rated ? seat.rAfter : null,
      k: rated ? kFor(n) : null,
      foldP: rated ? expected : null,
      ratedGamesBefore: rated ? n : null,
      shareRank: null,
      award: rated ? 'none' : null,
      weekRBefore: null,
      weekRAfter: null,
      weekK: null,
      weekFoldP: null,
      weekGamesBefore: null,
    };
  });
  const game: BreakdownGame = {
    winningSide: result.winningSide,
    botBlueWinProb: options.botBlueWinProb === undefined ? result.blueWinProb : options.botBlueWinProb,
    botOddsModel: options.botOddsModel ?? 'openskill',
    rows,
  };
  const reasons = new Map<string, KustomReason | null>(
    rows.map((row) => [row.playerId, rowReason(game, row.playerId)]),
  );
  return { gameId: result.gameId, odds: resultOdds(game), reasons };
}
