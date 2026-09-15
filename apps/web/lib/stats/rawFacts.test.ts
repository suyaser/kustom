import { describe, expect, it } from 'vitest';
import {
  emptyRawFacts,
  mergeDraftBans,
  rawFactsFromUnknown,
  rawHasDraftBanList,
  rawNeedsDraftBanEnrichment,
  stealLine,
} from './rawFacts';

describe('rawFactsFromUnknown', () => {
  it('is empty on junk', () => {
    expect(rawFactsFromUnknown(null)).toEqual(emptyRawFacts());
    expect(rawFactsFromUnknown('nope')).toEqual(emptyRawFacts());
    expect(rawFactsFromUnknown({ gameMode: 'CLASSIC' })).toEqual(emptyRawFacts());
  });

  it('reads first blood, steals and the champion name off an end-of-game block', () => {
    const facts = rawFactsFromUnknown({
      gameMode: 'CLASSIC',
      teams: [
        {
          teamId: 100,
          players: [
            {
              puuid: 'u-lena',
              championName: 'Ahri',
              detectedTeamPosition: 'MIDDLE',
              spell1Id: 4,
              spell2Id: 14,
              stats: {
                firstBloodKill: 1,
                firstBloodAssist: 0,
                firstBloodDeath: 0,
                VISION_SCORE: 22,
                objectivesStolen: 2,
                baronKills: 1,
                dragonKills: 0,
                longestTimeSpentLiving: 640,
                pentaKills: 1,
                quadraKills: 0,
                tripleKills: 2,
                doubleKills: 3,
                largestKillingSpree: 8,
                firstTowerKill: 1,
              },
            },
          ],
        },
        {
          teamId: 200,
          players: [
            {
              puuid: 'u-yuki',
              championName: 'Yasuo',
              stats: { firstBloodKill: 0, firstBloodAssist: 0, objectivesStolen: 0 },
            },
            { puuid: '00000000-0000-0000-0000-000000000000', stats: { firstBloodKill: 1 } },
          ],
        },
      ],
    });

    expect(facts.byPuuid['u-lena']?.firstBloodKill).toBe(true);
    expect(facts.byPuuid['u-lena']?.objectivesStolen).toBe(2);
    expect(facts.byPuuid['u-lena']?.championName).toBe('Ahri');
    expect(facts.byPuuid['u-lena']?.longestLivedS).toBe(640);
    expect(facts.byPuuid['u-lena']?.role).toBe('mid');
    expect(facts.byPuuid['u-lena']?.pentaKills).toBe(1);
    expect(facts.byPuuid['u-lena']?.tripleKills).toBe(2);
    expect(facts.byPuuid['u-lena']?.doubleKills).toBe(3);
    expect(facts.byPuuid['u-lena']?.largestKillingSpree).toBe(8);
    expect(facts.byPuuid['u-lena']?.firstTowerKill).toBe(true);
    expect(stealLine(facts.byPuuid['u-lena'] as NonNullable<(typeof facts.byPuuid)[string]>)).toBe(
      '2 baron steals',
    );
    expect(facts.byPuuid['u-yuki']?.firstBloodKill).toBe(false);
    expect(facts.byPuuid['00000000-0000-0000-0000-000000000000']).toBeUndefined();
  });

  it('reads first blood and draft bans off a match-history detail', () => {
    const facts = rawFactsFromUnknown({
      participantIdentities: [
        { participantId: 1, player: { puuid: 'u-omar' } },
        { participantId: 6, player: { puuid: 'u-hana' } },
      ],
      participants: [
        {
          participantId: 1,
          teamId: 100,
          spell1Id: 4,
          spell2Id: 12,
          timeline: { lane: 'MIDDLE', role: 'SOLO' },
          stats: { firstBloodKill: false, firstBloodDeath: true, visionScore: 40 },
        },
        {
          participantId: 6,
          teamId: 200,
          spell1Id: 11,
          spell2Id: 4,
          timeline: { lane: 'JUNGLE', role: 'NONE' },
          stats: {
            firstBloodKill: true,
            objectivesStolen: 1,
            dragonKills: 1,
            quadraKills: 1,
            tripleKills: 0,
            firstTowerKill: false,
          },
        },
      ],
      teams: [
        {
          teamId: 100,
          bans: [
            { championId: 35, pickTurn: 1 },
            { championId: -1, pickTurn: 2 },
          ],
        },
        { teamId: 200, bans: [{ championId: 103, pickTurn: 6 }] },
      ],
    });

    expect(facts.byPuuid['u-hana']?.firstBloodKill).toBe(true);
    expect(facts.byPuuid['u-hana']?.smite).toBe(true);
    expect(facts.byPuuid['u-hana']?.timelineLane).toBe('JUNGLE');
    expect(facts.byPuuid['u-omar']?.visionScore).toBe(40);
    expect(facts.byPuuid['u-omar']?.firstBloodDeath).toBe(true);
    expect(facts.byPuuid['u-hana']?.firstBloodDeath).toBe(false);
    expect(facts.byPuuid['u-hana']?.quadraKills).toBe(1);
    expect(facts.byPuuid['u-hana']?.firstTowerKill).toBe(false);
    expect(stealLine(facts.byPuuid['u-hana'] as NonNullable<(typeof facts.byPuuid)[string]>)).toBe(
      '1 dragon steal',
    );
    expect(facts.bans).toEqual([
      { championId: 35, teamId: 100 },
      { championId: 103, teamId: 200 },
    ]);
  });

  /**
   * M7.7. These two are the only stats here the MVP / ACE bonus cannot do without, and the
   * only two whose absence has to stay distinguishable from a zero: a tank with no stored
   * mitigation must not read as a tank who mitigated nothing.
   */
  it('reads vision score and damage mitigated off both shapes and both spellings', () => {
    const eog = rawFactsFromUnknown({
      teams: [
        {
          teamId: 100,
          players: [
            {
              puuid: 'u-lena',
              stats: { VISION_SCORE: 53, TOTAL_DAMAGE_SELF_MITIGATED: 48_955 },
            },
            // The camelCase duplicates the block carries beside the uppercase keys.
            {
              puuid: 'u-yuki',
              stats: { visionScore: 18, damageSelfMitigated: 151_130 },
            },
            // A block that never said. Null, not zero.
            { puuid: 'u-omar', stats: { CHAMPIONS_KILLED: 4 } },
            // Uppercase wins when a block disagrees with itself (M2.10's rule for every stat).
            {
              puuid: 'u-hana',
              stats: {
                VISION_SCORE: 90,
                visionScore: 1,
                TOTAL_DAMAGE_SELF_MITIGATED: 19_814,
                damageSelfMitigated: 2,
              },
            },
          ],
        },
      ],
    });

    expect(eog.byPuuid['u-lena']?.visionScore).toBe(53);
    expect(eog.byPuuid['u-lena']?.damageSelfMitigated).toBe(48_955);
    expect(eog.byPuuid['u-yuki']?.visionScore).toBe(18);
    expect(eog.byPuuid['u-yuki']?.damageSelfMitigated).toBe(151_130);
    expect(eog.byPuuid['u-omar']?.visionScore).toBeNull();
    expect(eog.byPuuid['u-omar']?.damageSelfMitigated).toBeNull();
    expect(eog.byPuuid['u-hana']?.visionScore).toBe(90);
    expect(eog.byPuuid['u-hana']?.damageSelfMitigated).toBe(19_814);

    const detail = rawFactsFromUnknown({
      participantIdentities: [{ participantId: 1, player: { puuid: 'u-omar' } }],
      participants: [
        { participantId: 1, teamId: 100, stats: { visionScore: 110, damageSelfMitigated: 30_154 } },
      ],
    });
    expect(detail.byPuuid['u-omar']?.visionScore).toBe(110);
    expect(detail.byPuuid['u-omar']?.damageSelfMitigated).toBe(30_154);

    // A genuine zero is a zero, and is not the same fact as a missing key.
    const zeroed = rawFactsFromUnknown({
      teams: [
        {
          teamId: 100,
          players: [{ puuid: 'u-aram', stats: { VISION_SCORE: 0, TOTAL_DAMAGE_SELF_MITIGATED: 0 } }],
        },
      ],
    });
    expect(zeroed.byPuuid['u-aram']?.visionScore).toBe(0);
    expect(zeroed.byPuuid['u-aram']?.damageSelfMitigated).toBe(0);
  });

  it('reads draft bans off match-history teams that have no players', () => {
    const facts = rawFactsFromUnknown({
      teams: [
        {
          teamId: 100,
          bans: [
            { championId: 11, pickTurn: 1 },
            { championId: '154', pickTurn: 2 },
          ],
        },
        { teamId: 200, bans: [{ championId: 11, pickTurn: 6 }] },
      ],
    });
    expect(facts.bans).toEqual([
      { championId: 11, teamId: 100 },
      { championId: 154, teamId: 100 },
      { championId: 11, teamId: 200 },
    ]);
  });

  it('reads bans copied onto an end-of-game team that already has players', () => {
    const facts = rawFactsFromUnknown({
      gameMode: 'CLASSIC',
      teams: [
        {
          teamId: 100,
          players: [{ puuid: 'u-lena', stats: { firstBloodKill: 1 } }],
          bans: [{ championId: 11, pickTurn: 1 }],
        },
        {
          teamId: 200,
          players: [{ puuid: 'u-yuki', stats: {} }],
          bans: [{ championId: 154, pickTurn: 6 }],
        },
      ],
    });
    expect(facts.byPuuid['u-lena']?.firstBloodKill).toBe(true);
    expect(facts.bans).toEqual([
      { championId: 11, teamId: 100 },
      { championId: 154, teamId: 200 },
    ]);
  });
});

describe('rawNeedsDraftBanEnrichment', () => {
  it('asks for a live eog Rift row that never stored bans', () => {
    expect(rawNeedsDraftBanEnrichment({ gameMode: 'CLASSIC', teams: [{ teamId: 100, players: [] }] })).toBe(
      true,
    );
    expect(rawNeedsDraftBanEnrichment({ teams: [{ teamId: 100, players: [] }] })).toBe(true);
  });

  it('does not keep asking once a ban list is present, or for ARAM', () => {
    expect(
      rawNeedsDraftBanEnrichment({
        gameMode: 'CLASSIC',
        teams: [{ teamId: 100, bans: [{ championId: 11 }] }],
      }),
    ).toBe(false);
    expect(rawNeedsDraftBanEnrichment({ gameMode: 'ARAM', teams: [{ teamId: 100, players: [] }] })).toBe(
      false,
    );
  });
});

describe('mergeDraftBans', () => {
  it('copies match-history bans onto an eog block that never stored them', () => {
    const stored = {
      gameId: 1,
      teams: [
        { teamId: 100, players: [{ puuid: 'u-lena' }] },
        { teamId: 200, players: [{ puuid: 'u-yuki' }] },
      ],
    };
    const incoming = {
      teams: [
        { teamId: 100, bans: [{ championId: 11, pickTurn: 1 }] },
        { teamId: 200, bans: [{ championId: 154, pickTurn: 6 }] },
      ],
    };
    expect(rawHasDraftBanList(stored)).toBe(false);
    const merged = mergeDraftBans(stored, incoming);
    expect(merged).not.toBeNull();
    expect(rawHasDraftBanList(merged)).toBe(true);
    expect(rawFactsFromUnknown(merged).bans.map((ban) => ban.championId)).toEqual([11, 154]);
    expect(mergeDraftBans(merged, incoming)).toBeNull();
  });

  it('does not invent a list when the incoming block has none', () => {
    expect(
      mergeDraftBans({ teams: [{ teamId: 100, players: [] }] }, { teams: [{ teamId: 100 }] }),
    ).toBeNull();
  });
});
