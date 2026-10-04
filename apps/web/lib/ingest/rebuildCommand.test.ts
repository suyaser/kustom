import { describe, expect, it, vi } from 'vitest';
import type { ServiceClient } from '../supabase';
import type { RebuildAllResult } from './rebuild';
import {
  checkRebuildTarget,
  formatTargetLine,
  parseRebuildArgs,
  type RebuildCommandEnv,
  runRebuildCommand,
} from './rebuildCommand';

/**
 * M14.27: `rebuild-ratings` names its database on the first line (host only) and refuses any
 * database that is not the local stack unless `--hosted` is passed -- before it creates a client,
 * so a refused run reads and writes nothing.
 */

const LOCAL = 'http://127.0.0.1:54321';
const HOSTED = 'https://abcdefghijkl.supabase.co';
const KEY = 'service-role-SECRET-eyJhbGciOiJIUzI1NiJ9';

function harness(result: RebuildAllResult = { ok: true, groups: [] }) {
  const out: string[] = [];
  const err: string[] = [];
  const client = {} as ServiceClient;
  const createClient = vi.fn((_url: string, _key: string) => client);
  const rebuildAllGroups = vi.fn(async () => result);
  return {
    out,
    err,
    createClient,
    rebuildAllGroups,
    run: (argv: string[], env: RebuildCommandEnv) =>
      runRebuildCommand(argv, env, {
        createClient,
        rebuildAllGroups,
        now: () => 1000,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      }),
  };
}

describe('parseRebuildArgs', () => {
  it('reads every flag, --hosted included, in any order', () => {
    expect(parseRebuildArgs([])).toEqual({
      dryRun: false,
      force: false,
      prune: false,
      hosted: false,
      groupSlug: null,
    });
    expect(parseRebuildArgs(['--hosted', '--group', 'customs', '--dry-run'])).toEqual({
      dryRun: true,
      force: false,
      prune: false,
      hosted: true,
      groupSlug: 'customs',
    });
  });

  it.each([[['--nope']], [['--group']], [['--group', '--hosted']], [['customs']]])('refuses %j', (argv) => {
    expect(parseRebuildArgs(argv)).toBeNull();
  });
});

describe('checkRebuildTarget', () => {
  it('accepts the local stack with or without --hosted', () => {
    for (const url of [LOCAL, 'http://localhost:54321', 'http://[::1]:54321']) {
      expect(checkRebuildTarget(url, false), url).toMatchObject({ ok: true, local: true });
      expect(checkRebuildTarget(url, true), url).toMatchObject({ ok: true, local: true });
    }
    expect(checkRebuildTarget(LOCAL, false)).toEqual({
      ok: true,
      host: '127.0.0.1:54321',
      local: true,
      line: 'target        127.0.0.1:54321 (local)',
    });
  });

  it('refuses anything else unless --hosted is passed', () => {
    expect(checkRebuildTarget(HOSTED, false)).toMatchObject({
      ok: false,
      line: 'target        abcdefghijkl.supabase.co (hosted)',
      error: expect.stringMatching(/--hosted/),
    });
    expect(checkRebuildTarget(HOSTED, true)).toMatchObject({ ok: true, local: false });
    // A host that only looks local is not local.
    expect(checkRebuildTarget('https://127.0.0.1.example.com', false).ok).toBe(false);
    expect(checkRebuildTarget('https://localhost.evil.dev', false).ok).toBe(false);
    expect(checkRebuildTarget('not a url', true)).toMatchObject({ ok: false, line: null });
  });

  it('puts the host and nothing else of the URL in the line', () => {
    const url = 'https://admin:pw-SECRET@abcdefghijkl.supabase.co/rest/v1?apikey=SECRET';
    const target = checkRebuildTarget(url, true);
    expect(target).toMatchObject({ ok: true, line: 'target        abcdefghijkl.supabase.co (hosted)' });
    expect(formatTargetLine('abcdefghijkl.supabase.co', false)).not.toContain('SECRET');
  });
});

describe('runRebuildCommand', () => {
  it('folds the local stack with no flag, and prints the target first', async () => {
    const h = harness();
    const code = await h.run(['--dry-run'], {
      NEXT_PUBLIC_SUPABASE_URL: LOCAL,
      SUPABASE_SERVICE_ROLE_KEY: KEY,
    });
    expect(code).toBe(0);
    expect(h.out[0]).toBe('target        127.0.0.1:54321 (local)');
    expect(h.createClient).toHaveBeenCalledWith(LOCAL, KEY);
    expect(h.rebuildAllGroups).toHaveBeenCalledWith(expect.anything(), {
      force: false,
      dryRun: true,
      prune: false,
      groupSlug: null,
    });
    expect(h.err).toEqual([]);
  });

  it.each([[[]], [['--dry-run']], [['--force', '--group', 'customs']]])(
    'refuses a hosted URL without --hosted (%j): exit 1, no client, nothing read or written',
    async (argv) => {
      const h = harness();
      const code = await h.run(argv, { NEXT_PUBLIC_SUPABASE_URL: HOSTED, SUPABASE_SERVICE_ROLE_KEY: KEY });
      expect(code).toBe(1);
      expect(h.out).toEqual(['target        abcdefghijkl.supabase.co (hosted)']);
      expect(h.err.join('\n')).toMatch(/not the local stack; pass --hosted/);
      expect(h.createClient).not.toHaveBeenCalled();
      expect(h.rebuildAllGroups).not.toHaveBeenCalled();
    },
  );

  it('folds a hosted URL with --hosted', async () => {
    const h = harness();
    const code = await h.run(['--hosted'], {
      NEXT_PUBLIC_SUPABASE_URL: HOSTED,
      SUPABASE_SERVICE_ROLE_KEY: KEY,
    });
    expect(code).toBe(0);
    expect(h.out[0]).toBe('target        abcdefghijkl.supabase.co (hosted)');
    expect(h.rebuildAllGroups).toHaveBeenCalledTimes(1);
  });

  it('never prints the key or any secret part of the URL, on any path', async () => {
    const url = 'https://admin:pw-SECRET@abcdefghijkl.supabase.co/?apikey=SECRET';
    const refused: RebuildAllResult = {
      ok: true,
      groups: [
        {
          groupId: 'g1',
          groupSlug: 'customs',
          result: { ok: false, code: 'guard', message: 'a lobby is live', report: null },
        },
      ],
    };
    for (const [argv, result] of [
      [[], undefined],
      [['--hosted'], undefined],
      [['--hosted', '--dry-run'], refused],
    ] as const) {
      const h = harness(result);
      await h.run([...argv], { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: KEY });
      const printed = [...h.out, ...h.err].join('\n');
      expect(printed).toContain('target        abcdefghijkl.supabase.co (hosted)');
      expect(printed).not.toContain(KEY);
      expect(printed).not.toContain('SECRET');
    }
  });

  it('keeps the exit codes: a refused group is 1, a missing env is 1 with no target line', async () => {
    const refused = harness({
      ok: true,
      groups: [
        {
          groupId: 'g1',
          groupSlug: 'customs',
          result: { ok: false, code: 'guard', message: 'live', report: null },
        },
      ],
    });
    expect(await refused.run([], { NEXT_PUBLIC_SUPABASE_URL: LOCAL, SUPABASE_SERVICE_ROLE_KEY: KEY })).toBe(
      1,
    );
    expect(refused.out).toContain('group         customs');

    const fenced = harness({
      ok: true,
      groups: [
        {
          groupId: 'g1',
          groupSlug: 'customs',
          result: { ok: false, code: 'fence', message: 'again', report: null },
        },
      ],
    });
    expect(await fenced.run([], { NEXT_PUBLIC_SUPABASE_URL: LOCAL, SUPABASE_SERVICE_ROLE_KEY: KEY })).toBe(2);

    const missing = harness();
    expect(await missing.run([], { NEXT_PUBLIC_SUPABASE_URL: LOCAL })).toBe(1);
    expect(missing.out).toEqual([]);
    expect(missing.createClient).not.toHaveBeenCalled();
  });
});
