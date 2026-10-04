import { displayKustom, rateGameKustom, SETTLING_GAMES } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { WEEK_BOARD_SENTENCE_SHORT, WINDOW_LABELS } from '../board/copy';
import { championLane } from '../champs/lanes';
import { championName, listChampions } from '../champs/names';
import { SWITCH_SIDE_ENABLED } from '../commands/gate';
import { type FearlessGame, foldFearless } from '../fearless/fold';
import { availableFearless, presentFearless } from '../fearless/present';
import type { FearlessChampion } from '../fearless/types';
import { formatMinutes } from '../games/duration';
import { displayDelta } from '../ratingDisplay';
import { modePageUrl } from '../siteUrl';
import { workedBoardRows, workedWindowRows } from '../testing/boardFixtures';
import { game4Identity } from '../testing/discordGame4';
import { WORKED_ROSTER, workedBalance, workedNames, workedPool, workedPuuid } from '../testing/workedExample';
import { buildTeamsInput } from './assemble';
import {
  ACCENT_COLOR,
  ACE_LABEL,
  awardLine,
  awardLineBold,
  BLUE_COLOR,
  BLUE_SIDE_TITLE,
  boardFooter,
  explanationLine,
  favoredClause,
  fearlessEmbed,
  fearlessResetEmbed,
  formatDamage,
  formatDelta,
  joinNames,
  type LeaderboardEmbedInput,
  leaderboardEmbed,
  MVP_LABEL,
  oddsBar,
  RED_COLOR,
  RED_SIDE_TITLE,
  type ResultEmbedInput,
  type ResultPlayer,
  receiptLines,
  renderName,
  resultEmbed,
  SETTLING_FIELD,
  SETTLING_FOOTER,
  SIDE_LINE_AUTO,
  SIDE_LINE_MANUAL,
  sideLine,
  type TeamsEmbedInput,
  type TeamsReceipt,
  teamsEmbed,
  teamsHeaderLines,
  teamsTitle,
  underdogClause,
  type WebhookPayload,
  type WindowSummaryEmbedInput,
  weekLineTail,
  windowSummaryEmbed,
} from './embeds';
import { FIELD_VALUE_LIMIT, guardMessage, messageLength, TOTAL_LIMIT } from './limits';
import { addedBy, boardPostEntries } from './post';

/**
 * The two embeds against the worked example (`docs/00-product.md`), which is also the layout
 * in `docs/05-design.md`, "Discord embeds".
 *
 * Nothing here is hand-computed: the split and the explanation come from `balance()`, the
 * display ratings from `displayKustom`, and the result deltas from `rateGameKustom`. The design
 * doc's result example was written by hand from the Plackett-Luce reduction and warns that it
 * is illustrative; these numbers are the package's.
 */

const SITE_URL = 'https://customs.example';
/** Every post's identity (M14.61): the group's name, its page and the avatar. */
const IDENTITY = game4Identity(SITE_URL);

/** The teams post's parts (05-design 10.4): E1's fields, the two sides' lines, E4's lines. */
const fieldOf = (payload: WebhookPayload, name: string) =>
  payload.embeds[0]?.fields?.find((field) => field.name === name);
const blueLines = (payload: WebhookPayload): string[] => payload.embeds[1]?.description?.split('\n') ?? [];
const redLines = (payload: WebhookPayload): string[] => payload.embeds[2]?.description?.split('\n') ?? [];
const headerLines = (payload: WebhookPayload): string[] => payload.embeds[0]?.description?.split('\n') ?? [];
const receiptOf = (payload: WebhookPayload): string[] => payload.embeds[3]?.description?.split('\n') ?? [];
const textOf = (lines: ReturnType<typeof receiptLines>): string[] =>
  lines.map((line) => (typeof line === 'string' ? line : line.text));

/**
 * The worked balance's splits as the receipt reads them: the `splits` rows' numeric columns,
 * `rank` 1 to 3 (M14.10). `rank` picks the one in play; the next one down is its runner-up.
 */
function workedReceipt(rank = 1): TeamsReceipt {
  const { splits } = workedBalance();
  const row = (index: number) => {
    const split = splits[index];
    if (split === undefined) return null;
    return {
      rank: index + 1,
      blue: split.blue,
      red: split.red,
      gap: split.gap,
      offRoleCount: split.offRoleCount,
      blueWinProb: split.blueWinProb,
    };
  };
  const chosen = row(rank - 1);
  if (chosen === null) throw new Error(`no split at rank ${rank}`);
  return { chosen, next: row(rank), splitCount: splits.length };
}

function workedTeamsInput(overrides: Partial<TeamsEmbedInput> = {}): TeamsEmbedInput {
  const result = workedBalance();
  const split = result.splits[0];
  const explanation = result.explanations[0];
  if (split === undefined || explanation === undefined) throw new Error('no split');

  const built = buildTeamsInput(
    {
      split,
      explanation,
      lobbyName: 'customs-night',
      lobbyPassword: '4471',
      playing: workedPool(),
      sitters: [],
      seatMoves: [],
      tiedOnGames: false,
      receipt: workedReceipt(),
    },
    workedNames(),
    { identity: IDENTITY, url: SITE_URL, receiptUrl: `${SITE_URL}#how-the-bot-decided` },
  );

  return { ...built, ...overrides };
}

describe('teamsEmbed, the worked example', () => {
  // The gate is named rather than left to default, so the snapshot is the **gate-off** message
  // by construction and does not change the day `SWITCH_SIDE_ENABLED` flips. The gate-on
  // sentence has its own tests below, and the default is pinned there too.
  const payload = teamsEmbed(workedTeamsInput({ switchSideEnabled: false }));
  const embed = payload.embeds[0];

  it('matches the layout in 05-design.md', () => {
    expect(payload).toMatchSnapshot();
  });

  it('is an amber header and an amber closing block: neither side is favoured (10.2)', () => {
    expect(payload.embeds.map((part) => part.color)).toEqual([
      ACCENT_COLOR,
      BLUE_COLOR,
      RED_COLOR,
      ACCENT_COLOR,
    ]);
    expect(embed?.title).toBe('Teams are set');
    expect(embed).not.toHaveProperty('footer');
    expect(embed).not.toHaveProperty('timestamp');
  });

  /**
   * **The receipt** (M14.10, STRATEGY §4.9), character for character, split over the stack by
   * 05-design 10.4: the labels, the bar and the verdict in E1; the chips, the reason line and
   * core's sentence verbatim as subtext in E4. This is STRATEGY's own example, this worked night.
   */
  it("is the text receipt of STRATEGY §4.9, with core's sentence verbatim as its last line", () => {
    expect(headerLines(payload)).toEqual([
      '**Blue 56%** · **44% Red**',
      '🟦🟦🟦🟦🟦🟦🟥🟥🟥🟥',
      'Close. Blue has a slight edge.',
    ]);
    expect(receiptOf(payload)).toEqual([
      "Rating gap 100 pts · Main roles 10/10 · Bot's pick #1 of 3",
      "Next best: swap the top players, Hana and Omar. That's Blue 60%, with a bigger rating gap (170 vs 100 pts).",
      '-# Blue favored 56%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
    ]);
  });

  it('names the two sides in words, each in its own embed, with no team totals (STRATEGY §4.2 rule 4)', () => {
    expect(payload.embeds[1]?.title).toBe(BLUE_SIDE_TITLE);
    expect(payload.embeds[2]?.title).toBe(RED_SIDE_TITLE);
    expect(payload.embeds[1]).not.toHaveProperty('fields');
  });

  it('prints five lines a side, in lane order, role in inline code, the name bold', () => {
    expect(blueLines(payload)).toEqual([
      '`top` **Hana** · 1434',
      '`jungle` **Iris** · 1578',
      '`mid` **Karim** · 1551',
      '`adc` **Bilal** · 1713',
      '`support` **Theo** · 1419',
    ]);
    expect(redLines(payload)).toEqual([
      '`top` **Omar** · 1469',
      '`jungle` **Rami** · 1638',
      '`mid` **Nadia** · 1266',
      '`adc` **Lena** · 2088',
      '`support` **Yuki** · 1134',
    ]);
  });

  it('carries the lobby name and password so a straggler can still get in', () => {
    expect(fieldOf(payload, 'Lobby')?.value).toBe('`customs-night` · password `4471`');
  });

  it('has no sit-out field on a ten-player night, and a Seats field carrying the side line alone', () => {
    expect(embed?.fields?.map((field) => field.name)).toEqual(['Seats', 'Lobby']);
    expect(fieldOf(payload, 'Seats')?.value).toBe('Move to your side in the lobby.');
  });

  it('links the tonight page, and posts no url at all when there is none', () => {
    expect(embed?.url).toBe(SITE_URL);
    expect(teamsEmbed(workedTeamsInput({ url: undefined })).embeds[0]).not.toHaveProperty('url');
  });

  it('never promises a link in a footer: the title is the link, and there is no footer (10.2)', () => {
    expect(teamsEmbed(workedTeamsInput({ url: undefined })).embeds[0]).not.toHaveProperty('footer');
  });
});

describe('teamsEmbed, the fields that only sometimes exist', () => {
  it('drops the password half when the client reported no password (every lobby before M4.1)', () => {
    const embed = teamsEmbed(workedTeamsInput({ lobby: { name: 'customs-night', password: null } }))
      .embeds[0];
    expect(embed?.fields?.find((field) => field.name === 'Lobby')?.value).toBe('`customs-night`');
  });

  it('has no Lobby field at all when neither is known: never empty, never "unknown"', () => {
    const embed = teamsEmbed(workedTeamsInput({ lobby: { name: null, password: null } })).embeds[0];
    expect(embed?.fields?.some((field) => field.name === 'Lobby')).toBe(false);
  });

  it('starts the Sitting out value at the name, with the most-games reason (M14.41)', () => {
    const embed = teamsEmbed(
      workedTeamsInput({ sitOut: { names: ['Omar', 'Sara'], rule: { kind: 'most-games' } } }),
    ).embeds[0];
    expect(embed?.fields?.find((field) => field.name === 'Sitting out')?.value).toBe(
      "Omar and Sara sit this one out. They've played the most games tonight.",
    );
  });

  it('names the tie-break when everybody has played the same number tonight', () => {
    const embed = teamsEmbed(
      workedTeamsInput({
        sitOut: { names: ['Omar'], rule: { kind: 'longest-since', games: 1, everyone: true } },
      }),
    ).embeds[0];
    expect(embed?.fields?.find((field) => field.name === 'Sitting out')?.value).toBe(
      "Omar sits this one out. They've gone longest without sitting out, and everyone's played 1 game tonight.",
    );
  });

  it('says somebody has to be first on the first game of a night', () => {
    const embed = teamsEmbed(
      workedTeamsInput({ sitOut: { names: ['Player0'], rule: { kind: 'first', games: 0, everyone: true } } }),
    ).embeds[0];
    const value = embed?.fields?.find((field) => field.name === 'Sitting out')?.value;
    expect(value).toBe('Player0 sits this one out. First game of the night, so somebody has to be first.');
    expect(value?.startsWith('Sitting out')).toBe(false);
  });

  it('prints one Seats line per move, swap and open slot', () => {
    const embed = teamsEmbed(
      workedTeamsInput({
        // Named, like the worked example above: this case is about the move lines, so it must
        // not move the day `SWITCH_SIDE_ENABLED` flips.
        switchSideEnabled: false,
        sitOut: { names: ['Omar'], rule: { kind: 'most-games' } },
        seats: [
          { kind: 'swap', sitter: 'Omar', mover: 'Nadia' },
          { kind: 'open-slot', mover: 'Yuki' },
        ],
      }),
    ).embeds[0];
    expect(embed?.fields?.find((field) => field.name === 'Seats')?.value.split('\n')).toEqual([
      'Swap: Omar out, Nadia in.',
      'Yuki is playing — take the open slot.',
      'Move to your side in the lobby.',
    ]);
  });

  it('puts the rotation and the lobby above the teams: Sitting out, Seats, Lobby, then the sides', () => {
    // 05-design 10.4: the lines that have to happen before anybody can play, and the lobby a
    // latecomer needs, sit in E1; the two sides follow in their own embeds.
    const payload = teamsEmbed(
      workedTeamsInput({
        sitOut: { names: ['Omar'], rule: { kind: 'most-games' } },
        seats: [{ kind: 'swap', sitter: 'Omar', mover: 'Nadia' }],
      }),
    );
    expect(payload.embeds[0]?.fields?.map((field) => field.name)).toEqual(['Sitting out', 'Seats', 'Lobby']);
    expect(payload.embeds[0]?.fields?.every((field) => field.inline === undefined)).toBe(true);
    expect(payload.embeds.slice(1, 3).map((part) => part.title)).toEqual([BLUE_SIDE_TITLE, RED_SIDE_TITLE]);
  });

  it('marks an off-role line, so the fact survives being read on its own', () => {
    const base = workedTeamsInput();
    const blue = base.blue.map((player, index) => (index === 0 ? { ...player, offRole: true } : player));
    expect(blueLines(teamsEmbed({ ...base, blue }))[0]).toBe('`top` **Hana** · 1434 · off main role');
  });

  it('renders a player the database has no name for as Someone', () => {
    const base = workedTeamsInput();
    const blue = base.blue.map((player, index) => (index === 0 ? { ...player, name: null } : player));
    expect(blueLines(teamsEmbed({ ...base, blue }))[0]).toBe('`top` **Someone** · 1434');
  });
});

/**
 * The side line (M4.3's copy, M4.7 (b)'s placement).
 *
 * One line, in the `Seats` block, on **every** teams embed — including the ten-player night
 * where nobody swaps, because the embed is posted at the moment of balancing and somebody is
 * always on the wrong side of a lobby that was filled in join order. Which of the two sentences
 * it is, is the verification gate's answer and nobody else's.
 */
describe('teamsEmbed, the side line', () => {
  /**
   * **Pinned character for character.** These are the sentences the tonight page prints too —
   * `lib/tonight/copy.ts` re-exports these three constants, so the page and the message cannot
   * be two wordings of one instruction, and this is the test that guards the words themselves.
   * The code points are asserted, not just the strings: the dash is an em dash (U+2014) and the
   * apostrophe is the ASCII one (U+0027), which is what the M4.3 brief and `05-design.md`'s
   * copy table both have.
   */
  it("spells product's two sentences exactly as the brief does", () => {
    expect(SIDE_LINE_MANUAL).toBe('Move to your side in the lobby.');
    expect(SIDE_LINE_AUTO).toBe("You'll be moved to your side — if not, move yourself.");
    expect([...SIDE_LINE_AUTO].map((char) => char.codePointAt(0))).toEqual([
      89, 111, 117, 39, 108, 108, 32, 98, 101, 32, 109, 111, 118, 101, 100, 32, 116, 111, 32, 121, 111, 117,
      114, 32, 115, 105, 100, 101, 32, 0x2014, 32, 105, 102, 32, 110, 111, 116, 44, 32, 109, 111, 118, 101,
      32, 121, 111, 117, 114, 115, 101, 108, 102, 46,
    ]);
    expect(sideLine(false)).toBe(SIDE_LINE_MANUAL);
    expect(sideLine(true)).toBe(SIDE_LINE_AUTO);
  });

  it('is the last line of the Seats field, under the moves', () => {
    const embed = teamsEmbed(
      workedTeamsInput({
        switchSideEnabled: false,
        seats: [{ kind: 'swap', sitter: 'Omar', mover: 'Nadia' }],
      }),
    ).embeds[0];
    expect(embed?.fields?.find((field) => field.name === 'Seats')?.value.split('\n')).toEqual([
      'Swap: Omar out, Nadia in.',
      'Move to your side in the lobby.',
    ]);
  });

  it('tells people to move themselves while the switch-side gate is off', () => {
    const embed = teamsEmbed(workedTeamsInput({ switchSideEnabled: false })).embeds[0];
    expect(embed?.fields?.find((field) => field.name === 'Seats')?.value).toBe(SIDE_LINE_MANUAL);
  });

  it('says the companion moves you once the gate is on, and still ends with move yourself', () => {
    // M4.3 acceptance check 8. A companion that is closed, offline or facing a full side moves
    // nobody, and the embed is written before any of them has polled.
    const embed = teamsEmbed(workedTeamsInput({ switchSideEnabled: true })).embeds[0];
    expect(embed?.fields?.find((field) => field.name === 'Seats')?.value).toBe(SIDE_LINE_AUTO);
  });

  it('carries the line once, never per-person and never both sentences', () => {
    for (const enabled of [false, true]) {
      const embed = teamsEmbed(
        workedTeamsInput({
          switchSideEnabled: enabled,
          sitOut: { names: ['Omar'], rule: { kind: 'most-games' } },
          seats: [{ kind: 'swap', sitter: 'Omar', mover: 'Nadia' }],
        }),
      ).embeds[0];
      const whole = JSON.stringify(embed);
      expect(whole.split('to your side').length - 1).toBe(1);
    }
  });

  it('changes nothing else about the embed', () => {
    const off = teamsEmbed(workedTeamsInput({ switchSideEnabled: false })).embeds[0];
    const on = teamsEmbed(workedTeamsInput({ switchSideEnabled: true })).embeds[0];
    expect({ ...on, fields: on?.fields?.filter((field) => field.name !== 'Seats') }).toEqual({
      ...off,
      fields: off?.fields?.filter((field) => field.name !== 'Seats'),
    });
  });

  it('takes the sentence from the server gate when nothing overrides it', () => {
    // `buildTeamsInput` reads `SWITCH_SIDE_ENABLED` at post time, so the message and the queue
    // can never disagree: the flag that decides whether a `switch_side` row is written is the
    // flag that decides which sentence is posted.
    const embed = teamsEmbed(workedTeamsInput()).embeds[0];
    expect(embed?.fields?.find((field) => field.name === 'Seats')?.value).toBe(sideLine(SWITCH_SIDE_ENABLED));
  });
});

/**
 * Red wins the worked example — the underdog at 46%, the case `05-design.md` illustrates.
 * The deltas are `rateGameKustom`'s (M18.6: all ten settled, K 16, no performance score), not the
 * design doc's hand arithmetic.
 */
function workedResultInput(overrides: Partial<ResultEmbedInput> = {}): ResultEmbedInput {
  const split = workedBalance().splits[0];
  if (split === undefined) throw new Error('no split');

  const before = new Map<string, number>(WORKED_ROSTER.map((player) => [workedPuuid(player.name), player.r]));
  const rating = (puuid: string): number => {
    const value = before.get(puuid);
    if (value === undefined) throw new Error(`no rating for ${puuid}`);
    return value;
  };

  const folded = rateGameKustom({
    players: [
      ...split.blue.map((one) => ({
        puuid: one.puuid,
        side: 100 as const,
        r: rating(one.puuid),
        n: 10,
        score: null,
      })),
      ...split.red.map((one) => ({
        puuid: one.puuid,
        side: 200 as const,
        r: rating(one.puuid),
        n: 10,
        score: null,
      })),
    ],
    winningSide: 200,
  });
  const afterOf = new Map(folded.map((row) => [row.puuid, row.rAfter]));

  const nameOf = new Map(WORKED_ROSTER.map((player) => [workedPuuid(player.name), player.name]));
  const side = (assignments: readonly { puuid: string; role: ResultPlayer['role'] }[]): ResultPlayer[] =>
    assignments.map((assignment) => {
      const rAfter = afterOf.get(assignment.puuid);
      if (rAfter === undefined) throw new Error('rateGameKustom returned fewer rows than players');
      return {
        puuid: assignment.puuid,
        name: nameOf.get(assignment.puuid) ?? null,
        role: assignment.role,
        rating: displayKustom(rAfter),
        delta: displayDelta(rating(assignment.puuid), rAfter),
      };
    });

  return {
    winningSide: 200,
    // Invented, like the design doc's: the docs pin no result for the worked example.
    durationS: 2_052,
    blue: side(split.blue),
    red: side(split.red),
    blueWinProb: split.blueWinProb,
    topDamage: { name: 'Lena', damage: 47_300 },
    // M7.10. Red won the worked example, so its MVP comes off Red and its ACE off Blue: Lena
    // is Red's adc and Iris is Blue's jungler. (Product's illustration of the line reads
    // `MVP Lena · ACE Rami`; Rami is on Red here, so the pair is named on this roster's own
    // sides and the string itself is pinned by `awardLine` below.)
    award: { mvp: 'Lena', ace: 'Iris' },
    gameNumber: 47,
    url: SITE_URL,
    identity: IDENTITY,
    ...overrides,
  };
}

describe('resultEmbed, the worked example lost by the favourite', () => {
  const input = workedResultInput();
  const payload = resultEmbed(input);
  const embed = payload.embeds[0];

  it('matches the layout in 05-design.md', () => {
    expect(payload).toMatchSnapshot();
  });

  it('wears the winning side colour on E1; blue keeps the first side embed', () => {
    expect(embed?.color).toBe(RED_COLOR);
    expect(embed?.title).toBe('Red wins · 34 min');
    expect(payload.embeds.map((part) => part.title)).toEqual([
      'Red wins · 34 min',
      BLUE_SIDE_TITLE,
      RED_SIDE_TITLE,
    ]);
    expect(payload.embeds.slice(1).map((part) => part.color)).toEqual([BLUE_COLOR, RED_COLOR]);
    expect(resultEmbed(workedResultInput({ winningSide: 100 })).embeds[0]?.color).toBe(BLUE_COLOR);
    expect(resultEmbed(workedResultInput({ winningSide: 100 })).embeds[1]?.title).toBe(BLUE_SIDE_TITLE);
  });

  it('says what the odds were, that the underdog won, who did the damage and who carried, one line each', () => {
    expect(embed?.description?.split('\n')).toEqual([
      'Red was 44%. Red won. Upset!',
      'Top damage: Lena, 47.3k.',
      '**MVP** Lena · **ACE** Iris',
    ]);
  });

  it('says the favorite won without an Upset!', () => {
    const won = resultEmbed(workedResultInput({ winningSide: 100, topDamage: null, award: null })).embeds[0];
    expect(won?.description).toBe('Blue was 56%. Blue won.');
  });

  it('prints new rating and signed delta, one line per player, joined by a no-break space', () => {
    expect(blueLines(payload)).toMatchSnapshot('blue lines');
    expect(redLines(payload)).toMatchSnapshot('red lines');
    for (const line of [...blueLines(payload), ...redLines(payload)])
      expect(line).toMatch(/ · \d+\u00A0\([+-]\d+\)$/);
  });

  it('adds up: every line is round(rAfter) and its delta from round(rBefore)', () => {
    const before = new Map(WORKED_ROSTER.map((player) => [player.name, displayKustom(player.r)]));
    for (const player of [...input.blue, ...input.red]) {
      const was = before.get(player.name ?? '');
      if (was === undefined) throw new Error(`no before rating for ${player.name}`);
      expect((player.rating ?? Number.NaN) - (player.delta ?? Number.NaN)).toBe(was);
    }
  });

  it('never prints a team total of deltas', () => {
    // -45 and +45 on this roster: ten settled players and no performance score, so the sides
    // cancel (M18: shares sum to 5 a side). Even so the total is never printed: printed changes
    // are differences of rounded Ratings, and newcomers' K breaks the cancel (M3.3).
    const blue = input.blue.reduce((total, player) => total + (player.delta ?? Number.NaN), 0);
    const red = input.red.reduce((total, player) => total + (player.delta ?? Number.NaN), 0);
    expect([blue, red]).toEqual([-45, 45]);
    for (const part of payload.embeds) {
      expect(part.title).not.toContain(String(blue));
      expect(part.title).not.toContain(String(red));
    }
  });

  /**
   * **The group and its game number** (M5.12; moved from the footer to the author line by
   * M14.61, 05-design 10.5): every game this group has played up to this one.
   */
  it("names the group and this game in the group's history in the author line", () => {
    expect(embed?.author?.name).toBe('Customs Night · game 47');
    expect(embed?.author?.name.toLowerCase()).not.toContain('season');
    expect(embed).not.toHaveProperty('footer');
  });

  it('names the group alone when the count could not be taken, never `game ?`', () => {
    const uncounted = resultEmbed(workedResultInput({ gameNumber: null })).embeds[0];
    expect(uncounted?.author?.name).toBe('Customs Night');
  });

  it('drops the lines it has nothing to say for', () => {
    const bare = resultEmbed(workedResultInput({ blueWinProb: null, topDamage: null, award: null }))
      .embeds[0];
    expect(bare).not.toHaveProperty('description');
  });

  it('says 50–50 for the coin flip, and never Upset! (STRATEGY §4.7)', () => {
    const embedded = resultEmbed(workedResultInput({ blueWinProb: 0.5, award: null })).embeds[0];
    expect(embedded?.description).toBe('50–50. Red won.\nTop damage: Lena, 47.3k.');
    // 0.496 rounds to 50: the rounded share decides, not the raw probability.
    expect(
      resultEmbed(workedResultInput({ blueWinProb: 0.496, topDamage: null, award: null })).embeds[0]
        ?.description,
    ).toBe('50–50. Red won.');
  });

  it("reads the winner's own share when red was favored and won", () => {
    const embedded = resultEmbed(workedResultInput({ blueWinProb: 0.42, topDamage: null, award: null }))
      .embeds[0];
    expect(embedded?.description).toBe('Red was 58%. Red won.');
  });
});

describe('teamsTitle, the title on a reroll (M3.2)', () => {
  it('leaves split 1 plain, including when an admin promotes it back', () => {
    expect(teamsTitle(undefined)).toBe('Teams are set');
    expect(teamsTitle({ rank: 1, splitCount: 3 })).toBe('Teams are set');
  });

  it('says which reroll this is, and that the second one is the last', () => {
    expect(teamsTitle({ rank: 2, splitCount: 3 })).toBe('Teams are set · reroll 1 of 2');
    expect(teamsTitle({ rank: 3, splitCount: 3 })).toBe('Teams are set · reroll 2 of 2');
  });

  it('counts the splits the lobby stored rather than assuming three', () => {
    // `of 2` is true because core returns three. A lobby that stored two must not promise a
    // reroll it has not got.
    expect(teamsTitle({ rank: 2, splitCount: 2 })).toBe('Teams are set · reroll 1 of 1');
  });

  it('titles the post, and changes nothing else about it', () => {
    const plain = teamsEmbed(workedTeamsInput());
    const rerolled = teamsEmbed(workedTeamsInput({ promoted: { rank: 2, splitCount: 3 } }));
    expect(rerolled.embeds[0]?.title).toBe('Teams are set · reroll 1 of 2');
    expect({
      ...rerolled,
      embeds: [{ ...rerolled.embeds[0], title: 'Teams are set' }, ...rerolled.embeds.slice(1)],
    }).toEqual(plain);
  });
});

describe('the small formatters', () => {
  it('the result title length is the shared formatMinutes: whole minutes played, never 0 min (M14.39)', () => {
    expect(formatMinutes(2_052)).toBe('34 min');
    // Rounded down like every page (34:30 is still 34 minutes in); before M14.39 the post said 35.
    expect(formatMinutes(2_070)).toBe('34 min');
    expect(formatMinutes(20)).toBe('1 min');
    expect(formatMinutes(3_723)).toBe('62 min');
  });

  it('signs every delta, and keeps the direction of one that rounds to zero', () => {
    expect(formatDelta(43)).toBe('+43');
    expect(formatDelta(-46)).toBe('-46');
    expect(formatDelta(0)).toBe('+0');
    // `(0)` never appears (`05-design.md`, "Rating delta"). A rating that moved down by less
    // than half a point is `-0`, which `>= 0` would otherwise call positive.
    expect(formatDelta(-0)).toBe('-0');
    expect(formatDelta(displayDelta(25.0, 24.999))).toBe('-0');
    expect(formatDelta(displayDelta(25.0, 25.001))).toBe('+0');
  });

  it('abbreviates damage over a thousand only', () => {
    expect(formatDamage(47_300)).toBe('47.3k');
    expect(formatDamage(1_000)).toBe('1.0k');
    expect(formatDamage(940)).toBe('940');
  });

  it('joins names with commas and a final "and"', () => {
    expect(joinNames(['Sara'])).toBe('Sara');
    expect(joinNames(['Sara', 'Deniz'])).toBe('Sara and Deniz');
    expect(joinNames(['Sara', 'Deniz', 'Ali'])).toBe('Sara, Deniz and Ali');
    expect(joinNames([])).toBe('');
  });

  it('renders a missing name as Someone and truncates a long one at 32', () => {
    expect(renderName(null)).toBe('Someone');
    expect(renderName('   ')).toBe('Someone');
    expect(renderName('Hana')).toBe('Hana');
    expect(renderName('x'.repeat(40))).toBe(`${'x'.repeat(31)}…`);
    expect(renderName('x'.repeat(32))).toBe('x'.repeat(32));
  });

  it('escapes the markdown a Riot ID can carry, so a name is text and not markup', () => {
    // One stray backtick closes the role's code span and swallows the rest of the field.
    expect(renderName('a`b')).toBe('a\\`b');
    expect(renderName('Dark_Wolf')).toBe('Dark\\_Wolf');
    expect(renderName('*bold*')).toBe('\\*bold\\*');
    expect(renderName('~x~')).toBe('\\~x\\~');
    expect(renderName('a|b')).toBe('a\\|b');
    expect(renderName('a\\b')).toBe('a\\\\b');
  });

  it('escapes link, mention and heading syntax, so a name is never a link or a ping (M14.61 r2)', () => {
    expect(renderName('[x](https://evil)')).toBe('\\[x\\]\\(https://evil\\)');
    expect(renderName('[click](https://evil.example)')).not.toMatch(/(?<!\\)\[[^\]]*(?<!\\)\]\(/);
    expect(renderName('<@&123> <#5>')).toBe('\\<@&123\\> \\<\\#5\\>');
    expect(renderName('# big')).toBe('\\# big');
    // The 32-character cut still lands before the escapes.
    expect(renderName('['.repeat(40))).toBe(`${'\\['.repeat(31)}…`);
  });

  it('escapes last, so the escapes cannot be sliced away by the truncation', () => {
    // 32 underscores: what a reader counts is still 31 characters and an ellipsis, and every
    // backslash still has its character. Escaping first would cut one off mid-pair.
    const rendered = renderName('_'.repeat(40));
    expect(rendered).toBe(`${'\\_'.repeat(31)}…`);
    expect(rendered.replace(/\\/g, '')).toBe(`${'_'.repeat(31)}…`);
  });

  it('escapes the name in every line that prints one', () => {
    const base = workedTeamsInput({
      // Named: the case is about escaping, not about which side sentence ships today.
      switchSideEnabled: false,
      sitOut: { names: ['Dark_Wolf'], rule: { kind: 'most-games' } },
      seats: [{ kind: 'swap', sitter: 'Dark_Wolf', mover: 'a`b' }],
    });
    const blue = base.blue.map((player, index) => (index === 0 ? { ...player, name: 'a`b' } : player));
    const payload = teamsEmbed({ ...base, blue });

    expect(fieldOf(payload, 'Sitting out')?.value).toBe(
      "Dark\\_Wolf sits this one out. They've played the most games tonight.",
    );
    expect(fieldOf(payload, 'Seats')?.value).toBe(
      'Swap: Dark\\_Wolf out, a\\`b in.\nMove to your side in the lobby.',
    );
    // The bold markers go around the escaped name (05-design 10.4).
    expect(blueLines(payload)[0]).toBe('`top` **a\\`b** · 1434');
  });
});

/**
 * The nightly board (M3.5), against the same ten and the same numbers as `05-design.md`'s
 * worked example: Lena `1548` down to Yuki `534`, with the design doc's illustrative game
 * counts. The snapshot is the JSON a scheduler puts in the channel once a night.
 */
/** The worked board's rows as an all-time post's ranked lines: `post.ts`'s own ordering. */
function allTimeEntries(ratedGames?: ReadonlyMap<string, number>) {
  const rows = workedBoardRows();
  return boardPostEntries(rows, 'all-time', ratedGames ?? new Map(rows.map((row) => [row.puuid, row.games])))
    .entries;
}

function workedLeaderboardInput(overrides: Partial<LeaderboardEmbedInput> = {}): LeaderboardEmbedInput {
  return {
    // The **window's** name, never a season's (M5.12): the title, the board heading and the
    // picker's option are the same three words.
    windowLabel: WINDOW_LABELS['this-week'],
    /**
     * **The all-time track**, which is what pins `05-design.md`'s nightly post byte for byte
     * (M3.5, M5.10). The nightly post itself reads `This week` and therefore the weekly track
     * since M7.3 — that is the `the week's own board` block below, and `post.ts` is what
     * chooses between them. This builder is pure and prints whichever it is given.
     */
    track: 'all-time',
    // Everybody past `SETTLING_GAMES` (24 to 44 games each), so all ten are ranked, by Rating.
    entries: allTimeEntries(),
    url: `${SITE_URL}/g/customs/leaderboard?window=this-week`,
    identity: IDENTITY,
    ...overrides,
  };
}

describe('leaderboardEmbed, the worked example', () => {
  it("is the design doc's nightly post", () => {
    expect(leaderboardEmbed(workedLeaderboardInput())).toMatchSnapshot();
  });

  it('prints Rating, in Rating order, and no second number (M14.10)', () => {
    const embed = leaderboardEmbed(workedLeaderboardInput()).embeds[0];
    const rows = workedBoardRows();

    expect(embed?.fields).toHaveLength(1);
    expect(embed?.fields?.[0]?.name).toBe('Top ten');
    // One field, block, no columns: a ranked list is a single column by nature.
    expect(embed?.fields?.[0]?.inline).toBeUndefined();
    const lines = embed?.fields?.[0]?.value.split('\n') ?? [];
    expect(lines[0]).toBe('`1` **Lena** · 2088 · 41 games');
    // Every line's one number is that player's Rating, and the column never goes up.
    const printed = lines.map((line) => Number(line.split(' · ')[1]));
    expect(printed).toEqual([...rows.map((row) => row.rating)].sort((a, b) => b - a));
    // Lena's Proven (1548), the number this post printed before M14.10, is nowhere in it.
    expect(embed?.fields?.[0]?.value).not.toContain('1548');
  });

  /**
   * **The field name follows the count** (M3.22, product 2026-09-09). With eight players seeded
   * the shipped post read `Top ten` over eight lines — a field naming a number the list does
   * not have, in a channel where the group can count the lines.
   */
  it('is named `Top ten` only when ten lines print', () => {
    const eight = workedLeaderboardInput().entries.slice(0, 8);
    const embed = leaderboardEmbed(workedLeaderboardInput({ entries: eight })).embeds[0];

    expect(embed?.fields?.[0]?.name).toBe('The board');
    expect(embed?.fields?.[0]?.value.split('\n')).toHaveLength(8);
    // Ten is still ten.
    expect(leaderboardEmbed(workedLeaderboardInput()).embeds[0]?.fields?.[0]?.name).toBe('Top ten');
  });

  it('names an eleven-row board `Top ten`, because ten is what it prints', () => {
    const eleven = [...workedLeaderboardInput().entries, workedLeaderboardInput().entries[0]].flatMap(
      (entry) => (entry === undefined ? [] : [entry]),
    );
    const embed = leaderboardEmbed(workedLeaderboardInput({ entries: eleven })).embeds[0];

    expect(embed?.fields?.[0]?.name).toBe('Top ten');
    expect(embed?.fields?.[0]?.value.split('\n')).toHaveLength(10);
  });

  it("carries the settling line on every all-time post, with core's threshold in it", () => {
    const embed = leaderboardEmbed(workedLeaderboardInput()).embeds[0];

    expect(embed?.footer?.text).toBe(
      `New players' ratings move fast at first. They get a rank after ${SETTLING_GAMES} games.`,
    );
    expect(SETTLING_FOOTER).toContain('10 games');
    expect(embed?.fields?.[0]?.value).not.toContain('settling');
  });

  it('is the accent bar, the board title and the board link', () => {
    const embed = leaderboardEmbed(workedLeaderboardInput()).embeds[0];

    expect(embed?.color).toBe(ACCENT_COLOR);
    // `This week · board`, linking to the board it just printed (M5.12).
    expect(embed?.title).toBe('This week · board');
    expect(embed?.title?.toLowerCase()).not.toContain('season');
    expect(embed?.url).toBe(`${SITE_URL}/g/customs/leaderboard?window=this-week`);
    expect(embed?.description).toBeUndefined();
  });

  /** Every one of the five can title one of these posts: M5.10's Sunday post is `Last week`. */
  it('titles itself with whichever window it printed', () => {
    for (const [kind, label] of Object.entries(WINDOW_LABELS)) {
      const embed = leaderboardEmbed(workedLeaderboardInput({ windowLabel: label })).embeds[0];
      expect(embed?.title).toBe(`${label} · board`);
      expect(kind).toBeTruthy();
    }
  });

  it('drops the url when there is no honest one, and keeps the footer', () => {
    const embed = leaderboardEmbed(workedLeaderboardInput({ url: undefined })).embeds[0];

    expect(embed).not.toHaveProperty('url');
    // Unlike the teams footer, this one promises no link, so it does not change.
    expect(embed?.footer?.text).toBe(SETTLING_FOOTER);
  });

  it('prints ten at most, however many the group has', () => {
    const entries = [...workedLeaderboardInput().entries];
    const value = leaderboardEmbed(
      workedLeaderboardInput({
        entries: [...entries, { puuid: 'puuid-11', name: 'Eleventh', rating: 100, games: 3 }],
      }),
    ).embeds[0]?.fields?.[0]?.value;

    expect(value?.split('\n')).toHaveLength(10);
    expect(value).not.toContain('Eleventh');
  });

  it('says `1 game` for the newest player, never `1 games`', () => {
    const value = leaderboardEmbed(
      workedLeaderboardInput({
        entries: [{ puuid: 'puuid-new', name: 'New', rating: 0, games: 1 }],
      }),
    ).embeds[0]?.fields?.[0]?.value;

    expect(value).toBe('`1` **New** · 0 · 1 game');
  });

  it('renders a nameless player as `Someone`, like every other surface (M3.10)', () => {
    const value = leaderboardEmbed(
      workedLeaderboardInput({
        entries: [{ puuid: 'puuid-x', name: null, rating: 700, games: 12 }],
      }),
    ).embeds[0]?.fields?.[0]?.value;

    expect(value).toBe('`1` **Someone** · 700 · 12 games');
  });
});

/**
 * **The week's own board post** (M7.3, net points since M14.57). The nightly post reads
 * `This week` and the Sunday post reads `Last week`, so both print net points and W–L, in the
 * board's own order, and both carry the week's footer.
 */
describe('a board post on a week', () => {
  const weekly = () =>
    workedLeaderboardInput({
      track: 'week',
      entries: workedWindowRows('last-week').map((row) => ({
        puuid: row.puuid,
        name: row.name,
        rating: row.rating,
        games: row.games,
        week: {
          points: row.points ?? 0,
          wins: row.wins,
          losses: row.losses,
          settlingGames: row.settlingChip ? row.ratedGames : null,
        },
      })),
    });

  it('prints net points and W–L, never a Rating', () => {
    const value = leaderboardEmbed(weekly()).embeds[0]?.fields?.[0]?.value ?? '';

    expect(value.split('\n')[0]).toBe('`1` **Lena** · +58 · 4W–2L');
    expect(value).not.toContain('2088');
  });

  it('adds the all-time settling chip to a settling player, and +0 for a net zero', () => {
    expect(weekLineTail({ points: 31, wins: 1, losses: 0, settlingGames: 3 })).toBe(
      '+31 · 1W–0L · settling · 3/10',
    );
    expect(weekLineTail({ points: 0, wins: 1, losses: 1, settlingGames: null })).toBe('+0 · 1W–1L');
    expect(weekLineTail({ points: -45, wins: 0, losses: 2, settlingGames: null })).toBe('-45 · 0W–2L');
  });

  it('carries the week footer, and the all-time windows the settling line', () => {
    expect(leaderboardEmbed(weekly()).embeds[0]?.footer?.text).toBe(WEEK_BOARD_SENTENCE_SHORT);
    expect(leaderboardEmbed(workedLeaderboardInput()).embeds[0]?.footer?.text).toBe(SETTLING_FOOTER);
    // The Sunday post is a week board and the all-time board is not: one helper, two answers.
    expect(boardFooter('week')).toBe(WEEK_BOARD_SENTENCE_SHORT);
    expect(boardFooter('all-time')).toBe(SETTLING_FOOTER);
  });

  it('never prints a settling section on a week, even when it is handed one', () => {
    const embed = leaderboardEmbed({
      ...weekly(),
      settling: [{ puuid: 'p', name: 'New', rating: 1200, ratedGames: 2 }],
    }).embeds[0];
    expect(embed?.fields?.map((field) => field.name)).toEqual(['Top ten']);
  });

  it('interpolates no game count into either footer', () => {
    // M18.7: the only digit is the week's fixed start, `0` (05-design 11.4); no count is interpolated.
    expect(WEEK_BOARD_SENTENCE_SHORT.replace("starts the week at 0", "")).not.toMatch(/\d/);
    expect(
      windowSummaryEmbed(workedWindowInput({ track: 'week', entries: weekly().entries })).embeds[0]?.footer
        ?.text,
    ).toBe(WEEK_BOARD_SENTENCE_SHORT);
  });
});

/**
 * The post a closed week makes of itself (M5.10, fired by M5.13): the same ten and the same
 * numbers as the nightly example, under the days they were played on.
 *
 * The description is built by `windowRange.ts` from the window itself and is passed in here as
 * a string, because this builder is pure and knows nothing about calendars.
 */
function workedWindowInput(overrides: Partial<WindowSummaryEmbedInput> = {}): WindowSummaryEmbedInput {
  return {
    windowLabel: WINDOW_LABELS['last-week'],
    description: 'Sunday 6 Sep to Saturday 12 Sep · 14 rated games',
    track: 'all-time',
    entries: allTimeEntries(),
    url: `${SITE_URL}/g/customs/leaderboard?window=last-week`,
    identity: IDENTITY,
    ...overrides,
  };
}

describe('windowSummaryEmbed, the closed window', () => {
  it("is the milestone's weekly post", () => {
    expect(windowSummaryEmbed(workedWindowInput())).toMatchSnapshot();
  });

  /**
   * **The title, the url and the description name the same window.** A post that arrives
   * unasked has to say which seven days it is about, and the tap out of the channel has to
   * land on the board it printed.
   */
  it('names the window in the title, the link and the dates', () => {
    const embed = windowSummaryEmbed(workedWindowInput()).embeds[0];

    expect(embed?.title).toBe('Last week · board');
    expect(embed?.url).toBe(`${SITE_URL}/g/customs/leaderboard?window=last-week`);
    // Byte for byte the board's own window slot (`05-design.md`), which since M7.18 names the
    // count it counted: `post.ts` composes it with `boardSlotLine` and this builder prints it.
    expect(embed?.description).toBe('Sunday 6 Sep to Saturday 12 Sep · 14 rated games');
    expect(embed?.color).toBe(ACCENT_COLOR);
  });

  it('prints the same board lines, and the same field-name rule, as the nightly post', () => {
    const embed = windowSummaryEmbed(workedWindowInput()).embeds[0];

    expect(embed?.fields?.[0]?.name).toBe('Top ten');
    expect(embed?.fields?.[0]?.value.split('\n')[0]).toBe('`1` **Lena** · 2088 · 41 games');
    expect(embed?.fields?.[0]?.value.split('\n')).toHaveLength(10);
    expect(embed?.footer?.text).toBe(leaderboardEmbed(workedLeaderboardInput()).embeds[0]?.footer?.text);

    const eight = windowSummaryEmbed(workedWindowInput({ entries: workedWindowInput().entries.slice(0, 8) }))
      .embeds[0];
    expect(eight?.fields?.[0]?.name).toBe('The board');
  });

  /**
   * **The awards are a seam** (M5.4 has not shipped): with none given, the post is the board
   * and there is no empty field where the block will go.
   */
  it('prints the board alone until there are awards to print', () => {
    expect(windowSummaryEmbed(workedWindowInput()).embeds[0]?.fields).toHaveLength(1);
    expect(windowSummaryEmbed(workedWindowInput({ awards: [] })).embeds[0]?.fields).toHaveLength(1);
  });

  it('prints one block field per award, the label its name and the line quoted (10.6)', () => {
    const embed = windowSummaryEmbed(
      workedWindowInput({
        awards: [
          { label: 'Best off-role', line: 'Omar · 9W 3L · 75% · his main is top' },
          // An award nobody won prints its sentence rather than being dropped, so the block
          // always has both lines and the group can see the bar it missed (M5.10).
          { label: 'Cursed duo', line: 'Nobody played 6 games this week.' },
        ],
      }),
    ).embeds[0];

    expect(embed?.fields?.slice(1)).toEqual([
      { name: 'Best off-role', value: 'Omar · 9W 3L · 75% · his main is top' },
      { name: 'Cursed duo', value: 'Nobody played 6 games this week.' },
    ]);
  });

  it('caps the board at ten lines and renders a nameless player as `Someone`', () => {
    const value = windowSummaryEmbed(
      workedWindowInput({ entries: [{ puuid: 'puuid-x', name: null, rating: 700, games: 1 }] }),
    ).embeds[0]?.fields?.[0]?.value;

    expect(value).toBe('`1` **Someone** · 700 · 1 game');
  });
});

/**
 * The MVP / ACE line (M7.10), pinned by code point.
 *
 * Product's copy is `MVP Lena · ACE Rami` — two names, a middle dot, no score, no percentage,
 * no emoji — and this file is where a string the group reads is allowed to be a literal. The
 * separator is U+00B7, the same middle dot every other line in these embeds uses; a hyphen or a
 * bullet here would be a fifth punctuation on a surface with four.
 */
describe('the MVP / ACE line', () => {
  it("is product's line, character for character", () => {
    expect(awardLine({ mvp: 'Lena', ace: 'Rami' })).toBe('MVP Lena · ACE Rami');
    expect([...awardLine({ mvp: 'Lena', ace: 'Rami' })].map((character) => character.codePointAt(0))).toEqual(
      [
        0x4d, 0x56, 0x50, 0x20, 0x4c, 0x65, 0x6e, 0x61, 0x20, 0xb7, 0x20, 0x41, 0x43, 0x45, 0x20, 0x52, 0x61,
        0x6d, 0x69,
      ],
    );
    expect(MVP_LABEL).toBe('MVP');
    expect(ACE_LABEL).toBe('ACE');
  });

  it('is floodlit: no emoji, no trophy, no colour of its own, no `#1`', () => {
    const line = awardLine({ mvp: 'Lena', ace: 'Rami' });
    // Printable ASCII and the middle dot, and nothing else: an emoji, an arrow or a medal is
    // outside this set by construction.
    expect(/^[ -~·]+$/u.test(line)).toBe(true);
    expect(line).not.toContain('#');
    expect(line).not.toContain('**');
    // The post bolds the two labels and nothing else (05-design 10.5): the words are the same.
    expect(awardLineBold({ mvp: 'Lena', ace: 'Rami' })).toBe('**MVP** Lena · **ACE** Rami');
    expect(awardLineBold({ mvp: 'Lena', ace: 'Rami' }).replaceAll('**', '')).toBe(line);
  });

  it('renders a nameless player as `Someone`, like every other line', () => {
    expect(awardLine({ mvp: null, ace: 'Rami' })).toBe('MVP Someone · ACE Rami');
  });

  it('truncates and escapes a long Riot ID exactly as the columns above it do', () => {
    const long = `${'a'.repeat(40)}_x`;
    expect(awardLine({ mvp: long, ace: 'Rami' })).toBe(`MVP ${renderName(long)} · ACE Rami`);
    expect(renderName(long)).toContain('…');
  });

  it('is the last line of E1, under the headline it belongs to, never a field (10.5)', () => {
    const payload = resultEmbed(workedResultInput());
    const embed = payload.embeds[0];
    expect(embed?.description?.split('\n').at(-1)).toBe('**MVP** Lena · **ACE** Iris');
    expect(payload.embeds.every((part) => part.fields === undefined)).toBe(true);
  });

  /**
   * Acceptance 2 of M7.10: **a game with no award is the same post less one line.** Not a line
   * with a dash in it, not the word `unknown`.
   */
  it('prints no line at all when the game has no award', () => {
    const without = resultEmbed(workedResultInput({ award: null }));
    const before = resultEmbed(workedResultInput());
    expect(without.embeds[0]?.description?.split('\n')).toEqual(
      before.embeds[0]?.description?.split('\n').slice(0, -1),
    );
    expect(without.embeds.slice(1)).toEqual(before.embeds.slice(1));
  });
});

describe('fearlessEmbed', () => {
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
  /** Seats 0-4 blue top..support, 5-9 red top..support. */
  function riftGame(id: string, champions: readonly number[]): FearlessGame {
    return {
      id,
      durationS: 1_800,
      gameMode: 'CLASSIC',
      players: champions.map((championId, index) => ({
        puuid: `p${index}`,
        side: index < 5 ? 100 : 200,
        championId,
        role: ROLES[index % 5] ?? null,
      })),
    };
  }
  // Game 1: Camille, Graves, Akali, Caitlyn, Blitzcrank / Darius, Kha'Zix, Orianna, Ezreal, Leona.
  const GAME_ONE = riftGame('g1', [164, 104, 84, 51, 53, 122, 121, 61, 81, 89]);
  // Game 2: Aatrox, Lee Sin, Ahri, Jinx, Nautilus / K'Sante, Vi, Syndra, Kai'Sa, Thresh.
  const GAME_TWO = riftGame('g2', [266, 64, 103, 222, 111, 897, 254, 134, 145, 412]);

  function poolAfter(...games: FearlessGame[]): FearlessChampion[] {
    return presentFearless(foldFearless(games), championName);
  }

  function twoGamePost(): WebhookPayload {
    const champions = poolAfter(GAME_ONE, GAME_TWO);
    return fearlessEmbed({
      champions,
      added: addedBy(champions, 'g2'),
      identity: IDENTITY,
      url: `${SITE_URL}/g/customs/mode`,
    });
  }

  it("bolds exactly the second game's ten and leads each lane with them (snapshot)", () => {
    const payload = twoGamePost();
    expect(payload).toMatchSnapshot();
    const embed = payload.embeds[0];
    expect(embed?.color).toBe(ACCENT_COLOR);
    expect(embed?.title).toBe('Fearless');
    expect(embed?.fields?.map((field) => field.name)).toEqual([
      'top · 4',
      'jungle · 4',
      'mid · 4',
      'adc · 4',
      'support · 4',
    ]);
    expect(embed?.fields?.every((field) => field.inline === false)).toBe(true);
    expect(embed?.fields?.[0]?.value).toBe("**Aatrox**, **K'Sante**, Camille, Darius");
    expect(embed?.fields?.[3]?.value).toBe("**Jinx**, **Kai'Sa**, Caitlyn, Ezreal");
    const bold = embed?.fields?.flatMap((field) =>
      [...field.value.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]),
    );
    expect(bold?.sort()).toEqual(
      ['Aatrox', "K'Sante", 'Lee Sin', 'Vi', 'Ahri', 'Syndra', 'Jinx', "Kai'Sa", 'Nautilus', 'Thresh'].sort(),
    );
    expect(embed?.description).toBe(
      `Banned next game: 10 more, 20 in all. ${availableFearless(poolAfter(GAME_ONE, GAME_TWO)).length} still open.`,
    );
    expect(embed?.footer?.text).toBe("Tap the title to see what's still open");
  });

  it('counts nine, not ten, when a lock repeats a champion already banned', () => {
    // Seat 0 locks Camille again: already banned by game 1, so the game adds nine.
    const repeat = riftGame('g2', [164, 64, 103, 222, 111, 897, 254, 134, 145, 412]);
    const champions = poolAfter(GAME_ONE, repeat);
    const embed = fearlessEmbed({ champions, added: addedBy(champions, 'g2'), identity: IDENTITY }).embeds[0];
    expect(embed?.description).toMatch(/^Banned next game: 9 more, 19 in all\. /);
    expect(embed?.fields?.[0]?.value).toBe("**K'Sante**, Camille, Darius");
  });

  it("links a second group's mode panel and never the retired /fearless page", () => {
    const url = modePageUrl(SITE_URL, 'friday-five');
    expect(url).toBe(`${SITE_URL}/g/friday-five/mode`);
    const champions = poolAfter(GAME_ONE);
    const link = url === undefined ? {} : { url };
    const posts = [
      fearlessEmbed({ champions, added: addedBy(champions, 'g1'), identity: IDENTITY, ...link }),
      fearlessResetEmbed({ identity: IDENTITY, ...link }),
    ];
    for (const post of posts) {
      expect(post.embeds[0]?.url).toBe(url);
      expect(JSON.stringify(post)).not.toContain('/fearless');
    }
  });

  it('stays inside every embed limit at 172 bans with no lane shed', () => {
    const champions: FearlessChampion[] = listChampions().map((champion) => ({
      id: champion.id,
      name: champion.name,
      role: championLane(champion.id),
    }));
    expect(champions.length).toBeGreaterThanOrEqual(172);
    const added = new Set(champions.slice(0, 10).map((champion) => champion.id));
    const payload = fearlessEmbed({
      champions,
      added,
      identity: IDENTITY,
      url: `${SITE_URL}/g/customs/mode`,
    });
    const embed = payload.embeds[0];
    if (embed === undefined) throw new Error('no embed');
    // A second pass of the guard changes nothing, and nothing was cut on the first.
    expect(guardMessage(payload.embeds)).toEqual(payload.embeds);
    const fields = embed.fields ?? [];
    const printed = fields.map((field) => field.value).join(', ');
    expect(printed).not.toContain('…');
    for (const champion of champions) {
      expect(printed).toContain(champion.name.replace(/([`*_~|\\])/g, '\\$1'));
    }
    for (const field of fields) expect(field.value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(messageLength(payload.embeds)).toBeLessThanOrEqual(TOTAL_LIMIT);
    expect(embed.description).toBe(`Banned next game: 10 more, ${champions.length} in all. 0 still open.`);
  });

  it("escapes names as everywhere else: K'Sante and Kai'Sa pass, markdown cannot break the bold", () => {
    const champions: FearlessChampion[] = [
      { id: 897, name: "K'Sante", role: 'top' },
      { id: 145, name: "Kai'Sa", role: 'adc' },
      { id: 9001, name: 'Star*Guardian_', role: 'adc' },
      { id: 9002, name: 'Pipe|Back`tick', role: 'adc' },
    ];
    const embed = fearlessEmbed({
      champions,
      added: new Set([9001, 145]),
      identity: IDENTITY,
    }).embeds[0];
    expect(embed?.fields?.[0]?.value).toBe("K'Sante");
    expect(embed?.fields?.[1]?.value).toBe("**Kai'Sa**, **Star\\*Guardian\\_**, Pipe\\|Back\\`tick");
  });

  it('is a second message, never stuffed into the result', () => {
    const result = resultEmbed(workedResultInput()).embeds[0];
    const fearless = fearlessEmbed({
      champions: [{ id: 103, name: 'Ahri', role: 'mid' }],
      added: new Set([103]),
      identity: IDENTITY,
    }).embeds[0];
    expect(result?.title).not.toContain('Fearless');
    expect(fearless?.title).toBe('Fearless');
    expect(fearless?.fields?.map((field) => field.name)).toEqual(['mid · 1']);
    // No link, no promise to tap it, and since M14.61 no bare `Kustom` footer either.
    expect(fearless).not.toHaveProperty('footer');
  });

  it('carries no champion icon: the icon lives on the fearless card only (M11.1)', () => {
    const payload = twoGamePost();
    const text = JSON.stringify(payload);
    expect(text).not.toContain('communitydragon');
    expect(text).not.toContain('ddragon');
    expect(text).not.toContain('champion-icons');
    expect(text).not.toContain('sprite');
    expect(text).not.toMatch(/\.png/);
    const embed = payload.embeds[0] as Record<string, unknown> | undefined;
    expect(embed?.thumbnail).toBeUndefined();
    expect(embed?.image).toBeUndefined();
  });
});

/**
 * The result poster's underdog line (M11.3). It lives beside `favoredClause` so the two round
 * the same stored number the same way; the embed itself does not print it.
 */
describe('underdogClause', () => {
  it("is the underdog winner's rounded share, in product's words", () => {
    expect(underdogClause(0.62, 200)).toBe('Red was 38%. Red won.');
    expect(underdogClause(0.41, 100)).toBe('Blue was 41%. Blue won.');
  });

  it('is null when the favourite won, so the caller keeps `favoredClause`', () => {
    expect(underdogClause(0.62, 100)).toBeNull();
    expect(favoredClause(0.62)).toBe('Blue was favored 62%.');
    expect(underdogClause(0.38, 200)).toBeNull();
  });

  it('is null on a coin flip, whoever won', () => {
    expect(underdogClause(0.5, 100)).toBeNull();
    expect(underdogClause(0.5, 200)).toBeNull();
    // 0.496 rounds to 50: the rounded share decides, not the raw probability.
    expect(underdogClause(0.496, 100)).toBeNull();
    expect(favoredClause(0.5)).toBe('Neither side was favored.');
  });

  it('is null with no stored split', () => {
    expect(underdogClause(null, 200)).toBeNull();
  });

  it('agrees with the result post, which since M14.10 prints the same line plus Upset!', () => {
    const embed = resultEmbed(
      workedResultInput({ winningSide: 200, blueWinProb: 0.62, topDamage: null, award: null }),
    ).embeds[0];
    expect(embed?.description).toBe(`${underdogClause(0.62, 200)} Upset!`);
  });
});

describe('fearlessResetEmbed', () => {
  it('says the ban list is empty', () => {
    const embed = fearlessResetEmbed({ identity: IDENTITY }).embeds[0];
    expect(embed?.title).toBe('Fearless');
    expect(embed?.description).toBe('Fearless reset. Every champion is open again.');
    expect(embed).not.toHaveProperty('fields');
    expect(embed).not.toHaveProperty('footer');
  });
  it('links the mode panel like the pool post does (M14.31)', () => {
    const url = `${SITE_URL}/g/customs/mode`;
    const embed = fearlessResetEmbed({ identity: IDENTITY, url }).embeds[0];
    expect(embed?.url).toBe(url);
    expect(embed?.description).toBe('Fearless reset. Every champion is open again.');
    // No footer on the reset, link or not (design review, M14.61).
    expect(embed).not.toHaveProperty('footer');
  });
});

/* ---------------------------------------------------------------------------
 * M14.10: the receipt in the teams embed, the reroll, the settling section, and the
 * one-public-number rule across every post.
 * ------------------------------------------------------------------------- */

describe('teamsEmbed, the receipt (M14.10)', () => {
  it('is drawn from the split columns only: a garbage explanation changes nothing but its own line', () => {
    const real = teamsEmbed(workedTeamsInput());
    const garbage = teamsEmbed(workedTeamsInput({ explanation: 'Red favored 99%. Gap 9000. lol' }));

    expect(headerLines(garbage)).toEqual(headerLines(real));
    expect(receiptOf(garbage).slice(0, -1)).toEqual(receiptOf(real).slice(0, -1));
    expect(receiptOf(garbage).at(-1)).toBe('-# Red favored 99%. Gap 9000. lol');
  });

  it("is core's sentence alone, as plain text in E4, when the split columns could not be read", () => {
    const payload = teamsEmbed(workedTeamsInput({ receipt: null }));
    expect(payload.embeds[0]).not.toHaveProperty('description');
    expect(payload.embeds[3]?.description).toBe(
      'Blue favored 56%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
    );
  });

  it('says `This was the only split that fit.` when the lobby stored one split', () => {
    const { chosen } = workedReceipt();
    const lines = receiptOf(teamsEmbed(workedTeamsInput({ receipt: { chosen, next: null, splitCount: 1 } })));
    expect(lines[0]).toBe("Rating gap 100 pts · Main roles 10/10 · Bot's pick #1 of 1");
    expect(lines[1]).toBe('This was the only split that fit.');
  });

  it('draws the bar as ten cells, blue from the left, each side keeping one (10.4)', () => {
    expect(oddsBar(0.54)).toBe('🟦'.repeat(5) + '🟥'.repeat(5));
    expect(oddsBar(0.5)).toBe('🟦'.repeat(5) + '🟥'.repeat(5));
    expect(oddsBar(0)).toBe(`🟦${'🟥'.repeat(9)}`);
    expect(oddsBar(1)).toBe(`${'🟦'.repeat(9)}🟥`);
    expect([...oddsBar(0.37)]).toHaveLength(10);
  });

  it("sets core's sentence as subtext, with the italic fallback one switch away", () => {
    expect(explanationLine('Blue favored 54%.')).toBe('-# Blue favored 54%.');
    expect(explanationLine('Blue favored 54%.', 'italic')).toBe('*Blue favored 54%.*');
  });

  it('builds E1 and E4 from the same functions the post uses', () => {
    const input = workedTeamsInput();
    const payload = teamsEmbed(input);
    expect(headerLines(payload)).toEqual(teamsHeaderLines(input));
    expect(receiptOf(payload)).toEqual(textOf(receiptLines(input)));
  });
});

/** A reroll to `rank`: the promoted split's own columns and its own stored sentence. */
function workedReroll(rank: 2 | 3): TeamsEmbedInput {
  const explanation = workedBalance().explanations[rank - 1];
  if (explanation === undefined) throw new Error(`no explanation at rank ${rank}`);
  return workedTeamsInput({ promoted: { rank, splitCount: 3 }, receipt: workedReceipt(rank), explanation });
}

describe('teamsEmbed, a reroll (M3.2, M14.10)', () => {
  const input = workedReroll(2);
  const payload = teamsEmbed(input);
  const embed = payload.embeds[0];

  it('is the reroll post', () => {
    expect(payload).toMatchSnapshot();
  });

  it("says reroll once in the body (the chip), not as a first-line prefix, and reads the promoted split's own columns", () => {
    const second = workedBalance().splits[1];
    if (second === undefined) throw new Error('no split 2');
    const blue = Math.round(second.blueWinProb * 100);
    expect(headerLines(payload)[0]).toBe(`**Blue ${blue}%** · **${100 - blue}% Red**`);
    expect(headerLines(payload)[1]).toBe(oddsBar(second.blueWinProb));
    const chips = receiptOf(payload)[0];
    expect(chips).toContain('Reroll 1 of 2 · pick #2');
    expect([...headerLines(payload), ...receiptOf(payload)].join('\n').match(/reroll/gi)).toHaveLength(1);
    expect(chips).toContain(`Rating gap ${second.gap} pts`);
    expect(embed?.title).toBe('Teams are set · reroll 1 of 2');
  });

  it('never claims the fairest split on a reroll', () => {
    expect(JSON.stringify(payload)).not.toContain('fairest');
  });

  it('says nothing about a runner-up once the last split is in play', () => {
    const last = teamsEmbed(workedReroll(3));
    const lines = receiptOf(last);
    expect(lines).toHaveLength(2);
    expect(headerLines(last)[0]?.startsWith('**Blue ')).toBe(true);
    expect(lines[0]).toContain('Reroll 2 of 2');
    // The receipt's own lines; the last one is core's sentence, quoted as stored.
    const receipt = [...headerLines(last), ...lines.slice(0, -1)].join('\n');
    expect(receipt).not.toContain('Next best');
    expect(receipt).not.toContain('only split');
  });
});

describe('a board post on the all-time track: the settling rule (M14.10)', () => {
  // Nadia and Yuki with 4 and 0 rated games in the group: under `SETTLING_GAMES`.
  const counts = new Map(workedBoardRows().map((row) => [row.puuid, row.games]));
  counts.set(workedPuuid('Nadia'), 4);
  counts.delete(workedPuuid('Yuki'));
  const { entries, settling } = boardPostEntries(workedBoardRows(), 'all-time', counts);
  const payload = windowSummaryEmbed(
    workedWindowInput({
      windowLabel: WINDOW_LABELS['all-time'],
      description: 'first game 8 Sep 2025 · 34 rated games',
      entries,
      settling,
      url: `${SITE_URL}/g/customs/leaderboard?window=all-time`,
    }),
  );
  const embed = payload.embeds[0];

  it('is an all-time board post with a settling section', () => {
    expect(payload).toMatchSnapshot();
  });

  it('numbers only the settled players, by Rating, and lists the rest after, unnumbered', () => {
    expect(embed?.fields?.map((field) => field.name)).toEqual(['The board', SETTLING_FIELD]);
    const ranked = embed?.fields?.[0]?.value.split('\n') ?? [];
    expect(ranked).toHaveLength(8);
    expect(ranked.every((line, index) => line.startsWith(`\`${index + 1}\` `))).toBe(true);
    expect(ranked.join('\n')).not.toMatch(/Nadia|Yuki/);

    const unranked = embed?.fields?.[1]?.value.split('\n') ?? [];
    const nadia = workedBoardRows().find((row) => row.name === 'Nadia');
    const yuki = workedBoardRows().find((row) => row.name === 'Yuki');
    const expected = [
      { name: 'Nadia', rating: nadia?.rating ?? 0, n: 4 },
      { name: 'Yuki', rating: yuki?.rating ?? 0, n: 0 },
    ]
      .sort((a, b) => b.rating - a.rating)
      .map((row) => `${row.name} · ${row.rating} · settling · ${row.n}/${SETTLING_GAMES}`);
    expect(unranked).toEqual(expected);
  });

  it("orders the ranked list on Rating, not on the board's old Proven order", () => {
    const printed = (embed?.fields?.[0]?.value.split('\n') ?? []).map((line) => Number(line.split(' · ')[1]));
    expect(printed).toEqual([...printed].sort((a, b) => b - a));
  });

  it('is a settling list alone when nobody has ten games yet', () => {
    const fresh = boardPostEntries(workedBoardRows(), 'all-time', new Map());
    const only = leaderboardEmbed(workedLeaderboardInput({ ...fresh })).embeds[0];
    expect(fresh.entries).toEqual([]);
    expect(only?.fields?.map((field) => field.name)).toEqual([SETTLING_FIELD]);
    expect(only?.fields?.[0]?.value.split('\n')).toHaveLength(10);
  });

  it('ranks everybody by Rating, with no settling split, when the counts could not be read', () => {
    const unread = boardPostEntries(workedBoardRows(), 'all-time', null);
    expect(unread.settling).toEqual([]);
    expect(unread.entries).toHaveLength(10);
    const printed = unread.entries.map((entry) => entry.rating);
    expect(printed).toEqual([...printed].sort((a, b) => b - a));
  });

  it("keeps the board's own order on a week, sets nobody apart and carries points and W–L", () => {
    const rows = workedWindowRows('last-week');
    const week = boardPostEntries(rows, 'week', null);
    expect(week.settling).toEqual([]);
    expect(week.entries.map((entry) => entry.puuid)).toEqual(rows.map((row) => row.puuid));
    expect(week.entries[0]?.week).toEqual({
      points: rows[0]?.points,
      wins: rows[0]?.wins,
      losses: rows[0]?.losses,
      settlingGames: null,
    });
  });
});

/**
 * **One public number** (M14.10 acceptance 3, STRATEGY §5): no `Proven` and no `ordinal`
 * anywhere in any post, and every post under Discord's limits with the receipt whole.
 */
describe('every post', () => {
  const posts = {
    teams: teamsEmbed(workedTeamsInput()),
    reroll: teamsEmbed(workedReroll(2)),
    result: resultEmbed(workedResultInput()),
    nightly: leaderboardEmbed(workedLeaderboardInput()),
    weekly: windowSummaryEmbed(workedWindowInput({ track: 'week' })),
    allTime: windowSummaryEmbed(
      workedWindowInput({
        windowLabel: WINDOW_LABELS['all-time'],
        settling: [{ puuid: 'p', name: 'New', rating: 1200, ratedGames: 3 }],
      }),
    ),
    fearless: fearlessEmbed({
      champions: [{ id: 103, name: 'Ahri', role: 'mid' }],
      added: new Set([103]),
      identity: IDENTITY,
    }),
    fearlessReset: fearlessResetEmbed({ identity: IDENTITY }),
  };

  it.each(Object.entries(posts))('%s prints no Proven and no ordinal', (_name, payload) => {
    expect(JSON.stringify(payload)).not.toMatch(/proven|ordinal/i);
  });

  it.each(Object.entries(posts))(
    '%s is under 6000 characters in all, across the message',
    (_name, payload) => {
      expect(messageLength(payload.embeds)).toBeLessThanOrEqual(TOTAL_LIMIT);
    },
  );

  it('keeps the teams receipt whole: the guard never sheds it', () => {
    const input = workedTeamsInput();
    expect(headerLines(posts.teams)).toEqual(teamsHeaderLines(input));
    expect(receiptOf(posts.teams)).toEqual(textOf(receiptLines(input)));
  });
});

/**
 * M14.41 (scene-walk gap 1): one Rating per person in each message. Every line that names a
 * worked player, across the description and every field, carries at most one distinct four-digit
 * number per name: the group Rating (Discord prints no weekly number beside it).
 */
describe('one Rating per person in a message (M14.41)', () => {
  function numbersPerName(payload: WebhookPayload): Map<string, Set<string>> {
    const text = payload.embeds
      .flatMap((embed) => [embed.description ?? '', ...(embed.fields ?? []).map((field) => field.value)])
      .join('\n');
    const seen = new Map<string, Set<string>>();
    for (const line of text.split('\n')) {
      const numbers = line.match(/(?<![\d.])\d{4}(?![\d.])/g) ?? [];
      for (const player of WORKED_ROSTER) {
        if (!new RegExp(`\\b${player.name}\\b`).test(line)) continue;
        const set = seen.get(player.name) ?? new Set<string>();
        for (const n of numbers) set.add(n);
        seen.set(player.name, set);
      }
    }
    return seen;
  }

  it('the teams post and the result post never put two four-digit numbers beside one name', () => {
    for (const payload of [teamsEmbed(workedTeamsInput()), resultEmbed(workedResultInput())]) {
      const seen = numbersPerName(payload);
      expect(seen.size).toBeGreaterThanOrEqual(10);
      for (const [name, numbers] of seen)
        expect({ name, one: numbers.size <= 1 }).toEqual({ name, one: true });
    }
  });
});

/** M14.41 review: the main-role clause never contradicts the chip in one teams post. */
describe("teams embed: core's main-role clause follows the chip (M14.41 review)", () => {
  const CHIP_NEW = /Main roles \d+\/\d+ · \d+ new|No main roles yet/;

  it('the worked sentence carries the all-on-main clause, so the case is real', () => {
    expect(workedTeamsInput().explanation).toContain('Everyone on a main role.');
  });

  for (const fresh of [4, 10]) {
    it(`never prints Everyone on a main role beside the chip with ${fresh} new`, () => {
      const base = workedTeamsInput();
      let left = fresh;
      const mark = (players: typeof base.blue) =>
        players.map((player) => (left-- > 0 ? { ...player, offRole: false, noMain: true } : player));
      const blue = mark(base.blue);
      const red = mark(base.red);
      // The chip and core's sentence both live in E4 since M14.61.
      const description = teamsEmbed({ ...base, blue, red }).embeds[3]?.description ?? '';
      expect(description).toMatch(CHIP_NEW);
      expect(description).not.toContain('Everyone on a main role');
      expect(description).toContain(fresh === 10 ? 'No main roles yet.' : '4 new, the rest on a main role.');
    });
  }
});
