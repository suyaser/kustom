import type { ReactNode } from 'react';
import { siteMetadataBase } from '@/lib/og/meta';
import { THEME_BOOTSTRAP, THEME_COLOR, THEME_DEFAULT } from '@/lib/theme';
// The three webfonts, and why each is loaded the way it is.
import { fontVariables } from './fonts';
// Kustom 2.0's tokens, Tailwind and the base styles (M14.1; the only stylesheet since M14.25).
import './globals.css';

/**
 * The product is **Kustom** (M3.21): the wordmark, the browser tab and the WhatsApp link
 * preview all say it. The repo's codename stays in `CLAUDE.md`, the docs and the package
 * names, and appears nowhere under `apps/web`.
 */
export const metadata = {
  // WhatsApp and Discord do not resolve a relative `og:image` (M11.4).
  metadataBase: siteMetadataBase(),
  title: 'Kustom',
  description: 'Team balancer and stats tracker for nightly League customs.',
};

/**
 * `viewport-fit` and no user scaling limits: the page is read at arm's length and a friend
 * must be able to zoom it. Phone chrome follows Night until the toggle writes Day.
 */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: THEME_COLOR[THEME_DEFAULT],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables} data-theme={THEME_DEFAULT} suppressHydrationWarning>
      <body>
        {/*
          The theme, before first paint: a blocking inline script, first in <body>, so it runs before
          anything below it is painted. Raw HTML on a hidden wrapper rather than `next/script` or a
          <script> element (M14.7): when a page or layout calls notFound(), Next renders this layout on
          the client, and React warns on every <script> element it creates there ("Encountered a script
          tag..."). React never creates this one: on the server it is markup, and on the client it is an
          innerHTML string, whose script does not run again (the server copy already did).
        */}
        <div
          hidden
          // biome-ignore lint/security/noDangerouslySetInnerHtml: THEME_BOOTSTRAP is a constant
          dangerouslySetInnerHTML={{ __html: `<script id="cn-theme">${THEME_BOOTSTRAP}</script>` }}
        />
        {children}
      </body>
    </html>
  );
}
