'use client';

import { type ClassTag, modeRatedDefault, type RuleOption, ruleKey } from '@customs/core';
import {
  GROUP_MODES,
  type GroupMode,
  type ModeChoice,
  type NextGame,
  ruleOptionOf,
  setGroupModeResponseSchema,
} from '@customs/db/schemas';
import { type FormEvent, useEffect, useId, useState } from 'react';
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
import { NOTHING_TO_SPIN, ratedNotice, ruleChosenNotice, standingNotice } from '@/lib/mode/ruleNotices';
import { SPIN_BROADCAST_EVENT, SPIN_CYCLE_MS, SPIN_REVEAL_EVENT, SPIN_WAIT_MS } from '@/lib/mode/spinEvents';
import { requestTonightRefresh } from '@/lib/tonight/live';
import { cn } from '@/lib/utils';

const MODE_ACTION = '/api/admin/mode';
const SPIN_ACTION = '/api/admin/mode/spin';
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
 *   With JS a confirmed choice **answers on its own** (QA fix 2026-10-04, like the Rated switch):
 *   the route's answer becomes the select's value at its version, so the button goes away at once
 *   and cannot re-post the same choice while the page re-reads.
 * - **`Spin`** (M15.5, R3): the server picks; the card reveals the answer here and on every open
 *   page (the Realtime broadcast). Without JS it is a form post and the page reloads on the result.
 *   With JS it stays quiet (`aria-disabled`) from the tap until its own reveal has played (the page
 *   has re-read the spin's version, then the reveal's cycle), so a double tap never writes twice.
 * - **`Rated`** (M15.5, R9): a switch for the next game, in any mode; a submit button with
 *   `role="switch"`, so it works as a form post with no JS. With JS it **answers on its own**
 *   (prod fix 2026-10-04, "I tap it and nothing changes"): it flips on the tap, takes the route's
 *   `next.rated` as the answer, and reverts with `Couldn't change that.` on a failure. It used to
 *   be only the page's `nextRated`, which moves when the whole Tonight page has been re-read; until
 *   then a tap showed nothing and a second tap posted the same value again. The page's value takes
 *   over again once it is at least as new as the write (`version`, the card's token).
 * - **`Reset fearless`** while the standing mode is Fearless and the pool has a ban.
 * - After Roll every change is for the next game: `Changes apply from the next game.` and
 *   `Next game: Mages only.` (the page's `nextLine`).
 * - Outcomes show in place (`role="status"`, a refusal `role="alert"`), never as a toast.
 */
export interface ModeControlsProps {
  groupId: string;
  /** The standing mode. */
  mode: GroupMode;
  /** Bans in the pool now, for whether Reset shows and its dialog sentence. */
  banned: number;
  /** After Roll (teams set or in game): every change is for the next game. */
  inGame: boolean;
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
  /**
   * `group_modes.version` the page's `nextRated` was read at: once a re-read is at least as new
   * as the switch's own write, the page's value wins again (another admin, a recorded game).
   */
  version?: number | undefined;
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
  redirectTo,
  resetConfirmHref,
  selected = mode,
  tooFew = [],
  nextRated = true,
  version,
  nextLine = null,
  notice,
  error,
}: ModeControlsProps) {
  const selectId = useId();
  const sentenceId = useId();
  const ratedSentenceId = useId();
  const [choice, setChoice] = useState<string>(selected);
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState<'mode' | 'spin' | 'rated' | null>(null);
  const [said, setSaid] = useState<string | null>(notice ?? null);
  const [failed, setFailed] = useState<string | null>(error ?? null);

  // The switch's own answer since its last tap (see the doc comment): `pending` while the write
  // is in flight, `confirmed` with the route's version once it answered, null for the page's value.
  const [ratedLocal, setRatedLocal] = useState<RatedLocal | null>(null);
  const rated =
    ratedLocal === null
      ? nextRated
      : ratedLocal.kind === 'confirmed' && pageCaughtUp(version, ratedLocal.version)
        ? nextRated
        : ratedLocal.rated;

  // The select's confirmed value since the last Set mode or Spin (the route's answer at its
  // version), the same handback: the page's `selected` wins again once it is at least as new.
  const [modeLocal, setModeLocal] = useState<{ value: string; version: number } | null>(null);
  const current =
    modeLocal !== null && !pageCaughtUp(version, modeLocal.version) ? modeLocal.value : selected;

  // Spin's own reveal: from the tap until the page has re-read the spin and the reveal has cycled.
  const [spinHeld, setSpinHeld] = useState<{ version: number } | null>(null);

  useEffect(() => setHydrated(true), []);
  // A Realtime change from another admin moves the select with the card.
  useEffect(() => setChoice(current), [current]);
  useEffect(() => {
    if (spinHeld === null) return;
    // Once the page has the spin, the reveal cycles; a page that never re-reads (Realtime down)
    // still frees Spin after the reveal's own wait.
    const caughtUp = pageCaughtUp(version, spinHeld.version);
    const timer = setTimeout(
      () => setSpinHeld(null),
      caughtUp ? SPIN_CYCLE_MS : SPIN_WAIT_MS + SPIN_CYCLE_MS,
    );
    return () => clearTimeout(timer);
  }, [spinHeld, version]);

  async function post(
    action: string,
    body: Record<string, unknown>,
    kind: 'mode' | 'spin' | 'rated',
  ): Promise<{ ok: true; spun: RuleOption | null; next: NextGame | null } | { ok: false; status: number }> {
    setPending(kind);
    setFailed(null);
    setSaid(null);
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId, ...body }),
      });
      if (!response.ok) return { ok: false, status: response.status };
      const parsed = setGroupModeResponseSchema.safeParse(await response.json().catch(() => null));
      const spun = parsed.success && parsed.data.spun !== undefined ? ruleOptionOf(parsed.data.spun) : null;
      return { ok: true, spun, next: parsed.success ? (parsed.data.next ?? null) : null };
    } catch {
      return { ok: false, status: 0 };
    } finally {
      setPending(null);
    }
  }

  async function setMode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending !== null || choice === current) return;
    const result = await post(MODE_ACTION, { mode: choice }, 'mode');
    if (!result.ok) {
      setFailed(MODE_CHANGE_FAILED);
      setChoice(current);
      return;
    }
    confirm(choice, result.next);
    const rule = ruleOptionOf(choice as ModeChoice);
    // The rule's default rated flag is the server's; the card and the announcer say it on refresh.
    setSaid(
      rule === null
        ? standingNotice(choice as GroupMode, current !== mode)
        : ruleChosenNotice(rule, modeRatedDefault(rule.id)),
    );
    requestTonightRefresh();
  }

  async function spin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending !== null || spinHeld !== null) return;
    const result = await post(SPIN_ACTION, {}, 'spin');
    if (!result.ok) {
      setFailed(result.status === 409 ? NOTHING_TO_SPIN : MODE_CHANGE_FAILED);
      return;
    }
    setSpinHeld({ version: result.next?.version ?? (version ?? 0) + 1 });
    if (result.spun !== null) {
      const rule = ruleKey(result.spun);
      confirm(rule, result.next);
      // This page's reveal is the route's own answer (`local`); the broadcast is checked by others.
      window.dispatchEvent(new CustomEvent(SPIN_REVEAL_EVENT, { detail: { rule, source: 'local' } }));
      window.dispatchEvent(new CustomEvent(SPIN_BROADCAST_EVENT, { detail: { rule } }));
    }
    requestTonightRefresh();
  }

  /** A Set mode or Spin the route confirmed: the select's value, and the switch reset with it (R1). */
  function confirm(value: string, next: NextGame | null): void {
    const written = next?.version ?? (version ?? 0) + 1;
    setModeLocal({ value, version: written });
    if (next !== null) setRatedLocal({ kind: 'confirmed', rated: next.rated, version: next.version });
  }

  async function flipRated(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending !== null) return;
    // The switch as it shows now, never the page's possibly older prop.
    const target = !rated;
    const before = ratedLocal;
    setRatedLocal({ kind: 'pending', rated: target });
    const result = await post(MODE_ACTION, { rated: target }, 'rated');
    if (!result.ok) {
      setRatedLocal(before);
      setFailed(MODE_CHANGE_FAILED);
      return;
    }
    // The route's answer is the next game as written; a 200 without one moved the version anyway.
    const answer = result.next?.rated ?? target;
    const written = result.next?.version ?? (version ?? 0) + 1;
    setRatedLocal({ kind: 'confirmed', rated: answer, version: written });
    setSaid(ratedNotice(answer));
    requestTonightRefresh();
  }

  const showSet = !hydrated || choice !== current;
  const spinBusy = pending === 'spin' || spinHeld !== null;
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
            name="mode"
            value={choice}
            aria-describedby={sentenceId}
            onChange={(event) => setChoice(event.target.value)}
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
        <ResetFearless groupId={groupId} banned={banned} confirmHref={resetConfirmHref} onSaid={setSaid} />
      ) : null}

      {failed === null ? null : (
        <p role="alert" className="text-sm font-bold">
          {failed}
        </p>
      )}
      <p role="status" className="text-sm empty:hidden">
        {said}
      </p>
    </div>
  );
}

/** The page has re-read at least as new as a write of ours (`version`, the card's token). */
function pageCaughtUp(version: number | undefined, written: number): boolean {
  return version !== undefined && version >= written;
}

/** The Rated switch's own answer: the tap in flight, or the route's answer at its version. */
type RatedLocal =
  | { kind: 'pending'; rated: boolean }
  | { kind: 'confirmed'; rated: boolean; version: number };

function ResetFearless({
  groupId,
  banned,
  confirmHref,
  onSaid,
}: {
  groupId: string;
  banned: number;
  confirmHref: string;
  onSaid: (line: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(RESET_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
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
      setOpen(false);
      setPending(false);
      requestTonightRefresh();
    } catch {
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
      <AlertDialogContent>
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
