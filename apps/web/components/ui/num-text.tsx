/**
 * A short label that mixes words and numbers (`5 Oct · 31 min`), set by 05-design 4's rule:
 * the digits in mono (`.num`), the words in the text face (M18.7 design review). The text reads
 * exactly as the string, so tests and screen readers see the same words.
 */
export function NumText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((piece, index) =>
        piece === '' ? null : /^\d+$/.test(piece) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed string.
          <span key={index} className="num">
            {piece}
          </span>
        ) : (
          piece
        ),
      )}
    </>
  );
}
