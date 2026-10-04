import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, readTheme, THEME_COLOR, THEME_PICKER_LABEL, THEME_STORAGE_KEY } from '@/lib/theme';
import { ThemeSwitch } from './ThemeSwitch';

describe('ThemeSwitch', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'night';
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it('is a switch, Night on by default', () => {
    render(<ThemeSwitch />);

    const toggle = screen.getByRole('switch', { name: THEME_PICKER_LABEL });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveTextContent('Day');
    expect(toggle).toHaveTextContent('Night');
  });

  it('follows the document theme after mount, so a refresh cannot disagree', async () => {
    document.documentElement.dataset.theme = 'day';
    render(<ThemeSwitch />);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: THEME_PICKER_LABEL })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });
  });

  it('flips to Day on the document and in localStorage', async () => {
    render(<ThemeSwitch />);

    fireEvent.click(screen.getByRole('switch', { name: THEME_PICKER_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: THEME_PICKER_LABEL })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });
    expect(document.documentElement.dataset.theme).toBe('day');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('day');
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
    applyTheme('day');

    expect(document.documentElement.dataset.theme).toBe('day');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('day');
    expect(readTheme()).toBe('day');
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
});
