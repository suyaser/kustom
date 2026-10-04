'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { applyTheme, otherTheme, readTheme, THEME_LABELS, type ThemeKind } from '@/lib/theme';

/** The kit's Day/Night switch: the same `data-theme` + localStorage path as the public toggle. */
export function KitThemeToggle() {
  const [theme, setTheme] = useState<ThemeKind | null>(null);
  useEffect(() => setTheme(readTheme()), []);

  return (
    <Button
      variant="outline"
      onClick={() => {
        const next = otherTheme(readTheme());
        applyTheme(next);
        setTheme(next);
      }}
    >
      {theme === null ? 'Theme' : `Switch to ${THEME_LABELS[otherTheme(theme)]}`}
    </Button>
  );
}
