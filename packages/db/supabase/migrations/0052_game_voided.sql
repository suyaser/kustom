-- M23.1 (quit games, owner bug 2026-10-05): a voided game, by an admin or automatically.
--
-- A void takes a game out of ratings and is undoable (`Restore`). It reuses `games.rated` (0032),
-- whose `false` already means "never in the rating fold, rebuild-ratings, the board, calibration,
-- the Fearless pool or role learning": a void writes `rated = false` and stamps `voided_at` and
-- `void_reason`; a restore writes `rated = true` and clears both. The stamp is what tells a voided
-- game (restorable) from one played not rated (a rule's default or the Rated switch at Roll), which
-- a restore must never turn rated.
--
--   void_reason  'admin'      an admin's `Void game` on the game page ("Not rated · voided")
--                'early-end'  stamped at insert on a new Rift game under 15 minutes: people left
--                             ("Not rated · ended early"; `Rate it anyway` restores it)
--
-- History is never rewritten: nothing here touches an existing row.
--
-- Expand-safe: two nullable columns, no default, no backfill. The running build never names them,
-- and every row it writes leaves both null, which the checks allow whatever `rated` is.

alter table public.games
  add column voided_at timestamptz,
  add column void_reason text;

alter table public.games
  add constraint games_voided_not_rated check (voided_at is null or not rated),
  add constraint games_void_reason check (
    (voided_at is null) = (void_reason is null)
    and (void_reason is null or void_reason in ('admin', 'early-end'))
  );

comment on column public.games.voided_at is
  'M23.1 (0052): when this game was voided (taken out of ratings); null = not voided. A voided game is rated = false (games_voided_not_rated); a restore sets rated = true and this null. Written by the ingest (early-end, at insert) and the admin Void game route (lib/admin/voidGame.ts).';
comment on column public.games.void_reason is
  'M23.1 (0052): why it was voided: admin (Void game) or early-end (a new Rift game under 15 minutes, stamped at insert). Null exactly when voided_at is null (games_void_reason).';
