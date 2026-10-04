-- m18-10-checks.sql  (M18.10 step 5: the read-only checks after the switch rebuild)
--
-- Three reads, nothing written. Run once per group after `rebuild-ratings --hosted` (the owner, from
-- docs/runbooks/kustom-rating.md), and compare with the dry run's output and the site:
--   A. the all-time board as stored (round(ratings.r)), top 10, against the dry run's `board` lines
--      ("new" place and Rating) and the /g/<slug> All time tab. Players tied on Rating may be listed
--      in a different order here than on the board (the board breaks ties its own way); the Ratings
--      agree.
--   B. the latest rated game's ten rows: side, the side's odds as a whole percent, K, share rank,
--      award, n, the printed all-time change and the printed weekly change. Open that game on the
--      site and tap one row: its explanation must say the same percent, K and share (rank 1 on the
--      winners x1.2 ... rank 5 x0.8; the first-ten line when n < 10).
--   C. for every player's every week: week points (round(last week_r_after) - 1200) equal the sum
--      of that week's printed weekly changes. `mismatches` must be 0. Then open one player's week
--      tab on the site: its per-game weekly changes add up to the header.
--
-- RUN:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v slug=customs -f packages/db/scripts/m18-10-checks.sql
-- or paste into the Supabase SQL editor with 'customs' in place of :'slug' (three places).

-- Check A: the all-time board as stored (round(r)), against the dry run's "new" column.
select row_number() over (order by r.r desc, r.games desc, coalesce(p.display_name, p.game_name)) as place,
       coalesce(p.display_name, p.game_name) as player, round(r.r)::int as rating, r.games
from public.ratings r
join public.players p on p.id = r.player_id
join public.groups g on g.id = r.group_id
where g.slug = :'slug' and r.r is not null
order by place limit 10;

-- Check B: the latest rated game's stored rows, the inputs of its explanation lines.
select coalesce(p.display_name, p.game_name) as player, gp.side, round(gp.fold_p * 100)::int as side_pct,
       gp.k, gp.share_rank, gp.award, gp.rated_games_before as n,
       round(gp.r_after)::int - round(gp.r_before)::int as change,
       round(gp.week_r_after)::int - round(gp.week_r_before)::int as week_change
from public.game_players gp
join public.players p on p.id = gp.player_id
where gp.game_id = (select g.id from public.games g join public.groups gr on gr.id = g.group_id
                    join public.game_players x on x.game_id = g.id and x.r_after is not null
                    where gr.slug = :'slug' order by g.started_at desc limit 1)
order by gp.side, gp.share_rank nulls last, player;

-- Check C: for every player's every week, week points (round(last week_r_after) - 1200) equal the
-- sum of that week's printed weekly changes. mismatches must be 0.
with w as (
  select gp.player_id, gp.week_r_before, gp.week_r_after, g.started_at, g.lcu_game_id,
         sum(case when gp.week_games_before = 0 then 1 else 0 end)
           over (partition by gp.player_id order by g.started_at, g.lcu_game_id) as week_no
  from public.game_players gp
  join public.games g on g.id = gp.game_id
  join public.groups gr on gr.id = gp.group_id
  where gr.slug = :'slug' and gp.week_r_after is not null)
select count(*) as player_weeks, count(*) filter (where points <> changes) as mismatches
from (select player_id, week_no,
             round((array_agg(week_r_after order by started_at desc, lcu_game_id desc))[1])::int - 1200 as points,
             sum(round(week_r_after)::int - round(week_r_before)::int) as changes
      from w group by player_id, week_no) t;
