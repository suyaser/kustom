import { describe, expect, it } from 'vitest';
import {
  banListInGameLine,
  banListLine,
  bansAnnouncement,
  chipStatusText,
  type LobbyChip,
  lobbiesDateLine,
  panelHeadLine,
  switcherAnnouncement,
  tableLabels,
  withLobby,
} from './switcher';
import type { TableView } from './types';

const chip = (key: string, label: string, overrides: Partial<LobbyChip> = {}): LobbyChip => ({
  id: `row-${key}`,
  key,
  label,
  status: { kind: 'filling', count: 6 },
  mode: 'Normal',
  you: false,
  ...overrides,
});

const ANA = chip('a', "Ana's lobby");
const BO = chip('b', "Bo's lobby");

describe('chip status (14.4)', () => {
  const start = '2026-10-03T20:00:00.000Z';
  const at = (minutes: number) => Date.parse(start) + minutes * 60_000;
  it('every word', () => {
    expect(chipStatusText({ kind: 'filling', count: 12 }, 0)).toBe('12 in');
    expect(chipStatusText({ kind: 'teams' }, 0)).toBe('Teams set');
    expect(chipStatusText({ kind: 'no-kustom' }, 0)).toBe('No Kustom');
    expect(chipStatusText({ kind: 'won', side: 'red' }, 0)).toBe('Red won');
    expect(chipStatusText({ kind: 'in-game', startedAt: start }, at(0.5))).toBe('In game · just started');
    expect(chipStatusText({ kind: 'in-game', startedAt: start }, at(12.9))).toBe('In game · 12 min');
    expect(chipStatusText({ kind: 'in-game', startedAt: null }, 0)).toBe('In game');
  });
});

describe('labels (14.1)', () => {
  const table = (id: string, name: string | null, openedAt: string) =>
    ({ id, host: name === null ? null : { puuid: id, name }, openedAt }) as TableView;
  it("host names, the newer of a same name numbered, Lobby n with none, straight 's after an s", () => {
    const labels = tableLabels([
      table('t2', 'Ana', '2026-10-03T19:00:00.000Z'),
      table('t1', 'Ana', '2026-10-03T18:00:00.000Z'),
      table('t3', null, '2026-10-03T20:00:00.000Z'),
      table('t4', 'Chaos', '2026-10-03T20:30:00.000Z'),
    ]);
    expect([...labels.entries()].sort()).toEqual([
      ['t1', "Ana's lobby"],
      ['t2', "Ana's lobby 2"],
      ['t3', 'Lobby 3'],
      ['t4', "Chaos's lobby"],
    ]);
  });
});

describe('copy (14.11)', () => {
  it('both for two, every for three', () => {
    expect(lobbiesDateLine('Saturday 3 October', 2)).toBe('Sat 3 Oct, 2 lobbies');
    expect(banListLine(2)).toBe('One ban list for both lobbies.');
    expect(banListLine(3)).toBe('One ban list for every lobby.');
    expect(banListInGameLine(2)).toBe("This game's ten join the ban list for both lobbies when it ends.");
    expect(banListInGameLine(3)).toBe("This game's ten join the ban list for every lobby when it ends.");
    expect(panelHeadLine(2)).toBe('Both lobbies add to this list.');
    expect(panelHeadLine(3)).toBe('Every lobby adds to this list.');
  });

  it('the panel link keeps its lane and adds the lobby', () => {
    expect(withLobby('/g/customs/mode', 'x')).toBe('/g/customs/mode?lobby=x');
    expect(withLobby('/g/customs/mode?lane=top', 'x')).toBe('/g/customs/mode?lane=top&lobby=x');
  });
});

describe('the announcer (14.9)', () => {
  it('a second table goes live', () => {
    expect(
      switcherAnnouncement({ chips: [ANA], selected: ANA.id }, { chips: [ANA, BO], selected: ANA.id }, false),
    ).toBe("Bo's lobby is open too.");
  });

  it('never on a first render with nothing before', () => {
    expect(
      switcherAnnouncement({ chips: [], selected: null }, { chips: [ANA, BO], selected: ANA.id }, false),
    ).toBeNull();
  });

  it('a table ends, on screen or not', () => {
    expect(
      switcherAnnouncement({ chips: [ANA, BO], selected: BO.id }, { chips: [BO], selected: BO.id }, false),
    ).toBe("Ana's lobby has ended.");
    expect(
      switcherAnnouncement({ chips: [ANA, BO], selected: ANA.id }, { chips: [BO], selected: BO.id }, false),
    ).toBe("Ana's lobby has ended. Showing Bo's lobby.");
  });

  it('a tap that landed; a new game cycle (new row id, same party) is not a new lobby', () => {
    expect(
      switcherAnnouncement(
        { chips: [ANA, BO], selected: ANA.id },
        { chips: [ANA, BO], selected: BO.id },
        true,
      ),
    ).toBe("Showing Bo's lobby.");
    const next = { ...ANA, id: 'row-a2' };
    expect(
      switcherAnnouncement(
        { chips: [ANA, BO], selected: ANA.id },
        { chips: [next, BO], selected: next.id },
        false,
      ),
    ).toBeNull();
  });

  it("the viewer's own lobby, off screen, gets teams or a result", () => {
    const mine = { ...BO, you: true };
    expect(
      switcherAnnouncement(
        { chips: [ANA, mine], selected: ANA.id },
        { chips: [ANA, { ...mine, status: { kind: 'teams' } }], selected: ANA.id },
        false,
      ),
    ).toBe('Teams are set in your lobby.');
    expect(
      switcherAnnouncement(
        { chips: [ANA, { ...mine, status: { kind: 'in-game', startedAt: null } }], selected: ANA.id },
        { chips: [ANA, { ...mine, status: { kind: 'won', side: 'blue' } }], selected: ANA.id },
        false,
      ),
    ).toBe("Your lobby's game is over.");
    // On screen: the page's own sentence says it, not the switcher.
    expect(
      switcherAnnouncement(
        { chips: [ANA, mine], selected: mine.id },
        { chips: [ANA, { ...mine, status: { kind: 'teams' } }], selected: mine.id },
        false,
      ),
    ).toBeNull();
  });
});

describe('bans from the other lobby (14.9)', () => {
  it('says only what was added', () => {
    const bo = (count: number) => ({ count, label: "Bo's lobby" });
    expect(bansAnnouncement(null, bo(10))).toBe("10 more banned, from Bo's lobby.");
    expect(bansAnnouncement(bo(10), bo(20))).toBe("10 more banned, from Bo's lobby.");
    expect(bansAnnouncement(bo(10), bo(10))).toBeNull();
    expect(bansAnnouncement(bo(10), null)).toBeNull();
  });
});
