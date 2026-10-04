import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../board/types';
import { listChampions } from '../champs/names';
import { lobbyView, snapshot, workedMembers, workedResult, workedTeams } from '../testing/tonightFixtures';
import {
  gameCardModel,
  joinCardModel,
  kustomCardModel,
  playerCardModel,
  type TonightCardModel,
  tonightCardModel,
} from './cards';

const GROUP = 'Customs Night';

/** The strip's headline, or the result card's verdict. */
const headline = (model: TonightCardModel): string =>
  model.kind === 'strip' ? model.headline : model.verdict.join(' ');

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
    const model = gameCardModel(fixture, GROUP);
    expect(model.verdict.join(' ')).toBe('RED WINS');
    expect(model.winner).toBe('red');
    expect(model.duration).toBe('34 min');
    expect(model.slug).toBe('Tuesday 22 September');
    expect(model.blue).toEqual(fixture.result.blue.map((seat) => seat.name));
    expect(model.red).toEqual(fixture.result.red.map((seat) => seat.name));
    expect([...model.blue, ...model.red]).toHaveLength(10);
    const text = strings(model).join('\n');
    for (const seat of [...fixture.result.blue, ...fixture.result.red]) expect(text).toContain(seat.name);
  });

  it('says BLUE WINS for a blue win', () => {
    const model = gameCardModel(game({ winningSide: 100 }), GROUP);
    expect(model.verdict.join(' ')).toBe('BLUE WINS');
    expect(strings(model)).not.toContain('RED WINS');
  });

  it('says not rated on ARAM and on an unrated Rift game, nothing on a rated one', () => {
    expect(gameCardModel(game({ aram: true, rated: false }), GROUP).note).toBe('ARAM · not rated');
    expect(gameCardModel(game({ rated: false }), GROUP).note).toBe('not rated');
    expect(gameCardModel(game(), GROUP).note).toBeNull();
  });

  it('carries no underdog sentence, rating, delta or MVP line', () => {
    const text = strings(gameCardModel(game(), GROUP)).join('\n');
    expect(text).not.toMatch(/ was \d+%|MVP|ACE|\d{4}|\([+−-]\d+\)/);
  });

  it('prints Someone for a nameless seat rather than a blank line', () => {
    const result = workedResult();
    const [first, ...rest] = result.blue;
    if (first === undefined) throw new Error('fixture');
    const model = gameCardModel(
      {
        ...game(),
        result: { ...result, blue: [{ ...first, name: null }, ...rest] },
      },
      GROUP,
    );
    expect(model.blue[0]).toBe('Someone');
  });
});

describe('tonightCardModel', () => {
  it("prints the strip's headline for each live state, with the slug", () => {
    expect(tonightCardModel(snapshot(null), GROUP)).toMatchObject({
      slug: 'Tuesday 8 September',
      headline: 'NOBODY IN YET',
    });
    expect(
      headline(tonightCardModel(snapshot(lobbyView({ status: 'open', members: workedMembers(9) })), GROUP)),
    ).toBe('9 IN THE LOBBY');
    expect(
      headline(tonightCardModel(snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })), GROUP)),
    ).toBe('TEAMS ARE SET');
    expect(
      headline(tonightCardModel(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })), GROUP)),
    ).toBe('IN GAME');
  });

  it('says who won instead of GAME OVER while a rated result is up', () => {
    const red = snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() }));
    expect(headline(tonightCardModel(red, GROUP))).toBe('RED WINS');
    const blue = snapshot(
      lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ winningSide: 100 }) }),
    );
    expect(headline(tonightCardModel(blue, GROUP))).toBe('BLUE WINS');
  });

  it('carries the odds line, the ten names and the group on a rated result (M14.42)', () => {
    const result = workedResult();
    const model = tonightCardModel(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result })),
      GROUP,
    );
    if (model.kind !== 'result') throw new Error('expected the result card');
    expect(model.group).toBe(GROUP);
    expect(model.winner).toBe('red');
    // The verdict names the winner; the odds line never does again (5.16 ruling (f)).
    expect(model.odds).toMatch(/^Red was \d+%\.( Upset!)?$/);
    expect(model.odds).not.toMatch(/won/);
    expect(model.blue).toEqual(result.blue.map((seat) => seat.name));
    expect(model.red).toEqual(result.red.map((seat) => seat.name));
  });

  it('prints 50–50 on an even split and no odds line without a stored split', () => {
    const even = tonightCardModel(
      snapshot(
        lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ blueWinProb: 0.5 }) }),
      ),
      GROUP,
    );
    expect(even.kind === 'result' && even.odds).toBe('50–50.');
    const none = tonightCardModel(
      snapshot(
        lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ blueWinProb: null }) }),
      ),
      GROUP,
    );
    expect(none.kind === 'result' && none.odds).toBeNull();
    expect(none.kind === 'result' && none.duration).toBe('34 min');
  });

  it('keeps Upset! on an underdog win, after the odds only', () => {
    const upset = tonightCardModel(
      snapshot(
        lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ blueWinProb: 0.54 }) }),
      ),
      GROUP,
    );
    expect(upset.kind === 'result' && upset.odds).toBe('Red was 46%. Upset!');
  });

  it('names the group on every strip state', () => {
    expect(tonightCardModel(snapshot(null), GROUP).group).toBe(GROUP);
  });

  it('keeps GAME OVER for an unrated finish, as the strip does', () => {
    const unrated = snapshot(
      lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ rated: false }) }),
    );
    expect(tonightCardModel(unrated, GROUP)).toMatchObject({
      kind: 'strip',
      headline: 'GAME OVER',
      sentence: '',
    });
  });
});

describe('playerCardModel', () => {
  const row: BoardRow = {
    puuid: 'puuid-lena',
    name: 'Lena',
    track: 'all-time',
    points: null,
    sortKey: 26.45,
    rating: 1587,
    games: 41,
    wins: 24,
    losses: 17,
    ratedGames: 41,
    climb: null,
    settling: false,
    settlingChip: false,
    awards: [],
  };

  it("prints Rating and the record as that player's All time board row prints them, and never Proven", () => {
    const model = playerCardModel(row, { main: 'mid', backup: 'support' }, GROUP);
    expect(model.slug).toBe('All time');
    expect(model.name).toBe('Lena');
    expect(model.stats).toEqual([
      { label: 'Rating', value: String(row.rating) },
      { label: 'Record', parts: [{ num: '24' }, { word: 'W' }, { num: '17' }, { word: 'L' }] },
    ]);
    expect(JSON.stringify(model)).not.toMatch(/proven|ordinal/i);
  });

  it('prints main · backup, main alone, or nothing', () => {
    expect(playerCardModel(row, { main: 'mid', backup: 'support' }, GROUP).roles).toBe('mid · support');
    expect(playerCardModel(row, { main: 'adc', backup: null }, GROUP).roles).toBe('adc');
    expect(playerCardModel(row, { main: null, backup: 'top' }, GROUP).roles).toBeNull();
  });

  it('shows the settling chip under ten rated games, and none once settled (M14.42)', () => {
    const fresh = { ...row, wins: 1, losses: 0, games: 1, ratedGames: 1, settling: true };
    expect(playerCardModel(fresh, { main: null, backup: null }, GROUP).settling).toEqual([
      { word: 'settling · ' },
      { num: '1/10' },
    ]);
    expect(playerCardModel(row, { main: null, backup: null }, GROUP).settling).toBeNull();
    expect(playerCardModel(row, { main: null, backup: null }, GROUP).group).toBe(GROUP);
  });
});

describe('every card', () => {
  it('carries no champion name, icon URL or emoji', () => {
    expectNoChampionIconOrEmoji(gameCardModel(game(), GROUP));
    expectNoChampionIconOrEmoji(gameCardModel(game({ aram: true, rated: false }), GROUP));
    expectNoChampionIconOrEmoji(
      tonightCardModel(
        snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
        GROUP,
      ),
    );
    expectNoChampionIconOrEmoji(
      playerCardModel(
        { name: 'Lena', rating: 1587, wins: 24, losses: 17, ratedGames: 3, settling: true },
        { main: 'mid', backup: 'support' },
        GROUP,
      ),
    );
    expectNoChampionIconOrEmoji(kustomCardModel());
    expectNoChampionIconOrEmoji(joinCardModel(GROUP));
  });

  it('names the group on the game card too', () => {
    expect(gameCardModel(game(), GROUP).group).toBe(GROUP);
  });
});

describe('the pitch cards (M14.42)', () => {
  it("say the landing hero's title and the page description, naming no group", () => {
    const model = kustomCardModel();
    expect(model.headline).toBe('Fair teams. No arguments.');
    expect(model.sentence).toMatch(/^Kustom picks fair teams for your League customs/);
  });

  it("say the join page's button and pitch for a live invite", () => {
    expect(joinCardModel('Friday Five')).toEqual({
      headline: 'Join Friday Five',
      sentence: 'Friday Five uses Kustom to pick fair teams for your customs.',
    });
  });
});
