-- M23.1 (quit games, owner bug 2026-10-05): an admin's `Void game`.
--
-- A void takes a game out of ratings after the fact and is undoable (`Restore`). It reuses
-- `games.rated` (0032), whose `false` already means "never in the rating fold, rebuild-ratings,
-- the board, calibration, the Fearless pool or role learning": a void writes `rated = false` and
-- stamps `voided_at`; a restore writes `rated = true` and clears it. The stamp is what tells a
-- voided game (restorable, "Not rated · voided") from one played not rated (a rule's default or the
-- Rated switch at Roll), which a restore must never turn rated.
--
-- Expand-safe: one nullable column, no default, no backfill. The running build never names it,
-- and every row it writes leaves it null, which the check allows whatever `rated` is.

alter table public.games
  add column voided_at timestamptz;

alter table public.games
  add constraint games_voided_not_rated check (voided_at is null or not rated);

comment on column public.games.voided_at is
  'M23.1 (0052): when an admin voided this game (taken out of ratings by hand); null = not voided. A voided game is rated = false (games_voided_not_rated) and a restore sets rated = true and this null. Written only by the admin Void game route (lib/admin/voidGame.ts).';
