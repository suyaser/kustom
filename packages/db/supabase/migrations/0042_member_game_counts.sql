-- 0042_member_game_counts.sql (database performance plan, redesign/research/db-performance.md findings 5, 8)
--
-- 1. A group index on game_players. Two readers need "this group's rows for these players" without a
--    parallel scan of the whole table:
--      - the player page and You (apps/web/lib/stats/load.ts): the games one player played in a group,
--        then those games' scoreboards. (group_id, player_id) include (game_id) answers the first as an
--        index-only scan;
--      - Admin Members, through the view below.
-- 2. group_member_game_counts: games played and the last game per (group, player), counted by Postgres
--    instead of paging every game_players row of the group to the server. A filter on group_id is pushed
--    below the GROUP BY, so `?group_id=eq.<id>` reads one group. Counts every stored game (rated or not),
--    like the loader it replaces (lib/admin/groupMembers.ts).
--
-- security_invoker, and readable by the service role only: the admin loader reads it with the service
-- client after its own owner/admin check; anon and authenticated get nothing.

begin;

create index game_players_group_player_idx
  on public.game_players (group_id, player_id) include (game_id);

create view public.group_member_game_counts
  with (security_invoker = true) as
select gp.group_id,
       gp.player_id,
       count(*)::integer as games,
       max(g.started_at) as last_played_at
from public.game_players gp
join public.games g on g.id = gp.game_id and g.group_id = gp.group_id
group by gp.group_id, gp.player_id;

comment on view public.group_member_game_counts is
  '0042: games played and last game per (group, player), for Admin Members. Counts every stored game (rated or not). Service role only.';

revoke all on public.group_member_game_counts from public, anon, authenticated;
grant select on public.group_member_game_counts to service_role;

commit;
