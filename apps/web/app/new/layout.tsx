import type { ReactNode } from 'react';
import { BareShell } from '@/components/shell/BareShell';

/**
 * Kustom-level pages with no group yet (M14.21): the bare shell (wordmark, footer with Riot's notice),
 * no tabs. Neither `/new` nor `/join/<code>` is in any group's nav.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <BareShell>{children}</BareShell>;
}
