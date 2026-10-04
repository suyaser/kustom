import { ADMIN_VIEWER, ANON_VIEWER, MEMBER_VIEWER } from '@/app/_tonight/fixtures';
import type { TonightSnapshot } from '@/lib/tonight/types';
import type { ViewerState } from '@/lib/tonight/viewer';

/**
 * The kit's `?viewer=` (dev only). `lead` is an admin, `anon` nobody, and `unlinked` (M14.42,
 * scene-walk gap 15) the signed-in friend with no player row yet: the one Tonight state the live walk
 * could not reach, which draws the `That's me` list. Its `claimable` is every lobby member but the
 * first, standing in for a friend who already linked (the server never offers a claimed row,
 * `lib/me/claimable.ts`). `member` (M14.78) is a linked friend who is not an admin, for the states
 * whose fixture looks as an admin (`over-ten`): no Roll, and the waiting line naming the admins.
 * Anything else keeps the fixture's own viewer.
 */
export function kitViewer(
  param: string | undefined,
  fixture: { viewer: ViewerState; snapshot: TonightSnapshot },
): ViewerState {
  if (param === 'lead') return ADMIN_VIEWER;
  if (param === 'anon') return ANON_VIEWER;
  if (param === 'member') return MEMBER_VIEWER;
  if (param === 'unlinked') {
    const members = fixture.snapshot.lobby?.members ?? [];
    return { kind: 'unlinked', claimable: members.slice(1).map((member) => member.puuid) };
  }
  return fixture.viewer;
}
