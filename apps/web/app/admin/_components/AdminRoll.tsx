import type { ReactNode } from 'react';
import type { RollableLobby } from '@/lib/admin/rollable';
import { PLAYERS_PER_GAME } from '@/lib/lobbyState';
import { ROLL_ADMIN_HINT, ROLL_LABEL } from '@/lib/tonight/copy';
import { AdminForm } from './AdminForm';
import { Empty } from './ui';

/**
 * `/admin`'s `Roll teams` (2026-10-03): the same press as the tonight page's `RollControl`, for
 * the lobby `getRollableLobby` found, posting to the same route.
 *
 * It is dressed and wired the way every other write on this page is — an `AdminForm` (a real
 * `<form>` for the no-JS path, a JSON post in place with JavaScript, the answer beside the
 * button) — rather than the tonight page's own client component. The admin area's convention
 * wins on the admin page; only the words (`ROLL_LABEL`, `ROLL_ADMIN_HINT`) are shared, so the
 * two buttons are the same button by name.
 *
 * **The press names the roster this render showed.** `rosterKey` was computed on the server by
 * the route's own two functions, and the roster is printed above the button so the admin can
 * check it; a friend joining or leaving after the render is the route's 409 in its own words.
 */
export function AdminRoll({ lobby }: { lobby: RollableLobby | null }): ReactNode {
  if (lobby === null) return <Empty>{NO_ROLLABLE_LOBBY}</Empty>;

  const name = <span className="admin-mono">{lobby.lobbyName ?? 'unnamed lobby'}</span>;
  const roster =
    lobby.members.length === 0 ? null : (
      <p className="admin-muted">
        {lobby.members
          .map((member) => (member.spectator ? `${member.label} (spectating)` : member.label))
          .join(', ')}
      </p>
    );

  if (lobby.stage === 'waiting') {
    return (
      <>
        <p>
          {name} · {lobby.around} of {PLAYERS_PER_GAME} in
        </p>
        {roster}
        <p className="admin-muted">{waitingLine(lobby.around)}</p>
      </>
    );
  }

  return (
    <>
      <p>
        {name} · {lobby.stage === 'repair' ? 'balanced, but no teams were written' : `${lobby.around} in`}
      </p>
      {roster}
      <AdminForm action={`/api/admin/lobbies/${lobby.id}/roll`} kind="roll" className="admin-stacked">
        <input type="hidden" name="rosterKey" value={lobby.rosterKey} />
        {/* Only the no-JavaScript path reads this; the route re-validates it as a path. */}
        <input type="hidden" name="redirectTo" value="/admin" />
        <p className="admin-muted">{ROLL_ADMIN_HINT}</p>
        <button type="submit" className="admin-primary">
          {ROLL_LABEL}
        </button>
      </AdminForm>
    </>
  );
}

/** No lobby is open, or the newest one already has teams (that is the Reroll card's). */
export const NO_ROLLABLE_LOBBY =
  'No lobby is waiting for teams. Roll teams appears here while a lobby is open, and can be pressed once ten are in.';

/** Under ten: the route would refuse, so there is no button, only how far off it is. */
export function waitingLine(around: number): string {
  const missing = PLAYERS_PER_GAME - around;
  return `${missing} more to go before teams can be rolled.`;
}
