import Link from 'next/link';
import { ACE_LABEL, MVP_LABEL } from '@/lib/board/copy';
import { COL_CS, COL_DAMAGE, COL_GOLD, COL_KDA, SCOREBOARD_LABEL } from '@/lib/games/copy';
import type { HistoryGame, HistorySeat, HistoryTeam } from '@/lib/games/types';
import { renderWebName } from '@/lib/tonight/copy';
import { RoleName } from '../_board/parts';

/**
 * Both scoreboards of one custom, the same sheet `/games` opens inside a match card.
 * `/fun` reuses it under a record so the night that set the number is still visible.
 *
 * `MVP` / `ACE` (M7.23) follows the name of the seat `gatedGameAward` named, in M7.10's dress —
 * `.cn-game-award`, the word and nothing else. A seat with no award renders exactly the markup it
 * did before the word existed, which is every seat on `/fun` (it never asks for awards).
 */

export function MatchSheet({ game, focusPuuid }: { game: HistoryGame; focusPuuid: string | null }) {
  return (
    <div className="cn-sheet">
      <p className="cn-sr">{SCOREBOARD_LABEL}</p>
      <TeamSheet team={game.blue} focusPuuid={focusPuuid} />
      <TeamSheet team={game.red} focusPuuid={focusPuuid} />
    </div>
  );
}

function TeamSheet({ team, focusPuuid }: { team: HistoryTeam; focusPuuid: string | null }) {
  const tone = team.side === 100 ? 'blue' : 'red';

  return (
    <section className={`cn-sheet-team cn-sheet-${tone}`}>
      <header className="cn-sheet-head">
        <h2 className="cn-sheet-title">{team.label}</h2>
        <span className="cn-num cn-sheet-gold-total">{team.goldLabel}</span>
      </header>
      <div className="cn-sheet-cols" aria-hidden="true">
        <span />
        <span />
        <span className="cn-num">{COL_KDA}</span>
        <span className="cn-num cn-sheet-wide">{COL_DAMAGE}</span>
        <span className="cn-num cn-sheet-wide">{COL_GOLD}</span>
        <span className="cn-num">{COL_CS}</span>
      </div>
      <ol className="cn-sheet-rows">
        {team.seats.map((seat) => (
          <li key={seat.puuid} className={seat.puuid === focusPuuid ? 'cn-sheet-row cn-you' : 'cn-sheet-row'}>
            {seat.role === null ? <span className="cn-num cn-lineup-role" /> : <RoleName role={seat.role} />}
            <span className="cn-sheet-who">
              {seat.award === null ? (
                <SeatName seat={seat} viewed={seat.puuid === focusPuuid} />
              ) : (
                <span className="cn-sheet-name">
                  <SeatName seat={seat} viewed={seat.puuid === focusPuuid} />
                  <span className="cn-game-award">{` ${seat.award === 'mvp' ? MVP_LABEL : ACE_LABEL}`}</span>
                </span>
              )}
              {seat.champion === null ? null : <span className="cn-sheet-champ">{seat.champion}</span>}
              <span className="cn-num cn-sheet-sub">
                {seat.csLabel}
                {seat.kp === null ? '' : ` · ${seat.kp}% KP`}
              </span>
            </span>
            <span className="cn-num cn-sheet-kda">{seat.kda}</span>
            <span className="cn-sheet-bar cn-sheet-wide" aria-hidden="true">
              <span className="cn-sheet-bar-fill" style={{ width: `${seat.damageShare}%` }} />
              <span className="cn-num cn-sheet-bar-n">{seat.damageLabel}</span>
            </span>
            <span className="cn-num cn-sheet-wide">{seat.goldLabel}</span>
            <span className="cn-num">{seat.csLabel}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SeatName({ seat, viewed }: { seat: HistorySeat; viewed: boolean }) {
  if (viewed) return <span className="cn-lineup-name">{renderWebName(seat.name)}</span>;

  return (
    <Link className="cn-lineup-name cn-lineup-link" href={`/p/${seat.puuid}`}>
      {renderWebName(seat.name)}
    </Link>
  );
}
