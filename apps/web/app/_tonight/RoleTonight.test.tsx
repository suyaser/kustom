import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extraMember, lobbyView, workedMembers } from '@/lib/testing/tonightFixtures';
import {
  PICK_YOURSELF,
  PICK_YOURSELF_TITLE,
  ROLE_CONTROL_HEADING,
  ROLE_CONTROL_HINT,
  ROLE_SIGN_IN,
  ROLE_TAP_OFFLINE,
  ROLE_TEAMS_ALREADY_SET,
  roleCardTitle,
  SIGN_IN_LABEL,
  SIGNED_IN_NO_LOBBY,
  THATS_ME,
} from '@/lib/tonight/copy';
import type { LobbyView } from '@/lib/tonight/types';
import type { ViewerState } from '@/lib/tonight/viewer';
import { RoleTonight } from './RoleTonight';

/** M19.3: `That's me` lands on `/you` through the router (a soft navigation), never `location`. */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

/**
 * `Your role tonight` and `That's me` (M3.6).
 *
 * The acceptance checks a night cannot be run to re-check: the tap posts the role that was
 * pressed and **never navigates** (M3.20), tapping the chosen role clears it, the control says
 * `Saved for the next game.` once the teams are up, a refusal is the route's own sentence
 * inline beside the control, and the four viewer states each draw exactly one thing.
 */

const ME = workedMembers(1)[0]?.puuid ?? '';

function lobby(overrides: Partial<LobbyView> = {}): LobbyView {
  return lobbyView({ members: workedMembers(4), ...overrides });
}

function draw(viewer: ViewerState, view: LobbyView | null) {
  return render(<RoleTonight lobby={view} viewer={viewer} />);
}

const linked: ViewerState = { kind: 'linked', puuid: ME, isAdmin: false };

/** Everybody in the fixture lobby is unclaimed unless a test says otherwise. */
function unlinked(claimable: readonly string[] = workedMembers(4).map((m) => m.puuid)): ViewerState {
  return { kind: 'unlinked', claimable };
}

/** The route answered. `ok: false` carries the envelope every route in this app uses. */
function answers(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

function lastBody(): unknown {
  const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  return JSON.parse(String(calls[calls.length - 1]?.[1]?.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
  router.push.mockClear();
  router.refresh.mockClear();
});

describe("the role control, for a linked viewer in tonight's lobby", () => {
  it('draws the five roles under the card title, with the sentence that says it is a preference', () => {
    draw(linked, lobby());

    // `Your role tonight · Bilal`: the viewer's own name, so the card says whose it is
    // (product, 2026-09-10). Never `· Someone`.
    // A heading, so a screen-reader user can find the only control on the page by navigating
    // headings (the designer, 2026-09-10).
    expect(screen.getByRole('heading', { name: 'Your role tonight · Bilal' })).toBeInTheDocument();
    expect(roleCardTitle(null)).toBe(ROLE_CONTROL_HEADING);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'top',
      'jungle',
      'mid',
      'adc',
      'support',
    ]);
    expect(screen.getByText(ROLE_CONTROL_HINT)).toBeInTheDocument();
    // **One hint per state.** `open` says what a tap is worth; the teams sentence is for a
    // screen that has teams on it.
    expect(screen.queryByText(ROLE_TEAMS_ALREADY_SET)).not.toBeInTheDocument();
  });

  it('posts the role that was pressed, marks it chosen, and never navigates', async () => {
    answers({ ok: true, puuid: ME, role: 'jungle', status: 'open', savedForNextGame: false });
    draw(linked, lobby());

    const jungle = screen.getByRole('button', { name: 'jungle' });
    // False means the click's default was prevented: with JavaScript the form never submits,
    // so no document loads and the URL does not change (M3.20).
    expect(fireEvent.click(jungle)).toBe(false);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(lastBody()).toEqual({ groupId: ORIGINAL_GROUP_ID, lobbyId: 'lobby-1', role: 'jungle' });
    // The receipt is the word itself, optimistically, before the write comes back round
    // through Realtime. No toast and no "saved!".
    await waitFor(() => expect(jungle).toHaveAttribute('aria-pressed', 'true'));
    // The control survives its own success — nothing here unmounts — which is what keeps the
    // keyboard focus on the word that was pressed (M3.20). jsdom does not move focus on a
    // synthetic click, so the focus itself is checked in a browser.
    expect(jungle).toBeInTheDocument();
  });

  it('clears the override when the chosen role is pressed again', async () => {
    answers({ ok: true, puuid: ME, role: null, status: 'open', savedForNextGame: false });
    const members = workedMembers(4);
    const mine = members[0];
    if (mine !== undefined) members[0] = { ...mine, roleOverride: 'jungle' };
    draw(linked, lobby({ members }));

    const jungle = screen.getByRole('button', { name: 'jungle' });
    expect(jungle).toHaveAttribute('aria-pressed', 'true');
    // The only way out, and there is no separate Clear button.
    fireEvent.click(jungle);

    await waitFor(() =>
      expect(lastBody()).toEqual({ groupId: ORIGINAL_GROUP_ID, lobbyId: 'lobby-1', role: null }),
    );
    await waitFor(() => expect(jungle).toHaveAttribute('aria-pressed', 'false'));
  });

  it('says the teams are already set from `balanced` on, and still stores the tap', async () => {
    answers({ ok: true, puuid: ME, role: 'top', status: 'balanced', savedForNextGame: true });
    draw(linked, lobby({ status: 'balanced' }));

    expect(screen.getByText(ROLE_TEAMS_ALREADY_SET)).toBeInTheDocument();
    // One hint, not two: the preference sentence is replaced, never stacked under it.
    expect(screen.queryByText(ROLE_CONTROL_HINT)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'top' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("prints the route's own sentence beside the control and puts the word back", async () => {
    answers({ ok: false, error: 'That lobby is over. You can set a role when the next one opens.' }, false);
    draw(linked, lobby());

    const mid = screen.getByRole('button', { name: 'mid' });
    fireEvent.click(mid);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'That lobby is over. You can set a role when the next one opens.',
      ),
    );
    // Above the hint, under the words it belongs to: a refusal below a grey explanation is a
    // refusal nobody reads (the designer, 2026-09-10).
    const hint = screen.getByText(ROLE_CONTROL_HINT);
    expect(
      screen.getByRole('alert').compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Not a banner at the top of the page and not in the query string (M3.20), and the word
    // that was pressed is not left looking chosen.
    expect(mid).toHaveAttribute('aria-pressed', 'false');
  });

  it('says so when the request never reached the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    draw(linked, lobby());
    fireEvent.click(screen.getByRole('button', { name: 'adc' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ROLE_TAP_OFFLINE));
  });

  it('draws for a sitter, who may well be in the next game', () => {
    // The eleventh person around, in the spectator slot: they are in `lobby_members`, so they
    // have a row and their choice counts at the next balance.
    const sitter = extraMember({ puuid: 'puuid-sitter', name: 'Deniz' });
    draw(
      { kind: 'linked', puuid: 'puuid-sitter', isAdmin: false },
      lobby({ members: [...workedMembers(4), sitter] }),
    );

    expect(screen.getByRole('heading', { name: 'Your role tonight · Deniz' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });
});

describe('when there is nothing to tap', () => {
  it("draws nothing for a linked viewer who is not in tonight's lobby", () => {
    const { container } = draw({ kind: 'linked', puuid: 'somebody-else', isAdmin: false }, lobby());

    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing once the game is over, or with no lobby at all', () => {
    expect(draw(linked, lobby({ status: 'finished' })).container).toBeEmptyDOMElement();
    expect(draw(linked, null).container).toBeEmptyDOMElement();
  });

  it('draws nothing for a signed-out reader on the idle page: reading is never gated', () => {
    expect(draw({ kind: 'anonymous' }, null).container).toBeEmptyDOMElement();
  });
});

describe('signed out, with a lobby up', () => {
  it('offers the one control that starts the Discord round trip, back to the tonight page', () => {
    const { container } = draw({ kind: 'anonymous' }, lobby());

    // The same card as every other state, with a title, a sentence, and a button whose label
    // is a label (the designer and product, 2026-09-10).
    expect(screen.getByRole('region', { name: ROLE_CONTROL_HEADING })).toBeInTheDocument();
    expect(screen.getByText(ROLE_SIGN_IN)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SIGN_IN_LABEL })).toBeEnabled();
    expect(container.querySelector('form')).toHaveAttribute('action', '/auth/signin');
    // Not `/admin`, which is where a sign-in with no destination lands.
    expect(container.querySelector('input[name="next"]')).toHaveValue('/g/customs');
  });
});

describe('signed in with no player row: picking yourself, once', () => {
  const visitor = unlinked();

  it("offers tonight's members, each with `That's me`, under the question as the card's h2 (M14.65)", () => {
    draw(visitor, lobby());

    expect(screen.getByRole('heading', { level: 2, name: 'Which one is you?' })).toBeInTheDocument();
    expect(PICK_YOURSELF_TITLE).toBe('Which one is you?');
    expect(screen.queryByRole('heading', { name: ROLE_CONTROL_HEADING })).toBeNull();
    expect(screen.getByText(PICK_YOURSELF)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    // The visible label is the same four words on every row; the name is what a listener
    // moving button to button needs.
    expect(screen.getAllByRole('button')[0]).toHaveAccessibleName(`${THATS_ME}: Bilal`);
  });

  it('once the teams are set, the card folds to one line that opens (lead ruling, M14.65)', () => {
    const { container } = draw(visitor, lobby({ status: 'balanced' }));
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    const summary = details.querySelector('summary') as HTMLElement;
    expect(summary).toHaveTextContent('Which one is you? Pick yourself');
    expect(screen.getByRole('heading', { level: 2, name: 'Which one is you?' })).toBeInTheDocument();
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getAllByRole('button', { name: new RegExp(THATS_ME) })).toHaveLength(4);
  });

  it('while the lobby is open the card is full, not folded', () => {
    const { container } = draw(visitor, lobby({ status: 'open' }));
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByText(PICK_YOURSELF)).toBeVisible();
  });

  it('a same-name suffix prints muted beside the name in the list (M14.69)', () => {
    const members = workedMembers(4).map((m, i) => (i === 1 ? { ...m, name: 'Ali', nameSuffix: '(2)' } : m));
    draw(visitor, lobbyView({ members }));
    expect(screen.getByText('(2)')).toHaveClass('font-normal', 'text-muted-foreground');
  });

  it('posts the puuid, then lands on the You tab with the welcome card through the router (M14.33, M19.3)', async () => {
    answers({ ok: true, puuid: ME });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const asked: Event[] = [];
    const onAsk = (event: Event) => asked.push(event);
    window.addEventListener('kustom:tonight-refresh', onAsk);
    draw(visitor, lobby());

    expect(fireEvent.click(screen.getAllByRole('button')[0] as Element)).toBe(false);

    await waitFor(() => expect(lastBody()).toEqual({ groupId: ORIGINAL_GROUP_ID, puuid: ME }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/g/customs/you?welcome=1'));
    expect(router.push).toHaveBeenCalledTimes(1);
    // A soft navigation: no document load, and no Tonight re-read asked for first.
    expect(assign).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(asked).toHaveLength(0);
    window.removeEventListener('kustom:tonight-refresh', onAsk);
  });

  it('sends one claim: a second tap while the first lands posts nothing', async () => {
    answers({ ok: true, puuid: ME });
    draw(visitor, lobby());
    fireEvent.click(screen.getAllByRole('button')[0] as Element);
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole('button')[1] as Element);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends the no-JavaScript form to the welcome URL too', () => {
    const { container } = draw(visitor, lobby());
    for (const input of container.querySelectorAll('form[action="/api/me/link"] input[name="redirectTo"]')) {
      expect(input).toHaveValue('/g/customs/you?welcome=1');
    }
  });

  it('does not navigate when the claim is refused', async () => {
    answers({ ok: false, error: 'Someone is already linked to that player.' }, false);
    draw(visitor, lobby());
    fireEvent.click(screen.getAllByRole('button')[0] as Element);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(router.push).not.toHaveBeenCalled();
  });

  it("prints the route's sentence when somebody is already linked to that player", async () => {
    answers({ ok: false, error: 'Someone is already linked to that player.' }, false);
    draw(visitor, lobby());

    fireEvent.click(screen.getAllByRole('button')[0] as Element);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Someone is already linked to that player.'),
    );
  });

  it('asks nothing when there is nobody to pick', () => {
    draw(visitor, null);

    expect(screen.getByText(SIGNED_IN_NO_LOBBY)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('offers only the members nobody is linked to yet', () => {
    // The server decided this list (`lib/me/claimable.ts`): a player who already carries a
    // Discord id is not on it, and the page is never told who those are.
    const members = workedMembers(4);
    const free = members[1];
    draw(unlinked(free === undefined ? [] : [free.puuid]), lobby());

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(`${THATS_ME}: Hana`);
    expect(screen.queryByText('Bilal')).not.toBeInTheDocument();
  });

  it('asks nothing when every member of the lobby is already linked', () => {
    draw(unlinked([]), lobby());

    expect(screen.getByText(SIGNED_IN_NO_LOBBY)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
