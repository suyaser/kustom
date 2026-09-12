import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  readTheme,
  THEME_COLOR,
  THEME_COLOR_CURRENT_LIGHT,
  THEME_LABELS,
  THEME_PICKER_LABEL,
  THEME_STORAGE_KEY,
} from '@/lib/theme';
import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'day';
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it('marks Day by default and offers Night and Current', () => {
    render(<ThemeToggle />);

    expect(screen.getByRole('group', { name: THEME_PICKER_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: THEME_LABELS.day })).toBeChecked();
    expect(screen.getByRole('radio', { name: THEME_LABELS.night })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: THEME_LABELS.current })).not.toBeChecked();
  });

  it('writes Night onto the document and into localStorage', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('radio', { name: THEME_LABELS.night }));

    expect(screen.getByRole('radio', { name: THEME_LABELS.night })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('night');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('night');
  });

  it('can restore Current, the isolated Floodlit look', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('radio', { name: THEME_LABELS.current }));

    expect(screen.getByRole('radio', { name: THEME_LABELS.current })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('current');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('current');
  });
});

describe('applyTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_STORAGE_KEY);
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.remove();
    }
  });

  it('writes data-theme and localStorage', () => {
    applyTheme('night');

    expect(document.documentElement.dataset.theme).toBe('night');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('night');
    expect(readTheme()).toBe('night');
  });

  it('updates theme-color when the meta tag is present', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.append(meta);

    applyTheme('day');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR.day);

    applyTheme('night');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR.night);
  });

  it('uses Floodlit light chrome when Current meets a light OS', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.append(meta);

    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-color-scheme: light'),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as typeof window.matchMedia;

    applyTheme('current');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR_CURRENT_LIGHT);

    window.matchMedia = original;
  });
});
