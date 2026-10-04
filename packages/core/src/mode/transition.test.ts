import { describe, expect, it } from 'vitest';
import type { RegionPair, RuleOption } from './model';
import { pairDrawable } from './pool';
import type { Rng } from './spin';
import { seeded, sequence, setRoster, syntheticRoster } from './testRoster';
import {
  handBack,
  lockRated,
  lockTransition,
  type ModeAction,
  type ModeLock,
  type ModeRow,
  nextRated,
  type PendingRule,
  type RecordInput,
  type RowPatch,
  recordGame,
  type TransitionContext,
  take,
  transition,
} from './transition';

// Regions: ionia, noxus, zaun at 9 open, targon at 8, demacia at 3 (never drawable).
// Ids from 20000 in that order: ionia 20000-20008, noxus 20009-20017, zaun 20018-20026,
// targon 20027-20034, demacia 20035-20037. Classes: 10 tanks (playable), 3 mages (not).
const ROSTER = new Map([
  ...setRoster([
    [['ionia'], 9],
    [['noxus'], 9],
    [['zaun'], 9],
    [['targon'], 8],
    [['demacia'], 3],
  ]),
  ...syntheticRoster({ Tank: 10, Mage: 3 }),
]);
const REGIONS = ['demacia', 'ionia', 'noxus', 'targon', 'zaun'] as const;
const TARGON_ONE = 20027;
const IONIA_ONE = 20000;
const IONIA_TWO = 20001;
/** Fearless bans that leave only ionia at 8 or more: no pair passes. */
const NO_PAIR = [20009, 20010, 20018, 20019, TARGON_ONE];

function ctx(rng: Rng = sequence(0, 0), fearlessPool: readonly number[] = []): TransitionContext {
  return { roster: ROSTER, regions: REGIONS, fearlessPool, rng };
}

const tanks = { id: 'class', tag: 'Tank' } as const;
const mages = { id: 'class', tag: 'Mage' } as const;
const mirror = { id: 'mirror' } as const;
const regionPick: RuleOption = { id: 'region' };
const ioniaNoxus = { id: 'region', blue: 'ionia', red: 'noxus' } as const satisfies PendingRule;

const row = (over: Partial<ModeRow> = {}): ModeRow => ({
  standing: 'normal',
  pending: null,
  rated: null,
  ...over,
});
const apply = (state: ModeRow, patch: RowPatch): ModeRow => ({ ...state, ...patch });

function patchOf(state: ModeRow, action: ModeAction, context = ctx()): RowPatch {
  const result = transition(state, action, context);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.patch;
}

describe('transition: each action returns only the fields it sets (the row)', () => {
  const priors: Record<string, ModeRow> = {
    empty: row(),
    'fearless, rated off': row({ standing: 'fearless', rated: false }),
    'tanks pending, rated on': row({ pending: tanks, rated: true }),
    'region pending': row({ pending: ioniaNoxus }),
    'mirror pending': row({ pending: mirror, rated: false }),
  };

  for (const [name, prior] of Object.entries(priors)) {
    describe(`from ${name}`, () => {
      it('standing: sets the standing mode, empties the rule and Rated', () => {
        expect(patchOf(prior, { type: 'standing', standing: 'fearless' })).toEqual({
          standing: 'fearless',
          pending: null,
          rated: null,
        });
      });

      it('pick a class: the rule and a reset Rated, standing untouched', () => {
        expect(patchOf(prior, { type: 'pick', rule: tanks })).toEqual({ pending: tanks, rated: null });
      });

      it('pick mirror: the rule and a reset Rated', () => {
        expect(patchOf(prior, { type: 'pick', rule: mirror })).toEqual({ pending: mirror, rated: null });
      });

      it('pick region wars: the rule always carries its pair', () => {
        const patch = patchOf(prior, { type: 'pick', rule: regionPick });
        expect(Object.keys(patch).sort()).toEqual(['pending', 'rated']);
        expect(patch.rated).toBeNull();
        // Already pending: the pair is kept. Otherwise sequence(0, 0) draws ionia vs noxus.
        expect(patch.pending).toEqual(ioniaNoxus);
      });

      it('rated: only Rated', () => {
        expect(patchOf(prior, { type: 'rated', rated: false })).toEqual({ rated: false });
        expect(patchOf(prior, { type: 'rated', rated: true })).toEqual({ rated: true });
      });

      it('spin: the server pick as a rule, Rated reset', () => {
        // sequence(0, 0): the class family, then the first playable class (Tank).
        expect(patchOf(prior, { type: 'spin', previous: null })).toEqual({ pending: tanks, rated: null });
      });

      if (prior.pending?.id === 'region') {
        it('redraw: only the pending rule, a new pair', () => {
          expect(patchOf(prior, { type: 'redraw' })).toEqual({
            pending: { id: 'region', blue: 'ionia', red: 'targon' },
          });
        });
        it('set-side: only the pending rule, the other side kept', () => {
          expect(patchOf(prior, { type: 'set-side', side: 'red', region: 'zaun' })).toEqual({
            pending: { id: 'region', blue: 'ionia', red: 'zaun' },
          });
          expect(patchOf(prior, { type: 'set-side', side: 'blue', region: 'targon' })).toEqual({
            pending: { id: 'region', blue: 'targon', red: 'noxus' },
          });
        });
      } else {
        it('redraw and set-side: refused, region wars is not pending', () => {
          expect(transition(prior, { type: 'redraw' }, ctx())).toEqual({
            ok: false,
            refusal: 'no-region-rule',
          });
          expect(transition(prior, { type: 'set-side', side: 'blue', region: 'zaun' }, ctx())).toEqual({
            ok: false,
            refusal: 'no-region-rule',
          });
        });
      }
    });
  }
});

describe('transition: picks and Spin', () => {
  it('a rule with too few open is refused, unless it is the rule already pending', () => {
    expect(transition(row(), { type: 'pick', rule: mages }, ctx())).toEqual({
      ok: false,
      refusal: 'too-few-open',
    });
    expect(patchOf(row({ pending: mages, rated: true }), { type: 'pick', rule: mages })).toEqual({
      pending: mages,
      rated: null,
    });
  });

  it('region wars with no passing pair is refused; already pending, it keeps its pair', () => {
    const fearless = row({ standing: 'fearless' });
    expect(transition(fearless, { type: 'pick', rule: regionPick }, ctx(sequence(0), NO_PAIR))).toEqual({
      ok: false,
      refusal: 'too-few-open',
    });
    const pending = row({ standing: 'fearless', pending: ioniaNoxus, rated: true });
    expect(patchOf(pending, { type: 'pick', rule: regionPick }, ctx(sequence(0), NO_PAIR))).toEqual({
      pending: ioniaNoxus,
      rated: null,
    });
  });

  it('region wars reads only the region list it is given (the list the draw reads)', () => {
    const narrow: TransitionContext = { ...ctx(), regions: ['demacia', 'ionia'] };
    expect(transition(row(), { type: 'pick', rule: regionPick }, narrow)).toEqual({
      ok: false,
      refusal: 'too-few-open',
    });
    expect(transition(row(), { type: 'spin', previous: tanks, blocked: [mirror] }, narrow)).toEqual({
      ok: false,
      refusal: 'nothing-to-spin',
    });
  });

  it('Fearless bans count only on a Fearless night', () => {
    // Under Normal the same pool is ignored: region wars is playable.
    expect(patchOf(row(), { type: 'pick', rule: regionPick }, ctx(sequence(0, 0), NO_PAIR)).pending).toEqual(
      ioniaNoxus,
    );
  });

  it('the drawn pair reads the bans: a short region is never drawn', () => {
    // Ionia down to 7: blue candidates noxus, targon, zaun.
    const patch = patchOf(
      row({ standing: 'fearless' }),
      { type: 'pick', rule: regionPick },
      ctx(sequence(0, 0), [IONIA_ONE, IONIA_TWO]),
    );
    expect(patch.pending).toEqual({ id: 'region', blue: 'noxus', red: 'targon' });
  });

  it('Spin landing on region wars draws the pair in the same call, even when region wars is pending', () => {
    // Families sorted class, region, mirror: 0.5 lands on region; then 0.99, 0.99 draws zaun vs targon.
    const spun = { type: 'spin', previous: null } as const;
    expect(patchOf(row(), spun, ctx(sequence(0.5, 0, 0.99, 0.99)))).toEqual({
      pending: { id: 'region', blue: 'zaun', red: 'targon' },
      rated: null,
    });
    expect(patchOf(row({ pending: ioniaNoxus }), spun, ctx(sequence(0.5, 0, 0.99, 0.99)))).toEqual({
      pending: { id: 'region', blue: 'zaun', red: 'targon' },
      rated: null,
    });
  });

  it('Spin skips the previous rule and anything blocked; nothing left is a refusal', () => {
    // Previous Tank: class has no playable option left (Mage is short), so region then mirror.
    expect(
      patchOf(row(), { type: 'spin', previous: tanks, blocked: [regionPick] }, ctx(sequence(0))),
    ).toEqual({
      pending: mirror,
      rated: null,
    });
    expect(
      transition(row(), { type: 'spin', previous: tanks, blocked: [regionPick, mirror] }, ctx(sequence(0))),
    ).toEqual({ ok: false, refusal: 'nothing-to-spin' });
  });
});

describe('redraw and set-side (row and lock, one rule)', () => {
  it('redraw never returns the same unordered pair (seeded, 1,000 RNG values)', () => {
    const rng = seeded(20);
    for (const current of [ioniaNoxus, { id: 'region', blue: 'noxus', red: 'ionia' } as const]) {
      for (let i = 0; i < 1000; i += 1) {
        const patch = patchOf(row({ pending: current }), { type: 'redraw' }, ctx(rng));
        const pair = patch.pending as RegionPair;
        expect([pair.blue, pair.red].sort()).not.toEqual(['ionia', 'noxus']);
        expect(pairDrawable(pair.blue, pair.red, ROSTER, [])).toBe(true);
      }
    }
  });

  it('redraw with no other passing pair is a refusal, not a no-op', () => {
    // Only ionia and noxus left at 8: their pair is the only one.
    const bans = [20018, 20019, TARGON_ONE];
    const state = row({ standing: 'fearless', pending: ioniaNoxus });
    expect(transition(state, { type: 'redraw' }, ctx(sequence(0), bans))).toEqual({
      ok: false,
      refusal: 'no-other-pair',
    });
  });

  it('set-side refuses the same region twice, a region under 8 open, an unknown region and a union failure', () => {
    const state = row({ pending: ioniaNoxus });
    const refusal = (side: 'blue' | 'red', region: string, context = ctx()) => {
      const result = transition(state, { type: 'set-side', side, region }, context);
      return result.ok ? null : result.refusal;
    };
    expect(refusal('red', 'ionia')).toBe('same-region');
    expect(refusal('blue', 'noxus')).toBe('same-region');
    expect(refusal('red', 'demacia')).toBe('region-short');
    expect(refusal('red', 'unaffiliated')).toBe('region-short');
    expect(refusal('red', 'atlantis')).toBe('region-short');
    expect(refusal('red', 'zaun')).toBeNull();
  });

  it('set-side refuses a pair failing only the union rule (8 + 8, one shared)', () => {
    const shared = setRoster([
      [['ionia'], 7],
      [['noxus'], 7],
      [['ionia', 'noxus'], 1],
      [['zaun'], 9],
    ]);
    const context: TransitionContext = {
      roster: shared,
      regions: ['ionia', 'noxus', 'zaun'],
      fearlessPool: [],
      rng: sequence(0),
    };
    const state = row({ pending: { id: 'region', blue: 'ionia', red: 'zaun' } });
    expect(transition(state, { type: 'set-side', side: 'red', region: 'noxus' }, context)).toEqual({
      ok: false,
      refusal: 'pair-short',
    });
  });

  const lock: ModeLock = { standing: 'normal', mode: ioniaNoxus, rated: null };

  it('on a lock: redraw and set-side return the new lock, standing and Rated untouched', () => {
    expect(lockTransition(lock, { type: 'redraw' }, ctx())).toEqual({
      ok: true,
      lock: { standing: 'normal', mode: { id: 'region', blue: 'ionia', red: 'targon' }, rated: null },
    });
    expect(
      lockTransition({ ...lock, rated: true }, { type: 'set-side', side: 'blue', region: 'zaun' }, ctx()),
    ).toEqual({
      ok: true,
      lock: { standing: 'normal', mode: { id: 'region', blue: 'zaun', red: 'noxus' }, rated: true },
    });
  });

  it('on a lock: the lock standing decides whether Fearless bans count', () => {
    const fearlessLock: ModeLock = { ...lock, standing: 'fearless' };
    expect(
      lockTransition(
        fearlessLock,
        { type: 'set-side', side: 'blue', region: 'targon' },
        ctx(sequence(0), [TARGON_ONE]),
      ),
    ).toEqual({
      ok: false,
      refusal: 'region-short',
    });
    expect(
      lockTransition(
        lock,
        { type: 'set-side', side: 'blue', region: 'targon' },
        ctx(sequence(0), [TARGON_ONE]),
      ).ok,
    ).toBe(true);
  });

  it('on a lock without region wars: refused', () => {
    const tanksLock: ModeLock = { standing: 'normal', mode: tanks, rated: null };
    expect(lockTransition(tanksLock, { type: 'redraw' }, ctx())).toEqual({
      ok: false,
      refusal: 'no-region-rule',
    });
    expect(
      lockTransition(
        { ...tanksLock, mode: { id: 'normal' } },
        { type: 'set-side', side: 'red', region: 'zaun' },
        ctx(),
      ),
    ).toEqual({
      ok: false,
      refusal: 'no-region-rule',
    });
  });
});

describe('take (Roll): the rule, its pair and Rated move into the lock', () => {
  it('no rule: locks the standing mode with Rated as set, empties the row', () => {
    const state = row({ standing: 'fearless', rated: false });
    expect(take(state, ctx())).toEqual({
      lock: { standing: 'fearless', mode: { id: 'fearless' }, rated: false },
      patch: { pending: null, rated: null },
      regions: null,
    });
  });

  it('a class or mirror rule: locked as it is', () => {
    expect(take(row({ pending: tanks }), ctx())).toEqual({
      lock: { standing: 'normal', mode: tanks, rated: null },
      patch: { pending: null, rated: null },
      regions: null,
    });
    expect(take(row({ pending: mirror, rated: false }), ctx()).lock).toEqual({
      standing: 'normal',
      mode: mirror,
      rated: false,
    });
  });

  it('a pair that still passes is locked exactly', () => {
    const state = row({
      standing: 'fearless',
      pending: { id: 'region', blue: 'noxus', red: 'targon' },
      rated: true,
    });
    expect(take(state, ctx(sequence(0.99, 0.99), [IONIA_ONE, IONIA_TWO]))).toEqual({
      lock: { standing: 'fearless', mode: { id: 'region', blue: 'noxus', red: 'targon' }, rated: true },
      patch: { pending: null, rated: null },
      regions: { outcome: 'kept' },
    });
  });

  it('a pair made short by added bans: a fresh passing pair is locked and flagged', () => {
    const was = { id: 'region', blue: 'targon', red: 'zaun' } as const;
    const state = row({ standing: 'fearless', pending: was });
    const taken = take(state, ctx(sequence(0, 0), [TARGON_ONE]));
    expect(taken).toEqual({
      lock: { standing: 'fearless', mode: ioniaNoxus, rated: null },
      patch: { pending: null, rated: null },
      regions: { outcome: 'redrawn', from: { blue: 'targon', red: 'zaun' } },
    });
  });

  it('no pair passes: only Rated moves, the rule and its stale pair stay pending', () => {
    const state = row({ standing: 'fearless', pending: ioniaNoxus, rated: true });
    expect(take(state, ctx(sequence(0), NO_PAIR))).toEqual({
      lock: { standing: 'fearless', mode: { id: 'fearless' }, rated: true },
      patch: { rated: null },
      regions: { outcome: 'no-draw' },
    });
  });

  it('lockRated: the moved switch, else the locked mode default (no-draw falls to the standing default)', () => {
    expect(lockRated({ standing: 'normal', mode: ioniaNoxus, rated: null })).toBe(false);
    expect(lockRated({ standing: 'normal', mode: ioniaNoxus, rated: true })).toBe(true);
    expect(lockRated({ standing: 'fearless', mode: { id: 'fearless' }, rated: null })).toBe(true);
    expect(lockRated({ standing: 'fearless', mode: { id: 'fearless' }, rated: false })).toBe(false);
  });
});

describe('handBack: per field, only into empty fields', () => {
  const lock: ModeLock = { standing: 'normal', mode: ioniaNoxus, rated: false };

  it('fills an empty rule and an empty Rated', () => {
    expect(handBack(row(), lock)).toEqual({ pending: ioniaNoxus, rated: false });
  });

  it('a newer pick wins, and keeps its own default Rated (no explicit Rated from the old rule)', () => {
    expect(handBack(row({ pending: tanks }), lock)).toEqual({});
    // Pick B after Roll on A with Rated on, then the teams come down: B stays at its default.
    const state = row({ pending: { id: 'region', blue: 'zaun', red: 'targon' }, rated: true });
    const taken = take(state, ctx());
    let after = apply(state, taken.patch);
    after = apply(after, patchOf(after, { type: 'pick', rule: mirror }));
    expect(handBack(after, taken.lock)).toEqual({});
    expect(nextRated(apply(after, handBack(after, taken.lock)))).toBe(true);
  });

  it('the same rule re-queued after Roll still gets its Rated back', () => {
    expect(handBack(row({ pending: { id: 'region', blue: 'zaun', red: 'targon' } }), lock)).toEqual({
      rated: false,
    });
  });

  it('a standing lock hands Rated back to a row with no rule, never onto a newer rule', () => {
    const standing: ModeLock = { standing: 'normal', mode: { id: 'normal' }, rated: false };
    expect(handBack(row(), standing)).toEqual({ rated: false });
    expect(handBack(row({ pending: tanks }), standing)).toEqual({});
  });

  it('a newer Rated wins; the rule still returns if empty', () => {
    expect(handBack(row({ rated: true }), lock)).toEqual({ pending: ioniaNoxus });
  });

  it('a standing lock returns no rule; a default Rated returns nothing', () => {
    expect(handBack(row(), { standing: 'normal', mode: { id: 'normal' }, rated: null })).toEqual({});
  });

  it('returns the pair as last locked (redraws included)', () => {
    const redrawn = lockTransition(lock, { type: 'redraw' }, ctx());
    if (!redrawn.ok) throw new Error('refused');
    expect(handBack(row(), redrawn.lock).pending).toEqual({ id: 'region', blue: 'ionia', red: 'targon' });
  });

  it('twice equals once', () => {
    for (const state of [
      row(),
      row({ pending: tanks }),
      row({ rated: true }),
      row({ pending: mirror, rated: false }),
    ]) {
      const once = apply(state, handBack(state, lock));
      expect(handBack(once, lock)).toEqual({});
    }
  });

  it('take then handBack restores the row exactly when nothing changed in between', () => {
    const states: ModeRow[] = [
      row(),
      row({ standing: 'fearless', rated: true }),
      row({ rated: false }),
      row({ pending: tanks }),
      row({ pending: tanks, rated: false }),
      row({ pending: tanks, rated: true }),
      row({ pending: mirror, rated: true }),
      row({ pending: ioniaNoxus }),
      row({ pending: ioniaNoxus, rated: false }),
    ];
    for (const state of states) {
      const taken = take(state, ctx());
      const after = apply(state, taken.patch);
      expect(apply(after, handBack(after, taken.lock))).toEqual(state);
    }
    // The no-draw path too, with Rated at its default.
    const noDraw = row({ standing: 'fearless', pending: ioniaNoxus });
    const taken = take(noDraw, ctx(sequence(0), NO_PAIR));
    const after = apply(noDraw, taken.patch);
    expect(apply(after, handBack(after, taken.lock))).toEqual(noDraw);
  });

  it('the no-draw limit: an explicit Rated moved with a standing lock is not put on the still-pending rule', () => {
    const noDraw = row({ standing: 'fearless', pending: ioniaNoxus, rated: true });
    const taken = take(noDraw, ctx(sequence(0), NO_PAIR));
    const after = apply(noDraw, taken.patch);
    expect(handBack(after, taken.lock)).toEqual({});
  });

  it('take then a newer admin choice then handBack keeps every newer field', () => {
    const state = row({ pending: ioniaNoxus, rated: true });
    const taken = take(state, ctx());
    let after = apply(state, taken.patch);
    after = apply(after, patchOf(after, { type: 'pick', rule: mirror }));
    after = apply(after, patchOf(after, { type: 'rated', rated: false }));
    expect(handBack(after, taken.lock)).toEqual({});
  });
});

describe('recordGame: the lock if there is one, otherwise the pending state', () => {
  const lock: ModeLock = { standing: 'fearless', mode: ioniaNoxus, rated: null };
  const game = (over: Partial<RecordInput>): RecordInput => ({
    kind: 'rift',
    lock: null,
    live: true,
    ...over,
  });

  it('a Rift game from a rolled lobby stamps the lock and writes nothing to the row', () => {
    const state = row({ standing: 'fearless', pending: tanks, rated: true });
    expect(recordGame(state, game({ lock }))).toEqual({
      stamp: { standing: 'fearless', mode: ioniaNoxus, rated: false, checked: true },
      patch: {},
    });
    expect(
      recordGame(state, game({ lock: { standing: 'normal', mode: { id: 'normal' }, rated: false } })),
    ).toEqual({
      stamp: { standing: 'normal', mode: { id: 'normal' }, rated: false, checked: false },
      patch: {},
    });
  });

  it('a Rift game with no lock (hand-made teams, never rolled) plays and uses up the pending state', () => {
    const state = row({ standing: 'fearless', pending: ioniaNoxus, rated: true });
    expect(recordGame(state, game({}))).toEqual({
      stamp: { standing: 'fearless', mode: ioniaNoxus, rated: true, checked: true },
      patch: { pending: null, rated: null },
    });
    expect(recordGame(row({ rated: false }), game({}))).toEqual({
      stamp: { standing: 'normal', mode: { id: 'normal' }, rated: false, checked: false },
      patch: { pending: null, rated: null },
    });
  });

  it('a remake or ARAM is never rated or checked; with a lock it hands back, without one it writes nothing', () => {
    for (const kind of ['remake', 'aram'] as const) {
      expect(recordGame(row(), game({ kind, lock }))).toEqual({
        stamp: { standing: 'fearless', mode: ioniaNoxus, rated: false, checked: false },
        patch: { pending: ioniaNoxus },
      });
      // Pending tanks and an ARAM: the game was never played under tanks, which stays pending.
      expect(recordGame(row({ pending: tanks, rated: true }), game({ kind }))).toEqual({
        stamp: { standing: 'normal', mode: { id: 'normal' }, rated: false, checked: false },
        patch: {},
      });
    }
  });

  it('a backfilled game takes the standing mode at its default and never touches the row', () => {
    const state = row({ standing: 'fearless', pending: tanks, rated: false });
    expect(recordGame(state, game({ live: false }))).toEqual({
      stamp: { standing: 'fearless', mode: { id: 'fearless' }, rated: true, checked: false },
      patch: {},
    });
    expect(recordGame(state, game({ live: false, lock })).patch).toEqual({});
  });
});

describe('the owner rule: the rule and Rated belong to the next game actually played', () => {
  it('hand-made teams after Roll with the lobby still up: the game plays the lock', () => {
    // Roll suggests teams; players move sides by hand; nothing touches the lock or the row.
    const state = row({ pending: tanks, rated: true });
    const taken = take(state, ctx());
    const after = apply(state, taken.patch);
    const recorded = recordGame(after, { kind: 'rift', lock: taken.lock, live: true });
    expect(recorded.stamp).toEqual({ standing: 'normal', mode: tanks, rated: true, checked: true });
    expect(apply(after, recorded.patch)).toEqual(row());
  });

  it('hand-made teams after Roll with the teams brought down: the rule and Rated come back and the game plays them', () => {
    const state = row({ pending: ioniaNoxus, rated: true });
    const taken = take(state, ctx());
    let after = apply(state, taken.patch);
    after = apply(after, handBack(after, taken.lock)); // teams down: balanced -> open
    expect(after).toEqual(state);
    const recorded = recordGame(after, { kind: 'rift', lock: null, live: true });
    expect(recorded.stamp).toEqual({ standing: 'normal', mode: ioniaNoxus, rated: true, checked: true });
    expect(apply(after, recorded.patch)).toEqual(row());
  });

  it('teams brought down twice and rolled again never loses the rule or Rated', () => {
    let state = row({ standing: 'fearless', pending: mirror, rated: false });
    for (let i = 0; i < 3; i += 1) {
      const taken = take(state, ctx());
      const after = apply(state, taken.patch);
      state = apply(after, handBack(after, taken.lock));
    }
    expect(state).toEqual(row({ standing: 'fearless', pending: mirror, rated: false }));
  });

  it('the 2.0 QA case: a Rated flip after Roll changes only the next game and never repeats the rule', () => {
    const state = row({ pending: tanks });
    const taken = take(state, ctx());
    let after = apply(state, taken.patch);
    after = apply(after, patchOf(after, { type: 'rated', rated: true }));
    const recorded = recordGame(after, { kind: 'rift', lock: taken.lock, live: true });
    expect(recorded.stamp).toEqual({ standing: 'normal', mode: tanks, rated: false, checked: true });
    expect(apply(after, recorded.patch)).toEqual(row({ rated: true }));
    expect(nextRated(apply(after, recorded.patch))).toBe(true);
  });
});

describe('nextRated', () => {
  it('the switch, else the next game mode default', () => {
    expect(nextRated(row())).toBe(true);
    expect(nextRated(row({ pending: tanks }))).toBe(false);
    expect(nextRated(row({ pending: tanks, rated: true }))).toBe(true);
    expect(nextRated(row({ pending: mirror }))).toBe(true);
  });
});

describe('property: no reachable state is a region rule without a valid pair', () => {
  const ACTIONS = (rng: Rng): ModeAction => {
    const r = rng();
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
    if (r < 0.12) return { type: 'standing', standing: pick(['normal', 'fearless'] as const) };
    if (r < 0.35) return { type: 'pick', rule: pick([tanks, mages, regionPick, mirror]) };
    if (r < 0.45) return { type: 'rated', rated: rng() < 0.5 };
    if (r < 0.55) return { type: 'spin', previous: null };
    if (r < 0.75) return { type: 'redraw' };
    return { type: 'set-side', side: pick(['blue', 'red'] as const), region: pick(REGIONS) };
  };
  const validPair = (rule: PendingRule | null) =>
    rule?.id !== 'region' ||
    (typeof rule.blue === 'string' &&
      typeof rule.red === 'string' &&
      rule.blue !== rule.red &&
      REGIONS.includes(rule.blue as never) &&
      REGIONS.includes(rule.red as never));

  it('over 300 random sequences with Roll, hand-backs and records in between', () => {
    const rng = seeded(6);
    for (let run = 0; run < 300; run += 1) {
      const bans = rng() < 0.5 ? [] : [TARGON_ONE, IONIA_ONE];
      const context = ctx(rng, bans);
      let state = row();
      let lock: ModeLock | null = null;
      for (let step = 0; step < 40; step += 1) {
        const r = rng();
        if (r < 0.1 && lock === null) {
          const taken = take(state, context);
          state = apply(state, taken.patch);
          lock = taken.lock;
        } else if (r < 0.15 && lock !== null) {
          state = apply(state, handBack(state, lock));
          lock = null;
        } else if (r < 0.2) {
          state = apply(state, recordGame(state, { kind: 'rift', lock, live: true }).patch);
          lock = null;
        } else if (r < 0.25 && lock !== null) {
          const changed = lockTransition(
            lock,
            rng() < 0.5 ? { type: 'redraw' } : { type: 'set-side', side: 'red', region: 'zaun' },
            context,
          );
          if (changed.ok) lock = changed.lock;
        } else {
          const result = transition(state, ACTIONS(rng), context);
          if (result.ok) {
            const written = result.patch.pending;
            // A pair written by an action passes the draw rule at that moment.
            if (written?.id === 'region' && written !== state.pending) {
              const counted =
                state.standing === 'fearless' || result.patch.standing === 'fearless' ? bans : [];
              expect(pairDrawable(written.blue, written.red, ROSTER, counted)).toBe(true);
            }
            state = apply(state, result.patch);
          }
        }
        expect(validPair(state.pending)).toBe(true);
        if (lock !== null && lock.mode.id === 'region') expect(validPair(lock.mode)).toBe(true);
      }
    }
  });
});
