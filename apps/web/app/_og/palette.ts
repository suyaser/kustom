/**
 * The share cards' colours: fixed hex, because `ImageResponse` has no CSS variables and no
 * `color-mix()`.
 *
 * **Source: `docs/05-design.md` 7.3, Night** (the primitives `app/globals.css` declares), so the
 * unfurl matches the page the tap opens. If those tokens change, this file changes in the same
 * commit. Always Night: an unfurl has no theme preference.
 */
export const OG_PALETTE = {
  /** `--background` (slate-0, 1.0's deep blue-black): the whole card, one plane. */
  bg: '#05070C',
  /** `--border` (slate-3): the one hairline, the losing side's rule. */
  line: '#2A3344',
  /** `--foreground` (slate-9): names, headline, the player number. */
  text: '#F4F7FC',
  /** `--muted-foreground` (slate-7): slug, duration, sentence, labels. Never a name. */
  dim: '#8B98AD',
  /** `--team-blue` (azure-400): side 100. */
  blue: '#2E9BFF',
  /** `--team-red` (vermilion-400): side 200. */
  red: '#FF6B35',
  /** `--primary-text` (amber-400): the wordmark bar only. No live state exists in a PNG. */
  brand: '#FFCF66',
  /** A raised plane behind a medallion's initials (the week notes image, M14.79). */
  raised: '#141B28',
  /** A card plane: the week notes' tiles and KEY box (M14.79). */
  card: '#0C121A',
} as const;

/**
 * Night's `--page-light` (7.3: the azure lamp top-left at 16%, the amber lamp top-right at 12%, the
 * 48px pitch grid at 4%), in pixels for the 1200px card. Each lamp fades to its own colour at zero
 * alpha, not to `transparent`: some renderers interpolate through black and draw a grey band.
 */
export const OG_LIGHT = [
  'radial-gradient(ellipse 1080px 760px at 96px -140px, rgba(46,155,255,0.16), rgba(46,155,255,0) 58%)',
  'radial-gradient(ellipse 960px 700px at 1152px -120px, rgba(255,207,102,0.12), rgba(255,207,102,0) 52%)',
  'repeating-linear-gradient(0deg, rgba(244,247,252,0) 0px, rgba(244,247,252,0) 47px, rgba(244,247,252,0.04) 47px, rgba(244,247,252,0.04) 48px)',
  'repeating-linear-gradient(90deg, rgba(244,247,252,0) 0px, rgba(244,247,252,0) 47px, rgba(244,247,252,0.04) 47px, rgba(244,247,252,0.04) 48px)',
].join(', ');
