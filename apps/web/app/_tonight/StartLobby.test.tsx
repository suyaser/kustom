import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alreadyHasALobbyLine,
  invitedLine,
  LOBBY_ALREADY_OPEN,
  LOBBY_WRITES_UNVERIFIED,
  NO_CLIENT_ANSWERED,
  NO_COMPANION_AROUND,
  openingOnPcLine,
  START_LOBBY_BUTTON,
} from '@/lib/lobbyStart';
import { SIGN_IN_LABEL, START_LOBBY_OFFLINE, START_LOBBY_SIGN_IN } from '@/lib/tonight/copy';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';
import { StartLobby, StartLobbySignIn } from './StartLobby';

/**
 * `Start a lobby` (M4.2's control, M4.7's placement).
 *
 * The checks a night cannot be run to re-check: the press posts JSON **in place** and never
 * navigates (M3.20), a refusal is printed in the route's own words where the button is, the
 * pending line names the host that was picked, and a lobby that opened says nothing at all —
 * the member list appearing is the answer.
 *
 * **Today the gate is off in production**, so the honest first assertion is that the refusal
 * this deployment actually gets — `Opening lobbies isn't verified on this patch yet.` — renders
 * cleanly and is the route's own sentence, not one of ours.
 */

const HOST = 'Hamoodi';

function progress(overrides: Partial<LobbyStartView> = {}): LobbyStartView {
  return {
    status: 'pending',
    error: null,
    hostName: HOST,
    lobbyName: 'Customs 10 Sep #1',
    lobbyPassword: '4821',
    invited: 0,
    ...overrides,
  };
}

/** `idle`: the state with the button in it. The readout has its own describe below. */
function draw(start: LobbyStartView | null = null, around = 0, onPressed?: () => void) {
  return render(<StartLobby start={start} press around={around} onPressed={onPressed} />);
}

/**
 * A **schema-valid** answer from the route (`startLobbyResponseSchema`), because that is what
 * the component parses: a 200 in any other shape names no host, and the server re-read fills
 * the sentence in instead. Overriding a field here is how the invalid case is written.
 */
function startAnswer(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    commandId: '2f1d6d7e-6c9a-4f0e-9d3f-5f1b8c2a44e1',
    host: { playerId: 'a6f0f4e2-1f77-4a63-9a5e-2c3f0b7d55aa', puuid: 'puuid-hamoodi', name: HOST },
    lobbyName: 'Customs 10 Sep #1',
    lobbyPassword: '4821',
    cycle: 1,
    expiresAt: '2026-09-10T19:41:00.000Z',
    ...overrides,
  };
}

/** The route answered. `ok: false` carries the envelope every route in this app uses. */
function answers(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

/** The same, with a status on it: one refusal of the six is answered by its code (M4.13). */
function refusesWith(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status, json: async () => body }) as unknown as Response),
  );
}

function press(): void {
  fireEvent.click(screen.getByRole('button', { name: START_LOBBY_BUTTON }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('idle: nobody has pressed it', () => {
  it("is one button, labelled in product's words, with nothing under it", () => {
    const { container } = draw();

    expect(screen.getByRole('button', { name: START_LOBBY_BUTTON })).toBeInTheDocument();
    expect(container.querySelector('.cn-start-note')).not.toBeInTheDocument();
    expect(container.querySelector('.cn-hint')).not.toBeInTheDocument();
  });

  it('is a real form with a real action, for the browser with no JavaScript', () => {
    const { container } = draw();
    const form = container.querySelector('form');

    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/api/me/lobbies/start');
    // The 303 path comes back to the tonight page, not to `/admin`, which is the route's own
    // default (M3.4). The route re-validates it as a path on this site.
    expect(container.querySelector('input[name="redirectTo"]')).toHaveValue('/');
  });
});

describe('the press', () => {
  it('posts an empty body in place, names the host, and never navigates', async () => {
    answers(startAnswer());
    const refresh = vi.fn();
    draw(null, 0, refresh);

    press();

    await waitFor(() => expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument());
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call?.[0]).toBe('/api/me/lobbies/start');
    // The body decides nothing: no host, no name, no password, no mode (M4.2).
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({});
    // And the page asks the server for the row: this table emits no Realtime event.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the focus on the button that was pressed', async () => {
    answers(startAnswer());
    draw();

    const button = screen.getByRole('button', { name: START_LOBBY_BUTTON });
    button.focus();
    press();

    await waitFor(() => expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument());
    // Not disabled while in flight: a control that disables itself loses the focus (M3.20).
    expect(document.activeElement).toBe(button);
    expect(button).not.toBeDisabled();
  });

  it('prints the route’s own sentence for every refusal, where the button is', async () => {
    for (const sentence of [
      LOBBY_WRITES_UNVERIFIED,
      LOBBY_ALREADY_OPEN,
      NO_COMPANION_AROUND,
      'A lobby is already being opened.',
    ]) {
      answers({ ok: false, error: sentence }, false);
      const { container, unmount } = draw();

      press();

      await waitFor(() => expect(screen.getByText(sentence)).toBeInTheDocument());
      // Beside the control, not as a banner at the top of the page and not in the URL.
      expect(container.querySelector('.cn-start-note')?.textContent).toBe(sentence);
      expect(container.querySelector('.cn-start')?.contains(screen.getByText(sentence))).toBe(true);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('prints the page’s own sentence for a 401, never the gate’s vocabulary', async () => {
    // The session expired between the render and the press (M4.13). `sign in required` is what
    // the gate says to a caller; a friend on a phone gets the same words the signed-out block
    // uses, because it is the same fact.
    refusesWith(401, { ok: false, error: 'sign in required' });
    const { container } = draw();

    press();

    await waitFor(() => expect(screen.getByText(START_LOBBY_SIGN_IN)).toBeInTheDocument());
    expect(container.textContent).not.toContain('sign in required');
  });

  it('names nobody when the answer is a 200 the schema does not recognise', async () => {
    // The row is written either way; the server re-read a moment later names the host, which
    // is better than `Opening a lobby on 's PC…`.
    answers({ ok: true });
    const refresh = vi.fn();
    const { container } = draw(null, 0, refresh);

    press();

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.cn-start-note')).not.toBeInTheDocument();
  });

  it('says nothing was opened when the request never left the browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    draw();

    press();

    await waitFor(() => expect(screen.getByText(START_LOBBY_OFFLINE)).toBeInTheDocument());
  });

  it('drops a second tap while one is in flight, instead of queuing a second command', async () => {
    answers(startAnswer());
    draw();

    press();
    press();

    await waitFor(() => expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('the readout, with no button (filling)', () => {
  it('carries the invited line and nothing to press', () => {
    render(<StartLobby start={progress({ status: 'acked', invited: 6 })} press={false} around={6} />);

    expect(screen.getByText(invitedLine(6))).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('carries a failed create’s sentence', () => {
    render(<StartLobby start={progress({ status: 'failed', error: 'expired' })} press={false} around={3} />);

    expect(screen.getByText(NO_CLIENT_ANSWERED)).toBeInTheDocument();
  });

  it('draws nothing at all when it has nothing to say', () => {
    const { container } = render(<StartLobby start={null} press={false} around={3} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('what the row says afterwards', () => {
  it('names the host while the command is pending, and again while it is sent', () => {
    const { unmount } = draw(progress());
    expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument();
    unmount();

    draw(progress({ status: 'sent' }));
    expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument();
  });

  it('goes quiet while the command is live, without ever being `disabled`', async () => {
    answers({ ok: false, error: LOBBY_ALREADY_OPEN }, false);
    draw(progress({ status: 'sent' }));

    const button = screen.getByRole('button', { name: START_LOBBY_BUTTON });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveClass('cn-button-quiet');
    // Never the attribute: a disabled control drops the focus to `<body>` (M3.20).
    expect(button).not.toBeDisabled();

    button.focus();
    press();
    // And the press is dropped rather than queuing a second command.
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it('says nothing on success: the member list appearing is the answer', () => {
    const { container } = draw(progress({ status: 'acked' }));

    expect(container.querySelector('.cn-start-note')).not.toBeInTheDocument();
  });

  it('counts the invites once the lobby is open, until ten are in', () => {
    const { unmount } = draw(progress({ status: 'acked', invited: 7 }), 3);
    expect(screen.getByText(invitedLine(7))).toBeInTheDocument();
    unmount();

    // Ten in: there is nobody left to wait for.
    draw(progress({ status: 'acked', invited: 7 }), 10);
    expect(screen.queryByText(invitedLine(7))).not.toBeInTheDocument();
  });

  it('tells the group to join the lobby the host already had open', () => {
    draw(progress({ status: 'failed', error: 'already_in_lobby: partyId=abc' }));

    expect(screen.getByText(alreadyHasALobbyLine(HOST))).toBeInTheDocument();
  });

  it('says nobody’s client answered for every other failure, in one sentence', () => {
    const { unmount } = draw(progress({ status: 'failed', error: 'expired' }));
    expect(screen.getByText(NO_CLIENT_ANSWERED)).toBeInTheDocument();
    unmount();

    draw(progress({ status: 'failed', error: 'wrong_phase' }));
    expect(screen.getByText(NO_CLIENT_ANSWERED)).toBeInTheDocument();
  });

  it('lets a fresh refusal outrank the row from before it', async () => {
    answers({ ok: false, error: LOBBY_ALREADY_OPEN }, false);
    draw(progress({ status: 'failed', error: 'expired' }));

    expect(screen.getByText(NO_CLIENT_ANSWERED)).toBeInTheDocument();
    press();

    await waitFor(() => expect(screen.getByText(LOBBY_ALREADY_OPEN)).toBeInTheDocument());
    expect(screen.queryByText(NO_CLIENT_ANSWERED)).not.toBeInTheDocument();
  });
});

/**
 * The signed-out block (M4.13): product's sentence, back from its 2026-09-10 suspension, in the
 * role card's own signed-out shape.
 */
describe('the signed-out block', () => {
  it('is the sentence, then a sign-in button, and never a disabled Start a lobby', () => {
    const { container } = render(<StartLobbySignIn />);

    expect(screen.getByText(START_LOBBY_SIGN_IN)).toBeInTheDocument();
    // The sentence is the reason and the button is the label (the designer, 2026-09-10).
    const button = screen.getByRole('button', { name: SIGN_IN_LABEL });
    expect(button).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: START_LOBBY_BUTTON })).not.toBeInTheDocument();
    expect(button).not.toBeDisabled();
    // The reason comes first in reading order.
    expect(container.querySelector('.cn-start')?.firstElementChild?.textContent).toBe(START_LOBBY_SIGN_IN);
  });

  it('is a real form to the OAuth round trip, coming back to the tonight page', () => {
    const { container } = render(<StartLobbySignIn />);
    const form = container.querySelector('form');

    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/auth/signin');
    // Back to `/`, not to `/admin`, which is where a sign-in defaults.
    expect(container.querySelector('input[name="next"]')).toHaveValue('/');
  });
});
