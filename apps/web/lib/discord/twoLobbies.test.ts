import { describe, expect, it } from 'vitest';
import { FEARLESS_RESET_DESCRIPTION, FEARLESS_TITLE } from '../fearless/copy';
import { modePageUrl } from '../siteUrl';
import {
  GAME4_GROUP,
  GAME4_ORIGIN,
  game4Fearless,
  game4Identity,
  game4Result,
  game4Teams,
} from '../testing/discordGame4';
import { recapPayload } from './aiEdit';
import {
  fearlessEmbed,
  fearlessResetEmbed,
  GAME_ON_CUSTOM_TITLE,
  GAME_ON_UNROLLED_TITLE,
  type GameOnEmbedInput,
  gameOnEmbed,
  labelledTitle,
  lobbyUrl,
  type PostLobbyLabel,
  resultEmbed,
  teamsEmbed,
  type WebhookPayload,
} from './embeds';

/**
 * M22.7 (05-design 14.10): while two or more lobbies are live, the teams, reroll, both `Game on`
 * and the result post lead E1's title with the lobby's label and their Tonight links open it
 * (`?lobby=<id>`); the Fearless pool and reset gain a second description line. Without a label
 * every post is today's, byte for byte (`posts.test.ts`' snapshots pin those, unchanged).
 */

const KNIFIY_LOBBY = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const XETA_LOBBY = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

/** knifiy's lobby, both lobbies live. */
const KNIFIY: PostLobbyLabel = {
  lobbyId: KNIFIY_LOBBY,
  label: { kind: 'host', name: 'knifiy', repeat: 1 },
  live: 2,
};
/** XETA's lobby, both lobbies live. */
const XETA: PostLobbyLabel = {
  lobbyId: XETA_LOBBY,
  label: { kind: 'host', name: 'XETA', repeat: 1 },
  live: 2,
};

const TONIGHT = `${GAME4_ORIGIN}/g/${GAME4_GROUP.slug}`;

/** A `Game on` input from game 4's ten: `custom` keeps the split's roles, `unrolled` has none. */
function gameOn(kind: GameOnEmbedInput['kind'], overrides: Partial<GameOnEmbedInput> = {}): GameOnEmbedInput {
  const teams = game4Teams();
  const side = (players: typeof teams.blue) =>
    players.map((player) => ({
      puuid: player.puuid,
      name: player.name,
      role: kind === 'custom' ? player.role : null,
      rating: player.rating,
    }));
  return {
    identity: game4Identity(),
    kind,
    blue: side(teams.blue),
    red: side(teams.red),
    blueWinProb: 0.47,
    mode: { mode: { id: 'region', blue: 'ionia', red: 'noxus' }, rated: true, standing: 'fearless' },
    modeUrl: modePageUrl(GAME4_ORIGIN, GAME4_GROUP.slug),
    url: TONIGHT,
    ...overrides,
  };
}

function twoLobbyPosts(): Record<string, WebhookPayload> {
  return {
    teams: teamsEmbed(
      game4Teams({
        mode: { mode: { id: 'region', blue: 'ionia', red: 'noxus' }, rated: true, standing: 'fearless' },
        lobbyLabel: KNIFIY,
      }),
    ),
    'teams reroll': teamsEmbed(game4Teams({ promoted: { rank: 2, splitCount: 3 }, lobbyLabel: KNIFIY })),
    'game on, own teams': gameOnEmbed(gameOn('custom', { lobbyLabel: KNIFIY })),
    'game on, unrolled': gameOnEmbed(gameOn('unrolled', { lobbyLabel: XETA })),
    result: resultEmbed(game4Result({ lobbyLabel: XETA })),
    'fearless pool': fearlessEmbed({ ...game4Fearless(), lobbyLabel: XETA }),
    'fearless pool, three lobbies': fearlessEmbed({ ...game4Fearless(), lobbyLabel: { ...XETA, live: 3 } }),
    'fearless reset': fearlessResetEmbed({
      identity: game4Identity(),
      url: game4Fearless().url,
      liveLobbies: 2,
    }),
    'fearless reset, three lobbies': fearlessResetEmbed({
      identity: game4Identity(),
      url: game4Fearless().url,
      liveLobbies: 3,
    }),
  };
}

describe('two lobbies live: every post that names one, as snapshots', () => {
  for (const [name, payload] of Object.entries(twoLobbyPosts())) {
    it(name, () => {
      expect(payload).toMatchSnapshot();
    });
  }
});

describe('the label leads the title (14.10)', () => {
  it('teams, reroll, both Game on kinds and the result', () => {
    expect(teamsEmbed(game4Teams({ lobbyLabel: KNIFIY })).embeds[0]?.title).toBe(
      "knifiy's lobby · Teams are set",
    );
    expect(
      teamsEmbed(game4Teams({ promoted: { rank: 2, splitCount: 3 }, lobbyLabel: KNIFIY })).embeds[0]?.title,
    ).toBe("knifiy's lobby · Teams are set · reroll 1 of 2");
    expect(gameOnEmbed(gameOn('custom', { lobbyLabel: KNIFIY })).embeds[0]?.title).toBe(
      `knifiy's lobby · ${GAME_ON_CUSTOM_TITLE}`,
    );
    expect(gameOnEmbed(gameOn('unrolled', { lobbyLabel: KNIFIY })).embeds[0]?.title).toBe(
      `knifiy's lobby · ${GAME_ON_UNROLLED_TITLE}`,
    );
    expect(resultEmbed(game4Result({ lobbyLabel: XETA })).embeds[0]?.title).toBe(
      "XETA's lobby · Red wins · 31 min",
    );
  });

  it('a same-name lobby and a nameless one', () => {
    expect(
      labelledTitle('Teams are set', { ...KNIFIY, label: { kind: 'host', name: 'Ana', repeat: 2 } }),
    ).toBe("Ana's lobby 2 · Teams are set");
    expect(labelledTitle('Game on', { ...KNIFIY, label: { kind: 'numbered', n: 3 } })).toBe(
      'Lobby 3 · Game on',
    );
  });

  it('the host name is escaped by renderName, plain in the bold title', () => {
    const label: PostLobbyLabel = { ...KNIFIY, label: { kind: 'host', name: '[x](y)_*', repeat: 1 } };
    expect(teamsEmbed(game4Teams({ lobbyLabel: label })).embeds[0]?.title).toBe(
      "\\[x\\]\\(y\\)\\_\\*'s lobby · Teams are set",
    );
  });
});

describe('the links open the lobby (14.10)', () => {
  it('teams: title, author, E4 before its anchor, the mode line; the sides carry no url', () => {
    const { embeds } = teamsEmbed(
      game4Teams({
        mode: { mode: { id: 'region', blue: 'ionia', red: 'noxus' }, rated: true, standing: 'fearless' },
        lobbyLabel: KNIFIY,
      }),
    );
    const [e1, e2, e3, e4] = embeds;
    expect(e1?.url).toBe(`${TONIGHT}?lobby=${KNIFIY_LOBBY}`);
    expect(e1?.author?.url).toBe(`${TONIGHT}?lobby=${KNIFIY_LOBBY}`);
    expect(e4?.url).toBe(`${TONIGHT}?lobby=${KNIFIY_LOBBY}#how-the-bot-decided`);
    expect(e1?.description?.split('\n')[0]).toContain(`](${TONIGHT}/mode?lobby=${KNIFIY_LOBBY})`);
    expect(e2?.url).toBeUndefined();
    expect(e3?.url).toBeUndefined();
  });

  it('Game on: title, author and the mode line', () => {
    const [e1] = gameOnEmbed(gameOn('custom', { lobbyLabel: KNIFIY })).embeds;
    expect(e1?.url).toBe(`${TONIGHT}?lobby=${KNIFIY_LOBBY}`);
    expect(e1?.author?.url).toBe(`${TONIGHT}?lobby=${KNIFIY_LOBBY}`);
    expect(e1?.description).toContain(`(${TONIGHT}/mode?lobby=${KNIFIY_LOBBY})`);
  });

  it('result: the title still links the game page, the author opens the lobby', () => {
    const [e1] = resultEmbed(game4Result({ lobbyLabel: XETA })).embeds;
    expect(e1?.url).toBe(game4Result().url);
    expect(e1?.author?.url).toBe(`${TONIGHT}?lobby=${XETA_LOBBY}`);
  });

  it('Fearless pool and reset: title and links stay the group’s', () => {
    const pool = fearlessEmbed({ ...game4Fearless(), lobbyLabel: XETA }).embeds[0];
    expect(pool?.title).toBe(FEARLESS_TITLE);
    expect(pool?.url).toBe(game4Fearless().url);
    expect(pool?.author?.url).toBe(TONIGHT);
    expect(pool?.description?.split('\n')[1]).toBe("From a game in XETA's lobby. One list for both lobbies.");
    const reset = fearlessResetEmbed({ identity: game4Identity(), url: game4Fearless().url, liveLobbies: 3 });
    expect(reset.embeds[0]?.description).toBe(`${FEARLESS_RESET_DESCRIPTION}\nFor every lobby.`);
  });

  it('lobbyUrl: no label or no url is the identity; a query joins with &', () => {
    expect(lobbyUrl(undefined, KNIFIY)).toBeUndefined();
    expect(lobbyUrl(TONIGHT, undefined)).toBe(TONIGHT);
    expect(lobbyUrl(`${TONIGHT}?window=x#a`, KNIFIY)).toBe(`${TONIGHT}?window=x&lobby=${KNIFIY_LOBBY}#a`);
  });
});

describe('one live lobby: today’s post, byte for byte', () => {
  it('no label is the same payload as before M22.7', () => {
    expect(teamsEmbed(game4Teams({ lobbyLabel: undefined }))).toEqual(teamsEmbed(game4Teams()));
    expect(resultEmbed(game4Result({ lobbyLabel: undefined }))).toEqual(resultEmbed(game4Result()));
    expect(fearlessResetEmbed({ identity: game4Identity(), liveLobbies: 1 })).toEqual(
      fearlessResetEmbed({ identity: game4Identity() }),
    );
  });
});

describe('a posted label stays (posts are never edited)', () => {
  it('the AI recap edit re-sends the stored E1, label and links included', () => {
    const posted = resultEmbed(game4Result({ lobbyLabel: XETA }));
    const edited = recapPayload(posted, 'Red closed it out.');
    expect(edited.embeds[0]).toEqual(posted.embeds[0]);
    expect(edited.embeds[0]?.title).toBe("XETA's lobby · Red wins · 31 min");
  });
});
