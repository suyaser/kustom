# Fun modes: research for Kustom (product, 2026-10-03)

The user asked for ideas like Fearless that are fun and change the rhythm of a night: all-tanks, all-ADCs,
troll builds, Ionia vs Noxus, Demacia vs Freljord. This is research, not a plan. Nothing here is accepted
until it becomes an M-task and gets a decision row.

**Constraints every idea below respects.** Kustom never touches champion select or the game. A mode is
*announced* (Tonight, Discord), *displayed* (the overlay shows the allowed pool, the way it shows Fearless),
and *checked afterwards* from the end-of-game block. Kustom never blocks a pick. There is no Riot API and no
new typing. Riot's League policy adds three lines that rule some ideas out
([developer.riotgames.com/docs/lol](https://developer.riotgames.com/docs/lol)): products "cannot alter the
goal of the game (i.e. Destroy the Nexus)", "should not remove game decisions", and should not be "apps that
dictate player decisions". So Kustom can narrow a pool the group chose, but it never hands one person a
specific champion or build, and the Nexus always decides who won.

**What the end-of-game block gives us** (checked against `packages/lcu/fixtures/16.17/eog-stats-block.json`):
champion id and name, `detectedTeamPosition`, side, win, KDA, gold, CS, damage to champions, damage taken and
mitigated, objective and turret damage, vision, wards, CC time, healing, multikills, first blood, **`items`
(the seven final inventory slots only, not what was bought), `spell1Id`/`spell2Id`, and runes
(`PERK0`..`PERK5`, primary and sub style)**. Final inventory only means a rule like "no boots" can be dodged
by selling boots before the end. The check is honest about that.

## 1. What groups actually play

- **Fearless** went from house rule to the pro standard in 2025. In a Sheep Esports poll of about 14,000
  people, 90% backed it, and champion variety is the reason people give
  ([lolesports](https://lolesports.com/news/fearless-draft-takes-over-2025),
  [Dot Esports](https://dotesports.com/league-of-legends/news/fearless-drafts-are-invigorating-league-esports-and-i-dont-want-to-go-back),
  [RFT.GG](https://rft.gg/news/fear-no-more-first-assessment-of-fearless-draft-after-a-full-year)). Kustom
  already has it (M10).
- **Theme drafts.** "Battle of the Regions": spin a wheel for your region, then pick only champions from it,
  with an optional random-build twist on top ([DMG Inc event](https://dmginc.gg/events/77779)). The wiki's
  list of player-made customs includes All Yordle All Mid and "League Roleplay", where teams play city-states
  ([LoL Wiki, Custom game](https://wiki.leagueoflegends.com/en-us/Custom_game)).
- **Random and troll.** Ultimate Bravery (a random champion, items and runes from a website) is the
  best-known community mode. People love it because "your build sucks and you're seeing how well you can do"
  ([MOBAFire thread](https://www.mobafire.com/league-of-legends/forum/general/ultimate-bravery-challenge-3350)).
  ARAM began as a custom and became an official queue ([LoL Wiki](https://wiki.leagueoflegends.com/en-us/Custom_game)).
- **Rules that change how the game is played.** Hardcore PvP (no farming), Hide and Seek, Catch the Teemo,
  Draft Racing, Smite Fight and Raid Boss (both against bots)
  ([LoL Wiki](https://wiki.leagueoflegends.com/en-us/Custom_game),
  [The GameHaus](https://thegamehaus.com/league-of-legends/3-new-league-of-legends-custom-game-ideas/2024/02/14/)).
  Most of these change what counts as winning, so Kustom cannot score them.
- **Draft formats in in-house leagues.** Captains draft and auctions are the usual ways in-house leagues
  build teams. In-house bots offer MMR matchmaking plus a "casual mode for ARAMs or fun customs"
  ([In House Queue](https://top.gg/bot/1001168331996409856),
  [Guild Order](https://guildorder.com/games/dota2/guides/in-house-league-organization)). Kustom's rule is
  that no human picks teams, so these are out.
- **What flops, and why.** One for All wore out because Riot ran it too often. ARURF frustrated people
  because they got champions they could not play at speed. Doom Bots got tedious
  ([RiftFeed](https://riftfeed.gg/more/league-of-legends-game-modes-the-worst-ever)). Riot's rotating modes
  are praised for "a break from standard Summoner's Rift"
  ([Fragster](https://www.fragster.com/gamemode-rotation-in-league-of-legends-everything-you-need-to-know/)).
  **The lesson for Kustom:** a mode works as one game that breaks up the night, not as the whole night every
  night. Random champions frustrate people. Pools they choose from feel fair.

## 2. Mode ideas

**Ratings, proposed.** Follow the ARAM precedent (`00-product.md`: ARAM is "recorded and never rated").
Modes that leave League as League (roles kept, a real pool, a fair draft) stay **rated**. Modes with an
off-meta pool or troll rules are **unrated**. Do not add a separate rating track: it adds a second number,
splits the 10 games it takes for a rating to settle, and moves further toward the "alternatives to official
ranking" Riot warns about. Unrated games still get the poster, the tape and a per-mode record ("Tank games:
Ana 3-1").

Data sources: **DD** means Data Dragon `champion.json` (`tags`, `stats.attackrange`; the fixture pinned in
M14.8 has the tags stripped out and must be regenerated with them). **REG** means a new region table (see
the box after the table). **Lanes** means the lane table from M10.3. **Hist** means our own `game_players`.
**EOG** means the end-of-game block.

| # | Mode | Rule in one line | How Kustom supports it (never blocks) | Rated | Data | Fun | Rhythm | Effort |
|---|---|---|---|---|---|---|---|---|
| 1 | **Class night** (Tanks / Marksmen / Mages / Assassins / Supports) | Everyone picks a champion with that class tag. | Overlay shows the class pool (minus Fearless bans). The result post names who broke the rule. | No | DD tags (46 Tank, 33 Marksman; plenty for ten unique picks) | 5 | High | S |
| 2 | **Region wars** (Ionia v Noxus, Demacia v Freljord, Piltover+Zaun v Noxus, Shurima v Void) | Each side picks only from its region. | The server randomly gives each side its region when teams are rolled, and both teams' posts say which. Overlay shows *your* side's pool. Check runs per side. | No (pools differ in size: Ionia 23, Demacia 14) | REG | 5 | High | M |
| 3 | **Mirror match** | Your lane opponent plays the same champion as you (needs a blind-pick lobby). | Announced. After the game, champions are compared role by role using `detectedTeamPosition`. | Yes (champions cancel out) | EOG | 4 | Medium | S |
| 4 | **Wrong lane** | Every champion is played outside its usual lane. | Overlay shows, for your assigned role, every champion whose lane is not that role. Check: role against lane. | No | Lanes | 4 | High | S |
| 5 | **Small themes** (Yordles, Void, Shadow Isles, Arcane) | A pool of 7 to 14 champions shared by both sides. Needs blind pick so both sides can pick the same champion. | Same as region wars, one shared pool. | No | REG | 4 | High | S after #2 |
| 6 | **Never played it** | Pick a champion you have never played in Kustom. | The overlay cannot know who is reading it, so it only states the rule. The check reads each person's history. | No | Hist | 4 | Medium | M |
| 7 | **Comfort night** | Play your most-played champion. | The result post compares each pick with the player's top champion. | Yes | Hist | 3 | Low | S |
| 8 | **Off-role roulette** | The balancer puts everyone on a role that is neither their main nor backup. | The balancer already hands out roles, so the receipt shows it. Needs a flag in `packages/core`. Check: `detectedTeamPosition` against the assigned role. | No | core | 4 | High | M |
| 9 | **Pick for the enemy** | Each side chooses the other side's champions out loud in voice. | Announce only. Nothing can be checked, so nothing is flagged. | No | none | 4 | High | S |
| 10 | **All Random Rift** | The client gives everyone a random champion. | Start a lobby creates queue `3120` "SR All Random". Creating a lobby is allowed; the client does the random part, not us. Needs a verify run. | No | LCU queue list | 4 | High | M |
| 11 | **ARAM break** | One ARAM between Rift games. | Start a lobby creates an ARAM custom. Already never rated and never added to Fearless. | No (existing rule) | LCU | 4 | Very high | M |
| 12 | **No boots** | Nobody buys boots. | Check the final `items` against Data Dragon's boots item ids. The post says "final items only". | No | EOG items + DD `item.json` | 3 | Medium | M |
| 13 | **Melee only / Ranged only** | Pick by attack range. | Pool and check from `attackrange`. | No | DD stats | 3 | Medium | S |
| 14 | **No farming** (Hardcore PvP) | No minions or camps. Fight. | Check: CS near zero. Flag anyone over a small allowance (last hits by accident happen). | No | EOG | 3 | High | S |
| 15 | **Bounty** | Last game's MVP has a bounty. The result post counts how often they died and who took them down most. | Display only. The win still comes from the Nexus. | Yes | EOG, M7 MVP | 3 | Low | S |
| 16 | **Best of three** | Same ten, same teams, three games, with Fearless inside the series. | Roll once and keep the split for three games. Tonight shows `Series 1-1`. Needs a product decision, because today every game gets a new roll. | Yes | existing | 4 | Gives the night a story | M |

**Rejected:**
- Ultimate Bravery as a Kustom feature. Kustom handing each person a champion and build "dictates player
  decisions". Friends can still use the website themselves.
- "First to 20 kills" and anything else that changes what counts as a win. Riot's policy forbids changing
  the goal of the game.
- Captains draft and auction. They break "no human picks teams".
- King of the hill (winners stay). Teams stop being fair.
- Votes. Ten taps instead of one.

> **Region data: source and licence.** `champion.json` has no region. Riot's canonical source is Universe
> (`universe.leagueoflegends.com`, a faction on every champion page). But Universe has no documented API
> (its JSON backend did not answer from here), it is **not** on the developer policy's list of allowed
> assets ("Data Dragon, Press Kit, TFT Assets, LOR Assets",
> [policies](https://developer.riotgames.com/policies/general)), and its crests and art are Riot IP. The
> usable static source is **Meraki `lolstaticdata`**: the code is MIT, and each champion's JSON has a
> `faction` field ([repo](https://github.com/meraki-analytics/lolstaticdata),
> [champions.json](https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json)). Fetched
> today: 171 champions (Data Dragon 16.19.1 has 173, so the two newest are missing), 20 "unaffiliated";
> Ionia 23, Noxus 17, Freljord 15, Demacia 14, Zaun 14, Shurima 11, Shadow Isles 10, Void 9, Piltover 8,
> Bilgewater 8, Ixtal 8, Targon 7, Bandle City 7. The data is derived from the LoL Wiki and Meraki asks
> users to credit both. **Proposal:** a static table kept in the repo (champion id to region slug, region
> *names* as plain words, no crests, no lore text), seeded once from Meraki with a credit line, spot-checked
> against Universe, with a test that every Data Dragon id has a row (the same pattern as M10.3's lane
> table). A region name is a fact, not an asset. Meraki's CDN is never called at runtime.

## 3. Mode of the night

- **Picking a mode is one tap, by an admin, before Roll teams.** It is an optional tap like Reset Fearless,
  not a new step in the night. Tonight gets a `Mode` row: `Normal` (the default), the enabled modes, and
  **Spin**. Spin is a wheel on Tonight that lands on a mode the server picks at random from the ones the
  group has turned on, so nobody can be accused of choosing a mode to suit themselves. It is one tap, and
  everyone watching sees the same result.
- **It lasts one game by default.** After the game, the mode goes back to `Normal`. This is the rhythm
  change the user asked for, and it avoids the One for All burnout. An admin can choose `Rest of tonight`
  instead, and it clears at the night boundary.
- **Themed nights without a tap.** In `/admin`, a group can tie a mode to a weekday ("Fridays: Region
  wars"). The first game that night uses it. A group that sets it up never touches it again.
- **Tonight:** a mode card above the teams, `TANKS ONLY · not rated`, with the pool behind one tap (the
  Fearless card pattern). After the game, the poster adds one line: `Blue kept the rule. Red: Jinx isn't a
  tank.`
- **Discord:** the rule goes on the teams post as a line ("This game: tanks only. Not rated."), and whether
  each side kept it goes on the result post. It is not a separate message, because the rule belongs to that
  game. Fearless keeps its own message.
- **Overlay:** the panel title changes to the mode, and the pool becomes the mode's pool minus the Fearless
  bans. It never highlights a live pick (M10.2 still holds: no champion-select read).
- **Breaking a rule:** the game is flagged on the poster, and the result stands. In a rated mode the rating
  still moves as normal. Nobody overturns a result, which keeps Kustom zero-input.
- **Fearless:** unrated mode games add nothing to the Fearless pool, the same as ARAM. Otherwise one region
  game would burn through Ionia.

## 4. Build these three first

1. **Class night.** The user named all-tanks and all-ADCs, it is the best-known theme, and the data is in
   Data Dragon, which we are already allowed to use. Building it also builds everything later modes reuse:
   the mode card, the Spin, the overlay pool, the line in Discord and the check after the game.
2. **Region wars.** The user's other example, and the most-cited community theme. All it adds is the region
   table, and that table also unlocks the small themes (#5) for little extra work.
3. **Mirror match.** The mechanism's first *rated* mode, so the competitive side of the group gets something
   too. It needs no new data (role and champion are already stored) and it is the fairest game Kustom can
   offer, because both lanes play the same champion.

Open for the user: whether best of three (#16) is wanted, because it changes the decision that every game
gets a fresh roll.
