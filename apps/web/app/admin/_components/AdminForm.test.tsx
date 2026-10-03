import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAnswerGroup } from './AdminAnswerGroup';
import { AdminForm } from './AdminForm';

/**
 * M3.20: every write on `/admin` happens in place.
 *
 * What this pins is the part a browser check cannot: the request that goes out is the same
 * object the no-JS form post would have sent, the answer is rendered **inside the form**, a
 * refusal prints the route's own sentence, and the default form submit — the thing that
 * navigates — is cancelled. The "the `load` event count stays 1" half is checked in a real
 * browser, because jsdom does not navigate on a form submit at all.
 */

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

function draw() {
  return render(
    <AdminForm action="/api/admin/players" kind="players">
      <input type="hidden" name="action" value="set-name" />
      <input type="hidden" name="playerId" value="player-1" />
      <input type="text" name="displayName" defaultValue="Hana" aria-label="Name" />
      <button type="submit">Save</button>
    </AdminForm>,
  );
}

function answer(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a save', () => {
  it('posts the form values as JSON to the same route, and never navigates', async () => {
    answer({ ok: true, action: 'set-name', playerId: 'player-1' });
    draw();

    const submitted = fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form') as Node);
    // The browser's own submit — the one that loads a document — is cancelled.
    expect(submitted).toBe(false);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] =
      (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/players');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      groupId: ORIGINAL_GROUP_ID,
      action: 'set-name',
      playerId: 'player-1',
      displayName: 'Hana',
    });
  });

  it('renders its notice inside the form, beside the control, and re-reads the row', async () => {
    answer({ ok: true, action: 'set-name', playerId: 'player-1' });
    const { container } = draw();

    fireEvent.submit(container.querySelector('form') as Node);

    await waitFor(() => expect(screen.getByText('name saved: Hana')).toBeInTheDocument());
    // Inside the form: not a banner at the top of the page.
    expect(container.querySelector('form')?.contains(screen.getByText('name saved: Hana'))).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves the button focused, because nothing was disabled and nothing navigated', async () => {
    answer({ ok: true, action: 'set-name', playerId: 'player-1' });
    draw();

    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    fireEvent.submit(button.closest('form') as Node);

    await waitFor(() => expect(screen.getByText('name saved: Hana')).toBeInTheDocument());
    expect(document.activeElement).toBe(button);
    expect(button).toBeEnabled();
  });

  it('keeps the plain form post as the no-JavaScript path', () => {
    const { container } = draw();
    const form = container.querySelector('form');

    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/api/admin/players');
  });
});

describe('a refusal', () => {
  it("prints the route's own sentence, inline, and does not re-read", async () => {
    answer({ ok: false, error: 'that player is not yours to rename' }, false);
    const { container } = draw();

    fireEvent.submit(container.querySelector('form') as Node);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('that player is not yours to rename'),
    );
    expect(refresh).not.toHaveBeenCalled();
    // Never in the query string: this page never navigated.
    expect(window.location.search).toBe('');
  });

  it('says something true when the request never reached the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { container } = draw();

    fireEvent.submit(container.querySelector('form') as Node);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('a control that removes itself by succeeding', () => {
  /**
   * `Revoke` and `Promote split N` are gone from the next render: the row becomes the word
   * `revoked`, the promoted split leaves the list. This harness is that re-render — the mocked
   * `router.refresh` swaps the form out, exactly as the server's would.
   */
  function Revokable() {
    const [revoked, setRevoked] = useState(false);
    refresh.mockImplementation(() => {
      act(() => setRevoked(true));
    });

    return (
      <AdminAnswerGroup>
        {revoked ? (
          <span>revoked</span>
        ) : (
          <AdminForm action="/api/admin/tokens" kind="tokens">
            <input type="hidden" name="action" value="revoke" />
            <input type="hidden" name="tokenId" value="token-1" />
            <button type="submit">Revoke</button>
          </AdminForm>
        )}
      </AdminAnswerGroup>
    );
  }

  it('keeps its sentence after the re-render that takes the control away', async () => {
    answer({ ok: true, action: 'revoke', tokenId: 'token-1' });
    render(<Revokable />);

    const button = screen.getByRole('button', { name: 'Revoke' });
    button.focus();
    fireEvent.submit(button.closest('form') as Node);

    // The row has been swapped for the word, and the sentence is still on screen beside it.
    await waitFor(() => expect(screen.getByText('revoked')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.getByText('token revoked')).toBeInTheDocument();
  });

  it('moves focus to the sentence, because the control that had it is gone', async () => {
    answer({ ok: true, action: 'revoke', tokenId: 'token-1' });
    render(<Revokable />);

    const button = screen.getByRole('button', { name: 'Revoke' });
    button.focus();
    fireEvent.submit(button.closest('form') as Node);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('token revoked')));
  });

  it('leaves the focus alone when the control is still there', async () => {
    answer({ ok: true, action: 'set-name', playerId: 'player-1' });
    render(
      <AdminAnswerGroup>
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-name" />
          <input type="hidden" name="playerId" value="player-1" />
          <input type="text" name="displayName" defaultValue="Hana" aria-label="Name" />
          <button type="submit">Save</button>
        </AdminForm>
      </AdminAnswerGroup>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    fireEvent.submit(button.closest('form') as Node);

    await waitFor(() => expect(screen.getByText('name saved: Hana')).toBeInTheDocument());
    expect(document.activeElement).toBe(button);
  });
});

describe('pressing a refused control twice', () => {
  it('clears the group sentence on the second press and announces it again', async () => {
    answer({ ok: false, error: 'that lobby is not balanced' }, false);
    render(
      <AdminAnswerGroup>
        <AdminForm action="/api/admin/lobbies/lobby-1/reroll" kind="reroll">
          <input type="hidden" name="splitId" value="split-2" />
          <button type="submit">Promote split 2</button>
        </AdminForm>
      </AdminAnswerGroup>,
    );

    const form = screen.getByRole('button', { name: 'Promote split 2' }).closest('form') as Node;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const first = screen.getByRole('alert');
    expect(first).toHaveTextContent('that lobby is not balanced');

    // The second press clears the old sentence before it asks again: without that, a screen
    // reader is handed the same node with the same words and says nothing.
    fireEvent.submit(form);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const second = screen.getByRole('alert');
    expect(second).toHaveTextContent('that lobby is not balanced');
    expect(second).not.toBe(first);
  });
});

describe('minting a token', () => {
  it('shows the raw token, because with JavaScript on there is no one-time page', async () => {
    answer({ ok: true, action: 'mint', token: 'cnt_live_secret' });
    render(
      <AdminForm action="/api/admin/tokens" kind="tokens">
        <input type="hidden" name="action" value="mint" />
        <button type="submit">Mint token</button>
      </AdminForm>,
    );

    fireEvent.submit(screen.getByRole('button', { name: 'Mint token' }).closest('form') as Node);

    await waitFor(() => expect(screen.getByText('token minted')).toBeInTheDocument());
    expect(screen.getByText(/cnt_live_secret/)).toBeInTheDocument();
    expect(screen.getByText(/Copy it now/)).toBeInTheDocument();
  });
});
