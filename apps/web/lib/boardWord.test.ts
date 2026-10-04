import { describe, expect, it } from 'vitest';
import * as adminHome from './admin/homeCopy';
import * as adminSections from './admin/sectionCopy';
import * as board from './board/copy';
import * as games from './games/copy';
import * as groupPages from './groups/pageCopy';
import * as landing from './landing/copy';
import * as receipt from './receipt/copy';
import * as shell from './shellCopy';
import * as stats from './stats/copy';
import * as tonight from './tonight/copy';
import * as screen from './tonight/screenCopy';

/**
 * M14.72 (flow audit): one word, Board. No string a web page prints says `leaderboard`; routes and
 * identifiers may keep it. (The Discord title, `Last week · board`, is `lib/discord/embeds.ts`'s
 * `BOARD_WORD`.)
 */

const MODULES = {
  adminHome,
  adminSections,
  board,
  games,
  groupPages,
  landing,
  receipt,
  shell,
  stats,
  tonight,
  screen,
};
const EXEMPT = new Set<string>();

/** Every string reachable from an export: constants, arrays and records (functions are not called). */
function strings(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) strings(item, `${path}[${index}]`, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) strings(inner, `${path}.${key}`, out);
  }
}

describe('the word Board (M14.72)', () => {
  it('no exported web copy says leaderboard', () => {
    const found: [string, string][] = [];
    for (const [name, mod] of Object.entries(MODULES)) {
      for (const [key, value] of Object.entries(mod)) {
        if (EXEMPT.has(`${name}.${key}`)) continue;
        strings(value, `${name}.${key}`, found);
      }
    }
    expect(found.length).toBeGreaterThan(100);
    const offenders = found.filter(([, text]) => /leader­?board/i.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('the board heading, the finished line and the landing step use it', () => {
    expect(board.BOARD_LABEL).toBe('Board');
    expect(tonight.FINISHED_SENTENCE).toBe('Ratings are updated. The board has the rest.');
    expect(landing.STEPS[2].body).toContain('The board updates.');
  });
});
