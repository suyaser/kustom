/**
 * Why somebody is sitting out (M14.41, scene-walk gap 4): one rule and one sentence, read by the
 * tonight page's sit-out card and by the Discord teams embed, so the two can never disagree.
 *
 * The walk caught them disagreeing: with ten tied on one game each and a newcomer on none, the
 * embed said `most games tonight` (its `tiedOnGames` flag only asked whether the **whole pool** was
 * level, and the newcomer was not), while the page said `Each game goes to whoever has played
 * least tonight`. Neither named the key that actually decided.
 *
 * **The rule is read at the boundary**, the way the rotation decided it (`compareForSitOut` in
 * `lib/ingest/selection.ts`: most games tonight first, then longest since a sit-out, then puuid):
 * the last person to sit against the first person who plays. Whatever separates those two is the
 * reason. This module never decides **who** sits; it only explains a decision already made.
 *
 * Pure: no I/O, no clock.
 */

/** The fields of a pool member the rotation orders by (`PoolMember` satisfies it). */
export interface SitOutStanding {
  puuid: string;
  /** Games finished since 06:00 tonight. */
  gamesTonight: number;
  /** Epoch ms of the last game they were around for and did not play, or `null`: never. */
  lastSitOutAt: number | null;
  /**
   * The player whose companion hosts the lobby (M14.43): `selectTen` never seats them out, so the
   * cut is read against the first player who **could** have sat. `PoolMember.isHost` satisfies it.
   */
  isHost?: boolean;
}

export type SitOutRule =
  /** The sitters played strictly more games tonight than anybody who plays. */
  | { kind: 'most-games' }
  /** Level on games (`games` each); the sitters have gone longest without sitting out. */
  | { kind: 'longest-since'; games: number; everyone: boolean }
  /** Level on games and on sit-out history (nobody has sat out): somebody had to be first. */
  | { kind: 'first'; games: number; everyone: boolean };

/** `compareForSitOut`'s order, restated so this module imports nothing from ingest. */
function sitsFirst(a: SitOutStanding, b: SitOutStanding): number {
  if (a.gamesTonight !== b.gamesTonight) return b.gamesTonight - a.gamesTonight;
  const lastA = a.lastSitOutAt ?? Number.NEGATIVE_INFINITY;
  const lastB = b.lastSitOutAt ?? Number.NEGATIVE_INFINITY;
  if (lastA !== lastB) return lastA - lastB;
  return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
}

/**
 * The rule that seated these sitters out, or `null` when nobody sits (or nobody plays, which
 * cannot happen past a roll), or when the rotation's order does not explain the cut.
 */
export function sitOutRule(
  playing: readonly SitOutStanding[],
  sitters: readonly SitOutStanding[],
): SitOutRule | null {
  if (sitters.length === 0 || playing.length === 0) return null;
  const lastToSit = [...sitters].sort(sitsFirst).at(-1);
  // The host always plays (M14.43, `selectTen`): the cut is against the first non-host player.
  const nextUp = playing.filter((member) => member.isHost !== true).sort(sitsFirst)[0];
  if (lastToSit === undefined || nextUp === undefined) return null;
  // The rotation's order does not explain this cut (somebody was kept in on another rule): claim
  // no reason rather than a false one.
  if (sitsFirst(lastToSit, nextUp) > 0) return null;

  if (lastToSit.gamesTonight > nextUp.gamesTonight) return { kind: 'most-games' };

  const games = lastToSit.gamesTonight;
  const everyone = [...playing, ...sitters].every((member) => member.gamesTonight === games);
  const historyDecided =
    (lastToSit.lastSitOutAt ?? Number.NEGATIVE_INFINITY) !==
    (nextUp.lastSitOutAt ?? Number.NEGATIVE_INFINITY);
  return historyDecided ? { kind: 'longest-since', games, everyone } : { kind: 'first', games, everyone };
}

/** Who the sentence is about: the names, already rendered and joined, and whether that is several people. */
export interface SitOutWho {
  /** `Ramzy`, `Ramzy and Omar`, or `You`. */
  who: string;
  /** Several people, or `You`: `have`, not `has`. */
  plural: boolean;
  /** The viewer is the one sitting (`who` is `You`): `You've`, not `They've`. */
  you?: boolean | undefined;
}

function gamesWord(games: number): string {
  return games === 1 ? '1 game' : `${games} games`;
}

/**
 * The one reason sentence (M14.41 [NEW COPY]; wording from design round 1, 05-design 5.15). It
 * follows the lead (`Chaos sits this one out.`), so the name is said once per card: the reason
 * opens with the pronoun (`They've`, several sitters too; `You've` for the sitter) and a tie is its
 * clause, so `they` can't be read as `everyone`. Counts say `game(s)`.
 *
 * - `They've played the most games tonight.` (only when the sitter played strictly more);
 * - `They've gone longest without sitting out, and everyone's played 1 game tonight.` (a tie broken
 *   by sit-outs; `…, tied on 1 game tonight.` when only the cut is level; `…, and it's the first
 *   game of the night.` at zero games);
 * - `First game of the night, so somebody has to be first.` (nothing to tell them apart on the
 *   first game; later in a night, `Tied on 1 game tonight, so somebody has to be first.`).
 */
export function sitOutReasonSentence(rule: SitOutRule, { you }: SitOutWho): string {
  const pronoun = you === true ? "You've" : "They've";
  switch (rule.kind) {
    case 'most-games':
      return `${pronoun} played the most games tonight.`;
    case 'longest-since': {
      const tie =
        rule.games === 0
          ? "and it's the first game of the night"
          : rule.everyone
            ? `and everyone's played ${gamesWord(rule.games)} tonight`
            : `tied on ${gamesWord(rule.games)} tonight`;
      return `${pronoun} gone longest without sitting out, ${tie}.`;
    }
    case 'first':
      return rule.games === 0
        ? 'First game of the night, so somebody has to be first.'
        : `Tied on ${gamesWord(rule.games)} tonight, so somebody has to be first.`;
  }
}

/** `Ramzy sits this one out.` / `Ramzy and Omar sit this one out.`: the line's lead, before the reason. */
export function sitOutLead({ who, plural }: SitOutWho): string {
  return `${who} ${plural ? 'sit' : 'sits'} this one out.`;
}

/** The lead after the name, for the page, which sets the name in 700: ` sits this one out.` */
export function sitOutVerb(plural: boolean): string {
  return plural ? ' sit this one out.' : ' sits this one out.';
}

/** After the game (the finished poster): ` sat this one out.`, with no reason ([NEW COPY]). */
export const SIT_OUT_PAST = ' sat this one out.';

/** The card for the person sitting (05-design 5.15: read first). The reason goes between. */
export const SIT_OUT_VIEWER_LEAD = 'You are sitting this one out.';
export const SIT_OUT_VIEWER_NEXT = 'You are first in line for the next one.';
export const SIT_OUT_VIEWER_PAST = 'You sat this one out.';

/**
 * The whole line, lead and reason: the embed's `Sitting out` field value (which starts at the
 * name) and, split into its two parts, the page's card. With no rule known, the lead alone.
 */
export function sitOutLine(rule: SitOutRule | null, who: SitOutWho): string {
  return rule === null ? sitOutLead(who) : `${sitOutLead(who)} ${sitOutReasonSentence(rule, who)}`;
}
