'use client';

import { ROLES } from '@customs/core';
import type { LobbyStatusValue, RoleValue } from '@customs/db';
import { type MouseEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { isActiveLobbyStatus } from '@/lib/lobbyState';
import { groupHome } from '@/lib/nav';
import {
  LINK_OFFLINE,
  PICK_YOURSELF,
  ROLE_CONTROL_HEADING,
  ROLE_CONTROL_HINT,
  ROLE_SIGN_IN,
  ROLE_TAP_OFFLINE,
  ROLE_TEAMS_ALREADY_SET,
  renderWebName,
  roleCardTitle,
  SIGN_IN_LABEL,
  SIGNED_IN_NO_LOBBY,
  THATS_ME,
} from '@/lib/tonight/copy';
import type { LobbyView, MemberView } from '@/lib/tonight/types';
import type { ViewerState } from '@/lib/tonight/viewer';
import { RoleIcon } from '../_icons/RoleIcon';
import { usePageGroup } from '../_shell/PageGroup';

/**
 * `Your role tonight` (M3.6): the one thing a friend can change on this page about themselves.
 *
 * Somebody says in voice "I'll jungle tonight", taps `jungle` under their own name, and puts
 * the phone down. The next balance treats jungle as their main and their usual main as the
 * backup. It is a **preference, not a lock** — the sentence under the control says exactly
 * that, and the page never promises more.
 *
 * Four states, and which one is drawn is decided by the session on the server, never here.
 * **All of them are the same card** (the designer, 2026-09-10): one title, one control, one
 * sentence, in one place all night, so a friend who signs in does not have to find a new
 * shape — only the control inside it changes.
 *
 *   - **linked, and in tonight's lobby** — the five role words, the chosen one in `brand`.
 *     Tapping the chosen one clears it; that is the only way out and there is no Clear button.
 *   - **signed in with no player row** — the `That's me` list, which is the day-one case for
 *     everybody and resolves itself in one tap with no admin. **Only players nobody is linked
 *     to are offered**, and which those are is decided on the server: no Discord id, and no
 *     fact about who is linked, ever reaches the browser.
 *   - **signed out** — the same card with one `Sign in with Discord` button.
 *   - **linked but not in the lobby, or no live lobby at all** — nothing. There is no row to
 *     write and a preference with no lobby is M5's problem.
 *
 * **Nothing here navigates** (M3.20): every control is a real `<form>` with a real action —
 * the no-JavaScript path, which the routes still answer with a 303 — intercepted on click when
 * JavaScript is running and posted as JSON instead. The receipt is the role word turning
 * `brand`, not a toast: `05-design.md` — realtime already changes the thing you are looking
 * at. A refusal is printed inline, under the control it belongs to, never as a banner and
 * never in the URL.
 *
 * **It is below the rack, not inside a row.** A rack row is exactly 44px and the rack is ten
 * rows at every count (`rowHeight.test.tsx`); five 44px targets do not fit in one, and putting
 * them there would move the block under a thumb. The card is the last thing in the column, so
 * it can appear and disappear without touching a pixel of the primary block above it. It
 * carries the rack's own 2px `brand` inset rule, because it is about you and nothing else on
 * the page is.
 */

const ROLE_TAP_ACTION = '/api/me/role-tonight';
const LINK_ACTION = '/api/me/link';
const SIGN_IN_ACTION = '/auth/signin';

export interface RoleTonightProps {
  /** Tonight's lobby, or `null` on the idle page. */
  lobby: LobbyView | null;
  viewer: ViewerState;
  /**
   * Re-read the page's server components. Supplied by `TonightLive`, because who the viewer is
   * comes from the session on the server: after a self-link the footer's `Your games` and this
   * card's own state both live one render away. Absent in tests and in a static render, where
   * there is nothing to refresh.
   */
  onViewerChanged?: (() => void) | undefined;
}

export function RoleTonight({ lobby, viewer, onViewerChanged }: RoleTonightProps) {
  if (viewer.kind === 'unlinked') {
    // Only the members nobody has claimed, decided on the server (`lib/me/claimable.ts`): a
    // row that already carries a Discord id is not offered, and the page cannot even tell
    // which those are.
    const claimable = (lobby?.members ?? []).filter((member) => viewer.claimable.includes(member.puuid));
    return claimable.length === 0 ? (
      <p className="cn-hint">{SIGNED_IN_NO_LOBBY}</p>
    ) : (
      <PickYourself members={claimable} onLinked={onViewerChanged} />
    );
  }

  // `isActiveLobbyStatus` is the same predicate ingest and the route use — `finished`,
  // `dropped` and `abandoned` are records of what happened, and there is nothing to tap on.
  if (lobby === null || !isActiveLobbyStatus(lobby.status)) return null;

  if (viewer.kind === 'anonymous') return <SignIn />;

  const seat = lobby.members.find((member) => member.puuid === viewer.puuid);
  // Linked, but not in tonight's lobby: there is no row to write, so there is no control.
  if (seat === undefined) return null;

  return <RolePicker key={seat.puuid} lobbyId={lobby.id} status={lobby.status} seat={seat} />;
}

/** Every state's frame: the card, its title, and whatever the state puts inside it. */
function RoleCard({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();

  return (
    <section className="cn-card cn-role-card" aria-labelledby={id}>
      {/* Archivo, not the mono micro-label: a card title is language. A heading, because
          heading navigation is how a screen-reader user finds the only control on this page
          (the designer, 2026-09-10). */}
      <h2 className="cn-card-title" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The five role words. Each is a submit button of one form, so the no-JavaScript path posts
 * the role that was pressed and nothing else; with JavaScript the click is intercepted.
 */
function RolePicker({
  lobbyId,
  status,
  seat,
}: {
  lobbyId: string;
  status: LobbyStatusValue;
  seat: MemberView;
}) {
  const group = usePageGroup();
  const [pending, setPending] = useState<RoleValue | null | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const titleId = useId();
  // The optimistic answer until the write lands, then the stored one: the page is subscribed
  // to `lobby_members`, so every device shows the choice a moment later without asking.
  const chosen = pending === undefined ? seat.roleOverride : pending;

  useEffect(() => {
    // The write has come back around through Realtime — or somebody else changed the row —
    // so the optimistic value has done its job.
    if (pending !== undefined && seat.roleOverride === pending) setPending(undefined);
  }, [pending, seat.roleOverride]);

  async function submit(event: MouseEvent<HTMLButtonElement>, role: RoleValue | null): Promise<void> {
    // Cancels the browser's own submit: with JavaScript this control never navigates.
    event.preventDefault();
    const previous = chosen;
    setPending(role);
    setFailed(null);

    try {
      const response = await fetch(ROLE_TAP_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, lobbyId, role }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        // Back to what the row actually says, then the route's own sentence under the words.
        // It owns the rule it just refused.
        setPending(previous);
        setFailed(errorOf(body, ROLE_TAP_OFFLINE));
      }
    } catch {
      setPending(previous);
      setFailed(ROLE_TAP_OFFLINE);
    }
  }

  return (
    <section className="cn-card cn-role-card" aria-labelledby={titleId}>
      <h2 className="cn-card-title" id={titleId}>
        {roleCardTitle(seat.name)}
      </h2>
      <form className="cn-role-choices" method="post" action={ROLE_TAP_ACTION} aria-labelledby={titleId}>
        <input type="hidden" name="lobbyId" value={lobbyId} />
        {/* Only the no-JavaScript path reads this. The route re-validates it as a path here. */}
        <input type="hidden" name="groupId" value={group.id} />
        <input type="hidden" name="redirectTo" value={groupHome(group)} />
        {ROLES.map((role) => {
          const selected = chosen === role;
          return (
            <button
              key={role}
              type="submit"
              name="role"
              // Tapping the chosen role clears it: `''` is the form's way of saying null, and
              // it is the only way out — there is no separate Clear button.
              value={selected ? '' : role}
              className={selected ? 'cn-role-choice cn-role-on' : 'cn-role-choice'}
              aria-pressed={selected}
              onClick={(event) => void submit(event, selected ? null : role)}
            >
              <RoleIcon role={role} />
              {role}
            </button>
          );
        })}
      </form>
      {/* Directly under the words it belongs to and above the hint, in `text`: a refusal that
          sits below a grey explanation is a refusal nobody reads (the designer, 2026-09-10). */}
      {failed === null ? null : (
        <p className="cn-role-error" role="alert">
          {failed}
        </p>
      )}
      {/* **One hint per state.** `open` says what a tap is worth; from `balanced` on it says
          what it is worth *now*, and the two never stack. */}
      <p className="cn-hint">{status === 'open' ? ROLE_CONTROL_HINT : ROLE_TEAMS_ALREADY_SET}</p>
    </section>
  );
}

/**
 * `That's me`, once (M3.6, "Picking yourself, once").
 *
 * Only tonight's unclaimed members are offered — a friend cannot claim somebody who is not in
 * the room with them, and a player somebody is already linked to is not on the list at all.
 * The route checks both again.
 */
function PickYourself({
  members,
  onLinked,
}: {
  members: readonly MemberView[];
  onLinked?: (() => void) | undefined;
}) {
  const group = usePageGroup();
  const [failed, setFailed] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const listId = useId();

  async function submit(event: MouseEvent<HTMLButtonElement>, puuid: string): Promise<void> {
    event.preventDefault();
    setFailed(null);
    try {
      const response = await fetch(LINK_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, puuid }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setFailed(errorOf(body, LINK_OFFLINE));
        return;
      }
      setClaimed(puuid);
      // The session is linked from now on, and that is a fact the **server** holds: this asks
      // for the page's server components again so the rack marks the row and the footer grows
      // its `Your games` link. Not a navigation: no document load, and the focus stays.
      onLinked?.();
    } catch {
      setFailed(LINK_OFFLINE);
    }
  }

  return (
    <RoleCard title={ROLE_CONTROL_HEADING}>
      <p className="cn-hint" id={listId}>
        {PICK_YOURSELF}
      </p>
      <ul className="cn-pick-list" aria-labelledby={listId}>
        {members.map((member) => (
          <li key={member.puuid} className="cn-pick-row">
            <span className="cn-pick-name">{renderWebName(member.name)}</span>
            <form method="post" action={LINK_ACTION}>
              <input type="hidden" name="puuid" value={member.puuid} />
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="redirectTo" value={groupHome(group)} />
              <button
                type="submit"
                className="cn-pick-button"
                onClick={(event) => void submit(event, member.puuid)}
              >
                {/* The name is in the row beside the button in reading order, but a screen
                    reader moving button to button hears ten identical labels without it. */}
                {THATS_ME}
                <span className="cn-sr">{`: ${renderWebName(member.name)}`}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
      {failed === null ? null : (
        <p className="cn-role-error" role="alert">
          {failed}
        </p>
      )}
      {claimed === null ? null : (
        // The list is about to be replaced by the role control on the next server render. This
        // is the one line that says the tap landed while that is in flight.
        <p className="cn-hint" role="status">
          {`You are ${renderWebName(members.find((member) => member.puuid === claimed)?.name ?? null)}.`}
        </p>
      )}
    </RoleCard>
  );
}

/**
 * The same card, with one button in it, and the only thing on this page that navigates — an
 * OAuth round trip cannot be done in place. Reading is never gated: the rest of the page is
 * exactly what everybody else sees.
 */
function SignIn() {
  const group = usePageGroup();
  return (
    <RoleCard title={ROLE_CONTROL_HEADING}>
      <p className="cn-hint">{ROLE_SIGN_IN}</p>
      <form method="post" action={SIGN_IN_ACTION} className="cn-signin">
        {/* Back to the tonight page, not to `/admin`, which is where a sign-in defaults. */}
        <input type="hidden" name="next" value={groupHome(group)} />
        <button type="submit" className="cn-button">
          {SIGN_IN_LABEL}
        </button>
      </form>
    </RoleCard>
  );
}

/** The API's envelope is `{ ok: false, error }`. Anything else gets the offline sentence. */
function errorOf(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }
  return fallback;
}
