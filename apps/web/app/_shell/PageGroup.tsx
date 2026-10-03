'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { ORIGINAL_GROUP, type PageGroup } from '@/lib/groups/pageGroup';

/**
 * The page's group, for the client components under `/g/[slug]` (M13.9): the tonight page's four
 * controls put its id in every `/api/me/*` and `/api/admin/*` body (M13.4), and the tape, the
 * rail and the daily pointer build their links from its slug (`lib/nav.ts`).
 *
 * Provided once, by `app/(group)/g/[slug]/layout.tsx`, from the group the server resolved from
 * the URL. A context rather than a prop threaded through `TonightLive` → `TonightView` → a
 * block → a control: four levels of a prop nobody in between reads.
 *
 * **The default is the original group**, which is exactly what every one of these components
 * hard-coded before M13.9. It is what a component test renders without a provider; on a page,
 * every group-scoped component sits under the layout's provider.
 */
const PageGroupContext = createContext<PageGroup>(ORIGINAL_GROUP);

export function PageGroupProvider({ group, children }: { group: PageGroup; children?: ReactNode }) {
  return <PageGroupContext.Provider value={group}>{children}</PageGroupContext.Provider>;
}

export function usePageGroup(): PageGroup {
  return useContext(PageGroupContext);
}
