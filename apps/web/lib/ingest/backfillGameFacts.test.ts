import { describe, expect, it, vi } from 'vitest';
import type { ServiceClient } from '../supabase';
import { parseBackfillFactsArgs, runBackfillFactsCommand } from './backfillGameFacts';

/**
 * `backfill-game-facts` names its database on the first line (host only) and refuses anything but
 * the local stack without `--hosted`, before a client exists (rebuild-ratings' rule, M14.27). The
 * fill itself is `gameFacts.integration.test.ts`.
 */

const LOCAL = 'http://127.0.0.1:54321';
const HOSTED = 'https://abcdefghijkl.supabase.co';
const KEY = 'service-role-SECRET-eyJhbGciOiJIUzI1NiJ9';

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const groups = { data: [] as { id: string; slug: string }[], error: null };
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    // biome-ignore lint/suspicious/noThenProperty: a PostgREST builder is a thenable; this fakes one.
    then: (resolve: (value: typeof groups) => unknown) => resolve(groups),
  };
  const client = { from: () => query } as unknown as ServiceClient;
  const createClient = vi.fn((_url: string, _key: string) => client);
  return {
    out,
    err,
    createClient,
    run: (argv: string[], url: string | undefined) =>
      runBackfillFactsCommand(
        argv,
        { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: KEY },
        { createClient, now: () => 1000, out: (line) => out.push(line), err: (line) => err.push(line) },
      ),
  };
}

describe('parseBackfillFactsArgs', () => {
  it('reads the three flags in any order and refuses anything else', () => {
    expect(parseBackfillFactsArgs([])).toEqual({ dryRun: false, hosted: false, groupSlug: null });
    expect(parseBackfillFactsArgs(['--group', 'customs', '--hosted', '--dry-run'])).toEqual({
      dryRun: true,
      hosted: true,
      groupSlug: 'customs',
    });
    expect(parseBackfillFactsArgs(['--group'])).toBeNull();
    expect(parseBackfillFactsArgs(['--group', '--dry-run'])).toBeNull();
    expect(parseBackfillFactsArgs(['--force'])).toBeNull();
  });
});

describe('runBackfillFactsCommand', () => {
  it('refuses a hosted database without --hosted, dry runs too, before creating a client', async () => {
    for (const argv of [[], ['--dry-run']]) {
      const h = harness();
      expect(await h.run(argv, HOSTED)).toBe(1);
      expect(h.out[0]).toBe('target        abcdefghijkl.supabase.co (hosted)');
      expect(h.err.join('\n')).toContain('pass --hosted');
      expect(h.createClient).not.toHaveBeenCalled();
      expect([...h.out, ...h.err].join('\n')).not.toContain(KEY);
    }
  });

  it('runs on the local stack by default and on a hosted one with --hosted', async () => {
    const local = harness();
    // No groups in the fake: a clean "no groups" refusal, after the client.
    expect(await local.run([], LOCAL)).toBe(1);
    expect(local.out[0]).toBe('target        127.0.0.1:54321 (local)');
    expect(local.createClient).toHaveBeenCalledOnce();

    const hosted = harness();
    await hosted.run(['--hosted', '--group', 'customs'], HOSTED);
    expect(hosted.createClient).toHaveBeenCalledOnce();
    expect(hosted.err.join('\n')).toContain('no group customs');
  });

  it('needs the URL and the key, and prints the usage on a bad flag', async () => {
    const missing = harness();
    expect(await missing.run([], undefined)).toBe(1);
    expect(missing.createClient).not.toHaveBeenCalled();

    const bad = harness();
    expect(await bad.run(['--nope'], LOCAL)).toBe(1);
    expect(bad.err[0]).toContain('usage: pnpm --filter web backfill-game-facts');
  });
});
