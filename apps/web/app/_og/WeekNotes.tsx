import type { RoleValue } from '@customs/db';
import { ImageResponse } from 'next/og';
import type { CSSProperties, ReactNode } from 'react';
import type { WeekNotesMedal, WeekNotesModel, WeekNotesTile } from '@/lib/og/weekNotes';
import { RoleIcon } from '../_icons/RoleIcon';
import { fitSize, textWidth } from './fit';
import { OG_DISPLAY, OG_MONO, OG_TEXT, ogFonts } from './fonts';
import { OG_PALETTE as P } from './palette';

/**
 * The "Week N notes" image (M14.79), variant A of `redesign/research/patch-image.md`: the patch
 * board, 1920×1080. BUFFS and NERFS medallions on the left, the KEY between the columns, SYSTEMS
 * and NEW tiles on the right, the notice along the bottom. Every string arrives in the model
 * (`lib/og/weekNotes.ts`); nothing here composes copy.
 *
 * Kustom's own look, never Riot's (research §2): no Riot logo, fonts, role or rank icons,
 * champion portraits or splash art. Players are initials in rings; the role marks are
 * `app/_icons/RoleIcon.tsx`. No green and no red: a gain is `text` with a 4px ring, a loss is
 * `dim` with a 2px ring, told apart by word and glyph too (05-design 3.1, 3.7).
 *
 * **Sized for the feed** (the lead, 2026-10-04): Discord shows it about 520 px wide on a phone, a
 * 0.27 scale, so names and points are set at 36 px (about 9.75 px there), W–L at 30, a tile's sub
 * line at 28 and its label at 26.
 *
 * Satori lays out flexbox only: every element with more than one child says `display: flex`.
 */

export const WEEK_NOTES_SIZE = { width: 1920, height: 1080 } as const;

const PAD_X = 56;
const PAD_Y = 48;
const RIGHT_W = 580;
const GAP = 40;
/** The left board: BUFFS across its full width, NERFS and the KEY side by side under it. */
const LEFT_W = WEEK_NOTES_SIZE.width - 2 * PAD_X - RIGHT_W - GAP;
const MEDAL_W = Math.floor(LEFT_W / 5);
/** NERFS holds at most three medallions; the KEY takes the room beside them. */
const KEY_W = LEFT_W - 3 * MEDAL_W - 56;
const RING = 100;

/**
 * Names and numbers: 36 px (about 9.75 px at a 520 px feed width). A one-line name shrinks to 33
 * (about 9 px there); a longer one wraps at its spaces at 36; only a one-word name too wide at 33
 * (15 wide capitals) shrinks to 30 and breaks inside the word.
 */
const NAME = 36;
const NAME_FIT_MIN = 33;
const NAME_MIN = 30;
/** A camelCase seam break may go to 27 (7.3 px in the feed): two whole halves read better than a cut. */
const SEAM_MIN = 27;
const NUMBER = 36;
const LABEL = 26;
/** A tile's sub line carries counts (`138 still open`): 28 px, about 7.6 px in the feed. */
const SUB = 28;
/** A tile's value: one line from 36 down to 32 (8.7 px in the feed), else wrapped at 32. */
const TILE_MIN = 32;
/** The tile's inner width: the column less its padding and border. */
const TILE_ROOM = RIGHT_W - 44;
const HEAD = 58;

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

const display = (size: number, color: string): CSSProperties => ({
  fontFamily: OG_DISPLAY,
  fontWeight: 900,
  fontSize: size,
  lineHeight: 1,
  color,
});

/** Night's page light at 1920×1080: the two lamps and the 48 px grid (`OG_LIGHT`, rescaled). */
const LIGHT = [
  'radial-gradient(ellipse 1728px 1296px at 154px -216px, rgba(46,155,255,0.16), rgba(46,155,255,0) 58%)',
  'radial-gradient(ellipse 1536px 1188px at 1843px -194px, rgba(255,207,102,0.11), rgba(255,207,102,0) 52%)',
  'repeating-linear-gradient(0deg, rgba(244,247,252,0) 0px, rgba(244,247,252,0) 47px, rgba(244,247,252,0.035) 47px, rgba(244,247,252,0.035) 48px)',
  'repeating-linear-gradient(90deg, rgba(244,247,252,0) 0px, rgba(244,247,252,0) 47px, rgba(244,247,252,0.035) 47px, rgba(244,247,252,0.035) 48px)',
].join(', ');

function Mark({ role, size, color }: { role: RoleValue; size: number; color: string }) {
  return (
    <div style={{ display: 'flex', color }}>
      <RoleIcon role={role} size={size} />
    </div>
  );
}

function Triangle({ up, size, color }: { up: boolean; size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path d={up ? 'M10 3 L18 16 H2 Z' : 'M2 4 H18 L10 17 Z'} fill={color} />
    </svg>
  );
}

function Gear({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={P.text}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3 M12 18.5v3 M2.5 12h3 M18.5 12h3 M5.3 5.3l2.1 2.1 M16.6 16.6l2.1 2.1 M5.3 18.7l2.1-2.1 M16.6 7.4l2.1-2.1" />
    </svg>
  );
}

function Plus({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3 V17 M3 10 H17" stroke={P.text} strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

function SectionHead({
  glyph,
  title,
  sub,
  width,
}: {
  glyph: ReactNode;
  title: string;
  sub?: string;
  width: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', marginRight: 18 }}>{glyph}</div>
        <div style={{ ...display(HEAD, P.text), letterSpacing: '0.03em' }}>{title}</div>
        {sub === undefined ? null : (
          <div style={{ ...text(30, 400, P.dim), marginLeft: 22, marginTop: 10 }}>{sub}</div>
        )}
      </div>
      <div style={{ height: 2, backgroundColor: P.line, marginTop: 14 }} />
    </div>
  );
}

/**
 * One line from 36 down to 33; else wrapped at spaces at 36; else a one-word name breaks at its
 * camelCase seam; else 30 and broken inside the word.
 */
function nameFit(name: string, room: number): { size: number; wrap: CSSProperties; text?: string } {
  const one = fitSize(name, 'text-bold', room, NAME, NAME_FIT_MIN);
  if (one.fits) return { size: one.size, wrap: { whiteSpace: 'nowrap' } };
  const words = name.split(/\s+/);
  if (words.length > 1 && words.every((word) => fitSize(word, 'text-bold', room, NAME, NAME).fits)) {
    return { size: NAME, wrap: { whiteSpace: 'normal' } };
  }
  // One long word: break at its camelCase seam (`The` / `SHADOWREAPER`) when both halves fit.
  const seam = /^(.*\p{Ll})(\p{Lu}.*)$/u.exec(name);
  if (seam?.[1] !== undefined && seam[2] !== undefined && words.length === 1) {
    const halves = [seam[1], seam[2]];
    const size = Math.min(...halves.map((half) => fitSize(half, 'text-bold', room, NAME, SEAM_MIN).size));
    if (halves.every((half) => fitSize(half, 'text-bold', room, size, size).fits)) {
      return { size, wrap: { whiteSpace: 'pre-line' }, text: halves.join('\n') };
    }
  }
  const last = fitSize(name, 'text-bold', room, NAME_FIT_MIN, NAME_MIN);
  return {
    size: last.size,
    wrap: last.fits ? { whiteSpace: 'nowrap' } : { whiteSpace: 'normal', wordBreak: 'break-word' },
  };
}

function Medallion({ medal, up }: { medal: WeekNotesMedal; up: boolean }) {
  const room = MEDAL_W - 12;
  const name = nameFit(medal.name, room);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: MEDAL_W,
        alignSelf: 'stretch',
      }}
    >
      <div style={{ display: 'flex', position: 'relative', width: RING, height: RING }}>
        <div
          style={{
            display: 'flex',
            width: RING,
            height: RING,
            borderRadius: RING,
            border: `${up ? 4 : 2}px solid ${up ? P.text : P.line}`,
            backgroundColor: P.raised,
            alignItems: 'center',
            justifyContent: 'center',
            ...display(40, up ? P.text : P.dim),
            letterSpacing: '0.02em',
          }}
        >
          {medal.initials}
        </div>
        {medal.role === null ? null : (
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              left: -14,
              top: -8,
              width: 38,
              height: 38,
              borderRadius: 8,
              backgroundColor: P.bg,
              border: `2px solid ${P.line}`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Mark role={medal.role} size={28} color={P.dim} />
          </div>
        )}
      </div>
      <div
        style={{
          ...text(name.size, 700, P.text),
          marginTop: 10,
          width: room,
          textAlign: 'center',
          justifyContent: 'center',
          lineHeight: 1.08,
          ...name.wrap,
        }}
      >
        {name.text ?? medal.name}
      </div>
      {medal.suffix === null ? null : <div style={{ ...text(LABEL, 400, P.dim) }}>{medal.suffix}</div>}
      {/* The points sit on the medallion's bottom edge, level across the row however the names wrap. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          width: MEDAL_W,
          marginTop: 'auto',
          paddingTop: 2,
        }}
      >
        <div style={{ ...mono(NUMBER, 600, up ? P.text : P.dim), lineHeight: '44px' }}>{medal.points}</div>
        <RecordLine wins={medal.wins} losses={medal.losses} size={recordSize(medal)} />
      </div>
    </div>
  );
}

const RECORD = 30;
const RECORD_SMALL = 26;
const POINTS_GAP = 10;

/** `5W 2L`'s four tokens: digits in Martian Mono 500, `W` / `L` in Atkinson 700. */
function recordTokens(wins: number, losses: number) {
  return [{ num: String(wins) }, { word: 'W' }, { num: String(losses) }, { word: 'L' }] as const;
}

function recordWidth(wins: number, losses: number, size: number): number {
  const space = textWidth(' ', 'text-bold', size);
  return recordTokens(wins, losses).reduce(
    (sum, token) =>
      sum + ('num' in token ? textWidth(token.num, 'mono', size) : textWidth(token.word, 'text-bold', size)),
    space,
  );
}

/** 30 px, or 26 when the points and the record would not fit the medallion together. */
function recordSize(medal: WeekNotesMedal): number {
  const points = textWidth(medal.points, 'mono', NUMBER);
  return points + POINTS_GAP + recordWidth(medal.wins, medal.losses, RECORD) <= MEDAL_W - 8
    ? RECORD
    : RECORD_SMALL;
}

/** Pixels the letters sit lower than the digits in a shared line box (`Record` in Cards.tsx, scaled). */
const letterDrop = (size: number) => Math.round((2 * size) / 32);

/**
 * The week's W–L in dim, set per token like the cards' record (5.16 ruling (a)): no space between a
 * digit run and its letter, one space between the pairs. Baselines lined up by hand, because Satori's
 * `baseline` does not line up two faces with different metrics.
 */
function RecordLine({ wins, losses, size }: { wins: number; losses: number; size: number }) {
  // The points' 44 px line box; Martian Mono's baseline sits 0.4 em lower per px of size there.
  const box = '44px';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        marginLeft: POINTS_GAP,
        marginTop: Math.round(0.4 * (NUMBER - size)),
      }}
    >
      {recordTokens(wins, losses).map((token, index) =>
        'num' in token ? (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed tokens; two can be the same digits
            key={index}
            style={{
              ...mono(size, 500, P.dim),
              lineHeight: box,
              marginLeft: index === 0 ? 0 : textWidth(' ', 'text-bold', size),
            }}
          >
            {token.num}
          </div>
        ) : (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed tokens
            key={index}
            style={{ ...text(size, 700, P.dim), lineHeight: box, marginTop: letterDrop(size) }}
          >
            {token.word}
          </div>
        ),
      )}
    </div>
  );
}

function Medals({ medals, up }: { medals: readonly WeekNotesMedal[]; up: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', marginTop: 26 }}>
      {medals.map((medal, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered list; names can repeat
        <Medallion key={index} medal={medal} up={up} />
      ))}
    </div>
  );
}

function Quiet({ line }: { line: string }) {
  return <div style={{ ...text(32, 400, P.dim), marginTop: 22 }}>{line}</div>;
}

function Tile({ tile, grow }: { tile: WeekNotesTile; grow: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '10px 20px 12px',
        backgroundColor: P.card,
        border: `2px solid ${P.line}`,
        borderRadius: 10,
        ...(grow ? { flexGrow: 1, flexBasis: 0 } : {}),
      }}
    >
      <div style={{ ...text(LABEL, 700, P.dim), letterSpacing: '0.05em' }}>{tile.label}</div>
      <div
        style={{
          ...text(fitSize(tile.value, 'text-bold', TILE_ROOM, NAME, TILE_MIN).size, 700, P.text),
          marginTop: 2,
          lineHeight: 1.12,
        }}
      >
        {tile.value}
      </div>
      {tile.sub === null ? null : (
        <div style={{ ...text(SUB, 400, P.dim), marginTop: 2, lineHeight: 1.2 }}>{tile.sub}</div>
      )}
    </div>
  );
}

function KeyBox({ model }: { model: WeekNotesModel['key'] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: KEY_W,
        padding: '18px 22px 20px',
        border: `2px solid ${P.line}`,
        borderRadius: 10,
        backgroundColor: P.card,
      }}
    >
      <div style={{ ...display(30, P.dim), letterSpacing: '0.12em' }}>{model.title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 4 }}>
        {model.roles.map((role) => (
          <div key={role} style={{ display: 'flex', alignItems: 'center', marginTop: 12, marginRight: 26 }}>
            <Mark role={role} size={30} color={P.dim} />
            <div style={{ ...text(30, 700, P.text), marginLeft: 10 }}>{role}</div>
          </div>
        ))}
      </div>
      <div style={{ ...text(LABEL, 400, P.dim), marginTop: 16, lineHeight: 1.25 }}>{model.line}</div>
    </div>
  );
}

export function WeekNotesBoard({ model }: { model: WeekNotesModel }) {
  const { width, height } = WEEK_NOTES_SIZE;
  const systems = model.systems.tiles;
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width,
        height,
        padding: `${PAD_Y}px ${PAD_X}px`,
        backgroundColor: P.bg,
        backgroundImage: LIGHT,
      }}
    >
      {/* Left: wordmark, title, BUFFS, NERFS */}
      <div style={{ display: 'flex', flexDirection: 'column', width: LEFT_W }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 7, height: 30, borderRadius: 2, backgroundColor: P.brand, marginRight: 12 }} />
          <div style={{ ...display(38, P.text), letterSpacing: '0.02em' }}>KUSTOM</div>
          <div
            style={{
              ...text(30, 700, P.text),
              marginLeft: 16,
              maxWidth: LEFT_W - 200,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {model.group}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 16 }}>
          <div style={{ ...display(144, P.text), lineHeight: 0.9, whiteSpace: 'nowrap' }}>{model.week}</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 26, paddingBottom: 4 }}>
            <div style={{ ...display(44, P.dim), letterSpacing: '0.14em' }}>{model.notes}</div>
            <div style={{ ...text(30, 400, P.dim), marginTop: 4 }}>{model.range}</div>
            <div style={{ ...text(30, 400, P.dim) }}>{model.counts}</div>
          </div>
        </div>

        <div style={{ display: 'flex', marginTop: 36 }}>
          <SectionHead
            glyph={<Triangle up size={40} color={P.text} />}
            title={model.buffs.title}
            sub={model.buffs.sub}
            width={LEFT_W - 20}
          />
        </div>
        {model.buffs.empty === null ? (
          <Medals medals={model.buffs.medals} up />
        ) : (
          <Quiet line={model.buffs.empty} />
        )}

        {/* NERFS (at most three) and the KEY beside them, between the board and the right column */}
        <div style={{ display: 'flex', marginTop: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 3 * MEDAL_W }}>
            {model.nerfs === null ? null : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <SectionHead
                  glyph={<Triangle up={false} size={40} color={P.dim} />}
                  title={model.nerfs.title}
                  sub={model.nerfs.sub}
                  width={3 * MEDAL_W - 20}
                />
                <Medals medals={model.nerfs.medals} up={false} />
              </div>
            )}
          </div>
          {/* The key explains medallions, so it shows only beside some. With no NERFS it moves under BUFFS. */}
          {model.buffs.medals.length === 0 && model.nerfs === null ? null : (
            <div style={{ display: 'flex', marginLeft: model.nerfs === null ? -3 * MEDAL_W : 'auto' }}>
              <KeyBox model={model.key} />
            </div>
          )}
        </div>
      </div>

      {/* Right: SYSTEMS and NEW */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: RIGHT_W,
          marginLeft: GAP,
          height: WEEK_NOTES_SIZE.height - 2 * PAD_Y,
          overflow: 'hidden',
        }}
      >
        <SectionHead glyph={<Gear size={46} />} title={model.systems.title} width={RIGHT_W} />
        {model.systems.empty !== null ? (
          <Quiet line={model.systems.empty} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 16 }}>
            {systems.map((tile, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: at most two fixed tiles
                key={index}
                style={{ display: 'flex', marginTop: index === 0 ? 0 : 10 }}
              >
                <Tile tile={tile} grow />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', marginTop: 26 }}>
          <SectionHead glyph={<Plus size={44} />} title={model.news.title} width={RIGHT_W} />
        </div>
        {model.news.empty !== null ? (
          <Quiet line={model.news.empty} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 16 }}>
            {model.news.tiles.map((tile, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: at most three fixed tiles
                key={index}
                style={{ display: 'flex', marginTop: index === 0 ? 0 : 10 }}
              >
                <Tile tile={tile} grow />
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{ display: 'flex', position: 'absolute', left: PAD_X, bottom: 30, ...text(LABEL, 400, P.dim) }}
      >
        {model.footer}
      </div>
    </div>
  );
}

/** The PNG, 1920×1080, fonts from disk. */
export async function weekNotesResponse(model: WeekNotesModel, cacheControl: string): Promise<ImageResponse> {
  return new ImageResponse(<WeekNotesBoard model={model} />, {
    ...WEEK_NOTES_SIZE,
    fonts: await ogFonts(),
    headers: { 'cache-control': cacheControl },
  });
}
