import { readFileSync } from 'node:fs';
import { storedGameFactsSchema } from '@customs/db/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordingClient } from '../testing/recordingClient';
import { currentFacts, GAME_FACTS_VERSION, gameFactsInsert, resolveFacts } from './gameFacts';
import { rawFactsFromUnknown } from './rawFacts';

/**
 * `game_facts` (0041): the stored row is `rawFactsFromUnknown(raw)` exactly, and a reader takes it
 * only when it parses and is current; anything else is a raw read, never a wrong number.
 */

function fixture(name: string): unknown {
  const url = new URL(`../../../../packages/lcu/fixtures/16.17/${name}.json`, import.meta.url);
  return (JSON.parse(readFileSync(url, 'utf8')) as { body: unknown }).body;
}

const loud = {
  gameMode: 'CLASSIC',
  teams: [
    {
      teamId: 100,
      bans: [{ championId: 7 }, { championId: '12' }],
      players: [
        {
          puuid: 'p-1',
          championName: 'Ahri',
          detectedTeamPosition: 'MIDDLE',
          spell1Id: 11,
          stats: {
            firstBloodKill: true,
            PENTA_KILLS: 1,
            objectivesStolen: 2,
            dragonKills: 1,
            VISION_SCORE: 31,
          },
        },
      ],
    },
    { teamId: 200, players: [{ puuid: 'p-2', stats: { firstBloodDeath: true, totalDamageTaken: 41_000 } }] },
  ],
};

const blocks: [string, unknown][] = [
  ['the recorded end-of-game block', fixture('eog-stats-block')],
  ['the recorded match-history detail', fixture('match-detail')],
  ['an end-of-game block with facts and bans', loud],
  ['an empty object', {}],
  ['null', null],
];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the stored shape', () => {
  it.each(blocks)('rawFactsFromUnknown parses as storedGameFactsSchema, unchanged: %s', (_label, raw) => {
    const facts = rawFactsFromUnknown(raw);
    // Through JSON, the way it is stored and read back.
    const stored = JSON.parse(JSON.stringify(facts));
    expect(storedGameFactsSchema.parse(stored)).toEqual(facts);
  });

  it('writes the current version and the game and group it belongs to', () => {
    const row = gameFactsInsert({ id: 'g-1', groupId: 'grp-1' }, loud);
    expect(row).toEqual({
      game_id: 'g-1',
      group_id: 'grp-1',
      facts_version: GAME_FACTS_VERSION,
      facts: rawFactsFromUnknown(loud),
    });
  });
});

describe('currentFacts', () => {
  const facts = rawFactsFromUnknown(loud);

  it('takes a current row, embedded as an array or as one object', () => {
    expect(currentFacts([{ facts_version: GAME_FACTS_VERSION, facts }])).toEqual(facts);
    expect(currentFacts({ facts_version: GAME_FACTS_VERSION, facts })).toEqual(facts);
  });

  it('sends a missing, older, newer or malformed row to raw', () => {
    expect(currentFacts([])).toBeNull();
    expect(currentFacts(null)).toBeNull();
    expect(currentFacts(undefined)).toBeNull();
    expect(currentFacts([{ facts_version: GAME_FACTS_VERSION + 1, facts }])).toBeNull();
    expect(currentFacts([{ facts_version: GAME_FACTS_VERSION, facts: { byPuuid: [] } }])).toBeNull();
    expect(
      currentFacts([
        { facts_version: GAME_FACTS_VERSION, facts: { byPuuid: { p: { smite: 'yes' } }, bans: [] } },
      ]),
    ).toBeNull();
  });
});

describe('resolveFacts', () => {
  it('reads raw paths only for the games with no current row, in one request', async () => {
    const facts = rawFactsFromUnknown(loud);
    const { client, recording } = recordingClient({
      games: [
        {
          id: 'g-2',
          gameMode: loud.gameMode,
          teams: loud.teams,
          participants: null,
          participantIdentities: null,
        },
        { id: 'g-3', gameMode: null, teams: null, participants: null, participantIdentities: null },
      ],
    });
    const resolved = await resolveFacts(client, [
      { id: 'g-1', game_facts: [{ facts_version: GAME_FACTS_VERSION, facts }] },
      { id: 'g-2', game_facts: [] },
      { id: 'g-3', game_facts: [{ facts_version: GAME_FACTS_VERSION + 1, facts }] },
    ]);
    expect(resolved.get('g-1')).toEqual(facts);
    expect(resolved.get('g-2')).toEqual(facts);
    expect(resolved.get('g-3')).toEqual(rawFactsFromUnknown({}));
    expect(recording.count()).toBe(1);
    expect(recording.rawSelects()).toEqual([]);
  });

  it('makes no request when every row is current', async () => {
    const { client, recording } = recordingClient({});
    const facts = rawFactsFromUnknown(loud);
    await resolveFacts(client, [{ id: 'g-1', game_facts: [{ facts_version: GAME_FACTS_VERSION, facts }] }]);
    expect(recording.count()).toBe(0);
  });
});
