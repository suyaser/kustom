import 'server-only';
import { type ClosedWindow, civilDayKey, closedWindow } from '../night';
import { type AiGate, aiGateOpen, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import { renderWebName } from '../tonight/copy';
import { dbLineStore, loadShownLine } from './store';

/**
 * The weekly storyline's read side (M16.5), apart from its generator so the board never loads the
 * model client (M16.6 code review). Imports nothing from `generate`, `client` or `afterIngest`.
 */

/** `2026-09-27`: the closed week's Sunday on the group clock, the line's subject. */
export function weekStartDay(window: Pick<ClosedWindow, 'start'>, timeZone: string): string {
  return civilDayKey(window.start, timeZone);
}

/** `players.id` -> the raw stored name, for the players a stored week line maps. */
export async function readLineNames(
  service: ServiceClient,
  groupId: string,
  weekStart: string,
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const row = await dbLineStore(service).read(groupId, 'week', weekStart);
  if (row === null || row.status !== 'published') return names;
  const ids = [...new Set(Object.values(row.token_map))];
  if (ids.length === 0) return names;
  const { data, error } = await service.from('players').select('id, display_name, game_name').in('id', ids);
  if (error) throw new Error(`ai storyline: name read failed: ${error.message}`);
  for (const player of data ?? []) names.set(player.id, player.display_name ?? player.game_name ?? null);
  return names;
}

/** What the board's Last week draws: the line and its id (for the admin's Hide). */
export interface BoardStoryline {
  lineId: string;
  text: string;
}

/**
 * The storyline for the board's **Last week** (the most recently closed week on the group clock),
 * or null for "draw nothing, exactly like a group without Premium". Read only: never generates.
 * Never throws.
 */
export async function loadBoardStoryline(
  service: ServiceClient,
  input: { groupId: string; now: Date; timeZone: string; gate?: AiGate | null },
): Promise<BoardStoryline | null> {
  try {
    const gate = input.gate === undefined ? await readAiGate(service, input.groupId) : input.gate;
    if (!aiGateOpen(gate)) return null;
    const weekStart = weekStartDay(closedWindow('last-week', input.now, input.timeZone), input.timeZone);
    const names = await readLineNames(service, input.groupId, weekStart);
    const shown = await loadShownLine(service, {
      groupId: input.groupId,
      subject: { kind: 'week', weekStart },
      nameOf: (playerId) => (names.has(playerId) ? renderWebName(names.get(playerId) ?? null) : null),
      gate,
    });
    return shown === null ? null : { lineId: shown.lineId, text: shown.text };
  } catch (error) {
    console.error(
      'ai storyline: none on the board',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

/** As {@link loadBoardStoryline}, with the service client made lazily (pages call this). */
export async function loadBoardStorylineOrNone(
  service: () => ServiceClient,
  input: { groupId: string; now: Date; timeZone: string },
): Promise<BoardStoryline | null> {
  try {
    return await loadBoardStoryline(service(), input);
  } catch (error) {
    console.error(
      'ai storyline: none on the board',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}
