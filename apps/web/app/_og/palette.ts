/**
 * The share cards' colours (05-design.md, "Share cards — Open Graph images"): fixed hex, because
 * `ImageResponse` has no CSS variables and no `color-mix()`.
 *
 * **Source: `app/tokens.css`, `[data-theme="night"]`** — the shipped Night values, so the unfurl
 * matches the page the tap opens. If those tokens change, this file changes in the same commit.
 * Always Night: an unfurl has no theme preference.
 */
export const OG_PALETTE = {
  bg: '#05070C',
  line: '#2A3344',
  text: '#F4F7FC',
  dim: '#7D8A9E',
  blue: '#4EA3FF',
  red: '#FF6F68',
  /** The wordmark bar only. No live state exists in a PNG. */
  brand: '#FFC857',
} as const;

/** The shell's one floodlight at 5%, in pixels, fading to the same amber at zero alpha. */
export const OG_LIGHT =
  'radial-gradient(ellipse 1440px 441px at 600px -95px, rgba(255,200,87,0.05), rgba(255,200,87,0) 65%)';
