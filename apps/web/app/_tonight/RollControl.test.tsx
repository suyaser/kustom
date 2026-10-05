import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOBBY_ABANDONED } from '@/lib/admin/rerollCopy';
import { STALE_ROSTER } from '@/lib/admin/roll';
import { lobbyRosterKey } from '@/lib/ingest/lobby';
import { modeStoreThisGameForTests, resetModeStoreForTests, thisGameNoticeOf } from '@/lib/mode/clientStore';
import { holdTonightRefresh } from '@/lib/testing/heldTonightRefresh';
import { extraMember, workedMembers } from '@/lib/testing/tonightFixtures';
import { ROLL_FAILED, ROLL_LABEL, ROLL_UNREACHABLE } from '@/lib/tonight/copy';
import type { MemberView } from '@/lib/tonight/types';
import { RollControl } from './RollControl';

/**
 * `Roll teams` (2026-10-03). What a night cannot be run to re-check: the press names the roster
 * the page drew in exactly the form the route recomputes it, a 409 is printed in the route's
 * own words and asks the page to re-read rather than giving up, and a success re-reads too. The
 * route's own rules are `roll.integration.test.ts`.
 */

const LOBBY_ID = '0b0e5a1c-3f7d-4c2a-9a51-1d2e3f4a5b6c';
const ACTION = `/api/admin/lobbies/${LOBBY_ID}/roll`;

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response),
  );
}

function rolled(outcome: 'rolled' | 'already_rolled' = 'rolled') {
  return {
    ok: true,
    lobbyId: LOBBY_ID,
    status: 'balanced',
    splitId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    outcome,
  };
}

function lastCall(): [string, RequestInit] {
  const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  const call = calls[calls.length - 1];
  if (call === undefined) throw new Error('fetch was not called');
  return call;
}

function draw(members: readonly MemberView[] = workedMembers(), onSettled?: () => void) {
  return render(<RollControl lobbyId={LOBBY_ID} members={members} onSettled={onSettled} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the roll control', () => {
  it('is a real form to the roll route, with the no-JavaScript fallback in it', () => {
    const members = [...workedMembers(), extraMember()];
    const { container } = draw(members);

    expect(container.querySelector('form')).toHaveAttribute('action', ACTION);
    expect(container.querySelector('form')).toHaveAttribute('method', 'post');
    expect(container.querySelector('input[name="rosterKey"]')).toHaveValue(
      lobbyRosterKey(members.map((member) => member.puuid)),
    );
    expect(container.querySelector('input[name="redirectTo"]')).toHaveValue('/g/customs');
    expect(screen.queryByText(/Check everyone/)).toBeNull();
    expect(screen.getByRole('button', { name: ROLL_LABEL })).toBeEnabled();
  });

  it('posts JSON naming every member on screen, spectators included, as the route recomputes it', async () => {
    answer(200, rolled());
    const members = [...workedMembers(), extraMember()];
    const settled = vi.fn();
    draw([...members].reverse(), settled);

    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));

    await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    const [url, init] = lastCall();
    expect(url).toBe(ACTION);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      groupId: ORIGINAL_GROUP_ID,
      rosterKey: lobbyRosterKey(members.map((member) => member.puuid)),
    });
    // Teams up: nothing to say here, the block is about to be replaced by the teams.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("M20 D11: keeps the answer's short-pair notice for this lobby's Mode card", async () => {
    resetModeStoreForTests();
    const line = 'Targon vs Zaun ran short after the bans, so Roll drew Shurima vs Zaun.';
    answer(200, { ...rolled(), modeNotice: line });
    const settled = vi.fn();
    draw(workedMembers(), settled);
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    expect(thisGameNoticeOf(modeStoreThisGameForTests(), ORIGINAL_GROUP_ID, LOBBY_ID)).toBe(line);
    // Another lobby never shows it.
    expect(thisGameNoticeOf(modeStoreThisGameForTests(), ORIGINAL_GROUP_ID, 'another')).toBeNull();
    resetModeStoreForTests();
  });

  it('treats a repeat press as a success, not a refusal', async () => {
    answer(200, rolled('already_rolled'));
    const settled = vi.fn();
    draw(workedMembers(), settled);

    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));

    await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('prints a stale-roster 409 in the route words, re-reads the roster, and stays pressable', async () => {
    answer(409, { ok: false, error: STALE_ROSTER });
    const settled = vi.fn();
    draw(workedMembers(), settled);

    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));

    const alert = await screen.findByRole('alert');
    // The route's sentence, given a capital and a stop because it stands alone here.
    expect(alert).toHaveTextContent(
      'The lobby changed since you looked: somebody joined or left, so nothing was rolled. Check the roster and press again.',
    );
    expect(settled).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: ROLL_LABEL })).toBeEnabled());
  });

  it("M22.6: with two lobbies live, an abandoned lobby's 409 reads That lobby has ended.", async () => {
    answer(409, { ok: false, error: LOBBY_ABANDONED });
    render(<RollControl lobbyId={LOBBY_ID} members={workedMembers()} severalLobbies />);
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^That lobby has ended\.$/);
  });

  it('M22.6: with one lobby the same 409 is printed in the route words, as before', async () => {
    answer(409, { ok: false, error: LOBBY_ABANDONED });
    draw();
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^That lobby was abandoned\.$/);
  });

  it('presses again with the roster the re-read brought', async () => {
    answer(409, { ok: false, error: STALE_ROSTER });
    const { rerender } = draw(workedMembers(10));
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    await screen.findByRole('alert');

    // Somebody swapped in: the page re-read and drew the new ten.
    const swapped = [...workedMembers(9), extraMember({ isSpectator: false })];
    rerender(<RollControl lobbyId={LOBBY_ID} members={swapped} />);
    answer(200, rolled());
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(JSON.parse(String(lastCall()[1].body))).toEqual({
      groupId: ORIGINAL_GROUP_ID,
      rosterKey: lobbyRosterKey(swapped.map((member) => member.puuid)),
    });
  });

  it('keeps a sentence that already ends, and has its own for a refusal with none', async () => {
    answer(409, { ok: false, error: 'the teams are being made right now; they will be up in a moment' });
    const { unmount } = draw();
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The teams are being made right now; they will be up in a moment.',
    );
    unmount();

    answer(500, null);
    draw();
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ROLL_FAILED);
  });

  it('says so when the press never reached the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    const settled = vi.fn();
    draw(workedMembers(), settled);

    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));

    expect(await screen.findByRole('alert')).toHaveTextContent(ROLL_UNREACHABLE);
    expect(settled).not.toHaveBeenCalled();
  });

  it('sends one press while one is in flight', async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    draw();

    const button = screen.getByRole('button', { name: ROLL_LABEL });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    // Never the attribute: a disabled control drops the focus to `<body>` (M3.20).
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);

    release({ ok: true, status: 200, json: async () => rolled() } as unknown as Response);
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
  });

  it('M19.3: stays pending until the re-read it asked for has landed, and a press meanwhile sends nothing', async () => {
    const tonight = holdTonightRefresh();
    answer(200, rolled());
    draw();
    const button = screen.getByRole('button', { name: ROLL_LABEL });
    const before = Date.now();

    fireEvent.click(button);
    // The route answered; the page asked Tonight once, with the time it answered.
    await waitFor(() => expect(tonight.asks).toHaveLength(1));
    expect(tonight.asks[0]).toBeGreaterThanOrEqual(before);
    // The old screen is still up: still quiet, and a second press posts nothing.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);

    act(() => tonight.land());
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
    tonight.stop();
  });

  it('M19.3: a refusal holds the button until the roster it is about is on screen', async () => {
    const tonight = holdTonightRefresh();
    answer(409, { ok: false, error: STALE_ROSTER });
    draw();
    const button = screen.getByRole('button', { name: ROLL_LABEL });
    fireEvent.click(button);
    await screen.findByRole('alert');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    act(() => tonight.land());
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
    tonight.stop();
  });
});
