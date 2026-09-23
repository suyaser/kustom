import { describe, expect, it } from 'vitest';
import { shouldShowOverlay } from './phases.js';

describe('shouldShowOverlay', () => {
  it('shows on Lobby and ChampSelect', () => {
    expect(shouldShowOverlay('Lobby')).toBe(true);
    expect(shouldShowOverlay('ChampSelect')).toBe(true);
  });

  it('hides at GameStart and when the client is idle', () => {
    expect(shouldShowOverlay('GameStart')).toBe(false);
    expect(shouldShowOverlay('InProgress')).toBe(false);
    expect(shouldShowOverlay('None')).toBe(false);
    expect(shouldShowOverlay(null)).toBe(false);
  });
});
