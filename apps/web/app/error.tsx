'use client';

import { BareShell } from '@/components/shell/BareShell';
import { ErrorView } from '@/components/shell/ErrorView';
import { BACK_TO_KUSTOM_LABEL } from '@/lib/shellCopy';

/**
 * Anything that failed above a group's own boundary: the group layout itself (its group lookup), or a
 * page outside `/g/` (M14.7, 05-design.md 5.8). No group is known, so the bare shell.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <BareShell>
      <ErrorView error={error} reset={reset} back={{ label: BACK_TO_KUSTOM_LABEL, href: '/' }} />
    </BareShell>
  );
}
