# Admin audit for Kustom 2.0 (product, 2026-10-04)

The user asked: "did we include the admin pages and admin flows in the 2.0 revamp for its ux and ui and its
obsolete features?"

**Short answer.** Yes, for look and layout. Every admin page is a 2.0 page (M14.21 to M14.23, M14.40, M14.43).
They use Direction C tokens, the shared `StackedTable`, AlertDialog confirms with focus on Cancel, refusals shown
where you tapped, and no seasons, month windows or fearless controls. The **host setup flow** is the problem. It
describes the Rust app (M17), but 2.0 ships with 0.3.x as the download, and 0.3.x cannot become a host from a
code. So a brand-new group following its own admin home gets stuck at the one step it cannot skip. Once the
Rust build ships, the reverse happens: the hand-made host key (`Add a host by hand`) is something nobody can
paste. Both halves need a planned switch-over that the milestones don't have yet. M16's admin surfaces (the
Premium section, `Don't write about <Name>`) have no task that builds their UI.

Built on `redesign-2.0` at `947083c` (local DB at `0032`), dev server on :3129, Night theme (the default, "1.0
night"). Screenshots are in `redesign/screens/admin-audit/`, at 375 and 1440 each.

---

## 1. Inventory

### Pages

| Surface | What it does today | Who |
|---|---|---|
| `/g/<slug>/admin` (home) | `Get your group ready` checklist, worked out from data (Create, Discord, Install Kustom, Invite, First game; M14.43 order). It folds to `Your group is ready for game night.` Also: `Invite your group` (Copy link, New link behind a confirm), a `Tonight` card (one link: `Open Tonight`), `Members` (count + `See everyone`), `Set up this PC as host` (download, "open Kustom ... and pick Host", `Get a code`), and `Reset ratings` (owner live with a typed slug; an admin sees it disabled). | owner, admin; the unlinked creator (checklist, invite, host card only); the operator (read-only, invite hidden) |
| `/g/<slug>/admin/members` | Stacked list: name, role in words, last played, games. `Make admin`, `Make member`, `Make owner`, `Remove from group`, each behind a confirm. The owner row explains why it has no Remove. | owner, admin; operator read-only |
| `/g/<slug>/admin/discord` | `Connect Discord` (OAuth), `Or paste a webhook link instead`, `Send a test post`. States: not connected, connected, test failed, cancelled. | owner, admin, unlinked creator; operator read-only |
| `/g/<slug>/admin/hosts` | Host list (name, account, added, last seen, Working/Stopped) with `Stop this host` behind a confirm. Also `Add a host by hand`: pick an account, name the PC, `Make a host key`, then `Copy this key now` ("They paste it into Kustom when it asks"). | owner, admin; operator read-only, no mint |
| `/g/<slug>/admin/games` | `Missed` (lobbies that went in game with no result) and `Captured` (last 200 games: started, length, how it came in, players, `Rated` Yes / `Not yet`). Read-only. | owner, admin; operator |
| `/admin/login` | `Kustom admin`, `Sign in with Discord`. Signed in: goes to the oldest group you run, or says `This Discord account doesn't run a group here.` | anyone |
| `/ops` | `All groups` table (started, people, admins, last game, Discord, Premium read-only with cap) and `Open admin` per group. 404 for everyone else. | operator only |
| You (`/g/<slug>/you`) | `Admin` card first: `You run <Group>.` / `You help run <Group>.` and `Open admin`. | owner, admin (needs a membership) |
| Top bar (desktop) | `Admin` link. | owner, admin (needs a membership) |
| Tonight | Roll teams, Reroll (M3.2) and the Mode card's admin foot (`Admins and the owner`, the Mode select, `Reset fearless` behind a confirm). M15.5 adds rule, Spin and Rated here. | owner, admin |
| `/g/<slug>/mode/reset` | The no-JS confirm for Reset fearless. | owner, admin |

### Admin API routes (`apps/web/app/api/admin/`)

| Route | Used by | Notes |
|---|---|---|
| `group` (GET) | operator/admin header read (M14.19) | invite masked for the operator |
| `members/role`, `members/remove`, `owner/transfer` | Members page | owner rules checked again in `security definer` |
| `invite/rotate` | Invite card | setup gate lets the unlinked creator use it (M14.40) |
| `discord`, `discord/connect`, `discord/callback`, `discord/test`, `discord-config` | Discord page | OAuth state single-use; paste fallback |
| `tokens` (mint / revoke, JSON only) | Hosts page | mint is the hand key, see finding M17.12 amend |
| `ratings/reset` | Reset ratings card | owner only, busy guard |
| `lobbies/[id]/roll`, `lobbies/[id]/reroll` | Tonight | |
| `mode`, `mode/spin` | Tonight's Mode card (M14.29, M15.3) | |
| `fearless/reset` | Tonight's Mode card and `/mode/reset` | lives under `/api/admin` but is only used from Tonight. Correct per 00-product ("never in admin" means the pages) |
| `players` (set-name, set-discord, set-admin; set-roles and set-backfill answer 410) | **nothing in the 2.0 UI** | finding M14.56 |
| `ops/groups` (GET) | `/ops` | |
| `/api/me/pairing` (not under admin) | the host card's `Get a code` | creator, owner, admin |

---

## 2. Walk at 375 and 1440 (Night)

Judged the way earlier phases were: can a friend who is an admin do the job in a few taps, with no dead ends,
clear copy, and the 2.0 look?

- **Look:** passes on every page. One h1 per page, no horizontal scroll at 375 on any state, 44px targets on
  every control except inline text links (Games page date links, `Go to Kustom` on `/admin/login`, the inline
  `Set up this PC as host` on Hosts). Role words, never colour alone. The admin pages are a `kustom2` root
  inside the group shell and match Tonight and Board.
- **Admin home, fresh group** (`kit-admin-fresh`): the checklist reads well and every unfinished row has its
  one action. The host card's step 2 says `pick Host` (obsolete under M17, and wrong for 0.3.x's code, see M14.49).
- **Admin home, ready group** (`kit-admin-ready`): after the fold, the page is the invite card, a `Tonight`
  card whose only content is a link, a Members card, the full three-step host card with a `Get a code` button,
  and Reset. The host card stays at full size forever (it only drops to a secondary button). The Tonight card
  is dead weight. Polish (M14.55).
- **Members at 375** (`kit-members-375`): 40 members make a **9,357 px** page. Every member is a full card with
  two or three buttons, and there's no search or way to jump. Making one friend an admin means scrolling up to
  nine screens. Should-fix (M14.52).
- **Discord** (`kit-discord*`): good. One primary button, the fallback folded away, the failure reason shown
  in place.
- **Hosts** (`kit-hosts*`): a paired host is labelled `This PC` on every device, including the phone of the
  admin reading the list, so it never names the PC. Stopped hosts stay in the list forever. The intro sends you
  to the admin home for "the easy way" and keeps this page "for someone else's PC". Under M17 there will be no
  someone-else's-PC path (M17.12 amend).
- **Games** (`kit-games-1440`, real local data): the two newest games read `Rated: Not yet`. `Not yet` is also
  what every ARAM game, every gated game and every M15 not-rated game will say forever. The intro says games
  count "once they're recalculated", which is a CLI step no admin can take. Also, the admin page is called
  `Games` right next to the main `Games` tab (M14.53).
- **`/admin/login`** (`real-admin-login`): clean. The denied state has no way through for an unlinked creator
  (M14.51).
- **You admin card** (`kit-you-admin`) and **Tonight admin foot** (`kit-tonight-filling-admin`,
  `kit-mode-admin`): fine. The Mode card's admin foot is where M15.5 adds rules. No admin control leaked into
  the admin pages.

### What I could not see

- **Any real signed-in admin page.** Discord sign-in doesn't work locally and I faked no session. Every
  signed-in state comes from `/kit/onboarding` (the same components, fixture data) and the component tests. The
  real routes were only seen signed out (`real-admin-signed-out`, `real-hosts-signed-out`) and `/ops` as a 404
  (`real-ops-signed-out`).
- **Open dialogs:** Members confirms, `Stop this host`, `New link`, Reset ratings typed (the kit state
  `admin-reset-typed` renders the card; I didn't screenshot the dialog open). Their behaviour is covered by
  `MembersTable.test.tsx`, `HostsView.test.tsx` and `ResetRatingsCard.test.tsx` (focus on Cancel).
- **`Copy this key now`** (the minted key shown once): no kit state.
- **The 0.3.x client itself** (no Windows here). M14.49 rests on code and docs: `POST /api/companion/pair` treats a
  missing `mode` as overlay and mints no token (`app/api/companion/pair/handler.ts:55`). 0.3.0 is the M14.6
  build (pairing plus group picker, commit `51db6dc`), and host-mode pairing arrived only in 0.4.0 (`7868d77`),
  which is never published. Runbook `ship-2.0.md` section 5 says the same. **Needs one look at 0.3.x's Host
  screen to confirm that it asks for a pasted key and has no code field.**
- Discord OAuth live (waits on the user's redirect URL, M14.20). Day theme (not asked for).

---

## 3. Obsolete or wrong items

| # | Where | What | Owner of the fix |
|---|---|---|---|
| O1 | `lib/admin/homeCopy.ts` `HOST_STEP_OPEN` | `Open Kustom with League running and pick Host.` The mode picker is gone in M17. | M17.12 already owns it (decision row 2026-10-04). Correct for 0.3.x, so keep it until then |
| O2 | `lib/groups/copy.ts` `HOST_NOT_ADMIN` | `... Ask one, or switch to Overlay mode.` | M17.12 already owns it |
| O3 | Host card steps 2–3 vs 0.3.x | The code doesn't make a 0.3.x install a host | **M14.49** |
| O4 | Hosts `Add a host by hand`, `Copy this key now`, `They paste it into Kustom when it asks.`, `REVOKE_BODY` "until it gets a new key" | Pasting is gone in the Rust app (decision row M17.1: "pairing is the only way in; no token paste field") | **M17.12 amend**, at the M17.12 switch |
| O5 | Hosts intro `Use this page for someone else's PC.` | Under M17 a non-admin's PC can't host (`HOST_NOT_ADMIN`) and an admin's code only works on their own League account | M17.12 amend |
| O6 | `redesign/STRATEGY.md` §3.2 step 4 | Still says "pick `Host`", "switch to Overlay mode", "manual mint stays as the fallback" | M14.54 (docs) |
| O7 | `docs/00-product.md` "Starting a group" | Lists Create, Discord, **Invite, Install**. The checklist has been Create, Discord, **Install, Invite** since M14.43 | M14.54 (product's own doc) |
| O8 | `lib/landing/copy.ts` `COMPANION_OVERLAY` and the `Overlay mode` / `Host mode` terms on `/download` | True for 0.3.x, false from 1.0.0 | M17.12's "three copy surfaces": make sure these two strings are on its list |
| O9 | `POST /api/admin/players` | set-roles and set-backfill answer 410 "for a stale 1.0 tab", but the 1.0 admin pages were retired with 308s in M14.23, so that tab can't post anymore. set-name and set-discord have no 2.0 UI | M14.56 |
| O10 | Code comments (`HostSetupCard.tsx`, `HostControls.tsx`, `checklist.ts`) say "Host mode", "Host-mode pairing" | Not friend-facing | M17.14's sweep |
| — | "companion", seasons, month windows, 0.4.0, fearless controls on admin pages | **None found** in admin copy (grep over `app/(group)/g/[slug]/admin`, `app/admin`, `app/ops`, `lib/admin`). `$2 a month cap` on `/ops` is a budget, not a month window | — |

### Should Hosts become "set up this PC with a code" only?

**Yes, but not before 1.0.0 is the download.** The plan:

- **2.0 to M17.12** (0.3.x is the download): the only way to make a host is the hand key pasted into 0.3.x's
  Host screen. The code links an account and nothing more. The admin home must say that (M14.49).
- **From the M17.12 switch** (1.0.0 is `releases/latest`): the host card goes back to code only, `Add a host by
  hand` and every paste string are removed, and `POST /api/admin/tokens { action: 'mint' }` is refused with a
  sentence. Keys already minted keep working, because the server accepts 0.3.x until M17.15 (M17.12 amend).
- **The host list stays useful**, because `Stop this host` is the only way to cut off a lost or old PC. It needs
  the PC named by its person (`Hana's PC`, not `This PC`), stopped hosts folded away, and ideally which app
  version each host last ran, so an admin can see who still has to install 1.0.0 by hand (M17's migration
  section: "A 0.3.x user installs it once by hand"). Whether the server knows the version is an open question.

---

## 4. Admin features the plans need that admin does not have

| Need | Plan says | Built / owned? |
|---|---|---|
| `Kustom Premium` section on the admin home: `AI lines` switch, on and off lines, the budget-paused line | M16.1 §1.5 | **No task builds the UI.** M16.3 is platform plumbing (routes, flags), and its acceptance tests only the path → new **M16.3b** |
| `Don't write about <Name>` on a member's row, confirm `<Name> won't be named in AI lines.` | M16.1 §1.4 | **No task builds it** → M16.3b |
| `Write about me` on You (player side, needed for the admin-off-only rule to make sense) | M16.1 §1.4 | **No task builds it** → M16.3b |
| `Hide` on the game line (game page, Tonight poster) | M16.1 §1.5, M16.4 | M16.4 owns it |
| `Hide` on the scouting report (player page) | M16.1 §1.5 says the game page **and the player page** | **M16.6's acceptance doesn't mention it** → amend M16.6 |
| `Hide` on the weekly storyline (board Last week) | M16.1 doesn't cover it: only the group switch can remove it | OPEN for the lead |
| `/ops` shows a group as capped | M16.1 §3 | Not in M16.3's acceptance → amend M16.3 |
| Rule, Spin and Rated controls | 00-product: on Tonight only | M15.5 (Tonight), correctly not admin |
| Admin Games page tells why a game isn't rated (ARAM, rule, Rated off, too short, waiting for a rebuild) | M15.3 stamps rated; 00-product: "A not-rated game is recorded and posted like any other" | **Nobody**: M14.53 (should land with or before M15.8) |
| Hosts: which app version each PC runs, during the 0.3.x → 1.0.0 move | M17 migration section | **Nobody**: in M17.12 amend, data question OPEN |
| A way back to admin for the creator before they link | STRATEGY §3.3 (creator lands on admin as owner) | **Missing**: M14.51 |

---

## 5. Proposed tasks

New strings are marked [NEW COPY]. Product signs every string before merge.

### Blocker

- [ ] **M14.49** Host setup that works with the Kustom we actually ship (0.3.x). *(owner: `web-engineer`,
  `product` for copy; **blocker for M14.27 for any group other than `customs`**; goes back to code only in
  M17.12)*
  Until 1.0.0 is the download, the admin home's `Set up this PC as host` card tells the truth for 0.3.x: (1)
  `Download Kustom on the PC that runs your lobbies.` (2) `Open Kustom with League running, pick Host, and paste
  your host key.` [NEW COPY] (3) `Make your host key` [NEW COPY] mints a key **for the signed-in admin's own
  account, on this card** (same `POST /api/admin/tokens { action: 'mint' }`, shown once with `Copy key`). For an
  unlinked creator, the card first shows the code with `Type this in Kustom under Join a group to link your
  League account. Then come back here for your host key.` [NEW COPY], and the key button appears once they're
  linked. One switch (a constant beside `RELEASES_URL`, e.g. `HOST_SETUP = 'key' | 'code'`) picks this or
  today's code card, so M17.12 flips one line.
  Acceptance: (1) with the switch on `key`, an admin of a fresh group goes from the admin home to a working host
  key without visiting Hosts (component test plus a local integration test: mint, then a fake 0.3.x lobby post
  with that key flips the checklist's Kustom row to `Waiting…`, then `Done`); (2) the unlinked creator sees the
  link step, then the key (test); (3) with the switch on `code`, the card renders today's three steps
  byte-for-byte (snapshot); (4) the operator sees neither button (test); (5) someone checks 0.3.x's Host screen
  on Windows once and confirms it takes a pasted key (report line; if it doesn't, this task is re-planned
  first); (6) screenshots 375/1440, designer ≤ 3 rounds; (7) typecheck, test, lint, build.

### Should-fix

- [ ] **M17.12 (amend)** The admin side of the 1.0.0 switch. *(owner: `web-engineer`, `platform-engineer`;
  inside M17.12, the same commit that makes 1.0.0 `releases/latest`)* Flip M14.49's switch to `code`. Remove
  `Add a host by hand`, `MintHostForm`, `Copy this key now` and `mintedLine`. `POST /api/admin/tokens { action:
  'mint' }` answers 410 `Kustom sets itself up with a code now. Open the admin home on the PC's owner's account
  and tap Get a code.` [NEW COPY] (`revoke` stays). Hosts intro becomes `A host is a PC that runs Kustom in the
  lobby. Each admin sets up their own from the admin home with a code. To host on a friend's PC, make them an
  admin first.` [NEW COPY]. `REVOKE_BODY` becomes `Kustom on that PC stops recording games until someone sets
  it up again with a code.` [NEW COPY]. Also on the list: O1, O2, O8.
  Acceptance: no string containing `paste` or `key` renders on any admin page (test over the Hosts and home
  views); the mint action is a 410 with that sentence and creates no row (integration test); existing keys
  still post (the 0.3.x acceptance M17 already has); grep for `COMPANION_OVERLAY` and `Overlay mode` in `lib/`
  returns nothing.

- [ ] **M14.50** Hosts list that names the PC and fades stopped ones. *(owner: `web-engineer`; polish to
  should-fix)* A paired host reads `<Account>'s PC` [NEW COPY] (falls back to `Unnamed PC`), never `This PC`,
  everywhere: Hosts list, the checklist's `Kustom seen on …`, the confirm title. Stopped hosts fold under
  `Stopped (N)` [NEW COPY] in a native disclosure. A `Last app version` column only if platform confirms the
  lobby or `/me` call already carries a version (no new contract field without a decision row; otherwise drop
  it and record why).
  Acceptance: no `This PC` anywhere (grep plus test); stopped rows are hidden behind the disclosure by default
  (test); 375 and 1440 screenshots.

- [ ] **M14.51** The creator before linking can always get back to admin. *(owner: `platform-engineer`
  (`loginViewer`), `web-engineer`)* `/admin/login` sends a session that created a group (`groups.created_by`)
  and isn't linked to that group's admin home, the same as the post-`/new` landing. The denied help drops `tap
  your name first` for creators. For everyone else it stays, but it reads `Not linked to a League account yet?
  Open your group's tonight page and tap your name next time you're in the lobby, or type a code into Kustom.`
  [NEW COPY].
  Acceptance: an unlinked creator signing in at `/admin/login` lands on `/g/<slug>/admin` (integration test);
  a non-creator unlinked session still gets the denied state (test); no admin route's permissions change (the
  existing setup gate tests unchanged).

- [ ] **M14.52** Members you can find at 375. *(owner: `web-engineer`, `designer`)* Order: owner, admins, then
  last played, newest first. A `Find someone` [NEW COPY] box filters the list as you type, with no page load and
  no server call. On phones, each member's actions sit behind one `Change role` / `Remove` row, so each card is
  one line plus its action, not three buttons.
  Acceptance: with the 40-member kit, making the 30th member an admin takes at most 3 taps plus typing and no
  scrolling past one screen (manual walk, screenshot); the order is tested; the filter is tested by role and
  text queries; every confirm is unchanged (existing tests pass).

- [ ] **M14.53** Admin Games tells why a game isn't rated, and stops sharing the main tab's name. *(owner:
  `web-engineer`, `platform-engineer` for the reason read; land with or before M15.8)* `Rated` reads `Yes`,
  `No · ARAM`, `No · <rule name>` (M15's stamp), `No · Rated was off`, `No · too short or not ten players`
  (the `gateGame` reasons) or `Waiting to be counted` [NEW COPY all], never `Not yet`. The page and its tab are
  renamed `Recording` [NEW COPY], with the line `Every game Kustom saw, and any it missed.` [NEW COPY]. The
  Captured intro drops "once they're recalculated" for `Games picked up the next day are counted overnight.`
  [NEW COPY] if a cron runs `rebuild-ratings`, or else `Games picked up the next day are counted the next time
  ratings are rebuilt.` (platform says which is true).
  Acceptance: one test per reason; no `Not yet` in the Rated column (test); the URL stays
  `/g/<slug>/admin/games` (no link breaks) and the nav label is `Recording`; local data shows the two newest
  `customs` games with their real reason.

- [ ] **M14.54** Docs say what admin does. *(owner: `product`; docs only)* STRATEGY §3.2 step 4 and §3.3's host
  row get a dated note: "0.3.x until M17.12: hand key on the host card (M14.49); from M17.12: code only, no hand
  key". `00-product.md` "Starting a group" lists the checklist order Create, Discord, Install, Invite, and says
  the host key is the interim step. A decision row: "Host setup during the 0.3.x window is a hand key on the
  admin home; the code only links; the hand key is removed at M17.12".
  Acceptance: `grep -n "Overlay mode\|pick .Host" redesign/STRATEGY.md` returns only history lines; the
  product doc order matches `lib/admin/checklist.ts`.

### Polish

- [ ] **M14.55** Admin home after the checklist folds. *(owner: `web-engineer`, `designer`)* Drop the
  `Tonight` card (Tonight is one tap away in the tab bar, and the card only says Roll lives there). Once a host
  is seen, the host card folds to `Set up another PC` [NEW COPY] in a native disclosure. Leave a slot in the
  order for M16.3b's `Kustom Premium` section (Premium groups only). `CONFIRM_MAKE_ADMIN_BODY` becomes `They can
  roll teams, set the mode or a rule, and open these admin pages.` [NEW COPY].
  Acceptance: ready-group screenshots at 375 are no taller than the invite card, the host disclosure, the
  members card and Reset; tests updated by role and text.

- [ ] **M14.56** Retire `POST /api/admin/players`. *(owner: `platform-engineer`)* No 2.0 page posts to it.
  `set-admin` duplicates `members/role`. `set-roles` and `set-backfill` exist for 1.0 tabs that the 308s
  already ended. Move `adminRoute.test.ts` and the backfill integration test to another admin route as their
  fixture, then delete the route, its schema and `ROLES_ARE_INFERRED` / `BACKFILL_IS_ALWAYS_ON`.
  Acceptance: grep finds no `/api/admin/players`; the moved tests pass. **Blocked on OPEN 2** (did 2.0 mean to
  drop the admin name override `set-name`?).

### M16 (Premium) owners

- [ ] **M16.3b** Premium's admin and player switches, on the page. *(owner: `web-engineer`, after M16.3;
  `designer` places them)* The admin home's `Kustom Premium` section (M16.1 §1.5 copy verbatim: `AI lines`
  switch, both state lines, the budget-paused line). Members row `Don't write about <Name>` with its confirm
  (off only, never on). You's `AI lines about you` block with `Write about me` and both confirmations (§1.4). All
  of it only when `isPremium` is true, server-side.
  Acceptance: a non-Premium group's admin home, Members and You render byte-identically (snapshots, M16.2's
  rule); the admin control can set opt-out and never clear it (test); members never see the section or the row
  action (tests); screenshots 375/1440; **M16.4 does not merge before this** (guardrail 4: an opt-out nobody can
  reach is not an opt-out).
- [ ] **M16.6 (amend)** Add: the admin `Hide` on the scouting report, the same as M16.4's (members can't see
  it; hidden for everyone; test).
- [ ] **M16.3 (amend)** Add: `/ops` shows a capped group as `Paused · cap reached` [NEW COPY] (test), per M16.1
  §3.

### M15 note

No new M15 task. M15.5 keeps every rule control on Tonight (correct). M14.53 must land before or with M15.8, or
the first class-wars night fills the admin Games page with `Not yet`. **M15.12's scene walk should include the
admin Games page** (add to its acceptance).

---

## 6. Open questions for the lead

1. **M14.49 timing.** Is a brand-new group (not `customs`) expected to set up between the 2.0 deploy and M17.12? If
   not, M14.49 can drop to should-fix, but then the landing page's `Create your group` invites a dead end in
   that window.
2. **Admin rename (`set-name`).** 1.0 let an admin override a player's display name. 2.0 has no UI for it, and
   names follow Riot's `gameName`. Was that dropped on purpose? If yes, M14.56 deletes it with a decision row.
   If not, it needs a Members row action.
3. **Hosting on a friend's PC after M17.** The plan's answer is "make them an admin". Is that acceptable to the
   user, or does the Rust app need an admin-issued "host for <Name>" code (a contract change, so a decision row
   and a platform task)?
4. **Weekly storyline `Hide`.** M16.1 gives `Hide` to the game line and the scouting report only. Should the
   board's Last week storyline get one too?

## Screenshots (`redesign/screens/admin-audit/`, each at -375 and -1440)

kit-admin-fresh, kit-admin-creator, kit-admin-code, kit-admin-waiting, kit-admin-ready, kit-admin-operator,
kit-admin-reset-as-admin, kit-admin-reset-typed, kit-members, kit-members-admin, kit-members-operator,
kit-discord, kit-discord-connected, kit-discord-test-failed, kit-hosts, kit-hosts-empty, kit-games, kit-ops,
kit-tonight-filling-admin, kit-mode-admin, kit-you-admin, real-admin-signed-out, real-hosts-signed-out,
real-admin-login, real-ops-signed-out.
