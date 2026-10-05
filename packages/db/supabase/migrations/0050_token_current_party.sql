-- 0050_token_current_party.sql (M22.3, decision row M22 D7)
--
-- Which Kustom is in which lobby: each companion token's current party, the `lcu_party_id` of the last
-- lobby post the token made that the server accepted.
--
--   current_party_id  text, null: the party of the token's last accepted lobby post (any group's party:
--                     a post about another group's party still says where this Kustom is). Null: the
--                     token has made no lobby post since this migration.
--   current_party_at  timestamptz, null: when current_party_id last changed. Null exactly when
--                     current_party_id is null.
--
-- Written by the lobby route (apps/web/lib/ingest/lobby.ts) only when the party changes, so a repeated
-- post still writes no row (M19.8). A table (the night's rows of one party, M22 D4) is watched while a
-- token of its group seen inside HOST_WINDOW_MS has it as current party (apps/web/lib/liveTables.ts).
--
-- companion_tokens keeps 0001's RLS: enabled, no policy, every grant revoked from anon and
-- authenticated. The new columns inherit that; only the service role reads or writes them.
--
-- Additive and nullable; the previous build never reads or writes the columns, so a rollback needs
-- nothing.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

begin;

alter table public.companion_tokens
  add column current_party_id text,
  add column current_party_at timestamptz;

alter table public.companion_tokens
  add constraint companion_tokens_current_party_pair check (
    (current_party_id is null) = (current_party_at is null)
  ),
  -- Like lobbies_party_id_not_blank (0001): the same ids, so the same rule and no upper bound.
  add constraint companion_tokens_current_party_not_blank check (
    current_party_id is null or length(current_party_id) > 0
  );

-- Who is watching a group's tables: the live tokens of a group with a current party.
create index companion_tokens_group_party_idx
  on public.companion_tokens (group_id, current_party_id)
  where revoked_at is null and current_party_id is not null;

comment on column public.companion_tokens.current_party_id is
  'M22.3 (0050): the lcu_party_id of the token''s last accepted lobby post; written only when it changes. Null: no lobby post since 0050.';
comment on column public.companion_tokens.current_party_at is
  'M22.3 (0050): when current_party_id last changed. Null exactly when current_party_id is null.';

commit;
