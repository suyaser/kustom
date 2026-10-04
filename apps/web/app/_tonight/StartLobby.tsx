'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PLAYERS_PER_GAME } from '@/lib/lobbyRules';
import { invitedLine, START_LOBBY_BUTTON, startLobbySentence } from '@/lib/lobbyStartCopy';
import { groupHome } from '@/lib/nav';
import { SIGN_IN_LABEL, START_LOBBY_OFFLINE, START_LOBBY_SIGN_IN } from '@/lib/tonight/copy';
import { beginTonightPress } from '@/lib/tonight/live';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';
import { usePageGroup } from '../_shell/PageGroup';

/**
 * `Start a lobby` on the tonight page (M4.2's control, M4.7 (a)'s layout).
 *
 * 21:40, seven friends in voice, one of them taps this on a phone. Somebody's League client —
 * nobody had to decide whose — opens a custom with a name and a password neither of them chose,
 * and the invite popup appears for everyone who is around. **It is the one tap this product
 * has**, and everything it needs to decide is decided by the route: who hosts, the name, the
 * password, the four refusals (`lib/lobbyStart.ts`).
 *
 * **Every word here is imported, not retyped.** The button's label, the pending line and the
 * invited line are product's, and they live in one file with the rules that answer with them,
 * so this page and `/admin` cannot drift apart by a character.
 *
 * **Two shapes, one block** (the designer, 2026-09-10):
 *
 *   - **`idle`, for a linked player: the button**, directly under the strip's sentence and
 *     *above* the rack. Ten empty seats are 480px, so a control below them is below the fold on
 *     a 390px phone — and this is the one thing on an idle page anybody can do.
 *   - **`filling`: a readout, with no button.** A lobby row exists, so the route can only answer
 *     `There is already a lobby open.`, and a control whose only outcome is a refusal is not a
 *     control. What is left is worth saying: how many were invited, or that the create failed.
 *
 * **No card and no mark.** It is a stack of lines under the strip; the 2px `brand` inset rule
 * means "this is about you" (the rack's row, `Your role tonight`) and this is about the night.
 *
 * **Drawn for a linked player, and being drawn is not permission** (M4.13). The route runs on
 * M3.6's `/api/me/*` class and resolves the session again with the service-role client before it
 * writes; somebody who forged the markup gets the 403 sentence, not a lobby. An anonymous
 * visitor on the idle page gets {@link StartLobbySignIn} instead — product's
 * `Sign in with Discord to start a lobby.`, suspended on 2026-09-10 and back now that there is
 * a button behind it that they can really press once they are in.
 *
 * **In place, and never a toast** (M3.20). A real `<form>` with a real action, intercepted when
 * JavaScript is running and posted as JSON to the same route; the answer — the pending line or
 * the route's own refusal — is printed where the button is, the URL never changes, no document
 * loads and the focus stays on the button that was pressed. With JavaScript off the form posts
 * and the 303 brings the same sentence back in the query string.
 */

const START_ACTION = '/api/me/lobbies/start';

/** The OAuth round trip, the one thing on this page that navigates (`RoleTonight`'s own). */
const SIGN_IN_ACTION = '/auth/signin';

export interface StartLobbyProps {
  /**
   * Tonight's newest `create_lobby`, read on the server (`lib/tonight/lobbyStart.ts`), or
   * `null` when nobody has pressed today. It is what makes the pending line survive a reload
   * and appear on the *other* admin's phone.
   */
  start: LobbyStartView | null;
  /**
   * Whether the button is drawn: `idle` only. With `false` this is the readout — the same
   * sentences, with nothing to press.
   */
  press: boolean;
  /** How many are in the lobby now: the invited line is drawn until ten are in. */
  around: number;
  /**
   * Ask the server for that row again. `TonightLive` supplies it — `companion_commands` is
   * service-role only and in no Realtime publication, so this is the one change on this page
   * that has to be polled rather than subscribed to.
   */
  onPressed?: (() => void) | undefined;
  /** The button's words; default `Start a lobby`. Finished passes `Start the next lobby`. */
  label?: string | undefined;
  /**
   * M14.66: `Nobody's Kustom is running right now. Ask … to open it.`, under the button on idle when
   * no host has been seen for ten minutes, so the friend knows who to ask before they tap. Any
   * progress line or refusal takes the slot instead (a refused press says the same thing).
   */
  noHostLine?: string | null | undefined;
}

export function StartLobby({ start, press, around, onPressed, label, noHostLine = null }: StartLobbyProps) {
  const group = usePageGroup();
  const [inFlight, setInFlight] = useState(false);
  /** The route's own sentence for a refused press, until the next press clears it. */
  const [refused, setRefused] = useState<string | null>(null);
  /**
   * The host this browser was told about, for the moment between the answer landing and the
   * server re-read arriving. After that the row itself names them, on every device.
   */
  const [pressedHost, setPressedHost] = useState<string | null>(null);

  const progress = start ?? (pressedHost === null ? null : { status: 'pending' as const, error: null });
  const hostName = start?.hostName ?? pressedHost ?? '';
  // A refusal is about the press that was just made and outranks the row from before it.
  const sentence = refused ?? startLobbySentence(progress, hostName);
  /**
   * While the command is live the button goes **quiet** rather than `disabled`: a disabled
   * control drops the focus to `<body>`, and M3.20 is about the focus staying where the
   * keyboard left it. `aria-disabled` says the same thing to a listener, and the submit
   * short-circuits, so the quiet button cannot queue a second command.
   */
  const quiet = progress?.status === 'pending' || progress?.status === 'sent';
  /**
   * `Invited <n> friends — waiting for them to accept.`, under the control while the lobby is
   * filling and until ten are in (product, M4.2). It is the fan-out's own count, so it appears
   * with the invites and not with the press.
   */
  const invited =
    progress?.status === 'acked' && start !== null && start.invited > 0 && around < PLAYERS_PER_GAME
      ? invitedLine(start.invited)
      : null;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    // With JavaScript this control never navigates.
    event.preventDefault();
    // A second tap while one is in flight — or while the last one is still being run by a
    // client — is dropped here rather than by disabling the button (see `quiet`).
    if (inFlight || quiet) return;

    setInFlight(true);
    setRefused(null);
    // The response schema (and zod with it) loads on the press, beside the request, not with the
    // page (M14.44): zod is 86 KB gzip, and every phone that opens Tonight paid for it up front.
    // A chunk that fails to load costs only the host's name for a moment (see below).
    const schemaLoad = import('@/app/api/me/lobbies/start/schema').catch(() => null);
    // Tonight holds its renders until this answers (M19.3): one render for the row and the answer.
    const press = beginTonightPress();
    try {
      // The body decides nothing (`start/schema.ts`): no host, no name, no password, no mode.
      const response = await fetch(START_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: group.id }),
      });
      const answeredAt = Date.now();
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        // One of the four sentences, in the route's own words: it owns the rule it refused.
        // **One exception, and it is the page's** (M4.13): a session that expired between the
        // render and the press answers 401 `sign in required`, which is gate vocabulary. The
        // fact is the same one the signed-out block states, so it is stated in the same words.
        setRefused(response.status === 401 ? START_LOBBY_SIGN_IN : errorOf(body));
        return;
      }
      // **The route's own response schema**, not a hand-read of two fields: one shape,
      // validated at both ends of the wire. A 200 the schema does not recognise names nobody,
      // and the server re-read a moment later fills the sentence in.
      const schema = await schemaLoad;
      const answer = schema?.startLobbyResponseSchema.safeParse(body);
      if (answer?.success) setPressedHost(answer.data.host.name);
      // The row is service-role only, so the page asks the **server** for it again rather than
      // waiting for an event that will never come.
      onPressed?.();
      // In flight until the row is on screen (M19.3), so the button never wakes on the old page.
      await press.answered(answeredAt);
    } catch {
      setRefused(START_LOBBY_OFFLINE);
    } finally {
      press.release();
      setInFlight(false);
    }
  }

  // The readout with nothing to say draws nothing at all, rather than an empty block with a gap
  // in it (the `filling` case for every night nobody pressed the button).
  if (!press && sentence === null && invited === null) return null;

  return (
    <div data-slot="start-lobby" className="flex flex-col items-start gap-2">
      {press ? (
        <form className="w-full" method="post" action={START_ACTION} onSubmit={submit}>
          {/* Only the no-JavaScript path reads this. The route re-validates it as a path. */}
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="redirectTo" value={groupHome(group)} />
          <Button type="submit" pending={quiet} className="w-full sm:w-auto">
            {label ?? START_LOBBY_BUTTON}
          </Button>
        </form>
      ) : null}
      {/*
       * Where the button is, never as a banner and never in the URL (M3.20). One slot: the
       * pending line, a refusal, or nothing at all on success — the member list appearing *is*
       * the answer, and a toast on top of it is noise (product, M4.2).
       *
       * A refusal is 600 and `role="alert"`; a progress line is 400 and `role="status"`. Two
       * weights, because one of them is an answer to a press and the other is a state.
       */}
      {sentence === null ? null : (
        <p
          className={refused === null ? 'text-sm text-muted-foreground' : 'text-sm font-bold'}
          role={refused === null ? 'status' : 'alert'}
        >
          {sentence}
        </p>
      )}
      {invited === null ? null : <p className="text-sm text-muted-foreground">{invited}</p>}
      {press && sentence === null && noHostLine !== null ? (
        <p className="text-sm text-muted-foreground">{noHostLine}</p>
      ) : null}
    </div>
  );
}

/**
 * What a **signed-out** visitor gets where the button would be, on the `idle` page and nowhere
 * else (M4.13, product).
 *
 * 21:40 and a friend whose session expired opens the WhatsApp link on the one night it matters.
 * `RoleTonight` draws nothing at all for them — there is no live lobby to pick themselves out of
 * — so without this there is no door into this site anywhere on the screen.
 *
 * **The role card's signed-out shape**: the sentence is the reason and the button is the label
 * (the designer, 2026-09-10), and it is a real form posting to `/auth/signin` because an OAuth
 * round trip cannot be done in place. **Never a disabled `Start a lobby`** — the M4.2 brief's
 * "disabled with the sentence" was killed by M3.20 and the amber-control rules.
 *
 * In `filling` a signed-out visitor still sees nothing: that block is a readout, not a control,
 * and there is nothing to sign in *for* while a lobby is already open.
 */
export function StartLobbySignIn() {
  const group = usePageGroup();
  return (
    <div data-slot="start-lobby" className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">{START_LOBBY_SIGN_IN}</p>
      <form method="post" action={SIGN_IN_ACTION} className="w-full">
        {/* Back to the tonight page, not to `/admin`, which is where a sign-in defaults. */}
        <input type="hidden" name="next" value={groupHome(group)} />
        <Button type="submit" variant="secondary" className="w-full sm:w-auto">
          {SIGN_IN_LABEL}
        </Button>
      </form>
    </div>
  );
}

/**
 * The API's envelope is `{ ok: false, error }`. Anything else gets the page's own sentence.
 *
 * Read by hand rather than through `apiErrorSchema`: that schema lives in `lib/http.ts` beside
 * `next/server`, and this is a client component. Two fields, one shape, every route.
 */
function errorOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }
  return START_LOBBY_OFFLINE;
}
