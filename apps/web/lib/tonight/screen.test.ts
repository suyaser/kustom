import { describe, expect, it } from 'vitest';
import {
  lobbyView,
  seatedOnTheirSides,
  snapshot,
  tapeEntry,
  workedMembers,
  workedResult,
  workedTeams,
} from '../testing/tonightFixtures';
import { workedPuuid } from '../testing/workedExample';
import { type CalibrationGameRow, calibrationGames } from './calibration';
import {
  chosenSplit,
  gameNumber,
  playedAsRolled,
  receiptNames,
  seatStanding,
  stillNeeded,
  viewerMoveTo,
  viewerRegionSide,
  viewerSeat,
} from './screen';
import { answerMoveLine, elapsedLabel, rosterCount, stripDateLine, wouldSitOutLine } from './screenCopy';
import { tonightState } from './state';

describe('the 2.0 tonight helpers (M14.9)', () => {
  it('names every member in full for the receipt, with no 32-character cut', () => {
    const long = 'A'.repeat(40);
    const members = workedMembers(2).map((member, i) => (i === 0 ? { ...member, name: long } : member));
    const names = receiptNames(lobbyView({ members }));
    expect(names[workedPuuid('Bilal')]).toBe(long);
  });

  it('leaves the nameless out so the receipt prints the shared fallback word', () => {
    const members = workedMembers(1).map((member) => ({ ...member, name: null }));
    expect(receiptNames(lobbyView({ members }))).toEqual({});
  });

  it('knows whether the ten played as rolled', () => {
    const teams = workedTeams();
    const chosen = chosenSplit(teams.stored);
    if (chosen === null) throw new Error('fixture');
    expect(playedAsRolled(workedResult(), chosen)).toBe(true);
    const swapped = workedResult();
    const [a] = swapped.blue;
    const [b] = swapped.red;
    if (a === undefined || b === undefined) throw new Error('fixture');
    expect(
      playedAsRolled(
        { ...swapped, blue: [b, ...swapped.blue.slice(1)], red: [a, ...swapped.red.slice(1)] },
        chosen,
      ),
    ).toBe(false);
  });

  it('numbers the game from the tape, and none when idle', () => {
    const snap = snapshot(lobbyView({ status: 'open' }), {
      tape: [tapeEntry(), tapeEntry({ result: null })],
    });
    expect(gameNumber(snap, tonightState(snap))).toBe(2);
    const idle = snapshot(null);
    expect(gameNumber(idle, tonightState(idle))).toBeNull();
    // M14.45: 5.10's short form, so the live tag never re-wraps the line.
    expect(stripDateLine('Tuesday 8 September', 2)).toBe('Tue 8 Sep, game 2 tonight');
    expect(stripDateLine('Saturday 3 October', null)).toBe('Sat 3 Oct');
    expect(stripDateLine('not a label', null)).toBe('not a label');
  });

  it('finds the viewer on their side', () => {
    const teams = workedTeams();
    const seat = teams.red[0];
    if (seat === undefined) throw new Error('fixture');
    expect(viewerSeat(teams, seat.puuid)).toEqual({ side: 'red', role: seat.role });
    expect(viewerSeat(teams, 'nobody')).toBeNull();
  });

  it('M21.9: the region side is where the client has the viewer, else the split side', () => {
    const teams = workedTeams();
    const seat = teams.red[0];
    if (seat === undefined) throw new Error('fixture');
    // No side known: the split's.
    expect(viewerRegionSide(teams, seat.puuid)).toBe('red');
    // A red seat still sitting on blue: blue's region is theirs; after moving, red's.
    expect(viewerRegionSide(seatedOnTheirSides(teams, { [seat.puuid]: 100 }), seat.puuid)).toBe('blue');
    expect(viewerRegionSide(seatedOnTheirSides(teams), seat.puuid)).toBe('red');
    expect(viewerRegionSide(seatedOnTheirSides(teams, { [seat.puuid]: null }), seat.puuid)).toBe('red');
    // Not seated, or nobody looking: none.
    expect(viewerRegionSide(teams, 'nobody')).toBeNull();
    expect(viewerRegionSide(teams, null)).toBeNull();
    expect(viewerRegionSide(null, seat.puuid)).toBeNull();
  });

  describe('M21.13: where to move while balanced', () => {
    const teams = workedTeams();
    const blue = teams.blue[0];
    const red = teams.red[0];
    if (blue === undefined || red === undefined) throw new Error('fixture');

    it('right side: no instruction, for either side', () => {
      expect(viewerMoveTo(seatedOnTheirSides(teams), blue.puuid)).toBeNull();
      expect(viewerMoveTo(seatedOnTheirSides(teams), red.puuid)).toBeNull();
    });

    it('wrong side: the split side, either way round', () => {
      expect(viewerMoveTo(seatedOnTheirSides(teams, { [blue.puuid]: 200 }), blue.puuid)).toBe('blue');
      expect(viewerMoveTo(seatedOnTheirSides(teams, { [red.puuid]: 100 }), red.puuid)).toBe('red');
      // Somebody else on the wrong side changes nothing for the viewer.
      expect(viewerMoveTo(seatedOnTheirSides(teams, { [red.puuid]: 100 }), blue.puuid)).toBeNull();
    });

    it('side unknown (a spectator slot, or no member row): no instruction', () => {
      expect(viewerMoveTo(seatedOnTheirSides(teams, { [blue.puuid]: null }), blue.puuid)).toBeNull();
      expect(viewerMoveTo({ ...teams, blue: teams.blue.map((s) => ({ ...s, liveSide: null })) }, blue.puuid)).toBeNull();
    });

    it('not seated in the split, or nobody looking: no instruction', () => {
      expect(viewerMoveTo(seatedOnTheirSides(teams), 'nobody')).toBeNull();
      expect(viewerMoveTo(seatedOnTheirSides(teams), null)).toBeNull();
      expect(viewerMoveTo(null, blue.puuid)).toBeNull();
    });

    it("says where they are and where to go, with and without a role (product's copy)", () => {
      expect(answerMoveLine('red', 'blue', 'top')).toBe('YOU on RED. Move to BLUE to play top.');
      expect(answerMoveLine('blue', 'red', 'support')).toBe('YOU on BLUE. Move to RED to play support.');
      expect(answerMoveLine('red', 'blue', null)).toBe('YOU on RED. Move to BLUE.');
    });
  });

  it('lists the lanes nobody mains, in lane order, only short of ten', () => {
    const members = workedMembers(2); // Bilal adc, Hana top
    expect(stillNeeded(members)).toEqual(['jungle', 'mid', 'support']);
    expect(stillNeeded(workedMembers())).toEqual([]);
    expect(stillNeeded(members.map((m) => ({ ...m, mainRole: null, secondaryRole: null })))).toEqual([]);
  });

  it('says new at 0, settling under 10, nothing after, and nothing when unknown', () => {
    expect(seatStanding(0)).toBe('new');
    expect(seatStanding(4)).toBe('settling');
    expect(seatStanding(10)).toBe('settled');
    expect(seatStanding(null)).toBe('unknown');
  });

  it('prints whole minutes, never a clock', () => {
    const start = '2026-09-08T20:00:00.000Z';
    expect(elapsedLabel(start, Date.parse(start) + 30_000)).toBe('Just started');
    expect(elapsedLabel(start, Date.parse(start) + 23 * 60_000 + 59_000)).toBe('23 min in');
  });

  it('says who would sit out, in order', () => {
    expect(wouldSitOutLine(['Deniz'])).toBe('If the teams rolled now, Deniz would sit out.');
    expect(wouldSitOutLine(['Deniz', 'Mo', 'Sam'])).toBe(
      'If the teams rolled now, Deniz, Mo and then Sam would sit out.',
    );
    expect(wouldSitOutLine([])).toBeNull();
    expect(rosterCount(12)).toBe('10/10 +2');
  });
});

describe('which games the calibration line counts (STRATEGY §4.8)', () => {
  const blue = ['b1', 'b2', 'b3', 'b4', 'b5'];
  const red = ['r1', 'r2', 'r3', 'r4', 'r5'];
  const puuidOf = new Map([...blue, ...red].map((id) => [`p-${id}`, id]));
  const rows = (r: number | null = 1500) => [
    ...blue.map((id) => ({ player_id: `p-${id}`, side: 100, r_before: r, r_after: r })),
    ...red.map((id) => ({ player_id: `p-${id}`, side: 200, r_before: r, r_after: r })),
  ];
  const split = {
    lobby_id: 'l1',
    blue: blue.map((puuid) => ({ puuid, role: 'top' })),
    red: red.map((puuid) => ({ puuid, role: 'top' })),
    blue_win_prob: 0.6,
    odds_model: 'kustom',
  };
  const game = (over: Partial<CalibrationGameRow> = {}): CalibrationGameRow => ({
    id: 'g1',
    lobby_id: 'l1',
    winning_side: 100,
    gameMode: 'CLASSIC',
    game_players: rows(),
    ...over,
  });

  it('counts a rated Rift game played as rolled', () => {
    expect(calibrationGames([game()], [split], puuidOf)).toEqual([{ blueWinProb: 0.6, blueWon: true }]);
  });

  it('drops ARAM, unrated, split-less and changed-teams games', () => {
    expect(calibrationGames([game({ gameMode: 'ARAM' })], [split], puuidOf)).toEqual([]);
    expect(calibrationGames([game({ game_players: rows(null) })], [split], puuidOf)).toEqual([]);
    expect(calibrationGames([game({ lobby_id: 'other' })], [split], puuidOf)).toEqual([]);
    const swapped = { ...split, blue: [...split.blue.slice(1), { puuid: 'r1', role: 'top' }] };
    expect(calibrationGames([game()], [swapped], puuidOf)).toEqual([]);
  });

  it("counts the split's teams on swapped sides with the odds flipped (M21.7, the game page's rule)", () => {
    const turned = { ...split, blue: split.red, red: split.blue };
    const [counted] = calibrationGames([game()], [turned], puuidOf);
    expect(counted?.blueWinProb).toBeCloseTo(0.4, 10);
    expect(counted?.blueWon).toBe(true);
  });

  it('counts only Kustom rolls (M18.6): the line restarts at the switch', () => {
    expect(calibrationGames([game()], [{ ...split, odds_model: 'openskill' }], puuidOf)).toEqual([]);
  });

  it('drops a game played not rated (M15.3), even with rating columns on it', () => {
    expect(calibrationGames([game({ rated: false })], [split], puuidOf)).toEqual([]);
    expect(calibrationGames([game({ rated: true })], [split], puuidOf)).toHaveLength(1);
  });
});
