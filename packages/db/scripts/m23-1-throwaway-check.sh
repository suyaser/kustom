#!/usr/bin/env bash
# M23.1: checks 0052_game_voided.sql on a throwaway database, never on the shared local stack.
#
#   1. a read-only pg_dump of the local stack's `auth` schema (GoTrue owns it; the image alone does
#      not make it);
#   2. a fresh throwaway from the local stack's image: `auth` restored, every migration before 0052
#      replayed in order;
#   3. a game written before 0052 is there; 0052 applies; a second apply fails and rolls back;
#   4. expand-safe: the running build's insert (no voided_at/void_reason) still works and leaves both
#      null, rated or not; the ingest's early-end insert, an admin void and a restore pass; a voided
#      game that is rated, a void without a reason, a reason without a void and an unknown reason are
#      refused;
#   5. anon and authenticated read voided_at (games is public-read) and write nothing;
#   6. if the local stack has 0052, its two columns, checks and comments match the throwaway's (one
#      read-only catalog select).
#
# Usage: packages/db/scripts/m23-1-throwaway-check.sh [0052 path]. Needs Docker and the local stack
# running (`pnpm db:start`), which it only reads (pg_dump and one catalog select).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0052_game_voided.sql}"
DIR="$(cd "$(dirname "$MIGRATION")" && pwd)"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m231-throwaway-$$"
WORK="$(mktemp -d)"

[[ -f "$MIGRATION" ]] || { echo "no migration at $MIGRATION" >&2; exit 1; }
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$LOCAL_DB")"

cleanup() {
  docker rm -f "$THROWAWAY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_t() { docker exec -i "$THROWAWAY" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER_T:-postgres}" -h localhost -d postgres "$@"; }
q() { psql_t -At -c "$1"; }
expect_eq() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label: got '$actual', expected '$expected'" >&2
    exit 1
  fi
  echo "ok: $label"
}
must_fail() {
  local label="$1" sql="$2"
  if printf 'begin;\n%s\nrollback;\n' "$sql" | psql_t -q >/dev/null 2>&1; then
    echo "FAIL: $label was accepted" >&2
    exit 1
  fi
  echo "ok: refused $label"
}
must_pass() { printf 'begin;\n%s\nrollback;\n' "$1" | psql_t -qAt; }

G1=00000000-0000-4000-8000-0000000231a1
GOLD=00000000-0000-4000-8000-0000000231b1
GNEW=00000000-0000-4000-8000-0000000231b2

echo "== 1. read-only dump of $LOCAL_DB's auth schema"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=auth -f /tmp/m231.dump
docker cp "$LOCAL_DB:/tmp/m231.dump" "$WORK/auth.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m231.dump

echo "== 2. throwaway $THROWAWAY on $IMAGE, every migration before 0052"
docker run -d --name "$THROWAWAY" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$THROWAWAY" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 5
docker cp "$WORK/auth.dump" "$THROWAWAY:/tmp/auth.dump"
PGUSER_T=supabase_admin psql_t -q -c 'drop schema if exists auth cascade; create schema auth;' 2>/dev/null
docker exec "$THROWAWAY" pg_restore -U supabase_admin -h localhost -d postgres --schema=auth /tmp/auth.dump
for file in "$DIR"/*.sql; do
  [[ "$(basename "$file")" < "0052" ]] || continue
  docker cp "$file" "$THROWAWAY:/tmp/replay.sql"
  if ! psql_t -q -f /tmp/replay.sql >"$WORK/replay.log" 2>&1; then
    echo "FAIL: replay stopped at $(basename "$file")" >&2
    tail -5 "$WORK/replay.log" >&2
    exit 1
  fi
done
echo "ok: replayed up to $(ls "$DIR" | awk '$0 < "0052"' | tail -1)"

echo "== 3. 0052 over a game written before it"
psql_t -q <<SQL
insert into public.groups (id, slug, name) values ('$G1', 'm231-one', 'M23.1 one');
insert into public.games (id, lcu_game_id, started_at, duration_s, winning_side, raw, group_id)
  values ('$GOLD', 231001, now() - interval '1 day', 1900, 100, '{}', '$G1');
SQL
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0052.sql"
psql_t -q -f /tmp/0052.sql
if psql_t -q -f /tmp/0052.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply of 0052 succeeded" >&2
  exit 1
fi
echo "ok: 0052 applied; a second apply fails and rolls back"
expect_eq "the older game is rated and not voided" "$(q "select rated || ':' || coalesce(voided_at::text, '-') from public.games where id = '$GOLD'")" "true:-"

echo "== 4. expand-safe, void, restore, the check"
expect_eq "the running build's insert (no voided_at) leaves it null" \
  "$(must_pass "insert into public.games (id, lcu_game_id, started_at, duration_s, winning_side, raw, group_id, rated)
  values ('$GNEW', 231002, now(), 1900, 200, '{}', '$G1', false);
select rated || ':' || coalesce(voided_at::text, '-') || ':' || coalesce(void_reason, '-') from public.games where id = '$GNEW';")" "false:-:-"
expect_eq "an early-end insert (the ingest's stamp) passes" \
  "$(must_pass "insert into public.games (lcu_game_id, started_at, duration_s, winning_side, raw, group_id, rated, voided_at, void_reason)
  values (231003, now(), 632, 100, '{}', '$G1', false, now(), 'early-end') returning void_reason;")" "early-end"
expect_eq "an admin void (rated false, voided_at now, admin) passes" \
  "$(must_pass "update public.games set rated = false, voided_at = now(), void_reason = 'admin' where id = '$GOLD' and voided_at is null and rated returning rated;")" "f"
expect_eq "a restore (rated true, both null) passes" \
  "$(must_pass "update public.games set rated = false, voided_at = now(), void_reason = 'admin' where id = '$GOLD';
update public.games set rated = true, voided_at = null, void_reason = null where id = '$GOLD' and voided_at is not null returning rated;")" "t"
must_fail "a voided game that is rated" "update public.games set voided_at = now(), void_reason = 'admin' where id = '$GOLD';"
must_fail "rating a voided game without clearing the stamp" \
  "update public.games set rated = false, voided_at = now(), void_reason = 'admin' where id = '$GOLD'; update public.games set rated = true where id = '$GOLD';"
must_fail "a void with no reason" "update public.games set rated = false, voided_at = now() where id = '$GOLD';"
must_fail "a reason with no void" "update public.games set void_reason = 'admin' where id = '$GOLD';"
must_fail "an unknown reason" "update public.games set rated = false, voided_at = now(), void_reason = 'other' where id = '$GOLD';"

echo "== 5. grants"
for role in anon authenticated; do
  expect_eq "$role reads voided_at" "$(must_pass "set local role $role; select count(*) from public.games where voided_at is null;")" "1"
  must_fail "$role writing voided_at" "set local role $role; update public.games set rated = false, voided_at = now(), void_reason = 'admin' where id = '$GOLD' returning id;
do \$\$ begin if (select voided_at from public.games where id = '$GOLD') is null then raise exception 'nothing written'; end if; end \$\$;"
done

echo "== 6. the local stack runs the same 0052 (a read-only catalog select on $LOCAL_DB)"
FP="select 'col ' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-')
  from information_schema.columns where table_schema = 'public' and table_name = 'games' and column_name in ('voided_at', 'void_reason')
  union all select 'ck ' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.games'::regclass and conname in ('games_voided_not_rated', 'games_void_reason')
  union all select 'cm ' || attname || ':' || md5(col_description('public.games'::regclass, attnum)) from pg_attribute
  where attrelid = 'public.games'::regclass and attname in ('voided_at', 'void_reason')
  order by 1"
if [[ "$(docker exec "$LOCAL_DB" psql -X -U postgres -d postgres -At -c "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'games' and column_name = 'voided_at'")" == "1" ]]; then
  diff <(docker exec "$LOCAL_DB" psql -X -U postgres -d postgres -At -c "$FP") <(q "$FP") >&2 || {
    echo "FAIL: local games.voided_at differs from the file" >&2
    exit 1
  }
  echo "ok: local games.voided_at and void_reason, their checks and comments match the file"
else
  echo "skip: 0052 is not applied on $LOCAL_DB"
fi

echo "ALL CHECKS PASSED"
