import type { ReactNode } from 'react';
import type { Sentence } from '@/lib/breakdown/copy';

/**
 * The words a screen reader says for the two glyphs of an inline sum (05-design 11.6.5):
 * `16 × 44% = 7` reads `16 times 44 percent equals 7`, and `×1.2` reads `times 1.2`.
 */
const SPOKEN_GLYPH: Readonly<Record<string, string>> = { '×': 'times', '=': 'equals' };

/**
 * A text part with its `×` and `=` set apart: the glyph `aria-hidden`, its word `sr-only` with a
 * space each side, so the spoken text never runs `times` into the number after it.
 */
function textWithGlyphs(text: string, key: string): ReactNode {
  if (!/[×=]/.test(text)) return <span key={key}>{text}</span>;
  return (
    <span key={key}>
      {text.split(/([×=])/).map((piece, index) => {
        const word = SPOKEN_GLYPH[piece];
        if (word === undefined) return piece === '' ? null : piece;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed string.
          <span key={index}>
            <span aria-hidden="true">{piece}</span>
            <span className="sr-only">{` ${word} `}</span>
          </span>
        );
      })}
    </span>
  );
}

/** One sentence: text parts as text, `{ num }` parts in mono. */
export function SentenceText({ sentence, lead = false }: { sentence: Sentence; lead?: boolean }) {
  return (
    <>
      {lead ? ' ' : null}
      {sentence.map((part, index) =>
        typeof part === 'string' ? (
          textWithGlyphs(part, String(index))
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed sentence.
          <span key={index} className="num text-[0.92em]">
            {part.num}
          </span>
        ),
      )}
    </>
  );
}
