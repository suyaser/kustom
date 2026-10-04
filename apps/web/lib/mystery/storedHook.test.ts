import { describe, expect, it } from 'vitest';
import { championDisplayName } from './champion';
import { HOOK_DURATION } from './copy';
import { parseStoredHook } from './ensure';

describe('parseStoredHook (M14.38 code review)', () => {
  it('re-derives a pre-2.0 hook clock time as minutes, the length line included', () => {
    const hook = parseStoredHook({
      kills: 2,
      deaths: 11,
      assists: 4,
      kda: '2 / 11 / 4',
      durationS: 21 * 60 + 46,
      durationLabel: '21:46',
      lines: [
        { label: 'Deaths', value: '11' },
        { label: HOOK_DURATION, value: '21:46' },
      ],
    });
    expect(hook?.durationLabel).toBe('21 min');
    expect(hook?.lines).toEqual([
      { label: 'Deaths', value: '11' },
      { label: HOOK_DURATION, value: '21 min' },
    ]);
  });

  it('still refuses a malformed hook', () => {
    expect(parseStoredHook({ kda: 1 })).toBeNull();
  });
});

describe('championDisplayName', () => {
  it("turns the client's Data Dragon id into the name a friend reads", () => {
    expect(championDisplayName('LeeSin')).toBe('Lee Sin');
    expect(championDisplayName('MonkeyKing')).toBe('Wukong');
    expect(championDisplayName('Ahri')).toBe('Ahri');
    expect(championDisplayName('NotAChampion')).toBe('NotAChampion');
  });
});
