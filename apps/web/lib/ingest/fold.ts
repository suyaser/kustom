import {
  applyMvpAceBonus,
  type MvpAce,
  mvpAce,
  type PerformancePlayer,
  type Rating,
  type RatingChange,
  type Role,
  rateGame,
} from '@customs/core';
import type { SideValue } from '@customs/db';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { MIN_RATED_DURATION_S, PLAYERS_PER_GAME } from '../lobbyState';

/**
 * The middle of the rating fold, written once (M5.2).
 *
 * Ten rows plus the ratings that went in plus the winning side, in; the ratings that came out,
 * out. No database, no clock: everything either side of this — reading `ratings`, claiming the
 * null `mu_after` columns, batching a whole season's writes — belongs to its caller.
 *
 * There are exactly two callers, and that is the point: `rating.ts` folds one game as it lands
 * and `rebuild.ts` folds every game of a season from seeds. "The rebuild reproduces the
 * incremental fold exactly" is a fact about this file being the only implementation, not a
 * hope about two copies staying in step. The gate below has to be shared for the same reason:
 * a game the live fold skipped and the rebuild rated would move numbers nobody played for.
 *
 * **There are two gates here and they answer two different questions** (M7.1).
 *
 * - {@link gateGame} — "did a game happen that can be read?" Ten rows, five a side, over 300
 *   seconds, nobody twice. That is the universe `countedGames` folds for `/stats`, `/fun`,
 *   `/p/[puuid]` and the board's streak, and an ARAM night belongs in it: it was played, it has
 *   a scoreboard, and M5.26 settled that `/stats` and the rating fold stay mixed.
 * - {@link gateRatedGame} — "and may it move the rating?" Everything above **and** the map. Only
 *   `rating.ts` and `rebuild.ts` call it, and nothing on any page does.
 *
 * Folding the mode into `gateGame` instead would have emptied `/fun?queue=aram` — that page
 * folds `countedGames` and *then* filters to ARAM — so the separation is the whole shape of the
 * fix, not a style choice.
 *
 * **The MVP / ACE bonus is applied here and nowhere else** (M7.9). `rateGame` produces the ten
 * deltas; `mvpAce` names the best player on each side from the stat line the game stored; and
 * `applyMvpAceBonus` scales exactly two of those deltas. All three are `@customs/core`'s and
 * none of the arithmetic is repeated here. It sits inside {@link foldGame} for the same reason
 * the gate does: a game the live fold amplified and the rebuild did not would move numbers
 * nobody played for, and the only defence against that is there being one implementation.
 *
 * A game missing any of the nine stored numbers for any of the ten — or any of the ten roles —
 * gets **no MVP and no ACE** and is rated exactly as it was before M7.9. That rule lives in
 * core (`performanceScores` returns `null`); this file only hands it the columns.
 *
 * The maths itself is `rateGame` in `@customs/core` and is not repeated here (CLAUDE.md).
 */

/** Five a side. Anything else is not a game we rate. */
export const TEAM_SIZE = PLAYERS_PER_GAME / 2;

/**
 * What **the gate itself** reads off a row: which side, and who.
 *
 * Split out of {@link FoldPlayer} by M7.10 so a surface that only wants to *print* an answer —
 * the result embed, `/p/[puuid]`'s recent games — can run the same shape check without
 * inventing a `playerId` it has no use for. `gateGame` never read that field; this only says so
 * in the type.
 */
export interface FoldGatePlayer {
  /** The tie-break for the order the two teams are handed to core. */
  puuid: string;
  side: SideValue;
}

/** One `game_players` row, reduced to what **the fold** reads: the gate's two, plus the key. */
export interface FoldPlayer extends FoldGatePlayer {
  playerId: string;
}

/**
 * The stat line one `game_players` row carries into the performance score (M7.9).
 *
 * Nine numbers and a role, spelled exactly as `PerformancePlayer` in `@customs/core` wants
 * them, so {@link toPerformancePlayer} is a rename and never a computation. Every field is
 * nullable because the columns are: `vision_score` and `damage_self_mitigated` only exist from
 * migration `0014`, `damage_to_objectives` from `0015`, and `role` is null for every backfilled
 * game. Core's rule — a game missing any one of them for any of the ten has no MVP — is what
 * makes the nullability safe to pass straight through.
 *
 * `kills` through `cs` are `not null` in the schema and are typed nullable anyway: this is the
 * shape core reads, and a column's default is not a promise the fold should be relying on.
 */
export interface FoldPerformance {
  role: Role | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damageToChamps: number | null;
  gold: number | null;
  cs: number | null;
  visionScore: number | null;
  damageSelfMitigated: number | null;
  damageToObjectives: number | null;
}

/**
 * What {@link foldGame} needs: the gate's three fields and the stat line.
 *
 * The two rating callers — `rating.ts` and `rebuild.ts` — both select these columns and both
 * hand their own row type straight through the gate, which is why the gates are generic in the
 * row. Everything else that gates (`lib/stats/fold.ts`'s `countedGames`) asks only "did a game
 * happen", never "what did it do to the rating", and keeps passing a plain {@link FoldPlayer}.
 */
export interface FoldRatedPlayer extends FoldPlayer, FoldPerformance {}

/**
 * Why a stored game is not rated. `duplicate-player` cannot happen through the API — the
 * `(game_id, player_id)` primary key forbids it and the game route refuses the payload — but
 * the rebuild reads whatever is in the table, and a fold that averaged somebody against
 * themselves would be worse than a loud skip.
 */
export type FoldSkipReason = 'participant-count' | 'side-split' | 'duration' | 'duplicate-player';

/**
 * Generic in the row so a caller's own shape survives the gate: `rating.ts` and `rebuild.ts`
 * put a {@link FoldRatedPlayer} in and need one back out, because {@link foldGame} reads the
 * stat line off exactly these two arrays.
 */
export type FoldGate<T extends FoldGatePlayer = FoldPlayer> =
  | { ok: true; blue: T[]; red: T[] }
  | { ok: false; reason: FoldSkipReason };

/**
 * M2.5's gate: ten rows, five a side, over 300 seconds. 300 exactly is not rated.
 *
 * **"A game happened", not "a game rates"** (M7.1): the map is not asked about here, because
 * this is also the universe `/stats` and `/fun` count and an ARAM night counts there. The
 * rating callers use {@link gateRatedGame}, which is this plus the mode.
 *
 * On the way through it sorts each side by puuid ascending, which is the order both callers
 * hand to `rateGame`. OpenSkill's answer does not depend on that order today, but the columns
 * we write do — the fold has to be reproducible from the table, not from the order a
 * PostgREST select happened to return.
 */
export function gateGame<T extends FoldGatePlayer>(players: readonly T[], durationS: number): FoldGate<T> {
  if (players.length !== PLAYERS_PER_GAME) {
    return { ok: false, reason: 'participant-count' };
  }
  if (new Set(players.map((player) => player.puuid)).size !== players.length) {
    return { ok: false, reason: 'duplicate-player' };
  }
  const blue = players.filter((player) => player.side === 100).sort(byPuuid);
  const red = players.filter((player) => player.side === 200).sort(byPuuid);
  if (blue.length !== TEAM_SIZE || red.length !== TEAM_SIZE) {
    return { ok: false, reason: 'side-split' };
  }
  if (durationS <= MIN_RATED_DURATION_S) {
    return { ok: false, reason: 'duration' };
  }
  return { ok: true, blue, red };
}

/**
 * Why a game that happened is not *rated*. {@link gateGame}'s four reasons, plus the map.
 *
 * `game-mode` is only ever produced by {@link gateRatedGame}: it is not a reason a game fails to
 * count on `/stats`, which is exactly the point of there being two gates.
 */
export type RatedSkipReason = FoldSkipReason | 'game-mode';

export type RatedGate<T extends FoldGatePlayer = FoldPlayer> =
  | { ok: true; blue: T[]; red: T[] }
  | { ok: false; reason: RatedSkipReason };

/**
 * Is this game's mode one the rating fold may read? **Summoner's Rift, and nothing else** (M7.1).
 *
 * `raw` is `games.raw` — the stored end-of-game block or match detail — and the client's
 * `gameMode` on it is the authority. The two helpers are `lib/games/queue.ts`'s, the same pair
 * `/games`, `/fun` and the Daily Mystery read, so "Rift" means one thing in this app:
 * `CLASSIC`, or a **missing** mode.
 *
 * **A missing mode is Rift** (M5.26, 2026-09-12): every night captured before the companion
 * stored a mode was Rift, and treating null as unknown would un-rate the group's whole history.
 * ARAM, `KIWI`, `URF` and whatever the client invents next patch are stored with their ten rows
 * and their scoreboard and four null rating columns, for ever.
 */
export function isRatedMode(raw: unknown): boolean {
  return matchesQueue(gameModeFromRaw(raw), 'sr');
}

/**
 * The gate the **rating** fold uses: {@link gateGame} and then the map (M7.1).
 *
 * The order matters to the log and to nothing else — a nine-player ARAM is still reported as
 * `participant-count`, exactly as it was before this check existed, so a rebuild's skip counts
 * only grow a new column rather than move numbers between the old ones.
 *
 * Both rating callers pass `games.raw` straight through; neither of them interprets it, because
 * "what counts as Rift" living in two places is how the live fold and the rebuild start
 * disagreeing.
 */
export function gateRatedGame<T extends FoldGatePlayer>(
  players: readonly T[],
  durationS: number,
  raw: unknown,
): RatedGate<T> {
  const gate = gateGame(players, durationS);
  if (!gate.ok) return gate;
  if (!isRatedMode(raw)) return { ok: false, reason: 'game-mode' };
  return gate;
}

/**
 * One game's new ratings, by player id. `before` must hold a rating for all ten — a seed, or
 * what the season has given them so far; whose job that is differs between the two callers.
 *
 * Three steps, and the second and third are M7.9:
 *
 * 1. `rateGame` — the base OpenSkill fold, untouched.
 * 2. {@link gameAward} — who the MVP and the ACE were, or `null` when the game cannot be scored.
 * 3. `applyMvpAceBonus` — the MVP's `mu` delta × 1.25 and the ACE's × 0.80, eight untouched and
 *    every `sigma` copied through.
 *
 * With no award, step 3 hands back exactly what step 1 produced, so a game stored before the
 * stat columns existed — or a backfilled one that knows nobody's role — rates digit for digit
 * as it did before this function learned about the bonus.
 */
export function foldGame(
  blue: readonly FoldRatedPlayer[],
  red: readonly FoldRatedPlayer[],
  before: ReadonlyMap<string, Rating>,
  winningSide: SideValue,
): Map<string, Rating> {
  const rated = rateGame(
    blue.map((player) => mustGet(before, player.playerId)),
    red.map((player) => mustGet(before, player.playerId)),
    winningSide,
  );

  // Blue then red, the order the two arrays were handed to core, so the index of a player in
  // `ten` is the index of their rating in the matching half of `rated`.
  const ten = [...blue, ...red];
  const changes: RatingChange[] = ten.map((player, index) => ({
    puuid: player.puuid,
    before: mustGet(before, player.playerId),
    after: index < blue.length ? mustIndex(rated.blue, index) : mustIndex(rated.red, index - blue.length),
  }));

  const adjusted = applyMvpAceBonus(changes, gameAward(ten, winningSide));

  const after = new Map<string, Rating>();
  ten.forEach((player, index) => {
    after.set(player.playerId, mustChange(adjusted, index).after);
  });
  return after;
}

/**
 * Who carried each side (M7.9), or `null` for a game that cannot be scored: a stat column the
 * row never stored, a role the client never detected, or anything else core's missing-input
 * rule refuses. The whole of that judgement is `mvpAce`'s; this is the column-to-field rename
 * in front of it.
 *
 * Exported because it is the only place in the app that names an MVP, and a surface that wants
 * to print one (M7.10) has to read it here rather than fold a second copy of the formula.
 *
 * **It inherits core's contract and throws** — it does not return `null` — when it is handed
 * anything that is not five a side with ten distinct puuids. {@link foldGame} only ever reaches
 * it behind {@link gateRatedGame}; a *printing* surface has no such gate of its own and calls
 * {@link gatedGameAward} instead.
 */
export function gameAward(players: readonly FoldAwardPlayer[], winningSide: SideValue): MvpAce | null {
  return mvpAce(players.map(toPerformancePlayer), winningSide);
}

/**
 * What {@link gameAward} needs, and nothing else: the stat line, the side and the puuid.
 *
 * {@link FoldRatedPlayer} satisfies it, which is how the fold keeps calling the same function
 * with its own row. A surface that reads `game_players` to *print* a result (M7.10) satisfies it
 * too, without carrying the fold's `playerId` through a display type.
 */
export interface FoldAwardPlayer extends FoldGatePlayer, FoldPerformance {}

/**
 * {@link gameAward} behind {@link gateGame}: the MVP and the ACE of a game a **surface** is
 * about to print (M7.10), and `null` for anything that is not a clean ten.
 *
 * One function for both printing surfaces — the Discord result embed and `/p/[puuid]`'s recent
 * games — so acceptance 3 ("the two surfaces cannot disagree about one game") is a fact about
 * there being one call, not two implementations that agree today.
 *
 * It answers the **shape** question only, and its callers answer the other one: both of them
 * reach here only for a game whose ten rows all carry `mu_after`, which is what "the fold rated
 * this" means and is therefore how a remake, a short surrender and an ARAM (M7.1, four null
 * rating columns for ever) all arrive with no award rather than with a wrong one.
 */
export function gatedGameAward<T extends FoldAwardPlayer>(
  players: readonly T[],
  durationS: number,
  winningSide: SideValue,
): MvpAce | null {
  const gate = gateGame(players, durationS);
  return gate.ok ? gameAward(players, winningSide) : null;
}

/** A rename, not a computation: the nine stored numbers and the role, under core's spellings. */
function toPerformancePlayer(player: FoldAwardPlayer): PerformancePlayer {
  return {
    puuid: player.puuid,
    side: player.side,
    role: player.role,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    damageToChamps: player.damageToChamps,
    gold: player.gold,
    cs: player.cs,
    visionScore: player.visionScore,
    damageSelfMitigated: player.damageSelfMitigated,
    damageToObjectives: player.damageToObjectives,
  };
}

function byPuuid(a: FoldGatePlayer, b: FoldGatePlayer): number {
  return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
}

export function mustGet(map: ReadonlyMap<string, Rating>, key: string): Rating {
  const value = map.get(key);
  if (value === undefined) throw new Error(`fold: no rating for player ${key}`);
  return value;
}

function mustIndex(list: readonly Rating[], index: number): Rating {
  const value = list[index];
  if (value === undefined) throw new Error(`fold: core returned no rating at index ${index}`);
  return value;
}

function mustChange(list: readonly RatingChange[], index: number): RatingChange {
  const value = list[index];
  if (value === undefined) throw new Error(`fold: core returned no rating change at index ${index}`);
  return value;
}
