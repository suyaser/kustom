import { describe, expect, it, vi } from 'vitest';
import { nightStart } from '../night';
import type { PublicClient } from '../publicClient';
import { displayDelta } from '../ratingDisplay';
import { yourNightAwards, yourNightBest, yourNightLine } from './screenCopy';
import { foldYourNight, loadYourNightOrNone, type YourNightGame, type YourNightRow } from './yourNight';

/**
 * Your night (M14.36): the fold from tonight's games to the recap, pure. The players are p0..p9
 * (puuid u0..u9), blue p0..p4, red p5..p9; the viewer is p0 (top, blue).
 */
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const PUUID_OF = new Map(Array.from({ length: 10 }, (_, i) => [`p${i}`, `u${i}`]));
const ME = 'p0';

function row(i: number, over: Partial<YourNightRow> = {}): YourNightRow {
  return {
    player_id: `p${i}`,
    side: i < 5 ? 100 : 200,
    role: ROLES[i % 5] ?? 'top',
    kills: 3,
    deaths: 3,
    assists: 3,
    gold: 10_000,
    cs: 150,
    vision_score: 20,
    damage_self_mitigated: 10_000,
    damage_to_objectives: 3_000,
    damage_to_champs: 15_000,
    champion_id: 145,
    mu_before: 25,
    mu_after: i < 5 ? 25.5 : 24.5,
    ...over,
  };
}

function game(
  id: string,
  at: string,
  opts: { winner?: 100 | 200; me?: Partial<YourNightRow>; aram?: boolean; unrated?: boolean } = {},
): YourNightGame {
  const winner = opts.winner ?? 100;
  return {
    id,
    started_at: at,
    duration_s: 1_800,
    winning_side: winner,
    gameMode: opts.aram ? 'ARAM' : 'CLASSIC',
    game_players: Array.from({ length: 10 }, (_, i) => {
      const won = (i < 5 ? 100 : 200) === winner;
      const base = row(i, { mu_after: won ? 25.6 : 24.4 });
      const aramOrUnrated = opts.aram || opts.unrated;
      const withRating = aramOrUnrated ? { ...base, mu_before: null, mu_after: null } : base;
      return i === 0 ? { ...withRating, ...(opts.me ?? {}) } : withRating;
    }),
  };
}

describe('your night', () => {
  it('is nothing for a viewer with no counted game tonight', () => {
    expect(foldYourNight([], ME, PUUID_OF)).toBeNull();
    expect(foldYourNight([game('g1', '2026-10-03T18:00:00Z', { unrated: true })], ME, PUUID_OF)).toBeNull();
  });

  it("counts wins and losses, and the Rating change is the sum of the posters' per-game deltas", () => {
    const games = [
      game('g1', '2026-10-03T18:00:00Z', { winner: 100, me: { mu_before: 25, mu_after: 25.7 } }),
      game('g2', '2026-10-03T19:00:00Z', { winner: 200, me: { mu_before: 25.7, mu_after: 25.1 } }),
      game('g3', '2026-10-03T20:00:00Z', { winner: 100, me: { mu_before: 25.1, mu_after: 25.9 } }),
    ];
    const night = foldYourNight(games, ME, PUUID_OF);
    expect(night).toMatchObject({ wins: 2, losses: 1 });
    expect(night?.ratingDelta).toBe(
      displayDelta(25, 25.7) + displayDelta(25.7, 25.1) + displayDelta(25.1, 25.9),
    );
    expect(yourNightLine(2, 1, '+38')).toBe('Your night: 2 wins, 1 loss, Rating +38.');
  });

  it('picks the best game by performance score, ties to the later game', () => {
    const big = { kills: 12, deaths: 2, assists: 8, damage_to_champs: 40_000, champion_id: 145 };
    const games = [
      game('g1', '2026-10-03T18:00:00Z', { me: { ...big, champion_id: 103 } }),
      game('g2', '2026-10-03T19:00:00Z', {
        me: { kills: 1, deaths: 9, assists: 1, damage_to_champs: 2_000, champion_id: 22 },
      }),
      game('g3', '2026-10-03T20:00:00Z', { me: big }),
    ];
    const night = foldYourNight(games, ME, PUUID_OF);
    expect(night?.best).toEqual({ champion: "Kai'Sa", kills: 12, deaths: 2, assists: 8 });
    expect(yourNightBest("Kai'Sa", 12, 2, 8)).toBe("Best game: Kai'Sa, 12/2/8.");
  });

  it('counts MVPs and ACEs from the award, and says them in words', () => {
    const big = { kills: 20, deaths: 0, assists: 15, damage_to_champs: 60_000, gold: 20_000, cs: 300 };
    const night = foldYourNight(
      [game('g1', '2026-10-03T18:00:00Z', { me: big }), game('g2', '2026-10-03T19:00:00Z', { me: big })],
      ME,
      PUUID_OF,
    );
    expect(night?.mvp).toBe(2);
    expect(yourNightAwards(2, 1)).toBe('MVP twice. ACE once.');
    expect(yourNightAwards(0, 3)).toBe('ACE 3 times.');
    expect(yourNightAwards(0, 0)).toBeNull();
  });

  it('counts ARAM in wins and losses and says nothing about Rating when the night was only ARAM', () => {
    const night = foldYourNight(
      [
        game('a1', '2026-10-03T18:00:00Z', { aram: true }),
        game('a2', '2026-10-03T19:00:00Z', { aram: true }),
      ],
      ME,
      PUUID_OF,
    );
    expect(night).toMatchObject({ wins: 2, losses: 0, ratingDelta: null, mvp: 0, ace: 0 });
    expect(yourNightLine(2, 0, null)).toBe('Your night: 2 wins, 0 losses. ARAM, so no Rating change.');
  });

  it('M15.5: counts a not-rated Rift game in W/L and says not rated when nothing was rated', () => {
    const notRated = (id: string, at: string, winner: 100 | 200 = 100) => ({
      ...game(id, at, { unrated: true, winner }),
      rated: false,
    });
    const night = foldYourNight(
      [notRated('n1', '2026-10-03T18:00:00Z'), notRated('n2', '2026-10-03T19:00:00Z', 200)],
      ME,
      PUUID_OF,
    );
    expect(night).toMatchObject({ wins: 1, losses: 1, ratingDelta: null, notRated: true, mvp: 0 });
    expect(yourNightLine(1, 1, null, true)).toBe(
      'Your night: 1 win, 1 loss. Not rated, so no Rating change.',
    );
    // A remake played not rated is still not a game; with a rated game the Rating line wins.
    const remake = { ...notRated('r1', '2026-10-03T18:00:00Z'), duration_s: 200 };
    expect(foldYourNight([remake], ME, PUUID_OF)).toBeNull();
    const mixed = foldYourNight(
      [notRated('n1', '2026-10-03T18:00:00Z'), game('g1', '2026-10-03T19:00:00Z')],
      ME,
      PUUID_OF,
    );
    expect(mixed?.wins).toBe(2);
    expect(mixed?.ratingDelta).not.toBeNull();
  });

  it('goes at the 06:00 boundary: with the clock past it, last night is not tonight', () => {
    const games = [game('g1', '2026-10-03T18:00:00Z')];
    const tonight = nightStart(new Date('2026-10-03T22:00:00Z'), 'Africa/Cairo');
    const tomorrow = nightStart(new Date('2026-10-04T04:30:00Z'), 'Africa/Cairo');
    expect(foldYourNight(games, ME, PUUID_OF, tonight)).not.toBeNull();
    expect(foldYourNight(games, ME, PUUID_OF, tomorrow)).toBeNull();
  });
});

/**
 * The loader with a fake client (M14.36 review): it reads this group's games only, a failed read is
 * no card (never a throw), and a viewer with no player row is no card.
 */
describe('loadYourNightOrNone', () => {
  type Call = { table: string; ops: [string, unknown[]][] };

  function fakeClient(answers: {
    me?: { data: { id: string } | null; error: { message: string } | null };
    games?: { data: YourNightGame[] | null; error: { message: string } | null };
    players?: { data: { id: string; puuid: string }[]; error: null };
  }): { client: PublicClient; calls: Call[] } {
    const calls: Call[] = [];
    let playersReads = 0;
    const client = {
      from(table: string) {
        const call: Call = { table, ops: [] };
        calls.push(call);
        const answer = () => {
          if (table === 'games') return answers.games ?? { data: [], error: null };
          playersReads += 1;
          return playersReads === 1
            ? (answers.me ?? { data: { id: ME }, error: null })
            : (answers.players ?? { data: [...PUUID_OF].map(([id, puuid]) => ({ id, puuid })), error: null });
        };
        const builder: Record<string, unknown> = {};
        for (const op of ['select', 'eq', 'gte', 'in', 'order', 'range']) {
          builder[op] = (...args: unknown[]) => {
            call.ops.push([op, args]);
            return builder;
          };
        }
        builder.maybeSingle = async () => answer();
        // biome-ignore lint/suspicious/noThenProperty: a PostgREST builder is awaitable
        builder.then = (resolve: (value: unknown) => void) => resolve(answer());
        return builder;
      },
    } as unknown as PublicClient;
    return { client, calls };
  }

  const options = { groupId: 'group-a', nightStart: new Date('2026-10-03T03:00:00Z'), puuid: 'u0' };

  it("reads only this group's games, since the night started, and folds them", async () => {
    const { client, calls } = fakeClient({
      games: { data: [game('g1', '2026-10-03T18:00:00Z')], error: null },
    });
    const night = await loadYourNightOrNone(client, options);
    expect(night).toMatchObject({ wins: 1, losses: 0 });
    const games = calls.find((call) => call.table === 'games');
    expect(games?.ops).toContainEqual(['eq', ['group_id', 'group-a']]);
    expect(games?.ops).toContainEqual(['gte', ['started_at', options.nightStart.toISOString()]]);
  });

  it('is no card when a read fails, never a throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient({ games: { data: null, error: { message: 'boom' } } });
    await expect(loadYourNightOrNone(client, options)).resolves.toBeNull();
    const meFails = fakeClient({ me: { data: null, error: { message: 'boom' } } });
    await expect(loadYourNightOrNone(meFails.client, options)).resolves.toBeNull();
  });

  it('is no card for a viewer with no player row, and reads no games for them', async () => {
    const { client, calls } = fakeClient({ me: { data: null, error: null } });
    await expect(loadYourNightOrNone(client, options)).resolves.toBeNull();
    expect(calls.some((call) => call.table === 'games')).toBe(false);
  });

  it("is no card when the viewer played none of tonight's games", async () => {
    const { client } = fakeClient({
      me: { data: { id: 'someone-else' }, error: null },
      games: { data: [game('g1', '2026-10-03T18:00:00Z')], error: null },
    });
    await expect(loadYourNightOrNone(client, options)).resolves.toBeNull();
  });
});
