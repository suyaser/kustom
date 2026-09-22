import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminNav } from './AdminNav';

const pathname = vi.hoisted(() => ({ current: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

function draw(path: string) {
  pathname.current = path;
  return render(<AdminNav />);
}

describe('AdminNav', () => {
  it('marks only the index current on /admin', () => {
    draw('/admin');
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Players' })).not.toHaveAttribute('aria-current');
  });

  it('marks Players current on /admin/players, not the index', () => {
    draw('/admin/players');
    expect(screen.getByRole('link', { name: 'Players' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Admin' })).not.toHaveAttribute('aria-current');
  });

  it('never marks Tonight current', () => {
    draw('/');
    expect(screen.getByRole('link', { name: 'Tonight' })).not.toHaveAttribute('aria-current');
  });
});
