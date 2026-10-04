import type { LockedMode, ModeState } from '@customs/core';
import type { LobbyStatusValue } from '@customs/db';
import { ruleCheckSchema, ruleModeOf } from '@customs/db/schemas';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { MIN_RATED_DURATION_S } from '../lobbyRules';
import type { PublicClient } from '../publicClient';
import { loadCheckNames } from './clientNames';
import { readGroupModeRow } from './load';
import { lockFromRow } from './lock';
import { stateFromRow } from './state';
import type { GameStampView } from './types';

/**
 * Tonight's reads of the Mode card's M15 facts (M15.5), with the anon key: `0032` grants anon the
 * card state on `group_modes`, the lock on `lobbies` and the stamp on `games`. Each read is its
 * own query and **never throws**: a failure logs and answers "nothing" (no pending rule, no lock,
 * no stamp), so a page never 500s over a rule and a database one migration behind still renders.
 */

export async function loadModeState(client: PublicClient, groupId: string): Promise<ModeState | null> {
  // The same row the fearless pool reads, once per render (`readGroupModeRow`).
  const { data, error } = await readGroupModeRow(client, groupId);
  if (error) {
    console.error('mode: reading the card state failed', error.message);
    return null;
  }
  return data === null ? null : stateFromRow(data);
}

export async function loadLobbyLock(client: PublicClient, lobbyId: string): Promise<LockedMode | null> {
  const { data, error } = await client
    .from('lobbies')
    .select(
      'lock_mode, lock_rule, lock_class_tag, lock_region_blue, lock_region_red, lock_rated, lock_version',
    )
    .eq('id', lobbyId)
    .maybeSingle();
  if (error) {
    console.error('mode: reading the lobby lock failed', error.message);
    return null;
  }
  return data === null ? null : (lockFromRow(data)?.lock ?? null);
}

/**
 * Tonight's newest lobby (the one Tonight draws) with its status and lock, for the mode panel,
 * which shows what the card shows without reading the whole night. Null with none or on failure.
 */
export async function loadTonightLobbyLock(
  client: PublicClient,
  groupId: string,
  nightStart: Date,
): Promise<{ status: LobbyStatusValue; lock: LockedMode | null } | null> {
  const { data, error } = await client
    .from('lobbies')
    .select(
      'status, lock_mode, lock_rule, lock_class_tag, lock_region_blue, lock_region_red, lock_rated, lock_version',
    )
    .eq('group_id', groupId)
    .gte('created_at', nightStart.toISOString())
    .neq('status', 'abandoned')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('mode: reading tonight lobby lock failed', error.message);
    return null;
  }
  return data === null ? null : { status: data.status, lock: lockFromRow(data)?.lock ?? null };
}

export async function loadGameStamp(client: PublicClient, gameId: string): Promise<GameStampView | null> {
  const { data, error } = await client
    .from('games')
    .select(
      'duration_s, raw->gameMode, rule, rule_class_tag, rule_region_blue, rule_region_red, rated, rule_checked, rule_check',
    )
    .eq('id', gameId)
    .maybeSingle();
  if (error) {
    console.error('mode: reading the game stamp failed', error.message);
    return null;
  }
  if (data === null) return null;
  const mode = ruleModeOf({
    rule: data.rule,
    classTag: data.rule_class_tag,
    regionBlue: data.rule_region_blue,
    regionRed: data.rule_region_red,
  });
  const check = data.rule_checked ? ruleCheckSchema.safeParse(data.rule_check) : null;
  if (check !== null && !check.success) console.error('mode: a stored rule check did not parse', gameId);
  const stored = check?.success ? check.data : null;
  const names = await loadCheckNames(client, gameId, stored);
  return {
    rule: mode,
    rated: data.rated,
    // ARAM and remakes are never rated anyway, and say nothing about it (the existing rule).
    rift:
      matchesQueue(gameModeFromRaw({ gameMode: data.gameMode }), 'sr') &&
      data.duration_s > MIN_RATED_DURATION_S,
    check: stored,
    ...(Object.keys(names).length === 0 ? {} : { names }),
  };
}

/** `games.created_at` of the group's newest game: when the last game landed, or null. */
export async function loadLastGameAt(client: PublicClient, groupId: string): Promise<string | null> {
  const { data, error } = await client
    .from('games')
    .select('created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('mode: reading the last game time failed', error.message);
    return null;
  }
  return data?.created_at ?? null;
}
