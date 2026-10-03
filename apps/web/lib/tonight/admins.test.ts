import { describe, expect, it } from 'vitest';
import type { ServiceClient } from '../supabase';
import { loadAdminNames } from './admins';

/**
 * The admins' names for the strip (2026-10-03, per group since M13.4): the group's `admin`
 * memberships, oldest player first, display name before game name, `null` for a row with
 * neither. Never the old global flag on `players`.
 */

function client(result: { data: unknown; error: { message: string } | null }) {
  const calls: { from?: string; eq: [string, unknown][] } = { eq: [] };
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      calls.eq.push([column, value]);
      // The second filter is the last call of the chain: answer it.
      return calls.eq.length === 2 ? Promise.resolve(result) : chain;
    },
  };
  return {
    client: {
      from: (table: string) => {
        calls.from = table;
        return chain;
      },
    } as unknown as ServiceClient,
    calls,
  };
}

describe('loadAdminNames', () => {
  it("reads the group's admins oldest first and names each the way the page does", async () => {
    const { client: fake, calls } = client({
      data: [
        { players: { display_name: null, game_name: 'Omar', created_at: '2026-09-02' } },
        { players: { display_name: 'Yasser', game_name: 'yfarhan', created_at: '2026-09-01' } },
        { players: { display_name: null, game_name: null, created_at: '2026-09-03' } },
      ],
      error: null,
    });
    expect(await loadAdminNames(fake, 'group-a')).toEqual(['Yasser', 'Omar', null]);
    expect(calls.from).toBe('group_memberships');
    expect(calls.eq).toEqual([
      ['group_id', 'group-a'],
      ['role', 'admin'],
    ]);
  });

  it('throws on a failed read', async () => {
    const failing = client({ data: null, error: { message: 'boom' } }).client;
    await expect(loadAdminNames(failing, 'group-a')).rejects.toThrow('boom');
  });
});
