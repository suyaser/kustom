import type { ReactNode } from 'react';
import { KustomSignIn } from '@/components/landing/KustomSignIn';
import { BareShell } from '@/components/shell/BareShell';

/**
 * Kustom's own pages (M14.24; STRATEGY 2.1, 2.5): `/` (the landing page, or a redirect to your
 * group), `/about`, `/how`, `/download`. The bare shell: the wordmark, `Sign in`, no group tabs, and
 * the footer with Riot's notice.
 */
export default function KustomLayout({ children }: { children: ReactNode }) {
  return <BareShell headerEnd={<KustomSignIn />}>{children}</BareShell>;
}
