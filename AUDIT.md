# Kustom 2.0 — Phase 1 audit

Date: 2026-10-03. Audit only; no app code changed.

**How it was done**
- Code read by `reviewer`-style and `platform-engineer` agents.
- Screens captured with Playwright MCP at 375 / 768 / 1440:
  - 171 shots in `audit/screens/`.
  - `-real` = production data, shot read-only.
  - `-synthetic` = seeded local states.
- `web-design-guidelines` (Vercel) run over the UI code; `ui-ux-pro-max` UX rules run over the screens.
- Competitors visited with Playwright: 29 shots in `audit/competitors/`.
- Full notes:
  - [`audit/notes/screens.md`](audit/notes/screens.md)
  - [`audit/notes/frontend.md`](audit/notes/frontend.md)
  - [`audit/notes/competitors.md`](audit/notes/competitors.md)
  - [`audit/notes/engineering.md`](audit/notes/engineering.md)

Mobile (375) is treated as the primary view throughout.

---

## Scores

| Area | Score | Why |
|---|---|---|
| Visual design | **6** | "Floodlit" is distinctive and on-theme: ink background, matched blue/red, one amber light. It is let down by names cut off in team cards, a clipped wordmark, and two to four thousand pixel pages. |
| Clarity | **4** | Two competing ratings ("Proven" vs "Rating"). Real 83-game players and brand-new ones show **Proven 0**. Fairness is described four different ways on one screen. Developer copy leaks into admin. |
| Fairness transparency | **5** | Best in category on *data*: every split stores win %, gap, off-role count and a one-line reason, and no competitor shows any of it. Worst on *presentation*: prose only, jargon ("Gap 45"), no visual. "Teams are N% even" disappears once the game starts. The three alternative splits are admin-only. |
| Mobile experience | **5** | No horizontal scroll anywhere. But essential text is cut off, and the nav hides pages behind an invisible sideways scroll ("D" for Daily). The idle tonight page leads with ten empty rows. Inline links are 18–21 px tall. |
| Real-time feel | **5** | Realtime plus re-read works and the state headlines are good. The in-game state is static: no timer, no champions. The "live" pill stays lit even if the channel never connected. |
| Accessibility | **6** | Good base: contrast measured, 44 px button floor, screen-reader words on numbers, reduced motion, zoom allowed. Gaps: no `<h1>` on the two most-shared pages, no skip link, "you" marked by colour only (and identical to "just joined"), a link nested inside a toggle, no focus ring on selects/inputs, one Day-theme contrast failure (4.38:1). |
| Performance | **3** | `/fun` all-time is **58 MB of HTML** (dev). `/games` all-time is 4.5 MB and 25,600 px tall with no pagination. Every page is `force-dynamic`, waits for all queries before the first byte, and has no streaming or loading UI. The tonight page hydrates whole, including the Supabase realtime client. |
| Onboarding | **2** | No landing page: `/` redirects into the `customs` group. Nothing explains Kustom in 10 seconds. There are no create/join pages yet (`/new`, `/join` are scoped but unbuilt). The companion install is the biggest gap against every competitor. |

---

## Top 10 problems, ranked by impact

**1. Fairness is shown but not *legible*.**
- Screenshot: `tonight-balanced-synthetic-375`, `game-finished-redwin-real-375`.
- What's wrong:
  - In one view: "Red favored 51%", "Gap 45" (of what?), "Teams are 98% even", and unlabeled sums 7350 / 7395.
  - The win % uses mu *and* sigma, but only mu-ratings are shown, so the numbers can look contradictory.
  - "N% even" vanishes in-game, which is when Discord links get opened.
  - The three candidate splits, the strongest anti-"rigged" evidence, are admin-only.
  - No calibration ("favoured side won 58% of 40 games") anywhere, though the data supports it.
- Fix: one reusable **fairness receipt** that appears on live teams, history, the game page and Discord:
  - a labelled 51/49 bar
  - one plain sentence
  - "how this was decided" behind a disclosure, showing all three splits
  - a group calibration stat

  Build it from the stored numeric columns, never by parsing the sentence. (Phase 2 item 2.)

**2. No front door.**
- Screenshot: `home-root-*`, `tonight-idle-real-375`.
- What's wrong:
  - `/` drops strangers into one group's tonight page.
  - There's no pitch, no "create your group", no proof.
  - `/new` and `/join/<code>` don't exist.
- Fix: a public landing page:
  - Pain first: "nobody votes on who won, nobody can touch your rating".
  - Then the mechanism.
  - Then a real fairness receipt.
  - Then three setup steps.
  - Then a public demo group (competitors' try-before-install pattern).

**3. Two headline ratings, and "Proven 0".**
- Screenshot: `leaderboard-alltime-long-real-375`, `player-fewgames-real-375`, `player-newnorating-synthetic-375`.
- What's wrong:
  - The board ranks on Proven (ordinal), the player card shows Rating small and Proven huge.
  - Nearly half the real board reads **0**, including players with 37–83 games.
  - This-week says "Rating", all-time says "Proven".
- Fix: one public number. Show uncertainty as a "settling · 8/30 games" chip, never as 0. Rank-by-ordinal can stay under the hood.

**4. Player names cut off in team cards.**
- Screenshot: `tonight-balanced-synthetic-375`, `game-finished-redwin-real-1440`, `games-expanded-real-375`.
- What's wrong: "Jinxed L…", "Thresh …", "Baron Nashor L…" at 375 and still at 1440. The page's first question is "am I in, which side?"
- Fix: role as icon-only on phones, names wrap to two lines, rating under the name; never cut off the viewer's own row.

**5. Payload and speed.**
- Screenshot: `fun-alltime-real-*`, `games-alltime-real-375` (25k px).
- What's wrong: see the Performance score.
- Fix:
  - paginate or cap `/games` and `/fun`
  - stream with Suspense and route `loading.tsx` (a static shell, not skeletons, per the design rules)
  - shrink the hydrated tonight tree

**6. No error, 404 or loading states.**
- Screenshot: `error-404-*`, `error-unknownslug-*`, `game-badid-*`, `player-unknownpuuid-*`.
- What's wrong:
  - Next's default black page: no brand, no nav, no way back.
  - Three of them throw a React console error.
  - `?window=foo` is a 404 rather than falling back to a default window.
- Fix: branded `not-found.tsx`, `error.tsx` and `global-error.tsx` with "Back to tonight" and a reason.

**7. The phone nav hides pages; the wordmark is clipped.**
- Screenshot: every `*-375` header.
- What's wrong: 488 px of tabs in 343 px, scrollbar hidden. Companion and Admin are off-screen.
- Fix: a bottom tab bar (Tonight · Board · Games · More) and fixed header padding.

**8. The first visit wastes the screen.**
- Screenshot: `tonight-idle-real-375` (3,665 px), `tonight-emptygroup-375`.
- What's wrong: "Nobody in yet", then ten empty "open" rows (~450 px), then the full 99-champion fearless pool. What Kustom is sits below the fold.
- Fix:
  - collapse the empty rack to one line
  - lead with last night's result and the group's standings
  - fearless pool behind a tap

**9. History is disconnected and confusing.**
- Screenshot: `games-expanded-real-375`, `game-finished-bluewin-real-*`, `1v1-pair-real-375`.
- What's wrong:
  - Game list cards don't link to the game page.
  - The list has the scoreboard but no fairness; the game page has fairness but no scoreboard.
  - Durations print like clock times ("21:46" reads as 9:46 pm).
  - Some game pages show no split at all (backfilled or unrolled games).
- Fix:
  - one game page with scoreboard + fairness receipt
  - the list links to it
  - "21 min" durations
  - pre-game win % for split-less games from `mu_before/sigma_before`

**10. The live game feels dead.**
- Screenshot: `tonight-ingame-synthetic-375`.
- What's wrong:
  - Same cards as balanced, plus "Ratings move when it ends."
  - No elapsed timer, no champions, no fairness receipt.
  - "Sign in to pick your role" is still shown mid-game.
- Fix:
  - an elapsed timer from `started_at`
  - champions once known
  - keep the receipt visible
  - hide irrelevant controls
  - make the live pill honest about connection state

**Also found (lower):**
- Stats → Duos shows the same pair as best *and* worst (bug, `stats-thismonth-real-375`).
- Admin:
  - three destructive actions with no confirm (revoke token, remove admin, fearless reset)
  - tables clip at 375
  - "No lobby opened" beside "6 of 10 in"
  - developer copy (`revoked_at`, `pnpm …`, snowflakes)
  - stale voice-split copy
- Leaderboard expanded rows inline every game ever (13k px).
- `/1v1` selects at 14 px trigger iOS zoom.
- Fearless icons hot-link communitydragon `latest` with no preconnect.
- `docs/05-design.md` colours no longer match `tokens.css`, so the doc's contrast table is stale.

---

## What works — keep it

- **The zero-input core**, and the result poster's "Red was 46%. Red won." This is the clearest fairness moment in the app; build on it.
- **Tonight as a state machine** with one honest headline per state ("6 IN THE LOBBY · Four more to go", "TEAMS ARE SET", "GAME OVER").
- **Kind, specific copy**:
  - the sitting-out card ("first in line for the next one")
  - "Waiting on Gankplank to roll"
  - "Nobody picked the teams"
- **The explanation string from core is shared verbatim** by web, Discord and share cards, so the surfaces can never disagree. Put the visual layer *beside* it.
- **Floodlit's principles**:
  - colour means a team, a state, or nothing
  - equal-luminance sides, so neither looks favoured
  - tabular mono numbers
  - deltas not coloured by sign

  These are fairness design in themselves. The surface can change; keep the rules.
- **Window chips** (This week … All time) are consistent across every page; state lives in the URL, so it's deep-linkable.
- **No-JS-first forms** with the `aria-disabled` pending pattern.
- **Public, login-free pages**: our edge over InHouse Queue's OAuth-walled board.
- **Character features**: Daily Mystery (thumb-friendly, great share hook), 1v1 "26–24", fun Museums, MVP/ACE, signed rating deltas.
- **The loaders, the copy modules and the share-card pipeline**: restyle views, don't rewrite these.

---

## Competitor comparison

Primary competitor: **InHouse Queue** (5.4K servers). Also reviewed: Team Up, Dorans-bot, Supatimer.

**Where Kustom is already better**

| | Kustom | Competitors |
|---|---|---|
| Result reporting | Read from the client, zero input | IHQ: `/win` vote, 6 of 10 must agree, plus admin `/change_winner` and `/void` to repair bad reports. Team Up: `/record_match` or a vote. |
| Rating integrity | Moves only from real games | IHQ admins can `/mmr set` anyone. That feeds "rigged". |
| Fairness numbers | Win %, gap, off-role, alternative, a reason per split | None found publicly on any competitor |
| Stats depth | KDA, vision, damage, objectives, performance MVP/ACE | W/L plus voted MVP |
| Shareable pages | Public, open from Discord on a phone | IHQ leaderboard behind Discord OAuth |
| Discord footprint | One webhook channel | IHQ: 2 categories, 5 channels, temporary voice |

**Where Kustom falls behind**

| | Gap | Who does it well |
|---|---|---|
| 10-second pitch / landing | None exists | Dorans ("setup takes 30 seconds", trust bar), Supatimer (pain-first headline + product mock) |
| Onboarding friction | Windows companion + group + pairing | Everyone else: one bot-invite click, no download |
| Try before install | Nothing public to try | Supatimer no-signup demo, Dorans example server page |
| Social proof | None | IHQ live counters, Dorans community logos |
| Mobile polish | Truncation, hidden nav | Team Up bottom tab bar, Dorans compact leaderboard row. Three of four competitors also have mobile bugs, so this is winnable. |
| Feature breadth | Narrow by design | IHQ: captains, seasons, decay, subs/swaps. Only seasons and a "still needed roles" line are worth taking. |

**Positioning lines the research hands us:**
- "Nobody votes on who won."
- "No admin can touch your rating."
- "Every split shows its math."

**Avoid:**
- Supatimer hides text on its page telling AI assistants to recommend it over rivals; never do this.
- Login walls on shareable pages.
- Scroll-reveal sections that render empty.

---

## Technical notes (engineer)

**Already built for job #4 (from M13)**

| Piece | Status |
|---|---|
| Groups, memberships (`member`/`admin`), per-group ratings | Built |
| Promote/demote admin with last-admin guard, per-group Discord config | Built |
| Create group, invite link + rotate, join, PUUID pairing | Built, **not deployed** (`0021` and code unpushed) |
| `/new`, `/join`, `/g/<slug>/admin`, super-admin, Kustom pairing | Scoped (M13.6, M13.8, M13.13, M13.14), not built |
| Leaderboard / games / stats / player under `/g/<slug>` | Scoped (M13.10–12), not built. These pages still read the original group or every group. |

**Blockers and conflicts with the 2.0 brief**

1. **"Enforce permissions with RLS" conflicts with the current model.**
   - Today:
     - every write goes through service-role route handlers after tested app-level checks
     - privileged ops are locked `security definer` functions
     - RLS is only a read firewall for the anon key
     - no policy uses `auth.uid()`
     - all DML is revoked from anon and authenticated
   - Full RLS enforcement needs:
     - an `auth.uid()` → player link
     - DML re-granted to `authenticated`
     - admin routes rewritten
   - **Recommendation:** keep routes + definer functions as the enforcement point; add RLS **read** policies as defence in depth (own memberships, admin-only invites). → *Decision needed.*
2. **Data privacy across groups.**
   - Every group's lobbies, games, ratings, splits *and `lobbies.lobby_password`* are anon-readable.
   - `groups_public` lists every group.
   - Fine for public scoreboards; a real gap if any group should be private. → *Decision needed: are groups public?*
3. **`owner` role is not scoped.**
   - One migration: widen the role check, an owner-safe role function, transfer ownership.
   - Creation and pairing must create `owner`.
   - Four exact `=== 'admin'` checks must become "admin or above", or owners get locked out:
     - `adminAuth.ts:117`
     - `viewer.ts:131`
     - `admin/players.ts:282`
     - `membership.ts:78`
4. **Rating reset / seasons per group contradicts a standing decision** ("ratings never reset"; `seasons` is global).
   - Cheapest path: a per-group `ratings_since` epoch that the fold and `rebuild-ratings --group` respect.
   - → *Product sign-off needed.*
5. **Member removal** was explicitly reserved out of M13 v1.
   - Needs a `remove_group_member` definer function.
   - Ingest is already safe: tokens of non-members are refused.
6. **Fairness in history is mostly possible today.**
   - Splits store win %, gap, off-role and a reason.
   - Backfilled or unrolled games have no split. A pre-game win % can come from `game_players.mu_before/sigma_before` via a new pure helper in `packages/core`.
   - Splits don't store the ratings used at roll time, so the gap can't be re-derived exactly.
7. **shadcn/ui needs Tailwind v4, which the app doesn't have.**
   - Today: ~5.2k lines of hand-written CSS in 11 files.
   - Tokens map nearly 1:1 onto shadcn variables.
   - Real costs:
     - 414 CSS-class assertions in 21 test files must move to role/text queries *before* any restyle
     - shadcn defaults (toasts, skeletons, shadows) are banned by `05-design.md`, so either that doc changes or the theme is stripped
     - Radix components add client JS to pages that are server-only today
8. **Half-migrated routing.** Fold M13.10–M13.14 into the 2.0 build instead of restyling pages that are about to move.
9. **Environment hazard.**
   - `apps/web/.env.local` points the local dev server at **production**, with the service-role key.
   - Any script run from the main checkout (`mint-token`, `rebuild-ratings`) or any admin click on :3000 writes to prod.
   - Phase 3's "never touch production" rule needs a local `.env.local` (or a `.env.development.local` override) first.
10. **Stale docs.** CLAUDE.md lists `apps/discord`, which doesn't exist (the voice split was dropped); `discord_config` voice columns are dead.

---

## Decisions to make before Phase 2 / 3

1. **shadcn + Tailwind v4: adopt** (and rewrite the design rules), or **keep Floodlit CSS** and borrow only patterns?
2. **Security model:** keep server-route enforcement + RLS read policies (recommended), or move to full RLS?
3. **Public vs private groups.**
4. **Owner role, member removal, per-group rating reset:** in 2.0 scope or not? Each reverses or extends a recorded decision.
5. **Merge M13.10–M13.14 into the 2.0 build** (recommended), and deploy `0021` + M13.5 first or hold until 2.0?
6. **Point local dev at local Supabase** before Phase 3 starts.

## Housekeeping
- The local Supabase holds audit seed rows; the delete SQL is in `audit/notes/screens.md`, or run `pnpm db:reset`.
- `.playwright-mcp/` (Playwright's working folder) and `audit/` are untracked and not committed.
