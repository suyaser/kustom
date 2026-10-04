'use client';

import { type RuleOption, ruleKey } from '@customs/core';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { spinAnnouncement } from '@/lib/mode/ruleCopy';
import { spinNotice } from '@/lib/mode/ruleNotices';
import {
  ANNOUNCE_EVENT,
  SPIN_CYCLE_MS,
  SPIN_HOLD_MS,
  SPIN_REVEAL_EVENT,
  SPIN_TICK_MS,
  SPIN_WAIT_MS,
  spinDetail,
} from '@/lib/mode/spinEvents';

/**
 * The Spin reveal, in the Mode card's status slot (M15.5; brief D3, design round 1): when a Spin
 * lands, the status line cycles through the rule names for at most 1.2 s in the status's own type
 * (level 1, text 700 23, no box) and lands on `Spin says: Tanks only.`, which the announcer says
 * once; then the status (`children`, server-rendered) comes back. With `prefers-reduced-motion` it
 * lands at once. No wheel, no route, no modal. Until a Spin it is just its children.
 *
 * **It plays only what the card confirms** (M15.5 review, design round 1). Whether the reveal came
 * from this admin's own Spin or from another page's Realtime broadcast (a claim anyone with the
 * anon key could send on the public channel), it plays only when its rule is the card's pending
 * rule (`pendingKey`, the server's read of `group_modes`), so the reveal and the card never
 * disagree. One that beats the page's refresh waits up to {@link SPIN_WAIT_MS} for the refreshed
 * card; anything else is dropped silently.
 */
export function SpinReveal({
  labels,
  pendingKey,
  children,
}: {
  labels: Readonly<Record<string, string>>;
  /** The card's pending rule key (`class:Tank`, `region`, `mirror`), or null with none. */
  pendingKey: string | null;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState<{ text: string; landed: boolean } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const held = useRef<{ rule: RuleOption; until: number } | null>(null);
  const pending = useRef(pendingKey);
  const play = useRef<(rule: RuleOption) => void>(() => {});
  const slot = useRef<HTMLSpanElement>(null);
  const cycling = !!shown && !shown.landed;

  // While cycling, the card root carries `data-spin-cycling`: its `data-spin-hide` parts (title,
  // chip, lines, action) go invisible so nothing names the result early (design round 2).
  useEffect(() => {
    const card = slot.current?.closest('[data-slot="mode-card"]') ?? null;
    if (card === null) return;
    if (cycling) card.setAttribute('data-spin-cycling', '');
    else card.removeAttribute('data-spin-cycling');
    return () => card.removeAttribute('data-spin-cycling');
  }, [cycling]);

  play.current = (rule: RuleOption) => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    const land = () => {
      setShown({ text: spinNotice(rule), landed: true });
      window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: { line: spinAnnouncement(rule) } }));
      timers.current.push(setTimeout(() => setShown(null), SPIN_HOLD_MS));
    };
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) {
      land();
      return;
    }
    const names = Object.values(labels);
    const ticks = Math.floor(SPIN_CYCLE_MS / SPIN_TICK_MS);
    for (let tick = 0; tick < ticks; tick += 1) {
      timers.current.push(
        setTimeout(
          () => setShown({ text: names[tick % names.length] ?? '', landed: false }),
          tick * SPIN_TICK_MS,
        ),
      );
    }
    timers.current.push(setTimeout(land, SPIN_CYCLE_MS));
  };

  // The refreshed card confirms (or not) a Spin that arrived before it.
  useEffect(() => {
    pending.current = pendingKey;
    const claim = held.current;
    if (claim === null) return;
    if (Date.now() > claim.until) {
      held.current = null;
      return;
    }
    if (pendingKey !== null && ruleKey(claim.rule) === pendingKey) {
      held.current = null;
      play.current(claim.rule);
    }
  }, [pendingKey]);

  useEffect(() => {
    const onSpin = (event: Event) => {
      const rule = spinDetail(event);
      if (rule === null) return;
      if (pending.current !== null && ruleKey(rule) === pending.current) {
        held.current = null;
        play.current(rule);
        return;
      }
      // Not (yet) the pending rule: wait for the page's refresh to confirm it, then forget it.
      held.current = { rule, until: Date.now() + SPIN_WAIT_MS };
    };
    window.addEventListener(SPIN_REVEAL_EVENT, onSpin);
    return () => {
      window.removeEventListener(SPIN_REVEAL_EVENT, onSpin);
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    };
  }, []);

  if (shown === null)
    return (
      <span ref={slot} className="contents">
        {children}
      </span>
    );
  return (
    <span
      ref={slot}
      data-slot="spin-reveal"
      data-landed={shown.landed ? '' : undefined}
      // The cycle is decoration; the landing is said by the announcer (one live region).
      aria-hidden={shown.landed ? undefined : true}
      className="text-lg font-bold"
    >
      {shown.text}
    </span>
  );
}
