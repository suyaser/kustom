-- 0031_premium_flag.sql (M16.2)
--
-- Kustom Premium's entitlement: one flag per group that gates every AI feature (M16), and the
-- group's monthly AI budget. Brief: redesign/briefs/m16.1-premium-ai.md, section 2 and decision 2;
-- the user's decisions of 2026-10-04 (operator script, $2 per group per month, $20 overall).
--
--   groups.premium              off for every group, `customs` included. Turned on and off only by
--                               the operator's service-role script (`pnpm --filter web set-premium`);
--                               no HTTP route writes it, and /ops shows it read-only.
--   groups.premium_changed_at   null until the flag first changes, then the moment of the latest
--                               change. Stamped by the trigger below, never by a caller, so it can
--                               only ever mean "when premium last flipped": an update that leaves
--                               the flag as it was (the script run twice) keeps the old stamp.
--   groups.ai_monthly_cap_usd   the group's AI spend cap for a calendar month, $2.00 by default,
--                               set by the same script (`--cap <usd>`). The brief listed it under
--                               M16.3's migration; it is here because M16.2's script and /ops
--                               already read and write it. The global $20 cap is a server setting,
--                               not a column.
--
-- No plan, tier, price, expiry, seat or billing column: those wait for a billing decision.
--
-- RLS and grants: `groups` stays service-role only. 0018 revoked everything on it from anon and
-- authenticated and no later migration granted anything back; the revoke is repeated here so the
-- file states its own guarantee. `groups_public` is NOT changed: friends never see the word
-- Premium (brief 1.1), so only the server reads the flag, with the service role.
--
-- One explicit transaction: the Supabase CLI applies a file statement by statement with no
-- enclosing transaction, and this file must be all-or-nothing.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

alter table public.groups
  add column premium boolean not null default false,
  add column premium_changed_at timestamptz,
  add column ai_monthly_cap_usd numeric(6, 2) not null default 2.00
    constraint groups_ai_monthly_cap_usd_range check (ai_monthly_cap_usd >= 0 and ai_monthly_cap_usd <= 100);

comment on column public.groups.premium is
  'M16.2: Kustom Premium is on for this group; gates every AI generator and render, server-side. Set only by the operator''s service-role script (set-premium); no route writes it. Not in groups_public.';
comment on column public.groups.premium_changed_at is
  'M16.2: when premium last changed, or null if it never has. Stamped by groups_stamp_premium_changed_at(); a caller''s value is ignored.';
comment on column public.groups.ai_monthly_cap_usd is
  'M16.2: the group''s AI spend cap per calendar month in USD (default 2.00, 0 to 100). Set only by the operator''s script (set-premium --cap). The global cap is a server setting.';

create function public.groups_stamp_premium_changed_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.premium_changed_at := case when new.premium then now() else null end;
  elsif new.premium is distinct from old.premium then
    new.premium_changed_at := now();
  else
    new.premium_changed_at := old.premium_changed_at;
  end if;
  return new;
end;
$$;

comment on function public.groups_stamp_premium_changed_at() is
  'M16.2 (0031): keeps groups.premium_changed_at the moment premium last flipped; an update that leaves premium alone keeps the old stamp. Trigger only.';

revoke all on function public.groups_stamp_premium_changed_at() from public, anon, authenticated;

create trigger groups_stamp_premium_changed_at
  before insert or update on public.groups
  for each row execute function public.groups_stamp_premium_changed_at();

revoke all on public.groups from anon, authenticated;

commit;
