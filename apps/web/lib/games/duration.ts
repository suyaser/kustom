/**
 * A game's length as a friend says it: `21 min`, never `21:46` (STRATEGY §6(c); docs/05-design.md
 * 6.12 "Durations are ‹21 min›"). Whole minutes played, rounded down the way a clock reads (21:46
 * is still "21 minutes in"), and never `0 min`: a remake that ended at 0:40 is `1 min`.
 *
 * Every game length Kustom prints, web, admin and Discord alike (M14.16; M14.39 moved the admin
 * Games table and the Discord result title onto it).
 */
export function formatMinutes(durationS: number): string {
  const seconds = Number.isFinite(durationS) ? Math.max(0, durationS) : 0;
  return `${Math.max(1, Math.floor(seconds / 60))} min`;
}

/**
 * A life span, where the seconds matter: `3:20`, and `1:02:03` past the hour. Never a game's length
 * (that is {@link formatMinutes}). The mystery clue `longest_life` reads it (moved here from
 * `lib/discord/embeds.ts` in M14.39, output unchanged).
 */
export function formatLifeSpan(durationS: number): string {
  const total = Math.max(0, Math.round(durationS));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
