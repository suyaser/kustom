import type { RoleValue } from '@customs/db';
import {
  SETTLING_CHIP,
  SETTLING_SENTENCE,
  SETTLING_SENTENCE_PLAYER,
  WEEK_BOARD_SENTENCE,
} from '@/lib/board/copy';
import { NAMELESS_HINT } from '@/lib/tonight/copy';
import { RoleIcon } from '../_icons/RoleIcon';

/**
 * The pieces `/leaderboard` and `/p/[puuid]` share (M3.8, M3.10).
 *
 * They live in one file because both pages have to say them the same way: the chip is the same
 * chip, the sentence appears **once per page** on both, and the nameless hint is the tonight
 * page's own line, imported rather than retyped.
 */

/**
 * The still-settling marker: the word `settling`, mono `t-xs`, `dim`, a hairline border.
 *
 * No colour, no dot, no emoji, no asterisk — it reads as a label, not a warning
 * (`05-design.md`, "Still-settling marker"). It disappears at 30 games with no ceremony, which
 * is the caller's `settling` flag and nothing here.
 */
export function SettlingChip() {
  return <span className="cn-num cn-chip">{SETTLING_CHIP}</span>;
}

/**
 * The sentence, once per page: under the leaderboard heading, under the rating chart on the
 * player page. Never once per row — ten rows of it is the thing the one line replaces.
 *
 * **Two forms, one placement** (M3.26, product 2026-09-10). The board's is second person,
 * because everyone reading a board is on it; the player page's is the third-person twin, with
 * no name in it, because `your rating` there names the number printed above it and that number
 * belongs to whoever's page it is. The `person` prop picks the constant and nothing else
 * differs — same element, same class, same gate on `settling`.
 */
export function SettlingNote({ person = 'you' }: { person?: 'you' | 'player' }) {
  return <p className="cn-settling">{person === 'player' ? SETTLING_SENTENCE_PLAYER : SETTLING_SENTENCE}</p>;
}

/**
 * The week board's own sentence, in the same slot and the same type as {@link SettlingNote}
 * (M7.3) — under the card, once per page, on `This week` and `Last week`.
 *
 * It **replaces** the Proven sentence rather than joining it: a week sorts on `Rating`, so the
 * paragraph that explains Proven is explaining a column that is not on the screen. It is also
 * not gated on any row, because it is not about the rows the board is least sure of — on a week
 * the board is unsure of all of them, every week, which is the third of its four sentences.
 */
export function WeekBoardNote() {
  return <p className="cn-settling">{WEEK_BOARD_SENTENCE}</p>;
}

/** M3.10's quiet line, once per page, while any row on it reads `Someone`. */
export function NamelessHint() {
  return <p className="cn-hint">{NAMELESS_HINT}</p>;
}

/**
 * A role, icon and word, always both (`05-design.md`, "Iconography"). The icon is `aria-hidden`
 * and the word beside it is the accessible name; the mark is an anchor for the eye in a dense
 * list, never a replacement for language.
 *
 * 20px where the role is the subject of its row (`By role`), 14px where it sits beside a name
 * in a lineup — the same size the seat rack and the team cards use for exactly that position.
 *
 * Shared since M5.20: the record under the chart and the lineups under `Recent games` are two
 * files now, and a role printed two ways on one page is the drift this file exists to stop.
 */
export function RoleName({ role, size = 14 }: { role: RoleValue; size?: number }) {
  return (
    <span className="cn-num cn-lineup-role">
      <RoleIcon role={role} size={size} />
      {role}
    </span>
  );
}
