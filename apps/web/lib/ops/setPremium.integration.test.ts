import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { listOpsGroups } from './groups';
import { setGroupPremium } from './setPremium';

/**
 * M16.2 against the local stack: `set-premium` toggles a scratch group's flag, is idempotent, and
 * stamps `premium_changed_at` only when the flag flips; the anon key cannot update it; `/ops`'s
 * listing reads it; and the real command refuses a non-local URL without `--hosted`.
 *
 * Skipped without the stack, and **skipped until 0031 is applied** (the columns are not there
 * before). The column grants for `authenticated` are `packages/db`'s `premiumFlag.integration.test.ts`.
 */

const stack = await resolveLocalStack();
const db =
  stack === null
    ? null
    : createClient<Database>(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
const applied = db !== null && (await db.from('groups').select('premium').limit(1)).error === null;

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The real command, as `pnpm --filter web set-premium` runs it, with the env given (no `.env.local`). */
function runScript(args: string[], env: Record<string, string>): { code: number; out: string } {
  try {
    const out = execFileSync(
      process.execPath,
      ['--conditions=react-server', '--import', 'tsx', 'scripts/set-premium.ts', ...args],
      {
        cwd: WEB_ROOT,
        env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env },
        encoding: 'utf8',
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { code: 0, out };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, out: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

describe.skipIf(!applied)('set-premium against the local stack (skipped until 0031 is applied)', () => {
  const runId = randomUUID().slice(0, 8);
  let groups: Record<'p', string>;
  let slug = '';

  beforeAll(async () => {
    const service = db as NonNullable<typeof db>;
    groups = await createTestGroups(service, `m162${runId}`, ['p'] as const);
    slug = `it-m162${runId}-p`;
  });

  afterAll(async () => {
    if (groups) await deleteTestGroups(db as NonNullable<typeof db>, Object.values(groups));
  });

  async function read() {
    const { data, error } = await (db as NonNullable<typeof db>)
      .from('groups')
      .select('premium, premium_changed_at, ai_monthly_cap_usd')
      .eq('id', groups.p)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  it('a new group reads off, never changed, $2 cap', async () => {
    expect(await read()).toEqual({ premium: false, premium_changed_at: null, ai_monthly_cap_usd: 2 });
  });

  it('turns it on, stamps it, and a second run changes nothing', async () => {
    const service = db as NonNullable<typeof db>;

    const first = await setGroupPremium(service, { slug, premium: true, capUsd: null });
    expect(first).toMatchObject({
      status: 'ok',
      changed: true,
      before: { premium: false },
      after: { premium: true },
    });
    const on = await read();
    expect(on.premium).toBe(true);
    expect(on.premium_changed_at).not.toBeNull();

    const again = await setGroupPremium(service, { slug, premium: true, capUsd: null });
    expect(again).toMatchObject({ status: 'ok', changed: false });
    expect(await read()).toEqual(on);

    const capped = await setGroupPremium(service, { slug, premium: true, capUsd: 3.5 });
    expect(capped).toMatchObject({ changed: true, after: { monthlyCapUsd: 3.5 } });
    expect(await read()).toEqual({ ...on, ai_monthly_cap_usd: 3.5 });
  });

  it('the anon key cannot update the flag', async () => {
    const { url, anonKey } = stack as NonNullable<typeof stack>;
    const anon = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
    const before = await read();
    const { error } = await anon.from('groups').update({ premium: false }).eq('id', groups.p);
    expect(error).not.toBeNull();
    expect(await read()).toEqual(before);
  });

  it('/ops lists it read-only', async () => {
    const row = (await listOpsGroups(db as NonNullable<typeof db>)).find((group) => group.id === groups.p);
    expect(row?.premium).toMatchObject({ premium: true, monthlyCapUsd: 3.5 });
    expect(row?.premium.premiumChangedAt).not.toBeNull();
    // M16.10: $3.50 with nothing spent is under the cap.
    expect(row?.aiCapReached).toBe(false);
  });

  it('M16.10: /ops reads Paused · cap reached at the cap, and not once it is raised again', async () => {
    const client = db as NonNullable<typeof db>;
    await setGroupPremium(client, { slug, premium: true, capUsd: 0 });
    const at = (await listOpsGroups(client)).find((group) => group.id === groups.p);
    expect(at?.aiCapReached).toBe(true);
    await setGroupPremium(client, { slug, premium: true, capUsd: 3.5 });
    const under = (await listOpsGroups(client)).find((group) => group.id === groups.p);
    expect(under?.aiCapReached).toBe(false);
  });

  it('the real command turns it off, prints the URL and before / after, and is idempotent', () => {
    const { url, serviceRoleKey } = stack as NonNullable<typeof stack>;
    const env = { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey };
    const off = runScript([slug, 'off'], env);
    expect(off.code, off.out).toBe(0);
    expect(off.out).toContain(`supabase  ${url}`);
    expect(off.out).toMatch(/before\s+on, cap \$3\.50/);
    expect(off.out).toMatch(/after\s+off, cap \$3\.50/);

    const again = runScript([slug, 'off'], env);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain('no change');
  });
});

describe('set-premium, the command, without a database', () => {
  it('the real command refuses a non-local URL without --hosted, before connecting', () => {
    const refused = runScript(['customs', 'on'], {
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'not-a-key',
    });
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('supabase  https://abcdefghijklmnop.supabase.co');
    expect(refused.out).toMatch(/refused: .*--hosted/);
  });

  it('refuses bad arguments with the usage, before reading the environment', () => {
    const bad = runScript(['customs', 'maybe'], {});
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('usage: pnpm --filter web set-premium <slug> on|off');
  });
});
