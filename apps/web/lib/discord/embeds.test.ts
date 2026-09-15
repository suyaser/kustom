import { displayRating, type Rating, rateGame } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { WINDOW_LABELS } from '../board/copy';
import { SWITCH_SIDE_ENABLED } from '../commands/gate';
import { displayDelta } from '../ratingDisplay';
import { workedBoardRows } from '../testing/boardFixtures';
import { WORKED_ROSTER, workedBalance, workedNames, workedPool, workedPuuid } from '../testing/workedExample';
import { buildTeamsInput } from './assemble';
import {
  ACCENT_COLOR,
  BLUE_COLOR,
  formatDamage,
  formatDelta,
  formatDuration,
  joinNames,
  type LeaderboardEmbedInput,
  leaderboardEmbed,
  RED_COLOR,
  type ResultEmbedInput,
  type ResultPlayer,
  renderName,
  resultEmbed,
  SIDE_LINE_AUTO,
  SIDE_LINE_MANUAL,
  sideLine,
  type TeamsEmbedInput,
  teamsEmbed,
  teamsTitle,
  type WindowSummaryEmbedInput,
  windowSummaryEmbed,
} from './embeds';

/**
 * The two embeds against the worked example (`docs/00-product.md`), which is also the layout
 * in `docs/05-design.md`, "Discord embeds".
 *
 * Nothing here is hand-computed: the split and the explanation come from `balance()`, the
 * display ratings from `displayRating`, and the result deltas from `rateGame`. The design
 * doc's result example was written by hand from the Plackett-Luce reduction and warns that it
 * is illustrative; these numbers are the package's.
 */

const TIMESTAMP = '2026-09-08T20:15:00.000Z';
const SITE_URL = 'https://customs.example';

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
    },
    workedNames(),
    { url: SITE_URL, timestamp: TIMESTAMP },
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

  it('is the accent bar, not either side: a tinted teams embed reads as a prediction', () => {
    expect(embed?.color).toBe(ACCENT_COLOR);
    expect(embed?.title).toBe('Teams are set');
    expect(embed?.footer.text).toBe('Kustom · more on the tonight page');
    expect(embed?.timestamp).toBe(TIMESTAMP);
  });

  it('posts the stored explanation verbatim as the description', () => {
    expect(embed?.description).toBe(
      'Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
    );
  });

  // The two side fields, by name: since M4.3's side line the first field is `Seats`.
  const sideField = (side: 'Blue' | 'Red') => embed?.fields.find((field) => field.name.startsWith(side));

  it('names the two side fields with the sum of five display ratings', () => {
    expect(sideField('Blue')?.name).toBe('Blue · 7695');
    expect(sideField('Red')?.name).toBe('Red · 7595');
    expect(sideField('Blue')?.inline).toBe(true);
    expect(sideField('Red')?.inline).toBe(true);
  });

  it('prints five lines a side, in lane order, role in inline code', () => {
    expect(sideField('Blue')?.value.split('\n')).toEqual([
      '`top` Hana · 1434',
      '`jungle` Iris · 1578',
      '`mid` Karim · 1551',
      '`adc` Bilal · 1713',
      '`support` Theo · 1419',
    ]);
    expect(sideField('Red')?.value.split('\n')).toEqual([
      '`top` Omar · 1469',
      '`jungle` Rami · 1638',
      '`mid` Nadia · 1266',
      '`adc` Lena · 2088',
      '`support` Yuki · 1134',
    ]);
  });

  it('carries the lobby name and password so a straggler can still get in', () => {
    const lobby = embed?.fields.find((field) => field.name === 'Lobby');
    expect(lobby?.value).toBe('`customs-night` · password `4471`');
  });

  it('has no sit-out field on a ten-player night, and a Seats field carrying the side line alone', () => {
    expect(embed?.fields.map((field) => field.name)).toEqual(['Seats', 'Blue · 7695', 'Red · 7595', 'Lobby']);
    expect(embed?.fields.find((field) => field.name === 'Seats')?.value).toBe(
      'Move to your side in the lobby.',
    );
  });

  it('links the tonight page, and posts no url at all when there is none', () => {
    expect(embed?.url).toBe(SITE_URL);
    expect(teamsEmbed(workedTeamsInput({ url: undefined })).embeds[0]).not.toHaveProperty('url');
  });

  it('stops promising a tonight page when the title is not a link', () => {
    // A localhost origin is dropped by `tonightPageUrl`, and a footer that says "more on the
    // tonight page" over an unlinked title tells a friend to tap something that is not there.
    expect(teamsEmbed(workedTeamsInput({ url: undefined })).embeds[0]?.footer.text).toBe('Kustom');
  });
});

describe('teamsEmbed, the fields that only sometimes exist', () => {
  it('drops the password half when the client reported no password (every lobby before M4.1)', () => {
    const embed = teamsEmbed(workedTeamsInput({ lobby: { name: 'customs-night', password: null } }))
      .embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Lobby')?.value).toBe('`customs-night`');
  });

  it('has no Lobby field at all when neither is known: never empty, never "unknown"', () => {
    const embed = teamsEmbed(workedTeamsInput({ lobby: { name: null, password: null } })).embeds[0];
    expect(embed?.fields.some((field) => field.name === 'Lobby')).toBe(false);
  });

  it('prints M2.15 sit-out copy verbatim, with the most-games reason', () => {
    const embed = teamsEmbed(workedTeamsInput({ sitOut: { names: ['Omar', 'Sara'], reason: 'most-games' } }))
      .embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Sitting out')?.value).toBe(
      'Sitting out: Omar and Sara — most games tonight.',
    );
  });

  it('switches the reason clause when everybody has played the same number tonight', () => {
    const embed = teamsEmbed(workedTeamsInput({ sitOut: { names: ['Omar'], reason: 'longest-since' } }))
      .embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Sitting out')?.value).toBe(
      'Sitting out: Omar — longest since they last sat out.',
    );
  });

  it('says nobody had sat out before on the first balance of a night (M3.12)', () => {
    const embed = teamsEmbed(workedTeamsInput({ sitOut: { names: ['Player0'], reason: 'first-sit-out' } }))
      .embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Sitting out')?.value).toBe(
      'Sitting out: Player0 — nobody has sat out before, so somebody had to be first.',
    );
  });

  it('prints one Seats line per move, swap and open slot', () => {
    const embed = teamsEmbed(
      workedTeamsInput({
        // Named, like the worked example above: this case is about the move lines, so it must
        // not move the day `SWITCH_SIDE_ENABLED` flips.
        switchSideEnabled: false,
        sitOut: { names: ['Omar'], reason: 'most-games' },
        seats: [
          { kind: 'swap', sitter: 'Omar', mover: 'Nadia' },
          { kind: 'open-slot', mover: 'Yuki' },
        ],
      }),
    ).embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Seats')?.value.split('\n')).toEqual([
      'Swap: Omar out, Nadia in.',
      'Yuki is playing — take the open slot.',
      'Move to your side in the lobby.',
    ]);
  });

  it('puts the rotation above the teams: Sitting out, Seats, Blue, Red, Lobby', () => {
    // `05-design.md`, revised 2026-09-09: the line that has to happen before anybody can play
    // goes above the fold, and Blue/Red stay next to each other so Discord still pairs them.
    const embed = teamsEmbed(
      workedTeamsInput({
        sitOut: { names: ['Omar'], reason: 'most-games' },
        seats: [{ kind: 'swap', sitter: 'Omar', mover: 'Nadia' }],
      }),
    ).embeds[0];
    expect(embed?.fields.map((field) => field.name)).toEqual([
      'Sitting out',
      'Seats',
      'Blue · 7695',
      'Red · 7595',
      'Lobby',
    ]);
    // Consecutive, and both inline: that is what makes them two columns rather than two rows.
    expect(embed?.fields.slice(2, 4).map((field) => field.inline)).toEqual([true, true]);
  });

  it('marks an off-role line, so the fact survives being read on its own', () => {
    const base = workedTeamsInput();
    const blue = base.blue.map((player, index) => (index === 0 ? { ...player, offRole: true } : player));
    const embed = teamsEmbed({ ...base, blue }).embeds[0];
    expect(blueLines(embed)[0]).toBe('`top` Hana · 1434 · off-role');
  });

  it('renders a player the database has no name for as Someone', () => {
    const base = workedTeamsInput();
    const blue = base.blue.map((player, index) => (index === 0 ? { ...player, name: null } : player));
    const embed = teamsEmbed({ ...base, blue }).embeds[0];
    expect(blueLines(embed)[0]).toBe('`top` Someone · 1434');
  });
});

/** The blue column's five lines, found by name: `Seats` is field 0 since M4.3's side line. */
function blueLines(embed: { fields: { name: string; value: string }[] } | undefined): string[] {
  return embed?.fields.find((field) => field.name.startsWith('Blue'))?.value.split('\n') ?? [];
}

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
    expect(embed?.fields.find((field) => field.name === 'Seats')?.value.split('\n')).toEqual([
      'Swap: Omar out, Nadia in.',
      'Move to your side in the lobby.',
    ]);
  });

  it('tells people to move themselves while the switch-side gate is off', () => {
    const embed = teamsEmbed(workedTeamsInput({ switchSideEnabled: false })).embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Seats')?.value).toBe(SIDE_LINE_MANUAL);
  });

  it('says the companion moves you once the gate is on, and still ends with move yourself', () => {
    // M4.3 acceptance check 8. A companion that is closed, offline or facing a full side moves
    // nobody, and the embed is written before any of them has polled.
    const embed = teamsEmbed(workedTeamsInput({ switchSideEnabled: true })).embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Seats')?.value).toBe(SIDE_LINE_AUTO);
  });

  it('carries the line once, never per-person and never both sentences', () => {
    for (const enabled of [false, true]) {
      const embed = teamsEmbed(
        workedTeamsInput({
          switchSideEnabled: enabled,
          sitOut: { names: ['Omar'], reason: 'most-games' },
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
    expect({ ...on, fields: on?.fields.filter((field) => field.name !== 'Seats') }).toEqual({
      ...off,
      fields: off?.fields.filter((field) => field.name !== 'Seats'),
    });
  });

  it('takes the sentence from the server gate when nothing overrides it', () => {
    // `buildTeamsInput` reads `SWITCH_SIDE_ENABLED` at post time, so the message and the queue
    // can never disagree: the flag that decides whether a `switch_side` row is written is the
    // flag that decides which sentence is posted.
    const embed = teamsEmbed(workedTeamsInput()).embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Seats')?.value).toBe(sideLine(SWITCH_SIDE_ENABLED));
  });
});

/**
 * Red wins the worked example — the underdog at 46%, the case `05-design.md` illustrates.
 * The deltas are `rateGame`'s, not the design doc's hand arithmetic.
 */
function workedResultInput(overrides: Partial<ResultEmbedInput> = {}): ResultEmbedInput {
  const split = workedBalance().splits[0];
  if (split === undefined) throw new Error('no split');

  const before = new Map<string, Rating>(
    WORKED_ROSTER.map((player) => [workedPuuid(player.name), { mu: player.mu, sigma: player.sigma }]),
  );
  const rating = (puuid: string): Rating => {
    const value = before.get(puuid);
    if (value === undefined) throw new Error(`no rating for ${puuid}`);
    return value;
  };

  const rated = rateGame(
    split.blue.map((assignment) => rating(assignment.puuid)),
    split.red.map((assignment) => rating(assignment.puuid)),
    200,
  );

  const nameOf = new Map(WORKED_ROSTER.map((player) => [workedPuuid(player.name), player.name]));
  const side = (
    assignments: readonly { puuid: string; role: ResultPlayer['role'] }[],
    after: readonly Rating[],
  ): ResultPlayer[] =>
    assignments.map((assignment, index) => {
      const muAfter = after[index]?.mu;
      if (muAfter === undefined) throw new Error('rateGame returned fewer ratings than players');
      return {
        puuid: assignment.puuid,
        name: nameOf.get(assignment.puuid) ?? null,
        role: assignment.role,
        rating: displayRating(muAfter),
        delta: displayDelta(rating(assignment.puuid).mu, muAfter),
      };
    });

  return {
    winningSide: 200,
    // Invented, like the design doc's: the docs pin no result for the worked example.
    durationS: 2_052,
    blue: side(split.blue, rated.blue),
    red: side(split.red, rated.red),
    blueWinProb: split.blueWinProb,
    topDamage: { name: 'Lena', damage: 47_300 },
    gameNumber: 47,
    url: SITE_URL,
    timestamp: '2026-09-08T21:09:12.000Z',
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

  it('wears the winning side colour, and blue keeps the first column', () => {
    expect(embed?.color).toBe(RED_COLOR);
    expect(embed?.title).toBe('Red wins · 34:12');
    expect(embed?.fields.map((field) => field.name)).toEqual(['Blue', 'Red']);
    expect(resultEmbed(workedResultInput({ winningSide: 100 })).embeds[0]?.color).toBe(BLUE_COLOR);
    expect(resultEmbed(workedResultInput({ winningSide: 100 })).embeds[0]?.fields[0]?.name).toBe('Blue');
  });

  it('says who was favoured and who did the damage', () => {
    expect(embed?.description).toBe('Blue was favored 54%. Top damage: Lena, 47.3k.');
  });

  it('prints new rating and signed delta, one line per player', () => {
    expect(embed?.fields[0]?.value.split('\n')).toMatchSnapshot('blue lines');
    expect(embed?.fields[1]?.value.split('\n')).toMatchSnapshot('red lines');
  });

  it('adds up: every line is displayRating(muAfter) and its delta from displayRating(muBefore)', () => {
    const before = new Map(WORKED_ROSTER.map((player) => [player.name, displayRating(player.mu)]));
    for (const player of [...input.blue, ...input.red]) {
      const was = before.get(player.name ?? '');
      if (was === undefined) throw new Error(`no before rating for ${player.name}`);
      expect(player.rating - player.delta).toBe(was);
    }
  });

  it('never prints a team total of deltas', () => {
    // -223 and +223 on this roster: with real `rateGame` output the two sides happen to
    // cancel, which the design doc's hand-computed example (-228 / +231) did not. Either way
    // the total is not printed — movement scales with each player's own sigma, so the sides
    // are not guaranteed to cancel, and a visible imbalance is a free argument (M3.3).
    const blue = input.blue.reduce((total, player) => total + player.delta, 0);
    const red = input.red.reduce((total, player) => total + player.delta, 0);
    expect([blue, red]).toEqual([-223, 223]);
    for (const field of embed?.fields ?? []) {
      expect(field.name).not.toContain(String(blue));
      expect(field.name).not.toContain(String(red));
    }
  });

  /**
   * **The product's name and the group's game number** (M5.12, product 2026-09-10). It read
   * `Season 1 · game 47` until seasons left the friend-facing vocabulary — on the deployment
   * that exists it would have said `gamesd · game 47` — and the count is unchanged: every game
   * this group has played up to this one.
   */
  it("footers the product and this game in the group's history", () => {
    expect(embed?.footer.text).toBe('Kustom · game 47');
    expect(embed?.footer.text.toLowerCase()).not.toContain('season');
  });

  it('prints the name alone when the count could not be taken, never `game ?`', () => {
    const uncounted = resultEmbed(workedResultInput({ gameNumber: null })).embeds[0];

    expect(uncounted?.footer.text).toBe('Kustom');
    expect(uncounted?.footer.text).not.toContain('game');
  });

  it('drops the clauses it has nothing to say for', () => {
    const bare = resultEmbed(workedResultInput({ blueWinProb: null, topDamage: null })).embeds[0];
    expect(bare).not.toHaveProperty('description');
  });

  it('names neither side for the coin flip, and drops the number with it (M3.11)', () => {
    // `Even 50%.` is core's present-tense fragment and stays core's; under `Red wins · 34:12`
    // it reads as a scoreline. 50 is what "neither" means, so the percent goes too.
    const embedded = resultEmbed(workedResultInput({ blueWinProb: 0.5 })).embeds[0];
    expect(embedded?.description).toBe('Neither side was favored. Top damage: Lena, 47.3k.');
    expect(embedded?.description).not.toContain('50%');
  });

  it('reads the underdog win the other way round when red was favoured', () => {
    const embedded = resultEmbed(workedResultInput({ blueWinProb: 0.42, topDamage: null })).embeds[0];
    expect(embedded?.description).toBe('Red was favored 58%.');
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

  it('titles the embed, and changes nothing else about it', () => {
    const plain = teamsEmbed(workedTeamsInput()).embeds[0];
    const rerolled = teamsEmbed(workedTeamsInput({ promoted: { rank: 2, splitCount: 3 } })).embeds[0];
    expect(rerolled?.title).toBe('Teams are set · reroll 1 of 2');
    expect({ ...rerolled, title: 'Teams are set' }).toEqual(plain);
  });
});

describe('the small formatters', () => {
  it('formats a duration as mm:ss, and hh:mm:ss past the hour', () => {
    expect(formatDuration(2_052)).toBe('34:12');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(3_723)).toBe('1:02:03');
    expect(formatDuration(0)).toBe('0:00');
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
      sitOut: { names: ['Dark_Wolf'], reason: 'most-games' },
      seats: [{ kind: 'swap', sitter: 'Dark_Wolf', mover: 'a`b' }],
    });
    const blue = base.blue.map((player, index) => (index === 0 ? { ...player, name: 'a`b' } : player));
    const embed = teamsEmbed({ ...base, blue }).embeds[0];

    expect(embed?.fields.find((field) => field.name === 'Sitting out')?.value).toBe(
      'Sitting out: Dark\\_Wolf — most games tonight.',
    );
    expect(embed?.fields.find((field) => field.name === 'Seats')?.value).toBe(
      'Swap: Dark\\_Wolf out, a\\`b in.\nMove to your side in the lobby.',
    );
    expect(embed?.fields.find((field) => field.name.startsWith('Blue'))?.value.split('\n')[0]).toBe(
      '`top` a\\`b · 1434',
    );
  });
});

/**
 * The nightly board (M3.5), against the same ten and the same numbers as `05-design.md`'s
 * worked example: Lena `1548` down to Yuki `534`, with the design doc's illustrative game
 * counts. The snapshot is the JSON a scheduler puts in the channel once a night.
 */
function workedLeaderboardInput(overrides: Partial<LeaderboardEmbedInput> = {}): LeaderboardEmbedInput {
  return {
    // The **window's** name, never a season's (M5.12): the title, the board heading and the
    // picker's option are the same three words.
    windowLabel: WINDOW_LABELS['this-week'],
    entries: workedBoardRows().map((row) => ({
      puuid: row.puuid,
      name: row.name,
      proven: row.proven,
      games: row.games,
    })),
    url: `${SITE_URL}/leaderboard?window=this-week`,
    timestamp: TIMESTAMP,
    ...overrides,
  };
}

describe('leaderboardEmbed, the worked example', () => {
  it("is the design doc's nightly post", () => {
    expect(leaderboardEmbed(workedLeaderboardInput())).toMatchSnapshot();
  });

  it('prints Proven, in Proven order, and no second number', () => {
    const embed = leaderboardEmbed(workedLeaderboardInput()).embeds[0];

    expect(embed?.fields).toHaveLength(1);
    expect(embed?.fields[0]?.name).toBe('Top ten');
    // One field, block, no columns: a ranked list is a single column by nature.
    expect(embed?.fields[0]?.inline).toBeUndefined();
    expect(embed?.fields[0]?.value.split('\n')).toEqual([
      '`1` Lena · 1548 · 41 games',
      '`2` Bilal · 1137 · 44 games',
      '`3` Rami · 1062 · 39 games',
      '`4` Iris · 990 · 38 games',
      '`5` Karim · 987 · 40 games',
      '`6` Omar · 917 · 42 games',
      '`7` Hana · 882 · 37 games',
      '`8` Theo · 831 · 38 games',
      '`9` Nadia · 654 · 28 games',
      '`10` Yuki · 534 · 24 games',
    ]);
    // The Rating numbers are the web page's: a second number in a proportional font with no
    // column to sit in is unreadable.
    expect(embed?.fields[0]?.value).not.toContain('2088');
  });

  /**
   * **The field name follows the count** (M3.22, product 2026-09-09). With eight players seeded
   * the shipped post read `Top ten` over eight lines — a field naming a number the list does
   * not have, in a channel where the group can count the lines.
   */
  it('is named `Top ten` only when ten lines print', () => {
    const eight = workedLeaderboardInput().entries.slice(0, 8);
    const embed = leaderboardEmbed(workedLeaderboardInput({ entries: eight })).embeds[0];

    expect(embed?.fields[0]?.name).toBe('The board');
    expect(embed?.fields[0]?.value.split('\n')).toHaveLength(8);
    // Ten is still ten.
    expect(leaderboardEmbed(workedLeaderboardInput()).embeds[0]?.fields[0]?.name).toBe('Top ten');
  });

  it('names an eleven-row board `Top ten`, because ten is what it prints', () => {
    const eleven = [...workedLeaderboardInput().entries, workedLeaderboardInput().entries[0]].flatMap(
      (entry) => (entry === undefined ? [] : [entry]),
    );
    const embed = leaderboardEmbed(workedLeaderboardInput({ entries: eleven })).embeds[0];

    expect(embed?.fields[0]?.name).toBe('Top ten');
    expect(embed?.fields[0]?.value.split('\n')).toHaveLength(10);
  });

  it('carries the short still-settling sentence on every post, and no chip per line', () => {
    const embed = leaderboardEmbed(workedLeaderboardInput()).embeds[0];

    expect(embed?.footer.text).toBe(
      'Proven is your rating minus how unsure the board still is about you, and it settles after about 30 games.',
    );
    expect(embed?.fields[0]?.value).not.toContain('settling');
  });

  it('is the accent bar, the board title and the board link', () => {
    const embed = leaderboardEmbed(workedLeaderboardInput()).embeds[0];

    expect(embed?.color).toBe(ACCENT_COLOR);
    // `This week · leaderboard`, linking to the board it just printed (M5.12).
    expect(embed?.title).toBe('This week · leaderboard');
    expect(embed?.title.toLowerCase()).not.toContain('season');
    expect(embed?.url).toBe(`${SITE_URL}/leaderboard?window=this-week`);
    expect(embed?.description).toBeUndefined();
  });

  /** Every one of the five can title one of these posts: M5.10's Sunday post is `Last week`. */
  it('titles itself with whichever window it printed', () => {
    for (const [kind, label] of Object.entries(WINDOW_LABELS)) {
      const embed = leaderboardEmbed(workedLeaderboardInput({ windowLabel: label })).embeds[0];
      expect(embed?.title).toBe(`${label} · leaderboard`);
      expect(kind).toBeTruthy();
    }
  });

  it('drops the url when there is no honest one, and keeps the footer', () => {
    const embed = leaderboardEmbed(workedLeaderboardInput({ url: undefined })).embeds[0];

    expect(embed).not.toHaveProperty('url');
    // Unlike the teams footer, this one promises no link, so it does not change.
    expect(embed?.footer.text).toContain('Proven is your rating minus');
  });

  it('prints ten at most, however many the season has', () => {
    const entries = [...workedLeaderboardInput().entries];
    const value = leaderboardEmbed(
      workedLeaderboardInput({
        entries: [...entries, { puuid: 'puuid-11', name: 'Eleventh', proven: 100, games: 3 }],
      }),
    ).embeds[0]?.fields[0]?.value;

    expect(value?.split('\n')).toHaveLength(10);
    expect(value).not.toContain('Eleventh');
  });

  it('says `1 game` for the newest player, never `1 games`', () => {
    const value = leaderboardEmbed(
      workedLeaderboardInput({
        entries: [{ puuid: 'puuid-new', name: 'New', proven: 0, games: 1 }],
      }),
    ).embeds[0]?.fields[0]?.value;

    expect(value).toBe('`1` New · 0 · 1 game');
  });

  it('renders a nameless player as `Someone`, like every other surface (M3.10)', () => {
    const value = leaderboardEmbed(
      workedLeaderboardInput({
        entries: [{ puuid: 'puuid-x', name: null, proven: 700, games: 12 }],
      }),
    ).embeds[0]?.fields[0]?.value;

    expect(value).toBe('`1` Someone · 700 · 12 games');
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
    description: 'Sunday 6 Sep to Saturday 12 Sep · 14 games',
    entries: workedBoardRows().map((row) => ({
      puuid: row.puuid,
      name: row.name,
      proven: row.proven,
      games: row.games,
    })),
    url: `${SITE_URL}/leaderboard?window=last-week`,
    timestamp: TIMESTAMP,
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

    expect(embed?.title).toBe('Last week · leaderboard');
    expect(embed?.url).toBe(`${SITE_URL}/leaderboard?window=last-week`);
    // Byte for byte the copy table's window slot (`05-design.md`).
    expect(embed?.description).toBe('Sunday 6 Sep to Saturday 12 Sep · 14 games');
    expect(embed?.color).toBe(ACCENT_COLOR);
  });

  /**
   * **The noun is a parameter, not a copy-paste** (M5.10, acceptance 5): the monthly post is
   * this builder with different strings, and no line of it is written twice.
   */
  it('is the same builder for the month', () => {
    const embed = windowSummaryEmbed(
      workedWindowInput({ windowLabel: WINDOW_LABELS['last-month'], description: 'September · 34 games' }),
    ).embeds[0];

    expect(embed?.title).toBe('Last month · leaderboard');
    expect(embed?.description).toBe('September · 34 games');
    // The board is untouched by which window it came from.
    expect(embed?.fields[0]?.value).toBe(windowSummaryEmbed(workedWindowInput()).embeds[0]?.fields[0]?.value);
  });

  it('prints the same board lines, and the same field-name rule, as the nightly post', () => {
    const embed = windowSummaryEmbed(workedWindowInput()).embeds[0];

    expect(embed?.fields[0]?.name).toBe('Top ten');
    expect(embed?.fields[0]?.value.split('\n')[0]).toBe('`1` Lena · 1548 · 41 games');
    expect(embed?.fields[0]?.value.split('\n')).toHaveLength(10);
    expect(embed?.footer.text).toBe(leaderboardEmbed(workedLeaderboardInput()).embeds[0]?.footer.text);

    const eight = windowSummaryEmbed(workedWindowInput({ entries: workedWindowInput().entries.slice(0, 8) }))
      .embeds[0];
    expect(eight?.fields[0]?.name).toBe('The board');
  });

  /**
   * **The awards are a seam** (M5.4 has not shipped): with none given, the post is the board
   * and there is no empty field where the block will go.
   */
  it('prints one field until there are awards to print', () => {
    expect(windowSummaryEmbed(workedWindowInput()).embeds[0]?.fields).toHaveLength(1);
    expect(windowSummaryEmbed(workedWindowInput({ awards: [] })).embeds[0]?.fields).toHaveLength(1);
  });

  it('prints the awards block when it is given one, with the label bold and the line quoted', () => {
    const embed = windowSummaryEmbed(
      workedWindowInput({
        awards: [
          { label: 'Most improved', line: 'Nadia · +212 · 1266 → 1478' },
          { label: 'Best off-role', line: 'Omar · 9W 3L · 75% · his main is top' },
          // An award nobody won prints its sentence rather than being dropped, so the block
          // always has three lines and the group can see the bar it missed (M5.10).
          { label: 'Cursed duo', line: 'Nobody played 6 games this week.' },
        ],
      }),
    ).embeds[0];

    expect(embed?.fields).toHaveLength(2);
    expect(embed?.fields[1]?.name).toBe('Awards');
    expect(embed?.fields[1]?.value.split('\n')).toEqual([
      '**Most improved** Nadia · +212 · 1266 → 1478',
      '**Best off-role** Omar · 9W 3L · 75% · his main is top',
      '**Cursed duo** Nobody played 6 games this week.',
    ]);
  });

  it('caps the board at ten lines and renders a nameless player as `Someone`', () => {
    const value = windowSummaryEmbed(
      workedWindowInput({ entries: [{ puuid: 'puuid-x', name: null, proven: 700, games: 1 }] }),
    ).embeds[0]?.fields[0]?.value;

    expect(value).toBe('`1` Someone · 700 · 1 game');
  });
});
