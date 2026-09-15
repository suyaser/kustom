import type { DailyMysteryAttemptRow, DailyMysteryRow, RoleValue } from '@customs/db';
import { mysteryClueTypeSchema } from '@customs/db/schemas';
import { championName } from '../champs/names';
import { inChunks } from '../chunks';
import { formatDamage, formatDuration } from '../discord/embeds';
import { formatDayMonth, nextCivilMidnight } from '../night';
import { rawFactsFromUnknown } from '../stats/rawFacts';
import type { ServiceClient } from '../supabase';
import { clueView } from './clues';
import { kdaLine } from './copy';
import { ensureTodayMystery, parseStoredHook } from './ensure';
import { mysteryPlayerName } from './names';
import { type AttemptStat, buildCommunity, percentileBucket, rankAmongCorrect } from './stats';
import type {
  ChallengeCategory,
  MysteryClueView,
  MysteryEmptyView,
  MysteryKind,
  MysteryPerformance,
  MysteryPlayView,
  MysteryPublicHook,
  MysteryResultView,
  MysterySuspect,
} from './types';

const RATE_GAP_MS = 300;
const RATE_MAX_REQUESTS = 80;
const DEFAULT_HOOK: MysteryPublicHook = {
  kills: 0,
  deaths: 0,
  assists: 0,
  kda: '0 / 0 / 0',
  durationS: 0,
  durationLabel: '0:00',
  lines: [],
};

/**
 * Which game a stored row is. The column is text and this is the one place it becomes a
 * union: anything else — a row from a future kind, a hand-edited value — reads as a Daily
 * Mystery rather than throwing a card off the home page.
 */
function kindOf(value: string): MysteryKind {
  return value === 'award' ? 'award' : 'mystery';
}

export type MysteryPageState =
  | { kind: 'empty'; empty: MysteryEmptyView }
  | { kind: 'play'; play: MysteryPlayView }
  | { kind: 'closed'; result: MysteryResultView };

export function emptyMysteryPage(now: Date, timeZone: string): MysteryPageState {
  return {
    kind: 'empty',
    empty: { empty: true, expiresAt: nextCivilMidnight(now, timeZone).toISOString() },
  };
}

export async function loadMysteryPage(
  client: ServiceClient,
  options: { now: Date; timeZone: string; visitorId: string | null },
): Promise<MysteryPageState> {
  const row = await ensureTodayMystery(client, options.now, options.timeZone);
  if (row === null) return emptyMysteryPage(options.now, options.timeZone);
  if (options.visitorId !== null) {
    const attempt = await loadAttempt(client, row.id, options.visitorId);
    if (attempt !== null) {
      return {
        kind: 'closed',
        result: await buildResult(client, row, attempt, options.visitorId, options.timeZone),
      };
    }
    await touchSession(client, row.id, options.visitorId, options.now, { increment: false });
  }
  return { kind: 'play', play: await buildPlay(client, row, options.visitorId) };
}

export async function revealNextClue(
  client: ServiceClient,
  options: { challengeId: string; visitorId: string; now: Date },
): Promise<
  | { clue: MysteryClueView | null; cluesRevealed: number; clueCount: number }
  | { error: string; status: number }
> {
  const row = await loadChallenge(client, options.challengeId);
  if (row === null) return { error: 'challenge not found', status: 404 };
  if (new Date(row.expires_at).getTime() <= options.now.getTime()) {
    return { error: "today's mystery has expired", status: 410 };
  }
  const existing = await loadAttempt(client, row.id, options.visitorId);
  if (existing !== null) return { error: 'this visitor has already locked a guess', status: 409 };

  const limited = await touchSession(client, row.id, options.visitorId, options.now, { increment: true });
  if (!limited.ok) return limited;

  const clues = await loadClues(client, row.id);
  const nextOrder = limited.cluesRevealed + 1;
  const next = clues.find((clue) => clue.order === nextOrder) ?? null;
  const cluesRevealed = next === null ? limited.cluesRevealed : nextOrder;
  if (next !== null) {
    const { error } = await client
      .from('daily_mystery_sessions')
      .update({ clues_revealed: cluesRevealed, last_request_at: options.now.toISOString() })
      .eq('challenge_id', row.id)
      .eq('visitor_id', options.visitorId);
    if (error) throw new Error(`daily mystery: failed to reveal clue: ${error.message}`);
  }
  return { clue: next, cluesRevealed, clueCount: clues.length };
}

export async function submitGuess(
  client: ServiceClient,
  options: {
    challengeId: string;
    visitorId: string;
    playerId: string;
    now: Date;
    timeZone: string;
  },
): Promise<{ result: MysteryResultView } | { error: string; status: number }> {
  const row = await loadChallenge(client, options.challengeId);
  if (row === null) return { error: 'challenge not found', status: 404 };
  if (new Date(row.expires_at).getTime() <= options.now.getTime()) {
    return { error: "today's mystery has expired", status: 410 };
  }
  if (!row.suspect_ids.includes(options.playerId)) {
    return { error: "that player is not one of today's suspects", status: 400 };
  }

  const already = await loadAttempt(client, row.id, options.visitorId);
  if (already !== null) {
    return { result: await buildResult(client, row, already, options.visitorId, options.timeZone) };
  }

  const limited = await touchSession(client, row.id, options.visitorId, options.now, { increment: true });
  if (!limited.ok) return limited;

  const startedAt = new Date(limited.startedAt).getTime();
  const completionTimeMs = Math.max(0, options.now.getTime() - startedAt);
  const correct = options.playerId === row.mystery_player_id;

  const { data: inserted, error } = await client
    .from('daily_mystery_attempts')
    .insert({
      challenge_id: row.id,
      visitor_id: options.visitorId,
      guessed_player_id: options.playerId,
      correct,
      clues_used: limited.cluesRevealed,
      completion_time_ms: completionTimeMs,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      const raced = await loadAttempt(client, row.id, options.visitorId);
      if (raced !== null) {
        return { result: await buildResult(client, row, raced, options.visitorId, options.timeZone) };
      }
    }
    throw new Error(`daily mystery: failed to lock guess: ${error.message}`);
  }

  let claimedFirst = false;
  if (correct) {
    const { data: claimed } = await client
      .from('daily_mysteries')
      .update({ first_correct_at: options.now.toISOString() })
      .eq('id', row.id)
      .is('first_correct_at', null)
      .select('id')
      .maybeSingle();
    claimedFirst = claimed !== null;
  }

  const fresh = (await loadChallenge(client, row.id)) ?? row;
  return {
    result: await buildResult(client, fresh, inserted, options.visitorId, options.timeZone, claimedFirst),
  };
}

export async function loadResultForVisitor(
  client: ServiceClient,
  options: { challengeId: string; visitorId: string; timeZone: string },
): Promise<{ result: MysteryResultView } | { error: string; status: number }> {
  const row = await loadChallenge(client, options.challengeId);
  if (row === null) return { error: 'challenge not found', status: 404 };
  const attempt = await loadAttempt(client, row.id, options.visitorId);
  if (attempt === null) return { error: 'this visitor has not locked a guess', status: 403 };
  return { result: await buildResult(client, row, attempt, options.visitorId, options.timeZone) };
}

async function loadChallenge(client: ServiceClient, id: string): Promise<DailyMysteryRow | null> {
  const { data, error } = await client.from('daily_mysteries').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`daily mystery: failed to read challenge: ${error.message}`);
  return data;
}

async function loadAttempt(
  client: ServiceClient,
  challengeId: string,
  visitorId: string,
): Promise<DailyMysteryAttemptRow | null> {
  const { data, error } = await client
    .from('daily_mystery_attempts')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('visitor_id', visitorId)
    .maybeSingle();
  if (error) throw new Error(`daily mystery: failed to read attempt: ${error.message}`);
  return data;
}

async function loadClues(client: ServiceClient, challengeId: string): Promise<MysteryClueView[]> {
  const { data, error } = await client
    .from('daily_mystery_clues')
    .select('clue_type, clue_value, reveal_order')
    .eq('challenge_id', challengeId)
    .order('reveal_order', { ascending: true });
  if (error) throw new Error(`daily mystery: failed to read clues: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    const type = mysteryClueTypeSchema.safeParse(row.clue_type);
    if (!type.success) return [];
    return [clueView({ type: type.data, value: row.clue_value, revealOrder: row.reveal_order })];
  });
}

async function touchSession(
  client: ServiceClient,
  challengeId: string,
  visitorId: string,
  now: Date,
  options: { increment: boolean },
): Promise<
  { ok: true; cluesRevealed: number; startedAt: string } | { ok: false; error: string; status: number }
> {
  const { data: existing } = await client
    .from('daily_mystery_sessions')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('visitor_id', visitorId)
    .maybeSingle();

  if (existing === null) {
    const { error } = await client.from('daily_mystery_sessions').insert({
      challenge_id: challengeId,
      visitor_id: visitorId,
      clues_revealed: 0,
      started_at: now.toISOString(),
      last_request_at: now.toISOString(),
      request_count: 1,
    });
    if (error && error.code !== '23505') {
      throw new Error(`daily mystery: failed to open session: ${error.message}`);
    }
    return { ok: true, cluesRevealed: 0, startedAt: now.toISOString() };
  }

  const elapsed = now.getTime() - new Date(existing.last_request_at).getTime();
  if (options.increment && elapsed < RATE_GAP_MS) {
    return { ok: false, error: 'too many requests', status: 429 };
  }
  if (existing.request_count >= RATE_MAX_REQUESTS) {
    return { ok: false, error: 'too many requests', status: 429 };
  }

  if (options.increment) {
    const { error } = await client
      .from('daily_mystery_sessions')
      .update({
        last_request_at: now.toISOString(),
        request_count: existing.request_count + 1,
      })
      .eq('challenge_id', challengeId)
      .eq('visitor_id', visitorId);
    if (error) throw new Error(`daily mystery: failed to touch session: ${error.message}`);
  }

  return { ok: true, cluesRevealed: existing.clues_revealed, startedAt: existing.started_at };
}

async function buildPlay(
  client: ServiceClient,
  row: DailyMysteryRow,
  visitorId: string | null,
): Promise<MysteryPlayView> {
  const [suspects, clues, session] = await Promise.all([
    loadSuspects(client, row.suspect_ids),
    loadClues(client, row.id),
    visitorId === null
      ? Promise.resolve(null)
      : client
          .from('daily_mystery_sessions')
          .select('clues_revealed')
          .eq('challenge_id', row.id)
          .eq('visitor_id', visitorId)
          .maybeSingle()
          .then((result) => result.data),
  ]);
  const cluesRevealed = session?.clues_revealed ?? 0;
  return {
    challengeId: row.id,
    challengeNumber: row.challenge_number,
    day: row.day,
    kind: kindOf(row.kind),
    category: row.category as ChallengeCategory,
    expiresAt: row.expires_at,
    hook: parseStoredHook(row.hook) ?? DEFAULT_HOOK,
    suspects,
    cluesRevealed,
    revealedClues: clues.filter((clue) => clue.order <= cluesRevealed),
    clueCount: clues.length,
    completed: false,
  };
}

async function buildResult(
  client: ServiceClient,
  row: DailyMysteryRow,
  attempt: DailyMysteryAttemptRow,
  visitorId: string,
  timeZone: string,
  claimedFirst?: boolean,
): Promise<MysteryResultView> {
  const suspects = await loadSuspects(client, row.suspect_ids);
  const [clues, attempts, performance] = await Promise.all([
    loadClues(client, row.id),
    loadAttemptStats(client, row.id, suspects),
    loadPerformance(client, row, timeZone),
  ]);
  const names = new Map(suspects.map((suspect) => [suspect.playerId, suspect.name]));
  const actualName = names.get(row.mystery_player_id) ?? (await nameOf(client, row.mystery_player_id));
  const guessedName =
    names.get(attempt.guessed_player_id) ?? (await nameOf(client, attempt.guessed_player_id));
  const correctRows = attempts.filter((row) => row.correct);
  const me: AttemptStat = {
    visitorId,
    guessedPlayerId: attempt.guessed_player_id,
    guessedName,
    correct: attempt.correct,
    cluesUsed: attempt.clues_used,
    completionTimeMs: attempt.completion_time_ms,
  };
  const firstDetective =
    claimedFirst === true ||
    (claimedFirst === undefined &&
      attempt.correct &&
      (await isFirstCorrectAttempt(client, row.id, attempt.id)));

  return {
    challengeId: row.id,
    challengeNumber: row.challenge_number,
    day: row.day,
    kind: kindOf(row.kind),
    category: row.category as ChallengeCategory,
    expiresAt: row.expires_at,
    hook: parseStoredHook(row.hook) ?? DEFAULT_HOOK,
    suspects,
    revealedClues: clues.filter((clue) => clue.order <= attempt.clues_used),
    clueCount: clues.length,
    performance,
    personal: {
      guessedPlayerId: attempt.guessed_player_id,
      guessedName,
      actualPlayerId: row.mystery_player_id,
      actualName,
      correct: attempt.correct,
      cluesUsed: attempt.clues_used,
      completionTimeMs: attempt.completion_time_ms,
      firstDetective: Boolean(firstDetective),
      percentile: attempt.correct
        ? percentileBucket(rankAmongCorrect(me, correctRows), correctRows.length)
        : null,
    },
    community: buildCommunity(attempts, row.first_correct_at !== null),
  };
}

async function isFirstCorrectAttempt(
  client: ServiceClient,
  challengeId: string,
  attemptId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('daily_mystery_attempts')
    .select('id')
    .eq('challenge_id', challengeId)
    .eq('correct', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`daily mystery: failed to read first correct: ${error.message}`);
  return data?.id === attemptId;
}

async function loadSuspects(client: ServiceClient, ids: string[]): Promise<MysterySuspect[]> {
  const names = new Map<string, string>();
  for (const chunk of inChunks(ids)) {
    const { data, error } = await client
      .from('players_public')
      .select('id, display_name, game_name')
      .in('id', chunk);
    if (error) throw new Error(`daily mystery: failed to read suspects: ${error.message}`);
    for (const row of data ?? []) {
      if (row.id === null) continue;
      names.set(row.id, mysteryPlayerName(row));
    }
  }
  return ids.map((playerId) => ({ playerId, name: names.get(playerId) ?? 'Someone' }));
}

async function nameOf(client: ServiceClient, playerId: string): Promise<string> {
  const { data } = await client
    .from('players_public')
    .select('display_name, game_name')
    .eq('id', playerId)
    .maybeSingle();
  return data === null ? 'Someone' : mysteryPlayerName(data);
}

async function loadAttemptStats(
  client: ServiceClient,
  challengeId: string,
  suspects: MysterySuspect[],
): Promise<AttemptStat[]> {
  const names = new Map(suspects.map((suspect) => [suspect.playerId, suspect.name]));
  const { data, error } = await client
    .from('daily_mystery_attempts')
    .select('visitor_id, guessed_player_id, correct, clues_used, completion_time_ms')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(`daily mystery: failed to read attempts: ${error.message}`);
  return (data ?? []).map((row) => ({
    visitorId: row.visitor_id,
    guessedPlayerId: row.guessed_player_id,
    guessedName: names.get(row.guessed_player_id) ?? 'Someone',
    correct: row.correct,
    cluesUsed: row.clues_used,
    completionTimeMs: row.completion_time_ms,
  }));
}

async function loadPerformance(
  client: ServiceClient,
  row: DailyMysteryRow,
  timeZone: string,
): Promise<MysteryPerformance> {
  const { data: game, error: gameError } = await client
    .from('games')
    .select('started_at, duration_s, winning_side, raw')
    .eq('id', row.game_id)
    .maybeSingle();
  if (gameError) throw new Error(`daily mystery: failed to read game: ${gameError.message}`);
  const { data: seat, error: seatError } = await client
    .from('game_players')
    .select(
      'side, role, champion_id, kills, deaths, assists, gold, damage_to_champs, cs, player_id, vision_score, damage_self_mitigated, damage_to_objectives',
    )
    .eq('game_id', row.game_id)
    .eq('player_id', row.mystery_player_id)
    .maybeSingle();
  if (seatError) throw new Error(`daily mystery: failed to read seat: ${seatError.message}`);

  const { data: identity } = await client
    .from('players_public')
    .select('puuid')
    .eq('id', row.mystery_player_id)
    .maybeSingle();
  const raw = rawFactsFromUnknown(game?.raw);
  const facts = identity?.puuid ? raw.byPuuid[identity.puuid] : undefined;
  const kills = seat?.kills ?? 0;
  const deaths = seat?.deaths ?? 0;
  const assists = seat?.assists ?? 0;
  const damage = seat?.damage_to_champs ?? 0;
  const durationS = game?.duration_s ?? 0;
  const damageTaken = facts?.damageTaken ?? null;
  return {
    kills,
    deaths,
    assists,
    kda: kdaLine(kills, deaths, assists),
    champion: facts?.championName ?? (seat?.champion_id == null ? null : championName(seat.champion_id)),
    role: (seat?.role ?? facts?.role ?? null) as RoleValue | null,
    damage,
    damageLabel: formatDamage(damage),
    cs: seat?.cs ?? 0,
    gold: seat?.gold ?? 0,
    goldLabel: formatDamage(seat?.gold ?? 0),
    damageTaken,
    damageTakenLabel: damageTaken === null ? null : formatDamage(damageTaken),
    // The column first, the blob second, null when neither said — the reveal of an award day
    // is about one of these three, and a made-up zero would be a lie about a tank.
    visionScore: seat?.vision_score ?? facts?.visionScore ?? null,
    damageSelfMitigated: seat?.damage_self_mitigated ?? facts?.damageSelfMitigated ?? null,
    damageToObjectives: seat?.damage_to_objectives ?? facts?.damageToObjectives ?? null,
    durationS,
    durationLabel: formatDuration(durationS),
    won: game !== null && seat !== null && game.winning_side === seat.side,
    startedLabel: game === null ? '' : formatDayMonth(new Date(game.started_at), timeZone),
  };
}
