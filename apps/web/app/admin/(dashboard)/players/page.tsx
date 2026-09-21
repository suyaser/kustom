import { displayRating, ordinal } from '@customs/core';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { playerLabel, shortPuuid } from '@/lib/admin/playerName';
import {
  type AdminPlayerRow,
  formatInferredRoles,
  listAdminPlayers,
  type AdminPlayersPage as PlayersPageData,
  parsePageParam,
} from '@/lib/admin/players';
import { getActiveSeason } from '@/lib/admin/seasons';
import { requireAdmin } from '@/lib/adminPage';
import { getServiceClient } from '@/lib/supabase';
import { AdminForm } from '../../_components/AdminForm';
import {
  Card,
  Empty,
  formatDay,
  InferredRoles,
  Notices,
  PageHeader,
  readParam,
  type SearchParams,
  Status,
} from '../../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Players — Kustom admin',
  robots: { index: false, follow: false },
};

/**
 * Every player, with the four things only an admin can change: the name the group uses, the
 * Discord link, the admin flag and backfill approval (M5.1).
 *
 * **Roles are not one of them any more** (M5.17). The column is still here and it is the only
 * read-only one: the pair is inferred from the games that player has actually played, and the
 * count behind it says how many games the answer rests on.
 *
 * Read with the service-role client, so `discord_id` is visible — `players_public` (what every
 * public page reads) does not carry it.
 */
export default async function AdminPlayersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [params, admin] = await Promise.all([searchParams, requireAdmin()]);
  const client = getServiceClient();
  const season = await getActiveSeason(client);
  const page = await listAdminPlayers(client, season?.id ?? null, {
    search: readParam(params, 'q'),
    page: parsePageParam(readParam(params, 'page')),
  });
  const players = page.rows;

  return (
    <main>
      <PageHeader title="Players">
        <p className="admin-muted">
          {page.total} player{page.total === 1 ? '' : 's'}
          {page.search === null ? '' : ` matching "${page.search}"`}. Ratings are the active season
          {season === null ? ' (none active)' : ` (${season.name})`}. A row appears on its own the first time
          a PUUID shows up in a lobby, a game or a rank report — there is no "add player". A name follows the
          Riot ID until you set one here; clear the field to put it back on automatic. Roles are worked out
          from the games each player has played and cannot be set by hand.
        </p>
        {/* Product's copy, verbatim (M5.1): the decision an admin is being asked to make is
            "whose PC is this", and nothing else on this page says it. */}
        <p className="admin-muted">
          Backfill lets a player&apos;s companion send past customs from their client&apos;s match history.
          Turn it on once you know whose PC it is.
        </p>
      </PageHeader>

      <Notices params={params} />

      <Card>
        <PlayerSearch search={page.search} />

        {players.length === 0 ? (
          page.search === null ? (
            <Empty>
              No players yet. Run the companion once, or post a lobby to{' '}
              <span className="admin-mono">/api/companion/lobby</span>, and the rows appear here.
            </Empty>
          ) : (
            <Empty>
              No player has that name or starts with that PUUID. <Link href="/admin/players">Show all</Link>.
            </Empty>
          )
        ) : (
          <div className="admin-scroll">
            <table>
              <thead>
                <tr>
                  <th>PUUID</th>
                  <th>Name</th>
                  <th>Riot ID</th>
                  <th>Rank</th>
                  <th>Rating</th>
                  <th>Roles</th>
                  <th>Discord</th>
                  <th>Admin</th>
                  <th>Backfill</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <PlayerRow key={player.id} player={player} actingPlayerId={admin.playerId} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pager page={page} />
      </Card>
    </main>
  );
}

/**
 * The search box. A plain `GET` form: searching and paging are **reads**, so they navigate and
 * leave a URL an admin can bookmark or send to someone. M3.20's in-place rule is about the
 * writes on this page — the name field, the Discord field, the admin flag, backfill — and every
 * one of those still posts through `AdminForm` and changes nothing about the URL.
 *
 * Dropping `page` on submit is deliberate: a new search starts at its own first page.
 */
function PlayerSearch({ search }: { search: string | null }) {
  return (
    <form method="get" action="/admin/players" className="admin-search">
      <label>
        <span className="admin-muted">search </span>
        <input
          type="search"
          name="q"
          size={24}
          defaultValue={search ?? ''}
          placeholder="name, or the start of a PUUID"
          aria-label="Search players by name or PUUID"
        />
      </label>{' '}
      <button type="submit">Search</button>
      {search === null ? null : (
        <>
          {' '}
          <Link href="/admin/players">Clear</Link>
        </>
      )}
    </form>
  );
}

/**
 * `Page 2 of 24 · 1200 players`, with the two links that move.
 *
 * Links and not buttons: this is a read, and a link is what a browser already knows how to
 * open in a new tab, bookmark and go back from. The search rides along in the href so paging a
 * filtered list does not silently drop the filter.
 */
function Pager({ page }: { page: PlayersPageData }) {
  if (page.pageCount <= 1) return null;
  const first = (page.page - 1) * page.pageSize + 1;
  const last = first + page.rows.length - 1;

  return (
    <nav className="admin-pager" aria-label="Player pages">
      {page.page > 1 ? <Link href={pageHref(page, page.page - 1)}>← Previous</Link> : <span>← Previous</span>}{' '}
      <span className="admin-muted">
        {first}–{last} of {page.total} · page {page.page} of {page.pageCount}
      </span>{' '}
      {page.page < page.pageCount ? (
        <Link href={pageHref(page, page.page + 1)}>Next →</Link>
      ) : (
        <span>Next →</span>
      )}
    </nav>
  );
}

/** `/admin/players?q=…&page=…`, with `page=1` left off so the first page has one URL. */
function pageHref(page: PlayersPageData, wanted: number): Route {
  const params = new URLSearchParams();
  if (page.search !== null) params.set('q', page.search);
  if (wanted > 1) params.set('page', String(wanted));
  const query = params.toString();
  return (query === '' ? '/admin/players' : `/admin/players?${query}`) as Route;
}

function PlayerRow({ player, actingPlayerId }: { player: AdminPlayerRow; actingPlayerId: string }) {
  const isSelf = player.id === actingPlayerId;
  // Never a blank cell and never a bare PUUID where a name exists: the same chain every other
  // admin surface uses, and the label the forms below refer to.
  const label = playerLabel(player);

  return (
    <tr>
      <td className="admin-mono" title={player.puuid}>
        {shortPuuid(player.puuid)}
      </td>
      <td className="admin-wrap">
        {/* The readable name first, then the field that overrides it: an admin has to see what
            the group currently reads before deciding to change it, and on a row that is still on
            automatic the field is empty while this line already says a name. */}
        <div>{label}</div>
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-name" />
          <input type="hidden" name="playerId" value={player.id} />
          <input
            type="text"
            name="displayName"
            size={14}
            maxLength={40}
            defaultValue={player.displayName ?? ''}
            placeholder="follows the Riot ID"
            aria-label={`Name for ${label}`}
          />
          <button type="submit">Save</button>
        </AdminForm>
      </td>
      <td>{player.gameName === null ? '—' : `${player.gameName}#${player.tagLine ?? '???'}`}</td>
      <td>{formatRank(player)}</td>
      <td>{formatRating(player)}</td>
      <td>
        {/* Read-only, and the only cell on this page that is (M5.17): the pair comes from the
            games this player has played, recomputed after every rated game and every rebuild. */}
        <InferredRoles pair={formatInferredRoles(player)} inferredAt={player.rolesInferredAt} />
      </td>
      <td className="admin-wrap">
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-discord" />
          <input type="hidden" name="playerId" value={player.id} />
          <input
            type="text"
            name="discordId"
            inputMode="numeric"
            size={20}
            defaultValue={player.discordId ?? ''}
            placeholder="snowflake, empty to unlink"
            aria-label={`Discord id for ${label}`}
          />
          <button type="submit">Save</button>
        </AdminForm>
      </td>
      <td>
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-admin" />
          <input type="hidden" name="playerId" value={player.id} />
          <input type="hidden" name="isAdmin" value={player.isAdmin ? 'false' : 'true'} />
          <Status tone={player.isAdmin ? 'on' : 'off'}>{player.isAdmin ? 'yes' : 'no'}</Status>
          {/* An admin may not remove their own flag: the last one out would lock everyone out. */}
          <button
            type="submit"
            disabled={isSelf && player.isAdmin}
            className={player.isAdmin ? 'admin-danger' : undefined}
          >
            {player.isAdmin ? 'Remove' : 'Make admin'}
          </button>
        </AdminForm>
      </td>
      <td>
        {/* Three states in one cell, then the one control (M5.1). `asked` is the companion
            having knocked at `/api/companion/backfill/scan` and been told no — the marker is
            there so an admin knows somebody is waiting rather than having to be asked. */}
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-backfill" />
          <input type="hidden" name="playerId" value={player.id} />
          <input
            type="hidden"
            name="approved"
            value={player.backfillApprovedAt === null ? 'true' : 'false'}
          />
          <Status
            tone={
              player.backfillApprovedAt !== null ? 'on' : player.backfillRequestedAt !== null ? 'live' : 'off'
            }
          >
            {formatBackfill(player)}
          </Status>
          <button type="submit" className={player.backfillApprovedAt === null ? undefined : 'admin-danger'}>
            {player.backfillApprovedAt === null ? 'Allow' : 'Revoke'}
          </button>
        </AdminForm>
      </td>
    </tr>
  );
}

/** `off` / `asked <date>` / `on since <date>`, exactly the three states the brief names. */
function formatBackfill(player: AdminPlayerRow): string {
  if (player.backfillApprovedAt !== null) return `on since ${formatDay(player.backfillApprovedAt)}`;
  if (player.backfillRequestedAt !== null) return `asked ${formatDay(player.backfillRequestedAt)}`;
  return 'off';
}

function formatRank(player: AdminPlayerRow): string {
  if (player.rankTier === null) return 'unranked';
  const division = player.rankDivision === null ? '' : ` ${player.rankDivision}`;
  const lp = player.rankLp === null ? '' : ` ${player.rankLp} LP`;
  return `${player.rankTier}${division}${lp}`;
}

/**
 * Display rating and ordinal both come from `@customs/core`; nothing here does its own
 * arithmetic on a rating, so what an admin sees is what the balancer and the leaderboard see.
 */
function formatRating(player: AdminPlayerRow): string {
  if (player.rating === null) return '—';
  const { mu, sigma, games, wins } = player.rating;
  return `${displayRating(mu)} (ord ${ordinal({ mu, sigma }).toFixed(2)}, ${wins}/${games})`;
}
