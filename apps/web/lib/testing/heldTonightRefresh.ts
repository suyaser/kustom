import { TONIGHT_REFRESH_EVENT, type TonightRefreshDetail } from '@/lib/tonight/live';

/**
 * A stand-in for a mounted `TonightLive` in a control's test (M19.3): it answers every
 * `requestTonightRefresh` with a render the test lands by hand, so "pending until the screen
 * changes" can be checked without the page. Tests only.
 */
export interface HeldTonightRefresh {
  /** Every ask so far, with the time its route answered. */
  asks: number[];
  /** Land every render asked for so far. */
  land(): void;
  stop(): void;
}

export function holdTonightRefresh(): HeldTonightRefresh {
  const asks: number[] = [];
  const open: (() => void)[] = [];
  const onAsk = (event: Event): void => {
    const detail = (event as CustomEvent<TonightRefreshDetail | undefined>).detail;
    if (detail === undefined || detail === null) return;
    asks.push(detail.answeredAt);
    detail.answered = new Promise<void>((resolve) => open.push(resolve));
  };
  window.addEventListener(TONIGHT_REFRESH_EVENT, onAsk);
  return {
    asks,
    land() {
      for (const resolve of open.splice(0)) resolve();
    },
    stop() {
      window.removeEventListener(TONIGHT_REFRESH_EVENT, onAsk);
      for (const resolve of open.splice(0)) resolve();
    },
  };
}
