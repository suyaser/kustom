#!/usr/bin/env bash
# m14-58-throwaway-check.sh  (M14.58: verify 0034 without touching the shared stack)
#
# Applies 0034_fold_breakdown.sql to a THROWAWAY Postgres restored from a read-only pg_dump of the
# local stack, then checks it. The shared local stack is only ever read (pg_dump); hosted is never
# touched.
#
#   packages/db/scripts/m14-58-throwaway-check.sh [path/to/0034_fold_breakdown.sql]
#
# Checks, all on the throwaway:
#   1. the migration applies (it carries its own begin/commit) and a second apply fails cleanly
#      (columns exist), leaving the first intact;
#   2. the four columns exist with the documented types, every existing row reads null;
#   3. the check constraints refuse: fold_p outside [0, 1], an unknown award, a negative count,
#      a partial breakdown, a breakdown on a row with no mu_after; and accept a whole one;
#   4. anon can select the new columns through the existing policy (RLS on, no new policy);
#   5. the container is removed (also on failure).
#
# Exit 0 only when every check passes. Needs Docker and the local stack running (`pnpm db:start`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0034_fold_breakdown.sql}"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m1458-throwaway-$$"
WORK="$(mktemp -d)"

[[ -f "$MIGRATION" ]] || { echo "no migration at $MIGRATION" >&2; exit 1; }
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$LOCAL_DB")"

cleanup() {
  docker rm -f "$THROWAWAY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_t() { docker exec -i "$THROWAWAY" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER_T:-postgres}" -h localhost -d postgres "$@"; }
# Runs one statement that must FAIL; exits non-zero if it succeeds.
must_fail() {
  local label="$1" sql="$2"
  if printf 'begin;\n%s\nrollback;\n' "$sql" | psql_t -q >/dev/null 2>&1; then
    echo "FAIL: $label was accepted" >&2
    exit 1
  fi
  echo "ok: refused $label"
}

echo "== 1. read-only dump of $LOCAL_DB"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=public --schema=auth -f /tmp/m1458.dump
docker cp "$LOCAL_DB:/tmp/m1458.dump" "$WORK/local.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m1458.dump

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

echo "== 3. apply 0034"
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0034.sql"
psql_t -q -f /tmp/0034.sql
if psql_t -q -f /tmp/0034.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply succeeded" >&2
  exit 1
fi
echo "ok: a second apply fails and rolls back"

echo "== 4. columns, types, nulls"
psql_t -At -c "select column_name || ':' || data_type || ':' || is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'game_players'
    and column_name in ('fold_p', 'base_mu_after', 'award', 'rated_games_before') order by column_name" | tee "$WORK/cols.txt"
diff <(printf 'award:text:YES\nbase_mu_after:double precision:YES\nfold_p:double precision:YES\nrated_games_before:integer:YES\n') "$WORK/cols.txt"
psql_t -At -c "select count(*) || ' rows, ' || count(fold_p) || ' fold_p, ' || count(base_mu_after) || ' base, ' || count(award) || ' award, ' || count(rated_games_before) || ' count' from public.game_players"
[[ "$(psql_t -At -c 'select count(*) from public.game_players where fold_p is not null or base_mu_after is not null or award is not null or rated_games_before is not null')" == "0" ]]
echo "ok: every existing row is null in all four"

echo "== 5. constraints"
ROW="(select game_id from public.game_players where mu_after is not null limit 1)"
PID="(select player_id from public.game_players where mu_after is not null and game_id = $ROW limit 1)"
WHERE="where game_id = $ROW and player_id = $PID"
must_fail "fold_p 1.5" "update public.game_players set fold_p = 1.5, base_mu_after = mu_after, award = 'none' $WHERE;"
must_fail "fold_p -0.1" "update public.game_players set fold_p = -0.1, base_mu_after = mu_after, award = 'none' $WHERE;"
must_fail "award 'gold'" "update public.game_players set fold_p = 0.5, base_mu_after = mu_after, award = 'gold' $WHERE;"
must_fail "rated_games_before -1" "update public.game_players set rated_games_before = -1 $WHERE;"
must_fail "a partial breakdown" "update public.game_players set fold_p = 0.5 $WHERE;"
must_fail "a breakdown on a row with no mu_after" "update public.game_players set mu_after = null, mu_before = null, fold_p = 0.5, base_mu_after = 25, award = 'none' $WHERE;"
printf 'begin;\nupdate public.game_players set fold_p = 0.62, base_mu_after = mu_after, award = %s, rated_games_before = 9 %s;\nrollback;\n' "'none'" "$WHERE" | psql_t -q
echo "ok: a whole breakdown is accepted (rolled back)"
printf 'begin;\nupdate public.game_players set fold_p = null, base_mu_after = null, award = null, rated_games_before = null, mu_after = null %s;\nrollback;\n' "$WHERE" | psql_t -q
echo "ok: nulling a row whole is accepted (rolled back)"

echo "== 6. anon reads the new columns through the existing policy"
[[ "$(psql_t -At -c "select relrowsecurity from pg_class where oid = 'public.game_players'::regclass")" == "t" ]]
printf 'begin;\nset local role anon;\nselect count(fold_p), count(base_mu_after), count(award), count(rated_games_before) from public.game_players;\nrollback;\n' | psql_t -q
[[ "$(psql_t -At -c "select count(*) from pg_policies where schemaname = 'public' and tablename = 'game_players'")" == "1" ]]
echo "ok: anon select works, still exactly one policy"

echo "ALL CHECKS PASSED"
