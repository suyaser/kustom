import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { THEME_PICKER_LABEL, THEME_STORAGE_KEY } from '@/lib/theme';
import { BareShell } from './BareShell';
import { Shell } from './Shell';
import { ThemeSwitch } from './ThemeSwitch';
import { ThemeToggle } from './ThemeToggle';

/** M14.47: the Day / Night icon button in the top bar of every page. Role and name queries only. */

vi.mock('next/navigation', () => ({ usePathname: () => '/g/customs' }));

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'night';
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it('offers Day in Night', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to Day' })).toBeInTheDocument();
  });

  it('offers Night when the document is already Day', () => {
    document.documentElement.dataset.theme = 'day';
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to Night' })).toBeInTheDocument();
  });

  it('flips data-theme and localStorage, and renames itself, both ways', async () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Day' }));
    expect(document.documentElement.dataset.theme).toBe('day');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('day');

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Night' }));
    expect(document.documentElement.dataset.theme).toBe('night');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('night');
    expect(await screen.findByRole('button', { name: 'Switch to Day' })).toBeInTheDocument();
  });

  it("stays in step with the You page's switch, both directions, without a reload", async () => {
    render(
      <>
        <ThemeToggle />
        <ThemeSwitch />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Day' }));
    expect(
      await screen.findByRole('switch', { name: THEME_PICKER_LABEL, checked: false }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: THEME_PICKER_LABEL }));
    expect(await screen.findByRole('button', { name: 'Switch to Day' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: THEME_PICKER_LABEL })).toHaveAttribute('aria-checked', 'true');
  });

  it('follows a theme change made anywhere else on the document', async () => {
    render(<ThemeToggle />);
    document.documentElement.dataset.theme = 'day';
    expect(await screen.findByRole('button', { name: 'Switch to Night' })).toBeInTheDocument();
  });
});

describe('the toggle is on every page', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'night';
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it("is in the group shell's top bar, inside the banner", () => {
    render(
      <Shell group={ORIGINAL_GROUP} isAdmin={false} account="anonymous">
        <p>page body</p>
      </Shell>,
    );
    const banner = screen.getByRole('banner');
    expect(banner).toContainElement(screen.getByRole('button', { name: 'Switch to Day' }));
  });

  it("is in the bare shell's header, beside whatever the page puts there", () => {
    render(
      <BareShell headerEnd={<a href="/auth/signin">Sign in</a>}>
        <p>page body</p>
      </BareShell>,
    );
    const banner = screen.getByRole('banner');
    expect(banner).toContainElement(screen.getByRole('button', { name: 'Switch to Day' }));
    expect(banner).toContainElement(screen.getByRole('link', { name: 'Sign in' }));
  });
});
