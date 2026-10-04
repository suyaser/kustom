import { describe, expect, it } from 'vitest';
import type { ServiceClient } from '../supabase';
import { checkSetPremiumTarget, formatPremium, parseSetPremiumArgs, setGroupPremium } from './setPremium';

/** M16.2: `set-premium`'s arguments, its local-only guard, and its idempotent write. */

describe('parseSetPremiumArgs', () => {
  it('reads a slug and on or off, the cap and --hosted in any order', () => {
    expect(parseSetPremiumArgs(['customs', 'on'])).toEqual({
      ok: true,
      args: { slug: 'customs', premium: true, capUsd: null, hosted: false },
    });
    expect(parseSetPremiumArgs(['--cap', '2.5', 'friday', 'off', '--hosted'])).toEqual({
      ok: true,
      args: { slug: 'friday', premium: false, capUsd: 2.5, hosted: true },
    });
    expect(parseSetPremiumArgs(['customs', 'on', '--cap', '0'])).toMatchObject({ args: { capUsd: 0 } });
    expect(parseSetPremiumArgs(['customs', 'on', '--cap', '100.00'])).toMatchObject({
      args: { capUsd: 100 },
    });
  });

  it.each([
    [[]],
    [['customs']],
    [['customs', 'yes']],
    [['customs', 'ON']],
    [['customs', 'on', 'extra']],
    [['customs', 'on', '--cap']],
    [['customs', 'on', '--cap', '--hosted']],
    [['customs', 'on', '--cap', '-1']],
    [['customs', 'on', '--cap', '100.01']],
    [['customs', 'on', '--cap', '2.005']],
    [['customs', 'on', '--cap', '1e1']],
    [['customs', 'on', '--cap', '$2']],
    [['customs', 'on', '--cap', '']],
    [['customs', 'on', '--force']],
  ])('refuses %j', (argv) => {
    expect(parseSetPremiumArgs(argv).ok).toBe(false);
  });
});

describe('checkSetPremiumTarget', () => {
  it('writes to the local stack with or without --hosted', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321']) {
      expect(checkSetPremiumTarget(url, false), url).toEqual({ ok: true, local: true });
      expect(checkSetPremiumTarget(url, true), url).toEqual({ ok: true, local: true });
    }
  });

  it('refuses anything else unless --hosted is passed', () => {
    const hosted = 'https://abcdefghijkl.supabase.co';
    expect(checkSetPremiumTarget(hosted, false)).toMatchObject({ ok: false, error: /--hosted/ });
    expect(checkSetPremiumTarget(hosted, true)).toEqual({ ok: true, local: false });
    // A host that only looks local is not local.
    expect(checkSetPremiumTarget('https://127.0.0.1.example.com', false).ok).toBe(false);
    expect(checkSetPremiumTarget('https://localhost.evil.dev', false).ok).toBe(false);
    expect(checkSetPremiumTarget('not a url', true).ok).toBe(false);
  });
});

const GROUP = { id: '11111111-1111-4111-8111-111111111111', slug: 'friday', name: 'Friday Five' };

/** The select-then-maybe-update the writer does, recorded. */
function fakeClient(row: Record<string, unknown> | null, updated?: Record<string, unknown>) {
  const updates: unknown[] = [];
  const client = {
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
        update(patch: unknown) {
          updates.push(patch);
          return { eq: () => ({ select: () => ({ single: async () => ({ data: updated, error: null }) }) }) };
        },
      };
    },
  };
  return { client: client as unknown as ServiceClient, updates };
}

const OFF = { ...GROUP, premium: false, premium_changed_at: null, ai_monthly_cap_usd: 2 };
const ON = {
  ...GROUP,
  premium: true,
  premium_changed_at: '2026-10-04T10:00:00+00:00',
  ai_monthly_cap_usd: 2,
};

describe('setGroupPremium', () => {
  it('is not_found for an unknown slug, and writes nothing', async () => {
    const { client, updates } = fakeClient(null);
    await expect(setGroupPremium(client, { slug: 'nope', premium: true, capUsd: null })).resolves.toEqual({
      status: 'not_found',
    });
    expect(updates).toEqual([]);
  });

  it('flips the flag and returns before and after as the database answered', async () => {
    const { client, updates } = fakeClient(OFF, ON);
    const result = await setGroupPremium(client, { slug: 'friday', premium: true, capUsd: null });
    expect(updates).toEqual([{ premium: true }]);
    expect(result).toEqual({
      status: 'ok',
      group: GROUP,
      before: { premium: false, premiumChangedAt: null, monthlyCapUsd: 2 },
      after: { premium: true, premiumChangedAt: '2026-10-04T10:00:00+00:00', monthlyCapUsd: 2 },
      changed: true,
    });
  });

  it('is idempotent: asking for what is there writes nothing', async () => {
    const { client, updates } = fakeClient(ON);
    const result = await setGroupPremium(client, { slug: 'friday', premium: true, capUsd: 2 });
    expect(updates).toEqual([]);
    expect(result).toMatchObject({ status: 'ok', changed: false });
  });

  it('sets only the cap when the flag is already as asked, and never names premium_changed_at', async () => {
    const { client, updates } = fakeClient(ON, { ...ON, ai_monthly_cap_usd: 5 });
    const result = await setGroupPremium(client, { slug: 'friday', premium: true, capUsd: 5 });
    expect(updates).toEqual([{ ai_monthly_cap_usd: 5 }]);
    expect(result).toMatchObject({ status: 'ok', changed: true, after: { monthlyCapUsd: 5 } });
  });
});

describe('formatPremium', () => {
  it('prints the state, the cap and when it changed', () => {
    expect(formatPremium({ premium: false, premiumChangedAt: null, monthlyCapUsd: 2 })).toBe(
      'off, cap $2.00 a month, never changed',
    );
    expect(
      formatPremium({ premium: true, premiumChangedAt: '2026-10-04T10:00:00Z', monthlyCapUsd: 2.5 }),
    ).toBe('on, cap $2.50 a month, changed 2026-10-04T10:00:00Z');
  });
});
