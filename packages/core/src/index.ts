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
 * post-game rule check and the card's state. Champion tags and regions are input; core imports no
 * fixture. M20.6's `transition` (one row, `take` at Roll, `handBack`, `recordGame`) replaced the
 * version-token lifecycle, whose exports M20.8 deleted once apps/web stopped calling them.
 *
 * `rating/kustom` (M18.1) is the Kustom rating that replaces OpenSkill at the M18 switch. Since
 * M18.2 the balancer (`balance`, `preGameOdds`) reads Kustom Ratings through `winProbability`;
 * the fold and the reads follow in the same switch deploy (M18.5, M18.6).
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
  type KustomBefore,
  nextSplit,
  type OddsBand,
  oddsBand,
  preGameOdds,
  type RankedColumns,
  type RatingBefore,
  type ResolvedRoles,
  type RoleProfile,
  resolveRoles,
  type ScoredColumns,
  type ScoreParts,
  type Split,
  type SplitTeams,
  type SwapDescription,
  type WhyLower,
  type WhyLowerScored,
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
  pairDrawable,
  regionOpenCounts,
  regionPool,
  rulePlayable,
} from './mode/pool';
export { drawRegions, drawSpin, type RegionDrawSource, type Rng, SPIN_FAMILIES } from './mode/spin';
export {
  handBack,
  type LockResult,
  lockRated,
  lockTransition,
  type ModeAction,
  type ModeLock,
  type ModeRow,
  nextRated,
  type PendingRule,
  type RecordInput,
  type RecordResult,
  type RecordStamp,
  type Refusal,
  type RegionAction,
  type RowPatch,
  recordGame,
  type TakeRegions,
  type TakeResult,
  type TransitionContext,
  type TransitionResult,
  take,
  transition,
} from './mode/transition';
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
// M18.11 core: the balanced-teams guard's fit and adoption rule (storage and the monthly job are platform's).
export {
  fitOddsPair,
  type OddsAdoptDecision,
  type OddsAdoptInput,
  type OddsAdoptSkip,
  type OddsFit,
  type OddsFitGame,
  type OddsFitOptions,
  shouldAdoptOddsPair,
} from './rating/oddsFit';
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
