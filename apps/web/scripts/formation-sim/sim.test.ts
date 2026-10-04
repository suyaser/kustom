import { KUSTOM_START } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { coreBalance, makeWorld, metrics, mulberry32, portBalance, run, type SimSeat } from './sim';

/**
 * The evenness simulation's port (M18.13) is only evidence if it is core's balancer with one rule
 * swapped. With core's own rules (flat drop, capped variety) it must choose exactly what core's
 * `balance()` chooses, lanes and score included, on lobbies with fill protection, a last split
 * and a previous game's teammates.
 */

function lobby(rng: () => number, base: number): {
  ten: SimSeat[];
  lastBlue: Set<number> | null;
  pairs: Set<string>;
} {
  const ids = new Set<number>();
  while (ids.size < 10) ids.add(Math.floor(rng() * 20));
  const ten = [...ids]
    .sort((a, b) => a - b)
    .map((id): SimSeat => {
      const n = Math.floor(rng() * 30);
      const main = Math.floor(rng() * 5);
      let sec = Math.floor(rng() * 5);
      while (sec === main) sec = Math.floor(rng() * 5);
      return {
        id,
        n,
        r: n === 0 ? KUSTOM_START : base + Math.round(rng() * 300 * 100) / 100,
        main,
        sec,
        sinceFill: rng() < 0.5 ? null : Math.floor(rng() * 6),
      };
    });
  const shuffled = [...ten].sort(() => rng() - 0.5);
  const lastBlue = rng() < 0.3 ? new Set(shuffled.slice(0, 5).map((s) => s.id)) : null;
  // A previous game of the whole twenty: two random fives, so tonight's ten carry some of its pairs.
  const prev = Array.from({ length: 20 }, (_, i) => i).sort(() => rng() - 0.5);
  const pairs = new Set<string>();
  for (const side of [prev.slice(0, 5), prev.slice(5, 10)])
    for (let x = 0; x < 5; x += 1)
      for (let y = x + 1; y < 5; y += 1) {
        const a = side[x] as number;
        const b = side[y] as number;
        pairs.add(a < b ? `${a}-${b}` : `${b}-${a}`);
      }
  return { ten, lastBlue, pairs };
}

describe('formation-sim port', () => {
  it("chooses exactly core's split under core's rules", () => {
    const rng = mulberry32(18_13);
    for (let i = 0; i < 300; i += 1) {
      const { ten, lastBlue, pairs } = lobby(rng, 1100);
      const core = coreBalance(ten, lastBlue, pairs);
      const port = portBalance(ten, lastBlue, pairs, { strength: 'flat', variety: true });
      expect(port.blue).toEqual(core.blue);
      expect(port.red).toEqual(core.red);
      expect(port.score).toBeCloseTo(core.score, 9);
      expect(port.offRoleCount).toBe(core.offRoleCount);
    }
  });

  it('is deterministic per seed', () => {
    const world = makeWorld(3, 0);
    expect(metrics(run(world, 'after', 40))).toEqual(metrics(run(world, 'after', 40)));
  });
});
