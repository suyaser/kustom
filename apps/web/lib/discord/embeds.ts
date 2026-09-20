import type { Role, Side } from '@customs/core';
import {
  gamesLabel,
  LEADERBOARD_LABEL,
  SETTLING_SENTENCE_SHORT,
  WEEK_BOARD_SENTENCE_SHORT,
} from '../board/copy';
import type { RatingTrack } from '../board/types';
import {
  FEARLESS_RESET_DESCRIPTION,
  FEARLESS_TITLE,
  fearlessDescription,
  fearlessLaneTitle,
} from '../fearless/copy';
import { groupFearless } from '../fearless/present';
import type { FearlessChampion } from '../fearless/types';
import { inLaneOrder } from '../laneOrder';
import { type FieldLine, fieldValue, guardEmbed, KEEP_LAST_STANDING } from './limits';

/**
 * The Discord embeds, as pure functions (M3.1 teams, M3.3 result).
 *
 * Nothing in this file reads the database, the clock or the environment: it takes plain data
 * — names, roles, display ratings, an explanation string, a timestamp — and returns the JSON
 * body of a webhook POST. `webhook.ts` is the only I/O, `assemble.ts` is the only place that
 * turns rows into these inputs, and both of those are testable because this one is not.
 *
 * The layout, the field names, the colours and every string are `docs/05-design.md`
 * ("Discord embeds") and the sit-out copy is M2.15's, verbatim. Neither is a suggestion: an
 * engineer who wants different wording asks product for it.
 */

/** Bar colours, as the integers the API passes (`05-design.md`, dark palette). */
export const ACCENT_COLOR = 14_721_854;
export const BLUE_COLOR = 7_054_839;
export const RED_COLOR = 15_363_945;

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
 * copy from its own copy file. That file already imports {@link NAMELESS_PLAYER} from here,
 * which is the same direction and the same reason: a string two surfaces print lives in the
 * module with no Next and no DOM in front of it (`04-decisions.md`, 2026-09-11).
 * ------------------------------------------------------------------------- */

/**
 * The gate is **off** — no `switch_side` row is queued for anybody, so the only thing that can
 * put a player on their side is the player. Not what production prints since 16.18 (2026-09-12),
 * when the row went green; it is what it prints again if a patch breaks the path.
 */
export const SIDE_LINE_MANUAL = 'Move to your side in the lobby.';

/**
 * The gate is **on**, which it has been since 16.18 (2026-09-12), so this is the live sentence.
 * It still ends with `move yourself`, because a companion that is closed,
 * offline, or looking at a side that already holds five moves nobody (M4.3, "the bounce") — and
 * the embed is posted at the moment of balancing, before any companion has polled, so it can
 * only ever say what is about to happen.
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

export interface Embed {
  color: number;
  title: string;
  url?: string;
  description?: string;
  fields: EmbedField[];
  footer: { text: string };
  timestamp: string;
}

/** The body of a webhook POST. One embed; we never post content or mentions. */
export interface WebhookPayload {
  embeds: Embed[];
}

/**
 * The one exit from this file (M4.12).
 *
 * Every builder returns through here, so Discord's limits are applied once, in `limits.ts`,
 * on the assembled embed — where the 6000-character total can be seen at all. Below the limits
 * it is the identity, which is why no snapshot in this directory moved when it landed.
 */
function payload(embed: Embed): WebhookPayload {
  return { embeds: [guardEmbed(embed)] };
}

export interface TeamsPlayer {
  puuid: string;
  name: PlayerName;
  role: Role;
  /** `displayRating(mu)`, already rounded by core. */
  rating: number;
  /** Not on a main role in this split (core's `isOffRole`). */
  offRole: boolean;
}

/**
 * Why the sitters are sitting. M2.15's two clauses, plus M3.12's third one for the first
 * balance of a night.
 *
 * `first-sit-out` is the case where everyone around is tied on games tonight *and* nobody
 * around has a sit-out on record: the comparator has fallen through to PUUID order, so
 * `longest-since` would be stating a fact about a history that does not exist and sending the
 * reader looking for a night they sat out that never happened (product, 2026-09-09).
 */
export type SitOutReason = 'most-games' | 'longest-since' | 'first-sit-out';

export type SeatLine =
  /** Somebody leaves the ten and somebody takes their slot. */
  | { kind: 'swap'; sitter: PlayerName; mover: PlayerName }
  /** A mover with nobody to swap with: ten around, one of them watching, nobody sitting. */
  | { kind: 'open-slot'; mover: PlayerName };

export interface TeamsEmbedInput {
  /** Five, lane order enforced here anyway. */
  blue: readonly TeamsPlayer[];
  red: readonly TeamsPlayer[];
  /** `splits.explanation`, verbatim. Never recomposed, never shortened. */
  explanation: string;
  /** Only when somebody sits. */
  sitOut: { names: readonly PlayerName[]; reason: SitOutReason } | null;
  /** Only when somebody has to move, which is not the same question. */
  seats: readonly SeatLine[];
  /**
   * M4.3's gate (`lib/commands/gate.ts`, read at post time by `buildTeamsInput`). It decides
   * **which** of the two side sentences the `Seats` field ends with, never whether there is
   * one. Required rather than optional: a caller that forgot it would quietly promise a switch
   * nobody queued.
   */
  switchSideEnabled: boolean;
  lobby: { name: string | null; password: string | null };
  /**
   * Which of the lobby's stored splits this post is, and how many the lobby has (M3.2).
   *
   * Absent for a fresh balance, which is always rank 1 and keeps the plain title. A reroll
   * passes the promoted split's rank so the title says how far down the list the group has
   * gone; nothing else about the embed changes.
   */
  promoted?: PromotedSplit | undefined;
  /** The tonight page, or `undefined` when there is no honest URL to post. */
  url?: string | undefined;
  /** ISO 8601. Injected, so this function has no clock. */
  timestamp: string;
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
  /** `displayRating(muAfter)`. */
  rating: number;
  /** `displayRating(muAfter) - displayRating(muBefore)`, from `displayDelta`. */
  delta: number;
}

/**
 * Who carried each side, as two names (M7.10).
 *
 * **Both or neither.** Core hands back an MVP and an ACE together or hands back nothing, and
 * this type says the same thing: there is no half-line naming a winner's best player and
 * nobody on the other side. A name is a {@link PlayerName}, so a player the database has never
 * been told about is `Someone` here exactly as they are in the columns above.
 */
export interface ResultAward {
  /** The highest-scoring player on the **winning** side. */
  mvp: PlayerName;
  /** The highest-scoring player on the **losing** side. */
  ace: PlayerName;
}

export interface ResultEmbedInput {
  winningSide: Side;
  durationS: number;
  blue: readonly ResultPlayer[];
  red: readonly ResultPlayer[];
  /**
   * The MVP and the ACE, or `null` for a game that has none (M7.10).
   *
   * Required rather than optional, like {@link TeamsEmbedInput.switchSideEnabled}: the answer is
   * `gameAward`'s and a caller that forgot to ask would silently print the post the group had
   * before the bonus existed, which is the one failure nobody would notice.
   */
  award: ResultAward | null;
  /** The chosen split's `blue_win_prob`, or `null` when this game had no stored split. */
  blueWinProb: number | null;
  /** The single highest `damage_to_champs`, or `null` when the block carried none. */
  topDamage: { name: PlayerName; damage: number } | null;
  /**
   * Which game this is, counted from the group's first, or `null` when it could not be
   * counted. **Not a season's game number** (M5.12, product 2026-09-10): there is one running
   * history and the count reads it, so game 47 is the forty-seventh custom this group played.
   */
  gameNumber: number | null;
  url?: string | undefined;
  timestamp: string;
}

/** One line of the nightly board. Ordered before it gets here, never after. */
export interface LeaderboardEntry {
  puuid: string;
  name: PlayerName;
  /**
   * **The number the board sorted on, which is the only one this line prints**: Proven
   * (`round(ordinal * 60)`) on `All time` and the month windows, and the weekly `Rating`
   * (`round(mu * 60)` off the week's own fold) on `This week` and `Last week` (M7.3).
   *
   * One field and not two, for the reason the web row has one big number: where only one
   * number fits it is the one the order is made of, because a list ordered by a number it does
   * not show is exactly the complaint this rule exists to prevent.
   */
  score: number;
  games: number;
}

export interface LeaderboardEmbedInput {
  /**
   * The window's own name — `This week` (M5.12), never a season's name. The title reads
   * `This week · leaderboard`, in the same five words the picker and the board heading use.
   */
  windowLabel: string;
  /**
   * Which fold the entries' `score` came from (M7.3). It picks the footer and nothing else:
   * a week post explains the week's restart, every other post explains Proven.
   */
  track: RatingTrack;
  /** Already ordered, descending, by the number they carry. {@link TOP_N} is the most printed. */
  entries: readonly LeaderboardEntry[];
  /** The board, or `undefined` when there is no honest URL to post. */
  url?: string | undefined;
  timestamp: string;
}

/**
 * The footer under a board post: Proven's sentence, or the week's (M7.3).
 *
 * Neither string is edited into the other and neither interpolates a game count — the week does
 * not claim to settle, and `All time` and the month windows say exactly what they said before.
 */
export function boardFooter(track: RatingTrack): string {
  return track === 'weekly' ? WEEK_BOARD_SENTENCE_SHORT : SETTLING_SENTENCE_SHORT;
}

/** `05-design.md`, "Nightly leaderboard embed": at most ten lines print. */
export const TOP_N = 10;

/**
 * The field's name **follows the count** (M3.22, product 2026-09-09).
 *
 * With eight players seeded, the shipped post read `Top ten` over eight lines — a field that
 * names a number the list does not have, in a channel where the whole group can count the
 * lines. `Top ten` is the name only when ten of them print; any shorter board is `The board`,
 * which is true at any length and is the destination's own noun in a sentence
 * (`Ratings are updated. The leaderboard has the rest.`).
 */
export const TOP_N_FIELD = 'Top ten';
export const BOARD_FIELD = 'The board';

/** `Top ten` for ten lines, `The board` for anything shorter. Never a count in the name. */
export function leaderboardFieldName(lines: number): string {
  return lines === TOP_N ? TOP_N_FIELD : BOARD_FIELD;
}

/**
 * The teams embed: two columns with role and display rating, the explanation verbatim, the
 * sit-out copy when somebody sits, the side line, and the lobby name and password so a
 * straggler can get in.
 */
export function teamsEmbed(input: TeamsEmbedInput): WebhookPayload {
  const blue = inLaneOrder(input.blue);
  const red = inLaneOrder(input.red);

  // The rotation goes first (`05-design.md`, revised 2026-09-09): "Swap: Omar out, Nadia in."
  // is the one line in the message that has to happen before anybody can play, and behind ten
  // rating lines plus a wrapped explanation it was landing below the fold on a phone. Discord
  // groups only *consecutive* inline fields, so a block field in front of Blue and Red does not
  // break their pairing. `Sitting out` is still only there when somebody sits; `Seats` is now
  // always there, because M4.3's side line lives in it.
  const fields: EmbedField[] = [];

  if (input.sitOut !== null && input.sitOut.names.length > 0) {
    fields.push({
      name: 'Sitting out',
      value: fieldValue([sitOutLine(input.sitOut.names, input.sitOut.reason)]),
    });
  }
  // The `Seats` field is on every teams embed, because the side line is (`05-design.md`,
  // "Teams embed", designer 2026-09-11: "the side line is the last line of `Seats`… it always
  // prints"). The moves keep the top of the field — a `Swap:` line names two people who must
  // act, and it is still the line that has to happen before anybody can play — and the side
  // line closes the block, because it is addressed to all ten. Order is specific, then general;
  // there is no `Sides` field, which would be a heading over one sentence about seats.
  //
  // **The side line outranks the move lines** (M4.12). Eleven around with escapable Riot IDs is
  // ten `Swap:` lines of up to 144 characters each, which is over the 1024-character field limit
  // and a 400 on the whole post. So the move lines are droppable and the side line is not: the
  // field loses its lowest `Swap:` lines to a single `…`, and the sentence addressed to all ten
  // is the last line standing.
  fields.push({
    name: 'Seats',
    value: fieldValue([
      ...input.seats.map(seatLine),
      { text: sideLine(input.switchSideEnabled), keep: KEEP_LAST_STANDING },
    ]),
  });

  fields.push(
    { name: `Blue · ${sumRatings(blue)}`, value: fieldValue(blue.map(teamsLine)), inline: true },
    { name: `Red · ${sumRatings(red)}`, value: fieldValue(red.map(teamsLine)), inline: true },
  );

  const lobby = lobbyFieldValue(input.lobby);
  if (lobby !== null) fields.push({ name: 'Lobby', value: fieldValue([lobby]) });

  return payload({
    color: ACCENT_COLOR,
    title: teamsTitle(input.promoted),
    ...(input.url === undefined ? {} : { url: input.url }),
    description: input.explanation,
    fields,
    // With no url the title is not a link, so the footer must not promise one
    // (`05-design.md`): telling a friend to tap something that is not there is worse than
    // saying nothing.
    footer: { text: teamsFooter(input.url) },
    timestamp: input.timestamp,
  });
}

/**
 * The result embed: who won, how long it took, the top damage, and what it did to each
 * player's rating.
 *
 * The two columns keep their side's position — blue first, always — so "my column" is in the
 * same place it was in the teams embed. There is no team total of deltas and there never will
 * be one: the two sides do not sum to zero, and printing that invites an argument about a
 * thing that is working correctly (`00-product.md`, "The numbers on the screen").
 */
export function resultEmbed(input: ResultEmbedInput): WebhookPayload {
  const winner = input.winningSide === 100 ? 'Blue' : 'Red';
  const description = [favoredClause(input.blueWinProb), topDamageClause(input.topDamage)]
    .filter((clause) => clause !== null)
    .join(' ');

  return payload({
    color: input.winningSide === 100 ? BLUE_COLOR : RED_COLOR,
    title: `${winner} wins · ${formatDuration(input.durationS)}`,
    ...(input.url === undefined ? {} : { url: input.url }),
    ...(description.length > 0 ? { description } : {}),
    fields: [
      { name: 'Blue', value: fieldValue(inLaneOrder(input.blue).map(resultLine)), inline: true },
      { name: 'Red', value: fieldValue(inLaneOrder(input.red).map(resultLine)), inline: true },
      // One line, under the two columns, and **only when there is one** (M7.10). A game the
      // score cannot be computed for — a column stored before migration `0014`, a role the
      // client never reported — adds no field at all, and the post is byte-identical to the
      // one this group has been reading since M3.3.
      ...(input.award === null
        ? []
        : [{ name: AWARD_FIELD_NAME, value: fieldValue([awardLine(input.award)]) }]),
    ],
    footer: { text: resultFooter(input.gameNumber) },
    timestamp: input.timestamp,
  });
}

/**
 * The two words in front of the two names (M7.10, product's copy).
 *
 * Upper case because they are op.gg's terms and the group reads them there every day; not
 * `Mvp`, not `mvp`, and never a trophy, a medal, a colour or a `#1` beside them. Pinned by code
 * point in `embeds.test.ts`.
 */
export const MVP_LABEL = 'MVP';
export const ACE_LABEL = 'ACE';

/**
 * `MVP Lena · ACE Rami` — product's line, verbatim and in that order (M7.10).
 *
 * Two names, a middle dot, and nothing else: no score, no percentage, no emoji, nothing for the
 * other eight and no "nearly MVP" anywhere. The MVP comes first because the winning side does.
 * Names go through {@link renderName}, so a long Riot ID is truncated at 32 characters and
 * escaped exactly as it is in the two columns above it.
 */
export function awardLine(award: ResultAward): string {
  return `${MVP_LABEL} ${renderName(award.mvp)} · ${ACE_LABEL} ${renderName(award.ace)}`;
}

/**
 * The award field's name: a zero-width space, which is Discord's way of writing a field with no
 * heading (M7.10).
 *
 * Product asked for **one line under the existing block** and wrote no heading for it, and this
 * agent does not write product's copy. A field is the only place in an embed that is *under*
 * the two inline columns — the description is above them and the footer belongs to
 * `Kustom · game 47` — and Discord rejects a field whose name is the empty string. So the name
 * is a character that takes no room and says nothing, and the line reads as a line.
 *
 * It is also, deliberately, the **last** field: `guardEmbed` gives ground from the last field
 * backwards when an embed is over 6000 characters, so the lowest-priority line of the post is
 * the first to go and the ten rating rows are never cut to make room for it (M4.12).
 */
export const AWARD_FIELD_NAME = '​';

/**
 * The nightly board (M3.5, `05-design.md`, "Nightly leaderboard embed").
 *
 * **One field, block, no columns.** A ranked list is a single column by nature and inline
 * fields would break it across a row.
 *
 * The number after the name is **the one the board is ordered by**, because where only one
 * number fits it has to be the one the order is made of — a list ordered by a number it does
 * not show is exactly the complaint this rule exists to prevent (M3.5 brief). That is Proven
 * (`round(ordinal * 60)`) on `All time` and the month windows, and on the two week windows it
 * is the weekly `Rating` (M7.3), which the nightly post prints because the nightly post reads
 * `This week`.
 *
 * **The title names the window, not a season** (M5.12): `This week · leaderboard`, linking to
 * `?window=this-week`. A season name in a Discord title was always going to read as
 * `gamesd · leaderboard` on the deployment that exists; more to the point, "the season" is no
 * longer a thing the product has. The field-name rule (M3.22) and the ten-line cap are
 * untouched.
 *
 * The footer is one short sentence, on **every** one of these posts and not just the first: a
 * post without it is a post that invites the question again (M3.8). Which sentence follows the
 * number above it — Proven's on an all-time board, the week's restart on a week one (M7.3). There
 * is no `settling` chip per line — it would double the length of the two lines that are already
 * about the newest players.
 */
export function leaderboardEmbed(input: LeaderboardEmbedInput): WebhookPayload {
  const entries = input.entries.slice(0, TOP_N);

  return payload({
    color: ACCENT_COLOR,
    title: `${input.windowLabel} · ${LEADERBOARD_LABEL.toLowerCase()}`,
    ...(input.url === undefined ? {} : { url: input.url }),
    fields: [{ name: leaderboardFieldName(entries.length), value: boardValue(entries) }],
    footer: { text: boardFooter(input.track) },
    timestamp: input.timestamp,
  });
}

/**
 * The board's field value: ten ranked lines, cut from the **bottom** if ten escaped 32-character
 * names do not fit in 1024 (M4.12).
 *
 * Every line is one rank, so the drop order is the rank order reversed and the field keeps its
 * top rows — which is the only sensible thing a list ordered by Proven can lose. `…` under the
 * last row it kept says the rest are on the page the title links to.
 */
function boardValue(entries: readonly LeaderboardEntry[]): string {
  return fieldValue(entries.map(leaderboardLine));
}

/** `` `1` Lena · 1548 · 41 games ``. The rank is in code, like a role, so the column reads. */
function leaderboardLine(entry: LeaderboardEntry, index: number): string {
  return `\`${index + 1}\` ${renderName(entry.name)} · ${entry.score} · ${gamesLabel(entry.games)}`;
}

/**
 * One award line of the closed window's post (M5.4, M5.10).
 *
 * **Filled since M5.4 landed**: `lib/discord/post.ts` reads the closed window through
 * `loadStats` and hands three of these over, computed by the same pure functions the page
 * prints. `windowSummaryEmbed` still prints the field only when it is given some, which is what
 * keeps a failed stats read a post of the board alone rather than no post at all.
 *
 * The line is **quoted from the awards, never re-derived here** — including the sentence an
 * award nobody won prints (`Nobody played 6 games this week.`), so the block always has three
 * labels and the group can see the bar it missed. A tie carries its winners as one string with
 * a newline in it, so the bold label prints once and the second name hangs under the first.
 */
export interface WindowAward {
  /** `Most improved`. Rendered bold, at the front of the line. */
  label: string;
  /** `Nadia · +212 · 1266 → 1478`, or the "nobody qualifies" sentence, verbatim. */
  line: string;
}

/** The awards block's field name (M5.10). */
export const AWARDS_FIELD = 'Awards';

export interface WindowSummaryEmbedInput {
  /** `Last week` or `Last month` — {@link WINDOW_LABELS}, the same words the picker uses. */
  windowLabel: string;
  /**
   * `Sunday 6 Sep to Saturday 12 Sep · 14 rated games`: the window's own dates and the board's
   * own count, composed by `boardSlotLine` in `post.ts` — the same formatter and therefore the
   * same string as the slot under the picker on the page this post links to (M5.12, named by
   * M7.18). The builder prints what it is given and knows nothing about either count.
   */
  description: string;
  /** Which fold the entries came from (M7.3): `weekly` on the Sunday post, `all-time` monthly. */
  track: RatingTrack;
  /** The window's board, in its own order. {@link TOP_N} is the most that will print. */
  entries: readonly LeaderboardEntry[];
  /** M5.4's three lines when they exist. Undefined or empty prints no field at all. */
  awards?: readonly WindowAward[] | undefined;
  /** `/leaderboard?window=last-week`, or `undefined` when there is no honest URL to post. */
  url?: string | undefined;
  /** When the post was made — not when the window closed; the description says that. */
  timestamp: string;
}

/**
 * The post a closed week or month makes of itself (M5.10, fired by M5.13).
 *
 * Sunday morning: nobody is in voice, nobody opened anything, and there is a post in the
 * channel that says who won the week. It is the nightly embed's twin and shares its rules on
 * purpose — the same colour, the same ten-line cap, the same field-name rule (M3.22), the same
 * footer — with two differences that are the whole task:
 *
 * - **the description**, which names the window's own days and the count it counted (`Sunday 6 Sep
 *   to Saturday 12 Sep · 14 rated games`), because a post that arrives unasked has to say which
 *   seven days it is about — and, since M7.18, which of the two counts the group can compare it
 *   with is on it;
 * - **the awards field**, when there are awards to print (see {@link WindowAward}).
 *
 * The board is the **window's** board (M5.12): the players who played inside it, each with
 * their rating as of their last counted game in it, which is what makes Sunday's post
 * reproducible on Tuesday and after a late backfill.
 *
 * `week` and `month` appear nowhere in this function: the noun arrives in `windowLabel` and in
 * `description`, so the monthly post is this builder with different strings and not a copy.
 */
export function windowSummaryEmbed(input: WindowSummaryEmbedInput): WebhookPayload {
  const entries = input.entries.slice(0, TOP_N);
  const awards = input.awards ?? [];

  return payload({
    color: ACCENT_COLOR,
    title: `${input.windowLabel} · ${LEADERBOARD_LABEL.toLowerCase()}`,
    ...(input.url === undefined ? {} : { url: input.url }),
    description: input.description,
    fields: [
      { name: leaderboardFieldName(entries.length), value: boardValue(entries) },
      ...(awards.length === 0 ? [] : [{ name: AWARDS_FIELD, value: fieldValue(awards.flatMap(awardLines)) }]),
    ],
    footer: { text: boardFooter(input.track) },
    timestamp: input.timestamp,
  });
}

/** `**Most improved** Nadia · +212 · 1266 → 1478`. The label is bold; the rest is quoted. */
function windowAwardLine(award: WindowAward): string {
  return `**${award.label}** ${award.line}`;
}

/**
 * An award as ranked lines: **the winner's first line is a keeper, the tie's rest are not**
 * (M4.12).
 *
 * A ten-way tie arrives as one `line` with nine newlines in it and can push the block past 1024
 * on its own. Dropping from the bottom of a tie leaves every label present with its bold head
 * and its first winner — three awards, three answers — and one `…` where the other names were.
 * Losing a whole award to a tie in the one above it would be the wrong three lines to lose.
 */
function awardLines(award: WindowAward): FieldLine[] {
  return windowAwardLine(award)
    .split('\n')
    .map((text, index) => (index === 0 ? { text, keep: KEEP_LAST_STANDING } : text));
}

/**
 * `Teams are set`, and `Teams are set · reroll 1 of 2` when an admin has promoted split 2
 * (M3.2, `05-design.md` "The title on a reroll").
 *
 * Split 1 keeps the plain title, including when an admin promotes it back: it is the teams
 * the balancer chose, whatever route it took to be on the board again. The count comes from
 * how many splits the lobby actually stored — core returns three, so it reads `of 2` — rather
 * than from a literal, because a lobby that stored fewer must not promise a reroll it has not
 * got.
 */
export function teamsTitle(promoted: PromotedSplit | undefined): string {
  if (promoted === undefined || promoted.rank <= 1) return 'Teams are set';
  const rerolls = Math.max(promoted.splitCount - 1, promoted.rank - 1);
  return `Teams are set · reroll ${promoted.rank - 1} of ${rerolls}`;
}

/** `` `top` Hana · 1434 `` , plus ` · off-role` on the line of whoever is off it. */
function teamsLine(player: TeamsPlayer): string {
  return `\`${player.role}\` ${renderName(player.name)} · ${player.rating}${player.offRole ? ' · off-role' : ''}`;
}

/** `` `adc` Bilal · 1667 (-46) ``. The same shape as a teams line, on purpose. */
function resultLine(player: ResultPlayer): string {
  const role = player.role === null ? '' : `\`${player.role}\` `;
  return `${role}${renderName(player.name)} · ${player.rating} (${formatDelta(player.delta)})`;
}

/**
 * `+43`, `-46`, and `+0` / `-0` for a change too small to round to a point.
 *
 * Signed always: `(0)` never appears, because one unsigned entry in a column of ten signed
 * ones reads as a bug (`05-design.md`, "Rating delta"). ASCII `-`, not U+2212 — Discord has no
 * font control and these lines get copy-pasted. `-0 >= 0` is true in JavaScript, so the
 * negative zero has to be asked about by identity before anything else looks at the sign.
 */
export function formatDelta(delta: number): string {
  if (Object.is(delta, -0)) return '-0';
  return delta >= 0 ? `+${delta}` : String(delta);
}

/** `34:12`, and `1:02:03` for the long ones. */
export function formatDuration(durationS: number): string {
  const total = Math.max(0, Math.round(durationS));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** `47.3k` over a thousand, the plain number below it. */
export function formatDamage(damage: number): string {
  return damage >= 1_000 ? `${(damage / 1_000).toFixed(1)}k` : String(Math.round(damage));
}

/**
 * The name as it is printed: the display name, truncated at 32 characters, or `Someone` for a
 * player the database has no name for yet (M3.10). The fallback is a rendering rule and
 * nothing else — it is never written to `players`.
 *
 * A name is **text, not markup**. Riot IDs carry underscores and asterisks, and one stray
 * backtick closes the role's code span and swallows the rest of the field. So the markdown
 * characters are backslash-escaped — **last**, on the already-truncated string, so an escape
 * can never be sliced away from the character it belongs to and the 32 characters stay the 32
 * characters a reader sees (`05-design.md`, 2026-09-09).
 */
export function renderName(name: PlayerName): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return NAMELESS_PLAYER;
  const cut = trimmed.length > MAX_NAME_LENGTH ? `${trimmed.slice(0, MAX_NAME_LENGTH - 1)}…` : trimmed;
  return escapeMarkdown(cut);
}

/** Backtick, `*`, `_`, `~`, `|` and the backslash itself. There is no name we want italicised. */
function escapeMarkdown(value: string): string {
  return value.replace(/([`*_~|\\])/g, '\\$1');
}

/**
 * `Kustom · game 47`, and `Kustom` alone when the count could not be taken (M5.12, product
 * 2026-09-10; `05-design.md`, "Result embed").
 *
 * It used to be `Season 1 · game 47`. Seasons left the friend-facing vocabulary with the
 * window picker, and the last place the word survived was this footer — where it read as
 * `gamesd · game 47` on the deployment that exists. **The count keeps its meaning**: it is
 * every game this group has played up to this one, which is what it always counted, because
 * there has only ever been one season row for it to count inside.
 *
 * The bare name is right and needs no apology (product, 2026-09-09, for the same footer): a
 * count we could not take is simply not printed. Never `game ?`, never `game 0`, never a
 * sentence explaining that something did not add up.
 */
function resultFooter(gameNumber: number | null): string {
  return gameNumber === null ? 'Kustom' : `Kustom · game ${gameNumber}`;
}

/**
 * The fearless-draft list (M10): unique champions since the last admin reset, banned from
 * the next custom. A second message after the result, never stuffed into it — the result is
 * about ratings and this is about tomorrow's bans.
 *
 * Accent bar, same as teams: the list is neither side's. Empty pool is not posted; the
 * reset path has its own embed.
 */
export interface FearlessEmbedInput {
  champions: readonly FearlessChampion[];
  timestamp: string;
  url?: string;
}

export function fearlessEmbed(input: FearlessEmbedInput): WebhookPayload {
  return payload({
    color: ACCENT_COLOR,
    title: FEARLESS_TITLE,
    ...(input.url === undefined ? {} : { url: input.url }),
    description: fearlessDescription(input.champions.length),
    fields: groupFearless(input.champions).map((group) => ({
      name: fearlessLaneTitle(group.role),
      value: fieldValue(group.champions.map((champion) => champion.name)),
    })),
    footer: { text: teamsFooter(input.url) },
    timestamp: input.timestamp,
  });
}

export interface FearlessResetEmbedInput {
  timestamp: string;
  url?: string;
}

export function fearlessResetEmbed(input: FearlessResetEmbedInput): WebhookPayload {
  return payload({
    color: ACCENT_COLOR,
    title: FEARLESS_TITLE,
    ...(input.url === undefined ? {} : { url: input.url }),
    description: FEARLESS_RESET_DESCRIPTION,
    fields: [],
    footer: { text: teamsFooter(input.url) },
    timestamp: input.timestamp,
  });
}

/**
 * `Kustom · more on the tonight page`, or just the name when there is no link (M3.21).
 *
 * The product is **Kustom** on every friend-facing surface; the repo's codename stays in
 * `CLAUDE.md`, the docs and the package names, and appears nowhere under `apps/web`.
 */
function teamsFooter(url: string | undefined): string {
  return url === undefined ? 'Kustom' : 'Kustom · more on the tonight page';
}

/** `Sara and Deniz`, `Sara, Deniz and Ali` (M2.15). */
export function joinNames(names: readonly PlayerName[]): string {
  const rendered = names.map(renderName);
  if (rendered.length <= 1) return rendered[0] ?? '';
  return `${rendered.slice(0, -1).join(', ')} and ${rendered[rendered.length - 1]}`;
}

/** M2.15's and M3.12's copy, verbatim. Product owns all three; none is composed elsewhere. */
function sitOutLine(names: readonly PlayerName[], reason: SitOutReason): string {
  return `Sitting out: ${joinNames(names)} — ${SIT_OUT_CLAUSES[reason]}.`;
}

/** The three clauses. Words from `05-design.md`, "Sit-out fields"; nothing derives them. */
const SIT_OUT_CLAUSES: Readonly<Record<SitOutReason, string>> = {
  'most-games': 'most games tonight',
  'longest-since': 'longest since they last sat out',
  'first-sit-out': 'nobody has sat out before, so somebody had to be first',
};

/** M2.15's two seat lines, verbatim. */
function seatLine(move: SeatLine): string {
  if (move.kind === 'open-slot') return `${renderName(move.mover)} is playing — take the open slot.`;
  return `Swap: ${renderName(move.sitter)} out, ${renderName(move.mover)} in.`;
}

/**
 * `` `customs-night` · password `4471` ``.
 *
 * The password half is dropped when the client did not report one — which is every lobby
 * until M4.1 creates them itself — and the whole field is absent when the name is unknown
 * too. Never empty, never the word "unknown" (M3.1 acceptance check 5).
 */
function lobbyFieldValue(lobby: { name: string | null; password: string | null }): string | null {
  const name = lobby.name?.trim() ?? '';
  const password = lobby.password?.trim() ?? '';
  if (name.length === 0 && password.length === 0) return null;
  if (name.length === 0) return `Password \`${password}\``;
  return password.length === 0 ? `\`${name}\`` : `\`${name}\` · password \`${password}\``;
}

/**
 * `Blue was favored 54%.` Past tense, because the game has been played; the teams embed's
 * present-tense clause is core's and this one is not a recomposition of it — it is the same
 * number said about a game that is over.
 *
 * The coin flip is `Neither side was favored.` and not core's `Even 50%.` (M3.11, product
 * 2026-09-09): under the headline `Red wins · 34:12`, beside a full past-tense sentence,
 * *even, 50%* reads as a scoreline before it reads as a prediction — and on a first night,
 * everyone unrated and every split gap 0, it is the first result sentence the group ever
 * reads. The number goes with it, because 50 is what "neither" means. Core's fragment in the
 * teams explanation is untouched and stays core's.
 *
 * Exported because the tonight page's result card prints the same sentence (M3.4): the page
 * and the message must not invent a fifth number format between them (`05-design.md`, "The
 * four number formats").
 */
export function favoredClause(blueWinProb: number | null): string | null {
  if (blueWinProb === null) return null;
  const percent = Math.round(blueWinProb * 100);
  if (percent > 50) return `Blue was favored ${percent}%.`;
  if (percent < 50) return `Red was favored ${100 - percent}%.`;
  return 'Neither side was favored.';
}

function topDamageClause(top: { name: PlayerName; damage: number } | null): string | null {
  if (top === null) return null;
  return `Top damage: ${renderName(top.name)}, ${formatDamage(top.damage)}.`;
}

/**
 * The number beside the side's name: the sum of five display ratings. It is not the gap —
 * the gap is computed on effective (role-adjusted) skill and lives in the explanation, which
 * is the only place the word appears.
 */
function sumRatings(players: readonly TeamsPlayer[]): number {
  return players.reduce((total, player) => total + player.rating, 0);
}
