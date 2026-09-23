import { describe, expect, it } from 'vitest';
import { gamePageUrl, tonightPageUrl } from './siteUrl';

describe('gamePageUrl (M11.4)', () => {
  const GAME_ID = '0b6f6d7e-5c1a-4a8e-9d3b-2f4e6a8c0d12';

  it("is the tonight page's origin plus /g/<id>", () => {
    expect(gamePageUrl('https://kustom.example', GAME_ID)).toBe(`https://kustom.example/g/${GAME_ID}`);
    expect(gamePageUrl('https://kustom.example/some/path', GAME_ID)).toBe(
      `https://kustom.example/g/${GAME_ID}`,
    );
  });

  it('drops a localhost origin, exactly as tonightPageUrl does', () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', null, undefined, 'not a url']) {
      expect(tonightPageUrl(origin)).toBeUndefined();
      expect(gamePageUrl(origin, GAME_ID)).toBeUndefined();
    }
  });
});
