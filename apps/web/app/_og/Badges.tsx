import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';
import { TAPE_WINS } from '@/lib/tonight/copy';
import { OG_DISPLAY, ogFonts } from './fonts';
import { OG_PALETTE as P } from './palette';

/**
 * The two Discord images (M14.61, 05-design 10.11): the webhook's avatar (B1) and the result
 * post's thumbnail badge (B2). Both 256 × 256, on the page colour, drawn by Satori with the
 * committed fonts. Nothing else: no names, no duration, no champion art (5.16's Riot-safe rule).
 * Every Discord post is complete without them; they are only sent on a public origin.
 */
export const BADGE_SIZE = { width: 256, height: 256 } as const;

/**
 * B1: the `▍` wordmark bar in amber and a `K` in Archivo condensed 900, both inside the centre
 * 70%, because Discord crops avatars to a circle.
 */
export function KustomAvatar() {
  return (
    <div
      style={{
        width: BADGE_SIZE.width,
        height: BADGE_SIZE.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: P.bg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 26, height: 140, background: P.brand }} />
        <div
          style={{
            fontFamily: OG_DISPLAY,
            fontWeight: 900,
            fontSize: 180,
            lineHeight: 1,
            color: P.text,
            marginTop: -6,
          }}
        >
          K
        </div>
      </div>
    </div>
  );
}

/**
 * B2: a 16 px rule across the top in the winner's colour, the side's word (Archivo condensed 900,
 * 112 px, the winner's colour) and `WINS` (72 px, the page's text colour; `TAPE_WINS`).
 */
export function ResultBadge({ side }: { side: 100 | 200 }) {
  const colour = side === 100 ? P.blue : P.red;
  return (
    <div
      style={{
        width: BADGE_SIZE.width,
        height: BADGE_SIZE.height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: P.bg,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: BADGE_SIZE.width,
          height: 16,
          background: colour,
        }}
      />
      <div
        style={{
          display: 'flex',
          fontFamily: OG_DISPLAY,
          fontWeight: 900,
          fontSize: 112,
          lineHeight: 0.9,
          color: colour,
          marginTop: 16,
        }}
      >
        {side === 100 ? 'BLUE' : 'RED'}
      </div>
      <div
        style={{
          display: 'flex',
          fontFamily: OG_DISPLAY,
          fontWeight: 900,
          fontSize: 72,
          lineHeight: 1,
          color: P.text,
        }}
      >
        {TAPE_WINS}
      </div>
    </div>
  );
}

/** The PNG, 256 × 256, fonts from disk. */
export async function badgeResponse(element: ReactElement, cacheControl: string): Promise<ImageResponse> {
  return new ImageResponse(element, {
    ...BADGE_SIZE,
    fonts: await ogFonts(),
    headers: { 'cache-control': cacheControl },
  });
}
