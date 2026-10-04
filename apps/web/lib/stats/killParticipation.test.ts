import { describe, expect, it } from 'vitest';
import { killParticipation, killParticipationPercent } from './killParticipation';

/** M14.77: kill participation is never over 100%, and a side whose rows do not add up is skipped. */
describe('killParticipation', () => {
  it('is takedowns over team kills', () => {
    expect(killParticipation(4, 6, 20)).toBe(0.5);
    expect(killParticipationPercent(15, 6, 25)).toBe(84);
  });

  it('is exactly 100% when the player took part in every kill', () => {
    expect(killParticipation(3, 7, 10)).toBe(1);
    expect(killParticipationPercent(3, 7, 10)).toBe(100);
  });

  it('skips a game whose team kills are below the player’s kills plus assists', () => {
    expect(killParticipation(5, 8, 12)).toBeNull();
    expect(killParticipationPercent(5, 8, 12)).toBeNull();
  });

  it('skips a side with no kills', () => {
    expect(killParticipation(0, 0, 0)).toBeNull();
    expect(killParticipationPercent(0, 0, 0)).toBeNull();
  });

  it('never leaves 0 to 100, for any small input', () => {
    for (let kills = 0; kills <= 6; kills += 1) {
      for (let assists = 0; assists <= 6; assists += 1) {
        for (let team = 0; team <= 14; team += 1) {
          const percent = killParticipationPercent(kills, assists, team);
          if (percent === null) continue;
          expect(percent).toBeGreaterThanOrEqual(0);
          expect(percent).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
