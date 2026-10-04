import 'server-only';
import { formatDayMonth, formatDayName } from '../night';
import { type AiGate, aiGateOpen, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import { renderWebName } from '../tonight/copy';
import { renderLine } from './check';
import { scoutingWrittenLine } from './recapCopy';
import { readOptedOut } from './store';

/**
 * The scouting report's page read (M16.6), apart from its generator so a page that shows a report
 * never loads the model client (code review): this file imports nothing from `generate`, `client`
 * or `afterIngest` (`readOnly.test.ts` walks the import graph of every page that reads a line).
 */

/** What the player page draws under the header block. */
export interface PlayerScouting {
  lineId: string;
  text: string;
  /** `Written Sunday 4 Oct` [NEW COPY per brief 1.2]. */
  written: string;
}

/**
 * The player's newest report on the page, or null for "draw nothing, exactly like a group without
 * Premium". Newest by week: a published one shows, a hidden one hides the report for everyone
 * (never falls back to an older week), a rejected or failed newest leaves the last good one. Read
 * only: never generates. Never throws.
 */
export async function loadPlayerScouting(
  service: ServiceClient,
  input: { groupId: string; puuid: string; timeZone: string; gate?: AiGate | null },
): Promise<PlayerScouting | null> {
  try {
    const gate = input.gate === undefined ? await readAiGate(service, input.groupId) : input.gate;
    if (!aiGateOpen(gate)) return null;
    const { data: player, error: playerError } = await service
      .from('players')
      .select('id, display_name, game_name')
      .eq('puuid', input.puuid)
      .maybeSingle();
    if (playerError) throw new Error(playerError.message);
    if (player === null) return null;
    const { data: rows, error } = await service
      .from('ai_lines')
      .select('id, status, text, token_map, published_at, week_start')
      .eq('group_id', input.groupId)
      .eq('kind', 'player')
      .eq('player_id', player.id)
      .in('status', ['published', 'hidden'])
      .order('week_start', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = rows?.[0];
    if (row === undefined || row.status !== 'published' || row.published_at === null) return null;
    const optedOut = await readOptedOut(service, input.groupId);
    const tokenMap = row.token_map as Record<string, string>;
    // M16.19: a report may name a second player (the duo partner): read every name it maps.
    const names = new Map<string, string>([
      [player.id, renderWebName(player.display_name ?? player.game_name ?? null)],
    ]);
    const others = Object.values(tokenMap).filter((id) => id !== player.id);
    if (others.length > 0) {
      const { data: more, error: moreError } = await service
        .from('players')
        .select('id, display_name, game_name')
        .in('id', others);
      if (moreError) throw new Error(moreError.message);
      for (const other of more ?? [])
        names.set(other.id, renderWebName(other.display_name ?? other.game_name ?? null));
    }
    const text = renderLine({
      gate,
      line: { status: 'published', text: row.text, tokenMap },
      optedOut,
      nameOf: (playerId) => names.get(playerId) ?? null,
    });
    if (text === null) return null;
    const at = new Date(row.published_at);
    return {
      lineId: row.id,
      text,
      written: scoutingWrittenLine(formatDayName(at, input.timeZone), formatDayMonth(at, input.timeZone)),
    };
  } catch (error) {
    console.error('ai scouting: none on the page', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

/** As {@link loadPlayerScouting}, with the service client made lazily (pages call this). */
export async function loadPlayerScoutingOrNone(
  service: () => ServiceClient,
  input: { groupId: string; puuid: string; timeZone: string },
): Promise<PlayerScouting | null> {
  try {
    return await loadPlayerScouting(service(), input);
  } catch {
    return null;
  }
}
