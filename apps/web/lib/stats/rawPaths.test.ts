import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inParallel } from '../chunks';
import { gameModeFromRaw } from '../games/queue';
import { rawFromPaths } from './load';
import { rawFactsFromUnknown } from './rawFacts';

/**
 * The Stats read selects `raw->gameMode`, `raw->teams`, `raw->participants` and
 * `raw->participantIdentities` instead of the whole end-of-game block. These pin that the two
 * readers answer the same from those four paths as from the whole column, for both stored shapes
 * and the junk a public-read column can hold.
 */

function fixture(name: string): unknown {
  const url = new URL(`../../../../packages/lcu/fixtures/16.17/${name}.json`, import.meta.url);
  return (JSON.parse(readFileSync(url, 'utf8')) as { body: unknown }).body;
}

/** What PostgREST answers for `alias:raw->key`: the key's value, or null for anything else. */
function selectPaths(raw: unknown) {
  const at = (key: string) =>
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? ((raw as Record<string, unknown>)[key] ?? null)
      : null;
  return {
    gameMode: at('gameMode'),
    teams: at('teams'),
    participants: at('participants'),
    participantIdentities: at('participantIdentities'),
  };
}

const eog = fixture('eog-stats-block');
const detail = fixture('match-detail');

/** An end-of-game block with real facts on it (the 16.17 fixture is a bot game of zeroes). */
const loudEog = {
  gameMode: ' aram ',
  localPlayer: { stats: { firstBloodKill: true } },
  teams: [
    {
      teamId: 100,
      bans: [{ championId: 7 }],
      players: [
        {
          puuid: 'p-1',
          championName: 'Ahri',
          detectedTeamPosition: 'MIDDLE',
          spell1Id: 11,
          stats: { firstBloodKill: true, PENTA_KILLS: 1, objectivesStolen: 2, dragonKills: 1 },
        },
      ],
    },
    { teamId: 200, players: [{ puuid: 'p-2', stats: { firstBloodDeath: true } }] },
  ],
};

const cases: [string, unknown][] = [
  ['the recorded end-of-game block', eog],
  ['the recorded match-history detail', detail],
  ['an end-of-game block with facts and bans', loudEog],
  ['a block with no gameMode', { teams: [] }],
  ['a non-string gameMode', { gameMode: 5, teams: 'nope' }],
  ['an empty object', {}],
  ['null', null],
  ['an array', [1, 2]],
  ['a string', 'CLASSIC'],
];

describe('rawFromPaths', () => {
  it.each(cases)('gives the same mode and facts as the whole column: %s', (_label, raw) => {
    const paths = rawFromPaths(JSON.parse(JSON.stringify(selectPaths(raw))));
    expect(gameModeFromRaw(paths)).toBe(gameModeFromRaw(raw));
    expect(rawFactsFromUnknown(paths)).toEqual(rawFactsFromUnknown(raw));
  });

  it('keeps the facts that matter on a real-shaped block', () => {
    const facts = rawFactsFromUnknown(rawFromPaths(selectPaths(loudEog)));
    expect(gameModeFromRaw(rawFromPaths(selectPaths(loudEog)))).toBe('ARAM');
    expect(facts.byPuuid['p-1']).toMatchObject({ firstBloodKill: true, pentaKills: 1, smite: true });
    expect(facts.bans).toEqual([{ championId: 7, teamId: 100 }]);
  });

  it('treats an absent path like a null one', () => {
    expect(rawFromPaths({})).toEqual({
      gameMode: null,
      teams: null,
      participants: null,
      participantIdentities: null,
    });
  });
});

describe('inParallel', () => {
  it('answers in item order, whatever order the work finishes in', async () => {
    const out = await inParallel([30, 5, 20, 1], async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms * 2;
    });
    expect(out).toEqual([60, 10, 40, 2]);
  });

  it('keeps at most the limit in flight', async () => {
    let live = 0;
    let peak = 0;
    await inParallel(
      Array.from({ length: 20 }, (_, index) => index),
      async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => setTimeout(resolve, 2));
        live -= 1;
      },
      6,
    );
    expect(peak).toBe(6);
  });

  it('makes no call for no items, and rejects on the first failure', async () => {
    expect(await inParallel([], async () => 1)).toEqual([]);
    await expect(
      inParallel([1, 2], async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
