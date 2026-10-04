import { Chip } from '@/components/ui/chip';
import type { Rich } from '@/lib/receipt/copy';
import { cn } from '@/lib/utils';

/** A `Rich` sentence: names bold in the foreground colour, numbers mono and tabular. */
export function RichText({ rich }: { rich: Rich }) {
  return (
    <>
      {rich.map((part, i) => {
        // Parts are positional and never reorder, so the index is a stable key.
        const key = i;
        if (typeof part === 'string') return part;
        if ('strong' in part) {
          return (
            <b key={key} className="font-bold text-foreground">
              {part.strong}
            </b>
          );
        }
        return (
          <span key={key} className="num font-stretch-88%">
            {part.num}
          </span>
        );
      })}
    </>
  );
}

/**
 * A receipt chip (5.5): a static span, the words muted, the `num` parts mono in the foreground
 * colour. The spaces live in the text parts, so the chip's text is the plain string Discord prints.
 */
export function ReceiptChip({ chip }: { chip: Rich }) {
  return (
    <Chip className="inline-block min-h-[34px] px-2.5 py-1 text-xs">
      {chip.map((part, i) => {
        const key = i;
        if (typeof part === 'string') return <span key={key}>{part}</span>;
        const text = 'strong' in part ? part.strong : part.num;
        return (
          <b key={key} className="num text-[0.875rem] font-semibold text-foreground font-stretch-78%">
            {text}
          </b>
        );
      })}
    </Chip>
  );
}

export function ChipRow({ chips, className }: { chips: readonly Rich[]; className?: string | undefined }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {chips.map((chip, i) => {
        const key = i;
        return <ReceiptChip key={key} chip={chip} />;
      })}
    </div>
  );
}
