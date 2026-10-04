#!/usr/bin/env bash
# m18-4-throwaway-check.sh  (M18.4: verify 0036 on real local data without touching the shared stack)
#
# Applies 0036_kustom_rating.sql to a THROWAWAY Postgres restored from a read-only pg_dump of the
# local stack, then checks it. The shared local stack is only ever read (pg_dump); hosted is never
# touched. This is the rehearsal of what the owner runs on hosted in M18.10.
#
#   packages/db/scripts/m18-4-throwaway-check.sh [path/to/0036_kustom_rating.sql]
#
# If the local stack has already applied 0036, the throwaway is first taken back to the 0035 shape
# (the 0036 columns and checks dropped, 0034's two checks restored, ratings.mu/sigma not null
# again), which is itself a check that 0036 can be undone while no Kustom row exists.
#
# Checks, all on the throwaway:
#   1. the migration applies (it carries its own begin/commit) and a second apply fails cleanly;
#   2. no existing value moved: a fingerprint of every OpenSkill and 0034 column of game_players,
#      ratings and splits is identical before and after;
#   3. the new columns exist with the documented types, every existing row reads null in them and
#      every existing split reads 'openskill';
#   4. the checks refuse a hand-written update breaking each one, and accept the Kustom fold's
#      whole row, both tracks, on a real stored row (all rolled back);
#   5. anon can select the new columns through the existing policies (no new policy);
#   6. the container is removed (also on failure).
#
# Exit 0 only when every check passes. Needs Docker and the local stack running (`pnpm db:start`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0036_kustom_rating.sql}"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m184-throwaway-$$"
WORK="$(mktemp -d)"

[[ -f "$MIGRATION" ]] || { echo "no migration at $MIGRATION" >&2; exit 1; }
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$LOCAL_DB")"

cleanup() {
  docker rm -f "$THROWAWAY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_t() { docker exec -i "$THROWAWAY" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER_T:-postgres}" -h localhost -d postgres "$@"; }
# Runs one statement that must FAIL naming the constraint; exits non-zero if it succeeds.
must_fail() {
  local label="$1" constraint="$2" sql="$3" out
  if out="$(printf 'begin;\n%s\nrollback;\n' "$sql" | psql_t -q 2>&1)"; then
    echo "FAIL: $label was accepted" >&2
    exit 1
  fi
  if [[ "$out" != *"$constraint"* ]]; then
    echo "FAIL: $label was refused, but not by $constraint: $out" >&2
    exit 1
  fi
  echo "ok: $constraint refused $label"
}
must_pass() {
  local label="$1" sql="$2"
  printf 'begin;\n%s\nrollback;\n' "$sql" | psql_t -q >/dev/null
  echo "ok: accepted $label (rolled back)"
}

FINGERPRINT="select md5(string_agg(x, '|' order by x)) from (
  select concat_ws(',', game_id, player_id, mu_before, sigma_before, mu_after, sigma_after,
                   fold_p, base_mu_after, award, rated_games_before) as x from public.game_players
  union all
  select concat_ws(',', group_id, player_id, mu, sigma, ordinal, games, wins, seed_mu, seed_sigma) from public.ratings
  union all
  select concat_ws(',', id, blue_win_prob, score, is_chosen) from public.splits) t"

echo "== 1. read-only dump of $LOCAL_DB"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=public --schema=auth -f /tmp/m184.dump
docker cp "$LOCAL_DB:/tmp/m184.dump" "$WORK/local.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m184.dump

echo "== 2. throwaway $THROWAWAY on $IMAGE"
docker run -d --name "$THROWAWAY" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$THROWAWAY" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 5
docker cp "$WORK/local.dump" "$THROWAWAY:/tmp/local.dump"
PGUSER_T=supabase_admin psql_t -q -c 'drop schema auth cascade; drop schema public cascade;'
docker exec "$THROWAWAY" pg_restore -U supabase_admin -h localhost -d postgres /tmp/local.dump

if [[ "$(psql_t -At -c "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'game_players' and column_name = 'r_after'")" == "1" ]]; then
  echo "== 2b. the dump already has 0036: take the throwaway back to the 0035 shape"
  [[ "$(psql_t -At -c 'select count(*) from public.game_players where r_after is not null or week_r_after is not null')" == "0" ]] \
    || { echo "FAIL: the local stack holds Kustom rows; cannot undo 0036 here" >&2; exit 1; }
  psql_t -q --single-transaction <<'SQL'
alter table public.game_players
  drop constraint game_players_kustom_together,
  drop constraint game_players_week_together,
  drop constraint game_players_share_rank,
  drop constraint game_players_breakdown_together,
  drop constraint game_players_breakdown_needs_rating,
  drop column r_before, drop column r_after, drop column k, drop column share_rank,
  drop column week_r_before, drop column week_r_after, drop column week_k, drop column week_fold_p,
  drop column week_games_before;
alter table public.game_players
  add constraint game_players_breakdown_together check (
    (fold_p is null) = (base_mu_after is null) and (base_mu_after is null) = (award is null)
  ),
  add constraint game_players_breakdown_needs_rating check (
    mu_after is not null
    or (fold_p is null and base_mu_after is null and award is null and rated_games_before is null)
  );
alter table public.ratings
  drop constraint ratings_openskill_pair,
  drop constraint ratings_has_a_rating,
  drop column r,
  alter column mu set not null,
  alter column sigma set not null;
alter table public.splits drop column odds_model;
SQL
  echo "ok: 0036 undone on the throwaway"
fi

BEFORE="$(psql_t -At -c "$FINGERPRINT")"
POLICIES_BEFORE="$(psql_t -At -c "select count(*) from pg_policies where schemaname = 'public'")"

echo "== 3. apply 0036"
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0036.sql"
psql_t -q -f /tmp/0036.sql
if psql_t -q -f /tmp/0036.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply succeeded" >&2
  exit 1
fi
echo "ok: a second apply fails and rolls back"

echo "== 4. no existing value moved"
AFTER="$(psql_t -At -c "$FINGERPRINT")"
[[ "$BEFORE" == "$AFTER" ]] || { echo "FAIL: fingerprint $BEFORE -> $AFTER" >&2; exit 1; }
echo "ok: fingerprint $AFTER unchanged"

echo "== 5. columns, types, nulls"
psql_t -At -c "select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable
  from information_schema.columns where table_schema = 'public' and (
    (table_name = 'game_players' and column_name in ('r_before','r_after','k','share_rank','week_r_before','week_r_after','week_k','week_fold_p','week_games_before'))
    or (table_name = 'ratings' and column_name in ('r','mu','sigma'))
    or (table_name = 'splits' and column_name = 'odds_model'))
  order by table_name, column_name" | tee "$WORK/cols.txt"
diff <(printf '%s\n' \
  'game_players.k:double precision:YES' \
  'game_players.r_after:double precision:YES' \
  'game_players.r_before:double precision:YES' \
  'game_players.share_rank:smallint:YES' \
  'game_players.week_fold_p:double precision:YES' \
  'game_players.week_games_before:integer:YES' \
  'game_players.week_k:double precision:YES' \
  'game_players.week_r_after:double precision:YES' \
  'game_players.week_r_before:double precision:YES' \
  'ratings.mu:double precision:YES' \
  'ratings.r:double precision:YES' \
  'ratings.sigma:double precision:YES' \
  'splits.odds_model:text:NO') "$WORK/cols.txt"
psql_t -At -c "select count(*) || ' game_players rows, ' || (select count(*) from public.ratings) || ' ratings rows, ' || (select count(*) from public.splits) || ' splits' from public.game_players"
[[ "$(psql_t -At -c 'select count(*) from public.game_players where r_before is not null or r_after is not null or k is not null or share_rank is not null or week_r_before is not null or week_r_after is not null or week_k is not null or week_fold_p is not null or week_games_before is not null')" == "0" ]]
[[ "$(psql_t -At -c 'select count(*) from public.ratings where r is not null')" == "0" ]]
[[ "$(psql_t -At -c "select count(*) from public.splits where odds_model <> 'openskill'")" == "0" ]]
echo "ok: every existing row is null in the new columns, every split openskill"

echo "== 6. checks"
GAME="(select game_id from public.game_players where mu_after is not null limit 1)"
PLAYER="(select player_id from public.game_players where mu_after is not null and game_id = $GAME limit 1)"
WHERE="where game_id = $GAME and player_id = $PLAYER"
ALL="r_before = 1200, r_after = 1208, k = 16, fold_p = 0.5, award = 'none', rated_games_before = 12, share_rank = 3"
WEEK="week_r_before = 1200, week_r_after = 1219.2, week_k = 32, week_fold_p = 0.5, week_games_before = 0"
must_pass "the Kustom fold's whole row, both tracks, base_mu_after null" "update public.game_players set $ALL, $WEEK, base_mu_after = null $WHERE;"
must_pass "nulling every column of the row in one statement" "update public.game_players set mu_before = null, sigma_before = null, mu_after = null, sigma_after = null, fold_p = null, base_mu_after = null, award = null, rated_games_before = null $WHERE;"
must_fail "r_after without k" game_players_kustom_together "update public.game_players set r_before = 1200, r_after = 1208 $WHERE;"
must_fail "an all-time Kustom row without its n" game_players_kustom_together "update public.game_players set r_before = 1200, r_after = 1208, k = 16, rated_games_before = null $WHERE;"
must_fail "a partial weekly set" game_players_week_together "update public.game_players set week_r_before = 1200, week_r_after = 1208, week_k = 16, week_fold_p = 0.5 $WHERE;"
must_fail "a share rank without an award" game_players_share_rank "update public.game_players set fold_p = null, base_mu_after = null, award = null, share_rank = 2 $WHERE;"
must_fail "an OpenSkill breakdown without its odds" game_players_breakdown_together "update public.game_players set fold_p = null $WHERE;"
must_fail "a breakdown on a row rated on no track" game_players_breakdown_needs_rating "update public.game_players set mu_before = null, mu_after = null $WHERE;"
must_fail "share_rank 6" game_players_share_rank_check "update public.game_players set share_rank = 6 $WHERE;"
must_fail "k 0" game_players_k_check "update public.game_players set k = 0 $WHERE;"
must_fail "week_fold_p 1.5" game_players_week_fold_p_check "update public.game_players set week_fold_p = 1.5 $WHERE;"
RATED="where player_id = (select player_id from public.ratings limit 1) and group_id = (select group_id from public.ratings limit 1)"
must_pass "a Kustom-only ratings row" "update public.ratings set mu = null, sigma = null, r = 1208 $RATED;"
must_fail "mu without sigma" ratings_openskill_pair "update public.ratings set sigma = null $RATED;"
must_fail "a ratings row with no rating" ratings_has_a_rating "update public.ratings set mu = null, sigma = null $RATED;"
must_fail "an unknown odds model" splits_odds_model_known "update public.splits set odds_model = 'elo';"

echo "== 7. anon reads the new columns through the existing policies"
printf 'begin;\nset local role anon;\nselect count(r_after), count(week_r_after), count(share_rank) from public.game_players;\nselect count(r) from public.ratings;\nselect count(odds_model) from public.splits;\nrollback;\n' | psql_t -q >/dev/null
[[ "$(psql_t -At -c "select count(*) from pg_policies where schemaname = 'public'")" == "$POLICIES_BEFORE" ]]
echo "ok: anon select works, no policy added or removed"

echo "ALL CHECKS PASSED"
