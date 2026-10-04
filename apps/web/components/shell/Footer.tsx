import type { Route } from 'next';
import Link from 'next/link';
import { GET_KUSTOM_LABEL, HOW_THE_BOT_DECIDES_LABEL, WHATS_KUSTOM_LABEL } from '@/lib/shellCopy';
import { RiotNotice } from './RiotNotice';

/**
 * The 2.0 footer (M14.7, M14.7b, M14.8, M14.24; STRATEGY 2.5), on every page that has a shell.
 *
 * - `How the bot decides` -> `/how` (M14.24 replaced M14.7b's in-footer disclosure with the page).
 * - `Get Kustom` -> `/download`, which explains the app and links the releases page (never the exe).
 * - `What's Kustom?` -> `/about`, on group pages only (`inGroup`): the landing page that never
 *   redirects, for a member who wants to see what their friends signed them up for.
 * - Riot's notice, verbatim (`RiotNotice`).
 * - While a tab's pending frame shows (`<main aria-busy>`, M19.15) it is not drawn: the frame holds
 *   the first screen only, so the footer would sit at the fold and jump when a shorter page lands
 *   (a layout shift past the tap's 500 ms input window). Appearing again is not a shift.
 */
const LINK = 'inline-flex min-h-11 items-center underline underline-offset-3 hover:text-foreground';

export function Footer({ inGroup = false }: { inGroup?: boolean }) {
  return (
    <footer className="mt-auto border-t border-border [main[aria-busy=true]~&]:hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-(--gutter) py-4 text-sm text-muted-foreground">
        <nav aria-label="About Kustom" className="flex flex-wrap items-start gap-x-6">
          <Link href={'/how' as Route} className={LINK}>
            {HOW_THE_BOT_DECIDES_LABEL}
          </Link>
          <Link href={'/download' as Route} className={LINK}>
            {GET_KUSTOM_LABEL}
          </Link>
          {inGroup ? (
            <Link href={'/about' as Route} className={LINK}>
              {WHATS_KUSTOM_LABEL}
            </Link>
          ) : null}
        </nav>
        <RiotNotice />
      </div>
    </footer>
  );
}
