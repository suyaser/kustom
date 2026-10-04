import { describe, expect, it } from 'vitest';
import { AI_GAME, AI_PLAYER, AI_WEEK, playerId } from '@/lib/testing/aiFixtures';
import { type CheckResult, checkLine, normalizeLine, playersNamedIn, renderLine } from './check';
import { buildGameFacts, buildPlayerFacts, buildWeekFacts, type FactList } from './facts';

/**
 * M16.3: the deterministic checker, attacked. Tokens in the game (see `aiFixtures.ts`): Blue won,
 * P1 Garen (top), P2 Lee Sin (jungle, 9/0/5, most kills, 14 of 39), P3 Orianna, P4 Jinx (24,312
 * damage), P5 Thresh (21 assists, most assists and vision); Red lost: P6 Darius, P7 Vi, P8 Ahri
 * (most damage), P9 Caitlyn (most CS), P10 Lulu (40 vision only). Blue's 39 kills, 31 minutes, an upset.
 */

const game = buildGameFacts(AI_GAME, new Set()) as FactList;
const calmGame = buildGameFacts({ ...AI_GAME, upset: false }, new Set()) as FactList;
const week = buildWeekFacts(AI_WEEK, new Set()) as FactList;
const player = buildPlayerFacts(AI_PLAYER, new Set()) as FactList;

function expectPass(result: CheckResult): void {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
}

function expectReject(result: CheckResult, code: string, reason?: RegExp): void {
  expect(result.ok, JSON.stringify(result)).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
    if (reason !== undefined) expect(result.reason).toMatch(reason);
  }
}

describe('clean lines pass', () => {
  it.each([
    '{P2} put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.',
    'The underdogs did it. {P5} had 21 assists on Thresh and the most vision in the game.',
    '{P2} was in on 14 of 39 kills on Lee Sin, and never died.',
    '{P4} dealt 24,312 damage on Jinx while {P2} took 9 kills.',
    '{P4} dealt 24.3k damage on Jinx. Blue had 39 kills in 31 minutes.',
    '{P8} did the most damage in the game on Ahri, 31204 damage to champions.',
    '{P10} still had 40 vision for Red on Lulu.',
    "Blue's 39 kills sealed it for {P1} on Garen.",
    '{P2} and {P3} ran the map, {P2} with nine kills.',
  ])('%s', (line) => {
    expectPass(checkLine(line, game));
  });

  it('keeps the tokens and normalises quotes and apostrophes', () => {
    const result = checkLine('"{P2}’s 9 kills on Lee Sin won it for Blue."', game);
    expect(result).toEqual({ ok: true, text: "{P2}'s 9 kills on Lee Sin won it for Blue." });
  });

  it('passes a clean week paragraph and a clean scouting report', () => {
    expectPass(
      checkLine(
        "{P1} finished first on the week's board with 9 wins from 12 games. {P1} also had the biggest climb, 212 points, and won 5 in a row. {P2} took 2nd place with 7 wins.",
        week,
      ),
    );
    expectPass(
      checkLine(
        '{P1} has played 14 games on Lee Sin with 10 wins, a 71 percent win rate. Jungle is home: 30 games and 20 wins there.',
        player,
      ),
    );
  });
});

describe('the ten fixture rejections of the acceptance', () => {
  it('one wrong number', () => {
    expectReject(checkLine('{P2} put up 10 kills on Lee Sin.', game), 'number', /10 kills/);
  });

  it('one number bound to the wrong player', () => {
    expectReject(checkLine('{P3} put up 9 kills on Orianna.', game), 'number', /player it belongs to/);
  });

  it('one spelled-out wrong number', () => {
    expectReject(checkLine('{P2} put up ten kills on Lee Sin.', game), 'number', /ten kills/);
  });

  it('one unknown name', () => {
    expectReject(checkLine('{P2} and Sami ran it on Lee Sin with 9 kills.', game), 'name', /Sami/);
  });

  it('one invented champion', () => {
    expectReject(checkLine('{P2} had 9 kills on Zyphra.', game), 'name', /Zyphra/);
  });

  it('one absolute word without a matching fact', () => {
    expectReject(checkLine('{P3} had the most kills, 8 kills on Orianna.', game), 'absolute', /most/);
  });

  it("one 'because'", () => {
    expectReject(checkLine('Blue won because {P2} had 9 kills.', game), 'forbidden', /causal.*because/);
  });

  it("one 'Baron'", () => {
    expectReject(checkLine('{P2} took Baron and Blue won.', game), 'forbidden', /cannot see.*baron/);
  });

  it('one odds claim', () => {
    expectReject(checkLine('Red was favored, and Blue won anyway.', game), 'forbidden', /odds/);
  });

  it('one insult', () => {
    expectReject(checkLine('{P10} was useless on Lulu.', game), 'forbidden', /insult.*useless/);
  });
});

describe('numbers', () => {
  it.each([
    ['a number with no unit', '{P2} went 9 on Lee Sin.', /no unit/],
    ["the loser's deaths (never a fact)", '{P10} had 11 deaths on Lulu.', /11 deaths/],
    ['a loser team total (never a fact)', "Red's 25 kills were not enough.", /25 kills/],
    ['a kill participation printed as kills', '{P2} had 14 kills on Lee Sin.', /14 kills/],
    ['a wrong total in x of y', '{P2} was in on 14 of 25 kills.', /14 of 25/],
    ['a damage rounded to a wrong thousand', '{P4} dealt 25k damage on Jinx.', /25k/],
    ['a minute that is not the duration', 'At 20 minutes {P2} had 9 kills.', /20 minutes/],
    ['a game-length in seconds', 'Blue won in 31:24.', /no unit/],
    ['a percentage about a side', 'Blue was 46% to win.', /not in the facts|percentage/],
    [
      'a kill count written as a word for the wrong player',
      '{P1} got nine kills on Garen.',
      /player it belongs to/,
    ],
    ['times', '{P10} died 11 times.', /no unit/],
    ['a KDA', '{P2} went 9/0/5 on Lee Sin.', /no unit/],
    ['an ordinal of the wrong count', "{P2}'s 10th kill came on Lee Sin.", /10/],
  ])('rejects %s', (_label, line, reason) => {
    const result = checkLine(line, game);
    expect(result.ok, JSON.stringify(result)).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it('accepts the same value written as digits, with commas, as k, and as a word', () => {
    for (const line of [
      '{P4} dealt 24312 damage on Jinx.',
      '{P4} dealt 24,312 damage on Jinx.',
      '{P4} dealt 24k damage on Jinx.',
      '{P5} had twenty-one assists on Thresh.',
    ]) {
      // `twenty-one` is two words, `twenty` and `one`: rejected, as it must be (no 20 assists fact).
      const result = checkLine(line, game);
      if (line.includes('twenty')) expect(result.ok).toBe(false);
      else expectPass(result);
    }
  });

  it('a side number needs its side in the sentence', () => {
    expectReject(checkLine('{P10} watched 39 kills go by.', game), 'number', /player it belongs to/);
  });
});

describe('players, names and champions', () => {
  it.each([
    ['an unknown token', '{P11} had 9 kills.', 'token'],
    ['a malformed token', '{Player 2} had 9 kills.', 'token'],
    ['a bare token', 'P2 had 9 kills on Lee Sin.', 'token'],
    ['a name at the start of a sentence', 'Faker would be proud of {P2} and 9 kills.', 'name'],
    ['a nickname mid-sentence', '{P2} the Blind Monk had 9 kills.', 'name'],
    ['a title as a capital', '{P2} played like a Pro on Lee Sin.', 'name'],
    ['a real champion from no fact', '{P2} had 9 kills on Zed.', 'champion'],
    ["another player's champion", '{P3} had 8 kills on Lee Sin.', 'champion'],
  ])('rejects %s', (_label, line, code) => {
    expectReject(checkLine(line, game), code);
  });

  it('allows roles, sides, weekdays, game words and champions with dots and apostrophes', () => {
    expectPass(checkLine('From Top to Support, Blue won this Thursday in 31 minutes.', game));
    const mundo = buildGameFacts(
      {
        ...AI_GAME,
        seats: AI_GAME.seats.map((seat, index) => (index === 0 ? { ...seat, champion: 'Dr. Mundo' } : seat)),
      },
      new Set(),
    ) as FactList;
    expectPass(checkLine('{P1} took Dr. Mundo top lane and Blue won in 31 minutes.', mundo));
  });
});

describe('vocabulary', () => {
  it.each([
    ['thanks to', 'Blue won thanks to {P2}.'],
    ['teamfight', '{P2} won every teamfight.'],
    ['comeback', 'What a comeback by Blue.'],
    ['first blood', '{P2} drew first blood on Lee Sin.'],
    ['dragon', 'Blue took every dragon.'],
    ['steal', '{P2} had a steal on Lee Sin.'],
    ['throw', 'Red threw the game.'],
    ['MVP', '{P2} was the MVP with 9 kills.'],
    ['rating on a game', '{P2} gained rating with 9 kills.'],
    ['rank', '{P2} plays above his rank.'],
    ['chance', 'Red had every chance.'],
    ['an upset the facts lack', 'What an upset for Blue.'],
    ['counterfactual', 'Red could have won.'],
    ['personal', '{P10} needs a new job.'],
    ['a mean word', '{P10} was trash on Lulu.'],
    ['worst', '{P10} had the worst game.'],
  ])('rejects %s', (_label, line) => {
    const list = line.includes('upset') ? calmGame : game;
    const result = checkLine(line, list);
    expect(result.ok, JSON.stringify(result)).toBe(false);
  });

  it('allows `underdog` only when the facts carry the upset', () => {
    expectPass(checkLine('The underdogs won in 31 minutes.', game));
    expectReject(checkLine('The underdogs won in 31 minutes.', calmGame), 'forbidden', /upset/);
  });

  it('rejects advice in a scouting report only', () => {
    expectReject(
      checkLine('{P1} should play Lee Sin more. Jungle suits {P1}.', player),
      'forbidden',
      /advice/,
    );
  });

  it('rejects "this week" in a storyline: it is read all week under Last week (M16.5)', () => {
    expectReject(
      checkLine("{P1} finished first on the week's board this week with 9 wins. {P2} took 2nd place.", week),
      'forbidden',
      /stale week word/,
    );
    expectReject(
      checkLine("This week's board belonged to {P1}, with 9 wins. {P2} took 2nd place.", week),
      'forbidden',
      /this week/,
    );
    expectPass(
      checkLine(
        "{P1} finished first on the week's board with 9 wins from 12 games. {P2} took 2nd place.",
        week,
      ),
    );
    expectPass(
      checkLine("Last week's board belonged to {P1}, with 9 wins from 12 games. {P2} took 2nd place.", week),
    );
  });

  it('allows a climb in the week, never on a game', () => {
    expectPass(checkLine('{P1} had the biggest climb of the week, 212 Rating. {P2} took 2nd place.', week));
    expectReject(checkLine('{P2} climbed with 9 kills on Lee Sin.', game), 'forbidden', /rating/);
  });
});

describe('absolute words', () => {
  it('a backed claim passes for its own player only', () => {
    expectPass(checkLine('{P2} never died on Lee Sin.', game));
    expectReject(checkLine('{P3} never died on Orianna.', game), 'absolute');
    expectPass(checkLine('{P9} had the most CS in the game on Caitlyn.', game));
    expectReject(checkLine('{P9} had the most kills on Caitlyn.', game), 'absolute', /most \.\.\. kills/);
    expectReject(checkLine('{P5} had the highest damage on Thresh.', game), 'absolute', /damage/);
  });

  it('`first` needs a first claim, `top lane` is a lane', () => {
    expectReject(checkLine('{P2} was first to 9 kills.', game), 'absolute', /first/);
    expectPass(checkLine('{P1} held top lane on Garen with 7 kills.', game));
    expectReject(checkLine('{P1} was top dog on Garen.', game), 'absolute', /top/);
  });

  it('`only` and `every` are absolute too', () => {
    expectReject(checkLine('{P3} was the only star on Orianna.', game), 'absolute');
    expectReject(checkLine('Blue won every lane.', game), 'absolute');
  });
});

describe('shape', () => {
  it.each([
    ['empty', '   '],
    ['too long', `{P2} had 9 kills on Lee Sin ${'and so it went '.repeat(15)}.`],
    ['three sentences on a game', '{P2} had 9 kills. Blue won. In 31 minutes.'],
    ['a line break', '{P2} had 9 kills.\nBlue won.'],
    ['markdown', '**{P2}** had 9 kills on Lee Sin.'],
    ['a link', '{P2} had 9 kills, see kustom.gg for more.'],
    ['an emoji', '{P2} had 9 kills on Lee Sin 🔥.'],
    ['a mention', '@everyone {P2} had 9 kills.'],
  ])('rejects %s', (_label, line) => {
    // An emoji is outside ASCII, so the character check catches it first.
    expectReject(checkLine(line, game), _label === 'an emoji' ? 'characters' : 'shape');
  });

  it('a scouting report needs two or three sentences', () => {
    expectReject(checkLine('{P1} has played 14 games on Lee Sin.', player), 'shape', /1 sentences/);
  });
});

describe('renderLine: the last check, at render', () => {
  const gateOpen = { premium: true, linesEnabled: true, premiumChangedAt: '2026-10-01T00:00:00Z' };
  const line = {
    status: 'published' as const,
    text: '{P2} had 9 kills on Lee Sin while {P5} had 21 assists.',
    tokenMap: game.tokenMap,
  };
  const names = new Map([
    [playerId(1), 'Nadia'],
    [playerId(4), 'Karim'],
  ]);
  const nameOf = (id: string) => names.get(id) ?? null;

  it('substitutes names after the check', () => {
    expect(renderLine({ gate: gateOpen, line, optedOut: new Set(), nameOf })).toBe(
      'Nadia had 9 kills on Lee Sin while Karim had 21 assists.',
    );
    expect(playersNamedIn(line)).toEqual([playerId(1), playerId(4)]);
  });

  it('shows nothing for a rejected, failed, pending or hidden line', () => {
    for (const status of ['rejected', 'failed', 'pending', 'hidden'] as const) {
      expect(
        renderLine({ gate: gateOpen, line: { ...line, status }, optedOut: new Set(), nameOf }),
      ).toBeNull();
    }
  });

  it('shows nothing once a named player opted out, or when the group is off', () => {
    expect(renderLine({ gate: gateOpen, line, optedOut: new Set([playerId(4)]), nameOf })).toBeNull();
    // An opted-out player the line does not name does not hide it.
    expect(renderLine({ gate: gateOpen, line, optedOut: new Set([playerId(7)]), nameOf })).not.toBeNull();
    expect(
      renderLine({ gate: { ...gateOpen, linesEnabled: false }, line, optedOut: new Set(), nameOf }),
    ).toBeNull();
    expect(
      renderLine({ gate: { ...gateOpen, premium: false }, line, optedOut: new Set(), nameOf }),
    ).toBeNull();
    expect(renderLine({ gate: null, line, optedOut: new Set(), nameOf })).toBeNull();
  });

  it('shows nothing rather than a raw token when a name is missing', () => {
    expect(renderLine({ gate: gateOpen, line, optedOut: new Set(), nameOf: () => null })).toBeNull();
  });
});

describe('characters: printable ASCII only', () => {
  it.each([
    ['fullwidth digits', '{P2} put up \uFF19 kills on Lee Sin.'],
    ['fullwidth digits, two', '{P2} put up \uFF19\uFF19 kills on Lee Sin.'],
    ['Arabic-Indic digits', '{P2} put up \u0669\u0669 kills on Lee Sin.'],
    ['a zero-width space inside a forbidden word', '{P2} took ba\u200Bron and Blue won.'],
    ['a zero-width space inside an insult', '{P10} was a l\u200Boser on Lulu.'],
    ['a fullwidth invented name', '{P2} and \uFF33\uFF41\uFF4D\uFF49 had 9 kills.'],
    ['a Cyrillic insult', '{P10} was a \u043D\u0443\u0431 on Lulu.'],
    ['a combining mark', '{P2} put up 9 kills on Lee Sin\u0301.'],
    ['a non-breaking space', '{P2} put up 9\u00A0kills on Lee Sin.'],
  ])('rejects %s', (_label, line) => {
    expectReject(checkLine(line, game), 'characters', /outside plain ASCII/);
  });

  it('curly quotes are mapped first, and champions with dots, apostrophes and & still pass', () => {
    expectPass(checkLine('\u201C{P2}\u2019s 9 kills on Lee Sin won it for Blue.\u201D', game));
    // The roster spells Nunu & Willump as `Nunu`; the ampersand is checked on its own below.
    for (const champion of ["Kai'Sa", 'Dr. Mundo', 'Nunu']) {
      const list = buildGameFacts(
        {
          ...AI_GAME,
          seats: AI_GAME.seats.map((seat, index) => (index === 0 ? { ...seat, champion } : seat)),
        },
        new Set(),
      ) as FactList;
      expectPass(checkLine(`{P1} took ${champion} and Blue won in 31 minutes.`, list));
    }
    expectPass(checkLine('{P1} & {P2} won in 31 minutes.', game));
  });
});

describe('loser barbs: only the winning side is teased', () => {
  it.each([
    ['died', '{P10} died a lot on Lulu.'],
    ['fed', '{P6} fed on Darius.'],
    ['feeding', '{P6} kept feeding on Darius.'],
    ['threw', '{P8} threw on Ahri.'],
    ['lost it', '{P7} lost it on Vi.'],
    ['struggled', '{P9} struggled on Caitlyn.'],
    ['rough', 'A rough one for {P10} on Lulu.'],
    ['behind', '{P6} fell behind on Darius.'],
    ['stomped', '{P2} stomped {P7} on Lee Sin.'],
    // M16.8: barbs the eval caught passing before.
    ["couldn't", "{P10} had 40 vision score but couldn't hold it."],
    ["wasn't enough", "{P8} did the most damage in the game on Ahri, but it wasn't enough."],
    ['fell short', '{P8} fell short on Ahri.'],
    ['not enough', '{P10} had 40 vision score, not enough on Lulu.'],
    // M16.9 r3: passed before, on old and new code alike.
    ['at least, loser watching', '{P2} had at least 9 kills on Lee Sin while {P10} watched.'],
    ['at least, loser showed up', '{P2} had at least 9 kills on Lee Sin, at least {P10} showed up.'],
    ['at least + a number, loser', '{P2} and {P10} had at least 9 kills between them on Lee Sin.'],
  ])('rejects %s next to a losing player', (_label, line) => {
    const result = checkLine(line, game);
    expect(result.ok, JSON.stringify(result)).toBe(false);
  });

  it('M16.9 r3: at least beside a loser is refused as a barb, and still passes with no loser named', () => {
    expectReject(
      checkLine('{P2} had at least 9 kills on Lee Sin while {P10} watched.', game),
      'barb',
      /at least/,
    );
    expectReject(
      checkLine('{P2} had at least 9 kills on Lee Sin, at least {P10} showed up.', game),
      'barb',
      /at least/,
    );
    expectPass(checkLine('{P2} had at least 9 kills on Lee Sin.', game));
  });

  it('names the rule when nothing else catches it', () => {
    expectReject(checkLine('{P10} struggled on Lulu.', game), 'barb', /struggled/);
  });

  it('praise for a loser and teasing a winner both pass', () => {
    expectPass(checkLine('{P8} did the most damage in the game on Ahri, 31204 damage to champions.', game));
    expectPass(checkLine('{P1} had a rough day on Garen, and Blue won anyway.', game));
  });
});

describe('normalizeLine', () => {
  it('strips outer quotes and curly punctuation', () => {
    expect(normalizeLine('  “{P1}’s line.” ')).toBe("{P1}'s line.");
  });
});

describe('M16.9 exact idioms: read as words, and only where their guard holds', () => {
  // AI_WEEK: P1 1st (9 wins in 12 games, 212 points), P2 2nd, P3 3rd, P4 4th, P5 5th.
  it.each([
    ['made the most of', '{P1} made the most of 12 games with 9 wins. {P2} took 2nd place.'],
    ['at least', '{P1} won at least 9 wins worth of games. {P2} took 2nd place.'],
    ['top three', '{P1} and {P2} led a tight top three. {P3} held 3rd place.'],
    ['top three, no player named', '{P1} took 1st place. That is a tight top three this time.'],
    ['at the top', 'The race at the top was all {P1}: 9 wins in 12 games. {P2} took 2nd place.'],
    ['top two', '{P1} and {P2} were the top two. {P3} took 3rd place.'],
  ])('a week line with %s passes', (_label, line) => {
    expectPass(checkLine(line, week));
  });

  it.each([
    ['this one', '{P2} put up 9 kills on Lee Sin, and Blue took this one.'],
    ['a close one', 'Blue won a close one. {P2} had 9 kills on Lee Sin.'],
    ['one-sided', 'Blue made it one-sided, and {P2} had 9 kills on Lee Sin.'],
    ['made the most of', '{P2} made the most of Lee Sin with 9 kills.'],
  ])('a game line with %s passes', (_label, line) => {
    expectPass(checkLine(line, calmGame));
  });

  it.each([
    // A player below the idiom's place: still a superlative claim the facts do not back.
    ['top three, 4th place', '{P4} cracked the top three. {P1} took 1st place.', 'absolute'],
    ['at the top, 2nd place', '{P2} sat at the top all week. {P1} took 1st place.', 'absolute'],
    // A unit after the idiom: a count again, checked as one.
    ['top three kills', '{P1} had the top three kills. {P2} took 2nd place.', 'number'],
    // The numbers next to an idiom are still checked.
    ['made the most of, wrong number', '{P1} made the most of 13 games. {P2} took 2nd place.', 'number'],
    ['at least, wrong number', '{P1} won at least 10 wins. {P2} took 2nd place.', 'number'],
    // Near misses that are not the exact idiom stay absolutes.
    [
      'the most points',
      'Nobody had more fun than {P4}, who had the most points. {P1} took 1st place.',
      'absolute',
    ],
    // Game-only idioms do not open the week-only ones.
    ['top three in a game', '{P2} had the top three on Lee Sin.', 'number'],
  ])('%s still fails', (_label, line, code) => {
    const list = line.includes('Lee Sin') ? calmGame : week;
    expectReject(checkLine(line, list), code);
  });

  it.each([
    ['this one kill', '{P2} got this one kill on Lee Sin.'],
    ['a close one, then a count', 'Blue won a close one kills race. {P2} had 9 kills on Lee Sin.'],
  ])('"one" before a unit is still a number: %s', (_label, line) => {
    expectReject(checkLine(line, calmGame), 'number');
  });

  it.each([
    ['only + a number', '{P1} played only 12 games and took 1st place. {P2} took 2nd place.'],
    ['the race at the top', 'The race at the top was close, and {P2} took 2nd place. {P1} took 1st place.'],
  ])('a week line with %s passes', (_label, line) => {
    expectPass(checkLine(line, week));
  });

  it.each([
    [
      'only, a uniqueness claim',
      '{P2} was the only player with 7 wins. {P1} took 1st place.',
      'week',
      'absolute',
    ],
    ['only + a wrong number', '{P1} played only 13 games. {P2} took 2nd place.', 'week', 'number'],
    ['only next to a loser', '{P10} had only 40 vision score on Lulu.', 'game', 'absolute'],
    [
      'the race at the top, 4th place',
      'The race at the top had {P4} in it. {P1} took 1st place.',
      'week',
      'absolute',
    ],
  ])('%s still fails', (_label, line, kind, code) => {
    expectReject(checkLine(line, kind === 'week' ? week : calmGame), code);
  });

  // M16.9 r2: an idiom whose guard fails is no idiom; a failed place guard refuses the line.
  it.each([
    ['game', '{P10} at least showed up.'],
    ['game', 'At least {P9} showed up.'],
    ['game', '{P6} was at least there with 230 cs.'],
    ['game', '{P10} had at least 40 vision score on Lulu.'],
    ['week', '{P5} was at least around in 5th place. {P1} took 1st place.'],
    ['week', 'At least {P5} tried in 5th place. {P1} took 1st place.'],
    ['week', '{P4} won at least 5 wins. {P1} took 1st place.'],
    ['week', '{P1} was at least the best. {P2} took 2nd place.'],
  ])('at least as a dig still fails (%s): %s', (kind, line) => {
    const result = checkLine(line, kind === 'week' ? week : calmGame);
    expect(result.ok, JSON.stringify(result)).toBe(false);
  });

  it.each([
    ['at the top', '{P1} and {P2} sat at the top. {P3} took 3rd place.'],
    ['at the top', '{P2} sat at the top. {P1} took 1st place.'],
    ['top two', '{P1} and {P3} were the top two. {P2} took 2nd place.'],
    ['top three', '{P1} and {P4} made the top three. {P2} took 2nd place.'],
    ['top 3', '{P4} is top 3 material. {P1} took 1st place.'],
    ['the race at the top', 'The race at the top had {P1} and {P5} in it. {P2} took 2nd place.'],
    ['top five', '{P1} led a top five that had {P6} in it. {P2} took 2nd place.'],
  ])('%s with a player outside it is refused outright', (phrase, line) => {
    expectReject(checkLine(line, week), 'absolute', new RegExp(phrase));
  });

  it('stores the text as written, not the neutral word', () => {
    const result = checkLine('{P1} made the most of 12 games with 9 wins. {P2} took 2nd place.', week);
    expect(result).toMatchObject({
      ok: true,
      text: '{P1} made the most of 12 games with 9 wins. {P2} took 2nd place.',
    });
  });
});

describe('M16.14 small holes', () => {
  it('rejects a reply cut off at max_tokens, whatever its text', () => {
    expectReject(
      checkLine('{P2} put up 9 kills on Lee Sin.', calmGame, { stopReason: 'max_tokens' }),
      'shape',
      /max_tokens/,
    );
    expectPass(checkLine('{P2} put up 9 kills on Lee Sin.', calmGame, { stopReason: 'end_turn' }));
  });

  it('rejects a line with no terminal . ! or ?', () => {
    expectReject(
      checkLine('{P2} led the way with 9 kills on Lee Sin and the', calmGame),
      'shape',
      /full stop/,
    );
    expectPass(checkLine('{P2} led the way with 9 kills on Lee Sin!', calmGame));
    expectPass(checkLine('Did anyone see {P2} on Lee Sin?', calmGame));
  });

  it.each([
    ['1 kills', '{P1} had 1 kills on Garen.'],
    ['one kills', '{P1} had one kills on Garen.'],
    ['1 wins (week)', '{P1} went 1 wins in 12 games. {P2} took 2nd place.'],
    ['1 deaths', '{P2} had 1 deaths on Lee Sin.'],
    ['1 assists', '{P2} had 1 assists on Lee Sin.'],
    ['1 games (week)', '{P1} played 1 games. {P2} took 2nd place.'],
    ['1 points (week)', '{P1} gained 1 points. {P2} took 2nd place.'],
  ])('rejects a plural unit after one: %s', (label, line) => {
    expectReject(checkLine(line, label.includes('week') ? week : calmGame), 'number', /singular/);
  });

  it('1 places is refused too (place counts are no unit the checker reads, so it never passes)', () => {
    expect(checkLine('{P1} climbed 1 places. {P2} took 2nd place.', week).ok).toBe(false);
    // Passed until the DeepSeek eval (2026-10-04); a place now always needs its ending.
    expect(checkLine('{P1} finished in 1 place. {P2} took 2nd place.', week).ok).toBe(false);
    expect(checkLine('{P1} finished in 1st place. {P2} took 2nd place.', week).ok).toBe(true);
  });

  it('a plural share of a total still passes', () => {
    expectPass(checkLine('{P2} took part in 14 of 39 team kills on Lee Sin.', calmGame));
  });
});

describe('M16.11 numbers and champions bind to the nearest token before them', () => {
  // AI_GAME (calm): P1 Garen 7 kills, P2 Lee Sin 9 kills.
  it('a correct two-player sentence passes', () => {
    expectPass(checkLine('{P1} had 7 kills on Garen, and {P2} had 9 kills on Lee Sin.', calmGame));
  });

  it('swapped figures are refused (both numbers are in the facts, for the other player)', () => {
    expectReject(
      checkLine('{P1} had 9 kills on Garen, and {P2} had 7 kills on Lee Sin.', calmGame),
      'number',
      /player it belongs to/,
    );
  });

  it('swapped champions are refused', () => {
    expectReject(
      checkLine('{P1} had 7 kills on Lee Sin, and {P2} had 9 kills on Garen.', calmGame),
      'champion',
      /\{P1\}/,
    );
  });

  it('a number or champion before any token belongs to the first token after it', () => {
    expectPass(checkLine('With 9 kills on Lee Sin, {P2} ran the jungle.', calmGame));
    expectReject(checkLine('With 9 kills, {P1} and {P2} won it.', calmGame), 'number');
  });

  it('a number after a second token is that player’s, even when the first had it too', () => {
    // P2 has 0 deaths; P1 has 4. Naming P1 last makes the 0 deaths theirs: refused.
    expectReject(checkLine('{P2} went 9 kills and {P1} went 0 deaths.', calmGame), 'number');
  });
});

describe('M16.17 winner-tease limits: carried, lucky, scripting, hacking are out', () => {
  // AI_GAME (calm): Blue won; P1 Garen 7 kills, P2 Lee Sin 9 kills.
  it.each([
    [
      'did the carrying',
      '{P2} did the carrying with 9 kills on Lee Sin.',
      '{P1} got carried by {P2} on Lee Sin.',
    ],
    [
      'carried, as a verb',
      '{P2} carried Blue with 9 kills on Lee Sin.',
      '{P1} was carried by {P2} and Lee Sin.',
    ],
    [
      'a generous support',
      '{P5} was a very generous support for Blue.',
      '{P5} was boosted all game for Blue.',
    ],
    [
      'ran the jungle',
      '{P2} ran the jungle on Lee Sin with 9 kills.',
      '{P2} played Lee Sin like a script with 9 kills.',
    ],
    [
      'moral support',
      '{P1} was mostly there for moral support on Garen.',
      '{P1} got lucky on Garen with 7 kills.',
    ],
    [
      'nobody stopped them',
      'Nobody stopped {P2} on Lee Sin: 9 kills.',
      '{P2} must be on hacks with 9 kills on Lee Sin.',
    ],
    ['a fair win', '{P1} took a fair win on Garen.', 'Blue won on pure luck, {P1} on Garen.'],
    ['scripting', '{P2} had 9 kills on Lee Sin.', '{P2} was scripting on Lee Sin with 9 kills.'],
  ])('%s passes; the nearby violation is refused', (_label, pass, fail) => {
    expectPass(checkLine(pass, calmGame));
    expect(checkLine(fail, calmGame)).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('M16.18 words about the writing itself are refused, in every kind', () => {
  // From the M16.7 month's refused attempts #1, #14, #16 and #24, tokens put back.
  it.each([
    ['#1', 'Wait, that breaks the ever rule. {P2} had 9 kills on Lee Sin.', /wait|rule/],
    ['#14', '{P2} had 9 kills on Lee Sin. Tease approved, the win covers it.', /tease/],
    ['#16', '{P2} had 9 kills on Lee Sin. Gentle ribbing, since Blue took the win anyway.', /ribbing/],
    ['#24', '{P5} won with 11 assists, so the support gets teased and thanked at once.', /teased/],
    ['a joke', '{P2} had 9 kills on Lee Sin, and that is no joke.', /joke/],
    ['fixed', 'Fixed: {P2} had 9 kills on Lee Sin.', /fixed/],
    ['here is', 'Here is the line: {P2} had 9 kills on Lee Sin.', /here is/],
  ])('game, %s', (_label, line, reason) => {
    expectReject(checkLine(line, calmGame), 'forbidden', reason);
  });

  it('week and player lines too', () => {
    expectReject(
      checkLine("{P1} took 1st place with 9 wins. Here's the fun fact: {P2} took 2nd place.", week),
      'forbidden',
      /here's|fact/,
    );
    expectReject(
      checkLine('{P1} plays Lee Sin in 14 games. As a rule {P1} sticks to the jungle.', player),
      'forbidden',
      /rule/,
    );
  });

  it('plain words nearby still pass: a wait for the win, a fair game', () => {
    expectPass(checkLine('{P2} made Red wait 31 minutes for the end, with 9 kills on Lee Sin.', calmGame));
    expectPass(checkLine('{P2} had 9 kills on Lee Sin. Nobody on Red found an answer.', calmGame));
  });
});

describe('M16.15 follow-up: longest is an absolute, and whose longest matters', () => {
  // P2 (Lee Sin, a winner) on 5 wins in a row; with `longestStreak` the facts claim their own record.
  const streak = (longestStreak: boolean) =>
    buildGameFacts(
      {
        ...AI_GAME,
        upset: false,
        seats: AI_GAME.seats.map((seat, i) =>
          i === 1
            ? {
                ...seat,
                history: {
                  winStreak: 5,
                  ...(longestStreak ? { longestStreak } : {}),
                  firstOnChampion: false,
                  personalBests: [],
                },
              }
            : seat,
        ),
      },
      new Set(),
    ) as FactList;

  it('their longest run, with the record claim, passes', () => {
    expectPass(
      checkLine('{P2} is on 5 wins in a row on Lee Sin, their longest run in the group.', streak(true)),
    );
  });

  it('the longest run in the group is refused: no fact makes it a group record', () => {
    expectReject(
      checkLine('{P2} is on 5 wins in a row on Lee Sin, the longest run in the group.', streak(true)),
      'absolute',
      /longest/,
    );
  });

  it('their longest run without the record claim is refused', () => {
    expectReject(
      checkLine('{P2} is on 5 wins in a row on Lee Sin, their longest run in the group.', streak(false)),
      'absolute',
      /longest/,
    );
  });

  it('another max claim does not back longest (P2 also has the most kills)', () => {
    expectReject(
      checkLine('{P2} had the longest night on Lee Sin with 9 kills.', calmGame),
      'absolute',
      /longest/,
    );
  });
});

describe('M16.19 r2: a scouting report binds every fact to its owner, the duo partner included', () => {
  // AI_PLAYER: Lee Sin 14 games, 10 wins (71 percent); Vi 6 games; jungle 30 games. Duo: 11 games
  // together on the same team, 8 wins.
  const duo = buildPlayerFacts(
    { ...AI_PLAYER, extras: { duo: { partnerId: playerId(2), games: 11, wins: 8 } } },
    new Set(),
  ) as FactList;

  it.each([
    ['a champion bound to the partner', '{P1} has played 14 games on Lee Sin. {P2} plays Lee Sin a lot.'],
    [
      "the subject's numbers bound to the partner",
      '{P1} has played 14 games on Lee Sin. {P2} has 14 games on Lee Sin with 10 wins.',
    ],
    [
      "the subject's percent bound to the partner",
      '{P1} has played 14 games on Lee Sin. {P2} has a 71 percent win rate.',
    ],
    ['a percent nobody has', '{P1} has played 14 games on Lee Sin. {P2} has a 60% win rate.'],
    ['another champion bound to the partner', '{P1} has played 14 games on Lee Sin. {P2} has played Ahri.'],
    [
      "the duo's number without the partner named",
      '{P1} has played 14 games on Lee Sin. {P1} has 11 games on the same team.',
    ],
    // The same checks reached without a champion in the way, and with a champion in the facts.
    [
      "the subject's games and wins bound to the partner",
      '{P1} means Lee Sin. {P2} has 14 games with 10 wins.',
    ],
    ["the subject's Vi bound to the partner", '{P1} has played 14 games on Lee Sin. {P2} has played Vi.'],
  ])('refuses %s', (_label, line) => {
    expect(checkLine(line, duo).ok).toBe(false);
  });

  it('passes the duo quoted from either side, and the subject’s own facts', () => {
    expectPass(
      checkLine('{P1} has 11 games with {P2} on the same team. {P1} has played 14 games on Lee Sin.', duo),
    );
    expectPass(checkLine('{P1} and {P2} have 8 wins in 11 games on the same team. {P1} means Lee Sin.', duo));
    expectPass(checkLine('{P1} means Lee Sin, 14 games on it. The pick sits at 71 percent.', duo));
  });
});

describe('M16.19 r3: a sentence naming the duo partner carries duo facts only', () => {
  // AI_PLAYER: Lee Sin 14 games, 10 wins. Duo: 6 games together, 6 wins.
  const six = buildPlayerFacts(
    { ...AI_PLAYER, extras: { duo: { partnerId: playerId(2), games: 6, wins: 6 } } },
    new Set(),
  ) as FactList;
  const tail = ' {P1} means Lee Sin.';

  it.each([
    ['a bare most wins for the partner', '{P2} has the most wins.'],
    ['most wins in the group for the partner', '{P2} has the most wins in the group.'],
    ["the subject's 14 games quoted with the partner", '{P1} has 14 games with {P2}.'],
    ["the subject's 14 games, played, with the partner", '{P1} has played 14 games with {P2}.'],
  ])('refuses %s', (_label, line) => {
    expect(checkLine(line + tail, six).ok).toBe(false);
  });

  it.each([
    ['the duo games quoted from the subject', '{P1} won 6 games with {P2}.'],
    ['the duo wins, together', '{P2} and {P1} have 6 wins together.'],
    ['the duo claim, together with the subject', '{P2} has the most wins together with {P1}.'],
  ])('passes %s', (_label, line) => {
    expectPass(checkLine(line + tail, six));
  });
});

describe('DeepSeek eval tightenings (2026-10-04)', () => {
  it('refuses a place without its ending', () => {
    expectReject(checkLine('{P1} took 1 place with 212 points.', week), 'number', /place without its ending/);
  });

  it.each(['her', 'him', 'his', 'he', 'She'])('refuses the gendered pronoun %s', (pronoun) => {
    expectReject(
      checkLine(`{P2} put up 9 kills on Lee Sin and ${pronoun} won in 31 minutes.`, game),
      'forbidden',
      /gendered pronoun/,
    );
  });

  it('passes words that only contain a pronoun', () => {
    expectPass(checkLine('{P2} put up 9 kills on Lee Sin, and there is the whole story.', game));
  });
});
