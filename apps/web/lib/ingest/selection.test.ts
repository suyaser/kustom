import { describe, expect, it } from 'vitest';
import { compareForSitOut, type PoolMember, planSeats, SelectionError, selectTen } from './selection';

/**
 * Who sits and who moves (M2.5). Pure: the numbers a `PoolMember` carries are filled in from
 * the database in `balance.ts` and checked against it in `companion.integration.test.ts`.
 */

function member(puuid: string, overrides: Partial<PoolMember> = {}): PoolMember {
  return {
    playerId: `id-${puuid}`,
    puuid,
    name: puuid,
    side: 100,
    isSpectator: false,
    mainRole: null,
    secondaryRole: null,
    roleOverride: null,
    r: 1200,
    n: 0,
    gamesTonight: 0,
    lastSitOutAt: null,
    ...overrides,
  };
}

function pool(count: number, from = 0): PoolMember[] {
  return Array.from({ length: count }, (_, index) => member(`p${String(from + index).padStart(2, '0')}`));
}

describe('compareForSitOut', () => {
  it('sits whoever has played the most tonight', () => {
    const busy = member('a', { gamesTonight: 3 });
    const rested = member('b', { gamesTonight: 1 });
    expect(compareForSitOut(busy, rested)).toBeLessThan(0);
    expect(compareForSitOut(rested, busy)).toBeGreaterThan(0);
  });

  it('between equals, sits whoever has gone longest without sitting', () => {
    const longAgo = member('a', { lastSitOutAt: 1_000 });
    const recent = member('b', { lastSitOutAt: 9_000 });
    expect(compareForSitOut(longAgo, recent)).toBeLessThan(0);
  });

  it('sits someone who has never sat out before someone who has', () => {
    const never = member('z', { lastSitOutAt: null });
    const once = member('a', { lastSitOutAt: 1 });
    expect(compareForSitOut(never, once)).toBeLessThan(0);
  });

  it('breaks the last tie on puuid, so the answer never depends on member order', () => {
    expect(compareForSitOut(member('a'), member('b'))).toBeLessThan(0);
    expect(compareForSitOut(member('b'), member('a'))).toBeGreaterThan(0);
    expect(compareForSitOut(member('a'), member('a'))).toBe(0);
  });
});

describe('selectTen', () => {
  it('plays all ten when exactly ten are around, and nobody sits', () => {
    const selection = selectTen(pool(10));
    expect(selection.playing).toHaveLength(10);
    expect(selection.sitters).toEqual([]);
  });

  it('sits the player with the most games tonight', () => {
    const around = [...pool(10), member('busy', { gamesTonight: 2 })];
    const selection = selectTen(around);

    expect(selection.sitters.map((m) => m.puuid)).toEqual(['busy']);
    expect(selection.playing).toHaveLength(10);
    expect(selection.playing.some((m) => m.puuid === 'busy')).toBe(false);
    expect(selection.tiedOnGames).toBe(false);
  });

  it('sits two when twelve are around, most games first', () => {
    const around = [...pool(10), member('busy', { gamesTonight: 4 }), member('busier', { gamesTonight: 5 })];
    expect(selectTen(around).sitters.map((m) => m.puuid)).toEqual(['busier', 'busy']);
  });

  it('falls back to the sit-out clock when everyone has played the same', () => {
    const around = [
      ...pool(10).map((m, i) => ({ ...m, lastSitOutAt: 5_000 + i })),
      member('waited', { lastSitOutAt: 100 }),
    ];
    const selection = selectTen(around);

    expect(selection.sitters.map((m) => m.puuid)).toEqual(['waited']);
    // M2.15's copy switches to "longest since they last sat out" on exactly this.
    expect(selection.tiedOnGames).toBe(true);
  });

  it('treats a spectator as one of the people who are here', () => {
    // Nine on teams and one watching is a ten-player night: the spectator plays.
    const around = [...pool(9), member('watcher', { side: null, isSpectator: true })];
    const selection = selectTen(around);

    expect(selection.playing.map((m) => m.puuid)).toContain('watcher');
    expect(selection.sitters).toEqual([]);
  });

  it('refuses to guess when fewer than ten are around', () => {
    expect(() => selectTen(pool(9))).toThrow(SelectionError);
  });
});

/**
 * M14.43, lead ruling 2026-10-03: until a real client shows a spectator host still gets the
 * end-of-game block, the rotation never seats out the player whose companion hosts the lobby.
 */
describe('selectTen never seats out the host', () => {
  it('the host plus exactly ten others: the host plays and the next in line sits', () => {
    // The host is first in the rotation by every rule (most games tonight).
    const around = [...pool(10), member('host', { gamesTonight: 9, isHost: true })];
    const selection = selectTen(around);

    expect(selection.playing.map((m) => m.puuid)).toContain('host');
    expect(selection.playing).toHaveLength(10);
    // Without the host, the first of the others by the comparator: all tied, so puuid order.
    expect(selection.sitters.map((m) => m.puuid)).toEqual(['p00']);
  });

  it('with twelve around, the two sitters are the first two who are not the host', () => {
    const around = [
      ...pool(9),
      member('host', { gamesTonight: 5, isHost: true }),
      member('busy', { gamesTonight: 4 }),
      member('busier', { gamesTonight: 3 }),
    ];
    expect(selectTen(around).sitters.map((m) => m.puuid)).toEqual(['busy', 'busier']);
  });

  it('a host in the spectator slot is moved in, and the seat plan pairs them with a sitter', () => {
    const around = [
      ...pool(10).map((m, i) => ({ ...m, lastSitOutAt: 5_000 + i })),
      member('host', { side: null, isSpectator: true, lastSitOutAt: null, isHost: true }),
    ];
    const selection = selectTen(around);

    expect(selection.playing.map((m) => m.puuid)).toContain('host');
    expect(selection.sitters.map((m) => m.puuid)).toEqual(['p00']);
    expect(planSeats(selection).map((move) => [move.mover.puuid, move.sitter?.puuid])).toEqual([
      ['host', 'p00'],
    ]);
  });

  it('changes nothing when the host would have played anyway, or nobody is marked', () => {
    const plain = [...pool(10), member('busy', { gamesTonight: 2 })];
    const hosted = plain.map((m) => (m.puuid === 'p03' ? { ...m, isHost: true } : m));
    expect(selectTen(hosted)).toEqual({
      ...selectTen(plain),
      playing: selectTen(plain).playing.map((m) => (m.puuid === 'p03' ? { ...m, isHost: true } : m)),
    });
    expect(selectTen(hosted).sitters.map((m) => m.puuid)).toEqual(['busy']);
  });

  it('keeps the playing ten in sit-out order and never more or fewer than ten', () => {
    for (let extra = 0; extra <= 5; extra += 1) {
      const around = [...pool(10 + extra), member('host', { gamesTonight: 7, isHost: true })];
      const selection = selectTen(around);
      expect(selection.playing).toHaveLength(10);
      expect(selection.sitters).toHaveLength(extra + 1);
      expect(selection.playing.map((m) => m.puuid)).toContain('host');
      const sorted = [...selection.playing].sort(compareForSitOut);
      expect(selection.playing).toEqual(sorted);
    }
  });
});

describe('planSeats', () => {
  it('pairs each sitter with the spectator taking their slot, in order', () => {
    const around = [
      ...pool(10),
      member('watcher', { side: null, isSpectator: true }),
      member('busy', { gamesTonight: 3 }),
    ];
    // Twelve around: `busy` sits on games, and one of the ten sits after them.
    const selection = selectTen(around);
    const moves = planSeats(selection);

    expect(selection.sitters.map((m) => m.puuid)).toEqual(['busy', 'p00']);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.mover.puuid).toBe('watcher');
    expect(moves[0]?.sitter?.puuid).toBe('busy');
  });

  it('names a lone mover when ten are around and one of them is watching', () => {
    const around = [...pool(9), member('watcher', { side: null, isSpectator: true })];
    const moves = planSeats(selectTen(around));

    // Nobody sits, but somebody still has to take the open slot (M2.15's `Seats` field).
    expect(moves).toHaveLength(1);
    expect(moves[0]?.mover.puuid).toBe('watcher');
    expect(moves[0]?.sitter).toBeNull();
  });

  it('is empty when everyone is already in the right seat', () => {
    expect(planSeats(selectTen(pool(10)))).toEqual([]);
  });

  it('does not pair a sitter who was already spectating', () => {
    // Twelve around, two of them watching, and both watchers happen to sit: nobody moves.
    const around = [
      ...pool(10),
      member('watcherA', { side: null, isSpectator: true, gamesTonight: 9 }),
      member('watcherB', { side: null, isSpectator: true, gamesTonight: 9 }),
    ];
    const selection = selectTen(around);

    expect(selection.sitters.map((m) => m.puuid)).toEqual(['watcherA', 'watcherB']);
    expect(planSeats(selection)).toEqual([]);
  });
});
