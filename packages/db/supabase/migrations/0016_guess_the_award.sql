-- 0016_guess_the_award.sql
--
-- A second daily game on the Daily Mystery engine (M8.4): Guess the Award.
--
-- The two games alternate civil days in CUSTOMS_NIGHT_TZ. There is still exactly one
-- challenge per civil day, so `daily_mysteries.day` keeps its unique and no table is
-- duplicated. This migration is additive: one column, one widened check, one unique.
--
--   kind                     'mystery' | 'award'. **Stored, never derived from the date's
--                            parity at read time** -- a stored challenge has to keep meaning
--                            what it meant if the rotation rule ever changes. Existing rows
--                            take the default and are Daily Mysteries, which is what they are.
--   category                 the check becomes per kind. Daily Mystery keeps its five; Guess
--                            the Award names which of `performanceScores`' seven components
--                            the standout led the game in (packages/core/src/rating/
--                            performance.ts). No third kind, and no category shared by two.
--   (kind, challenge_number) the unique moves. `Daily Mystery #41` is printed in the heading
--                            and in the share string, so a shared counter would print #41,
--                            #43, #45 and a friend who plays every day would be counting cases
--                            that never existed. Each game counts its own.
--
-- RLS is unchanged: enabled with no policy at all and the grants revoked (0013). The answer
-- never leaves the server, on an award day exactly as on a mystery day.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

alter table public.daily_mysteries
  add column kind text not null default 'mystery';

alter table public.daily_mysteries
  add constraint daily_mysteries_kind_check check (kind in ('mystery', 'award'));

alter table public.daily_mysteries
  drop constraint daily_mysteries_category_check;

alter table public.daily_mysteries
  add constraint daily_mysteries_category_check check (
    (
      kind = 'mystery'
      and category in ('disaster', 'monster', 'farming', 'raid_boss', 'ghost')
    )
    or (
      kind = 'award'
      and category in ('kda', 'damage', 'gold', 'vision', 'mitigation', 'cs', 'objectives')
    )
  );

alter table public.daily_mysteries
  drop constraint daily_mysteries_challenge_number_key;

alter table public.daily_mysteries
  add constraint daily_mysteries_kind_challenge_number_key unique (kind, challenge_number);

comment on column public.daily_mysteries.kind is
  'Which daily game this row is: mystery | award (M8.4). Stored at creation, never inferred from the date.';
comment on column public.daily_mysteries.category is
  'Per kind: the five Daily Mystery categories, or the performance component the award standout led.';
comment on column public.daily_mysteries.challenge_number is
  'Counts within its own kind: Daily Mystery #41 and Guess the Award #7 are separate sequences.';
