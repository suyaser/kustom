-- 0043_apply_game_player_ratings.sql (M18.10 prerequisite; redesign/research/db-performance.md finding 7)
--
-- One statement for a fold's `game_players` writes. Before this, `rebuild-ratings` and the daily
-- `/api/cron/rebuild` wrote one PostgREST PATCH per row that moved (18,190 requests and 12.5 s for
-- a 2,000-game group, not atomic, one Realtime UPDATE per row to every open Tonight because
-- `game_players` is in `supabase_realtime`), and the live fold claimed its ten rows one request at
-- a time. The M18 switch rebuild rewrites every row of every group, which is exactly that case.
--
-- apply_game_player_ratings(p_group, p_rows, p_only_unrated) -> integer (rows written)
--
--   p_group        the group whose rows these are; a row of another group is never touched.
--   p_rows         a json array of objects, one per (game_id, player_id), each carrying EVERY
--                  rating column the fold owns -- OpenSkill's four, 0034's breakdown (fold_p,
--                  base_mu_after, award, rated_games_before) and 0036's nine Kustom columns -- with
--                  null where the column is to be null. A missing key is refused, not read as null:
--                  "all columns of a track written together" (0036's checks) must not depend on a
--                  caller remembering a key. counts_for_role_inference is the one optional key
--                  (the live fold's M5.17 guard rides on the claim); absent means "keep it".
--   p_only_unrated false: the rebuild, the one writer entitled to overwrite a stored fold.
--                  true: the live fold's claim -- only rows with no rating on any track
--                  (mu_after, r_after and week_r_after all null) are written, so a second
--                  companion posting the same game writes 0 rows and the caller answers
--                  `already-rated`. Concurrent claims serialise on the row locks; the loser
--                  re-checks the condition on the winner's row and matches nothing.
--
-- Rows whose stored values already equal the new ones (`is distinct from`, exact) are skipped, so
-- a second rebuild writes 0 rows and fires no Realtime event, and `game_players` triggers (none
-- today) would not see a no-op. One statement, so one transaction: a row refused by a check
-- (0036's `game_players_kustom_together` and friends) rolls the whole fold back and the caller
-- sees the error; nothing is half written.
--
-- Hardening: security definer (runs as the owner, so it does not depend on the caller's table
-- grants), `search_path = ''` with every name schema-qualified, execute revoked from public, anon
-- and authenticated and granted to service_role only (the API and the scripts use the service
-- role). statement_timeout 60 s on the function, so a large group's rebuild is not cut at the
-- authenticator's 8 s.
--
-- Requires 0036 (it names the Kustom columns). Additive: the OpenSkill build ignores it, so the
-- M18 rollback (previous build + m18-rollback-prestep.sql + its own rebuild) is unchanged.
-- No RLS change; no table or column change.

begin;

create function public.apply_game_player_ratings(
  p_group uuid,
  p_rows jsonb,
  p_only_unrated boolean default false
) returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  v_count integer;
  v_keys constant text[] := array[
    'game_id', 'player_id',
    'mu_before', 'sigma_before', 'mu_after', 'sigma_after',
    'fold_p', 'base_mu_after', 'award', 'rated_games_before',
    'r_before', 'r_after', 'k', 'share_rank',
    'week_r_before', 'week_r_after', 'week_k', 'week_fold_p', 'week_games_before'
  ];
begin
  if p_group is null then
    raise exception 'apply_game_player_ratings: p_group is required';
  end if;
  if p_only_unrated is null then
    raise exception 'apply_game_player_ratings: p_only_unrated is required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'apply_game_player_ratings: p_rows must be a json array';
  end if;
  if exists (
    select from pg_catalog.jsonb_array_elements(p_rows) as e(v)
    where pg_catalog.jsonb_typeof(e.v) is distinct from 'object' or not (e.v ?& v_keys)
  ) then
    raise exception 'apply_game_player_ratings: every row must be an object carrying every rating column';
  end if;
  if (
    select count(*) <> count(distinct (e.v ->> 'game_id', e.v ->> 'player_id'))
    from pg_catalog.jsonb_array_elements(p_rows) as e(v)
  ) then
    raise exception 'apply_game_player_ratings: a (game_id, player_id) appears twice in p_rows';
  end if;

  update public.game_players gp
  set mu_before = r.mu_before,
      sigma_before = r.sigma_before,
      mu_after = r.mu_after,
      sigma_after = r.sigma_after,
      fold_p = r.fold_p,
      base_mu_after = r.base_mu_after,
      award = r.award,
      rated_games_before = r.rated_games_before,
      r_before = r.r_before,
      r_after = r.r_after,
      k = r.k,
      share_rank = r.share_rank,
      week_r_before = r.week_r_before,
      week_r_after = r.week_r_after,
      week_k = r.week_k,
      week_fold_p = r.week_fold_p,
      week_games_before = r.week_games_before,
      counts_for_role_inference = coalesce(r.counts_for_role_inference, gp.counts_for_role_inference)
  from pg_catalog.jsonb_to_recordset(p_rows) as r(
    game_id uuid, player_id uuid,
    mu_before double precision, sigma_before double precision,
    mu_after double precision, sigma_after double precision,
    fold_p double precision, base_mu_after double precision, award text, rated_games_before integer,
    r_before double precision, r_after double precision, k double precision, share_rank smallint,
    week_r_before double precision, week_r_after double precision, week_k double precision,
    week_fold_p double precision, week_games_before integer,
    counts_for_role_inference boolean
  )
  where gp.game_id = r.game_id
    and gp.player_id = r.player_id
    and gp.group_id = p_group
    and (not p_only_unrated or (gp.mu_after is null and gp.r_after is null and gp.week_r_after is null))
    and (gp.mu_before, gp.sigma_before, gp.mu_after, gp.sigma_after, gp.fold_p, gp.base_mu_after, gp.award,
         gp.rated_games_before, gp.r_before, gp.r_after, gp.k, gp.share_rank, gp.week_r_before,
         gp.week_r_after, gp.week_k, gp.week_fold_p, gp.week_games_before, gp.counts_for_role_inference)
        is distinct from
        (r.mu_before, r.sigma_before, r.mu_after, r.sigma_after, r.fold_p, r.base_mu_after, r.award,
         r.rated_games_before, r.r_before, r.r_after, r.k, r.share_rank, r.week_r_before,
         r.week_r_after, r.week_k, r.week_fold_p, r.week_games_before,
         coalesce(r.counts_for_role_inference, gp.counts_for_role_inference));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.apply_game_player_ratings(uuid, jsonb, boolean) is
  '0043: a fold''s game_players rating columns (OpenSkill, 0034 breakdown, 0036 Kustom) in one statement. p_only_unrated false: the rebuild; true: the live fold''s claim (rows rated on no track only). Every row carries every column; unmoved rows are skipped. Returns rows written. service_role only.';

revoke all on function public.apply_game_player_ratings(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apply_game_player_ratings(uuid, jsonb, boolean) to service_role;

commit;
