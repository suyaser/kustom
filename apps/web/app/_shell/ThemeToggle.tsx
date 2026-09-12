'use client';

import { useState } from 'react';
import {
  applyTheme,
  readTheme,
  THEME_LABELS,
  THEME_ORDER,
  THEME_PICKER_LABEL,
  type ThemeKind,
} from '@/lib/theme';

/**
 * Day / Night / Current. Day is the default; Night is the same gaming look after dark;
 * Current is Floodlit and lives in `theme-current.css` so it can be deleted in one pass.
 *
 * Client for one reason: the choice is on this device. The first paint is already the
 * stored theme — the root layout's beforeInteractive script writes `data-theme` — so the
 * chips only have to match it.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeKind>(readTheme);

  function pick(next: ThemeKind) {
    setTheme(next);
    applyTheme(next);
  }

  return (
    <fieldset className="cn-themes">
      <legend className="cn-sr">{THEME_PICKER_LABEL}</legend>
      {THEME_ORDER.map((kind) => (
        <label key={kind} className={kind === theme ? 'cn-theme cn-theme-on' : 'cn-theme'}>
          <input
            type="radio"
            name="cn-theme"
            className="cn-sr"
            checked={kind === theme}
            onChange={() => pick(kind)}
          />
          {THEME_LABELS[kind]}
        </label>
      ))}
    </fieldset>
  );
}
