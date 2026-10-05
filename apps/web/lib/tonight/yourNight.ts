import type { RoleValue, SideValue } from '@customs/db';
import { championName } from '../champs/names';
import { inChunks } from '../chunks';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { isRemake } from '../games/remake';
import { type FoldAwardPlayer, gameScores, gatedGameAward, gateGame } from '../ingest/fold';
import type { PublicClient } from '../publicClient';
import { type DeltaPair, sumDisplayDeltas } from '../ratingDisplay';

/**
 * Your night (M14.36): a linked viewer's recap of tonight's games in this group, on Tonight (idle
 * and finished) and as one line on You. One loader for both, so the two can never disagree.
 *
 * Which games count: tonight's games of the group (since the night's 06:00 boundary, the existing
 * rule, so the card goes at 06:00) that the viewer played, and that are either **rated** (every row
 * carries `r_before` and `r_after`, the fold's own mark; a remake or a short surrender is not) or an
 * **ARAM** (never rated, but a game: it counts in wins and losses and says nothing about Rating).
 * Never a remake (300 s or less, ARAM included: no result anywhere) and never a voided game
 * (`void_reason` set, M23.2: ended early or voided by an admin, it does not count).
 *
 * The Rating change is the sum of each rated game's `displayDelta`, the number the poster prints per
 * game, so the card and the posters add up: `sumDisplayDeltas`, the one function the player page's
 * Tonight tile calls too (M14.57). Best game is the viewer's highest M7 performance score
 * (core's `performanceScores`, the MVP's input), ties to the later game. MVP and ACE come from
 * `gatedGameAward`, the one function that names them, on rated games only (the poster's rule).
 */
export interface YourNight {
  wins: number;
  losses: number;
  /** Sum of the rated games' display deltas; `null` when no counted game was rated (ARAM only). */
  ratingDelta: number | null;
  best: { champion: string; kills: number; deaths: number; assists: number } | null;
  mvp: number;
  ace: number;
  /**
   * M15.5: at least one counted game was a Rift game played not rated (a rule's default or the
   * Rated switch, `games.rated = false`). With no rated game, the line says `Not rated, so no
   * Rating change.` instead of the ARAM sentence.
   */
  notRated?: boolean;
}

export interface YourNightRow {
  player_id: string;
  side: number | null;
  role: RoleValue | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  gold: number | null;
  cs: number | null;
  vision_score: number | null;
  damage_self_mitigated: number | null;
  damage_to_objectives: number | null;
  damage_to_champs: number | null;
  champion_id: number | null;
  r_before: number | null;
  r_after: number | null;
}

export interface YourNightGame {
  id: string;
  started_at: string;
  duration_s: number;
  winning_side: number | null;
  gameMode: unknown;
  /** `games.rated` (M15.3, `0032`); absent in older fixtures, read as rated. */
  rated?: boolean | null;
  /** `games.void_reason` (M23.1, `0052`): `early-end` or `admin`; absent in older fixtures, not voided. */
  void_reason?: string | null;
  game_players: readonly YourNightRow[];
}

/** The fold, pure: games in, the recap out (`null` when the viewer has no counted game tonight). */
export function foldYourNight(
  games: readonly YourNightGame[],
  viewerPlayerId: string,
  puuidOf: ReadonlyMap<string, string>,
  /** The night's 06:00 boundary (`tonightStart(now)`): a game before it is last night's. */
  nightStart?: Date,
): YourNight | null {
  const from = nightStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  const ordered = [...games]
    .filter((game) => Date.parse(game.started_at) >= from)
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || (a.id < b.id ? -1 : 1));
  let wins = 0;
  let losses = 0;
  const rated: DeltaPair[] = [];
  let bestScore = -1;
  let best: YourNight['best'] = null;
  let mvp = 0;
  let ace = 0;
  let notRated = false;

  for (const game of ordered) {
    if (game.winning_side !== 100 && game.winning_side !== 200) continue;
    if (game.void_reason != null || isRemake(game.duration_s)) continue;
    const me = game.game_players.find((row) => row.player_id === viewerPlayerId);
    if (me === undefined || (me.side !== 100 && me.side !== 200)) continue;
    const aram = matchesQueue(gameModeFromRaw({ gameMode: game.gameMode }), 'aram');
    const rows = game.game_players;
    const isRated =
      !aram && rows.length > 0 && rows.every((row) => row.r_before !== null && row.r_after !== null);
    // M15.5 (R4): a Rift game played not rated still counts in wins and losses, like an ARAM.
    const notRatedRift = !aram && game.rated === false;
    if (!aram && !isRated && !notRatedRift) continue;
    if (notRatedRift) notRated = true;

    if (me.side === game.winning_side) wins += 1;
    else losses += 1;

    if (isRated && me.r_before !== null && me.r_after !== null) {
      rated.push({ rBefore: me.r_before, rAfter: me.r_after });
    }

    const ten = awardPlayers(rows, puuidOf);
    const myPuuid = puuidOf.get(viewerPlayerId);
    if (ten !== null && myPuuid !== undefined && gateGame(ten, game.duration_s).ok) {
      const scores = gameScores(ten);
      const mine = scores?.find((one) => one.puuid === myPuuid);
      if (mine !== undefined && mine.score >= bestScore && me.champion_id !== null) {
        bestScore = mine.score;
        best = {
          champion: championName(me.champion_id),
          kills: me.kills ?? 0,
          deaths: me.deaths ?? 0,
          assists: me.assists ?? 0,
        };
      }
      if (isRated) {
        const award = gatedGameAward(ten, game.duration_s, game.winning_side as SideValue);
        if (award?.mvp === myPuuid) mvp += 1;
        if (award?.ace === myPuuid) ace += 1;
      }
    }
  }

  if (wins + losses === 0) return null;
  return {
    wins,
    losses,
    ratingDelta: sumDisplayDeltas(rated),
    best,
    mvp,
    ace,
    ...(notRated ? { notRated } : {}),
  };
}

function awardPlayers(
  rows: readonly YourNightRow[],
  puuidOf: ReadonlyMap<string, string>,
): FoldAwardPlayer[] | null {
  const ten: FoldAwardPlayer[] = [];
  for (const row of rows) {
    const puuid = puuidOf.get(row.player_id);
    if (puuid === undefined || (row.side !== 100 && row.side !== 200)) return null;
    ten.push({
      puuid,
      side: row.side,
      role: row.role,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      damageToChamps: row.damage_to_champs,
      gold: row.gold,
      cs: row.cs,
      visionScore: row.vision_score,
      damageSelfMitigated: row.damage_self_mitigated,
      damageToObjectives: row.damage_to_objectives,
    });
  }
  return ten;
}

const COLUMNS =
  'id, started_at, duration_s, winning_side, rated, void_reason, gameMode:game_mode, game_players(player_id, side, role, kills, deaths, assists, gold, cs, vision_score, damage_self_mitigated, damage_to_objectives, damage_to_champs, champion_id, r_before, r_after)';

/** PostgREST's `max_rows`: one page of the night's games. */
const PAGE = 1_000;

/** The viewer's night in this group, or `null` (no counted game, or a failed read: the card is absent). */
export async function loadYourNightOrNone(
  client: PublicClient,
  options: { groupId: string; nightStart: Date; puuid: string },
): Promise<YourNight | null> {
  try {
    const { data: me, error: meError } = await client
      .from('players_public')
      .select('id')
      .eq('puuid', options.puuid)
      .maybeSingle();
    if (meError) throw new Error(meError.message);
    if (me?.id == null) return null;

    // Paged: PostgREST cuts a response at `max_rows` (1000) without saying so. `id` breaks ties so
    // pages neither overlap nor skip; one page is every real night.
    const games: YourNightGame[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('games')
        .select(COLUMNS)
        .eq('group_id', options.groupId)
        .gte('started_at', options.nightStart.toISOString())
        .in('winning_side', [100, 200])
        .order('started_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      games.push(...((data ?? []) as unknown as YourNightGame[]));
      if ((data ?? []).length < PAGE) break;
    }
    if (!games.some((game) => game.game_players.some((row) => row.player_id === me.id))) return null;

    const ids = [...new Set(games.flatMap((game) => game.game_players.map((row) => row.player_id)))];
    // Chunked, every chunk at once: a long `in` list is a `414 URI too long`.
    const pages = await Promise.all(
      inChunks(ids).map(async (chunk) => {
        const { data: players, error: playersError } = await client
          .from('players_public')
          .select('id, puuid')
          .in('id', chunk);
        if (playersError) throw new Error(playersError.message);
        return players ?? [];
      }),
    );
    const puuidOf = new Map<string, string>();
    for (const row of pages.flat()) if (row.id !== null && row.puuid !== null) puuidOf.set(row.id, row.puuid);

    return foldYourNight(games, me.id, puuidOf, options.nightStart);
  } catch (error) {
    console.error('tonight: reading your night failed', error);
    return null;
  }
}
