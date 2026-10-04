'use client';

import { applyTheme, otherTheme, THEME_LABELS, THEME_ORDER, THEME_PICKER_LABEL } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useTheme } from './useTheme';

/**
 * Day / Night, in More's `You` card (M14.7; it left the top bar). The same switch as 1.0's: one
 * `role="switch"` named `Theme`, checked on Night, both words always visible with the current one
 * on a raised segment and bold. It writes `data-theme` and localStorage through `lib/theme`, and reads
 * `data-theme` live (M14.47), so the top bar's toggle and this one stay in step.
 */
export function ThemeSwitch() {
  const theme = useTheme();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === 'night'}
      aria-label={THEME_PICKER_LABEL}
      onClick={() => {
        applyTheme(otherTheme(theme));
      }}
      className="inline-flex min-h-11 shrink-0 items-stretch gap-1 rounded-control border border-border-strong bg-background p-1"
    >
      {THEME_ORDER.map((kind) => (
        <span
          key={kind}
          className={cn(
            'flex items-center rounded-chip px-3 text-sm text-muted-foreground',
            kind === theme && 'bg-raised font-bold text-foreground',
          )}
        >
          {THEME_LABELS[kind]}
        </span>
      ))}
    </button>
  );
}
