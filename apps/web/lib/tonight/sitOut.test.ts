import { describe, expect, it } from 'vitest';
import { compareForSitOut, type PoolMember, selectTen } from '../ingest/selection';
import { type SitOutStanding, sitOutLead, sitOutLine, sitOutReasonSentence, sitOutRule } from './sitOut';

/** M14.41 (scene-walk gap 4): one rule, one sentence, page and embed alike. */

function member(puuid: string, gamesTonight: number, lastSitOutAt: number | null = null): SitOutStanding {
  return { puuid, gamesTonight, lastSitOutAt };
}

function pool(n: number, games: number, lastSitOutAt: number | null = null): SitOutStanding[] {
  return Array.from({ length: n }, (_, index) =>
    member(`p${String(index).padStart(2, '0')}`, games, lastSitOutAt),
  );
}

const RAMZY = { who: 'Ramzy', plural: false };

describe('sitOutRule, read at the cut', () => {
  it('is null when nobody sits', () => {
    expect(sitOutRule(pool(10, 0), [])).toBeNull();
  });

  it('most games only when the sitter played strictly more than everybody who plays', () => {
    expect(sitOutRule(pool(10, 1), [member('a-ramzy', 2)])).toEqual({ kind: 'most-games' });
  });

  it('the walk: ten on one game, a newcomer on none, nobody has sat out: never most games', () => {
    const playing = [...pool(9, 1), member('new', 0)];
    expect(sitOutRule(playing, [member('a-ramzy', 1)])).toEqual({ kind: 'first', games: 1, everyone: false });
  });

  it('a tie broken by sit-outs is longest-since, with the games count and whether all are level', () => {
    const playing = pool(10, 1, 5_000);
    expect(sitOutRule(playing, [member('a-ramzy', 1, 1_000)])).toEqual({
      kind: 'longest-since',
      games: 1,
      everyone: true,
    });
    expect(sitOutRule([...pool(9, 1, 5_000), member('new', 0)], [member('a-ramzy', 1)])).toEqual({
      kind: 'longest-since',
      games: 1,
      everyone: false,
    });
  });

  it('the first game of a night with no history at all is first, games 0', () => {
    expect(sitOutRule(pool(10, 0), [member('a-zz', 0)])).toEqual({ kind: 'first', games: 0, everyone: true });
  });

  it('claims nothing when the cut is not the rotation order (somebody kept in on another rule)', () => {
    expect(sitOutRule(pool(10, 2), [member('a-ramzy', 1)])).toBeNull();
  });

  it("agrees with the balancer's own selection on a mixed pool", () => {
    const around: PoolMember[] = [
      ...pool(8, 1, 3_000),
      member('a', 2),
      member('b', 1, 1_000),
      member('c', 0),
      member('d', 1),
    ].map((one) => ({
      ...one,
      playerId: one.puuid,
      name: one.puuid,
      side: null,
      isSpectator: false,
      mainRole: null,
      secondaryRole: null,
      roleOverride: null,
      mu: 25,
      sigma: 8,
    }));
    const { playing, sitters } = selectTen(around);
    expect([...sitters].sort(compareForSitOut).map((one) => one.puuid)).toEqual(['a', 'd']);
    // `d` never sat out, the eight at the cut did: history decided between d and the next up.
    expect(sitOutRule(playing, sitters)).toEqual({ kind: 'longest-since', games: 1, everyone: false });
  });
});

describe('the host always plays (M14.43): the reason skips them at the cut', () => {
  const asPool = (rows: SitOutStanding[]): PoolMember[] =>
    rows.map(({ isHost, ...one }) => ({
      ...one,
      ...(isHost === true ? { isHost: true } : {}),
      playerId: one.puuid,
      name: one.puuid,
      side: null,
      isSpectator: false,
      mainRole: null,
      secondaryRole: null,
      roleOverride: null,
      mu: 25,
      sigma: 8,
    }));

  it('the walk: eleven level on one game, the host first by puuid, so the next in line sits', () => {
    // `a-host` would sit on the puuid tie-break; the host rule seats the next one out instead.
    const around = asPool([{ ...member('a-host', 1), isHost: true }, member('b-next', 1), ...pool(9, 1)]);
    const { playing, sitters } = selectTen(around);
    expect(sitters.map((one) => one.puuid)).toEqual(['b-next']);
    expect(sitOutRule(playing, sitters)).toEqual({ kind: 'first', games: 1, everyone: true });
  });

  it('history decides past the host: the sitter has gone longest, the host sat out longer ago still', () => {
    const around = asPool([
      { ...member('host', 2, null), isHost: true },
      member('sitter', 2, 1_000),
      ...pool(9, 2, 9_000),
    ]);
    const { playing, sitters } = selectTen(around);
    expect(sitters.map((one) => one.puuid)).toEqual(['sitter']);
    expect(sitOutRule(playing, sitters)).toEqual({ kind: 'longest-since', games: 2, everyone: true });
  });

  it('most games past the host: the host played as many, the rest fewer', () => {
    const around = asPool([{ ...member('host', 3), isHost: true }, member('sitter', 3), ...pool(9, 2)]);
    const { playing, sitters } = selectTen(around);
    expect(sitOutRule(playing, sitters)).toEqual({ kind: 'most-games' });
  });
});

describe('the reason sentence (M14.41 [NEW COPY])', () => {
  it('most games', () => {
    expect(sitOutReasonSentence({ kind: 'most-games' }, RAMZY)).toBe(
      "They've played the most games tonight.",
    );
    expect(sitOutReasonSentence({ kind: 'most-games' }, { who: 'You', plural: true, you: true })).toBe(
      "You've played the most games tonight.",
    );
  });

  it('a tie broken by sit-outs', () => {
    expect(sitOutReasonSentence({ kind: 'longest-since', games: 1, everyone: true }, RAMZY)).toBe(
      "They've gone longest without sitting out, and everyone's played 1 game tonight.",
    );
    expect(sitOutReasonSentence({ kind: 'longest-since', games: 2, everyone: false }, RAMZY)).toBe(
      "They've gone longest without sitting out, tied on 2 games tonight.",
    );
    expect(
      sitOutReasonSentence(
        { kind: 'longest-since', games: 3, everyone: true },
        { who: 'You', plural: true, you: true },
      ),
    ).toBe("You've gone longest without sitting out, and everyone's played 3 games tonight.");
    expect(
      sitOutReasonSentence(
        { kind: 'longest-since', games: 0, everyone: true },
        { who: 'Ramzy and Omar', plural: true },
      ),
    ).toBe("They've gone longest without sitting out, and it's the first game of the night.");
  });

  it('the first game', () => {
    expect(sitOutReasonSentence({ kind: 'first', games: 0, everyone: true }, RAMZY)).toBe(
      'First game of the night, so somebody has to be first.',
    );
    expect(sitOutReasonSentence({ kind: 'first', games: 1, everyone: false }, RAMZY)).toBe(
      'Tied on 1 game tonight, so somebody has to be first.',
    );
  });

  it('the line is the lead, then the reason; with no rule the lead alone', () => {
    expect(sitOutLead(RAMZY)).toBe('Ramzy sits this one out.');
    expect(sitOutLead({ who: 'Ramzy and Omar', plural: true })).toBe('Ramzy and Omar sit this one out.');
    expect(sitOutLine({ kind: 'most-games' }, RAMZY)).toBe(
      "Ramzy sits this one out. They've played the most games tonight.",
    );
    expect(sitOutLine(null, RAMZY)).toBe('Ramzy sits this one out.');
  });
});
