import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from '../publicClient';
import { loadAdminNames, loadAdminNamesOrNone } from './admins';

/**
 * The admins' names for the strip (2026-10-03): `players_public` rows with `is_admin`, oldest
 * first, display name before game name, `null` for a row with neither.
 */

function client(result: { data: unknown; error: { message: string } | null }) {
  const calls: { eq?: [string, unknown]; order?: [string, unknown] } = {};
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      calls.eq = [column, value];
      return chain;
    },
    order: async (column: string, options: unknown) => {
      calls.order = [column, options];
      return result;
    },
  };
  return { client: { from: () => chain } as unknown as PublicClient, calls };
}

describe('loadAdminNames', () => {
  it('reads the admins oldest first and names each the way the page does', async () => {
    const { client: fake, calls } = client({
      data: [
        { display_name: 'Yasser', game_name: 'yfarhan', created_at: '2026-09-01' },
        { display_name: null, game_name: 'Omar', created_at: '2026-09-02' },
        { display_name: null, game_name: null, created_at: '2026-09-03' },
      ],
      error: null,
    });
    expect(await loadAdminNames(fake)).toEqual(['Yasser', 'Omar', null]);
    expect(calls.eq).toEqual(['is_admin', true]);
    expect(calls.order).toEqual(['created_at', { ascending: true }]);
  });

  it('throws on a failed read, and the page-facing half answers an empty list instead', async () => {
    const failing = client({ data: null, error: { message: 'boom' } }).client;
    await expect(loadAdminNames(failing)).rejects.toThrow('boom');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadAdminNamesOrNone(failing)).toEqual([]);
    spy.mockRestore();
  });
});
