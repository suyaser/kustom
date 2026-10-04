'use client';

import { usePathname } from 'next/navigation';
import { usePageGroup } from '@/app/_shell/PageGroup';
import { BOARD_TAB_LABEL, groupBase, groupHome, groupHref } from '@/lib/nav';
import {
  BACK_TO_TONIGHT_LABEL,
  NOT_FOUND_TITLE,
  notFoundGameReason,
  notFoundInGroupReason,
  notFoundPlayerReason,
} from '@/lib/shellCopy';
import { StatusPage } from './StatusPage';

/** What the path under `/g/<slug>` was asking for, as far as a 404 can tell. */
export type MissingThing = 'game' | 'player' | 'page';

export function missingThing(pathname: string, base: string): MissingThing {
  const rest = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split('/') : [];
  if (rest[0] === 'games' && rest.length >= 2 && rest[1] !== '') return 'game';
  if (rest[0] === 'p' && rest.length >= 2 && rest[1] !== '') return 'player';
  return 'page';
}

/**
 * The group-scoped 404 (05-design.md 5.8): the shell stays, the h1 is `Page not found`, and the reason
 * names what was missing where the path says (a game, a player) and the group by name. A client
 * component because a not-found file gets no params: the path comes from `usePathname`, the group from
 * the layout's provider. Then `Back to tonight` and, when the group has one, the board.
 */
export function GroupNotFound() {
  const group = usePageGroup();
  const pathname = usePathname();
  const thing = missingThing(pathname, groupBase(group));
  const reason =
    thing === 'game'
      ? notFoundGameReason(group.name)
      : thing === 'player'
        ? notFoundPlayerReason(group.name)
        : notFoundInGroupReason(group.name);
  const board = groupHref(group, { page: 'leaderboard' });

  return (
    <StatusPage
      title={NOT_FOUND_TITLE}
      reason={reason}
      primary={{ label: BACK_TO_TONIGHT_LABEL, href: groupHome(group) }}
      secondary={board === null ? undefined : { label: BOARD_TAB_LABEL, href: board }}
    />
  );
}
