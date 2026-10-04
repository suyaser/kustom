/**
 * The groups this PC knows (M13.8, M14.6): the config's list, which one is selected, the picker the panel
 * shows with two or more, and the config writes pairing and token pastes make.
 *
 * **One token per group, one group per session.** Host mode posts to exactly one group at a time, with that
 * group's token, from that group's own state directory (`hostStateDir`): the end-of-game queue, the backfill
 * cache and the executed-commands record are per group, so a queued block can only ever be replayed with the
 * token of the group it was captured for. Overlay mode posts nothing and reads for the selected group.
 *
 * **The 0.2.x config** (`companionToken` at the top level, no `groups`) is read as a single group whose token
 * is that one. It is filed under its real group once the server says which (`GET /api/companion/me` with a
 * `group`, else the PUUID's only group in `GET /api/overlay/groups`); until then it is the `legacy-token`
 * group, which has no id the server knows and keeps the root state directory.
 */

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { overlayGroupsResponseSchema } from '@customs/db/schemas';
import { ApiClient, type FetchLike } from './api.js';
import {
  type AppMode,
  type CompanionConfig,
  type GroupEntry,
  groupEntrySchema,
  isHostConfig,
  readStateOwner,
  recordStateOwner,
  sanitizeGroups,
  tokenFingerprint,
  updateConfig,
} from './config.js';
import { checkIdentity } from './identity.js';
import { type CompanionLogger, createMemoryLogger } from './log.js';

/** The runtime id of a 0.2.x token whose group is not known yet. Never written to the config, never sent. */
export const LEGACY_GROUP_ID = 'legacy-token';

/** What the 0.2.x token's group is called until the server says. Shown only when there are two or more. */
export const LEGACY_GROUP_NAME = 'Your group';

/** Picker label, Host mode (M13.8, exact). */
export const HOST_PICKER_LABEL = 'Posting tonight to:';
/** Picker label, Overlay mode (M13.8, exact): Overlay posts nothing, so it must not say it does. */
export const OVERLAY_PICKER_LABEL = "Tonight's group:";
/** Panel line for an Overlay PC with zero memberships (M13.8, exact). */
export const NO_GROUPS_SENTENCE = 'Play a game with your group, or ask them for the join link.';

export function noHostTokenLabel(name: string): string {
  return `${name} (no host token)`;
}

/** The sentence for a token the server refused with 403 (M13.8, exact). */
export function tokenNoLongerWorks(name: string): string {
  return `This token no longer works for ${name}. Ask an admin for a new one.`;
}

export interface GroupView {
  readonly groupId: string;
  readonly slug: string;
  readonly name: string;
  readonly token?: string;
}

export type ConfigGroupInput = Omit<GroupEntry, 'companionToken'> & { companionToken?: string };

export interface PickerOption {
  readonly groupId: string;
  readonly label: string;
  readonly disabled: boolean;
}

export interface PickerView {
  readonly label: string;
  readonly options: readonly PickerOption[];
  readonly selectedGroupId: string | null;
}

/** The groups as the app uses them: the config's list, then the 0.2.x token as a group of its own if unfiled. */
export function groupViews(config: CompanionConfig): GroupView[] {
  const views: GroupView[] = (config.groups ?? []).map((group) => ({
    groupId: group.groupId,
    slug: group.slug,
    name: group.name,
    ...(group.companionToken ? { token: group.companionToken } : {}),
  }));
  if (isHostConfig(config) && config.companionToken) {
    const filed = views.some((view) => view.token === config.companionToken);
    if (!filed) {
      views.unshift({
        groupId: LEGACY_GROUP_ID,
        slug: '',
        name: LEGACY_GROUP_NAME,
        token: config.companionToken,
      });
    }
  }
  return views;
}

/**
 * The group a session runs on. Overlay: `lastGroupId` if it is still a membership, else the first. Host: the
 * last one used if it has a token, else the first with one; null when none has (nothing can post).
 */
export function selectGroup(
  views: readonly GroupView[],
  mode: AppMode,
  lastGroupId: string | undefined,
): GroupView | null {
  const usable = mode === 'host' ? views.filter((view) => view.token !== undefined) : views;
  return usable.find((view) => view.groupId === lastGroupId) ?? usable[0] ?? null;
}

/** The picker, or null: it exists only with two or more groups. */
export function pickerFor(
  mode: AppMode,
  views: readonly GroupView[],
  selected: GroupView | null,
): PickerView | null {
  if (views.length < 2) return null;
  return {
    label: mode === 'host' ? HOST_PICKER_LABEL : OVERLAY_PICKER_LABEL,
    selectedGroupId: selected?.groupId ?? null,
    options: views.map((view) => {
      const unusable = mode === 'host' && view.token === undefined;
      return {
        groupId: view.groupId,
        label: unusable ? noHostTokenLabel(view.name) : view.name,
        disabled: unusable,
      };
    }),
  };
}

/** The `group=` the overlay calls send: the selected group's id, never the unfiled 0.2.x token's. */
export function overlayGroupParam(group: GroupView | null): string | null {
  return group === null || group.groupId === LEGACY_GROUP_ID ? null : group.groupId;
}

/** Where a group's queue, backfill cache and executed-commands record live. */
export function hostStateDir(configDir: string, groupId: string): string {
  return groupId === LEGACY_GROUP_ID ? configDir : join(configDir, 'groups', groupId);
}

export { tokenFingerprint };

/**
 * The state directory for an unfiled top-level token. The config root's queue, backfill cache and executed
 * record belong to the first token that used them (recorded as a fingerprint in `legacy-state-owner`); a
 * different top-level token, for instance a fresh paste that no group claims yet, gets a directory of its own
 * so a block queued under the old token is never replayed under it (M14.13).
 */
export function legacyStateDir(configDir: string, token: string): string {
  const fingerprint = tokenFingerprint(token);
  const owner = readStateOwner(configDir);
  if (owner === null) {
    recordStateOwner(configDir, token);
    return configDir;
  }
  return owner === fingerprint ? configDir : join(configDir, 'groups', `legacy-${fingerprint}`);
}

/** `hostStateDir` for a group as the session sees it: an unfiled token goes through `legacyStateDir`. */
export function hostStateDirFor(configDir: string, group: Pick<GroupView, 'groupId' | 'token'>): string {
  return group.groupId === LEGACY_GROUP_ID && group.token
    ? legacyStateDir(configDir, group.token)
    : hostStateDir(configDir, group.groupId);
}

const MOVED_STATE = ['queue', 'backfill.json', 'commands-done.json'] as const;

/**
 * A 0.2.x token just got a real group: its queued games, backfill cache and executed-commands record move
 * from the config root into that group's state directory, so they stay with the token that captured them.
 * Skips anything already there, and (given the token being filed) leaves it alone when the root state belongs
 * to a different token. Never throws; returns the names moved.
 */
export function adoptLegacyState(
  configDir: string,
  groupId: string,
  logger?: CompanionLogger,
  token?: string,
): string[] {
  const to = hostStateDir(configDir, groupId);
  const moved: string[] = [];
  // The root state belongs to the token that first used it; another token must not inherit it.
  if (token !== undefined) {
    const owner = readStateOwner(configDir);
    if (owner !== null && owner !== tokenFingerprint(token)) return moved;
  }
  for (const name of MOVED_STATE) {
    const source = join(configDir, name);
    const target = join(to, name);
    try {
      if (!existsSync(source) || existsSync(target)) continue;
      mkdirSync(to, { recursive: true, mode: 0o700 });
      renameSync(source, target);
      moved.push(name);
    } catch (error) {
      logger?.warn('could not move legacy state into the group directory', {
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return moved;
}

// ---------------------------------------------------------------------------
// Config writes. Every one keeps the keys it does not know about (updateConfig).
// ---------------------------------------------------------------------------

function groupsOf(raw: Record<string, unknown>): GroupEntry[] {
  return sanitizeGroups(raw.groups);
}

function withGroups(raw: Record<string, unknown>, groups: GroupEntry[]): Record<string, unknown> {
  return { ...raw, groups };
}

/**
 * Adds a group (pairing, or the overlay refresh) or updates its name and slug; keeps any token already there.
 * A config with no file yet gets `{ apiBase, groups }` and no mode: the person still has to pick one.
 */
export function rememberGroup(configDir: string, apiBase: string, group: ConfigGroupInput): string {
  const entry = groupEntrySchema.parse(group);
  return updateConfig(configDir, (raw) => {
    const groups = groupsOf(raw);
    const at = groups.findIndex((existing) => existing.groupId === entry.groupId);
    if (at >= 0) {
      const current = groups[at] as GroupEntry;
      groups[at] = {
        ...current,
        slug: entry.slug,
        name: entry.name,
        ...(entry.companionToken ? { companionToken: entry.companionToken } : {}),
      };
    } else {
      groups.push(entry);
    }
    return withGroups(raw.apiBase === undefined ? { ...raw, apiBase } : raw, groups);
  });
}

/** Records the group last used, so the next start opens on it. */
export function setLastGroup(configDir: string, groupId: string): string {
  return updateConfig(configDir, (raw) => ({ ...raw, lastGroupId: groupId }));
}

/**
 * Files a token under its group: the group's entry gets the token (a rotated token replaces the old one), and
 * the top-level 0.2.x token goes away if it is this one. The group becomes `lastGroupId` when none is set.
 */
export function fileTokenUnderGroup(
  configDir: string,
  group: { groupId: string; slug: string; name: string },
  token: string,
): string {
  return updateConfig(configDir, (raw) => {
    const groups = groupsOf(raw);
    const entry = groupEntrySchema.parse({ ...group, companionToken: token });
    const at = groups.findIndex((existing) => existing.groupId === entry.groupId);
    if (at >= 0) groups[at] = entry;
    else groups.push(entry);
    // The 0.2.x top-level token goes only if it IS the one being filed: a different one is another
    // group's token waiting to be filed, and dropping it would lose that group's host access.
    const { companionToken: legacy, ...withoutLegacy } = raw;
    const rest = legacy === undefined || legacy === token ? withoutLegacy : raw;
    return withGroups(
      typeof rest.lastGroupId === 'string' && rest.lastGroupId.length > 0
        ? rest
        : { ...rest, lastGroupId: entry.groupId },
      groups,
    );
  });
}

/**
 * Overlay start (M13.8): the server's list of the PUUID's memberships replaces what the config knew. New ones
 * are added (a friend who joined by playing sees the group with zero setup), names are refreshed, and an entry
 * the server no longer lists goes unless it carries a host token (that token's own 403 handles it).
 */
export function mergeServerGroups(
  configDir: string,
  apiBase: string,
  listed: readonly { id: string; slug: string; name: string }[],
): string {
  return updateConfig(configDir, (raw) => {
    const known = groupsOf(raw);
    const next: GroupEntry[] = [];
    for (const item of listed) {
      const current = known.find((group) => group.groupId === item.id);
      next.push({
        groupId: item.id,
        slug: item.slug,
        name: item.name,
        ...(current?.companionToken ? { companionToken: current.companionToken } : {}),
      });
    }
    for (const group of known) {
      if (group.companionToken && !next.some((kept) => kept.groupId === group.groupId)) next.push(group);
    }
    return withGroups(raw.apiBase === undefined ? { ...raw, apiBase } : raw, next);
  });
}

// ---------------------------------------------------------------------------
// Talking to the server about groups
// ---------------------------------------------------------------------------

export const OVERLAY_GROUPS_PATH = '/api/overlay/groups';

/** `GET /api/overlay/groups?puuid=`: the PUUID's memberships. Null when the answer was not usable. */
export async function fetchOverlayGroups(
  apiBase: string,
  puuid: string,
  options: { fetch?: FetchLike; logger?: CompanionLogger } = {},
): Promise<{ id: string; slug: string; name: string }[] | null> {
  const api = new ApiClient({
    apiBase,
    maxAttempts: 1,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const result = await api.request(
    'GET',
    `${OVERLAY_GROUPS_PATH}?puuid=${encodeURIComponent(puuid)}`,
    undefined,
    overlayGroupsResponseSchema,
    1,
    { quiet: true },
  );
  return result.ok ? result.data.groups : null;
}

/**
 * Host start: if a token sits at the top level of the config (the 0.2.x single token, or a fresh paste),
 * ask the server which group it is for and file it there. The answer comes from `/api/companion/me` when it
 * carries a `group`, else from the PUUID's memberships when there is exactly one. Anything else (offline,
 * several groups and no `group` yet) leaves the token where it is: it still posts, it is only unlabelled.
 * Returns the group it was filed under, or null.
 */
export async function resolveTopLevelToken(options: {
  configDir: string;
  config: CompanionConfig;
  logger?: CompanionLogger;
  fetch?: FetchLike;
}): Promise<{ groupId: string; slug: string; name: string } | null> {
  const { config } = options;
  const logger = options.logger ?? createMemoryLogger();
  if (!isHostConfig(config) || !config.companionToken) return null;
  const token = config.companionToken;
  const api = new ApiClient({
    apiBase: config.apiBase,
    token,
    maxAttempts: 1,
    logger,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const me = await checkIdentity(api);
  if (me.status !== 'ok') return null;

  let group: { groupId: string; slug: string; name: string } | null = me.group
    ? { groupId: me.group.id, slug: me.group.slug, name: me.group.name }
    : null;
  if (group === null) {
    const listed = await fetchOverlayGroups(config.apiBase, me.puuid, {
      logger,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    if (listed?.length === 1) {
      const only = listed[0] as { id: string; slug: string; name: string };
      group = { groupId: only.id, slug: only.slug, name: only.name };
    }
  }
  if (group === null) {
    logger.info('the saved token has no known group yet; it keeps working unlabelled');
    return null;
  }
  const hadFiled = (config.groups ?? []).find((entry) => entry.groupId === group.groupId);
  fileTokenUnderGroup(options.configDir, group, token);
  // Only the first token a group ever had inherits the old root state; a rotation keeps its own directory.
  if (!hadFiled?.companionToken) {
    adoptLegacyState(options.configDir, group.groupId, logger, token);
  }
  logger.info('the saved token is filed under its group', { groupId: group.groupId, slug: group.slug });
  return group;
}
