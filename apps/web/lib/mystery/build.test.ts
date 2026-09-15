import { describe, expect, it } from 'vitest';
import { type BuildGame, type BuildSeat, buildChallenge, planChallenge } from './build';
import type { SelectAvoid } from './select';

/**
 * The rotation, the fallback and the shared memory (M8.4), with no database in the room.
 *
 * Every assertion here is one of the brief's acceptance criteria: one challenge a day
 * following the date's parity with the kind decided once and handed back to be stored (1),
 * the standout scored by `performanceScores` and by nothing written in this directory (4),
 * yesterday's answer in either game barred from today's in either game (6), and an award day
 * with nothing scorable falling back to a Daily Mystery without moving tomorrow (7).
 */

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const NOBODY: SelectAvoid = { recentGameIds: new Set(), recentPlayerIds: new Set() };

function seat(index: number, overrides: Partial<BuildSeat> = {}): BuildSeat {
  return {
    playerId: `player-${index}`,
    side: index < 5 ? 100 : 200,
    role: ROLES[index % 5] ?? 'mid',
    championId: 100 + index,
    championName: `Champion${index}`,
    kills: 4 + index,
    deaths: 4,
    assists: 6,
    gold: 11_000 + index * 100,
    damageToChamps: 18_000 + index * 250,
    cs: 150 + index,
    visionScore: 18 + index,
    damageSelfMitigated: 20_000 + index * 300,
    damageToObjectives: 4_000 + index * 120,
    damageTaken: 25_000,
    longestLivedS: 600,
    ...overrides,
  };
}

function game(index: number, overrides: Partial<BuildGame> = {}): BuildGame {
  return {
    id: `game-${index}`,
    startedAt: new Date(Date.UTC(2026, 8, 1 + index, 20, 0, 0)),
    durationS: 1_800,
    isRift: true,
    seats: Array.from({ length: 10 }, (_, i) => seat(i)),
    ...overrides,
  };
}

/** A window of real customs: every one of them scorable by both games. */
const games = (): BuildGame[] => [game(0), game(1), game(2), game(3)];

/** The same window as it looked before M7.7: no vision score anywhere. */
function beforeM77(): BuildGame[] {
  return games().map((row) => ({
    ...row,
    seats: row.seats.map((s) => ({
      ...s,
      visionScore: null,
      damageSelfMitigated: null,
      damageToObjectives: null,
    })),
  }));
}

function day(offset: number): string {
  return new Date(Date.UTC(2026, 8, 14) + offset * 86_400_000).toISOString().slice(0, 10);
}

describe('planChallenge: the rotation', () => {
  it('alternates the two games over fourteen consecutive days, one a day', () => {
    const kinds = Array.from(
      { length: 14 },
      (_, i) => planChallenge({ dayKey: day(i), games: games(), avoid: NOBODY })?.kind,
    );
    expect(kinds).toEqual([
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
      'mystery',
      'award',
    ]);
  });

  it('hands the kind back to be stored rather than leaving it to be re-read off the date', () => {
    const built = planChallenge({ dayKey: day(1), games: games(), avoid: NOBODY });
    expect(built?.kind).toBe('award');
    // The award categories are disjoint from the five Daily Mystery ones, which is how the
    // per-kind check constraint in migration 0016 can be written at all.
    expect(['disaster', 'monster', 'farming', 'raid_boss', 'ghost']).not.toContain(built?.category);
  });

  it('is the same answer twice for the same day, so two first visitors cannot fork it', () => {
    const first = planChallenge({ dayKey: day(1), games: games(), avoid: NOBODY });
    const second = planChallenge({ dayKey: day(1), games: games(), avoid: NOBODY });
    expect(first?.playerId).toBe(second?.playerId);
    expect(first?.gameId).toBe(second?.gameId);
    expect(first?.suspectIds).toEqual(second?.suspectIds);
  });
});

describe('planChallenge: the fallback', () => {
  it('falls back to a Daily Mystery when an award day has nothing scorable', () => {
    const built = planChallenge({ dayKey: day(1), games: beforeM77(), avoid: NOBODY });
    expect(built?.kind).toBe('mystery');
  });

  it('does not shift the rotation: the day after a fallback is whatever the parity says', () => {
    expect(planChallenge({ dayKey: day(1), games: beforeM77(), avoid: NOBODY })?.kind).toBe('mystery');
    expect(planChallenge({ dayKey: day(2), games: beforeM77(), avoid: NOBODY })?.kind).toBe('mystery');
    // And the next award day is still an award day once the window has scorable games again.
    expect(planChallenge({ dayKey: day(3), games: games(), avoid: NOBODY })?.kind).toBe('award');
  });

  it('gives nothing at all only when neither game can be built', () => {
    expect(planChallenge({ dayKey: day(1), games: [], avoid: NOBODY })).toBeNull();
    expect(planChallenge({ dayKey: day(0), games: [], avoid: NOBODY })).toBeNull();
  });

  it('refuses ARAM for the award and falls back, because a vision-weighted score means nothing there', () => {
    const aram = games().map((row) => ({ ...row, isRift: false }));
    const built = planChallenge({ dayKey: day(1), games: aram, avoid: NOBODY });
    expect(built?.kind).toBe('mystery');
  });

  it('refuses a game too short to be a Daily Mystery for the award too', () => {
    const short = games().map((row) => ({ ...row, durationS: 300 }));
    expect(buildChallenge({ dayKey: day(1), games: short, avoid: NOBODY }, 'award')).toBeNull();
  });
});

describe('planChallenge: one memory for two games', () => {
  it('will not make yesterday’s answer today’s answer, whichever game each day was', () => {
    const award = planChallenge({ dayKey: day(1), games: games(), avoid: NOBODY });
    expect(award).not.toBeNull();
    const next = planChallenge({
      dayKey: day(2),
      games: games(),
      avoid: {
        recentGameIds: new Set([award?.gameId ?? '']),
        recentPlayerIds: new Set([award?.playerId ?? '']),
      },
    });
    expect(next).not.toBeNull();
    expect(next?.kind).toBe('mystery');
    expect(next?.playerId).not.toBe(award?.playerId);
    expect(next?.gameId).not.toBe(award?.gameId);
  });

  it('keeps a mystery answer out of the next award day as well', () => {
    const mystery = planChallenge({ dayKey: day(0), games: games(), avoid: NOBODY });
    const award = planChallenge({
      dayKey: day(1),
      games: games(),
      avoid: {
        recentGameIds: new Set([mystery?.gameId ?? '']),
        recentPlayerIds: new Set([mystery?.playerId ?? '']),
      },
    });
    expect(award?.kind).toBe('award');
    expect(award?.playerId).not.toBe(mystery?.playerId);
  });
});

describe('the award card', () => {
  const window = (): BuildGame[] => {
    const rows = games();
    const first = rows[0] as BuildGame;
    first.seats[6] = seat(6, { role: 'adc', damageToChamps: 96_000, gold: 24_000 });
    return [first];
  };

  it('is about the player core scores highest, with the six suspects from that game', () => {
    const built = buildChallenge({ dayKey: day(1), games: window(), avoid: NOBODY }, 'award');
    expect(built?.kind).toBe('award');
    expect(built?.playerId).toBe('player-6');
    expect(built?.suspectIds).toHaveLength(6);
    expect(built?.suspectIds).toContain('player-6');
    const roster = new Set((window()[0] as BuildGame).seats.map((s) => s.playerId));
    for (const id of built?.suspectIds ?? []) expect(roster.has(id)).toBe(true);
  });

  it('opens on the stat that stood out and never repeats it as a clue', () => {
    const built = buildChallenge({ dayKey: day(1), games: window(), avoid: NOBODY }, 'award');
    expect(built?.category).toBe('damage');
    expect(built?.hook.lines[0]).toEqual({ label: 'Damage', value: '96.0k' });
    expect(built?.clues.map((clue) => clue.type)).not.toContain('damage');
  });

  it('walks from the rest of the scoreboard to the role, the champion and the history', () => {
    const built = buildChallenge({ dayKey: day(1), games: window(), avoid: NOBODY }, 'award');
    expect(built?.clues.map((clue) => clue.type)).toEqual(['gold', 'cs', 'role', 'champion', 'historical']);
    expect(built?.clues.map((clue) => clue.revealOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it('still hides the answer: nothing in the hook or the clues is a name', () => {
    const built = buildChallenge({ dayKey: day(1), games: window(), avoid: NOBODY }, 'award');
    const printed = JSON.stringify([built?.hook, built?.clues]);
    expect(printed).not.toContain('player-6');
  });
});

describe('the mystery card is what it was', () => {
  it('still scores on scorePerformance and still prefers Rift', () => {
    const built = buildChallenge({ dayKey: day(0), games: games(), avoid: NOBODY }, 'mystery');
    expect(built?.kind).toBe('mystery');
    expect(['disaster', 'monster', 'farming', 'raid_boss', 'ghost']).toContain(built?.category);
    expect(built?.hook.lines.at(-1)?.label).toBe('Game');
  });

  it('takes an ARAM game when Rift has nothing, exactly as M5.32 wrote it', () => {
    const aram = games().map((row) => ({ ...row, isRift: false }));
    const built = buildChallenge({ dayKey: day(0), games: aram, avoid: NOBODY }, 'mystery');
    expect(built).not.toBeNull();
  });
});
