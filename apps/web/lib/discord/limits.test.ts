import type { Role } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { WINDOW_LABELS } from '../board/copy';
import {
  ACCENT_COLOR,
  type Embed,
  type LeaderboardEntry,
  leaderboardEmbed,
  type ResultPlayer,
  renderName,
  resultEmbed,
  type SeatLine,
  SIDE_LINE_MANUAL,
  type TeamsEmbedInput,
  type TeamsPlayer,
  teamsEmbed,
  type WindowAward,
  windowSummaryEmbed,
} from './embeds';
import {
  cutText,
  DESCRIPTION_LIMIT,
  ELLIPSIS,
  FIELD_VALUE_LIMIT,
  FOOTER_LIMIT,
  fieldValue,
  guardEmbed,
  KEEP_LAST_STANDING,
  TITLE_LIMIT,
  TOTAL_LIMIT,
} from './limits';

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

const TIMESTAMP = '2026-09-08T20:15:00.000Z';

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
    blue: teamOf('blue', ESCAPABLE_NAME),
    red: teamOf('red', ESCAPABLE_NAME),
    explanation: 'Blue favored 54%. Everyone on a main role. Gap 100.',
    sitOut: null,
    seats,
    switchSideEnabled: false,
    lobby: { name: 'customs-night', password: '4471' },
    timestamp: TIMESTAMP,
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

function embedLength(embed: Embed): number {
  return (
    embed.title.length +
    (embed.description?.length ?? 0) +
    embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0) +
    embed.footer.text.length
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
  const embed = teamsEmbed(pathologicalTeamsInput()).embeds[0];
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
    expect(embedLength(embed as Embed)).toBeLessThanOrEqual(TOTAL_LIMIT);
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
  it('fits both columns', () => {
    const player = (side: string, role: Role, index: number): ResultPlayer => ({
      puuid: `${side}-${index}`,
      name: ESCAPABLE_NAME,
      role,
      rating: 1400,
      delta: -41,
    });
    const embed = resultEmbed({
      winningSide: 200,
      durationS: 2052,
      blue: LANES.map((role, index) => player('blue', role, index)),
      red: LANES.map((role, index) => player('red', role, index)),
      blueWinProb: 0.54,
      topDamage: { name: ESCAPABLE_NAME, damage: 47_300 },
      // Two more escapable names on the lowest-priority line of the post (M7.10).
      award: { mvp: ESCAPABLE_NAME, ace: ESCAPABLE_NAME },
      gameNumber: 47,
      timestamp: TIMESTAMP,
    }).embeds[0];

    for (const field of fieldsOf(embed)) expect(field.value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(escapesAreWhole(embed?.description ?? '')).toBe(true);
    // The award field is last, so `guardEmbed` takes from it first if the post ever runs over
    // 6000 — and with ten markdown names it has not: the line is whole and unescaped-through.
    expect(escapesAreWhole(fieldsOf(embed)[2]?.value ?? '')).toBe(true);
    expect(fieldsOf(embed)[2]?.value).toBe(`MVP ${RENDERED} · ACE ${RENDERED}`);
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
    score: 1548 - index,
    games: 41,
  }));

  it('fits ten of them with no cut at all', () => {
    const embed = leaderboardEmbed({
      windowLabel: WINDOW_LABELS['this-week'],
      track: 'weekly',
      entries,
      timestamp: TIMESTAMP,
    }).embeds[0];
    const value = embed?.fields[0]?.value ?? '';

    expect(value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(value.split('\n')).toHaveLength(10);
    expect(value).not.toContain(ELLIPSIS);
    expect(value.split('\n')[0]).toBe(`\`1\` ${RENDERED} · 1548 · 41 games`);
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
    (_, index) => `${renderName(`${ESCAPABLE_NAME}`)} & Player${index} · 6 games · 0W 6L`,
  ).join('\n');

  const awards: WindowAward[] = [
    { label: 'Most improved', line: `${RENDERED} · +212 · 1266 → 1478` },
    { label: 'Best off-role', line: `${RENDERED} · 9W 3L · 75% · his main is top` },
    { label: 'Cursed duo', line: tie },
  ];

  const embed = windowSummaryEmbed({
    windowLabel: WINDOW_LABELS['last-week'],
    description: 'Sunday 6 Sep to Saturday 12 Sep · 14 games',
    track: 'weekly',
    entries: [{ puuid: 'p-1', name: 'Lena', score: 1548, games: 41 }],
    awards,
    timestamp: TIMESTAMP,
  }).embeds[0];

  const value = fieldsOf(embed).find((field) => field.name === 'Awards')?.value ?? '';

  it('is over the limit before the guard', () => {
    expect(awards.map((award) => `**${award.label}** ${award.line}`).join('\n').length).toBeGreaterThan(
      FIELD_VALUE_LIMIT,
    );
  });

  it('keeps all three labels and each winner’s first line', () => {
    expect(value.length).toBeLessThanOrEqual(FIELD_VALUE_LIMIT);
    expect(value).toContain('**Most improved**');
    expect(value).toContain('**Best off-role**');
    expect(value).toContain('**Cursed duo**');
    // The tie's first name is the winner line; it stays with its bold label.
    expect(value).toContain(`**Cursed duo** ${renderName(ESCAPABLE_NAME)} & Player0 · 6 games · 0W 6L`);
  });

  it('loses the tie’s later names to one gap, on line boundaries', () => {
    expect(value).toContain(ELLIPSIS);
    expect(value.split('\n').filter((line) => line === ELLIPSIS)).toHaveLength(1);
    expect(value).not.toContain('Player9');
    expect(escapesAreWhole(value)).toBe(true);
  });
});

describe('guardEmbed, the limits the builders cannot see', () => {
  function embedOf(overrides: Partial<Embed> = {}): Embed {
    return {
      color: ACCENT_COLOR,
      title: 'Teams are set',
      fields: [{ name: 'Seats', value: SIDE_LINE_MANUAL }],
      footer: { text: 'Kustom' },
      timestamp: TIMESTAMP,
      ...overrides,
    };
  }

  it('is the identity on an embed that already fits', () => {
    const embed = embedOf({ description: 'Blue favored 54%.', url: 'https://customs.example' });
    expect(guardEmbed(embed)).toEqual(embed);
  });

  it('cuts the title at 256, the description at 4096 and the footer at 2048', () => {
    // One at a time, because all three at once is over the 6000 total and that is the next test.
    const title = guardEmbed(embedOf({ title: 'T'.repeat(400) })).title;
    expect(title).toHaveLength(TITLE_LIMIT);
    expect(title.endsWith(ELLIPSIS)).toBe(true);

    expect(guardEmbed(embedOf({ description: 'D'.repeat(5000) })).description).toHaveLength(
      DESCRIPTION_LIMIT,
    );
    expect(guardEmbed(embedOf({ footer: { text: 'F'.repeat(3000) } })).footer.text).toHaveLength(
      FOOTER_LIMIT,
    );
  });

  /**
   * **The description gives way first** when the total is over: it is prose, and the fields are
   * the message. Five full fields plus a 4096-character explanation is 9000-odd characters.
   */
  it('cuts the description first when the total is over 6000', () => {
    const fields = ['Sitting out', 'Seats', 'Blue', 'Red', 'Lobby'].map((name) => ({
      name,
      value: 'v'.repeat(1000),
    }));
    const guarded = guardEmbed(embedOf({ description: 'D'.repeat(4000), fields }));

    expect(embedLength(guarded)).toBeLessThanOrEqual(TOTAL_LIMIT);
    for (const [index, field] of guarded.fields.entries()) {
      expect(field.value).toBe(fields[index]?.value);
    }
    expect(guarded.description?.endsWith(ELLIPSIS)).toBe(true);
  });

  /** And only then the fields, from the last one backwards, still on line boundaries. */
  it('takes from the last fields when the description is not enough', () => {
    const fields = Array.from({ length: 8 }, (_, index) => ({
      name: `f${index}`,
      value: Array.from({ length: 10 }, (_, line) => `${index}-${line}`.padEnd(100, '.')).join('\n'),
    }));
    const guarded = guardEmbed(embedOf({ description: 'D'.repeat(100), fields }));

    expect(embedLength(guarded)).toBeLessThanOrEqual(TOTAL_LIMIT);
    // The first field is whole, the last one is not, and none of them is empty.
    expect(guarded.fields[0]?.value).toBe(fields[0]?.value);
    expect(guarded.fields.at(-1)?.value).toContain(ELLIPSIS);
    for (const field of guarded.fields) expect(field.value.length).toBeGreaterThan(0);
  });
});
