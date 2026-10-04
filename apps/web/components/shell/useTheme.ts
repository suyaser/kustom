'use client';

import { useSyncExternalStore } from 'react';
import { readTheme, THEME_DEFAULT, type ThemeKind } from '@/lib/theme';

/**
 * The document's theme, live (M14.47). Every theme control reads `data-theme` on `<html>` through a
 * MutationObserver, so flipping one (the top bar's toggle, the You page's switch) updates the others
 * without a reload. `applyTheme` stays the only writer.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const serverTheme = (): ThemeKind => THEME_DEFAULT;

export function useTheme(): ThemeKind {
  return useSyncExternalStore(subscribe, readTheme, serverTheme);
}

const noSubscription = () => () => {};

/** False on the server and during hydration, true once the client has taken over. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
