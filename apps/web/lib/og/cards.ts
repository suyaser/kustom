import type { RoleValue, SideValue } from '@customs/db';
import { PROVEN_LABEL, RATING_LABEL, WINDOW_LABELS } from '../board/copy';
import { formatDuration } from '../discord/embeds';
import { HEAD_SEPARATOR, renderWebName, TAPE_WINS, tapeRatedNote } from '../tonight/copy';
import { tonightHeader, tonightState } from '../tonight/state';
import type { PlayerName, ResultView, TonightSnapshot } from '../tonight/types';

/**
 * The share cards' text (M11.4, 05-design.md "Share cards — Open Graph images"): every string a
 * card paints, and nothing else. The image routes load data, call one of these and hand the
 * answer to `ImageResponse`; the tests read these, not pixels.
 *
 * Every string is one a page already prints. No champion, no icon URL, no emoji, no domain.
 */

/** `BLUE` / `WINS`: the verdict on two lines, the way the card sets it. */
export function winnerWords(side: SideValue): readonly [string, string] {
  return [side === 100 ? 'BLUE' : 'RED', TAPE_WINS];
}

export interface TonightCardModel {
  /** `TUESDAY 22 SEPTEMBER`: the strip's slug, so a card a night old says which night it was. */
  slug: string;
  /** The strip's headline, count included (`9 IN THE LOBBY`), or the winner on a rated result. */
  headline: string;
  /** The strip's sentence, `''` where the strip has none. */
  sentence: string;
}

/**
 * The strip at render time. The one change from the page: a rated result says who won rather
 * than `GAME OVER`, because the card is read without the poster under it.
 */
export function tonightCardModel(snapshot: TonightSnapshot): TonightCardModel {
  const state = tonightState(snapshot);
  const header = tonightHeader(state);
  const slug = snapshot.nightLabel.toUpperCase();
  if (state.kind === 'result' && state.result.rated) {
    return { slug, headline: winnerWords(state.result.winningSide).join(' '), sentence: header.sentence };
  }
  return {
    slug,
    headline: header.count === null ? header.headline : `${header.count} ${header.headline}`,
    sentence: header.sentence,
  };
}

export interface GameCardModel {
  slug: string;
  winner: 'blue' | 'red';
  verdict: readonly [string, string];
  /** `34:12`. */
  duration: string;
  /** `ARAM · not rated`, `not rated`, or `null` on a rated game: the tape's own note. */
  note: string | null;
  /** Five names a side in lane order, through `renderWebName`. No roles, ratings or champions. */
  blue: readonly string[];
  red: readonly string[];
}

export function gameCardModel(game: {
  nightLabel: string;
  aram: boolean;
  result: Pick<ResultView, 'winningSide' | 'durationS' | 'rated' | 'blue' | 'red'>;
}): GameCardModel {
  const { result } = game;
  return {
    slug: game.nightLabel.toUpperCase(),
    winner: result.winningSide === 100 ? 'blue' : 'red',
    verdict: winnerWords(result.winningSide),
    duration: formatDuration(result.durationS),
    note: tapeRatedNote({ aram: game.aram, rated: result.rated }),
    blue: result.blue.map((seat) => renderWebName(seat.name)),
    red: result.red.map((seat) => renderWebName(seat.name)),
  };
}

export interface PlayerCardModel {
  /** `ALL TIME`: the card is always the all-time board's numbers, whatever `?window=` said. */
  slug: string;
  name: string;
  /** Proven, then Rating: the digits the `All time` board prints for this player, unformatted. */
  stats: readonly { label: string; value: string }[];
  /** `mid · support`, `mid`, or `null` when no main role is known. */
  roles: string | null;
}

export function playerCardModel(
  player: { name: PlayerName; proven: number; rating: number },
  roles: { main: RoleValue | null; backup: RoleValue | null },
): PlayerCardModel {
  return {
    slug: WINDOW_LABELS['all-time'].toUpperCase(),
    name: renderWebName(player.name),
    stats: [
      { label: PROVEN_LABEL, value: String(player.proven) },
      { label: RATING_LABEL, value: String(player.rating) },
    ],
    roles: roleLine(roles),
  };
}

function roleLine({ main, backup }: { main: RoleValue | null; backup: RoleValue | null }): string | null {
  if (main === null) return null;
  return backup === null || backup === main ? main : `${main} ${HEAD_SEPARATOR} ${backup}`;
}
