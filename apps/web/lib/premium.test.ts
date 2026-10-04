import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiGateOpen,
  groupMonthlyCapUsd,
  isPremium,
  parseGroupPremium,
  readAiGate,
  readGroupPremium,
} from './premium';
import type { ServiceClient } from './supabase';

/** M16.2: the server-side Premium read, and the static guards that keep every AI path behind it. */

const GROUP = '11111111-1111-4111-8111-111111111111';

type Answer = { data: unknown; error: { message: string } | null };

/** Just enough of the service client for `from('groups').select().eq().maybeSingle()`. */
function fakeClient(answer: Answer | (() => never)) {
  const calls: { table: string; columns: string; column: string; value: unknown }[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(column: string, value: unknown) {
              calls.push({ table, columns, column, value });
              return {
                maybeSingle: async () => (typeof answer === 'function' ? answer() : answer),
              };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as ServiceClient, calls };
}

const ROW_ON = { premium: true, premium_changed_at: '2026-10-04T10:00:00+00:00', ai_monthly_cap_usd: 2 };
const ROW_OFF = { premium: false, premium_changed_at: null, ai_monthly_cap_usd: 2.5 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseGroupPremium', () => {
  it('camel-cases a valid row', () => {
    expect(parseGroupPremium(ROW_ON)).toEqual({
      premium: true,
      premiumChangedAt: '2026-10-04T10:00:00+00:00',
      monthlyCapUsd: 2,
    });
  });

  it.each([
    ['a string flag', { ...ROW_ON, premium: 'true' }],
    ['a missing flag', { premium_changed_at: null, ai_monthly_cap_usd: 2 }],
    ['a negative cap', { ...ROW_ON, ai_monthly_cap_usd: -1 }],
    ['a cap over 100', { ...ROW_ON, ai_monthly_cap_usd: 100.01 }],
    ['a fraction of a cent', { ...ROW_ON, ai_monthly_cap_usd: 2.005 }],
    ['a string cap', { ...ROW_ON, ai_monthly_cap_usd: '2.00' }],
  ])('throws on %s', (_label, row) => {
    expect(() => parseGroupPremium(row)).toThrow(/malformed/);
  });
});

describe('readGroupPremium', () => {
  it('reads the three columns of the one group, by id', async () => {
    const { client, calls } = fakeClient({ data: ROW_OFF, error: null });
    await expect(readGroupPremium(client, GROUP)).resolves.toEqual({
      premium: false,
      premiumChangedAt: null,
      monthlyCapUsd: 2.5,
    });
    expect(calls).toEqual([
      {
        table: 'groups',
        columns: 'premium, premium_changed_at, ai_monthly_cap_usd',
        column: 'id',
        value: GROUP,
      },
    ]);
  });

  it('is null for no such group and throws on a database error', async () => {
    await expect(readGroupPremium(fakeClient({ data: null, error: null }).client, GROUP)).resolves.toBeNull();
    await expect(
      readGroupPremium(fakeClient({ data: null, error: { message: 'boom' } }).client, GROUP),
    ).rejects.toThrow(/boom/);
  });
});

describe('isPremium', () => {
  it('is true only for an existing group with the flag on', async () => {
    expect(await isPremium(fakeClient({ data: ROW_ON, error: null }).client, GROUP)).toBe(true);
    expect(await isPremium(fakeClient({ data: ROW_OFF, error: null }).client, GROUP)).toBe(false);
    expect(await isPremium(fakeClient({ data: null, error: null }).client, GROUP)).toBe(false);
  });

  it('fails closed: a database error, a malformed row or a throw is not Premium', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await isPremium(fakeClient({ data: null, error: { message: 'down' } }).client, GROUP)).toBe(false);
    expect(await isPremium(fakeClient({ data: { premium: 'yes' }, error: null }).client, GROUP)).toBe(false);
    const throwing = fakeClient(() => {
      throw new Error('network');
    });
    expect(await isPremium(throwing.client, GROUP)).toBe(false);
  });
});

describe('groupMonthlyCapUsd', () => {
  it('reads the cap, and is null when it cannot (no budget, no call)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await groupMonthlyCapUsd(fakeClient({ data: ROW_OFF, error: null }).client, GROUP)).toBe(2.5);
    expect(await groupMonthlyCapUsd(fakeClient({ data: null, error: null }).client, GROUP)).toBeNull();
    expect(
      await groupMonthlyCapUsd(fakeClient({ data: null, error: { message: 'down' } }).client, GROUP),
    ).toBeNull();
    expect(
      await groupMonthlyCapUsd(
        fakeClient({ data: { ...ROW_ON, ai_monthly_cap_usd: -5 }, error: null }).client,
        GROUP,
      ),
    ).toBeNull();
  });
});

describe('readAiGate / aiGateOpen (M16.3)', () => {
  const GATE_ROW = { premium: true, premium_changed_at: '2026-10-04T10:00:00+00:00', ai_lines_enabled: true };

  it('reads premium, its stamp and the AI lines switch', async () => {
    const { client, calls } = fakeClient({ data: GATE_ROW, error: null });
    const gate = await readAiGate(client, GROUP);
    expect(gate).toEqual({
      premium: true,
      linesEnabled: true,
      premiumChangedAt: '2026-10-04T10:00:00+00:00',
    });
    expect(aiGateOpen(gate)).toBe(true);
    expect(calls[0]?.columns).toBe('premium, premium_changed_at, ai_lines_enabled');
  });

  it('is closed with either switch off', async () => {
    const off = await readAiGate(
      fakeClient({ data: { ...GATE_ROW, ai_lines_enabled: false }, error: null }).client,
      GROUP,
    );
    expect(aiGateOpen(off)).toBe(false);
    const notPremium = await readAiGate(
      fakeClient({ data: { ...GATE_ROW, premium: false }, error: null }).client,
      GROUP,
    );
    expect(aiGateOpen(notPremium)).toBe(false);
  });

  it('fails closed: no group, a database without 0033, a malformed row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readAiGate(fakeClient({ data: null, error: null }).client, GROUP)).toBeNull();
    expect(
      await readAiGate(
        fakeClient({ data: null, error: { message: 'column groups.ai_lines_enabled does not exist' } })
          .client,
        GROUP,
      ),
    ).toBeNull();
    expect(await readAiGate(fakeClient({ data: { premium: true }, error: null }).client, GROUP)).toBeNull();
    expect(aiGateOpen(null)).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Static guards
 * ------------------------------------------------------------------------- */

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === 'node_modules' || name === '.next' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Imports `lib/premium` from anywhere: `@/lib/premium`, `../premium`, `../../lib/premium`, ... */
const IMPORTS_PREMIUM = /from\s+['"](?:@\/lib\/premium|(?:\.\.?\/)+(?:lib\/)?premium)(?:\.ts)?['"]/;

describe('every AI path reads the flag', () => {
  it('every file under lib/ai/ imports lib/premium', () => {
    const missing = sourceFiles(join(WEB_ROOT, 'lib/ai'))
      .filter((path) => !IMPORTS_PREMIUM.test(readFileSync(path, 'utf8')))
      .map((path) => relative(WEB_ROOT, path));
    expect(missing).toEqual([]);
  });

  it('the import check recognises the import forms a file would use', () => {
    for (const line of [
      "import { isPremium } from '@/lib/premium';",
      "import { isPremium } from '../premium';",
      "import { isPremium } from '../../lib/premium';",
      'import { isPremium } from "./premium.ts";',
    ]) {
      expect(line, line).toMatch(IMPORTS_PREMIUM);
    }
    expect("import { isPremiumish } from '../premiumish';").not.toMatch(IMPORTS_PREMIUM);
  });
});

describe('no HTTP route writes the flag', () => {
  const writer = join(WEB_ROOT, 'lib/ops/setPremium.ts');
  const app = sourceFiles(join(WEB_ROOT, 'app'));
  const lib = sourceFiles(join(WEB_ROOT, 'lib'));

  it("nothing under app/ imports the operator script's writer", () => {
    const importers = app
      .filter((path) => /setPremium['"]/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(WEB_ROOT, path));
    expect(importers).toEqual([]);
  });

  it('no app or lib file but the writer names premium or the cap in a write', () => {
    const WRITE = /\.(update|upsert|insert)\s*\(/;
    // A `premium:` key (a patch object) or either other column by name.
    const COLUMN = /\bpremium\??\s*:|premium_changed_at|ai_monthly_cap_usd/;
    const offenders = [...app, ...lib]
      .filter((path) => path !== writer)
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return WRITE.test(text) && COLUMN.test(text);
      })
      .map((path) => relative(WEB_ROOT, path));
    expect(offenders).toEqual([]);
  });

  it('the writer is where the guard expects it', () => {
    expect(existsSync(writer)).toBe(true);
  });
});
