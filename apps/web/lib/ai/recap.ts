import 'server-only';
import { discordRecapText } from '../discord/aiEdit';
import { type AiGate, aiGateOpen, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import { renderWebName } from '../tonight/copy';
import { gameLineEligibility } from './eligibility';
import { readGameMeta } from './facts';
import { dbLineStore, loadShownLine, type ShownLine } from './store';

/**
 * The game recap line's reads (M16.4): what Tonight's poster and the game page show, what the
 * Discord edit prints, and the admin's budget line. Every one goes through `loadShownLine` and so
 * `renderLine` (fail closed: not Premium, AI lines off, not published, hidden, an opted-out player
 * named, an unknown name -- all are "no line"). None of them ever generates.
 */

/** What a surface draws: the line, or nothing yet but the page should look again soon. */
export type GameRecapView =
  | { kind: 'line'; lineId: string; text: string }
  /** No line yet, and one may still land (live game, gate open, inside the 15-minute window). */
  | { kind: 'waiting' };

/** `players.id` -> the raw stored name, for the players of one game. */
export async function readGameNames(
  service: ServiceClient,
  gameId: string,
): Promise<Map<string, string | null>> {
  const { data: seats, error } = await service.from('game_players').select('player_id').eq('game_id', gameId);
  if (error) throw new Error(`ai recap: seat read failed: ${error.message}`);
  const ids = [...new Set((seats ?? []).map((row) => row.player_id))];
  const names = new Map<string, string | null>();
  if (ids.length === 0) return names;
  const { data, error: playersError } = await service
    .from('players')
    .select('id, display_name, game_name')
    .in('id', ids);
  if (playersError) throw new Error(`ai recap: name read failed: ${playersError.message}`);
  for (const row of data ?? []) names.set(row.id, row.display_name ?? row.game_name ?? null);
  return names;
}

/**
 * The recap for one game on the site, or null for "draw nothing, exactly like a group without
 * Premium". Never throws: a failed read is no line (brief 4.6).
 */
export async function loadGameRecap(
  service: ServiceClient,
  input: { groupId: string; gameId: string; now: Date; gate?: AiGate | null },
): Promise<GameRecapView | null> {
  try {
    const gate = input.gate === undefined ? await readAiGate(service, input.groupId) : input.gate;
    if (!aiGateOpen(gate)) return null;
    const names = await readGameNames(service, input.gameId);
    const shown = await loadShownLine(service, {
      groupId: input.groupId,
      subject: { kind: 'game', gameId: input.gameId },
      // The name the rest of the site prints for that player (tokens stored, so a rename shows).
      nameOf: (playerId) => (names.has(playerId) ? renderWebName(names.get(playerId) ?? null) : null),
      gate,
    });
    if (shown !== null) return { kind: 'line', lineId: shown.lineId, text: shown.text };
    return (await mayStillLand(service, input.groupId, input.gameId, gate, input.now))
      ? { kind: 'waiting' }
      : null;
  } catch (error) {
    console.error('ai recap: no recap shown', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

/** No row yet (or one being written) for a game that may still get one. */
async function mayStillLand(
  service: ServiceClient,
  groupId: string,
  gameId: string,
  gate: AiGate,
  now: Date,
): Promise<boolean> {
  if (!gameLineEligibility(await readGameMeta(service, groupId, gameId), gate, now).ok) return false;
  const row = await dbLineStore(service).read(groupId, 'game', gameId);
  return row === null || row.status === 'pending' || row.status === 'failed';
}

/** As {@link loadGameRecap}, swallowing everything into null (pages call this). */
export async function loadGameRecapOrNone(
  service: () => ServiceClient,
  input: { groupId: string; gameId: string; now: Date },
): Promise<GameRecapView | null> {
  try {
    return await loadGameRecap(service(), input);
  } catch (error) {
    console.error('ai recap: no recap shown', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

/**
 * The line as the Discord edit prints it: names escaped like every name Kustom posts, the rest
 * escaped, or null. Read through the same `loadShownLine`, so a hidden line, an opted-out player
 * or a group switched off never reaches Discord either. Never throws.
 */
export async function loadDiscordRecap(
  service: ServiceClient,
  input: { groupId: string; gameId: string },
): Promise<string | null> {
  try {
    const names = await readGameNames(service, input.gameId);
    const slots: (string | null)[] = [];
    const shown: ShownLine | null = await loadShownLine(service, {
      groupId: input.groupId,
      subject: { kind: 'game', gameId: input.gameId },
      nameOf: (playerId) => {
        if (!names.has(playerId)) return null;
        slots.push(names.get(playerId) ?? null);
        return `\u0000${slots.length - 1}\u0000`;
      },
    });
    return shown === null ? null : discordRecapText(shown.text, slots);
  } catch (error) {
    console.error('ai recap: no Discord recap', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}
