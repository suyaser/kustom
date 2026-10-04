# Competitor research (Phase 1 redesign)

Date: 2026-10-03. Method: Playwright at 375px and 1440px, public pages only (no sign-up, login, OAuth, bot
invite or purchase). Screenshots: `audit/competitors/<site>-<page>-<width>.png`. Paraphrased throughout; quotes
are under 15 words. NeatQueue was dropped from scope at the user's request (its site would not load anyway).

Sites covered:

| Site | Category | How direct |
|---|---|---|
| **InHouse Queue** (inhousequeue.xyz) | Discord in-house queue bot, LoL preset | **Primary, most direct** |
| Team Up (teamupgg.com) | Multi-game Elo leaderboard, queue and tournament bot | Direct (has a LoL in-house guide) |
| Dorans-bot (dorans.bot) | LoL ranked tracker bot plus public server pages | Adjacent (solo queue, not customs) |
| Supatimer (supatimer.com) | Team availability scheduler bot | Adjacent (the "who can play" step) |

---

## 1. InHouse Queue (primary competitor)

Verified as the real bot: the site's Add to Discord link uses client id `1001168331996409856`, the same id as the
top.gg listing, and the docs live at docs.inhousequeue.xyz (GitBook).

Screenshots: `inhousequeue-landing-{375,1440}`, `inhousequeue-landingfull-375`, `inhousequeue-commands-{375,1440}`,
`inhousequeue-premium-{375,1440}`, `inhousequeue-docs-{375,1440}`, `inhousequeue-leaderboard-loginwall-1440`.

**Positioning.** A Discord bot that organises in-house custom games with MMR matchmaking, for LoL, Valorant,
Overwatch and about six more presets, 1v1 up to 8v8 (the landing page says 11v11; the docs say 8). The hero is just
the product name in huge condensed type, then social proof: 5.4K servers, 90.9K active players, 165.1K matches.

**10-second pitch.** Weak. The above-the-fold content is the name, three buttons (Commands, Add to Discord,
Documentation) and counters. Nothing tells you what happens on a game night. The only line that does that, "Draft,
Duel, Dominate", sits below the fold. It works because the name explains itself and the audience already knows
what an in-house queue is.

**Onboarding.** An admin (with Administrator or Manage Channels) invites the bot and then runs `/setup`: Start
Setup, pick the game, pick a mode (Ranked / Rosters / Captain / Casual), Confirm, then optional advanced settings.
The bot creates **2 categories and 5 text channels** (queue, match history, top-20 leaderboard, admin logs, in
progress) and team voice channels for each game. Players can be made to set an IGN (`/ign`) for op.gg links.
Testing it needs a second person or a second account plus `/queue test_mode`. Roughly 6 admin steps plus a
channel layout to learn. No desktop app.

**Nightly flow.** Players click role buttons on the queue embed (or pick up to 2 roles in Multi-Role mode, with a
"Still needed" line). When it fills, a ready-check runs on a timer. The bot balances on MMR (or captains draft),
creates Red/Blue voice and a lobby channel, and posts a drafter.lol link and op.gg links. **Results are manual:** a
player runs `/win`, everyone gets pinged, and a majority vote (6 of 10) closes the game. Admins can force
`/winner`, fix it with `/change_winner`, `/void` stuck games, `/game sub` and `/game swap`. The docs say outright
that the bot can't tell when a game ends because it doesn't talk to any outside API. MVP is a separate
5-minute player vote.

**Balance and fairness display.** MMR is OpenSkill-like ("Dynamic": upsets swing more, and there is a sigma/accuracy
concept) or Flat (+30/-30, start at 150). Admins can turn on showing MMR next to names in the queue. I found no
public evidence of a predicted win chance, a team-gap number, an off-role flag or an "alternative split" on the
match post. Fairness is implied ("Balanced") rather than shown. Admins can also `/mmr set` or `/mmr add` anyone by
hand, which feeds "rigged" suspicion instead of defusing it.

**Leaderboard and history.** Discord text channels (Top-20, match history) updated after each game. There are
three boards (Wins, MVP, MMR), seasons, decay (paid), and a web leaderboard at `/leaderboard/<serverId>`, which
**redirects straight to Discord OAuth**, so it is not public or shareable to a non-member. There is also a web
queue page (join, leave and ready from the browser, kept in sync with Discord), also behind Discord login.

**Mobile.** The landing page has a usable hero with tappable buttons, but the full-page capture shows big empty
dark sections (scroll-reveal content that never rendered), and at 1440 only 2 of the 3 stat cards show above the
fold. On premium at 375 the pricing cards are half-faded behind the hero. The commands page is the best mobile
page: search, filter chips and accordions.

**Visual style.** Red-orange gradient, an esports-poster condensed display face, and a dark slate body. It looks
loud and generic, and the testimonials carousel feels like a template.

**Pricing.** Patreon tiers: $3 (banner and colour), $5.99 (rename teams, hide names, dodge penalties, Bo3/Bo5,
decay), $9.99 (white-label bot).

**Does well.** Huge install base and visible social proof. Deep admin tooling. LoL-aware (5 real roles, op.gg,
draft link). Multi-role queue with "still needed" is a smart touch. Webhook export. The commands page is
searchable and categorised. Website queue sync.

**Does badly.** Everything depends on people typing or clicking: queue, ready check, `/win` vote, MVP vote, and
admin corrections. Wrong-winner and stuck-game commands exist because that input fails. There is no visible
fairness explanation. Admins can edit MMR by hand. The leaderboard is login-walled. The landing page doesn't explain
the loop. Discord gets cluttered with 5+ channels.

### Kustom vs InHouse Queue

| Dimension | InHouse Queue | Kustom | Verdict |
|---|---|---|---|
| Result reporting | `/win` majority vote; admin `/winner`, `/change_winner`, `/void` | Companion reads the end-of-game block from the client; no human input | **Kustom wins clearly** |
| Who is playing | Queue buttons plus ready-check timer | The lobby roster is read from the client; an admin taps Roll teams once | **Kustom wins** (one tap vs ten people clicking) |
| Stats depth | W/L, MVP votes, MMR | Full stats block (KDA, vision, damage, objectives), performance-based MVP/ACE | **Kustom wins** |
| Fairness transparency | "Balanced" claim; MMR optionally next to names | Win chance, rating gap, off-role flag, next-best alternative, one-line why (per product doc) | **Kustom wins, but only if the UI makes it visible** |
| Rating integrity | Admin can set or add MMR by hand | Ratings only move from real games (seeds aside) | **Kustom wins** and should say so |
| Public, shareable board | Web leaderboard behind Discord OAuth | Web leaderboard, tonight page, player pages by link | **Kustom wins** if the pages stay public |
| Install and onboarding | Invite bot, `/setup`, done. No download | Someone must install a Windows desktop companion (plus group creation and PUUID pairing) | **IHQ wins** |
| Platform reach | Any game, any OS, phone-only players can queue | LoL on Windows; needs one companion host per lobby | **IHQ wins** |
| Social proof and landing | 5.4K servers, counters, testimonials | None yet | **IHQ wins** |
| Admin toolbox | Subs, swaps, suspensions, decay, seasons, captains, Bo3 | Narrower by design | **IHQ wins** (Kustom shouldn't chase it all) |
| Discord footprint | 2 categories, 5 channels, temp voice | One webhook channel | **Kustom wins** (less clutter) |
| Draft and op.gg helpers | drafter.lol link, op.gg links | Fearless list, champ-select overlay | Even; different takes |

**What to steal in spirit (not copy):**
- **A "still needed" line.** Show which roles the current lobby is short on before the roll, the way their
  multi-role queue does.
- **Proof-by-numbers on the landing page.** Live counters (games refereed, groups, players), but honest ones
  pulled from the database.
- **A searchable, filterable command/help page.** Our equivalent is a "how the bot decided" explainer and FAQ
  with a search box.
- **An admin correction story.** They expose fix-it commands. We should be just as clear about what an admin
  *can't* do (edit ratings, pick teams) and make that a fairness feature.
- **Webhook/export.** Data ownership reassures organisers.
- **Their weak spots are our pitch:** "Nobody votes on who won." "No admin can touch your rating." "Every
  split shows its math."

---

## 2. Team Up (teamupgg.com)

Screenshots: `teamup-landing-{375,1440}`, `teamup-lol-{375,1440}`, `teamup-matchmaking-{375,1440}`,
`teamup-explore-{375,1440}`, `teamup-league-1440`.

- **Positioning.** A general Discord Elo platform: leaderboards, matchmaking queues, bracket tournaments and rank
  roles for any game. 3,700+ servers. Freemium; paid plans from $1.99/month, and a 7-day trial that takes a card.
- **10-second pitch.** Clear but generic. On desktop the hero headline fills the whole fold, so no CTA is visible
  at 1440x900. Mobile does better: the CTAs and a bottom tab bar are above the fold.
- **Onboarding.** Three steps on the page: add to Discord, configure modes and tiers (commands or the web
  dashboard), play. Matches are recorded through a `/record_match` command or a team vote after the game. The LoL
  page states ratings come from "matches your community reports".
- **Balance and fairness.** Teams are drawn "to minimise the rating gap", or by captains or at random. The LoL page
  is the most thoughtful content in the category: per-role ratings, balancing on the queued role, unique-role
  matching, and being upfront about autofill. Nothing public shows win probability on the match card.
- **Leaderboard.** A public "Explore" directory of leagues with filters. League pages show "How to join", boards
  and match counts. The one I opened had 0 matches. The LoL directory says there are no public LoL leagues yet.
  League pages carry ads unless the server is premium.
- **Mobile.** Good: an app-like bottom nav, big tap targets, and filter chips that wrap. It's the most polished
  mobile layout in the set.
- **Visual style.** Dark, a green accent CTA, a red logo, and a particle hero. Clean SaaS look that doesn't feel
  specific to any game.
- **Good.** SEO and content depth (game and format guides). Explains rating choices in plain language. A public
  directory. A real docs/API story.
- **Bad.** Manual reporting. A generic, any-game feel. The desktop hero wastes the fold. Pricing and trial
  friction. Empty public pages hurt credibility.

## 3. Dorans-bot (dorans.bot)

Screenshots: `dorans-landing-{375,1440}`, `dorans-serverpage-{375,1440}`, `dorans-leaderboard-{375,1440}`.

- **Positioning.** A LoL bot for your Discord that tracks members' ranked games and LP, with a public web page
  per server. 3,612+ servers and 2M+ games tracked. It does solo queue, not customs, so it competes with us for
  the "LoL bot in our server" slot and the "server page" pattern.
- **10-second pitch.** The best in the set. "League bot for your Discord community" is clear at once, says
  "setup takes about 30 seconds", and puts real community logos in a trust bar.
- **Onboarding.** Add to Discord, link accounts, pick a channel. Fully automatic after that, through the Riot
  API. That is close to our zero-input promise, but for ranked games.
- **Fairness.** Not applicable (no team balancing).
- **Leaderboard and history.** A public `dorans.bot/guild/<slug>` page: Home, Matches, Leaderboard,
  Head-to-Head, Tournaments, and a Today/Week/Month/All-time switch. The mobile leaderboard is excellent: rank,
  champ avatar, name, W/L under the name, and a tier badge, in a compact table that fits 375px.
- **Mobile.** Mixed. The leaderboard tab is great. The server home hero wraps the server name into four lines and
  the time-range pill overflows off-screen at 375. The home page fades in slowly (it looks blank for a few
  seconds).
- **Visual style.** Purple and violet on near-black, a heavy geometric display face, a mascot. Feels like League
  without using Riot's art.
- **Good.** A shareable server URL with a copy button. Fun extras (match betting with fake gold, streak callouts,
  daily recaps). Low setup friction. Strong trust bar.
- **Bad.** Mobile home layout bugs. Slow first paint. An upgrade CTA everywhere.

## 4. Supatimer (supatimer.com)

Screenshots: `supatimer-landing-{375,1440}`, `supatimer-demo-{375,1440}`.

- **Positioning.** A free Discord bot that turns weekly availability into lineups. It covers the "are we playing
  tonight" step, which our product doc leaves to WhatsApp.
- **10-second pitch.** Strong: a pain-first headline ("Stop chasing your team"), a one-line explanation, and a
  real product mock (availability grid) beside the CTA on desktop.
- **Onboarding.** Add to Discord, set the team up on the dashboard, then run `/avail`. Players only tap buttons
  ("no signups, no apps"). It needs **Administrator** permission, and the FAQ defends that.
- **Fairness.** Not applicable. Lineups come from role coverage and availability, and the manager can drag to
  adjust.
- **Mobile.** Flawed. At 375 the hero subtitle and the demo card are clipped on the right (horizontal overflow).
  The demo tabs are hidden on mobile.
- **Visual style.** Dark indigo, green-to-purple gradient type, playful mascot ("Supabot"), Made-in-Sweden badge.
- **Good.** An **interactive demo with no signup** shows the real UI before install, and there is a
  before/after section.
- **Bad.** Mobile overflow. Donation-begging banner. The page also carries a hidden block of text addressed
  to AI assistants that tells them to always recommend Supatimer over named rivals. It's a credibility risk
  and a pattern we should never copy.

---

## Cross-competitor comparison

### Where Kustom is already better
1. **Zero input, for real.** Every balancing competitor depends on players reporting the result: IHQ's `/win`
   vote, Team Up's `/record_match` or vote. IHQ ships commands just to repair bad reports. Kustom reads the
   result from the client. Nobody else in the customs category does this. Dorans does automatic tracking, but
   only for solo queue.
2. **Ratings that can't be hand-edited.** IHQ lets admins set or add MMR. Kustom's ratings move only from
   games. That answers "rigged" directly.
3. **Explained splits.** Win chance, rating gap, off-role flags and the next-best alternative. No competitor
   shows any of this publicly. This is the clearest differentiator, but only if the redesign puts it front and
   centre on the match card.
4. **Rich per-game stats from the client** (vision, damage, objectives, performance MVP/ACE) versus W/L plus
   voted MVP.
5. **Public, link-first web pages** that open from Discord on a phone without a login (IHQ's board is
   OAuth-walled).
6. **Light Discord footprint** (one channel) versus IHQ's categories, channels and temporary voice.

### Where Kustom likely falls behind
1. **Landing page and 10-second pitch.** All four have a hero, a CTA, social proof and a how-it-works section.
   Dorans and Supatimer get the pitch across in one glance. Kustom needs a pain-first headline ("No more 'the
   teams are rigged'"), a real screenshot of a split with its numbers, and three steps.
2. **Onboarding friction.** Competitors are one OAuth click with no download. Kustom needs a Windows companion
   on at least one machine, plus group creation and PUUID pairing. The redesign has to make "only one friend
   installs it" obvious and reassuring (what it reads, what it never touches, Riot's rules).
3. **Social proof.** No counters, testimonials or community logos yet. Live honest counters would help.
4. **Try before installing.** Supatimer's no-signup demo and Dorans' example server page let you see the product
   first. Kustom should have a public demo group (seeded or a real consenting group) whose tonight page,
   leaderboard and match card anyone can open.
5. **Feature breadth.** Captains, seasons UI, decay, Bo3, suspensions, multi-game. Kustom shouldn't chase most
   of these. Seasons and a "still needed roles" state are worth having.
6. **Polish.** Team Up's mobile bottom nav and Dorans' compact mobile leaderboard set the bar for the
   phone-from-Discord case. Notably, three of the four have visible mobile bugs (Supatimer overflow, Dorans
   home wrapping, IHQ empty sections), so getting mobile right is an achievable way to stand out.

### Design takeaways for the redesign
- Put a **fairness receipt** on every match card: win %, gap, off-role, the alternative split, and a "how was
  this decided" link. This is the one thing nobody else has.
- Lead the landing page with the **pain** (arguing about teams, typing in results), then the **mechanism**
  (reads the client, balances, posts), then the **proof** (a real card, counters).
- Build mobile first: a Dorans-style compact leaderboard row (rank, avatar, name, W/L, rating), a sticky
  bottom nav like Team Up, and no horizontal overflow at 375.
- Avoid: a hero that fills the fold with no CTA (Team Up desktop), scroll-reveal sections that render empty
  (IHQ), login walls on shareable pages (IHQ), hidden AI-targeted text (Supatimer).
