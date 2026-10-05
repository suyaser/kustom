#!/usr/bin/env bash
# M22.4: checks 0051_lobby_modes.sql on a throwaway database, never on the shared local stack.
#
#   1. a read-only pg_dump of the local stack's `auth` schema (GoTrue owns it; the image alone does
#      not make it);
#   2. a fresh throwaway from the local stack's image: `auth` restored, every migration before 0051
#      replayed in order;
#   3. 0051: applies; a second apply fails and rolls back;
#   4. the fork trigger (in play = live with a token whose current party it is): the first lobby
#      never forks; a second lobby while another is in play forks a copy of the group card (rule,
#      pair, Rated; never the standing mode); a host whose token moved to the new custom, a finished
#      lobby nobody's Kustom is in, an in_game lobby with no token (an old build), a stale or revoked
#      token, and a new cycle of a live lobby write nothing; the same host's second Kustom still in
#      the old custom forks; a new lobby alone deletes a left-over row of its party; a second fork of
#      the same party overwrites a stale row; the trigger takes the per-group advisory lock;
#   5. mode_take_lobby: stale on a different read or a missing row, locked (row emptied and stamped
#      with the lobby, updated_at = locked_at), then exists; teams coming down hand back to the lobby
#      row only for a lock taken from it, else to group_modes (an older build's take);
#      mode_hand_back_lobby gives nothing back after an admin write; one lobby's teams down still
#      hands back to group_modes (0048's path);
#   6. lobby_mode_fold: copies the rule, pair and Rated (not the mode) and deletes the row; refuses
#      while the lobby holds a live lock. lobby_modes_settle: deletes an earlier night's row and an
#      ended lobby's, keeps one under a minute old, folds the party it is given;
#   7. checks refuse a class rule with no tag, a region rule with half a pair, a blank party;
#   8. anon and authenticated read the card columns and not the admin ids, write nothing, execute
#      no function; lobby_modes is in supabase_realtime;
#   9. if the local stack has 0051, its lobby_modes columns, checks, triggers and functions match
#      the throwaway's (one read-only catalog select).
#
# Usage: packages/db/scripts/m22-4-throwaway-check.sh [0051 path]. Needs Docker and the local stack
# running (`pnpm db:start`), which it only reads (pg_dump and one catalog select).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0051_lobby_modes.sql}"
DIR="$(cd "$(dirname "$MIGRATION")" && pwd)"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m224-throwaway-$$"
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

G1=00000000-0000-4000-8000-0000000224a1
G2=00000000-0000-4000-8000-0000000224a2
G3=00000000-0000-4000-8000-0000000224a3
G4=00000000-0000-4000-8000-0000000224a4
P1=00000000-0000-4000-8000-0000000224c1
P2=00000000-0000-4000-8000-0000000224c2
P3=00000000-0000-4000-8000-0000000224c3
LA=00000000-0000-4000-8000-0000000224e1
LB=00000000-0000-4000-8000-0000000224e2
LS=00000000-0000-4000-8000-0000000224e3

echo "== 1. read-only dump of $LOCAL_DB's auth schema"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=auth -f /tmp/m224.dump
docker cp "$LOCAL_DB:/tmp/m224.dump" "$WORK/auth.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m224.dump

echo "== 2. throwaway $THROWAWAY on $IMAGE, every migration before 0051"
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
  [[ "$(basename "$file")" < "0051" ]] || continue
  docker cp "$file" "$THROWAWAY:/tmp/replay.sql"
  if ! psql_t -q -f /tmp/replay.sql >"$WORK/replay.log" 2>&1; then
    echo "FAIL: replay stopped at $(basename "$file")" >&2
    tail -5 "$WORK/replay.log" >&2
    exit 1
  fi
done
echo "ok: replayed up to $(ls "$DIR" | awk '$0 < "0051"' | tail -1)"

echo "== 3. 0051"
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0051.sql"
psql_t -q -f /tmp/0051.sql
if psql_t -q -f /tmp/0051.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply of 0051 succeeded" >&2
  exit 1
fi
echo "ok: 0051 applied; a second apply fails and rolls back"

psql_t -q <<SQL
insert into public.groups (id, slug, name) values
  ('$G1', 'm224-one', 'M22.4 one'), ('$G2', 'm224-two', 'M22.4 two'),
  ('$G3', 'm224-three', 'M22.4 three'), ('$G4', 'm224-four', 'M22.4 four');
insert into public.players (id, puuid) values ('$P1', 'm224-ana'), ('$P2', 'm224-bo'), ('$P3', 'm224-cy');
insert into public.companion_tokens (player_id, token_hash, group_id, last_seen_at, current_party_id, current_party_at) values
  ('$P1', 'm224-hash-ana', '$G1', now(), 'pa', now()),
  ('$P2', 'm224-hash-bo', '$G1', now(), 'pb', now()),
  ('$P3', 'm224-hash-cy', '$G2', now(), 'qa', now());
update public.group_modes set mode = 'fearless', pending_rule = 'region', pending_region_blue = 'ionia',
  pending_region_red = 'noxus', rated_override = false, pending_set_by = '$P1'
where group_id = '$G1';
SQL
echo "ok: four groups, three hosts, G1's card region wars ionia/noxus, not rated, on Fearless"

echo "== 4. the fork"
q "insert into public.lobbies (id, group_id, lcu_party_id, reported_by_player_id) values ('$LA', '$G1', 'pa', '$P1')" >/dev/null
expect_eq "the first lobby never forks" "$(q "select count(*) from public.lobby_modes")" "0"
q "insert into public.lobbies (id, group_id, lcu_party_id, reported_by_player_id) values ('$LB', '$G1', 'pb', '$P2')" >/dev/null
expect_eq "a second lobby while Ana's is in play forks a copy of the card" \
  "$(q "select lcu_party_id || ':' || pending_rule || ':' || pending_region_blue || ':' || pending_region_red || ':' || rated_override || ':' || (pending_set_by = '$P1') from public.lobby_modes where group_id = '$G1'")" \
  "pb:region:ionia:noxus:false:true"
expect_eq "the row holds no standing mode" \
  "$(q "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'lobby_modes' and column_name = 'mode'")" "0"

q "insert into public.lobbies (group_id, lcu_party_id, reported_by_player_id) values ('$G2', 'qa', '$P3')" >/dev/null
expect_eq "the host's second Kustom still in the old custom: the new one forks" \
  "$(must_pass "insert into public.companion_tokens (player_id, token_hash, group_id, last_seen_at, current_party_id, current_party_at) values ('$P3', 'm224-hash-cy-2', '$G2', now(), 'qa', now());
update public.companion_tokens set current_party_id = 'qc', current_party_at = now() where token_hash = 'm224-hash-cy';
insert into public.lobbies (group_id, lcu_party_id, reported_by_player_id) values ('$G2', 'qc', '$P3');
select string_agg(lcu_party_id, ',') from public.lobby_modes where group_id = '$G2';")" "qc"
for case in "update public.companion_tokens set last_seen_at = now() - interval '11 minutes' where token_hash = 'm224-hash-cy';|a token last seen 11 minutes ago" \
  "update public.companion_tokens set revoked_at = now() where token_hash = 'm224-hash-cy';|a revoked token"; do
  expect_eq "${case#*|} keeps nothing in play" \
    "$(must_pass "${case%%|*}
insert into public.lobbies (group_id, lcu_party_id, reported_by_player_id) values ('$G2', 'qd', '$P2');
select count(*) from public.lobby_modes where group_id = '$G2';")" "0"
done
q "update public.companion_tokens set current_party_id = 'qb', current_party_at = now() where token_hash = 'm224-hash-cy'" >/dev/null
q "insert into public.lobbies (group_id, lcu_party_id, reported_by_player_id) values ('$G2', 'qb', '$P3')" >/dev/null
expect_eq "a host whose token moved to the new custom does not fork" \
  "$(q "select count(*) from public.lobby_modes where group_id = '$G2'")" "0"

q "insert into public.lobbies (group_id, lcu_party_id, status) values ('$G3', 'ra', 'finished')" >/dev/null
q "insert into public.lobbies (group_id, lcu_party_id, reported_by_player_id) values ('$G3', 'rb', '$P3')" >/dev/null
expect_eq "a finished lobby nobody's Kustom is in does not fork the next" \
  "$(q "select count(*) from public.lobby_modes where group_id = '$G3'")" "0"
q "insert into public.lobby_modes (group_id, lcu_party_id, pending_rule) values ('$G3', 'rz', 'mirror')" >/dev/null
q "update public.lobbies set status = 'abandoned' where group_id = '$G3' and lcu_party_id = 'rb'" >/dev/null
q "insert into public.lobbies (group_id, lcu_party_id) values ('$G3', 'rz')" >/dev/null
expect_eq "a new lobby alone deletes a left-over row of its party" \
  "$(q "select count(*) from public.lobby_modes where group_id = '$G3'")" "0"

q "insert into public.lobbies (group_id, lcu_party_id, status) values ('$G4', 'sa', 'in_game')" >/dev/null
expect_eq "an in_game lobby with no token (an old build) is not in play" \
  "$(must_pass "insert into public.lobbies (group_id, lcu_party_id) values ('$G4', 'sx');
select count(*) from public.lobby_modes where group_id = '$G4';")" "0"
q "insert into public.companion_tokens (player_id, token_hash, group_id, last_seen_at, current_party_id, current_party_at) values ('$P3', 'm224-hash-cy-g4', '$G4', now(), 'sa', now())" >/dev/null
q "insert into public.lobby_modes (group_id, lcu_party_id, pending_rule, rated_override, created_at) values ('$G4', 'sb', 'mirror', true, now() - interval '2 days')" >/dev/null
q "insert into public.lobbies (id, group_id, lcu_party_id) values ('$LS', '$G4', 'sb')" >/dev/null
expect_eq "an in_game lobby with its Kustom counts; the fork overwrites a stale row of the party" \
  "$(q "select coalesce(pending_rule, '-') || ':' || coalesce(rated_override::text, '-') || ':' || (created_at > now() - interval '1 minute') from public.lobby_modes where group_id = '$G4' and lcu_party_id = 'sb'")" \
  "-:-:true"

q "update public.lobbies set status = 'finished' where id = '$LA'" >/dev/null
q "insert into public.lobbies (group_id, lcu_party_id, reported_by_player_id) values ('$G1', 'pa', '$P1')" >/dev/null
expect_eq "a new cycle of a live lobby writes nothing" \
  "$(q "select string_agg(lcu_party_id, ',') from public.lobby_modes where group_id = '$G1'")" "pb"
expect_eq "the fork takes the per-group advisory lock" \
  "$(q "select position('pg_advisory_xact_lock(hashtext(new.group_id::text))' in prosrc) > 0 from pg_proc where proname = 'lobbies_fork_mode'")" "t"

echo "== 5. the take and the hand-back"
q "update public.group_modes set pending_rule = 'class', pending_class_tag = 'Tank', pending_region_blue = null, pending_region_red = null, rated_override = null where group_id = '$G1'" >/dev/null
expect_eq "a lock not taken from the row (an older build's take) hands back to group_modes" \
  "$(must_pass "update public.group_modes set pending_rule = null, pending_class_tag = null where group_id = '$G1';
update public.lobbies set status = 'balanced', lock_mode = 'normal', lock_rule = 'mirror', locked_at = now() + interval '1 second' where id = '$LB';
update public.lobbies set status = 'open' where id = '$LB';
select gm.pending_rule || ':' || lm.pending_rule from public.group_modes gm join public.lobby_modes lm on lm.group_id = gm.group_id where gm.group_id = '$G1';")" "mirror:region"
q "update public.lobbies set status = 'balanced' where id = '$LB'" >/dev/null
TAKE="select public.mode_take_lobby('$LB', '$G1', 'pb', array['balanced'], 'fearless', 'region', null, 'ionia', 'noxus', false, 'fearless', 'region', null, 'ionia', 'noxus', false, true)"
expect_eq "a read that is not the row is stale" \
  "$(q "select public.mode_take_lobby('$LB', '$G1', 'pb', array['balanced'], 'normal', 'region', null, 'ionia', 'noxus', false, 'normal', 'region', null, 'ionia', 'noxus', false, true)")" "stale"
expect_eq "a party with no row is stale" \
  "$(q "select public.mode_take_lobby('$LB', '$G1', 'nope', array['balanced'], 'fearless', null, null, null, null, null, 'fearless', null, null, null, null, null, true)")" "stale"
expect_eq "the take locks" "$(q "$TAKE")" "locked"
expect_eq "the lock is the row's rule, pair and Rated" \
  "$(q "select lock_mode || ':' || lock_rule || ':' || lock_region_blue || ':' || lock_region_red || ':' || lock_rated from public.lobbies where id = '$LB'")" \
  "fearless:region:ionia:noxus:false"
expect_eq "the row is emptied and stamped with updated_at = locked_at; the group card is untouched" \
  "$(q "select (lm.pending_rule is null and lm.rated_override is null and lm.taken_by_lobby_id = l.id) || ':' || (lm.updated_at = l.locked_at) || ':' || gm.pending_rule || ':' || gm.pending_class_tag from public.lobby_modes lm join public.lobbies l on l.id = '$LB' join public.group_modes gm on gm.group_id = lm.group_id where lm.group_id = '$G1' and lm.lcu_party_id = 'pb'")" \
  "true:true:class:Tank"
expect_eq "the old read is stale now (the row moved)" "$(q "$TAKE")" "stale"
expect_eq "a second take of the row as it is finds the lock" \
  "$(q "select public.mode_take_lobby('$LB', '$G1', 'pb', array['balanced'], 'fearless', null, null, null, null, null, 'fearless', null, null, null, null, null, true)")" "exists"

q "update public.lobbies set status = 'open' where id = '$LB'" >/dev/null
expect_eq "teams coming down hand back to the lobby row, not the group card" \
  "$(q "select lm.pending_rule || ':' || lm.pending_region_blue || ':' || lm.rated_override || ':' || gm.pending_rule || ':' || coalesce(gm.rated_override::text, '-') from public.lobby_modes lm join public.group_modes gm on gm.group_id = lm.group_id where lm.group_id = '$G1' and lm.lcu_party_id = 'pb'")" \
  "region:ionia:false:class:-"
expect_eq "and the lock is gone" "$(q "select coalesce(lock_mode, '-') from public.lobbies where id = '$LB'")" "-"
expect_eq "after an admin write the hand-back gives nothing back" \
  "$(must_pass "update public.lobby_modes set pending_rule = null, pending_region_blue = null, pending_region_red = null, rated_override = null, set_by = '$P2' where group_id = '$G1' and lcu_party_id = 'pb';
select public.mode_hand_back_lobby('$G1', 'pb', 'mirror', null, null, null, true, now() - interval '1 hour');")" "f"
expect_eq "one lobby's teams down still hands back to group_modes" \
  "$(must_pass "update public.group_modes set pending_rule = null, pending_class_tag = null where group_id = '$G2';
update public.lobbies set status = 'balanced', lock_mode = 'normal', lock_rule = 'mirror', locked_at = now() + interval '1 second' where group_id = '$G2' and lcu_party_id = 'qb';
update public.lobbies set status = 'open' where group_id = '$G2' and lcu_party_id = 'qb';
select pending_rule from public.group_modes where group_id = '$G2';")" "mirror"

echo "== 6. the fold and the settle"
expect_eq "the fold refuses while the lobby holds a live lock" \
  "$(must_pass "update public.lobbies set status = 'balanced', lock_mode = 'normal', locked_at = now() where id = '$LS';
select public.lobby_mode_fold('$G4', 'sb') || ':' || (select count(*) from public.lobby_modes where group_id = '$G4');")" "false:1"
expect_eq "the fold folds" "$(q "select public.lobby_mode_fold('$G1', 'pb')")" "t"
expect_eq "the fold copies the rule, pair and Rated, never the mode, and deletes the row" \
  "$(q "select 'true:' || gm.mode || ':' || gm.pending_rule || ':' || gm.pending_region_blue || ':' || gm.pending_region_red || ':' || gm.rated_override || ':' || (select count(*) from public.lobby_modes where group_id = '$G1') from public.group_modes gm where gm.group_id = '$G1'")" \
  "true:fearless:region:ionia:noxus:false:0"
psql_t -q <<SQL
insert into public.lobby_modes (group_id, lcu_party_id, created_at) values
  ('$G4', 'old', now() - interval '2 days'),
  ('$G4', 'ended', now() - interval '5 minutes'),
  ('$G4', 'fresh', now());
SQL
G4_ROWS="select string_agg(lcu_party_id, ',' order by lcu_party_id) from public.lobby_modes where group_id = '$G4'"
expect_eq "the settle with two lobbies in play folds nothing" \
  "$(q "select coalesce(public.lobby_modes_settle('$G4', array['sa', 'sb'], null, now() - interval '1 day'), '-')")" "-"
expect_eq "and deleted an earlier night's row and an ended lobby's, kept a fresh one" "$(q "$G4_ROWS")" "fresh,sb"
expect_eq "the settle folds the party it is given" \
  "$(q "select coalesce(public.lobby_modes_settle('$G4', array['sb'], 'sb', null), '-')")" "sb"
expect_eq "and only the fresh row is left" "$(q "$G4_ROWS")" "fresh"

echo "== 7. checks"
must_fail "a class rule with no tag" "insert into public.lobby_modes (group_id, lcu_party_id, pending_rule) values ('$G2', 'x1', 'class');"
must_fail "a region rule with half a pair" "insert into public.lobby_modes (group_id, lcu_party_id, pending_rule, pending_region_blue) values ('$G2', 'x2', 'region', 'ionia');"
must_fail "the same region twice" "insert into public.lobby_modes (group_id, lcu_party_id, pending_rule, pending_region_blue, pending_region_red) values ('$G2', 'x3', 'region', 'ionia', 'ionia');"
must_fail "a blank party" "insert into public.lobby_modes (group_id, lcu_party_id) values ('$G2', ' ');"
must_fail "a second row for one party" "insert into public.lobby_modes (group_id, lcu_party_id) values ('$G4', 'fresh');"

echo "== 8. grants and the publication"
for role in anon authenticated; do
  expect_eq "$role reads the card columns" \
    "$(must_pass "set local role $role; select count(*) >= 0 from (select group_id, lcu_party_id, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override, created_at, updated_at from public.lobby_modes) t;")" "t"
  must_fail "$role reading set_by" "set local role $role; select set_by from public.lobby_modes;"
  must_fail "$role reading pending_set_by" "set local role $role; select pending_set_by from public.lobby_modes;"
  must_fail "$role reading taken_by_lobby_id" "set local role $role; select taken_by_lobby_id from public.lobby_modes;"
  must_fail "$role inserting" "set local role $role; insert into public.lobby_modes (group_id, lcu_party_id) values ('$G2', 'x4');"
  must_fail "$role updating" "set local role $role; update public.lobby_modes set rated_override = true;"
  must_fail "$role executing lobby_mode_fold" "set local role $role; select public.lobby_mode_fold('$G4', 'fresh');"
  must_fail "$role executing lobby_modes_settle" "set local role $role; select public.lobby_modes_settle('$G4', null, null, null);"
  must_fail "$role executing mode_hand_back_lobby" "set local role $role; select public.mode_hand_back_lobby('$G4', 'fresh', null, null, null, null, true, null);"
  must_fail "$role executing mode_take_lobby" "set local role $role; select public.mode_take_lobby('$LS', '$G4', 'sb', array['open'], 'normal', null, null, null, null, null, 'normal', null, null, null, null, null, true);"
done
expect_eq "lobby_modes is in supabase_realtime" \
  "$(q "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lobby_modes'")" "1"

echo "== 9. the local stack runs the same 0051 (a read-only catalog select on $LOCAL_DB)"
FP="select 'col ' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-')
  from information_schema.columns where table_schema = 'public' and table_name = 'lobby_modes'
  union all select 'ck ' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.lobby_modes'::regclass
  union all select 'tg ' || tgname from pg_trigger
  where tgrelid in ('public.lobby_modes'::regclass, 'public.lobbies'::regclass) and not tgisinternal
  union all select 'fn ' || p.proname || ':' || md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('lobby_mode_fold', 'lobby_modes_settle', 'lobbies_fork_mode',
    'mode_take_lobby', 'mode_hand_back_lobby', 'lobbies_drop_mode_lock')
  order by 1"
if [[ "$(docker exec "$LOCAL_DB" psql -X -U postgres -d postgres -At -c "select to_regclass('public.lobby_modes') is not null")" == "t" ]]; then
  diff <(docker exec "$LOCAL_DB" psql -X -U postgres -d postgres -At -c "$FP") <(q "$FP") >&2 || {
    echo "FAIL: local lobby_modes differs from the files" >&2
    exit 1
  }
  echo "ok: local lobby_modes, its triggers and functions match the files"
else
  echo "skip: 0051 is not applied on $LOCAL_DB"
fi

echo "ALL CHECKS PASSED"
