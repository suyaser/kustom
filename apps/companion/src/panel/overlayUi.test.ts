/**
 * The overlay panel (`desktop/overlay/app.js`) is a plain script served as-is to the
 * browser -- no bundler, no module system (see server.ts's baking comment). There is
 * no render test harness for it. This loads the real file into a sandboxed vm context
 * (stubbing the DOM bits it touches at load time) so its pure helpers can be unit
 * tested without dragging in jsdom.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Seat {
  puuid: string;
  with: { games: number; wins: number; losses: number } | null;
  against: { games: number; wins: number; losses: number } | null;
}

interface AppJsContext {
  fillReadiness(teams: { blue: unknown[]; red: unknown[] }): string;
  recordNote(seat: Seat): string | null;
}

function loadAppJs(): AppJsContext {
  const appJsPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'desktop', 'overlay', 'app.js');
  const source = readFileSync(appJsPath, 'utf8');

  const stubElement = { style: {}, textContent: '', innerHTML: '' };
  const sandbox: Record<string, unknown> = {
    document: { getElementById: () => stubElement },
    EventSource: class {
      onmessage: unknown = null;
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox as unknown as AppJsContext;
}

describe('fillReadiness', () => {
  it('counts each side against 5', () => {
    const { fillReadiness } = loadAppJs();
    const teams = { blue: [{}, {}, {}], red: [{}, {}] };
    expect(fillReadiness(teams)).toBe('Blue 3/5 · Red 2/5');
  });

  it('caps at 5 a side and handles empty rosters', () => {
    const { fillReadiness } = loadAppJs();
    expect(fillReadiness({ blue: [], red: [] })).toBe('Blue 0/5 · Red 0/5');
    expect(fillReadiness({ blue: new Array(5).fill({}), red: new Array(6).fill({}) })).toBe(
      'Blue 5/5 · Red 5/5',
    );
  });
});

describe('recordNote', () => {
  it('is a single count, not a with/against sentence', () => {
    const { recordNote } = loadAppJs();
    expect(recordNote({ puuid: 'a', with: { games: 3, wins: 2, losses: 1 }, against: null })).toBe('3 games');
    expect(recordNote({ puuid: 'a', with: null, against: { games: 1, wins: 0, losses: 1 } })).toBe('1 game');
  });

  it('renders nothing when there is too little history', () => {
    const { recordNote } = loadAppJs();
    expect(recordNote({ puuid: 'a', with: null, against: null })).toBeNull();
  });
});
