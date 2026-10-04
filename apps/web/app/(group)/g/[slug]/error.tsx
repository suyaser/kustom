'use client';

import { ErrorView } from '@/components/shell/ErrorView';
import { groupHome } from '@/lib/nav';
import { BACK_TO_TONIGHT_LABEL } from '@/lib/shellCopy';
import { usePageGroup } from '../../../_shell/PageGroup';

/** A page under a known group failed (M14.7, 05-design.md 5.8). The group's shell stays around it. */
export default function GroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const group = usePageGroup();
  return (
    <ErrorView error={error} reset={reset} back={{ label: BACK_TO_TONIGHT_LABEL, href: groupHome(group) }} />
  );
}
