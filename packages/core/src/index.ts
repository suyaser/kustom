/**
 * `packages/core` is pure TypeScript: balancer, rating, role model.
 * No network, no database, no `Date.now()` without injection. See CLAUDE.md "Hard rules".
 *
 * This file is the only public entry point; everything consumers need is re-exported from
 * here. `rating/` landed in M1.3, `balance/` in M1.4. The role model exposes exactly two
 * functions: `isOffRole` (M3.1, marks an off-role line) and `resolveRoles` (M3.6, the
 * tonight page's `<override> · <old main>` row). Both are the balancer's own rule, so a display
 * surface can never disagree with the explanation about who is on what.
 *
 * `mode/` (M15.2) is the mode model: the standing mode and the one-game rule, pools, Spin, the
 * post-game rule check and the lifecycle (lock at Roll, compare and clear at record). Champion
 * tags and regions are input; core imports no fixture.
 *
 * `rating/kustom` (M18.1) is the Kustom rating that replaces OpenSkill at the M18 switch; until
 * then it is exported and tested but nothing outside this package calls it.
 */

export {
  type Assignment,
  BalanceError,
  type BalanceInput,
  type BalancePlayer,
  type BalanceResult,
  balance,
  type Calibration,
  type CalibrationGame,
  calibration,
  type Duo,
  describeSwap,
  explain,
  type FavoredSide,
  favoredSide,
  isOffRole,
  nextSplit,
  type OddsBand,
  oddsBand,
  preGameOdds,
  type RankedColumns,
  type RatingBefore,
  type ResolvedRoles,
  type RoleProfile,
  resolveRoles,
  type Split,
  type SplitTeams,
  type SwapDescription,
  type WhyLower,
  whyLower,
} from './balance/index';

export {
  type Config,
  config,
  KUSTOM_START,
  type PerformanceBucket,
  type RankDivision,
  type RankTier,
  SETTLING_GAMES,
} from './config';
export {
  type CheckSeat,
  type CheckVerdict,
  checkMode,
  type LaneCheck,
  type ModeCheck,
  type SideCheck,
} from './mode/check';
export {
  afterRecord,
  chooseRule,
  chooseStanding,
  consumesRule,
  type GameStamp,
  gameStamp,
  type LockedMode,
  lockAtRoll,
  type ModeState,
  nextGame,
  type RecordedGame,
  type RecordedGameKind,
  setRated,
  startState,
} from './mode/lifecycle';
export {
  type ChampionFacts,
  type ChampionTable,
  CLASS_TAGS,
  type ClassTag,
  isStandingMode,
  MODE_IDS,
  type Mode,
  type ModeFamily,
  type ModeId,
  modeFamily,
  modeRatedDefault,
  type RegionId,
  type RegionPair,
  RULE_FAMILIES,
  RULE_OPTIONS,
  type RuleFamily,
  type RuleOption,
  ruleKey,
  ruleOf,
  STANDING_MODES,
  type StandingModeId,
  sameRule,
  UNAFFILIATED,
} from './mode/model';
export {
  type Bans,
  classPool,
  drawableRegions,
  type ModePool,
  modePool,
  type PoolSplit,
  regionOpenCounts,
  regionPool,
  rulePlayable,
} from './mode/pool';
export { drawRegions, drawSpin, type Rng, SPIN_FAMILIES } from './mode/spin';
export {
  type Certainty,
  type DeltaAward,
  type DeltaBreakdown,
  type DeltaOdds,
  type DeltaReason,
  explainDelta,
  explainLegacyDelta,
  foldWinProbability,
  type GameResult,
  type LeadOnlyDeltaReason,
  type LegacyDeltaInput,
  type LegacyDeltaReason,
  type OddsStance,
  type StoredDeltaReason,
} from './rating/explain';
export {
  balanceScore,
  displayRating,
  evenness,
  isSettling,
  ordinal,
  predictWin,
  provisionalSeed,
  rateGame,
  seedFromRank,
} from './rating/index';
// M18.1: the Kustom rating, pure and not yet wired (nothing in apps/ imports it before M18.5).
export {
  displayKustom,
  explainKustomDelta,
  type KustomAward,
  type KustomCalib,
  type KustomDeltaParts,
  type KustomGame,
  KustomInputError,
  type KustomPlayer,
  type KustomRow,
  kFor,
  printedChange,
  rateGameKustom,
  shareFor,
  shareRanks,
  winProbability,
} from './rating/kustom';
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
