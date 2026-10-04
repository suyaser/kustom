import 'server-only';
import { aiGateOpen, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import { subjectKey } from './store';

/**
 * Has this game's recap line landed (M19.16)? The light question the recap waiter asks instead of
 * re-rendering the page (performance plan P6): the group's AI gate (`lib/premium`, fails closed)
 * and the line's row on its unique key `(group_id, kind, subject)` with `status = 'published'`,
 * read **side by side**, so the answer is one wave.
 *
 * Deliberately **not** the full "would the page show it": the opt-outs and the name chain stay
 * `loadGameRecap`'s (`lib/ai/recap.ts`), and the page's one refresh after `true` asks it. A
 * published line the page then declines to draw (a named player opted out) costs that one refresh
 * and nothing else. A closed gate, and a hidden, pending, failed or rejected line, are `false`. The
 * group is part of the key, so a game of another group is always `false`. No text, no line id: the
 * answer carries nothing the page would not print.
 */
export async function readRecapLanded(
  service: ServiceClient,
  input: { groupId: string; gameId: string },
): Promise<boolean> {
  const [gate, line] = await Promise.all([
    readAiGate(service, input.groupId),
    service
      .from('ai_lines')
      .select('id')
      .eq('group_id', input.groupId)
      .eq('kind', 'game')
      .eq('subject', subjectKey({ kind: 'game', gameId: input.gameId }))
      .eq('status', 'published')
      .maybeSingle(),
  ]);
  if (line.error) throw new Error(`readRecapLanded: ${line.error.message}`);
  return aiGateOpen(gate) && line.data !== null;
}
