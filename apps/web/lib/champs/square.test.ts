import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { DDRAGON_VERSION, ddragonChampionIconUrl, ddragonSpriteSheetUrl } from './ddragon';
import { championSquare, optimizedImageUrl, SQUARE_QUALITY, SQUARE_WIDTHS } from './square';

describe('championSquare (M14.45)', () => {
  it("is the pinned square through Next's default loader, 32px at 1x and 48px at 2x", () => {
    const ahri = championSquare(103);
    const source = encodeURIComponent(
      `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Ahri.png`,
    );
    expect(ahri).toEqual({
      src: `/_next/image?url=${source}&w=48&q=75`,
      srcSet: `/_next/image?url=${source}&w=32&q=75 1x, /_next/image?url=${source}&w=48&q=75 2x`,
      size: 24,
    });
  });

  it('is null for a key the pin does not ship', () => {
    expect(championSquare(99_999)).toBeNull();
  });

  it("asks only for widths and a quality Next's optimizer accepts", () => {
    const sizes = [...(nextConfig.images?.imageSizes ?? imageConfigDefault.imageSizes)];
    const qualities = nextConfig.images?.qualities ?? imageConfigDefault.qualities ?? [75];
    expect(sizes).toContain(SQUARE_WIDTHS.x1);
    expect(sizes).toContain(SQUARE_WIDTHS.x2);
    expect(qualities).toContain(SQUARE_QUALITY);
    expect(optimizedImageUrl('https://x/y.png', 32)).toBe(
      '/_next/image?url=https%3A%2F%2Fx%2Fy.png&w=32&q=75',
    );
  });

  it("next.config's remotePatterns allow every champion square and nothing else from Data Dragon", () => {
    const patterns = nextConfig.images?.remotePatterns ?? [];
    expect(hasRemoteMatch([], patterns, new URL(ddragonChampionIconUrl(62) ?? ''))).toBe(true);
    expect(hasRemoteMatch([], patterns, new URL(ddragonSpriteSheetUrl(0)))).toBe(false);
    expect(hasRemoteMatch([], patterns, new URL('https://example.com/cdn/1/img/champion/Ahri.png'))).toBe(
      false,
    );
  });
});
