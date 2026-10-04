import { describe, expect, it } from 'vitest';
import {
  afterRecord,
  chooseRule,
  chooseStanding,
  consumesRule,
  gameStamp,
  type LockedMode,
  lockAtRoll,
  type ModeState,
  nextGame,
  onlyRatedSinceRoll,
  type RecordedGame,
  setRated,
  startState,
} from './lifecycle';

const tanks = { id: 'class', tag: 'Tank' } as const;
const mages = { id: 'class', tag: 'Mage' } as const;
const fearless: ModeState = startState('fearless');

describe('the standing mode and the pending rule (D1)', () => {
  it('a group starts on its standing mode with no rule and no override', () => {
    expect(startState('normal')).toEqual({
      standing: 'normal',
      pending: null,
      ratedOverride: null,
      version: 0,
    });
    expect(nextGame(startState('normal'))).toEqual({ modeId: 'normal', rule: null, rated: true });
  });

  it('choosing a rule leaves the standing mode alone; the next game is the rule, not rated by default', () => {
    const state = chooseRule(fearless, tanks);
    expect(state.standing).toBe('fearless');
    expect(state.pending).toEqual(tanks);
    expect(nextGame(state)).toEqual({ modeId: 'class', rule: tanks, rated: false });
  });

  it('choosing Normal or Fearless sets the standing mode and clears a pending rule', () => {
    const state = chooseStanding(chooseRule(fearless, tanks), 'normal');
    expect(state.standing).toBe('normal');
    expect(state.pending).toBeNull();
    expect(nextGame(state)).toEqual({ modeId: 'normal', rule: null, rated: true });
  });

  it('every change moves the version (the compare-and-clear token)', () => {
    let state = fearless;
    const versions = [state.version];
    state = chooseRule(state, tanks);
    versions.push(state.version);
    state = setRated(state, true);
    versions.push(state.version);
    state = chooseStanding(state, 'fearless');
    versions.push(state.version);
    expect(new Set(versions).size).toBe(4);
  });
});

describe('the Rated switch (D5, R9: any mode, both ways)', () => {
  it('an admin can make a rule game rated and a Fearless game not rated', () => {
    expect(nextGame(setRated(chooseRule(fearless, tanks), true)).rated).toBe(true);
    expect(nextGame(setRated(fearless, false)).rated).toBe(false);
    expect(nextGame(setRated(chooseRule(fearless, { id: 'mirror' }), false)).rated).toBe(false);
  });

  it("choosing a mode or a rule resets the switch to that mode's default", () => {
    const flipped = setRated(fearless, false);
    expect(chooseRule(flipped, { id: 'mirror' }).ratedOverride).toBeNull();
    expect(nextGame(chooseRule(flipped, { id: 'mirror' })).rated).toBe(true);
    expect(nextGame(chooseStanding(setRated(chooseRule(fearless, tanks), true), 'normal')).rated).toBe(true);
    expect(nextGame(chooseRule(setRated(chooseRule(fearless, tanks), true), mages)).rated).toBe(false);
  });
});

describe('lockAtRoll', () => {
  it('copies the effective mode and the rated flag onto the lobby', () => {
    const state = chooseRule(fearless, tanks);
    expect(lockAtRoll(state, null)).toEqual({ mode: tanks, rated: false, version: state.version });
    const standing = setRated(startState('normal'), false);
    expect(lockAtRoll(standing, null)).toEqual({
      mode: { id: 'normal' },
      rated: false,
      version: standing.version,
    });
  });

  it('region wars takes the draw at Roll', () => {
    const state = chooseRule(fearless, { id: 'region' });
    expect(lockAtRoll(state, { blue: 'ionia', red: 'noxus' }).mode).toEqual({
      id: 'region',
      blue: 'ionia',
      red: 'noxus',
    });
  });

  it('region wars with no possible draw locks the standing mode, keeps the rated flag the card showed, and does not consume the rule', () => {
    const state = chooseRule(fearless, { id: 'region' });
    const lock = lockAtRoll(state, null);
    expect(lock).toEqual({ mode: { id: 'fearless' }, rated: false, version: state.version });
    expect(afterRecord(state, { kind: 'rift', lock }).pending).toEqual({ id: 'region' });
  });

  it('Reroll keeps the lock, the region draw included, even if the card changed since', () => {
    const state = chooseRule(fearless, { id: 'region' });
    const first = lockAtRoll(state, { blue: 'ionia', red: 'noxus' });
    const changed = setRated(chooseRule(state, mages), true);
    expect(lockAtRoll(changed, { blue: 'zaun', red: 'void' }, first)).toBe(first);
  });

  it('teams coming down drop the lock: the rule is still pending and the next Roll draws again', () => {
    const state = chooseRule(fearless, { id: 'region' });
    lockAtRoll(state, { blue: 'ionia', red: 'noxus' });
    expect(nextGame(state).rule).toEqual({ id: 'region' });
    expect(lockAtRoll(state, { blue: 'zaun', red: 'void' }, null).mode).toEqual({
      id: 'region',
      blue: 'zaun',
      red: 'void',
    });
  });
});

describe('which games use up a rule', () => {
  const lock: LockedMode = { mode: tanks, rated: false, version: 1 };

  it('only a Rift game recorded from a rolled lobby consumes it', () => {
    expect(consumesRule({ kind: 'rift', lock })).toBe(true);
    expect(consumesRule({ kind: 'remake', lock })).toBe(false);
    expect(consumesRule({ kind: 'aram', lock })).toBe(false);
    expect(consumesRule({ kind: 'rift', lock: null })).toBe(false);
  });
});

describe('gameStamp: what the recorded game carries', () => {
  const state = setRated(chooseRule(fearless, tanks), true);
  const lock = lockAtRoll(chooseRule(fearless, tanks), null);

  it('a rolled Rift game takes the lobby copy and is checked', () => {
    expect(gameStamp(state, { kind: 'rift', lock })).toEqual({ mode: tanks, rated: false, checked: true });
  });

  it('a rolled standing-mode game is not checked', () => {
    const plain = lockAtRoll(fearless, null);
    expect(gameStamp(fearless, { kind: 'rift', lock: plain })).toEqual({
      mode: { id: 'fearless' },
      rated: true,
      checked: false,
    });
  });

  it('a remake or ARAM keeps the rule stamp but is never rated and never checked', () => {
    expect(gameStamp(state, { kind: 'remake', lock })).toEqual({ mode: tanks, rated: false, checked: false });
    const ratedLock: LockedMode = { mode: { id: 'mirror' }, rated: true, version: 9 };
    expect(gameStamp(state, { kind: 'aram', lock: ratedLock })).toEqual({
      mode: { id: 'mirror' },
      rated: false,
      checked: false,
    });
  });

  it('a game with no lobby copy takes the standing mode and its default, ignoring the switch and the rule', () => {
    expect(gameStamp(state, { kind: 'rift', lock: null })).toEqual({
      mode: { id: 'fearless' },
      rated: true,
      checked: false,
    });
    expect(gameStamp(setRated(startState('normal'), false), { kind: 'rift', lock: null }).rated).toBe(true);
  });
});

describe('afterRecord: compare and clear', () => {
  it('the scene: the rule is consumed and the card is back on the standing mode', () => {
    const state = chooseRule(fearless, tanks);
    const lock = lockAtRoll(state, null);
    const after = afterRecord(state, { kind: 'rift', lock });
    expect(after.pending).toBeNull();
    expect(after.standing).toBe('fearless');
    expect(nextGame(after)).toEqual({ modeId: 'fearless', rule: null, rated: true });
  });

  it('the Rated switch resets after a standing-mode game too', () => {
    const state = setRated(fearless, false);
    const after = afterRecord(state, { kind: 'rift', lock: lockAtRoll(state, null) });
    expect(after.ratedOverride).toBeNull();
    expect(nextGame(after).rated).toBe(true);
  });

  it('a rule queued mid-game survives the record', () => {
    const rolled = chooseRule(fearless, tanks);
    const lock = lockAtRoll(rolled, null);
    const queued = chooseRule(rolled, mages);
    expect(afterRecord(queued, { kind: 'rift', lock })).toEqual(queued);
  });

  it('the same rule queued again mid-game survives too (it is a new choice)', () => {
    const rolled = chooseRule(fearless, tanks);
    const lock = lockAtRoll(rolled, null);
    const again = chooseRule(rolled, tanks);
    expect(afterRecord(again, { kind: 'rift', lock }).pending).toEqual(tanks);
  });

  it('a Rated flip mid-game changes only Rated: the rule is used up, the flip is for the next game', () => {
    const rolled = chooseRule(fearless, tanks);
    const lock = lockAtRoll(rolled, null);
    const flipped = setRated(rolled, true);
    expect(onlyRatedSinceRoll(flipped, lock)).toBe(true);
    const after = afterRecord(flipped, { kind: 'rift', lock });
    expect(after).toEqual({
      standing: 'fearless',
      pending: null,
      ratedOverride: true,
      version: flipped.version + 1,
    });
    expect(nextGame(after)).toEqual({ modeId: 'fearless', rule: null, rated: true });
    // A second companion's post finds nothing left to clear.
    expect(afterRecord(after, { kind: 'rift', lock })).toBe(after);
  });

  it('flipped off and on and off again mid-game: still only Rated, and the last flip stands', () => {
    const rolled = chooseRule(fearless, mages);
    const lock = lockAtRoll(rolled, null);
    const flips = setRated(setRated(setRated(rolled, true), false), true);
    expect(afterRecord(flips, { kind: 'rift', lock })).toMatchObject({ pending: null, ratedOverride: true });
  });

  it('a Rated flip on a standing-mode game keeps the flip for the next game', () => {
    const lock = lockAtRoll(fearless, null);
    const flipped = setRated(fearless, false);
    expect(onlyRatedSinceRoll(flipped, lock)).toBe(false);
    expect(afterRecord(flipped, { kind: 'rift', lock })).toEqual(flipped);
  });

  it('a flip then a new rule mid-game: the new rule survives with its own default', () => {
    const rolled = chooseRule(fearless, tanks);
    const lock = lockAtRoll(rolled, null);
    const queued = chooseRule(setRated(rolled, true), mages);
    expect(onlyRatedSinceRoll(queued, lock)).toBe(false);
    expect(afterRecord(queued, { kind: 'rift', lock })).toEqual(queued);
  });

  it('a flip then the same rule queued again survives (the pick resets the switch: a new choice)', () => {
    const rolled = chooseRule(fearless, tanks);
    const lock = lockAtRoll(rolled, null);
    const again = chooseRule(chooseRule(setRated(rolled, true), mages), tanks);
    expect(afterRecord(again, { kind: 'rift', lock }).pending).toEqual(tanks);
  });

  it('the documented blind spot: the same rule queued again and then flipped reads as Rated only', () => {
    const rolled = chooseRule(fearless, tanks);
    const lock = lockAtRoll(rolled, null);
    const again = setRated(chooseRule(chooseRule(rolled, mages), tanks), true);
    expect(afterRecord(again, { kind: 'rift', lock }).pending).toBeNull();
  });

  it('a Rated flip after a region wars that could not be drawn keeps region wars pending', () => {
    const rolled = chooseRule(fearless, { id: 'region' });
    const lock = lockAtRoll(rolled, null);
    const flipped = setRated(rolled, true);
    expect(onlyRatedSinceRoll(flipped, lock)).toBe(false);
    expect(afterRecord(flipped, { kind: 'rift', lock })).toEqual(flipped);
  });

  it('a drawn region wars is the same rule as the pending one: a flip uses it up', () => {
    const rolled = chooseRule(fearless, { id: 'region' });
    const lock = lockAtRoll(rolled, { blue: 'demacia', red: 'noxus' });
    const flipped = setRated(rolled, true);
    expect(afterRecord(flipped, { kind: 'rift', lock }).pending).toBeNull();
  });

  it('a remake or ARAM after a mid-game flip uses nothing up', () => {
    const rolled = chooseRule(fearless, tanks);
    const lock = lockAtRoll(rolled, null);
    const flipped = setRated(rolled, true);
    expect(afterRecord(flipped, { kind: 'remake', lock })).toBe(flipped);
    expect(afterRecord(flipped, { kind: 'aram', lock })).toBe(flipped);
  });

  it('with nothing moved since Roll it is not "only Rated"', () => {
    const rolled = setRated(chooseRule(fearless, tanks), true);
    expect(onlyRatedSinceRoll(rolled, lockAtRoll(rolled, null))).toBe(false);
  });

  it('remake, ARAM and no-lobby games leave the rule pending', () => {
    const state = chooseRule(fearless, tanks);
    const lock = lockAtRoll(state, null);
    const games: RecordedGame[] = [
      { kind: 'remake', lock },
      { kind: 'aram', lock },
      { kind: 'rift', lock: null },
    ];
    for (const game of games) expect(afterRecord(state, game)).toEqual(state);
  });

  it('a dropped lobby is not a record: nothing to call, the rule stays; a late block consumes it', () => {
    const state = chooseRule(fearless, tanks);
    const lock = lockAtRoll(state, null);
    // Two hours with no block: no call. The late block is a normal record with the lobby's copy.
    expect(nextGame(state).rule).toEqual(tanks);
    expect(afterRecord(state, { kind: 'rift', lock }).pending).toBeNull();
  });
});
