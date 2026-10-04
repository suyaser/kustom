-- 0033_ai_lines.sql (M16.3)
--
-- Kustom Premium's AI plumbing: the store for generated lines, the spend ledger the caps are
-- enforced on, the operator's kill switch and global cap, the group's AI lines switch and the
-- player's opt-out. Brief: redesign/briefs/m16.1-premium-ai.md, sections 1.4, 1.5, 2 ("M16.3's
-- migration"), 3.3, 4.4 to 4.6; decisions M16.1 D6 to D8 and the user's 2026-10-04 row
-- ($2 per group per month, $20 overall). `groups.ai_monthly_cap_usd` already shipped in 0031.
--
--   groups.ai_lines_enabled          the admin's `AI lines` switch (brief 1.5), on by default so a
--                                    group the operator turns Premium on for has lines at once.
--                                    Off: no model call and no line rendered; nothing is deleted.
--   group_memberships.ai_opt_out     the player's `Write about me` switch, inverted (brief 1.4,
--                                    D6): per player per group, default written-about. The app
--                                    lets an admin set it true and never false (lib/ai/store.ts).
--                                    `group_memberships` keeps its 0022 reads (a session reads its
--                                    own rows, a group admin reads the group's), so a member sees
--                                    their own switch and an admin sees whom they switched off;
--                                    no client role can write it.
--   ai_settings                      one row: `calls_enabled` (the kill switch: false stops every
--                                    model call for every group at the next call, no deploy) and
--                                    `global_monthly_cap_usd` ($20.00). Operator SQL only:
--                                      update public.ai_settings set calls_enabled = false;
--   ai_lines                         one row per (group, kind, subject): kind `game` (subject the
--                                    game id), `week` (the week start) or `player` (player id and
--                                    week start). The text keeps `{Pn}` tokens, never names, with
--                                    the token -> players.id map beside it, the fact list, its
--                                    hash, the model and prompt version, the status, the reject
--                                    reason, tokens and cost. Rejected and failed rows are kept:
--                                    they make generation idempotent and feed M16.7's rates.
--   ai_calls                         the ledger: one row per model call, reserved at its worst case
--                                    before the call and settled at its real cost after. A month's
--                                    spend is the sum of settled costs plus open reservations, so
--                                    a crashed call still counts and the cap is never overshot.
--   ai_month_spend(), ai_reserve_call(), ai_settle_call()
--                                    the meter. `ai_reserve_call` takes a transaction-scoped
--                                    advisory lock, so two calls racing for the last cents cannot
--                                    both pass, and refuses unless the kill switch is off, the
--                                    group is Premium with AI lines on, and the worst case fits
--                                    under both the group's and the global cap.
--
-- Status machine of ai_lines (the same table as lib/ai/store.ts's LINE_TRANSITIONS; the trigger
-- refuses every other move):
--   pending   -> published | rejected | failed      (a generation ends)
--   failed    -> pending                            (a transient error is retried in its window)
--   published -> hidden                             (an admin's Hide; it never comes back)
--   rejected, hidden: final.
--
-- RLS and grants: every new table is service-role only. RLS on, no policy, and everything revoked
-- from anon and authenticated (Supabase's default privileges would otherwise grant them all). The
-- three functions are executable by the service role only. A public read of shown lines comes
-- later, if ever, through a server loader -- not through RLS.
--
-- One explicit transaction: the Supabase CLI applies a file statement by statement with no
-- enclosing transaction, and this file must be all-or-nothing.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

-- ---------------------------------------------------------------------------------------------
-- The group's switch and the player's opt-out
-- ---------------------------------------------------------------------------------------------

alter table public.groups
  add column ai_lines_enabled boolean not null default true;

comment on column public.groups.ai_lines_enabled is
  'M16.3: the admins'' AI lines switch (brief 1.5). Off: no model call and no line rendered; stored lines come back when it is turned on again. Only matters while premium is on. Not in groups_public.';

alter table public.group_memberships
  add column ai_opt_out boolean not null default false;

comment on column public.group_memberships.ai_opt_out is
  'M16.3: the player asked not to be written about in this group (brief 1.4, D6). True: left out of every AI fact list, and stored lines naming them are not rendered. An admin may set it true, never false; only the player turns it back off.';

-- ---------------------------------------------------------------------------------------------
-- The operator's settings: kill switch and global cap
-- ---------------------------------------------------------------------------------------------

create table public.ai_settings (
  id boolean primary key default true
    constraint ai_settings_singleton check (id),
  calls_enabled boolean not null default true,
  global_monthly_cap_usd numeric(7, 2) not null default 20.00
    constraint ai_settings_global_cap_range check (global_monthly_cap_usd >= 0 and global_monthly_cap_usd <= 1000),
  updated_at timestamptz not null default now()
);

comment on table public.ai_settings is
  'M16.3: one row. calls_enabled = false is the kill switch (every model call for every group stops at the next call); global_monthly_cap_usd caps every group''s AI spend together per calendar month. Operator SQL only; no route writes it.';

insert into public.ai_settings (id) values (true);

create function public.ai_settings_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger ai_settings_touch
  before update on public.ai_settings
  for each row execute function public.ai_settings_touch();

-- ---------------------------------------------------------------------------------------------
-- The lines
-- ---------------------------------------------------------------------------------------------

create table public.ai_lines (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  kind text not null
    constraint ai_lines_kind check (kind in ('game', 'week', 'player')),
  subject text not null,
  game_id uuid references public.games (id) on delete cascade,
  player_id uuid references public.players (id) on delete cascade,
  week_start date,
  status text not null default 'pending'
    constraint ai_lines_status check (status in ('pending', 'published', 'rejected', 'failed', 'hidden')),
  text text
    constraint ai_lines_text_length check (char_length(text) <= 2000),
  token_map jsonb not null default '{}'::jsonb
    constraint ai_lines_token_map_object check (jsonb_typeof(token_map) = 'object'),
  facts jsonb not null
    constraint ai_lines_facts_array check (jsonb_typeof(facts) = 'array'),
  fact_hash text not null
    constraint ai_lines_fact_hash_sha256 check (fact_hash ~ '^[0-9a-f]{64}$'),
  model text not null,
  prompt_version text not null,
  attempts smallint not null default 0
    constraint ai_lines_attempts_range check (attempts >= 0 and attempts <= 2),
  reject_reason text,
  input_tokens integer not null default 0
    constraint ai_lines_input_tokens_nonnegative check (input_tokens >= 0),
  output_tokens integer not null default 0
    constraint ai_lines_output_tokens_nonnegative check (output_tokens >= 0),
  cost_usd numeric(10, 6) not null default 0
    constraint ai_lines_cost_nonnegative check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid references public.players (id) on delete set null,
  constraint ai_lines_subject_unique unique (group_id, kind, subject),
  constraint ai_lines_subject_shape check (
    (kind = 'game' and game_id is not null and player_id is null and week_start is null
      and subject = game_id::text)
    or (kind = 'week' and game_id is null and player_id is null and week_start is not null
      and subject = to_char(week_start, 'YYYY-MM-DD'))
    or (kind = 'player' and game_id is null and player_id is not null and week_start is not null
      and subject = player_id::text || ':' || to_char(week_start, 'YYYY-MM-DD'))
  ),
  constraint ai_lines_shown_has_text check (status not in ('published', 'hidden') or text is not null),
  constraint ai_lines_published_stamp check ((status in ('published', 'hidden')) = (published_at is not null)),
  constraint ai_lines_hidden_stamp check ((status = 'hidden') = (hidden_at is not null))
);

comment on table public.ai_lines is
  'M16.3: one AI line per (group, kind, subject), written once. text keeps {Pn} tokens; token_map maps each to players.id. Shown only while status = published, the group is Premium with ai_lines_enabled, and no mapped player has opted out. Service role only.';

create index ai_lines_game_id on public.ai_lines (game_id) where game_id is not null;
create index ai_lines_player_id on public.ai_lines (player_id) where player_id is not null;

create function public.ai_lines_guard_status() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('published', 'rejected', 'failed'))
    or (old.status = 'failed' and new.status = 'pending')
    or (old.status = 'published' and new.status = 'hidden')
  ) then
    raise exception 'ai_lines: % -> % is not an allowed move', old.status, new.status
      using errcode = 'check_violation';
  end if;
  -- A final row never changes, with one exception: `hidden_by ... on delete set null` nulling the
  -- admin who hid it when that player is deleted (otherwise the player's delete would fail).
  if old.status in ('rejected', 'hidden')
     and (to_jsonb(new) - 'hidden_by' - 'updated_at') is distinct from (to_jsonb(old) - 'hidden_by' - 'updated_at')
  then
    raise exception 'ai_lines: a % line is final', old.status using errcode = 'check_violation';
  end if;
  if old.status in ('rejected', 'hidden') and new.hidden_by is distinct from old.hidden_by
     and new.hidden_by is not null then
    raise exception 'ai_lines: a % line is final', old.status using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.ai_lines_guard_status() is
  'M16.3 (0033): the ai_lines status machine. pending -> published|rejected|failed, failed -> pending, published -> hidden; rejected and hidden rows never change again, except hidden_by nulled when that player is deleted. Trigger only.';

create trigger ai_lines_guard_status
  before update on public.ai_lines
  for each row execute function public.ai_lines_guard_status();

-- ---------------------------------------------------------------------------------------------
-- The ledger and the meter
-- ---------------------------------------------------------------------------------------------

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  -- set null, not cascade: a deleted group's spend still counts against the global cap.
  group_id uuid references public.groups (id) on delete set null,
  line_id uuid references public.ai_lines (id) on delete set null,
  model text not null,
  reserved_usd numeric(10, 6) not null
    constraint ai_calls_reserved_positive check (reserved_usd > 0),
  cost_usd numeric(10, 6)
    constraint ai_calls_cost_nonnegative check (cost_usd >= 0),
  input_tokens integer
    constraint ai_calls_input_tokens_nonnegative check (input_tokens >= 0),
  output_tokens integer
    constraint ai_calls_output_tokens_nonnegative check (output_tokens >= 0),
  outcome text not null default 'reserved'
    constraint ai_calls_outcome check (outcome in ('reserved', 'ok', 'error', 'timeout')),
  request_id text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint ai_calls_settled_shape check ((outcome = 'reserved') = (settled_at is null and cost_usd is null))
);

comment on table public.ai_calls is
  'M16.3: one row per model call. Reserved at its worst case before the call, settled at its real cost after; a month''s spend is sum(coalesce(cost_usd, reserved_usd)), so an unsettled call counts at its worst case. Service role only.';

create index ai_calls_created_at on public.ai_calls (created_at);
create index ai_calls_group_created_at on public.ai_calls (group_id, created_at);

create function public.ai_month_spend(p_group_id uuid, p_month_start timestamptz, p_month_end timestamptz)
returns table (
  group_spent_usd numeric,
  global_spent_usd numeric,
  group_cap_usd numeric,
  global_cap_usd numeric,
  calls_enabled boolean,
  premium boolean,
  lines_enabled boolean
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce((
      select sum(coalesce(c.cost_usd, c.reserved_usd)) from public.ai_calls c
      where c.group_id = g.id and c.created_at >= p_month_start and c.created_at < p_month_end
    ), 0),
    coalesce((
      select sum(coalesce(c.cost_usd, c.reserved_usd)) from public.ai_calls c
      where c.created_at >= p_month_start and c.created_at < p_month_end
    ), 0),
    g.ai_monthly_cap_usd,
    s.global_monthly_cap_usd,
    s.calls_enabled,
    g.premium,
    g.ai_lines_enabled
  from public.groups g
  cross join public.ai_settings s
  where g.id = p_group_id;
$$;

comment on function public.ai_month_spend(uuid, timestamptz, timestamptz) is
  'M16.3 (0033): one group''s and every group''s AI spend in [p_month_start, p_month_end) (settled cost, or the reservation while unsettled), both caps, the kill switch and the group''s gates. No row for an unknown group. Service role only.';

create function public.ai_reserve_call(
  p_group_id uuid,
  p_model text,
  p_worst_case_usd numeric,
  p_month_start timestamptz,
  p_month_end timestamptz,
  p_line_id uuid default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  spend record;
  call_id uuid;
begin
  if p_worst_case_usd is null or p_worst_case_usd <= 0 then
    raise exception 'ai_reserve_call: the worst case must be positive' using errcode = 'check_violation';
  end if;
  if p_month_end <= p_month_start then
    raise exception 'ai_reserve_call: empty month' using errcode = 'check_violation';
  end if;

  -- One reservation at a time, everywhere: the global cap is shared by every group.
  perform pg_advisory_xact_lock(hashtextextended('public.ai_reserve_call', 0));

  select * into spend from public.ai_month_spend(p_group_id, p_month_start, p_month_end);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_group');
  end if;
  if not spend.calls_enabled then
    return jsonb_build_object('ok', false, 'reason', 'kill_switch');
  end if;
  if not spend.premium then
    return jsonb_build_object('ok', false, 'reason', 'not_premium');
  end if;
  if not spend.lines_enabled then
    return jsonb_build_object('ok', false, 'reason', 'lines_off');
  end if;
  if spend.group_spent_usd + p_worst_case_usd > spend.group_cap_usd then
    return jsonb_build_object('ok', false, 'reason', 'group_cap');
  end if;
  if spend.global_spent_usd + p_worst_case_usd > spend.global_cap_usd then
    return jsonb_build_object('ok', false, 'reason', 'global_cap');
  end if;

  insert into public.ai_calls (group_id, line_id, model, reserved_usd)
  values (p_group_id, p_line_id, p_model, p_worst_case_usd)
  returning id into call_id;

  return jsonb_build_object('ok', true, 'call_id', call_id);
end;
$$;

comment on function public.ai_reserve_call(uuid, text, numeric, timestamptz, timestamptz, uuid) is
  'M16.3 (0033): reserves one model call at its worst case, or refuses with a reason (kill_switch, not_premium, lines_off, group_cap, global_cap, no_group). Serialised by an advisory lock so racing calls cannot overshoot a cap. Service role only.';

create function public.ai_settle_call(
  p_call_id uuid,
  p_outcome text,
  p_cost_usd numeric,
  p_input_tokens integer,
  p_output_tokens integer,
  p_request_id text
) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_outcome not in ('ok', 'error', 'timeout') then
    raise exception 'ai_settle_call: unknown outcome %', p_outcome using errcode = 'check_violation';
  end if;
  update public.ai_calls
     set outcome = p_outcome,
         cost_usd = p_cost_usd,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         request_id = p_request_id,
         settled_at = now()
   where id = p_call_id and outcome = 'reserved';
  return found;
end;
$$;

comment on function public.ai_settle_call(uuid, text, numeric, integer, integer, text) is
  'M16.3 (0033): settles a reserved call once, at its real cost (or the reservation, for a timeout whose bill is unknown). False when the call was not open. Service role only.';

-- ---------------------------------------------------------------------------------------------
-- Grants: service role only
-- ---------------------------------------------------------------------------------------------

alter table public.ai_settings enable row level security;
alter table public.ai_lines enable row level security;
alter table public.ai_calls enable row level security;

revoke all on public.ai_settings from anon, authenticated;
revoke all on public.ai_lines from anon, authenticated;
revoke all on public.ai_calls from anon, authenticated;

revoke all on function public.ai_settings_touch() from public, anon, authenticated;
revoke all on function public.ai_lines_guard_status() from public, anon, authenticated;
revoke all on function public.ai_month_spend(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ai_reserve_call(uuid, text, numeric, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.ai_settle_call(uuid, text, numeric, integer, integer, text)
  from public, anon, authenticated;

grant execute on function public.ai_month_spend(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.ai_reserve_call(uuid, text, numeric, timestamptz, timestamptz, uuid)
  to service_role;
grant execute on function public.ai_settle_call(uuid, text, numeric, integer, integer, text)
  to service_role;

-- `groups` and `group_memberships` keep their grants: 0018 revoked everything on groups from the
-- client roles (repeated in 0031), and 0022/0018 left group_memberships select-only for
-- authenticated under RLS with no insert, update or delete. Repeated here so this file states its
-- own guarantee for the two new columns.
revoke all on public.groups from anon, authenticated;
revoke insert, update, delete, truncate on public.group_memberships from anon, authenticated;

commit;
