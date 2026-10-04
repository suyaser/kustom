'use client';

import { applyTheme, otherTheme, THEME_SWITCH_TO_LABEL } from '@/lib/theme';
import { useHydrated, useTheme } from './useTheme';

/**
 * Day / Night as one icon button in the top bar of every page (M14.47): a sun in Night (tap for
 * Day), a moon in Day (tap for Night), named for what it does, `Switch to Day` / `Switch to Night`.
 * 44 x 44. It writes through `applyTheme` and reads `data-theme` live, so the You page's switch and
 * this one stay in step.
 *
 * It cannot work without JavaScript, so it is invisible (space kept, out of the accessibility tree)
 * until hydrated; the inline bootstrap still sets the stored theme before first paint. The glyphs
 * are inline SVG in TabIcon's stroke family (the project carries no icon package).
 */
export function ThemeToggle() {
  const theme = useTheme();
  const hydrated = useHydrated();
  const next = otherTheme(theme);
  const label = THEME_SWITCH_TO_LABEL[next];

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => applyTheme(next)}
      style={hydrated ? undefined : { visibility: 'hidden' }}
      className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="size-6"
      >
        {theme === 'night' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </>
        ) : (
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        )}
      </svg>
    </button>
  );
}
