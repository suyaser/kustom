import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensurePlayers } from '@/lib/ingest/players';
import { localAuthUsers } from '@/lib/testing/authUsers';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.51 against the local stack: where `/admin/login` sends each session. An unlinked creator
 * lands on their group's admin home; an unlinked session that created nothing is still denied; a
 * linked admin still gets their group. Sessions are injected (no OAuth); `created_by` needs a real
 * `auth.users` row, made through `localAuthUsers`. Skipped without the stack or Docker.
 */

const stack = await resolveLocalStack();
const authUsers = stack === null ? null : localAuthUsers();

if (stack === null || authUsers === null) {
  describe.skip('admin login against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { decideLoginViewer } = await import('./adminGroup');
  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const ADMIN = `it-${runId}-login-admin`;
  const groups = { made: '', run: '' };
  const users = { creator: '', stranger: '' };
  let adminId = '';

  beforeAll(async () => {
    const [creator, stranger] = authUsers.create([
      `creator-${runId}-login@example.invalid`,
      `stranger-${runId}-login@example.invalid`,
    ]);
    users.creator = creator ?? '';
    users.stranger = stranger ?? '';
    const made = await createTestGroups(db, runId, ['lgmade', 'lgrun'] as const);
    groups.made = made.lgmade;
    groups.run = made.lgrun;
    const stamped = await db.from('groups').update({ created_by: users.creator }).eq('id', groups.made);
    if (stamped.error) throw new Error(stamped.error.message);
    adminId = (await ensurePlayers(db, [{ puuid: ADMIN }])).get(ADMIN) ?? '';
    await setTestMembership(db, groups.run, adminId, 'admin');
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().eq('puuid', ADMIN);
    authUsers.remove(Object.values(users).filter((id) => id !== ''));
  });

  const unlinked = (userId: string) =>
    ({ kind: 'signed-in', userId, discordId: `d-${userId}`, player: null }) as const;

  it("lands an unlinked creator on their group's admin home", async () => {
    expect(await decideLoginViewer(db, unlinked(users.creator))).toEqual({
      kind: 'creator-unlinked',
      href: `/g/it-${runId}-lgmade/admin`,
    });
  });

  it('still denies an unlinked session that created no group', async () => {
    expect(await decideLoginViewer(db, unlinked(users.stranger))).toEqual({ kind: 'denied' });
  });

  it('still sends a linked admin to the group they run, and nobody signed in is anonymous', async () => {
    expect(
      await decideLoginViewer(db, {
        kind: 'signed-in',
        userId: randomUUID(),
        discordId: 'd-admin',
        player: { playerId: adminId, puuid: ADMIN },
      }),
    ).toEqual({ kind: 'runs-group', href: `/g/it-${runId}-lgrun/admin` });
    expect(await decideLoginViewer(db, { kind: 'anonymous' })).toEqual({ kind: 'anonymous' });
  });
}
