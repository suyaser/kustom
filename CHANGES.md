> **Work in progress (refreshed 2026-10-04).** Everything below is merged into `redesign-2.0` and runs on the
> local stack. Production hasn't been touched. This goes to you for sign-off once the open items in section 4
> are settled; your sign-off also ticks M14.26 (the milestone review).

# Kustom 2.0: what changed

Branch `redesign-2.0`. 2.0 is now four things in one deploy:

- **M14, the redesign**: the new look (Direction C, "Floodlit Slate"), five tabs, the fairness receipt on every
  surface, groups for anyone, the Mode card. Since the first draft of this document: an admin audit, a flow audit,
  one rating number, tap to see why, and Discord posts 2.0.
- **M15, Mode of the night**: one game in a night with a twist. Class wars, region wars, mirror match. Accepted.
- **M16, Kustom Premium**: AI-written lines on games, the week and players, for groups with Premium on. Done for 2.0.
- **M17, Kustom 1.0**: the companion rewritten in Rust. Small, updates itself, no overlay. Built, **not yet
  shipped**: it waits for your Windows checks. 2.0 deploys with 0.3.x as the download.

Screens are committed under `redesign/screens/` (`m14/`, `m15/`, `m16/`, `m17/`, `discord/`, `admin-audit/`).
The old "before" pictures from the Phase 1 audit only exist on this Mac (`audit/screens/`, gitignored), so this
version links "after" pictures only.

Contents
1. What's new for friends
2. What's new for admins and owners
3. Under the hood
4. What's waiting on you
5. Known limits and follow-ups
6. Calls made while you were away (still standing)

---

## 1. What's new for friends

### Tonight

- One headline per state: idle, filling, teams set, in game, finished. Over ten people: who sits out is named
  before the roll. ([teams set](redesign/screens/m14/m1445-after-balanced-375.png),
  [in game](redesign/screens/m14/m1445-after-in-game-375.png))
- The receipt stays up all game (compact, with a timer) and opens to `How the bot decided`.
  ([full receipt](redesign/screens/m14/receipt-full-375.png))
- **New since the first draft:**
  - The Mode card can carry a one-game rule (section "Mode of the night" below).
  - Finished seats explain their points on tap (see Board).
  - A friend who isn't linked yet sees `Which one is you?` straight under the strip, before anything else.
    ([screen](redesign/screens/m14/audit-claim-first-375.png))
  - If no host's Kustom is running, Tonight says so before anyone taps, and names who to ask:
    `Nobody's Kustom is running right now. Ask Yasser or Omar to open it.`
    ([screen](redesign/screens/m14/audit-no-host-375.png))
  - The fairness line now names every admin power: they can also pick the mode and whether the next game is
    rated, before a roll, never after. ([screen](redesign/screens/m14/audit-fairness-receipt-375.png))
  - A Day/Night switch sits in the top bar on every page. ([screen](redesign/screens/m14/m1447-topbar-night-375.png))

### Mode of the night (M15)

An admin picks a rule on Tonight's Mode card, or taps **Spin**, before Roll teams. It lasts one game, then the
card goes back to the group's usual mode (Normal or Fearless). Kustom never touches champion select: the rule is
announced, the allowed champions are shown on the mode panel, and the result is checked afterwards.

- **Class wars**: Tanks only, Marksmen only, Mages, Assassins, Supports. Not rated by default.
  ([card](redesign/screens/m15/m155-class-balanced-375.png), [panel](redesign/screens/m15/m155-panel-class-tanks-375.png))
- **Region wars**: the server deals each side a region at Roll (`Ionia vs Noxus`), words only, no Riot art. Not
  rated by default. If too few champions are open to draw two regions, the card says it didn't apply.
  ([panel](redesign/screens/m15/m155-panel-region-drawn-seated-red-375.png))
- **Mirror match**: your lane opponent plays your champion. **Rated.** For now the host opens a Blind Pick lobby by
  hand, and Tonight says so. Spin never lands on mirror until Kustom can open that lobby itself (M17.17).
  ([idle with host line](redesign/screens/m15/m155-mirror-idle-admin-375.png))
- **Spin**: picks a rule for you, never the same one twice in a row. ([reveal](redesign/screens/m15/m155-spin-reveal-landed-375.png))
- **Rated switch**: admins can make the next game rated or not, in any mode. It locks at Roll teams.
- **After the game**: the poster and the Discord result say who kept the rule, naming champions, never players.
  Breaking it never changes the result. ([finished](redesign/screens/m15/m155-class-finished-375.png))
- History names the rule: `Tanks only · not rated`, `Mirror match`. ([games list](redesign/screens/m15/m1519-games-375.png))

### Board

- **One rating number** (M14.57). Every gain or loss anywhere is the same all-time number. Before, the same game
  could show `-50` on one tab and `-120` on another. That's gone.
- **This week and Last week rank by points**: the sum of your games' points that week, with W-L. Ties go to more
  wins, then fewer games, then Rating, then name. ([this week](redesign/screens/m14/m1457-board-this-week-375.png))
- **Month windows are gone** (your call: "a useless filter"). This week, Last week, All time remain.
- All time keeps the `Still settling` section for anyone under 10 rated games.
- An empty week points somewhere: `No games this week yet.` with `See last week`.
  ([screen](redesign/screens/m14/audit-empty-week-board-375.png))
- Two people with the same name are told apart (`Ali #EUW`, or `Ali (2)`), everywhere names are listed.
  ([screen](redesign/screens/m14/audit-same-names-board-375.png))
- One word everywhere: **Board** (no more "leaderboard" in the copy).

### Tap to see why (M14.58, M14.59)

The group's complaint was "I lost 50 that game but 120 the game before". Every points number on the game page,
player rows and Tonight's finished seats is now a button. Tap it:

> You lost 50. Your side was the 62% favourite, so a loss costs more. You're settled, so swings are small. ACE
> softened it by a fifth.
>
> *Upsets and new players move the most.*

([game page, open](redesign/screens/m14/m1458-game-open-375-night.png),
[Tonight, open](redesign/screens/m14/m1458-tonight-open-375-night.png))

Also: the odds on a result are now the odds the rating actually used. When those differ from the bot's pre-game
odds (usually because a new player started at 1200), one line says so:
`For points, Blue was 61%, because new players start at 1200.` Discord doesn't get the explanation; its link
opens the page that has it.

### Games

- Every row opens its game and carries the compact receipt; 25 per page; durations read `21 min`.
  ([list](redesign/screens/m14/games-list-375.png), [game](redesign/screens/m14/game-rolled-375.png))
- Filters are now `Tonight · This week · All` (no months).
- A not-rated game shows no after-the-fact odds. The bot's own odds and `Upset!` stay.
- Kill participation never reads over 100%.

### Stats

One tab with `Records · Champions · 1v1`, under 350 KB. Month windows are gone here too.
([records](redesign/screens/m14/m1448-stats-records-375.png))

### You

Your Rating, W-L, tonight's change, `Your night`, and you vs everyone. Signed out, one honest pitch.
([you](redesign/screens/m14/you-self-375.png)) New since the first draft:

- The Day/Night switch here and in the top bar stay in sync.
- In a Premium group, your own scouting report shows here, and a switch lets you opt out of AI lines about you.
- The "claim your games" prompt says plainly: `Next time you're in the group's lobby, open Tonight and tap That's me.`

### Discord (M14.61, Discord posts 2.0)

Posts now look good, not just carry information:

- Teams and result posts are a stack of cards: a header, a blue side, a red side, a closing block. Each side is
  coloured. A ten-cell 🟦🟥 odds bar.
- Sent as **Kustom** with its own avatar; the group name sits at the top.
- Links read as words, not raw URLs. Each seat's Rating and its change stay on one line.
- A result badge (`RED WINS` / `BLUE WINS`) appears on result posts, once the site is live on its public address.
- Mode-of-the-night games add a rule line on the teams post, and a kept/broke line on the result.
- The Sunday post is weekly only (no monthly post), ranked by points, titled `Last week · board`.
- Every post is complete even if the images don't load.

Screens (built from the real code, not a real channel):
[teams](redesign/screens/discord/built-teams-375.png),
[teams with a rule](redesign/screens/discord/built-teams-rule-375.png),
[result](redesign/screens/discord/built-result-375.png),
[Sunday](redesign/screens/discord/built-weekly-375.png). The real-phone check is yours (section 4).

### Kustom Premium (M16)

For groups with Premium on. Invisible everywhere else: a non-Premium group's pages and posts are byte-identical
to before. No payments or billing yet; you switch Premium on per group with a script.

- **AI recap**: one line on each game, on the Discord result (edited in within 15 minutes), Tonight's poster and
  the game page. ([poster](redesign/screens/m16/m164-poster-375.png))
- **Weekly storyline**: a paragraph opening the Sunday post and on the board's Last week.
  ([board](redesign/screens/m16/m165-board-lastweek-storyline-375.png))
- **Scouting report**: two or three lines on a player's page and their You page, written weekly, for players with
  10+ rated games. ([player page](redesign/screens/m16/m166-member-375.png))

How it stays honest and friendly:

- Every number, name and champion in a line is checked against the database. A line that fails the check is no
  line, never an unchecked one.
- Players go to the AI as `P1..P10`, never by name.
- Only winners get teased, and only about their numbers. Someone who lost is named only for a number they earned.
  Never "carried", "lucky", "boosted".
- Any player can opt out. Admins can hide any line with one tap.

**The verdicts:**

| | Score | Verdict |
|---|---|---|
| Game recap (M16.8) | 4.2 of 5 (funny 3.2, accurate 4.9, tone 4.8), vs 2.8 on the first prompt | Keep, on Sonnet 5.5 |
| Weekly storyline (M16.9) | refused for good: 3 of 15 weeks down to 0 of 15 | Keep |
| Scouting report (M16.19) | engaging 3.0, specific 4.1, friendly 4.9 (bar: 3.0 / 4.5) | Keep, **at the floor**, under the real-group read |

All three judged on one real game plus made-up games with the real roster's names: agents don't read hosted
data. The real test is M16.20 (section 4).

### Kustom 1.0, the companion (M17, not shipped yet)

What hosts will get once your Windows checks pass. Members install nothing.

- One small Windows app (the Mac test build is 9.9 MB; the installer limit is 15 MB, down from 95 MB).
- Link it once with the six-character code from the site. It starts with Windows, sits in the tray, shows the group
  and whether League is connected, and records every custom exactly as before.
- Updates itself, never mid-game and never with a game still waiting to send.
- No overlay. A member who pairs by mistake is told they don't need it, and it stops starting with Windows.

Screens: [link](redesign/screens/m17/m178-l1-idle.png), [home](redesign/screens/m17/m178-home-one-group.png),
[update ready](redesign/screens/m17/m178-update-ready.png), [member refused](redesign/screens/m17/m178-l7-member.png),
[tray](redesign/screens/m17/m178-tray-two-groups-menu.png).

---

## 2. What's new for admins and owners

Since the first draft, from the admin audit (M14.50 to M14.56) and the flow audit (M14.62 to M14.78):

- **New groups start on Normal** (M14.46). Existing groups, `customs` included, keep their mode.
- **Admin home** is shorter once set up: the Tonight card is gone, and the host card folds to `Set up another PC`.
  Premium groups get one `Kustom Premium` card with the month's budget.
  ([ready group](redesign/screens/admin-audit/kit-admin-ready-375.png),
  [Premium card](redesign/screens/m16/m163b-admin-premium-375.png))
- **Members** is findable at 375: owner first, then admins, then by last played, with a `Find someone` box.
  Actions sit behind one `Manage` row. ([find](redesign/screens/m14/admin-members-find-375.png))
- **Unlink Discord** (M14.60): an admin can clear a member's Discord link from Manage. The owner can't unlink
  themselves; only the owner can unlink another admin. ([confirm](redesign/screens/m14/admin-unlink-confirm-375.png))
- **Hosts** names each PC (`Sami's PC`, never `This PC`), says `Not seen yet` until it connects, and folds stopped
  ones away. ([hosts](redesign/screens/m14/admin-hosts-375.png))
- **Recording** (was admin Games, same URL) says why each game isn't rated: `No · ARAM`, `No · Tanks only`,
  `No · Rated was off`, `No · before the ratings reset`, `Waiting to be counted`. Never `Not yet`.
  ([recording](redesign/screens/m14/admin-recording-375.png))
- **Reset ratings** doesn't show before the group's first rated game. The owner's own Members row says how to step
  back: `You're the owner. To step back, make an admin the owner.`
- **The creator can always get back to admin** before linking League.
- **Premium switches**: an admin can turn AI lines off for the group, mark a member `Don't write about`, and hide
  any single line.
- **Hosting on a friend's PC means making them an admin**; they pair their own PC with a code. The old "add a host
  by hand" key goes away the day Kustom 1.0 becomes the download.
- Gone: the old `POST /api/admin/players` route and the display-name override. Names follow each player's Riot ID.

---

## 3. Under the hood

### Migrations: 0021 to 0035, all local only

Nothing is on hosted yet. The ship runbook pushes fifteen files in one go, `0021` to `0035`. The ones added since
the first draft:

| File | What | Notes |
|---|---|---|
| `0029` | Hides who set the mode or reset Fearless from the public key | M14.40 |
| `0030` | New groups start on Normal | Rewrites no existing row |
| `0031` | Premium flag and per-group AI cap (default $2) | Premium off everywhere until you switch it on |
| `0032` | Mode of the night: the pending rule, the lock at Roll, `games.rated` | Every existing game stays rated |
| `0033` | AI lines, AI calls, the spend meter and kill switch | Caps enforced inside the database |
| `0034` | Why this many points: the fold stores odds, base change and award per player | Old games filled by one `rebuild-ratings` run after the push (runbook 3.7a) |
| `0035` | Region wars that couldn't be drawn | Flags only |

`0026` (remove seasons) is still the one that **deletes rows**. `0026` to `0035` each run in a transaction.

### Crons (Vercel)

| Path | When (UTC) | What |
|---|---|---|
| `/api/cron/rebuild` | 04:15 daily | **New** (M14.63). Games recovered the next day count toward ratings by the next morning. No more running `rebuild-ratings` by hand after a backfill. |
| `/api/cron/window` | 04:30 daily | Now weekly only (no month). On Sundays, Premium groups also get the storyline and scouting reports. |
| `/api/cron/leaderboard` | 04:30 daily | Unchanged |
| `/api/cron/mystery` | 21:00, 22:00 | Unchanged |

### Env vars on Vercel Production

New: `SUPER_ADMIN_USER_IDS`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, and
`ANTHROPIC_API_KEY` (Production only, so previews never spend). `NEXT_PUBLIC_SITE_URL` must be exactly
`https://kustom-delta.vercel.app`: if it's wrong, Discord images silently drop. `BOOTSTRAP_ADMIN_PUUID` must be
**your** PUUID, because it now picks `customs`'s permanent owner. Full table: runbook §1.5.

### AI cost and the kill switch

- **Cost**: about **$0.94 per group per month** on a synthetic month (150 games, 20 players), 47% of the $2 cap.
  A game line costs about half a cent. All three features run on Sonnet 5.5.
- **Caps**: $2 per group per month, $20 overall, enforced in the database (each call reserves its worst case first).
  At a cap the AI goes quiet until the 1st; admins see `Paused · cap reached`. Plus your $20 limit in the
  Anthropic console as a backstop.
- **Spend so far** on evaluation: about $4.15 of the $4.50 you allowed.
- **Nothing spends until** the key is on Vercel **and** you run `set-premium customs on --hosted` (runbook 3.7b).
- **Kill switch**, no deploy, in the Supabase SQL editor:
  `update public.ai_settings set calls_enabled = false;`

### The companion contract

The Rust app speaks the same server routes with the same bodies. That is proven by 41 recorded "goldens" from the
old engine, checked against the server's schemas in CI. The server keeps accepting 0.3.x until M17.15.

### New commands

`set-premium`, `ai-eval`, `ai-eval-month`, `ddragon-fixture`, `seed-regions`, `export-schemas`, `make-goldens`,
and the Rust `tauri:dev`. `rebuild-ratings` and `set-premium` print their target first and refuse a non-local
database without `--hosted`. All listed in `CLAUDE.md`.

---

## 4. What's waiting on you

Rough order. Items marked **(blocks ship)** gate the 2.0 deploy; the rest can follow it.

### Before the deploy

- [ ] **M14.62: ship 2.0 with Kustom 1.0, or not?** (blocks ship) New groups set up a host with `Get a code`,
  which only works with Kustom 1.0. Until 1.0 is the download, a new group gets stuck on
  `Waiting for Kustom to connect…`. Pick one:
  - **(a) Together.** Deploy 2.0, then make 1.0 the download within days, after Windows round-trip 1. Don't promote
    new groups in between; only `customs` hosts, on 0.3.x with its existing key. This matches the 2026-10-04
    decision row.
  - **(b) Not together.** Point the host card at the Hosts page's hand key while 0.3.x is the download.

  Note: 1.0 can't pair against production until 2.0's server is live, so the deploy comes first either way.
- [ ] **Discord portal redirects.** Discord developer portal → the sign-in app → OAuth2 → Redirects: add
  `https://kustom-delta.vercel.app/api/admin/discord/callback` and
  `http://localhost:3000/api/admin/discord/callback`. Runbook §1.6.
- [ ] **The two local live checks** (runbook §1.6b): Connect Discord to a scratch channel, and check the `-#`
  line renders small and grey. Paste `PASS`/`FAIL` back.
- [ ] **`ANTHROPIC_API_KEY` on Vercel, Production scope only**, plus a **$20 monthly spend limit** in the
  Anthropic console. Setting the key spends nothing by itself.
- [ ] **Run the M14.27 runbook** (`docs/runbooks/ship-2.0.md`): back up, seasons drop counts (§1.4), env (§1.5),
  the window, migrations `0021`→`0035` in one push, merge to `main`, smoke pass, then the one-offs (§3.7: fill
  the breakdowns, switch Premium on for `customs`). Review `0026` before it reaches hosted: it deletes rows.
- [ ] **§3.9 phone check, after the deploy.** Send the teams, result and Sunday posts to a scratch webhook, then
  look on a phone and a desktop: Kustom avatar, sides as cards, the 🟦🟥 bar, the result badge, nothing cut off.
  Send six screenshots to the lead. That ticks M14.61.

### Kustom 1.0 (M17)

- [ ] **The updater signing key** (`docs/runbooks/companion-release.md`, steps 1 to 3):
  1. Generate it outside the repo: `tauri signer generate`.
  2. Add three repository secrets on `suyaser/kustom`: `TAURI_SIGNING_PRIVATE_KEY` (the file's content, not its
     path), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `KUSTOM_RELEASES_TOKEN`.
  3. Put the public key in `apps/companion/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.

  Until the pubkey is real, a release tag stops at the publish guard. Dry runs work today.
- [ ] **The Blind Pick read-back (M17.17).** It's built and reviewed, but held on its own branch. With League open
  on this Mac and not in a lobby:
  ```sh
  cd /Users/suyaser/lol/.claude/worktrees/agent-a59fde1ba94bbdcaf/apps/companion
  cargo run -p engine --example lcu-create-lobby -- --blind    # expect queueId 3100, SimulPickStrategy, PASS
  cargo run -p engine --example lcu-create-lobby -- --draft    # expect queueId 3110, TeamBuilderDraftPickStrategy
  ```
  It opens a real lobby (leave it by hand afterwards) and never touches champion select. Paste both outputs. On a
  pass, it merges: Start a lobby opens Blind Pick for mirror games, the host line goes away, and Spin can land on
  mirror.
- [ ] **Windows round-trip 1** (M17.12), after the deploy: install the CI build. Then check:
  - both sizes (installer 15 MB or less, installed exe 20 MB or less);
  - League found at its default path and at a non-default one;
  - pairing works, and a lobby shows on production `/g/customs`;
  - the tray icon at 100% and 125% scaling;
  - **Restart now** runs the installer and relaunches.
  - **M17.20**: install 1.0 over 0.3.x with Start with Windows on, then reboot. Only 1.0 should run, with no Old
    engine screen and one startup entry.
- [ ] **The Windows night (M17.13)**, the gate:
  - **Round-trip 2**: a real night on 1.0.x. Start a lobby, invite, roll, switch sides, the game is recorded,
    ratings move, backfill runs, nobody types anything.
  - **Round-trip 3**: publish 1.0.(x+1) and watch it update itself after the game.
- [ ] **Optional, on this Mac:** the Rust host has already connected to League here, posted a lobby and synced
  your rank. Not yet seen live: a finished game being recorded, a Start a lobby command, and a backfill pass.
  These need League open with a custom game.

### After two Premium weeks

- [ ] **M16.20, the real-group read.** After two real Premium weeks on `customs`, export every published AI line
  (game lines, storylines, scouting reports) and hand it to product. The bar: engaging 3.0+, no repetition, and
  zero lines a friend would want hidden. A feature that misses is cut, with a decision row. Scouting is the one at
  risk.

### Not open any more

- **0.2.1 vs 0.3.x**: no open question in the milestones. 0.3.x stays the download until the Windows night
  passes. The Rust app reads every 0.2.x and 0.3.x config shape. A real 0.3.x config from your Windows PC
  (redacted) would still be a welcome extra test fixture, but nothing waits on it.
- Kustom 0.4.0: skipped (your call, 2026-10-03).

---

## 5. Known limits and follow-ups

- **M16.21, scouting prompt nits.** Repeated sentence shapes, a group-best claim with nothing to back it, a
  partner's number that reads like their total. These need spend, so they wait for your go-ahead.
- **M17.14, retire the TypeScript companion**, and **M17.15, remove the overlay routes** (that one also needs 30
  days with no overlay requests in Vercel logs). Both come after the Windows night. **M17.16**, the Rust scene walk,
  comes after M17.13 too.
- **M17 live ticks.** M17.5, M17.7, M17.8 and M17.9 are built and merged but unticked until their live checks
  (section 4). M17.8 also needs the tray checked on Windows.
- **M14.26** ticks with your sign-off on this document. **M14.27** is the runbook you run.
- **The spectator host.** Does a host's Kustom still record the game from the spectator slot? Until a real game
  proves it, the host never sits out (`docs/03-lcu-reference.md`, question 12).
- **Riot Developer Portal.** Register Kustom as a League Client API product (runbook §7). Nothing waits on it.
- **The first real Premium game**: watch its Discord post get the AI line edited in.
- **Not walked live:** everything behind Discord sign-in on the real site (admin, You signed in, pressing Roll).
  It's covered by tests and the screenshot kit; runbook §3.6's smoke pass covers it on production.
- **Deliberately not in 2.0:** payments and pricing for Premium, best of three, pick for the enemy, more modes
  (the ideas list from the first draft is in git history), the companion overlay.

---

## 6. Calls made while you were away (still standing)

Say the word and any of these changes.

1. **The host never sits out**, until the spectator check above.
2. **A group's creator can connect Discord and rotate the invite before linking League.**
3. **The receipt is compact during the game**, so the teams stay on the first screen at 375.
4. **Settling is 10 rated games.** One constant.
5. **Arabic roasts in `customs` only.**
6. **Roll and Reroll live on Tonight only.**
7. **The Mode card shows for everyone, in every state**, Normal included.
8. **Week boards have no settling section and no minimum games.** One game puts you on the board; your settling
   chip explains big swings.
9. **"Most improved" is retired.** With the week ranked by points, it would always just be #1. Best off-role and
   Cursed duo stay.
10. **`customs` gets its owner from `BOOTSTRAP_ADMIN_PUUID`** on the first request after the deploy. Check it's
    yours (runbook risk R2).
11. **Not-rated mode games still count for the weekly awards** (best off-role, cursed duo), like before.
12. **Premium is invisible outside a Premium group**, and inside one only admins see the word "Premium". The
    landing page and `/about` don't mention AI yet.
13. **Kustom 1.0's window is Night only**, in 1.0's deep blue.
