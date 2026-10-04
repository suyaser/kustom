import { KUSTOM_START } from '@customs/core';

/**
 * Hand-written `game_players` rating columns for integration fixtures (M18.6): the 0036 Kustom
 * columns a folded row carries, so a fixture that seeds rows by hand satisfies
 * `game_players_kustom_together` / `game_players_week_together` and the readers find them.
 *
 * `rBefore` / `rAfter` are the all-time pair. `weekStart` is the player's all-time Rating when the
 * week began: the weekly pair is the all-time pair moved to start the week at 1200, so a fixture
 * whose players play only inside the week has the same per-game changes on both tracks (and the
 * week's points are `round(last week_r_after) − 1200`). `null` leaves the weekly track unfolded.
 * The companions (`k`, `fold_p`, `award`, `rated_games_before` and their weekly twins) are
 * plausible constants: no hand fixture asserts on them.
 *
 * Fixtures converted from OpenSkill use `r = mu × 60`, so every printed number they pin stays
 * the same (`displayRating(mu)` was `round(mu × 60)`).
 */
export function kustomSeat(
  rBefore: number,
  rAfter: number,
  weekStart: number | null = rBefore,
  options: { gamesBefore?: number; weekGamesBefore?: number; award?: 'mvp' | 'ace' | 'none' } = {},
) {
  const week =
    weekStart === null
      ? {
          week_r_before: null,
          week_r_after: null,
          week_k: null,
          week_fold_p: null,
          week_games_before: null,
        }
      : {
          week_r_before: rBefore - weekStart + KUSTOM_START,
          week_r_after: rAfter - weekStart + KUSTOM_START,
          week_k: 16,
          week_fold_p: 0.5,
          week_games_before: options.weekGamesBefore ?? 0,
        };
  return {
    r_before: rBefore,
    r_after: rAfter,
    k: 16,
    fold_p: 0.5,
    award: options.award ?? 'none',
    rated_games_before: options.gamesBefore ?? 10,
    ...week,
  };
}

/** `mu × 60`, unrounded: the Kustom Rating a converted OpenSkill fixture stands for. */
export function rOf(mu: number): number {
  return mu * 60;
}
