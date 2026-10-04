import type { Sentence } from '@/lib/breakdown/copy';

/** One sentence: text parts as text, `{ num }` parts in mono. */
export function SentenceText({ sentence, lead = false }: { sentence: Sentence; lead?: boolean }) {
  return (
    <>
      {lead ? ' ' : null}
      {sentence.map((part, index) =>
        typeof part === 'string' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed sentence.
          <span key={index}>{part}</span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed sentence.
          <span key={index} className="num">
            {part.num}
          </span>
        ),
      )}
    </>
  );
}
