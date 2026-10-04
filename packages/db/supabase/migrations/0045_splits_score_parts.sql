-- 0045_splits_score_parts.sql (M18.13, owner-approved 2026-10-04, decision row)
--
-- splits.score_parts: every term of a split's score, as `balance()` returned it (core
-- `ScoreParts`, packages/core/src/balance/types.ts), so the fairness receipt's "why it ranked
-- lower" can name a repeat, teammate variety or recent fills from stored numbers instead of
-- "scored a hair worse overall".
--
--   { "gap": <number>, "offRole": <number>, "repeat": <number>, "variety": <number>,
--     "repeatedPairs": <integer> }
--
--   gap            the unrounded gap in Rating points on role-adjusted strength (splits.gap is
--                  its rounding)
--   offRole        the sum of each off-role seat's cost (fill protection included)
--   repeat         the repeat-split penalty, or 0
--   variety        min(cap, per-pair x (repeatedPairs - floor)), teammate variety; the floor is
--                  the fewest repeatedPairs of any split of that lobby (M18.14), so it is what was
--                  charged, not recomputable from this row alone
--   repeatedPairs  the raw count: pairs on the same side who were teammates in the night's
--                  previous game
--
-- score = gap + offRole + repeat + variety (core sums them in that order). Not checked here:
-- the parts are doubles summed in JS, and a database recomputation is not the place to argue
-- about float rounding. The receipt reads the parts, never `score`.
--
-- Null on every row written before this migration and on any row a caller wrote without parts;
-- the receipt then says what it said before (core `whyLower` falls back to `role-costs`). No
-- backfill: the window a stored split's variety depended on is not recoverable honestly.
--
-- Written by the API's roll path only (apps/web/lib/ingest/balance.ts, service role). Read by the
-- tonight page, the game page and the Discord embeds through zod (`scorePartsSchema`,
-- packages/db/src/schemas/scoreParts.ts); a value that fails it reads as null.
--
-- No RLS change: `splits` is publicly readable (0001, "splits are publicly readable", a table
-- grant, no column grants), and the parts are derived from public columns (ratings, roles, the
-- previous game's teams). No view selects splits. Realtime: splits is already published (0001).
-- Additive and nullable: the previous build ignores the column, so a rollback needs nothing.

begin;

alter table public.splits
  add column score_parts jsonb
    constraint splits_score_parts_shape check (
      score_parts is null
      or (
        jsonb_typeof(score_parts) = 'object'
        and jsonb_typeof(score_parts -> 'gap') = 'number'
        and jsonb_typeof(score_parts -> 'offRole') = 'number'
        and jsonb_typeof(score_parts -> 'repeat') = 'number'
        and jsonb_typeof(score_parts -> 'variety') = 'number'
        and jsonb_typeof(score_parts -> 'repeatedPairs') = 'number'
        and (score_parts ->> 'gap')::numeric >= 0
        and (score_parts ->> 'offRole')::numeric >= 0
        and (score_parts ->> 'repeat')::numeric >= 0
        and (score_parts ->> 'variety')::numeric >= 0
        and (score_parts ->> 'repeatedPairs')::numeric >= 0
        and (score_parts ->> 'repeatedPairs')::numeric = trunc((score_parts ->> 'repeatedPairs')::numeric)
      )
    );

comment on column public.splits.score_parts is
  'M18.13 (0045): the terms of score as balance() returned them, {gap, offRole, repeat, variety, repeatedPairs} (core ScoreParts). The receipt''s why-lower line names repeat, variety or recent fills from these. Null: written before 0045.';

commit;
