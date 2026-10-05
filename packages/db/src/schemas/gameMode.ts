/**
 * The client's `gameMode` words, in one place, for the server and its clients (owner bug 2026-10-05).
 *
 * **The ARAM family** is every Howling Abyss mode the client names, from its own queue list
 * (`/lol-game-queues/v1/queues`, `packages/lcu/fixtures/16.18/game-queues.json`, all map 12):
 *
 * - `ARAM`: ARAM, ARAM Clash, and the three Howling Abyss custom queues (3200, 3210, 3230);
 * - `KIWI`: ARAM: Mayhem (2400, the custom 3270, the tournament 2410);
 * - `KIWI_JADE`: ARAM: Mayhem Classic-ish (2450, custom 3280), so any `KIWI_*` variant;
 * - `KINGPORO`: Legend of the Poro King (Riot's gameModes.json), a Howling Abyss rotating mode.
 *
 * On 2026-10-04 the group's custom "ARAM" was Mayhem, stored as `KIWI`, which the old
 * `=== 'ARAM'` checks treated as neither Rift nor ARAM. Rift (`CLASSIC` or a missing mode) is
 * unchanged, and rating stays Rift-only (`isRatedMode`): this only decides what is labelled ARAM.
 */

/** Upper case and trimmed, or '' for a missing mode. */
export function normalizeGameMode(gameMode: string | null | undefined): string {
  return (gameMode ?? '').trim().toUpperCase();
}

/** Whether the client's `gameMode` is a Howling Abyss (ARAM family) mode. A missing mode is not. */
export function isAramGameMode(gameMode: string | null | undefined): boolean {
  const mode = normalizeGameMode(gameMode);
  return mode === 'ARAM' || mode === 'KINGPORO' || mode === 'KIWI' || mode.startsWith('KIWI_');
}

/** Whether the client's `gameMode` is Summoner's Rift: `CLASSIC`, or missing (M5.26). */
export function isRiftGameMode(gameMode: string | null | undefined): boolean {
  const mode = normalizeGameMode(gameMode);
  return mode === '' || mode === 'CLASSIC';
}

/**
 * `isAramGameMode` in Postgres (`imatch`, case-insensitive), for the `/games` list filter on
 * `games.game_mode`. POSIX classes only: the value travels inside a PostgREST filter.
 */
export const ARAM_GAME_MODE_PATTERN = '^[[:space:]]*(aram|kingporo|kiwi(_[a-z0-9_]*)?)[[:space:]]*$';

/**
 * What a game's mode says about which game it is: `rift`, `aram`, or the word itself for anything
 * else. Null when the mode is unknown (an older companion's `in_progress`), so a comparison needs
 * both sides known. Two modes of different kinds are two different games.
 */
export function gameModeKind(gameMode: string | null | undefined): string | null {
  if (gameMode === null || gameMode === undefined) return null;
  const mode = normalizeGameMode(gameMode);
  if (isRiftGameMode(mode)) return 'rift';
  if (isAramGameMode(mode)) return 'aram';
  return mode;
}
