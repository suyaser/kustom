import type { Metadata, Route } from 'next';
import Link from 'next/link';
import {
  type CapturedGameRow,
  GAMES_COPY,
  listCapturedGames,
  listMissedLobbies,
  type MissedLobbyRow,
} from '@/lib/admin/games';
import { requireAdmin } from '@/lib/adminPage';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';
import { Card, Empty, PageHeader, Status } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Games — Kustom admin',
  robots: { index: false, follow: false },
};

/**
 * The missed-game report (M5.5): the lobbies that started a game and never got a result, and
 * the games the server did capture.
 *
 * **Read-only, and that is a rule rather than a shortcut.** There is no form on this page, no
 * route under `/api/admin/games`, and nothing that edits a lobby or a game. A stuck row is the
 * evidence that the companion rule was broken that night, and a button that clears evidence on
 * the only page that shows it is the wrong shape; the real cost of a stuck row — the party's
 * later posts landing on a frozen row — is fixed by the sweep instead (M5.11).
 *
 * Admin and not public: "we missed one" is not a thing the group needs on a phone at 21:30.
 */
export default async function AdminGamesPage() {
  await requireAdmin();
  const client = getServiceClient();
  const timeZone = nightTimeZone();
  const [missed, captured] = await Promise.all([
    listMissedLobbies(client, { timeZone }),
    listCapturedGames(client, { timeZone }),
  ]);

  const anyLobbyNeverClosed = missed.rows.some((row) => row.state === 'game landed, lobby never closed');

  return (
    <main>
      <PageHeader title={GAMES_COPY.heading} />

      <div className="admin-grid">
        <Card title={GAMES_COPY.missed} wide>
          <p className="admin-muted">{GAMES_COPY.missedIntro}</p>

          {missed.rows.length === 0 ? (
            <Empty>{GAMES_COPY.missedEmpty}</Empty>
          ) : (
            <>
              <div className="admin-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Night</th>
                      <th>In game at</th>
                      <th>Reported by</th>
                      <th>Party</th>
                      <th>Roster</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missed.rows.map((row) => (
                      <MissedRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* The cap, and how far past it the list goes. If this number is ever above ten the
                  news is not the list, it is that the companion rule is not being followed. */}
              {missed.total > missed.rows.length ? (
                <p className="admin-muted">
                  Showing the newest {missed.rows.length} of {missed.total}.
                </p>
              ) : null}
              {anyLobbyNeverClosed ? <p className="admin-muted">{GAMES_COPY.lobbyNeverClosed}</p> : null}
            </>
          )}
        </Card>

        <Card title={GAMES_COPY.captured} wide>
          <p className="admin-muted">{GAMES_COPY.capturedIntro}</p>

          {captured.length === 0 ? (
            <Empty>{GAMES_COPY.capturedEmpty}</Empty>
          ) : (
            <div className="admin-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Night</th>
                    <th>Start</th>
                    <th>Length</th>
                    <th>Source</th>
                    <th>Players</th>
                    <th>Rated</th>
                    <th>Season</th>
                    <th>Lobby</th>
                  </tr>
                </thead>
                <tbody>
                  {captured.map((row) => (
                    <CapturedRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

function MissedRow({ row }: { row: MissedLobbyRow }) {
  return (
    <tr>
      <td>{row.night}</td>
      <td>{row.wentInGameAt}</td>
      <td>
        {row.reportedByPuuid === null ? (
          row.reportedBy
        ) : (
          <Link href={`/p/${row.reportedByPuuid}` as Route}>{row.reportedBy}</Link>
        )}
      </td>
      <td className="admin-mono">{row.partyId}</td>
      <td className="admin-wrap">
        {/* The count first, because a roster of three is worse news than one of ten and the
            names below it are what an admin reads next (M2.9 froze whatever was on the row). */}
        <div>
          {row.members.length} member{row.members.length === 1 ? '' : 's'}
        </div>
        <div className="admin-muted">
          {row.members.length === 0
            ? 'nobody on the row'
            : row.members.map((member, index) => (
                <span key={member.puuid}>
                  {index === 0 ? '' : ', '}
                  <Link href={`/p/${member.puuid}` as Route}>{member.name}</Link>
                </span>
              ))}
        </div>
      </td>
      <td>
        <Status tone={row.state === 'game landed, lobby never closed' ? 'warn' : 'live'}>{row.state}</Status>
      </td>
    </tr>
  );
}

function CapturedRow({ row }: { row: CapturedGameRow }) {
  return (
    <tr>
      <td>{row.night}</td>
      <td>{row.startedAt}</td>
      <td>{row.duration}</td>
      <td>{row.source}</td>
      {/* Ten is the shape of this product. Anything else is why the row below reads `no`. */}
      <td className={row.participants === 10 ? undefined : 'admin-error'}>{row.participants}</td>
      <td>
        <Status tone={row.rated ? 'on' : 'off'}>{row.rated ? 'yes' : 'no'}</Status>
      </td>
      <td>{row.seasonName}</td>
      <td className="admin-mono">{row.partyId ?? '—'}</td>
    </tr>
  );
}
