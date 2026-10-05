import type { ModeLock, ModeRow } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { listChampions } from '../champs/names';
import { modeCardView, selectValue, tooFewOpen } from './card';
import { championTable } from './champions';
import { nextGameLine } from './ruleCopy';
import { type ModeSpeech, modeSpeechLine } from './speech';

/**
 * M15.5, on M20.8's one row: what the Mode card is about, per state (brief D2, 05-design 8.3), and
 * what the announcer says when it changes (brief §4). Before Roll the card is the row (the next
 * game); set and in game it is the lobby's lock (this game), and the row is the next game.
 */

const table = championTable();
const zaun = { id: 'region', blue: 'zaun', red: 'noxus' } as const;
const state = (over: Partial<ModeRow> = {}): ModeRow => ({
  standing: 'fearless',
  pending: null,
  rated: null,
  ...over,
});
const lockOf = (mode: ModeLock['mode'], rated: boolean | null = null): ModeLock => ({
  standing: 'fearless',
  mode,
  rated,
});
const view = (
  s: ModeRow,
  status: Parameters<typeof modeCardView>[0]['lobbyStatus'] = null,
  lock: ModeLock | null = null,
  bans: number[] = [],
) => modeCardView({ row: s, lobbyStatus: status, lock, bans, table });

describe('modeCardView', () => {
  it('before Roll the card is the next game: the pending rule at its default rated flag', () => {
    const v = view(state({ pending: { id: 'class', tag: 'Tank' } }), 'open');
    expect(v.shown).toEqual({ id: 'class', tag: 'Tank' });
    expect(v.rated).toBe(false);
    expect(v.locked).toBe(false);
    expect(v.nextLine).toBeNull();
  });

  it('region wars before Roll is the row with its pair (M20 D9), no lobby needed', () => {
    for (const status of [null, 'open', 'finished'] as const) {
      const v = view(state({ pending: zaun }), status);
      expect(v.shown).toEqual(zaun);
      expect(v.pending).toEqual(zaun);
    }
  });

  it('the Rated switch wins in any mode, Normal included', () => {
    expect(view(state({ standing: 'normal', rated: false })).rated).toBe(false);
    expect(view(state({ pending: zaun, rated: true })).rated).toBe(true);
    expect(view(state({ pending: { id: 'mirror' } })).rated).toBe(true);
  });

  it('after Roll the card is the lock; the row as Roll left it says nothing, a choice since is the next game line', () => {
    const lock = lockOf(zaun, false);
    const same = view(state(), 'balanced', lock);
    expect(same.shown).toEqual(zaun);
    expect(same.rated).toBe(false);
    expect(same.locked).toBe(true);
    expect(same.nextLine).toBeNull();
    const moved = view(state({ pending: { id: 'class', tag: 'Mage' } }), 'in_game', lock);
    expect(moved.shown).toEqual(zaun);
    expect(moved.nextLine).toBe('Next game: Mages only.');
    const toNormal = view(state({ standing: 'normal' }), 'in_game', lock);
    expect(toNormal.nextLine).toBe('Next game: Normal.');
  });

  it("region wars with no pair at Roll: this game is the standing mode with Rated moved, the card says it didn't apply", () => {
    const v = view(state({ pending: zaun }), 'balanced', lockOf({ id: 'fearless' }, false));
    expect(v.shown).toEqual({ id: 'fearless' });
    expect(v.rated).toBe(false);
    expect(v.didntApply).toBe(true);
    // The note already says it is still set for the next game.
    expect(v.nextLine).toBeNull();
    // An admin chose something else since: no note, the next game line names it.
    const moved = view(state({ pending: { id: 'mirror' } }), 'balanced', lockOf({ id: 'fearless' }, false));
    expect(moved.didntApply).toBe(false);
    expect(moved.nextLine).toBe('Next game: Mirror match.');
  });

  it('a lock on a lobby that is no longer set is not this game; the row is', () => {
    const lock = lockOf({ id: 'class', tag: 'Tank' }, false);
    const v = view(state(), 'finished', lock);
    expect(v.shown).toEqual({ id: 'fearless' });
    expect(v.rated).toBe(true);
    expect(v.locked).toBe(false);
    // Balanced with no lock (teams by hand, M21): the card is the next game.
    expect(view(state({ pending: { id: 'mirror' } }), 'balanced', null).shown).toEqual({ id: 'mirror' });
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
    locked: false,
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
      locked: true,
      lobbyStatus: 'in_game',
    });
    expect(modeSpeechLine(before, speech({ lobbyStatus: 'finished', standing: 'fearless' }))).toBe(
      "This game's rule is done. Back to Fearless.",
    );
  });

  it('an admin picking the standing mode clears the rule', () => {
    expect(modeSpeechLine(speech({ pending: zaun }), speech())).toBe('Rule cleared. Back to Fearless.');
    expect(modeSpeechLine(speech({ pending: zaun }), speech({ standing: 'normal' }))).toBe(
      'Rule cleared. Back to Normal.',
    );
  });

  it('region wars chosen names its pair', () => {
    expect(modeSpeechLine(speech(), speech({ pending: zaun, nextRated: false }))).toBe(
      'Next game: Region wars. Blue: Zaun · Red: Noxus. Not rated.',
    );
  });

  it('Roll moving the row onto the lock, or the teams handing it back, says nothing', () => {
    const before = speech({ pending: { id: 'class', tag: 'Tank' }, nextRated: false, lobbyStatus: 'open' });
    const rolled = speech({
      lockedRule: { id: 'class', tag: 'Tank' },
      locked: true,
      lobbyStatus: 'balanced',
    });
    expect(modeSpeechLine(before, rolled)).toBeNull();
    expect(modeSpeechLine(rolled, { ...before, lobbyStatus: 'open' })).toBeNull();
  });

  it('the switch is always about the next game, and nothing changed says nothing', () => {
    expect(modeSpeechLine(speech(), speech({ nextRated: false }))).toBe('Next game is not rated.');
    expect(modeSpeechLine(speech(), speech())).toBeNull();
  });
});

describe('a Rated flip after Roll changes only Rated (the user, 2026-10-04)', () => {
  const tanksLock = lockOf({ id: 'class', tag: 'Tank' }, false);

  it('the next game line does not repeat the rule; it names what the next game is', () => {
    expect(view(state({ rated: true }), 'in_game', tanksLock).nextLine).toBe('Next game: Fearless.');
    expect(view(state({ rated: false }), 'in_game', tanksLock).nextLine).toBe(
      'Next game: Fearless. Not rated.',
    );
  });

  it('only Rated differs from this game: `Next game: not rated.` / `Next game: rated.`', () => {
    expect(view(state({ rated: false }), 'in_game', lockOf({ id: 'fearless' }, true)).nextLine).toBe(
      'Next game: not rated.',
    );
    expect(view(state({ rated: true }), 'balanced', lockOf({ id: 'fearless' }, false)).nextLine).toBe(
      'Next game: rated.',
    );
  });

  it('a rule queued after Roll is named, with Rated when it is not the rule default', () => {
    const mage = { id: 'class', tag: 'Mage' } as const;
    expect(view(state({ pending: mage, rated: true }), 'in_game', tanksLock).nextLine).toBe(
      'Next game: Mages only. Rated.',
    );
    expect(view(state({ pending: mage }), 'in_game', tanksLock).nextLine).toBe('Next game: Mages only.');
    // The same rule queued again: named, so the admin sees it will repeat.
    expect(view(state({ pending: { id: 'class', tag: 'Tank' } }), 'in_game', tanksLock).nextLine).toBe(
      'Next game: Tanks only.',
    );
  });

  it('the select and the switch are the row: the next game, never a prediction', () => {
    expect(selectValue(state())).toBe('fearless');
    expect(selectValue(state({ pending: zaun }))).toBe('region');
  });

  it('nextGameLine says Rated in both places', () => {
    expect(nextGameLine({ id: 'class', tag: 'Tank' }, true)).toBe('Next game: Tanks only. Rated.');
    expect(nextGameLine(null, false)).toBe('Next game: not rated.');
    expect(nextGameLine('normal')).toBe('Next game: Normal.');
    expect(nextGameLine('fearless', false)).toBe('Next game: Fearless. Not rated.');
  });
});
