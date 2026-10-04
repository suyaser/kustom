'use client';

import { useEffect } from 'react';
import { type Connection, resetLiveState, setLiveState } from '@/lib/tonight/live';

/** Dev-only stand-in for `TonightLive`: puts the live tag and the tab dot in a fixed state. */
export function KitLive({ connection, lobbyLive }: { connection: Connection; lobbyLive: boolean }) {
  useEffect(() => {
    setLiveState({ connection, lobbyLive, mounted: true });
    return resetLiveState;
  }, [connection, lobbyLive]);
  return null;
}
