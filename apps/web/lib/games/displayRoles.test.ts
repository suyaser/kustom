import { describe, expect, it } from 'vitest';
import { playerFacts } from '../stats/rawFacts';
import { tenPlayerGame } from '../testing/statsFixtures';
import { displayRolesForSide, withDisplayRoles } from './displayRoles';

describe('withDisplayRoles', () => {
  it('keeps a stored role and fills a backfill from the end-of-game position', () => {
    const game = tenPlayerGame({
      at: '2026-09-09T20:00:00Z',
      winner: 100,
      blue: [
        { key: 'hana', role: 'top' },
        { key: 'iris', role: null },
        { key: 'omar', role: null },
        { key: 'lena', role: null },
        { key: 'theo', role: null },
      ],
      rawFacts: {
        bans: [],
        byPuuid: {
          'u-iris': playerFacts({ role: 'jungle' }),
          'u-omar': playerFacts({ timelineLane: 'MIDDLE', timelineRole: 'SOLO' }),
          'u-lena': playerFacts({ timelineLane: 'BOTTOM', timelineRole: 'CARRY' }),
          'u-theo': playerFacts({ timelineLane: 'BOTTOM', timelineRole: 'SUPPORT' }),
        },
      },
    });

    const blue = withDisplayRoles(game).filter((row) => row.side === 100);
    expect(Object.fromEntries(blue.map((row) => [row.puuid, row.role]))).toEqual({
      'u-hana': 'top',
      'u-iris': 'jungle',
      'u-omar': 'mid',
      'u-lena': 'adc',
      'u-theo': 'support',
    });
  });

  it('treats Smite as jungle and the leftover lane as the missing role', () => {
    const game = tenPlayerGame({
      at: '2026-09-09T20:00:00Z',
      winner: 100,
      blue: [
        { key: 'hana', role: 'top' },
        { key: 'iris', role: null, cs: 180 },
        { key: 'omar', role: 'mid' },
        { key: 'lena', role: 'adc' },
        { key: 'theo', role: 'support' },
      ],
      rawFacts: {
        bans: [],
        byPuuid: { 'u-iris': playerFacts({ smite: true }) },
      },
    });

    expect(withDisplayRoles(game).find((row) => row.puuid === 'u-iris')?.role).toBe('jungle');
  });

  it('does not map JUNGLE+NONE, which the fixtures proved is often a laner', () => {
    const game = tenPlayerGame({
      at: '2026-09-09T20:00:00Z',
      winner: 100,
      blue: [
        { key: 'hana', role: null, cs: 244 },
        { key: 'iris', role: 'jungle' },
        { key: 'omar', role: 'mid' },
        { key: 'lena', role: 'adc' },
        { key: 'theo', role: 'support' },
      ],
      rawFacts: {
        bans: [],
        byPuuid: { 'u-hana': playerFacts({ timelineLane: 'JUNGLE', timelineRole: 'NONE' }) },
      },
    });

    expect(withDisplayRoles(game).find((row) => row.puuid === 'u-hana')?.role).toBe('top');
  });

  it('marks the one sub-50 CS seat as support when the others farmed', () => {
    const seats = [
      { key: 'hana', cs: 210 },
      { key: 'iris', cs: 180 },
      { key: 'omar', cs: 200 },
      { key: 'lena', cs: 220 },
      { key: 'theo', cs: 30 },
    ].map((seat) => ({
      playerId: `p-${seat.key}`,
      puuid: `u-${seat.key}`,
      side: 100 as const,
      role: null,
      rBefore: 25,
      rAfter: 25,
      championId: null,
      kills: 0,
      deaths: 0,
      assists: 0,
      gold: 0,
      damageToChamps: 0,
      cs: seat.cs,
      visionScore: null,
      damageSelfMitigated: null,
      damageToObjectives: null,
    }));

    const roles = displayRolesForSide(seats, null, 'CLASSIC');
    expect(roles.get('u-theo')).toBe('support');
    expect(roles.get('u-hana')).toBeNull();
  });

  it('leaves ARAM seats as stored — Howling Abyss has no lanes to recover', () => {
    const game = tenPlayerGame({
      at: '2026-09-09T20:00:00Z',
      winner: 100,
      gameMode: 'ARAM',
      blue: [{ key: 'hana', role: null }],
      rawFacts: {
        bans: [],
        byPuuid: { 'u-hana': playerFacts({ role: 'top', smite: true }) },
      },
    });

    expect(withDisplayRoles(game).find((row) => row.puuid === 'u-hana')?.role).toBeNull();
  });
});
