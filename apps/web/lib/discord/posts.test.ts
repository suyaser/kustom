import { describe, expect, it } from 'vitest';
import { AI_RECAP_LABEL } from '../ai/recapCopy';
import { WEEK_BOARD_SENTENCE_SHORT } from '../board/copy';
import { FEARLESS_POST_FOOTER, FEARLESS_RESET_DESCRIPTION } from '../fearless/copy';
import { NOT_RATED_RESULT_LINE } from '../mode/notRated';
import { HOW_SUMMARY, oddsSentence, resultOddsLine } from '../receipt/copy';
import {
  groupPageUrl,
  isLocalOrPrivateHost,
  kustomAvatarUrl,
  publicImageOrigin,
  resultBadgeUrl,
  tonightPageUrl,
  weekNotesImageUrl,
} from '../siteUrl';
import {
  GAME4_EXPLANATION,
  GAME4_GROUP,
  GAME4_ORIGIN,
  GAME4_RECAP,
  GAME4_STORYLINE,
  game4Fearless,
  game4Identity,
  game4Nightly,
  game4RatingsReset,
  game4Result,
  game4ResultNotRated,
  game4Teams,
  game4TeamsRule,
  game4Weekly,
} from '../testing/discordGame4';
import { recapPayload } from './aiEdit';
import {
  ACCENT_COLOR,
  awardLine,
  BLUE_COLOR,
  BLUE_SIDE_TITLE,
  blueCells,
  type Embed,
  explanationLine,
  fearlessEmbed,
  fearlessResetEmbed,
  KUSTOM_USERNAME,
  leaderboardEmbed,
  NBSP,
  oddsBar,
  RED_COLOR,
  RED_SIDE_TITLE,
  resultEmbed,
  SLATE_COLOR,
  sideLine,
  teamsEmbed,
  type WebhookPayload,
  windowSummaryEmbed,
} from './embeds';
import { messageLength, TOTAL_LIMIT } from './limits';
import { teamsModeWords } from './modeLines';
import { resultPayload } from './post';
import { ratingsResetEmbed } from './ratingsReset';
import { TEST_POST_TEXT, testPostBody } from './testPost';

/**
 * Discord posts 2.0 (M14.61), against 05-design section 10's worked examples (game 4 names,
 * `lib/testing/discordGame4.ts`). One snapshot per post and per variant of 10.4 and 10.5, then
 * the acceptance checks of 10.14 one by one.
 */

const LOCAL = 'http://localhost:3000';
/** The Sunday game 4's week opens on (M14.79's `[weekStart]`). */
const WEEK = '2026-09-27';

/** Every post this directory builds, on a public origin. */
function everyPost(): Record<string, WebhookPayload> {
  return {
    teams: teamsEmbed(game4Teams()),
    'teams reroll': teamsEmbed(game4Teams({ promoted: { rank: 2, splitCount: 3 } })),
    'teams rule': teamsEmbed(game4TeamsRule()),
    result: resultEmbed(game4Result()),
    'result not rated': resultEmbed(game4ResultNotRated()),
    'result with recap': recapPayload(resultEmbed(game4Result()), GAME4_RECAP),
    weekly: windowSummaryEmbed(game4Weekly()),
    'weekly with storyline': windowSummaryEmbed(game4Weekly({ storyline: GAME4_STORYLINE })),
    // M14.79: the week notes picture as E1's image, beside the storyline and the board.
    'weekly with week notes': windowSummaryEmbed(
      game4Weekly({
        storyline: GAME4_STORYLINE,
        image: weekNotesImageUrl(GAME4_ORIGIN, GAME4_GROUP.slug, WEEK),
      }),
    ),
    nightly: leaderboardEmbed(game4Nightly()),
    fearless: fearlessEmbed(game4Fearless()),
    'fearless reset': fearlessResetEmbed({ identity: game4Identity(), url: game4Fearless().url }),
    'ratings reset': ratingsResetEmbed(game4RatingsReset()),
  };
}

const lines = (text: string | undefined): string[] => (text ?? '').split('\n');

describe('the stack of every post (10.3), as snapshots', () => {
  for (const [label, payload] of Object.entries(everyPost())) {
    it(label, () => {
      expect(payload).toMatchSnapshot();
    });
  }

  it('the test post: content only, as Kustom', () => {
    expect(testPostBody(kustomAvatarUrl(GAME4_ORIGIN))).toMatchSnapshot();
  });
});

describe('10.4 teams, the variants', () => {
  it('stacks amber, blue, red, amber: header, the two sides, How the bot decided', () => {
    const { embeds } = teamsEmbed(game4Teams());
    expect(embeds.map((embed) => embed.color)).toEqual([ACCENT_COLOR, BLUE_COLOR, RED_COLOR, ACCENT_COLOR]);
    expect(embeds.map((embed) => embed.title)).toEqual([
      'Teams are set',
      BLUE_SIDE_TITLE,
      RED_SIDE_TITLE,
      HOW_SUMMARY,
    ]);
    expect(BLUE_SIDE_TITLE).toBe('\u{1F7E6} BLUE');
    expect(RED_SIDE_TITLE).toBe('\u{1F7E5} RED');
  });

  it('E1: labels, bar, verdict; Sitting out, Seats, Lobby in that order', () => {
    const [e1] = teamsEmbed(game4Teams()).embeds;
    expect(lines(e1?.description)).toEqual([
      '**Blue 49%** · **51% Red**',
      '🟦🟦🟦🟦🟦🟥🟥🟥🟥🟥',
      oddsSentence(0.49, 1),
    ]);
    expect(e1?.fields?.map((field) => field.name)).toEqual(['Sitting out', 'Seats', 'Lobby']);
    expect(e1?.author?.name).toBe('Customs Night · Fearless');
  });

  it('a reroll changes the title and nothing else', () => {
    const plain = teamsEmbed(game4Teams());
    const reroll = teamsEmbed(game4Teams({ promoted: { rank: 2, splitCount: 3 } }));
    expect(reroll.embeds[0]?.title).toBe('Teams are set · reroll 1 of 2');
    expect({ ...reroll, embeds: reroll.embeds.map(({ title: _t, ...rest }) => rest) }).toEqual({
      ...plain,
      embeds: plain.embeds.map(({ title: _t, ...rest }) => rest),
    });
  });

  it('a rule opens E1 with the mode line; the author still names the standing mode', () => {
    const [e1] = teamsEmbed(game4TeamsRule()).embeds;
    expect(lines(e1?.description)[0]).toBe(
      '**This game: tanks only.** Not rated. [See the tanks](https://kustom-delta.vercel.app/g/customs/mode)',
    );
    expect(lines(e1?.description).slice(1, 2)).toEqual(['**Blue 49%** · **51% Red**']);
    expect(e1?.author?.name).toBe('Customs Night · Fearless');
  });

  it('Normal or Fearless switched to not rated opens with the bold not-rated line, no link', () => {
    const [e1] = teamsEmbed(
      game4Teams({ mode: { mode: { id: 'normal' }, rated: false, standing: 'normal' } }),
    ).embeds;
    expect(lines(e1?.description)[0]).toBe('**This game: not rated.**');
    expect(e1?.author?.name).toBe('Customs Night');
  });

  it('nobody sits: no Sitting out; no lobby name: no Lobby', () => {
    const [e1] = teamsEmbed(game4Teams({ sitOut: null, lobby: { name: null, password: null } })).embeds;
    expect(e1?.fields?.map((field) => field.name)).toEqual(['Seats']);
  });

  it("no stored receipt: E1 has no labels, bar or verdict; E4 is core's sentence, plain", () => {
    const { embeds } = teamsEmbed(game4Teams({ receipt: null }));
    expect(embeds[0]?.description).toBeUndefined();
    expect(embeds[3]?.description).toBe(GAME4_EXPLANATION);
    const ruled = teamsEmbed(game4Teams({ receipt: null, mode: game4TeamsRule().mode })).embeds[0];
    expect(lines(ruled?.description)).toHaveLength(1);
  });

  it('no URL: no author link, no title links, E4 plain', () => {
    const { embeds } = teamsEmbed(
      game4Teams({
        identity: game4Identity(LOCAL),
        url: undefined,
        receiptUrl: undefined,
        modeUrl: undefined,
        mode: game4TeamsRule().mode,
      }),
    );
    for (const embed of embeds) expect(embed.url).toBeUndefined();
    expect(embeds[0]?.author).toEqual({ name: 'Customs Night · Fearless' });
    expect(lines(embeds[0]?.description)[0]).toBe('**This game: tanks only.** Not rated.');
  });

  it('newcomers: the main-roles chip reads `6/6 · 4 new` as now (5.5)', () => {
    const input = game4Teams();
    const fresh = new Set(
      input.blue
        .slice(0, 2)
        .map((p) => p.puuid)
        .concat(input.red.slice(0, 2).map((p) => p.puuid)),
    );
    const mark = (player: (typeof input.blue)[number]) => ({ ...player, noMain: fresh.has(player.puuid) });
    const e4 = teamsEmbed({ ...input, blue: input.blue.map(mark), red: input.red.map(mark) }).embeds[3];
    expect(lines(e4?.description)[0]).toContain('Main roles 6/6 · 4 new');
  });

  it("E4 is the receipt's lines 3 to 5, verbatim, core's sentence as subtext", () => {
    const e4 = teamsEmbed(game4Teams()).embeds[3];
    expect(lines(e4?.description)).toEqual([
      "Rating gap 45 pts · Main roles 10/10 · Bot's pick #1 of 3",
      "Next best: swap the adc players, SugarPapy and PRT Khokha. That's Blue 53%, with a bigger rating gap (61 vs 45 pts).",
      explanationLine(GAME4_EXPLANATION),
    ]);
    expect(e4?.url).toBe('https://kustom-delta.vercel.app/g/customs#how-the-bot-decided');
  });
});

describe('10.5 result, the variants', () => {
  it("E1 in the winner's colour, one line per fact, the award line bold-labelled", () => {
    const [e1] = resultEmbed(game4Result()).embeds;
    expect(e1?.color).toBe(RED_COLOR);
    expect(e1?.author?.name).toBe('Customs Night · game 4');
    expect(lines(e1?.description)).toEqual([
      resultOddsLine(0.49, 200),
      'Top damage: Syndrome\u00A0Axes, 31.4k.',
      '**MVP** Syndrome\u00A0Axes · **ACE** Ramzyinhović',
    ]);
    expect(resultEmbed(game4Result({ winningSide: 100 })).embeds[0]?.color).toBe(BLUE_COLOR);
  });

  it("the award line is product's words: drop the bold and it is `awardLine`, byte for byte", () => {
    const award = { mvp: 'lena_x', ace: null };
    const [e1] = resultEmbed(game4Result({ award, topDamage: null, blueWinProb: null })).embeds;
    expect(e1?.description?.replaceAll('**', '')).toBe(awardLine(award));
  });

  it('the count failed: the author names the group alone', () => {
    expect(resultEmbed(game4Result({ gameNumber: null })).embeds[0]?.author?.name).toBe('Customs Night');
  });

  it('not rated: the rule check and not rated under the odds, names only on the seat lines', () => {
    const { embeds } = resultEmbed(game4ResultNotRated());
    expect(lines(embeds[0]?.description)).toEqual([
      'Red was 51%. Red won.',
      "Tanks only: Blue kept the rule. Red: Jinx isn't a tank.",
      NOT_RATED_RESULT_LINE,
      'Top damage: Syndrome\u00A0Axes, 31.4k.',
    ]);
    // A rule line means no badge: the rule check keeps E1's full width (design review).
    expect(embeds[0]?.thumbnail).toBeUndefined();
    expect(resultEmbed(game4Result()).embeds[0]?.thumbnail).toEqual({ url: game4Result().badgeUrl });
    const ratedRule = resultEmbed(
      game4Result({ mode: { rated: true, rule: game4ResultNotRated().mode?.rule ?? null } }),
    );
    expect(ratedRule.embeds[0]?.thumbnail).toBeUndefined();
    expect(
      resultEmbed(game4Result({ mode: { rated: false, rule: null } })).embeds[0]?.thumbnail,
    ).toBeDefined();
    expect(lines(embeds[1]?.description)[0]).toBe('`top` **FoxHound**');
  });

  it('side titles never say won or lost', () => {
    const { embeds } = resultEmbed(game4Result());
    expect([embeds[1]?.title, embeds[2]?.title]).toEqual([BLUE_SIDE_TITLE, RED_SIDE_TITLE]);
  });

  it('resultPayload sends the badge on a public origin only', () => {
    const source = {
      winningSide: 200 as const,
      durationS: 1874,
      gameNumber: 4,
      blueWinProb: null,
      endedAt: '2026-10-04T21:44:00.000Z',
      rated: false,
      rift: true,
      rule: null,
      players: [],
    };
    // An empty scoreboard is not a clean ten: no post at all, which says nothing about images.
    expect(resultPayload(source, 'g', { slug: 'customs', name: 'Customs Night' }, GAME4_ORIGIN)).toBeNull();
    expect(resultBadgeUrl(GAME4_ORIGIN, 'customs', 'g')).toBe(
      'https://kustom-delta.vercel.app/og/g/customs/games/g/badge',
    );
    expect(resultBadgeUrl(LOCAL, 'customs', 'g')).toBeUndefined();
  });
});

describe('10.14 check 2: Kustom on every post, images only on a public origin', () => {
  it('every payload is `username: Kustom`, with the avatar on a public origin', () => {
    for (const payload of Object.values(everyPost())) {
      expect(payload.username).toBe(KUSTOM_USERNAME);
      expect(payload.avatar_url).toBe('https://kustom-delta.vercel.app/og/kustom/avatar?v=2');
    }
    expect(testPostBody().username).toBe('Kustom');
    expect(testPostBody().content).toBe(TEST_POST_TEXT);
  });

  it('on localhost there is no avatar, no thumbnail and no link at all', () => {
    const identity = game4Identity(LOCAL);
    expect(identity).toEqual({ groupName: 'Customs Night', groupUrl: undefined, avatarUrl: undefined });
    const result = resultEmbed(
      game4Result({ identity, url: undefined, badgeUrl: resultBadgeUrl(LOCAL, 'customs', 'g') }),
    );
    expect(result.avatar_url).toBeUndefined();
    expect(result.embeds[0]?.thumbnail).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/localhost|127\.0\.0\.1/);
    expect('avatar_url' in testPostBody(kustomAvatarUrl(LOCAL))).toBe(false);
  });

  it('the image origin is https and public: no loopback, private range, .local or plain http', () => {
    for (const origin of [
      LOCAL,
      'http://127.0.0.1:3000',
      'https://192.168.1.20',
      'https://10.0.0.4',
      'https://172.20.1.1',
      'https://kustom.local',
      'http://kustom-delta.vercel.app',
      'https://devbox',
      null,
      'not a url',
    ]) {
      expect(publicImageOrigin(origin)).toBeUndefined();
    }
    expect(publicImageOrigin('https://kustom-delta.vercel.app/anything')).toBe(GAME4_ORIGIN);
  });

  // M14.61 r2: one host rule for links and images, trailing dot stripped first.
  const LOCAL_OR_PRIVATE = [
    'https://localhost.',
    'https://foo.local.',
    'https://foo.internal.',
    'https://foo.internal',
    'https://localhost.localdomain',
    'https://localhost.localdomain.',
    'https://app.localhost',
    'https://100.64.0.1',
    'https://100.127.255.254',
    'https://[::ffff:7f00:1]',
    'https://[::ffff:127.0.0.1]',
    'https://[fd00::1]',
    'https://[::1]',
    'https://192.168.1.5.',
    'https://10.1.2.3.',
    'https://0.0.0.0',
    'https://devbox.',
  ];

  it.each(LOCAL_OR_PRIVATE)('refuses %s as a link and as an image', (origin) => {
    expect(tonightPageUrl(origin)).toBeUndefined();
    expect(groupPageUrl(origin, 'customs')).toBeUndefined();
    expect(publicImageOrigin(origin)).toBeUndefined();
    expect(isLocalOrPrivateHost(new URL(origin).hostname)).toBe(true);
  });

  it('keeps public hosts, including the CGNAT neighbours and a trailing-dot public name', () => {
    for (const host of [
      'kustom-delta.vercel.app',
      'kustom-delta.vercel.app.',
      '100.63.0.1',
      '100.128.0.1',
      '8.8.8.8',
    ]) {
      expect(isLocalOrPrivateHost(host)).toBe(false);
    }
    expect(tonightPageUrl('https://192.168.1.5')).toBeUndefined();
    expect(tonightPageUrl('https://kustom-delta.vercel.app')).toBe(GAME4_ORIGIN);
  });
});

describe('10.14 check 3: only E1 has author and links; E2 and E3 never carry a url', () => {
  const posts = everyPost();
  for (const [label, payload] of Object.entries(posts)) {
    it(label, () => {
      const withAuthor = payload.embeds.filter((embed) => embed.author !== undefined);
      expect(withAuthor).toHaveLength(1);
      const sides = payload.embeds.filter(
        (embed) => embed.title === BLUE_SIDE_TITLE || embed.title === RED_SIDE_TITLE,
      );
      for (const side of sides) expect(side.url).toBeUndefined();
      // The author sits on E1: the first embed, or the board under the Sunday storyline (10.6).
      const authored = payload.embeds.findIndex((embed) => embed.author !== undefined);
      expect(authored).toBe(payload.embeds[0]?.color === SLATE_COLOR ? 1 : 0);
    });
  }
});

describe('10.14 check 4: the Rating and its change are joined by U+00A0, and nothing else is', () => {
  it('on every result seat line, once', () => {
    const { embeds } = resultEmbed(game4Result());
    for (const embed of embeds.slice(1)) {
      for (const line of lines(embed.description)) {
        expect(line.match(/ /g)).toHaveLength(1);
        expect(line).toMatch(/· \d+ \([+-]\d+\)$/);
      }
    }
    expect(NBSP).toBe(' ');
  });

  it('nowhere else in any post: every line that has one is a rated seat line', () => {
    for (const payload of Object.values(everyPost())) {
      for (const embed of payload.embeds) {
        const texts = [
          embed.title,
          embed.description,
          embed.author?.name,
          embed.footer?.text,
          ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]),
        ];
        for (const line of texts.flatMap(lines)) {
          if (!line.includes(NBSP)) continue;
          // The seat line: Rating and change. E1's fact lines (design review): only inside names.
          const seat = /^`\w+` \*\*[^\u00A0]+\*\* · \d+\u00A0\([+-]\d+\)$/;
          const fact =
            /^(Top damage: \S+(\u00A0\S+)*, [\d.]+k?\.|\*\*MVP\*\* \S+(\u00A0\S+)* · \*\*ACE\*\* \S+(\u00A0\S+)*)$/;
          expect(line).toMatch(new RegExp(`${seat.source}|${fact.source}`));
        }
      }
    }
    expect(JSON.stringify(resultEmbed(game4ResultNotRated()).embeds.slice(1))).not.toContain(NBSP);
    expect(JSON.stringify(teamsEmbed(game4Teams()))).not.toContain(NBSP);
  });

  it("E1's top damage and MVP / ACE names keep their inner spaces unbroken, and only there", () => {
    const [e1] = resultEmbed(game4Result()).embeds;
    const [, damage, award] = lines(e1?.description);
    expect(damage).toBe('Top damage: Syndrome\u00A0Axes, 31.4k.');
    expect(award).toBe('**MVP** Syndrome\u00A0Axes · **ACE** Ramzyinhović');
    // Seat lines keep plain spaces inside names; the words are unchanged once U+00A0 is a space.
    expect(lines(resultEmbed(game4Result()).embeds[2]?.description)[1]).toContain('**Syndrome Axes**');
    expect(award?.replaceAll(NBSP, ' ').replaceAll('**', '')).toBe(
      awardLine(game4Result().award ?? { mvp: null, ace: null }),
    );
  });
});

describe('10.14 check 5: the ten-cell bar', () => {
  it.each([
    [0.49, 5],
    [0.5, 5],
    [0.55, 5],
    [0.45, 5],
    [0.03, 1],
    [0.97, 9],
  ])('p = %s gives %s blue cells', (p, blue) => {
    expect(blueCells(p)).toBe(blue);
    expect(oddsBar(p)).toBe('🟦'.repeat(blue) + '🟥'.repeat(10 - blue));
  });

  it('rounds every other share to the nearest ten and keeps each side a cell', () => {
    expect([0, 0.08, 0.12, 0.16, 0.65, 0.66, 0.35, 0.92, 1].map(blueCells)).toEqual([
      1, 1, 1, 2, 6, 7, 4, 9, 9,
    ]);
  });
});

describe('10.14 check 7: the AI recap is its own slate E4', () => {
  it('appends a slate E4 to the stored payload and never touches E1', () => {
    const posted = resultEmbed(game4Result());
    const edited = recapPayload(posted, GAME4_RECAP);
    expect(edited.embeds.slice(0, 3)).toEqual(posted.embeds);
    expect(edited.embeds[3]).toEqual({ color: SLATE_COLOR, title: AI_RECAP_LABEL, description: GAME4_RECAP });
    expect(edited.username).toBe('Kustom');
    expect(edited.embeds[0]?.fields).toBeUndefined();
  });

  it('a second edit replaces the block, never adds a second', () => {
    const twice = recapPayload(recapPayload(resultEmbed(game4Result()), 'one'), 'two');
    expect(twice.embeds.filter((embed) => embed.color === SLATE_COLOR)).toHaveLength(1);
    expect(twice.embeds[3]?.description).toBe('two');
  });
});

describe("10.14 check 8: M16.5's hook, the Sunday storyline", () => {
  it('absent gives exactly the E1-only post', () => {
    const plain = windowSummaryEmbed(game4Weekly());
    expect(plain.embeds).toHaveLength(1);
    expect(windowSummaryEmbed(game4Weekly({ storyline: undefined }))).toEqual(plain);
    expect(windowSummaryEmbed(game4Weekly({ storyline: '  ' }))).toEqual(plain);
  });

  it('present puts a slate `AI recap` E0 above the unchanged board', () => {
    const plain = windowSummaryEmbed(game4Weekly());
    const told = windowSummaryEmbed(game4Weekly({ storyline: GAME4_STORYLINE }));
    expect(told.embeds[0]).toEqual({
      color: SLATE_COLOR,
      title: AI_RECAP_LABEL,
      description: GAME4_STORYLINE,
    });
    expect(told.embeds.slice(1)).toEqual(plain.embeds);
    expect(SLATE_COLOR).toBe(0x8b98ad);
  });

  // Moved from M16.5's `storyline.test.ts` when its `withStoryline` folded into this one.
  it('drops a line longer than any storyline this build writes (M16.5: 600 before escaping)', () => {
    const plain = windowSummaryEmbed(game4Weekly());
    expect(windowSummaryEmbed(game4Weekly({ storyline: 'z'.repeat(1_201) }))).toEqual(plain);
    expect(windowSummaryEmbed(game4Weekly({ storyline: 'z'.repeat(1_200) })).embeds).toHaveLength(2);
  });

  it('drops E0 whole rather than push the message past 6,000, and leaves the board as posted alone', () => {
    const awards = Array.from({ length: 5 }, (_, index) => ({
      label: `Award ${index}`,
      line: 'w'.repeat(1_000),
    }));
    const alone = windowSummaryEmbed(game4Weekly({ awards }));
    const told = windowSummaryEmbed(game4Weekly({ awards, storyline: 'y'.repeat(600) }));
    expect(messageLength(alone.embeds) + 600 + AI_RECAP_LABEL.length).toBeGreaterThan(TOTAL_LIMIT);
    expect(told).toEqual(alone);
  });
});

describe('M14.79: the week notes image on the Sunday post', () => {
  const image = (origin: string | null) => weekNotesImageUrl(origin, GAME4_GROUP.slug, WEEK);

  it('a public https origin puts it on E1 as `image`, and E1 is otherwise the post without it', () => {
    const plain = windowSummaryEmbed(game4Weekly({ storyline: GAME4_STORYLINE }));
    const pictured = windowSummaryEmbed(
      game4Weekly({ storyline: GAME4_STORYLINE, image: image(GAME4_ORIGIN) }),
    );
    expect(pictured.embeds[1]?.image).toEqual({ url: `${GAME4_ORIGIN}/og/g/customs/week/2026-09-27` });
    // The storyline E0 carries none; the text of every embed is unchanged.
    expect(pictured.embeds[0]).toEqual(plain.embeds[0]);
    const { image: _picture, ...rest } = pictured.embeds[1] as Embed;
    expect(rest).toEqual(plain.embeds[1]);
  });

  it('localhost, plain http or a private host sends no image at all', () => {
    for (const origin of [LOCAL, 'http://kustom-delta.vercel.app', 'https://192.168.1.20', null]) {
      expect(image(origin)).toBeUndefined();
      const payload = windowSummaryEmbed(
        game4Weekly({ identity: game4Identity(LOCAL), image: image(origin) }),
      );
      expect(payload.embeds.every((embed) => embed.image === undefined)).toBe(true);
      expect(JSON.stringify(payload)).not.toContain('/week/');
    }
  });

  it('does not count toward 6,000: the guard sheds the same lines and keeps the image', () => {
    const awards = Array.from({ length: 5 }, (_, index) => ({
      label: `Award ${index}`,
      line: 'w'.repeat(1_000),
    }));
    const alone = windowSummaryEmbed(game4Weekly({ awards, storyline: 'y'.repeat(600) }));
    const pictured = windowSummaryEmbed(
      game4Weekly({ awards, storyline: 'y'.repeat(600), image: image(GAME4_ORIGIN) }),
    );
    expect(pictured.embeds).toHaveLength(alone.embeds.length);
    expect(messageLength(pictured.embeds)).toBe(messageLength(alone.embeds));
    expect(pictured.embeds.at(-1)?.image?.url).toBe(image(GAME4_ORIGIN));
  });
});

describe('10.6 and 10.7, the boards', () => {
  it('Sunday: the top three bold, one block field per award, the week footer', () => {
    const [e1] = windowSummaryEmbed(game4Weekly()).embeds;
    const board = lines(e1?.fields?.[0]?.value);
    expect(board.slice(0, 4)).toEqual([
      '`1` **Ramzyinhović** · +212 · 5W–2L',
      '`2` **Syndrome Axes** · +140 · 6W–3L',
      '`3` **knifiy** · +88 · 4W–3L',
      '`4` XETA · +41 · 3W–3L',
    ]);
    expect(board[9]).toBe('`10` Chaos · -96 · 1W–4L · settling · 4/10');
    expect(e1?.fields?.map((field) => field.name)).toEqual(['Top ten', 'Best off-role', 'Cursed duo']);
    expect(e1?.footer?.text).toBe(WEEK_BOARD_SENTENCE_SHORT);
    expect(e1?.title).toBe('Last week · board');
  });

  it('a tie keeps its names on separate lines under the one label', () => {
    const [e1] = windowSummaryEmbed(
      game4Weekly({
        awards: [{ label: 'Cursed duo', line: 'A and B · 1W 5L · 17%\nC and D · 1W 5L · 17%' }],
      }),
    ).embeds;
    expect(e1?.fields?.[1]).toEqual({
      name: 'Cursed duo',
      value: 'A and B · 1W 5L · 17%\nC and D · 1W 5L · 17%',
    });
  });

  it('nightly: no awards, no description, the same bold top three', () => {
    const [e1] = leaderboardEmbed(game4Nightly()).embeds;
    expect(e1?.title).toBe('This week · board');
    expect(e1?.description).toBeUndefined();
    expect(e1?.fields?.map((field) => field.name)).toEqual(['Top ten']);
  });
});

describe('10.8 fearless', () => {
  it('each lane field names its count; the value is unchanged', () => {
    const [e1] = fearlessEmbed(game4Fearless()).embeds;
    expect(e1?.fields?.map((field) => field.name)).toEqual([
      'top · 7',
      'jungle · 6',
      'mid · 7',
      'adc · 6',
      'support · 8',
    ]);
    expect(e1?.fields?.[0]?.value).toBe('**Aatrox**, **Gnar**, Camille, Darius, Fiora, Garen, Jax');
    expect(e1?.footer?.text).toBe(FEARLESS_POST_FOOTER);
  });

  it('the reset: the sentence, the footer, no fields; no URL drops the footer with the link', () => {
    const [e1] = fearlessResetEmbed({ identity: game4Identity(), url: game4Fearless().url }).embeds;
    expect(e1?.description).toBe(FEARLESS_RESET_DESCRIPTION);
    expect(e1?.fields).toBeUndefined();
    const bare = fearlessResetEmbed({ identity: game4Identity(LOCAL) }).embeds[0];
    expect(bare?.footer).toBeUndefined();
    expect(bare?.url).toBeUndefined();
  });
});

describe("10.13 copy: the strings are the copy modules', not retyped", () => {
  it("the mode line keeps M15.6's words: bold and the masked link are layout only", () => {
    const url = 'https://kustom-delta.vercel.app/g/customs/mode';
    const line = lines(teamsEmbed(game4TeamsRule()).embeds[0]?.description)[0] ?? '';
    const words = teamsModeWords({ mode: { id: 'class', tag: 'Tank' }, rated: false });
    expect(line.replaceAll('**', '').replace(`(${url})`, '').replace(/[[\]]/g, '')).toBe(
      `${words?.rule} ${words?.rest} ${words?.action}`,
    );
  });

  it("the side line is M4.3's sentence; footers carry a sentence or nothing; no timestamps", () => {
    const posts = everyPost();
    expect(posts.teams?.embeds[0]?.fields?.[1]?.value).toBe(sideLine(true));
    for (const payload of Object.values(posts)) {
      for (const embed of payload.embeds as (Embed & { timestamp?: string })[]) {
        expect(embed.timestamp).toBeUndefined();
        expect(embed.footer?.text).not.toBe('Kustom');
        expect(embed.footer?.text ?? '').not.toMatch(/^Kustom · (game|more on)/);
      }
    }
  });

  it('emoji only as data: the side titles and the bar, nothing else', () => {
    for (const [label, payload] of Object.entries(everyPost())) {
      const text = JSON.stringify(payload)
        .replaceAll(BLUE_SIDE_TITLE, '')
        .replaceAll(RED_SIDE_TITLE, '')
        .replace(/(?:\u{1F7E6}|\u{1F7E5}){10}/gu, '');
      expect(text, label).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('the ratings reset: author, linked title, the sentence, no footer', () => {
    const [e1] = ratingsResetEmbed(game4RatingsReset()).embeds;
    expect(e1?.footer).toBeUndefined();
    expect(e1?.url).toBe('https://kustom-delta.vercel.app/g/customs/leaderboard?window=all-time');
    expect(e1?.description).toMatch(
      /^Ratings were reset\. Everyone starts at 1200 again\. Top 3 before the reset: /,
    );
  });
});

describe('every post is well inside 6,000', () => {
  it.each(Object.entries(everyPost()))('%s', (_label, payload) => {
    expect(messageLength(payload.embeds)).toBeLessThan(TOTAL_LIMIT / 2);
  });
});
