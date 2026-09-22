import { describe, expect, it } from 'vitest';
import { LANE_ORDER } from '../laneOrder';
import { CHAMPION_LANES, championLane } from './lanes';
import { listChampions } from './names';

describe('champion lanes', () => {
  it('files every roster champion under one lane and names nobody else', () => {
    const roster = new Set(listChampions().map((champion) => champion.id));
    const filed = new Set(Object.keys(CHAMPION_LANES).map(Number));
    expect(filed).toEqual(roster);
    for (const id of roster) {
      expect(LANE_ORDER).toContain(championLane(id));
    }
    expect(championLane(12_345)).toBeNull();
  });
});
