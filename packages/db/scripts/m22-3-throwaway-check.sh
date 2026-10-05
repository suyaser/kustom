#!/usr/bin/env bash
# M22.3: checks 0050_token_current_party.sql on a throwaway database, never on the shared local stack.
#
#   1. a read-only pg_dump of the local stack's `auth` schema (GoTrue owns it; the image alone does
#      not make it);
#   2. a fresh throwaway from the local stack's image: `auth` restored, every migration before 0050
#      replayed in order, and a pre-0050 token seeded;
#   3. 0050: applies; a second apply fails and rolls back; the old token reads null/null; the old
#      build's insert and last_seen_at write still land; the pair and not-blank checks refuse half a
#      party and a blank one; the partial index exists; anon and authenticated read neither column
#      (0001's revoke holds) and service_role writes both;
#   4. if the local stack has 0050, its companion_tokens columns, checks and indexes match the
#      throwaway's (one read-only catalog select).
#
# Usage: packages/db/scripts/m22-3-throwaway-check.sh [0050 path]. Needs Docker and the local stack
# running (`pnpm db:start`), which it only reads (pg_dump and one catalog select).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0050_token_current_party.sql}"
DIR="$(cd "$(dirname "$MIGRATION")" && pwd)"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m223-throwaway-$$"
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

G1=00000000-0000-4000-8000-0000000223a1
P1=00000000-0000-4000-8000-0000000223c1
T1=00000000-0000-4000-8000-0000000223d1
T2=00000000-0000-4000-8000-0000000223d2

echo "== 1. read-only dump of $LOCAL_DB's auth schema"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=auth -f /tmp/m223.dump
docker cp "$LOCAL_DB:/tmp/m223.dump" "$WORK/auth.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m223.dump

echo "== 2. throwaway $THROWAWAY on $IMAGE, every migration before 0050"
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
  [[ "$(basename "$file")" < "0050" ]] || continue
  docker cp "$file" "$THROWAWAY:/tmp/replay.sql"
  if ! psql_t -q -f /tmp/replay.sql >"$WORK/replay.log" 2>&1; then
    echo "FAIL: replay stopped at $(basename "$file")" >&2
    tail -5 "$WORK/replay.log" >&2
    exit 1
  fi
done
echo "ok: replayed up to $(ls "$DIR" | awk '$0 < "0050"' | tail -1)"
psql_t -q <<SQL
insert into public.groups (id, slug, name) values ('$G1', 'm223-one', 'M22.3 one');
insert into public.players (id, puuid) values ('$P1', 'm223-host');
insert into public.group_memberships (group_id, player_id, role) values ('$G1', '$P1', 'owner') on conflict do nothing;
insert into public.companion_tokens (id, player_id, token_hash, group_id, last_seen_at)
  values ('$T1', '$P1', 'm223-hash-1', '$G1', now());
SQL
echo "ok: pre-0050 token seeded"

echo "== 3. 0050"
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0050.sql"
psql_t -q -f /tmp/0050.sql
if psql_t -q -f /tmp/0050.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply of 0050 succeeded" >&2
  exit 1
fi
echo "ok: 0050 applied; a second apply fails and rolls back"

expect_eq "the old token has no current party" \
  "$(q "select coalesce(current_party_id, '-') || ':' || coalesce(current_party_at::text, '-') from public.companion_tokens where id = '$T1'")" "-:-"
expect_eq "the old build's insert and last_seen_at write still land" \
  "$(must_pass "insert into public.companion_tokens (id, player_id, token_hash, group_id) values ('$T2', '$P1', 'm223-hash-2', '$G1');
update public.companion_tokens set last_seen_at = now() where id = '$T2';
select count(*) from public.companion_tokens where id = '$T2' and current_party_id is null and last_seen_at is not null;")" "1"
expect_eq "a party with its time lands" \
  "$(must_pass "update public.companion_tokens set current_party_id = 'p-1', current_party_at = now() where id = '$T1';
select current_party_id from public.companion_tokens where id = '$T1';")" "p-1"
must_fail "a party without its time" "update public.companion_tokens set current_party_id = 'p-1' where id = '$T1';"
must_fail "a time without a party" "update public.companion_tokens set current_party_at = now() where id = '$T1';"
must_fail "a blank party" "update public.companion_tokens set current_party_id = '', current_party_at = now() where id = '$T1';"
expect_eq "the partial index" \
  "$(q "select indexdef from pg_indexes where indexname = 'companion_tokens_group_party_idx'")" \
  "CREATE INDEX companion_tokens_group_party_idx ON public.companion_tokens USING btree (group_id, current_party_id) WHERE ((revoked_at IS NULL) AND (current_party_id IS NOT NULL))"
for role in anon authenticated; do
  must_fail "$role reading current_party_id" "set local role $role; select current_party_id from public.companion_tokens;"
  must_fail "$role writing current_party_id" "set local role $role; update public.companion_tokens set current_party_id = 'x', current_party_at = now();"
done
expect_eq "service_role writes and reads both" \
  "$(must_pass "set local role service_role;
update public.companion_tokens set current_party_id = 'p-2', current_party_at = now() where id = '$T1';
select current_party_id || ':' || (current_party_at is not null) from public.companion_tokens where id = '$T1';")" "p-2:true"

echo "== 4. the local stack runs the same 0050 (a read-only catalog select on $LOCAL_DB)"
FP="select 'col ' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-')
  from information_schema.columns where table_schema = 'public' and table_name = 'companion_tokens'
  union all select 'ck ' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.companion_tokens'::regclass and contype = 'c'
  union all select 'ix ' || indexdef from pg_indexes where schemaname = 'public' and tablename = 'companion_tokens'
  order by 1"
LOCAL_FP="$(docker exec "$LOCAL_DB" psql -X -U postgres -d postgres -At -c "$FP")"
if [[ "$LOCAL_FP" == *current_party_id* ]]; then
  diff <(echo "$LOCAL_FP") <(q "$FP") >&2 || {
    echo "FAIL: local companion_tokens differs from the files" >&2
    exit 1
  }
  echo "ok: local companion_tokens matches the files"
else
  echo "skip: 0050 is not applied on $LOCAL_DB"
fi

echo "ALL CHECKS PASSED"
