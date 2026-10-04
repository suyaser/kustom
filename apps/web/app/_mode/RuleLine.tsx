import { clientNamer, ruleCheckLine } from '@/lib/discord/modeLines';
import type { GameStampView } from '@/lib/mode/types';

/**
 * The poster's rule line (M15.5; brief D6, §4): `Tanks only: Blue kept the rule. Red: Jinx isn't a
 * tank.` Champions and sides only, never a player. `null` for a standing-mode game or one with no
 * check. Since design round 2 the finished Strip prints it as its own row inside the poster
 * (`ruleLine`); `Not rated, so no Rating change.` is the strip's sentence, never repeated here.
 *
 * **The same builder as Discord's result post** (`lib/discord/modeLines.ts`, M15.6), so the poster
 * and the post can never drift (`rules.test.tsx` checks they agree verdict for verdict).
 */
export function ruleLineOf(stamp: GameStampView | null): string | null {
  if (stamp === null || stamp.rule === null || stamp.check === null) return null;
  return stamp.names === undefined
    ? ruleCheckLine(stamp.rule, stamp.check)
    : ruleCheckLine(stamp.rule, stamp.check, clientNamer(stamp.names));
}
