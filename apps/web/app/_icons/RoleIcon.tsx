import type { RoleValue } from '@customs/db';

/**
 * The five role marks (05-design.md, "Iconography"). Inline SVG drawn in this repo, one
 * component, five paths, `currentColor`, 24×24, 2px stroke, round caps, no fill — there is no
 * asset pipeline in this project and there should not be one.
 *
 * **The icon never appears without its word.** It is an anchor for the eye in a dense row, not
 * a replacement for language, so it is always `aria-hidden` and the word beside it is the
 * accessible name.
 *
 * Colour comes from the row: `dim` normally, `brand` when the seat is off-role, and never a
 * side colour — a role is not a team.
 */

/** The lane frame, on the three lanes that are one. Jungle and support are shapes of their own. */
const FRAMED: ReadonlySet<RoleValue> = new Set<RoleValue>(['top', 'mid', 'adc']);

/**
 * The three lane marks are drawn **inside** the frame rather than on it: at 14px the original
 * geometry put a 2px stroke on the frame's own edge and the two merged into a filled square
 * (the designer, 2026-09-09). Jungle and support are unchanged.
 */
const PATHS: Record<RoleValue, readonly string[]> = {
  top: ['M8 16 V8 H16'],
  jungle: ['M18 6 C9 6 6 9 6 18 C15 18 18 15 18 6 Z', 'M9 15 L15 9'],
  mid: ['M8 16 L16 8'],
  adc: ['M8 16 H16 V8'],
  support: ['M12 4 L19 7 v5 c0 4 -3 6.5 -7 8 c-4 -1.5 -7 -4 -7 -8 V7 Z'],
};

export function RoleIcon({ role, size = 14 }: { role: RoleValue; size?: number }) {
  return (
    <svg
      className="shrink-0"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {FRAMED.has(role) ? <rect x="3.5" y="3.5" width="17" height="17" rx="4" opacity="0.3" /> : null}
      {PATHS[role].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
