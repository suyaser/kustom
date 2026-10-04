import { loadGroupPool } from '../ingest/balance';
import { selectTen } from '../ingest/selection';
import { PLAYERS_PER_GAME } from '../lobbyRules';
import { getServiceClient } from '../supabase';
import { type SitOutRule, sitOutRule } from './sitOut';

/**
 * Who would sit out if the teams were rolled now (M14.9, STRATEGY §6(a) "More than ten"): the
 * balancer's own rotation (`loadPool` + `selectTen`, `lib/ingest/selection.ts`), read and never
 * written. First to sit first, by puuid.
 *
 * Server only (the rotation reads tonight's games and sit-outs with the service role). Only asked
 * for an `open` lobby with more than ten around; any failure is `null` and the page keeps the
 * generic `Ten play, the rest sit out.` line.
 */
export async function loadSitOutPreviewOrNone(
  lobbyId: string,
  groupId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<string[] | null> {
  try {
    const client = getServiceClient();
    const pool = await loadGroupPool(client, lobbyId, now, timeZone, groupId);
    if (pool.length <= PLAYERS_PER_GAME) return null;
    return selectTen(pool).sitters.map((member) => member.puuid);
  } catch (error) {
    console.error('tonight: working out who would sit out failed', error);
    return null;
  }
}

/**
 * Why tonight's sitters are sitting (M14.41, scene-walk gap 4): the rotation's pool for this
 * lobby, split by the ten the split seats, read through `sitOutRule` (the same rule the Discord
 * teams embed prints). Read only, never written, and it never decides who sits.
 *
 * Asked for a `balanced` or `in_game` lobby with somebody sitting: until the game ends nobody's
 * `gamesTonight` has moved, so the pool reads as it did at the roll. Any failure is `null`, and
 * the card prints its lead (`Ramzy sits this one out.`) with no reason rather than a guess.
 */
export async function loadSitOutRuleOrNone(
  lobbyId: string,
  groupId: string,
  timeZone: string,
  ten: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<SitOutRule | null> {
  try {
    const client = getServiceClient();
    const pool = await loadGroupPool(client, lobbyId, now, timeZone, groupId);
    const playing = pool.filter((member) => ten.has(member.puuid));
    const sitters = pool.filter((member) => !ten.has(member.puuid));
    if (playing.length !== ten.size) return null;
    return sitOutRule(playing, sitters);
  } catch (error) {
    console.error('tonight: working out why somebody sits out failed', error);
    return null;
  }
}
