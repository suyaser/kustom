/**
 * Public-page themes: Day and Night, two palettes of one look; Night is the default.
 *
 * Anything else stored under the key (the short-lived 1.0 `current`, retired in M14.25) is ignored,
 * which lands on the server-rendered default, Night.
 */

export const THEME_STORAGE_KEY = 'cn-theme';

export const THEME_DEFAULT = 'night';

export const THEME_ORDER = ['day', 'night'] as const;

export type ThemeKind = (typeof THEME_ORDER)[number];

/** The nav group, and the name of the control. */
export const THEME_PICKER_LABEL = 'Theme';

export const THEME_LABELS: Readonly<Record<ThemeKind, string>> = {
  day: 'Day',
  night: 'Night',
};

/** The top bar's icon toggle (M14.47), named for the theme it switches to. */
export const THEME_SWITCH_TO_LABEL: Readonly<Record<ThemeKind, string>> = {
  day: 'Switch to Day',
  night: 'Switch to Night',
};

/** Phone chrome, one hex per theme. */
export const THEME_COLOR: Readonly<Record<ThemeKind, string>> = {
  day: '#e8eef6',
  night: '#05070c',
};

/**
 * Inline, before first paint, in the root layout. Only a stored `day` or `night` is applied, so a
 * refresh cannot land on a theme the switch does not offer.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==='day'||t==='night')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export function parseTheme(value: string | null | undefined): ThemeKind | null {
  if (value === 'day' || value === 'night') return value;
  return null;
}

export function readTheme(): ThemeKind {
  if (typeof document === 'undefined') return THEME_DEFAULT;
  return parseTheme(document.documentElement.dataset.theme) ?? THEME_DEFAULT;
}

export function otherTheme(theme: ThemeKind): ThemeKind {
  return theme === 'night' ? 'day' : 'night';
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
  meta.setAttribute('content', THEME_COLOR[theme]);
}
