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
      // M15.2 the mode model: ids, families, the five classes, rule options, rated defaults.
      'CLASS_TAGS',
      // M18.1 the Kustom rating (not yet wired): the start, and the typed input error.
      'KUSTOM_START',
      'KustomInputError',
      'MODE_IDS',
      'ROLES',
      'RULE_FAMILIES',
      'RULE_OPTIONS',
      // Rated games before a player is ranked on the board (M14.4, STRATEGY §5).
      'SETTLING_GAMES',
      // M15.2 review: the families Spin draws from (class, region and mirror since M17.17).
      'SPIN_FAMILIES',
      'STANDING_MODES',
      'UNAFFILIATED',
      // M15.2 lifecycle: compare and clear once a game is recorded.
      'afterRecord',
      // The MVP / ACE adjustment (M7.8), applied to a fold's result and never inside the fold.
      'applyMvpAceBonus',
      'balance',
      // How even a split is as a percentage (M3.31): `evenness(predictWin(...))` for a caller
      // holding ratings. A display transform, never a second win-probability model.
      'balanceScore',
      // M14.4, the fairness receipt: how honest the odds were, over games the caller chose.
      'calibration',
      // M15.2 the post-game rule check: per side (mirror: per lane), champions only.
      'checkMode',
      'chooseRule',
      'chooseStanding',
      // M15.2 pools: any-tag classes, regions, minus the Fearless bans the caller passes.
      'classPool',
      'config',
      'consumesRule',
      // M14.4: who differs between two stored splits; the sentence's `Next best:` is built on it.
      'describeSwap',
      // M18.1: round(r), the printed Kustom Rating.
      'displayKustom',
      'displayRating',
      // M15.2 the server's draws, with an injected RNG.
      'drawRegions',
      'drawSpin',
      'drawableRegions',
      // The same transform over a stored `blue_win_prob` (M3.31) — what a display surface calls.
      'evenness',
      'explain',
      // M14.58: why a game moved a Rating, as structure (stored breakdown, and pre-0034 rows).
      'explainDelta',
      // M18.1: why a Kustom row moved, as structure (web owns the words, M18.7).
      'explainKustomDelta',
      'explainLegacyDelta',
      // M14.4: the favored side and its rounded % for a `blue_win_prob`, so pages do no maths.
      'favoredSide',
      // M14.58 / M14.59 (a): the probability the fold stores per side; predictWin, one function.
      'foldWinProbability',
      'gameStamp',
      // A player's main and backup read off their own games (M5.16); M5.17 stores the pair.
      'inferRoles',
      // The role model's one predicate, for the surfaces that mark an off-role line (M3.1).
      'isOffRole',
      // M14.4: under `SETTLING_GAMES` rated games, the board's unnumbered section.
      'isSettling',
      'isStandingMode',
      // M18.1: K from the player's own rated games on the track (32 down to 16).
      'kFor',
      'lockAtRoll',
      'modeFamily',
      'modePool',
      'modeRatedDefault',
      // Who carried each side (M7.8): the MVP won, the ACE did not.
      'mvpAce',
      'nextGame',
      'nextSplit',
      // M14.4: STRATEGY §4.3's band for a `blue_win_prob`; the copy stays in apps/web.
      'oddsBand',
      'ordinal',
      // One game's seven-component score per player (M7.8, M7.13, M7.14), normalised in-game.
      'performanceScores',
      // M14.4: `predictWin` from `mu_before` / `sigma_before` for a game with no split, or null.
      'preGameOdds',
      'predictWin',
      // M18.1: round(after) - round(before), so a column adds up.
      'printedChange',
      // Where every stored rating starts (2026-09-16). No arguments: nothing
      // about a player changes it, and that is the decision.
      'provisionalSeed',
      'rateGame',
      // M18.1: one game folded on one Kustom track.
      'rateGameKustom',
      'regionOpenCounts',
      'regionPool',
      // The resolver behind it, for the tonight page's `<override> · <old main>` row (M3.6).
      'resolveRoles',
      'ruleKey',
      'ruleOf',
      'rulePlayable',
      'sameRule',
      'seedFromRank',
      'setRated',
      // M18.1: performance-rank shares (1.2 .. 0.8 winners, reversed losers).
      'shareFor',
      'shareRanks',
      'startState',
      // M14.4: why the runner-up ranked lower, from `off_role_count` and `gap` (STRATEGY §4.4).
      'whyLower',
      // M18.1: the one Kustom odds function, logistic(a + b * gap / 400).
      'winProbability',
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
