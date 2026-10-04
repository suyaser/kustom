#!/usr/bin/env bash
# m19-11-throwaway-check.sh  (M19.11: verify 0044 without touching the shared stack)
#
# Applies 0044_publication_live_only.sql to a THROWAWAY Postgres restored from a read-only pg_dump
# of the local stack, then checks it. The shared local stack is only ever read (pg_dump); hosted is
# never touched.
#
#   packages/db/scripts/m19-11-throwaway-check.sh [path/to/0044_publication_live_only.sql]
#
# A schema-only dump does not carry publication membership, so the throwaway first rebuilds the
# pre-0044 publication (the nine tables 0001, 0017, 0024 and 0037 published), which is the state
# every database is in before the migration.
#
# Checks, all on the throwaway:
#   1. the migration applies (it carries its own begin/commit) and the publication is exactly
#      fearless_state, group_live and group_modes, with no column list and no row filter;
#   2. a second apply fails (the tables are no longer members) and leaves the first intact;
#   3. the six tables are still there, still RLS-on, still readable by anon under their policies
#      (only their change events stop);
#   4. replay (stands in for `pnpm db:reset`): a second fresh throwaway, `auth` restored from the
#      same dump, then every numbered file in this folder in order; the publication ends exactly the
#      three tables;
#   5. the container is removed (also on failure).
#
# Exit 0 only when every check passes. Needs Docker and the local stack running (`pnpm db:start`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0044_publication_live_only.sql}"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m1911-throwaway-$$"
WORK="$(mktemp -d)"
EXPECTED=$'fearless_state||\ngroup_live||\ngroup_modes||'
# pg_publication_tables.attnames lists every column when there is no column list; prattrs is null then.
PUBLISHED_SQL="select r.prrelid::regclass::text || '|' || coalesce(r.prattrs::text, '') || '|' || coalesce(pg_get_expr(r.prqual, r.prrelid), '')
  from pg_publication_rel r join pg_publication p on p.oid = r.prpubid
  where p.pubname = 'supabase_realtime' order by 1"

[[ -f "$MIGRATION" ]] || { echo "no migration at $MIGRATION" >&2; exit 1; }
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$LOCAL_DB")"

cleanup() {
  docker rm -f "$THROWAWAY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_t() { docker exec -i "$THROWAWAY" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER_T:-postgres}" -h localhost -d postgres "$@"; }
expect_eq() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label: got '$actual', expected '$expected'" >&2
    exit 1
  fi
}
start_throwaway() {
  docker run -d --name "$THROWAWAY" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$THROWAWAY" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
    sleep 2
  done
  sleep 5
}

echo "== 1. read-only dump of $LOCAL_DB"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=public --schema=auth -f /tmp/m1911.dump
docker cp "$LOCAL_DB:/tmp/m1911.dump" "$WORK/local.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m1911.dump

echo "== 2. throwaway $THROWAWAY on $IMAGE, pre-0044 publication"
start_throwaway
docker cp "$WORK/local.dump" "$THROWAWAY:/tmp/local.dump"
PGUSER_T=supabase_admin psql_t -q -c 'drop schema auth cascade; drop schema public cascade;' 2>/dev/null
docker exec "$THROWAWAY" pg_restore -U supabase_admin -h localhost -d postgres /tmp/local.dump
PGUSER_T=supabase_admin psql_t -q <<'SQL'
drop publication if exists supabase_realtime;
create publication supabase_realtime;
alter publication supabase_realtime add table
  public.lobbies, public.lobby_members, public.splits, public.games, public.game_players,
  public.ratings, public.fearless_state, public.group_modes, public.group_live;
SQL
expect_eq "pre-0044 tables" "$(psql_t -At -c "select count(*) from pg_publication_tables where pubname = 'supabase_realtime'")" "9"
echo "ok: nine tables published before 0044"

echo "== 3. apply 0044"
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0044.sql"
psql_t -q -f /tmp/0044.sql
expect_eq "published after 0044" "$(psql_t -At -c "$PUBLISHED_SQL")" "$EXPECTED"
echo "ok: exactly fearless_state, group_live, group_modes; no column list, no row filter"
if psql_t -q -f /tmp/0044.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply succeeded" >&2
  exit 1
fi
expect_eq "published after a failed second apply" "$(psql_t -At -c "$PUBLISHED_SQL")" "$EXPECTED"
echo "ok: a second apply fails and changes nothing"

echo "== 4. the six tables are untouched apart from their events"
for table in lobbies lobby_members splits games game_players ratings; do
  expect_eq "$table RLS" "$(psql_t -At -c "select relrowsecurity from pg_class where oid = 'public.$table'::regclass")" "t"
  printf 'begin;\nset local role anon;\nselect 1 from public.%s limit 0;\nrollback;\n' "$table" | psql_t -q >/dev/null \
    || { echo "FAIL: anon can no longer read public.$table" >&2; exit 1; }
done
echo "ok: all six still RLS-on and anon-readable"

echo "== 5. replay: every migration in this folder, in order, on a second fresh throwaway"
docker rm -f "$THROWAWAY" >/dev/null
start_throwaway
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
expect_eq "published after replay" "$(psql_t -At -c "$PUBLISHED_SQL")" "$EXPECTED"
echo "ok: every migration replays clean; the publication is exactly the three tables"

echo "ALL CHECKS PASSED"
