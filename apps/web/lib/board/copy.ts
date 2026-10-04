import { SETTLING_GAMES } from '@customs/core';
import type { WindowKind } from '../night';

/**
 * Every friend-facing word on the board and the player page (M3.5; one Rating since M14.15,
 * STRATEGY §5). Proven is gone from every surface, and so is the 30-game threshold: the settling
 * count is core's `SETTLING_GAMES` (10), never a literal here.
 */

/** The one public number (STRATEGY §5). */
export const RATING_LABEL = 'Rating';

/**
 * The board's one word (M14.72, flow audit): the tab, the h1 and the page title all say `Board`.
 * Short enough that the h1 needs no soft hyphen at 200% text.
 */
export const BOARD_LABEL = 'Board';

/** The ranked section's heading (visually hidden: the numbers say it). [NEW COPY] */
export const RANKED_SECTION_TITLE = 'Ranked';

/** The settling section's heading (STRATEGY §5). */
export const SETTLING_SECTION_TITLE = 'Still settling';

/** The settling section's line (STRATEGY §5), the same words the Discord board post prints. */
export const SETTLING_SECTION_LINE =
  `New players' ratings move fast at first. They get a rank after ${SETTLING_GAMES} games.` as const;

/** The settling chip (05-design 5.6): `settling · 4/10`. */
export function settlingChip(ratedGames: number): string {
  return settlingChipParts(ratedGames)
    .map((part) => ('num' in part ? part.num : part.word))
    .join('');
}

/**
 * {@link settlingChip} split per token (05-design 5.16 ruling (e)): the words in the text face, the
 * count in mono. The share card sets them apart; every other surface joins them.
 */
export function settlingChipParts(ratedGames: number): readonly ({ word: string } | { num: string })[] {
  return [{ word: 'settling · ' }, { num: `${ratedGames}/${SETTLING_GAMES}` }];
}

/** The board with no rated game at all (STRATEGY §6(b)). */
export const BOARD_EMPTY =
  "No rated games yet. The board fills in after your first Summoner's Rift game." as const;

/** An empty window's way to the board that has games (05-design 5.7's example). */
export const SEE_ALL_TIME = 'See all time';

/** M14.70: an empty `This week` points to last week first, when last week had a game. */
export const SEE_LAST_WEEK = 'See last week';

/** The empty window's button, by where it points (M14.70). */
export const SEE_FALLBACK: Readonly<Record<'last-week' | 'all-time', string>> = {
  'last-week': SEE_LAST_WEEK,
  'all-time': SEE_ALL_TIME,
};

/**
 * Under the board: the group's people who are not on it (STRATEGY §5). All time and the running
 * windows say `yet`; a closed window names itself. [NEW COPY for the window variants]
 */
export function notPlayedLine(count: number, window: WindowKind): string {
  const people = count === 1 ? "1 person who hasn't" : `${count} people who haven't`;
  return `+ ${people} played a rated game ${NOT_PLAYED_WHEN[window]}.`;
}

const NOT_PLAYED_WHEN: Readonly<Record<WindowKind, string>> = {
  'all-time': 'yet',
  'this-week': 'this week yet',
  'last-week': 'last week',
};

/** The sort select (STRATEGY §6(b)). [NEW COPY] */
export const SORT_LABEL = 'Sort by';
export const SORT_SUBMIT = 'Sort';
export const SORT_OPTION_LABELS = { rating: 'Rating', games: 'Games', winrate: 'Win rate' } as const;

/**
 * The sort select's option words per window (M14.57): a week board is ranked by net points, so
 * its default option (`?sort=rating`, the board's own order) reads `Points`, never `Rating`.
 * The URL value stays `rating` on every window, so old links keep working. [NEW COPY: `Points`]
 */
export function sortOptionLabel(sort: keyof typeof SORT_OPTION_LABELS, window: WindowKind): string {
  if (sort === 'rating' && window !== 'all-time') return 'Points';
  return SORT_OPTION_LABELS[sort];
}

/** Pagination over 100 rows (STRATEGY §6(b)). [NEW COPY] */
export const PREVIOUS_PAGE = 'Previous 100';
export const NEXT_PAGE = 'Next 100';
export function pageLine(page: number, pages: number): string {
  return `Page ${page} of ${pages}`;
}
export const PAGINATION_LABEL = 'Board pages';

/** A change's screen-reader words (05-design 5.3). */
export function changeWords(delta: number): string {
  if (Object.is(delta, -0) || delta < 0) return `lost ${Math.abs(delta)}`;
  return delta === 0 ? 'no change' : `gained ${delta}`;
}

/**
 * The week windows' note (M7.3; M14.57; rewritten for the Kustom weekly track by M18.7 from
 * 05-design 11.4): everyone starts the week at 0, the week counts only its own games, and All time
 * is the one that makes teams. Also the Discord Sunday post's footer (11.8), so the page and the
 * post say the same sentence. Product's final words (M18.9).
 */
export const WEEK_BOARD_SENTENCE_SHORT =
  "Everyone starts each week at zero and only that week's games count, so one good night can top it. All time is the Rating that makes teams." as const;

/**
 * The player page's week note under the chart (M7.16; M14.57; M18.7 from 05-design 11.5); `your`
 * on the self lens. Product's final words (M18.9).
 */
export function weekPlayerSentence(whose: 'their' | 'your'): string {
  return `Everyone starts each week at zero and only that week's games count. Rating is ${whose} all-time number, the one that makes teams.`;
}
export const WEEK_PLAYER_SENTENCE = weekPlayerSentence('their');

/**
 * The week boards' column label over the sorted number (M14.57, product's [NEW COPY]):
 * `Points this week` / `Points last week`. All time has none (its number is the Rating).
 */
export const POINTS_COLUMN_LABEL: Readonly<Record<Exclude<WindowKind, 'all-time'>, string>> = {
  'this-week': 'Points this week',
  'last-week': 'Points last week',
};

/**
 * The player page's week words after the signed net points (M14.57): `+86 this week · 5W 2L`.
 * Product wrote `5W–2L`; the web keeps its one record shape (`winLossLabel`, `13W 15L`).
 */
export const WEEK_POINTS_WORDS: Readonly<Record<Exclude<WindowKind, 'all-time'>, string>> = {
  'this-week': 'this week',
  'last-week': 'last week',
};

/**
 * Week points as a screen reader hears them (05-design 11.4): `58 points this week`, `minus 33
 * points last week`, `0 points this week`. The visible number is `aria-hidden`.
 */
export function weekPointsWords(points: number, window: Exclude<WindowKind, 'all-time'>): string {
  const size = Math.abs(points);
  const sign = points < 0 ? 'minus ' : '';
  return `${sign}${size} ${size === 1 ? 'point' : 'points'} ${WEEK_POINTS_WORDS[window]}`;
}

/**
 * A week row's change as a screen reader hears it (05-design 11.5, 11.6.5): `gained 19 this week`;
 * the Why button adds `. Why?` after it.
 */
export function weekChangeWords(delta: number, window: Exclude<WindowKind, 'all-time'>): string {
  return `${changeWords(delta)} ${WEEK_POINTS_WORDS[window]}`;
}

/**
 * The closing row of a week's game list (05-design 11.5): the sum of the column, which equals the
 * header. Not a link, not a button. [DRAFT COPY, 05-design 11.5]
 */
export const WEEK_TOTAL_LABEL = 'Week total';

/**
 * The week tab's game list column label, over the change column (05-design 11.5): the window's own
 * word, `This week` / `Last week`.
 */
export const WEEK_CHANGE_COLUMN_LABEL: Readonly<Record<Exclude<WindowKind, 'all-time'>, string>> = {
  'this-week': 'This week',
  'last-week': 'Last week',
};

/** The player page with no rated game in the group (the new-player state). [NEW COPY] */
export function noGamesYetLine(groupName: string): string {
  return `No games with ${groupName} yet. Their first one shows up here.`;
}

/** The player page's games list heading and its way to the rest. [NEW COPY: the links] */
export const RECENT_GAMES_HEADING = 'Recent games';
export const ALL_THEIR_GAMES = 'All their games';
export const ALL_YOUR_GAMES = 'All your games';

/** The trend chart's accessible summary (`role="img"`). [NEW COPY] */
export function trendSummary(from: number, to: number, games: number): string {
  return `Rating went from ${from} to ${to} over ${ratedGamesLabel(games)}.`;
}

/**
 * The week chart's accessible summary (05-design 11.2: week points from 0): `Points this week went
 * from 0 to +36 over 7 rated games.` [NEW COPY, M18.7]
 */
export function weekTrendSummary(to: number, games: number, window: Exclude<WindowKind, 'all-time'>): string {
  const signedTo = to === 0 ? '0' : to > 0 ? `+${to}` : `minus ${Math.abs(to)}`;
  return `${POINTS_COLUMN_LABEL[window]} went from 0 to ${signedTo} over ${ratedGamesLabel(games)}.`;
}

/** The self lens's Rating tile label: `Rating, #3`, or `Rating` while settling. */
export function ratingTileLabel(rank: number | null): string {
  return rank === null ? RATING_LABEL : `${RATING_LABEL}, #${rank}`;
}

/** The self lens with no game in the group yet (STRATEGY §2.4's line, M14.33 adds `That's you.`). */
export const NO_GAMES_YET_SELF = 'No games with this group yet. Your first one shows up here.';

/**
 * The three windows the board is read through (M5.12, `05-design.md`'s board copy table,
 * product 2026-09-10). **The same three words are the option, the board heading and the post
 * title** — a picker that said `Week` over a heading that said `This week` would be two names
 * for one thing, which is the rule `Leaderboard` already won.
 *
 * The parameter is the `WindowKind` itself (`?window=this-week`), so the URL and the label
 * cannot drift: there is one map and it is this one.
 */
export const WINDOW_LABELS: Readonly<Record<WindowKind, string>> = {
  'this-week': 'This week',
  'last-week': 'Last week',
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
 * `Since 1 Nov`: the reset's own words (STRATEGY 3.6), and **only** a reset's (M14.42, scene-walk
 * gap 13): `All time`'s chip once the group has reset its ratings. A group that never reset says
 * {@link firstGameLabel} instead, so `Since` never reads like a reset that didn't happen.
 */
export function sinceLabel(day: string): string {
  return `Since ${day}`;
}

/**
 * `first game 8 Sep 2025`: `All time`'s range half, from the group's first counted game, or on a
 * person's page from theirs (M14.42; was `Since <date>`, which read like a reset). It follows
 * `All time · ` on the board and the player page. The only window form that carries a year,
 * because it is the only one that can reach one. [NEW COPY]
 */
export function firstGameLabel(day: string): string {
  return `first game ${day}`;
}

/**
 * A window's chip and heading word (M14.18, STRATEGY 3.6): {@link WINDOW_LABELS}, except that once
 * the group has reset its ratings `All time` reads `Since <reset day>` (`Since 1 Nov`), because the
 * all-time numbers only go back that far. `resetDay` is formatted on the server (`formatDayMonth`).
 */
export function windowLabel(kind: WindowKind, resetDay: string | null): string {
  return kind === 'all-time' && resetDay !== null ? sinceLabel(resetDay) : WINDOW_LABELS[kind];
}

/**
 * The picker's accessible name — the noun product uses for the control in `00-product.md`
 * ("time windows the same board is read through"), because a `<nav>` landmark with three links
 * in it and no name is announced as "navigation" beside the one that says `Leaderboard`.
 *
 * It is on screen nowhere: the three options name themselves. **M5.8 owns the visible control**
 * and may give it a visible heading, in which case this string becomes that heading.
 */
export const WINDOW_PICKER_LABEL = 'Time window';

/**
 * A window with nothing in it — on the board and on a player page, the same sentence in both
 * places.
 *
 * **A running window says `yet`; a closed one does not**, because nothing more is coming to
 * `Last week`. Three constants and not one interpolation, so product can move any one of the
 * three without touching the other two.
 */
export const WINDOW_EMPTY: Readonly<Record<WindowKind, string>> = {
  'this-week': 'No games this week yet.',
  'last-week': 'No games last week.',
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

/**
 * The chart's reference line labels (05-design 11.2, M18.7): `Start 1200` on `All time`, the 1200
 * every Rating starts at; `Week start` on a week, whose series is week points from 0, so that label
 * carries no number. [DRAFT COPY, 05-design 11.2]
 */
export const SEED_LABEL = 'Start';
export const START_LABEL = 'Week start';

/** The reference line's whole label: `Start 1200` on `All time`, `Week start` on a week. */
export function chartReferenceLabel(track: 'all-time' | 'week', reference: number): string {
  return track === 'all-time' ? `${SEED_LABEL} ${reference}` : START_LABEL;
}

/** The player page's two sections under the chart. Plain nouns; the content is the vocabulary. */
export const ROLE_RECORD_HEADING = 'By role';

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
 *
 * Two surfaces go through it and they cannot drift: `boardSlotLine` (the `/leaderboard` slot and
 * both board posts) and {@link sinceClause} (the seed line on `/p/[puuid]`, M7.22).
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

/** One token of a record: a number (set in mono) or a letter (set in the text face). */
export type WinLossPart = { num: string } | { word: string };

/**
 * {@link winLossLabel} split per token, for a surface that sets each in its own face and cannot
 * use a `.num` span (the share card, 05-design.md 5.16 ruling (a)). The same four tokens, in order.
 */
export function winLossParts(wins: number, losses: number): readonly WinLossPart[] {
  return [{ num: String(wins) }, { word: 'W' }, { num: String(losses) }, { word: 'L' }];
}

/* ---------------------------------------------------------------------------
 * "How you got here" (M5.15): the seed line above the chart, the per-game
 * sentence on every row of `Recent games`, and the one line under the list.
 *
 * Product's words, from `05-design.md`'s copy table (2026-09-10). Every number
 * inside them is `lib/ratingDisplay.ts`'s — the sentences below take the
 * already-formatted string and never round anything themselves.
 * ------------------------------------------------------------------------- */

/*
 * **No rank formatter lives here any more** (M7.20, 2026-09-16). `UNRANKED_LABEL` and
 * `rankLabel(tier, division)` — `Gold II`, `Master`, `Unranked` — formatted the pair stored beside
 * a seed for M5.15's `Seeded from Gold II at 1469.`; M7.19 took the rank off that sentence, which
 * left the function with no caller but the loader line that built `PlayerBoardView.seedRank`, and
 * that field had no reader either. Both are deleted rather than kept with a note: the words were
 * only ever a display of the seed's *reason*, and since 2026-09-16 a seed has no reason to show —
 * every one of them is `provisionalSeed()`.
 *
 * `ratings.seed_rank_tier` / `seed_rank_division` are untouched and still written on every new
 * seed (`lib/ingest/seed.ts`): they are the record of what the client reported the night a history
 * began, and nothing on a screen was ever their justification. A page that wants those words again
 * writes the formatter it needs then, against whatever the sentence of the day is.
 */

/**
 * `Started at 1200, 37 rated games since.` — once, above the chart (M5.15; re-worded by M7.19 and
 * again by M7.22).
 *
 * The number is the **same value the chart's reference line draws**, passed in by the caller,
 * so the line and the sentence cannot disagree; the count is `ratings.games`, and since M7.22 the
 * clause says so in a word — see {@link sinceClause}.
 *
 * **No rank, and not a softened one** (product, 2026-09-16). Since M7.19 every rating starts at
 * `provisionalSeed()` — the same number for everybody — so a tier named on the one line that
 * explains where a rating came from would be read as the reason for it whatever the preposition
 * did. The clause is dropped, not reworded, and `All time` now rhymes with the windows under it:
 * `Started at …` / `Started the week at …`.
 *
 * **At zero games the trailing clause is dropped**: `Started at 1200.` A brand-new player's
 * line would otherwise end `, 0 rated games since.`, and M5.15's acceptance says their page shows
 * the seed line and never a `0` (`04-decisions.md`, 2026-09-10).
 */
export function seededLine(rating: number, games: number): string {
  return `Started at ${rating}${sinceClause(games)}`;
}

/**
 * The same line in a window: `Started the week at 1469, 6 rated games since.` The rating is the one
 * the player carried **into** the window — the chart's `start` hairline — and the count is the
 * window's counted games.
 *
 * Product wrote the week form, and since M14.48 dropped the month windows every window this is
 * printed on is a week.
 */
export function startedLine(rating: number, games: number): string {
  return `Started the week at ${rating}${sinceClause(games)}`;
}

/**
 * `, 37 rated games since.` — or nothing at all when there are none to count.
 *
 * **The clause names its own universe** (M7.22, product 2026-09-16). It goes through
 * {@link ratedGamesLabel} and not {@link gamesLabel}, because the count both callers pass is
 * `player.games` — the rated count on every one of the three windows, checked in `lib/board/load.ts`
 * rather than assumed — and it prints forty pixels above `By role`, the streaks and the partners,
 * all of which count every game played, ARAM included. Unlabelled, it was the one number on
 * `/p/[puuid]` a reader could take for the other universe, which is the half of M7.18's acceptance
 * 3 that did not land with it.
 *
 * **This is private to the seed line.** Its only callers are {@link seededLine} and
 * {@link startedLine}, so no played-count context shares the wording and no second formatter is
 * needed. `gamesLabel` is deliberately left alone: `windowSlotLine` still calls it for `/stats`,
 * `/fun` and `/games`, which count played games and are pinned byte for byte.
 *
 * **The zero arm is unchanged**: at no games the clause is dropped whole rather than worded, so a
 * brand-new player still reads `Started at 1200.` and never `0 rated games` (M5.15's acceptance 5).
 */
function sinceClause(games: number): string {
  return games === 0 ? '.' : `, ${ratedGamesLabel(games)} since.`;
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
 * formula, no link to a paper (product, 2026-09-10). M18.9 swapped the sigma
 * clause for the first-ten one.
 */
export const RATING_EXPLANATION =
  `Beating the favourite moves your Rating more than beating the underdog, and your first ${SETTLING_GAMES} games count extra.` as const;

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
  'On each team, the better your game, the more of a win you keep and the less of a loss you give back. The best on the winning side is the MVP; the best on the losing side is the ACE.';

/**
 * The welcome card on `/g/<slug>/you?welcome=1` (M14.33), right after a self-link. The numbers are
 * the self lens's own (`PlayerBoardView`), never a second read. [NEW COPY]
 */
export function welcomeLine(games: number, wins: number, rating: number): string {
  return `That's you. ${gamesLabel(games)}, ${wins === 1 ? '1 win' : `${wins} wins`}, ${RATING_LABEL} ${rating}.`;
}

/** The welcome card for a linked player with no game in the group yet (M14.33). [NEW COPY] */
export const WELCOME_NO_GAMES = `That's you. ${NO_GAMES_YET_SELF}` as const;
