import type { Metadata } from 'next';
import Link from 'next/link';
import { playerLabel } from '@/lib/admin/playerName';
import { ADMIN_PLAYERS_MAX_PAGE_SIZE, listAdminPlayers } from '@/lib/admin/players';
import { listAdminTokens } from '@/lib/admin/tokens';
import { requireAdmin } from '@/lib/adminPage';
import { RELEASE_EXE_SHA256_URL, RELEASE_EXE_URL } from '@/lib/nav';
import { getServiceClient } from '@/lib/supabase';
import { AdminAnswerGroup } from '../../_components/AdminAnswerGroup';
import { AdminForm } from '../../_components/AdminForm';
import {
  Card,
  Empty,
  formatTimestamp,
  Notices,
  PageHeader,
  type SearchParams,
  Status,
} from '../../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Companion tokens — Kustom admin',
  robots: { index: false, follow: false },
};

/**
 * Mint and revoke companion tokens — the button that replaces
 * `pnpm --filter web mint-token` (M1.5).
 *
 * Minting answers with a one-off page carrying the raw token; the table below only ever knows
 * that a token exists, because the database only stores its SHA-256 hash.
 */
export default async function AdminTokensPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [params] = await Promise.all([searchParams, requireAdmin()]);
  const client = getServiceClient();
  // The mint dropdown needs every player, so it asks for one big page rather than the page
  // size `/admin/players` uses — but it asks with an explicit range all the same (M3.25), so
  // "the list stops here" is this number's doing and not PostgREST truncating in silence.
  const [tokens, playerPage] = await Promise.all([
    listAdminTokens(client),
    listAdminPlayers(client, null, { pageSize: ADMIN_PLAYERS_MAX_PAGE_SIZE }),
  ]);
  const players = playerPage.rows;

  return (
    <main>
      <PageHeader title="Companion tokens">
        <p className="admin-muted">
          One token per companion install. The raw token is shown once, on the page you land on after minting;
          only its hash is stored. Revoking sets <span className="admin-mono">revoked_at</span> and the API
          refuses the token from the next request on — the row stays, so{' '}
          <span className="admin-mono">last_seen_at</span> remains as the trail of a token that may have
          leaked.
        </p>
      </PageHeader>

      <Notices params={params} />

      <div className="admin-grid">
        <Card title="Mint" wide>
          {/* The dropdown holds one page, and the page is capped. Saying so is the difference
              between a list that stops and a list that lies (M3.25). */}
          {playerPage.total > players.length ? (
            <p className="admin-muted">
              showing the first {players.length} of {playerPage.total}; find the rest on{' '}
              <Link href="/admin/players">/admin/players</Link>
            </p>
          ) : null}
          {players.length === 0 ? (
            <Empty>No players yet, so there is nobody to mint a token for.</Empty>
          ) : (
            <AdminForm action="/api/admin/tokens" kind="tokens">
              <input type="hidden" name="action" value="mint" />
              <label>
                <span className="admin-muted">player </span>
                <select name="playerId" aria-label="Player" defaultValue={players[0]?.id ?? ''}>
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {playerLabel(player)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="admin-muted">label </span>
                <input type="text" name="label" placeholder="bilal's desktop" aria-label="Label" />
              </label>
              <button type="submit" className="admin-primary">
                Mint token
              </button>
            </AdminForm>
          )}

          {/*
           * The download, beside the token it needs (M2.20). This is the one place in `apps/web`
           * that links the `.exe` directly: an admin reading this is on the PC that is going to run
           * it. Every friend-facing surface links the releases page instead, because the tonight
           * page is opened on a phone.
           */}
          <p className="admin-muted">
            <a href={RELEASE_EXE_URL}>Kustom.exe</a> — the latest Windows build, with{' '}
            <a href={RELEASE_EXE_SHA256_URL}>Kustom.exe.sha256</a> beside it to check the download. Send it to
            whoever is running the companion, with the token you just minted.
          </p>
        </Card>

        <Card title="Tokens" wide>
          {tokens.length === 0 ? (
            <Empty>
              No tokens yet. Mint one above and send it to whoever runs the companion — they paste it in when
              the companion asks.
            </Empty>
          ) : (
            <div className="admin-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Label</th>
                    <th>Created</th>
                    <th>Last seen</th>
                    <th>Revoked</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.id}>
                      {/* The name, the Riot ID, then a PUUID fragment: minting for the wrong
                          person is a live credential handed to the wrong friend (M1.7). */}
                      <td title={token.puuid}>{playerLabel(token)}</td>
                      <td>{token.label ?? '—'}</td>
                      <td className="admin-mono">{formatTimestamp(token.createdAt)}</td>
                      <td className="admin-mono">{formatTimestamp(token.lastSeenAt)}</td>
                      <td>
                        {token.revokedAt === null ? (
                          <Status tone="live">active</Status>
                        ) : (
                          <Status>{formatTimestamp(token.revokedAt)}</Status>
                        )}
                      </td>
                      <td>
                        {/* The group is outside the branch on purpose: revoking replaces the form
                            with the word `revoked`, and the sentence has to outlive the control
                            that produced it (M3.20). */}
                        <AdminAnswerGroup>
                          {token.revokedAt === null ? (
                            <AdminForm action="/api/admin/tokens" kind="tokens">
                              <input type="hidden" name="action" value="revoke" />
                              <input type="hidden" name="tokenId" value={token.id} />
                              <button type="submit" className="admin-danger">
                                Revoke
                              </button>
                            </AdminForm>
                          ) : (
                            <span className="admin-muted">revoked</span>
                          )}
                        </AdminAnswerGroup>
                      </td>
                    </tr>
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
