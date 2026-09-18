'use client';

import type { WindowKind } from '@/lib/night';
import type { PlayerRef } from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import { COMPARE, PICK_LEFT, PICK_PLAYER, PICK_RIGHT, VERSUS_WORD } from '@/lib/versus/copy';

/**
 * The two `<select>`s on `/1v1`. A GET form so a pick survives a refresh and pastes into
 * the chat; `onChange` submits without a second tap when JavaScript is on.
 */

export function PlayerPick({
  window,
  roster,
  left,
  right,
}: {
  window: WindowKind;
  roster: readonly PlayerRef[];
  left?: string;
  right?: string;
}) {
  return (
    <form
      className="cn-versus-pick"
      method="get"
      action="/1v1"
      onChange={(event) => event.currentTarget.requestSubmit()}
    >
      <input type="hidden" name="window" value={window} />
      <label className="cn-versus-select">
        <span className="cn-sr-only">{PICK_LEFT}</span>
        <select name="a" defaultValue={left ?? ''} aria-label={PICK_LEFT}>
          <option value="">{PICK_PLAYER}</option>
          {roster.map((player) => (
            <option key={player.puuid} value={player.puuid}>
              {renderWebName(player.name)}
            </option>
          ))}
        </select>
      </label>
      <span className="cn-versus-vs" aria-hidden="true">
        {VERSUS_WORD}
      </span>
      <label className="cn-versus-select">
        <span className="cn-sr-only">{PICK_RIGHT}</span>
        <select name="b" defaultValue={right ?? ''} aria-label={PICK_RIGHT}>
          <option value="">{PICK_PLAYER}</option>
          {roster.map((player) => (
            <option key={player.puuid} value={player.puuid}>
              {renderWebName(player.name)}
            </option>
          ))}
        </select>
      </label>
      <button className="cn-versus-go" type="submit">
        {COMPARE}
      </button>
    </form>
  );
}
