import type { ReactNode } from 'react';
import { RiotNotice } from '@/components/shell/RiotNotice';

/**
 * The layout of what is left under `/admin`: the sign-in page (`/admin/login`), in 2.0 since the
 * M14.23 follow-up. Group admin lives at `/g/<slug>/admin`; bare `/admin` 308s there for the
 * original group. Riot's notice is in the footer of every page (M14.8).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-page text-foreground">
      {children}
      <footer className="border-t border-border px-(--gutter) py-6">
        <div className="mx-auto w-full max-w-7xl">
          <RiotNotice placement="standalone" />
        </div>
      </footer>
    </div>
  );
}
