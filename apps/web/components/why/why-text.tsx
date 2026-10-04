import type { DeltaReason } from '@customs/core';
import { EXPLAIN_FOOTNOTE, type ExplainSubject, explainSentences } from '@/lib/breakdown/copy';
import { renderWebName } from '@/lib/tonight/copy';
import type { PlayerName } from '@/lib/tonight/types';
import { SentenceText } from './sentence';

/**
 * The words inside a `WhyPanel` (M14.58): at most four short sentences from `explainSentences`,
 * numbers in mono at the text's size (05-design 6.12), then the small footnote. A server component:
 * the copy never ships to the phone as code, only as text.
 */
export function WhyText({ reason, subject }: { reason: DeltaReason; subject: ExplainSubject }) {
  return (
    <>
      <p className="text-sm text-pretty text-foreground">
        {explainSentences(reason, subject).map((sentence, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered list that never reorders.
          <SentenceText key={index} sentence={sentence} lead={index > 0} />
        ))}
      </p>
      <p className="text-xs text-pretty text-muted-foreground">{EXPLAIN_FOOTNOTE}</p>
    </>
  );
}

/** `You` for the signed-in viewer's own row, the printed name for anybody else's. */
export function subjectFor(puuid: string, viewerPuuid: string | null, name: PlayerName): ExplainSubject {
  return viewerPuuid !== null && puuid === viewerPuuid
    ? { kind: 'you' }
    : { kind: 'name', name: renderWebName(name) };
}
