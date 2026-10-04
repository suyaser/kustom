'use client';

import { useEffect, useState } from 'react';
import { type KustomSessionState, probeSession } from '@/lib/landing/sessionProbe';

/**
 * The visitor's session state for a static page's island: `signed-out` on the server and on the
 * first client render (so the hydrated markup matches the prerendered HTML), then the shared
 * {@link probeSession} answer.
 */
export function useKustomSession(): KustomSessionState {
  const [state, setState] = useState<KustomSessionState>('signed-out');
  useEffect(() => {
    let live = true;
    void probeSession().then((answer) => {
      if (live) setState(answer);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
