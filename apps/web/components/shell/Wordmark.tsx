import { WORDMARK } from '@/lib/nav';

/**
 * The KUSTOM lockup's mark (05-design.md 5.11, 7.1): a 5x22 `--primary-text` bar, the lamp, then the
 * six letters in the condensed display cut. A logo, so the one other place Archivo is allowed.
 */
export function Wordmark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <span aria-hidden="true" className="h-[22px] w-[5px] rounded-[2px] bg-primary-text" />
      <span className="font-display text-[1.5rem] leading-none font-black tracking-[0.02em] uppercase font-stretch-62%">
        {WORDMARK}
      </span>
    </span>
  );
}
