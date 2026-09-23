import { ImageResponse } from 'next/og';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { GameCardModel, PlayerCardModel, TonightCardModel } from '@/lib/og/cards';
import { OG_SIZE } from '@/lib/og/meta';
import { OG_DISPLAY, OG_MONO, OG_SANS, ogFonts } from './fonts';
import { OG_LIGHT, OG_PALETTE as P } from './palette';

/**
 * The three share cards (05-design.md, "Share cards — Open Graph images"), drawn by Satori.
 * Every string arrives in a model from `lib/og/cards.ts`; nothing here composes copy.
 *
 * Satori lays out flexbox only: every element with more than one child says `display: flex`.
 */

const INSET = 48;

const display = (size: number, color: string): CSSProperties => ({
  fontFamily: OG_DISPLAY,
  fontWeight: 800,
  fontSize: size,
  lineHeight: 1,
  letterSpacing: '-0.02em',
  color,
});

const mono = (size: number, weight: 500 | 600, color: string): CSSProperties => ({
  fontFamily: OG_MONO,
  fontWeight: weight,
  fontSize: size,
  color,
});

const oneLine: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

/** `▍KUSTOM` and the slug over a 2px line, then the body centred in what is left. */
function Frame({ slug, children }: { slug: string | null; children: ReactNode }) {
  return (
    <div
      style={{
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        display: 'flex',
        flexDirection: 'column',
        padding: INSET,
        backgroundColor: P.bg,
        backgroundImage: OG_LIGHT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 54 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 6, height: 28, backgroundColor: P.brand, marginRight: 12 }} />
          <div style={{ ...display(28, P.text), letterSpacing: '0.14em' }}>KUSTOM</div>
        </div>
        {slug === null ? null : (
          <div style={{ ...mono(20, 500, P.dim), letterSpacing: '0.08em' }}>{slug}</div>
        )}
      </div>
      <div style={{ height: 2, backgroundColor: P.line, marginBottom: 8 }} />
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
}

export function TonightCard({ model }: { model: TonightCardModel }) {
  return (
    <Frame slug={model.slug}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ ...display(112, P.text), maxWidth: 720, textAlign: 'center', display: 'flex' }}>
          {model.headline}
        </div>
        {model.sentence === '' ? null : (
          <div
            style={{
              fontFamily: OG_SANS,
              fontWeight: 500,
              fontSize: 36,
              lineHeight: 1.3,
              color: P.dim,
              maxWidth: 880,
              marginTop: 24,
              textAlign: 'center',
              lineClamp: 2,
              display: 'block',
            }}
          >
            {model.sentence}
          </div>
        )}
      </div>
    </Frame>
  );
}

const SIDE_WIDTH = 352;

function SideColumn({
  label,
  names,
  color,
  won,
  mirrored,
}: {
  label: string;
  names: readonly string[];
  color: string;
  won: boolean;
  mirrored: boolean;
}) {
  const rule = <div style={{ width: won ? 8 : 2, backgroundColor: won ? color : P.line, flexShrink: 0 }} />;
  return (
    <div style={{ display: 'flex', flexDirection: mirrored ? 'row-reverse' : 'row', width: SIDE_WIDTH }}>
      {rule}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: mirrored ? 'flex-end' : 'flex-start',
          [mirrored ? 'paddingRight' : 'paddingLeft']: 24,
          width: SIDE_WIDTH - (won ? 8 : 2),
        }}
      >
        <div style={{ ...display(28, color), letterSpacing: '0.12em', marginBottom: 24 }}>{label}</div>
        {names.map((name, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: five fixed seats; two players can share a name
            key={index}
            style={{
              ...oneLine,
              fontFamily: OG_SANS,
              fontWeight: 600,
              fontSize: 34,
              lineHeight: '56px',
              height: 56,
              color: P.text,
              maxWidth: SIDE_WIDTH - 40,
              textAlign: mirrored ? 'right' : 'left',
            }}
          >
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GameCard({ model }: { model: GameCardModel }) {
  const winColor = model.winner === 'blue' ? P.blue : P.red;
  return (
    <Frame slug={model.slug}>
      <div style={{ display: 'flex', width: '100%', alignItems: 'stretch' }}>
        <SideColumn
          label="BLUE"
          names={model.blue}
          color={P.blue}
          won={model.winner === 'blue'}
          mirrored={false}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
          }}
        >
          <div style={display(112, winColor)}>{model.verdict[0]}</div>
          <div style={display(112, winColor)}>{model.verdict[1]}</div>
          <div style={{ ...mono(32, 500, P.dim), marginTop: 24 }}>{model.duration}</div>
          {model.note === null ? null : (
            <div style={{ ...mono(28, 500, P.dim), marginTop: 8 }}>{model.note}</div>
          )}
        </div>
        <SideColumn label="RED" names={model.red} color={P.red} won={model.winner === 'red'} mirrored />
      </div>
    </Frame>
  );
}

export function PlayerCard({ model }: { model: PlayerCardModel }) {
  const [primary, ...rest] = model.stats;
  return (
    <Frame slug={model.slug}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            ...oneLine,
            fontFamily: OG_SANS,
            fontWeight: 600,
            fontSize: 72,
            color: P.text,
            maxWidth: 1000,
          }}
        >
          {model.name}
        </div>
        {primary === undefined ? null : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 16 }}>
            <div style={{ ...mono(160, 600, P.text), lineHeight: 1 }}>{primary.value}</div>
            <div style={{ ...mono(24, 500, P.dim), letterSpacing: '0.08em', marginTop: 8 }}>
              {primary.label}
            </div>
          </div>
        )}
        {rest.map((stat) => (
          <div key={stat.label} style={{ display: 'flex', alignItems: 'baseline', marginTop: 24 }}>
            <div style={{ ...mono(28, 500, P.dim), letterSpacing: '0.08em', marginRight: 12 }}>
              {stat.label}
            </div>
            <div style={mono(32, 600, P.text)}>{stat.value}</div>
          </div>
        ))}
        {model.roles === null ? null : (
          <div style={{ ...mono(28, 500, P.dim), marginTop: 12 }}>{model.roles}</div>
        )}
      </div>
    </Frame>
  );
}

/** The PNG, 1200×630, fonts from disk. `cacheControl` because the default is a year, immutable. */
export async function cardResponse(card: ReactElement, cacheControl: string): Promise<ImageResponse> {
  return new ImageResponse(card, {
    ...OG_SIZE,
    fonts: await ogFonts(),
    headers: { 'cache-control': cacheControl },
  });
}

export const NOT_FOUND = (): Response => new Response('Not found', { status: 404 });
