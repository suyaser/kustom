#!/usr/bin/env bash
# M20.7: checks 0047_mode_one_row_expand.sql and 0048_mode_one_row_contract.sql on a throwaway
# database, never on the shared local stack. The two stages are the deploy: 0047 before the code
# (the old build must keep working), 0048 after it.
#
#   1. a read-only pg_dump of the local stack's `auth` schema (GoTrue owns it; the image alone does
#      not make it);
#   2. a fresh throwaway from the local stack's image: `auth` restored, every migration before 0047
#      replayed in order, and a pre-0047 state seeded (a group with region wars pending and no
#      pair, a class rule on another, a lobby with an old-shape lock);
#   3. 0047 (expand): a second apply fails; every old column is still there and the old build's
#      writes still land (a version bump, a pairless region wars, an old-shape lock, a no-draw
#      game); an old lock coming down is dropped with nothing handed back; the lock checks have no
#      NULL hole; mode_hand_back (core's handBack, including an admin write after the lock) and the
#      teams-down trigger; mode_take (locked, exists, stale, no-draw, a status outside the list);
#      grants;
#   4. 0048 (contract): a second apply fails; (c) empties the pairless region wars and keeps the
#      class rule; the four columns are gone; the pair check refuses a region rule without its
#      pair; the lock checks still have no NULL hole; the trigger still hands back;
#   5. if the local stack has 0048, its 0047/0048 functions, checks and columns match the files
#      (one read-only catalog select).
#
# Usage: packages/db/scripts/m20-7-throwaway-check.sh [migrations dir]. Needs Docker and the local
# stack running (`pnpm db:start`), which it only reads (pg_dump and one catalog select).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${1:-$HERE/../supabase/migrations}"
EXPAND="$DIR/0047_mode_one_row_expand.sql"
CONTRACT="$DIR/0048_mode_one_row_contract.sql"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m207-throwaway-$$"
WORK="$(mktemp -d)"

[[ -f "$EXPAND" && -f "$CONTRACT" ]] || { echo "no 0047/0048 in $DIR" >&2; exit 1; }
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
apply_twice() {
  local file="$1" name
  name="$(basename "$file")"
  docker cp "$file" "$THROWAWAY:/tmp/$name"
  psql_t -q -f "/tmp/$name"
  if psql_t -q -f "/tmp/$name" >/dev/null 2>&1; then
    echo "FAIL: a second apply of $name succeeded" >&2
    exit 1
  fi
  echo "ok: $name applied; a second apply fails and rolls back"
}

G1=00000000-0000-4000-8000-0000000207a1
G2=00000000-0000-4000-8000-0000000207a2
L1=00000000-0000-4000-8000-0000000207b1
L2=00000000-0000-4000-8000-0000000207b2

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

# A row of a group, as rule:tag-or-blue:red:rated.
row() { q "select coalesce(pending_rule, '-') || ':' || coalesce(pending_class_tag, pending_region_blue, '-') || ':' || coalesce(pending_region_red, '-') || ':' || coalesce(rated_override::text, '-') from public.group_modes where group_id = '$1'"; }

# Shared by both stages: the lock checks' NULL holes, the hand-back table, the trigger.
lock_checks() {
  must_fail "a region lock with a null region" "update public.lobbies set lock_rule = 'region', lock_class_tag = null, lock_region_blue = 'ionia' where id = '$L1';"
  must_fail "a lock with no time" "update public.lobbies set locked_at = null where id = '$L1';"
  must_fail "no lock_mode with a rule and Rated (the 0032 NULL hole)" \
    "insert into public.lobbies (group_id, lcu_party_id, lock_mode, lock_rule, lock_rated) values ('$G2', 'm207-hole', null, 'mirror', true);"
  expect_eq "a lock with Rated null (the default) and no lock_version" \
    "$(must_pass "insert into public.lobbies (group_id, lcu_party_id, status, lock_mode, lock_rule, locked_at) values ('$G2', 'm207-new', 'balanced', 'normal', 'mirror', now()); select 1;")" "1"
}
hand_back_checks() {
  # hb <row rule> <row tag> <row rated> <lock rule> <lock tag> <lock blue> <lock red> <lock rated> <locked_at>
  hb() { must_pass "update public.group_modes set mode = 'normal', pending_rule = $1, pending_class_tag = $2, pending_region_blue = null, pending_region_red = null, rated_override = $3 where group_id = '$G1';
select public.mode_hand_back('$G1', $4, $5, $6, $7, $8, $9) \\g /dev/null
select public.mode_hand_back('$G1', $4, $5, $6, $7, $8, $9) \\g /dev/null
select coalesce(pending_rule, '-') || ':' || coalesce(pending_class_tag, pending_region_blue, '-') || ':' || coalesce(pending_region_red, '-') || ':' || coalesce(rated_override::text, '-') from public.group_modes where group_id = '$G1';"; }
  local LATER="now() + interval '1 hour'" EARLIER="now() - interval '1 hour'"
  expect_eq "empty row: rule (pair as locked) and Rated back, twice = once" \
    "$(hb null null null "'region'" null "'zaun'" "'noxus'" true "$LATER")" "region:zaun:noxus:true"
  expect_eq "a newer rule keeps the row and its default" \
    "$(hb "'mirror'" null null "'class'" "'Tank'" null null false "$LATER")" "mirror:-:-:-"
  expect_eq "a newer Rated keeps it; the rule comes back (row written before the lock)" \
    "$(hb null null false "'class'" "'Tank'" null null true "$LATER")" "class:Tank:-:false"
  expect_eq "the same rule re-picked gets its Rated back" \
    "$(hb "'class'" "'Tank'" null "'class'" "'Tank'" null null false "$LATER")" "class:Tank:-:false"
  expect_eq "another class does not" \
    "$(hb "'class'" "'Mage'" null "'class'" "'Tank'" null null false "$LATER")" "class:Mage:-:-"
  expect_eq "a standing lock gives only Rated, into an empty row" \
    "$(hb null null null null null null null false "$LATER")" "-:-:-:false"
  expect_eq "an admin write after the lock: nothing comes back (Tanks locked, Normal picked)" \
    "$(hb null null null "'class'" "'Tank'" null null true "$EARLIER")" "-:-:-:-"
}
take_checks() {
  take() { echo "select public.mode_take('$L2', '$G1', array['balanced'], $1);"; }
  local SEED="update public.group_modes set mode = 'normal', pending_rule = 'class', pending_class_tag = 'Tank', pending_region_blue = null, pending_region_red = null, rated_override = true where group_id = '$G1';
insert into public.lobbies (id, group_id, lcu_party_id, status) values ('$L2', '$G1', 'm207-take', 'balanced');"
  local READ="'normal', 'class', 'Tank', null, null, true"
  expect_eq "locked: the lock written, the row emptied at locked_at" "$(must_pass "$SEED
$(take "$READ, $READ, true")
select lock_rule || ':' || lock_class_tag || ':' || lock_rated || '|' || coalesce(gm.pending_rule, '-') || ':' || coalesce(gm.rated_override::text, '-') || ':' || (gm.updated_at = l.locked_at)
  from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L2';")" \
    "$(printf 'locked\nclass:Tank:true|-:-:true')"
  expect_eq "locked then teams down: the untouched row takes the lock back" "$(must_pass "$SEED
$(take "$READ, $READ, true") \\g /dev/null
update public.lobbies set status = 'open' where id = '$L2';
select coalesce(lock_mode, '-') || '|' || gm.pending_rule || ':' || gm.pending_class_tag || ':' || gm.rated_override
  from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L2';")" \
    "$(printf 'locked\n-|class:Tank:true')"
  expect_eq "exists: a second take writes nothing" "$(must_pass "$SEED
$(take "$READ, $READ, true")
update public.group_modes set pending_rule = 'mirror', pending_class_tag = null where group_id = '$G1';
$(take "'normal', 'mirror', null, null, null, null, 'normal', 'mirror', null, null, null, null, true")
select lock_rule || ':' || gm.pending_rule from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L2';")" \
    "$(printf 'locked\nexists\nclass:mirror')"
  expect_eq "stale: the row moved since the read, nothing written" "$(must_pass "$SEED
update public.group_modes set pending_class_tag = 'Mage' where group_id = '$G1';
$(take "$READ, $READ, true")
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
$(take "$READ, $READ, true")")" "exists"
}
grant_checks() {
  for role in anon authenticated; do
    expect_eq "$role reads the pair" "$(must_pass "set local role $role; select count(pending_region_blue) >= 0 from public.group_modes;")" "t"
    must_fail "$role reads pending_set_by" "set local role $role; select pending_set_by from public.group_modes;"
    must_fail "$role runs mode_hand_back" "set local role $role; select public.mode_hand_back('$G1', null, null, null, null, null, null);"
    must_fail "$role runs mode_take" "set local role $role; select public.mode_take('$L1', '$G1', array['balanced'], 'normal', null, null, null, null, null, 'normal', null, null, null, null, null, true);"
  done
  expect_eq "service_role runs both" "$(must_pass "set local role service_role;
select public.mode_hand_back('$G1', null, null, null, null, null, null) \\g /dev/null
select public.mode_take('$L1', '$G2', array['balanced'], 'normal', null, null, null, null, null, 'normal', null, null, null, null, null, true);")" "stale"
}

echo "== 3. 0047 (expand): additive; the old build keeps working"
apply_twice "$EXPAND"
expect_eq "every old column is still there" "$(q "select count(*) from information_schema.columns where table_schema = 'public' and
  ((table_name = 'group_modes' and column_name = 'version') or (table_name = 'lobbies' and column_name in ('lock_version', 'lock_no_draw'))
  or (table_name = 'games' and column_name = 'rule_no_draw'))")" "4"
expect_eq "pair columns" "$(q "select string_agg(column_name || ':' || is_nullable, ',' order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'group_modes' and column_name like 'pending_region_%'")" \
  "pending_region_blue:YES,pending_region_red:YES"
expect_eq "(c) not yet: the pairless region wars is untouched" "$(row "$G1")" "region:-:-:true"
expect_eq "old write: a version bump and a pairless region wars" \
  "$(must_pass "update public.group_modes set pending_rule = 'region', pending_class_tag = null, pending_region_blue = null, version = version + 1 where group_id = '$G2'; select version > 0 from public.group_modes where group_id = '$G2';")" "t"
expect_eq "old write: an old-shape no-draw lock" \
  "$(must_pass "update public.lobbies set lock_rule = null, lock_class_tag = null, lock_rated = true, lock_version = 4, lock_no_draw = true where id = '$L1'; select lock_no_draw from public.lobbies where id = '$L1';")" "t"
expect_eq "old write: a no-draw game" \
  "$(must_pass "insert into public.games (group_id, lcu_game_id, started_at, duration_s, winning_side, mode, rule_no_draw, raw) values ('$G2', 920701, now(), 1800, 100, 'fearless', true, '{}'::jsonb) returning rule_no_draw;")" "t"
expect_eq "an old-shape lock coming down is dropped, nothing handed back" "$(must_pass "update public.group_modes set pending_rule = null, pending_class_tag = null, rated_override = null where group_id = '$G2';
update public.lobbies set status = 'open' where id = '$L1';
select coalesce(lock_mode, '-') || ':' || coalesce(lock_version::text, '-') || ':' || lock_no_draw || '|' || coalesce(gm.pending_rule, '-') || ':' || coalesce(gm.rated_override::text, '-')
  from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L1';")" "-:-:false|-:-"
lock_checks
hand_back_checks
expect_eq "an M20.7 lock (no lock_version) coming down is handed back" "$(must_pass "update public.group_modes set pending_rule = null, pending_class_tag = null, rated_override = null where group_id = '$G2';
-- locked_at in this transaction: the row reset above is not an admin write after the lock.
update public.lobbies set lock_version = null, lock_rated = false, locked_at = now() where id = '$L1';
update public.lobbies set status = 'open' where id = '$L1';
select coalesce(lock_mode, '-') || '|' || gm.pending_rule || ':' || gm.pending_class_tag || ':' || gm.rated_override
  from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L1';")" "-|class:Mage:false"
expect_eq "the same, after an admin write: the lock is dropped and nothing comes back" "$(must_pass "update public.lobbies set lock_version = null, lock_rated = false, locked_at = now() - interval '1 minute' where id = '$L1';
update public.group_modes set pending_rule = null, pending_class_tag = null, rated_override = null where group_id = '$G2';
update public.lobbies set status = 'open' where id = '$L1';
select coalesce(lock_mode, '-') || '|' || coalesce(gm.pending_rule, '-') || ':' || coalesce(gm.rated_override::text, '-')
  from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L1';")" "-|-:-"
take_checks
grant_checks

echo "== 4. 0048 (contract): the drops, the pair check, (c)"
apply_twice "$CONTRACT"
expect_eq "(c) a pairless region rule is emptied with its Rated and setter" \
  "$(q "select coalesce(pending_rule, '-') || ':' || coalesce(rated_override::text, '-') || ':' || coalesce(pending_set_by::text, '-') from public.group_modes where group_id = '$G1'")" \
  "-:-:-"
expect_eq "(c) a class rule is left as it was" "$(row "$G2")" "class:Tank:-:false"
expect_eq "the lock survives without its version" \
  "$(q "select lock_mode || ':' || lock_rule || ':' || lock_class_tag || ':' || lock_rated from public.lobbies where id = '$L1'")" \
  "fearless:class:Mage:false"
expect_eq "dropped columns" "$(q "select count(*) from information_schema.columns where table_schema = 'public' and
  ((table_name = 'group_modes' and column_name = 'version') or (table_name = 'lobbies' and column_name in ('lock_version', 'lock_no_draw'))
  or (table_name = 'games' and column_name = 'rule_no_draw'))")" "0"
must_fail "a region rule with no pair" "update public.group_modes set pending_rule = 'region' where group_id = '$G1';"
must_fail "a region rule with one region" "update public.group_modes set pending_rule = 'region', pending_region_blue = 'ionia' where group_id = '$G1';"
must_fail "one region twice" "update public.group_modes set pending_rule = 'region', pending_region_blue = 'ionia', pending_region_red = 'ionia' where group_id = '$G1';"
must_fail "unaffiliated" "update public.group_modes set pending_rule = 'region', pending_region_blue = 'unaffiliated', pending_region_red = 'ionia' where group_id = '$G1';"
must_fail "a pair on another rule" "update public.group_modes set pending_rule = 'mirror', pending_region_blue = 'ionia', pending_region_red = 'noxus' where group_id = '$G1';"
expect_eq "a region rule with its pair" "$(must_pass "update public.group_modes set pending_rule = 'region', pending_region_blue = 'ionia', pending_region_red = 'noxus' where group_id = '$G1'; select 1;")" "1"
lock_checks
hand_back_checks
expect_eq "teams down hand the lock back and drop it" "$(must_pass "update public.group_modes set pending_rule = null, pending_class_tag = null, rated_override = null where group_id = '$G2';
update public.lobbies set locked_at = now() where id = '$L1';
update public.lobbies set status = 'open' where id = '$L1';
select coalesce(lock_mode, '-') || '|' || gm.pending_rule || ':' || gm.pending_class_tag || ':' || gm.rated_override
  from public.lobbies l join public.group_modes gm on gm.group_id = l.group_id where l.id = '$L1';")" "-|class:Mage:false"
take_checks
grant_checks

echo "== 5. the local stack runs the same 0047 + 0048 (a read-only catalog select on $LOCAL_DB)"
FP="select 'fn ' || proname || ':' || md5(prosrc) from pg_proc where proname in ('mode_take', 'mode_hand_back', 'lobbies_drop_mode_lock')
  union all select 'ck ' || conname || ':' || md5(pg_get_constraintdef(oid)) from pg_constraint
  where conrelid in ('public.group_modes'::regclass, 'public.lobbies'::regclass, 'public.games'::regclass) and contype = 'c'
  union all select 'col ' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-')
  from information_schema.columns where table_schema = 'public' and table_name in ('group_modes', 'lobbies', 'games')
    and column_name not like 'kickoff%'
  order by 1"
LOCAL_FP="$(docker exec "$LOCAL_DB" psql -X -U postgres -d postgres -At -c "$FP")"
if [[ "$LOCAL_FP" == *mode_take* && "$LOCAL_FP" != *lock_version* ]]; then
  diff <(echo "$LOCAL_FP") <(q "$FP" | grep -v '^col .*kickoff') >/dev/null || {
    diff <(echo "$LOCAL_FP") <(q "$FP") >&2 || true
    echo "FAIL: local functions, checks or columns differ from the files" >&2
    exit 1
  }
  echo "ok: local functions, checks and columns match the files"
else
  echo "skip: 0048 is not applied on $LOCAL_DB"
fi

echo "ALL CHECKS PASSED"
