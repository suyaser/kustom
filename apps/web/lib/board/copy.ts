/**
 * Every word `/leaderboard` and `/p/[puuid]` say (M3.5, M3.8, M3.10), in one file, spelled the
 * way product and `docs/05-design.md` spell them.
 *
 * The two names are fixed on every surface — **Proven** (`round(ordinal * 60)`, the sort key
 * and the primary number) and **Rating** (`round(mu * 60)`, the number the embeds print) — and
 * no surface invents a third (M3.5 brief; the row in `04-decisions.md`). Capitalised as
 * labels, lower case inside a sentence.
 */

import { config, seedFromRank } from '@customs/core';
import type { WindowKind } from '../night';
import type { RatingTrack } from './types';

/** The primary number: `round(ordinal * 60)`. Named once per page, in the legend. */
export const PROVEN_LABEL = 'Proven';

/** The secondary number: `round(mu * 60)`. Printed inline on every line 2. */
export const RATING_LABEL = 'Rating';

/**
 * The legend in the board card's header bar, right-aligned over the **one** unlabelled number
 * (`05-design.md`, "Leaderboard row", amended 2026-09-09). A legend, not a header row: it does
 * not stick, does not sort and is not tappable.
 *
 * **One word, and the word is `Proven`.** Right-aligned, `Proven · Rating` put `Rating`
 * directly over the Proven column and `Proven` over nothing, which reads as two side-by-side
 * columns when the two numbers are stacked one per line. `Rating` needs no legend: it names
 * itself on every line 2.
 */
export const BOARD_LEGEND = PROVEN_LABEL;

/**
 * The legend in the `Recent games` header, right-aligned over the column of ratings, and the
 * same lower-case mono micro-label the seat rack carries over its own rating column
 * (`05-design.md`, "The player page", the designer's M3.5 review). The bare number under it
 * carries visually-hidden `Rating`, exactly as the board row's bare Proven does.
 */
export const RECENT_RATING_LEGEND = RATING_LABEL.toLowerCase();

/**
 * The board's own word (designer, 2026-09-09). `Leaderboard` and not `standings`: it is what
 * `docs/01-architecture.md` and the milestones have called this page since M0, it is the word
 * the group uses, and a second name for a page is exactly the drift the two number names are
 * already policed against.
 *
 * Capitalised as a label — the page heading, the back link, the `<title>` — and lower case
 * inside the embed's title, where it follows the **window's** name in a sentence-shaped line
 * (`This week · leaderboard`, M5.12), the same rule `Proven` and `Rating` follow.
 */
export const LEADERBOARD_LABEL = 'Leaderboard';

/**
 * When the marker switches off. Product's round number for M1.3's finding that a mis-seeded
 * player's sigma first falls below 5.00 somewhere between game 26 and game 36 (M3.8 brief):
 * the sentence says "about 30 games" and the chip switches off at exactly 30.
 */
export const SETTLING_GAMES = 30;

/** The chip. A word, not a warning: no colour, no dot, no emoji, no asterisk. */
export const SETTLING_CHIP = 'settling';

/**
 * The sentence, once per page under the leaderboard heading and never once per row (product,
 * **2026-09-10**, amending the 2026-09-08 wording; {@link SETTLING_SENTENCE_SHORT} was amended
 * in the same pass and for the same reason, so the page and the nightly post say one thing).
 *
 * **`/leaderboard`'s, from M3.26.** The player page prints {@link SETTLING_SENTENCE_PLAYER}
 * instead; `you` is right here, because everyone reading a board is on it.
 *
 * The 2026-09-08 wording said new players `start low on purpose and climb as they play`, which
 * is false on a season's first board, where every row is a rank seed and nobody has climbed
 * anything. It also promised a gap that closes — `stays below your rating until…` — and the gap
 * never closes: σ shrinks, it does not reach zero. This one says what Proven **is**, in the
 * reader's own terms, and what happens to the difference: it shrinks and settles.
 *
 * The number is interpolated from {@link SETTLING_GAMES} rather than typed, because the M3.8
 * acceptance check is that the number in the sentence is the threshold the marker itself uses.
 * `board/copy.test.ts` pins the assembled string against product's words.
 */
export const SETTLING_SENTENCE =
  `The board sorts on ${PROVEN_LABEL}: your rating, minus how unsure the board still is about you. That gap shrinks as you play and settles after about ${SETTLING_GAMES} games.` as const;

/**
 * The same two sentences on `/p/[puuid]`, in the **third person and with no name in them**
 * (M3.26, product 2026-09-10; the copy table in `05-design.md`).
 *
 * On Yuki's page `your rating` names the number printed twenty pixels above it, and that
 * number is Yuki's, not the reader's — the one page in the product where the board's own
 * `you` is wrong. It is not deleted instead: M5.15's explanation strip says why a *change* is
 * the size it is and names neither Proven nor Rating, so with this gone the biggest number on
 * the page and the `settling` chip beside it would have nothing anywhere saying what they are.
 *
 * **No name is interpolated.** A nameless player is `Someone` (M3.10), a name can change
 * between two page loads, and the possessive of every name in the group is not one rule.
 *
 * Same shape, same two interpolations and the same `settles`-not-`closes` rule as the board's,
 * so a reader arriving from `/leaderboard` meets the same explanation rather than a second one.
 * Neither constant may be edited into the other.
 */
export const SETTLING_SENTENCE_PLAYER =
  `The board sorts on ${PROVEN_LABEL}: a player's rating, minus how unsure the board still is about them. That gap shrinks as they play and settles after about ${SETTLING_GAMES} games.` as const;

/**
 * The short form, for the one-line Discord footer where two sentences will not fit. Amended
 * with the long one (product, 2026-09-10): **the gap settles, it never closes** — σ falls with
 * every game and does not reach zero, so neither sentence may say `until` or `catches up`.
 *
 * **Second person, and it stays** (M3.26): it is addressed to a channel where every reader is
 * a player, and it points at no number on a screen.
 */
export const SETTLING_SENTENCE_SHORT =
  `${PROVEN_LABEL} is your rating minus how unsure the board still is about you, and it settles after about ${SETTLING_GAMES} games.` as const;

/* ---------------------------------------------------------------------------
 * The week board (M7.3). `This week` and `Last week` are folded from scratch
 * every Sunday and **sort on Rating**, not on Proven, so they need their own
 * sentence — not an edit of the three above, which keep printing byte for byte
 * on `All time`, on the month windows and on `/p/[puuid]` (the M3.26 rule).
 * ------------------------------------------------------------------------- */

/**
 * The sentence under the board on a week window, once per page, where
 * {@link SETTLING_SENTENCE} prints on every other one (product, 2026-09-15).
 *
 * **No game count is interpolated, and the name carries no `SETTLING`.** M7.2 measured the
 * weekly track reaching `sigma < 5.00` at game 30 — a bar a group playing one to three games a
 * night never clears inside a week — so the week does not claim to settle at all. What it says
 * instead is what is true and measured: the Sunday restart, the column it sorts on, that the
 * numbers swing, and where the settled number lives.
 *
 * **`Every week`, not `This week`**: `Last week` prints this same string, because it is the
 * same track and the same question, and `This week` would read as a mistake under the other
 * heading.
 *
 * **It does not say "back at their rank"** (M7.21, product 2026-09-16). M7.19 (2026-09-16) took
 * the League rank out of every stored seed — `provisionalSeed()`, the same number for everybody —
 * so a week restarts everyone on one rating rather than on their own. One clause changed and
 * nothing else in the sentence did; the second person stays, because every reader of a board is
 * in the group it describes.
 */
export const WEEK_BOARD_SENTENCE =
  `Every week starts everyone on the same rating on Sunday, so a good Tuesday shows up here straight away. The board sorts on ${RATING_LABEL} — what the bot thinks you are after this week's games — and takes nothing off for playing only a few, so a clean two-game week can sit above a longer patchy one. It is a handful of games either way, so these numbers swing. All time is the settled one, and the one that makes teams.` as const;

/**
 * The same, for the embed footer where {@link SETTLING_SENTENCE_SHORT} prints on every other
 * window: the nightly post reads `this-week` and the Sunday post reads `last-week`, so both say
 * this one instead (product, 2026-09-15).
 *
 * **It does not say "back at their rank"** (M7.21, product 2026-09-16). M7.19 (2026-09-16) took
 * the League rank out of every stored seed — `provisionalSeed()`, the same number for everybody —
 * so a week restarts everyone on one rating rather than on their own. A sent embed is a record of
 * what was said and is not edited; the next post carries the new words.
 */
export const WEEK_BOARD_SENTENCE_SHORT =
  'Every week starts everyone on the same rating on Sunday, so these numbers swing, and two clean wins can top a longer patchy week. All time is the settled one, and the one that makes teams.' as const;

/**
 * The same fact on `/p/[puuid]`, on the two week windows, where
 * {@link SETTLING_SENTENCE_PLAYER} prints on the other three (product, 2026-09-16, M7.16).
 *
 * **Third person, because the page may be somebody else's.** {@link WEEK_BOARD_SENTENCE}'s `you`
 * is right on a board, where every reader is on it, and wrong twenty pixels under a number that
 * belongs to whoever's page this is — the same M3.26 rule that gave the Proven sentence its own
 * twin. It carries the board sentence's four load-bearing points and not its second clause about
 * a sort order: this page sorts nothing.
 *
 * **It does not say "back at their rank".** M7.19 (2026-09-16) took the League rank out of every
 * stored seed — `provisionalSeed()`, the same number for everybody — so a week now restarts
 * everyone on one rating rather than on their own. The brief for this task was written before
 * that landed and proposed the rank wording; it is corrected here rather than copied.
 * {@link WEEK_BOARD_SENTENCE} and {@link WEEK_BOARD_SENTENCE_SHORT} carried the retired wording
 * until M7.21 corrected them the same day, so all three now say `starts everyone on the same
 * rating`; none of them may be edited into another (the M3.26 rule), and the three still differ
 * where they must — the sort clause, and the person.
 *
 * **`Every week`, not `This week`**, for {@link WEEK_BOARD_SENTENCE}'s reason: `Last week` prints
 * the same string. No game count is interpolated and the name carries no `SETTLING` — the weekly
 * track does not claim to settle inside a week.
 */
export const WEEK_PLAYER_SENTENCE =
  "Every week starts everyone on the same rating on Sunday, so a good Tuesday shows up here straight away. This is their rating after this week's games, with nothing taken off for playing only a few. It is a handful of games either way, so these numbers swing. All time is the settled one, and the one that makes teams." as const;

/**
 * The legend over the board's one number, which is **the number the board sorted on**.
 *
 * `Proven` on `All time` and the month windows, `Rating` on a week — where the row prints the
 * weekly Rating and no Proven at all (M7.3). One helper, because the legend and the row's own
 * visually-hidden noun have to name the same number.
 */
export function boardLegend(track: RatingTrack): string {
  return track === 'weekly' ? RATING_LABEL : BOARD_LEGEND;
}

/**
 * The five windows the board is read through (M5.12, `05-design.md`'s board copy table,
 * product 2026-09-10). **The same five words are the option, the board heading and the post
 * title** — a picker that said `Week` over a heading that said `This week` would be two names
 * for one thing, which is the rule `Leaderboard` already won.
 *
 * The parameter is the `WindowKind` itself (`?window=this-week`), so the URL and the label
 * cannot drift: there is one map and it is this one.
 */
export const WINDOW_LABELS: Readonly<Record<WindowKind, string>> = {
  'this-week': 'This week',
  'last-week': 'Last week',
  'this-month': 'This month',
  'last-month': 'Last month',
  'all-time': 'All time',
};

/**
 * `Sunday 6 Sep to Saturday 12 Sep · 14 games`: the line under the picker (M5.12, the designer's
 * slot; `05-design.md`'s copy table, product 2026-09-10).
 *
 * The range half is `lib/night.ts`'s — **and the week form is M5.10's post description byte for
 * byte**, so the Sunday post and the page a tap later say the same words. The count is the
 * window's counted games and goes through {@link gamesLabel}, so a one-game week never reads
 * `1 games`.
 *
 * Sentence case here; the stylesheet upper-cases it, exactly as the tonight page's slug line is
 * a readable date in the DOM and a `SLUG` on the screen.
 *
 * **This is the *played* count's form, and `/leaderboard` no longer calls it** (M7.18): the board
 * counts the games that moved a rating and says so through {@link boardSlotLine}. The string here
 * is unchanged and belongs to `/stats`, `/fun` and `/games`, which count what the group played.
 * Neither formatter may be edited into the other.
 */
export function windowSlotLine(range: string, games: number): string {
  return `${range} · ${gamesLabel(games)}`;
}

/**
 * `Sunday 13 Sep to Saturday 19 Sep · 12 rated games`: **the board's** slot line (M7.18, product
 * 2026-09-16).
 *
 * `/leaderboard` and `/stats` print the same dates under the same picker over two different
 * counts, and since M7.1 those numbers differ by every ARAM the group played. Both are right —
 * the board is a rating board and counts the games that moved a number, `/stats` counts what was
 * played — and the bug was that neither said which. So the board's count says it, in one word,
 * and {@link windowSlotLine} is left exactly as it is for `/stats`, `/fun` and `/games`, whose
 * count is the played one.
 *
 * **A second formatter and not a flag**, because the two are not one string with a parameter:
 * they are two sentences about two universes that happen to share a shape, and the day one of
 * them moves the other must not.
 *
 * **The word is never conditional.** On a week with no ARAM in it — most weeks — the two counts
 * are equal and this still reads `rated games`: a label that appeared only when the numbers
 * differed would teach nobody anything and would read as an error on the weeks it showed up.
 *
 * An empty window prints its {@link WINDOW_EMPTY} sentence instead and never `· 0 rated games`,
 * exactly as it does today; that rule is the slot's and is not restated here.
 */
export function boardSlotLine(range: string, games: number): string {
  return `${range} · ${ratedGamesLabel(games)}`;
}

/**
 * `Since 8 Sep 2025`: `All time`'s range half, from the group's first counted game — or, on a
 * person's page, from theirs. The only window form that carries a year, because it is the only
 * one that can reach one.
 */
export function sinceLabel(day: string): string {
  return `Since ${day}`;
}

/**
 * The picker's accessible name — the noun product uses for the control in `00-product.md`
 * ("time windows the same board is read through"), because a `<nav>` landmark with five links
 * in it and no name is announced as "navigation" beside the one that says `Leaderboard`.
 *
 * It is on screen nowhere: the five options name themselves. **M5.8 owns the visible control**
 * and may give it a visible heading, in which case this string becomes that heading.
 */
export const WINDOW_PICKER_LABEL = 'Time window';

/**
 * A window with nothing in it — on the board and on a player page, the same sentence in both
 * places, exactly as the deleted `No games this season yet.` was used in both.
 *
 * **A running window says `yet`; a closed one does not**, because nothing more is coming to
 * `Last week`. Five constants and not one interpolation, so product can move any one of the
 * five without touching the other four.
 *
 * The two strings that stood here until 2026-09-10 are gone with the word they carried:
 * `NO_GAMES_YET` (`No games this season yet.`) is replaced by these five, and
 * `NO_SEASON_BOARD` (`No season is active…`) is deleted with the button it pointed at
 * (**M5.14**) — a deployment with no season row has no games either, so the empty-window line
 * is both true and enough.
 */
export const WINDOW_EMPTY: Readonly<Record<WindowKind, string>> = {
  'this-week': 'No games this week yet.',
  'last-week': 'No games last week.',
  'this-month': 'No games this month yet.',
  'last-month': 'No games last month.',
  'all-time': 'No games yet.',
};

/**
 * A game that moved nobody's rating, in the rating column of `Recent games` (M3.23, product
 * 2026-09-10).
 *
 * **One vocabulary for every reason.** A game the fold refused (too short, nine players, the
 * same player twice) and a backfilled game that `rebuild-ratings` has not folded yet both read
 * the same three syllables: the reader's question is "why did this not move my number", and
 * the answer is one sentence under the list, not five words per row.
 */
export const NOT_RATED = 'not rated';

/**
 * The sentence under the list, once per page, printed only while a row reads {@link NOT_RATED}
 * — the same placement rule as M3.10's nameless hint (product, 2026-09-10).
 *
 * **`ARAM` is the first of the four reasons** (product, 2026-09-16, M7.17). The sentence
 * enumerates, so a reason it leaves out reads as a bug rather than a rule — and since M7.1 an
 * ARAM is stored, listed and never rated, which M7.11's rebuild turned into the most common
 * reason in this group's stored history. One word added and nothing else in the sentence
 * touched: no second sentence, and no argument for *why* ARAM does not rate, which lives in
 * `00-product.md` and not in a hint line.
 */
export const NOT_RATED_HINT =
  "Some games don't move ratings: ARAM, too short, short a player, or added from match history and not counted yet.";

/** `05-design.md`, "Rating history": the chart's title, the same word as line 2 of a row. */
export const CHART_TITLE = RATING_LABEL;

/** The label on the hairline reference line, in the same units as the series. */
export const SEED_LABEL = 'seed';

/**
 * The same hairline, in a window: the rating the player carried **into** it (M5.12).
 *
 * `seed` is where the board started them — since M7.19 the same provisional number for everybody,
 * and never their rank — and it is a fact about their whole history; the line on `This week`'s
 * chart is where Sunday found them, which is not a seed and may not borrow the word. `All time`
 * keeps {@link SEED_LABEL}, unchanged.
 */
export const START_LABEL = 'start';

/** The player page's two sections under the chart. Plain nouns; the content is the vocabulary. */
export const ROLE_RECORD_HEADING = 'By role';
export const RECENT_GAMES_HEADING = 'Recent games';

/**
 * A recent game's result on `/p/[puuid]`: **this player's own**, not the winning side's
 * (product, 2026-09-09).
 *
 * The page is about them, and `Red wins` beside their own delta would make a reader work out
 * which side they were on before they could read their own row. Past tense rather than the
 * `13W 15L` letters, because the line is one game that happened and not a tally.
 *
 * They lived in `app/_board/PlayerView.tsx` until M3.19; the copy table in `05-design.md` has
 * one code half, and this is it.
 */
export const WON = 'Won';
export const LOST = 'Lost';

/**
 * The tonight page's rail card at ≥1080px (`05-design.md`, "Breakpoints and the desktop grid").
 * The board's first five rows, under the doc's own name for them — not a fourth word for the
 * destination the nav tab, the heading and the embed all call `Leaderboard`, because this card
 * is a slice of that page and not a second one.
 */
export const TOP_OF_BOARD_TITLE = 'Top of the board';

/** `1 game`, `28 games`. A count of one never prints as `1 games` on the newest player's row. */
export function gamesLabel(games: number): string {
  return games === 1 ? '1 game' : `${games} games`;
}

/**
 * `1 rated game`, `12 rated games`: the same count, named (M7.18).
 *
 * The one word that says this number counted the games that **moved a rating** — the board's
 * universe, `gateRatedGame`'s — rather than the games the group played, which is what every
 * `gamesLabel` on `/stats`, `/fun` and `/games` counts. Same singular rule, because a one-game
 * week reads `1 rated game` on both pages or on neither.
 *
 * It is deliberately **not** built as `` `rated ${gamesLabel(games)}` ``: that reads `rated 1
 * game` at one, and the adjective belongs to the noun and not to the count.
 */
export function ratedGamesLabel(games: number): string {
  return games === 1 ? '1 rated game' : `${games} rated games`;
}

/**
 * The one sentence on `/p/[puuid]` that says which count is which, where the stats sections
 * begin (M7.18, product 2026-09-16).
 *
 * The header's record is folded over the games that moved a rating and every section under it —
 * `By role`, the sides, the partners, the streaks, the mean game — is folded over every game the
 * player played, ARAM included. Both are right, they are forty pixels apart, and until this
 * sentence nothing on the page said so.
 *
 * **Second person, and one sentence.** The page is about a person and the reader is usually
 * looking at their own, which is the one case M3.26's third-person rule does not cover: `you` here
 * names the reader's games, not a number twenty pixels above. If it ever needs a third-person twin
 * for somebody else's page, product writes it — this file does not grow one on its own.
 *
 * **Not conditional on a player having played an ARAM.** Somebody with none reads it and finds it
 * true and dull, which is the correct outcome: a sentence that appeared only on the pages where
 * the numbers differ would read as a warning about that person.
 *
 * The streak sits under it and is untouched (M5.21): one computation, mixed, the same fact on the
 * board, on `/stats` and here — and covered by the second half of this sentence.
 */
export const PLAYER_COUNTS_SENTENCE =
  'The record above counts games that moved a rating; everything below counts every game you played, ARAM included.';

/** `13W 15L`, the same shape on a row, on the player page and in a role record. */
export function winLossLabel(wins: number, losses: number): string {
  return `${wins}W ${losses}L`;
}

/* ---------------------------------------------------------------------------
 * "How you got here" (M5.15): the seed line above the chart, the per-game
 * sentence on every row of `Recent games`, and the one line under the list.
 *
 * Product's words, from `05-design.md`'s copy table (2026-09-10). Every number
 * inside them is `lib/ratingDisplay.ts`'s — the sentences below take the
 * already-formatted string and never round anything themselves.
 * ------------------------------------------------------------------------- */

/** No rank in `players.rank_tier`: the client never reported one, said in one word. */
export const UNRANKED_LABEL = 'Unranked';

/**
 * The rank the seed came from, as words: `Gold II`, `Master`, `Unranked`.
 *
 * The client sends the tier upper case (`GOLD`) and the division as a Roman numeral, and this
 * formats exactly the pair stored beside the seed — `ratings.seed_rank_tier` /
 * `seed_rank_division` — so the words always name the rank the client reported when that
 * player's history began.
 *
 * **They no longer name where the number came from, and no page prints them** (2026-09-16).
 * Every seed written from that date is `provisionalSeed()`, 1200, whatever rank rode along with
 * it, so M7.19 dropped the rank from {@link seededLine} rather than re-phrase it. This function
 * survives the re-word with its job unchanged — say what the client said, in words — but its only
 * remaining callers are `lib/board/load.ts` and its own tests; whether it and
 * `PlayerBoardView.seedRank` stay at all is M7.20's question.
 *
 * `seedFromRank` is still the test for "is this a rank at all", which is the one thing that has
 * not moved: a tier core does not recognise seeds as unranked, and is named that way here too,
 * as is a client that reported none. Master and above have no division
 * (`config.rating.tiersWithoutDivisions`).
 */
export function rankLabel(tier: string | null, division: string | null): string {
  const key = (tier ?? '').trim().toUpperCase();
  // Exactly core's own test for "I do not know this tier": a string core cannot place comes back
  // at the unranked pair, and printing `Golden III` for it would invent a rank the client never
  // reported. This is a lookup on the *label*, not on the seed's number, which since 2026-09-16
  // does not come from here at all.
  const seeded = seedFromRank(key, division);
  const unranked = seedFromRank(null, null);
  if (seeded.mu === unranked.mu && seeded.sigma === unranked.sigma) return UNRANKED_LABEL;

  const titled = `${key.charAt(0)}${key.slice(1).toLowerCase()}`;
  const numeral = (division ?? '').trim().toUpperCase();
  const withoutDivisions: readonly string[] = config.rating.tiersWithoutDivisions;
  return withoutDivisions.includes(key) || numeral.length === 0 ? titled : `${titled} ${numeral}`;
}

/**
 * `Started at 1200, 37 games since.` — once, above the chart (M5.15; re-worded by M7.19).
 *
 * The number is the **same value the chart's reference line draws**, passed in by the caller,
 * so the line and the sentence cannot disagree; the count is `ratings.games`.
 *
 * **No rank, and not a softened one** (product, 2026-09-16). Since M7.19 every rating starts at
 * `provisionalSeed()` — the same number for everybody — so a tier named on the one line that
 * explains where a rating came from would be read as the reason for it whatever the preposition
 * did. The clause is dropped, not reworded, and `All time` now rhymes with the windows under it:
 * `Started at …` / `Started the week at …`.
 *
 * **At zero games the trailing clause is dropped**: `Started at 1200.` A brand-new player's
 * line would otherwise end `, 0 games since.`, and M5.15's acceptance says their page shows the
 * seed line and never a `0` (`04-decisions.md`, 2026-09-10).
 */
export function seededLine(rating: number, games: number): string {
  return `Started at ${rating}${sinceClause(games)}`;
}

/**
 * The same line in a window: `Started the week at 1469, 6 games since.` The rating is the one
 * the player carried **into** the window — the chart's `start` hairline — and the count is the
 * window's counted games.
 *
 * Product wrote the week form; the month windows say `the month` by the same shape, because
 * `Started the week` on `Last month` would name the wrong calendar (`04-decisions.md`).
 */
export function startedLine(window: WindowKind, rating: number, games: number): string {
  const period = window === 'this-month' || window === 'last-month' ? 'month' : 'week';
  return `Started the ${period} at ${rating}${sinceClause(games)}`;
}

/** `, 37 games since.` — or nothing at all when there are none to count. */
function sinceClause(games: number): string {
  return games === 0 ? '.' : `, ${gamesLabel(games)} since.`;
}

/**
 * Why a rating change is the size it is, on one row of `Recent games`: `As the 58% side.`
 * (product and the designer, 2026-09-10).
 *
 * **The clause and nothing else.** The row's own head already prints `Won`, the date, the
 * duration and `1392 (−42)`; a caption under it that said `Lost as the 58% side, −42` would say
 * the result twice and the change twice, which is three of the four words on the line repeated
 * in grey. What the head cannot say is the one thing this task is for: what the balancer
 * thought the odds were.
 *
 * The percentage is the chance the balancer gave **their** side. A game with no stored chance
 * has no caption at all — no `Won, +43` form — and neither has an unrated row, which M3.23
 * answers whole in three words.
 */
export function gameExplanation(chance: number): string {
  return `As the ${chance}% side.`;
}

/**
 * The point of the whole task, under the list and **once per page** — not per row. No maths, no
 * formula, no link to a paper (product, 2026-09-10).
 */
export const RATING_EXPLANATION =
  'Beating the favoured side moves you more than beating the underdog, and the board moves you more while it is still unsure about you.';

/* ---------------------------------------------------------------------------
 * The MVP and the ACE (M7.10). The bonus itself is M7.9's and lives in the
 * fold; these are the only words any page says about it.
 * ------------------------------------------------------------------------- */

/**
 * The word beside the delta on a `Recent games` row, for the best player on the **winning**
 * side of that game (product, 2026-09-15).
 *
 * **The word, and nothing around it**: no badge, no icon, no trophy, no colour of its own and
 * no "#1" (acceptance 6). op.gg's two words for op.gg's idea, upper case because that is how
 * they are said — the scorer behind them is ours and is never printed.
 */
export const MVP_LABEL = 'MVP';

/** The same word for the best player on the **losing** side. */
export const ACE_LABEL = 'ACE';

/**
 * The second half of the explanation under `Recent games` (M7.10), directly after
 * {@link RATING_EXPLANATION} and in the same strip.
 *
 * **It is about the model, not about a game.** It prints on every player's page whether or not
 * they have ever been either one, for the same reason M5.15's sentence prints once per page and
 * not once per row: the reader's question is "why is this number the size it is", and the answer
 * does not change because tonight went badly. No maths, no percentage, no formula, and neither
 * word is capitalised into the page — this sentence names the *positions*, and
 * {@link MVP_LABEL} and {@link ACE_LABEL} name the players.
 */
export const MVP_EXPLANATION =
  'The best player on the winning side keeps a little more of what they gained, and the best player on the losing side gives a little less back.';
