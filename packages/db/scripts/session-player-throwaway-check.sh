#!/usr/bin/env bash
# session-player-throwaway-check.sh  (verified session lookup: check 0038 without touching the shared stack)
#
# Applies 0038_session_player.sql to a THROWAWAY Postgres restored from a read-only pg_dump of the local
# stack (schemas public and auth), then checks it. The shared local stack is only ever read (pg_dump); hosted
# is never touched. This is the rehearsal of what the owner runs on hosted (docs/runbooks/jwt-signing-keys.md).
#
#   packages/db/scripts/session-player-throwaway-check.sh [path/to/0038_session_player.sql]
#
# If the dump already has 0038, the throwaway first drops the function (0038 adds nothing else), which is
# itself a check that 0038 can be undone.
#
# Checks, all on the throwaway:
#   1. postgres (the migration role, and the function's owner) can select auth.sessions, auth.identities and
#      auth.users;
#   2. the migration applies (it carries its own begin/commit) and a second apply fails cleanly;
#   3. the function is security definer, stable, search_path '', owned by postgres, and executable by
#      postgres and service_role only: anon and authenticated get 42501, service_role runs it;
#   4. on fabricated rows (rolled back): a live session answers its Discord id, player and role; another
#      group answers role null; a deleted session, a session past not_after, a banned user, a soft-deleted
#      user, another user's session id and a null session id answer no row; a past ban answers again; no
#      Discord identity answers discord_id null; an unlinked player answers player_id null;
#   5. no existing row of auth or public moved (row counts before and after);
#   6. the container is removed (also on failure).
#
# Exit 0 only when every check passes. Needs Docker and the local stack running (`pnpm db:start`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${1:-$HERE/../supabase/migrations/0038_session_player.sql}"
LOCAL_DB="${LOCAL_DB_CONTAINER:-supabase_db_customs-night}"
THROWAWAY="session-player-throwaway-$$"
WORK="$(mktemp -d)"

[[ -f "$MIGRATION" ]] || { echo "no migration at $MIGRATION" >&2; exit 1; }
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$LOCAL_DB")"

cleanup() {
  docker rm -f "$THROWAWAY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_t() { docker exec -i "$THROWAWAY" psql -X -v ON_ERROR_STOP=1 -U "${PGUSER_T:-postgres}" -h localhost -d postgres "$@"; }
expect_eq() {
  local label="$1" want="$2" got="$3"
  [[ "$got" == "$want" ]] || { echo "FAIL: $label: want [$want], got [$got]" >&2; exit 1; }
  echo "ok: $label"
}

COUNTS="select string_agg(t || '=' || n, ',' order by t) from (
  select 'auth.users' t, count(*) n from auth.users union all
  select 'auth.sessions', count(*) from auth.sessions union all
  select 'auth.identities', count(*) from auth.identities union all
  select 'players', count(*) from public.players union all
  select 'groups', count(*) from public.groups union all
  select 'group_memberships', count(*) from public.group_memberships) c"

echo "== 1. read-only dump of $LOCAL_DB"
docker exec "$LOCAL_DB" pg_dump -U postgres -d postgres -Fc --schema=public --schema=auth -f /tmp/session-player.dump
docker cp "$LOCAL_DB:/tmp/session-player.dump" "$WORK/local.dump"
docker exec "$LOCAL_DB" rm -f /tmp/session-player.dump

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

if [[ "$(psql_t -At -c "select count(*) from pg_proc where proname = 'session_player'")" != "0" ]]; then
  echo "== 2b. the dump already has 0038: drop the function on the throwaway"
  psql_t -q -c 'drop function public.session_player(uuid, uuid, uuid);'
  echo "ok: 0038 undone on the throwaway"
fi

echo "== 3. postgres can read the auth tables"
expect_eq "postgres selects auth.sessions, auth.identities, auth.users" "t|t|t" "$(psql_t -At -c "select has_table_privilege('postgres','auth.sessions','select'), has_table_privilege('postgres','auth.identities','select'), has_table_privilege('postgres','auth.users','select')")"

BEFORE="$(psql_t -At -c "$COUNTS")"

echo "== 4. apply 0038"
docker cp "$MIGRATION" "$THROWAWAY:/tmp/0038.sql"
psql_t -q -f /tmp/0038.sql
if psql_t -q -f /tmp/0038.sql >/dev/null 2>&1; then
  echo "FAIL: a second apply succeeded" >&2
  exit 1
fi
echo "ok: a second apply fails and rolls back"

echo "== 5. definition and grants"
expect_eq "owner, security definer, stable, search_path" 'postgres|t|s|{"search_path=\"\""}' \
  "$(psql_t -At -c "select pg_get_userbyid(proowner), prosecdef, provolatile, proconfig from pg_proc where proname = 'session_player'")"
expect_eq "execute: postgres and service_role only" "postgres=X/postgres,service_role=X/postgres" \
  "$(psql_t -At -c "select array_to_string(proacl, ',') from pg_proc where proname = 'session_player'")"
for role in anon authenticated; do
  if out="$(printf "begin;\nset local role %s;\nselect * from public.session_player(gen_random_uuid(), gen_random_uuid());\nrollback;\n" "$role" | psql_t -q 2>&1)"; then
    echo "FAIL: $role could execute session_player" >&2; exit 1
  fi
  [[ "$out" == *"permission denied"* ]] || { echo "FAIL: $role refused, but not by a privilege: $out" >&2; exit 1; }
  echo "ok: $role is refused execute"
done

echo "== 6. behaviour on fabricated rows (rolled back)"
psql_t -q -At <<'SQL' | tee "$WORK/behaviour.txt"
begin;
create temp table k as select gen_random_uuid() as u, gen_random_uuid() as s, gen_random_uuid() as other_u,
  gen_random_uuid() as g, gen_random_uuid() as g2, '7' || (extract(epoch from now()) * 1000)::bigint::text as snowflake;
grant select on k to service_role;
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tc-' || u || '@example.invalid', now(), now() from k;
insert into auth.sessions (id, user_id, created_at, updated_at) select s, u, now(), now() from k;
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  select snowflake, u, jsonb_build_object('sub', snowflake), 'discord', now(), now() from k;
insert into public.groups (id, slug, name) select g, 'tc-' || left(g::text, 8), 'tc' from k;
insert into public.groups (id, slug, name) select g2, 'tc-' || left(g2::text, 8), 'tc2' from k;
insert into public.players (puuid, display_name, discord_id) select 'tc-' || u, 'tc', snowflake from k;
insert into public.group_memberships (group_id, player_id, role)
  select g, p.id, 'admin' from k join public.players p on p.puuid = 'tc-' || k.u;

set local role service_role;
\echo live
select (discord_id = k.snowflake) || '|' || (player_id is not null) || '|' || coalesce(role, '-') from k, public.session_player(k.u, k.s, k.g);
\echo other_group
select coalesce(role, '-') from k, public.session_player(k.u, k.s, k.g2);
\echo no_group
select coalesce(role, '-') from k, public.session_player(k.u, k.s);
\echo other_users_session
select count(*) from k, public.session_player(k.other_u, k.s, k.g);
\echo null_session
select count(*) from k, public.session_player(k.u, null, k.g);
reset role;

update auth.users set banned_until = now() + interval '1 hour' where id = (select u from k);
\echo banned
select count(*) from k, public.session_player(k.u, k.s, k.g);
update auth.users set banned_until = now() - interval '1 minute' where id = (select u from k);
\echo ban_past
select count(*) from k, public.session_player(k.u, k.s, k.g);
update auth.users set deleted_at = now() where id = (select u from k);
\echo soft_deleted
select count(*) from k, public.session_player(k.u, k.s, k.g);
update auth.users set deleted_at = null where id = (select u from k);
update auth.sessions set not_after = now() - interval '1 second' where id = (select s from k);
\echo past_not_after
select count(*) from k, public.session_player(k.u, k.s, k.g);
update auth.sessions set not_after = now() + interval '1 hour' where id = (select s from k);
\echo future_not_after
select count(*) from k, public.session_player(k.u, k.s, k.g);
update public.players set discord_id = null where puuid = (select 'tc-' || u from k);
\echo unlinked_player
select (discord_id is not null) || '|' || coalesce(player_id::text, '-') from k, public.session_player(k.u, k.s, k.g);
delete from auth.identities where user_id = (select u from k);
\echo no_identity
select coalesce(discord_id, '-') || '|' || coalesce(player_id::text, '-') from k, public.session_player(k.u, k.s, k.g);
delete from auth.sessions where id = (select s from k);
\echo signed_out
select count(*) from k, public.session_player(k.u, k.s, k.g);
rollback;
SQL
want="$(printf '%s\n' live 'true|true|admin' other_group - no_group - other_users_session 0 null_session 0 \
  banned 0 ban_past 1 soft_deleted 0 past_not_after 0 future_not_after 1 unlinked_player 'true|-' no_identity '-|-' \
  signed_out 0)"
got="$(grep -v '^$' "$WORK/behaviour.txt" | sed 's/^ *//')"
[[ "$got" == "$want" ]] || { echo "FAIL: behaviour"; diff <(echo "$want") <(echo "$got"); exit 1; }
echo "ok: every behaviour case"

echo "== 7. nothing moved"
expect_eq "row counts unchanged" "$BEFORE" "$(psql_t -At -c "$COUNTS")"

echo "ALL CHECKS PASSED"
