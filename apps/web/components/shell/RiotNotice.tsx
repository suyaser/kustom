import { RIOT_NOTICE } from '@/lib/shellCopy';
import { cn } from '@/lib/utils';

/** Where the notice sits. The class strings live here because `@source` scans `components/`. */
export type RiotNoticePlacement = 'footer' | 'standalone';

const PLACEMENT: Record<RiotNoticePlacement, string> = {
  // Inside the 2.0 footer, under its links.
  footer: '',
  // A page with no footer of its own (admin): its own padded block at the end.
  standalone: 'px-(--gutter) py-6',
};

/**
 * Riot's developer-policy notice (M14.8), verbatim, on every page's footer: the 2.0 shell, the bare
 * shell, admin, and (inlined) `global-error`. Small and
 * muted but real text at `--fs-xs` in `--muted-foreground` (9:1 and up on every surface it sits on).
 * Its own 2.0 root, so it reads the same wherever it is mounted.
 */
export function RiotNotice({ placement = 'footer' }: { placement?: RiotNoticePlacement }) {
  return (
    <p
      data-slot="riot-notice"
      className={cn('max-w-3xl text-xs text-pretty text-muted-foreground', PLACEMENT[placement])}
    >
      {RIOT_NOTICE}
    </p>
  );
}
