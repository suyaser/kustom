import { describe, expect, it } from 'vitest';
import * as core from './index';
import { ROLES, type Side } from './index';

describe('core skeleton', () => {
  it('exposes the five roles in lane order', () => {
    expect(ROLES).toEqual(['top', 'jungle', 'mid', 'adc', 'support']);
  });

  it('types blue as 100 and red as 200', () => {
    const blue: Side = 100;
    const red: Side = 200;
    expect([blue, red]).toEqual([100, 200]);
  });

  it('exports the rating API and config from the single entry point', () => {
    // `packages/db` and the balancer import these; a rename here is a breaking change.
    expect(Object.keys(core).sort()).toEqual([
      'BalanceError',
      'ROLES',
      // The MVP / ACE adjustment (M7.8), applied to a fold's result and never inside the fold.
      'applyMvpAceBonus',
      'balance',
      // How even a split is as a percentage (M3.31): `evenness(predictWin(...))` for a caller
      // holding ratings. A display transform, never a second win-probability model.
      'balanceScore',
      'config',
      'displayRating',
      // The same transform over a stored `blue_win_prob` (M3.31) — what a display surface calls.
      'evenness',
      'explain',
      // A player's main and backup read off their own games (M5.16); M5.17 stores the pair.
      'inferRoles',
      // The role model's one predicate, for the surfaces that mark an off-role line (M3.1).
      'isOffRole',
      // Who carried each side (M7.8): the MVP won, the ACE did not.
      'mvpAce',
      'nextSplit',
      'ordinal',
      // One game's seven-component score per player (M7.8, M7.13, M7.14), normalised in-game.
      'performanceScores',
      'predictWin',
      // Where every stored rating starts, on both tracks (2026-09-16). No arguments: nothing
      // about a player changes it, and that is the decision.
      'provisionalSeed',
      'rateGame',
      // The weekly track's fold (M7.2): a second number, same shape, its own tuning. It never
      // forms teams and nothing under `lib/ingest/` may import it.
      'rateGameWeekly',
      // The resolver behind it, for the tonight page's `<override> · <old main>` row (M3.6).
      'resolveRoles',
      'seedFromRank',
    ]);
  });
});

describe('resolveRoles (exported for the tonight page, M3.6)', () => {
  // The page prints the pair as `<main> · <secondary>`; these three rows are what it may render.
  it('no override: main and backup unchanged', () => {
    const resolved: core.ResolvedRoles = core.resolveRoles({
      mainRole: 'support',
      secondaryRole: 'mid',
    });
    expect(resolved).toEqual({ main: 'support', secondary: 'mid' });
    expect(core.resolveRoles({ mainRole: 'support', secondaryRole: 'mid', roleOverride: null })).toEqual({
      main: 'support',
      secondary: 'mid',
    });
  });

  it('override equal to the main: unchanged', () => {
    const profile: core.RoleProfile = { mainRole: 'support', secondaryRole: 'mid', roleOverride: 'support' };
    expect(core.resolveRoles(profile)).toEqual({ main: 'support', secondary: 'mid' });
  });

  it('override different from the main: main = override, backup = old main', () => {
    expect(core.resolveRoles({ mainRole: 'support', secondaryRole: 'mid', roleOverride: 'top' })).toEqual({
      main: 'top',
      secondary: 'support',
    });
  });

  it('is the same function the balancer uses, not a copy', () => {
    // `isOffRole` is `roleTier !== 'main'` over this resolver; if the two ever disagree the page
    // would print one pair and the explanation another.
    const yuki: core.RoleProfile = { mainRole: 'support', secondaryRole: 'mid', roleOverride: 'top' };
    expect(core.isOffRole(yuki, core.resolveRoles(yuki).main as core.Role)).toBe(false);
    expect(core.isOffRole(yuki, 'support')).toBe(true);
  });
});
