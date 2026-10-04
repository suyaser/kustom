import { randomInt } from 'node:crypto';
import type { Rng } from '@customs/core';

/**
 * The server's randomness for Spin and the region draw (M15.3): `node:crypto`, uniform in
 * `[0, 1)` at 2^-32 resolution, which is what core's `Rng` contract asks for. Server only: the
 * browser never chooses (R3), and `lib/clientGraph.test.ts` keeps `node:*` out of client modules.
 */
const SCALE = 2 ** 32;

export const serverRng: Rng = () => randomInt(0, SCALE) / SCALE;
