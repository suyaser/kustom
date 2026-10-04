'use client';

import { ROLES } from '@customs/core';
import type { LobbyStatusValue, RoleValue } from '@customs/db';
import { type MouseEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { NameText } from '@/components/names/name-text';
import { Button } from '@/components/ui/button';
import { welcomeHref } from '@/lib/board/hrefs';
import { isActiveLobbyStatus } from '@/lib/lobbyRules';
import { groupHome } from '@/lib/nav';
import {
  HEAD_SEPARATOR,
  isNameless,
  LINK_OFFLINE,
  PICK_YOURSELF,
  PICK_YOURSELF_OPEN,
  PICK_YOURSELF_TITLE,
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
import { requestTonightRefresh } from '@/lib/tonight/live';
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

/** The card every state of this control sits in (5.0 Card, level 1). */
const CARD = 'flex flex-col gap-3 rounded-card border border-border bg-card p-(--card-pad)';

/** A role toggle (5.0 Chip that acts): 44px, `aria-pressed` carries the state, not colour alone. */
const ROLE_CHOICE = [
  'inline-flex min-h-11 items-center gap-1.5 rounded-control border border-border-strong bg-raised px-3 font-mono text-sm font-medium text-muted-foreground font-stretch-85%',
  'transition-[background-color,border-color,color,scale] duration-(--dur-fast) ease-out active:scale-[.98]',
  'aria-pressed:border-foreground aria-pressed:bg-accent aria-pressed:font-bold aria-pressed:text-foreground',
].join(' ');
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
      <p className="text-sm text-muted-foreground">{SIGNED_IN_NO_LOBBY}</p>
    ) : (
      <PickYourself
        members={claimable}
        onLinked={onViewerChanged}
        // Lead ruling (M14.65): once the teams are set the card folds to one line that opens.
        collapsed={lobby?.status === 'balanced'}
      />
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
    <section className={CARD} aria-labelledby={id}>
      {/* Archivo, not the mono micro-label: a card title is language. A heading, because
          heading navigation is how a screen-reader user finds the only control on this page
          (the designer, 2026-09-10). */}
      <h2 className="text-md font-bold" id={id}>
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
    <section className={CARD} aria-labelledby={titleId}>
      <h2
        className="text-md font-bold [overflow-wrap:anywhere]"
        id={titleId}
        aria-label={roleCardTitle(seat.name)}
      >
        {isNameless(seat.name) ? (
          roleCardTitle(seat.name)
        ) : (
          // Under 768 the name takes its own line with no `·` (M14.41 design round 1); from 768 one
          // line, `Your role tonight · Bilal`, as before. The heading's name is that line either way.
          <>
            {ROLE_CONTROL_HEADING}
            <span aria-hidden="true" className="max-md:hidden">{` ${HEAD_SEPARATOR} `}</span>
            <span className="block md:inline">{renderWebName(seat.name)}</span>
          </>
        )}
      </h2>
      <form className="flex flex-wrap gap-2" method="post" action={ROLE_TAP_ACTION} aria-labelledby={titleId}>
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
              className={ROLE_CHOICE}
              aria-pressed={selected}
              onClick={(event) => void submit(event, selected ? null : role)}
            >
              <RoleIcon role={role} size={16} />
              {role}
            </button>
          );
        })}
      </form>
      {/* Directly under the words it belongs to and above the hint, in `text`: a refusal that
          sits below a grey explanation is a refusal nobody reads (the designer, 2026-09-10). */}
      {failed === null ? null : (
        <p className="text-sm font-bold" role="alert">
          {failed}
        </p>
      )}
      {/* **One hint per state.** `open` says what a tap is worth; from `balanced` on it says
          what it is worth *now*, and the two never stack. */}
      <p className="text-sm text-muted-foreground">
        {status === 'open' ? ROLE_CONTROL_HINT : ROLE_TEAMS_ALREADY_SET}
      </p>
    </section>
  );
}

/**
 * Where `That's me` goes once the link succeeds (M14.33): a full navigation to the welcome URL.
 * An object so a test can stand in for the browser's `location`.
 */
export const linkLanding = {
  go(href: string): void {
    window.location.assign(href);
  },
};

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
  collapsed = false,
}: {
  members: readonly MemberView[];
  onLinked?: (() => void) | undefined;
  /** The lobby is balanced: one line, `Which one is you? Pick yourself`, that opens to the list. */
  collapsed?: boolean;
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
      // The session is linked from now on: land on the You tab's welcome card (M14.33), which
      // shows the whole history in one card. `onLinked` still refreshes the page underneath in
      // case the navigation is slow.
      onLinked?.();
      requestTonightRefresh();
      linkLanding.go(welcomeHref(group));
    } catch {
      setFailed(LINK_OFFLINE);
    }
  }

  const body = (
    <>
      <p className="text-sm text-muted-foreground" id={listId}>
        {PICK_YOURSELF}
      </p>
      <ul className="flex flex-col" aria-labelledby={listId}>
        {members.map((member) => (
          <li
            key={member.puuid}
            className="flex min-h-(--row-min-h) items-center justify-between gap-3 border-t border-border py-2"
          >
            <span className="min-w-0 font-bold [overflow-wrap:anywhere]">
              <NameText name={member.name} suffix={member.nameSuffix} />
            </span>
            {/* M14.45: the button never wraps; a long name wraps beside it instead. */}
            <form method="post" action={LINK_ACTION} className="shrink-0">
              <input type="hidden" name="puuid" value={member.puuid} />
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="redirectTo" value={welcomeHref(group)} />
              <Button
                type="submit"
                variant="secondary"
                className="whitespace-nowrap"
                onClick={(event) => void submit(event, member.puuid)}
              >
                {/* The name is in the row beside the button in reading order, but a screen
                    reader moving button to button hears ten identical labels without it. */}
                {THATS_ME}
                <span className="sr-only">{`: ${renderWebName(member.name)}`}</span>
              </Button>
            </form>
          </li>
        ))}
      </ul>
      {failed === null ? null : (
        <p className="text-sm font-bold" role="alert">
          {failed}
        </p>
      )}
      {claimed === null ? null : (
        // The list is about to be replaced by the role control on the next server render. This
        // is the one line that says the tap landed while that is in flight.
        <p className="text-sm text-muted-foreground" role="status">
          {`You are ${renderWebName(members.find((member) => member.puuid === claimed)?.name ?? null)}.`}
        </p>
      )}
    </>
  );

  if (!collapsed) return <RoleCard title={PICK_YOURSELF_TITLE}>{body}</RoleCard>;
  return (
    <details className="rounded-card border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-card p-(--card-pad) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <h2 className="text-md font-bold">{PICK_YOURSELF_TITLE}</h2>{' '}
        <span className="text-sm font-bold text-primary-text underline underline-offset-3">
          {PICK_YOURSELF_OPEN}
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-(--card-pad) pb-(--card-pad)">{body}</div>
    </details>
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
      <p className="text-sm text-muted-foreground">{ROLE_SIGN_IN}</p>
      <form method="post" action={SIGN_IN_ACTION}>
        {/* Back to the tonight page, not to `/admin`, which is where a sign-in defaults. */}
        <input type="hidden" name="next" value={groupHome(group)} />
        <Button type="submit" variant="secondary" className="w-full sm:w-auto">
          {SIGN_IN_LABEL}
        </Button>
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
