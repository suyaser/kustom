import type { Metadata } from 'next';
import { listSeasons } from '@/lib/admin/seasons';
import { requireAdmin } from '@/lib/adminPage';
import { NO_ACTIVE_SEASON_MESSAGE } from '@/lib/season';
import { getServiceClient } from '@/lib/supabase';
import { Card, Empty, formatTimestamp, PageHeader, Status } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Seasons — Kustom admin',
  robots: { index: false, follow: false },
};

/**
 * Seasons — **read-only** (M5.14, 2026-09-10). One line naming the row and the date it
 * started, and nothing to press.
 *
 * The name field, the typed confirmation (M3.9), the `Start` button and
 * `POST /api/admin/seasons` are gone. With M5.3 dropped, ratings never reset and the board is
 * read through time windows (M5.12); starting a season would have emptied the board with no
 * undo and given nobody anything they wanted. The safest version of that button is the one
 * that is not there.
 *
 * The row itself is the one `0001_init.sql` inserts — the all-time container every
 * `games.season_id` points at. **Its name is never printed to a friend**; this page is the
 * only place in the product that still shows it, and it exists so that an admin whose games
 * stopped saving can see whether the row is there.
 */
export default async function AdminSeasonsPage() {
  await requireAdmin();
  const seasons = await listSeasons(getServiceClient());
  const active = seasons.find((season) => season.isActive) ?? null;

  return (
    <main>
      <PageHeader title="Seasons">
        <p className="admin-muted">
          There is one season and it is created by the first migration. Nothing in the app makes another:
          ratings never reset, and the board is read through <strong>time windows</strong> — this week, last
          week, this month, last month, all time — which change who is listed, never anybody&rsquo;s number. A
          season&rsquo;s name is not printed anywhere a friend can see it.
        </p>
      </PageHeader>

      <div className="admin-grid">
        <Card title="The season row" wide>
          {active === null ? (
            // Verbatim the sentence the companion API answers a game post with while this is true
            // (M2.18). Whoever opens this page after a failed night reads the words they were sent.
            <p className="admin-error" role="alert">
              {NO_ACTIVE_SEASON_MESSAGE}
            </p>
          ) : (
            <p>
              <strong>{active.name}</strong> · started {formatTimestamp(active.startsAt)}
            </p>
          )}

          {seasons.length === 0 ? (
            <Empty>
              No seasons at all. That should not be possible — the database is created with Season 1 already
              running, so something is wrong with it.
            </Empty>
          ) : null}
        </Card>

        {seasons.length > 1 ? (
          <Card title="All seasons" wide>
            {/* Only ever seen on a database that pressed the removed button before 2026-09-10.
              The extra rows are harmless where they are: nothing reads a name any more. */}
            <div className="admin-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Started</th>
                    <th>Ended</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {seasons.map((season) => (
                    <tr key={season.id}>
                      <td>{season.name}</td>
                      <td className="admin-mono">{formatTimestamp(season.startsAt)}</td>
                      <td className="admin-mono">{formatTimestamp(season.endsAt)}</td>
                      <td>{season.isActive ? <Status tone="live">active</Status> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
