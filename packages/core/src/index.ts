/**
 * `packages/core` is pure TypeScript: balancer, rating, role model.
 * No network, no database, no `Date.now()` without injection. See CLAUDE.md "Hard rules".
 *
 * This file is the only public entry point; everything consumers need is re-exported from
 * here. `rating/` landed in M1.3, `balance/` in M1.4. The role model exposes exactly two
 * functions: `isOffRole` (M3.1, marks an off-role line) and `resolveRoles` (M3.6, the
 * tonight page's `<override> · <old main>` row). Both are the balancer's own rule, so a display
 * surface can never disagree with the explanation about who is on what.
 */

export {
  type Assignment,
  BalanceError,
  type BalanceInput,
  type BalancePlayer,
  type BalanceResult,
  balance,
  type Duo,
  explain,
  isOffRole,
  nextSplit,
  type ResolvedRoles,
  type RoleProfile,
  resolveRoles,
  type Split,
} from './balance/index';

export {
  type Config,
  config,
  type PerformanceBucket,
  type RankDivision,
  type RankTier,
} from './config';
export {
  balanceScore,
  displayRating,
  evenness,
  ordinal,
  predictWin,
  rateGame,
  rateGameWeekly,
  seedFromRank,
} from './rating/index';
export {
  applyMvpAceBonus,
  type MvpAce,
  mvpAce,
  type PerformancePlayer,
  type PerformanceScore,
  type PerformanceStats,
  performanceScores,
  type RatingChange,
} from './rating/performance';
export { type InferredRoles, inferRoles, type RoleGame } from './roles/infer';
export { type LobbyStatus, type Rating, ROLES, type Role, type Side } from './types';
