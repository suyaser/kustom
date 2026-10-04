import { Archivo, Atkinson_Hyperlegible_Next, Martian_Mono } from 'next/font/google';

/**
 * Every webfont the app loads, as CSS variables on <html> (the root layout). `docs/05-design.md`
 * section 4: Atkinson Hyperlegible Next for text, Martian Mono (with its `wdth` axis, 75 to 112.5)
 * for numbers and role words, and Archivo (its condensed `wdth` end) for the display face.
 * `app/globals.css` maps them to `font-sans`, `font-mono` and `font-display`.
 *
 * All three are preloaded: every page draws all three above the fold (since M14.25, when the last
 * page that never drew the two text faces went).
 *
 * `display: 'swap'` everywhere: the first paint carries content, and a friend opening the
 * WhatsApp link should read the teams in the fallback face rather than wait for a webfont.
 */
export const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-archivo',
});

/**
 * `latin-ext` matters: real names include `Ramzyinhović` and `Menaçe`. `adjustFontFallback` is off
 * because Next 16.3 ships no metrics for this family; the size-matched `"Atkinson Fallback"` face is
 * declared in `globals.css` instead (05-design.md section 4 and 7.3).
 */
export const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  adjustFontFallback: false,
  variable: '--font-atkinson',
});

export const martian = Martian_Mono({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-martian',
});

/** The class list for <html>: defines the three variables and nothing else. */
export const fontVariables = [archivo, atkinson, martian].map((font) => font.variable).join(' ');
