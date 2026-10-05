import { PLAYERS_PER_GAME } from '../lobbyRules';
import { renderWebName } from './copy';
import type { PlayerName } from './types';

/**
 * Kustom 2.0's tonight page strings (M14.9; redesign/STRATEGY.md §6(a), docs/05-design.md 5.10 to
 * 5.15). Strings STRATEGY or 05-design already carries are cited; the rest are listed in the task
 * report as [NEW COPY]. The 1.0 strings in `./copy` stay: the share card, the Discord posts and the
 * role card still read them. The receipt's own strings live in `lib/receipt/copy.ts`.
 */

/** `Tuesday 8 September, game 4 tonight` (the strip's first line, 5.10). */
export function stripDateLine(nightLabel: string, gameNumber: number | null): string {
  const short = shortNightLabel(nightLabel);
  return gameNumber === null ? short : `${short}, game ${gameNumber} tonight`;
}

/**
 * `Saturday 3 October` → `Sat 3 Oct`: the strip's date in 5.10's own form (`Sat 3 Oct, game 4
 * tonight`), M14.45. Short enough that the live tag and the date share one line at 375 whichever
 * label the tag shows, so the tag going from `Connecting…` to `Live` (or away) never re-wraps the
 * line and shifts the page (it was Tonight's whole CLS). The label is `formatNightLabel`'s, in the
 * fixed display locale, so its words are always weekday, day, month; anything else is kept as is.
 */
export function shortNightLabel(nightLabel: string): string {
  const match = /^(\p{L}{3})\p{L}* (\d{1,2}) (\p{L}{3})\p{L}*$/u.exec(nightLabel);
  return match === null ? nightLabel : `${match[1]} ${match[2]} ${match[3]}`;
}

/** `RED WINS`: the finished headline (5.10), the 1.0 poster's word. */
export function winsHeadline(side: 100 | 200): string {
  return side === 100 ? 'BLUE WINS' : 'RED WINS';
}

export const JUST_STARTED = 'Just started';

/** In game, the timer (STRATEGY §6(a), `23 min in`). Whole minutes, never mm:ss (5.4). */
export function elapsedLabel(startedAt: string | null, now: number): string | null {
  if (startedAt === null) return null;
  const ms = now - Date.parse(startedAt);
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.floor(ms / 60_000);
  return minutes < 1 ? JUST_STARTED : `${minutes} min in`;
}

/** The live tag (5.4): `Live` only while the page's own channel is subscribed. */
export const LIVE_TAG = 'Live';
export const CONNECTING_TAG = 'Connecting…';
export const RECONNECTING_TAG = 'Reconnecting…';

/** The answer band (5.10): YOU sticker, `on`, the side pill, `, playing support`. */
export const ANSWER_ON = 'on';
export function answerRole(role: string): string {
  return `, playing ${role}`;
}
/**
 * M21.13 (product's copy): balanced, sitting on the other side from the split: `YOU on RED. Move to
 * BLUE to play top.`; without a role, `YOU on RED. Move to BLUE.`. The band renders the two sides as
 * side pills between these pieces; `answerMoveLine` is the same sentence as plain text.
 */
export const ANSWER_MOVE_TO = '. Move to';
export function answerMoveRole(role: string | null): string {
  return role === null ? '.' : ` to play ${role}.`;
}
export function answerMoveLine(here: 'blue' | 'red', there: 'blue' | 'red', role: string | null): string {
  return `YOU ${ANSWER_ON} ${here.toUpperCase()}${ANSWER_MOVE_TO} ${there.toUpperCase()}${answerMoveRole(role)}`;
}
/** Finished: ` · won` / ` · lost` after the side pill. */
export function answerResult(won: boolean): string {
  return won ? ' · won' : ' · lost';
}
/**
 * Filling, the viewer is in the lobby: `YOU in the lobby · adc` (M14.45 [NEW COPY]; was
 * `, main role adc`, which wrapped loosely at 375). `main role` is still read to screen readers.
 */
export const ANSWER_IN_LOBBY = 'in the lobby';
export const ANSWER_MAIN_ROLE = 'main role';
export function answerMainRole(role: string | null): string {
  return role === null ? '' : ` · ${role}`;
}

/** The roster card (5.15 "Filling rack"). */
export const ROSTER_TITLE = 'In the lobby';
export function rosterCount(around: number): string {
  return around > PLAYERS_PER_GAME
    ? `${PLAYERS_PER_GAME}/${PLAYERS_PER_GAME} +${around - PLAYERS_PER_GAME}`
    : `${around}/${PLAYERS_PER_GAME}`;
}
export function openSeatsLine(open: number): string {
  return open === 1
    ? '1 open seat. It fills as people join the League lobby.'
    : `${open} open seats. They fill as people join the League lobby.`;
}
export const STILL_NEEDED = 'Still needed:';
export const NEW_TAG = 'New';
export const JOINED_JUST_NOW = 'joined just now';
export const YOU_TAG = 'You';
/** Visually hidden after the viewer's own name (5.1). */
export const YOU_SR = ' (you)';

/** More than ten, before the roll (STRATEGY §6(a)): who the rotation sits first, in order. */
export function wouldSitOutLine(names: readonly PlayerName[]): string | null {
  if (names.length === 0) return null;
  const rendered = names.map(renderWebName);
  const list =
    rendered.length === 1
      ? rendered[0]
      : `${rendered.slice(0, -1).join(', ')} and then ${rendered[rendered.length - 1]}`;
  return `If the teams rolled now, ${list} would sit out.`;
}

/** The settling chip (STRATEGY §5): `settling · 4/10`. */
export function settlingChip(ratedGames: number, settlingGames: number): string {
  return `settling · ${ratedGames}/${settlingGames}`;
}

/** The strip's name rows' list labels (05-design 5.10, M14.41). */
export const NAME_ROW_BLUE = 'Blue side';
export const NAME_ROW_RED = 'Red side';

/** Team card header words (5.1). */
export const YOUR_SIDE_TAG = 'Your side';
export const WON_TAG = 'Won';
export function teamHeading(side: 'blue' | 'red'): { visible: string; sr: string } {
  return side === 'blue' ? { visible: 'BLUE', sr: 'Blue team' } : { visible: 'RED', sr: 'Red team' };
}

/** The night tape (5.15 "Tape tile"). */
export const TAPE_TITLE = "Tonight's tape";
export function tapePlayed(count: number): string {
  return `${count} played`;
}
/**
 * M14.41 [NEW COPY]: `1 earlier` while a lobby is on the page (the walk read `1 played` with game 2
 * on the poster). Idle keeps `<n> played`: there is no current game for "earlier" to be before.
 */
export function tapeEarlier(count: number): string {
  return `${count} earlier`;
}
export function tapeGame(index: number): string {
  return `Game ${index}`;
}
export const TAPE_NO_RESULT = 'No result';
/** Long nights (STRATEGY §6(a)): the tape shows the newest three, the rest behind this. */
export function showEarlierGames(count: number): string {
  return count === 1 ? 'Show 1 earlier game' : `Show ${count} earlier games`;
}
export const MVP_TAG = 'MVP';
export const ACE_TAG = 'ACE';

/** Idle: the group's last game as a compact poster. */
export const LAST_GAME_TITLE = 'Last game';
export const SEE_THE_GAME = 'See the game';
/** The finished poster's link to its game page (M14.41 [NEW COPY], scene-walk gap 5). */
export const FULL_SCOREBOARD = 'Full scoreboard';

/**
 * Idle and the rail: this week's top five. M14.41 [NEW COPY] `Top this week` (was `Top of the
 * board`): the rows are the week's W–L and change, not a Rating (scene-walk gap 1).
 */
export const TOP_TITLE = 'Top this week';
export const TOP_WINDOW = 'This week';
export const FULL_BOARD = 'Full board';
export const TOP_EMPTY = 'No games this week yet.';

/** The empty group (STRATEGY §6(a)). */
/** The empty group's sub-line under `NOBODY IN YET` (said once; designer round 1). */
export const EMPTY_GROUP_MEMBER = 'When someone opens a custom with Kustom running, it shows up here.';
export const EMPTY_GROUP_ADMIN_TITLE = 'Get your group ready';
export const EMPTY_GROUP_ADMIN_BODY =
  'Invite your friends and pair a host. The first lobby anyone opens with Kustom running shows up here.';
export const FINISH_SETUP = 'Finish setup';

/** The page's one polite announcement per change (05-design.md 6.4). */
export const ANNOUNCE_GAME_STARTED = 'Game started.';
/** `You're on Red, mid.` (6.4), `You're on Red.` with no role; '' for a viewer not playing. */
export function announceYou(you: { side: 'Blue' | 'Red'; role: string | null } | null): string {
  if (you === null) return '';
  return you.role === null ? `You're on ${you.side}.` : `You're on ${you.side}, ${you.role}.`;
}
export function announceTeams(
  oddsSentence: string,
  you: { side: 'Blue' | 'Red'; role: string | null } | null,
): string {
  return `Teams are set. ${oddsSentence} ${announceYou(you)}`.replace(/ +/g, ' ').trim();
}
/** `Game started. You're on Red, mid.`: the side the game started on, which may not be the split's. */
export function announceGameStarted(you: { side: 'Blue' | 'Red'; role: string | null } | null): string {
  return you === null ? ANNOUNCE_GAME_STARTED : `${ANNOUNCE_GAME_STARTED} ${announceYou(you)}`;
}
export function announceWinner(side: 100 | 200): string {
  return side === 100 ? 'Blue wins.' : 'Red wins.';
}

/* ---------------------------------------------------------------------------
 * Your night (M14.36, product's brief; all [NEW COPY]).
 * ------------------------------------------------------------------------- */

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * `Your night: 3 wins, 1 loss, Rating +38.`; ARAM only: `Your night: 2 wins, 0 losses. ARAM, so no
 * Rating change.` The delta is the web's signed format (`formatWebDelta`), passed in.
 */
export function yourNightLine(wins: number, losses: number, delta: string | null, notRated = false): string {
  const record = `${count(wins, 'win', 'wins')}, ${count(losses, 'loss', 'losses')}`;
  // M15.5 (brief §4): no rated game, and at least one played not rated.
  if (delta === null && notRated) return `Your night: ${record}. Not rated, so no Rating change.`;
  return delta === null
    ? `Your night: ${record}. ARAM, so no Rating change.`
    : `Your night: ${record}, Rating ${delta}.`;
}

/** `Best game: Kai'Sa, 12/2/8.` */
export function yourNightBest(champion: string, kills: number, deaths: number, assists: number): string {
  const parts = yourNightBestParts(champion, kills, deaths, assists);
  return `${parts.lead}${parts.kda}${parts.end}`;
}

/** The same sentence in parts, so the page sets the KDA in the mono numeric face. */
export function yourNightBestParts(
  champion: string,
  kills: number,
  deaths: number,
  assists: number,
): { lead: string; kda: string; end: string } {
  return { lead: `Best game: ${champion}, `, kda: `${kills}/${deaths}/${assists}`, end: '.' };
}

function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

/** `MVP twice.` / `ACE once.`, together on one line when both happened; `null` when neither. */
export function yourNightAwards(mvp: number, ace: number): string | null {
  const parts = [mvp > 0 ? `MVP ${times(mvp)}.` : null, ace > 0 ? `ACE ${times(ace)}.` : null].filter(
    Boolean,
  );
  return parts.length === 0 ? null : parts.join(' ');
}

export const YOUR_NIGHT_TITLE = 'Your night';
