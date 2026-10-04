#!/usr/bin/env bash
# m19-9-throwaway-check.sh  (M19.9: verify 0037 without touching the shared stack)
#
# Applies 0037_group_live.sql to a THROWAWAY Postgres restored from a read-only pg_dump of the
# local stack, then checks it. The shared local stack is only ever read (pg_dump); hosted is never
# touched.
#
#   packages/db/scripts/m19-9-throwaway-check.sh [path/to/0037_group_live.sql]
#
# The local stack may already carry 0037 (it is applied there for the integration tests), so the
# throwaway first removes 0037's objects if the dump brought them, which is the state every
# database is in before the migration.
#
# Checks, all on the throwaway:
#   1. the migration applies (it carries its own begin/commit) and a second apply fails cleanly
#      (the table exists), leaving the first intact;
#   2. exactly the four columns with the documented types; one row per group, version 0, kind
#      roster; a new group gets its row from the trigger; a deleted group takes its row along;
#   3. the checks refuse a kind outside the list and a negative version;
#   4. RLS is on with exactly one policy; anon and authenticated can select and cannot insert,
#      update, delete or execute bump_group_live; service_role can, and the bump moves version by
#      one and stamps the kind;
#   5. group_live is in supabase_realtime;
#   6. replay (stands in for `pnpm db:reset`, M19.9 acceptance 4): a second fresh throwaway from the
#      same image, `auth` restored from the same dump (GoTrue's schema, which the image lacks), then
#      every numbered file in this folder in order; every group ends with its row;
#   7. the container is removed (also on failure).
#
# Exit 0 only when every check passes. Needs Docker and the local stack running (`pnpm db:start`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0037_group_live.sql}"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m199-throwaway-$$"
WORK="$(mktemp -d)"

[[ -f "$MIGRATION" ]] || { echo "no migration at $MIGRATION" >&2; exit 1; }
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$LOCAL_DB")"

cleanup() {
  docker rm -f "$THROWAWAY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_t() { docker exec -i "$THROWAWAY" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER_T:-postgres}" -h localhost -d postgres "$@"; }
# Exits with a message unless the two values are equal.
expect_eq() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label: got '$actual', expected '$expected'" >&2
    exit 1
  fi
}
# Runs SQL that must FAIL inside a rolled-back transaction; exits non-zero if it succeeds.
must_fail() {
  local label="$1" sql="$2"
  if printf 'begin;\n%s\nrollback;\n' "$sql" | psql_t -q >/dev/null 2>&1; then
    echo "FAIL: $label was accepted" >&2
    exit 1
  fi
  echo "ok: refused $label"
}
# Runs SQL that must SUCCEED inside a rolled-back transaction and prints what it selected.
must_pass() {
  local sql="$1"
  printf 'begin;\n%s\nrollback;\n' "$sql" | psql_t -qAt
}

echo "== 1. read-only dump of $LOCAL_DB"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=public --schema=auth -f /tmp/m199.dump
docker cp "$LOCAL_DB:/tmp/m199.dump" "$WORK/local.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m199.dump

echo "== 2. throwaway $THROWAWAY on $IMAGE"
docker run -d --name "$THROWAWAY" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$THROWAWAY" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 5
docker cp "$WORK/local.dump" "$THROWAWAY:/tmp/local.dump"
PGUSER_T=supabase_admin psql_t -q -c 'drop schema auth cascade; drop schema public cascade;' 2>/dev/null
docker exec "$THROWAWAY" pg_restore -U supabase_admin -h localhost -d postgres /tmp/local.dump
PGUSER_T=supabase_admin psql_t -q <<'SQL'
-- The state before 0037, whatever the dump brought.
drop trigger if exists groups_insert_live on public.groups;
drop function if exists public.groups_insert_live();
drop function if exists public.bump_group_live(uuid, text);
drop table if exists public.group_live;
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;
SQL
GROUP_COUNT="$(psql_t -At -c 'select count(*) from public.groups')"
echo "ok: pre-0037 state, $GROUP_COUNT groups"

echo "== 3. apply 0037"
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0037.sql"
psql_t -q -f /tmp/0037.sql
if psql_t -q -f /tmp/0037.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply succeeded" >&2
  exit 1
fi
echo "ok: a second apply fails and rolls back"

echo "== 4. columns, rows, trigger, cascade"
psql_t -At -c "select column_name || ':' || data_type || ':' || is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'group_live' order by column_name" | tee "$WORK/cols.txt"
diff <(printf 'changed_at:timestamp with time zone:NO\ngroup_id:uuid:NO\nkind:text:NO\nversion:bigint:NO\n') "$WORK/cols.txt"
expect_eq "rows" "$(psql_t -At -c 'select count(*) from public.group_live')" "$GROUP_COUNT"
expect_eq "rows not at 0:roster" \
  "$(psql_t -At -c "select count(*) from public.group_live where version <> 0 or kind <> 'roster'")" "0"
expect_eq "groups with no row" \
  "$(psql_t -At -c 'select count(*) from public.groups g left join public.group_live l on l.group_id = g.id where l.group_id is null')" "0"
echo "ok: one row per group ($GROUP_COUNT), all at 0:roster"
NEW="$(must_pass "insert into public.groups (id, slug, name) values ('00000000-0000-4000-8000-0000000019a9', 'm199-new', 'M19.9 new');
select version || ':' || kind from public.group_live where group_id = '00000000-0000-4000-8000-0000000019a9';")"
expect_eq "a new group's row" "$NEW" "0:roster"
echo "ok: a new group gets its row from groups_insert_live (rolled back)"
GONE="$(must_pass "insert into public.groups (id, slug, name) values ('00000000-0000-4000-8000-0000000019aa', 'm199-gone', 'M19.9 gone');
delete from public.groups where id = '00000000-0000-4000-8000-0000000019aa';
select count(*) from public.group_live where group_id = '00000000-0000-4000-8000-0000000019aa';")"
expect_eq "a deleted group's rows" "$GONE" "0"
echo "ok: a deleted group takes its row along (rolled back)"

echo "== 5. checks"
# One fixed group, read once: a `limit 1` subquery may name a different row after an update.
ANY="'$(psql_t -At -c 'select group_id from public.group_live order by group_id limit 1')'::uuid"
must_fail "kind 'players'" "update public.group_live set kind = 'players' where group_id = $ANY;"
must_fail "version -1" "update public.group_live set version = -1 where group_id = $ANY;"

echo "== 6. RLS, grants, the one writer"
expect_eq "RLS on" "$(psql_t -At -c "select relrowsecurity from pg_class where oid = 'public.group_live'::regclass")" "t"
expect_eq "policies" \
  "$(psql_t -At -c "select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_live'")" "1"
for role in anon authenticated; do
  expect_eq "$role privileges" "$(psql_t -At -c "select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'group_live' and grantee = '$role'")" "SELECT"
  expect_eq "$role reads" "$(must_pass "set local role $role; select count(*) from public.group_live;")" "$GROUP_COUNT"
  must_fail "$role insert" "set local role $role; insert into public.group_live (group_id, kind) values (gen_random_uuid(), 'game');"
  must_fail "$role update" "set local role $role; update public.group_live set version = 9;"
  must_fail "$role delete" "set local role $role; delete from public.group_live;"
  must_fail "$role bump" "set local role $role; select public.bump_group_live($ANY, 'game');"
  echo "ok: $role reads every row and writes none"
done
BUMP="$(must_pass "set local role service_role;
select public.bump_group_live($ANY, 'game') \\g /dev/null
select public.bump_group_live($ANY, 'split') \\g /dev/null
select version || ':' || kind from public.group_live where group_id = $ANY;")"
expect_eq "two service-role bumps" "$BUMP" "2:split"
echo "ok: service_role bumps, version + 1 each, kind stamped (rolled back)"

echo "== 7. published"
expect_eq "published" \
  "$(psql_t -At -c "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_live'")" "1"
echo "ok: group_live is in supabase_realtime"

echo "== 8. replay: every migration in this folder, in order, on a second fresh throwaway"
# What `pnpm db:reset` does to the schema, without touching the shared stack: a clean database
# from the same image, then each numbered file in order. Stands in for M19.9 acceptance 4.
docker rm -f "$THROWAWAY" >/dev/null
docker run -d --name "$THROWAWAY" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$THROWAWAY" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 5
# GoTrue owns `auth` and creates it before any migration runs; the image alone does not. Take it
# from the same dump (schema and rows), exactly what the stack's Auth service would have made.
docker cp "$WORK/local.dump" "$THROWAWAY:/tmp/local.dump"
PGUSER_T=supabase_admin psql_t -q -c 'drop schema if exists auth cascade; create schema auth;' 2>/dev/null
docker exec "$THROWAWAY" pg_restore -U supabase_admin -h localhost -d postgres --schema=auth /tmp/local.dump
for file in "$(dirname "$MIGRATION")"/*.sql; do
  docker cp "$file" "$THROWAWAY:/tmp/replay.sql"
  if ! psql_t -q -f /tmp/replay.sql >"$WORK/replay.log" 2>&1; then
    echo "FAIL: replay stopped at $(basename "$file")" >&2
    tail -5 "$WORK/replay.log" >&2
    exit 1
  fi
done
expect_eq "rows after replay" "$(psql_t -At -c 'select count(*) from public.group_live')" \
  "$(psql_t -At -c 'select count(*) from public.groups')"
echo "ok: every migration replays clean; every group has its row"

echo "ALL CHECKS PASSED"
