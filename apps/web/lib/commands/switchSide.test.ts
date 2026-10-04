import type { Split } from '@customs/core';
import type { SideValue } from '@customs/db';
import { describe, expect, it } from 'vitest';
import type { PoolMember } from '../ingest/selection';
import { switchSideMoves } from './switchSide';

/**
 * Who is on the wrong side, with no database in sight (M4.1/M4.3). Everything the queue decides
 * before it writes anything is this function, so it is tested as a function.
 */

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

function member(puuid: string, side: SideValue | null, isSpectator = false): PoolMember {
  return {
    playerId: `player-${puuid}`,
    puuid,
    name: puuid,
    side,
    isSpectator,
    mainRole: null,
    secondaryRole: null,
    roleOverride: null,
    r: 1200,
    n: 0,
    gamesTonight: 0,
    lastSitOutAt: null,
  };
}

/** Five puuids on blue, five on red, in lane order, exactly as core returns a split. */
function split(blue: readonly string[], red: readonly string[]): Split {
  return {
    blue: blue.map((puuid, index) => ({ puuid, role: ROLES[index] ?? 'top' })),
    red: red.map((puuid, index) => ({ puuid, role: ROLES[index] ?? 'top' })),
    gap: 12,
    blueWinProb: 0.5,
    score: 12,
    offRoleCount: 0,
  };
}

const BLUE = ['a1', 'a2', 'a3', 'a4', 'a5'];
const RED = ['b1', 'b2', 'b3', 'b4', 'b5'];

describe('switchSideMoves', () => {
  it('moves nobody when every seat already matches', () => {
    const playing = [...BLUE.map((p) => member(p, 100)), ...RED.map((p) => member(p, 200))];
    expect(switchSideMoves(split(BLUE, RED), playing)).toEqual([]);
  });

  it('moves exactly the two people the split swapped', () => {
    // The client has a5 on red and b5 on blue; the chosen split says the other way round.
    const playing = [
      ...['a1', 'a2', 'a3', 'a4'].map((p) => member(p, 100)),
      member('a5', 200),
      ...['b1', 'b2', 'b3', 'b4'].map((p) => member(p, 200)),
      member('b5', 100),
    ];

    expect(switchSideMoves(split(BLUE, RED), playing)).toEqual([
      { playerId: 'player-a5', puuid: 'a5', from: 200, to: 100 },
      { playerId: 'player-b5', puuid: 'b5', from: 100, to: 200 },
    ]);
  });

  it('never queues a spectator, whose side is null: a toggle cannot seat them', () => {
    const playing = [
      ...['a1', 'a2', 'a3', 'a4'].map((p) => member(p, 100)),
      member('a5', null, true),
      ...RED.map((p) => member(p, 200)),
    ];
    expect(switchSideMoves(split(BLUE, RED), playing)).toEqual([]);
  });

  it('never queues somebody the client has not placed on a side yet', () => {
    const playing = [
      ...['a1', 'a2', 'a3', 'a4'].map((p) => member(p, 100)),
      member('a5', null),
      ...RED.map((p) => member(p, 200)),
    ];
    expect(switchSideMoves(split(BLUE, RED), playing)).toEqual([]);
  });

  it('ignores anybody who is not in the chosen ten, however wrong their side is', () => {
    const playing = [
      ...BLUE.map((p) => member(p, 100)),
      ...RED.map((p) => member(p, 200)),
      // A sitter on blue while the split has nothing to say about them: never moved.
      member('sitter', 100),
    ];
    expect(switchSideMoves(split(BLUE, RED), playing)).toEqual([]);
  });

  it('is stable: blue in lane order, then red', () => {
    const playing = [...BLUE.map((p) => member(p, 200)), ...RED.map((p) => member(p, 100))];
    const moves = switchSideMoves(split(BLUE, RED), playing);
    expect(moves.map((move) => move.puuid)).toEqual([...BLUE, ...RED]);
    expect(moves.every((move) => move.from !== move.to)).toBe(true);
    expect(moves.slice(0, 5).every((move) => move.to === 100)).toBe(true);
    expect(moves.slice(5).every((move) => move.to === 200)).toBe(true);
  });
});
