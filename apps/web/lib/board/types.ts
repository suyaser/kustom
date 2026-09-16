import type { RoleValue, SideValue } from '@customs/db';
import type { WindowKind } from '../night';
import type { PlayerName } from '../tonight/types';
import type { Streak } from './streak';

/**
 * What `/leaderboard` and `/p/[puuid]` know (M3.5). Loaded on the server with the anon key and
 * rendered there; neither page has a client component.
 *
 * **`BoardRow` does cross the wire** (M3.19): the tonight page's rail renders the board's first
 * five through `TonightLive`, which is a client component, so those rows are serialized into the
 * RSC payload. Everything on the row is a string, a number, a boolean or `null` — including
 * `sortKey`, which is serialized and simply never rendered — so there is nothing here that a
 * `JSON.stringify` would change.
 *
 * **Numbers are display numbers, deltas are not.** `proven` and `rating` are what the shared
 * helpers in `lib/ratingDisplay.ts` computed, because the board must print the same integers
 * the embeds print. A rating *change* is carried as the two mu values it comes from and turned
 * into a delta where it is rendered: `-0` is a real value and does not survive a
 * `JSON.stringify` — which, now that these rows do make one, is a rule with teeth rather than a
 * precaution (`05-design.md`, "Rating delta").
 *
 * **`breakdown` is empty on the rail** (M5.30). `/leaderboard` asks the loader for the window's
 * rated games so a row can open; the tonight rail does not, so those five rows stay the same
 * size they were and never grow a `<details>`.
 */

/**
 * Which rating track a row's numbers were read from (M7.3).
 *
 * - `all-time` — the stored fold: `ratings` on `All time`, and the `mu_after` of the last
 *   counted game in the window on `This month` and `Last month`. Sorted and printed on Proven,
 *   exactly as every board has been since M3.5.
 * - `weekly` — the week folded from scratch from the player's seed with `rateGameWeekly`
 *   (M7.2), on `This week` and `Last week` only. Sorted and printed on **Rating**.
 *
 * **One row never mixes tracks.** `rating`, `sortKey`, `proven` and `climb` all come from the
 * one this field names, and the renderer reads it to decide which number is the row's primary —
 * which is why it travels on the row rather than being inferred from a window the tonight
 * rail's rows do not carry.
 */
export type RatingTrack = 'all-time' | 'weekly';

/** One row of the board. `05-design.md`, "Leaderboard row", is the layout for exactly this. */
export interface BoardRow {
  puuid: string;
  /** `null` for a player the database has no name for yet: rendered `Someone` (M3.10). */
  name: PlayerName;
  /** Which fold the four numbers below came from (M7.3). All four, or none: never a mix. */
  track: RatingTrack;
  /**
   * `round(ordinal * 60)`, floored at zero. The primary number a reader sees — **except on a
   * week row**, where the primary number is {@link BoardRow.rating} and this one is printed
   * nowhere at all (M7.3): a week is a handful of games by design, so `- 2σ` is enormous for
   * every row and largest for whoever played fewest. It is still computed, off the weekly
   * track, so the row keeps one shape on every window.
   */
  proven: number;
  /**
   * The raw number this row is ordered by. **Never printed.**
   *
   * The `ordinal` (`mu - 2σ`) on an `all-time` row, and the weekly `mu` itself on a `weekly`
   * one — in both cases the unrounded form of the number the row prints, which is what keeps
   * the printed column non-increasing as you read down it.
   *
   * `proven` is floored at zero, so everybody the board has not seen play yet displays `0`;
   * ordering on the displayed number would drop those rows onto the name tie-break and shuffle
   * them. The floor is monotonic, so ordering on this keeps the displayed column
   * non-increasing anyway.
   */
  sortKey: number;
  /**
   * `round(mu * 60)`. The number the embeds print beside a name, and **the row's one number on
   * a week window**, where it is the weekly track's `mu`.
   */
  rating: number;
  /**
   * The **window's** counted games (M5.12), which on `All time` is the fold's own total and
   * therefore `ratings.games` to the number. One field and not two: a row that carried both
   * would print two game counts on one line, and the reader would have to be told which.
   */
  games: number;
  wins: number;
  losses: number;
  /**
   * The run at the front of their history. **`All time` only**: in a window the row's line 2
   * is the window line (`6 games · 4W 2L · +58`), which product fixed and which has no streak
   * in it. `null` also for a player with no rated games at all.
   */
  streak: Streak | null;
  /**
   * What the window did to their rating: the two mu values it is computed from, never a
   * formatted delta (`-0` does not survive the `JSON.stringify` the rail's rows make). `null`
   * on `All time`, where the row is exactly today's row and gains nothing.
   *
   * On a `weekly` row it is the weekly seed to the weekly number at the end of the window —
   * the same track as the rest of the row, so `6 games · 4W 2L · +58` adds up against the
   * number printed beside it.
   */
  climb: Climb | null;
  /**
   * Fewer than 30 recorded games (M3.8) — **always the all-time count**, in every window. The
   * chip is a fact about the rating, not about the window: a player with one game this week
   * and two hundred behind them has not become unsettled by the calendar.
   *
   * **Always `false` on a `weekly` row** (M7.3): on a week that is every row, every week, and a
   * marker on all ten rows marks nothing. `SETTLING_GAMES` and the chip are untouched on
   * `All time` and the month windows.
   */
  settling: boolean;
  /**
   * The window's rated games, newest first, for the row's expand (M5.30). Empty when the
   * loader was not asked for them (the rail) and when the player has none (a seed on
   * `All time`). Rated only: an unrated row does not move the number the expand is explaining.
   */
  breakdown: readonly BoardGame[];
  /**
   * The titles of the awards this player won in the window (M8.3), in the awards' own order:
   * `Most improved`, `Best off-role`, `Cursed duo`. The strings are `lib/stats/copy.ts`'s, as
   * `awardsView` labelled the blocks — the row prints them and formats nothing.
   *
   * **Empty on every window but `Last week` and `Last month`**, which are the only two that hand
   * anything out (M5.4), empty when nobody cleared a minimum, and empty on the tonight rail,
   * which asks the loader for a snapshot of tonight rather than a window's story.
   */
  awards: readonly string[];
}

/** One rated game on a board row, slim enough to sit under every name on `/leaderboard`. */
export interface BoardGame {
  gameId: string;
  /** `9 Sep`, formatted on the server in the group's zone. */
  startedLabel: string;
  durationS: number;
  won: boolean;
  side: SideValue;
  /** The two mu values the delta is computed from, at render. Never a formatted delta. */
  muBefore: number;
  muAfter: number;
}

/** `mu_before` of the first counted game in the window and `mu_after` of the last. */
export interface Climb {
  muBefore: number;
  muAfter: number;
}

export interface BoardView {
  /** Which of the five this board was read through. The page's heading is its name. */
  window: WindowKind;
  /** Ordered by `proven` descending. Reading the primary column top to bottom never goes up. */
  rows: BoardRow[];
  /**
   * The header slot's **range half**, formatted on the server: `Sunday 6 Sep to Saturday 12 Sep`,
   * `September`, `Since 8 Sep 2025` (M5.12, the designer's slot).
   *
   * `null` when the window has no counted games, where the slot prints the window's empty
   * sentence instead — never both, and never `· 0 games`.
   */
  range: string | null;
  /** The window's counted games, for the other half of the slot. `0` on an empty window. */
  games: number;
}

/** One of the player's own five in a recent game, in lane order. */
export interface RecentTeammate {
  puuid: string;
  name: PlayerName;
  role: RoleValue | null;
}

/**
 * What this player was in one game, when they were one of the two (M7.10).
 *
 * `mvp` is the highest-scoring player on the side that won, `ace` the highest-scoring player on
 * the side that lost — op.gg's two words, because they are the two words this group already
 * uses. There is no third value and no rank: the other eight carry `null`, and no page prints
 * "you were nearly MVP".
 */
export type RecentAward = 'mvp' | 'ace';

export interface RecentGame {
  gameId: string;
  /** ISO 8601. The list is newest first; nothing on the page draws a date axis. */
  startedAt: string;
  durationS: number;
  won: boolean;
  side: SideValue;
  /** The player's own role in this game, from the scoreboard. */
  role: RoleValue | null;
  /** The two mu values the delta is computed from, at render. Never a formatted delta. */
  muBefore: number | null;
  muAfter: number | null;
  /**
   * `mvp`, `ace`, or `null` — **this player's** place in this game's award (M7.10), beside the
   * delta it explains: M7.9 gives the MVP a quarter more of what they gained and gives the ACE
   * a fifth of their loss back, and until this field nothing on the page said which two `+43`s
   * were not the same `+43`.
   *
   * The loader reads it from `gatedGameAward` — the one function that names an MVP in this app,
   * the one the fold itself applied and the one the Discord result post prints — so the word
   * here and the name there are one answer about one game.
   *
   * `null` is every ordinary row and also every game that has no award: a remake, an ARAM, a
   * game stored before the stat columns existed, a game one of whose ten has no role. A row
   * with no word is the normal case and says nothing at all about the player.
   */
  award: RecentAward | null;
  /**
   * The chance the balancer gave **blue** in the split the group played (M5.15):
   * `games.lobby_id` → the lobby's chosen split → `splits.blue_win_prob`. The page turns it
   * into this player's own side's chance, which is its complement on 200.
   *
   * `null` for every game with no stored split — a backfilled game (no lobby), a game whose
   * lobby row was cleared (`on delete set null`), a game the group played without the bot —
   * and those rows drop the clause and keep the result and the change. **No row invents a
   * chance and no row is hidden** (product, 2026-09-10).
   */
  blueWinProb: number | null;
  /** The five on the player's own side, lane order, this player among them. */
  team: RecentTeammate[];
}

/*
 * `RoleRecord` stood here until M5.20 (2026-09-11) and is **deleted, not moved**.
 *
 * It was this file's own fold of `By role` over the player's *rated* rows, and M5.20 draws that
 * section from `lib/stats` — over the counted games `gateGame` decides, with product's five-row
 * minimum and a percentage. Keeping both would have been two records for one person on one
 * page, disagreeing the day a backfill lands unrated (`04-decisions.md`). The type that
 * replaces it is `PlayerRoleRecord` in `lib/stats/types.ts`.
 */

/**
 * `/p/[puuid]`, read through one window (M3.5, windowed by M5.12).
 *
 * **One shape, not two.** Until 2026-09-10 this was a discriminated union whose second arm was
 * "no season is active": the page then printed a name and one sentence, because ratings were
 * per season and there was no number to show. Seasons are gone (`04-decisions.md`), that
 * sentence is deleted with the button behind it (**M5.14**), and a deployment with no season
 * row has no games either — so the honest page is the ordinary one with the window's empty
 * line on it, exactly like a player who has not played this week.
 *
 * What the union was defending against still holds, enforced differently: the numbers here are
 * never zeros standing in for "we do not know". A player with no games carries the rating the
 * balancer would seed them with — the number `/leaderboard` already shows on their row — and
 * `history` is empty, so no chart is drawn.
 */
export interface PlayerBoardView {
  puuid: string;
  name: PlayerName;
  /** Which of the five this page was read through. Its name is beside the picker. */
  window: WindowKind;
  /**
   * Which fold every rating number below came from (M7.16), under exactly
   * {@link BoardRow.track}'s rule: `weekly` on `This week` and `Last week`, `all-time` on the
   * other three. **The page never mixes tracks** — `rating`, `proven`, `reference`, `history`
   * and the per-game deltas in `recent` are all this one's.
   *
   * It exists so that the board row and the page it links to cannot say two numbers about one
   * week (M7.3's own follow-up): `/leaderboard?window=this-week` sorts and prints the weekly
   * `Rating`, and this page now prints the same digit.
   */
  track: RatingTrack;
  /**
   * `round(mu * 60)` **as of their last counted game inside the window** — their current
   * rating on `All time`, and where the month left them on `This month` / `Last month`. With
   * no counted game in the window it is their current rating: the page is a person, and the
   * empty line under it is what says the window has nothing in it.
   *
   * **On a week window it is the weekly track's** (M7.16): the player's seed folded through
   * that week's counted games, equal to the digit on their board row, and their weekly **seed**
   * when the week holds no counted game of theirs — where Sunday put them is the honest answer
   * to "how was their week" when they did not play it.
   */
  rating: number;
  /**
   * `round(ordinal * 60)`, from the same game, under the same label the board uses — **and
   * printed nowhere at all on a week window** (M7.16), the same carve-out the board row has
   * (M7.3): a week is a handful of games by design, so `- 2σ` is enormous on every page, every
   * week. It is still computed, off the weekly track, so the view keeps one shape on every
   * window and nothing here has to be nullable.
   */
  proven: number;
  /** The window's counted games. `All time` is the fold's own total. */
  games: number;
  wins: number;
  losses: number;
  /**
   * The header slot's range half, as on the board — **the range alone**, with no count beside
   * it (product, 2026-09-10): M5.15's seed line already ends `, 6 rated games since.`, and no page
   * says one number twice. `null` when this player has nothing to date from.
   */
  range: string | null;
  /**
   * The 30-game rule, always on the all-time count (M3.8). Never a fact about the window.
   *
   * **Always `false` on a week window** (M7.16), exactly as on a week board row: the chip and
   * its sentence explain Proven, which a week window does not print, and
   * {@link WEEK_PLAYER_SENTENCE} is the paragraph that goes in their place. `SETTLING_GAMES`
   * and the chip are untouched on `All time`, `This month` and `Last month`.
   */
  settling: boolean;
  /**
   * The rank on record when the seed was taken, as words: `Gold II`, `Master`, `Unranked`
   * (M5.15).
   *
   * Formatted in the loader by `rankLabel` from `ratings.seed_rank_tier` / `seed_rank_division`.
   * Those two columns used to be what the seed's number was computed from; since 2026-09-16 a
   * seed is the provisional `20 / 12` for everybody and they are the record of what the client
   * reported that night and nothing more. M7.19's re-word (2026-09-16) took the rank off the
   * seed line rather than re-phrase it, so **no page reads this field any more**; the loader
   * still builds it, and whether it and `rankLabel` survive is M7.20's question, not this
   * pass's. It is still carried on every window, as it always was: the rank is a fact about the
   * player, not about the calendar.
   */
  seedRank: string;
  /**
   * The chart's reference line, in the series' own units: `round(seedMu * 60)` on `All time`,
   * and the rating carried **into** the window on the other four. {@link PlayerBoardView.window}
   * decides whether it is labelled `seed` or `start`.
   *
   * On a week window it is the **weekly seed** — where the from-scratch fold started this
   * player on Sunday (M7.16) — under the same `start` label M5.12 gave the window charts. It is
   * not called a `seed`: that word is a fact about a whole history and stays on `All time`.
   */
  reference: number;
  /**
   * The `Rating` series in `started_at` order, oldest first. Empty for no games.
   *
   * **The weekly fold's own steps on a week window** (M7.16), so the line under the number ends
   * where the number says. A game the weekly fold skipped is not a point on it, exactly as it is
   * not a row in a board row's expand.
   */
  history: number[];
  /**
   * The window's last few games, rated or not (M3.23).
   *
   * **On a week window each game's two mu values are the weekly ones** (M7.16) — the same change
   * M7.3 made to the board row's expand, for the same reason: a list whose deltas do not add up
   * to the number above it is a page arguing with itself. The `award` on a row does not move
   * with the track; it is a fact about who played the game (M7.10).
   */
  recent: RecentGame[];
}
