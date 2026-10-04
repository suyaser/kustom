import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginViewer } from './adminGroup';

/** `/admin/login` in 2.0 (M14.23 follow-up): its three states. Role and text queries. */

const viewer = vi.fn<() => Promise<LoginViewer>>();
vi.mock('./adminGroup', () => ({ loginViewer: () => viewer() }));
const redirect = vi.fn((href: string) => {
  throw new Error(`NEXT_REDIRECT ${href}`);
});
vi.mock('next/navigation', () => ({ redirect: (href: string) => redirect(href) }));

async function draw(params: Record<string, string> = {}) {
  const { default: AdminLoginPage } = await import('./page');
  return render(await AdminLoginPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => viewer.mockReset());

describe('/admin/login', () => {
  it('signed out: one h1 and Sign in with Discord as a POST form that comes back here', async () => {
    viewer.mockResolvedValue({ kind: 'anonymous' });
    await draw();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const form = screen.getByRole('button', { name: 'Sign in with Discord' }).closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/auth/signin');
    expect(form?.querySelector('input[name="next"]')).toHaveValue('/admin/login');
  });

  it('opens with the skip link, which lands on a focusable main (M14.42, quality A11)', async () => {
    viewer.mockResolvedValue({ kind: 'anonymous' });
    const { container } = await draw();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(container.querySelector('a')).toBe(skip);
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
  });

  it("running a group: a link to that group's admin, never the bare /admin", async () => {
    viewer.mockResolvedValue({ kind: 'runs-group', href: '/g/friday-five/admin' as never });
    await draw();
    expect(screen.getByRole('link', { name: 'Open admin' })).toHaveAttribute('href', '/g/friday-five/admin');
    expect(screen.queryByRole('link', { name: 'Open admin' })).not.toHaveAttribute('href', '/admin');
  });

  it('running no group: the denied line, the Members page as the fix, and Use another Discord account', async () => {
    viewer.mockResolvedValue({ kind: 'denied' });
    await draw();
    expect(screen.getByRole('alert')).toHaveTextContent("This Discord account doesn't run a group here.");
    expect(screen.getByText(/the group's Members page/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('/admin/players');
    expect(
      screen.getByRole('button', { name: 'Use another Discord account' }).closest('form'),
    ).toHaveAttribute('action', '/auth/signout');
  });

  it('prints a refused sign-in as an alert', async () => {
    viewer.mockResolvedValue({ kind: 'anonymous' });
    await draw({ error: 'you said no' });
    expect(screen.getByRole('alert')).toHaveTextContent("Sign-in didn't work: you said no");
  });

  it("M14.51: the group's creator before linking goes straight to its admin home", async () => {
    viewer.mockResolvedValue({ kind: 'creator-unlinked', href: '/g/friday-five/admin' as never });
    await expect(draw()).rejects.toThrow('NEXT_REDIRECT /g/friday-five/admin');
    expect(redirect).toHaveBeenCalledWith('/g/friday-five/admin');
  });

  it('M14.51: the denied help says how to link, without "tap your name first"', async () => {
    viewer.mockResolvedValue({ kind: 'denied' });
    await draw();
    expect(
      screen.getByText(
        /Open your group's tonight page and tap your name next time you're in the lobby, or type a code into Kustom\./,
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('tap your name first');
  });
});
