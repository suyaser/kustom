/**
 * `Not rated, so no Rating change.` (brief §4): the Discord result post's line (M15.6) and Tonight's
 * strip sentence for a game played not rated (M15.5). Its own module with no imports, so the
 * strip's client islands can read it without pulling the champion and region tables along.
 */
export const NOT_RATED_RESULT_LINE = 'Not rated, so no Rating change.';

/** 05-design.md 15.3: Tonight's strip sentence for a game the ingest voided (ended early). */
export const ENDED_EARLY_RESULT_LINE = 'Ended early, so no Rating change.';
/** 05-design.md 15.3: Tonight's strip sentence for a game an admin voided. */
export const ADMIN_VOIDED_RESULT_LINE = 'Voided, so no Rating change.';
