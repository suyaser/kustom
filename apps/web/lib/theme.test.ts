import { describe, expect, it } from 'vitest';
import {
  parseTheme,
  THEME_BOOTSTRAP,
  THEME_DEFAULT,
  THEME_LABELS,
  THEME_ORDER,
  THEME_STORAGE_KEY,
} from './theme';

describe('parseTheme', () => {
  it('accepts the three names and nothing else', () => {
    expect(parseTheme('day')).toBe('day');
    expect(parseTheme('night')).toBe('night');
    expect(parseTheme('current')).toBe('current');
    expect(parseTheme('light')).toBeNull();
    expect(parseTheme('')).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });
});

describe('the default and the isolated Current', () => {
  it('defaults to Day, and Current is a named third option', () => {
    expect(THEME_DEFAULT).toBe('day');
    expect(THEME_ORDER).toEqual(['day', 'night', 'current']);
    expect(THEME_LABELS.current).toBe('Current');
  });

  it('writes the same three names the bootstrap script reads', () => {
    expect(THEME_BOOTSTRAP).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOTSTRAP).toContain("t==='day'");
    expect(THEME_BOOTSTRAP).toContain("t==='night'");
    expect(THEME_BOOTSTRAP).toContain("t==='current'");
  });
});
