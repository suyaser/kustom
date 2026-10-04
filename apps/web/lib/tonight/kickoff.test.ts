import { winProbability } from '@customs/core';
import type { KickoffRow } from '@customs/db/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extraMember, workedKickoff, workedMembers, workedTeams } from '../testing/tonightFixtures';
import { workedPuuid } from '../testing/workedExample';
import { kickoffView, readKickoff, swappedRun, viewerKickoffSeat } from './kickoff';

/** M21.5: the in-game block's teams from the kickoff record (M21.4). */
describe('kickoffView', () => {
  it('rolled: the split on its sides, its roles, its odds', () => {
    const { kickoff, teams } = workedKickoff('rolled');
    expect(teams).not.toBeNull();
    expect(kickoff.kind).toBe('rolled');
    expect(kickoff.swapped).toBe(false);
    expect(kickoff.blue.map((seat) => [seat.puuid, seat.role])).toEqual(
      teams?.blue.map((seat) => [seat.puuid, seat.role]),
    );
    expect(kickoff.red.map((seat) => seat.role)).toEqual(['top', 'jungle', 'mid', 'adc', 'support']);
    expect(kickoff.blueWinProb).toBe(teams?.blueWinProb);
    expect(kickoff.sitters).toEqual([]);
  });

  it('rolled on swapped sides: each team on its real side, roles kept, odds turned round', () => {
    const { kickoff, teams } = workedKickoff('swapped');
    expect(kickoff.swapped).toBe(true);
    expect(kickoff.blue.map((seat) => seat.puuid)).toEqual(teams?.red.map((seat) => seat.puuid));
    expect(kickoff.red.map((seat) => seat.puuid)).toEqual(teams?.blue.map((seat) => seat.puuid));
    expect(kickoff.blue.every((seat) => seat.role !== null)).toBe(true);
    expect(kickoff.blueWinProb).toBeCloseTo(1 - (teams?.blueWinProb ?? 0), 12);
  });

  it('custom: the moved players on their real sides, no roles on a changed side, the stored odds', () => {
    const { kickoff, record, members } = workedKickoff('custom');
    if (record.kind === 'rolled') throw new Error('expected custom');
    expect(kickoff.kind).toBe('custom');
    expect(kickoff.red.map((seat) => seat.puuid)).toContain(workedPuuid('Theo'));
    expect(kickoff.blue.map((seat) => seat.puuid)).toContain(workedPuuid('Yuki'));
    // Both sides changed: no role anywhere, highest Rating first.
    for (const side of [kickoff.blue, kickoff.red]) {
      expect(side.every((seat) => seat.role === null && !seat.offRole)).toBe(true);
      const ratings = side.map((seat) => seat.rating);
      expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
    }
    expect(kickoff.blueWinProb).toBe(record.blueWinProb);
    // The fixture stored what M21.4 stores: core's odds over the summed Ratings.
    expect(record.blueWinProb).toBe(kickoff.blueWinProb);
    expect(new Set(members.map((m) => m.side))).toEqual(new Set([100, 200]));
  });

  it('custom with one side unchanged: that side keeps the split roles, the other has none', () => {
    const sitter = extraMember({ isSpectator: false });
    const members = [...workedMembers(), sitter];
    const teams = workedTeams({ members, sitters: [sitter] });
    const out = teams.red[0]?.puuid ?? '';
    const record = {
      kind: 'custom' as const,
      blue: teams.blue.map((seat) => seat.puuid),
      red: teams.red.map((seat) => (seat.puuid === out ? sitter.puuid : seat.puuid)),
      at: '2026-09-08T20:07:00.000Z',
      blueWinProb: 0.47,
      oddsModel: 'kustom' as const,
    };
    const view = kickoffView(record, teams, members);
    expect(view.blue.map((seat) => seat.role)).toEqual(teams.blue.map((seat) => seat.role));
    expect(view.red.every((seat) => seat.role === null)).toBe(true);
    expect(view.red.map((seat) => seat.puuid)).toContain(sitter.puuid);
    // The one who was dropped is a sitter now; the sitter who came in is not.
    expect(view.sitters.map((member) => member.puuid)).toEqual([out]);
    expect(view.blueWinProb).toBe(0.47);
  });

  it('unrolled: no split, no roles, the stored odds', () => {
    const { kickoff, teams, record } = workedKickoff('unrolled');
    expect(teams).toBeNull();
    expect(kickoff.kind).toBe('unrolled');
    expect([...kickoff.blue, ...kickoff.red].every((seat) => seat.role === null)).toBe(true);
    expect(kickoff.blueWinProb).toBe(record.kind === 'unrolled' ? record.blueWinProb : Number.NaN);
  });

  it('a rolled record whose split cannot be read has no odds', () => {
    const { record, members } = workedKickoff('rolled');
    expect(kickoffView(record, null, members).blueWinProb).toBeNull();
  });

  it('a kickoff player with no member row is drawn as 1200 with no name', () => {
    const record = {
      kind: 'unrolled' as const,
      blue: ['ghost-a'],
      red: ['ghost-b'],
      at: '2026-09-08T20:07:00.000Z',
      blueWinProb: winProbability(1200, 1200),
      oddsModel: 'kustom' as const,
    };
    const view = kickoffView(record, null, []);
    expect(view.blue[0]).toMatchObject({ puuid: 'ghost-a', name: null, role: null, rating: 1200 });
  });
});

describe('viewerKickoffSeat', () => {
  it('the players who moved are on their real sides, with no role on a changed side', () => {
    const { kickoff } = workedKickoff('custom');
    expect(viewerKickoffSeat(kickoff, workedPuuid('Yuki'))).toEqual({ side: 'blue', role: null });
    expect(viewerKickoffSeat(kickoff, workedPuuid('Theo'))).toEqual({ side: 'red', role: null });
    expect(viewerKickoffSeat(kickoff, 'nobody')).toBeNull();
    expect(viewerKickoffSeat(kickoff, null)).toBeNull();
  });

  it('rolled: the split role on the real side', () => {
    expect(viewerKickoffSeat(workedKickoff('swapped').kickoff, workedPuuid('Theo'))).toEqual({
      side: 'red',
      role: 'support',
    });
  });
});

describe('swappedRun', () => {
  it('turns every split round and leaves the rest', () => {
    const teams = workedTeams();
    const turned = swappedRun(teams.stored);
    turned.forEach((split, index) => {
      const original = teams.stored[index];
      expect(split.blue).toBe(original?.red);
      expect(split.red).toBe(original?.blue);
      expect(split.blueWinProb).toBeCloseTo(1 - (original?.blueWinProb ?? 0), 12);
      expect(split.gap).toBe(original?.gap);
      expect(split.isChosen).toBe(original?.isChosen);
    });
  });
});

describe('readKickoff', () => {
  afterEach(() => vi.restoreAllMocks());
  const none: KickoffRow = {
    kickoff_kind: null,
    kickoff_blue: null,
    kickoff_red: null,
    kickoff_swapped: false,
    kickoff_blue_win_prob: null,
    kickoff_odds_model: null,
    kickoff_at: null,
  };

  it('no record: null, nothing logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readKickoff(none, 'lobby-1')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a row this build cannot read: null, and logged with the lobby id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const row: KickoffRow = {
      ...none,
      kickoff_kind: 'custom',
      kickoff_blue: ['a', 'b'],
      kickoff_red: ['c'],
      kickoff_blue_win_prob: 0.5,
      kickoff_odds_model: 'kustom',
      kickoff_at: '2026-09-08T20:07:00.000Z',
    };
    expect(readKickoff(row, 'lobby-9')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /lobby lobby-9 has a kickoff record this build cannot read/,
    );
  });
});
