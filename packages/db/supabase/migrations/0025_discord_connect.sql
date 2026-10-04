-- 0025_discord_connect.sql (M14.20)
--
-- Connect Discord in one click: OAuth2 `webhook.incoming` on the existing sign-in application. The
-- admin picks a channel on Discord's consent screen, Discord hands back a webhook, and the server
-- stores it in the group's existing `discord_config.webhook_url`. Pasting a webhook stays as the
-- fallback (`POST /api/admin/discord-config`, unchanged).
--
--   discord_connect_states   one row per `Connect Discord` press: the sha256 of the OAuth `state`
--                            nonce, bound to the auth user who pressed it and the group, with a
--                            ten-minute expiry and a `used_at` the callback sets in the same
--                            statement that checks it. That one `update ... where used_at is null
--                            and expires_at > now()` is what makes a state single-use under two
--                            racing callbacks. The nonce itself is never stored, only its hash,
--                            and the URL's `state` also carries an HMAC over (nonce, group, user)
--                            keyed from the server's Discord client secret, so a row alone cannot
--                            be turned back into a valid state. Service role only: RLS on, no
--                            policy, every privilege revoked from anon and authenticated.
--
--   discord_config.test_post_at     when the last test post (`Kustom is connected. Teams and
--                                   results will show up here.`) landed, for the page's `Done ·
--                                   test post sent <time ago>` and M14.22's checklist row
--                                   "Discord connected (a test post landed)".
--   discord_config.test_post_error  Discord's own reason when the last test post did not land, for
--                                   the page's failed state. Null after a test post lands.
--
-- Both test-post columns describe the webhook stored **now**, so a trigger clears them whenever
-- `webhook_url` changes (connect again, paste a new one, clear it). The server writes the new
-- test-post outcome in a second statement after the webhook, so it is never cleared by its own
-- write.
--
-- **No Discord user token is stored anywhere.** The `webhook.incoming` exchange returns an access
-- token and a refresh token beside the webhook; the server reads the webhook and drops the rest.
-- No column here could hold them.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- ---------------------------------------------------------------------------
-- discord_connect_states
-- ---------------------------------------------------------------------------

create table public.discord_connect_states (
  state_hash   text        primary key,
  group_id     uuid        not null references public.groups (id) on delete cascade,
  auth_user_id uuid        not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  constraint discord_connect_states_hash_shape check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint discord_connect_states_expiry check (expires_at > created_at)
);

create index discord_connect_states_expires_idx on public.discord_connect_states (expires_at);

comment on table public.discord_connect_states is
  'M14.20: one row per Connect Discord press. sha256 of the OAuth state nonce, bound to the auth user and the group, ten-minute expiry, single-use (used_at set by the callback in the statement that checks it). Service role only.';
comment on column public.discord_connect_states.state_hash is
  'Lower-case hex sha256 of the state nonce. The nonce itself is never stored.';
comment on column public.discord_connect_states.used_at is
  'Set once, by the callback, in the same update that checks used_at is null and expires_at > now().';

alter table public.discord_connect_states enable row level security;
revoke all on public.discord_connect_states from anon, authenticated;

-- ---------------------------------------------------------------------------
-- discord_config: the test post
-- ---------------------------------------------------------------------------

alter table public.discord_config
  add column test_post_at    timestamptz,
  add column test_post_error text;

comment on column public.discord_config.test_post_at is
  'M14.20: when the last test post to the stored webhook landed. Cleared when webhook_url changes.';
comment on column public.discord_config.test_post_error is
  'M14.20: Discord''s reason when the last test post did not land. Cleared when webhook_url changes.';

create function public.discord_config_clear_test_post()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.webhook_url is distinct from old.webhook_url then
    new.test_post_at := null;
    new.test_post_error := null;
  end if;
  return new;
end;
$$;

create trigger discord_config_clear_test_post
  before update on public.discord_config
  for each row execute function public.discord_config_clear_test_post();

revoke all on function public.discord_config_clear_test_post() from public, anon, authenticated;
