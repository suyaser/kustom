import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { THEME_BOOTSTRAP, THEME_COLOR, THEME_DEFAULT } from '@/lib/theme';
import './tokens.css';
import './theme-gaming.css';
import './theme-current.css';

/**
 * The two families of `docs/05-design.md`: Archivo for anything read as language, IBM Plex
 * Mono for anything read as data. They are exposed as CSS variables and composed into
 * `--cn-font-sans` / `--cn-font-mono` in `tokens.css`, which is where the fallback stacks live.
 *
 * Archivo is loaded as a **variable font with the width axis** (Floodlit, "Type"), which buys
 * the display cut — `wdth` 118 at weight 800, the wordmark, the lobby count and the result
 * headline — with no second download. `.cn-display` in `tokens.css` is the only place that
 * asks for it; if the axis ever fails to load the page falls back to plain Archivo 800 and
 * loses a little character and nothing else.
 *
 * `display: 'swap'` because the first paint carries content: a friend opening the WhatsApp
 * link should read the teams in the fallback face rather than wait for a webfont.
 */
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--cn-font-archivo',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--cn-font-plex-mono',
});

/**
 * The product is **Kustom** (M3.21): the wordmark, the browser tab and the WhatsApp link
 * preview all say it. The repo's codename stays in `CLAUDE.md`, the docs and the package
 * names, and appears nowhere under `apps/web`.
 */
export const metadata = {
  title: 'Kustom',
  description: 'Team balancer and stats tracker for nightly League customs.',
};

/**
 * `viewport-fit` and no user scaling limits: the page is read at arm's length and a friend
 * must be able to zoom it. `themeColor` is Day's paper; the toggle rewrites the meta tag.
 */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: THEME_COLOR[THEME_DEFAULT],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable}`}
      data-theme={THEME_DEFAULT}
      suppressHydrationWarning
    >
      <body>
        <Script id="cn-theme" strategy="beforeInteractive">
          {THEME_BOOTSTRAP}
        </Script>
        {children}
      </body>
    </html>
  );
}
