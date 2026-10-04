# M2 test night: the run sheet

The M2 acceptance line: *two people run the companion, play one custom, and the game appears once in `games`
with ten `game_players` rows and updated ratings. Kill one companion mid-game; the game still lands.* The
sequence that proves it, and the evidence to paste back. Site <https://playkustom.com>.

## Two sessions, and M2 is ticked only after the second

**Session 1 is one companion on the Windows PC**: install, first run, a lobby, a game, a client restart, a
sleep and the queue recovery — proof that the thing a friend downloads works on the platform it ships on. It
proves nothing about ratings (a custom with fewer than ten humans is stored and never rated; the fold needs
ten participants, five a side, over 300 s — `apps/web/README.md`, "the rating fold") and **nothing about two
companions**: dedupe (M2.3 check 9) and killing one of two mid-game (check 8) move to Session 2.

**Session 2 is the ten-human night, two companions, two games.** Game 1, both alive, is the acceptance line:
one `games` row, ten `game_players` rows, ratings move, exactly one poster says `created: true`. Game 2 is the
kill at minute five. Until it lands M2 is **partial**, the only standing proof of the fold being
`apps/web/app/api/companion/lobbyState.integration.test.ts` → "rates a real game once, however many companions
post it".

## Before Session 1 (you)

1. **Vercel has every variable.** Everything in `.env.example`, plus `CUSTOMS_NIGHT_TZ=Africa/Cairo` and
   `CRON_SECRET`. Check `/api/health` answers, and that `/api/cron/sweep` with `authorization: Bearer
   $CRON_SECRET` answers `{ ok: true, abandoned: <n> }` — a 503 means the secret is not set on Vercel.
2. **A season is active.** `/admin` must name one, not say "No season is active". `games.season_id` is
   `not null default active_season_id()`, so with no active season **every game insert of the night fails**
   (M2.18 is the task that makes that failure say so).
3. **One token**, minted at `/admin/tokens` against your own player row, labelled `windows pc`. Shown once;
   never paste it into a thread. And **the M2.11 pass first** on that PC (`git clone`, `pnpm install`,
   `smoke --diff`): a client-shape difference found later, with ten people waiting, is the worst place for it.
4. **The exe**, when M2.6 lands, from
   <https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe> — no GitHub account
   needed. Until then `pnpm --filter companion dev` on the same PC. At the first-run prompt:
   `https://playkustom.com`, then the token.

## Session 1: one companion, one PC (an evening, mostly waiting)

**Install and first run (M2.6 checks 1 to 3).**

1. Download the exe to the desktop, double-click, paste the token. Time it: download to `watching` under two
   minutes, no address typed if the baked origin answers, and it prints `signed in as <name>`.
2. Close it and run it again: no prompt, `watching` again, and `%APPDATA%\customs-night\config.json` holds the
   token and the origin. Then, once, paste a wrong token into a fresh config: one plain sentence naming the
   admin page, no stack trace, and the process still running a minute later.

**Client restart and sleep (M2.6 checks 4 and 5).**

3. With it running, quit and relaunch the League client: within 30 s it logs `lockfile gone; the client has
   exited` or `lockfile changed; the client restarted`, then `watching` again. No human action, no exit.
4. Sleep the PC for two minutes and wake it: back at `watching` within 60 s, and a lobby opened after the wake
   still produces a `lobby posted` line. A socket that comes back open but silent is a finding, not a shrug.

**A lobby and a game, alone.**

5. Open a custom lobby, add bots if you like (the companion drops them before posting): `lobby posted` with
   `memberCount: 1`, `status: "open"`, `recheckInMs` null — one person is not ten, so nothing balances, which
   is the rule and not a fault.
6. Play past six minutes and **end it with a winner** — do not quit out, a block with no winner is thrown away
   (`TerminatedInError`, M2.10). Expect `game started`, `end-of-game block captured`, `game posted ...
   created: true`, and one `games` row with one `game_players` row and `mu_after` null: stored, never rated.

**Queue recovery (M2.3 check 5, run with the API unreachable rather than answering 500 — same retryable
path, and a true 500 stays covered by that task's stubbed check 6).**

7. Stop it, set `"apiBase": "http://127.0.0.1:9"` in `%APPDATA%\customs-night\config.json`, start it again:
   `api not reachable now; calls will retry`.
8. Play a second short custom and end it with a winner. Wait for `end-of-game block captured`, click past the
   scoreboard so the client drops the block, confirm `%APPDATA%\customs-night\queue\<gameId>.json` exists,
   then kill it hard: `taskkill /f /im Kustom.exe` (or `/im node.exe` on the dev path).
9. Put the real `apiBase` back and start it: it replays the queue (`game posted ... created: true`) and
   `queue\` is empty. Start it once more — still empty, still one `games` row for that `gameId`.
10. **No spam (M2.6 check 7).** An hour with the client open and no lobby: at most 20 console lines, and none
    carrying the token, a lockfile password or a raw event body.

## Before Session 2 (you)

1. **Who runs the second companion**, and on what: the Mac (`pnpm --filter companion dev`) with a second
   League account in the room, or a friend's PC with the exe. Decided before the night, not on it.
2. **Its player row must exist before you mint its token** — `/admin/tokens` mints against an existing player,
   which is why the README tells a first-timer to join a lobby before asking for one. Get them into a lobby
   your companion posts, refresh `/admin/players`, then mint.
3. **`record-ws` on the second machine** during the ten-human lobby: the `lobby-10.json` the M2 note asks for.

## Your friend's part (paste this to them)

> Tonight we are testing the bot that picks teams. Nothing for you to do beyond the usual: get in the custom
> lobby and play. Two of us run a little app that watches the League client — it only reads, it never clicks
> anything for you. Two small things: when a game ends, sit on the scoreboard about ten seconds before you
> click through so the app can read it, and do not end a game by everyone quitting out — the client writes
> down "no winner" for those and the bot bins them. Surrender or knock the nexus down.

## Session 2: ten humans, two companions, two games

**Game 1 — the acceptance line.**

1. Ten people in one custom lobby, both companions among them and at `watching`.
2. Watch the console: `lobby posted` with `memberCount: 10` and `recheckInMs: 10000`, then a post ten seconds
   later with `status: "balanced"`. `ranksNeeded` is non-zero the first time anyone new appears and drops to
   `0` on a later post — rank sync closing itself out (M2.4 check 9).
3. Start the game: both log `game started`, `game start posted`, then `lobby posted` with `rosterFrozen: true`
   and `lobby roster is frozen on the server; posts no longer change it` (M2.5 check 6).
4. Play past five minutes, end with a winner, both companions up. Both log `end-of-game block captured` with
   `participants: 10`, then `game posted` — **exactly one says `created: true`** (M2.3 check 9).

**Game 2 — kill one companion mid-game (M2.3 check 8).**

5. Same ten if you can, new lobby, both at `watching`. At **five minutes in**, kill the second companion
   (`pkill -9 -f "companion"`, or `taskkill /f` on Windows).
6. Finish with a winner. The survivor alone logs `end-of-game block captured` and `game posted ...
   created: true`. Restart the killed one afterwards: nothing queued, nothing posted, still one `games` row.

**The tonight page on a real phone (M3.4) — eyeball, not pass or fail.**

Only if the tonight page is deployed by the night. Three things the designer raised in the M3.4 review that
no laptop can answer, so they ride along on the ten-human night. Look, then say what you saw; each becomes a
task with its own ID only if the night says it should. None of them blocks M2 or M3.4.

7. **The empty slab.** At about seven in the lobby, on your own phone, at the brightness you actually use in
   a dark room: the member list holds ten rows' height from the first paint, so three empty rows sit under
   the last name. Does that read as "three more to come", or as a page that half-loaded? OLED screens make
   the empty part disappear into the background, which is the whole question.
8. **Below the fold.** With eleven around, so the sit-out strip is up, on a 390 x 844 phone (iPhone 12/13/14
   class): is the Blue card's support row on screen without scrolling? If it is not, say how far you had to
   scroll to find your own name.
9. **Long names.** Get somebody with a Riot ID past 25 characters into the lobby. Where does the ellipsis
   land, in the member list and on the team card, and can the group still tell who it is?

## After each session, paste this back

**After both.** The console from `customs night companion starting` through `watching` (version, `configDir`,
`logDir`, `signed in as <name>`), and every `end-of-game block captured` and `game posted` line from every
machine: `gameId`, `startedAtFrom`, `durationS`, `winningSide`, `participants`, `created` — "appears once with
ten rows" in the companion's own words. **Never** a token, `config.json`, a lockfile password, or a log file
nobody has read first.

**After Session 1 only.** Download-to-`watching` time and the exe's size; what it printed on the client restart
and on the wake; the queue filename before the kill and the `game posted` line of the replay; the League patch
and anything `smoke --diff` reported; the console line count from the idle hour.

**After Session 2 only.** Every `lobby posted` line of game 1 (`status`, `memberCount`, `created`,
`rosterFrozen`, `recheckInMs`, `ranksNeeded`) plus the `lobby roster is frozen` line; and from
`/admin/players`, that ten rows carry a **Rating** which has moved, **Rank** and **Riot ID** are filled in for
people nobody had seen before, and a **Name** you set by hand is untouched (M2.4 check 9).

The lead reads the counts off **`/admin/games`** (M5.5), not out of the database by hand: `Captured` has one
row per game with `10` players, `eog` and `rated: yes`, and `Missed` says `Nothing missing. Every game that
started has a result.` — which is the same sentence as "both Session 2 lobbies finished". The two things that
page does not show are still read from the database: ten `ratings` rows with `games` up by one and `wins` on
exactly five, and three `splits` rows with one `is_chosen`.

## Pass or fail

| Acceptance check | Where it is proved | Evidence |
|---|---|---|
| The game appears **once** in `games` | Session 2, game 1 | one `created: true` and one `created: false`; one `games` row |
| Ten `game_players` rows | Session 2, game 1 | `participants: 10` on both capture lines; ten rows |
| Updated ratings | Session 2, game 1 | Rating moved on ten `/admin/players` rows; `mu_after` non-null |
| Kill one companion mid-game; the game still lands | Session 2, game 2 | killed at 5:00, survivor's `game posted ... created: true` |
| M2.3 check 9: two companions, one eog | Session 2, game 1 | exactly one `created: true` |
| M2.3 check 5: crash and recovery | Session 1, steps 7 to 9 | queue file present, hard kill, replay, `queue\` empty twice |
| M2.6 checks 1 to 5, 7: install, second run, bad token, restart, sleep, no spam | Session 1, steps 1 to 4, 10 | times, printed lines, line count |
| M2.4 check 9: names, ranks, `ranksNeeded` | Session 2, game 1 | Rank and Riot ID filled; an admin-set Name untouched; `ranksNeeded: 0` later |
| M2.5: the roster freeze | Session 2 | `rosterFrozen: true` with the full member count |

Session 1 passes only its own rows. M2 stays **partial** until Session 2 lands.
