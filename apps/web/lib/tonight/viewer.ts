/**
 * Who is reading the tonight page, as the page has to branch on it (M3.6).
 *
 * Until M3.6 there were two answers — a linked player, or nobody — and `null` served for both.
 * The role tap needs three, because the middle one is the day-one case for **everybody**: a
 * friend who has signed in with Discord and matches no `players` row yet. That visitor is not
 * anonymous (they have an identity we can write) and not linked (there is no row to tap), and
 * the page owes them the `That's me` list rather than a sign-in button they have already
 * pressed.
 *
 * A discriminated union rather than two nullable fields, per `CLAUDE.md`: `puuid` exists on
 * exactly the state that has one, so no component can read it from a visitor who has none.
 *
 * This file is deliberately free of `next/headers` and of any Supabase import: it is the type
 * the client components share with `lib/viewer.ts`, which is the server half.
 */
export type ViewerState =
  | { kind: 'anonymous' }
  /**
   * Signed in with Discord, matching no player row. `claimable` is the PUUIDs of tonight's
   * lobby members **nobody is linked to yet**, decided on the server (`lib/me/claimable.ts`):
   * the `That's me` list is exactly these, and a player who already carries a Discord id is
   * not offered. No Discord id and no fact about who is linked reaches the browser.
   */
  | { kind: 'unlinked'; claimable: readonly string[] }
  | {
      kind: 'linked';
      puuid: string;
      isAdmin: boolean;
      isOwner?: boolean;
      /**
       * A member of the page's group (any role). Linked means the person has a player row, not that
       * they belong to this group; tonight's lobby password is for members only (M14.28).
       */
      isMember?: boolean;
    };

/** Nobody is signed in, which is the ordinary case and the one the page is designed for. */
export const ANONYMOUS_VIEWER: ViewerState = { kind: 'anonymous' };

/** The puuid whose seat gets the `brand` "you" rule, or `null` for everybody else. */
export function viewerPuuid(viewer: ViewerState): string | null {
  return viewer.kind === 'linked' ? viewer.puuid : null;
}

/**
 * Decided on the server from the session (`lib/viewer.ts`). It draws the reroll control, and
 * nothing else on this page: the admin's role tap on somebody else's row was struck from M3.6
 * on 2026-09-10 (admins see roles under `/g/<slug>/admin/members` since M14.23), while `POST /api/me/role-tonight`
 * keeps honouring an admin's `puuid`. It is never the gate — the route behind the control
 * checks the session again before it writes.
 */
export function viewerIsAdmin(viewer: ViewerState): boolean {
  return viewer.kind === 'linked' && viewer.isAdmin;
}
