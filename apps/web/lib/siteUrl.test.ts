import { describe, expect, it } from 'vitest';
import { gamePageUrl, groupPageUrl, leaderboardPageUrl, tonightPageUrl } from './siteUrl';

const GAME_ID = '0b6f6d7e-5c1a-4a8e-9d3b-2f4e6a8c0d12';

describe('gamePageUrl (M11.4, under the group since M13.11 / M14.10)', () => {
  it("is the group's page plus /games/<id>", () => {
    expect(gamePageUrl('https://kustom.example', 'customs', GAME_ID)).toBe(
      `https://kustom.example/g/customs/games/${GAME_ID}`,
    );
    expect(gamePageUrl('https://kustom.example/some/path', 'other-crew', GAME_ID)).toBe(
      `https://kustom.example/g/other-crew/games/${GAME_ID}`,
    );
  });

  it('drops a localhost origin, exactly as tonightPageUrl does', () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', null, undefined, 'not a url']) {
      expect(tonightPageUrl(origin)).toBeUndefined();
      expect(groupPageUrl(origin, 'customs')).toBeUndefined();
      expect(gamePageUrl(origin, 'customs', GAME_ID)).toBeUndefined();
      expect(leaderboardPageUrl(origin, 'customs', 'this-week')).toBeUndefined();
    }
  });
});

describe('groupPageUrl and leaderboardPageUrl (M14.10)', () => {
  it("is the group's tonight page, with an optional anchor", () => {
    expect(groupPageUrl('https://kustom.example', 'customs')).toBe('https://kustom.example/g/customs');
    expect(groupPageUrl('https://kustom.example', 'customs', 'how-the-bot-decided')).toBe(
      'https://kustom.example/g/customs#how-the-bot-decided',
    );
  });

  it("is the group's board, carrying the window the post printed", () => {
    expect(leaderboardPageUrl('https://kustom.example', 'b-team')).toBe(
      'https://kustom.example/g/b-team/leaderboard',
    );
    expect(leaderboardPageUrl('https://kustom.example', 'b-team', 'last-week')).toBe(
      'https://kustom.example/g/b-team/leaderboard?window=last-week',
    );
  });
});
