import type { CSSProperties, ReactNode } from 'react';
import { OG_DISPLAY, OG_TEXT } from '../../app/_og/fonts.ts';
import { OG_PALETTE as P } from '../../app/_og/palette.ts';
import { Plus, SectionHead, Triangle, WEEK_NOTES_LIGHT } from '../../app/_og/WeekNotes.tsx';
import {
  BULLET,
  COLUMN_GAP,
  columnWidth,
  HEAD_GAP,
  HEADER_GAP,
  INDENT,
  ITEM_GAP,
  LINE_HEIGHT,
  NOTICE,
  PAD_X,
  PAD_Y,
  PATCH_NOTES_SIZE,
  SECTION_GAP,
} from './layout.ts';
import type { PatchNotes, PatchNotesKind } from './notes.ts';

/**
 * The one-time "Kustom 2.0 patch notes" picture: the week notes picture's look (05-design 5.16
 * ruling (g), `app/_og/WeekNotes.tsx`) on a page of text. The header, then one column per entry of
 * `notes.columns`, each section a week-notes section head over square-bulleted lines, the notice
 * along the bottom. Every string arrives in `notes`; nothing here composes copy.
 *
 * Kustom's own look, never Riot's: no Riot logo, fonts or icons, no champion art. No green and no
 * red: BUFFS and NERFS are told apart by word and by ▲ / ▼ (a NERFS glyph is `dim`), as in the week
 * notes picture.
 *
 * Satori lays out flexbox only: every element with more than one child says `display: flex`.
 */

const text = (size: number, weight: 400 | 700, color: string): CSSProperties => ({
  fontFamily: OG_TEXT,
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

/** The rating section's mark: a line that climbs, in the week notes' 2.2 stroke. */
function Climb({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={P.text}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 18 L9 12 L13 15 L21 6 M15 6 H21 V12" />
    </svg>
  );
}

function glyph(kind: PatchNotesKind): ReactNode {
  switch (kind) {
    case 'new':
      return <Plus size={44} />;
    case 'rating':
      return <Climb size={46} />;
    case 'buffs':
      return <Triangle up size={40} color={P.text} />;
    case 'nerfs':
      return <Triangle up={false} size={40} color={P.dim} />;
  }
}

function Line({ line, size, width }: { line: string; size: number; width: number }) {
  const box = Math.ceil(size * LINE_HEIGHT);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', width }}>
      <div
        style={{
          width: BULLET,
          height: BULLET,
          marginTop: Math.round((box - BULLET) / 2),
          marginRight: INDENT - BULLET,
          backgroundColor: P.dim,
          flexShrink: 0,
        }}
      />
      <div style={{ ...text(size, 400, P.text), lineHeight: `${box}px`, width: width - INDENT }}>{line}</div>
    </div>
  );
}

export function PatchNotesBoard({ notes, size }: { notes: PatchNotes; size: number }) {
  const { width, height } = PATCH_NOTES_SIZE;
  const col = columnWidth(notes.columns.length);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        width,
        height,
        padding: `${PAD_Y}px ${PAD_X}px`,
        backgroundColor: P.bg,
        backgroundImage: WEEK_NOTES_LIGHT,
      }}
    >
      {/* Header: the wordmark row, then the version large with PATCH NOTES beside it */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: 7, height: 30, borderRadius: 2, backgroundColor: P.brand, marginRight: 12 }} />
        <div style={{ ...display(38, P.text), letterSpacing: '0.02em' }}>{notes.wordmark}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 16 }}>
        <div style={{ ...display(144, P.text), lineHeight: 0.9, whiteSpace: 'nowrap' }}>{notes.version}</div>
        <div style={{ ...display(72, P.dim), letterSpacing: '0.14em', marginLeft: 30, paddingBottom: 6 }}>
          {notes.notes}
        </div>
      </div>

      <div style={{ display: 'flex', marginTop: HEADER_GAP }}>
        {notes.columns.map((column, c) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered layout
            key={c}
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: col,
              marginLeft: c === 0 ? 0 : COLUMN_GAP,
            }}
          >
            {column.map((section, s) => (
              <div
                key={section.title}
                style={{ display: 'flex', flexDirection: 'column', marginTop: s === 0 ? 0 : SECTION_GAP }}
              >
                <SectionHead glyph={glyph(section.kind)} title={section.title} width={col} />
                <div style={{ display: 'flex', flexDirection: 'column', marginTop: HEAD_GAP }}>
                  {section.lines.map((line, l) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered list
                    <div key={l} style={{ display: 'flex', marginTop: l === 0 ? 0 : ITEM_GAP }}>
                      <Line line={line} size={size} width={col} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: PAD_X,
          bottom: 30,
          ...text(NOTICE, 400, P.dim),
        }}
      >
        {notes.footer}
      </div>
    </div>
  );
}
