import { CLASS_TAGS, type ClassTag, type RuleOption } from '@customs/core';

/**
 * The Spin reveal's in-page events (M15.5; brief D3). No zod: client islands read this.
 *
 * - The spinning admin's controls dispatch {@link SPIN_REVEAL_EVENT} (their own card reveals) and
 *   {@link SPIN_BROADCAST_EVENT}, which `TonightLive` sends on the page's Realtime channel as a
 *   broadcast; every other open Tonight page receives it and dispatches {@link SPIN_REVEAL_EVENT}.
 * - The reveal speaks its landing through {@link ANNOUNCE_EVENT}, so Tonight keeps one live region.
 *
 * The broadcast only says *which rule to reveal*: the card itself re-renders from the database
 * (`group_modes` is published), so a forged message can at most play a reveal, never change a card.
 */
export const SPIN_REVEAL_EVENT = 'kustom:spin-reveal';
export const SPIN_BROADCAST_EVENT = 'kustom:spin-broadcast';
export const ANNOUNCE_EVENT = 'kustom:announce';
/** The Realtime broadcast event name on `tonight:<groupId>`. */
export const SPIN_BROADCAST = 'spin';

/** The reveal's cycle, at most 1.5 s in all (D3), then the result stays a while. */
export const SPIN_CYCLE_MS = 1_200;
export const SPIN_TICK_MS = 100;
export const SPIN_HOLD_MS = 5_000;
/** How long a broadcast that beat the page's refresh waits for the card to confirm it. */
export const SPIN_WAIT_MS = 8_000;

/**
 * Where a reveal came from (`local`: this admin's Spin; `broadcast`: another page's), carried in the
 * event's detail for logs and tests. Since design round 1 both are gated the same way: the reveal
 * plays only when the card's pending rule confirms it (`SpinReveal`).
 */
export type SpinSource = 'local' | 'broadcast';

/** A rule key (`class:Tank`, `region`, `mirror`) as a rule, or null for anything else. */
export function ruleFromKey(key: unknown): RuleOption | null {
  if (key === 'region' || key === 'mirror') return { id: key };
  if (typeof key !== 'string' || !key.startsWith('class:')) return null;
  const tag = key.slice('class:'.length);
  return (CLASS_TAGS as readonly string[]).includes(tag) ? { id: 'class', tag: tag as ClassTag } : null;
}

/** The rule key a broadcast or event carries, if it names a rule. */
export function spinDetail(event: Event | { payload?: unknown }): RuleOption | null {
  const detail =
    'detail' in event ? (event as CustomEvent<unknown>).detail : (event as { payload?: unknown }).payload;
  const rule = typeof detail === 'object' && detail !== null && 'rule' in detail ? detail.rule : null;
  return ruleFromKey(rule);
}
