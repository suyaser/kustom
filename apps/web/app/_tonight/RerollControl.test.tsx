import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_MORE_SPLITS } from '@/lib/admin/rerollCopy';
import { holdTonightRefresh } from '@/lib/testing/heldTonightRefresh';
import { REROLL_FAILED, REROLL_LABEL, REROLL_UNREACHABLE } from '@/lib/tonight/copy';
import type { SplitChoice } from '@/lib/tonight/types';
import { RerollControl } from './RerollControl';

/**
 * The reroll control (M3.2's button), brought into line with `RollControl` (and the lobby press, gone since M22.11) on
 * 2026-10-03: quiet and `aria-disabled` while a press is in flight — never the `disabled`
 * attribute, which drops the focus to `<body>` (M3.20) — with the real attribute kept for the one
 * permanent case, the last split. A refusal reads like the other two controls': the route's words
 * as a sentence, in `text` at 600.
 */

const LOBBY_ID = 'lobby-1';

function splits(chosen: number): SplitChoice[] {
  return [1, 2, 3].map((rank) => ({ id: `split-${rank}`, rank, isChosen: rank === chosen }));
}

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the reroll control', () => {
  it('posts the next split down the list', async () => {
    answer(200, { ok: true });
    render(<RerollControl lobbyId={LOBBY_ID} splits={splits(1)} />);

    fireEvent.click(screen.getByRole('button', { name: REROLL_LABEL }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] =
      (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] ?? [];
    expect(url).toBe(`/api/admin/lobbies/${LOBBY_ID}/reroll`);
    expect(JSON.parse(String(init?.body))).toEqual({ groupId: ORIGINAL_GROUP_ID, splitId: 'split-2' });
  });

  it('goes quiet while a press is in flight, keeps the focus, and sends one press', async () => {
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
    render(<RerollControl lobbyId={LOBBY_ID} splits={splits(1)} />);

    const button = screen.getByRole('button', { name: REROLL_LABEL });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    expect(button).not.toBeDisabled();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);

    release({ ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response);
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
  });

  it('M19.3: stays pending until the promoted split is on screen; a press meanwhile never reposts the old splitId', async () => {
    const tonight = holdTonightRefresh();
    answer(200, { ok: true });
    const { rerender } = render(<RerollControl lobbyId={LOBBY_ID} splits={splits(1)} />);
    const button = screen.getByRole('button', { name: REROLL_LABEL });

    fireEvent.click(button);
    await waitFor(() => expect(tonight.asks).toHaveLength(1));
    // Answered, but the old board is still drawn (`next` would still be split-2): quiet, and no post.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);

    // The re-read lands with split 2 chosen; the next press names split 3.
    rerender(<RerollControl lobbyId={LOBBY_ID} splits={splits(2)} />);
    act(() => tonight.land());
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const bodies = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.map(
      ([, init]) => JSON.parse(String(init.body)).splitId,
    );
    expect(bodies).toEqual(['split-2', 'split-3']);
    tonight.stop();
  });

  it('is really disabled only on the last split, with the sentence beside it', () => {
    render(<RerollControl lobbyId={LOBBY_ID} splits={splits(3)} />);
    expect(screen.getByRole('button', { name: REROLL_LABEL })).toBeDisabled();
    expect(screen.getByText(NO_MORE_SPLITS)).toBeInTheDocument();
  });

  it("prints a refusal in the route's words as a sentence, in the refusal dress", async () => {
    answer(409, { ok: false, error: 'that split is already on the board' });
    render(<RerollControl lobbyId={LOBBY_ID} splits={splits(1)} />);

    fireEvent.click(screen.getByRole('button', { name: REROLL_LABEL }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/^That split is already on the board\.$/);
  });

  it('has a sentence of its own for a refusal with none, and for a press that never left', async () => {
    answer(500, null);
    const { unmount } = render(<RerollControl lobbyId={LOBBY_ID} splits={splits(1)} />);
    fireEvent.click(screen.getByRole('button', { name: REROLL_LABEL }));
    expect(await screen.findByRole('alert')).toHaveTextContent(REROLL_FAILED);
    unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    render(<RerollControl lobbyId={LOBBY_ID} splits={splits(1)} />);
    fireEvent.click(screen.getByRole('button', { name: REROLL_LABEL }));
    expect(await screen.findByRole('alert')).toHaveTextContent(REROLL_UNREACHABLE);
  });
});
