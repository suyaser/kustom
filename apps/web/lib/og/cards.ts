import type { RoleValue, SideValue } from '@customs/db';
import {
  RATING_LABEL,
  settlingChipParts,
  WINDOW_LABELS,
  type WinLossPart,
  winLossParts,
} from '../board/copy';
import { formatMinutes } from '../games/duration';
import { isRemake, REMAKE } from '../games/remake';
import { joinButtonLabel, joinPitch } from '../groups/pageCopy';
import { HERO_TITLE, PAGE_DESCRIPTION } from '../landing/copy';
import { resultOdds, UPSET_SENTENCE } from '../receipt/copy';
import { HEAD_SEPARATOR, renderWebName, TAPE_WINS, tapeRatedNote } from '../tonight/copy';
import { tonightHeader, tonightState } from '../tonight/state';
import type { PlayerName, ResultView, TonightSnapshot } from '../tonight/types';

/**
 * The share cards' text (M11.4; 05-design.md 5.16 since M14.25): every string a
 * card paints, and nothing else. The image routes load data, call one of these and hand the
 * answer to `ImageResponse`; the tests read these, not pixels.
 *
 * Every string is one a page already prints. No champion, no icon URL, no emoji, no domain.
 *
 * **Every group card names its group** (M14.42, scene-walk gap 11): `group` is the group's name as
 * somebody typed it, painted beside the wordmark the way the shell's group line prints it, so a
 * card pasted into another chat still says whose night it was.
 */

/** `BLUE` / `WINS`: the verdict on two lines, the way the card sets it. */
export function winnerWords(side: SideValue): readonly [string, string] {
  return [side === 100 ? 'BLUE' : 'RED', TAPE_WINS];
}

/** The strip at render time: every state but a rated result. */
export interface TonightStripModel {
  kind: 'strip';
  /** The group's name (M14.42). */
  group: string;
  /** `Tuesday 22 September`: the night, in the page's own sentence case, so a card a night old says which night it was. */
  slug: string;
  /** The strip's headline, count included (`9 IN THE LOBBY`). */
  headline: string;
  /** The strip's sentence, `''` where the strip has none. */
  sentence: string;
}

/**
 * A rated result (M14.42, scene-walk gap 11): read without the poster under it, so the card
 * carries what the poster leads with: who won, the odds line the receipt prints
 * (`Red was 46%. Red won.`, `resultOddsLine`) and the ten names, laid out as the game card.
 */
export interface TonightResultModel extends TeamsBody {
  kind: 'result';
  group: string;
  slug: string;
  /**
   * The games row's odds line (05-design 5.5, 5.16 ruling (f)): `Red was 51%.`, `Red was 46%.
   * Upset!`, `50–50.`; never `Red won.` again, because the verdict already says it. `null` for a
   * game played without a stored split, and the card then shows {@link duration} instead.
   */
  odds: string | null;
  /** `34 min`: shown when there are no odds, like the game card. */
  duration: string;
}

export type TonightCardModel = TonightStripModel | TonightResultModel;

/** The three-column body the game card and a finished Tonight card share. */
export interface TeamsBody {
  /** `null` on a remake (05-design.md 15): no side is drawn as the winner. */
  winner: 'blue' | 'red' | null;
  /** `BLUE` / `WINS` on two lines, or `REMAKE` on one (the duration under it finishes the verdict). */
  verdict: readonly string[];
  /** Five names a side in lane order, through `renderWebName`. No roles, ratings or champions. */
  blue: readonly string[];
  red: readonly string[];
}

function teamsBody(result: Pick<ResultView, 'winningSide' | 'blue' | 'red'>): TeamsBody {
  return {
    winner: result.winningSide === 100 ? 'blue' : 'red',
    verdict: winnerWords(result.winningSide),
    blue: result.blue.map((seat) => renderWebName(seat.name)),
    red: result.red.map((seat) => renderWebName(seat.name)),
  };
}

/**
 * The strip at render time. The one change from the page: a rated result is the result card
 * (who won, the odds, the names) rather than `GAME OVER`, because the card is read without the
 * poster under it.
 */
export function tonightCardModel(snapshot: TonightSnapshot, group: string): TonightCardModel {
  const state = tonightState(snapshot);
  const header = tonightHeader(state);
  const slug = snapshot.nightLabel;
  if (state.kind === 'result' && state.result.rated) {
    const { result } = state;
    return {
      kind: 'result',
      group,
      slug,
      ...teamsBody(result),
      odds: result.blueWinProb === null ? null : oddsOnly(result.blueWinProb, result.winningSide),
      duration: formatMinutes(result.durationS),
    };
  }
  return {
    kind: 'strip',
    group,
    slug,
    headline: header.count === null ? header.headline : `${header.count} ${header.headline}`,
    sentence: header.sentence,
  };
}

/** The finished odds line minus `<Winner> won.`, with `Upset!` kept (5.16 ruling (f)). */
function oddsOnly(blueWinProb: number, winningSide: SideValue): string {
  const { odds, upset } = resultOdds(blueWinProb, winningSide);
  return upset ? `${odds} ${UPSET_SENTENCE}` : odds;
}

export interface GameCardModel extends TeamsBody {
  /** The group's name (M14.42). */
  group: string;
  slug: string;
  /** `34 min` (M14.16: never a clock time). */
  duration: string;
  /** `ARAM · not rated`, `not rated`, or `null` on a rated game: the tape's own note. */
  note: string | null;
}

export function gameCardModel(
  game: {
    nightLabel: string;
    aram: boolean;
    result: Pick<ResultView, 'winningSide' | 'durationS' | 'rated' | 'blue' | 'red'>;
  },
  group: string,
): GameCardModel {
  const { result } = game;
  // A remake names no winner (05-design.md 15): `REMAKE` over its minutes, no side, no note.
  if (isRemake(result.durationS)) {
    return {
      group,
      slug: game.nightLabel,
      ...teamsBody(result),
      winner: null,
      verdict: [REMAKE.toUpperCase()],
      duration: formatMinutes(result.durationS),
      note: null,
    };
  }
  return {
    group,
    slug: game.nightLabel,
    ...teamsBody(result),
    duration: formatMinutes(result.durationS),
    note: tapeRatedNote({ aram: game.aram, rated: result.rated }),
  };
}

export interface PlayerCardModel {
  /** The group's name (M14.42). */
  group: string;
  /** `All time`: the card is always the all-time board's numbers, whatever `?window=` said. */
  slug: string;
  name: string;
  /**
   * Rating, then the record: the digits the group's `All time` board row prints (M14.15). The
   * record comes as parts (5.16 ruling (a)): numbers in mono, `W` / `L` in the text face.
   */
  stats: readonly PlayerCardStat[];
  /** `mid · support`, `mid`, or `null` when no main role is known. */
  roles: string | null;
  /**
   * The board's settling chip, `settling · 1/10` (05-design 5.6), under core's `SETTLING_GAMES`
   * rated games in this group; `null` once settled (M14.42). In parts (5.16 ruling (e)): the words
   * in the text face, the count in mono. The board shows the same chip on the same row, so a
   * first-night `1341` never reads as earned.
   */
  settling: readonly WinLossPart[] | null;
}

export type PlayerCardStat =
  | { label: string; value: string }
  | { label: string; parts: readonly WinLossPart[] };

/** The share card's second number. [NEW COPY] */
export const RECORD_LABEL = 'Record';

export function playerCardModel(
  player: {
    name: PlayerName;
    rating: number;
    wins: number;
    losses: number;
    ratedGames: number;
    settling: boolean;
  },
  roles: { main: RoleValue | null; backup: RoleValue | null },
  group: string,
): PlayerCardModel {
  return {
    group,
    slug: WINDOW_LABELS['all-time'],
    name: renderWebName(player.name),
    stats: [
      { label: RATING_LABEL, value: String(player.rating) },
      { label: RECORD_LABEL, parts: winLossParts(player.wins, player.losses) },
    ],
    roles: roleLine(roles),
    settling: player.settling ? settlingChipParts(player.ratedGames) : null,
  };
}

function roleLine({ main, backup }: { main: RoleValue | null; backup: RoleValue | null }): string | null {
  if (main === null) return null;
  return backup === null || backup === main ? main : `${main} ${HEAD_SEPARATOR} ${backup}`;
}

/**
 * The plain card for links that are not one night, game or player (M14.42, scene-walk gap 9): `/`,
 * `/about`, a dead invite (which must name no group), and a live invite (which names its group).
 * A headline in the display cut and one sentence, both a page's own words.
 */
export interface PitchCardModel {
  headline: string;
  sentence: string;
}

/** `/`, `/about` and a dead invite: the landing hero's title and the page's description. */
export function kustomCardModel(): PitchCardModel {
  return { headline: HERO_TITLE, sentence: PAGE_DESCRIPTION };
}

/** A live `/join/<code>`: the join page's own button and pitch, for this group. */
export function joinCardModel(group: string): PitchCardModel {
  return { headline: joinButtonLabel(group), sentence: joinPitch(group) };
}
