'use client';

import { type ClassTag, modeRatedDefault, type RuleOption, ruleKey } from '@customs/core';
import {
  GROUP_MODES,
  type GroupMode,
  type ModeChoice,
  type NextGame,
  ruleOptionOf,
  legacyModeAnswerSchema,
} from '@customs/db/schemas';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  FEARLESS_RESET_BUTTON,
  FEARLESS_RESET_CANCEL,
  FEARLESS_RESET_FAILED,
  FEARLESS_RESET_POSTED,
  FEARLESS_RESET_SKIPPED,
  FEARLESS_RESET_TITLE,
  FEARLESS_RESETTING,
  fearlessResetBody,
} from '@/lib/fearless/copy';
import { applyModeAnswer, beginOptimistic, endOptimistic, type ModeOptimistic } from '@/lib/mode/clientStore';
import { type ControlsWrite, controlsOf, useControls } from '@/lib/mode/controlsStore';
import {
  MODE_ADMIN_EYEBROW,
  MODE_APPLIES_NEXT_GAME,
  MODE_CHANGE_FAILED,
  MODE_NAMES,
  MODE_PICKER_LABEL,
  MODE_PICKER_SENTENCES,
  MODE_SETTINGS_LABEL,
  SET_MODE,
  SETTING_MODE,
} from '@/lib/mode/copy';
import {
  OPTGROUP_CLASS,
  OPTGROUP_MIRROR,
  OPTGROUP_REGION,
  optionLabel,
  RATED_LABEL,
  RATED_OFF,
  RATED_ON,
  ruleSentence,
  SPIN,
  SPINNING,
  TOO_FEW_OPEN,
} from '@/lib/mode/ruleCopy';
import {
  NOTHING_TO_SPIN,
  RULE_TOO_FEW_OPEN,
  ratedNotice,
  ruleChosenNotice,
  standingNotice,
} from '@/lib/mode/ruleNotices';
import { SPIN_BROADCAST_EVENT, SPIN_CYCLE_MS, SPIN_REVEAL_EVENT, SPIN_WAIT_MS } from '@/lib/mode/spinEvents';
import { beginTonightPress, requestTonightRefresh } from '@/lib/tonight/live';
import { cn } from '@/lib/utils';

const MODE_ACTION = '/api/admin/mode';
// M20.7: Spin posts to the one mode route with `spin=true` (`/api/admin/mode/spin` is gone).
const SPIN_ACTION = MODE_ACTION;
const RESET_ACTION = '/api/admin/fearless/reset';

const CLASS_CHOICES: readonly ClassTag[] = ['Tank', 'Marksman', 'Mage', 'Assassin', 'Support'];

/**
 * The Mode card's admin foot (M14.30, extended by M15.5; 05-design.md 8.4.2): admins and the owner
 * only. The page draws it from the session on the server; the routes check the session and the
 * group again.
 *
 * - **The mode: a native `<select>` and a `Set mode` button**, never a submit on change (arrowing
 *   through a closed select on Windows fires `change` per option and would cycle the live mode for
 *   everyone). `Normal`, `Fearless`, then the rule optgroups (M15.5); a rule too small under
 *   Fearless is a disabled option with ` (too few open)`. Picking Normal or Fearless clears a
 *   pending rule (R1). The button shows once the choice differs; without JS it is always there.
 *   **The select shows what is set** (the pending rule, else the standing mode) before and after
 *   Roll (owner bug 1, 2026-10-04: it used to show what the record would leave, so after Roll it
 *   read Normal while the game was Tanks). After Roll the pending rule is the one this game locked;
 *   `Set mode` is offered for it anyway (`requeue`), so it can be queued for the next game too
 *   (owner bug 3). M19.13: the tap is **optimistic** on the card (the client mode store shows core's
 *   own transition at once), `Setting…` until the route confirms, and the route's answer goes into
 *   the store, so the card is the new one with no server render; a failure puts the card back.
 * - **`Spin`** (M15.5, R3): the server picks; the card reveals the answer here and on every open
 *   page (the Realtime broadcast). Without JS it is a form post and the page reloads on the result.
 *   With JS it stays quiet (`aria-disabled`) from the tap until its own reveal has played. M19.13:
 *   the route's answer goes into the client mode store and its reveal plays at once (`local`);
 *   other pages' reveals wait for their `group_modes` row.
 * - **`Rated`** (M15.5, R9): a switch for the next game, in any mode; a submit button with
 *   `role="switch"`, so it works as a form post with no JS. With JS it flips on the tap (prod fix
 *   2026-10-04, "I tap it and nothing changes"; M19.13: an optimistic tap in the client mode store),
 *   takes the route's `next` as the answer, and reverts with `Couldn't change that.` on a failure.
 *   An answer without `next` is never guessed at: the page re-reads.
 * - **State** (audit defects 2, 7, 8): what is set comes in as props from the client mode store and
 *   is never copied; the controls' own state is the unsaved pick, the write in flight, Spin's quiet
 *   time and the outcome line (`lib/mode/controlsStore.ts`), kept per group so a Roll that moves the
 *   card to another place on the page loses none of it.
 * - **`Reset fearless`** while the standing mode is Fearless and the pool has a ban.
 * - After Roll every change is for the next game: `Changes apply from the next game.` and
 *   `Next game: Mages only.` (the page's `nextLine`).
 * - Outcomes show in place, never as a toast; a refusal is `role="alert"`. The outcome line is not
 *   a live region: Tonight's Announcer speaks the card's change once (QA fix 2026-10-04).
 * - **Focus never drops to the page** (QA fix 2026-10-04): a confirmed Set mode hides its button,
 *   so focus moves to the select; a reset closes its dialog and its trigger goes with the bans, so
 *   focus moves to the outcome line (`tabIndex={-1}`).
 */
export interface ModeControlsProps {
  groupId: string;
  /** The standing mode. */
  mode: GroupMode;
  /** Bans in the pool now, for whether Reset shows and its dialog sentence. */
  banned: number;
  /** After Roll (teams set or in game): every change is for the next game. */
  inGame: boolean;
  /**
   * After Roll, the pending rule is the one this game locked and nothing changed since: picking it
   * again queues it for the next game too (`requeueable`), so `Set mode` is offered for it.
   */
  requeue?: boolean | undefined;
  /** Tonight's path: where the no-JS forms come back to. */
  redirectTo: string;
  /** `/g/<slug>/mode/reset`: where Reset goes without JS, to confirm before anything is cleared. */
  resetConfirmHref: string;
  /** The select's current value: the standing mode or the pending rule's key (M15.5). */
  selected?: string | undefined;
  /** Rule keys too small to pick under Fearless (M15.5). */
  tooFew?: readonly string[] | undefined;
  /** Whether the next game is rated: the switch's state (M15.5). */
  nextRated?: boolean | undefined;
  /** After Roll, when something changed since: `Next game: Mages only.` (M15.5). */
  nextLine?: string | null | undefined;
  /** A no-JS post's outcome, carried back in `?notice=` / `?error=`. */
  notice?: string | null | undefined;
  error?: string | null | undefined;
}

export function ModeControls({
  groupId,
  mode,
  banned,
  inGame,
  requeue = false,
  redirectTo,
  resetConfirmHref,
  selected = mode,
  tooFew = [],
  nextRated = true,
  nextLine = null,
  notice,
  error,
}: ModeControlsProps) {
  const selectId = useId();
  const sentenceId = useId();
  const ratedSentenceId = useId();
  const [hydrated, setHydrated] = useState(false);
  const [controls, dispatch] = useControls(groupId);
  const selectRef = useRef<HTMLSelectElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  // What is set is the card's (the client mode store, a tap in flight included): never a copy.
  const current = selected;
  const rated = nextRated;
  const choice = controls.pick ?? current;
  const pending = controls.pending;
  const said = controls.said ?? (controls.acted ? null : (notice ?? null));
  const failed = controls.failed ?? (controls.acted ? null : (error ?? null));

  useEffect(() => setHydrated(true), []);
  // Spin's quiet time is a deadline in the store, so it outlives a remount (a Roll moves the card).
  useEffect(() => {
    if (controls.spinUntil === null) return;
    const timer = setTimeout(
      () => dispatch({ type: 'spin-free' }),
      Math.max(0, controls.spinUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [controls.spinUntil, dispatch]);

  /**
   * One write to a mode route. M19.13: no Tonight press: the route's answer goes into the client
   * mode store (`applyModeAnswer`), which is the card, and the route's `group_live` bump re-reads
   * nothing once its `group_modes` row has arrived (`TonightLive`). `optimistic` is shown on the card
   * while the write is in flight. An answer without the card's new state is never guessed at: the
   * page re-reads instead.
   */
  async function post(
    action: string,
    body: Record<string, unknown>,
    optimistic: ModeOptimistic | null = null,
  ): Promise<{ ok: true; spun: RuleOption | null; next: NextGame | null } | { ok: false; status: number }> {
    const token = optimistic === null ? null : beginOptimistic(groupId, optimistic);
    const done = () => {
      if (token !== null) endOptimistic(groupId, token);
    };
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId, ...body }),
      });
      if (!response.ok) {
        done();
        return { ok: false, status: response.status };
      }
      // M20.7: the answer is `{ state, notice }` plus the fields this client reads; M20.8 moves it to `state`.
      const parsed = legacyModeAnswerSchema.safeParse(await response.json().catch(() => null));
      const spun = parsed.success && parsed.data.spun !== undefined ? ruleOptionOf(parsed.data.spun) : null;
      const next = parsed.success ? (parsed.data.next ?? null) : null;
      // The answer first, then the tap goes: the card never flashes back to the old state.
      if (next !== null) applyModeAnswer(groupId, next);
      else void requestTonightRefresh();
      done();
      return { ok: true, spun, next };
    } catch {
      done();
      return { ok: false, status: 0 };
    }
  }

  /** Starts a write unless one is in flight (a double tap posts once). */
  function begin(write: ControlsWrite): boolean {
    if (controlsOf(groupId).pending !== null) return false;
    dispatch({ type: 'start', write });
    return true;
  }

  async function setMode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const picked = choice;
    // The pending rule picked again after Roll queues it for the next game too (owner bug 3).
    if ((picked === current && !requeue) || !begin('mode')) return;
    const result = await post(MODE_ACTION, { mode: picked }, { kind: 'choice', choice: picked });
    if (!result.ok) {
      // 409: the server's rule check (a page older than the pool, QA fix 2026-10-04).
      dispatch({ type: 'refused', failed: result.status === 409 ? RULE_TOO_FEW_OPEN : MODE_CHANGE_FAILED });
      return;
    }
    const rule = ruleOptionOf(picked as ModeChoice);
    dispatch({
      type: 'answered',
      said:
        rule === null
          ? standingNotice(picked as GroupMode, current !== mode)
          : ruleChosenNotice(rule, result.next?.rated ?? modeRatedDefault(rule.id)),
    });
    // The card is the answer already (M19.13): the button goes, focus stays on the select.
    selectRef.current?.focus();
  }

  async function spin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (controlsOf(groupId).spinUntil !== null || !begin('spin')) return;
    const result = await post(SPIN_ACTION, { spin: true });
    if (!result.ok) {
      dispatch({ type: 'refused', failed: result.status === 409 ? NOTHING_TO_SPIN : MODE_CHANGE_FAILED });
      return;
    }
    // With the answer on the card the reveal cycles now; without it, wait for the re-read too.
    const quiet = result.next !== null ? SPIN_CYCLE_MS : SPIN_WAIT_MS + SPIN_CYCLE_MS;
    dispatch({ type: 'answered', said: null, spinUntil: Date.now() + quiet });
    if (result.spun !== null) {
      const rule = ruleKey(result.spun);
      // This page's reveal is the route's own answer (`local`); the broadcast is checked by others.
      window.dispatchEvent(new CustomEvent(SPIN_REVEAL_EVENT, { detail: { rule, source: 'local' } }));
      window.dispatchEvent(new CustomEvent(SPIN_BROADCAST_EVENT, { detail: { rule } }));
    }
  }

  async function flipRated(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // The switch as it shows now (the card's value, a tap in flight included).
    const target = !rated;
    if (!begin('rated')) return;
    const result = await post(MODE_ACTION, { rated: target }, { kind: 'rated', rated: target });
    if (!result.ok) {
      dispatch({ type: 'refused', failed: MODE_CHANGE_FAILED });
      return;
    }
    // The route's answer is the next game as written.
    dispatch({ type: 'answered', said: ratedNotice(result.next?.rated ?? target) });
  }

  // `Setting…` stays up until the route confirms (M19.13: the card already shows the tap), then goes.
  const showSet = !hydrated || choice !== current || requeue || pending === 'mode';
  const spinBusy = pending === 'spin' || controls.spinUntil !== null;
  // Design round 1: `Next game: Mages only.` already says it; don't repeat `Changes apply…` under it.
  const afterRoll = inGame && nextLine === null;
  const chosenRule = ruleOptionOf(choice as ModeChoice);
  // M14.76: `Changes apply from the next game.` is said once, under the eyebrow, not under each control.
  const sentence = chosenRule === null ? MODE_PICKER_SENTENCES[choice as GroupMode] : ruleSentence(mode);
  const option = (rule: RuleOption) => {
    const key = ruleKey(rule);
    const small = tooFew.includes(key);
    return (
      <option key={key} value={key} disabled={small}>
        {optionLabel(rule)}
        {small ? TOO_FEW_OPEN : ''}
      </option>
    );
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-raised/45 px-(--card-pad) py-4">
      <p className="font-mono text-2xs text-muted-foreground">{MODE_ADMIN_EYEBROW}</p>
      {afterRoll ? <p className="text-sm text-muted-foreground">{MODE_APPLIES_NEXT_GAME}</p> : null}
      {nextLine === null ? null : <p className="text-sm font-bold">{nextLine}</p>}
      <form
        method="post"
        action={MODE_ACTION}
        onSubmit={(event) => void setMode(event)}
        aria-label={MODE_SETTINGS_LABEL}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <label htmlFor={selectId} className="text-xs font-bold">
          {MODE_PICKER_LABEL}
        </label>
        {/* Row 1 the select at full width, row 2 `[Set mode][Spin]`; one row only when the card
            itself is 520px or wider (a container query, never the viewport; design round 1). */}
        <div className="flex flex-col gap-2 @[520px]:flex-row @[520px]:items-center">
          <NativeSelect
            id={selectId}
            ref={selectRef}
            name="mode"
            value={choice}
            aria-describedby={sentenceId}
            onChange={(event) => dispatch({ type: 'pick', value: event.target.value })}
            className="w-full @[520px]:max-w-sm @[520px]:flex-1"
          >
            {GROUP_MODES.map((one) => (
              <option key={one} value={one}>
                {MODE_NAMES[one]}
              </option>
            ))}
            <optgroup label={OPTGROUP_CLASS}>
              {CLASS_CHOICES.map((tag) => option({ id: 'class', tag }))}
            </optgroup>
            <optgroup label={OPTGROUP_REGION}>{option({ id: 'region' })}</optgroup>
            <optgroup label={OPTGROUP_MIRROR}>{option({ id: 'mirror' })}</optgroup>
          </NativeSelect>
          <div className="flex flex-wrap gap-2">
            {showSet ? (
              <Button type="submit" pending={pending === 'mode'}>
                {pending === 'mode' ? SETTING_MODE : SET_MODE}
              </Button>
            ) : null}
            {/* Spin sits on the select's row (8.4.2), in its own form so it posts with no JS. */}
            <Button type="submit" form={`${selectId}-spin`} variant="secondary" pending={spinBusy}>
              {spinBusy ? SPINNING : SPIN}
            </Button>
          </div>
        </div>
        <p id={sentenceId} className="text-xs text-muted-foreground empty:hidden">
          {sentence}
        </p>
      </form>
      <form
        id={`${selectId}-spin`}
        method="post"
        action={SPIN_ACTION}
        onSubmit={(event) => void spin(event)}
        hidden
      >
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="spin" value="true" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
      </form>

      <form
        method="post"
        action={MODE_ACTION}
        onSubmit={(event) => void flipRated(event)}
        className="flex flex-col gap-1"
      >
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <button
          type="submit"
          name="rated"
          value={rated ? 'false' : 'true'}
          role="switch"
          aria-checked={rated}
          aria-describedby={ratedSentenceId}
          aria-disabled={pending === 'rated' ? true : undefined}
          className="group inline-flex min-h-11 w-fit items-center gap-3 rounded-control text-[1.0625rem] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span
            aria-hidden="true"
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors duration-(--dur-fast) forced-colors:border-[CanvasText]',
              rated ? 'border-foreground bg-foreground' : 'border-border-strong bg-transparent',
            )}
          >
            <span
              className={cn(
                'block size-4 rounded-full transition-transform duration-(--dur-fast) motion-reduce:transition-none',
                rated ? 'translate-x-[22px] bg-card' : 'translate-x-[2px] bg-muted-foreground',
              )}
            />
          </span>
          {RATED_LABEL}
        </button>
        <p id={ratedSentenceId} className="text-xs text-muted-foreground">
          {rated ? RATED_ON : RATED_OFF}
        </p>
      </form>

      {mode === 'fearless' && banned > 0 ? (
        <ResetFearless
          groupId={groupId}
          banned={banned}
          confirmHref={resetConfirmHref}
          onSaid={(line) => dispatch({ type: 'answered', said: line })}
          onClosed={() => statusRef.current?.focus()}
        />
      ) : null}

      {failed === null ? null : (
        <p role="alert" className="text-sm font-bold">
          {failed}
        </p>
      )}
      {/* No live region here (QA fix 2026-10-04): Tonight's one Announcer says every outcome when
          the card re-reads, so a role="status" here said each one twice. A reset's line is read
          because focus moves to it. */}
      <p ref={statusRef} tabIndex={-1} data-slot="mode-outcome" className="text-sm empty:hidden">
        {said}
      </p>
    </div>
  );
}

function ResetFearless({
  groupId,
  banned,
  confirmHref,
  onSaid,
  onClosed,
}: {
  groupId: string;
  banned: number;
  confirmHref: string;
  onSaid: (line: string) => void;
  /** After a reset the dialog closes onto the outcome line, not its trigger (gone with the bans). */
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  async function reset(): Promise<void> {
    setPending(true);
    setError(null);
    const press = beginTonightPress();
    try {
      const response = await fetch(RESET_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId }),
      });
      const answeredAt = Date.now();
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        press.release();
        setError(MODE_CHANGE_FAILED);
        setPending(false);
        return;
      }
      const post = typeof body === 'object' && body !== null && 'post' in body ? body.post : null;
      onSaid(
        post === 'posted'
          ? FEARLESS_RESET_POSTED
          : post === 'skipped'
            ? FEARLESS_RESET_SKIPPED
            : FEARLESS_RESET_FAILED,
      );
      done.current = true;
      setOpen(false);
      setPending(false);
      // Not held open until the re-read lands: the re-read removes this dialog's trigger with the
      // bans, and a dialog unmounted while open would drop the focus to <body>. The outcome line
      // is focused on close instead. The ask still joins a render already running (M19.3).
      void press.answered(answeredAt);
    } catch {
      press.release();
      setError(MODE_CHANGE_FAILED);
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {/* Without JS this is a plain GET to the confirm page (`/g/<slug>/mode/reset`), which asks the
          same question and posts the reset from there: a reset is never one tap away. With JS the
          submit is cancelled and the AlertDialog asks instead. */}
      <form method="get" action={confirmHref} onSubmit={(event) => event.preventDefault()}>
        <AlertDialogTrigger asChild>
          <Button type="submit" variant="secondary" className="w-full sm:w-auto">
            {FEARLESS_RESET_BUTTON}
          </Button>
        </AlertDialogTrigger>
      </form>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!done.current) return;
          done.current = false;
          event.preventDefault();
          onClosed();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{FEARLESS_RESET_TITLE}</AlertDialogTitle>
          <AlertDialogDescription>{fearlessResetBody(banned)}</AlertDialogDescription>
        </AlertDialogHeader>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button type="button" variant="destructive" pending={pending} onClick={() => void reset()}>
            {pending ? FEARLESS_RESETTING : FEARLESS_RESET_BUTTON}
          </Button>
          <AlertDialogCancel>{FEARLESS_RESET_CANCEL}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
