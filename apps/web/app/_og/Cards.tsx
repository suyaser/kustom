import { ImageResponse } from 'next/og';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { WinLossPart } from '@/lib/board/copy';
import type {
  GameCardModel,
  PitchCardModel,
  PlayerCardModel,
  TeamsBody,
  TonightCardModel,
} from '@/lib/og/cards';
import { OG_SIZE } from '@/lib/og/meta';
import { fitSize, textWidth } from './fit';
import { OG_DISPLAY, OG_MONO, OG_TEXT, ogFonts } from './fonts';
import { OG_LIGHT, OG_PALETTE as P } from './palette';

/**
 * The three share cards, drawn by Satori. The layout is `05-design-1.0.md`'s "Share cards" (the frame,
 * the centre third, the three-column game card); the look is 2.0's (M14.25): 7.3's Night ink and glow
 * (`./palette`), the condensed Archivo display cut, Atkinson for names and sentences, Martian Mono for
 * numbers and role words (05-design.md section 4: number or role is mono, person or sentence is text).
 * Every string arrives in a model from `lib/og/cards.ts`; nothing here composes copy.
 *
 * **Names shrink before they cut off** (M14.42, scene-walk gap 11; 05-design 6.14): a name, a group
 * name or a headline is measured (`./fit`) and set at the largest size that fits its box; only a
 * name wider than 6.14's sixteen all-caps characters at the floor size wraps, and none is ever
 * ellipsed.
 *
 * Satori lays out flexbox only: every element with more than one child says `display: flex`.
 */

const INSET = 48;

/** The condensed display cut, upper case, tracked -0.01em at display size (05-design.md 4). */
const display = (size: number, color: string): CSSProperties => ({
  fontFamily: OG_DISPLAY,
  fontWeight: 900,
  fontSize: size,
  lineHeight: 0.95,
  letterSpacing: '-0.01em',
  textTransform: 'uppercase',
  color,
});

const text = (size: number, weight: 400 | 700, color: string): CSSProperties => ({
  fontFamily: OG_TEXT,
  fontWeight: weight,
  fontSize: size,
  color,
});

const mono = (size: number, weight: 500 | 600, color: string): CSSProperties => ({
  fontFamily: OG_MONO,
  fontWeight: weight,
  fontSize: size,
  color,
});

/** One line when it fits; otherwise wrapped, never cut off (only below the floor size). */
const fitted = (fits: boolean): CSSProperties =>
  fits ? { whiteSpace: 'nowrap' } : { whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.05 };

const WORDMARK_WIDTH = 6 + 10 + textWidth('KUSTOM', 'display', 32, 0.02);
const HEADER_GAP = 20;
const HEADER_TYPE = 24;

/**
 * `▍KUSTOM`, the group's name beside it (M14.42, the shell's group line), and the slug over a 2px
 * line, then the body centred in what is left. The group name takes what the wordmark and the
 * slug leave, at 24 always, and ends in an ellipsis when it doesn't fit (5.16 ruling (d): the one
 * ellipsis a card may print; the full name is the unfurl's `og:title`).
 */
function Frame({
  group,
  slug,
  children,
}: {
  group: string | null;
  slug: string | null;
  children: ReactNode;
}) {
  const inner = OG_SIZE.width - 2 * INSET;
  const slugWidth = slug === null ? 0 : textWidth(slug, 'text-bold', HEADER_TYPE) + HEADER_GAP;
  const groupRoom = inner - WORDMARK_WIDTH - HEADER_GAP - slugWidth;
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 54 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 1 }}>
          <div
            style={{
              width: 6,
              height: 26,
              borderRadius: 2,
              backgroundColor: P.brand,
              marginRight: 10,
              flexShrink: 0,
            }}
          />
          <div style={{ ...display(32, P.text), letterSpacing: '0.02em', flexShrink: 0 }}>KUSTOM</div>
          {group === null ? null : (
            <div
              style={{
                ...text(HEADER_TYPE, 700, P.text),
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                marginLeft: HEADER_GAP,
                maxWidth: groupRoom,
              }}
            >
              {group}
            </div>
          )}
        </div>
        {slug === null ? null : (
          <div style={{ ...text(HEADER_TYPE, 700, P.dim), whiteSpace: 'nowrap', flexShrink: 0 }}>{slug}</div>
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
  if (model.kind === 'result') {
    return (
      <Frame group={model.group} slug={model.slug}>
        <Teams body={model}>
          {model.odds === null ? (
            <div style={{ ...mono(32, 500, P.dim), marginTop: 24 }}>{model.duration}</div>
          ) : (
            <div
              style={{
                ...text(28, 400, P.dim),
                lineHeight: 1.3,
                marginTop: 24,
                maxWidth: CENTRE_WIDTH - 24,
                textAlign: 'center',
                display: 'block',
              }}
            >
              {model.odds}
            </div>
          )}
        </Teams>
      </Frame>
    );
  }
  return (
    <Frame group={model.group} slug={model.slug}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ ...display(112, P.text), maxWidth: 720, textAlign: 'center', display: 'flex' }}>
          {model.headline}
        </div>
        {model.sentence === '' ? null : (
          <div
            style={{
              ...text(36, 400, P.dim),
              lineHeight: 1.3,
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
/** What the two side columns leave for the verdict. */
const CENTRE_WIDTH = OG_SIZE.width - 2 * INSET - 2 * SIDE_WIDTH;
const NAME_TYPE = 34;
/** A side-column name's floor before it wraps to two lines (5.16 ruling (c)). */
const NAME_MIN = 24;
const NAME_ROOM = SIDE_WIDTH - 40;

/**
 * The side glyph (3.3's carrier 2, 5.16 ruling (b)): ◣ before `BLUE`, ◥ after `RED`, 28px, in the side
 * colour, so the side is a shape as well as a colour and a word.
 */
function SideGlyph({ color, mirrored }: { color: string; mirrored: boolean }) {
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" style={{ flexShrink: 0 }} aria-hidden="true">
      <path d={mirrored ? 'M4 4 H24 V24 Z' : 'M4 4 V24 H24 Z'} fill={color} />
    </svg>
  );
}

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
        <div
          style={{
            display: 'flex',
            flexDirection: mirrored ? 'row-reverse' : 'row',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <SideGlyph color={color} mirrored={mirrored} />
          <div
            style={{
              ...display(36, color),
              letterSpacing: '0.04em',
              [mirrored ? 'marginRight' : 'marginLeft']: 10,
            }}
          >
            {label}
          </div>
        </div>
        {names.map((name, index) => {
          const fit = fitSize(name, 'text-bold', NAME_ROOM, NAME_TYPE, NAME_MIN);
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: five fixed seats; two players can share a name
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: mirrored ? 'flex-end' : 'flex-start',
                height: 56,
                width: NAME_ROOM,
              }}
            >
              <div
                style={{
                  ...text(fit.size, 700, P.text),
                  ...fitted(fit.fits),
                  maxWidth: NAME_ROOM,
                  textAlign: mirrored ? 'right' : 'left',
                }}
              >
                {name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The mirrored three columns: Blue's five, the verdict and what goes under it, Red's five. */
function Teams({ body, children }: { body: TeamsBody; children: ReactNode }) {
  const winColor = body.winner === 'blue' ? P.blue : P.red;
  return (
    <div style={{ display: 'flex', width: '100%', alignItems: 'stretch' }}>
      <SideColumn
        label="BLUE"
        names={body.blue}
        color={P.blue}
        won={body.winner === 'blue'}
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
        <div style={display(144, winColor)}>{body.verdict[0]}</div>
        <div style={display(144, winColor)}>{body.verdict[1]}</div>
        {children}
      </div>
      <SideColumn label="RED" names={body.red} color={P.red} won={body.winner === 'red'} mirrored />
    </div>
  );
}

export function GameCard({ model }: { model: GameCardModel }) {
  return (
    <Frame group={model.group} slug={model.slug}>
      <Teams body={model}>
        <div style={{ ...mono(32, 500, P.dim), marginTop: 24 }}>{model.duration}</div>
        {model.note === null ? null : (
          <div style={{ ...text(28, 400, P.dim), marginTop: 8 }}>{model.note}</div>
        )}
      </Teams>
    </Frame>
  );
}

const PLAYER_NAME_ROOM = 1000;

export function PlayerCard({ model }: { model: PlayerCardModel }) {
  const [primary, ...rest] = model.stats;
  const nameFit = fitSize(model.name, 'text-bold', PLAYER_NAME_ROOM, 72, 40);
  return (
    <Frame group={model.group} slug={model.slug}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            ...text(nameFit.size, 700, P.text),
            ...fitted(nameFit.fits),
            maxWidth: PLAYER_NAME_ROOM,
            textAlign: 'center',
          }}
        >
          {model.name}
        </div>
        {primary === undefined ? null : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 16 }}>
            <div style={{ ...mono(160, 600, P.text), lineHeight: 1 }}>
              {'value' in primary ? primary.value : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
              <div style={text(28, 400, P.dim)}>{primary.label}</div>
              {model.settling === null ? null : <SettlingChip parts={model.settling} />}
            </div>
          </div>
        )}
        {rest.map((stat) => (
          <div key={stat.label} style={{ display: 'flex', alignItems: 'baseline', marginTop: 24 }}>
            <div style={{ ...text(28, 400, P.dim), marginRight: 12 }}>{stat.label}</div>
            {'value' in stat ? (
              <div style={mono(32, 600, P.text)}>{stat.value}</div>
            ) : (
              <Record parts={stat.parts} />
            )}
          </div>
        ))}
        {model.roles === null ? null : (
          <div style={{ ...mono(28, 500, P.dim), letterSpacing: '0.04em', marginTop: 12 }}>{model.roles}</div>
        )}
      </div>
    </Frame>
  );
}

/**
 * The board's settling chip at card size (05-design 5.16 ruling (e)): on the `Rating` label's row,
 * 16px to its right, a 2px solid `line` outline, radius 6, padding 4 × 16, the word in Atkinson 700
 * and the count in Martian Mono 600, both 28 `dim`. Never filled, never `brand`.
 */
function SettlingChip({ parts }: { parts: readonly WinLossPart[] }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        marginLeft: 16,
        padding: '4px 16px',
        border: `2px solid ${P.line}`,
        borderRadius: 6,
        whiteSpace: 'pre',
      }}
    >
      {parts.map((part, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: two fixed tokens
          key={index}
          style={'num' in part ? mono(28, 600, P.dim) : { ...text(28, 700, P.dim), whiteSpace: 'pre' }}
        >
          {'num' in part ? part.num : part.word}
        </div>
      ))}
    </div>
  );
}

const PITCH_ROOM = 1000;

/**
 * `/`, `/about` and an invite's card (M14.42, scene-walk gap 9): the headline in the display cut,
 * shrunk to fit and wrapped only below 64, and the sentence under it. No slug and no group line:
 * a live invite's group is in its headline, and a dead one must name no group.
 */
export function PitchCard({ model }: { model: PitchCardModel }) {
  const fit = fitSize(model.headline, 'display', PITCH_ROOM, 112, 64, -0.01);
  return (
    <Frame group={null} slug={null}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            ...display(fit.size, P.text),
            ...(fit.fits ? { whiteSpace: 'nowrap' } : { whiteSpace: 'normal', wordBreak: 'break-word' }),
            maxWidth: PITCH_ROOM,
            textAlign: 'center',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {model.headline}
        </div>
        <div
          style={{
            ...text(32, 400, P.dim),
            lineHeight: 1.3,
            maxWidth: 960,
            marginTop: 28,
            textAlign: 'center',
            display: 'block',
          }}
        >
          {model.sentence}
        </div>
      </div>
    </Frame>
  );
}

/** Pixels the record's letters sit lower than its digits in a shared 40px line box (see `Record`). */
const RECORD_LETTER_DROP = 2;

/**
 * A record set per token (5.16 ruling (a)): digits in mono 600, `W` / `L` in the text face 700, both
 * 32px `text`, baseline-aligned, nothing between a digit and its letter, about a space between pairs.
 */
function Record({ parts }: { parts: readonly WinLossPart[] }) {
  // Satori's flex `alignItems: baseline` does not line up two faces with different metrics, so the
  // baselines are lined up by hand: one 40px line box for both, top-aligned, and the letter moved
  // down by the difference between the two faces' baselines in that box (Martian Mono's hhea is
  // 1000 / -200, Atkinson's 984 / -316, per 1000: about 2px at 32px).
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {parts.map((part, index) =>
        'num' in part ? (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed tokens; two can be the same digits
            key={index}
            style={{ ...mono(32, 600, P.text), lineHeight: '40px', marginLeft: index === 0 ? 0 : 10 }}
          >
            {part.num}
          </div>
        ) : (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed tokens
            key={index}
            style={{ ...text(32, 700, P.text), lineHeight: '40px', marginTop: RECORD_LETTER_DROP }}
          >
            {part.word}
          </div>
        ),
      )}
    </div>
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
