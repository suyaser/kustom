import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGN_IN_LABEL, SIGN_OUT_LABEL } from '@/lib/shellCopy';
import { hasSessionCookie, KustomSignIn, SESSION_PROBE_URL } from './KustomSignIn';

/**
 * The bare shell's account control as a client island (M19.18): the static Kustom pages ship
 * `Sign in`, and only a browser holding a Supabase cookie asks the server whether it is signed in.
 */

const COOKIE = 'sb-127-auth-token';

function setCookie(name: string, value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom's cookie jar is what the island reads.
  document.cookie = `${name}=${value}; path=/`;
}

function clearCookie(name: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom's cookie jar is what the island reads.
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function stubFetch(answer: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(answer);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  clearCookie(COOKIE);
  clearCookie('kustom_group');
  vi.unstubAllGlobals();
});

describe('hasSessionCookie', () => {
  it('finds a Supabase cookie and nothing else', () => {
    expect(hasSessionCookie('')).toBe(false);
    expect(hasSessionCookie('kustom_group=customs')).toBe(false);
    expect(hasSessionCookie('kustom_group=customs; sb-abc-auth-token=x')).toBe(true);
    expect(hasSessionCookie('sb-abc-auth-token.0=x')).toBe(true);
    // A cookie whose value merely mentions `sb-` is not one.
    expect(hasSessionCookie('note=sb-abc')).toBe(false);
  });
});

describe('KustomSignIn', () => {
  it('ships Sign in, and asks nobody when the browser holds no session cookie', async () => {
    setCookie('kustom_group', 'customs');
    const fetchMock = stubFetch(async () => new Response(null, { status: 200 }));
    render(<KustomSignIn />);

    const button = screen.getByRole('button', { name: SIGN_IN_LABEL });
    expect(button.closest('form')).toHaveAttribute('action', '/auth/signin');
    expect(button.closest('form')?.querySelector('input[name="next"]')).toHaveValue('/');
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns to Sign out once the server confirms the session', async () => {
    setCookie(COOKIE, 'token');
    const fetchMock = stubFetch(async () => new Response('{}', { status: 200 }));
    render(<KustomSignIn here="/download" />);

    const button = await screen.findByRole('button', { name: SIGN_OUT_LABEL });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(SESSION_PROBE_URL);
    const form = button.closest('form');
    expect(form).toHaveAttribute('action', '/auth/signout');
    expect(form).toHaveAttribute('data-session', 'signed-in');
    expect(form?.querySelector('input[name="next"]')).toHaveValue('/download');
    expect(screen.queryByRole('button', { name: SIGN_IN_LABEL })).toBeNull();
  });

  it.each([401, 403, 500])('stays Sign in when the server answers %i', async (status) => {
    setCookie(COOKIE, 'stale');
    const fetchMock = stubFetch(async () => new Response('{}', { status }));
    render(<KustomSignIn />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.getByRole('button', { name: SIGN_IN_LABEL }).closest('form')).toHaveAttribute(
      'data-session',
      'signed-out',
    );
  });

  it('stays Sign in when the request fails outright', async () => {
    setCookie(COOKIE, 'token');
    const fetchMock = stubFetch(async () => {
      throw new TypeError('offline');
    });
    render(<KustomSignIn />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: SIGN_IN_LABEL })).toBeInTheDocument();
  });

  it('keeps both words in the button so turning the label cannot shift the bar', async () => {
    setCookie(COOKIE, 'token');
    stubFetch(async () => new Response('{}', { status: 200 }));
    render(<KustomSignIn />);

    const signedOut = screen.getByRole('button', { name: SIGN_IN_LABEL });
    expect(signedOut).toHaveTextContent(SIGN_IN_LABEL);
    expect(signedOut).toHaveTextContent(SIGN_OUT_LABEL);
    expect(screen.getByText(SIGN_OUT_LABEL)).toHaveClass('invisible');

    const signedIn = await screen.findByRole('button', { name: SIGN_OUT_LABEL });
    expect(signedIn).toBe(signedOut);
    expect(screen.getByText(SIGN_IN_LABEL)).toHaveClass('invisible');
    expect(screen.getByText(SIGN_IN_LABEL)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(SIGN_OUT_LABEL)).not.toHaveClass('invisible');
  });
});
