import type { Role } from '@customs/core';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * Reads and writes behind `/admin/players`.
 *
 * Every function takes the service-role client as its first argument: the pages and the route
 * handlers pass the one they were given, and the integration tests pass one built from the
 * local stack. Nothing here decides who may call it — `lib/adminAuth.ts` has already done that.
 *
 * These read `players`, not `players_public`, because `discord_id` is the whole point of the
 * page and only the service role can see it (`0001_init.sql`).
 */

export interface AdminRating {
  mu: number;
  sigma: number;
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
  /**
   * Backfill approval (M5.1). Three states, and the page renders them as three: both null is
   * `off`, a request with no approval is `asked <date>`, an approval is `on since <date>`.
   * Revoking clears `backfillApprovedAt` and leaves the request standing.
   */
  backfillRequestedAt: string | null;
  backfillApprovedAt: string | null;
  /** The active season's rating, or null when the player has never been rated. */
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
 * characters, the same fragment `shortPuuid` prints — and an unanchored `ilike` on a 78-character
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
  seasonId: string | null,
  { search, page = 1, pageSize = ADMIN_PLAYERS_PAGE_SIZE }: AdminPlayersQuery = {},
): Promise<AdminPlayersPage> {
  const cleanedSearch = normalizeSearch(search);
  const size = Math.min(Math.max(1, Math.trunc(pageSize)), ADMIN_PLAYERS_MAX_PAGE_SIZE);

  const read = async (wanted: number) => {
    const from = (wanted - 1) * size;
    let query = client
      .from('players')
      .select(
        'id, puuid, display_name, game_name, tag_line, discord_id, is_admin, main_role, secondary_role, roles_counted, roles_inferred_at, rank_tier, rank_division, rank_lp, ratings(season_id, group_id, mu, sigma, games, wins), group_memberships(group_id, backfill_requested_at, backfill_approved_at)',
        { count: 'exact' },
      )
      // The original group's rating and backfill state (M13.3: both are per group now, and the
      // companion's scan reads the membership). This page is the original group's until M13.4
      // scopes `/admin` to the request's group.
      .eq('ratings.group_id', ORIGINAL_GROUP_ID)
      .eq('group_memberships.group_id', ORIGINAL_GROUP_ID)
      .order('display_name', { ascending: true, nullsFirst: false })
      .order('puuid', { ascending: true })
      .range(from, from + size - 1);

    if (cleanedSearch !== null) query = query.or(playerSearchFilter(cleanedSearch));
    // Filters the embedded rating, not the players: a player with no rating this season still
    // has a row on this page.
    if (seasonId !== null) query = query.eq('ratings.season_id', seasonId);

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
    let query = client.from('players').select('id', { count: 'exact', head: true });
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
    rows: data.map(toAdminPlayerRow(seasonId)),
    total,
    page: resolvedPage,
    pageCount: pageCountFor(total, size),
    pageSize: size,
    search: cleanedSearch,
  };
}

/**
 * One selected row into the shape the page renders. Curried on the season so the mapping and
 * the "which rating is this player's" rule stay in one place for however many pages there are.
 */
function toAdminPlayerRow(seasonId: string | null) {
  return (row: {
    id: string;
    puuid: string;
    display_name: string | null;
    game_name: string | null;
    tag_line: string | null;
    discord_id: string | null;
    is_admin: boolean;
    main_role: Role | null;
    secondary_role: Role | null;
    roles_counted: number;
    roles_inferred_at: string | null;
    rank_tier: string | null;
    rank_division: string | null;
    rank_lp: number | null;
    ratings: { season_id: string; mu: number; sigma: number; games: number; wins: number }[];
    group_memberships: {
      backfill_requested_at: string | null;
      backfill_approved_at: string | null;
    }[];
  }): AdminPlayerRow => {
    const rating = row.ratings.find((entry) => seasonId === null || entry.season_id === seasonId) ?? null;
    const membership = row.group_memberships[0] ?? null;
    return {
      id: row.id,
      puuid: row.puuid,
      displayName: row.display_name,
      gameName: row.game_name,
      tagLine: row.tag_line,
      discordId: row.discord_id,
      isAdmin: row.is_admin,
      mainRole: row.main_role,
      secondaryRole: row.secondary_role,
      rolesCounted: row.roles_counted,
      rolesInferredAt: row.roles_inferred_at,
      rankTier: row.rank_tier,
      rankDivision: row.rank_division,
      rankLp: row.rank_lp,
      backfillRequestedAt: membership?.backfill_requested_at ?? null,
      backfillApprovedAt: membership?.backfill_approved_at ?? null,
      rating:
        rating === null
          ? null
          : { mu: rating.mu, sigma: rating.sigma, games: rating.games, wins: rating.wins },
    };
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

export interface SetPlayerDisplayNameInput {
  playerId: string;
  /** `null` (the form posts `""`) puts the row back on automatic. */
  displayName: string | null;
}

/**
 * The name the group actually calls someone (M1.7).
 *
 * This is the only override there is: `ensurePlayers` fills `display_name` from the Riot
 * `gameName` and keeps following it *while it still equals the stored `game_name`*, so writing
 * anything else here freezes the name against every later rename, and writing null hands it
 * back to the client at the next report (`lib/ingest/players.ts`, `isDisplayNameAutomatic`).
 *
 * Nothing here compares the new name to `game_name`: setting the name to exactly the current
 * `gameName` is indistinguishable from automatic *by design* — that is the whole rule, and it
 * degrades to "you typed what it already says", not to a lost override.
 */
export async function setPlayerDisplayName(
  client: ServiceClient,
  input: SetPlayerDisplayNameInput,
): Promise<AdminWriteResult<string>> {
  if (input.displayName !== null && input.displayName.length > 40) {
    return writeFailed(400, 'that name is too long for a team sheet; keep it under 40 characters');
  }

  const { data, error } = await client
    .from('players')
    .update({ display_name: input.displayName })
    .eq('id', input.playerId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`setPlayerDisplayName failed: ${error.message}`);
  if (data === null) return writeFailed(404, 'no such player');
  return writeOk(data.id);
}

export interface SetPlayerDiscordIdInput {
  playerId: string;
  /** `null` unlinks. */
  discordId: string | null;
}

/**
 * Links or unlinks a Discord id. `players.discord_id` is unique, so linking one that already
 * belongs to someone else is a 409 rather than a database error page: an admin who mistypes a
 * snowflake should be told, not shown a stack trace.
 */
export async function setPlayerDiscordId(
  client: ServiceClient,
  input: SetPlayerDiscordIdInput,
): Promise<AdminWriteResult<string>> {
  if (input.discordId !== null) {
    const { data: holder, error: holderError } = await client
      .from('players')
      .select('id, puuid')
      .eq('discord_id', input.discordId)
      .maybeSingle();
    if (holderError) throw new Error(`setPlayerDiscordId lookup failed: ${holderError.message}`);
    if (holder && holder.id !== input.playerId) {
      return writeFailed(409, `that Discord id is already linked to ${holder.puuid}`);
    }
  }

  const { data, error } = await client
    .from('players')
    .update({ discord_id: input.discordId })
    .eq('id', input.playerId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`setPlayerDiscordId failed: ${error.message}`);
  if (data === null) return writeFailed(404, 'no such player');
  return writeOk(data.id);
}

export interface SetPlayerAdminInput {
  playerId: string;
  isAdmin: boolean;
  /** The admin making the change, from the session. Never from the request body. */
  actingPlayerId: string;
}

/**
 * An admin may promote or demote anyone except themselves.
 *
 * Pure, so the rule is a unit test rather than an integration test: the last admin demoting
 * themselves would lock everyone out of `/admin`, and the only way back would be redeploying
 * with `BOOTSTRAP_ADMIN_PUUID` set.
 */
export function isSelfDemotion(input: SetPlayerAdminInput): boolean {
  return !input.isAdmin && input.playerId === input.actingPlayerId;
}

export async function setPlayerAdmin(
  client: ServiceClient,
  input: SetPlayerAdminInput,
): Promise<AdminWriteResult<string>> {
  if (isSelfDemotion(input)) {
    return writeFailed(403, 'you cannot remove your own admin flag; ask another admin');
  }

  const { data, error } = await client
    .from('players')
    .update({ is_admin: input.isAdmin })
    .eq('id', input.playerId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`setPlayerAdmin failed: ${error.message}`);
  if (data === null) return writeFailed(404, 'no such player');
  return writeOk(data.id);
}

export interface SetPlayerBackfillInput {
  playerId: string;
  /** The group whose approval this is (M13.3). The original group until M13.4. */
  groupId?: string;
  /** The target state, not a toggle: two tabs cannot flip each other's answer. */
  approved: boolean;
  /** Injected so the integration tests can pin the timestamp. */
  now?: Date;
}

/**
 * Allow or revoke backfill for one player (M5.1), in one group (M13.3).
 *
 * The approval lives on the membership (`group_memberships.backfill_approved_at`), because
 * approving somebody's history is a group admin's call about their group and the companion's
 * scan reads it from there. The group is the original one until M13.4 passes the request's.
 * Approving a player who is not yet a member makes them one (an admin naming them is enough);
 * revoking a non-member writes nothing.
 *
 * Approving stamps `backfill_approved_at`; revoking sets it back to null and the next
 * `POST /api/companion/backfill/scan` answers `approved: false`. The request timestamp is
 * never touched here — it is the record of when that friend's PC first asked, and an admin who
 * revokes has not un-asked anything.
 *
 * Re-approving an already-approved player moves the date. That is deliberate and harmless: the
 * column is a note for a human, and nothing reads it but "is it null".
 */
export async function setPlayerBackfill(
  client: ServiceClient,
  input: SetPlayerBackfillInput,
): Promise<AdminWriteResult<string>> {
  const groupId = input.groupId ?? ORIGINAL_GROUP_ID;
  const { data, error } = await client.from('players').select('id').eq('id', input.playerId).maybeSingle();
  if (error) throw new Error(`setPlayerBackfill failed: ${error.message}`);
  if (data === null) return writeFailed(404, 'no such player');

  const approvedAt = input.approved ? (input.now ?? new Date()).toISOString() : null;
  // `role` is not in the payload, so an existing membership keeps its role; a new one is `member`.
  const { error: writeError } = input.approved
    ? await client
        .from('group_memberships')
        .upsert(
          { group_id: groupId, player_id: data.id, backfill_approved_at: approvedAt },
          { onConflict: 'group_id,player_id' },
        )
    : await client
        .from('group_memberships')
        .update({ backfill_approved_at: null })
        .eq('group_id', groupId)
        .eq('player_id', data.id);
  if (writeError) throw new Error(`setPlayerBackfill failed: ${writeError.message}`);
  return writeOk(data.id);
}
