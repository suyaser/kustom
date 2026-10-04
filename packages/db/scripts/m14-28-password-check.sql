-- m14-28-password-check.sql  (M14.28, THROWAWAY DATABASE ONLY, after 0028)
--
-- anon and authenticated read every lobbies column but lobby_password; naming it (or *) is
-- refused; the service role still reads it; RLS, the policy and the Realtime publication are
-- unchanged. Rolled back. Each check raises on failure.
\set ON_ERROR_STOP 1
begin;

insert into public.lobbies (group_id, lcu_party_id, status, lobby_name, lobby_password)
select id, 'm1428-check-party', 'open', 'Customs check', '4821' from public.groups order by created_at limit 1;

-- anon
set local role anon;
select 'anon reads the public columns: ' || count(*) from public.lobbies where lcu_party_id = 'm1428-check-party' and lobby_name = 'Customs check';
do $$
begin
  perform lobby_password from public.lobbies limit 1;
  raise exception 'anon could read lobby_password';
exception when insufficient_privilege then
  raise notice 'anon: lobby_password refused (42501) -- as expected';
end;
$$;
do $$
begin
  perform * from public.lobbies limit 1;
  raise exception 'anon could select *';
exception when insufficient_privilege then
  raise notice 'anon: select * refused (42501) -- as expected';
end;
$$;
reset role;

-- authenticated
set local role authenticated;
select 'authenticated reads the public columns: ' || count(*) from public.lobbies where lcu_party_id = 'm1428-check-party';
do $$
begin
  perform lobby_password from public.lobbies limit 1;
  raise exception 'authenticated could read lobby_password';
exception when insufficient_privilege then
  raise notice 'authenticated: lobby_password refused (42501) -- as expected';
end;
$$;
reset role;

-- service_role
set local role service_role;
do $$
begin
  if (select lobby_password from public.lobbies where lcu_party_id = 'm1428-check-party') <> '4821' then
    raise exception 'service_role lost lobby_password';
  end if;
  raise notice 'service_role reads lobby_password -- as expected';
end;
$$;
reset role;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'lobbies') then
    raise exception 'lobbies left the realtime publication';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lobbies' and policyname = 'lobbies are publicly readable') then
    raise exception 'the lobbies read policy is gone';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.lobbies'::regclass) then
    raise exception 'RLS is off on lobbies';
  end if;
  if not has_table_privilege('anon', 'public.lobbies', 'REFERENCES') or not has_table_privilege('anon', 'public.lobbies', 'TRIGGER') then
    raise exception 'anon lost a privilege 0028 should not touch';
  end if;
  raise notice 'publication, policy, RLS and the other privileges unchanged -- as expected';
end;
$$;

rollback;
