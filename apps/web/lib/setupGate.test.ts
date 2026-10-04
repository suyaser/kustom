import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  type AdminPlayerRecord,
  authorizeAdmin,
  authorizeSetupWrite,
  NOT_A_GROUP_ADMIN,
  type SessionUserLike,
  toSetupWrite,
} from './adminAuth';
import type { GroupRoleLookup } from './groups/membership';

/**
 * M14.40 (S7): the group's creator, before they link a League account, may make the four setup
 * writes -- Connect Discord (connect + callback), the Discord test post, `discord-config`, the invite
 * rotate -- and nothing else. Lookups injected: no database, no OAuth.
 */

const CREATOR_ID = 'e3b0c442-0000-4000-8000-0000000000c1';
const STRANGER_ID = 'e3b0c442-0000-4000-8000-0000000000d2';
const GROUP = '00000000-0000-4000-8000-00000000000a';
const OTHER_GROUP = '00000000-0000-4000-8000-00000000000b';

function session(id: string, discord = true): SessionUserLike {
  return {
    id,
    email: `${id}@example.com`,
    identities: discord ? [{ id: `snow-${id}`, provider: 'discord' }] : [{ id: 'x', provider: 'email' }],
  };
}

const linked: AdminPlayerRecord = {
  playerId: '11111111-1111-4111-8111-111111111111',
  puuid: 'p',
  displayName: 'Hana',
};

/** `created_by` of GROUP is the creator; OTHER_GROUP has a different creator. */
const creators = async (groupId: string) =>
  groupId === GROUP ? CREATOR_ID : groupId === OTHER_GROUP ? STRANGER_ID : null;

function setup(
  user: SessionUserLike | null,
  opts: {
    player?: AdminPlayerRecord | null;
    role?: Awaited<ReturnType<GroupRoleLookup>>;
    groupId?: string | null;
  } = {},
) {
  const lookups = {
    resolveSessionUser: async () => user,
    lookupPlayerByDiscordId: async () => opts.player ?? null,
    lookupGroupRole: (async () => opts.role ?? null) as GroupRoleLookup,
    groupId: opts.groupId === undefined ? GROUP : opts.groupId,
  };
  return {
    setupWrite: () => authorizeSetupWrite({ ...lookups, lookupGroupCreator: creators }),
    adminWrite: () => authorizeAdmin(lookups),
  };
}

describe('authorizeSetupWrite', () => {
  it('lets the unlinked creator make the setup writes in their own group', async () => {
    const result = await setup(session(CREATOR_ID)).setupWrite();
    expect(result).toEqual({
      ok: true,
      writer: { kind: 'unlinked_creator', userId: CREATOR_ID, groupId: GROUP, admin: null },
    });
  });

  it('refuses the unlinked creator on every other admin write (the admin gate never reads created_by)', async () => {
    const result = await setup(session(CREATOR_ID)).adminWrite();
    expect(result).toEqual({ ok: false, status: 403, error: 'no player is linked to this Discord account' });
  });

  it('refuses the creator in a group they did not create', async () => {
    const result = await setup(session(CREATOR_ID), { groupId: OTHER_GROUP }).setupWrite();
    expect(result).toEqual({ ok: false, status: 403, error: 'no player is linked to this Discord account' });
  });

  it('refuses an unlinked user who is not the creator, on setup writes and every other write', async () => {
    const { setupWrite, adminWrite } = setup(session(STRANGER_ID));
    expect(await setupWrite()).toEqual({
      ok: false,
      status: 403,
      error: 'no player is linked to this Discord account',
    });
    expect(await adminWrite()).toMatchObject({ ok: false, status: 403 });
  });

  it('is 401 without a session and never reads the creator', async () => {
    const lookupGroupCreator = vi.fn(creators);
    const result = await authorizeSetupWrite({
      resolveSessionUser: async () => null,
      lookupPlayerByDiscordId: async () => null,
      lookupGroupRole: async () => null,
      lookupGroupCreator,
      groupId: GROUP,
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(lookupGroupCreator).not.toHaveBeenCalled();
  });

  it('refuses the creator session with no Discord identity (it could not have made the group)', async () => {
    const result = await setup(session(CREATOR_ID, false)).setupWrite();
    expect(result).toEqual({ ok: false, status: 403, error: 'this session has no Discord identity' });
  });

  it('refuses the creator when the request names no group, or not a uuid', async () => {
    expect(await setup(session(CREATOR_ID), { groupId: null }).setupWrite()).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await setup(session(CREATOR_ID), { groupId: 'customs' }).setupWrite()).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('once the creator links a player, the normal role rules apply', async () => {
    // Paired as the owner: an admin-gate pass, as a group admin.
    const owner = await setup(session(CREATOR_ID), { player: linked, role: 'owner' }).setupWrite();
    expect(owner).toMatchObject({
      ok: true,
      writer: { kind: 'group_admin', userId: CREATOR_ID, groupId: GROUP },
    });

    // Linked but somehow only a member: created_by no longer helps.
    const member = await setup(session(CREATOR_ID), { player: linked, role: 'member' }).setupWrite();
    expect(member).toEqual({ ok: false, status: 403, error: NOT_A_GROUP_ADMIN });

    // Linked and in no membership at all: the same.
    const none = await setup(session(CREATOR_ID), { player: linked, role: null }).setupWrite();
    expect(none).toEqual({ ok: false, status: 403, error: NOT_A_GROUP_ADMIN });
  });

  it('passes a linked admin who did not create the group, as a group admin', async () => {
    const result = await setup(session(STRANGER_ID), { player: linked, role: 'admin' }).setupWrite();
    expect(result).toMatchObject({ ok: true, writer: { kind: 'group_admin', userId: STRANGER_ID } });
  });
});

describe('toSetupWrite', () => {
  it('reads an admin-gate pass as a group admin and keeps refusals as they are', () => {
    const refusal = { ok: false as const, status: 403 as const, error: 'nope' };
    expect(toSetupWrite(refusal)).toBe(refusal);
  });
});

/**
 * The allow-list: exactly these files under `app/api/admin` reach the setup gate. A new route that
 * wants it has to be added here on purpose -- the creator rule is not a general bypass.
 */
describe('the setup gate is an allow-list', () => {
  const webRoot = fileURLToPath(new URL('..', import.meta.url));
  const adminApi = join(webRoot, 'app/api/admin');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...walk(path));
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  }

  it('is used by Connect Discord, the test post, discord-config and the invite rotate only', () => {
    const users = walk(adminApi)
      .filter((file) =>
        /withSetupWriteAuth|resolveSetupWrite|authorizeSetupWrite|discordRouteDeps/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(adminApi, file))
      .sort();
    expect(users).toEqual([
      'discord-config/handler.ts',
      'discord/callback/handler.ts',
      'discord/connect/handler.ts',
      'discord/test/handler.ts',
      'invite/rotate/handler.ts',
    ]);
  });
});
