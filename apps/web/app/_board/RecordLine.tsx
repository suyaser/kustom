/**
 * `32 games · 23W 9L` with the numbers in mono and the words and letters in the text face
 * (05-design 4: number → mono, word → text). The text reads exactly like `gamesLabel` +
 * `winLossLabel`, so a screen reader and a test see the same string.
 */
export function RecordLine({
  games,
  wins,
  losses,
  order = 'games-first',
}: {
  games: number;
  wins: number;
  losses: number;
  order?: 'games-first' | 'record-first';
}) {
  const count = (
    <>
      <span className="num">{games}</span>
      {games === 1 ? ' game' : ' games'}
    </>
  );
  const record = (
    <>
      <span className="num">{wins}</span>W <span className="num">{losses}</span>L
    </>
  );
  return order === 'games-first' ? (
    <span>
      {count} · {record}
    </span>
  ) : (
    <span>
      {record} · {count}
    </span>
  );
}
