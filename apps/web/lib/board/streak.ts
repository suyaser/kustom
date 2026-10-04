/**
 * The `L2` at the end of a leaderboard row's line 2 (`05-design.md`, "Leaderboard row").
 *
 * Pure, and separate from the loader, because it is the one piece of arithmetic on the board
 * that is not core's: how many games back the current run of the same result goes.
 */

export interface Streak {
  /** `W` for a run of wins, `L` for a run of losses. */
  kind: 'W' | 'L';
  /** At least 1. A player who has played has a streak of one by definition. */
  length: number;
}

/**
 * The run at the **front** of the list: `results` is newest first, the way the board reads a
 * group, and the run ends at the first game that went the other way.
 *
 * `null` for a player who has not played, which prints nothing rather than `W0` — there is no
 * streak to be on and a zero in a signed-looking column reads as data.
 */
export function currentStreak(results: readonly boolean[]): Streak | null {
  const first = results[0];
  if (first === undefined) return null;

  let length = 1;
  while (results[length] === first) length += 1;
  return { kind: first ? 'W' : 'L', length };
}

/** `W3`, `L2`. Mono and tabular where it is printed, like every other number on the row. */
export function formatStreak(streak: Streak): string {
  return `${streak.kind}${streak.length}`;
}
