import type { MainTabKey } from '@/lib/nav';

/**
 * The five section icons (redesign/nav/proposal.md option A; 05-design.md 5.11): Tonight a lamp,
 * Board bars, Games a grid, Stats a trophy, You a head and shoulders (a glyph, not an avatar, so
 * Principle 6 holds). Inline SVG, 24px, `currentColor`, RoleIcon's stroke family, hidden from screen
 * readers because the word is always beside them. `active` fills the closed shapes, so the current tab
 * differs by shape as well as colour.
 */
export function TabIcon({ tab, active }: { tab: MainTabKey; active: boolean }) {
  const fill = active ? 'currentColor' : 'none';
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="size-6 shrink-0"
    >
      {tab === 'tonight' ? (
        <>
          <path d="M12 3v3M5.6 5.6l2.1 2.1M18.4 5.6l-2.1 2.1M4 21h16" />
          <path d="M7 21 9 12h6l2 9Z" fill={fill} />
        </>
      ) : null}
      {tab === 'board' ? (
        <>
          <rect x="4" y="10" width="4" height="10" fill={fill} />
          <rect x="10" y="4" width="4" height="16" fill={fill} />
          <rect x="16" y="13" width="4" height="7" fill={fill} />
        </>
      ) : null}
      {tab === 'games' ? (
        <>
          <rect
            x="4"
            y="4"
            width="16"
            height="16"
            rx="2"
            fill={fill}
            fillOpacity={active ? 0.3 : undefined}
          />
          <path d="M4 9h16M4 14h16M9 4v16" />
        </>
      ) : null}
      {tab === 'stats' ? (
        <>
          <path d="M8 4h8v5a4 4 0 0 1-8 0Z" fill={fill} />
          <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8" />
        </>
      ) : null}
      {tab === 'you' ? (
        <>
          <circle cx="12" cy="8" r="4" fill={fill} />
          <path d="M4 21c1.4-4 4.4-6 8-6s6.6 2 8 6" />
        </>
      ) : null}
    </svg>
  );
}
