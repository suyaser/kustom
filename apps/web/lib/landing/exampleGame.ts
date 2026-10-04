import type { Role } from '@customs/core';
import { EXAMPLE_NAMES, EXAMPLE_SPLITS } from './example';

/**
 * The landing hero's example game (docs/05-design.md section 12): the worked example's split 1
 * (`EXAMPLE_SPLITS[0]`, blue 54%) played out, red winning in 32:40. A fixture, captioned as one;
 * never live data (12.8). The real game lives in the Proof section's receipt.
 *
 * Each seat names its champion by numeric key (what the code keys on everywhere else) and by Data
 * Dragon id (the committed file's name, `components/landing/champions/<id>.webp`, cut by
 * `pnpm --filter web landing-champs`). The changes are illustrative whole numbers in M18's range
 * (11.3): winners positive, losers negative, none zero.
 */

export interface ExampleSeat {
  puuid: string;
  /** The worked example's name for the puuid (`EXAMPLE_NAMES`). */
  name: string;
  championKey: number;
  /** Data Dragon id at the pin, which is also the WebP file name. */
  ddragonId: string;
  /** Display name, the image's `alt` (12.6). */
  championName: string;
  /** The rating change shown, a signed whole number (RatingDelta formats it). */
  change: number;
}

export interface ExampleLane {
  role: Role;
  blue: ExampleSeat;
  red: ExampleSeat;
}

export interface ExampleGame {
  winner: 100 | 200;
  /** Shown as is, mono (12.3). */
  duration: string;
  blueWinProb: number;
  lanes: readonly ExampleLane[];
}

const SPLIT = EXAMPLE_SPLITS[0];
if (SPLIT === undefined) throw new Error('EXAMPLE_SPLITS has no split 1');

type Pick = Omit<ExampleSeat, 'puuid' | 'name'>;

/** 05-design 12.2's table, in lane order: [blue (lost), red (won)]. */
const PICKS: readonly (readonly [Pick, Pick])[] = [
  [
    { championKey: 86, ddragonId: 'Garen', championName: 'Garen', change: -18 },
    { championKey: 122, ddragonId: 'Darius', championName: 'Darius', change: 17 },
  ],
  [
    { championKey: 64, ddragonId: 'LeeSin', championName: 'Lee Sin', change: -21 },
    { championKey: 32, ddragonId: 'Amumu', championName: 'Amumu', change: 22 },
  ],
  [
    { championKey: 103, ddragonId: 'Ahri', championName: 'Ahri', change: -16 },
    { championKey: 157, ddragonId: 'Yasuo', championName: 'Yasuo', change: 15 },
  ],
  [
    { championKey: 222, ddragonId: 'Jinx', championName: 'Jinx', change: -19 },
    { championKey: 81, ddragonId: 'Ezreal', championName: 'Ezreal', change: 20 },
  ],
  [
    { championKey: 412, ddragonId: 'Thresh', championName: 'Thresh', change: -14 },
    { championKey: 99, ddragonId: 'Lux', championName: 'Lux', change: 13 },
  ],
];

export const EXAMPLE_GAME: ExampleGame = {
  winner: 200,
  duration: '32:40',
  blueWinProb: SPLIT.blueWinProb,
  lanes: PICKS.map(([blue, red], i) => {
    const b = SPLIT.blue[i];
    const r = SPLIT.red[i];
    if (b === undefined || r === undefined || b.role !== r.role) throw new Error(`split 1 has no lane ${i}`);
    const seat = (puuid: string, pick: Pick): ExampleSeat => ({
      puuid,
      name: EXAMPLE_NAMES[puuid] ?? puuid,
      ...pick,
    });
    return { role: b.role, blue: seat(b.puuid, blue), red: seat(r.puuid, red) };
  }),
};
