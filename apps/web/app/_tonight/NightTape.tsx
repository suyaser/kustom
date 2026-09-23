import Link from 'next/link';
import { formatDuration, underdogClause } from '@/lib/discord/embeds';
import {
  evennessLine,
  HEAD_SEPARATOR,
  TAPE_NO_RESULT,
  TAPE_TITLE,
  TAPE_WINS,
  tapeGameLabel,
  tapeRatedNote,
  tapeSatOut,
} from '@/lib/tonight/copy';
import type { TapeEntry } from '@/lib/tonight/types';

/**
 * Tonight's earlier games, oldest first (M11.2, 05-design.md "The night tape"). A quiet log in
 * one card: not a fourth state, not a second scoreboard. No ratings, deltas, MVP or champion
 * icons on a row. Absent — no card, no heading — when there is nothing behind the current block.
 */
export function NightTape({ tape }: { tape: readonly TapeEntry[] }) {
  if (tape.length === 0) return null;

  return (
    <section className="cn-card cn-tape-card" aria-labelledby="cn-tape-title">
      <h2 className="cn-card-title" id="cn-tape-title">
        {TAPE_TITLE}
      </h2>
      <ol className="cn-tape">
        {tape.map((entry, index) => (
          <TapeRow key={entry.lobbyId} entry={entry} index={index + 1} />
        ))}
      </ol>
    </section>
  );
}

function TapeRow({ entry, index }: { entry: TapeEntry; index: number }) {
  const result = entry.result;
  const underdog = result === null ? null : underdogClause(entry.blueWinProb, result.winningSide);
  const even = evennessLine(entry.blueWinProb);
  const satOut = tapeSatOut(entry.sitters);

  return (
    <li className={result === null ? 'cn-tape-row cn-tape-dropped' : 'cn-tape-row'}>
      <time className="cn-num cn-tape-time" dateTime={entry.createdAt}>
        {entry.clock}
      </time>
      <div className="cn-tape-body">
        <p className="cn-num cn-tape-game">{tapeGameLabel(index)}</p>
        <p className="cn-tape-result">
          {result === null ? (
            TAPE_NO_RESULT
          ) : (
            // A history link to the game's own page (M11.4), not a nightly control: the line
            // keeps its text size and gains no 44px target.
            <Link className="cn-tape-link" href={`/g/${result.gameId}`}>
              <TapeVerdict result={result} />
            </Link>
          )}
        </p>
        {underdog === null ? null : <p>{underdog}</p>}
        {even === null ? null : <p>{even}</p>}
        {satOut === null ? null : <p>{satOut}</p>}
      </div>
    </li>
  );
}

function TapeVerdict({ result }: { result: NonNullable<TapeEntry['result']> }) {
  const side = result.winningSide === 100 ? 'blue' : 'red';
  const note = tapeRatedNote(result);
  return (
    <>
      <span className={`cn-tape-side cn-tape-${side}`}>{side.toUpperCase()}</span>
      {` ${TAPE_WINS} ${HEAD_SEPARATOR} `}
      <span className="cn-num">{formatDuration(result.durationS)}</span>
      {note === null ? null : ` ${HEAD_SEPARATOR} ${note}`}
    </>
  );
}
