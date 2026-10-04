import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAIRING_CODE_EXPIRED } from '@/lib/groups/copy';
import {
  GET_CODE_LABEL,
  NEW_CODE_LABEL,
  PAIRING_EXPIRED_LINE,
  PAIRING_TTL_LINE,
} from '@/lib/groups/pageCopy';
import { PAIRING_POLL_MS, PairingCode } from './PairingCode';

/**
 * The pairing code's life (M13.13 acceptance 3, M14.21): asked for, shown, polled every 3 s on a fake
 * clock, and moved on when the status says `used`. Role and text queries only.
 */

const INVITE = 'AbCdEfGhIjKlMnOpQrStUv';
const GROUP = { id: '11111111-1111-4111-8111-111111111111', slug: 'friday-five', name: 'Friday Five' };
const EXPIRES = '2026-10-03T21:15:00.000Z';

type Answer = { status: number; body: unknown };

function json({ status, body }: Answer): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fake API: the issue answers come from `issues`, the polls from `polls`, in order. */
function fakeApi(issues: Answer[], polls: Answer[]) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/me/pairing') return json(issues.shift() ?? { status: 500, body: {} });
    return json(polls.shift() ?? { status: 200, body: { ok: true, status: 'waiting', expiresAt: EXPIRES } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const issued: Answer = { status: 200, body: { ok: true, code: 'K7QX2M', expiresAt: EXPIRES, group: GROUP } };
const waiting: Answer = { status: 200, body: { ok: true, status: 'waiting', expiresAt: EXPIRES } };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the pairing code', () => {
  it('asks for a code on arrival, shows it with the 15-minute line, and moves on when Kustom uses it', async () => {
    const { calls } = fakeApi(
      [issued],
      [waiting, { status: 200, body: { ok: true, status: 'used', group: GROUP } }],
    );
    const onUsed = vi.fn();
    render(<PairingCode request={{ inviteCode: INVITE }} autoStart onUsed={onUsed} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('K7QX2M')).toBeInTheDocument();
    expect(screen.getByText(PAIRING_TTL_LINE)).toBeInTheDocument();
    expect(calls[0]).toBe('POST /api/me/pairing');

    // Nothing is asked before the first 3 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS - 1);
    });
    expect(calls).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(calls[1]).toBe('GET /api/me/pairing/status?code=K7QX2M');
    expect(onUsed).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
    });
    expect(onUsed).toHaveBeenCalledWith(GROUP);

    // And stops asking.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS * 3);
    });
    expect(calls).toHaveLength(3);
  });

  it('on expiry says the code ran out and offers a new one, which asks again', async () => {
    const { calls } = fakeApi(
      [issued, { status: 200, body: { ok: true, code: 'P9WZ4T', expiresAt: EXPIRES, group: GROUP } }],
      [{ status: 200, body: { ok: true, status: 'expired' } }],
    );
    render(<PairingCode request={{ inviteCode: INVITE }} autoStart onUsed={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(PAIRING_EXPIRED_LINE);
    expect(screen.queryByText('K7QX2M')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: NEW_CODE_LABEL }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('P9WZ4T')).toBeInTheDocument();
    expect(calls.filter((call) => call === 'POST /api/me/pairing')).toHaveLength(2);
  });

  it("prints the server's refusal in place, never a toast", async () => {
    fakeApi([{ status: 404, body: { ok: false, error: PAIRING_CODE_EXPIRED } }], []);
    render(<PairingCode request={{ inviteCode: INVITE }} autoStart onUsed={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(PAIRING_CODE_EXPIRED);
    expect(screen.getByRole('button', { name: NEW_CODE_LABEL })).toBeInTheDocument();
  });

  it('on the admin card waits for a tap: a page view mints no code', async () => {
    const { calls } = fakeApi([issued], []);
    render(<PairingCode request={{ groupId: GROUP.id }} autoStart={false} onUsed={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS * 2);
    });
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: GET_CODE_LABEL }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('K7QX2M')).toBeInTheDocument();
    expect(calls).toEqual(['POST /api/me/pairing']);
  });
});
