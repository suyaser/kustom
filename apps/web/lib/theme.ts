/**
 * Public-page themes. Day and Night are the gaming look; Current is Floodlit, isolated
 * so it can be deleted without touching the rest.
 *
 * To drop Current: remove `current` from {@link THEME_ORDER} and {@link THEME_LABELS},
 * delete `app/theme-current.css` and its import in `app/layout.tsx`, and drop the Current
 * assertions in `app/_shell/ThemeToggle.test.tsx`.
 */

export const THEME_STORAGE_KEY = 'cn-theme';

export const THEME_DEFAULT = 'day';

export const THEME_ORDER = ['day', 'night', 'current'] as const;

export type ThemeKind = (typeof THEME_ORDER)[number];

/** The nav group, and the `<title>`-style name of the control. */
export const THEME_PICKER_LABEL = 'Theme';

export const THEME_LABELS: Readonly<Record<ThemeKind, string>> = {
  day: 'Day',
  night: 'Night',
  current: 'Current',
};

/** Phone chrome, one hex per forced theme. Current-on-light-OS is handled in {@link applyTheme}. */
export const THEME_COLOR: Readonly<Record<ThemeKind, string>> = {
  day: '#f1f4fa',
  night: '#080a10',
  current: '#0b0e14',
};

export const THEME_COLOR_CURRENT_LIGHT = '#eef1f6';

/**
 * Inline, before first paint. `beforeInteractive` in the root layout. Kept here so a test
 * can pin the key and the three names against the same constants the toggle uses.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==='day'||t==='night'||t==='current')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export function parseTheme(value: string | null | undefined): ThemeKind | null {
  if (value === 'day' || value === 'night' || value === 'current') return value;
  return null;
}

export function readTheme(): ThemeKind {
  if (typeof document === 'undefined') return THEME_DEFAULT;
  return parseTheme(document.documentElement.dataset.theme) ?? THEME_DEFAULT;
}

export function applyTheme(theme: ThemeKind): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode, first paint still has data-theme */
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta === null) return;

  const lightCurrent =
    theme === 'current' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  meta.setAttribute('content', lightCurrent ? THEME_COLOR_CURRENT_LIGHT : THEME_COLOR[theme]);
}
