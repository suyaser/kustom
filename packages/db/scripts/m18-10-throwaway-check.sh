#!/usr/bin/env bash
# m18-10-throwaway-check.sh  (M18.10: verify 0043 on real local data without touching the shared stack)
#
# Applies 0043_apply_game_player_ratings.sql to a THROWAWAY Postgres restored from a read-only
# pg_dump of the local stack, then checks it. The shared local stack is only ever read (pg_dump);
# hosted is never touched. This is the rehearsal of what the owner pushes to hosted in M18.10
# (docs/runbooks/kustom-rating.md), after 0036.
#
#   packages/db/scripts/m18-10-throwaway-check.sh [path/to/0043_apply_game_player_ratings.sql]
#
# If the dump already has 0043 (the local stack applied it), the throwaway first drops the
# function, which is itself a check that 0043 owns nothing else.
#
# Checks, all on the throwaway:
#   1. the dump has 0036's columns (0043 names them); the migration applies and a second apply
#      fails cleanly;
#   2. no existing value moved and no table changed: a fingerprint of every game_players /
#      ratings rating column, and of public's columns and checks, is identical before and after;
#   3. hardening: security definer, search_path '' and statement_timeout 60s on the function;
#      execute for service_role only (not public, anon, authenticated);
#   4. as service_role on real rows: every stored row of the biggest group handed back exactly as
#      stored writes 0 rows; a whole Kustom write through it on one real game writes 10 and passes
#      0036's checks; the same rows again write 0; p_only_unrated on a rated game writes 0; one
#      row breaking game_players_kustom_together refuses the whole call; a missing column and a
#      duplicate row are refused (all rolled back);
#   5. anon and authenticated get permission denied;
#   6. the container is removed (also on failure).
#
# Exit 0 only when every check passes. Needs Docker and the local stack running (`pnpm db:start`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0043_apply_game_player_ratings.sql}"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="m1810-throwaway-$$"
WORK="$(mktemp -d)"

[[ -f "$MIGRATION" ]] || { echo "no migration at $MIGRATION" >&2; exit 1; }
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$LOCAL_DB")"

cleanup() {
  docker rm -f "$THROWAWAY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_t() { docker exec -i "$THROWAWAY" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER_T:-postgres}" -h localhost -d postgres "$@"; }
# Runs SQL that must FAIL with a message containing $2; exits non-zero if it succeeds.
must_fail() {
  local label="$1" expected="$2" sql="$3" out
  if out="$(printf 'begin;\nset local extra_float_digits = 3;\n%s\nrollback;\n' "$sql" | psql_t -q 2>&1)"; then
    echo "FAIL: $label was accepted" >&2
    exit 1
  fi
  if [[ "$out" != *"$expected"* ]]; then
    echo "FAIL: $label was refused, but not with '$expected': $out" >&2
    exit 1
  fi
  echo "ok: refused $label ($expected)"
}
# Runs SQL in a rolled-back transaction and prints its last value.
value_of() {
  printf 'begin;\nset local extra_float_digits = 3;\n%s\nrollback;\n' "$1" | psql_t -q -At | tail -1
}

FINGERPRINT="select md5(string_agg(x, '|' order by x)) from (
  select concat_ws(',', game_id, player_id, mu_before, sigma_before, mu_after, sigma_after, fold_p,
                   base_mu_after, award, rated_games_before, r_before, r_after, k, share_rank,
                   week_r_before, week_r_after, week_k, week_fold_p, week_games_before,
                   counts_for_role_inference) as x from public.game_players
  union all
  select concat_ws(',', group_id, player_id, mu, sigma, r, games, wins, seed_mu, seed_sigma) from public.ratings
  union all
  select concat_ws(',', table_name, column_name, data_type, is_nullable, column_default)
    from information_schema.columns where table_schema = 'public'
  union all
  select conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace) t"

# Every rating column of a set of game_players rows as the function takes them (json array).
rows_json() {
  printf "(select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (select game_id, player_id, mu_before, sigma_before, mu_after, sigma_after, fold_p, base_mu_after, award, rated_games_before, r_before, r_after, k, share_rank, week_r_before, week_r_after, week_k, week_fold_p, week_games_before from public.game_players where %s) t)" "$1"
}

echo "== 1. read-only dump of $LOCAL_DB"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=public --schema=auth -f /tmp/m1810.dump
docker cp "$LOCAL_DB:/tmp/m1810.dump" "$WORK/local.dump"
docker exec "$LOCAL_DB" rm -f /tmp/m1810.dump

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

[[ "$(psql_t -At -c "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'game_players' and column_name in ('r_after', 'week_games_before')")" == "2" ]] \
  || { echo "FAIL: the dump has no 0036 columns; apply 0036 first" >&2; exit 1; }
echo "ok: 0036 is in the dump"

if [[ "$(psql_t -At -c "select count(*) from pg_proc where proname = 'apply_game_player_ratings'")" == "1" ]]; then
  echo "== 2b. the dump already has 0043: drop it on the throwaway"
  psql_t -q -c 'drop function public.apply_game_player_ratings(uuid, jsonb, boolean);'
  echo "ok: 0043 undone on the throwaway"
fi

BEFORE="$(psql_t -At -c "$FINGERPRINT")"

echo "== 3. apply 0043"
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0043.sql"
psql_t -q -f /tmp/0043.sql
if psql_t -q -f /tmp/0043.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply succeeded" >&2
  exit 1
fi
echo "ok: a second apply fails and rolls back"

echo "== 4. no existing value moved, no table changed"
AFTER="$(psql_t -At -c "$FINGERPRINT")"
[[ "$BEFORE" == "$AFTER" ]] || { echo "FAIL: fingerprint $BEFORE -> $AFTER" >&2; exit 1; }
echo "ok: fingerprint $AFTER unchanged"

echo "== 5. hardening"
psql_t -At -c "select 'secdef=' || prosecdef || ' config=' || array_to_string(proconfig, ';')
  from pg_proc where proname = 'apply_game_player_ratings'" | tee "$WORK/fn.txt"
[[ "$(cat "$WORK/fn.txt")" == 'secdef=true config=search_path="";statement_timeout=60s' ]] \
  || { echo "FAIL: function settings $(cat "$WORK/fn.txt")" >&2; exit 1; }
for role in public anon authenticated service_role; do
  if [[ "$role" == public ]]; then
    can="$(psql_t -At -c "select coalesce(bool_or(a.grantee = 0), false) from pg_proc p, aclexplode(p.proacl) a where p.proname = 'apply_game_player_ratings' and a.privilege_type = 'EXECUTE'")"
  else
    can="$(psql_t -At -c "select has_function_privilege('$role', 'public.apply_game_player_ratings(uuid, jsonb, boolean)', 'execute')")"
  fi
  want=f; [[ "$role" == service_role ]] && want=t
  [[ "$can" == "$want" ]] || { echo "FAIL: execute for $role is $can" >&2; exit 1; }
  echo "ok: execute for $role = $can"
done

echo "== 6. on real rows, as service_role (all rolled back)"
GROUP="(select group_id from public.game_players group by group_id order by count(*) desc limit 1)"
GAME="(select game_id from public.game_players where group_id = $GROUP and mu_after is not null group by game_id having count(*) = 10 limit 1)"
psql_t -At -c "select 'group ' || g.slug || ': ' || count(*) || ' game_players rows' from public.game_players gp join public.groups g on g.id = gp.group_id where gp.group_id = $GROUP group by g.slug"

N="$(value_of "set local role service_role; select public.apply_game_player_ratings($GROUP, $(rows_json "group_id = $GROUP"), false);")"
[[ "$N" == "0" ]] || { echo "FAIL: the group's stored rows handed back wrote $N" >&2; exit 1; }
echo "ok: every stored row of the group handed back as stored writes 0"

# The Kustom fold's whole row on one real game: both tracks, the 0034 parts it reuses, base_mu_after null.
KUSTOM="(select jsonb_agg(to_jsonb(t)) from (select game_id, player_id, mu_before, sigma_before, mu_after, sigma_after,
  0.5::float8 as fold_p, null::float8 as base_mu_after, 'none' as award, 3 as rated_games_before,
  1200::float8 as r_before, 1208::float8 as r_after, 16::float8 as k, null::smallint as share_rank,
  1200::float8 as week_r_before, 1216::float8 as week_r_after, 32::float8 as week_k, 0.5::float8 as week_fold_p, 0 as week_games_before
  from public.game_players where game_id = $GAME) t)"
OUT="$(printf 'begin;\nset local role service_role;\nselect public.apply_game_player_ratings(%s, %s, false);\nselect public.apply_game_player_ratings(%s, %s, false);\nselect public.apply_game_player_ratings(%s, %s, true);\nrollback;\n' \
  "$GROUP" "$KUSTOM" "$GROUP" "$KUSTOM" "$GROUP" "$KUSTOM" | psql_t -q -At | tr '\n' ' ')"
[[ "$OUT" == "10 0 0 " ]] || { echo "FAIL: Kustom write / again / claim wrote '$OUT', expected '10 0 0'" >&2; exit 1; }
echo "ok: a whole Kustom write on a real game writes 10, the same rows again 0, a claim on it 0"

BROKEN="(select jsonb_agg(case when n = 1 then v || '{\"k\": null}' else v end) from (select row_number() over () as n, x as v from jsonb_array_elements($KUSTOM) x) s)"
must_fail "one row of r_after without k (the whole call)" game_players_kustom_together \
  "set local role service_role; select public.apply_game_player_ratings($GROUP, $BROKEN, false);"
must_fail "a row missing a column" "every rating column" \
  "set local role service_role; select public.apply_game_player_ratings($GROUP, (select jsonb_agg(x - 'k') from jsonb_array_elements($KUSTOM) x), false);"
must_fail "a duplicate row" "appears twice" \
  "set local role service_role; select public.apply_game_player_ratings($GROUP, $KUSTOM || $KUSTOM, false);"

echo "== 7. anon and authenticated are refused"
must_fail "anon" "permission denied for function apply_game_player_ratings" \
  "set local role anon; select public.apply_game_player_ratings(gen_random_uuid(), '[]', false);"
must_fail "authenticated" "permission denied for function apply_game_player_ratings" \
  "set local role authenticated; select public.apply_game_player_ratings(gen_random_uuid(), '[]', false);"

FINAL="$(psql_t -At -c "$FINGERPRINT")"
[[ "$FINAL" == "$AFTER" ]] || { echo "FAIL: a rolled-back check left a trace" >&2; exit 1; }
echo "ALL CHECKS PASSED"
