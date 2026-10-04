/**
 * The fairness receipt (M14.9; redesign/STRATEGY.md §4; docs/05-design.md 5.5).
 *
 * - `FairnessReceipt`: balanced, in game, finished (tonight and the game page).
 * - `PreGameReceipt`: games with no usable split (§4.10).
 * - `CompactReceipt`: one line for history rows and the tape (§4.7).
 * Every string lives in `lib/receipt/copy`, shared with the Discord receipt (M14.10).
 */
export { CompactReceipt, type CompactReceiptProps } from './compact-receipt';
export { FairnessReceipt, type FairnessReceiptProps } from './fairness-receipt';
export { buildReceipt, oddsOf, receiptSplitFromRow } from './model';
export { PreGameReceipt, type PreGameReceiptProps } from './pre-game-receipt';
export type {
  OffRoleSeat,
  RatingsBefore,
  ReceiptNames,
  SplitRowLike,
  StoredSplit,
  WinnerSide,
} from './types';
