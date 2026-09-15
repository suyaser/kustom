import { SWITCH_SIDE_ENABLED } from '@/lib/commands/gate';
import { sideLine } from '@/lib/tonight/copy';

/**
 * One line under the two team cards, in `balanced` and **only** in `balanced` (M4.7 (b), the
 * words are M4.3's, the state is product's ruling of 2026-09-11).
 *
 * **It goes with the lobby.** Once the game has launched there is nothing to move in and
 * `Move to your side in the lobby.` names a room that no longer exists, so the line ends where
 * `in_game` begins — the same rule, in the same block, as M4.10's `Missed the invite?` line.
 * Whether that state is reached is the caller's (`TonightView`), because the same `teams` block
 * also draws an unrated finish.
 *
 * **And it goes when the sides are right** (M4.11). That condition is the caller's too, and for
 * the same reason: this component knows one sentence, and `anySeatOnTheWrongSide` is a fact
 * about ten seats. Whichever of the two sentences is on screen is the same sentence for as long
 * as the element exists — it is drawn, and later it is not drawn; it never changes under a
 * reader, which is why it is still not a live region.
 *
 * **One line under both cards, not one per card.** `05-design.md`'s "Teams" section places
 * everything else on this screen and is silent about this line, so it takes the section's own
 * shape: the sit-out strip above the cards and the explanation below them are each one
 * statement about the split as a whole, and so is this. Per card it would be the same sentence
 * twice, 200px apart on a phone, addressed to a reader who is on exactly one of them.
 *
 * **Above the explanation**, directly under the cards: it is an instruction about the seats you
 * have just read, and the explanation strip below is a different subject — why these teams —
 * with the reroll control attached to it.
 *
 * Archivo `t-sm` `dim`, the tonight page's hint dress: it is an aside beside two cards of names
 * and numbers, and the page has no banners. Not a live region — the sentence is the same
 * sentence from the moment the teams land until the game ends.
 *
 * **Which sentence is the gate's**, read from `lib/commands` and never re-derived: while
 * `switch_side` is `unverified` the server queues nothing, so the page must not promise that
 * anybody will be moved. When the probe verifies the path and the flag flips, this line changes
 * with it in the same commit and with no edit here.
 */
export interface SideLineProps {
  /**
   * The gate, **overridden only by tests** — the convention `isCommandKindEnabled` already
   * sets. Production reads `COMMAND_KIND_ENABLED.switch_side` through this default.
   */
  switchSideEnabled?: boolean;
}

export function SideLine({ switchSideEnabled = SWITCH_SIDE_ENABLED }: SideLineProps) {
  return <p className="cn-side-line">{sideLine(switchSideEnabled)}</p>;
}
