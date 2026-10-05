import { describe, expect, it } from 'vitest';
import { switchSideMoves } from '../commands/switchSide';
import { lobbyRosterKey } from '../ingest/lobby';
import {
  extraMember,
  lobbyView,
  seatedOnTheirSides,
  snapshot,
  tapeEntry,
  workedKickoff,
  workedMembers,
  workedResult,
  workedTeams,
} from '../testing/tonightFixtures';
import { workedPuuid } from '../testing/workedExample';
import { fillingSentence } from './copy';
import { announcement } from './screen';
import { ANNOUNCE_GAME_STARTED } from './screenCopy';
import {
  anySeatOnTheWrongSide,
  hasNamelessRow,
  lobbyAround,
  rollRosterKey,
  rollStage,
  tonightHeader,
  tonightState,
} from './state';

/**
 * The status strip, state by state (M3.18, `05-design.md`, "Copy — final (product
 * 2026-09-09)").
 *
 * These are the strings a friend reads in a dark room and the ones product argued over twice,
 * so they are pinned here character for character rather than inferred from the page: four of
 * the five headlines and five of the sentences are deliberate edits to what the code said
 * before this task, and a test that only checked "some text" would have let them drift back.
 */

const header = (state: Parameters<typeof tonightHeader>[0]) => tonightHeader(state);
const stripOf = (input: Parameters<typeof tonightState>[0]) => header(tonightState(input));

describe('the strip headline, one per state', () => {
  it('idle: NOBODY IN YET, no count, the shipped sentence, no live pill', () => {
    const strip = stripOf(snapshot(null));

    expect(strip.headline).toBe('NOBODY IN YET');
    expect(strip.count).toBeNull();
    expect(strip.sentence).toBe(
      'When ten are in a custom lobby with Kustom running, an admin rolls and the bot picks the teams.',
    );
    expect(strip.live).toBe(false);
  });

  it('filling: the count and IN THE LOBBY, with the pill lit', () => {
    const strip = stripOf(snapshot(lobbyView({ members: workedMembers(9) })));

    expect(strip.headline).toBe('IN THE LOBBY');
    expect(strip.count).toBe(9);
    expect(strip.sentence).toBe('One more to go.');
    expect(strip.live).toBe(true);
  });

  it('balanced: TEAMS ARE SET, and a sentence that does not repeat it', () => {
    const strip = stripOf(snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })));

    expect(strip.headline).toBe('TEAMS ARE SET');
    expect(strip.sentence).toBe('Split by rating and role. Nobody picked the teams.');
    expect(strip.live).toBe(true);
  });

  it('in game: IN GAME, and what happens when it ends', () => {
    const strip = stripOf(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })));

    expect(strip.headline).toBe('IN GAME');
    expect(strip.sentence).toBe('Ratings move when it ends.');
    expect(strip.live).toBe(true);
  });

  it('finished: GAME OVER, the ratings are in, and the pill is gone', () => {
    const strip = stripOf(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
    );

    expect(strip.headline).toBe('GAME OVER');
    expect(strip.sentence).toBe('Ratings are updated. The board has the rest.');
    expect(strip.live).toBe(false);
  });

  it('finished but unrated: GAME OVER and an empty sentence slot, never an apology', () => {
    const withTeams = stripOf(
      snapshot(
        lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ rated: false }) }),
      ),
    );
    expect(withTeams.headline).toBe('GAME OVER');
    expect(withTeams.sentence).toBe('');

    // The narrower case: a finished lobby with a result and no stored split at all.
    const withoutTeams = stripOf(
      snapshot(lobbyView({ status: 'finished', teams: null, result: workedResult({ rated: false }) })),
    );
    expect(withoutTeams.headline).toBe('GAME OVER');
    expect(withoutTeams.sentence).toBe('');
  });

  it('M23.2, 05-design.md 15.3: a voided game says why, not the plain not-rated sentence', () => {
    const voided = (voidReason: string | null) =>
      stripOf(
        snapshot(
          lobbyView({
            status: 'finished',
            teams: workedTeams(),
            result: workedResult({
              rated: false,
              durationS: 632,
              stamp: { rule: null, rated: false, rift: true, check: null, voidReason },
            }),
          }),
        ),
      ).sentence;
    expect(voided('early-end')).toBe('Ended early, so no Rating change.');
    expect(voided('admin')).toBe('Voided, so no Rating change.');
    expect(voided(null)).toBe('Not rated, so no Rating change.');
  });

  it('a remake is no result (05-design.md 15.1): REMAKE, its sentence, said once, teams or none', () => {
    const remake = workedResult({ rated: false, durationS: 240 });
    for (const teams of [workedTeams(), null]) {
      const state = tonightState(snapshot(lobbyView({ status: 'finished', teams, result: remake })));
      const strip = header(state);
      expect(strip.headline).toBe('REMAKE');
      expect(strip.sentence).toBe('No result, so no Rating change.');
      expect(strip.live).toBe(false);
      expect(announcement(state, strip, null)).toBe('Remake. No result.');
    }
    const played = tonightState(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
    );
    expect(announcement(played, header(played), null)).toBe('Red wins.');
  });

  it('teams are set: the side and role the viewer was given, or nothing for someone not playing', () => {
    const state = tonightState(snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })));
    expect(announcement(state, header(state), workedPuuid('Theo'))).toMatch(
      /^Teams are set\. Blue \d+ percent, Red \d+ percent\. You're on Blue, support\.$/,
    );
    expect(announcement(state, header(state), null)).toMatch(/percent\.$/);
  });
});

/**
 * Whether the side line is on the page (M4.11, M4.3's acceptance check 7).
 *
 * The predicate is the page's half of a rule the server already has in
 * `lib/commands/switchSide.ts`, so the last test here holds the two against each other: the
 * queue and the line must not disagree about who is in the wrong seat.
 */
describe('is anybody on the wrong side', () => {
  it('says yes until somebody has told us where the ten are sitting', () => {
    // The default fixture: a split nobody has moved for, every `liveSide` null.
    expect(anySeatOnTheWrongSide(workedTeams())).toBe(true);
  });

  it('says no once every seat is on the side the split gave it', () => {
    expect(anySeatOnTheWrongSide(seatedOnTheirSides(workedTeams()))).toBe(false);
  });

  it('says yes for one stray out of ten, on either card', () => {
    const teams = workedTeams();
    const blue = teams.blue[3]?.puuid ?? '';
    const red = teams.red[1]?.puuid ?? '';

    expect(anySeatOnTheWrongSide(seatedOnTheirSides(teams, { [blue]: 200 }))).toBe(true);
    expect(anySeatOnTheWrongSide(seatedOnTheirSides(teams, { [red]: 100 }))).toBe(true);
  });

  /**
   * **`null` is not a match.** The queue skips a seat with no side — a spectator cannot be
   * toggled onto a team — and `switchSide.ts` says the line on the page is what tells that
   * person to move. So the one case where the two rules differ is the one where the page has to
   * be the louder of the two.
   */
  it('says yes for a seat the client has not placed, which the queue skips', () => {
    const teams = workedTeams();
    const unplaced = teams.blue[0]?.puuid ?? '';
    const seated = seatedOnTheirSides(teams, { [unplaced]: null });

    expect(anySeatOnTheWrongSide(seated)).toBe(true);
    expect(movesFor(seated)).toHaveLength(0);
  });

  it('agrees with the queue everywhere the queue has an opinion', () => {
    const teams = workedTeams();
    const stray = teams.red[4]?.puuid ?? '';

    const matched = seatedOnTheirSides(teams);
    expect(movesFor(matched)).toHaveLength(0);
    expect(anySeatOnTheWrongSide(matched)).toBe(false);

    const mismatched = seatedOnTheirSides(teams, { [stray]: 100 });
    expect(movesFor(mismatched).map((move) => move.puuid)).toEqual([stray]);
    expect(anySeatOnTheWrongSide(mismatched)).toBe(true);
  });

  /** The same teams, read the way `queueSwitchSideForBalance` reads them. */
  function movesFor(teams: ReturnType<typeof workedTeams>) {
    return switchSideMoves(
      { blue: teams.blue, red: teams.red },
      [...teams.blue, ...teams.red].map((seat) => ({
        playerId: seat.puuid,
        puuid: seat.puuid,
        side: seat.liveSide,
      })),
    );
  }
});

describe('the sentence while the lobby fills', () => {
  it('says the fact once at zero, and never repeats the headline', () => {
    expect(fillingSentence(0)).toBe('Nobody in the lobby yet.');
  });

  it('counts the seats still to fill, in words, because the digit is already 44px above it', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((around) => fillingSentence(around))).toEqual([
      'Nine more to go.',
      'Eight more to go.',
      'Seven more to go.',
      'Six more to go.',
      'Five more to go.',
      'Four more to go.',
      'Three more to go.',
      'Two more to go.',
      'One more to go.',
    ]);
  });

  it('waits at ten and explains the eleventh', () => {
    // Not `Teams in a moment.`: since the 2026-10-03 roll trigger, ten in does not by itself
    // produce teams, so the line names the press that does.
    expect(fillingSentence(10)).toBe('Waiting on an admin to roll the teams.');
    expect(fillingSentence(10)).not.toMatch(/in a moment/i);
    // Past ten the rotation sits people out, and the teams are still waiting on the roll
    // (2026-10-03): the sentence says both, not only the sit-out.
    expect(fillingSentence(11)).toBe('Ten play, the rest sit out. Waiting on an admin to roll the teams.');
    expect(fillingSentence(14)).toBe('Ten play, the rest sit out. Waiting on an admin to roll the teams.');
  });

  it('names the admins at ten and past it, and never before', () => {
    expect(fillingSentence(10, ['Yasser'])).toBe('Waiting on Yasser to roll the teams.');
    expect(fillingSentence(10, ['Yasser', 'Omar'])).toBe('Waiting on Yasser or Omar to roll the teams.');
    expect(fillingSentence(10, ['Yasser', 'Omar', 'Sara'])).toBe(
      'Waiting on Yasser, Omar or Sara to roll the teams.',
    );
    expect(fillingSentence(12, ['Yasser', 'Omar'])).toBe(
      'Ten play, the rest sit out. Waiting on Yasser or Omar to roll the teams.',
    );
    // Before ten there is nothing to roll, so nobody is named.
    expect(fillingSentence(9, ['Yasser'])).toBe('One more to go.');
    expect(fillingSentence(0, ['Yasser'])).toBe('Nobody in the lobby yet.');
  });

  it('falls back to `an admin` with nobody to name', () => {
    // No admin on record.
    expect(fillingSentence(10, [])).toBe('Waiting on an admin to roll the teams.');
    // An admin row with no name: `Waiting on Someone` names nobody.
    expect(fillingSentence(10, [null, '  '])).toBe('Waiting on an admin to roll the teams.');
    expect(fillingSentence(10, [null, 'Omar'])).toBe('Waiting on Omar to roll the teams.');
    // Four names do not fit the two lines the strip reserves.
    expect(fillingSentence(10, ['A', 'B', 'C', 'D'])).toBe('Waiting on an admin to roll the teams.');
  });

  it('is the sentence the strip carries, for the lobby it is given', () => {
    const eleven = snapshot(lobbyView({ members: [...workedMembers(), extraMember()] }));
    const strip = stripOf(eleven);

    expect(strip.count).toBe(11);
    expect(strip.sentence).toBe('Ten play, the rest sit out. Waiting on an admin to roll the teams.');
    expect(tonightHeader(tonightState(eleven), ['Yasser']).sentence).toBe(
      'Ten play, the rest sit out. Waiting on Yasser to roll the teams.',
    );
  });

  it('names the admins in the strip at ten, and leaves every other state alone', () => {
    const ten = snapshot(lobbyView({ members: workedMembers() }));
    expect(tonightHeader(tonightState(ten), ['Yasser', 'Omar']).sentence).toBe(
      'Waiting on Yasser or Omar to roll the teams.',
    );
    const balanced = snapshot(lobbyView({ status: 'balanced', teams: workedTeams() }));
    expect(tonightHeader(tonightState(balanced), ['Yasser']).sentence).toBe(stripOf(balanced).sentence);
    expect(tonightHeader(tonightState(snapshot(null)), ['Yasser']).sentence).toBe(
      stripOf(snapshot(null)).sentence,
    );
  });
});

describe('the name re-read timer sees the tape (M11.2)', () => {
  it('fires on an idle page whose only Someone is a tape sitter', () => {
    const idle = tonightState(snapshot(lobbyView({ status: 'dropped', teams: workedTeams() })));
    expect(idle.kind).toBe('idle');
    expect(hasNamelessRow(idle, [])).toBe(false);
    expect(hasNamelessRow(idle, [tapeEntry({ sitters: ['Yuki', null] })])).toBe(true);
    expect(hasNamelessRow(idle, [tapeEntry({ sitters: ['Yuki', 'Omar'] })])).toBe(false);
  });

  it('still fires for the primary block alone', () => {
    const filling = tonightState(
      snapshot(lobbyView({ members: [...workedMembers(9), extraMember({ name: null })] })),
    );
    expect(hasNamelessRow(filling, [])).toBe(true);
  });
});

describe('the roll (2026-10-03)', () => {
  it('offers a press only where the route can do something', () => {
    expect(rollStage(lobbyView({ members: [] }))).toBe('waiting');
    expect(rollStage(lobbyView({ members: workedMembers(9) }))).toBe('waiting');
    expect(rollStage(lobbyView({ members: workedMembers() }))).toBe('ready');
    expect(rollStage(lobbyView({ members: [...workedMembers(), extraMember()] }))).toBe('ready');
    // A roll that claimed the lobby and died before its splits: the next press repairs it.
    expect(rollStage(lobbyView({ status: 'balanced', teams: null }))).toBe('repair');
    expect(rollStage(lobbyView({ status: 'balanced', teams: workedTeams() }))).toBe('none');
    expect(rollStage(lobbyView({ status: 'in_game', teams: null }))).toBe('none');
    expect(rollStage(lobbyView({ status: 'finished', teams: null }))).toBe('none');
  });

  it('counts people, not rows: a duplicated member is still nine', () => {
    const nine = workedMembers(9);
    const first = nine[0];
    if (first === undefined) throw new Error('fixture has no members');
    expect(rollStage(lobbyView({ members: [...nine, { ...first }] }))).toBe('waiting');
    // M14.45: the header counts the same people the stage does, never `10`.
    const doubled = lobbyView({ members: [...nine, { ...first }] });
    expect(lobbyAround(doubled.members)).toBe(9);
    expect(tonightHeader(tonightState(snapshot(doubled))).count).toBe(9);
  });

  it('sends the key the route recomputes, whatever order the page drew them in', () => {
    const members = [...workedMembers(), extraMember()];
    const puuids = members.map((member) => member.puuid);

    expect(rollRosterKey(members)).toBe(lobbyRosterKey(puuids));
    expect(rollRosterKey([...members].reverse())).toBe(lobbyRosterKey(puuids));
    // Spectators are in it, duplicates are not.
    expect(rollRosterKey(members)).toContain(extraMember().puuid);
    expect(rollRosterKey([...members, ...members])).toBe(lobbyRosterKey(puuids));
    expect(rollRosterKey([])).toBe(lobbyRosterKey([]));
    expect(rollRosterKey([])).toBe('');
  });
});

/** M21.5: an in-game lobby with a kickoff record is the in-game block, whatever its kind. */
describe('in game with the kickoff teams (M21.5)', () => {
  const inGame = (kind: Parameters<typeof workedKickoff>[0], rated = true) => {
    const { members, teams, kickoff } = workedKickoff(kind);
    return snapshot(
      lobbyView({
        status: 'in_game',
        members,
        teams,
        kickoff,
        startedAt: '2026-09-08T20:07:00.000Z',
        lock: { standing: 'fearless', mode: { id: 'fearless' }, rated },
      }),
    );
  };

  it.each(['rolled', 'swapped', 'custom', 'unrolled'] as const)('%s: the in-game block, IN GAME', (kind) => {
    const snap = inGame(kind);
    const state = tonightState(snap);
    expect(state.kind).toBe('in-game');
    if (state.kind !== 'in-game') return;
    expect(state.game).toBe(snap.lobby?.kickoff);
    expect(state.teams).toBe(snap.lobby?.teams);
    const strip = header(state);
    expect(strip).toEqual({
      headline: 'IN GAME',
      count: null,
      sentence: 'Ratings move when it ends.',
      live: true,
    });
    expect(announcement(state, strip, null)).toBe(ANNOUNCE_GAME_STARTED);
  });

  it('unrolled: never a filling lobby, no count, no roll stage', () => {
    const snap = inGame('unrolled');
    const strip = stripOf(snap);
    expect(strip.headline).not.toMatch(/IN THE LOBBY/);
    expect(strip.count).toBeNull();
    expect(snap.lobby === null ? null : rollStage(snap.lobby)).toBe('none');
  });

  it('names the side the viewer started on: the split side, or the side they really play', () => {
    const theo = workedPuuid('Theo');
    const said = (kind: Parameters<typeof workedKickoff>[0]) => {
      const state = tonightState(inGame(kind));
      return announcement(state, header(state), theo);
    };
    // Theo is the split's Blue support; in a custom game he traded onto Red, where he has no role.
    expect(said('rolled')).toBe("Game started. You're on Blue, support.");
    expect(said('swapped')).toBe("Game started. You're on Red, support.");
    expect(said('custom')).toBe("Game started. You're on Red.");
    // A viewer not playing hears the bare sentence.
    const state = tonightState(inGame('custom'));
    expect(announcement(state, header(state), 'not-in-this-game')).toBe(ANNOUNCE_GAME_STARTED);
    // No kickoff record: the split's side.
    const teams = tonightState(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })));
    expect(announcement(teams, header(teams), theo)).toBe("Game started. You're on Blue, support.");
  });

  it('a not-rated lock keeps its rule line in the strip', () => {
    expect(stripOf(inGame('custom', false)).sentence).toBe('Not rated, so no Rating change.');
  });

  it('no kickoff record: exactly as before (the split, or a filling lobby with no split)', () => {
    expect(tonightState(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() }))).kind).toBe('teams');
    expect(tonightState(snapshot(lobbyView({ status: 'in_game', teams: null }))).kind).toBe('filling');
    expect(tonightState(snapshot(lobbyView({ status: 'in_game', teams: null, kickoff: null }))).kind).toBe(
      'filling',
    );
  });

  it('a nameless player on a kickoff team counts for the name re-read', () => {
    const snap = inGame('custom');
    const lobby = snap.lobby;
    if (lobby?.kickoff == null) throw new Error('fixture');
    const kickoff = {
      ...lobby.kickoff,
      red: lobby.kickoff.red.map((seat, i) => (i === 0 ? { ...seat, name: null } : seat)),
    };
    const state = tonightState({ ...snap, lobby: { ...lobby, kickoff } });
    expect(hasNamelessRow(state, [])).toBe(true);
    expect(hasNamelessRow(tonightState(snap), [])).toBe(false);
  });
});
