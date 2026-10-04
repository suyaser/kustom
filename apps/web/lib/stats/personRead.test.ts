import { describe, expect, it } from 'vitest';
import { type Fixtures, recordingClient } from '../testing/recordingClient';
import { youVsEveryone } from '../versus/you';
import { loadPlayerStats, loadWindowGames } from './load';
import { playerStatsView } from './player';

/**
 * The player page and You vs them read only the person's games (database performance plan,
 * finding 5: a year-old group's player page read 8 MB to describe one person). These pin that the
 * answer is exactly the group read's, and that the read falls back to the group when it could not
 * be (a closed week's awards, a window over the cap).
 */

const GROUP = '00000000-0000-0000-0000-00000000a001';
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const NOW = new Date('2026-10-07T12:00:00.000Z');
const PID = (n: number) => `00000000-0000-0000-0000-0000000d00${String(n).padStart(2, '0')}`;
const PUUID = (n: number) => `puuid-${n}`;

/** Fourteen people, twenty games, rosters rotating so everybody misses some; three ARAMs, one ARAM-less tie. */
function fixtures(): Fixtures {
  const people = Array.from({ length: 14 }, (_, n) => n);
  const games = Array.from({ length: 20 }, (_, g) => ({
    id: `00000000-0000-0000-0000-0000000c00${String(g).padStart(2, '0')}`,
    group_id: GROUP,
    // Two games share an instant (tie broken on lcu_game_id), one has no lcu id.
    started_at: new Date(NOW.getTime() - Math.floor(g / 2) * 86_400_000 - (g % 2) * 3_600_000).toISOString(),
    lcu_game_id: g === 7 ? null : 5_000 + g,
    duration_s: g === 3 ? 200 : 1_800,
    winning_side: g % 3 === 0 ? 200 : 100,
    lobby_id: null,
    game_mode: g % 6 === 5 ? 'ARAM' : g % 4 === 0 ? null : 'CLASSIC',
  }));
  const game_players = games.flatMap((game, g) =>
    Array.from({ length: 10 }, (_, seat) => {
      const n = people[(g * 3 + seat) % people.length] as number;
      return {
        game_id: game.id,
        group_id: GROUP,
        player_id: PID(n),
        side: seat < 5 ? 100 : 200,
        role: ROLES[seat % 5],
        champion_id: 1 + ((g + seat) % 30),
        kills: (g + seat) % 9,
        deaths: (g * seat) % 7,
        assists: (g + 2 * seat) % 11,
        gold: 9_000 + seat * 300,
        damage_to_champs: 15_000 + g * 100 + seat,
        cs: 120 + seat,
        vision_score: 20 + seat,
        damage_self_mitigated: 9_000,
        damage_to_objectives: 3_000,
        mu_before: 25,
        mu_after: 25.5,
      };
    }),
  );
  return {
    players_public: people.map((n) => ({
      id: PID(n),
      puuid: PUUID(n),
      display_name: `Player ${n}`,
      game_name: `Player ${n}`,
      main_role: ROLES[n % 5],
    })),
    games,
    game_players,
  };
}

const options = (window: 'all-time' | 'this-week' | 'last-week') => ({
  window,
  groupId: GROUP,
  now: NOW,
  timeZone: 'Europe/London',
});

describe('the one-person read', () => {
  it.each(['all-time', 'this-week'] as const)(
    'gives the player page the group read’s answer (%s)',
    async (window) => {
      for (const n of [0, 5, 13]) {
        const group = recordingClient(fixtures());
        const read = await loadWindowGames(group.client, options(window));
        const expected = playerStatsView({
          window,
          puuid: PUUID(n),
          games: read.games,
          players: read.players,
          range: { start: null, end: null },
          capped: false,
          cap: 2_000,
        });
        const person = recordingClient(fixtures());
        const actual = await loadPlayerStats(person.client, PUUID(n), options(window));
        expect(actual).toEqual(expected);
        // It took the person path: one person lookup, one id read.
        expect(person.recording.count('players_public')).toBe(2);
        expect(
          person.recording.requests.some(
            (r) => r.table === 'game_players' && r.select === 'game_id, games!inner(started_at)',
          ),
        ).toBe(true);
      }
    },
  );

  it('gives You vs them the group read’s answer', async () => {
    for (const n of [1, 8]) {
      const group = recordingClient(fixtures());
      const read = await loadWindowGames(group.client, options('all-time'), { withGameMode: true });
      const expected = youVsEveryone(read.games, read.players, PUUID(n));
      const person = recordingClient(fixtures());
      const viewer = await loadWindowGames(person.client, options('all-time'), {
        withGameMode: true,
        onlyPuuid: PUUID(n),
      });
      expect(youVsEveryone(viewer.games, viewer.players, PUUID(n))).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
      // Fewer games than the group's, every one of them theirs.
      expect(viewer.games.length).toBeLessThan(read.games.length);
      const id = PID(n);
      expect(viewer.games.every((game) => game.rows.some((row) => row.playerId === id))).toBe(true);
      // Newest first, the group read's order.
      expect(viewer.games.map((game) => game.id)).toEqual(
        read.games.filter((game) => game.rows.some((row) => row.playerId === id)).map((game) => game.id),
      );
    }
  });

  it('reads the group for a closed week (its awards fold every game)', async () => {
    const person = recordingClient(fixtures());
    await loadPlayerStats(person.client, PUUID(0), options('last-week'));
    expect(person.recording.requests.some((r) => r.select === 'game_id, games!inner(started_at)')).toBe(
      false,
    );
  });

  it('reads the group when the window holds more games than the cap', async () => {
    const person = recordingClient(fixtures());
    const view = await loadPlayerStats(person.client, PUUID(0), { ...options('all-time'), maxGames: 5 });
    expect(view.capped).toBe(true);
    expect(person.recording.requests.some((r) => r.select === 'game_id, games!inner(started_at)')).toBe(
      false,
    );
  });

  it('is the empty view for a puuid nobody has', async () => {
    const person = recordingClient(fixtures());
    const view = await loadPlayerStats(person.client, 'nobody', options('all-time'));
    expect(view.games).toBe(0);
    expect(person.recording.count('game_players')).toBe(0);
  });
});
