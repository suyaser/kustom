import type { Role } from '@customs/core';
import { type GroupRole, groupRoleSchema, isAtLeast } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';

/**
 * Reads behind the retired 1.0 players page (its writes were retired in M14.56).
 *
 * Every function takes the service-role client as its first argument: the pages and the route
 * handlers pass the one they were given, and the integration tests pass one built from the
 * local stack. Nothing here decides who may call it — `lib/adminAuth.ts` has already done that.
 *
 * These read `players`, not `players_public`, because `discord_id` is the whole point of the
 * page and only the service role can see it (`0001_init.sql`).
 *
 * **Everything is one group's** (M13.4): the list is the group's members, the rating is the
 * group's, admin is the member's role in the group, and every write
 * refuses a player who is not a member of it with the same 404 as a player who does not exist —
 * an admin of one group does not learn which ids another group's members have.
 */

export interface AdminRating {
  /** The unrounded all-time Kustom Rating (`ratings.r`, M18.7); print it through `displayKustom`. */
  r: number;
  games: number;
  wins: number;
}

export interface AdminPlayerRow {
  id: string;
  puuid: string;
  displayName: string | null;
  gameName: string | null;
  tagLine: string | null;
  discordId: string | null;
  /** The member's role in the listed group (M13.4; `owner` since M14.11). */
  role: GroupRole;
  /** `admin` or `owner` in the listed group: `isAtLeast(role, 'admin')`. */
  isAdmin: boolean;
  /**
   * Inferred from play (M5.17), never set here: the most and second-most frequent role over
   * this player's last `config.roles.inferenceWindow` counted games. Null main is flexible.
   */
  mainRole: Role | null;
  secondaryRole: Role | null;
  /** How many counted games the pair rests on. Under `config.roles.minGames` it is flexible. */
  rolesCounted: number;
  /** When the pair was last worked out. Null means never — no rated game has landed yet. */
  rolesInferredAt: string | null;
  rankTier: string | null;
  rankDivision: string | null;
  rankLp: number | null;
  /** The group's rating, or null when the player has never been rated. */
  rating: AdminRating | null;
}

/** How many rows `/admin/players` shows at once (M3.25). */
export const ADMIN_PLAYERS_PAGE_SIZE = 50;

/**
 * The largest page anything may ask for, and the reason the number exists: PostgREST answers
 * at most `max_rows` (1000) rows and says nothing when it truncates. Every query in this file
 * sets an explicit `.range()`, so a truncation is this constant's doing and is visible in
 * `total` rather than a silently short list.
 */
export const ADMIN_PLAYERS_MAX_PAGE_SIZE = 1000;

/** PostgREST's code for "that offset is past the end of the list" (HTTP 416). */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

/** Longest search a box on an admin page will act on; past this it is a paste, not a search. */
const MAX_SEARCH_LENGTH = 64;

export interface AdminPlayersQuery {
  /** What the admin typed. Trimmed and cleaned by {@link normalizeSearch}; `null` is no filter. */
  search?: string | null;
  /** 1-based, clamped into range against the count the query comes back with. */
  page?: number;
  pageSize?: number;
}

export interface AdminPlayersPage {
  rows: AdminPlayerRow[];
  /** Every player the filter matches, not just this page. The header sentence prints it. */
  total: number;
  /** The page actually read, after clamping — a stale `?page=9` on a shrunk list lands on the last. */
  page: number;
  pageCount: number;
  pageSize: number;
  /** The cleaned search this page was read with, so the page's links can carry it back. */
  search: string | null;
}

/**
 * What the search box typed into it becomes.
 *
 * PostgREST's `or=` filter is a comma-separated list inside parentheses, so a comma or a
 * bracket in the value would be read as filter syntax rather than as text, and `%`/`*` would
 * be a wildcard the admin did not ask for. Those characters are dropped instead of escaped:
 * this is a name-and-PUUID box, none of them appears in either, and dropping them cannot
 * produce a query that means something else. The backslash goes with them, which is what makes
 * `escapeIlike` below the only thing that can put one into a pattern.
 *
 * `_` is **not** dropped: it is a real character in a Riot ID, and it is escaped at the filter
 * instead so the box still echoes what was typed.
 */
export function normalizeSearch(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw
    .replace(/[,()"'\\%*]/g, ' ')
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);
  return cleaned.length === 0 ? null : cleaned;
}

/**
 * `_` is a one-character wildcard in SQL `LIKE`, and PostgREST passes it through untouched —
 * so a search for `it_` matched every `it-` row on the stack (reviewer, 2026-09-10). Backslash
 * is `LIKE`'s default escape character, so `\_` is a literal underscore, and the sequence
 * survives the `or=` list because nothing between the commas re-reads it.
 *
 * The escape happens here rather than in {@link normalizeSearch} so the string the page echoes
 * back into the box and into its own links stays what the admin typed. Names with an underscore
 * in them are real — `cool_guy` is a Riot ID — so stripping the character would trade a false
 * positive for a search that cannot find a real player.
 */
function escapeIlike(search: string): string {
  return search.replace(/_/g, '\\_');
}

/**
 * The PostgREST `or` filter for a cleaned search: **contains** on either name a reader might
 * be looking at, and **prefix** on the PUUID.
 *
 * Prefix and not contains on the PUUID because that is how a PUUID is ever quoted — the first
 * characters, the same eight-character fragment the admin list once printed — and an unanchored `ilike` on a 78-character
 * random string is a sequential scan for nothing.
 */
export function playerSearchFilter(search: string): string {
  const pattern = escapeIlike(search);
  return [`display_name.ilike.*${pattern}*`, `game_name.ilike.*${pattern}*`, `puuid.ilike.${pattern}*`].join(
    ',',
  );
}

/** `1` for an empty list, so "Page 1 of 1" is never "Page 1 of 0". */
export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/**
 * A `?page=` from the query string, or 1.
 *
 * `Number.isSafeInteger`, not `isInteger`: `?page=1e21` parses as an integer, survives
 * `Math.trunc`, and reaches `.range(5e22, 5e22)` — a query PostgREST answers with nonsense
 * rather than with a page (reviewer, 2026-09-10). Anything that is not a page number this app
 * could have produced is page one.
 */
export function parsePageParam(raw: string | null | undefined): number {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

/**
 * One page of players, ordered by the name a reader sees and then by PUUID (M3.25).
 *
 * There used to be no `range` here at all, on the reasoning that a group of twenty never needs
 * one. That was wrong for two reasons found on 2026-09-10: the local stack had accumulated a
 * thousand test players and PostgREST answered with the first thousand and no error, so rows
 * silently vanished; and one form per editable field per row means a page of a thousand players
 * is ~4800 client components and 85,000px tall. So the range is explicit, `total` is a real
 * `count`, and the page says which slice it is showing.
 *
 * The count is `exact`: this table has thousands of rows at worst, and a planner estimate would
 * make the page's own sentence a guess.
 */
export async function listAdminPlayers(
  client: ServiceClient,
  groupId: string,
  { search, page = 1, pageSize = ADMIN_PLAYERS_PAGE_SIZE }: AdminPlayersQuery = {},
): Promise<AdminPlayersPage> {
  const cleanedSearch = normalizeSearch(search);
  const size = Math.min(Math.max(1, Math.trunc(pageSize)), ADMIN_PLAYERS_MAX_PAGE_SIZE);

  const read = async (wanted: number) => {
    const from = (wanted - 1) * size;
    let query = client
      .from('players')
      .select(
        'id, puuid, display_name, game_name, tag_line, discord_id, main_role, secondary_role, roles_counted, roles_inferred_at, rank_tier, rank_division, rank_lp, ratings(group_id, r, games, wins), group_memberships!inner(group_id, role)',
        { count: 'exact' },
      )
      // The group's members only (`!inner`), with the group's rating and role (M13.3, M13.4:
      // both are per group).
      .eq('ratings.group_id', groupId)
      .eq('group_memberships.group_id', groupId)
      .order('display_name', { ascending: true, nullsFirst: false })
      .order('puuid', { ascending: true })
      .range(from, from + size - 1);

    if (cleanedSearch !== null) query = query.or(playerSearchFilter(cleanedSearch));

    const { data, error, count } = await query;
    // PostgREST answers a range whose offset is past the end with 416 `PGRST103` rather than
    // an empty page, so "page 9999 of a list that has 24" arrives here as an error. It is not
    // one: it is a stale bookmark, and the caller clamps.
    if (error?.code === RANGE_NOT_SATISFIABLE) return null;
    if (error) throw new Error(`listAdminPlayers failed: ${error.message}`);
    return { data: data ?? [], total: count ?? 0 };
  };

  /** How many players match, with no rows read: only used to work out where the end is. */
  const countMatching = async (): Promise<number> => {
    let query = client
      .from('players')
      .select('id, group_memberships!inner(group_id)', { count: 'exact', head: true })
      .eq('group_memberships.group_id', groupId);
    if (cleanedSearch !== null) query = query.or(playerSearchFilter(cleanedSearch));
    const { count, error } = await query;
    if (error) throw new Error(`listAdminPlayers count failed: ${error.message}`);
    return count ?? 0;
  };

  // The same rule `parsePageParam` applies to the query string, applied again to whatever a
  // caller passes: an offset of 5e22 is not a page of anything.
  const wanted = Number.isSafeInteger(page) ? Math.max(1, page) : 1;
  let resolvedPage = wanted;
  let result = await read(wanted);
  if (result === null) {
    // A `?page=` past the end (a bookmark, or a search that shrank the list) reads the last
    // page rather than showing an admin an empty table beside a count that says there are rows.
    resolvedPage = pageCountFor(await countMatching(), size);
    result = await read(resolvedPage);
  }
  const { data, total } = result ?? { data: [], total: 0 };

  return {
    rows: data.map(toAdminPlayerRow),
    total,
    page: resolvedPage,
    pageCount: pageCountFor(total, size),
    pageSize: size,
    search: cleanedSearch,
  };
}

/**
 * One selected row into the shape the page renders. The embedded `ratings` is already filtered to
 * the group, so it holds at most one row (one rating per person per group).
 */
function toAdminPlayerRow(row: {
  id: string;
  puuid: string;
  display_name: string | null;
  game_name: string | null;
  tag_line: string | null;
  discord_id: string | null;
  main_role: Role | null;
  secondary_role: Role | null;
  roles_counted: number;
  roles_inferred_at: string | null;
  rank_tier: string | null;
  rank_division: string | null;
  rank_lp: number | null;
  ratings: { r: number | null; games: number; wins: number }[];
  group_memberships: { role: string }[];
}): AdminPlayerRow {
  const rating = row.ratings[0] ?? null;
  const membership = row.group_memberships[0] ?? null;
  // A role the union does not know (a hand-edited row) reads as a plain member: it grants nothing.
  const role = groupRoleSchema.catch('member').parse(membership?.role ?? 'member');
  return {
    id: row.id,
    puuid: row.puuid,
    displayName: row.display_name,
    gameName: row.game_name,
    tagLine: row.tag_line,
    discordId: row.discord_id,
    role,
    isAdmin: isAtLeast(role, 'admin'),
    mainRole: row.main_role,
    secondaryRole: row.secondary_role,
    rolesCounted: row.roles_counted,
    rolesInferredAt: row.roles_inferred_at,
    rankTier: row.rank_tier,
    rankDivision: row.rank_division,
    rankLp: row.rank_lp,
    rating:
      rating === null || rating.r === null
        ? null // none, or a row the Kustom fold has not filled yet (0036, before the switch rebuild)
        : { r: rating.r, games: rating.games, wins: rating.wins },
  };
}

/**
 * What `/admin/players` prints in the Roles column (M5.17). Four shapes and no fifth — the
 * brief's three, plus the player who has only ever played one position:
 *
 *   `support · jungle · from 17 games`   a pair
 *   `support · from 4 games`             one role only; a second is never invented
 *   `flexible · from 2 games`            under the M5.16 threshold, and it says why
 *   `flexible · no games yet`            nothing rated has landed for this player
 *
 * There is no control beside it. Roles are read off the games people play, recomputed after
 * every rated game and after every rebuild, and the M1-era hand-set pair was overwritten by
 * the first recompute (`04-decisions.md`, 2026-09-10).
 */
export function formatInferredRoles(
  player: Pick<AdminPlayerRow, 'mainRole' | 'secondaryRole' | 'rolesCounted'>,
): string {
  const from =
    player.rolesCounted === 0
      ? 'no games yet'
      : `from ${player.rolesCounted} game${player.rolesCounted === 1 ? '' : 's'}`;
  const pair =
    player.mainRole === null
      ? ['flexible']
      : player.secondaryRole === null
        ? [player.mainRole]
        : [player.mainRole, player.secondaryRole];
  return [...pair, from].join(' · ');
}
