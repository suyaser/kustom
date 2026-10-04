import type { ReactNode } from 'react';
import { BareShell } from '@/components/shell/BareShell';

/** `/ops` (M14.23): Kustom-level, across groups, so the bare shell (wordmark, footer, no tabs). */
export default function OpsLayout({ children }: { children: ReactNode }) {
  return <BareShell>{children}</BareShell>;
}
