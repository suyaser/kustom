import { type Role, SETTLING_GAMES, type Side } from '@customs/core';
import { AI_RECAP_LABEL } from '../ai/recapCopy';
import { gamesLabel, WEEK_BOARD_SENTENCE_SHORT } from '../board/copy';
import type { RatingTrack } from '../board/types';
import {
  FEARLESS_POST_FOOTER,
  FEARLESS_RESET_DESCRIPTION,
  FEARLESS_TITLE,
  fearlessLaneTitle,
  fearlessPostDescription,
} from '../fearless/copy';
import { availableFearless, groupFearless } from '../fearless/present';
import type { FearlessChampion } from '../fearless/types';
import { formatMinutes } from '../games/duration';
import { inLaneOrder } from '../laneOrder';
import {
  barPercents,
  explanationShown,
  HOW_SUMMARY,
  oddsSentence,
  type ReceiptSplit,
  reasonLine,
  receiptChips,
  resultOddsLine,
} from '../receipt/copy';
import { type SitOutRule, sitOutLine } from '../tonight/sitOut';
import { type DraftEmbed, type DraftField, type DraftLine, guardMessage, KEEP_LAST_STANDING } from './limits';
import { type ResultModeInput, resultModeLines, type TeamsModeInput, teamsModeLine } from './modeLines';

/**
 * The Discord posts, as pure functions (M3.1 teams, M3.3 result; posts 2.0 since M14.61).
 *
 * Nothing in this file reads the database, the clock or the environment: it takes plain data
 * (names, roles, display ratings, an explanation string, the group's name and links) and returns
 * the JSON body of a webhook POST. `webhook.ts` is the only I/O, `assemble.ts` and `post.ts` turn
 * rows into these inputs, and both of those are testable because this one is not.
 *
 * The layout, the colours and every string are `docs/05-design.md` section 10 ("Discord posts"),
 * and every sentence is quoted from the copy modules the pages print from (receipt, sit-out,
 * mode, fearless, board, stats). An engineer who wants different wording asks product for it.
 *
 * **A post is a stack of embeds** (05-design 10.3): teams and result are a header, a blue side,
 * a red side and a closing block; everything else is one embed. Only the header (E1) carries the
 * author line and the page link; the side embeds never carry a `url`, because Discord merges
 * embeds that share one into a gallery. Every post goes out as `Kustom`.
 */

/**
 * Bar colours, as the integers the API passes: Direction C's night values (05-design 10.2).
 * Amber `#FFCF66` for the parts that are neither side's, `#2E9BFF` blue and `#FF6B35` red for a
 * side's own embed and a win's header, and slate `#8B98AD` for blocks written by AI.
 */
export const ACCENT_COLOR = 16_764_774;
export const BLUE_COLOR = 3_054_591;
export const RED_COLOR = 16_739_125;
export const SLATE_COLOR = 9_148_589;

/** The webhook name on every post (05-design 10.2): a pasted `Captain Hook` still posts as Kustom. */
export const KUSTOM_USERNAME = 'Kustom';

/** The side embeds' titles (05-design 10.4) [NEW COPY]. The only place, with the bar, emoji appear. */
export const BLUE_SIDE_TITLE = '🟦 BLUE';
export const RED_SIDE_TITLE = '🟥 RED';

/**
 * A display name we have, or `null` for a player the database has never been told about.
 * `null` renders as `Someone` (M3.10) — at render time, here, and never stored anywhere.
 */
export type PlayerName = string | null;

/**
 * M3.10's fallback. One word, at the display boundary, on every surface.
 *
 * `lib/ingest/balance.ts` borrows the same constant for the name it hands core, because core
 * writes that name into `splits.explanation` and three surfaces quote that sentence verbatim
 * (M3.15). One word, spelled in one place, whether it is rendered or stored.
 */
export const NAMELESS_PLAYER = 'Someone';

/** `05-design.md`: truncate a display name at 32 characters with an ellipsis. */
const MAX_NAME_LENGTH = 32;

/** U+00A0. Joins a Rating to its change on a seat line, so a wrap never splits the two (10.4). */
export const NBSP = ' ';

/* ---------------------------------------------------------------------------
 * The side line (M4.3's copy, M4.7 (b)'s placement; `05-design.md`, "Teams embed", and the
 * tonight-page copy table's two rows of 2026-09-11).
 *
 * Product's two sentences, fixed in the M4.2 and M4.3 briefs and in the 2026-09-09 decision row
 * that gated the auto switch. They are quoted from the brief character for character — em dash
 * U+2014, ASCII apostrophe — and `embeds.test.ts` pins both by code point.
 *
 * **One definition, and this is it.** The tonight page prints the same two sentences under the
 * team cards, and `lib/tonight/copy.ts` re-exports these three so the page keeps importing its
 * copy from its own copy file.
 * ------------------------------------------------------------------------- */

/** The gate is **off**: no `switch_side` row is queued for anybody. */
export const SIDE_LINE_MANUAL = 'Move to your side in the lobby.';

/**
 * The gate is **on** (since 16.18, 2026-09-12), so this is the live sentence. It still ends with
 * `move yourself`, because a companion that is closed, offline, or looking at a full side moves
 * nobody (M4.3, "the bounce").
 */
export const SIDE_LINE_AUTO = "You'll be moved to your side — if not, move yourself.";

/** One of the two, by the gate. Never a third sentence, never both, never per-person. */
export function sideLine(switchSideEnabled: boolean): string {
  return switchSideEnabled ? SIDE_LINE_AUTO : SIDE_LINE_MANUAL;
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/** One embed as Discord takes it. Keys are only present when they say something. */
export interface Embed {
  color: number;
  author?: { name: string; url?: string };
  title?: string;
  url?: string;
  description?: string;
  fields?: EmbedField[];
  thumbnail?: { url: string };
  /** The large picture under the embed (M14.79: the Sunday post's week notes). Never counted toward 6,000. */
  image?: { url: string };
  footer?: { text: string };
}

/**
 * The body of a webhook POST: Kustom's name, the avatar when the site has a public address, and
 * a stack of embeds (or, for the test post alone, `content`). We never post mentions.
 */
export interface WebhookPayload {
  username: string;
  avatar_url?: string;
  content?: string;
  embeds: Embed[];
}

/**
 * Who a post is from and where its author line goes (05-design 10.2): the group's name, its
 * `/g/<slug>` page, and the avatar URL. Every URL is `undefined` when there is no honest one
 * (no slug, or a localhost origin); `groupName` is `null` when the group could not be read, and
 * the post then goes out with no author line rather than not at all.
 */
export interface PostIdentity {
  groupName: string | null;
  groupUrl?: string | undefined;
  avatarUrl?: string | undefined;
}

/**
 * The give-way order of 05-design 10.12, as `shed` ranks for {@link guardMessage}: lowest goes
 * first when a message is over 6,000 characters. A line with no rank is never shed.
 */
export const SHED = {
  /** Teams: core's sentence in E4, then E4's reason line, then the `Seats` moves, then `Sitting out`. */
  teamsSubtext: 1,
  teamsReason: 2,
  teamsMoves: 3,
  teamsSitOut: 4,
  /** Result: the AI recap (whole), then the award line, then the top damage. */
  recap: 1,
  award: 2,
  topDamage: 3,
  /** Weekly: the AI storyline (whole), then a tie's later names, then board rows from the bottom. */
  storyline: 1,
  tieNames: 2,
  boardRows: 3,
} as const;

/** The author line of a post's first embed, or nothing when the group's name is unknown. */
function authorOf(identity: PostIdentity, suffix?: string): DraftEmbed['author'] {
  if (identity.groupName === null) return undefined;
  const name = suffix === undefined ? identity.groupName : `${identity.groupName} · ${suffix}`;
  return identity.groupUrl === undefined ? { name } : { name, url: identity.groupUrl };
}

/**
 * The one exit from this file. Every builder returns through here, so the webhook identity is set
 * once and Discord's limits are applied once, on the whole message, in `limits.ts`. Below the
 * limits the guard is the identity.
 */
function message(identity: PostIdentity, embeds: readonly DraftEmbed[]): WebhookPayload {
  return {
    username: KUSTOM_USERNAME,
    ...(identity.avatarUrl === undefined ? {} : { avatar_url: identity.avatarUrl }),
    embeds: guardMessage(embeds),
  };
}

/** Drops the `author` key when there is none, so a payload never carries `author: undefined`. */
function withAuthor(embed: DraftEmbed, author: DraftEmbed['author']): DraftEmbed {
  return author === undefined ? embed : { ...embed, author };
}

/**
 * An AI-written block (05-design 10.2, 10.5, 10.6): its own slate embed, labelled `AI recap`.
 * The result post's recap is appended as E4 by the 15-minute edit (`aiEdit.ts`); the Sunday
 * storyline (M16.5) is E0 above the board. `text` arrives Discord-ready (escaped, like
 * `discordRecapText`). Shed whole, first, if a message is ever over the limit.
 */
export function aiRecapEmbed(text: string, shed: number = SHED.recap): DraftEmbed {
  return { color: SLATE_COLOR, title: AI_RECAP_LABEL, description: text, shed };
}

export interface TeamsPlayer {
  puuid: string;
  name: PlayerName;
  role: Role;
  /** `displayKustom(r)`, already rounded by core (M18.6). */
  rating: number;
  /** Not on a main role in this split (core's `isOffRole`). */
  offRole: boolean;
  /**
   * No main role on record (core's `resolveRoles(...).main === null`), M14.41: not counted as
   * on-main in the receipt chip (`Main roles 6/6 · 4 new`). Absent reads as `false`.
   */
  noMain?: boolean | undefined;
}

export type SeatLine =
  /** Somebody leaves the ten and somebody takes their slot. */
  | { kind: 'swap'; sitter: PlayerName; mover: PlayerName }
  /** A mover with nobody to swap with: ten around, one of them watching, nobody sitting. */
  | { kind: 'open-slot'; mover: PlayerName };

export interface TeamsEmbedInput {
  /** The group's name and links (05-design 10.2). */
  identity: PostIdentity;
  /** Five, lane order enforced here anyway. */
  blue: readonly TeamsPlayer[];
  red: readonly TeamsPlayer[];
  /** `splits.explanation`, verbatim. Never recomposed, never shortened. */
  explanation: string;
  /**
   * The stored split columns the receipt is built from (M14.10, STRATEGY §4.9): the split in
   * play, the one ranked directly below it, and how many the lobby stored. `null` when they could
   * not be read: E1 then has no labels, bar or verdict, and E4 is core's sentence alone.
   */
  receipt: TeamsReceipt | null;
  /**
   * Only when somebody sits. `rule` is why (`lib/tonight/sitOut.ts`, M14.41): the same rule and
   * sentence the tonight page's card prints; `null` claims no reason.
   */
  sitOut: { names: readonly PlayerName[]; rule: SitOutRule | null } | null;
  /** Only when somebody has to move, which is not the same question. */
  seats: readonly SeatLine[];
  /**
   * M4.3's gate (`lib/commands/gate.ts`, read at post time by `buildTeamsInput`). It decides
   * **which** of the two side sentences the `Seats` field ends with, never whether there is one.
   */
  switchSideEnabled: boolean;
  lobby: { name: string | null; password: string | null };
  /**
   * Which of the lobby's stored splits this post is, and how many the lobby has (M3.2). Absent
   * for a fresh balance, which keeps the plain title.
   */
  promoted?: PromotedSplit | undefined;
  /** E1's title link: the group's tonight page, `/g/<slug>`, or `undefined`. */
  url?: string | undefined;
  /** E4's title link: `/g/<slug>#how-the-bot-decided`, or `undefined`. */
  receiptUrl?: string | undefined;
  /**
   * The lobby's mode lock, taken at Roll (M15.6): the rule line at the top of E1's description,
   * and (M14.61) the standing mode for the author line.
   */
  mode?: TeamsModeInput | null | undefined;
  /** The group's mode panel, `/g/<slug>/mode`, which the rule line links. */
  modeUrl?: string | undefined;
}

/** The teams post's receipt: the posted split, the next one down, and the lobby's count. */
export interface TeamsReceipt {
  chosen: ReceiptSplit;
  /** `rank + 1` of the same lobby, or `null` when the posted split is the last one stored. */
  next: ReceiptSplit | null;
  splitCount: number;
}

/** `splits.rank` of the split being posted, and how many splits the lobby stored. */
export interface PromotedSplit {
  rank: number;
  splitCount: number;
}

export interface ResultPlayer {
  puuid: string;
  name: PlayerName;
  /** `null` when neither the scoreboard nor the split says where they played. */
  role: Role | null;
  /** `displayKustom(rAfter)`; `null` on a game played not rated (M15.6), whose line has no number. */
  rating: number | null;
  /** `round(rAfter) - round(rBefore)`, from `displayDelta`; `null` with `rating`. */
  delta: number | null;
}

/**
 * Who carried each side, as two names (M7.10). **Both or neither**: core hands back an MVP and
 * an ACE together or nothing.
 */
export interface ResultAward {
  /** The highest-scoring player on the **winning** side. */
  mvp: PlayerName;
  /** The highest-scoring player on the **losing** side. */
  ace: PlayerName;
}

export interface ResultEmbedInput {
  /** The group's name and links (05-design 10.2). */
  identity: PostIdentity;
  winningSide: Side;
  durationS: number;
  blue: readonly ResultPlayer[];
  red: readonly ResultPlayer[];
  /**
   * The MVP and the ACE, or `null` for a game that has none (M7.10). Required rather than
   * optional: a caller that forgot to ask would silently drop the line.
   */
  award: ResultAward | null;
  /** The chosen split's `blue_win_prob`, or `null` when this game had no stored split. */
  blueWinProb: number | null;
  /** The single highest `damage_to_champs`, or `null` when the block carried none. */
  topDamage: { name: PlayerName; damage: number } | null;
  /**
   * Which game this is, counted from the group's first, or `null` when it could not be counted
   * (M5.12): the author line then names the group alone.
   */
  gameNumber: number | null;
  /**
   * The game's mode (M15.6): the rule check line and `Not rated, so no Rating change.`, under the
   * odds line. Absent reads as a rated game with no rule.
   */
  mode?: ResultModeInput | undefined;
  /** E1's title link: the game's page, or `undefined`. */
  url?: string | undefined;
  /** The result badge (05-design 10.11 B2), only on a public origin. */
  badgeUrl?: string | undefined;
}

/** One line of a board post. Ordered before it gets here, never after. */
export interface LeaderboardEntry {
  puuid: string;
  name: PlayerName;
  /** **`Rating`, `round(r)`**, the all-time Kustom track's (M14.10, M18.6). */
  rating: number;
  /** The window's counted games. */
  games: number;
  /** A week line's numbers (M14.57), absent on `All time`. */
  week?: WeekEntry | undefined;
}

/** What a week board line prints after the name (M14.57): `+86 · 5W–2L`, then the settling chip. */
export interface WeekEntry {
  points: number;
  wins: number;
  losses: number;
  /** Rated games in the group while still settling, or `null` for a settled player. */
  settlingGames: number | null;
}

/**
 * A player still settling on an all-time board post (M14.10, STRATEGY §5): fewer than
 * `SETTLING_GAMES` rated games in the group, listed after the ranked lines and unnumbered.
 */
export interface SettlingEntry {
  puuid: string;
  name: PlayerName;
  rating: number;
  /** Rated games in the group (`ratings.games`), under `SETTLING_GAMES`. */
  ratedGames: number;
}

export interface LeaderboardEmbedInput {
  identity: PostIdentity;
  /** The window's own name — `This week` (M5.12). */
  windowLabel: string;
  /** Which fold the entries' `rating` came from (M7.3). */
  track: RatingTrack;
  /** Ranked, already ordered. {@link TOP_N} is the most printed. */
  entries: readonly LeaderboardEntry[];
  /** Still settling (all-time track only), by Rating, unnumbered. */
  settling?: readonly SettlingEntry[] | undefined;
  /** The board, or `undefined` when there is no honest URL to post. */
  url?: string | undefined;
}

/**
 * The all-time board post's footer (M14.10, STRATEGY §5's section line): why some players are
 * listed unnumbered. The count is core's `SETTLING_GAMES`, never a literal.
 */
export const SETTLING_FOOTER =
  `Their first ${SETTLING_GAMES} games count extra. They get a rank after ${SETTLING_GAMES} games.` as const;

/** The settling section's field name (STRATEGY §5's heading). */
export const SETTLING_FIELD = 'Still settling';

/** The footer under a board post: the settling line, or the week's (M7.3). */
export function boardFooter(track: RatingTrack): string {
  return track === 'week' ? WEEK_BOARD_SENTENCE_SHORT : SETTLING_FOOTER;
}

/** At most ten lines print. */
export const TOP_N = 10;

/** `Top ten` only when ten lines print (M3.22); any shorter board is `The board`. */
export const TOP_N_FIELD = 'Top ten';
export const BOARD_FIELD = 'The board';

/** `Top ten` for ten lines, `The board` for anything shorter. Never a count in the name. */
export function leaderboardFieldName(lines: number): string {
  return lines === TOP_N ? TOP_N_FIELD : BOARD_FIELD;
}

/** Ranks printed with the name in bold on a board post (05-design 10.6) [NEW STYLE]. */
export const BOLD_RANKS = 3;

/* ---------------------------------------------------------------------------
 * Teams (05-design 10.4)
 * ------------------------------------------------------------------------- */

/**
 * The teams post: E1 amber (the odds, `Sitting out`, `Seats`, `Lobby`), E2 `🟦 BLUE`, E3 `🟥 RED`
 * (five seat lines each, lane order), E4 amber `How the bot decided` (chips, the reason line,
 * core's sentence). The rotation and the lobby sit in E1 because a latecomer needs them before
 * the teams; the nerd lines close the stack, still verbatim.
 */
export function teamsEmbed(input: TeamsEmbedInput): WebhookPayload {
  const fields: DraftField[] = [];

  if (input.sitOut !== null && input.sitOut.names.length > 0) {
    fields.push({
      name: 'Sitting out',
      value: [{ text: sitOutValue(input.sitOut.names, input.sitOut.rule), shed: SHED.teamsSitOut }],
    });
  }
  // The `Seats` field is on every teams post, because the side line is. The moves keep the top
  // of the field and give way first; the side line, addressed to all ten, is the survivor (M4.12).
  fields.push({
    name: 'Seats',
    value: [
      ...input.seats.map((move): DraftLine => ({ text: seatLine(move), shed: SHED.teamsMoves })),
      { text: sideLine(input.switchSideEnabled), keep: KEEP_LAST_STANDING },
    ],
  });
  const lobby = lobbyFieldValue(input.lobby);
  if (lobby !== null) fields.push({ name: 'Lobby', value: [lobby] });

  const standing = input.mode?.standing;
  const header: DraftEmbed = withAuthor(
    {
      color: ACCENT_COLOR,
      title: teamsTitle(input.promoted),
      ...(input.url === undefined ? {} : { url: input.url }),
      ...optionalDescription(teamsHeaderLines(input)),
      fields,
    },
    authorOf(input.identity, standing === 'fearless' ? FEARLESS_TITLE : undefined),
  );

  return message(input.identity, [
    header,
    sideEmbed(BLUE_COLOR, BLUE_SIDE_TITLE, inLaneOrder(input.blue).map(teamsLine)),
    sideEmbed(RED_COLOR, RED_SIDE_TITLE, inLaneOrder(input.red).map(teamsLine)),
    {
      color: ACCENT_COLOR,
      title: HOW_SUMMARY,
      ...(input.receiptUrl === undefined ? {} : { url: input.receiptUrl }),
      description: receiptLines(input),
    },
  ]);
}

/** A side's embed: its colour, its title in words and emoji, five lines. Never a `url`. */
function sideEmbed(color: number, title: string, lines: readonly string[]): DraftEmbed {
  return { color, title, ...optionalDescription(lines) };
}

function optionalDescription(lines: readonly (string | DraftLine)[]): {
  description?: (string | DraftLine)[];
} {
  return lines.length === 0 ? {} : { description: [...lines] };
}

/**
 * E1's description (05-design 10.4): the mode line when there is one, then the receipt's two
 * labels, the ten-cell bar and the banded verdict. With no stored receipt it is the mode line or
 * nothing. Never shed.
 */
export function teamsHeaderLines(input: Pick<TeamsEmbedInput, 'receipt' | 'mode' | 'modeUrl'>): string[] {
  const modeLine =
    input.mode === undefined || input.mode === null ? null : teamsModeLine(input.mode, input.modeUrl);
  const lines = modeLine === null ? [] : [modeLine];
  if (input.receipt === null) return lines;
  const { chosen } = input.receipt;
  return [
    ...lines,
    oddsLabels(chosen.blueWinProb),
    oddsBar(chosen.blueWinProb),
    oddsSentence(chosen.blueWinProb, chosen.rank),
  ];
}

/**
 * E4's description: the receipt's lines 3 to 5 (05-design 5.5), verbatim: the chips, the reason
 * line when there is one, and core's sentence as subtext. Core's sentence goes first and the
 * reason second if the message is ever over the limit; the chips stay. With no stored receipt it
 * is core's sentence alone, as plain text.
 */
export function receiptLines(
  input: Pick<TeamsEmbedInput, 'receipt' | 'explanation' | 'blue' | 'red'>,
): (string | DraftLine)[] {
  const noMain = [...input.blue, ...input.red].filter((p) => p.noMain === true).length;
  const explanation = explanationShown(input.explanation, noMain);
  if (input.receipt === null) return [explanation];
  const { chosen, next, splitCount } = input.receipt;
  const names = new Map([...input.blue, ...input.red].map((player) => [player.puuid, player.name]));
  const reason = reasonLine(chosen, next, splitCount, (puuid) => renderName(names.get(puuid) ?? null));
  return [
    receiptChips(chosen, splitCount, noMain).join(' · '),
    ...(reason === null ? [] : [{ text: reason, shed: SHED.teamsReason }]),
    { text: explanationLine(explanation), shed: SHED.teamsSubtext },
  ];
}

/** Cells in the text bar: 10% each (05-design 10.4). */
export const BAR_CELLS = 10;

export const BLUE_CELL = '🟦';
export const RED_CELL = '🟥';

/**
 * Blue's cells of the ten: the printed blue percentage over ten, an exact half rounded **towards
 * 5** so neither side gains a cell from rounding, clamped to 1..9 so each side keeps one (the web
 * bar's clamp). Built on the label's integer percentage, so the bar can never disagree with the
 * number printed above it.
 */
export function blueCells(blueWinProb: number): number {
  const { blue } = barPercents(blueWinProb);
  const tenths = blue % 10;
  const floor = (blue - tenths) / 10;
  const cells = tenths > 5 ? floor + 1 : tenths < 5 ? floor : floor >= 5 ? floor : floor + 1;
  return Math.min(BAR_CELLS - 1, Math.max(1, cells));
}

/** `🟦🟦🟦🟦🟦🟥🟥🟥🟥🟥`: blue's cells from the left, red's after. */
export function oddsBar(blueWinProb: number): string {
  const blue = blueCells(blueWinProb);
  return BLUE_CELL.repeat(blue) + RED_CELL.repeat(BAR_CELLS - blue);
}

/** `**Blue 49%** · **51% Red**`: the receipt's two labels with the bar taken out. */
export function oddsLabels(blueWinProb: number): string {
  const { blue, red } = barPercents(blueWinProb);
  return `**Blue ${blue}%** · **${red}% Red**`;
}

/**
 * `Teams are set`, and `Teams are set · reroll 1 of 2` when an admin has promoted split 2 (M3.2).
 * The count comes from how many splits the lobby actually stored.
 */
export function teamsTitle(promoted: PromotedSplit | undefined): string {
  if (promoted === undefined || promoted.rank <= 1) return 'Teams are set';
  const rerolls = Math.max(promoted.splitCount - 1, promoted.rank - 1);
  return `Teams are set · reroll ${promoted.rank - 1} of ${rerolls}`;
}

/** `` `top` **Hana** · 1434 ``, plus ` · off main role` on the line of whoever is off it. */
function teamsLine(player: TeamsPlayer): string {
  return `\`${player.role}\` **${renderName(player.name)}** · ${player.rating}${player.offRole ? ' · off main role' : ''}`;
}

/* ---------------------------------------------------------------------------
 * Result (05-design 10.5)
 * ------------------------------------------------------------------------- */

/**
 * The result post: E1 in the winner's colour (who won and how long, then one line per fact: the
 * odds, the rule check, not rated, the top damage, the MVP and ACE), then E2 and E3 with each
 * player's new Rating and its change. No team total of deltas, ever (`00-product.md`).
 */
export function resultEmbed(input: ResultEmbedInput): WebhookPayload {
  const winner = input.winningSide === 100 ? 'Blue' : 'Red';
  const odds = input.blueWinProb === null ? null : resultOddsLine(input.blueWinProb, input.winningSide);
  const damage = topDamageLine(input.topDamage);
  const description: (string | DraftLine)[] = [
    ...(odds === null ? [] : [odds]),
    ...(input.mode === undefined ? [] : resultModeLines(input.mode)),
    ...(damage === null ? [] : [{ text: damage, shed: SHED.topDamage }]),
    ...(input.award === null ? [] : [{ text: awardLineBold(input.award), shed: SHED.award }]),
  ];

  const header: DraftEmbed = withAuthor(
    {
      color: input.winningSide === 100 ? BLUE_COLOR : RED_COLOR,
      title: `${winner} wins · ${formatMinutes(input.durationS)}`,
      ...(input.url === undefined ? {} : { url: input.url }),
      ...optionalDescription(description),
      // The badge narrows E1; a game with a rule carries the check line, so it goes without
      // (design review, M14.61): the rule line keeps the full width.
      ...(input.badgeUrl === undefined || input.mode?.rule != null
        ? {}
        : { thumbnail: { url: input.badgeUrl } }),
    },
    authorOf(input.identity, input.gameNumber === null ? undefined : `game ${input.gameNumber}`),
  );

  return message(input.identity, [
    header,
    sideEmbed(BLUE_COLOR, BLUE_SIDE_TITLE, inLaneOrder(input.blue).map(resultLine)),
    sideEmbed(RED_COLOR, RED_SIDE_TITLE, inLaneOrder(input.red).map(resultLine)),
  ]);
}

/**
 * The two words in front of the two names (M7.10, product's copy). Upper case because they are
 * op.gg's terms; never a trophy, a medal, a colour or a `#1` beside them.
 */
export const MVP_LABEL = 'MVP';
export const ACE_LABEL = 'ACE';

/**
 * `MVP Lena · ACE Rami` — product's words, verbatim and in that order (M7.10). The web poster
 * prints this plain line (`webAwardLine`); the Discord post prints {@link awardLineBold}.
 */
export function awardLine(award: ResultAward): string {
  return `${MVP_LABEL} ${renderName(award.mvp)} · ${ACE_LABEL} ${renderName(award.ace)}`;
}

/** `**MVP** Lena · **ACE** Rami` (05-design 10.5): the same words, only the two labels bold. */
export function awardLineBold(award: ResultAward): string {
  return `**${MVP_LABEL}** ${unbroken(award.mvp)} · **${ACE_LABEL}** ${unbroken(award.ace)}`;
}

/**
 * A name for E1's fact lines (top damage, MVP and ACE): rendered as everywhere, with its inner
 * spaces as U+00A0 so a narrow column (the badge beside it at 375) never splits `Syndrome Axes`
 * over two lines (design review, M14.61). Seat lines and the plain `awardLine` keep plain spaces.
 */
function unbroken(name: PlayerName): string {
  return renderName(name).replaceAll(' ', NBSP);
}

/**
 * `` `adc` **Bilal** · 1667 (-46) ``: the teams line's shape with the change in parentheses,
 * joined to the Rating by a no-break space so a wrap moves the whole number (10.4). A game played
 * not rated moved nobody: the name alone, never a made-up `+0`.
 */
function resultLine(player: ResultPlayer): string {
  const role = player.role === null ? '' : `\`${player.role}\` `;
  const name = `**${renderName(player.name)}**`;
  if (player.rating === null || player.delta === null) return `${role}${name}`;
  return `${role}${name} · ${player.rating}${NBSP}(${formatDelta(player.delta)})`;
}

/**
 * `+43`, `-46`, and `+0` / `-0` for a change too small to round to a point. Signed always; ASCII
 * `-`, not U+2212, because these lines get copy-pasted.
 */
export function formatDelta(delta: number): string {
  if (Object.is(delta, -0)) return '-0';
  return delta >= 0 ? `+${delta}` : String(delta);
}

/** `47.3k` over a thousand, the plain number below it. */
export function formatDamage(damage: number): string {
  return damage >= 1_000 ? `${(damage / 1_000).toFixed(1)}k` : String(Math.round(damage));
}

/**
 * The name as it is printed: the display name, truncated at 32 characters, or `Someone` for a
 * player the database has no name for yet (M3.10). Markdown characters are backslash-escaped
 * **last**, on the already-truncated string, so an escape is never sliced away.
 */
export function renderName(name: PlayerName): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return NAMELESS_PLAYER;
  const cut = trimmed.length > MAX_NAME_LENGTH ? `${trimmed.slice(0, MAX_NAME_LENGTH - 1)}…` : trimmed;
  return escapeMarkdown(cut);
}

/**
 * Backtick, `*`, `_`, `~`, `|`, the backslash, and (M14.61 r2) the link and heading syntax
 * `[ ] ( ) < > #`: a name or champion can never become a masked link, a `<@&role>` / `<#channel>`
 * mention, or a heading. There is no name we want italicised, linked or pinged.
 */
function escapeMarkdown(value: string): string {
  return value.replace(/([`*_~|\\[\]()<>#])/g, '\\$1');
}

function topDamageLine(top: { name: PlayerName; damage: number } | null): string | null {
  if (top === null) return null;
  return `Top damage: ${unbroken(top.name)}, ${formatDamage(top.damage)}.`;
}

/* ---------------------------------------------------------------------------
 * Boards (05-design 10.6, 10.7)
 * ------------------------------------------------------------------------- */

/**
 * The nightly board (M3.5, 05-design 10.7): one amber embed, author, the window in the title
 * (linked), the ranked field with the top three bold, the `Still settling` field on the all-time
 * track, and the footer sentence on every post.
 */
export function leaderboardEmbed(input: LeaderboardEmbedInput): WebhookPayload {
  return message(input.identity, [
    withAuthor(
      {
        color: ACCENT_COLOR,
        title: boardTitle(input.windowLabel),
        ...(input.url === undefined ? {} : { url: input.url }),
        fields: boardFields(input.entries, input.track, input.settling),
        footer: { text: boardFooter(input.track) },
      },
      authorOf(input.identity),
    ),
  ]);
}

/**
 * The word the board posts call the board (M14.72: one word, Board, everywhere a friend reads it;
 * the routes keep `/leaderboard`).
 */
export const BOARD_WORD = 'board';

/** `Last week · board`: the window the picker names, then {@link BOARD_WORD}. */
function boardTitle(windowLabel: string): string {
  return `${windowLabel} · ${BOARD_WORD}`;
}

/**
 * The board's fields: the ranked lines (M3.22's name rule), then `Still settling` when the
 * all-time track has anybody under `SETTLING_GAMES` (M14.10). A week never prints the second.
 */
function boardFields(
  ranked: readonly LeaderboardEntry[],
  track: RatingTrack,
  settling: readonly SettlingEntry[] | undefined,
): DraftField[] {
  const entries = ranked.slice(0, TOP_N);
  const unranked = track === 'week' ? [] : (settling ?? []).slice(0, TOP_N);
  const fields: DraftField[] = [];
  // A board of nobody but newcomers is a settling list alone, never an empty `The board`.
  if (entries.length > 0 || unranked.length === 0) {
    fields.push({
      name: leaderboardFieldName(entries.length),
      // Row 1 is never shed; the rest give way from the bottom (05-design 10.12).
      value: entries.map((entry, index) => {
        const text = leaderboardLine(entry, index);
        return index === 0 ? text : { text, shed: SHED.boardRows };
      }),
    });
  }
  if (unranked.length > 0) {
    fields.push({ name: SETTLING_FIELD, value: unranked.map(settlingLine) });
  }
  return fields;
}

/**
 * `` `1` **Lena** · 1548 · 41 games `` on `All time`; `` `1` **Nadia** · +212 · 5W–2L `` on a
 * week (M14.57), with `· settling · 4/10` after it for a player still settling. Ranks 1 to 3 have
 * the name in bold (05-design 10.6).
 */
function leaderboardLine(entry: LeaderboardEntry, index: number): string {
  const name = renderName(entry.name);
  const rank = `\`${index + 1}\` ${index < BOLD_RANKS ? `**${name}**` : name}`;
  if (entry.week === undefined) return `${rank} · ${entry.rating} · ${gamesLabel(entry.games)}`;
  return `${rank} · ${weekLineTail(entry.week)}`;
}

/**
 * `+212 · 5W–2L`, and `· settling · 4/10` for a player still settling (M14.57). Word joiners
 * (U+2060) hold the record together around the en dash, so `5W–` never ends a line (M18.7 review).
 */
export function weekLineTail(week: WeekEntry): string {
  const head = `${formatDelta(week.points)} · ${week.wins}W⁠–⁠${week.losses}L`;
  return week.settlingGames === null ? head : `${head} · settling · ${week.settlingGames}/${SETTLING_GAMES}`;
}

/** `Nadia · 1290 · settling · 4/10`: no rank, never bold, and the page's chip in words. */
function settlingLine(entry: SettlingEntry): string {
  return `${renderName(entry.name)} · ${entry.rating} · settling · ${entry.ratedGames}/${SETTLING_GAMES}`;
}

/**
 * One award of the closed window's post (M5.4, M5.10), quoted from the awards, never re-derived:
 * including the sentence an award nobody won prints. A tie carries its winners as one string
 * with a newline in it.
 */
export interface WindowAward {
  /** `Best off-role`: the award's own field name on the post (05-design 10.6). */
  label: string;
  /** The award's line(s), or the "nobody qualifies" sentence, verbatim. */
  line: string;
}

export interface WindowSummaryEmbedInput {
  identity: PostIdentity;
  /** `Last week` — the same words the picker uses. */
  windowLabel: string;
  /** `Sunday 6 Sep to Saturday 12 Sep · 14 rated games`, from `boardSlotLine`. */
  description: string;
  /** Which board the entries came from: `week` on the Sunday post (M14.57). */
  track: RatingTrack;
  /** The window's board, in its order. {@link TOP_N} is the most that will print. */
  entries: readonly LeaderboardEntry[];
  /** Still settling (all-time track only). */
  settling?: readonly SettlingEntry[] | undefined;
  /** M5.4's lines when they exist. Undefined or empty prints no award fields. */
  awards?: readonly WindowAward[] | undefined;
  /** `/leaderboard?window=last-week`, or `undefined`. */
  url?: string | undefined;
  /**
   * **M16.5's slot** (05-design 10.6, 10.14 check 8): the week's AI storyline, Discord-ready
   * (escaped like the recap), shown as E0, a slate `AI recap` embed above the board. Absent gives
   * exactly the board-only post.
   */
  storyline?: string | undefined;
  /**
   * **M14.79**: the "Week N notes" picture (`/og/g/<slug>/week/<weekStart>`) as E1's `image`, or
   * `undefined` off a public https origin (`weekNotesImageUrl`). The post is complete without it:
   * every line of E1 is the same with or without, and Discord gives an image no alt text, so E1's
   * text is the accessible version.
   */
  image?: string | undefined;
}

/**
 * The post a closed week makes of itself (M5.10, fired by M5.13; 05-design 10.6): (E0, the AI
 * storyline, only when given one) and E1, the board: author, title (linked), the window's days,
 * the ranked field with the top three bold, one block field per award (name = the award's label),
 * and the footer sentence.
 */
export function windowSummaryEmbed(input: WindowSummaryEmbedInput): WebhookPayload {
  const awards = input.awards ?? [];
  const board: DraftEmbed = withAuthor(
    {
      color: ACCENT_COLOR,
      title: boardTitle(input.windowLabel),
      ...(input.url === undefined ? {} : { url: input.url }),
      description: input.description,
      fields: [...boardFields(input.entries, input.track, input.settling), ...awards.map(awardField)],
      ...(input.image === undefined ? {} : { image: { url: input.image } }),
      footer: { text: boardFooter(input.track) },
    },
    authorOf(input.identity),
  );
  return message(input.identity, withStoryline(board, input.storyline));
}

/**
 * A storyline is at most 600 characters before escaping (M16.1 brief 4.4) and escaping at most
 * doubles it: anything longer is not a storyline this build wrote, and the post goes out without
 * it (M16.5's rule, kept).
 */
export const STORYLINE_MAX = 1_200;

/**
 * The Sunday stack: the storyline's slate E0 first when there is one (M16.5), then the board.
 * No line, a blank one or one over {@link STORYLINE_MAX} gives the board alone; past 6000 the
 * message guard drops E0 whole before any board line (05-design 10.12).
 */
export function withStoryline(board: DraftEmbed, storyline: string | null | undefined): DraftEmbed[] {
  const text = storyline?.trim() ?? '';
  return text.length === 0 || text.length > STORYLINE_MAX
    ? [board]
    : [aiRecapEmbed(text, SHED.storyline), board];
}

/**
 * An award as its own block field (05-design 10.6): the label is the field's name, the value its
 * line(s), verbatim. The winner's first line is never shed; a tie's later names give way.
 */
function awardField(award: WindowAward): DraftField {
  return {
    name: award.label,
    value: award.line
      .split('\n')
      .map((text, index) =>
        index === 0 ? { text, keep: KEEP_LAST_STANDING } : { text, shed: SHED.tieNames },
      ),
  };
}

/* ---------------------------------------------------------------------------
 * Fearless (05-design 10.8, 8.12)
 * ------------------------------------------------------------------------- */

/**
 * The fearless-draft list (M10, laid out by M14.31 per 05-design 8.12, restyled by 10.8): unique
 * champions since the last admin reset, banned from the next custom. A second message after the
 * result, never stuffed into it. One block field per lane named with its count (`top · 7`), the
 * lane's names on one line: this game's new ones first and bold, A–Z, then the rest A–Z.
 */
export interface FearlessEmbedInput {
  identity: PostIdentity;
  /** The whole pool after the game, as `loadFearless` answers it. */
  champions: readonly FearlessChampion[];
  /** Ids the game this post is about added to the pool: the bold ones, and `<n>` in the description. */
  added: ReadonlySet<number>;
  url?: string | undefined;
}

export function fearlessEmbed(input: FearlessEmbedInput): WebhookPayload {
  const added = input.champions.filter((champion) => input.added.has(champion.id)).length;
  return message(input.identity, [
    withAuthor(
      {
        color: ACCENT_COLOR,
        title: FEARLESS_TITLE,
        ...(input.url === undefined ? {} : { url: input.url }),
        description: fearlessPostDescription(
          added,
          input.champions.length,
          availableFearless(input.champions).length,
        ),
        fields: groupFearless(input.champions).map((group) => {
          const fresh = group.champions.filter((champion) => input.added.has(champion.id));
          const rest = group.champions.filter((champion) => !input.added.has(champion.id));
          return {
            name: fearlessLaneField(group.role, group.champions.length),
            value: [
              [
                ...fresh.map((champion) => `**${escapeMarkdown(champion.name)}**`),
                ...rest.map((champion) => escapeMarkdown(champion.name)),
              ].join(', '),
            ],
            inline: false,
          };
        }),
        ...fearlessFooter(input.url),
      },
      authorOf(input.identity),
    ),
  ]);
}

/** `top · 7`: the lane's title and how many it holds (05-design 10.8) [NEW COPY]. */
export function fearlessLaneField(role: Parameters<typeof fearlessLaneTitle>[0], count: number): string {
  return `${fearlessLaneTitle(role)} · ${count}`;
}

export interface FearlessResetEmbedInput {
  identity: PostIdentity;
  url?: string | undefined;
}

export function fearlessResetEmbed(input: FearlessResetEmbedInput): WebhookPayload {
  return message(input.identity, [
    withAuthor(
      {
        color: ACCENT_COLOR,
        title: FEARLESS_TITLE,
        ...(input.url === undefined ? {} : { url: input.url }),
        description: FEARLESS_RESET_DESCRIPTION,
      },
      authorOf(input.identity),
    ),
  ]);
}

/**
 * The pool post: the title opens the mode panel, so the footer says to tap it. With no link there
 * is no promise and no footer. The reset post has none either way (design review, M14.61): its one
 * sentence says the list is empty, and there is nothing open to go and look at that it does not say.
 */
function fearlessFooter(url: string | undefined): { footer?: { text: string } } {
  return url === undefined ? {} : { footer: { text: FEARLESS_POST_FOOTER } };
}

/* ---------------------------------------------------------------------------
 * Small shared pieces
 * ------------------------------------------------------------------------- */

/** `Sara and Deniz`, `Sara, Deniz and Ali` (M2.15). */
export function joinNames(names: readonly PlayerName[]): string {
  const rendered = names.map(renderName);
  if (rendered.length <= 1) return rendered[0] ?? '';
  return `${rendered.slice(0, -1).join(', ')} and ${rendered[rendered.length - 1]}`;
}

/**
 * One amber embed for a one-off notice (ratings reset): the identity, the author, a linked title
 * and a sentence. No footer, no timestamp (05-design 10.10).
 */
export function noticeEmbed(input: {
  identity: PostIdentity;
  title: string;
  description: string;
  url?: string | undefined;
}): WebhookPayload {
  return message(input.identity, [
    withAuthor(
      {
        color: ACCENT_COLOR,
        title: input.title,
        ...(input.url === undefined ? {} : { url: input.url }),
        description: input.description,
      },
      authorOf(input.identity),
    ),
  ]);
}

/** The `Sitting out` field's value (M14.41): the name first, then the page's reason sentence. */
function sitOutValue(names: readonly PlayerName[], rule: SitOutRule | null): string {
  return sitOutLine(rule, { who: joinNames(names), plural: names.length > 1 });
}

/** M2.15's two seat lines, verbatim. */
function seatLine(move: SeatLine): string {
  if (move.kind === 'open-slot') return `${renderName(move.mover)} is playing — take the open slot.`;
  return `Swap: ${renderName(move.sitter)} out, ${renderName(move.mover)} in.`;
}

/**
 * `` `customs-night` · password `4471` ``. The password half is dropped when the client did not
 * report one, and the whole field is absent when the name is unknown too. Never empty, never the
 * word "unknown" (M3.1 acceptance check 5).
 */
function lobbyFieldValue(lobby: { name: string | null; password: string | null }): string | null {
  const name = lobby.name?.trim() ?? '';
  const password = lobby.password?.trim() ?? '';
  if (name.length === 0 && password.length === 0) return null;
  if (name.length === 0) return `Password \`${password}\``;
  return password.length === 0 ? `\`${name}\`` : `\`${name}\` · password \`${password}\``;
}

/**
 * `Blue was favored 54%.` The 1.0 result clause. **No longer posted** (M14.10): kept, unchanged,
 * only because `lib/board/explain.test.ts` still pins it.
 */
export function favoredClause(blueWinProb: number | null): string | null {
  if (blueWinProb === null) return null;
  const percent = Math.round(blueWinProb * 100);
  if (percent > 50) return `Blue was favored ${percent}%.`;
  if (percent < 50) return `Red was favored ${100 - percent}%.`;
  return 'Neither side was favored.';
}

/**
 * `Red was 38%. Red won.` when the winner was the underdog (M11.3), `null` when it was not.
 * Rounded exactly as {@link favoredClause} rounds.
 */
export function underdogClause(blueWinProb: number | null, winningSide: Side): string | null {
  if (blueWinProb === null) return null;
  const blue = Math.round(blueWinProb * 100);
  const share = winningSide === 100 ? blue : 100 - blue;
  if (share >= 50) return null;
  const name = winningSide === 100 ? 'Blue' : 'Red';
  return `${name} was ${share}%. ${name} won.`;
}

/**
 * How core's sentence is set at the end of E4: Discord subtext (`-# `), which renders small and
 * grey. If a client is found not to render subtext inside an embed description, flip this to
 * `'italic'` and the line becomes `*…*`; nothing else changes.
 */
export const EXPLANATION_STYLE: 'subtext' | 'italic' = 'subtext';

/** Core's sentence, verbatim, as the receipt's last line (STRATEGY §4.2 rule 6). */
export function explanationLine(
  explanation: string,
  style: 'subtext' | 'italic' = EXPLANATION_STYLE,
): string {
  return style === 'subtext' ? `-# ${explanation}` : `*${explanation}*`;
}
