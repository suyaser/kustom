import { displayRating } from '@customs/core';
import { favoredClause, formatDamage, formatDuration, underdogClause } from '@/lib/discord/embeds';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { renderWebName, webAwardLine } from '@/lib/tonight/copy';
import type { ResultSeatView, ResultView } from '@/lib/tonight/types';
import { RoleCell } from './RoleCell';

/**
 * A rated game's result as a poster (M11.3, 05-design.md "The result poster"): the headline
 * card — duration, winner, the underdog line when it is true — then under a hairline the
 * footnotes, then the two team cards with **after** ratings and deltas, then the explanation
 * line of the split they played.
 *
 * A pure function of one {@link ResultView}. Nothing in it knows it is on `/`, so the game page
 * (M11.4) renders the same poster.
 *
 * **One rating per player per screen.** The cards inside this block are the only cards; there
 * is no second pair underneath with the before numbers (M3.4, M3.16).
 */
export function ResultPoster({
  result,
  explanation,
  viewerPuuid,
}: {
  result: ResultView;
  /** The played split's stored `splits.explanation`, verbatim, or `null` when there was none. */
  explanation: string | null;
  viewerPuuid: string | null;
}) {
  const side = result.winningSide === 100 ? 'blue' : 'red';
  // One odds line, never two: the underdog's sentence replaces the favourite's.
  const underdog = underdogClause(result.blueWinProb, result.winningSide);
  const prediction = underdog === null ? favoredClause(result.blueWinProb) : null;
  const notes = prediction !== null || result.award !== null || result.topDamage !== null;

  return (
    <section className="cn-block">
      <section className={`cn-card cn-result cn-result-${side}`}>
        {/* The verdict. `BLUE WINS` gets the whole row: the duration is the slug above it. */}
        <div className="cn-result-head">
          <p className="cn-num cn-result-duration">{formatDuration(result.durationS)}</p>
          {/* The one place in the product where a colour is large, and it is large for one
              line. The strip says `GAME OVER`; this says who won, and neither repeats the
              other (M3.16, and product 2026-09-09). */}
          <p className={`cn-display cn-win cn-win-${side}`}>{`${side.toUpperCase()} WINS`}</p>
          {underdog === null ? null : <p className="cn-underdog">{underdog}</p>}
        </div>

        {notes ? (
          <div className="cn-result-notes">
            {prediction === null ? null : <p className="cn-prediction">{prediction}</p>}
            {result.award === null ? null : <p className="cn-result-award">{webAwardLine(result.award)}</p>}
            {result.topDamage === null ? null : (
              <p className="cn-damage">
                {`Top damage: ${renderWebName(result.topDamage.name)}, `}
                <span className="cn-num cn-damage-value">{formatDamage(result.topDamage.damage)}</span>
              </p>
            )}
          </div>
        ) : null}
      </section>

      <div className="cn-cards">
        <ResultCard
          side="blue"
          seats={result.blue}
          losing={result.winningSide !== 100}
          viewerPuuid={viewerPuuid}
        />
        <ResultCard
          side="red"
          seats={result.red}
          losing={result.winningSide !== 200}
          viewerPuuid={viewerPuuid}
        />
      </div>

      {explanation === null ? null : (
        <div className="cn-card cn-explain">
          <p className="cn-explain-text">{explanation}</p>
        </div>
      )}
    </section>
  );
}

/**
 * One side of the result. Lane order, the same five positions as the teams block, so "my row"
 * is where it was. The winner keeps its 4px side rule and gains a 1px `brand` ring; the loser's
 * rule drops to a hairline. Two signals, both structural.
 *
 * **The delta is computed here, at render.** `displayDelta` returns `-0` for a rating that fell
 * by less than half a point, and `-0` does not survive `JSON.stringify`: carried through a
 * payload it would print `(+0)` on a row that went down (`05-design.md`).
 */
function ResultCard({
  side,
  seats,
  losing,
  viewerPuuid,
}: {
  side: 'blue' | 'red';
  seats: readonly ResultSeatView[];
  losing: boolean;
  viewerPuuid: string | null;
}) {
  const rows = seats.map((seat) => ({
    seat,
    rating: seat.muAfter === null ? null : displayRating(seat.muAfter),
    delta: seat.muBefore === null || seat.muAfter === null ? null : displayDelta(seat.muBefore, seat.muAfter),
  }));

  return (
    <section className={`cn-card cn-team cn-team-${side}${losing ? ' cn-team-lost' : ' cn-team-won'}`}>
      {/*
       * **No side sums here.** The sum answers "are these teams even?", which is a question
       * the game has just answered, and a reader who saw `6000` before and `6465` after has
       * computed a team total of deltas by subtraction — the one number this page must not
       * print (05-design.md, "Result card"). The teams block keeps its sums; this header is
       * the side name alone.
       */}
      <header className="cn-card-head cn-team-head">
        <h2 className="cn-display cn-side">{side === 'blue' ? 'BLUE' : 'RED'}</h2>
      </header>
      <ul className="cn-seats">
        {rows.map(({ seat, rating, delta }) => (
          <li key={seat.puuid} className={seat.puuid === viewerPuuid ? 'cn-seat cn-you' : 'cn-seat'}>
            <RoleCell role={seat.role} />
            <span className="cn-seat-name">{renderWebName(seat.name)}</span>
            <span className="cn-num cn-seat-rating">
              {rating ?? ''}
              {delta === null ? null : (
                // One string, not three children: React separates adjacent text nodes with
                // `<!-- -->` in the server render, and a rating copied off the page should
                // read `1512 (+43)`.
                <span className={isGain(delta) ? 'cn-delta cn-delta-up' : 'cn-delta'}>
                  {` (${formatWebDelta(delta)})`}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
