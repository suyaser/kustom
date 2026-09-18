import type { LobbyStatusValue, RoleValue, SideValue } from '@customs/db';
import type { FearlessView } from '../fearless/types';

/**
 * What the tonight page knows (M3.4). One snapshot, loaded on the server for the first paint
 * and re-loaded by the browser on every Realtime event, so both sides render from the same
 * shape and there is no second code path for "after an update".
 *
 * **No number in here has been formatted.** Display ratings are `displayRating(mu)` because
 * that is what the embed printed and the two must agree; a rating *change* is carried as the
 * two mu values it comes from and is turned into a delta where it is rendered. `-0` does not
 * survive `JSON.stringify` (05-design.md, "Rating delta"), and this object crosses the wire
 * twice — once in the RSC payload, once from PostgREST.
 */

/** A display name we have, or `null` for a player the database has never been told about. */
export type PlayerName = string | null;

export interface MemberView {
  puuid: string;
  name: PlayerName;
  mainRole: RoleValue | null;
  secondaryRole: RoleValue | null;
  roleOverride: RoleValue | null;
  /** Beyond the ten a custom lobby can seat. Rendered under the `Around` hairline. */
  isSpectator: boolean;
  /**
   * ISO 8601: when this player first appeared in the lobby. It is the list's order, and it is
   * what the three-second "just joined" marker is measured against (05-design.md). A re-post
   * upserts the row without touching `created_at`, so it stays the first sighting.
   */
  joinedAt: string;
  /** `displayRating(mu)` for the active season, seeded from rank when there is no row. */
  rating: number;
  /**
   * `lobby_members.side`: where the **client** has this person sitting right now, `100` blue,
   * `200` red, and `null` for a spectator or somebody the client has not placed (M4.11).
   *
   * It is not where the split puts them — that is {@link SeatView.role}'s card — and the two
   * differing is the whole of the side line. The companion rewrites this column on every lobby
   * post, so a friend dragging themselves across fires a `lobby_members` event and the page
   * re-reads (`TonightLive`).
   */
  side: SideValue | null;
}

/** One of the ten in the promoted split. */
export interface SeatView {
  puuid: string;
  name: PlayerName;
  role: RoleValue;
  rating: number;
  /** Core's `isOffRole`, never a re-derived `role !== mainRole`. */
  offRole: boolean;
  /**
   * {@link MemberView.side}, carried onto the seat the split gave this player (M4.11): where
   * the client has them, beside where they are supposed to be. `null` when they have no member
   * row at all (`game_players` and `lobby_members` are not always the same ten) or when the
   * client has not placed them.
   *
   * **Nothing in the card renders it.** It decides one thing — whether the side line is on the
   * page — and a seat moving from the wrong side to the right one must leave the two cards byte
   * for byte as they were.
   */
  liveSide: SideValue | null;
}

/** One of the lobby's stored splits, as the reroll control needs it. */
export interface SplitChoice {
  id: string;
  rank: number;
  isChosen: boolean;
}

export interface TeamsView {
  splitId: string;
  /** `splits.explanation` of the promoted split, verbatim. Never recomposed (M3.7). */
  explanation: string;
  blue: SeatView[];
  red: SeatView[];
  /** Everyone around who is not one of the ten. Empty when exactly ten are around. */
  sitters: MemberView[];
  blueWinProb: number;
  /** Every stored split of this lobby, best first: what a reroll can promote. */
  splits: SplitChoice[];
}

/** One row of the result card. The two mu values, not a delta: see the note at the top. */
export interface ResultSeatView {
  puuid: string;
  name: PlayerName;
  role: RoleValue | null;
  side: SideValue;
  muBefore: number | null;
  muAfter: number | null;
}

export interface ResultView {
  winningSide: SideValue;
  durationS: number;
  /** The chosen split's odds, or `null` when the game was played without a stored split. */
  blueWinProb: number | null;
  topDamage: { name: PlayerName; damage: number } | null;
  blue: ResultSeatView[];
  red: ResultSeatView[];
  /**
   * True when every row carries both mu values. A remake or a short surrender leaves them
   * null: the page then shows the teams and the explanation under the header `Final`, with no
   * deltas and no banner explaining itself (M3.4, "a game whose lobby is finished but which
   * the fold did not rate").
   */
  rated: boolean;
}

export interface LobbyView {
  id: string;
  status: LobbyStatusValue;
  /**
   * The lobby's own name in the client (`Customs 09 Sep #1`), or `null` when no companion has
   * reported one. With it and {@link LobbyView.lobbyPassword} the page tells a friend who
   * missed the invite how to get in by hand (M4.10).
   */
  lobbyName: string | null;
  /**
   * The four digits, or `null` until a companion that knows them posts (M4.2's never-clear
   * rule). **Not a secret**: it goes in the Discord embed and is read out in voice.
   */
  lobbyPassword: string | null;
  /** In join order, oldest first. Newest is appended; the list never reorders. */
  members: MemberView[];
  /** The promoted split, when there is one. */
  teams: TeamsView | null;
  /** The lobby's game, when it has finished one. */
  result: ResultView | null;
}

export interface TonightSnapshot {
  /**
   * The newest non-`abandoned` lobby of tonight, or `null` — which is the idle page. Tonight
   * is 06:00 to 06:00 in `CUSTOMS_NIGHT_TZ`; the boundary is computed on the server by
   * `lib/night.ts` and travels in `nightStart` so the browser never re-derives it.
   */
  lobby: LobbyView | null;
  /** ISO 8601. The start of the night this snapshot was taken for. */
  nightStart: string;
  /**
   * `TUESDAY 9 SEPTEMBER`: the strip's slug, from `nightStart`, so a 01:00 game still says
   * Tuesday. **Formatted on the server**, in a fixed locale and the configured timezone
   * (`lib/night.ts`), because a date formatted by the browser would disagree with the server
   * render and the line would change under the reader (05-design.md, "The status strip").
   */
  nightLabel: string;
  /**
   * False prints `NO_ACTIVE_SEASON_TONIGHT_MESSAGE` — tonight's games are not being saved.
   *
   * **The name that went with it is gone** (M5.12): the slug is the night alone, so nothing on
   * this page reads a season's name and the snapshot no longer carries one.
   */
  seasonActive: boolean;
  /**
   * Champions this group has locked since an admin last cleared the fearless pool (M10).
   * Empty until the next counted Rift custom lands after the cursor. Derived from
   * `game_players.champion_id`; the snapshot just carries the folded list.
   */
  fearless: FearlessView;
}

/**
 * The one primary block the page renders (05-design.md, "The tonight page's three states —
 * one rule"). Derived from `lobbies.status` and nothing else, so a fourth state cannot be
 * invented by a component.
 */
export type TonightState =
  | { kind: 'idle' }
  | { kind: 'filling'; lobby: LobbyView }
  | { kind: 'teams'; lobby: LobbyView; teams: TeamsView }
  | { kind: 'result'; lobby: LobbyView; result: ResultView; teams: TeamsView | null };
