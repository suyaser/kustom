# Reasons to sign in and link: research for Kustom 2.0

Owner: `product`. Date: 2026-10-03. Research only. It changes no behaviour and adds no decision rows. Anything
below that gets built needs a milestone task, and the ones marked **schema** also need a decision row.

**Today.** Every page is public by link. Signing in with Discord and linking your PUUID (by `That's me`, a
Kustom pairing code, or an admin) gets you: `Start a lobby`, `Role for tonight`, the lobby name and password,
the "you" border on Tonight, the second-person sit-out line, the footer's `Your games`, and admin controls if
you're an admin (`apps/web/lib/viewer.ts`, M3.6, M4.10, M4.13). All of that is useful during a night. None of it
is a reason to come back the next day. Nothing here can hide public data, because groups are public by link, so
every incentive is a **lens**: the same data, read from where you're standing.

---

## 1. What works elsewhere, and why

| Pattern | Who does it | Why it works | What it means for Kustom |
|---|---|---|---|
| **Verify and decorate** | op.gg's Riot link gives you a verified badge, a tagline, a champion cover image, private match notes, and your account pinned at the top of search ([op.gg help](https://help.op.gg/hc/en-us/articles/30993148799897-Features-available-when-linking-a-Riot-Account)) | Linking is cheap, and it turns a stats page anyone can read into *your* page | Our player page already exists. Linking should change what it looks like for you, and maybe for everyone. |
| **Your personal read on the numbers** | Mobalytics' personal dashboard and GPI ([mobalytics](https://mobalytics.gg/)); Blitz's post-match feedback and your-champ comparisons ([Blitz](https://apps.apple.com/ca/app/blitz/id1591484739)); chess.com Insights, which shows your best time of day and common mistakes ([chess.com](https://support.chess.com/en/articles/8708925-what-is-insights-on-chess-com)) | "What does this mean for me" is worth more than raw tables | We hold the same raw stats. The missing piece is reading them from one person's point of view. |
| **The recap** | Spotify Wrapped ([uxdesign.cc](https://uxdesign.cc/why-is-spotify-wrapped-so-popular-5c503e79a3ee), [ADMA](https://adma.com.au/resources/personal-shareable-no-strings-attached-the-winning-formula-behind-spotify-wrapped)); Strava Year in Sport ([Strava](https://support.strava.com/hc/en-us/articles/22067973274509-Your-Year-in-Sport)) | It's about who you are, it can be shared one image at a time, and it asks nothing of you | We already have a week that resets on Sunday. A "your week" card is our Wrapped, and it comes 52 times a year. |
| **Recaps posted where the group already is** | Dorans-bot posts every game to Discord with fun facts and daily "who climbed, who fell" recaps, and has server pages for linked players ([top.gg](https://top.gg/bot/1156008927943737415)) | The group chat does the work of bringing people back | Our webhook already posts. A post can `@mention` linked players, and only the ones it lists ([allowed_mentions](https://wisechecker.com/?p=25084)), with no bot. |
| **Rewarding showing up, not only winning** | Strava Local Legends goes to whoever has the most efforts in 90 days, not the fastest ([Android Central](https://www.androidcentral.com/strava-announces-local-legends-new-way-compete-segments)); kudos ([Run Republic](https://runrepublic.com/blogs/the-church-of-kudos-how-strava-conquered-the-world)) | Everyone can win something, not just the top three | Bronze-to-Master friends need recognition that isn't Rating. |
| **Achievements** | chess.com badges for first win, 100 wins, and so on ([chess.com](https://www.chess.com/forum/view/general/how-to-get-all-achievements-on-chess-com?lc=1)) | Small, permanent, collectible | Work it out from games and never store progress, the same rule as the setup checklist. |
| **Streaks, with some slack** | Duolingo streaks and Freezes. The Penn/UCLA "slack" finding: being allowed to miss a day raised daily active learners ([Duolingo blog](https://blog.duolingo.com/how-duolingo-streak-builds-habit)) | People hate losing a streak | **Use carefully.** A streak tied to playing is a nightly chore. Only streaks on things you can do in 10 seconds (the daily guess), and with slack. |
| **In-house leaderboards** | InHouse Queue has per-server boards for wins, MVP and MMR ([GitHub](https://github.com/DorianAarno/InHouseQueue)); Team Up is LFG by slash command ([top.gg](https://top.gg/bot/700132773553504287)) | Both make you type commands. That's exactly what Kustom avoids. | Our edge: nothing to type, ever. |

**Dark patterns to avoid** ([Brignull's catalogue via UW](https://courses.cs.washington.edu/courses/cse340/22sp/slides/wk09/Dark-Patterns-Deceptive-Design.pdf), [trymata](https://trymata.com/blog/deceptive-patterns/)):
- **Nagging.** No sign-in modal and no repeated banner.
- **Confirmshaming.** No "No thanks, I don't care about my stats".
- **Hiding public data behind a login wall.** That's against the product, and pointless anyway.
- **Pings nobody asked for.**
- **Streaks that punish a night off.**
- **Fake scarcity** ("claim before it's gone").

---

## 2. Incentives for Kustom

V = value (1 to 5). E = effort (S, M or L). Every "you" below means the signed-in, linked viewer's PUUID.

| # | Incentive | What only you get | Example copy | Where | Data | V | E | New data or schema |
|---|---|---|---|---|---|---|---|---|
| 1 | **Claim your games** | The moment you link, you see your whole history in one card instead of a "linked" toast | `That's you. 83 games, 47 wins, Rating 1512. All yours now.` | Lands on your player page with `?welcome=1`, after any linking method | games, rating | 5 | S | none |
| 2 | **You vs them** | On anyone's player page: your games together and against them, and your 1v1 lane record against them | `You and Ana: 9-3 on the same team. 2-6 against. She owns you top.` | `/p/<puuid>`, a card above the stats, for linked viewers only | partners, rivals, 1v1 | 5 | S | none |
| 3 | **Your night** | After the night's last game: your wins and losses, how far your rating moved, your best game, any MVP or ACE | `Tonight: 3-1, +38. Your Kai'Sa game was the cleanest thing anyone did all night.` | Top of Tonight in `finished` / idle, until 06:00 | game_players, rating history, awards | 5 | M | none |
| 4 | **Your week** | Sunday 06:00, when the weekly board resets: your week as a short card you can share | `Your week: 11 games, 7 wins, best duo Sam (5-0), most played Jinx. Week rank #3.` | More → You, plus an OG image at `/og/g/<slug>/p/<puuid>/week` | weekly rating, game_players | 4 | M | none (new OG route) |
| 5 | **Your row on the board** | Your row stays pinned while you scroll, with the gap to the next person up | `You're #6. 14 behind Mo.` / `settling · 6/10` | Board | ratings | 4 | S | none |
| 6 | **Your receipt record** | How often the bot favoured your side, and the upsets you pulled off. This is aimed straight at "the bot hates me". | `The bot has had you as the underdog 21 times. You won 9 of them.` | Your player page | splits, results (M8 upsets) | 4 | S | none |
| 7 | **Your fearless pool** | During a fearless run: your most-played champions that aren't banned yet. It's display only, so it never touches champ select. | `Still open for you: Viego, Lee Sin, Graves. Hecarim's gone.` | Fearless card on Tonight, linked viewers only | fearless list, game_players | 4 | S | none |
| 8 | **Ping me** (opt-in) | The Discord post `@mentions` you when teams with you on them are posted, or when a lobby starts. Webhook mentions, no bot. | Toggle: `Ping me in Discord when I'm on a team`. Post: `@Yasser you're blue, mid.` | Setting in More → You. Mention goes in the group's existing post. | `players.discord_id` | 4 | M | **schema**: opt-in flag per player and group |
| 9 | **Your rival and your duo** | Nemesis and best duo, shown only to you and only as a playful line. The public 1v1 page doesn't change. | `Your nemesis is Kim (1-7). Your ride or die is Sam (12-3).` | Your player page, More → You | partners, rivals | 4 | S | none |
| 10 | **Career highs and milestones** | Your personal bests and round-number milestones, worked out from your games and never stored | `New personal best: 41k damage. Previous: 36k on Sep 14.` / `100 customs. Respect.` | Your player page, plus a line in Your night | game_players | 4 | M | none |
| 11 | **Your roles** | What the bot thinks your main and backup are, how often you've been filled, and how far you are from a change | `Main: jungle. Backup: top. Filled 4 of your last 20. Two more support games and support becomes your backup.` | Your player page | role model (M5.16/17) | 3 | S | none |
| 12 | **Daily guess streak** | Your daily guess streak follows you to any device, and you see "you were the answer today". One missed day doesn't break it. | `Guess streak: 12 days.` / `Today's mystery was you. Nobody got it.` | `/mystery` | guesses | 3 | M | **schema**: guesses keyed to player (today they're accountless) |
| 13 | **Flair** | Pick a favourite-champion banner for your page, and a title from the ones you've earned. There's no free text, so there's nothing to moderate. | `The Wall (most damage mitigated, week 38)` | Your player page header, small on your board row | awards, champ ids, Data Dragon | 3 | M | **schema**: prefs (banner champ, title) |
| 14 | **Call it** (fake points) | Before a game starts, people who are sitting out or watching pick a side. Points go on a weekly table. | `Calling it: red. +10 if you're right.` | Tonight, `balanced` state, for people not on a team | splits, results | 2 | L | **schema**: predictions. Needs a decision row: it adds a tap during a night, but nobody has to make it. |
| 15 | **What linking unlocks, said out loud** | The night-time unlocks we already have, written down where people sign in | `Sign in to start lobbies, see the password, and pick your role for tonight.` | Sign-in prompt on Tonight, `/join` | none | 4 | S | none (copy) |
| 16 | **Leave or unlink** | You can see and remove your own Discord link and your ping settings | `Linked as Yasser#1234 to this League account. Unlink.` | More → You | `players.discord_id` | 3 | S | none |

---

## 3. The "aha" moment

**The single best reason to sign in is #2 together with #1: you see your own history and how you stack up
against each of your friends.** `You and Ana: 9-3 together, 2-6 against` is something no public page shows, it
only makes sense when it's you, and it's what friends argue about in voice anyway. Linking reveals something
real: your 83 games are already there and waiting.

**Where to offer it.** Curiosity peaks right after your rating moves:

1. **Tonight, in the `finished` state**, one line under the result. No modal, and it shows once per night:
   `Played tonight? Sign in and see how you did against everyone.`
2. **The game page**, beside the scoreboard. Same line, same rule.
3. **The Discord result post's link** lands on Tonight, so it reaches (1) with no extra work.
4. **`/join/<code>`**, as the reason inside the existing `Which League account is yours?` step (section 5).

Don't offer it on the board or in the middle of a lobby. Nobody wants a pitch while they're waiting for teams.

**One catch.** `That's me` only offers tonight's lobby members (`claimablePuuids`). That's deliberate, so a
stranger can't claim somebody else. Someone who taps the line on a game page the next morning can't claim
themselves there. Before (2) gets built, product and platform should decide whether "players of a game that
ended in the last 12 hours" are claimable too (question 1 in section 6).

---

## 4. Opt-outs and privacy

- **All pings are off until you turn them on**, per group. Unticking stops them on the next post. Kustom has
  no Discord bot, so there are no DMs. Pings are channel mentions, and the webhook's `allowed_mentions.users`
  lists only people who opted in, so a wrong id can never ping anyone else.
- **Bad news is only shown to you.** Your nemesis, your worst matchups and losing runs appear only in your own
  lens. No new public "worst of" surface gets added. Existing fun records stay as they are.
- **Discord stays a display.** Showing your Discord name on your own You page is fine. Your PUUID is still who
  you are. Unlinking removes `discord_id` and leaves your games and rating alone.
- **Signing in is never required to read anything.** The prompt is one line, it doesn't come back after you
  dismiss it, and declining it has no guilt-trip button.
- **No streak tied to playing.** Missing a night costs nothing.

---

## 5. The first three, and how they fit onboarding

1. **#1 Claim your games** (S). Every linking path ends here: the `/join/<code>` Kustom-code card (§3.4),
   `That's me` on Tonight, an admin's Host-mode pairing (§3.2 step 4), and an admin override (on that
   person's next visit). All of them go to `/g/<slug>/p/<you>?welcome=1` instead of a bare `You're in.` The
   `/join` "Signed in, not linked" heading gets the reason added: `Which League account is yours? Once we know,
   you'll see every game you've played with this group.`
2. **#2 You vs them** (S). Once you're linked, every name you tap becomes personal. This is the "aha" from
   section 3, and it's what pays off the claim from #1.
3. **#3 Your night** (M). This gives you a reason to open Tonight after the last game, not just before the
   first one, and it's where the section 3 sign-in line sits for people who haven't linked. It needs no new
   data.

All three use data we already have, need no schema, and add no step to the night. #8 (Ping me) is the best
next one, but it needs a schema change and a decision row.

---

## 6. Open questions for the lead

1. Should `That's me` also offer players of a game that ended in the last 12 hours, not only tonight's lobby?
   (This needs a platform decision on the security side.)
2. Should #13's title also show to everyone on the board, or only on the player page?
