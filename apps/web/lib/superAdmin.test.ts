import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminGroupResponseSchema, adminInviteViewSchema } from '@customs/db/schemas';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_READ_ONLY_LINE, adminAccess, adminInviteView, INVITE_HIDDEN } from './admin/readView';
import {
  ADMIN_GROUP_REQUIRED,
  type AdminPlayerRecord,
  type AdminReader,
  authorizeAdmin,
  authorizeAdminRead,
  NO_SUCH_GROUP,
  NOT_A_GROUP_ADMIN,
  type SessionUserLike,
} from './adminAuth';
import type { GroupRoleLookup } from './groups/membership';
import { authorizeOperator, OPERATOR_ONLY } from './ops/operator';
import { isSuperAdmin, parseSuperAdminIds, SUPER_ADMIN_ENV } from './superAdmin';

/**
 * The operator (M13.6 / M14.19) without a database: the env list, the admin read gate, the write
 * gate ignoring the list, the operator gate, and the invite masking. The integration half is
 * `app/api/ops/ops.integration.test.ts`.
 */

const OPERATOR_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const HANA_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const GROUP_A = '00000000-0000-4000-8000-00000000000a';
const GROUP_B = '00000000-0000-4000-8000-00000000000b';
const NO_GROUP = '00000000-0000-4000-8000-0000000000ff';

const env = { [SUPER_ADMIN_ENV]: ` ${OPERATOR_ID.toUpperCase()} , not-an-id,,` };

function sessionUser(id: string, snowflake: string | null): SessionUserLike {
  return {
    id,
    email: `${id}@example.invalid`,
    identities: snowflake === null ? [] : [{ id: snowflake, provider: 'discord' }],
  };
}

const PLAYERS: Record<string, AdminPlayerRecord> = {
  '100': { playerId: 'p-operator', puuid: 'puuid-op', displayName: 'Op' },
  '200': { playerId: 'p-hana', puuid: 'puuid-hana', displayName: 'Hana' },
};

/** Hana: admin of A. The operator's player: owner of A, member of B. */
const ROLES: GroupRoleLookup = async (playerId, groupId) => {
  if (playerId === 'p-hana') return groupId === GROUP_A ? 'admin' : null;
  if (playerId === 'p-operator') return groupId === GROUP_A ? 'owner' : groupId === GROUP_B ? 'member' : null;
  return null;
};

function readAs(user: SessionUserLike | null, groupId: string | null) {
  return authorizeAdminRead({
    resolveSessionUser: async () => user,
    lookupPlayerByDiscordId: async (snowflake) => PLAYERS[snowflake] ?? null,
    lookupGroupRole: ROLES,
    groupId,
    isSuperAdmin: (id) => isSuperAdmin(id, env),
    groupExists: async (id) => id === GROUP_A || id === GROUP_B,
  });
}

describe('SUPER_ADMIN_USER_IDS', () => {
  it('parses a comma list, trims, lower-cases and drops what is not an id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect([...parseSuperAdminIds(env[SUPER_ADMIN_ENV])]).toEqual([OPERATOR_ID]);
    // The count only, never the entries.
    expect(warn.mock.calls.flat().join(' ')).not.toContain('not-an-id');
    warn.mockRestore();
  });

  it('is empty when unset or blank, so nobody is a super-admin', () => {
    expect(parseSuperAdminIds(undefined).size).toBe(0);
    expect(parseSuperAdminIds('  ,  ').size).toBe(0);
    expect(isSuperAdmin(OPERATOR_ID, {})).toBe(false);
    expect(isSuperAdmin(OPERATOR_ID, { [SUPER_ADMIN_ENV]: '' })).toBe(false);
  });

  it('matches the verified user id only', () => {
    expect(isSuperAdmin(OPERATOR_ID, env)).toBe(true);
    expect(isSuperAdmin(HANA_ID, env)).toBe(false);
    expect(isSuperAdmin(null, env)).toBe(false);
  });
});

describe('authorizeAdminRead', () => {
  it('lets a super-admin in no group and with no Discord identity read any group, read-only', async () => {
    const result = await readAs(sessionUser(OPERATOR_ID, null), GROUP_B);
    expect(result).toEqual({
      ok: true,
      reader: {
        kind: 'operator',
        groupId: GROUP_B,
        userId: OPERATOR_ID,
        readOnly: true,
        admin: null,
        email: `${OPERATOR_ID}@example.invalid`,
      },
    });
  });

  it('gives a super-admin who is a plain member the operator view, not member powers', async () => {
    const result = await readAs(sessionUser(OPERATOR_ID, '100'), GROUP_B);
    expect(result.ok && result.reader.kind).toBe('operator');
  });

  it("gives a super-admin who is the group's owner exactly that: an admin reader", async () => {
    const result = await readAs(sessionUser(OPERATOR_ID, '100'), GROUP_A);
    expect(result.ok && result.reader.kind).toBe('group_admin');
    expect(result.ok && result.reader.kind === 'group_admin' && result.reader.role).toBe('owner');
  });

  it('is a group admin for a group admin, with the role', async () => {
    const result = await readAs(sessionUser(HANA_ID, '200'), GROUP_A);
    expect(result.ok && result.reader.kind === 'group_admin' && result.reader.role).toBe('admin');
  });

  it("refuses everyone else with the admin gate's own answer", async () => {
    expect(await readAs(sessionUser(HANA_ID, '200'), GROUP_B)).toEqual({
      ok: false,
      status: 403,
      error: NOT_A_GROUP_ADMIN,
    });
    expect(await readAs(sessionUser(HANA_ID, null), GROUP_B)).toMatchObject({ ok: false, status: 403 });
    expect(await readAs(null, GROUP_B)).toEqual({ ok: false, status: 401, error: 'sign in required' });
  });

  it('is 400 for an operator naming no group and 404 for a group that does not exist', async () => {
    expect(await readAs(sessionUser(OPERATOR_ID, null), null)).toEqual({
      ok: false,
      status: 400,
      error: ADMIN_GROUP_REQUIRED,
    });
    expect(await readAs(sessionUser(OPERATOR_ID, null), 'nope')).toMatchObject({ status: 400 });
    expect(await readAs(sessionUser(OPERATOR_ID, null), NO_GROUP)).toEqual({
      ok: false,
      status: 404,
      error: NO_SUCH_GROUP,
    });
  });

  it('opens nothing when the list is empty', async () => {
    const result = await authorizeAdminRead({
      resolveSessionUser: async () => sessionUser(OPERATOR_ID, null),
      lookupPlayerByDiscordId: async () => null,
      lookupGroupRole: ROLES,
      groupId: GROUP_B,
      isSuperAdmin: (id) => isSuperAdmin(id, {}),
      groupExists: async () => true,
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});

describe('the write gate ignores the list', () => {
  it('refuses a super-admin who is not an admin of the group, whatever the env says', async () => {
    const before = process.env[SUPER_ADMIN_ENV];
    process.env[SUPER_ADMIN_ENV] = OPERATOR_ID;
    try {
      for (const user of [sessionUser(OPERATOR_ID, null), sessionUser(OPERATOR_ID, '100')]) {
        const result = await authorizeAdmin({
          resolveSessionUser: async () => user,
          lookupPlayerByDiscordId: async (snowflake) => PLAYERS[snowflake] ?? null,
          lookupGroupRole: ROLES,
          groupId: GROUP_B,
        });
        expect(result).toMatchObject({ ok: false, status: 403 });
      }
    } finally {
      if (before === undefined) delete process.env[SUPER_ADMIN_ENV];
      else process.env[SUPER_ADMIN_ENV] = before;
    }
  });
});

describe('authorizeOperator', () => {
  const ids = parseSuperAdminIds(OPERATOR_ID);

  it('is 403 for everyone when the list is empty, without even resolving the session', async () => {
    const resolve = vi.fn(async () => sessionUser(OPERATOR_ID, null));
    expect(await authorizeOperator({ superAdminIds: new Set(), resolveSessionUser: resolve })).toEqual({
      ok: false,
      status: 403,
      error: OPERATOR_ONLY,
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('is 401 without a session, 403 off the list, ok on it', async () => {
    expect(
      await authorizeOperator({ superAdminIds: ids, resolveSessionUser: async () => null }),
    ).toMatchObject({
      status: 401,
    });
    expect(
      await authorizeOperator({
        superAdminIds: ids,
        resolveSessionUser: async () => sessionUser(HANA_ID, '200'),
      }),
    ).toMatchObject({ status: 403 });
    expect(
      await authorizeOperator({
        superAdminIds: ids,
        resolveSessionUser: async () => sessionUser(OPERATOR_ID, null),
      }),
    ).toEqual({ ok: true, operator: { userId: OPERATOR_ID, email: `${OPERATOR_ID}@example.invalid` } });
  });
});

describe('the invite as each reader sees it', () => {
  const invite = { code: 'abcdefghijklmnopqrstuv', rotatedAt: '2026-10-03T00:00:00.000Z' };
  const operator: AdminReader = {
    kind: 'operator',
    groupId: GROUP_B,
    userId: OPERATOR_ID,
    readOnly: true,
    admin: null,
    email: null,
  };
  const admin = {
    kind: 'group_admin',
    groupId: GROUP_A,
    userId: HANA_ID,
    readOnly: false,
    role: 'admin',
    admin: {} as never,
  } satisfies AdminReader;

  it("is masked for an operator, with product's sentence, whether or not a code exists", () => {
    for (const stored of [invite, null]) {
      const view = adminInviteView(operator, stored, 'http://localhost:3000');
      expect(view).toEqual({ state: 'hidden', message: INVITE_HIDDEN });
      expect(JSON.stringify(view)).not.toContain(invite.code);
      expect(adminInviteViewSchema.parse(view)).toEqual(view);
    }
    expect(INVITE_HIDDEN).toBe("Hidden. Only this group's admins can see the invite link.");
    expect(ADMIN_READ_ONLY_LINE).toBe('Read only. You are not an admin of this group.');
  });

  it('is the full link for an admin, and none when there is no code', () => {
    expect(adminInviteView(admin, invite, 'https://kustom.example')).toEqual({
      state: 'shown',
      code: invite.code,
      url: `https://kustom.example/join/${invite.code}`,
      rotatedAt: invite.rotatedAt,
    });
    expect(adminInviteView(admin, null, 'https://kustom.example')).toEqual({ state: 'none' });
  });

  it('says read-only for the operator in the access block', () => {
    expect(adminAccess(operator)).toEqual({ kind: 'operator', readOnly: true });
    expect(adminAccess(admin)).toEqual({ kind: 'group_admin', role: 'admin', readOnly: false });
    expect(() =>
      adminGroupResponseSchema.parse({
        ok: true,
        group: { id: GROUP_B, slug: 'b-group', name: 'B' },
        access: adminAccess(operator),
        invite: adminInviteView(operator, invite, 'http://localhost:3000'),
      }),
    ).not.toThrow();
  });
});

describe('nothing names the super-admin, and no write goes through the read gate', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else out.push(path);
    }
    return out;
  }

  it('no migration mentions a super-admin (acceptance 3)', () => {
    const migrations = walk(join(root, 'packages/db/supabase/migrations'));
    expect(migrations.length).toBeGreaterThan(0);
    for (const file of migrations) {
      expect([file, /super[\s_-]?admin/i.test(readFileSync(file, 'utf8'))]).toEqual([file, false]);
    }
  });

  it('every /api/admin route that exports a write is on the write gate, never the read gate', () => {
    const adminApi = join(root, 'apps/web/app/api/admin');
    const routes = walk(adminApi).filter((file) => file.endsWith('/route.ts'));
    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) {
      const dir = route.slice(0, -'route.ts'.length);
      const sources = [route, `${dir}handler.ts`]
        .filter((file) => {
          try {
            return statSync(file).isFile();
          } catch {
            return false;
          }
        })
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');
      const writes = /export const (POST|PUT|PATCH|DELETE)\b/.test(readFileSync(route, 'utf8'));
      if (writes) {
        expect([route, sources.includes('withAdminRead')]).toEqual([route, false]);
      }
    }
  });
});
