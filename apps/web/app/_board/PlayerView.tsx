import { displayRating } from '@customs/core';
import Link from 'next/link';
import {
  ACE_LABEL,
  gamesLabel,
  LOST,
  MVP_EXPLANATION,
  MVP_LABEL,
  NOT_RATED,
  NOT_RATED_HINT,
  PROVEN_LABEL,
  RATING_EXPLANATION,
  RATING_LABEL,
  RECENT_GAMES_HEADING,
  RECENT_RATING_LEGEND,
  WON,
  winLossLabel,
} from '@/lib/board/copy';
import { explainGame, explainRatingStart } from '@/lib/board/explain';
import type { PlayerBoardView, RecentGame, RecentTeammate } from '@/lib/board/types';
import { windowHref } from '@/lib/board/window';
import { formatDuration } from '@/lib/discord/embeds';
import { ALL_GAMES_LABEL } from '@/lib/games/copy';
import { formatDayMonth } from '@/lib/night';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
import type { PlayerStatsView } from '@/lib/stats/types';
import { isNameless, renderWebName } from '@/lib/tonight/copy';
import { nightTimeZone } from '@/lib/tonight/night';
import '../board-parts.css';
import '../stats.css';
import { PlayerStats } from './PlayerStats';
import { NamelessHint, RoleName, SettlingChip, SettlingNote } from './parts';
import { RatingChart } from './RatingChart';
import { WindowPicker } from './WindowPicker';
import { WindowSlot } from './WindowSlot';

/**
 * `/p/[puuid]` (M3.5, M3.8, M3.10; dressed for Floodlit in M3.19): the two numbers, the
 * `Rating` history, the role record and the last few games.
 *
 * **Two numbers with two names, and no third.** `Rating` and `Proven` are the board's words,
 * printed here under the same two labels, once, above the chart. The chart belongs to `Rating`;
 * the numbers beside it say where the board has this player today.
 *
 * Floodlit's rank order down the page, which v1 had upside down: **the name outranks the
 * section headings and the two numbers outrank both.** The name is the display cut, `Proven` is
 * `t-display`, `Rating` is `t-md`, and `By role` and `Recent games` are mono `t-xs` micro-labels
 * in a `raise` card header — v1 set the name and both headings at the same `t-lg`, which made
 * the largest type on a page about a person the words `By role`.
 *
 * There is **no back link**: the `Leaderboard` tab in the shell is the same destination, and a
 * page does not carry two ways to one place (`05-design.md`, settled with M3.18's shell).
 */

export interface PlayerViewProps {
  player: PlayerBoardView;
  /**
   * The sections under the chart (M5.20), read for this player out of `/stats`' own answer.
   *
   * **Never null and never optional**: `loadPlayerStats` answers with the empty view — `games:
   * 0` — for a player with nothing in the window, and the empty view draws nothing. A nullable
   * prop would be a second way to say the same thing, and the branch behind it could not be
   * reached.
   */
  stats: PlayerStatsView;
}

/**
 * **Nothing on this page depends on who is looking.** A lineup marks the player whose page it
 * is, and only them: marking the viewer as well put the `brand` rule on two of five rows on
 * every night the viewer played beside the person they are reading about (the designer,
 * 2026-09-10), which is two answers to "which one is my row" on a page that is not about the
 * viewer at all.
 */
export function PlayerView({ player, stats }: PlayerViewProps) {
  return (
    <main className="cn-page">
      <header className="cn-strip">
        {/* The person is the page: the display cut, and the biggest language on it. */}
        <h1 className="cn-display cn-player-name">{renderWebName(player.name)}</h1>
        {/*
         * The same five options, in the same order and the same words, as `/leaderboard`
         * (M5.12) — the control looks the same on all three pages, and the parameter is the
         * same word. This page's default is `All time`, because it is a person's history.
         */}
        <WindowPicker path={`/p/${player.puuid}`} selected={player.window} />

        {/*
         * The same slot the board's header carries, and the same component since M5.23 (the
         * designer, 2026-09-10 and 2026-09-11): the window's one line, under the chips and above
         * the hairline. A player with no counted game in the window says so here rather than
         * inside the card, where it used to sit between the two numbers and the chart.
         *
         * **The range half prints alone here** (product, 2026-09-10): the record under the two
         * numbers already says `6 games · 4W 2L`, and no page says one number twice — which is
         * why this caller passes `player.range` and not a composed slot line.
         */}
        <WindowSlot window={player.window} line={player.range} />
      </header>

      <PlayerWindow player={player} stats={stats} />
    </main>
  );
}

/** The page proper: the two numbers, the chart, the sections about them, the last few games. */
function PlayerWindow({ player, stats }: PlayerViewProps) {
  const nameless =
    isNameless(player.name) || player.recent.some((game) => game.team.some((seat) => isNameless(seat.name)));
  /** M3.23: the sentence is printed once, and only while a row on the page reads `not rated`. */
  const unrated = player.recent.some((game) => game.muAfter === null);
  /**
   * Where this player started, in one sentence (M5.15). It is drawn from `player.reference` —
   * **the value the hairline in the chart is drawn at** — so the line and the sentence are one
   * number read once and cannot disagree.
   */
  const start = explainRatingStart(player);

  return (
    <>
      <section className="cn-block">
        <div className="cn-card cn-player-card">
          {/*
           * Above the chart, once: the primary number and the number people arrive knowing,
           * under the same two labels the board uses, in the board's own order — `Rating`
           * first, because that is the one a reader is looking for, and `Proven` in the
           * display size, because that is the one the board sorts on. The chip sits beside
           * them (M3.8).
           */}
          <div className="cn-summary">
            <p className="cn-numbers">
              <span className="cn-number">
                <span className="cn-number-label">{RATING_LABEL}</span>{' '}
                <span className="cn-num cn-number-value">{player.rating}</span>
              </span>
              <span className="cn-number cn-number-primary">
                <span className="cn-number-label">{PROVEN_LABEL}</span>{' '}
                <span className="cn-num cn-number-value">{player.proven}</span>
              </span>
              {player.settling ? <SettlingChip /> : null}
            </p>

            {/*
             * The record, directly under the two numbers (the designer's review, 2026-09-09).
             * The board prints it on every row and this page — the one place a friend goes to
             * read about themselves — did not, so `28 games · 13W 15L` had to be counted off
             * the chart. It counts the **rated** games, the ones the fold counted (M3.23).
             *
             * At zero games there is no record to print: `0 games · 0W 0L` is three zeros
             * saying what the window's empty line says underneath in words (the designer,
             * 2026-09-10).
             */}
            {/*
             * **The record, minus the count the sentence under it already carries** (the
             * designer, 2026-09-10). `37 games · 19W 18L` above `Started at 1200, 37 games
             * since.` prints 37 twice, forty pixels apart; the seed line is the one
             * that has to say it, because "since when" is what it is about. With no seed line —
             * a window this player did not play — nothing prints here either, because the count
             * is zero.
             */}
            {player.games === 0 ? null : (
              <p className="cn-row-meta">
                {start === null ? (
                  <>
                    <span className="cn-num">{gamesLabel(player.games)}</span>
                    {' · '}
                  </>
                ) : null}
                <span className="cn-num">{winLossLabel(player.wins, player.losses)}</span>
              </p>
            )}
          </div>

          {/*
           * The seed line, once, above the chart (M5.15; re-worded by M7.19): `Started at 1200,
           * 37 games since.` It is the first half of "how you got here" — where the board
           * started this player before any of the games under it happened, which since
           * 2026-09-16 is the same provisional number for everybody and never their League rank
           * — and it prints for somebody with no games at all, where it is the only thing the
           * page can honestly say.
           */}
          {start === null ? null : <p className="cn-seed-line">{start}</p>}

          {/*
           * **Gated on games played, not on points to plot.** `history.length === 0` also means
           * "this player has games the window's read did not reach", and the page then told
           * somebody with forty games that they had none. A player with games and nothing
           * to draw gets no chart and no sentence rather than a false one.
           */}
          {player.history.length === 0 ? null : (
            // The hairline is the seed on `All time` and the rating carried **into** the
            // window on the other four, labelled `start` — it is not a seed and does not
            // borrow the word (M5.12).
            <RatingChart history={player.history} reference={player.reference} window={player.window} />
          )}

          {/*
           * Under the chart, once per page (M3.8), in the **third person** (M3.26): this page
           * is about one player and the sentence sits under their numbers, not the reader's.
           */}
          {player.settling ? <SettlingNote person="player" /> : null}
        </div>
      </section>

      {/*
       * **Below the rating chart, the sections about this person** (M5.20): their role record,
       * their side record, their partners, their streaks, their mean game and — on a closed
       * window they won something in — one award line.
       *
       * `By role` lives in there now and not here. It used to be folded a second time by
       * `lib/board/load.ts`, over the *rated* rows rather than the counted games, which is two
       * definitions of one record on one page the day a backfill lands unrated. The page reads
       * `lib/stats` for all of it, exactly as `/stats` does (`04-decisions.md`, 2026-09-11).
       */}
      <PlayerStats stats={stats} />

      {player.recent.length === 0 ? null : (
        <section className="cn-block">
          <section className="cn-card cn-list-card">
            <header className="cn-card-head cn-list-head">
              <h2 className="cn-board-title">{RECENT_GAMES_HEADING}</h2>
              {/* Right-aligned over the column of ratings, the same legend the seat rack
                  carries over its own (the designer's M3.5 review). */}
              <span className="cn-num cn-legend">{RECENT_RATING_LEGEND}</span>
            </header>
            <ul className="cn-games">
              {player.recent.map((game) => (
                <RecentGameView key={game.gameId} game={game} puuid={player.puuid} />
              ))}
            </ul>
          </section>
          {/* Once, under the list, and only while a row on it reads `not rated` (M3.23). */}
          <p className="cn-hint">
            <Link className="cn-lineup-link" href={windowHref('/games', player.window, { p: player.puuid })}>
              {ALL_GAMES_LABEL}
            </Link>
          </p>
          {unrated ? <p className="cn-hint">{NOT_RATED_HINT}</p> : null}
          {/*
           * And once under that, the whole point of M5.15: why one win is worth more than
           * another. **Per page, not per row** — a sentence repeated five times is a sentence
           * nobody reads twice. No maths, no formula, no link to a paper (product).
           *
           * In the tonight page's explanation-strip dress (the designer, 2026-09-10): the 3px
           * `brand` leading rule that means "the bot is explaining itself" on every other
           * surface it appears on.
           *
           * **Two sentences, one strip** (M7.10). The second says that the best player on the
           * winning side keeps a little more and the best on the losing side gives a little
           * less back — the other half of why a delta is the size it is, and therefore the same
           * paragraph rather than a second leading rule under it. It is about the model, so it
           * prints for every reader on every window, whether or not any row beside it says
           * `MVP`.
           */}
          <p className="cn-explain">
            {RATING_EXPLANATION} {MVP_EXPLANATION}
          </p>
        </section>
      )}

      {nameless ? <NamelessHint /> : null}
    </>
  );
}

/**
 * One game: what it did to this player's rating, and the five they were on in lane order — the
 * same five positions the teams block and the result card use, so "my row" is where it was.
 *
 * **The delta is computed here, at render.** `displayDelta` rounds both ratings before it
 * subtracts, so `1512 (+43)` adds up, and its `-0` for a rating that fell by less than half a
 * point does not survive a `JSON.stringify` it never makes.
 *
 * **A game that moved nothing says so** (M3.23, product 2026-09-10): where the rating would be,
 * the row reads `not rated` — one vocabulary for a game the fold refused and for a backfilled
 * game `rebuild-ratings` has not folded yet, because the reader's question is the same one. The
 * result, the date and the duration print exactly as they do on a rated row.
 */
function RecentGameView({
  game,
  puuid,
}: {
  game: RecentGame;
  /** Whose page this is: their own row in the lineup is plain text, and carries the rule. */
  puuid: string;
}) {
  const rating = game.muAfter === null ? null : displayRating(game.muAfter);
  const delta =
    game.muBefore === null || game.muAfter === null ? null : displayDelta(game.muBefore, game.muAfter);
  /**
   * Why the change is that size (M5.15): the chance the balancer gave **this player's own
   * side**, and only that — the head above already prints the result and the delta. `null` for
   * a game with no stored chance and for an unrated row, which M3.23 answers in three words.
   */
  const why = explainGame(game);

  return (
    <li className={`cn-game cn-game-${game.side === 100 ? 'blue' : 'red'}`}>
      <p className="cn-game-head">
        <span className="cn-game-result">{game.won ? WON : LOST}</span> {/*
         * The night this was, beside how long it took. Formatted on the server in the fixed
         * locale and the configured timezone (`lib/night.ts`), so a 01:00 game is dated the
         * night the group played it and the string cannot change under a reader whose browser
         * is set to somewhere else.
         */}
        <span className="cn-num cn-duration">
          {formatDayMonth(new Date(game.startedAt), nightTimeZone())}
        </span>
        <span className="cn-num cn-duration">{formatDuration(game.durationS)}</span>
        {rating === null ? (
          // No delta, no em-dash and no visually-hidden `Rating`: there is no rating on this
          // row to name (product, 2026-09-10).
          <span className="cn-num cn-game-rating cn-not-rated">{NOT_RATED}</span>
        ) : (
          <span className="cn-num cn-game-rating">
            {rating}
            {/* The bare number gets its noun, the same rule the board row's bare Proven
                follows (the designer's M3.5 review). */}
            <span className="cn-sr"> {RATING_LABEL}</span>
            {delta === null ? null : (
              // One string, not three children: React separates adjacent text nodes in the
              // server render, and a rating copied off the page should read `1512 (+43)`.
              <span className={isGain(delta) ? 'cn-delta cn-delta-up' : 'cn-delta'}>
                {` (${formatWebDelta(delta)})`}
              </span>
            )}
            {/*
             * **The word, beside the delta it explains** (M7.10): `1512 (+43) MVP`. One of two
             * words or nothing at all — never a badge, never an icon, never a colour of its
             * own — at the delta's own size, in the same column, so a reader scanning "what did
             * this game do to me" finds it without a second place to look.
             *
             * Absent, not empty: the eight players who were neither, and every game the fold
             * could not score, render no element here (`05-design.md`'s rule for the `not
             * rated` row, and the same reason no page says "nearly MVP").
             */}
            {game.award === null ? null : (
              <span className="cn-game-award">{` ${game.award === 'mvp' ? MVP_LABEL : ACE_LABEL}`}</span>
            )}
          </span>
        )}
      </p>
      {/* Directly under the head it explains, above the lineup: one readable column down the
          list, and never a second table. Absent, not empty, for a game with no stored chance. */}
      {why === null ? null : <p className="cn-game-why">{why}</p>}
      <ul className="cn-lineup">
        {game.team.map((seat) => (
          <li key={seat.puuid} className={seat.puuid === puuid ? 'cn-lineup-row cn-you' : 'cn-lineup-row'}>
            {seat.role === null ? <span className="cn-num cn-lineup-role" /> : <RoleName role={seat.role} />}
            <LineupName seat={seat} viewed={seat.puuid === puuid} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * A teammate's name, and a link to their page — **except the player whose page this is**, whose
 * row is plain text (the designer's M3.5 review). This is the one screen in the product that
 * lists other people by name, and hopping between friends is what the board is for; a link
 * back to the page you are already on is not a destination.
 */
function LineupName({ seat, viewed }: { seat: RecentTeammate; viewed: boolean }) {
  if (viewed) return <span className="cn-lineup-name">{renderWebName(seat.name)}</span>;

  return (
    <Link className="cn-lineup-name cn-lineup-link" href={`/p/${seat.puuid}`}>
      {renderWebName(seat.name)}
    </Link>
  );
}
