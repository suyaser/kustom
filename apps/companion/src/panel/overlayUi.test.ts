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
  pickerModel(groups: unknown): {
    label: string;
    options: { groupId: string; label: string; disabled: boolean }[];
    selectedGroupId: string | null;
    disabled: boolean;
  } | null;
  groupMain(groups: unknown): { only: string | null; lead: string };
}

function loadAppJs(): AppJsContext {
  const appJsPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'desktop', 'overlay', 'app.js');
  const source = readFileSync(appJsPath, 'utf8');

  const stubElement = {
    style: {},
    textContent: '',
    innerHTML: '',
    hidden: false,
    addEventListener: () => undefined,
  };
  const sandbox: Record<string, unknown> = {
    document: { getElementById: () => stubElement },
    fetch: () => Promise.resolve(),
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

describe('the group picker and group sentences (M13.8)', () => {
  const picker = {
    label: 'Posting tonight to:',
    selectedGroupId: 'g1',
    options: [
      { groupId: 'g1', label: 'Customs Night', disabled: false },
      { groupId: 'g2', label: 'Duo Club (no host token)', disabled: true },
    ],
  };

  it("has no picker without two groups, and shows the engine's label and options with them", () => {
    const { pickerModel } = loadAppJs();
    expect(pickerModel(null)).toBeNull();
    expect(pickerModel({ picker: null, noGroups: false, error: null, switching: false })).toBeNull();
    const model = pickerModel({ picker, noGroups: false, error: null, switching: false });
    expect(model?.label).toBe('Posting tonight to:');
    expect(model?.options.map((option) => option.label)).toEqual([
      'Customs Night',
      'Duo Club (no host token)',
    ]);
    expect(model?.options[1]?.disabled).toBe(true);
    expect(model?.disabled).toBe(false);
  });

  it('disables the select while Host switches', () => {
    const { pickerModel } = loadAppJs();
    expect(pickerModel({ picker, noGroups: false, error: null, switching: true })?.disabled).toBe(true);
  });

  it('zero memberships is the one sentence and nothing else', () => {
    const { groupMain } = loadAppJs();
    const view = groupMain({ picker: null, noGroups: true, error: null, switching: false });
    expect(view.only).toBe(
      '<p class="empty">Play a game with your group, or ask them for the join link.</p>',
    );
  });

  it('a refused token is a box that leads main, the sentence escaped', () => {
    const { groupMain } = loadAppJs();
    const view = groupMain({
      picker: null,
      noGroups: false,
      error: 'This token no longer works for A&B. Ask an admin for a new one.',
      switching: false,
    });
    expect(view.only).toBeNull();
    expect(view.lead).toBe(
      '<p class="error" role="alert">This token no longer works for A&amp;B. Ask an admin for a new one.</p>',
    );
    expect(groupMain(null)).toEqual({ only: null, lead: '' });
  });
});
