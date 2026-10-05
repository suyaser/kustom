import type { Role } from '@customs/core';
import type { RuleCheck } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import { WINDOW_LABELS } from '../board/copy';
import { game4Identity, game4Result, game4Teams } from '../testing/discordGame4';
import { recapPayload } from './aiEdit';
import {
  ACCENT_COLOR,
  BLUE_COLOR,
  type Embed,
  explanationLine,
  GAME_ON_CUSTOM_TITLE,
  gameOnEmbed,
  type LeaderboardEntry,
  leaderboardEmbed,
  RED_COLOR,
  type ResultPlayer,
  renderName,
  resultEmbed,
  type SeatLine,
  SHED,
  SIDE_LINE_MANUAL,
  SLATE_COLOR,
  type TeamsEmbedInput,
  type TeamsPlayer,
  teamsEmbed,
  type WindowAward,
  windowSummaryEmbed,
} from './embeds';
import {
  cutText,
  DESCRIPTION_LIMIT,
  type DraftEmbed,
  ELLIPSIS,
  EMBEDS_LIMIT,
  FIELD_VALUE_LIMIT,
  FOOTER_LIMIT,
  fieldValue,
  guardMessage,
  KEEP_LAST_STANDING,
  messageLength,
  TITLE_LIMIT,
  TOTAL_LIMIT,
} from './limits';
import { resultModeLines } from './modeLines';

/**
 * M4.12: Discord's limits, and what the builders do when an input reaches one.
 *
 * Discord does not truncate — a field value of 1025 characters is a 400 on the whole webhook,
 * so the post is not shortened, it is lost. The reviewer's case (2026-09-11) is eleven friends
 * with Riot IDs made of markdown: ten `Swap:` lines, every name doubled by the backslashes
 * `renderName` adds, and a `Seats` value half again over the limit.
 *
 * The pathological inputs below are built the way a hostile night would build them, and every
 * assertion is about the message that comes out: it fits, the line that matters is still in it,
 * and nothing was cut through the middle of a name or an escape.
 */

const IDENTITY = game4Identity();

/** 32 characters, every one of them something `escapeMarkdown` doubles. */
const ESCAPABLE_NAME = '*_~|`\\*_'.repeat(4);

/** The same name as it prints: 64 characters, a backslash in front of every one. */
const RENDERED = renderName(ESCAPABLE_NAME);

/**
 * The `Seats` line the ten of them make. Written out here rather than imported, so this test
 * says what the string on the wire is and would notice `seatLine` changing shape.
 */
const SWAP_LINE = `Swap: ${RENDERED} out, ${RENDERED} in.`;

const LANES: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];

function teamOf(side: 'blue' | 'red', name: string): TeamsPlayer[] {
  return LANES.map((role, index) => ({
    puuid: `${side}-${index}`,
    name,
    role,
    rating: 1400 + index,
    offRole: false,
  }));
}

function pathologicalTeamsInput(overrides: Partial<TeamsEmbedInput> = {}): TeamsEmbedInput {
  const seats: SeatLine[] = Array.from({ length: 10 }, (_, index) => ({
    kind: 'swap',
    sitter: `${ESCAPABLE_NAME}${index}`.slice(0, 32),
    mover: `${ESCAPABLE_NAME}${index}`.slice(0, 32),
  }));

  return {
    identity: IDENTITY,
    blue: teamOf('blue', ESCAPABLE_NAME),
    red: teamOf('red', ESCAPABLE_NAME),
    explanation: 'Blue favored 54%. Everyone on a main role. Gap 100.',
    receipt: null,
    sitOut: null,
    seats,
    switchSideEnabled: false,
    lobby: { name: 'customs-night', password: '4471' },
    ...overrides,
  };
}

/** Every backslash escapes the character after it, so a line's trailing run must be even. */
function escapesAreWhole(value: string): boolean {
  return value.split('\n').every((line) => (/\\*$/.exec(line)?.[0].length ?? 0) % 2 === 0);
}

function fieldsOf(embed: Embed | undefined): { name: string; value: string }[] {
  return (embed?.fields ?? []).map((field) => ({ name: field.name, value: field.value }));
}

/** Every part of every embed of a payload inside its own limit, and the message inside 6,000. */
function legal(embeds: readonly Embed[]): boolean {
  return (
    embeds.length <= EMBEDS_LIMIT &&
    messageLength(embeds) <= TOTAL_LIMIT &&
    embeds.every(
      (embed) =>
        (embed.title?.length ?? 0) <= TITLE_LIMIT &&
        (embed.description?.length ?? 0) <= DESCRIPTION_LIMIT &&
        (embed.footer?.text.length ?? 0) <= FOOTER_LIMIT &&
        (embed.fields ?? []).every(
          (field) => field.value.length <= FIELD_VALUE_LIMIT && field.value.length > 0,
        ),
    )
  );
}

describe('fieldValue, the shared field-value guard', () => {
  /**
   * **The identity below the limit** is the property every snapshot in this directory rests on:
   * the guard is not a formatter and does not touch a value it does not have to.
   */
  it('is the plain join when the lines fit', () => {
    expect(fieldValue(['one', 'two', 'three'])).toBe('one\ntwo\nthree');
    expect(fieldValue([])).toBe('');
  });

  it('leaves a value of exactly the limit alone and cuts the one character over it', () => {
    const exact = ['a'.repeat(500), 'b'.repeat(523)];
    expect(exact.join('\n')).toHaveLength(FIELD_VALUE_LIMIT);
    expect(fieldValue(exact)).toBe(exact.join('\n'));

    const over = ['a'.repeat(500), 'b'.repeat(524)];
    expect(over.join('\n')).toHaveLength(FIELD_VALUE_LIMIT + 1);
    const cut = fieldValue(over);
    expect(cut.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    // A line boundary, not a character: the first line is whole and the second is gone.
    expect(cut).toBe(`${'a'.repeat(500)}\n${ELLIPSIS}`);
  });

  it('drops equal-ranked lines from the bottom and marks the gap once', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `${index}`.padEnd(100, '.'));
    const value = fieldValue(lines);

    expect(value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(value.split('\n')[0]).toBe(lines[0]);
    expect(value.split('\n').at(-1)).toBe(ELLIPSIS);
    // One `…` for the whole cut, not one per line lost.
    expect(value.split('\n').filter((line) => line === ELLIPSIS)).toHaveLength(1);
  });

  it('keeps the highest-ranked line and puts the gap where the dropped lines were', () => {
    const value = fieldValue([
      ...Array.from({ length: 20 }, (_, index) => `${index}`.padEnd(100, '.')),
      { text: 'the one that matters', keep: KEEP_LAST_STANDING },
    ]);

    expect(value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(value.split('\n').at(-1)).toBe('the one that matters');
    expect(value.split('\n').at(-2)).toBe(ELLIPSIS);
  });

  /** A field Discord accepts is never empty, so the last line standing is cut, not dropped. */
  it('cuts the one surviving line rather than returning nothing', () => {
    const value = fieldValue([{ text: 'x'.repeat(3000), keep: KEEP_LAST_STANDING }, 'y'.repeat(50)]);

    expect(value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(value.endsWith(ELLIPSIS)).toBe(true);
  });
});

describe('cutText, the character cut', () => {
  it('never ends on half of a markdown escape', () => {
    // `\*` repeated: the limit lands on a backslash, which would escape the `…` and eat it.
    const value = '\\*'.repeat(600);
    const cut = cutText(value, FIELD_VALUE_LIMIT);

    expect(cut.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(cut.endsWith(`*${ELLIPSIS}`)).toBe(true);
    expect(escapesAreWhole(cut)).toBe(true);
  });

  it('never ends on half of a surrogate pair', () => {
    const value = '😀'.repeat(20);
    const cut = cutText(value, 11);

    expect(cut).toBe(`${'😀'.repeat(5)}${ELLIPSIS}`);
    expect([...cut]).toHaveLength(6);
  });

  it('is the identity at and below the limit', () => {
    expect(cutText('abcde', 5)).toBe('abcde');
    expect(cutText('abcde', 6)).toBe('abcde');
    expect(cutText('abcde', 4)).toBe(`abc${ELLIPSIS}`);
  });
});

/**
 * The reviewer's case, end to end (M4.12 acceptance).
 */
describe('teamsEmbed, ten swaps of markdown names', () => {
  const payload = teamsEmbed(pathologicalTeamsInput());
  const embed = payload.embeds[0];
  const seats = fieldsOf(embed).find((field) => field.name === 'Seats');

  it('is over the limit before the guard', () => {
    // What the field would be without one: ten 144-character `Swap:` lines and the side line.
    const raw = [...Array.from({ length: 10 }, () => SWAP_LINE), SIDE_LINE_MANUAL].join('\n');

    expect(SWAP_LINE.length).toBe(144);
    expect(raw.length).toBeGreaterThan(FIELD_VALUE_LIMIT);
  });

  it('lands under 1024 with the side line intact', () => {
    expect(seats?.value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    // The sentence addressed to all ten is the last line standing, still the last line.
    expect(seats?.value.split('\n').at(-1)).toBe(SIDE_LINE_MANUAL);
    expect(seats?.value).toContain(`\n${ELLIPSIS}\n`);
  });

  it('cuts on line boundaries, so no name and no escape is sliced', () => {
    const lines = seats?.value.split('\n') ?? [];
    const swaps = lines.filter((line) => line.startsWith('Swap:'));

    expect(swaps.length).toBeGreaterThan(0);
    expect(swaps.length).toBeLessThan(10);
    for (const line of swaps) expect(line).toMatch(/^Swap: .+ out, .+ in\.$/);
    expect(escapesAreWhole(seats?.value ?? '')).toBe(true);
  });

  it('keeps every other field inside its own limit', () => {
    for (const field of fieldsOf(embed)) {
      expect(field.value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
      expect(field.value.length).toBeGreaterThan(0);
    }
    expect(legal(payload.embeds)).toBe(true);
  });
});

/**
 * **A normal night is untouched**, which is why not one snapshot in this directory moved when
 * the guard landed (`embeds.test.ts`, `discord.integration.test.ts`). The guard is off the
 * normal path by construction: below the limit `fieldValue` returns the join it was given.
 */
describe('a normal post', () => {
  it('carries no mark of the guard', () => {
    const embed = teamsEmbed(
      pathologicalTeamsInput({
        blue: teamOf('blue', 'Hana'),
        red: teamOf('red', 'Omar'),
        seats: [{ kind: 'swap', sitter: 'Omar', mover: 'Nadia' }],
      }),
    ).embeds[0];

    for (const field of fieldsOf(embed)) {
      expect(field.value).not.toContain(ELLIPSIS);
      expect(field.value.length).toBeLessThan(FIELD_VALUE_LIMIT);
    }
    expect(fieldsOf(embed).find((field) => field.name === 'Seats')?.value).toBe(
      `Swap: Omar out, Nadia in.\n${SIDE_LINE_MANUAL}`,
    );
  });
});

describe('the result embed, ten markdown names', () => {
  it('fits both sides and the award line, whole', () => {
    const player = (side: string, role: Role, index: number): ResultPlayer => ({
      puuid: `${side}-${index}`,
      name: ESCAPABLE_NAME,
      role,
      rating: 1400,
      delta: -41,
    });
    const payload = resultEmbed({
      identity: IDENTITY,
      winningSide: 200,
      durationS: 2052,
      blue: LANES.map((role, index) => player('blue', role, index)),
      red: LANES.map((role, index) => player('red', role, index)),
      blueWinProb: 0.54,
      topDamage: { name: ESCAPABLE_NAME, damage: 47_300 },
      // Two more escapable names on the award line, which gives way early (05-design 10.12).
      award: { mvp: ESCAPABLE_NAME, ace: ESCAPABLE_NAME },
      gameNumber: 47,
    });
    const description = payload.embeds[0]?.description ?? '';

    expect(legal(payload.embeds)).toBe(true);
    expect(escapesAreWhole(description)).toBe(true);
    // With ten markdown names it has not given way: the line is whole and unescaped-through.
    expect(description.split('\n').at(-1)).toBe(`**MVP** ${RENDERED} · **ACE** ${RENDERED}`);
    for (const side of payload.embeds.slice(1)) {
      expect(side.description?.split('\n')).toHaveLength(5);
      expect(escapesAreWhole(side.description ?? '')).toBe(true);
    }
  });
});

/**
 * M15.6: the longest mode line the result post can carry: a region wars game on the two longest
 * region names, both sides with three broken champions of the longest names plus one that could
 * not be checked, on a game switched to rated (so the columns and the award print too) and on
 * the same game not rated. It fits, and the mode lines survive whole.
 */
describe('the result embed, the longest mode line', () => {
  const longest: RuleCheck = {
    kind: 'sides',
    // The three longest names on the roster (12 characters); an id newer than any pin.
    blue: { side: 100, verdict: 'broke', broke: [9, 74, 888], unknown: [999_999] },
    red: { side: 200, verdict: 'broke', broke: [9, 74, 888], unknown: [999_998] },
  };
  const rule = { mode: { id: 'region', blue: 'shadow-isles', red: 'bandle-city' } as const, check: longest };
  const player = (side: string, role: Role, index: number, rated: boolean): ResultPlayer => ({
    puuid: `${side}-${index}`,
    name: ESCAPABLE_NAME,
    role,
    rating: rated ? 1400 : null,
    delta: rated ? -41 : null,
  });

  for (const rated of [true, false]) {
    it(rated ? 'fits when rated, columns and award included' : 'fits when not rated', () => {
      const lines = resultModeLines({ rated, rule });
      const payload = resultEmbed({
        identity: IDENTITY,
        winningSide: 200,
        durationS: 2052,
        blue: LANES.map((role, index) => player('blue', role, index, rated)),
        red: LANES.map((role, index) => player('red', role, index, rated)),
        blueWinProb: 0.54,
        topDamage: { name: ESCAPABLE_NAME, damage: 47_300 },
        award: rated ? { mvp: ESCAPABLE_NAME, ace: ESCAPABLE_NAME } : null,
        gameNumber: 47,
        mode: { rated, rule },
        url: 'https://kustom.example/g/a-group-slug-that-is-long/games/00000000-0000-0000-0000-000000000000',
      });
      const embed = payload.embeds[0];
      if (embed === undefined) throw new Error('no embed');

      expect(lines[0]).toContain(
        "Blue: Fiddlesticks, Heimerdinger and Renata Glasc aren't from Shadow Isles.",
      );
      expect(lines[0]).toContain("Red: couldn't check Champion 999998.");
      expect(legal(payload.embeds)).toBe(true);
      for (const line of lines) expect(embed.description?.split('\n')).toContain(line);
      expect(JSON.stringify(payload)).not.toContain(ELLIPSIS);
    });
  }

  it('the teams post fits with the longest rule line on the pathological ten', () => {
    const payload = teamsEmbed(
      pathologicalTeamsInput({
        mode: { mode: { id: 'region', blue: 'shadow-isles', red: 'bandle-city' }, rated: false },
        modeUrl: 'https://kustom.example/g/a-group-slug-that-is-long/mode',
      }),
    );
    expect(legal(payload.embeds)).toBe(true);
    expect(payload.embeds[0]?.description?.split('\n')[0]).toBe(
      '**This game: region wars.** Blue picks from Shadow Isles, Red from Bandle City. Not rated. [See both pools](https://kustom.example/g/a-group-slug-that-is-long/mode)',
    );
  });
});

/**
 * M22.7 (05-design 14.10, 10.12): the longest lobby label is a 32-character name of escapable
 * characters (64 printed) plus `'s lobby 2 · `, and it is part of the never-cut title. On the
 * pathological ten, with the longest rule line and every link carrying `?lobby=`, every post that
 * names a lobby still fits whole, with no new give-way step.
 */
describe('the longest lobby label (M22.7)', () => {
  const LOBBY_ID = '00000000-0000-4000-8000-000000000000';
  const label = {
    lobbyId: LOBBY_ID,
    label: { kind: 'host', name: ESCAPABLE_NAME, repeat: 2 },
    live: 3,
  } as const;
  const LABEL = `${RENDERED}'s lobby 2`;
  const URL = 'https://kustom.example/g/a-group-slug-that-is-long';
  const longestRule = {
    mode: { id: 'region', blue: 'shadow-isles', red: 'bandle-city' },
    rated: false,
  } as const;

  it('the teams post: the title whole, the side line kept, every link opens the lobby', () => {
    const payload = teamsEmbed(
      pathologicalTeamsInput({
        mode: longestRule,
        modeUrl: `${URL}/mode`,
        url: URL,
        receiptUrl: `${URL}#how-the-bot-decided`,
        promoted: { rank: 3, splitCount: 3 },
        lobbyLabel: label,
      }),
    );
    expect(legal(payload.embeds)).toBe(true);
    const [e1, , , e4] = payload.embeds;
    expect(e1?.title).toBe(`${LABEL}\u00a0· Teams are set · reroll 2 of 2`);
    expect(e1?.url).toBe(`${URL}?lobby=${LOBBY_ID}`);
    expect(e4?.url).toBe(`${URL}?lobby=${LOBBY_ID}#how-the-bot-decided`);
    expect(e1?.description?.split('\n')[0]).toContain(`(${URL}/mode?lobby=${LOBBY_ID})`);
    expect(
      fieldsOf(e1)
        .find((field) => field.name === 'Seats')
        ?.value.split('\n')
        .at(-1),
    ).toBe(SIDE_LINE_MANUAL);
    expect(escapesAreWhole(e1?.title ?? '')).toBe(true);
  });

  it('Game on, with your own teams: the longest title it leads, whole', () => {
    const side = (prefix: string) =>
      LANES.map((role, index) => ({ puuid: `${prefix}${index}`, name: ESCAPABLE_NAME, role, rating: 1400 }));
    const payload = gameOnEmbed({
      identity: IDENTITY,
      kind: 'custom',
      blue: side('b'),
      red: side('r'),
      blueWinProb: 0.5,
      mode: longestRule,
      modeUrl: `${URL}/mode`,
      url: URL,
      lobbyLabel: label,
    });
    expect(legal(payload.embeds)).toBe(true);
    expect(payload.embeds[0]?.title).toBe(`${LABEL}\u00a0· ${GAME_ON_CUSTOM_TITLE}`);
    expect(JSON.stringify(payload)).not.toContain(ELLIPSIS);
  });

  it('the result post: the title whole, nothing cut', () => {
    const payload = resultEmbed(
      game4Result({
        blue: LANES.map((role, index) => ({
          puuid: `b${index}`,
          name: ESCAPABLE_NAME,
          role,
          rating: 1400,
          delta: -41,
        })),
        red: LANES.map((role, index) => ({
          puuid: `r${index}`,
          name: ESCAPABLE_NAME,
          role,
          rating: 1400,
          delta: 41,
        })),
        award: { mvp: ESCAPABLE_NAME, ace: ESCAPABLE_NAME },
        topDamage: { name: ESCAPABLE_NAME, damage: 47_300 },
        lobbyLabel: label,
      }),
    );
    expect(legal(payload.embeds)).toBe(true);
    expect(payload.embeds[0]?.title).toBe(`${LABEL}\u00a0· Red wins · 31 min`);
    expect(payload.embeds[0]?.title?.length).toBeLessThan(TITLE_LIMIT);
    expect(JSON.stringify(payload)).not.toContain(ELLIPSIS);
  });
});

/**
 * The board's worst case has headroom, and this test is the proof rather than the assumption.
 *
 * Ten lines is the cap (`TOP_N`) and a rendered name is at most 64 characters, so the longest
 * board that can exist is ~870 characters. It is under the limit **and untouched** — no `…`, no
 * line lost — which is the property the nightly post depends on.
 */
describe('the board, ten long escaped names', () => {
  const entries: LeaderboardEntry[] = Array.from({ length: 10 }, (_, index) => ({
    puuid: `p-${index}`,
    name: ESCAPABLE_NAME,
    rating: 1548 - index,
    games: 41,
  }));

  it('fits ten of them with no cut at all', () => {
    const embed = leaderboardEmbed({
      identity: IDENTITY,
      windowLabel: WINDOW_LABELS['this-week'],
      track: 'week',
      entries,
    }).embeds[0];
    const value = embed?.fields?.[0]?.value ?? '';

    expect(value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(value.split('\n')).toHaveLength(10);
    expect(value).not.toContain(ELLIPSIS);
    expect(value.split('\n')[0]).toBe(`\`1\` **${RENDERED}** · 1548 · 41 games`);
    expect(escapesAreWhole(value)).toBe(true);
  });

  it('would keep the top rows if it ever did not fit', () => {
    const long = Array.from({ length: 10 }, (_, index) => `\`${index + 1}\` ${'x'.repeat(200)}`);
    const value = fieldValue(long);

    expect(value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(value.split('\n')[0]).toBe(long[0]);
    expect(value.split('\n').at(-1)).toBe(ELLIPSIS);
  });
});

describe('the awards field, a ten-way tie', () => {
  const tie = Array.from(
    { length: 10 },
    // Two escaped names a line, as a duo award prints them: ten of them are over 1,024 alone.
    (_, index) =>
      `${renderName(`${ESCAPABLE_NAME}`)} & Player${index} ${RENDERED.slice(0, 16)} · 6 games · 0W 6L`,
  ).join('\n');

  const awards: WindowAward[] = [
    { label: 'Best off-role', line: `${RENDERED} · 9W 3L · 75% · his main is top` },
    { label: 'Cursed duo', line: tie },
  ];

  const embed = windowSummaryEmbed({
    identity: IDENTITY,
    windowLabel: WINDOW_LABELS['last-week'],
    description: 'Sunday 6 Sep to Saturday 12 Sep · 14 games',
    track: 'week',
    entries: [{ puuid: 'p-1', name: 'Lena', rating: 1548, games: 41 }],
    awards,
  }).embeds[0];

  const value = fieldsOf(embed).find((field) => field.name === 'Cursed duo')?.value ?? '';

  it('is over the limit before the guard', () => {
    expect(tie.length).toBeGreaterThan(FIELD_VALUE_LIMIT);
  });

  it('keeps both awards, each under its own label, and each winner’s first line', () => {
    expect(value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(fieldsOf(embed).map((field) => field.name)).toEqual(['The board', 'Best off-role', 'Cursed duo']);
    // The tie's first name is the winner line; it stays at the top of its field.
    expect(value.split('\n')[0]).toBe(tie.split('\n')[0]);
  });

  it('loses the tie’s later names to one gap, on line boundaries', () => {
    expect(value).toContain(ELLIPSIS);
    expect(value.split('\n').filter((line) => line === ELLIPSIS)).toHaveLength(1);
    expect(value).not.toContain('Player9');
    expect(escapesAreWhole(value)).toBe(true);
  });
});

/**
 * `guardMessage` (M14.61, 05-design 10.12): Discord's 6,000 characters are per message, across
 * every embed. Identity below the limit; over it, the message gives way in 10.12's order, and
 * the never-cut lines survive. Tests at the limit, as M4.12's.
 */
describe('guardMessage, the limits across a message', () => {
  const base = (overrides: Partial<DraftEmbed> = {}): DraftEmbed => ({
    color: ACCENT_COLOR,
    title: 'Teams are set',
    fields: [{ name: 'Seats', value: SIDE_LINE_MANUAL }],
    ...overrides,
  });

  it('is the identity on a message that already fits, and on each part', () => {
    const embeds: Embed[] = [
      {
        color: ACCENT_COLOR,
        author: { name: 'Customs Night' },
        title: 'T',
        url: 'https://x.example',
        description: 'a\nb',
      },
      { color: BLUE_COLOR, title: 'B', description: 'c' },
    ];
    expect(guardMessage(embeds)).toEqual(embeds);
  });

  it('cuts the title at 256, the description at 4096, the footer at 2048 and the author at 256', () => {
    const [title] = guardMessage([base({ title: 'T'.repeat(400) })]);
    expect(title?.title).toHaveLength(TITLE_LIMIT);
    expect(guardMessage([base({ description: 'D'.repeat(5000) })])[0]?.description).toHaveLength(
      DESCRIPTION_LIMIT,
    );
    expect(guardMessage([base({ footer: { text: 'F'.repeat(3000) } })])[0]?.footer?.text).toHaveLength(
      FOOTER_LIMIT,
    );
    expect(guardMessage([base({ author: { name: 'A'.repeat(300) } })])[0]?.author?.name).toHaveLength(256);
  });

  it('keeps at most ten embeds', () => {
    expect(guardMessage(Array.from({ length: 12 }, () => base()))).toHaveLength(EMBEDS_LIMIT);
  });

  it('counts the author name and every embed toward 6,000', () => {
    const embeds: Embed[] = [
      { color: ACCENT_COLOR, author: { name: 'abc' }, title: 'de', description: 'f', footer: { text: 'gh' } },
      { color: RED_COLOR, fields: [{ name: 'ij', value: 'k' }] },
    ];
    expect(messageLength(embeds)).toBe(11);
  });

  describe('teams: E4 subtext, E4 reason, Seats moves, Sitting out', () => {
    /**
     * A teams post whose core sentence is `size` characters long. A 1,000-character lobby name and
     * four swaps take up the room E4's 4,096-character description cannot, so the message can
     * reach 6,000.
     */
    const swaps: SeatLine[] = Array.from({ length: 4 }, (_, index) => ({
      kind: 'swap',
      sitter: `${'a'.repeat(31)}${index}`,
      mover: `${'b'.repeat(31)}${index}`,
    }));
    const teams = (size: number) =>
      teamsEmbed(
        game4Teams({
          explanation: 'x'.repeat(size),
          lobby: { name: 'l'.repeat(1000), password: null },
          seats: swaps,
        }),
      );
    const room = TOTAL_LIMIT - messageLength(teams(0).embeds);

    it('is the identity at exactly 6,000', () => {
      const at = teams(room);
      expect(messageLength(at.embeds)).toBe(TOTAL_LIMIT);
      expect(at.embeds[3]?.description?.split('\n').at(-1)).toBe(explanationLine('x'.repeat(room)));
    });

    it('one over: core sentence goes first, and nothing else', () => {
      const over = teams(room + 1);
      const atLimit = teams(room);
      expect(messageLength(over.embeds)).toBeLessThanOrEqual(TOTAL_LIMIT);
      expect(over.embeds[3]?.description?.split('\n')).toEqual([
        ...(atLimit.embeds[3]?.description?.split('\n').slice(0, 2) ?? []),
        ELLIPSIS,
      ]);
      expect(over.embeds.slice(0, 3)).toEqual(atLimit.embeds.slice(0, 3));
    });

    it('then the reason, the moves and the sitters; never the header, the sides, the side line or Lobby', () => {
      const line = (text: string, shed?: number) => (shed === undefined ? text : { text, shed });
      // `extra` grows the two side embeds, which are never shed, so the rest has to give way.
      const drafts = (extra: number): DraftEmbed[] => [
        {
          color: ACCENT_COLOR,
          title: 'Teams are set',
          description: ['**Blue 49%** · **51% Red**', '🟦🟦🟦🟦🟦🟥🟥🟥🟥🟥', 'Basically a coin flip.'],
          fields: [
            { name: 'Sitting out', value: [line('S'.repeat(600), SHED.teamsSitOut)] },
            {
              name: 'Seats',
              value: [
                line('M'.repeat(300), SHED.teamsMoves),
                line('N'.repeat(200), SHED.teamsMoves),
                SIDE_LINE_MANUAL,
              ],
            },
            { name: 'Lobby', value: ['`customs-night`'] },
          ],
        },
        { color: BLUE_COLOR, title: 'B', description: ['b'.repeat(500 + Math.ceil(extra / 2))] },
        { color: RED_COLOR, title: 'R', description: ['r'.repeat(500 + Math.floor(extra / 2))] },
        {
          color: ACCENT_COLOR,
          title: 'How the bot decided',
          description: [
            'chips',
            line('R'.repeat(1000), SHED.teamsReason),
            line('X'.repeat(1000), SHED.teamsSubtext),
          ],
        },
      ];
      const room = TOTAL_LIMIT - messageLength(guardMessage(drafts(0)));
      const survivors = (extra: number): string[] => {
        const embeds = guardMessage(drafts(extra));
        expect(messageLength(embeds)).toBeLessThanOrEqual(TOTAL_LIMIT);
        // The never-cut lines, every time.
        expect(embeds[0]?.description).toBe(
          '**Blue 49%** · **51% Red**\n🟦🟦🟦🟦🟦🟥🟥🟥🟥🟥\nBasically a coin flip.',
        );
        expect(
          embeds[0]?.fields
            ?.find((field) => field.name === 'Seats')
            ?.value.split('\n')
            .at(-1),
        ).toBe(SIDE_LINE_MANUAL);
        expect(embeds[0]?.fields?.find((field) => field.name === 'Lobby')?.value).toBe('`customs-night`');
        expect(embeds[1]?.description).toBe('b'.repeat(500 + Math.ceil(extra / 2)));
        expect(embeds[3]?.description?.split('\n')[0]).toBe('chips');
        const text = JSON.stringify(embeds);
        return ['XXX', 'RRR', 'NNN', 'MMM', 'SSS'].filter((mark) => text.includes(mark));
      };

      expect(survivors(room)).toEqual(['XXX', 'RRR', 'NNN', 'MMM', 'SSS']);
      expect(survivors(room + 500)).toEqual(['RRR', 'NNN', 'MMM', 'SSS']);
      expect(survivors(room + 1500)).toEqual(['NNN', 'MMM', 'SSS']);
      expect(survivors(room + 2150)).toEqual(['MMM', 'SSS']);
      expect(survivors(room + 2450)).toEqual(['SSS']);
      expect(survivors(room + 2900)).toEqual([]);
      expect(guardMessage(drafts(room + 1500))[3]?.description).toBe(`chips\n${ELLIPSIS}`);
      expect(guardMessage(drafts(room + 2150))[0]?.fields?.[1]?.value.split('\n')).toEqual([
        'M'.repeat(300),
        ELLIPSIS,
        SIDE_LINE_MANUAL,
      ]);
    });

    it('a field that loses every line goes: Sitting out, last of all', () => {
      const embeds = guardMessage([
        {
          color: ACCENT_COLOR,
          title: 'Teams are set',
          fields: [
            { name: 'Sitting out', value: [{ text: 'S'.repeat(1000), shed: SHED.teamsSitOut }] },
            { name: 'Seats', value: [{ text: 'M'.repeat(1000), shed: SHED.teamsMoves }, SIDE_LINE_MANUAL] },
          ],
        },
        { color: BLUE_COLOR, title: 'B', description: 'b'.repeat(4000) },
        { color: RED_COLOR, title: 'R', description: 'r'.repeat(1000) },
      ]);
      expect(messageLength(embeds)).toBeLessThanOrEqual(TOTAL_LIMIT);
      expect(embeds[0]?.fields?.map((field) => field.name)).toEqual(['Seats']);
      expect(embeds[0]?.fields?.[0]?.value).toBe(`${ELLIPSIS}\n${SIDE_LINE_MANUAL}`);
      expect(embeds[1]?.description).toBe('b'.repeat(4000));
    });
  });

  describe('result: the AI recap whole, the award line, the top damage', () => {
    it('a recap that would take the message over is dropped whole; the post stays as posted', () => {
      const posted = resultEmbed(game4Result());
      // Two never-shed filler embeds bring the post to exactly 1,000 + the label short of 6,000.
      const filler = TOTAL_LIMIT - 1000 - 'AI recap'.length - messageLength(posted.embeds);
      const full = {
        ...posted,
        embeds: [
          ...posted.embeds,
          { color: BLUE_COLOR, description: 'z'.repeat(Math.ceil(filler / 2)) },
          { color: RED_COLOR, description: 'z'.repeat(Math.floor(filler / 2)) },
        ],
      };
      const fits = recapPayload(full, 'y'.repeat(1000));
      expect(messageLength(fits.embeds)).toBe(TOTAL_LIMIT);
      expect(fits.embeds.at(-1)?.color).toBe(SLATE_COLOR);

      const over = recapPayload(full, 'y'.repeat(1001));
      expect(over.embeds.map((embed) => embed.color)).not.toContain(SLATE_COLOR);
      expect(over.embeds).toEqual(full.embeds);
    });

    it('then the award line, then the top damage; the title, odds, rule check, not rated and both sides stay', () => {
      const header = (extra: number): DraftEmbed[] => [
        {
          color: RED_COLOR,
          title: 'Red wins · 31 min',
          description: [
            'Red was 51%. Red won.',
            "Tanks only: Blue kept the rule. Red: Jinx isn't a tank.",
            'Not rated, so no Rating change.',
            { text: `Top damage: ${'d'.repeat(800)}`, shed: SHED.topDamage },
            { text: `**MVP** ${'m'.repeat(800)}`, shed: SHED.award },
          ],
        },
        { color: BLUE_COLOR, title: 'B', description: 'b'.repeat(2000) },
        { color: RED_COLOR, title: 'R', description: 'r'.repeat(2000 + extra) },
      ];
      const fits = (extra: number) => messageLength(guardMessage(header(extra)));
      const room = TOTAL_LIMIT - fits(0);
      expect(guardMessage(header(room))[0]?.description).toContain('**MVP**');

      const award = guardMessage(header(room + 1))[0]?.description?.split('\n') ?? [];
      expect(award.at(-1)).toBe(ELLIPSIS);
      expect(award.some((line) => line.startsWith('Top damage'))).toBe(true);
      expect(award.some((line) => line.startsWith('**MVP**'))).toBe(false);

      const damage = guardMessage(header(room + 900));
      expect(damage[0]?.description?.split('\n')).toEqual([
        'Red was 51%. Red won.',
        "Tanks only: Blue kept the rule. Red: Jinx isn't a tank.",
        'Not rated, so no Rating change.',
        ELLIPSIS,
      ]);
      expect(damage[2]?.description).toBe('r'.repeat(2000 + room + 900));
    });
  });

  describe("weekly: the storyline whole, a tie's later names, board rows from the bottom", () => {
    it('then the tie, then rows from the bottom; title, slot line and row 1 stay', () => {
      const rows = Array.from({ length: 10 }, (_, index) => {
        const text = `\`${index + 1}\` ${'p'.repeat(90)}`;
        return index === 0 ? text : { text, shed: SHED.boardRows };
      });
      const drafts = (filler: number): DraftEmbed[] => [
        { color: SLATE_COLOR, title: 'AI recap', description: 's'.repeat(1500), shed: SHED.storyline },
        {
          color: ACCENT_COLOR,
          title: 'Last week · board',
          description: 'Sunday 27 Sep to Saturday 3 Oct · 14 rated games',
          fields: [
            { name: 'Top ten', value: rows },
            {
              name: 'Cursed duo',
              value: [
                { text: 'A and B · 1W 5L · 17%', keep: KEEP_LAST_STANDING },
                { text: `C and ${'D'.repeat(400)}`, shed: SHED.tieNames },
              ],
            },
          ],
        },
        { color: BLUE_COLOR, description: 'f'.repeat(1000 + Math.ceil(filler / 2)) },
        { color: RED_COLOR, description: 'f'.repeat(1000 + Math.floor(filler / 2)) },
      ];
      const room = TOTAL_LIMIT - messageLength(guardMessage(drafts(0)));

      expect(guardMessage(drafts(room))).toHaveLength(4);
      const noStory = guardMessage(drafts(room + 1));
      expect(noStory).toHaveLength(3);
      expect(noStory[0]?.fields?.[1]?.value).toContain('DDD');

      const noTie = guardMessage(drafts(room + 1600));
      expect(noTie[0]?.fields?.[1]?.value).toBe(`A and B · 1W 5L · 17%\n${ELLIPSIS}`);
      expect(noTie[0]?.fields?.[0]?.value.split('\n')).toHaveLength(10);

      const rowsGone = guardMessage(drafts(room + 2200));
      const board = rowsGone[0]?.fields?.[0]?.value.split('\n') ?? [];
      expect(board[0]).toBe(`\`1\` ${'p'.repeat(90)}`);
      expect(board.at(-1)).toBe(ELLIPSIS);
      expect(board.length).toBeLessThan(10);
      expect(rowsGone[0]?.description).toBe('Sunday 27 Sep to Saturday 3 Oct · 14 rated games');
      expect(messageLength(rowsGone)).toBeLessThanOrEqual(TOTAL_LIMIT);
    });
  });

  it('the last resort: fields from the last embed back, then descriptions, never over 6,000', () => {
    const embeds = guardMessage([
      {
        color: ACCENT_COLOR,
        title: 'T'.repeat(256),
        description: 'D'.repeat(4096),
        footer: { text: 'F'.repeat(2000) },
      },
      { color: BLUE_COLOR, fields: [{ name: 'Seats', value: 'v'.repeat(500) }] },
    ]);
    expect(messageLength(embeds)).toBeLessThanOrEqual(TOTAL_LIMIT);
    expect(embeds[1]?.fields?.[0]?.value).toBe(ELLIPSIS);
    expect(embeds[0]?.description?.endsWith(ELLIPSIS)).toBe(true);
  });
});
