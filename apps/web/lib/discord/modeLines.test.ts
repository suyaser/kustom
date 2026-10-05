import type { Mode, Role } from '@customs/core';
import type { RuleCheck } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import { game4Identity } from '../testing/discordGame4';
import { buildResultInput, type ResultSource, type ResultSourcePlayer, storedRule } from './assemble';
import {
  EXPLANATION_STYLE,
  type ResultEmbedInput,
  type ResultPlayer,
  resultEmbed,
  type TeamsEmbedInput,
  type TeamsPlayer,
  teamsEmbed,
} from './embeds';
import {
  NOT_RATED_RESULT_LINE,
  NOT_RATED_TEAMS_LINE,
  resultModeLines,
  ruleCheckLine,
  teamsModeLine,
  teamsModeWords,
} from './modeLines';
import { announcesResult } from './post';

/**
 * M15.6: the rule line on the teams post and its Reroll posts, the kept / broke / couldn't-check
 * line and `Not rated, so no Rating change.` on the result post. Every string is the brief's §4
 * (`redesign/briefs/m15.1-mode-of-the-night.md`); the snapshots are whole payloads, one per mode
 * on the teams post and one per verdict on the result post.
 */

const URL = 'https://kustom.example/g/customs/mode';
const TIMESTAMP = '2026-10-04T20:15:00.000Z';
const IDENTITY = game4Identity('https://kustom.example');
const LANES: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];

const TANKS: Mode = { id: 'class', tag: 'Tank' };
const IONIA_NOXUS: Mode = { id: 'region', blue: 'ionia', red: 'noxus' };
const MIRROR: Mode = { id: 'mirror' };

// Data Dragon keys, named by `lib/champs/names.ts`.
const JINX = 222;
const ASHE = 22;
const LUX = 99;
const AMBESSA = 799;
const GAREN = 86;
const AHRI = 103;
const SYNDRA = 134;
const LEONA = 89;
const ORNN = 516;

type SideCheck = Extract<RuleCheck, { kind: 'sides' }>['blue'];
const side = (s: 100 | 200, broke: number[] = [], unknown: number[] = [], checked = true): SideCheck => ({
  side: s,
  verdict: broke.length > 0 ? 'broke' : checked ? 'kept' : 'unknown',
  broke,
  unknown,
});
const sides = (blue: SideCheck, red: SideCheck): RuleCheck => ({ kind: 'sides', blue, red });

function lanes(pairs: readonly [number | null, number | null][]): RuleCheck {
  const checked = LANES.map((lane, index) => {
    const [blue, red] = pairs[index] ?? [null, null];
    const verdict = blue === null || red === null ? 'unknown' : blue === red ? 'kept' : 'broke';
    return { lane, verdict, blue, red } as const;
  });
  return {
    kind: 'lanes',
    lanes: [...checked],
    kept: checked.filter((lane) => lane.verdict === 'kept').length,
  };
}

describe('teamsModeLine', () => {
  it('says the class, the rated word and the panel link: rule half bold, link masked (M14.61)', () => {
    expect(teamsModeLine({ mode: TANKS, rated: false }, URL)).toBe(
      `**This game: tanks only.** Not rated. [See the tanks](${URL})`,
    );
    expect(teamsModeLine({ mode: { id: 'class', tag: 'Marksman' }, rated: true }, URL)).toBe(
      `**This game: marksmen only.** Rated. [See the marksmen](${URL})`,
    );
  });

  it("keeps M15.6's words: drop the bold and unmask the link and it is the shipped sentence", () => {
    const plain = (line: string | null) =>
      (line ?? '').replaceAll('**', '').replace(/\[([^\]]+)\]\(([^)]+)\)/, '$1: $2');
    expect(plain(teamsModeLine({ mode: TANKS, rated: false }, URL))).toBe(
      `This game: tanks only. Not rated. See the tanks: ${URL}`,
    );
    expect(plain(teamsModeLine({ mode: IONIA_NOXUS, rated: false }, URL))).toBe(
      `This game: region wars. Blue picks from Ionia, Red from Noxus. Not rated. See both pools: ${URL}`,
    );
    expect(plain(teamsModeLine({ mode: MIRROR, rated: true }, URL))).toBe(
      `This game: mirror match, same champion as your lane opponent. Blind Pick lobby. Rated. How it works: ${URL}`,
    );
    expect(teamsModeWords({ mode: { id: 'normal' }, rated: true })).toBeNull();
  });

  it('region wars that could not be drawn says so, with no link (M15.17)', () => {
    const plain = (line: string | null) => (line ?? '').replaceAll('**', '');
    expect(plain(teamsModeLine({ mode: { id: 'fearless' }, rated: false, noDraw: true }, URL))).toBe(
      "This game: region wars couldn't be drawn, too few open champions. Not rated.",
    );
    expect(teamsModeLine({ mode: { id: 'normal' }, rated: false, noDraw: true }, URL)).toBe(
      "**This game: region wars couldn't be drawn, too few open champions.** Not rated.",
    );
    // An admin switched Rated on for it: the line tells the truth.
    expect(plain(teamsModeLine({ mode: { id: 'normal' }, rated: true, noDraw: true }, URL))).toBe(
      "This game: region wars couldn't be drawn, too few open champions. Rated.",
    );
  });

  it('names both regions in plain words', () => {
    expect(teamsModeLine({ mode: IONIA_NOXUS, rated: false }, URL)).toBe(
      `**This game: region wars.** Blue picks from Ionia, Red from Noxus. Not rated. [See both pools](${URL})`,
    );
    expect(
      teamsModeLine({ mode: { id: 'region', blue: 'shadow-isles', red: 'bandle-city' }, rated: false }, URL),
    ).toContain('Blue picks from Shadow Isles, Red from Bandle City.');
  });

  it('after this game regions were redrawn or changed: `new regions` (M20.1, M20.9)', () => {
    expect(teamsModeLine({ mode: IONIA_NOXUS, rated: false, newRegions: true }, URL)).toBe(
      `**This game: region wars, new regions.** Blue picks from Ionia, Red from Noxus. Not rated. [See both pools](${URL})`,
    );
    // Only region wars has regions to be new.
    expect(teamsModeLine({ mode: TANKS, rated: false, newRegions: true }, URL)).toBe(
      teamsModeLine({ mode: TANKS, rated: false }, URL),
    );
  });

  it("says mirror's Blind Pick lobby", () => {
    expect(teamsModeLine({ mode: MIRROR, rated: true }, URL)).toBe(
      `**This game: mirror match, same champion as your lane opponent.** Blind Pick lobby. Rated. [How it works](${URL})`,
    );
  });

  it('prints nothing for a rated Normal or Fearless game, and the not-rated line with no link', () => {
    expect(teamsModeLine({ mode: { id: 'normal' }, rated: true }, URL)).toBeNull();
    expect(teamsModeLine({ mode: { id: 'fearless' }, rated: true }, URL)).toBeNull();
    expect(teamsModeLine({ mode: { id: 'normal' }, rated: false }, URL)).toBe(`**${NOT_RATED_TEAMS_LINE}**`);
    expect(teamsModeLine({ mode: { id: 'fearless' }, rated: false }, URL)).toBe('**This game: not rated.**');
  });

  it('drops the link, never the sentence, when there is no honest URL', () => {
    expect(teamsModeLine({ mode: TANKS, rated: false }, undefined)).toBe(
      '**This game: tanks only.** Not rated.',
    );
  });
});

describe('ruleCheckLine', () => {
  it('both kept', () => {
    expect(ruleCheckLine(TANKS, sides(side(100), side(200)))).toBe('Tanks only: both sides kept the rule.');
  });

  it('one broke, one, two and three names', () => {
    expect(ruleCheckLine(TANKS, sides(side(100), side(200, [JINX])))).toBe(
      "Tanks only: Blue kept the rule. Red: Jinx isn't a tank.",
    );
    expect(ruleCheckLine(TANKS, sides(side(100), side(200, [JINX, ASHE])))).toBe(
      "Tanks only: Blue kept the rule. Red: Jinx and Ashe aren't tanks.",
    );
    expect(ruleCheckLine(TANKS, sides(side(100), side(200, [JINX, ASHE, LUX])))).toBe(
      "Tanks only: Blue kept the rule. Red: Jinx, Ashe and Lux aren't tanks.",
    );
    expect(ruleCheckLine({ id: 'class', tag: 'Assassin' }, sides(side(100, [LEONA]), side(200)))).toBe(
      "Assassins only: Red kept the rule. Blue: Leona isn't an assassin.",
    );
  });

  it('region', () => {
    expect(ruleCheckLine(IONIA_NOXUS, sides(side(100), side(200, [GAREN])))).toBe(
      "Ionia vs Noxus: Blue kept the rule. Red: Garen isn't from Noxus.",
    );
    expect(ruleCheckLine(IONIA_NOXUS, sides(side(100, [GAREN, LUX]), side(200)))).toBe(
      "Ionia vs Noxus: Red kept the rule. Blue: Garen and Lux aren't from Ionia.",
    );
  });

  it("unknown: couldn't check, after its side's part, never broke", () => {
    expect(ruleCheckLine(TANKS, sides(side(100), side(200, [JINX], [AMBESSA])))).toBe(
      "Tanks only: Blue kept the rule. Red: Jinx isn't a tank. Red: couldn't check Ambessa.",
    );
    expect(ruleCheckLine(TANKS, sides(side(100), side(200, [], [AMBESSA])))).toBe(
      "Tanks only: both sides kept the rule. Red: couldn't check Ambessa.",
    );
  });

  it('both broke, and no side checkable at all', () => {
    expect(ruleCheckLine(TANKS, sides(side(100, [LUX]), side(200, [JINX])))).toBe(
      "Tanks only: neither side kept the rule. Blue: Lux isn't a tank. Red: Jinx isn't a tank.",
    );
    expect(ruleCheckLine(TANKS, sides(side(100, [], [AMBESSA], false), side(200, [JINX])))).toBe(
      "Tanks only: not every pick could be checked. Blue: couldn't check Ambessa. Red: Jinx isn't a tank.",
    );
  });

  it('mirror, lane by lane', () => {
    const same: [number, number] = [AHRI, AHRI];
    expect(ruleCheckLine(MIRROR, lanes([same, same, same, same, same]))).toBe(
      'Mirror match: kept in every lane.',
    );
    expect(ruleCheckLine(MIRROR, lanes([same, same, [AHRI, SYNDRA], same, same]))).toBe(
      'Mirror match: kept in 4 lanes. Mid: Ahri vs Syndra.',
    );
    expect(ruleCheckLine(MIRROR, lanes([[null, AHRI], same, [AHRI, SYNDRA], same, same]))).toBe(
      "Mirror match: kept in 3 lanes. Top: couldn't check. Mid: Ahri vs Syndra.",
    );
    expect(
      ruleCheckLine(MIRROR, lanes([same, [JINX, ASHE], [AHRI, SYNDRA], [LUX, GAREN], [LEONA, ORNN]])),
    ).toBe(
      'Mirror match: kept in 1 lane. Jungle: Jinx vs Ashe. Mid: Ahri vs Syndra. ADC: Lux vs Garen. Support: Leona vs Ornn.',
    );
  });

  it('names champions, never players, and says nothing for a verdict that does not fit its rule', () => {
    expect(ruleCheckLine(TANKS, { kind: 'none' })).toBeNull();
    expect(ruleCheckLine(MIRROR, sides(side(100), side(200)))).toBeNull();
    expect(ruleCheckLine({ id: 'fearless' }, sides(side(100), side(200)))).toBeNull();
    expect(ruleCheckLine(TANKS, sides(side(100), side(200, [999_999])))).toBe(
      "Tanks only: Blue kept the rule. Red: Champion 999999 isn't a tank.",
    );
  });
});

describe('resultModeLines', () => {
  it('the check line, then the not-rated line; nothing for a plain rated game', () => {
    const rule = { mode: TANKS, check: sides(side(100), side(200)) };
    expect(resultModeLines({ rated: false, rule })).toEqual([
      'Tanks only: both sides kept the rule.',
      NOT_RATED_RESULT_LINE,
    ]);
    expect(resultModeLines({ rated: false, rule: null })).toEqual(['Not rated, so no Rating change.']);
    expect(resultModeLines({ rated: true, rule: null })).toEqual([]);
  });

  it('names a champion newer than the pin as the client named it, never `Champion <id>` (M15.10)', () => {
    const check = sides(side(100), side(200, [1], [9950]));
    // Without the client's names: the fallback the line used to print.
    expect(resultModeLines({ rated: false, rule: { mode: IONIA_NOXUS, check } })[0]).toBe(
      "Ionia vs Noxus: Blue kept the rule. Red: Annie isn't from Noxus. Red: couldn't check Champion 9950.",
    );
    // With them: the client's name for the unknown key; the pinned table still names the rest.
    expect(
      resultModeLines({
        rated: false,
        rule: { mode: IONIA_NOXUS, check, names: { 9950: 'Newchamp', 1: 'Wrong' } },
      })[0],
    ).toBe("Ionia vs Noxus: Blue kept the rule. Red: Annie isn't from Noxus. Red: couldn't check Newchamp.");
  });
});

/* ---------------------------------------------------------------------------
 * The two posts, whole.
 * ------------------------------------------------------------------------- */

const NAMES = ['Hana', 'Iris', 'Omar', 'Lena', 'Sara', 'Rami', 'Nadia', 'Bilal', 'Deniz', 'Ali'];

function teamsInput(overrides: Partial<TeamsEmbedInput> = {}): TeamsEmbedInput {
  const team = (offset: number): TeamsPlayer[] =>
    LANES.map((role, index) => ({
      puuid: `p-${offset + index}`,
      name: NAMES[offset + index] ?? null,
      role,
      rating: 1500 + 10 * (offset + index),
      offRole: false,
    }));
  return {
    identity: IDENTITY,
    blue: team(0),
    red: team(5),
    explanation: 'Blue favored 52%. Everyone on a main role.',
    receipt: null,
    sitOut: null,
    seats: [],
    switchSideEnabled: true,
    lobby: { name: 'customs-night', password: '4471' },
    url: 'https://kustom.example/g/customs',
    receiptUrl: 'https://kustom.example/g/customs#how-the-bot-decided',
    modeUrl: URL,
    ...overrides,
  };
}

describe('the teams post, one snapshot per mode', () => {
  const cases: [string, TeamsEmbedInput['mode']][] = [
    ['class wars', { mode: TANKS, rated: false }],
    ['region wars', { mode: IONIA_NOXUS, rated: false }],
    ['mirror match', { mode: MIRROR, rated: true }],
    ['normal, not rated', { mode: { id: 'normal' }, rated: false }],
    ['fearless, not rated', { mode: { id: 'fearless' }, rated: false }],
  ];
  for (const [label, mode] of cases) {
    it(label, () => {
      const payload = teamsEmbed(teamsInput({ mode }));
      expect(payload).toMatchSnapshot();
      // One line on top of E1's description, never a new message, a new embed or a new field.
      expect(payload.embeds).toHaveLength(4);
      expect(payload.embeds[0]?.fields?.map((field) => field.name)).toEqual(['Seats', 'Lobby']);
    });
  }

  it('is unchanged for a rated Normal or Fearless game, or a lobby with no lock', () => {
    const plain = teamsEmbed(teamsInput());
    expect(teamsEmbed(teamsInput({ mode: { mode: { id: 'fearless' }, rated: true } }))).toEqual(plain);
    expect(teamsEmbed(teamsInput({ mode: null }))).toEqual(plain);
  });

  it("keeps core's sentence in the EXPLANATION_STYLE it had", () => {
    const payload = teamsEmbed(teamsInput({ mode: { mode: TANKS, rated: false } }));
    expect(EXPLANATION_STYLE).toBe('subtext');
    // No stored receipt: E1 is the mode line alone, E4 core's sentence as plain text (10.4).
    expect(payload.embeds[0]?.description).toBe(
      `**This game: tanks only.** Not rated. [See the tanks](${URL})`,
    );
    expect(payload.embeds[3]?.description).toBe('Blue favored 52%. Everyone on a main role.');
  });

  it('carries the line on a Reroll post too', () => {
    const reroll = teamsEmbed(
      teamsInput({ mode: { mode: TANKS, rated: false }, promoted: { rank: 2, splitCount: 3 } }),
    );
    expect(reroll.embeds[0]?.title).toBe('Teams are set · reroll 1 of 2');
    expect(reroll.embeds[0]?.description?.split('\n')[0]).toBe(
      `**This game: tanks only.** Not rated. [See the tanks](${URL})`,
    );
  });
});

function resultInput(overrides: Partial<ResultEmbedInput> = {}): ResultEmbedInput {
  const team = (offset: number): ResultPlayer[] =>
    LANES.map((role, index) => ({
      puuid: `p-${offset + index}`,
      name: NAMES[offset + index] ?? null,
      role,
      rating: null,
      delta: null,
    }));
  return {
    identity: IDENTITY,
    winningSide: 200,
    durationS: 1_860,
    blue: team(0),
    red: team(5),
    award: null,
    blueWinProb: 0.55,
    topDamage: { name: 'Lena', damage: 31_200 },
    gameNumber: 52,
    url: 'https://kustom.example/g/customs/games/g-52',
    ...overrides,
  };
}

describe('the result post, one snapshot per verdict', () => {
  const cases: [string, ResultEmbedInput['mode']][] = [
    ['kept', { rated: false, rule: { mode: TANKS, check: sides(side(100), side(200)) } }],
    ['broke', { rated: false, rule: { mode: TANKS, check: sides(side(100), side(200, [JINX, ASHE])) } }],
    [
      'unknown',
      {
        rated: false,
        rule: { mode: IONIA_NOXUS, check: sides(side(100), side(200, [GAREN], [AMBESSA + 100_000])) },
      },
    ],
    [
      'mirror, rated',
      {
        rated: true,
        rule: {
          mode: MIRROR,
          check: lanes([
            [AHRI, AHRI],
            [JINX, JINX],
            [AHRI, SYNDRA],
            [LUX, LUX],
            [LEONA, LEONA],
          ]),
        },
      },
    ],
    ['normal, not rated', { rated: false, rule: null }],
  ];
  for (const [label, mode] of cases) {
    it(label, () => {
      const rated = mode?.rated === true;
      const input = rated
        ? resultInput({
            mode,
            blue: resultInput().blue.map((p) => ({ ...p, rating: 1500, delta: -20 })),
            red: resultInput().red.map((p) => ({ ...p, rating: 1520, delta: 20 })),
          })
        : resultInput({ mode });
      const payload = resultEmbed(input);
      expect(payload).toMatchSnapshot();
      expect(payload.embeds).toHaveLength(3);
    });
  }

  it('prints names alone on a not-rated game, and the lines under the odds line', () => {
    const payload = resultEmbed(
      resultInput({
        mode: { rated: false, rule: { mode: TANKS, check: sides(side(100), side(200, [JINX])) } },
      }),
    );
    const embed = payload.embeds[0];
    expect(payload.embeds[1]?.description?.split('\n')[0]).toBe('`top` **Hana**');
    // One line per fact (10.5): the odds, the rule check, not rated, then the top damage.
    expect(embed?.description?.split('\n')).toEqual([
      'Red was 45%. Red won. Upset!',
      "Tanks only: Blue kept the rule. Red: Jinx isn't a tank.",
      'Not rated, so no Rating change.',
      'Top damage: Lena, 31.2k.',
    ]);
    expect(embed?.description).not.toContain('Lena broke');
  });

  it('is unchanged for a rated game with no rule', () => {
    const rated = resultInput({
      blue: resultInput().blue.map((p) => ({ ...p, rating: 1500, delta: -20 })),
      red: resultInput().red.map((p) => ({ ...p, rating: 1520, delta: 20 })),
    });
    expect(resultEmbed({ ...rated, mode: { rated: true, rule: null } })).toEqual(resultEmbed(rated));
  });
});

/* ---------------------------------------------------------------------------
 * The result post for a not-rated Rift game (M15.3's OPEN 1), and still none for ARAM.
 * ------------------------------------------------------------------------- */

const NO_STATS: ResultSourcePlayer['stats'] = {
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

function notRatedSource(overrides: Partial<ResultSource> = {}): ResultSource {
  return {
    winningSide: 100,
    durationS: 1_800,
    gameNumber: 9,
    blueWinProb: 0.5,
    endedAt: TIMESTAMP,
    rated: false,
    rift: true,
    rule: { mode: TANKS, check: sides(side(100), side(200)) },
    players: NAMES.map((name, index) => ({
      puuid: `p-${index}`,
      name,
      side: index < 5 ? 100 : 200,
      role: LANES[index % 5] ?? null,
      damage: 1_000 * (index + 1),
      rBefore: null,
      rAfter: null,
      stats: NO_STATS,
    })),
    ...overrides,
  };
}

describe('buildResultInput, a game played not rated', () => {
  const context = { identity: IDENTITY, url: 'https://kustom.example/g/customs/games/g' };

  it('builds a post with no numbers and the mode lines', () => {
    const input = buildResultInput(notRatedSource(), context);
    expect(input).not.toBeNull();
    expect(input?.blue.every((player) => player.rating === null && player.delta === null)).toBe(true);
    expect(input?.award).toBeNull();
    expect(input?.mode).toEqual({ rated: false, rule: notRatedSource().rule });
  });

  it('builds none for ARAM, a remake or a short game, or a scoreboard that is not five a side', () => {
    expect(buildResultInput(notRatedSource({ rift: false }), context)).toBeNull();
    expect(buildResultInput(notRatedSource({ durationS: 300 }), context)).toBeNull();
    expect(
      buildResultInput(notRatedSource({ players: notRatedSource().players.slice(0, 9) }), context),
    ).toBeNull();
  });

  it('a rated rule game keeps its ratings and gains the check line', () => {
    const rated = notRatedSource({
      rated: true,
      rule: { mode: MIRROR, check: lanes(LANES.map(() => [AHRI, AHRI])) },
      players: notRatedSource().players.map((player) => ({ ...player, rBefore: 1500, rAfter: 1508.4 })),
    });
    const input = buildResultInput(rated, context);
    expect(input?.blue[0]?.rating).toBe(1508);
    expect(input?.mode).toEqual({ rated: true, rule: rated.rule });
  });
});

describe('announcesResult: who gets a result post', () => {
  it('rated, or not rated for the rule alone; never ARAM, a remake or a repeat', () => {
    expect(announcesResult({ rated: true, reason: null })).toBe(true);
    expect(announcesResult({ rated: false, reason: 'not-rated' })).toBe(true);
    expect(announcesResult({ rated: false, reason: 'game-mode' })).toBe(false);
    expect(announcesResult({ rated: false, reason: 'duration' })).toBe(false);
    expect(announcesResult({ rated: false, reason: 'already-rated' })).toBe(false);
    expect(announcesResult({ rated: false })).toBe(false);
  });
});

describe('storedRule: games.rule* and rule_check, read with the shared zod schema', () => {
  const row = {
    rule: 'class',
    rule_class_tag: 'Tank',
    rule_region_blue: null,
    rule_region_red: null,
    rule_checked: true,
    rule_check: sides(side(100), side(200, [JINX])),
  };

  it('reads a checked rule game', () => {
    expect(storedRule('g', row)).toEqual({ mode: TANKS, check: row.rule_check });
  });

  it('is null for an unchecked game, a standing-mode game, or a verdict it cannot read', () => {
    expect(storedRule('g', { ...row, rule_checked: false })).toBeNull();
    expect(storedRule('g', { ...row, rule: null, rule_class_tag: null })).toBeNull();
    expect(storedRule('g', { ...row, rule_check: { kind: 'sides', blue: 'nope' } })).toBeNull();
  });
});
