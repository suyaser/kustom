import type { Mode, ModeLock, ModeRow } from '@customs/core';
import type { LobbyStatusValue, RoleValue, SideValue } from '@customs/db';
import type { GroupMode, KickoffKind } from '@customs/db/schemas';
import type { StoredSplit } from '@/components/receipt/types';
import type { FearlessView } from '../fearless/types';
import type { GameStampView } from '../mode/types';
import type { NightClock } from '../night';

/**
 * What the tonight page knows (M3.4). One snapshot, loaded on the server for the first paint
 * and re-loaded by the browser on every Realtime event, so both sides render from the same
 * shape and there is no second code path for "after an update".
 *
 * **No number in here has been formatted.** Display ratings are `displayKustom(r)` (M18.6) because
 * that is what the embed printed and the two must agree; a rating *change* is carried as the
 * two unrounded all-time Ratings it comes from and is turned into a delta where it is rendered. `-0` does not
 * survive `JSON.stringify` (05-design.md, "Rating delta"), and this object crosses the wire
 * twice — once in the RSC payload, once from PostgREST.
 */

/** A display name we have, or `null` for a player the database has never been told about. */
export type PlayerName = string | null;

export interface MemberView {
  puuid: string;
  name: PlayerName;
  /**
   * The same-name suffix (`#EUW`, `(2)`) printed muted after the name, or null/absent when nobody
   * else in the group prints the same name (M14.69, `lib/names/roster.ts`).
   */
  nameSuffix?: string | null | undefined;
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
  /**
   * `displayKustom(ratings.r)`, the all-time Rating the balancer reads; 1200 with no row or a row
   * the Kustom fold has not written (M18.2, the same number the teams embed prints).
   */
  rating: number;
  /**
   * Rated games in this group (`ratings.games`), for the settling chip and the roster's `New`
   * (M14.9; core's `isSettling`). 0 for somebody the fold has never rated here; `null` when the
   * page cannot know (a fixture with no rating data), and then no chip is drawn rather than a false one.
   */
  ratedGames: number | null;
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
  /**
   * The same-name suffix (`#EUW`, `(2)`) printed muted after the name, or null/absent when nobody
   * else in the group prints the same name (M14.69, `lib/names/roster.ts`).
   */
  nameSuffix?: string | null | undefined;
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
  /**
   * The same run with its numeric columns and parsed tens (M14.9), best first: the fairness
   * receipt's only input besides names. Never re-derived from the seats.
   */
  stored: StoredSplit[];
}

/**
 * One of the players who started the game (M21.5): a {@link SeatView} whose role is only known
 * when this side's players are exactly the split's side (a changed side has no lane until the eog).
 */
export interface KickoffSeatView {
  puuid: string;
  name: PlayerName;
  nameSuffix?: string | null | undefined;
  /** The split's role for this player when the side is the split's side, else `null`. */
  role: RoleValue | null;
  rating: number;
  /** Core's `isOffRole` on the split's role; `false` with no role. */
  offRole: boolean;
}

/**
 * The teams that started the game (M21.4's kickoff record, M21.5): what the in-game block draws.
 * Built by `kickoffView` (`lib/tonight/kickoff.ts`) from the record, the split and the members.
 */
export interface KickoffView {
  /** `rolled` (the split's teams, maybe on swapped sides), `custom` (other teams), `unrolled` (no roll). */
  kind: KickoffKind;
  /** `rolled` only: the split's teams sat on each other's sides. */
  swapped: boolean;
  /** Side 100 at kickoff: lane order when the side is the split's, else rating order (high first). */
  blue: KickoffSeatView[];
  red: KickoffSeatView[];
  /** Everyone around who is on neither team, in join order. */
  sitters: MemberView[];
  /**
   * Blue's chance for the teams playing: the chosen split's stored odds for `rolled` (flipped when
   * swapped), the stored kickoff odds for `custom` and `unrolled`. `null`: none to read (a rolled
   * record whose split is not readable). Whether it is shown is the page's rule (M15.18).
   */
  blueWinProb: number | null;
}

/** One row of the result card. The two all-time Ratings, not a delta: see the note at the top. */
export interface ResultSeatView {
  puuid: string;
  name: PlayerName;
  /**
   * The same-name suffix (`#EUW`, `(2)`) printed muted after the name, or null/absent when nobody
   * else in the group prints the same name (M14.69, `lib/names/roster.ts`).
   */
  nameSuffix?: string | null | undefined;
  role: RoleValue | null;
  side: SideValue;
  /**
   * `game_players.r_before` / `r_after` (0036): the all-time Kustom Ratings around the game,
   * unrounded. The result card and the poster print all-time changes (M18.6); `r_before` is also
   * the pre-game odds of a split-less game. `null` on a game the all-time track did not rate.
   */
  rBefore: number | null;
  rAfter: number | null;
}

export interface ResultView {
  /** `games.id` (M14.30: the fearless pool's champions this game added carry it). */
  gameId: string;
  winningSide: SideValue;
  durationS: number;
  /** The chosen split's odds, or `null` when the game was played without a stored split. */
  blueWinProb: number | null;
  topDamage: { name: PlayerName; damage: number } | null;
  /**
   * The MVP and the ACE by name (M11.3): `gatedGameAward`'s answer, the function the Discord
   * result post and `/p/[puuid]` call on the same columns. `null` for a game with no award, and
   * the poster then prints no line at all.
   */
  award: {
    mvp: PlayerName;
    ace: PlayerName;
    /** M14.41: whose page the name links to (`/g/<slug>/p/<puuid>`). Absent in older fixtures. */
    mvpPuuid?: string | undefined;
    acePuuid?: string | undefined;
  } | null;
  blue: ResultSeatView[];
  red: ResultSeatView[];
  /**
   * True when every row carries both all-time Ratings (`r_before`, `r_after`). A remake or a short surrender leaves them
   * null: the page then shows the teams and the explanation under the header `Final`, with no
   * deltas and no banner explaining itself (M3.4, "a game whose lobby is finished but which
   * the fold did not rate").
   */
  rated: boolean;
  /**
   * The game's mode stamp (M15.5, `0032`): its rule, `games.rated` and the stored check, for the
   * poster's rule line and `Not rated, so no Rating change.`. Absent or null: none to say.
   */
  stamp?: GameStampView | null | undefined;
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
  /**
   * ISO 8601: when the game started, for `23 min in` (M14.9). `lobbies.updated_at` of an `in_game`
   * row (the `in_progress` post sets it), `null` in every other status.
   */
  startedAt: string | null;
  /** In join order, oldest first. Newest is appended; the list never reorders. */
  members: MemberView[];
  /** The promoted split, when there is one. */
  teams: TeamsView | null;
  /** The lobby's game, when it has finished one. */
  result: ResultView | null;
  /**
   * This game (M20.7, `lobbies.lock_*`; core's `ModeLock`): what Roll, or the game's start, moved
   * off the card. Absent or null: no lock, and the card shows the next game.
   */
  lock?: ModeLock | null | undefined;
  /**
   * The teams that started the game (M21.5), for an `in_game` lobby with a kickoff record only.
   * Absent or null: no record (a game before M21.4, unequal sides), and the page is as before.
   */
  kickoff?: KickoffView | null | undefined;
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
   * Champions this group has locked since an admin last cleared the fearless pool (M10).
   * Empty until the next counted Rift custom lands after the cursor. Derived from
   * `game_players.champion_id`; the snapshot just carries the folded list.
   */
  fearless: FearlessView;
  /**
   * The group's standing mode (M14.29). On `normal`, {@link fearless} is the paused pool, not bans
   * in force. The Mode card (M14.30) reads both.
   */
  mode: GroupMode;
  /** `group_modes.updated_at`, or `null`: the client mode store's gate (M19.13), nothing else. */
  modeSince: string | null;
  /**
   * The next game (M20.8; `group_modes`, core's `ModeRow`): the standing mode, the pending rule
   * with its region pair, the Rated switch. Absent in older fixtures: read as {@link mode} with
   * nothing pending.
   */
  modeRow?: ModeRow | undefined;
  /**
   * The `group_modes` read failed (audit, M19.13): `modeState` is a stand-in, never to be shown as
   * the group's mode. The card keeps the last good state it had and says it could not read it.
   */
  modeReadFailed?: boolean | undefined;
  /**
   * The configured zone's offset for this night, from the server (`lib/night.ts`). It travels so
   * the browser's re-read prints the tape's clocks the way the server did, without `Intl`.
   */
  nightClock: NightClock;
  /**
   * Tonight's earlier games, **oldest first** (M11.2): every `finished` or `dropped` lobby of
   * the night except the one the primary block is drawing. Not a fourth state — the primary
   * block is still {@link TonightState}. Empty on a night with nothing behind the current block.
   */
  tape: TapeEntry[];
  /**
   * The group's hosts by name (M14.66): every player with an unrevoked companion token of the
   * group, oldest first, nameless ones dropped (`readGroupHostNames` in `lib/lobbyStart.ts`).
   * Feeds `noKustomRunningLine(adminNames(hostNames))` under `Start a lobby` on idle.
   *
   * Tokens are service-role only, so the anon {@link loadTonight} answers `[]` and the page fills
   * it on the server (`withHostPresence`).
   */
  hostNames: string[];
  /**
   * Whether any of the group's tokens was seen in the last ten minutes (`HOST_WINDOW_MS`, the
   * press's own host window): false means a press would answer the no-host 409, so idle shows
   * the line before anyone taps. The anon {@link loadTonight} answers true (unknown: no line).
   */
  hostSeenRecently: boolean;
}

/** One row of the night tape. Everything on it is decided on the server; nothing is a rating. */
export interface TapeEntry {
  lobbyId: string;
  /** `lobbies.created_at`, ISO 8601, for `<time dateTime>`. */
  createdAt: string;
  /** `22:41`: `created_at` in `CUSTOMS_NIGHT_TZ`, h23, formatted by `formatClock`. */
  clock: string;
  status: 'finished' | 'dropped';
  /** The lobby's newest game with a winner, or `null`: a dropped lobby, `NO RESULT`. */
  result: {
    gameId: string;
    winningSide: SideValue;
    durationS: number;
    /** `matchesQueue(mode, 'aram')`, the rule `/games` lists by. */
    aram: boolean;
    /** Every scoreboard row carries both all-time Ratings: `loadResult`'s rule. */
    rated: boolean;
    /** `gatedGameAward`'s MVP by name (M14.9), or `null`: no award, or a name nobody has. */
    mvp: PlayerName;
    /**
     * M15.19: the rule the game was played under (`games.rule*`, only when `rule_checked`: a Rift
     * game under the rule), for `Tanks only · not rated` on the tile. Null or absent: no rule.
     */
    rule?: Mode | null | undefined;
  } | null;
  /** The chosen split's stored odds, or `null` with no split: no evenness line, no underdog line. */
  blueWinProb: number | null;
  /** The chosen split's rank (M14.9): `pick #2` after a reroll. `null` with no split. */
  rank: number | null;
  /** Members who were not in the chosen split's ten, in join order. `TeamsView.sitters`' rule. */
  sitters: PlayerName[];
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
  /**
   * M21.5: an `in_game` lobby with a kickoff record. `game` is who is really playing; `teams` is
   * the split the bot rolled, when there is one (its receipt, `How the bot decided`).
   */
  | { kind: 'in-game'; lobby: LobbyView; game: KickoffView; teams: TeamsView | null }
  | { kind: 'result'; lobby: LobbyView; result: ResultView; teams: TeamsView | null };
