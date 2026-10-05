'use client';

import {
  type ClassTag,
  type Mode,
  type ModeLock,
  type PendingRule,
  type RuleOption,
  ruleKey,
  ruleOf,
} from '@customs/core';
import {
  GROUP_MODES,
  type GroupMode,
  type ModeChoice,
  type ModeRowState,
  ruleOptionOf,
  setGroupModeResponseSchema,
} from '@customs/db/schemas';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
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
import type { RegionTarget } from '@/lib/mode/cardView';
import {
  applyLockAnswer,
  applyModeRow,
  beginOptimistic,
  endOptimistic,
  lockKey,
  type ModeOptimistic,
  rowTime,
} from '@/lib/mode/clientStore';
import {
  type CardMark,
  type ControlsWrite,
  controlsOf,
  type RegionWrite,
  useControls,
} from '@/lib/mode/controlsStore';
import {
  MODE_ADMIN_EYEBROW,
  MODE_APPLIES_NEXT_GAME,
  MODE_CHANGE_FAILED,
  MODE_NAMES,
  MODE_PICKER_LABEL,
  MODE_PICKER_LABEL_NEXT,
  MODE_PICKER_SENTENCES,
  MODE_SETTINGS_LABEL,
  SET_MODE,
  SETTING_MODE,
} from '@/lib/mode/copy';
import {
  OPTGROUP_CLASS,
  OPTGROUP_MIRROR,
  OPTGROUP_REGION,
  oneGameLine,
  optionLabel,
  RATED_LABEL,
  RATED_OFF,
  RATED_OFF_THIS,
  RATED_ON,
  RATED_ON_THIS,
  ruleSentence,
  SPIN,
  SPINNING,
  THIS_GAME_HEADING,
  TOO_FEW_OPEN,
} from '@/lib/mode/ruleCopy';
import { NOTHING_TO_SPIN, PICK_A_LOBBY_FIRST, RULE_TOO_FEW_OPEN } from '@/lib/mode/ruleNotices';
import { SPIN_BROADCAST_EVENT, SPIN_CYCLE_MS, SPIN_REVEAL_EVENT, SPIN_WAIT_MS } from '@/lib/mode/spinEvents';
import { beginTonightPress, requestTonightRefresh } from '@/lib/tonight/live';
import { resetBodyLobbies, THAT_LOBBY_ENDED } from '@/lib/tonight/switcher';
import { cn } from '@/lib/utils';
import { type RegionChange, RegionControls } from './RegionControls';

const MODE_ACTION = '/api/admin/mode';
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
 *   **The select shows what is set for the next game** (the row: `pending ?? standing`), before and
 *   after Roll (owner bug 1, 2026-10-04). M20.8: Roll moves the pending rule onto the lobby, so after
 *   Roll the row is empty and picking this game's rule again simply queues it (owner bug 3 needs no
 *   special case). The tap is **optimistic** on the card (a draft of the last tap in the client
 *   mode store), `Setting…` until the route confirms; the route's `{ state, notice }` goes into the
 *   store and the outcome line, so the card is the new one with no server render and the line is
 *   the route's, never recomputed; a failure puts the card back.
 * - **`Spin`** (M15.5, R3): the server picks; the card reveals the answer here and on every open
 *   page (the Realtime broadcast). Without JS it is a form post and the page reloads on the result.
 *   With JS it stays quiet (`aria-disabled`) from the tap until its own reveal has played. M19.13:
 *   the route's answer goes into the client mode store and its reveal plays at once (`local`);
 *   other pages' reveals wait for their `group_modes` row.
 * - **`Rated`** (M15.5, R9): a switch for the next game, in any mode; a submit button with
 *   `role="switch"`, so it works as a form post with no JS. With JS it flips on the tap (prod fix
 *   2026-10-04, "I tap it and nothing changes"; M19.13: an optimistic tap in the client mode store),
 *   takes the route's `state` as the answer, and reverts with `Couldn't change that.` on a failure.
 *   An answer that does not parse is never guessed at: the page re-reads.
 * - **State** (audit defects 2, 7, 8): what is set comes in as props from the client mode store and
 *   is never copied; the controls' own state is the unsaved pick, the write in flight, Spin's quiet
 *   time and the outcome line (`lib/mode/controlsStore.ts`), kept per group so a Roll that moves the
 *   card to another place on the page loses none of it.
 * - **`Reset fearless`** while the standing mode is Fearless and the pool has a ban.
 * - **M20.18: while the lobby is balanced (`thisGame`) the picker, Spin and Rated act on this game**
 *   (`game: 'this'`, the owner's "until the game starts, mode changes are for this game"): they
 *   show the lock's values under the `This game` legend with this game's region pair, and the
 *   answer's `thisGame` is on the card at once (`applyLockAnswer`); the route's repost and its
 *   `group_live` bump refresh every other page. Below the hairline the next game keeps only what
 *   still applies to it: a queued next-game region pair, headed `Next game`.
 * - In game every change is for the next game: `Changes apply from the next game.` heads the
 *   next-game group under the `Next game` picker (05-design 8.3.1: no bold `nextLine` in the foot).
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
  /** After Roll (teams set or in game): the picker is the next game's unless `thisGame` is given. */
  inGame: boolean;
  /**
   * M20.18: the lobby is balanced, so the picker, Spin and Rated act on this game's lock: its id
   * (the answer is keyed on it), the select's value, whether it is rated, its standing mode and the
   * rule keys too small to pick for it. Absent or null: they act on the next game (the row).
   */
  thisGame?: ThisGameControls | null | undefined;
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
  /** A no-JS post's outcome, carried back in `?notice=` / `?error=`. */
  notice?: string | null | undefined;
  error?: string | null | undefined;
  /**
   * M20.10: the region pairs an admin may still change (`regionTargets`): this game's while the
   * lobby is balanced, the next game's while region wars is pending. Absent: none.
   */
  regions?: { this: RegionTarget | null; next: RegionTarget | null } | undefined;
  /** The card's status already shows the next game's pair and its short-pair line (before Roll). */
  statusShowsNext?: boolean | undefined;
  /**
   * M20.15: the card as it is now (the row's `updated_at`, this game's pair). When it moves on
   * from a write this page did not make, the page's own outcome line goes. Absent: never.
   */
  card?: CardMark | undefined;
  /**
   * M22.6: while two or more lobbies are live, the lobby this card writes (`lobbyId` in every mode
   * body and no-JS form), its client store key (`modeCardKey`), and the foot's sentence under the
   * picker (14.5). Absent with one lobby: today's bodies, keys and foot.
   */
  lobbyId?: string | null | undefined;
  storeKey?: string | undefined;
  lobbyNote?: string | null | undefined;
  /** M22.6: live lobbies, for the Reset dialog's `in both lobbies` (14.11). Default one. */
  lobbyCount?: number | undefined;
}

/** This game's values for the controls while the lobby is balanced (M20.18). */
export interface ThisGameControls {
  lobbyId: string;
  /** The lock's rule key, else its standing mode. */
  selected: string;
  /** Whether this game is rated (core's `lockRated`). */
  rated: boolean;
  standing: GroupMode;
  tooFew: readonly string[];
}

export function ModeControls({
  groupId,
  mode,
  banned,
  inGame,
  thisGame = null,
  redirectTo,
  resetConfirmHref,
  selected = mode,
  tooFew = [],
  nextRated = true,
  notice,
  error,
  regions,
  statusShowsNext = false,
  card,
  lobbyId = null,
  storeKey = groupId,
  lobbyNote = null,
  lobbyCount = 1,
}: ModeControlsProps) {
  const selectId = useId();
  const sentenceId = useId();
  const ratedSentenceId = useId();
  const [hydrated, setHydrated] = useState(false);
  const [controls, dispatch] = useControls(storeKey);
  const selectRef = useRef<HTMLSelectElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  // What is set is the card's (the client mode store, a tap in flight included): never a copy.
  // M20.18: while balanced, this game's lock; otherwise the row (the next game).
  const forThis = thisGame !== null;
  const current = thisGame?.selected ?? selected;
  const rated = thisGame?.rated ?? nextRated;
  const tooFewNow = thisGame?.tooFew ?? tooFew;
  /** The target every picker, Spin and Rated write names while balanced. */
  const target: { game?: 'this' } = forThis ? { game: 'this' } : {};
  const choice = controls.pick ?? current;
  const pending = controls.pending;
  const said = controls.said ?? (controls.acted || controls.noticeGone ? null : (notice ?? null));
  const failed = controls.failed ?? (controls.acted ? null : (error ?? null));

  useEffect(() => setHydrated(true), []);

  // M20.15: the card moved on from a write this page did not make (another admin, a Roll, a
  // record): the outcome line said for the old card goes, so it never contradicts the card above
  // it. Each line marks the card it was said for (`saidFor`); the page's own answer is that card,
  // so it stays. A refusal stays (M20.17). Checked when the card moves and when a line is said
  // (an answer older than a row already heard is stale at once), and on a remount (a Roll).
  const cardAt = card?.updatedAt ?? null;
  const cardPair = card?.thisPair ?? null;
  const cardLock = card?.thisLock ?? null;
  const cardNow = useRef<CardMark | null>(card ?? null);
  cardNow.current = card ?? null;
  const loadedCard = useRef({ at: cardAt, pair: cardPair });
  const seenPair = useRef(cardPair);
  const seenLock = useRef(cardLock);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the card or the line moves; the rest is read fresh.
  useEffect(() => {
    // This game's pair is the server render's: a `this` answer's pair arrives on the card a moment
    // after its line, so only a move of the pair to another pair than the line's is someone else's.
    const pairMoved = cardPair !== seenPair.current;
    seenPair.current = cardPair;
    // M20.18: likewise this game's lock (rule, standing, Rated): moved to another lock than the line's.
    const lockMoved = cardLock !== seenLock.current;
    seenLock.current = cardLock;
    const now = controlsOf(storeKey);
    if (now.pending !== null) return;
    if (now.said === null) {
      // A no-JS post's `?notice=` is this page's line too, said for the card the page loaded with.
      const moved = cardAt !== loadedCard.current.at || cardPair !== loadedCard.current.pair;
      if (moved && !now.acted && !now.noticeGone && notice != null) dispatch({ type: 'stale' });
      return;
    }
    const mine = now.saidFor;
    if (mine === null) return;
    const newerRow = rowTime(cardAt) > rowTime(mine.updatedAt);
    const otherPair = pairMoved && cardPair !== null && cardPair !== mine.thisPair;
    const otherLock = lockMoved && cardLock !== null && mine.thisLock != null && cardLock !== mine.thisLock;
    if (newerRow || otherPair || otherLock) dispatch({ type: 'stale' });
  }, [cardAt, cardPair, cardLock, controls.said, controls.saidFor]);

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
   * One write to the mode route. M19.13: no Tonight press: the answer's `state` goes into the client
   * mode store (`applyModeRow`, gated on its `updatedAt`), which is the card, and the route's
   * `group_live` bump re-reads nothing once its `group_modes` row has arrived (`TonightLive`).
   * `optimistic` is shown on the card while the write is in flight. An answer that does not parse
   * is never guessed at: the page re-reads instead.
   */
  async function post(
    body: Record<string, unknown>,
    optimistic: ModeOptimistic | null = null,
  ): Promise<
    | {
        ok: true;
        spun: RuleOption | null;
        state: ModeRowState | null;
        notice: string | null;
        /** This game's region pair after a `this` write (`blue|red`), else null. */
        thisPair: string | null;
        /** This game's lock after a `this` write (`lockKey`), else null. */
        thisLock: string | null;
        /** This game's rule after a `this` write (region wars with its pair), else null. */
        thisRule: PendingRule | null;
      }
    | { ok: false; status: number; error: string | null }
  > {
    const token = optimistic === null ? null : beginOptimistic(storeKey, optimistic);
    const done = () => {
      if (token !== null) endOptimistic(storeKey, token);
    };
    try {
      const response = await fetch(MODE_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId, ...(lobbyId === null ? {} : { lobbyId }), ...body }),
      });
      if (!response.ok) {
        // A 409 carries M20.1's words for the refusal; nothing else is shown as is.
        const body: unknown = response.status === 409 ? await response.json().catch(() => null) : null;
        const said =
          typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
            ? body.error
            : null;
        // M22.6 (14.8): a card that named its lobby and is told to pick one wrote to a lobby that
        // has just ended: say so, and re-read the page for the lobbies that are left.
        const ended = lobbyId !== null && said === PICK_A_LOBBY_FIRST;
        if (ended) void requestTonightRefresh();
        done();
        return { ok: false, status: response.status, error: ended ? THAT_LOBBY_ENDED : said };
      }
      const parsed = setGroupModeResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        void requestTonightRefresh();
        done();
        return {
          ok: true,
          spun: null,
          state: null,
          notice: null,
          thisPair: null,
          thisLock: null,
          thisRule: null,
        };
      }
      const { state, notice, spun, thisGame } = parsed.data;
      // The answer first, then the tap goes: the card never flashes back to the old state.
      applyModeRow(storeKey, {
        row: { standing: state.standing, pending: state.pending, rated: state.rated },
        updatedAt: state.updatedAt,
      });
      // M20.18: a `this` write's lock is on the card at once; the re-read confirms it.
      const lock: ModeLock | null =
        thisGame === undefined
          ? null
          : { standing: thisGame.standing, mode: thisGame.mode as Mode, rated: thisGame.rated };
      if (thisGame !== undefined && lock !== null)
        applyLockAnswer(storeKey, { lobbyId: thisGame.lobbyId, lock });
      done();
      const thisPair = thisGame?.mode.id === 'region' ? `${thisGame.mode.blue}|${thisGame.mode.red}` : null;
      return {
        ok: true,
        spun: spun === undefined ? null : ruleOptionOf(spun),
        state,
        notice,
        thisPair,
        thisLock: lock === null ? null : lockKey(lock),
        thisRule: lock === null || ruleOf(lock.mode) === null ? null : (lock.mode as PendingRule),
      };
    } catch {
      done();
      return { ok: false, status: 0, error: null };
    }
  }

  /**
   * The card an answer's line is said for (M20.15): the answer's row, and this game's pair as the
   * answer left it (a `this` write) or as the card shows it. An answer with no row: the card now.
   */
  function markOf(result: {
    state: ModeRowState | null;
    thisPair: string | null;
    thisLock: string | null;
  }): CardMark | null {
    const shown = cardNow.current;
    if (result.state === null) return shown;
    return {
      updatedAt: result.state.updatedAt,
      thisPair: result.thisPair ?? shown?.thisPair ?? null,
      thisLock: result.thisLock ?? shown?.thisLock ?? null,
    };
  }

  /** Starts a write unless one is in flight (a double tap posts once). */
  function begin(write: ControlsWrite): boolean {
    if (controlsOf(storeKey).pending !== null) return false;
    dispatch({ type: 'start', write });
    return true;
  }

  async function setMode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const picked = choice;
    if (picked === current || !begin('mode')) return;
    const result = await post({ mode: picked, ...target }, { kind: 'choice', choice: picked, ...target });
    if (!result.ok) {
      // 409: the server's rule check (a page older than the pool, QA fix 2026-10-04); for this game
      // also the game has started or the teams came down (M20.18), in the route's words.
      dispatch({ type: 'refused', failed: refusal(result, RULE_TOO_FEW_OPEN, forThis) });
      return;
    }
    dispatch({ type: 'answered', said: result.notice, saidFor: markOf(result) });
    // The card is the answer already (M19.13): the button goes, focus stays on the select.
    selectRef.current?.focus();
  }

  async function spin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (controlsOf(storeKey).spinUntil !== null || !begin('spin')) return;
    const result = await post({ spin: true, ...target });
    if (!result.ok) {
      dispatch({ type: 'refused', failed: refusal(result, NOTHING_TO_SPIN, forThis) });
      return;
    }
    // With the answer on the card the reveal cycles now; without it, wait for the re-read too.
    const quiet = result.state !== null ? SPIN_CYCLE_MS : SPIN_WAIT_MS + SPIN_CYCLE_MS;
    dispatch({ type: 'answered', said: null, spinUntil: Date.now() + quiet });
    if (result.spun !== null) {
      const rule = ruleKey(result.spun);
      // This page's reveal is the route's own answer (`local`), naming the answer's pair; the
      // broadcast carries the rule only and is checked against each page's card. M20.18: a Spin
      // for this game names the lock's pair and sends no broadcast (other pages match a broadcast
      // against the next game's rule; they re-read on the route's bump instead).
      const pair = regionPairOf(forThis ? result.thisRule : (result.state?.pending ?? null));
      window.dispatchEvent(
        new CustomEvent(SPIN_REVEAL_EVENT, { detail: { rule, source: 'local', ...pair } }),
      );
      if (!forThis) window.dispatchEvent(new CustomEvent(SPIN_BROADCAST_EVENT, { detail: { rule } }));
    }
  }

  async function flipRated(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // The switch as it shows now (the card's value, a tap in flight included).
    const flipped = !rated;
    if (!begin('rated')) return;
    const result = await post({ rated: flipped, ...target }, { kind: 'rated', rated: flipped, ...target });
    if (!result.ok) {
      dispatch({ type: 'refused', failed: refusal(result, MODE_CHANGE_FAILED, forThis) });
      return;
    }
    dispatch({ type: 'answered', said: result.notice, saidFor: markOf(result) });
  }

  /**
   * M20.10: a region pair's Redraw or side change, on the next game (the row: the answer's `state`
   * is the card at once) or this game (the lock: the page re-reads it now; the route's `group_live`
   * bump re-reads every other page). The outcome line is the route's notice, a refusal its 409.
   */
  async function changeRegions(pair: RegionTarget, change: RegionChange): Promise<boolean> {
    const control = 'redraw' in change ? 'redraw' : change.side;
    if (!begin(`${control}-${pair.game}`)) return false;
    const result = await post({ ...change, game: pair.game });
    if (!result.ok) {
      dispatch({ type: 'refused', failed: result.error ?? MODE_CHANGE_FAILED });
      return false;
    }
    // M20.18: a `this` answer's lock is on the card already (`applyLockAnswer`); the route's
    // `group_live` bump re-reads the rest of the page.
    dispatch({ type: 'answered', said: result.notice, saidFor: markOf(result) });
    return true;
  }

  // `Setting…` stays up until the route confirms (M19.13: the card already shows the tap), then goes.
  const showSet = !hydrated || choice !== current || pending === 'mode';
  const spinBusy = pending === 'spin' || controls.spinUntil !== null;
  // 05-design 8.3.1 (M20.10 design round 1): in game the caption always heads the next-game
  // group; the foot's bold `nextLine` is gone (the `Next game` picker already says it). M20.18:
  // balanced, the picker is this game's, so neither the caption nor the `Next game` label shows.
  const afterRoll = inGame && !forThis;
  const chosenRule = ruleOptionOf(choice as ModeChoice);
  // M14.76: `Changes apply from the next game.` is said once, under the eyebrow, not under each control.
  // M20.18: a rule for this game is `This game only. Then back to Fearless.`, as the status says it.
  const sentence =
    chosenRule === null
      ? MODE_PICKER_SENTENCES[choice as GroupMode]
      : thisGame !== null
        ? oneGameLine(thisGame.standing)
        : ruleSentence(mode);
  const option = (rule: RuleOption) => {
    const key = ruleKey(rule);
    const small = tooFewNow.includes(key);
    return (
      <option key={key} value={key} disabled={small}>
        {optionLabel(rule)}
        {small ? TOO_FEW_OPEN : ''}
      </option>
    );
  };

  const regionPending = pending?.includes('-') ? (pending as RegionWrite) : null;
  const regionControls = (pair: RegionTarget | null | undefined) =>
    pair == null ? null : (
      <RegionControls
        target={pair}
        groupId={groupId}
        lobbyId={lobbyId}
        action={MODE_ACTION}
        redirectTo={redirectTo}
        // After Roll the foot can hold two pairs: each says which. In game (8.3.1) only this game's
        // pair is headed and the next game's sits under the `Next game` picker; balanced (M20.18)
        // this game's sits inside the `This game` fieldset, so only the next game's is headed.
        heading={
          forThis
            ? pair.game === 'next'
              ? MODE_PICKER_LABEL_NEXT
              : null
            : inGame && pair.game === 'this'
              ? THIS_GAME_HEADING
              : null
        }
        showShort={pair.game === 'next' && !statusShowsNext}
        pending={regionPending}
        hydrated={hydrated}
        onChange={changeRegions}
      />
    );
  /** No-JS posts name the game too (M20.18): balanced, every picker, Spin and Rated form is this game's. */
  const gameInput = (
    <>
      {forThis ? <input type="hidden" name="game" value="this" /> : null}
      {lobbyId === null ? null : <input type="hidden" name="lobbyId" value={lobbyId} />}
    </>
  );

  const picker = (
    <form
      method="post"
      action={MODE_ACTION}
      onSubmit={(event) => void setMode(event)}
      aria-label={MODE_SETTINGS_LABEL}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      {gameInput}
      <label htmlFor={selectId} className="text-xs font-bold">
        {afterRoll ? MODE_PICKER_LABEL_NEXT : MODE_PICKER_LABEL}
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
      {lobbyNote === null ? null : (
        <p data-slot="mode-lobby-note" className="text-xs text-muted-foreground">
          {lobbyNote}
        </p>
      )}
    </form>
  );

  const ratedSwitch = (
    <form
      method="post"
      action={MODE_ACTION}
      onSubmit={(event) => void flipRated(event)}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      {gameInput}
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
        {forThis ? (rated ? RATED_ON_THIS : RATED_OFF_THIS) : rated ? RATED_ON : RATED_OFF}
      </p>
    </form>
  );

  const reset =
    mode === 'fearless' && banned > 0 ? (
      <ResetFearless
        lobbyCount={lobbyCount}
        groupId={groupId}
        banned={banned}
        confirmHref={resetConfirmHref}
        onSaid={(line) => dispatch({ type: 'answered', said: line, saidFor: cardNow.current })}
        onClosed={() => statusRef.current?.focus()}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-raised/45 px-(--card-pad) py-4">
      <p className="font-mono text-2xs text-muted-foreground">{MODE_ADMIN_EYEBROW}</p>
      {forThis ? (
        <>
          {/* M20.18: balanced, everything that changes this game under one legend: the rule,
              Spin, this game's pair and Rated. The pool's Reset is not a game's, so it follows. */}
          <fieldset data-slot="mode-this-game" className="flex min-w-0 flex-col gap-3">
            <legend className="mb-3 text-xs font-bold">{THIS_GAME_HEADING}</legend>
            {picker}
            {regionControls(regions?.this)}
            {ratedSwitch}
          </fieldset>
          {reset}
          {/* Below the hairline, only what is still the next game's: a queued pair, headed. */}
          {regions?.next == null ? null : <NextGameGroup split>{regionControls(regions.next)}</NextGameGroup>}
        </>
      ) : (
        <>
          {/* This game's pair first: it is what the status above shows (M20.10). */}
          {regionControls(regions?.this)}
          <NextGameGroup split={regions?.this != null}>
            {afterRoll ? <p className="text-sm text-muted-foreground">{MODE_APPLIES_NEXT_GAME}</p> : null}
            {picker}
            {regionControls(regions?.next)}
          </NextGameGroup>
          {ratedSwitch}
          {reset}
        </>
      )}
      <form
        id={`${selectId}-spin`}
        method="post"
        action={MODE_ACTION}
        onSubmit={(event) => void spin(event)}
        hidden
      >
        <input type="hidden" name="groupId" value={groupId} />
        {/* M20.7: Spin is the one mode route with `spin=true`. */}
        <input type="hidden" name="spin" value="true" />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        {gameInput}
      </form>

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

/**
 * A refused write's line (M20.18): the route's own words on a 409 (the game has started, no teams
 * are rolled, too few open), else `fallback` for a 409 with none; anything else `Couldn't change that.`
 */
function refusal(result: { status: number; error: string | null }, fallback: string, words: boolean): string {
  if (result.status !== 409) return MODE_CHANGE_FAILED;
  // M22.6 (14.8): which lobby the write was for is always said, whatever the target.
  if (result.error === THAT_LOBBY_ENDED || result.error === PICK_A_LOBBY_FIRST) return result.error;
  return words ? (result.error ?? fallback) : fallback;
}

/**
 * 05-design 8.3.1: with this game's pair above it, the next game's controls open on a hairline, so
 * `Changes apply from the next game.` never sits under this game's `Redraw regions`.
 * While balanced (M20.18) it opens the queued next-game pair, under its `Next game` legend.
 */
function NextGameGroup({ split, children }: { split: boolean; children: ReactNode }) {
  if (!split) return <>{children}</>;
  return <div className="flex flex-col gap-3 border-t border-border pt-3">{children}</div>;
}

/** Region wars' pair for the local reveal's detail (`SpinReveal` reads `blue` / `red`). */
function regionPairOf(pending: PendingRule | null): { blue?: string; red?: string } {
  return pending?.id === 'region' ? { blue: pending.blue, red: pending.red } : {};
}

function ResetFearless({
  lobbyCount,
  groupId,
  banned,
  confirmHref,
  onSaid,
  onClosed,
}: {
  groupId: string;
  banned: number;
  lobbyCount: number;
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
          <AlertDialogDescription>
            {lobbyCount >= 2 ? resetBodyLobbies(banned, lobbyCount) : fearlessResetBody(banned)}
          </AlertDialogDescription>
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
