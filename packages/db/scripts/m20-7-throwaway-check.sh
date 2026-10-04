#!/usr/bin/env bash
# M20.7: checks 0047_mode_one_row.sql on a throwaway database, never on the shared local stack.
#
#   1. a read-only pg_dump of the local stack's `auth` schema (GoTrue owns it; the image alone does
#      not make it);
#   2. a fresh throwaway from the local stack's image: `auth` restored, every migration before 0047
#      replayed in order, and a pre-0047 state seeded (a group with region wars pending and no pair,
#      a class rule on another, a lobby with a lock, a game);
#   3. apply 0047: (c) empties the pairless region rule with its Rated and setter and leaves the
#      class rule; a second apply fails and rolls back;
#   4. columns: version, lock_version, lock_no_draw, rule_no_draw gone; the pair columns there;
#   5. checks: a region rule with no pair, one region twice, a pair on another rule, a region lock
#      with a null region are refused; a lock with a null lock_rated is accepted;
#   6. mode_hand_back: core's handBack table (empty row, newer rule, newer Rated, same rule);
#      twice is once; the trigger hands back on balanced -> open and drops the lock;
#   7. mode_take: locked (row emptied), exists (a second take), stale (the row moved), no-draw
#      (row kept), a status outside the list;
#   8. grants: anon and authenticated read the pair and never pending_set_by, and execute neither
#      function; service_role executes both;
#   9. if the local stack has 0047, its functions and checks match the file's (one read-only
#      catalog select).
#
# Usage: packages/db/scripts/m20-7-throwaway-check.sh [migrations dir]. Needs Docker and the local
# stack running (`pnpm db:start`), which it only reads (pg_dump and one catalog select).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${1:-$HERE/../supabase/migrations}"
MIGRATION="$DIR/0047_mode_one_row.sql"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m207-throwaway-$$"
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

echo "== 1. read-only dump of $LOCAL_DB's auth schema"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=auth -f /tmp/m207.dump
docker cp "$LOCAL_DB:/tmp/m207.dump" "$WORK/auth.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m207.dump

echo "== 2. throwaway $THROWAWAY on $IMAGE, every migration before 0047"
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
  [[ "$(basename "$file")" < "0047" ]] || continue
  docker cp "$file" "$THROWAWAY:/tmp/replay.sql"
  if ! psql_t -q -f /tmp/replay.sql >"$WORK/replay.log" 2>&1; then
    echo "FAIL: replay stopped at $(basename "$file")" >&2
    tail -5 "$WORK/replay.log" >&2
    exit 1
  fi
done
echo "ok: replayed up to $(ls "$DIR" | awk '$0 < "0047"' | tail -1)"

G1=00000000-0000-4000-8000-0000000207a1
G2=00000000-0000-4000-8000-0000000207a2
L1=00000000-0000-4000-8000-0000000207b1
psql_t -q <<SQL
insert into public.groups (id, slug, name) values ('$G1', 'm207-one', 'M20.7 one'), ('$G2', 'm207-two', 'M20.7 two');
insert into public.players (id, puuid) values ('00000000-0000-4000-8000-0000000207c1', 'm207-setter');
update public.group_modes set pending_rule = 'region', rated_override = true,
  pending_set_by = '00000000-0000-4000-8000-0000000207c1', version = version + 1 where group_id = '$G1';
update public.group_modes set mode = 'fearless', pending_rule = 'class', pending_class_tag = 'Tank', rated_override = false
  where group_id = '$G2';
insert into public.lobbies (id, group_id, lcu_party_id, status, lock_mode, lock_rule, lock_class_tag, lock_rated, lock_version, locked_at)
  values ('$L1', '$G2', 'm207-party', 'balanced', 'fearless', 'class', 'Mage', false, 3, now());
SQL
echo "ok: pre-0047 state seeded"

echo "== 3. apply 0047"
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0047.sql"
psql_t -q -f /tmp/0047.sql
if psql_t -q -f /tmp/0047.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply succeeded" >&2
  exit 1
fi
echo "ok: a second apply fails and rolls back"
expect_eq "(c) a pairless region rule is emptied with its Rated and setter" \
  "$(q "select coalesce(pending_rule, '-') || ':' || coalesce(rated_override::text, '-') || ':' || coalesce(pending_set_by::text, '-') from public.group_modes where group_id = '$G1'")" \
  "-:-:-"
expect_eq "(c) a class rule is left as it was" \
  "$(q "select pending_rule || ':' || pending_class_tag || ':' || rated_override from public.group_modes where group_id = '$G2'")" \
  "class:Tank:false"
expect_eq "the lock survives without its version" \
  "$(q "select lock_mode || ':' || lock_rule || ':' || lock_class_tag || ':' || lock_rated from public.lobbies where id = '$L1'")" \
  "fearless:class:Mage:false"

echo "== 4. columns"
expect_eq "dropped columns" "$(q "select count(*) from information_schema.columns where table_schema = 'public' and
  ((table_name = 'group_modes' and column_name = 'version') or (table_name = 'lobbies' and column_name in ('lock_version', 'lock_no_draw'))
  or (table_name = 'games' and column_name = 'rule_no_draw'))")" "0"
expect_eq "pair columns" "$(q "select string_agg(column_name || ':' || is_nullable, ',' order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'group_modes' and column_name like 'pending_region_%'")" \
  "pending_region_blue:YES,pending_region_red:YES"

echo "== 5. checks"
must_fail "a region rule with no pair" "update public.group_modes set pending_rule = 'region' where group_id = '$G1';"
must_fail "a region rule with one region" "update public.group_modes set pending_rule = 'region', pending_region_blue = 'ionia' where group_id = '$G1';"
must_fail "one region twice" "update public.group_modes set pending_rule = 'region', pending_region_blue = 'ionia', pending_region_red = 'ionia' where group_id = '$G1';"
must_fail "unaffiliated" "update public.group_modes set pending_rule = 'region', pending_region_blue = 'unaffiliated', pending_region_red = 'ionia' where group_id = '$G1';"
must_fail "a pair on another rule" "update public.group_modes set pending_rule = 'mirror', pending_region_blue = 'ionia', pending_region_red = 'noxus' where group_id = '$G1';"
must_fail "a region lock with a null region" "update public.lobbies set lock_rule = 'region', lock_class_tag = null, lock_region_blue = 'ionia' where id = '$L1';"
must_fail "a lock with no time" "update public.lobbies set locked_at = null where id = '$L1';"
expect_eq "a region rule with its pair" "$(must_pass "update public.group_modes set pending_rule = 'region', pending_region_blue = 'ionia', pending_region_red = 'noxus' where group_id = '$G1'; select 1;")" "1"
expect_eq "a lock with Rated null (the default)" "$(must_pass "update public.lobbies set lock_rated = null where id = '$L1'; select 1;")" "1"

echo "== 6. mode_hand_back (core handBack) and the teams-down trigger"
row() { q "select coalesce(pending_rule, '-') || ':' || coalesce(pending_class_tag, pending_region_blue, '-') || ':' || coalesce(rated_override::text, '-') from public.group_modes where group_id = '$G1'"; }
hb() { must_pass "update public.group_modes set mode = 'normal', pending_rule = $1, pending_class_tag = $2, pending_region_blue = null, pending_region_red = null, rated_override = $3 where group_id = '$G1';
select public.mode_hand_back('$G1', $4, $5, $6, $7, $8) \\g /dev/null
select public.mode_hand_back('$G1', $4, $5, $6, $7, $8) \\g /dev/null
select coalesce(pending_rule, '-') || ':' || coalesce(pending_class_tag, pending_region_blue, '-') || ':' || coalesce(pending_region_red, '-') || ':' || coalesce(rated_override::text, '-') from public.group_modes where group_id = '$G1';"; }
expect_eq "empty row: rule (pair as locked) and Rated back, twice = once" \
  "$(hb null null null "'region'" null "'zaun'" "'noxus'" true)" "region:zaun:noxus:true"
expect_eq "a newer rule keeps the row and its default" \
  "$(hb "'mirror'" null null "'class'" "'Tank'" null null false)" "mirror:-:-:-"
expect_eq "a newer Rated keeps it; the rule comes back" \
  "$(hb null null false "'class'" "'Tank'" null null true)" "class:Tank:-:false"
expect_eq "the same rule re-picked gets its Rated back" \
  "$(hb "'class'" "'Tank'" null "'class'" "'Tank'" null null false)" "class:Tank:-:false"
expect_eq "another class does not" \
  "$(hb "'class'" "'Mage'" null "'class'" "'Tank'" null null false)" "class:Mage:-:-"
expect_eq "a standing lock gives only Rated, into an empty row" \
  "$(hb null null null null null null null false)" "-:-:-:false"
TRIG="$(must_pass "update public.group_modes set pending_rule = null, pending_class_tag = null, rated_override = null where group_id = '$G2';
update public.lobbies set lock_rated = false where id = '$L1';
update public.lobbies set status = 'open' where id = '$L1';
select (select coalesce(lock_mode, '-') from public.lobbies where id = '$L1') || ':' ||
  (select pending_rule || ':' || pending_class_tag || ':' || rated_override from public.group_modes where group_id = '$G2');")"
expect_eq "teams down hand the lock back and drop it" "$TRIG" "-:class:Mage:false"

echo "== 7. mode_take"
L2=00000000-0000-4000-8000-0000000207b2
take() { echo "select public.mode_take('$L2', '$G1', array['balanced'], $1);"; }
SEED="update public.group_modes set mode = 'normal', pending_rule = 'class', pending_class_tag = 'Tank', pending_region_blue = null, pending_region_red = null, rated_override = true where group_id = '$G1';
insert into public.lobbies (id, group_id, lcu_party_id, status) values ('$L2', '$G1', 'm207-take', 'balanced');"
READ="'normal', 'class', 'Tank', null, null, true"
LOCK="'normal', 'class', 'Tank', null, null, true"
expect_eq "locked: the lock written, the row emptied" "$(must_pass "$SEED
$(take "$READ, $LOCK, true")
select lock_rule || ':' || lock_class_tag || ':' || lock_rated || '|' || coalesce(gm.pending_rule, '-') || ':' || coalesce(gm.rated_override::text, '-')
  from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L2';")" \
  "$(printf 'locked\nclass:Tank:true|-:-')"
expect_eq "exists: a second take writes nothing" "$(must_pass "$SEED
$(take "$READ, $LOCK, true")
update public.group_modes set pending_rule = 'mirror', pending_class_tag = null where group_id = '$G1';
$(take "'normal', 'mirror', null, null, null, null, 'normal', 'mirror', null, null, null, null, true")
select lock_rule || ':' || gm.pending_rule from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L2';")" \
  "$(printf 'locked\nexists\nclass:mirror')"
expect_eq "stale: the row moved since the read, nothing written" "$(must_pass "$SEED
update public.group_modes set pending_class_tag = 'Mage' where group_id = '$G1';
$(take "$READ, $LOCK, true")
select coalesce(lock_mode, '-') || '|' || gm.pending_class_tag from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L2';")" \
  "$(printf 'stale\n-|Mage')"
expect_eq "no-draw: the standing lock, the row kept" "$(must_pass "$SEED
update public.group_modes set pending_rule = 'region', pending_class_tag = null, pending_region_blue = 'ionia', pending_region_red = 'noxus', rated_override = false where group_id = '$G1';
$(take "'normal', 'region', null, 'ionia', 'noxus', false, 'normal', null, null, null, null, false, false")
select lock_mode || ':' || coalesce(lock_rule, '-') || ':' || lock_rated || '|' || gm.pending_rule || ':' || gm.pending_region_blue || ':' || gm.rated_override
  from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L2';")" \
  "$(printf 'locked\nnormal:-:false|region:ionia:false')"
expect_eq "a status outside the list" "$(must_pass "$SEED
update public.lobbies set status = 'in_game' where id = '$L2';
$(take "$READ, $LOCK, true")")" "exists"

echo "== 8. grants"
for role in anon authenticated; do
  expect_eq "$role reads the pair" "$(must_pass "set local role $role; select count(pending_region_blue) >= 0 from public.group_modes;")" "t"
  must_fail "$role reads pending_set_by" "set local role $role; select pending_set_by from public.group_modes;"
  must_fail "$role runs mode_hand_back" "set local role $role; select public.mode_hand_back('$G1', null, null, null, null, null);"
  must_fail "$role runs mode_take" "set local role $role; select public.mode_take('$L1', '$G1', array['balanced'], 'normal', null, null, null, null, null, 'normal', null, null, null, null, null, true);"
done
expect_eq "service_role runs both" "$(must_pass "set local role service_role;
select public.mode_hand_back('$G1', null, null, null, null, null) \\g /dev/null
select public.mode_take('$L1', '$G2', array['balanced'], 'normal', null, null, null, null, null, 'normal', null, null, null, null, null, true);")" "stale"

echo "== 9. the local stack runs the same 0047 (a read-only catalog select on $LOCAL_DB)"
FP="select proname || ':' || md5(prosrc) from pg_proc where proname in ('mode_take', 'mode_hand_back', 'lobbies_drop_mode_lock')
  union all select conname || ':' || md5(pg_get_constraintdef(oid)) from pg_constraint
  where conname in ('group_modes_pending_regions', 'lobbies_lock_regions', 'lobbies_lock_whole') order by 1"
LOCAL_FP="$(docker exec "$LOCAL_DB" psql -X -U postgres -d postgres -At -c "$FP")"
if [[ "$LOCAL_FP" == *mode_take* ]]; then
  expect_eq "local functions and checks match the file" "$LOCAL_FP" "$(q "$FP")"
else
  echo "skip: 0047 is not applied on $LOCAL_DB"
fi

echo "ALL CHECKS PASSED"
