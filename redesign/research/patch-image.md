# Week notes: a shareable patch-notes-style image (research, 2026-10-04)

The user asked whether Kustom can make a shareable picture in the style of Riot's League patch-notes graphic
("to share what changed with friends"). Their reference has a dark navy page, a big patch number, gold serif
`PATCH NOTES`, red NERFS and green BUFFS rows of round champion portraits, a SYSTEMS row, a NEW row of splash
cards, and a role and rank key. This is research and a throwaway prototype. Nothing here is accepted until it
becomes an M-task and gets a decision row. No product code was changed.

## Verdict

1. Yes. A weekly **"Week notes"** image for the group (BUFFS = risers, NERFS = fallers, NEW, SYSTEMS, a role
   key) can be rendered by the `ImageResponse` setup we already have in about 4–5 days of work, using only our
   own data.
2. Borrow the patch-notes **layout and section words**, not Riot's look: no Riot logo, no gold serif lockup,
   no champion portraits or splash art. Players appear as their initials in our own Floodlit Slate palette,
   with our own role marks.
3. Post it with the Sunday weekly post, as one 1200×630 image (variant B), with the existing text embed kept
   as the fallback. Put a download link for the 1920×1080 version (variant A) on the board's Last week. Leave
   "Kustom release notes" for later as a one-off.

## 1. Recommendation

**Which reading.** Build reading 1, **the group's week**, now. It renews itself every Sunday, it is about
the friends rather than the software, and every number already exists (the board's net points, the awards,
the records, the Fearless pool, the mode history). Reading 2, **release notes for Kustom**, happens maybe
twice a year. `CHANGES.md` is also written to the owner ("what's waiting on you"), not to friends, so it
would need its own copy each time. If the user wants it, it can reuse the same card parts as a
`/og/kustom/release/<version>` route reading a checked-in copy object, posted once by a script (about 1 day,
section 6). It isn't worth building first.

**Where it goes.**

| Surface | What | Why |
|---|---|---|
| Sunday weekly post (05-design 10.6) | Variant B (1200×630) as E1's `image`, only on a public origin | Discord shows it inside the post the group already reads every Sunday. E1's text stays exactly as it is, so the post is complete without the image (10.1, 10.11). |
| Board, `Last week` | A plain link `Save week notes` → the 1920×1080 PNG (variant A) with `Content-Disposition: attachment` | This is the "share with friends" path for WhatsApp and stories. Someone who wants the big one taps for it. |
| Board, `Last week` unfurl | `og:image` = variant B | A pasted `…/leaderboard?window=last-week` link unfurls as the week. This is 5.16's pattern, so no new mechanism. |

**When it's made.** On request, never stored. The route renders the closed week the first time Discord or a
browser asks, and the CDN keeps it (section 4, Caching). The Sunday cron (`postClosedWindow`) only puts the
URL in the payload. No week, or a week with fewer than 3 rated games: no image (the post already skips weeks
with no games). A week the owner reset ratings in: no BUFFS/NERFS, NEW and SYSTEMS only, or no image. Product
picks one.

**One image or several.** One. Variant C (three square cards as a Discord gallery) reads better tapped
open, but in the feed a three-image gallery on a phone is one large tile and two small ones, each about 160 px
wide. That is worse than a single 16:9 image, and it costs three renders and the shared-`url` gallery trick
that 10.3 deliberately avoids. Keep C in reserve for an Instagram-style "story" export if anyone asks.

## 2. Riot assets: the legal line

Kustom is a League **client** app. Our 2026-10-03 decision row puts it under Riot's **developer policies**
(developer.riotgames.com/policies/general, updated 29 May 2025), not the fan-content "Legal Jibber Jabber"
policy (riotgames.com/en/legal, August 2018). Both were re-read today.

- **Developer policies**: developers may use **Data Dragon**, the Press Kit, TFT and LoR assets "in the
  development and marketing of your product". Riot logos and trademarks only "where such use is inevitable to
  serve the core value of the product". **"Products cannot closely resemble Riot's games or products in style
  or function."** And the "isn't endorsed by Riot Games…" notice must be readily visible.
- **Legal Jibber Jabber** (for fan projects, not us): non-commercial use only, "You may not use any of our
  logos or trademarks anywhere in your Project", "We prohibit the use of our IP in games and apps", it needs
  its own notice, and it needs original content ("Don't just rip off or add some light commentary"). We don't
  print this notice, because it would claim a policy Kustom isn't under (2026-10-03 row).

**What we can and can't use.**

| Element | Use? | Why |
|---|---|---|
| Riot / League logo (the gold `L`), any Riot mark | **No** | Not inevitable for the core value; Jibber Jabber bans them outright. |
| "PATCH NOTES" lockup: gold Beaufort-style serif, tracked caps, the swirl backdrop, the `26.17` year.patch number | **No** | Together these are Riot's product look ("closely resemble… in style"), and a picture of them with our numbers in it could pass for an official graphic. We use `WEEK 12 NOTES` in Archivo condensed, the group's own week count, and our slate floodlight. |
| Riot's fonts (Beaufort for LoL, Spiegel) | **No** | Proprietary and licensed to Riot. Our three OFL faces are already in `app/_og/fonts/`. |
| Section words `BUFFS`, `NERFS`, `NEW`, `SYSTEMS`, `KEY` | **Yes** | Ordinary gaming vocabulary that every game and wiki uses. Paired with our wordmark and palette, they read as a nod, not a copy. |
| Riot's role icons, rank emblems, rank colour bars | **No** | Ours exist: `app/_icons/RoleIcon.tsx` (five marks drawn in this repo). The rank key is dropped; we don't print ranks on images. |
| Champion **names** as words (`Smolder, Aurora, Ambessa`) | **Yes** | Already on `/games`, Fearless and Discord (2026-09-12 and 2026-09-20 rows). |
| Champion **square icons** (Data Dragon) | **Policy allows, our rows say no** | Data Dragon is the listed source, but 2026-09-23 (reaffirmed 2026-10-04) keeps icons off share cards and out of Discord, and 5.16 is "Riot-safe: no champion art". In this image they would also be the main thing making it look like Riot's graphic. |
| **Splash art** (Data Dragon `img/champion/splash`) | **No** | Same rows. Splash cards in a NEW row are exactly the reference's look, they are huge files, and a skin splash is Riot marketing art. |
| Notice | **Short line on the image, verbatim on the page** | 5.16 keeps the notice on the page, not in the picture. A downloaded PNG leaves the page, though, so the prototype carries `Made by Kustom from this group's own games. Not affiliated with or endorsed by Riot Games.` That is a 5.16 amendment, and designer and product decide. Never "Riot Games presents", never "official". |

**Does the champion-icon row still hold for a downloadable image?** Yes, keep it. The reasons get stronger
for a file that travels: it leaves our page (and its notice), it gets reshared without context, and champion
portraits laid out in a patch-notes grid are the closest Kustom could come to "closely resembling" a Riot
product. The faces on this image are **people, not champions**, which is the point of the image anyway: who
went up, who went down. So portraits are each player's **initials in a ring** (prototype). Discord or League
profile avatars were considered and rejected. Players are keyed by PUUID, not Discord. A League summoner icon
is Riot art. A Discord avatar would mean fetching a third-party CDN at render time and printing a photo
somebody may not want on a shareable file. Initials need no fetch and leak nothing that the public board
doesn't already show.

## 3. Design (prototype)

The look is 05-design 7.3 Night through `app/_og/palette.ts`: page `#05070C`, the azure and amber lamps, the
48 px grid, the `▍KUSTOM` wordmark with the group name, Archivo condensed 900 for the big words, Atkinson for
names, Martian Mono for numbers. What follows from our own rules, and why it can't copy the reference's
colours:

- **No green BUFFS and no red NERFS.** 3.1 has no success green, red is side 200 and never means "bad", and
  3.7 says rating up and down are not coloured. The two sections are told apart by word, glyph (▲ / ▼),
  weight and contrast, the way the board does it: a gain is `text` at 600, a loss is `dim`. BUFFS rings are a
  4 px `text` ring and NERFS rings a 2 px `line` ring.
- **Amber stays on the wordmark bar only** (3.4: never a heading or a winner).
- **The key is ours**: the five role marks with their words, plus one line saying what points are and what
  the mark means (most-played role this week).
- **Nothing that must be read goes under 28 px at 1200 wide** (5.16) in variant B. Variant A follows the
  reference's density and is a tap-open or download picture.

Variants (all rendered with the same Satori/resvg `ImageResponse` the app uses and the committed fonts):

| Variant | Size | Verdict |
|---|---|---|
| **A, Patch board.** The reference's three-column layout: BUFFS and NERFS medallions on the left, the key in the middle, SYSTEMS and NEW fact tiles on the right | 1920×1080 (also 1200×675 scaled) | The "looks like the thing they showed me" version. Good to download and as a phone wallpaper. In the Discord feed (about 400 px wide on desktop, about 330 px on a phone) names come out at about 4–5 px, so it's unreadable until tapped. **Use it for the download.** |
| **B, Big type.** Header, top 3 BUFFS and top 3 NERFS as name + mark + points rows, one NEW strip | 1200×675 (and 1920×1080 scaled) | Names 34 px → about 9–11 px in the feed, readable without a tap. **Use it in the Sunday post and the unfurl.** Ship it at 1200×630 so it shares 5.16's `OG_SIZE` and the unfurl slot. |
| **C, Card set.** Three 1080 squares: BUFFS, NERFS + key, NEW + systems | 1080×1080 ×3 | Best tapped open, worst in the feed (gallery tiles about 160 px). The NEW card is cramped. Keep it in reserve. |

## 4. Technical plan

**Rendering.** `next/og` `ImageResponse` (Satori + resvg), exactly like `app/og/*` today. No `runtime`
export, so these routes run on the **Node.js runtime**. That is required: `app/_og/fonts.ts` reads the TTFs
with `node:fs` (`import 'server-only'`), and nothing is fetched at render time. Satori constraints already
handled in `_og`: static TTF only (no `woff2`, no `wdth` axis), every multi-child `div` is `display: flex`,
no CSS variables (fixed hex), no fit-to-width (use `app/_og/fit.ts` for names, 5.16 ruling (c)). The
prototype script renders all seven PNGs, including font loading, in 1.35 s on this Mac, so about 0.2 s each. Sizes: A 274 KB, B 108 KB, C about 140 KB
each. The edge-runtime 500 KB bundle cap doesn't apply on Node.

**Discord.**
- An embed `image` is a URL. Discord fetches it through its media proxy and keeps its own copy. Any aspect
  works. On desktop it shows about 400 px wide, on phones the embed's width (about 300–340 px), and a tap opens
  it full size. 16:9 / 1.91:1 is the safe shape. A tall image is letterboxed by the height cap. Keep it well
  under 1 MB (B is about 110 KB). The 8 MB proxy limit is far away.
- **Public https origin only**, the same guard that decides whether a post has links at all (10.1 rule 6,
  10.11). Localhost: no `image`. A 404 or a timeout: Discord lays the post out without it.
- **Alt text.** Discord gives embed `image` URLs **no alt text**. Only multipart attachments take
  `attachments[].description`. So the existing E1 text (slot line, the board, the awards) is the accessible
  version and must stay complete. That's another reason the image is added on top of the text and doesn't
  replace it. On the site, the download link and any `<img>` get an `alt` built from the same model (`Week 12
  notes for Customs Night: buffs Ramzyinhović +212, Syndrome Axes +140, knifiy +88; …`).
- Alternative, not recommended now: render inside the cron and upload as a multipart attachment
  (`attachment://week-12.png`, with an alt description). That gives a real alt text and a snapshot that never
  changes, but it puts a render in the cron path and adds a new webhook code path. Decide if alt text matters
  more than simplicity.

**Caching.** A closed week only changes if `rebuild-ratings` refolds it or the owner resets ratings. Put the
week in the path (`…/week/2026-09-27`) and serve `public, max-age=3600, s-maxage=86400,
stale-while-revalidate=604800`. Don't use `immutable`, so a rebuild shows up within a day. Discord's proxy
keeps its own copy anyway. Add `?v=<ratings_since epoch>` to the Discord URL so a reset breaks the old cached
copy. An unknown group, a malformed date, a week that hasn't closed yet, or a week with no games is a 404,
like the game card.

**Routes and builders to add** (names follow the existing `_og` and `lib/og` split):

| Piece | File | What |
|---|---|---|
| Model (pure, tested) | `lib/og/weekNotes.ts` | `weekNotesModel(input): WeekNotesModel`: picks BUFFS (top 3 by net points, or 5 on A), NERFS (rule below), NEW items (first night, first picks, records), SYSTEMS (modes, Fearless), the week number, the alt-text string. No copy is typed anywhere else (10.14 rule 9). |
| Loader | `lib/og/weekNotesLoad.ts` | `loadWeekNotes(client, groupId, weekStart)`: `loadBoard` with the last-week window (net points, W/L, settling), `awardBlocks`, `funFactsView` for records whose game falls in the week, plus two small queries: **first night** (players whose first counted game in the group is in the week) and **first picks** (`game_players.champion_id` whose first appearance in the group is in the week, the same derivation as the Fearless pool), and the mode counts from `games.rule`. Public client, as the other OG loaders. |
| Card parts | `app/_og/WeekNotes.tsx` | `WeekNotesFeed` (B, 1200×630) and `WeekNotesBoard` (A, 1920×1080), sharing `Medallion` (initials ring + role mark), `SectionHead`, `KeyBox`, `RoleMark` (a Satori copy of `RoleIcon`'s five paths). |
| Routes | `app/og/g/[slug]/week/[weekStart]/route.tsx` (B) and `app/og/g/[slug]/week/[weekStart]/board/route.tsx` (A; `?download=1` adds `Content-Disposition`) | `cardResponse(...)` with the cache header above, the 404 rules of the game card. |
| Discord | `lib/discord/embeds.ts` `windowSummaryEmbed` gains `image?: string`, and `postClosedWindow` passes `weekNotesUrl(origin, slug, weekStart)` only on a public origin | Snapshots: with origin → `image.url` present; localhost → absent; E1 text byte-identical either way. `guardMessage` is unaffected (images don't count toward 6,000). |
| Board | `Last week` window: a `Save week notes` link, plus `generateMetadata` `og:image` → the B route | web-engineer. |
| Tests | `lib/og/weekNotes.test.ts`, `app/og/og.test.ts` (route 404s, headers) | NERFS rule, empty week, reset week, settling exclusion, long names (`TheSHADOWREAPER`, `WMWMWM…`), alt-text text. |

**Effort.** Model + tests 0.5 d · loader + the two queries 1 d · card parts + routes 1 d · Discord wiring +
snapshots 0.5 d · board link + metadata 0.5 d · designer rounds and a real phone check in a scratch channel
0.5–1 d. **About 4–5 days**, platform-engineer (loader, routes, Discord) and web-engineer (card, board), with
a designer sign-off. Release notes card (reading 2), if wanted: +1 d (`/og/kustom/release/[version]` + a
`post-release` script; it reuses the parts).

## 5. Copy

Section words are the joke and stay. Everything under them follows the M16.7 tone read: plain counts, no
adjectives about a losing week, nobody mocked.

| Where | Copy |
|---|---|
| Wordmark line | `▍KUSTOM  Customs Night` |
| Title | `WEEK 12 NOTES`. *12* = weeks since the group's first counted game (or since `ratings_since`), the group's own "patch number". Never `26.40`-style year.patch. |
| Slot line | `Sunday 27 Sep to Saturday 3 Oct · 14 rated games · 4 nights` (the board's range wording) |
| BUFFS | `▲ BUFFS` · sub `most points this week` · rows `Ramzyinhović  +212  5W 2L` |
| NERFS | `▼ NERFS` · sub `gave some points back` (C: `Gave some points back. Same board next week.`) · rows `TheSHADOWREAPER  −61  1W 3L` (real minus U+2212, `dim`) |
| NERFS rule | At most 3. Only players with **3 or more rated games** that week, **never a settling player** (newcomers go to NEW instead), numbers only. Nobody is ever in NERFS alone (no section if fewer than 2 qualify). Product may soften the word to `▼ COOLDOWN` if `NERFS` reads as a jab; the prototype keeps it because it's the bit the user asked for. |
| NEW · first night | `FIRST NIGHT` / `Chaos` / `joined on Tuesday · settling 4/10` |
| NEW · record | `RECORD` / `Syndrome Axes · 48.2k` / `most damage in a game, new group best` (record titles from the Records copy, verbatim) |
| NEW · first picks | `FIRST PICKS FOR THE GROUP` / `Smolder, Aurora, Ambessa +6` / `champions nobody here had played before` |
| SYSTEMS · mode | `MODE OF THE NIGHT` / `Tanks only ×2` / `Ionia vs Noxus ×1 · not rated` (M15's mode names) |
| SYSTEMS · Fearless | `FEARLESS` / `34 banned` / `138 still open` (open count is 8.12's) |
| Awards (A only, if room) | the week's award labels and lines, verbatim (`Best off-role` / `XETA · 4W 1L as top`) |
| Key | `KEY` · `top jungle mid adc support` with marks · `Points: Rating won or lost in the week's games. Mark: most-played role.` |
| Notice (pending 5.16 ruling) | `Made by Kustom from this group's own games. Not affiliated with or endorsed by Riot Games.` |
| Board link | `Save week notes` |
| Alt text | `Week 12 notes for Customs Night, 27 Sep to 3 Oct. Buffs: Ramzyinhović +212, Syndrome Axes +140, knifiy +88. Nerfs: TheSHADOWREAPER −61, SugarPapy −44, FoxHound −18. New: Chaos's first night, 9 first picks, a 48.2k damage record.` |

## 6. Open questions (for the lead)

1. Product: is `NERFS` OK under the tone rules with the rule above, or `COOLDOWN`?
2. Designer: amend 5.16 so a downloadable image carries the short notice line?
3. Image in the Sunday post at all? It repeats the board that E1's text already shows. 10.11 rejected the
   game card as an image for exactly this reason. The case for it: the image is the shareable thing, and
   the post is where people see it. The fallback is to keep it only on the board (download + unfurl).
4. URL image (no alt text) or multipart attachment (alt text, snapshot)?
5. Reading 2 (release notes): wanted at all, and who writes the friend-facing copy per release?

## Prototype

Throwaway script: `/private/tmp/claude-501/-Users-suyaser-lol/33c2c4d5-3271-4fd2-a336-2cee3f00cc73/scratchpad/patch-image/render.mjs`
(`node render.mjs`). It imports `next/dist/compiled/@vercel/og` from `apps/web` and the TTFs from
`apps/web/app/_og/fonts/`, so what you see is what the route would draw. The data is fake. The names are the
roster from 05-design 10.4–10.6's fixtures (the local stack's `customs` group only holds seed players such as
`Player0`–`Player9`, `Lux Aeterna`, `Thresh Hold`, so it wasn't used). No hosted data was read.

PNGs (scratchpad, `patch-image/`):

- `A-patch-board-1920x1080.png`: variant A, the download version
- `A-patch-board-1200x675.png`: A scaled down, to show the density cost in the feed slot
- `B-big-type-1200x675.png`: variant B, the recommended Discord / unfurl image
- `B-big-type-1920x1080.png`: B scaled up
- `C-cards-1-buffs-1080.png`, `C-cards-2-nerfs-1080.png`, `C-cards-3-new-1080.png`: variant C card set
