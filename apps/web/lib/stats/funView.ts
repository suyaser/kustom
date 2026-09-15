import { windowRangeLabel } from '../board/window';
import { GAMES_QUEUE, type QueueKind } from '../games/queue';
import { countedGames } from './fold';
import { funFactsView } from './fun';
import type { FunFactsView } from './types';
import type { StatsInput } from './view';

/**
 * The whole of `/fun`, assembled from the same window read `/stats` makes (M5.24).
 *
 * Pure. `loadFunFacts` reads the rows and calls this; the page renders what comes back.
 * `queue` is which customs this snapshot is of — the loader already filtered the list.
 */

export function assembleFunFacts(input: StatsInput, queue: QueueKind = GAMES_QUEUE): FunFactsView {
  const counted = countedGames(input.games, { allMaps: true });
  const first = counted[0];
  const body = funFactsView(input.games, input.players, input.timeZone);

  return {
    ...body,
    window: input.window,
    queue,
    range:
      counted.length === 0
        ? null
        : windowRangeLabel(
            input.window,
            input.range,
            first === undefined ? null : new Date(first.startedAt),
            input.timeZone,
          ),
    capped: input.capped,
    cap: input.cap,
  };
}
