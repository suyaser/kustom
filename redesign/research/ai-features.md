# Can AI make Kustom better or more fun?

Research note, product, 2026-10-03. Not a plan: nothing here is in `docs/02-milestones.md` yet, and any of it
needs a decision row before it is built. Short answer: **yes, as a writer, never as a source.** The numbers
already exist and are trusted; the receipt is the trust anchor. AI can add the one thing the product does not
have, which is a voice: a line of story on top of numbers we already store.

## 1. Landscape

**What others do.**
- *Stat sites and coaches* (Mobalytics Smart Highlights, Blitz, OP.GG, a wave of "AI coach" apps) sell
  post-game summaries and improvement tips. Useful for a solo grinder; heavy for friends playing for fun.
- *Discord bots* are where the fun is. PerVerBot turns a League game into an AI "podcast" that roasts you, with
  a tone dial (unfiltered / mild / sarcastic). Doran's-bot and Scuttle post an automatic card when a game ends
  with KDA and "fun facts". The pattern that works: **automatic, short, in the channel people already read,
  about people who know each other.**
- *Year-in-review* (Spotify Wrapped, Steam Replay) proves people love being told a story about their own
  numbers and sharing it.
- *Natural-language stats* (StatMuse) works when the answer is a real query over real data, not a guess.

**What backfires.**
- *Wrong numbers.* Gannett paused AI high-school recaps after they were mocked; ESPN's AI recap ran a headline
  with the wrong winner. In a friend group one wrong stat ends the feature: "the bot is rigged" becomes "the
  bot lies", and that leaks onto the receipt.
- *Slop.* Spotify Wrapped 2024 was called generic and inaccurate and lost the playful specific bits; 2025 went
  back to "a more human touch". Vague praise in the same template every day gets muted.
- *A chatbot nobody asked for.* Discord shut down Clyde within months.
- *Tone.* Roasts land between friends who opted in, and sting when they pick on the same weak player every night.

**Riot policy.** The general developer policy says nothing about AI or generated text. What applies is what
already binds us: no unfair advantage, nothing that draws conclusions *during* gameplay, don't de-anonymise
players, and the "not endorsed by Riot" disclaimer. Everything below is post-game or pre-game words built from
stored data, which is inside those lines. Anything live in champion select (pick advice, counter tips) is out:
it breaks our own hard rule and comes close to Riot's.

## 2. Ideas

Costs assume claude-haiku-4-5 at $1 / $5 per million tokens in / out, and a Sonnet-class model at about
$3 / $15. A night is about 5 games. Every idea uses the same grounding pattern (section 4): the server builds a
fact list from the DB, the model writes words from it, a checker rejects any number or name not in it.

| # | Idea | What the player sees | Where | Fun / value | Effort | Cost per night | Zero input |
|---|---|---|---|---|---|---|---|
| 1 | **Game recap line** | `Blue closed it in 31. Sami's Lee Sin was in on 14 of Blue's 19 kills, and Red's 46% at kickoff never got closer.` | Discord result post, game page | 5 | S | 5 Haiku calls x ~2k in / 80 out = **~$0.01** | yes |
| 2 | **Weekly storyline** | `Karim went from 9th to 2nd on four wins in a row. The cursed duo is still Omar and Youssef: 1 and 6 together.` | The existing Sunday post, Board on Last week | 5 | S | 1 Sonnet call/week x ~8k in / 400 out = **~$0.03/week** | yes |
| 3 | **Player scouting report** | `The farmer. Most CS a minute in the group as mid, 7.9. Wins 64% on Ahri, 31% when filled to jungle.` | Player page, refreshed weekly | 4 | M | 20 Haiku calls/week x ~3k / 120 = **~$0.07/week** | yes |
| 4 | **Night in three lines** | `Five games, Blue took three. Nour played all five and won four. Biggest upset: Red won game 4 from 38%.` | Discord at the 06:00 night boundary; Tonight's empty state next day | 4 | S | 1 Haiku call x ~6k / 120 = **<$0.01** | yes |
| 5 | **Rivalry hook** | `Rematch: Omar vs Karim in mid again. Karim leads it 6 to 1.` | Tonight balanced state, under (never inside) the receipt; Discord teams post | 4 | M | 1 Haiku call per roll x ~2k / 50 = **<$0.01** | yes |
| 6 | **Award citations** | `Most improved: Karim. Up 140 this week, and he did it off-role twice.` | Sunday / monthly award posts, Board badges | 3 | S | 3 Haiku calls/week = **<$0.01/week** | yes |
| 7 | **Spicy mode** (group opt-in) | `Youssef's Yasuo: 0/9/2, 4,100 damage. The fearless ban did him a favour.` | Same places as 1 and 4, when a group turns it on | 4 for groups that want it, 1 otherwise | S once 1 exists | same as 1 | yes; opt-in is an admin setting, not a night step |
| 8 | **Stat-backed tip** | `When your vision as support is over 40 you win 7 of 10. Under 25, 2 of 9.` | Player page, behind a tap | 3 | M | 20 Haiku calls/week = **~$0.07/week** | yes |
| 9 | **Monthly "Kustom Wrapped" card** | `October: 23 games, 14 wins, your best friend on the Rift is Nour (9-2 together), your nemesis is Sami.` | Player page and a share image (M11.4 unfurls) | 4 | M | 20 Sonnet calls/month x ~4k / 200 = **~$0.30/month** | yes |
| 10 | **Daily Mystery clue writer** | `This player died 11 times and still had the most damage in the game. Who was it?` | Daily Mystery / Guess the Award | 3 | S | 1 Haiku call/day = **<$0.01** | yes |
| 11 | **Ask Kustom** | Type `who carries me most?` and get `Nour: 11 wins in 14 games together, your best duo.` | A box on More or the player page | 3 | L | per question ~$0.002 (Haiku picks one of a fixed set of queries) | no: it is typing, but never during a night and never required |
| 12 | **Close-game line on the receipt's "other splits"** | `Split 2 was 51 to 49 too; this one won on fewer people off role.` | "How the bot decided" | 2 | S | <$0.01 | yes |

Notes on the ideas:
- **Data.** Every row uses only what is stored: `game_players` (KDA, gold, damage, CS, vision, mitigated, damage
  to objectives, champion, role, side, win), ratings and the weekly rating, `splits` (win chance, gap,
  candidates, reason), MVP/ACE, awards, nemesis/duo, 1v1, fearless pool, duration. No timeline, no kill
  participation beyond kills plus assists over team kills, no "turning point" (we do not read the live game,
  so the model must never narrate a teamfight, a Baron, or a minute it cannot see).
- **#5** must never restate the odds in its own words. The receipt owns win chance; the hook may only cite a
  head-to-head count.
- **#7** is the tone people actually share and also the one that hurts. Rules: the group turns it on, any player
  can opt out of being the subject, nobody is the subject of a spicy line two nights running, and it never
  mentions rank, rating loss, or anything outside the game.
- **#8** must describe, not prescribe causes: "you win 7 of 10 when" is a count; "you lose because" is a claim
  the data cannot back. Minimum sample size, or it says nothing.
- **#11** is the one idea that breaks the scene's spirit if it ever becomes how you *get* something. Keep it a
  toy. The model only chooses a query template and fills slots; it never writes SQL and never sees other groups.
- **#12** is listed to reject it: principle 3 says every screen says fairness the same way. A model paraphrasing
  the receipt is the fastest way to two different explanations of one split.

**Considered and rejected.** A voice-channel narrator (needs a Discord bot, which is out of scope since
2026-09-10); champion-select pick or counter advice (gameplay automation, hard rule); an AI rating or "true
skill" score (the rating is OpenSkill and nobody can hand-edit it; a second opinion from a model would undo
principle 4); a chatbot in Discord (no bot, and Clyde's fate).

## 3. Top 3 to build first

1. **Game recap line (#1).** Highest frequency, smallest build, rides the result post and poster that already
   exist, and a game has the tightest fact set, so it is the easiest place to prove the checker works. If the
   group mutes it, we learn that for a cent.
2. **Weekly storyline (#2).** The Sunday post is the moment the group already looks at; today it is a list. One
   paragraph of story over climbs, streaks and the cursed duo is what makes "something to win by Friday" feel
   like a season finale. One call a week, worth a better model.
3. **Player scouting report (#3).** The only one that is about *you*, which is what people screenshot. It turns
   role and champion counts we already compute into an identity, refreshed weekly so it is never stale and
   never costs per page view.

All three keep the scene exactly as it is: nobody types, nothing new appears before the game, and each attaches
to a surface that already ships. Spicy mode (#7) is the natural follow-up once #1 has proven it gets numbers
right.

## 4. Guardrails

1. **Numbers come from the DB; the model only writes words.** The server builds a fact list (`F1: Sami, Lee Sin,
   kills 9, assists 5, team kills 19`), the model writes from it, and a checker rejects the output if any
   number, name, champion or percentage in it is not in the facts. Rejected output falls back to no line, never
   to an unchecked one. Players are sent as `P1..P10` and names are substituted after, which also keeps Riot IDs
   off the third-party request.
2. **Write once, store, never regenerate on view.** One line per game, keyed to the game, like idempotent
   ingest. A rebuild of ratings does not rewrite old lines. (Storing them is a schema change: lead and user call.)
3. **No gameplay, no live game.** Nothing generated during champion select or in game; nothing about plays we
   cannot see.
4. **Opt-out at two levels.** A group admin can turn AI words off entirely (default for new groups: plain tone,
   on or off is the lead's call); spicy is opt-in per group; any player can opt out of being named in a
   generated line.
5. **Cost caps.** A hard monthly cap per group (suggest $2) and a global kill switch; at the cap the feature goes
   quiet, nothing else changes. Budget at the numbers above: under $1 per group per month.
6. **Label it.** Generated lines are visibly the bot talking (a small `recap` label), never mixed into the
   receipt, the scoreboard or anything a friend would quote as a fact.

Sources: [Riot developer policies](https://developer.riotgames.com/policies/general),
[Riot third-party applications](https://support-leagueoflegends.riotgames.com/hc/en-us/articles/225266848),
[Mobalytics post-game highlights](https://mobalytics.gg/blog/dev-blog-post-game-highlights/),
[PerVerBot / Doran's-bot listings](https://top.gg/bot/864776547285991445),
[Gannett pauses AI sports recaps](https://vibegraveyard.ai/story/gannett-ai-sports-gibberish/),
[ESPN AI recap headline error](https://frontofficesports.com/espn-blames-human-headline-error-ai-article/),
[Spotify Wrapped 2024 AI backlash](https://news.designrush.com/spotify-wrapped-2024-disappoints-fans-with-ai-generated-results),
[Spotify Wrapped 2025 human touch](https://develop.adweek.com/?p=1921810),
[Discord shuts down Clyde](https://gizmodo.com/discord-chat-ai-clyde-shutdown-1851030659),
[StatMuse](https://techcrunch.com/2017/09/07/statmuse-lets-you-ask-a-sports-question-and-hear-a-response-from-an-nfl-star),
[Claude Haiku 4.5 pricing](https://pricepertoken.com/pricing-page/model/anthropic-claude-haiku-4.5).
