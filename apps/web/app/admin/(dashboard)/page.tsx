import type { Metadata } from 'next';
import Link from 'next/link';
import { getRerollableLobby, NO_MORE_SPLITS, type RerollableLobby } from '@/lib/admin/reroll';
import { getActiveSeason } from '@/lib/admin/seasons';
import { requireAdmin } from '@/lib/adminPage';
import { invitedLine, START_LOBBY_BUTTON, startLobbySentence } from '@/lib/lobbyStart';
import { NO_ACTIVE_SEASON_MESSAGE } from '@/lib/season';
import { getServiceClient } from '@/lib/supabase';
import { type LobbyStartView, loadLobbyStartOrNone } from '@/lib/tonight/lobbyStart';
import { nightTimeZone } from '@/lib/tonight/night';
import { AdminAnswerGroup } from '../_components/AdminAnswerGroup';
import { AdminForm } from '../_components/AdminForm';
import { Empty, formatTimestamp, Notices, type SearchParams } from '../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin — Kustom',
  robots: { index: false, follow: false },
};

/** The index: who you are, which season row is live, tonight's reroll, and where everything is. */
export default async function AdminIndexPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [params, admin] = await Promise.all([searchParams, requireAdmin()]);
  const client = getServiceClient();
  const [season, lobby, lobbyStart] = await Promise.all([
    getActiveSeason(client),
    getRerollableLobby(client),
    // The same read the tonight page's control makes, so the two surfaces say one thing about
    // one command (M4.2). This page is behind the session check already.
    loadLobbyStartOrNone(client, { timeZone: nightTimeZone() }),
  ]);

  return (
    <main>
      <h1>Admin</h1>
      <p className="admin-muted">
        Everything here writes through <span className="admin-mono">/api/admin/*</span>, which checks the
        session on the server. The rest of the site is public and needs no account.
      </p>

      <Notices params={params} />

      <h2>Tonight</h2>
      <StartLobby start={lobbyStart} />
      <Reroll lobby={lobby} />

      <h2>You</h2>
      <dl>
        <dt>Discord</dt>
        <dd>
          {admin.discordName ?? 'unknown name'} <span className="admin-mono">{admin.discordId}</span>
        </dd>
        <dt>Player</dt>
        <dd>
          {admin.displayName ?? 'no display name yet'} <span className="admin-mono">{admin.puuid}</span>
        </dd>
        <dt>Email</dt>
        <dd>{admin.email ?? '—'}</dd>
      </dl>

      <h2>Active season</h2>
      {season === null ? (
        // The same sentence the companion API answers with when it refuses a game (M2.18).
        // Whoever opens this page after a failed night should read the words they were sent.
        <p className="admin-error" role="alert">
          {NO_ACTIVE_SEASON_MESSAGE}
        </p>
      ) : (
        <p>{season.name}</p>
      )}

      <h2>Pages</h2>
      <ul>
        <li>
          <Link href="/admin/players">Players</Link> — names, Discord links, admin flags, backfill approval.
          Roles are read-only: they are worked out from the games people play
        </li>
        <li>
          <Link href="/admin/tokens">Companion tokens</Link> — mint and revoke
        </li>
        <li>
          <Link href="/admin/discord">Discord config</Link> — webhook and channel ids
        </li>
        <li>
          <Link href="/admin/seasons">Seasons</Link> — the one season row, read-only
        </li>
      </ul>
    </main>
  );
}

/**
 * `Start a lobby` (M4.2), the same route and the same words as the tonight page's control.
 *
 * **The route is `/api/me/lobbies/start` since M4.13** — this is the one form on this page whose
 * route is not an admin route, because the press is no longer an admin write. An admin passes
 * its gate with no special case: `players.is_admin` can only be true on a row that is linked.
 *
 * The admin area ships no dress and no client JavaScript beyond `AdminForm`, so this is one
 * button and one sentence: the refusal comes back in the route's own words, and a successful
 * press prints `Opening a lobby on <Name>'s PC…` from the response's host.
 *
 * The line under it is the row itself, so an admin who reloads — or who did not press it —
 * still sees what became of tonight's command, and the lobby name and password the companion
 * was given, which is what somebody joining by hand needs and what this page is for.
 */
function StartLobby({ start }: { start: LobbyStartView | null }) {
  const sentence = start === null ? null : startLobbySentence(start, start.hostName);

  return (
    <>
      <AdminForm action="/api/me/lobbies/start" kind="lobby-start">
        {/* The route's own default is the tonight page, which is where its other surface
            lives. Only the no-JavaScript path reads this; the route re-validates it. */}
        <input type="hidden" name="redirectTo" value="/admin" />
        <button type="submit">{START_LOBBY_BUTTON}</button>
      </AdminForm>
      {start === null ? <Empty>{NO_LOBBY_STARTED}</Empty> : null}
      {/* An acked create says nothing (product): the line under it is the lobby itself. */}
      {sentence === null ? null : <p>{sentence}</p>}
      {start === null || start.lobbyName === null ? null : (
        <p className="admin-muted">
          <span className="admin-mono">{start.lobbyName}</span>
          {start.lobbyPassword === null ? null : (
            <>
              {' · password '}
              <span className="admin-mono">{start.lobbyPassword}</span>
            </>
          )}
          {start.status === 'acked' && start.invited > 0 ? ` · ${invitedLine(start.invited)}` : null}
        </p>
      )}
    </>
  );
}

/** Nobody has pressed it tonight. A fact, with the button right above it. */
const NO_LOBBY_STARTED = 'No lobby has been opened tonight.';

/**
 * The reroll control (M3.2), until the tonight page grows its own (M3.4).
 *
 * Deliberately the plainest thing that works: one form per split, each naming the split it
 * promotes, so a double tap posts the same split twice rather than skipping one. The page is
 * a server component and the admin area ships no client JavaScript, so pressing this is an
 * ordinary form post and the answer comes back as `?notice=` on this page.
 */
function Reroll({ lobby }: { lobby: RerollableLobby | null }) {
  if (lobby === null) {
    return (
      <Empty>
        No lobby has teams on the board right now. Reroll appears here while a lobby is balanced — from the
        moment the teams are posted until the game starts.
      </Empty>
    );
  }

  const chosen = lobby.splits.find((split) => split.isChosen) ?? null;
  const lastRank = lobby.splits.reduce((highest, split) => Math.max(highest, split.rank), 0);
  // The third press: with the last split up, the only promotion left is back to split 1.
  const exhausted = chosen !== null && chosen.rank === lastRank;
  const rerolls = Math.max(lobby.splits.length - 1, 1);

  return (
    <>
      <p>
        <span className="admin-mono">{lobby.lobbyName ?? 'unnamed lobby'}</span> · balanced{' '}
        {formatTimestamp(lobby.updatedAt)}
      </p>
      {chosen === null ? (
        <p className="admin-error" role="alert">
          This lobby has no chosen split. The next companion post rebalances it.
        </p>
      ) : (
        <p>
          Split {chosen.rank} is on the board. {chosen.explanation}
        </p>
      )}
      {exhausted ? <p className="admin-muted">{NO_MORE_SPLITS}</p> : null}

      {/*
       * The group wraps the whole list, not each form: promoting split 2 makes it the chosen
       * one, so its own form is filtered out of the next render — and that sentence is the
       * only place the page says whether Discord took the post (M3.20).
       */}
      <AdminAnswerGroup>
        {lobby.splits
          .filter((split) => !split.isChosen && (split.rank === 1 || !exhausted))
          .map((split) => (
            <AdminForm
              key={split.id}
              action={`/api/admin/lobbies/${lobby.id}/reroll`}
              kind="reroll"
              className="admin-stacked"
            >
              <input type="hidden" name="splitId" value={split.id} />
              <p className="admin-muted">
                Split {split.rank} · gap {split.gap} · {split.explanation}
              </p>
              <button type="submit">
                {split.rank === 1
                  ? 'Put split 1 back'
                  : `Promote split ${split.rank} · reroll ${split.rank - 1} of ${rerolls}`}
              </button>
            </AdminForm>
          ))}
      </AdminAnswerGroup>
    </>
  );
}
