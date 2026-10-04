#!/usr/bin/env bash
# m19-dbperf-throwaway-check.sh  (database performance plan: verify 0039 to 0042 without touching the
# shared stack; redesign/research/db-performance.md 7.2)
#
# Applies 0039_games_game_mode, 0040_games_raw_lz4, 0041_game_facts and 0042_member_game_counts, in order, to
# a THROWAWAY Postgres restored from a read-only pg_dump of the local stack, then checks them. The shared
# local stack is only ever read (pg_dump); hosted is never touched. This is the rehearsal of the hosted
# runbook (docs/runbooks/db-performance.md).
#
#   packages/db/scripts/m19-dbperf-throwaway-check.sh [migrations dir]
#
# If the local stack already applied any of the four, the throwaway is first taken back to the shape
# before them (which is itself a check that they can be undone).
#
# Checks, all on the throwaway:
#   1. each migration applies (they carry their own begin/commit), timed; a second apply of 0039, 0041 and
#      0042 fails and rolls back; a second apply of 0040 is a harmless re-store;
#   2. 0039/0040 move no value: a fingerprint of every games column (raw by content) is identical before
#      and after;
#   3. game_mode equals the string value of raw->'gameMode' on every row, and still does after a raw
#      rewrite (a ban enrichment); a non-string gameMode reads null;
#   4. every raw value is lz4 after 0040; the group newest-first page uses games_group_started_lcu_idx with
#      no Sort, and games_group_started_at_idx is gone;
#   5. game_facts refuses a malformed facts shape, a version below 1, a game of another group; cascades
#      with its game; anon and authenticated read it and cannot write it; it is not in supabase_realtime;
#   6. group_member_game_counts equals a hand count on every (group, player); anon and authenticated are
#      refused, service_role reads it;
#   7. the container is removed (also on failure).
#
# Exit 0 only when every check passes. Needs Docker and the local stack running (`pnpm db:start`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${1:-$HERE/../supabase/migrations}"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m19dbperf-throwaway-$$"
WORK="$(mktemp -d)"
FILES=(0039_games_game_mode.sql 0040_games_raw_lz4.sql 0041_game_facts.sql 0042_member_game_counts.sql)

for f in "${FILES[@]}"; do [[ -f "$DIR/$f" ]] || { echo "no migration at $DIR/$f" >&2; exit 1; }; done
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$LOCAL_DB")"

cleanup() {
  docker rm -f "$THROWAWAY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_t() { docker exec -i "$THROWAWAY" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER_T:-postgres}" -h localhost -d postgres "$@"; }
# Runs SQL that must FAIL with `expect` in the error; exits non-zero if it succeeds.
must_fail() {
  local label="$1" expect="$2" sql="$3" out
  if out="$(printf 'begin;\n%s\nrollback;\n' "$sql" | psql_t -q 2>&1)"; then
    echo "FAIL: $label was accepted" >&2
    exit 1
  fi
  if [[ "$out" != *"$expect"* ]]; then
    echo "FAIL: $label was refused, but not with '$expect': $out" >&2
    exit 1
  fi
  echo "ok: refused $label ($expect)"
}
must_pass() {
  local label="$1" sql="$2"
  printf 'begin;\n%s\nrollback;\n' "$sql" | psql_t -q >/dev/null
  echo "ok: accepted $label (rolled back)"
}
ms_now() { python3 -c 'import time; print(int(time.time() * 1000))'; }

FINGERPRINT="select md5(string_agg(x, '|' order by x)) from (
  select concat_ws(',', id, lcu_game_id, lobby_id, started_at, duration_s, winning_side, source, created_at,
                   group_id, mode, rated, rule, rule_checked, md5(raw::text)) as x from public.games) t"

echo "== 1. read-only dump of $LOCAL_DB"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=public --schema=auth -f /tmp/m19dbperf.dump
docker cp "$LOCAL_DB:/tmp/m19dbperf.dump" "$WORK/local.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m19dbperf.dump

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

# Back to the shape before 0039 if the local stack has any of the four already.
PGUSER_T=supabase_admin psql_t -q <<'SQL'
drop view if exists public.group_member_game_counts;
drop index if exists public.game_players_group_player_idx;
drop table if exists public.game_facts;
alter table public.games alter column raw set compression default;
alter table public.games drop column if exists game_mode;
create index if not exists games_group_started_at_idx on public.games (group_id, started_at desc);
drop index if exists public.games_group_started_lcu_idx;
SQL

# A few rows the checks need, all inside this throwaway: one game with a non-string gameMode.
GROUP_ID="$(psql_t -At -c 'select id from public.groups order by created_at limit 1')"
[[ -n "$GROUP_ID" ]] || { echo "FAIL: the local stack has no group to check against" >&2; exit 1; }
psql_t -q -c "insert into public.games (lcu_game_id, started_at, duration_s, winning_side, source, raw, group_id)
  values (990000000001, now() - interval '3 days', 1500, 100, 'eog', '{\"gameMode\": 7, \"teams\": []}'::jsonb, '$GROUP_ID')"

BEFORE="$(psql_t -At -c "$FINGERPRINT")"
GAMES="$(psql_t -At -c 'select count(*) from public.games')"
echo "games on the throwaway: $GAMES"

echo "== 3. apply 0039 to 0042, timed"
for f in "${FILES[@]}"; do
  docker cp "$DIR/$f" "$THROWAWAY:/tmp/$f"
  t0="$(ms_now)"
  psql_t -q -f "/tmp/$f" >/dev/null
  echo "applied $f in $(( $(ms_now) - t0 )) ms"
done
for f in "${FILES[@]}"; do
  if [[ "$f" == 0040* ]]; then
    psql_t -q -f "/tmp/$f" >/dev/null
    echo "ok: a second apply of $f re-stores and succeeds"
    continue
  fi
  if psql_t -q -f "/tmp/$f" >/dev/null 2>&1; then
    echo "FAIL: a second apply of $f succeeded" >&2
    exit 1
  fi
  echo "ok: a second apply of $f fails and rolls back"
done

echo "== 4. no games value moved"
AFTER="$(psql_t -At -c "$FINGERPRINT")"
[[ "$BEFORE" == "$AFTER" ]] || { echo "FAIL: games fingerprint moved ($BEFORE -> $AFTER)" >&2; exit 1; }
echo "ok: games fingerprint identical ($AFTER)"

echo "== 5. game_mode"
[[ "$(psql_t -At -c "select count(*) from public.games where game_mode is distinct from
  (case when jsonb_typeof(raw->'gameMode') = 'string' then raw->>'gameMode' end)")" == "0" ]]
[[ "$(psql_t -At -c "select count(*) from public.games where lcu_game_id = 990000000001 and game_mode is null")" == "1" ]]
echo "ok: game_mode is the string gameMode on every row; a number reads null"
psql_t -q <<'SQL'
begin;
update public.games set raw = jsonb_set(raw, '{gameMode}', '"ARAM"') where lcu_game_id = 990000000001;
do $$ begin
  if (select game_mode from public.games where lcu_game_id = 990000000001) is distinct from 'ARAM' then
    raise exception 'game_mode did not follow a raw rewrite';
  end if;
end $$;
rollback;
SQL
echo "ok: game_mode follows a raw rewrite"
must_fail "a write to game_mode" "generated" "update public.games set game_mode = 'CLASSIC';"

echo "== 6. lz4 and the index"
[[ "$(psql_t -At -c "select count(*) from public.games where pg_column_compression(raw) is distinct from 'lz4' and pg_column_size(raw) > 2000")" == "0" ]]
echo "ok: every toasted raw is lz4 ($(psql_t -At -c "select count(*) from public.games where pg_column_compression(raw) = 'lz4'") compressed values)"
[[ "$(psql_t -At -c "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'games_group_started_at_idx'")" == "0" ]]
PLAN="$(printf "set enable_seqscan = off;\nexplain select id, game_mode from public.games where group_id = '%s' order by started_at desc, lcu_game_id desc limit 30;\n" "$GROUP_ID" | psql_t -At)"
[[ "$PLAN" == *games_group_started_lcu_idx* && "$PLAN" != *Sort* ]] || { echo "FAIL: plan: $PLAN" >&2; exit 1; }
echo "ok: the group page walks games_group_started_lcu_idx with no Sort"

echo "== 7. game_facts"
GAME="(select id from public.games where group_id = '$GROUP_ID' order by started_at desc limit 1)"
OTHER_GROUP="$(psql_t -At -c "insert into public.groups (slug, name) values ('m19-dbperf-other', 'Other') returning id" | head -1)"
GOOD="'{\"byPuuid\": {}, \"bans\": []}'::jsonb"
must_pass "a whole facts row" "insert into public.game_facts (game_id, group_id, facts_version, facts) values ($GAME, '$GROUP_ID', 1, $GOOD);"
must_fail "facts that is not an object" "game_facts_facts_check" "insert into public.game_facts (game_id, group_id, facts_version, facts) values ($GAME, '$GROUP_ID', 1, '[]'::jsonb);"
must_fail "facts without byPuuid" "game_facts_facts_check" "insert into public.game_facts (game_id, group_id, facts_version, facts) values ($GAME, '$GROUP_ID', 1, '{\"bans\": []}'::jsonb);"
must_fail "bans that is not an array" "game_facts_facts_check" "insert into public.game_facts (game_id, group_id, facts_version, facts) values ($GAME, '$GROUP_ID', 1, '{\"byPuuid\": {}, \"bans\": {}}'::jsonb);"
must_fail "facts_version 0" "game_facts_facts_version_check" "insert into public.game_facts (game_id, group_id, facts_version, facts) values ($GAME, '$GROUP_ID', 0, $GOOD);"
must_fail "a game of another group" "game_facts_game_group_fkey" "insert into public.game_facts (game_id, group_id, facts_version, facts) values ($GAME, '$OTHER_GROUP', 1, $GOOD);"
psql_t -q <<SQL
begin;
insert into public.game_facts (game_id, group_id, facts_version, facts) values ($GAME, '$GROUP_ID', 1, $GOOD);
delete from public.daily_mysteries where game_id = $GAME;
delete from public.games where id = $GAME;
do \$\$ begin
  if exists (select 1 from public.game_facts where game_id not in (select id from public.games)) then
    raise exception 'game_facts outlived its game';
  end if;
end \$\$;
rollback;
SQL
echo "ok: game_facts is deleted with its game"
psql_t -q -c "insert into public.game_facts (game_id, group_id, facts_version, facts) values ($GAME, '$GROUP_ID', 1, $GOOD)"
for role in anon authenticated; do
  [[ "$(printf 'begin;\nset local role %s;\nselect count(*) from public.game_facts;\nrollback;\n' "$role" | psql_t -At | grep -E '^[0-9]+$')" == "1" ]]
  must_fail "$role insert into game_facts" "permission denied" "set local role $role; insert into public.game_facts (game_id, group_id, facts_version, facts) values ($GAME, '$GROUP_ID', 1, $GOOD);"
  must_fail "$role update of game_facts" "permission denied" "set local role $role; update public.game_facts set facts_version = 2;"
done
echo "ok: anon and authenticated read game_facts and cannot write it"
[[ "$(psql_t -At -c "select relrowsecurity from pg_class where oid = 'public.game_facts'::regclass")" == "t" ]]
[[ "$(psql_t -At -c "select count(*) from pg_publication_tables where tablename = 'game_facts'")" == "0" ]]
echo "ok: RLS on; not in any publication"

echo "== 8. group_member_game_counts"
[[ "$(psql_t -At -c "with hand as (
    select gp.group_id, gp.player_id, count(*)::integer as games, max(g.started_at) as last_played_at
    from public.game_players gp join public.games g on g.id = gp.game_id group by 1, 2)
  select count(*) from (
    (select * from hand except select * from public.group_member_game_counts)
    union all
    (select * from public.group_member_game_counts except select * from hand)) d")" == "0" ]]
echo "ok: the view equals a hand count on $(psql_t -At -c 'select count(*) from public.group_member_game_counts') (group, player) rows"
for role in anon authenticated; do
  must_fail "$role select of group_member_game_counts" "permission denied" "set local role $role; select * from public.group_member_game_counts;"
done
printf 'begin;\nset local role service_role;\nselect count(*) from public.group_member_game_counts;\nrollback;\n' | psql_t -q >/dev/null
echo "ok: service_role reads it"
PLAN="$(printf "set enable_seqscan = off;\nexplain select * from public.group_member_game_counts where group_id = '%s';\n" "$GROUP_ID" | psql_t -At)"
[[ "$PLAN" == *game_players_group_player_idx* ]] || { echo "FAIL: the view's plan does not use the group index: $PLAN" >&2; exit 1; }
echo "ok: a group filter reaches game_players_group_player_idx"

echo "ALL CHECKS PASSED"
