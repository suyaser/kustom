import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../board/types';
import { listChampions } from '../champs/names';
import { lobbyView, snapshot, workedMembers, workedResult, workedTeams } from '../testing/tonightFixtures';
import { gameCardModel, playerCardModel, tonightCardModel } from './cards';

/** The share cards' text models (M11.4): what the PNG paints, tested as strings, not pixels. */

const strings = (model: object): string[] =>
  JSON.stringify(model)
    .match(/"(?:[^"\\]|\\.)*"/g)
    ?.map((literal) => JSON.parse(literal) as string) ?? [];

const EMOJI = /\p{Extended_Pictographic}/u;
const CHAMPIONS = listChampions().map((champion) => champion.name);

function expectNoChampionIconOrEmoji(model: object) {
  const text = strings(model).join('\n');
  expect(text).not.toMatch(EMOJI);
  expect(text).not.toMatch(/https?:|\.png|\.webp|ddragon|communitydragon/i);
  for (const name of CHAMPIONS) {
    expect(text.split(/[\n·]/).map((part) => part.trim())).not.toContain(name);
  }
}

const game = (overrides: { aram?: boolean; rated?: boolean; winningSide?: 100 | 200 } = {}) => ({
  nightLabel: 'Tuesday 22 September',
  aram: overrides.aram ?? false,
  result: workedResult({
    rated: overrides.rated ?? true,
    ...(overrides.winningSide === undefined ? {} : { winningSide: overrides.winningSide }),
  }),
});

describe('gameCardModel', () => {
  it('says RED WINS for a red win and carries all ten names, five a side in lane order', () => {
    const fixture = game();
    const model = gameCardModel(fixture);
    expect(model.verdict.join(' ')).toBe('RED WINS');
    expect(model.winner).toBe('red');
    expect(model.duration).toBe('34:12');
    expect(model.slug).toBe('TUESDAY 22 SEPTEMBER');
    expect(model.blue).toEqual(fixture.result.blue.map((seat) => seat.name));
    expect(model.red).toEqual(fixture.result.red.map((seat) => seat.name));
    expect([...model.blue, ...model.red]).toHaveLength(10);
    const text = strings(model).join('\n');
    for (const seat of [...fixture.result.blue, ...fixture.result.red]) expect(text).toContain(seat.name);
  });

  it('says BLUE WINS for a blue win', () => {
    const model = gameCardModel(game({ winningSide: 100 }));
    expect(model.verdict.join(' ')).toBe('BLUE WINS');
    expect(strings(model)).not.toContain('RED WINS');
  });

  it('says not rated on ARAM and on an unrated Rift game, nothing on a rated one', () => {
    expect(gameCardModel(game({ aram: true, rated: false })).note).toBe('ARAM · not rated');
    expect(gameCardModel(game({ rated: false })).note).toBe('not rated');
    expect(gameCardModel(game()).note).toBeNull();
  });

  it('carries no underdog sentence, rating, delta or MVP line', () => {
    const text = strings(gameCardModel(game())).join('\n');
    expect(text).not.toMatch(/ was \d+%|MVP|ACE|\d{4}|\([+−-]\d+\)/);
  });

  it('prints Someone for a nameless seat rather than a blank line', () => {
    const result = workedResult();
    const [first, ...rest] = result.blue;
    if (first === undefined) throw new Error('fixture');
    const model = gameCardModel({
      ...game(),
      result: { ...result, blue: [{ ...first, name: null }, ...rest] },
    });
    expect(model.blue[0]).toBe('Someone');
  });
});

describe('tonightCardModel', () => {
  it("prints the strip's headline for each live state, with the slug", () => {
    expect(tonightCardModel(snapshot(null))).toMatchObject({
      slug: 'TUESDAY 8 SEPTEMBER',
      headline: 'NOBODY IN YET',
    });
    expect(
      tonightCardModel(snapshot(lobbyView({ status: 'open', members: workedMembers(9) }))).headline,
    ).toBe('9 IN THE LOBBY');
    expect(tonightCardModel(snapshot(lobbyView({ status: 'balanced', teams: workedTeams() }))).headline).toBe(
      'TEAMS ARE SET',
    );
    expect(tonightCardModel(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() }))).headline).toBe(
      'IN GAME',
    );
  });

  it('says who won instead of GAME OVER while a rated result is up', () => {
    const red = snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() }));
    expect(tonightCardModel(red).headline).toBe('RED WINS');
    const blue = snapshot(
      lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ winningSide: 100 }) }),
    );
    expect(tonightCardModel(blue).headline).toBe('BLUE WINS');
  });

  it('keeps GAME OVER for an unrated finish, as the strip does', () => {
    const unrated = snapshot(
      lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ rated: false }) }),
    );
    expect(tonightCardModel(unrated)).toMatchObject({ headline: 'GAME OVER', sentence: '' });
  });
});

describe('playerCardModel', () => {
  const row: BoardRow = {
    puuid: 'puuid-lena',
    name: 'Lena',
    track: 'all-time',
    proven: 1418,
    sortKey: 23.63,
    rating: 1587,
    games: 41,
    wins: 24,
    losses: 17,
    streak: null,
    climb: null,
    settling: false,
    breakdown: [],
    awards: [],
  };

  it("prints Proven and Rating as that player's All time board row prints them", () => {
    const model = playerCardModel(row, { main: 'mid', backup: 'support' });
    expect(model.slug).toBe('ALL TIME');
    expect(model.name).toBe('Lena');
    expect(model.stats).toEqual([
      { label: 'Proven', value: String(row.proven) },
      { label: 'Rating', value: String(row.rating) },
    ]);
  });

  it('prints main · backup, main alone, or nothing', () => {
    expect(playerCardModel(row, { main: 'mid', backup: 'support' }).roles).toBe('mid · support');
    expect(playerCardModel(row, { main: 'adc', backup: null }).roles).toBe('adc');
    expect(playerCardModel(row, { main: null, backup: 'top' }).roles).toBeNull();
  });
});

describe('every card', () => {
  it('carries no champion name, icon URL or emoji', () => {
    expectNoChampionIconOrEmoji(gameCardModel(game()));
    expectNoChampionIconOrEmoji(gameCardModel(game({ aram: true, rated: false })));
    expectNoChampionIconOrEmoji(
      tonightCardModel(
        snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
      ),
    );
    expectNoChampionIconOrEmoji(
      playerCardModel({ name: 'Lena', proven: 1418, rating: 1587 }, { main: 'mid', backup: 'support' }),
    );
  });
});
