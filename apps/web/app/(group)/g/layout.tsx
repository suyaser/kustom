import type { ReactNode } from 'react';

/**
 * A pass-through, here for one reason (M14.7): a layout is what gives a segment its own not-found
 * boundary, and `[slug]/layout.tsx` calls `notFound()` for an unknown group. Without this layout that
 * call would fall through to the site's generic 404; with it, `./not-found.tsx` answers with the
 * unknown-group sentence.
 */
export default function GroupsLayout({ children }: { children: ReactNode }) {
  return children;
}
