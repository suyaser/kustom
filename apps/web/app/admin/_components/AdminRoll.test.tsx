import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLL_NOTICE_ALREADY, ROLL_NOTICE_ROLLED } from '@/lib/admin/notices';
import type { RollableLobby } from '@/lib/admin/rollable';
import { lobbyRosterKey } from '@/lib/ingest/lobby';
import { ROLL_ADMIN_HINT, ROLL_LABEL } from '@/lib/tonight/copy';
import { AdminRoll, NO_ROLLABLE_LOBBY, waitingLine } from './AdminRoll';

/**
 * `/admin`'s Roll card (2026-10-03). The route's own rules are `roll.integration.test.ts`'s;
 * this pins the card: when it offers the press, what the press posts (the server-computed key,
 * byte for byte), and that the answer lands beside it in the route's or the notice's words.
 */

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const LOBBY_ID = '6f0b8a7e-2b1c-4c8e-9f3a-1d2e3f4a5b6c';
const SPLIT_ID = '0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

function lobby(count: number, overrides: Partial<RollableLobby> = {}): RollableLobby {
  const members = Array.from({ length: count }, (_, i) => ({
    puuid: `puuid-${String(i).padStart(2, '0')}`,
    label: `Player ${i + 1}`,
    spectator: i === 10,
  }));
  return {
    id: LOBBY_ID,
    lobbyName: 'Customs 03 Oct #1',
    status: 'open',
    stage: count >= 10 ? 'ready' : 'waiting',
    around: count,
    rosterKey: lobbyRosterKey(members.map((member) => member.puuid)),
    members,
    ...overrides,
  };
}

function answer(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

function press(): void {
  fireEvent.submit(screen.getByRole('button', { name: ROLL_LABEL }).closest('form') as HTMLFormElement);
}

beforeEach(() => refresh.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('when there is nothing to roll', () => {
  it('says so, with no button, as the Reroll card does when it has nothing', () => {
    render(<AdminRoll lobby={null} />);
    expect(screen.getByText(NO_ROLLABLE_LOBBY)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers no press under ten, where the route would refuse, and says how far off it is', () => {
    render(<AdminRoll lobby={lobby(7)} />);
    expect(screen.queryByRole('button', { name: ROLL_LABEL })).not.toBeInTheDocument();
    expect(screen.getByText(waitingLine(7))).toBeInTheDocument();
    expect(waitingLine(7)).toBe('3 more to go before teams can be rolled.');
    expect(screen.getByText(/Player 1, Player 2/)).toBeInTheDocument();
  });
});

describe('the press', () => {
  it('names the roster on screen, spectators included, and posts its server-computed key', async () => {
    const eleven = lobby(11);
    answer({ ok: true, lobbyId: LOBBY_ID, status: 'balanced', splitId: SPLIT_ID, outcome: 'rolled' });
    render(<AdminRoll lobby={eleven} />);

    expect(screen.getByText(ROLL_ADMIN_HINT)).toBeInTheDocument();
    expect(screen.getByText(/Player 11 \(spectating\)/)).toBeInTheDocument();

    const form = screen.getByRole('button', { name: ROLL_LABEL }).closest('form') as HTMLFormElement;
    // The no-JS path: a real form against the real route, coming back to /admin.
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe(`/api/admin/lobbies/${LOBBY_ID}/roll`);

    press();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] =
      (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] ?? [];
    expect(url).toBe(`/api/admin/lobbies/${LOBBY_ID}/roll`);
    expect(JSON.parse(String(init?.body))).toEqual({ rosterKey: eleven.rosterKey, redirectTo: '/admin' });
    // The key is the route's own function over the same puuids, not a page-side format.
    expect(eleven.rosterKey).toBe(lobbyRosterKey(eleven.members.map((member) => member.puuid)));

    expect(await screen.findByRole('status')).toHaveTextContent(ROLL_NOTICE_ROLLED);
    expect(refresh).toHaveBeenCalled();
  });

  it('says nothing was posted again on a repeat press', async () => {
    answer({ ok: true, lobbyId: LOBBY_ID, status: 'balanced', splitId: SPLIT_ID, outcome: 'already_rolled' });
    render(<AdminRoll lobby={lobby(10)} />);
    press();
    expect(await screen.findByRole('status')).toHaveTextContent(ROLL_NOTICE_ALREADY);
  });

  it("prints a refusal in the route's own words, and keeps the button", async () => {
    const stale = 'the lobby changed since you looked: somebody joined or left, so nothing was rolled.';
    answer({ ok: false, error: stale }, false);
    render(<AdminRoll lobby={lobby(10)} />);
    press();
    expect(await screen.findByRole('alert')).toHaveTextContent(stale);
    expect(screen.getByRole('button', { name: ROLL_LABEL })).toBeInTheDocument();
  });

  it('offers the press to repair a balanced lobby whose roll never wrote its teams', () => {
    render(<AdminRoll lobby={lobby(10, { status: 'balanced', stage: 'repair' })} />);
    expect(screen.getByText(/balanced, but no teams were written/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ROLL_LABEL })).toBeInTheDocument();
  });
});
