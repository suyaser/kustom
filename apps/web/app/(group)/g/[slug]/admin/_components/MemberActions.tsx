'use client';

import {
  CONFIRM_MAKE_ADMIN_BODY,
  CONFIRM_MAKE_MEMBER_BODY,
  confirmMakeAdminTitle,
  confirmMakeMemberTitle,
  confirmMakeOwnerBody,
  confirmMakeOwnerTitle,
  confirmRemoveBody,
  confirmRemoveTitle,
  MAKE_ADMIN_LABEL,
  MAKE_MEMBER_LABEL,
  MAKE_OWNER_LABEL,
  REMOVE_LABEL,
} from '@/lib/admin/homeCopy';
import type { MemberAction } from '@/lib/admin/memberActions';
import { ConfirmAction } from './ConfirmAction';

/**
 * A member row's buttons (STRATEGY 3.5), each behind its confirm, each posting to its M14.11 route
 * with the page's group. Visible 44px buttons that wrap, never a `⋯` menu (05-design 5.12). The page
 * refreshes after a success (`ConfirmAction`'s own refresh, held pending until it lands: M19.3), so the
 * row redraws from the database rather than from a guess.
 */
export function MemberActions({
  groupId,
  playerId,
  name,
  actions,
}: {
  groupId: string;
  playerId: string;
  name: string;
  actions: readonly MemberAction[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => {
        switch (action) {
          case 'make-admin':
            return (
              <ConfirmAction
                key={action}
                label={MAKE_ADMIN_LABEL}
                tone="secondary"
                title={confirmMakeAdminTitle(name)}
                body={CONFIRM_MAKE_ADMIN_BODY}
                actionLabel={MAKE_ADMIN_LABEL}
                url="/api/admin/members/role"
                payload={{ groupId, playerId, role: 'admin' }}
              />
            );
          case 'make-member':
            return (
              <ConfirmAction
                key={action}
                label={MAKE_MEMBER_LABEL}
                tone="destructive"
                title={confirmMakeMemberTitle(name)}
                body={CONFIRM_MAKE_MEMBER_BODY}
                actionLabel={MAKE_MEMBER_LABEL}
                url="/api/admin/members/role"
                payload={{ groupId, playerId, role: 'member' }}
              />
            );
          case 'make-owner':
            return (
              <ConfirmAction
                key={action}
                label={MAKE_OWNER_LABEL}
                tone="secondary"
                title={confirmMakeOwnerTitle(name)}
                body={confirmMakeOwnerBody(name)}
                actionLabel={MAKE_OWNER_LABEL}
                url="/api/admin/owner/transfer"
                payload={{ groupId, playerId }}
              />
            );
          case 'remove':
            return (
              <ConfirmAction
                key={action}
                label={REMOVE_LABEL}
                tone="destructive"
                title={confirmRemoveTitle(name)}
                body={confirmRemoveBody(name)}
                actionLabel={REMOVE_LABEL}
                url="/api/admin/members/remove"
                payload={{ groupId, playerId }}
              />
            );
        }
        return null;
      })}
    </div>
  );
}
