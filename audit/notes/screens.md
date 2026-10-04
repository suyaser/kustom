# Phase 1 audit: current web app, screens and UX

Captured 2026-10-03 with Playwright (Chromium), dark color scheme, full-page shots at 375 / 768 / 1440. 57 page-state sets, 171 PNGs, all in `audit/screens/`.

**Sources**
- `-real` = the running dev server on :3000. **Its `apps/web/.env.local` points at the HOSTED Supabase project**, so these are real production players/games, shot strictly read-only (navigate, expand `<details>`, resize; nothing clicked that writes). Game ids for detail pages came from one anon, read-only REST GET.
- `-synthetic` = a throwaway git worktree of HEAD on :3001 with its own `.env.local` pointing at local Supabase (127.0.0.1:54321), seeded only for the live states and admin. Fake names (Gankplank, Jinxed Lad...).
- No suffix = :3001 with an empty local group (empty-group and error states).
- Note: the black "N" circle bottom-left in every shot is the Next.js dev-tools badge, not product UI. The red "1 Issue" pill on 404s is dev overlay for a real console error (below).

## Screenshot index

| Page | State | Source | Files (375 / 768 / 1440) |
|---|---|---|---|
| 1v1 | emptygroup | local (:3001, empty or error, no data needed) | `audit/screens/1v1-emptygroup-375.png` / `audit/screens/1v1-emptygroup-768.png` / `audit/screens/1v1-emptygroup-1440.png` |
| 1v1 | nopick | hosted-real (:3000, read-only) | `audit/screens/1v1-nopick-real-375.png` / `audit/screens/1v1-nopick-real-768.png` / `audit/screens/1v1-nopick-real-1440.png` |
| 1v1 | pair | hosted-real (:3000, read-only) | `audit/screens/1v1-pair-real-375.png` / `audit/screens/1v1-pair-real-768.png` / `audit/screens/1v1-pair-real-1440.png` |
| admin | discord | local-synthetic (:3001) | `audit/screens/admin-discord-synthetic-375.png` / `audit/screens/admin-discord-synthetic-768.png` / `audit/screens/admin-discord-synthetic-1440.png` |
| admin | games | local-synthetic (:3001) | `audit/screens/admin-games-synthetic-375.png` / `audit/screens/admin-games-synthetic-768.png` / `audit/screens/admin-games-synthetic-1440.png` |
| admin | home-balanced | local-synthetic (:3001) | `audit/screens/admin-home-balanced-synthetic-375.png` / `audit/screens/admin-home-balanced-synthetic-768.png` / `audit/screens/admin-home-balanced-synthetic-1440.png` |
| admin | home-finished | local-synthetic (:3001) | `audit/screens/admin-home-finished-synthetic-375.png` / `audit/screens/admin-home-finished-synthetic-768.png` / `audit/screens/admin-home-finished-synthetic-1440.png` |
| admin | home | local-synthetic (:3001) | `audit/screens/admin-home-synthetic-375.png` / `audit/screens/admin-home-synthetic-768.png` / `audit/screens/admin-home-synthetic-1440.png` |
| admin | players | local-synthetic (:3001) | `audit/screens/admin-players-synthetic-375.png` / `audit/screens/admin-players-synthetic-768.png` / `audit/screens/admin-players-synthetic-1440.png` |
| admin | seasons | local-synthetic (:3001) | `audit/screens/admin-seasons-synthetic-375.png` / `audit/screens/admin-seasons-synthetic-768.png` / `audit/screens/admin-seasons-synthetic-1440.png` |
| admin | signedout | local (:3001, empty or error, no data needed) | `audit/screens/admin-signedout-375.png` / `audit/screens/admin-signedout-768.png` / `audit/screens/admin-signedout-1440.png` |
| admin | tokens | local-synthetic (:3001) | `audit/screens/admin-tokens-synthetic-375.png` / `audit/screens/admin-tokens-synthetic-768.png` / `audit/screens/admin-tokens-synthetic-1440.png` |
| adminlogin | signedout | local (:3001, empty or error, no data needed) | `audit/screens/adminlogin-signedout-375.png` / `audit/screens/adminlogin-signedout-768.png` / `audit/screens/adminlogin-signedout-1440.png` |
| error | 404 | local (:3001, empty or error, no data needed) | `audit/screens/error-404-375.png` / `audit/screens/error-404-768.png` / `audit/screens/error-404-1440.png` |
| error | unknownslug | local (:3001, empty or error, no data needed) | `audit/screens/error-unknownslug-375.png` / `audit/screens/error-unknownslug-768.png` / `audit/screens/error-unknownslug-1440.png` |
| fun | alltime | hosted-real (:3000, read-only) | `audit/screens/fun-alltime-real-375.png` / `audit/screens/fun-alltime-real-768.png` / `audit/screens/fun-alltime-real-1440.png` |
| fun | emptygroup | local (:3001, empty or error, no data needed) | `audit/screens/fun-emptygroup-375.png` / `audit/screens/fun-emptygroup-768.png` / `audit/screens/fun-emptygroup-1440.png` |
| fun | thismonth | hosted-real (:3000, read-only) | `audit/screens/fun-thismonth-real-375.png` / `audit/screens/fun-thismonth-real-768.png` / `audit/screens/fun-thismonth-real-1440.png` |
| game | badid | local (:3001, empty or error, no data needed) | `audit/screens/game-badid-375.png` / `audit/screens/game-badid-768.png` / `audit/screens/game-badid-1440.png` |
| game | finished-bluewin | hosted-real (:3000, read-only) | `audit/screens/game-finished-bluewin-real-375.png` / `audit/screens/game-finished-bluewin-real-768.png` / `audit/screens/game-finished-bluewin-real-1440.png` |
| game | finished-older | hosted-real (:3000, read-only) | `audit/screens/game-finished-older-real-375.png` / `audit/screens/game-finished-older-real-768.png` / `audit/screens/game-finished-older-real-1440.png` |
| game | finished-redwin | hosted-real (:3000, read-only) | `audit/screens/game-finished-redwin-real-375.png` / `audit/screens/game-finished-redwin-real-768.png` / `audit/screens/game-finished-redwin-real-1440.png` |
| game | finished | local-synthetic (:3001) | `audit/screens/game-finished-synthetic-375.png` / `audit/screens/game-finished-synthetic-768.png` / `audit/screens/game-finished-synthetic-1440.png` |
| games | alltime | hosted-real (:3000, read-only) | `audit/screens/games-alltime-real-375.png` / `audit/screens/games-alltime-real-768.png` / `audit/screens/games-alltime-real-1440.png` |
| games | aram | hosted-real (:3000, read-only) | `audit/screens/games-aram-real-375.png` / `audit/screens/games-aram-real-768.png` / `audit/screens/games-aram-real-1440.png` |
| games | emptygroup | local (:3001, empty or error, no data needed) | `audit/screens/games-emptygroup-375.png` / `audit/screens/games-emptygroup-768.png` / `audit/screens/games-emptygroup-1440.png` |
| games | expanded | hosted-real (:3000, read-only) | `audit/screens/games-expanded-real-375.png` / `audit/screens/games-expanded-real-768.png` / `audit/screens/games-expanded-real-1440.png` |
| games | onegame | local-synthetic (:3001) | `audit/screens/games-onegame-synthetic-375.png` / `audit/screens/games-onegame-synthetic-768.png` / `audit/screens/games-onegame-synthetic-1440.png` |
| home | root | local (:3001, empty or error, no data needed) | `audit/screens/home-root-375.png` / `audit/screens/home-root-768.png` / `audit/screens/home-root-1440.png` |
| leaderboard | alltime-expanded | hosted-real (:3000, read-only) | `audit/screens/leaderboard-alltime-expanded-real-375.png` / `audit/screens/leaderboard-alltime-expanded-real-768.png` / `audit/screens/leaderboard-alltime-expanded-real-1440.png` |
| leaderboard | alltime-long | hosted-real (:3000, read-only) | `audit/screens/leaderboard-alltime-long-real-375.png` / `audit/screens/leaderboard-alltime-long-real-768.png` / `audit/screens/leaderboard-alltime-long-real-1440.png` |
| leaderboard | emptygroup | local (:3001, empty or error, no data needed) | `audit/screens/leaderboard-emptygroup-375.png` / `audit/screens/leaderboard-emptygroup-768.png` / `audit/screens/leaderboard-emptygroup-1440.png` |
| leaderboard | onegame | local-synthetic (:3001) | `audit/screens/leaderboard-onegame-synthetic-375.png` / `audit/screens/leaderboard-onegame-synthetic-768.png` / `audit/screens/leaderboard-onegame-synthetic-1440.png` |
| leaderboard | thisweek | hosted-real (:3000, read-only) | `audit/screens/leaderboard-thisweek-real-375.png` / `audit/screens/leaderboard-thisweek-real-768.png` / `audit/screens/leaderboard-thisweek-real-1440.png` |
| legacy | gameid-redirect | hosted-real (:3000, read-only) | `audit/screens/legacy-gameid-redirect-real-375.png` / `audit/screens/legacy-gameid-redirect-real-768.png` / `audit/screens/legacy-gameid-redirect-real-1440.png` |
| mystery | emptygroup | local (:3001, empty or error, no data needed) | `audit/screens/mystery-emptygroup-375.png` / `audit/screens/mystery-emptygroup-768.png` / `audit/screens/mystery-emptygroup-1440.png` |
| mystery |  | hosted-real (:3000, read-only) | `audit/screens/mystery-real-375.png` / `audit/screens/mystery-real-768.png` / `audit/screens/mystery-real-1440.png` |
| player | fewgames | hosted-real (:3000, read-only) | `audit/screens/player-fewgames-real-375.png` / `audit/screens/player-fewgames-real-768.png` / `audit/screens/player-fewgames-real-1440.png` |
| player | newnorating | local-synthetic (:3001) | `audit/screens/player-newnorating-synthetic-375.png` / `audit/screens/player-newnorating-synthetic-768.png` / `audit/screens/player-newnorating-synthetic-1440.png` |
| player | onegame | local-synthetic (:3001) | `audit/screens/player-onegame-synthetic-375.png` / `audit/screens/player-onegame-synthetic-768.png` / `audit/screens/player-onegame-synthetic-1440.png` |
| player | settling | hosted-real (:3000, read-only) | `audit/screens/player-settling-real-375.png` / `audit/screens/player-settling-real-768.png` / `audit/screens/player-settling-real-1440.png` |
| player | unknownpuuid | local (:3001, empty or error, no data needed) | `audit/screens/player-unknownpuuid-375.png` / `audit/screens/player-unknownpuuid-768.png` / `audit/screens/player-unknownpuuid-1440.png` |
| player | veteran | hosted-real (:3000, read-only) | `audit/screens/player-veteran-real-375.png` / `audit/screens/player-veteran-real-768.png` / `audit/screens/player-veteran-real-1440.png` |
| stats | alltime | hosted-real (:3000, read-only) | `audit/screens/stats-alltime-real-375.png` / `audit/screens/stats-alltime-real-768.png` / `audit/screens/stats-alltime-real-1440.png` |
| stats | emptygroup | local (:3001, empty or error, no data needed) | `audit/screens/stats-emptygroup-375.png` / `audit/screens/stats-emptygroup-768.png` / `audit/screens/stats-emptygroup-1440.png` |
| stats | thismonth | hosted-real (:3000, read-only) | `audit/screens/stats-thismonth-real-375.png` / `audit/screens/stats-thismonth-real-768.png` / `audit/screens/stats-thismonth-real-1440.png` |
| tonight | balanced-admin | local-synthetic (:3001) | `audit/screens/tonight-balanced-admin-synthetic-375.png` / `audit/screens/tonight-balanced-admin-synthetic-768.png` / `audit/screens/tonight-balanced-admin-synthetic-1440.png` |
| tonight | balanced | local-synthetic (:3001) | `audit/screens/tonight-balanced-synthetic-375.png` / `audit/screens/tonight-balanced-synthetic-768.png` / `audit/screens/tonight-balanced-synthetic-1440.png` |
| tonight | emptygroup | local (:3001, empty or error, no data needed) | `audit/screens/tonight-emptygroup-375.png` / `audit/screens/tonight-emptygroup-768.png` / `audit/screens/tonight-emptygroup-1440.png` |
| tonight | filling6-admin | local-synthetic (:3001) | `audit/screens/tonight-filling6-admin-synthetic-375.png` / `audit/screens/tonight-filling6-admin-synthetic-768.png` / `audit/screens/tonight-filling6-admin-synthetic-1440.png` |
| tonight | filling6 | local-synthetic (:3001) | `audit/screens/tonight-filling6-synthetic-375.png` / `audit/screens/tonight-filling6-synthetic-768.png` / `audit/screens/tonight-filling6-synthetic-1440.png` |
| tonight | finished-admin | local-synthetic (:3001) | `audit/screens/tonight-finished-admin-synthetic-375.png` / `audit/screens/tonight-finished-admin-synthetic-768.png` / `audit/screens/tonight-finished-admin-synthetic-1440.png` |
| tonight | finished | local-synthetic (:3001) | `audit/screens/tonight-finished-synthetic-375.png` / `audit/screens/tonight-finished-synthetic-768.png` / `audit/screens/tonight-finished-synthetic-1440.png` |
| tonight | full-waitingroll-admin | local-synthetic (:3001) | `audit/screens/tonight-full-waitingroll-admin-synthetic-375.png` / `audit/screens/tonight-full-waitingroll-admin-synthetic-768.png` / `audit/screens/tonight-full-waitingroll-admin-synthetic-1440.png` |
| tonight | full-waitingroll | local-synthetic (:3001) | `audit/screens/tonight-full-waitingroll-synthetic-375.png` / `audit/screens/tonight-full-waitingroll-synthetic-768.png` / `audit/screens/tonight-full-waitingroll-synthetic-1440.png` |
| tonight | idle | hosted-real (:3000, read-only) | `audit/screens/tonight-idle-real-375.png` / `audit/screens/tonight-idle-real-768.png` / `audit/screens/tonight-idle-real-1440.png` |
| tonight | ingame | local-synthetic (:3001) | `audit/screens/tonight-ingame-synthetic-375.png` / `audit/screens/tonight-ingame-synthetic-768.png` / `audit/screens/tonight-ingame-synthetic-1440.png` |

## Headline findings (ranked)

1. **HIGH: Names are truncated where they matter most.** Team cards cut every name to 7 to 9 characters at 375 ("Jinxed L...", "Thresh ...", "Garen T...", "Syndro...", "PRT E...") and still do at 1440 ("Baron Nashor L..."). The first question on the page is "am I in, which side?" and the answer is an ellipsis. `tonight-balanced-synthetic-375`, `tonight-ingame-synthetic-375`, `game-finished-redwin-real-375/1440`, `games-expanded-real-375`. Fix: drop the role word to an icon-only column on phones, let names wrap to two lines, or move rating under the name. Never truncate the viewer's own row.
2. **HIGH: Fairness is explained in jargon, three different ways.** In one balanced view: "Red favored 51%", "Gap 45" (gap of what?), "Teams are 98% even", and unlabeled team sums 7350 / 7395 (the "sum of the five ratings" label exists in markup but is not shown at 375). Nothing visual (no bar, no meter) and "Next best: swap X and Y, gap 45" reads like a log line. `tonight-balanced-synthetic-*`, `game-finished-redwin-real-*`. Fix: one hero number (e.g., "51 / 49") with a split bar, one plain sentence ("Ratings differ by 45 points out of ~7,400, everyone on a main role"), and the alternative behind a disclosure.
3. **HIGH: Two competing headline ratings.** The board ranks on "Proven", the player card shows "Rating 1333" small and "Proven 0" huge. Real players with 83 games show Proven 0 (`leaderboard-alltime-long-real`). A brand-new player with 2W 1L sees a giant **0** (`player-fewgames-real-375`, `player-newnorating-synthetic-375`). This week's board says "Rating", all time says "Proven" (`leaderboard-thisweek-real` vs `-alltime-`). Fix: one public number. Show uncertainty as a "settling: 3/30 games" progress chip, never a 0.
4. **HIGH: Payload and performance.** Read-only GETs to :3000 (dev mode, so the absolute times are inflated): `/fun?window=all-time` is **58 MB HTML in 51 s**, `/games?window=all-time` 4.5 MB in 6.6 s (25,646 px tall at 375, 106 games, no pagination), `/leaderboard` 392 KB. There is no `loading.tsx`, `error.tsx` or `not-found.tsx` anywhere in `apps/web/app`, so a slow page shows nothing until it is done. Fix: paginate or virtualize games and fun, stream with Suspense, add route-level loading skeletons.
5. **HIGH: Error states are the bare Next default.** `/g/<unknown>`, a bad game id, and an unknown PUUID give a black "404 This page could not be found" with no nav, no brand and no way back (`error-unknownslug`, `error-404`, `game-badid`). The unknown-PUUID one keeps the shell but shows the same default block. Three of them log a React console error: "Encountered a script tag while rendering React component". Fix: a branded not-found with "Back to tonight" and an explanation (e.g., "this game belongs to another group").
6. **MED: Game detail and games list do not connect.** The games list cards are `<details>` with no link to `/g/customs/games/<id>`. The detail page has ratings and fairness but no KDA, champions or scoreboard. The list has the scoreboard but no fairness line. Durations print like clock times ("3 Oct 21:46" is a 21:46 game length; "Oct 3 · 21:46" on 1v1), which reads as "played at 9:46 pm". `games-expanded-real-375`, `1v1-pair-real-375`.
7. **MED: The phone nav hides pages.** The top tabs scroll sideways (488 px of content in 343 px) with no fade or arrow. "DAILY" shows as a lone "D", and Companion and Admin are off-screen. The wordmark is clipped at the top edge on every page (`*-1440`, top-left "KUSTOM"). Fix: a bottom tab bar (Tonight, Board, Games, More) or a visible overflow affordance, and fix the header top padding.
8. **MED: In game, the page feels static.** "IN GAME · Ratings move when it ends." with the same cards as balanced: no elapsed timer, no champions, no "started 14 min ago". The only live signal is the amber pill. "Sign in with Discord to pick your role" is still shown mid-game. `tonight-ingame-synthetic-375`.
9. **MED: Weak first visit (10-second test).** A newcomer on idle `/g/customs` sees "NOBODY IN YET", a Sign in button, then **ten empty "open" rows** (about 450 px at 375) before "How this works". The 99-champion fearless pool fills the rest (page is 3,665 px). What Kustom is and why to trust it sits below the fold. `tonight-idle-real-375`, `tonight-emptygroup-375`. Fix: collapse the empty rack to one line ("0 of 10, lobby not open"), and lead with a one-line pitch and a link to last night's result.
10. **MED: Bug on Stats Duos.** "Best together" and "Worst together" show the same pair with the same record (CasuaLxLegenD and Syndrome... 4W 1L 80%). `stats-thismonth-real-375`.
11. **MED: Tap targets.** Player-name links in lists are 18 to 21 px tall (games: 2,122 sub-32 px targets, fun: 1,434). "This game" / "See games" links are tiny, and "All games" on the player page is 61x16. FUN / 1V1 tabs are 25 to 28 px wide. These pass WCAG 2.2 AA's 24 px minimum only on height in some cases and fail it on others. They miss 44 px comfortably. Fix: make the whole row the link.
12. **LOW: Copy and leftovers.** The admin Discord page still talks about the dropped "voice split" and voice channel ids. Admin copy exposes `revoked_at`, `last_seen_at`, `pnpm --filter web rebuild-ratings`, `/api/admin/*`, and raw Discord snowflakes. Daily Mystery's countdown is labelled "NEXT GAME 17:08:34" (next puzzle?). Fun mixes Arabic captions with English. That is fine as character, but they have no translation or aria hint.
13. **LOW: Fearless champion icons look blank until scrolled.** 172 `loading=lazy` 24 px icons hot-linked from `raw.communitydragon.org/latest`, all with empty alt (fine: the name is beside them). Below the fold the chips render iconless (`tonight-finished-synthetic-375`, jungle and mid lanes). That is expected lazy behaviour, but it reads as broken in shares or slow loads, and it depends on a third-party "latest" path. No champion **codes** were seen anywhere: games, fun and 1v1 all print names (KAYLE, Draven, Master Yi), so the past complaint looks fixed.

## Findings per page

### Tonight `/g/customs` (`tonight-*`)
- HIGH, name truncation in team cards (see 1). `tonight-balanced-*`, `tonight-ingame-*`, `tonight-finished-*`.
- HIGH, fairness copy (see 2). The admin's "Reroll" sits inside the explanation box; for others the box has no action and no visual.
- MED, idle: 10 empty seat rows plus a long fearless pool push everything down (see 9). `tonight-idle-real-375` is 3,665 px.
- MED, in game: static (see 8).
- MED, the finished state is 4,659 px at 375. Result poster, then cards, then explanation, then Guess the Award (its title truncates: "Most damage to objectives · 6 /..."), then the full fearless pool. Deltas (+112 / -112) are good, but the poster's "Red was favored 51%." is a different sentence pattern from the explanation's "Red favored 51%".
- MED, filling: seat rows show only name and rating, with no main role or rank, so "why will these teams be fair" has no inputs on screen. "Nobody has set a role tonight, so the bot can put anyone anywhere" is good honest copy. `tonight-filling6-synthetic-375`.
- LOW, the sitting-out card is clear and kind ("first in line for the next one") and the "Waiting on Gankplank to roll" line names the admin. Keep both.
- LOW, desktop 1440: the right rail repeats How this works and Run the companion on every state. Top of the board shows only on idle real data.

### Leaderboard `/leaderboard` (`leaderboard-*`)
- HIGH, Proven vs Rating (see 3). The footer explainer is a 9-line paragraph (`leaderboard-onegame-synthetic-375`).
- MED, an expanded row lists every game the player ever played inline (13,357 px with 3 rows open, `leaderboard-alltime-expanded-real-375`). Fix: last 5 plus "See all on profile".
- LOW, the disclosure chevron is a tiny dim triangle. The "settling" pill is good but unexplained in place.
- Good: rank, name, big number, W/L, streak and window chips are dense and scannable. No overflow at 375.

### Games `/games` (`games-*`)
- HIGH, a 25k px page with no pagination (see 4).
- MED, no link to game detail. Duration reads as a clock time (see 6).
- MED, the expanded scoreboard at 375 wraps CS onto an orphan line under the role label and truncates names ("Syndro...", "CasuaLxLe...") (`games-expanded-real-375`).
- LOW, ARAM tab with zero games shows a bare "No games" (`games-aram-real`).

### Game detail `/g/customs/games/<id>` (`game-*`)
- HIGH, truncated names even at 1440 (`game-finished-redwin-real-1440`).
- MED, inconsistent: `game-finished-bluewin-real` has no "Blue was X%" line and no explanation box, while red-win games do (presumably no stored split). No stats or champions. No back link to games.
- Good: "RED WINS" poster, MVP/ACE, signed deltas, and a stable URL. The legacy `/g/<gameId>` redirect works (`legacy-gameid-redirect-real`).

### Player `/p/<puuid>` (`player-*`)
- HIGH, the giant "Proven 0" for new or settling players (see 3). The rating chart has no axis values or dates, only a "seed" line.
- MED, no identity header: no rank, main role, most-played champions or "last played". The page opens on window chips.
- MED, the unknown PUUID gives the default 404 inside the shell (`player-unknownpuuid`), with a console error.
- LOW, a no-games player (`player-newnorating-synthetic`) gets "No games yet." and a card that says Rating 1200 / Proven 0. That is fine, but there is no "here's how you get rated" next step.
- Good: By role / By side / Partners / Streaks blocks, and recent games with the roster and the viewer highlighted.

### Stats `/stats`, Fun `/fun`, 1v1 `/1v1`, Daily `/mystery`
- MED, stats Duos bug (see 10). Each role block shows only #1 with a lot of empty row height.
- HIGH, fun all-time payload (see 4). Fun is a long stack of "Museums".
- MED, 1v1 pair: "Last mee..." truncated label, duration-as-time, "26–24" series score is great. Pick two uses native selects (good on mobile).
- LOW, the mystery page is clean and works well on a phone. Big KDA, big answer buttons (44 px+). The countdown label is unclear.

### Admin `/admin/*` (`admin-*`, synthetic)
- MED, it is not group-scoped (still `/admin`, not `/g/<slug>/admin`). The tabs row clips ("Discoı").
- MED, contradictory state: Tonight card says "No lobby has been opened tonight" while Roll teams in the same page shows "customs night · 6 of 10 in" (`admin-home-synthetic-375`).
- MED, at 375 the players and tokens tables clip their right columns with no scroll hint (`admin-players-synthetic-375`, `admin-tokens-synthetic-375`). Every player row is an always-open form with a full-width Save.
- LOW, developer copy and stale voice-split references (see 12).

### Errors and empty
- HIGH, the default 404 (see 5).
- MED, empty boards say "No games this week yet." with no action (e.g., "Get the companion", "See last week"). `leaderboard-emptygroup`, `games-emptygroup`, `stats-emptygroup`, `fun-emptygroup`, `1v1-emptygroup`. Mystery's empty copy is good ("the first mystery writes itself").

## ui-ux-pro-max checks (searched `--domain ux`)

| Rule (severity in skill) | Result |
|---|---|
| Horizontal Scroll (High): content fits viewport | **Pass** on every page at 375/768/1440 (scrollWidth == clientWidth). Nav and admin tables scroll or clip internally; see 7 and Admin. |
| Touch Target Size / WCAG 2.2 Target Size (High) | **Partial.** Primary buttons (Roll, Reroll, Sign in, role chips, window chips, mystery answers) are 44 px+. Inline name links are 18 to 21 px, FUN/1V1 tabs 25 to 28 px wide, "All games" 61x16. |
| Essential Text Truncation (Critical): no clamping of essential meaning | **Fail.** Player names in team cards, game detail and scoreboards. |
| Empty States (Medium): helpful message plus action | **Partial.** Messages present, actions absent except Mystery. |
| Error Messages / recovery (High) | **Fail.** Default 404, no recovery path, no error boundary. |
| Loading States / Indicators (High) | **Fail.** No loading UI. Server render blocks 1.4 to 51 s (dev). Live updates via realtime plus `router.refresh()` poll exist (`_tonight/TonightLive.tsx`). |
| Content Jumping (High) | Not observed (static shots). The lazy icons have a fixed 24 px box, so no CLS from them. |
| Active State nav (Medium) | **Pass.** Underlined active tab. |
| Table Handling mobile (Medium) | **Fail** in admin (clipped). The public pages use card rows, which pass. |
| Contrast (Critical) | **Pass by inspection.** The tokens are documented as measured at AA (docs/05-design.md). The smallest text found is 12 px uppercase mono (nav, labels). Dim `open` seats and mono labels are low-emphasis but readable. |
| Color not sole signal (Charts) | **Pass.** Sides carry the BLUE/RED words, and deltas are signed, not coloured. The rating chart lacks axes and labels. |

## What works, keep it
- The Floodlit look: ink background, blue and red with matched contrast, amber as the single light. It reads as a gaming product, not a template.
- The tonight page as a state machine with one honest headline per state ("6 IN THE LOBBY · Four more to go", "TEAMS ARE SET", "IN GAME", "GAME OVER").
- Naming the admin while waiting ("Waiting on Gankplank to roll the teams") and the kind sitting-out card.
- Signed rating deltas per player on the result, plus MVP/ACE and top damage.
- Window chips (This week ... All time) are consistent across board, games, stats, fun, 1v1 and player.
- The result poster ("RED WINS", "Red was 46%. Red won.") is the clearest fairness moment in the app. Build on it.
- Daily Mystery: compact, thumb-friendly, a great share hook.
- 1v1 head-to-head ("26–24", form W W W W W) and the fun Museums give the group character.
- No horizontal page scroll anywhere. Day/Night toggle. Old links redirect.

## States not reached
- **Loading**: there is no loading UI to capture (no `loading.tsx`). Shots are taken after networkidle.
- **Real lobby filling / balanced / in game**: none were live on hosted. These are synthetic only.
- **Off-role split / amber threshold, reroll result, side-line "move to your side" mismatch, latecomer "missed the invite"**: partly visible (the missed-the-invite line shows in the admin view). Not separately staged.
- **Dropped / abandoned lobby, remake**: not staged (timebox).
- **Day theme**: not shot. All captures are Night, the default.
- **/new, /join/<code>, /g/<slug>/admin**: described in docs/05-design.md (M13.7) but no `page.tsx` exists yet.
- **Signed-in non-admin player view** (role picker for a linked player who is not admin): not staged.
- **Discord OAuth sign-in flow**: not exercised. The admin session was injected locally.

## Local DB rows added (127.0.0.1 only, never hosted)

Before: `groups` 1 (customs), `seasons` 1, and 0 rows in players, games, lobbies, group_memberships, ratings and auth.users. (fearless_state, window_posts, group_invites and daily_mysteries were not counted beforehand.)

Added through the app's own routes on :3001 plus three direct statements:
- `players` 12: puuid `audit-p00` ... `audit-p11` (p00 through `mint-token`, p01-p10 through lobby posts, ranks for all through `/api/companion/rank`; p11 "Nunu Newbie" has no games).
- `companion_tokens` 1 (label `audit host`, player audit-p00).
- `group_memberships` 11 (customs; audit-p00 set to role `admin` by direct UPDATE).
- `players.discord_id` / names for audit-p00 set by direct UPDATE (`999000111222333444`, "Gankplank#EUW").
- `auth.users` 1 (`audit-admin@example.test`, id `c49b9cb1-693e-4560-98d8-44d3b26ef019`, local email signup) plus `auth.identities` 2 (its email identity and a direct INSERT discord identity `e8cc33b8-54c6-44d5-a87c-67f072f61757`), plus 2 `auth.sessions`.
- `lobbies` 1 (`037c9d42-6a74-44f3-ab05-8a5f02712849`, party `audit-party-1`, now finished), `lobby_members` 11, `splits` 3 (one chosen).
- `games` 1 (`858508c3-0162-423d-8ad7-0ff200dc6af0`, lcu 7700000001), `game_players` 10, `ratings` 10.
- Side effects of ingest: `fearless_state` 1, `daily_mysteries` 1 plus `daily_mystery_clues` 5, `window_posts` 1, `group_invites` 1 (may have pre-existed).

Remove with (local only):
```sql
delete from game_players where game_id='858508c3-0162-423d-8ad7-0ff200dc6af0';
delete from daily_mystery_clues; delete from daily_mysteries;      -- only the audit game existed
delete from games where id='858508c3-0162-423d-8ad7-0ff200dc6af0';
delete from splits where lobby_id='037c9d42-6a74-44f3-ab05-8a5f02712849';
delete from lobby_members where lobby_id='037c9d42-6a74-44f3-ab05-8a5f02712849';
delete from lobbies where id='037c9d42-6a74-44f3-ab05-8a5f02712849';
delete from ratings where player_id in (select id from players where puuid like 'audit-p%');
delete from companion_tokens where label='audit host';
delete from group_memberships where player_id in (select id from players where puuid like 'audit-p%');
delete from players where puuid like 'audit-p%';
delete from auth.users where email='audit-admin@example.test';     -- cascades identities/sessions
-- fearless_state / window_posts: reset or leave; or simply `pnpm db:reset` (local was empty before).
```
