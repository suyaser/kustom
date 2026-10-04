#!/usr/bin/env bash
# m14-14-throwaway-check.sh  (M14.14 acceptance 3: the lead's call, a documented script, not a CI test)
#
# Proves 0026_remove_seasons.sql keeps every active-season row unchanged and deletes every
# non-active one, on a THROWAWAY Postgres restored from a read-only pg_dump of the local stack.
# The shared local stack is only ever read (pg_dump); hosted is never touched.
#
#   packages/db/scripts/m14-14-throwaway-check.sh [path/to/0026_remove_seasons.sql] [later.sql ...]
#
# Any further files are run after 0026's checks, in order (migrations carry their own begin/commit):
# a migration (e.g. 0027) or a `*-check.sql` file. M14.18:
#   m14-14-throwaway-check.sh 0026_remove_seasons.sql 0027_ratings_reset.sql m14-18-reset-check.sql
#
# Steps:
#   1. pg_dump (read-only) the public and auth schemas of the local stack.
#   2. Start a throwaway container on the same image, restore the dump, and re-add the
#      supabase_realtime publication's tables (pg_dump -n does not carry publication membership).
#   3. Seed a non-active season with games, game_players, a mystery + attempt and ratings
#      (m14-14-seed-old-season.sql), print the drop counts (m14-14-season-drop-counts.sql).
#   4. Fingerprint the active season's rows (m14-14-fingerprint.sql, before=1).
#   5. Check the guard: with no active season the migration aborts and changes nothing.
#   6. Apply the migration (it carries its own begin/commit), fingerprint everything left (before=0), diff.
#   7. Check the schema: no seasons table, no season columns or functions, ratings_pkey is
#      (group_id, player_id), RLS and policies on games/ratings, publication still lists both,
#      and an UPDATE on ratings plus a games insert with no season both work (rolled back).
#   8. Remove the container (also on failure).
#
# Exit 0 only when every check passes. Needs Docker and the local stack running (`pnpm db:start`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0026_remove_seasons.sql}"
shift || true
LATER=("$@")
for f in "${LATER[@]}"; do [[ -f "$f" ]] || { echo "no file at $f" >&2; exit 1; }; done
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m1414-throwaway-$$"
WORK="$(mktemp -d)"

[[ -f "$MIGRATION" ]] || { echo "no migration at $MIGRATION" >&2; exit 1; }
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$LOCAL_DB")"

cleanup() {
  docker rm -f "$THROWAWAY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_t() { docker exec -i "$THROWAWAY" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER_T:-postgres}" -h localhost -d postgres "$@"; }

echo "== 1. read-only dump of $LOCAL_DB"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=public --schema=auth -f /tmp/m1414.dump
docker cp "$LOCAL_DB:/tmp/m1414.dump" "$WORK/local.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m1414.dump

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
psql_t -q -c 'alter publication supabase_realtime add table public.ratings, public.lobbies, public.lobby_members, public.splits, public.games, public.game_players, public.fearless_state, public.group_modes'

echo "== 3. seed a non-active season; drop counts"
for f in m14-14-seed-old-season.sql m14-14-season-drop-counts.sql m14-14-fingerprint.sql; do
  docker cp "$HERE/$f" "$THROWAWAY:/tmp/$f"
done
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0026.sql"
PGUSER_T=supabase_admin psql_t -q -f /tmp/m14-14-seed-old-season.sql
psql_t -c 'set default_transaction_read_only = on' -f /tmp/m14-14-season-drop-counts.sql

echo "== 4. fingerprint of the active season"
psql_t -q -v before=1 -f /tmp/m14-14-fingerprint.sql | tee "$WORK/before.txt"

echo "== 5. guard: no active season aborts"
printf 'begin;\nupdate public.seasons set is_active = false;\n\\i /tmp/0026.sql\nrollback;\n' \
  | docker exec -i "$THROWAWAY" sh -c 'cat > /tmp/guard.sql'
if psql_t -q -f /tmp/guard.sql >"$WORK/guard.txt" 2>&1; then
  echo "FAIL: the migration ran with no active season" >&2; exit 1
fi
grep -q 'expected exactly one active season, found 0' "$WORK/guard.txt" || { cat "$WORK/guard.txt" >&2; exit 1; }
[[ "$(psql_t -tAc 'select count(*) filter (where is_active) from public.seasons')" == "1" ]] || { echo "FAIL: guard left a change" >&2; exit 1; }
echo "guard ok"

echo "== 6. apply 0026 (its own begin/commit); fingerprint what is left"
psql_t -f /tmp/0026.sql
psql_t -q -v before=0 -f /tmp/m14-14-fingerprint.sql | tee "$WORK/after.txt"
diff "$WORK/before.txt" "$WORK/after.txt" && echo "FINGERPRINT IDENTICAL"

echo "== 7. schema checks"
psql_t -tA <<'SQL' | tee "$WORK/schema.txt"
select 'seasons table: ' || coalesce(to_regclass('public.seasons')::text, 'gone');
select 'season columns: ' || count(*) from information_schema.columns where table_schema = 'public' and column_name ilike '%season%';
select 'season functions: ' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ilike '%season%';
select 'ratings pk: ' || pg_get_constraintdef(oid) from pg_constraint where conname = 'ratings_pkey';
select 'rls: ' || string_agg(relname || '=' || relrowsecurity, ',' order by relname) from pg_class where relname in ('games', 'ratings') and relnamespace = 'public'::regnamespace;
select 'policies: ' || count(*) from pg_policies where tablename in ('games', 'ratings');
select 'published: ' || string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('games', 'ratings');
SQL
grep -qx 'seasons table: gone' "$WORK/schema.txt"
grep -qx 'season columns: 0' "$WORK/schema.txt"
grep -qx 'season functions: 0' "$WORK/schema.txt"
grep -qx 'ratings pk: PRIMARY KEY (group_id, player_id)' "$WORK/schema.txt"
grep -qx 'rls: games=true,ratings=true' "$WORK/schema.txt"
grep -qx 'policies: 2' "$WORK/schema.txt"
grep -qx 'published: games,ratings' "$WORK/schema.txt"
psql_t -q <<'SQL'
begin;
update public.ratings set games = games;
insert into public.games (lcu_game_id, started_at, duration_s, winning_side, raw, group_id)
  select 123456789, now(), 1800, 100, '{}'::jsonb, group_id from public.games limit 1;
rollback;
SQL

for f in "${LATER[@]}"; do
  name="$(basename "$f")"
  echo "== later: $name"
  docker cp "$f" "$THROWAWAY:/tmp/$name"
  psql_t -f "/tmp/$name"
done
echo "ALL CHECKS PASSED"
