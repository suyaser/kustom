import { describe, expect, it } from 'vitest';
import { gateGame, gateRatedGame } from './fold';

const ten = [
  { playerId: 'p1', puuid: 'u1', side: 100 as const },
  { playerId: 'p2', puuid: 'u2', side: 100 as const },
  { playerId: 'p3', puuid: 'u3', side: 100 as const },
  { playerId: 'p4', puuid: 'u4', side: 100 as const },
  { playerId: 'p5', puuid: 'u5', side: 100 as const },
  { playerId: 'p6', puuid: 'u6', side: 200 as const },
  { playerId: 'p7', puuid: 'u7', side: 200 as const },
  { playerId: 'p8', puuid: 'u8', side: 200 as const },
  { playerId: 'p9', puuid: 'u9', side: 200 as const },
  { playerId: 'p10', puuid: 'u10', side: 200 as const },
];

describe('gateRatedGame', () => {
  it('rates CLASSIC and a missing mode', () => {
    expect(gateRatedGame(ten, 1_800, 'CLASSIC').ok).toBe(true);
    expect(gateRatedGame(ten, 1_800, null).ok).toBe(true);
    expect(gateRatedGame(ten, 1_800, undefined).ok).toBe(true);
  });

  it('does not rate Howling Abyss even when the mode says CLASSIC', () => {
    expect(gateRatedGame(ten, 1_800, 'CLASSIC', 12)).toEqual({ ok: false, reason: 'game-mode' });
    expect(gateRatedGame(ten, 1_800, 'KIWI', 12)).toEqual({ ok: false, reason: 'game-mode' });
    expect(gateRatedGame(ten, 1_800, null, 11).ok).toBe(true);
  });

  it('names a short ARAM remake as duration, not game-mode', () => {
    expect(gateRatedGame(ten, 300, 'ARAM')).toEqual({ ok: false, reason: 'duration' });
    expect(gateGame(ten, 300)).toEqual({ ok: false, reason: 'duration' });
  });
});
