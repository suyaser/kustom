import type { Role } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { modePageUrl } from '../siteUrl';
import { GAME4_GROUP, GAME4_ORIGIN, game4Identity } from '../testing/discordGame4';
import { buildGameOnInput, type GameOnKickoff, type GameOnSource, type NameLookup } from './assemble';
import {
  ACCENT_COLOR,
  BLUE_SIDE_TITLE,
  type Embed,
  GAME_ON_CUSTOM_DESCRIPTION,
  GAME_ON_CUSTOM_TITLE,
  GAME_ON_UNROLLED_DESCRIPTION,
  GAME_ON_UNROLLED_TITLE,
  gameOnEmbed,
  oddsBar,
  RED_SIDE_TITLE,
  type WebhookPayload,
} from './embeds';
import { DESCRIPTION_LIMIT, ELLIPSIS, EMBEDS_LIMIT, messageLength, TITLE_LIMIT, TOTAL_LIMIT } from './limits';
import { announcesKickoff, postGameOnForLobby } from './post';

/**
 * M21.6: the `Game on` post, a new message when the game starts with teams Kustom did not roll.
 * The inputs go through the real `buildGameOnInput`, so the roles rule (a side that is the
 * split's five keeps its roles) and the not-rated rule are tested with the layout.
 */

const LANES: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const NAMES = ['Hana', 'Omar', 'Lina', 'Karim', 'Sara', 'Youssef', 'Mona', 'Tarek', 'Nour', 'Ziad'] as const;
const PUUIDS = NAMES.map((name) => `puuid-${name.toLowerCase()}`);
const puuid = (index: number): string => PUUIDS[index] ?? '';

/** The rolled split: the first five blue, the last five red, in lane order. */
const SPLIT: NonNullable<GameOnSource['split']> = {
  blue: LANES.map((role, index) => ({ puuid: puuid(index), role })),
  red: LANES.map((role, index) => ({ puuid: puuid(index + 5), role })),
};

/** Each player's all-time r: spread so the rating order is not the name order. */
const R = new Map(PUUIDS.map((id, index) => [id, 1150 + ((index * 37) % 120)]));
const ratingOf = (id: string): number => R.get(id) ?? 1200;
const NAME_LOOKUP: NameLookup = new Map(PUUIDS.map((id, index) => [id, NAMES[index] ?? null]));

const ORIGIN = GAME4_ORIGIN;
const CONTEXT = {
  identity: game4Identity(ORIGIN),
  url: `${ORIGIN}/g/${GAME4_GROUP.slug}`,
  modeUrl: modePageUrl(ORIGIN, GAME4_GROUP.slug),
};

function kickoff(
  kind: GameOnKickoff['kind'],
  blue: readonly string[],
  red: readonly string[],
  blueWinProb: number,
): GameOnKickoff {
  return {
    kind,
    blue: [...blue],
    red: [...red],
    at: '2026-10-05T19:30:00.000Z',
    blueWinProb,
    oddsModel: 'kustom',
  };
}

function post(
  record: GameOnKickoff,
  extra: Partial<Pick<GameOnSource, 'mode' | 'split'>> = {},
  names: NameLookup = NAME_LOOKUP,
): WebhookPayload {
  const split = extra.split !== undefined ? extra.split : record.kind === 'custom' ? SPLIT : null;
  return gameOnEmbed(
    buildGameOnInput({ kickoff: record, split, ratingOf, mode: extra.mode ?? null }, names, CONTEXT),
  );
}

const lines = (payload: WebhookPayload, index: number): string[] =>
  payload.embeds[index]?.description?.split('\n') ?? [];

function legal(embeds: readonly Embed[]): boolean {
  return (
    embeds.length <= EMBEDS_LIMIT &&
    messageLength(embeds) <= TOTAL_LIMIT &&
    embeds.every(
      (embed) =>
        (embed.title?.length ?? 0) <= TITLE_LIMIT && (embed.description?.length ?? 0) <= DESCRIPTION_LIMIT,
    )
  );
}

/** Two players traded: Sara (blue support) for Youssef (red top). */
const TWO_SWAP = kickoff(
  'custom',
  [puuid(0), puuid(1), puuid(2), puuid(3), puuid(5)],
  [puuid(4), puuid(6), puuid(7), puuid(8), puuid(9)],
  0.58,
);
/** Five players moved: the split's sides are mixed, neither kickoff side is a split side. */
const FIVE_SWAP = kickoff(
  'custom',
  [puuid(0), puuid(6), puuid(2), puuid(8), puuid(4)],
  [puuid(5), puuid(1), puuid(7), puuid(3), puuid(9)],
  0.41,
);
describe('gameOnEmbed, the Game on post (M21.6)', () => {
  it('a two-player swap: product copy, the kickoff odds, no role on either changed side', () => {
    const payload = post(TWO_SWAP);
    expect(payload).toMatchSnapshot();
    const header = payload.embeds[0];
    expect(header?.title).toBe(GAME_ON_CUSTOM_TITLE);
    expect(header?.color).toBe(ACCENT_COLOR);
    expect(header?.url).toBe(CONTEXT.url);
    expect(header?.author?.name).toBe(GAME4_GROUP.name);
    expect(lines(payload, 0)).toEqual([
      GAME_ON_CUSTOM_DESCRIPTION,
      '**Blue 58%** · **42% Red**',
      oddsBar(0.58),
      'Blue is favored.',
    ]);
    expect(payload.embeds.map((embed) => embed.title)).toEqual([
      GAME_ON_CUSTOM_TITLE,
      BLUE_SIDE_TITLE,
      RED_SIDE_TITLE,
    ]);
    // Both sides changed: names in rating order, no backticked role anywhere.
    for (const index of [1, 2]) {
      const side = lines(payload, index);
      expect(side).toHaveLength(5);
      for (const line of side) expect(line).not.toContain('`');
      const ratings = side.map((line) => Number(line.split(' · ').at(-1)));
      expect([...ratings].sort((a, b) => b - a)).toEqual(ratings);
    }
    // Never an edit: a plain webhook body, no message id, no `wait`.
    expect(Object.keys(payload).sort()).toEqual(['avatar_url', 'embeds', 'username']);
  });

  it('a five-player swap: every side mixed, names only', () => {
    const payload = post(FIVE_SWAP);
    expect(payload).toMatchSnapshot();
    expect(lines(payload, 0).at(-1)).toBe('Red is favored.');
    expect(lines(payload, 1).join('\n')).not.toContain('`');
  });

  it("a side that is the split's five keeps the split's roles, in lane order; the changed side has none", () => {
    // A sitter came in for one red player: blue is still the split's blue five, red is not a five.
    const sitterIn = kickoff(
      'custom',
      [puuid(4), puuid(3), puuid(2), puuid(1), puuid(0)],
      [puuid(5), puuid(6), puuid(7), puuid(8), 'puuid-sitter'],
      0.52,
    );
    const payload = post(sitterIn, {}, new Map([...NAME_LOOKUP, ['puuid-sitter', 'Rami']]));
    expect(payload).toMatchSnapshot();
    expect(lines(payload, 1).map((line) => line.split('`')[1])).toEqual([...LANES]);
    expect(lines(payload, 1)[0]).toBe(`\`top\` **Hana** · ${ratingOf(puuid(0))}`);
    expect(lines(payload, 2).join('\n')).not.toContain('`');
    // The sitter has no ratings row here: 1200, as the kickoff odds counted them.
    expect(lines(payload, 2)).toContain('**Rami** · 1200');
    // TWO_SWAP's sides are neither five: the split never lends a role to a changed side.
    expect(lines(post(TWO_SWAP), 1)[0]).not.toContain('`');
  });

  it('a not-rated rule game: the rule line stays, the odds go', () => {
    const payload = post(TWO_SWAP, {
      mode: { mode: { id: 'class', tag: 'Tank' }, rated: false, standing: 'fearless' },
    });
    expect(payload).toMatchSnapshot();
    expect(lines(payload, 0)).toEqual([
      GAME_ON_CUSTOM_DESCRIPTION,
      `**This game: tanks only.** Not rated. [See the tanks](${CONTEXT.modeUrl})`,
    ]);
    expect(payload.embeds[0]?.author?.name).toBe(`${GAME4_GROUP.name} · Fearless`);
  });

  it('a not-rated Normal game: the not-rated line, no odds', () => {
    const payload = post(TWO_SWAP, { mode: { mode: { id: 'normal' }, rated: false } });
    expect(lines(payload, 0)).toEqual([GAME_ON_CUSTOM_DESCRIPTION, '**This game: not rated.**']);
  });

  it('a rated rule game keeps the rule line above the odds', () => {
    const payload = post(TWO_SWAP, { mode: { mode: { id: 'mirror' }, rated: true } });
    expect(lines(payload, 0)).toHaveLength(5);
    expect(lines(payload, 0)[1]).toContain('mirror match');
    expect(lines(payload, 0)[2]).toBe('**Blue 58%** · **42% Red**');
  });

  it("unrolled: the Game on title, the receipt's no-split sentence, the odds, no roles", () => {
    const payload = post(kickoff('unrolled', PUUIDS.slice(0, 5), PUUIDS.slice(5), 0.83));
    expect(payload).toMatchSnapshot();
    expect(payload.embeds[0]?.title).toBe(GAME_ON_UNROLLED_TITLE);
    expect(lines(payload, 0)[0]).toBe(GAME_ON_UNROLLED_DESCRIPTION);
    // A clear favourite: never "the fairest split these ten allow" (they were nobody's split).
    expect(lines(payload, 0).at(-1)).toBe('Blue is clearly favored.');
    expect(lines(payload, 1).join('\n')).not.toContain('`');
  });

  it('a 4v4 prints four a side; a player with no name is Someone', () => {
    const names: NameLookup = new Map([...NAME_LOOKUP, [puuid(0), null]]);
    const payload = post(kickoff('unrolled', PUUIDS.slice(0, 4), PUUIDS.slice(5, 9), 0.5), {}, names);
    expect(lines(payload, 1)).toHaveLength(4);
    expect(lines(payload, 2)).toHaveLength(4);
    expect(lines(payload, 1).join('\n')).toContain('**Someone**');
    expect(lines(payload, 0).at(-1)).toBe('Dead even.');
  });

  describe('the limits guard (acceptance 4)', () => {
    const sixteen = ['Abcdefghijklmnop', '*_~|`\\*_*_~|`\\*_'];
    const longNames: NameLookup = new Map(PUUIDS.map((id, index) => [id, sixteen[index % 2] ?? null]));
    const longestRules = [
      { mode: { id: 'region', blue: 'shadow-isles', red: 'bandle-city' }, rated: false },
      { mode: { id: 'mirror' }, rated: false },
      { mode: { id: 'mirror' }, rated: true },
      { mode: { id: 'normal' }, rated: true, noDraw: true, standing: 'fearless' },
    ] as const;
    for (const mode of longestRules) {
      it(`ten 16-character names and the ${mode.mode.id} rule line (rated ${mode.rated}) fit untouched`, () => {
        const payload = post(TWO_SWAP, { mode }, longNames);
        expect(legal(payload.embeds)).toBe(true);
        expect(JSON.stringify(payload)).not.toContain(ELLIPSIS);
        expect(lines(payload, 1)).toHaveLength(5);
        expect(lines(payload, 2)).toHaveLength(5);
        expect(lines(payload, 0)[1]).toMatch(/^\*\*This game: /);
      });
    }
  });
});

describe('which kickoffs are announced (acceptance 3)', () => {
  it('custom and unrolled are; rolled (same or swapped sides) is not', () => {
    expect(announcesKickoff(TWO_SWAP)).toBe(true);
    expect(announcesKickoff(kickoff('unrolled', [puuid(0)], [puuid(1)], 0.5))).toBe(true);
    const rolled = { kind: 'rolled' as const, blue: [puuid(0)], red: [puuid(1)], at: TWO_SWAP.at };
    expect(announcesKickoff({ ...rolled, swapped: false })).toBe(false);
    expect(announcesKickoff({ ...rolled, swapped: true })).toBe(false);
  });

  it('postGameOnForLobby sends nothing for a rolled kickoff, without touching the database', async () => {
    const client = new Proxy(
      {},
      {
        get() {
          throw new Error('the database was read');
        },
      },
    ) as Parameters<typeof postGameOnForLobby>[0];
    const outcome = await postGameOnForLobby(client, {
      lobbyId: 'l',
      groupId: 'g',
      kickoff: { kind: 'rolled', blue: [puuid(0)], red: [puuid(1)], at: TWO_SWAP.at, swapped: false },
    });
    expect(outcome).toMatchObject({ status: 'skipped', attempts: 0 });
  });
});
