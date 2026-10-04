import type { LockedMode, ModeState } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { listChampions } from '../champs/names';
import { modeCardView, selectValue, tooFewOpen, upcomingState } from './card';
import { championTable } from './champions';
import { nextGameLine } from './ruleCopy';
import { type ModeSpeech, modeSpeechLine } from './speech';

/**
 * M15.5: what the Mode card is about, per state (brief D2, 05-design 8.3), and what the announcer
 * says when it changes (brief §4).
 */

const table = championTable();
const state = (over: Partial<ModeState> = {}): ModeState => ({
  standing: 'fearless',
  pending: null,
  ratedOverride: null,
  version: 3,
  ...over,
});
const view = (
  s: ModeState,
  status: Parameters<typeof modeCardView>[0]['lobbyStatus'] = null,
  lock: LockedMode | null = null,
  bans: number[] = [],
) => modeCardView({ state: s, lobbyStatus: status, lock, bans, table });

describe('modeCardView', () => {
  it('before Roll the card is the next game: the pending rule at its default rated flag', () => {
    const v = view(state({ pending: { id: 'class', tag: 'Tank' } }), 'open');
    expect(v.shown).toEqual({ id: 'class', tag: 'Tank' });
    expect(v.rated).toBe(false);
    expect(v.locked).toBe(false);
    expect(v.nextLine).toBeNull();
  });

  it('the Rated switch wins in any mode, Normal included', () => {
    expect(view(state({ standing: 'normal', ratedOverride: false })).rated).toBe(false);
    expect(view(state({ pending: { id: 'region' }, ratedOverride: true })).rated).toBe(true);
    expect(view(state({ pending: { id: 'mirror' } })).rated).toBe(true);
  });

  it('after Roll the card is the lock; a change since is the next game line', () => {
    const lock: LockedMode = {
      mode: { id: 'region', blue: 'ionia', red: 'noxus' },
      rated: false,
      version: 3,
    };
    const same = view(state({ pending: { id: 'region' } }), 'balanced', lock);
    expect(same.shown).toEqual(lock.mode);
    expect(same.locked).toBe(true);
    expect(same.nextLine).toBeNull();
    const moved = view(state({ pending: { id: 'class', tag: 'Mage' }, version: 4 }), 'in_game', lock);
    expect(moved.shown).toEqual(lock.mode);
    expect(moved.nextLine).toBe('Next game: Mages only.');
    const toNormal = view(state({ standing: 'normal', version: 4 }), 'in_game', lock);
    expect(toNormal.nextLine).toBe('Next game: Normal.');
  });

  it("region wars with no draw at Roll: the card says it didn't apply, and the rule stays", () => {
    const lock: LockedMode = { mode: { id: 'fearless' }, rated: false, version: 3 };
    const v = view(state({ pending: { id: 'region' } }), 'balanced', lock);
    expect(v.didntApply).toBe(true);
    expect(v.shown).toEqual({ id: 'fearless' });
    expect(v.rated).toBe(false);
  });

  it('finished shows the next game again: the card is back on the standing mode', () => {
    const lock: LockedMode = { mode: { id: 'class', tag: 'Tank' }, rated: false, version: 3 };
    const v = view(state({ version: 4 }), 'finished', lock);
    expect(v.shown).toEqual({ id: 'fearless' });
    expect(v.rated).toBe(true);
  });

  it('class wars counts the open class under Fearless only, and per usual lane', () => {
    const tanks = view(state({ standing: 'normal', pending: { id: 'class', tag: 'Tank' } }));
    expect(tanks.classOpen).toBeNull();
    const total = Object.values(tanks.laneCounts ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(30);
    const banned = view(state({ pending: { id: 'class', tag: 'Tank' } }), null, null, [3, 12, 32]);
    expect(banned.classOpen).toBe(46 - 3);
  });
});

describe('the select', () => {
  it('holds the standing mode or the pending rule key', () => {
    expect(selectValue(state())).toBe('fearless');
    expect(selectValue(state({ pending: { id: 'class', tag: 'Support' } }))).toBe('class:Support');
  });

  it('greys a class under 10 open only under standing Fearless, never the pending one', () => {
    const allButFive = listChampions()
      .map((c) => c.id)
      .filter((id) => !table.get(id)?.tags?.includes('Marksman'))
      .concat(
        [...table]
          .filter(([, f]) => f.tags?.includes('Marksman'))
          .slice(5)
          .map(([id]) => id),
      );
    expect(tooFewOpen(state(), allButFive, table)).toContain('class:Marksman');
    expect(tooFewOpen(state({ standing: 'normal' }), allButFive, table)).toEqual([]);
    expect(tooFewOpen(state({ pending: { id: 'class', tag: 'Marksman' } }), allButFive, table)).not.toContain(
      'class:Marksman',
    );
    expect(tooFewOpen(state(), [], table)).toEqual([]);
  });
});

describe('the announcer lines', () => {
  const speech = (over: Partial<ModeSpeech> = {}): ModeSpeech => ({
    standing: 'fearless',
    pending: null,
    nextRated: true,
    lockedRule: null,
    lobbyStatus: null,
    ...over,
  });

  it('a rule picked or spun says the next game', () => {
    expect(
      modeSpeechLine(speech(), speech({ pending: { id: 'class', tag: 'Tank' }, nextRated: false })),
    ).toBe('Next game: Class wars, tanks only. Not rated.');
  });

  it("a rule game landing says the rule is done, never M14's switched-off note", () => {
    const before = speech({
      lockedRule: { id: 'class', tag: 'Tank' },
      lobbyStatus: 'in_game',
      pending: { id: 'class', tag: 'Tank' },
      nextRated: false,
    });
    expect(modeSpeechLine(before, speech({ lobbyStatus: 'finished', standing: 'fearless' }))).toBe(
      "This game's rule is done. Back to Fearless.",
    );
  });

  it('an admin picking the standing mode clears the rule', () => {
    expect(modeSpeechLine(speech({ pending: { id: 'region' } }), speech())).toBe(
      'Rule cleared. Back to Fearless.',
    );
    expect(modeSpeechLine(speech({ pending: { id: 'region' } }), speech({ standing: 'normal' }))).toBe(
      'Rule cleared. Back to Normal.',
    );
  });

  it('the switch is always about the next game, and nothing changed says nothing', () => {
    expect(modeSpeechLine(speech(), speech({ nextRated: false }))).toBe('Next game is not rated.');
    expect(modeSpeechLine(speech(), speech())).toBeNull();
  });
});

describe('a Rated flip after Roll changes only Rated (the user, 2026-10-04)', () => {
  const tanksLock: LockedMode = { mode: { id: 'class', tag: 'Tank' }, rated: false, version: 3 };
  const tanks = { id: 'class', tag: 'Tank' } as const;

  it('the next game line does not repeat the rule; it names what the next game is', () => {
    const flipped = state({ pending: tanks, ratedOverride: true, version: 4 });
    expect(view(flipped, 'in_game', tanksLock).nextLine).toBe('Next game: Fearless.');
    const off = state({ pending: tanks, ratedOverride: false, version: 4 });
    expect(view(off, 'in_game', tanksLock).nextLine).toBe('Next game: Fearless. Not rated.');
  });

  it('only Rated differs from this game: `Next game: not rated.` / `Next game: rated.`', () => {
    const lock: LockedMode = { mode: { id: 'fearless' }, rated: true, version: 3 };
    expect(view(state({ ratedOverride: false, version: 4 }), 'in_game', lock).nextLine).toBe(
      'Next game: not rated.',
    );
    const offLock: LockedMode = { mode: { id: 'fearless' }, rated: false, version: 3 };
    expect(view(state({ ratedOverride: true, version: 4 }), 'balanced', offLock).nextLine).toBe(
      'Next game: rated.',
    );
  });

  it('a rule queued after Roll is named, with Rated when it is not the rule default', () => {
    const mages = state({ pending: { id: 'class', tag: 'Mage' }, ratedOverride: true, version: 5 });
    expect(view(mages, 'in_game', tanksLock).nextLine).toBe('Next game: Mages only. Rated.');
    const plain = state({ pending: { id: 'class', tag: 'Mage' }, version: 5 });
    expect(view(plain, 'in_game', tanksLock).nextLine).toBe('Next game: Mages only.');
    // The same rule queued again (no flip): named, so the admin sees it will repeat.
    const again = state({ pending: tanks, version: 6 });
    expect(view(again, 'in_game', tanksLock).nextLine).toBe('Next game: Tanks only.');
  });

  it('the controls read the upcoming card: the select and the switch are the game after this one', () => {
    const flipped = state({ pending: tanks, ratedOverride: true, version: 4 });
    const upcoming = upcomingState(flipped, 'in_game', tanksLock);
    expect(selectValue(upcoming)).toBe('fearless');
    expect(upcoming.ratedOverride).toBe(true);
    // Nothing moved since Roll: the next game is the standing mode at its default.
    const untouched = upcomingState(state({ pending: tanks, ratedOverride: false }), 'balanced', tanksLock);
    expect(selectValue(untouched)).toBe('fearless');
    expect(untouched.ratedOverride).toBeNull();
    // Before Roll (or finished) it is the card itself.
    expect(upcomingState(flipped, 'open', tanksLock)).toBe(flipped);
    expect(upcomingState(flipped, 'finished', tanksLock)).toBe(flipped);
    expect(upcomingState(flipped, 'in_game', null)).toBe(flipped);
  });

  it('nextGameLine says Rated in both places', () => {
    expect(nextGameLine({ id: 'class', tag: 'Tank' }, true)).toBe('Next game: Tanks only. Rated.');
    expect(nextGameLine(null, false)).toBe('Next game: not rated.');
    expect(nextGameLine('normal')).toBe('Next game: Normal.');
    expect(nextGameLine('fearless', false)).toBe('Next game: Fearless. Not rated.');
  });
});
