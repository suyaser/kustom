import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * M19.3: an admin write behind its confirm stays pending, dialog open, until the refreshed page has
 * committed: no closed dialog over the old row, and no second post from a second press. The refresh
 * is a stand-in that lands when the test says (`lib/useCommittedRefresh.test.tsx` is the real hook).
 */

const held = vi.hoisted(() => ({ asked: 0, open: [] as (() => void)[] }));
vi.mock('@/lib/useCommittedRefresh', () => ({
  useCommittedRefresh: () => ({
    refreshing: false,
    refresh: () => {
      held.asked += 1;
      return new Promise<void>((resolve) => held.open.push(resolve));
    },
  }),
}));

const { ConfirmAction } = await import('./ConfirmAction');

afterEach(() => {
  held.asked = 0;
  held.open.length = 0;
  vi.unstubAllGlobals();
});

function draw() {
  return render(
    <ConfirmAction
      label="Remove"
      tone="destructive"
      title="Remove Lena from the group?"
      body="Lena leaves the board."
      actionLabel="Remove from group"
      pendingLabel="Removing…"
      url="/api/admin/members/remove"
      payload={{ groupId: 'g', playerId: 'p' }}
    />,
  );
}

describe('ConfirmAction holds until the screen changes (M19.3)', () => {
  it('keeps the dialog open on its pending label until the refresh lands, and posts once', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    draw();
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    const dialog = await screen.findByRole('alertdialog');

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Remove from group/ }));
    });
    await waitFor(() => expect(held.asked).toBe(1));
    const pending = within(dialog).getByRole('button', { name: /Removing…/ });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await act(async () => {
      held.open.shift()?.();
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('a refusal neither refreshes nor closes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":false,"error":"the owner cannot be removed"}', { status: 409 })),
    );
    draw();
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Remove from group/ }));
    });
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(held.asked).toBe(0);
    expect(within(dialog).getByRole('button', { name: /Remove from group/ })).not.toHaveAttribute(
      'aria-disabled',
    );
  });
});
