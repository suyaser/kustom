import { describe, expect, it } from 'vitest';
import { WEEK_PLAYERS, weekInput, weekPlayer } from '../testing/weekNotesFixtures';
import {
  BUFFS_MAX,
  initials,
  mostPlayedRole,
  NERFS_MAX,
  nerfRows,
  WEEK_NOTES_COPY,
  weekNotesModel,
} from './weekNotes';
import { modeRuns, weekFromParam } from './weekNotesLoad';

/** M14.79: the "Week N notes" model, the rules behind every string the image paints. */

const names = (medals: readonly { name: string }[]) => medals.map((medal) => medal.name);

describe('weekNotesModel', () => {
  it('lays out the research week (snapshot)', () => {
    expect(weekNotesModel(weekInput())).toMatchSnapshot();
  });

  it('heads the board with the week number, the range and the counts', () => {
    const model = weekNotesModel(weekInput());
    expect(model.week).toBe('WEEK 12');
    expect(model.range).toBe('Sunday 27 Sep to Saturday 3 Oct');
    expect(model.counts).toBe('14 rated games · 4 nights');
    expect(weekNotesModel(weekInput({ games: 1, nights: 1 })).counts).toBe('1 rated game · 1 night');
  });

  it('never carries a PUUID, anywhere in the model', () => {
    const json = JSON.stringify(weekNotesModel(weekInput()));
    expect(json).not.toMatch(/puuid/i);
    for (const player of WEEK_PLAYERS) expect(json).not.toContain(player.puuid);
  });

  it('carries the Riot notice verbatim as the footer', () => {
    expect(weekNotesModel(weekInput()).footer).toBe(
      'Made by Kustom from this group’s own games. Not affiliated with or endorsed by Riot Games.',
    );
  });

  it('paints no champion art: no URL and no image reference in any string', () => {
    const json = JSON.stringify(weekNotesModel(weekInput()));
    expect(json).not.toMatch(/https?:|\.png|\.jpg|ddragon|splash/i);
  });
});

describe('BUFFS', () => {
  it('is the top point gainers, most first, at most five, with plain signed numbers', () => {
    const { buffs } = weekNotesModel(weekInput());
    expect(names(buffs.medals)).toEqual(['Ramzyinhović', 'Syndrome Axes', 'knifiy', 'XETA', 'H4RDC0R33']);
    expect(buffs.medals).toHaveLength(BUFFS_MAX);
    expect(buffs.medals[0]).toEqual({
      initials: 'RA',
      name: 'Ramzyinhović',
      suffix: null,
      role: 'mid',
      points: '+212',
      record: '5W 2L',
    });
    expect(buffs.empty).toBeNull();
  });

  it('includes a settling newcomer who finished up (only NERFS leaves them out)', () => {
    const players = [weekPlayer({ name: 'Nadia', points: 300, games: 2, ratedGames: 2, settling: true })];
    expect(names(weekNotesModel(weekInput({ players })).buffs.medals)).toEqual(['Nadia']);
  });

  it('says so when nobody finished up', () => {
    const players = [weekPlayer({ name: 'Lena', points: 0 }), weekPlayer({ name: 'Theo', points: -5 })];
    const { buffs } = weekNotesModel(weekInput({ players }));
    expect(buffs.medals).toEqual([]);
    expect(buffs.empty).toBe(WEEK_NOTES_COPY.buffsEmpty);
  });

  it('prints the same-name suffix the board prints', () => {
    const players = [weekPlayer({ name: 'Ali', nameSuffix: '#EUW', points: 20 })];
    expect(weekNotesModel(weekInput({ players })).buffs.medals[0]?.suffix).toBe('#EUW');
  });
});

describe('NERFS', () => {
  it('is up to three who gave points back, most first, with a real minus', () => {
    const { nerfs } = weekNotesModel(weekInput());
    // Chaos lost the most (−96) but is settling: never in NERFS.
    expect(names(nerfs?.medals ?? [])).toEqual(['TheSHADOWREAPER', 'SugarPapy', 'FoxHound']);
    expect(nerfs?.medals.map((medal) => medal.points)).toEqual(['−61', '−44', '−18']);
    expect(nerfs?.title).toBe('NERFS');
  });

  it('needs three or more rated games that week', () => {
    const players = [
      weekPlayer({ name: 'Two', points: -80, games: 2 }),
      weekPlayer({ name: 'Three', points: -20, games: 3 }),
      weekPlayer({ name: 'Four', points: -10, games: 4 }),
    ];
    expect(names(nerfRows(players).map((p) => ({ name: p.name ?? '' })))).toEqual(['Three', 'Four']);
  });

  it('never takes a settling player, however much they lost', () => {
    const players = [
      weekPlayer({ name: 'New', points: -200, games: 6, settling: true, ratedGames: 6 }),
      weekPlayer({ name: 'A', points: -20 }),
      weekPlayer({ name: 'B', points: -10 }),
    ];
    expect(nerfRows(players).map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('caps at three', () => {
    const players = ['A', 'B', 'C', 'D', 'E'].map((name, index) => weekPlayer({ name, points: -10 - index }));
    expect(nerfRows(players)).toHaveLength(NERFS_MAX);
  });

  it('is not drawn when fewer than two qualify: nobody is a NERF alone', () => {
    const players = [weekPlayer({ name: 'Up', points: 30 }), weekPlayer({ name: 'Down', points: -30 })];
    expect(weekNotesModel(weekInput({ players })).nerfs).toBeNull();
  });

  it('is not drawn when nobody gave points back', () => {
    const players = [weekPlayer({ name: 'Up', points: 30 })];
    expect(weekNotesModel(weekInput({ players })).nerfs).toBeNull();
  });
});

describe('SYSTEMS', () => {
  it('names the most-played rule, the rest under it, and the Fearless list', () => {
    expect(weekNotesModel(weekInput()).systems.tiles).toEqual([
      { label: 'MODE OF THE NIGHT', value: 'Tanks only ×2', sub: 'Ionia vs Noxus ×1 · not rated' },
      { label: 'FEARLESS', value: '34 banned', sub: '12 this week · 138 still open' },
    ]);
  });

  it('says a lone unrated rule is not rated', () => {
    const tiles = weekNotesModel(
      weekInput({ modes: [{ name: 'Mirror match', count: 3, rated: false }], fearless: null }),
    ).systems.tiles;
    expect(tiles).toEqual([{ label: 'MODE OF THE NIGHT', value: 'Mirror match ×3', sub: 'not rated' }]);
  });

  it('leaves out `0 this week` when the week added nothing to the list', () => {
    const tiles = weekNotesModel(weekInput({ modes: [], fearless: { total: 10, added: 0, open: 163 } }))
      .systems.tiles;
    expect(tiles).toEqual([{ label: 'FEARLESS', value: '10 banned', sub: '163 still open' }]);
  });

  it('is a quiet line on a week with no rule and no Fearless game', () => {
    const { systems } = weekNotesModel(weekInput({ modes: [], fearless: null }));
    expect(systems.tiles).toEqual([]);
    expect(systems.empty).toBe(WEEK_NOTES_COPY.systemsEmpty);
  });
});

describe('NEW', () => {
  it('is the first night, the record and the first picks, in that order', () => {
    expect(weekNotesModel(weekInput()).news.tiles).toEqual([
      { label: 'FIRST NIGHT', value: 'Chaos', sub: 'joined on Tuesday · settling 5/10' },
      { label: 'RECORD', value: 'Syndrome Axes · 48,213 damage', sub: 'Most damage, new group best' },
      {
        label: 'FIRST PICKS FOR THE GROUP',
        value: 'Smolder, Aurora, Ambessa +6',
        sub: 'champions nobody here had played before',
      },
    ]);
  });

  it('names several first nights in one tile', () => {
    const tiles = weekNotesModel(
      weekInput({
        firstNights: [
          { puuid: 'puuid-chaos', day: 'Tuesday' },
          { puuid: 'puuid-xeta', day: 'Friday' },
        ],
      }),
    ).news.tiles;
    expect(tiles[0]).toEqual({
      label: 'FIRST NIGHTS',
      value: 'Chaos, XETA',
      sub: 'first games in the group',
    });
  });

  it('counts the other records set this week', () => {
    const record = (title: string) => ({
      title,
      puuid: 'puuid-knifiy',
      name: 'knifiy',
      valueLabel: '20/1/4',
    });
    const tiles = weekNotesModel(
      weekInput({
        firstNights: [],
        records: [record('Most kills'), record('Most assists'), record('Cleanest night')],
      }),
    ).news.tiles;
    expect(tiles[0]).toEqual({
      label: 'RECORD',
      value: 'knifiy · 20/1/4',
      sub: 'Most kills, new group best · +2 more',
    });
  });

  it('tops up with the week’s awards when there is room, verbatim', () => {
    const tiles = weekNotesModel(weekInput({ firstNights: [], records: [] })).news.tiles;
    expect(tiles.map((tile) => tile.label)).toEqual([
      'FIRST PICKS FOR THE GROUP',
      'BEST OFF-ROLE',
      'CURSED DUO',
    ]);
    expect(tiles[1]?.value).toBe('XETA · 4W 1L · 80% · their main is jungle');
  });

  it('is a quiet line when nothing is new and nobody won an award', () => {
    const { news } = weekNotesModel(weekInput({ firstNights: [], records: [], firstPicks: [], awards: [] }));
    expect(news.tiles).toEqual([]);
    expect(news.empty).toBe(WEEK_NOTES_COPY.newsEmpty);
  });
});

describe('the parts', () => {
  it.each([
    ['Ramzyinhović', 'RA'],
    ['Syndrome Axes', 'SA'],
    ['H4RDC0R33', 'H4'],
    ['PRT Khokha', 'PK'],
    ['FoxHound', 'FH'],
    ['TheSHADOWREAPER', 'TS'],
    ['Player0', 'P0'],
    ['PerfPlayer17', 'P1'],
    ['knifiy', 'KN'],
    ['x', 'X'],
    ['!!!', '?'],
  ])('initials of %s are %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it('the mark is the most-played role, ties to lane order, none is null', () => {
    expect(mostPlayedRole(['adc', 'mid', 'mid', null])).toBe('mid');
    expect(mostPlayedRole(['support', 'top'])).toBe('top');
    expect(mostPlayedRole([null, null])).toBeNull();
  });

  it('mode runs: one per rule name and rated flag, in order of first play', () => {
    const game = (rule: string | null, extra: object = {}, rated = false) => ({
      rule,
      rule_class_tag: null,
      rule_region_blue: null,
      rule_region_red: null,
      rated,
      ...extra,
    });
    expect(
      modeRuns([
        game('class', { rule_class_tag: 'Tank' }),
        game(null, {}, true),
        game('region', { rule_region_blue: 'ionia', rule_region_red: 'noxus' }),
        game('class', { rule_class_tag: 'Tank' }),
        game('mirror', {}, true),
      ]),
    ).toEqual([
      { name: 'Tanks only', count: 2, rated: false },
      { name: 'Ionia vs Noxus', count: 1, rated: false },
      { name: 'Mirror match', count: 1, rated: true },
    ]);
  });
});

describe('weekFromParam', () => {
  const TZ = 'Africa/Cairo';
  const NOW = new Date('2026-10-04T12:00:00Z');

  it('reads a closed week from the Sunday it opens on, 06:00 to 06:00', () => {
    const week = weekFromParam('2026-09-27', TZ, NOW);
    expect(week?.key).toBe('2026-09-27');
    // Cairo is UTC+3 in September 2026: Sunday 06:00 local is 03:00Z.
    expect(week?.start.toISOString()).toBe('2026-09-27T03:00:00.000Z');
    expect(week?.end.toISOString()).toBe('2026-10-04T03:00:00.000Z');
  });

  it('refuses a malformed date, an impossible one, a day that opens no week and an open week', () => {
    expect(weekFromParam('27-09-2026', TZ, NOW)).toBeNull();
    expect(weekFromParam('2026-02-30', TZ, NOW)).toBeNull();
    expect(weekFromParam('2026-09-28', TZ, NOW)).toBeNull();
    expect(weekFromParam('2026-10-04', TZ, NOW)).toBeNull();
    // Closed one second after it ends, not before.
    expect(weekFromParam('2026-09-27', TZ, new Date('2026-10-04T02:59:59Z'))).toBeNull();
  });
});
