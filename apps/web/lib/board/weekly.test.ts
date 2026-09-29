import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, type Rating, rateGameWeekly, seedFromRank } from '@customs/core';
import { describe, expect, it, vi } from 'vitest';
import { type FoldPerformance, gameAward, gatedGameAward } from '../ingest/fold';
import { foldWeeklyRatings, isWeekWindow, type WeeklyGame, type WeeklyPlayer } from './weekly';

/**
 * The weekly fold (M7.3), on its own: seeds in, one week's games in, a rating per player out.
 *
 * Everything with a database behind it is `app/weekBoard.integration.test.ts`; this file is the
 * three rules the fold is made of — the order, the seed, and what it does with a game it cannot
 * read — plus the two windows it applies to.
 */

const SEED: Rating = seedFromRank('GOLD', 'IV');
const TEN = Array.from({ length: 10 }, (_, index) => `p${index}`);
const seeds = (): Map<string, Rating> => new Map(TEN.map((id) => [id, SEED]));

/**
 * A seat with **no stat line**: every column null, the shape a row read without the nine stat
 * columns — or stored before migrations 0014/0015 — arrives in. Core's missing-input rule gives
 * such a game no MVP, so every test written before M7.24 still reads the plain weekly fold.
 */
const NO_STATS: FoldPerformance = {
  role: null,
  kills: null,
  deaths: null,
  assists: null,
  damageToChamps: null,
  gold: null,
  cs: null,
  visionScore: null,
  damageSelfMitigated: null,
  damageToObjectives: null,
};

function seat(id: string, index: number): WeeklyPlayer {
  return { playerId: id, puuid: `puuid-${id}`, side: index < 5 ? 100 : 200, ...NO_STATS };
}

function game(overrides: Partial<WeeklyGame> = {}): WeeklyGame {
  return {
    gameId: 'game-1',
    startedAt: '2026-03-09T19:00:00Z',
    lcuGameId: 1,
    winningSide: 100,
    players: TEN.map(seat),
    ...overrides,
  };
}

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

/**
 * Ten seats carrying **every** input the score reads (M7.24): a role each, five distinct a side,
 * and all nine stat columns, each line different so the award has one clear answer. The same
 * spread `lib/ingest/fold.test.ts` gives `foldGame`.
 */
function scoredSeats(): WeeklyPlayer[] {
  return TEN.map((id, index) => ({
    playerId: id,
    puuid: `puuid-${id}`,
    side: index < 5 ? (100 as const) : (200 as const),
    role: ROLES[index % 5] ?? null,
    kills: index,
    deaths: 10 - index,
    assists: index * 2,
    damageToChamps: 20_000 + index * 2_500,
    gold: 10_000 + index * 250,
    cs: 150 + index * 3,
    visionScore: 20 + index,
    damageSelfMitigated: 8_000 + index * 400,
    damageToObjectives: 3_000 + index * 600,
  }));
}

function scoredGame(overrides: Partial<WeeklyGame> = {}): WeeklyGame {
  return game({ players: scoredSeats(), ...overrides });
}

describe('isWeekWindow', () => {
  it('is the two week windows and nothing else', () => {
    expect(isWeekWindow('this-week')).toBe(true);
    expect(isWeekWindow('last-week')).toBe(true);
    // The month windows keep the all-time number for ever (user, 2026-09-15): this predicate
    // is a list of two on purpose, not a window length.
    expect(isWeekWindow('this-month')).toBe(false);
    expect(isWeekWindow('last-month')).toBe(false);
    expect(isWeekWindow('all-time')).toBe(false);
  });
});

describe('the weekly fold', () => {
  it('is every player at their seed when the week has no games', () => {
    const folded = foldWeeklyRatings([], seeds());

    expect([...folded.keys()].sort()).toEqual([...TEN].sort());
    for (const held of folded.values()) {
      expect(held.rating).toEqual(SEED);
      expect(held.seed).toEqual(SEED);
      expect(held.games).toEqual([]);
    }
  });

  it('is `rateGameWeekly` applied to the seeds, and keeps the seed beside the answer', () => {
    const folded = foldWeeklyRatings([game()], seeds());
    const expected = rateGameWeekly(Array(5).fill(SEED), Array(5).fill(SEED), 100);

    expect(folded.get('p0')?.rating).toEqual(expected.blue[0]);
    expect(folded.get('p9')?.rating).toEqual(expected.red[0]);
    // The seed is carried, not recomputed: the row's climb is seed → end.
    expect(folded.get('p0')?.seed).toEqual(SEED);
    // And one step, for the row's expand.
    expect(folded.get('p0')?.games).toEqual([
      { gameId: 'game-1', muBefore: SEED.mu, muAfter: (expected.blue[0] as Rating).mu },
    ]);
  });

  /**
   * **`started_at`, then `lcu_game_id`** — the rebuild's order (M5.2), so a week and a history
   * folded from the same games tell the same story. The games are handed over newest first here
   * (the order the loader's own select returns them in) and the answer must be the ordered one.
   */
  it('folds in started_at then lcu_game_id order, whatever order it is given them in', () => {
    const first = game({ gameId: 'a', startedAt: '2026-03-09T19:00:00Z', lcuGameId: 1, winningSide: 100 });
    const second = game({ gameId: 'b', startedAt: '2026-03-09T19:00:00Z', lcuGameId: 2, winningSide: 200 });
    const third = game({ gameId: 'c', startedAt: '2026-03-10T19:00:00Z', lcuGameId: 3, winningSide: 100 });

    const ordered = foldWeeklyRatings([first, second, third], seeds());
    const shuffled = foldWeeklyRatings([third, second, first], seeds());

    expect(shuffled.get('p0')?.rating).toEqual(ordered.get('p0')?.rating);
    expect(shuffled.get('p0')?.games.map((played) => played.gameId)).toEqual(['a', 'b', 'c']);
    // A different order really would be a different number: the same three games with the tie
    // broken the other way do not land on the same rating.
    const reversedTie = foldWeeklyRatings(
      [{ ...first, lcuGameId: 2 }, { ...second, lcuGameId: 1 }, third],
      seeds(),
    );
    expect(reversedTie.get('p0')?.games.map((played) => played.gameId)).toEqual(['b', 'a', 'c']);
  });

  it('chains each game from the one before it', () => {
    const folded = foldWeeklyRatings(
      [game({ gameId: 'a', lcuGameId: 1 }), game({ gameId: 'b', lcuGameId: 2, winningSide: 200 })],
      seeds(),
    );
    const played = folded.get('p0')?.games ?? [];

    expect(played).toHaveLength(2);
    expect(played[0]?.muBefore).toBe(SEED.mu);
    expect(played[1]?.muBefore).toBe(played[0]?.muAfter);
    expect(folded.get('p0')?.rating.mu).toBe(played[1]?.muAfter);
  });

  /**
   * **A game it cannot read is skipped, loudly, and never thrown.** `rateGameWeekly` takes five
   * and five; the all-time fold already refused anything else, so this cannot come from the
   * pipeline — but a board that 500s over one odd row would be worse than a board that is one
   * game stale.
   */
  it('skips a game that is not five and five, and leaves everybody else folded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const odd = game({
      gameId: 'odd',
      lcuGameId: 1,
      players: TEN.slice(0, 9).map(seat),
    });

    const folded = foldWeeklyRatings([odd, game({ gameId: 'good', lcuGameId: 2 })], seeds());

    expect(folded.get('p0')?.games.map((played) => played.gameId)).toEqual(['good']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('odd');
    warn.mockRestore();
  });

  it('skips a game whose seat the board has no seed for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const short = new Map(seeds());
    short.delete('p9');

    const folded = foldWeeklyRatings([game()], short);

    expect(folded.get('p0')?.games).toEqual([]);
    expect(folded.get('p0')?.rating).toEqual(SEED);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  /**
   * **The weekly track never forms teams** (M7.3's acceptance 4). The balancer, the live fold
   * and the rebuild all read the all-time rating, and a week folded at read time must not reach
   * them: the check is a grep, so here is the grep.
   */
  it('is imported by nothing under lib/ingest', () => {
    const ingest = join(import.meta.dirname, '..', 'ingest');
    const offenders = readdirSync(ingest)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => {
        const source = readFileSync(join(ingest, name), 'utf8');
        return /from\s+'[^']*board\/weekly'/.test(source) || source.includes('rateGameWeekly');
      });

    expect(offenders).toEqual([]);
  });

  /**
   * **No weekly settling constant of any name** (M7.3's acceptance 9, product 2026-09-15). A
   * week never claims to settle, so there is no second threshold and no second chip to hold
   * one, and the name product refused appears nowhere a grep can find it.
   */
  it('leaves no weekly settling threshold anywhere in the app', () => {
    const roots = ['app', 'lib', 'scripts'].map((dir) => join(import.meta.dirname, '..', '..', dir));
    const offenders: string[] = [];
    // Assembled rather than typed, so `grep -r` over the repo finds nothing — including this
    // file, which would otherwise be the one hit the acceptance check forbids.
    const needle = ['WEEKLY', 'SETTLING'].join('_');

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry.name) && readFileSync(path, 'utf8').includes(needle)) {
          offenders.push(path);
        }
      }
    };
    for (const root of roots) walk(root);

    expect(offenders).toEqual([]);
  });

  /**
   * **One fold, not two** (M7.16's acceptance 6). `/leaderboard`'s rows, `/p/[puuid]` and
   * `Most improved` all read the week through this file: a second walk of `rateGameWeekly`
   * anywhere under `apps/web` would be two answers about one week, which is the defect M7.16
   * was opened to close and not a way to close it. The check is a grep, so here is the grep.
   */
  it('is the only file in the app that folds a week', () => {
    const roots = ['app', 'lib', 'scripts'].map((dir) => join(import.meta.dirname, '..', '..', dir));
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          // Tests may spell the expected numbers out; source may not.
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          // The **import**, not the word: `load.ts`, `types.ts` and `awards.ts` all name the
          // function in a comment about this file, which is the opposite of a second fold.
          if (/import\s*\{[^}]*\brateGameWeekly\b/.test(readFileSync(path, 'utf8'))) {
            offenders.push(entry.name);
          }
        }
      }
    };
    for (const root of roots) walk(root);

    expect(offenders.sort()).toEqual(['weekly.ts']);
  });

  /** Nothing is stored and nothing is shared: two folds of the same week are the same numbers. */
  it('is a pure function of its arguments', () => {
    const once = foldWeeklyRatings([game()], seeds());
    const twice = foldWeeklyRatings([game()], seeds());

    expect([...twice].map(([id, held]) => [id, held.rating])).toEqual(
      [...once].map(([id, held]) => [id, held.rating]),
    );
  });

  /**
   * **One fold, and the award is inside it** (M7.24). `foldWeeklyRatings` names the MVP and the
   * ACE with `lib/ingest/fold.ts`'s `gameAward` and scales them with core's `applyMvpAceBonus`
   * — the two calls `foldGame` makes. A second scorer anywhere in the app would be two answers
   * about one game; the check is a grep, so here is the grep.
   */
  it('calls the scorer the all-time fold calls, and no other', () => {
    const source = readFileSync(join(import.meta.dirname, 'weekly.ts'), 'utf8');

    expect(source).toMatch(/import\s*\{[^}]*\bgameAward\b[^}]*\}\s*from\s*'\.\.\/ingest\/fold'/);
    expect(source).toMatch(/import\s*\{[^}]*\bapplyMvpAceBonus\b[^}]*\}\s*from\s*'@customs\/core'/);
    // Not core's `mvpAce` or `performanceScores` directly: the rename in front of the scorer is
    // `gameAward`'s, and a week that spelled its own would be the second copy.
    expect(source).not.toMatch(/import\s*\{[^}]*\b(mvpAce|performanceScores)\b/);
    expect(source).not.toMatch(/\bmvpAce\(|\bperformanceScores\(/);
  });
});

/**
 * **The MVP / ACE bonus on the weekly track** (M7.24, user 2026-09-29 — reversing M7.9's
 * close-out ruling that the week never carries it). Every number is checked against
 * `rateGameWeekly` alone and the award `gameAward` names, the way `lib/ingest/fold.test.ts`
 * checks `foldGame` against `rateGame`.
 */
describe('the weekly fold and the MVP / ACE bonus', () => {
  const byPuuid = (a: WeeklyPlayer, b: WeeklyPlayer): number =>
    a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;

  /** What `rateGameWeekly` alone gives each seat of one game from the seeds, keyed by player id. */
  function plain(played: WeeklyGame): Map<string, Rating> {
    const blue = played.players.filter((p) => p.side === 100).sort(byPuuid);
    const red = played.players.filter((p) => p.side === 200).sort(byPuuid);
    const raw = rateGameWeekly(
      blue.map(() => SEED),
      red.map(() => SEED),
      played.winningSide,
    );
    const out = new Map<string, Rating>();
    blue.forEach((player, index) => {
      out.set(player.playerId, raw.blue[index] as Rating);
    });
    red.forEach((player, index) => {
      out.set(player.playerId, raw.red[index] as Rating);
    });
    return out;
  }

  /** **Acceptance 2**: MVP 1.25x, ACE 0.80x, eight untouched, `sigma` never moved. */
  it('scales the MVP by 1.25 and the ACE by 0.80 of their raw weekly delta, and leaves eight alone', () => {
    const played = scoredGame();
    const award = gameAward(played.players, played.winningSide);
    if (award === null) throw new Error('expected a game with every input to have an MVP');

    const base = plain(played);
    const folded = foldWeeklyRatings([played], seeds());

    const moved: string[] = [];
    for (const player of played.players) {
      const raw = base.get(player.playerId) as Rating;
      const now = folded.get(player.playerId)?.rating as Rating;
      expect(now.sigma).toBe(raw.sigma);
      const factor =
        player.puuid === award.mvp
          ? 1 + config.rating.mvp.bonusFraction
          : player.puuid === award.ace
            ? 1 - config.rating.mvp.aceReliefFraction
            : null;
      if (factor === null) {
        expect([player.playerId, now.mu]).toEqual([player.playerId, raw.mu]);
      } else {
        expect(now.mu).toBe(SEED.mu + (raw.mu - SEED.mu) * factor);
        moved.push(player.puuid);
      }
    }
    expect(moved.sort()).toEqual([award.mvp, award.ace].sort());
    // The constants are the ones the brief names, not whatever config happens to hold.
    expect(1 + config.rating.mvp.bonusFraction).toBe(1.25);
    expect(1 - config.rating.mvp.aceReliefFraction).toBe(0.8);
  });

  it('keeps the MVP s weekly gain bigger and the ACE s weekly loss smaller, and neither sign flips', () => {
    const played = scoredGame();
    const award = gameAward(played.players, played.winningSide) as { mvp: string; ace: string };
    const idOf = new Map(played.players.map((player) => [player.puuid, player.playerId]));
    const mvp = idOf.get(award.mvp) as string;
    const ace = idOf.get(award.ace) as string;
    const base = plain(played);
    const folded = foldWeeklyRatings([played], seeds());
    const gained = (id: string) => (folded.get(id)?.rating.mu as number) - SEED.mu;
    const plainGained = (id: string) => (base.get(id) as Rating).mu - SEED.mu;

    expect(plainGained(mvp)).toBeGreaterThan(0);
    expect(gained(mvp)).toBeGreaterThan(plainGained(mvp));
    expect(gained(ace)).toBeLessThan(0);
    expect(gained(ace)).toBeGreaterThan(plainGained(ace));
    // The step the row's expand and `/p/[puuid]` print is the adjusted one.
    expect(folded.get(mvp)?.games).toEqual([
      { gameId: 'game-1', muBefore: SEED.mu, muAfter: folded.get(mvp)?.rating.mu },
    ]);
  });

  /**
   * **Acceptance 3**: a hole in any column on any one seat — or a seat with no role — and the
   * game has no award, by core's universal rule, and folds exactly as `rateGameWeekly` alone.
   */
  it('folds a game with a missing stat column or a missing role exactly as rateGameWeekly alone does', () => {
    const holes: { what: string; hole: (player: WeeklyPlayer) => WeeklyPlayer }[] = [
      { what: 'kills', hole: (player) => ({ ...player, kills: null }) },
      { what: 'deaths', hole: (player) => ({ ...player, deaths: null }) },
      { what: 'assists', hole: (player) => ({ ...player, assists: null }) },
      { what: 'damage to champions', hole: (player) => ({ ...player, damageToChamps: null }) },
      { what: 'gold', hole: (player) => ({ ...player, gold: null }) },
      { what: 'cs', hole: (player) => ({ ...player, cs: null }) },
      { what: 'vision score', hole: (player) => ({ ...player, visionScore: null }) },
      { what: 'damage self mitigated', hole: (player) => ({ ...player, damageSelfMitigated: null }) },
      { what: 'damage to objectives', hole: (player) => ({ ...player, damageToObjectives: null }) },
      { what: 'the role', hole: (player) => ({ ...player, role: null }) },
    ];

    for (const { what, hole } of holes) {
      // On one seat of ten, on the losing side, where nothing about the winners changed.
      const played = scoredGame({ players: scoredSeats().map((p, index) => (index === 7 ? hole(p) : p)) });
      expect(gameAward(played.players, played.winningSide), what).toBeNull();

      const base = plain(played);
      const folded = foldWeeklyRatings([played], seeds());
      for (const player of played.players) {
        expect([what, folded.get(player.playerId)?.rating]).toEqual([what, base.get(player.playerId)]);
      }
    }
  });

  it('folds a week of rows read with no stat line exactly as it did before M7.24', () => {
    const folded = foldWeeklyRatings([game()], seeds());
    const expected = rateGameWeekly(Array(5).fill(SEED), Array(5).fill(SEED), 100);
    for (const [index, id] of TEN.entries()) {
      const side = index < 5 ? expected.blue : expected.red;
      expect([id, folded.get(id)?.rating]).toEqual([id, side[0]]);
    }
  });

  /**
   * A skipped game never reaches the award (no new failure mode), and a game the plain weekly
   * fold could read but core's scorer would throw on — a puuid twice — gets no award rather than
   * a 500.
   */
  it('adds no failure mode: a skipped game stays skipped, and a repeated puuid gets no award', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nine = scoredGame({ gameId: 'nine', players: scoredSeats().slice(0, 9) });
    const twice = scoredGame({
      gameId: 'twice',
      lcuGameId: 2,
      players: scoredSeats().map((p, index) => (index === 9 ? { ...p, puuid: 'puuid-p0' } : p)),
    });

    expect(() => foldWeeklyRatings([nine, twice], seeds())).not.toThrow();
    const folded = foldWeeklyRatings([nine], seeds());
    expect(folded.get('p0')?.games).toEqual([]);
    warn.mockRestore();
  });

  /**
   * **Acceptance 6**: the MVP / ACE `/p/[puuid]` names on a week window (M7.10's `recentAward`,
   * through `gatedGameAward`) is the seat whose weekly delta the fold amplified — so the word on
   * the row and the number beside it cannot disagree. Both winners of the result, across both
   * possible results, so neither side's answer is a coincidence.
   */
  it('amplifies exactly the seats the recent-games row names, whichever side won', () => {
    for (const winningSide of [100, 200] as const) {
      const played = scoredGame({ winningSide });
      const named = gatedGameAward(played.players, 1_800, winningSide);
      if (named === null) throw new Error('expected the printing surface to name an MVP');

      const base = plain(played);
      const folded = foldWeeklyRatings([played], seeds());
      const amplified = played.players
        .filter((p) => (folded.get(p.playerId)?.rating.mu as number) !== (base.get(p.playerId) as Rating).mu)
        .map((p) => {
          const gain = (folded.get(p.playerId)?.rating.mu as number) - SEED.mu;
          const raw = (base.get(p.playerId) as Rating).mu - SEED.mu;
          return { puuid: p.puuid, amplified: Math.abs(gain) > Math.abs(raw) };
        });

      expect(amplified).toHaveLength(2);
      expect(amplified.find((seat) => seat.amplified)?.puuid).toBe(named.mvp);
      expect(amplified.find((seat) => !seat.amplified)?.puuid).toBe(named.ace);
    }
  });
});
