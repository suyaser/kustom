import { describe, expect, it, vi } from 'vitest';
import type { ServiceClient } from '../supabase';
import { lobbyView, snapshot as tonightSnapshot } from '../testing/tonightFixtures';
import { loadLobbyPassword, maySeeLobbyPassword, withLobbyPassword } from './lobbyPassword';
import type { TonightSnapshot } from './types';
import type { ViewerState } from './viewer';

/**
 * Tonight's lobby password reaches a linked member of the group and nobody else (M14.28): the
 * snapshot the page serialises into the HTML and the RSC payload carries `lobbyPassword: null` for
 * every other reader, and the service-role read is not even made for them.
 */

const GROUP = '00000000-0000-0000-0000-000000000001';

function anonSnapshot(): TonightSnapshot {
  // What `loadTonight` returns since M14.28: the anon read never carries the password.
  return tonightSnapshot(lobbyView({ status: 'open', lobbyName: 'Customs 03 Oct #1', lobbyPassword: null }));
}

const VIEWERS: Record<string, ViewerState> = {
  anonymous: { kind: 'anonymous' },
  unlinked: { kind: 'unlinked', claimable: [] },
  'linked, not a member of this group': { kind: 'linked', puuid: 'p', isAdmin: false, isMember: false },
  'linked, membership unknown (the role read failed)': { kind: 'linked', puuid: 'p', isAdmin: false },
};

describe('withLobbyPassword', () => {
  it.each(Object.entries(VIEWERS))('gives %s no password, and never reads it', async (_name, viewer) => {
    const read = vi.fn(async () => '4821');
    const out = await withLobbyPassword(anonSnapshot(), viewer, GROUP, read);
    expect(out.lobby?.lobbyPassword).toBeNull();
    expect(JSON.stringify(out)).not.toContain('4821');
    expect(read).not.toHaveBeenCalled();
    expect(maySeeLobbyPassword(viewer)).toBe(false);
  });

  it('gives a linked member the password, read for this lobby and this group', async () => {
    const read = vi.fn(async () => '4821');
    const member: ViewerState = { kind: 'linked', puuid: 'p', isAdmin: false, isMember: true };
    const snapshot = anonSnapshot();
    const out = await withLobbyPassword(snapshot, member, GROUP, read);
    expect(out.lobby?.lobbyPassword).toBe('4821');
    expect(read).toHaveBeenCalledWith(snapshot.lobby?.id, GROUP);
  });

  it('leaves the line without a password when the read fails', async () => {
    const member: ViewerState = { kind: 'linked', puuid: 'p', isAdmin: true, isMember: true };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await withLobbyPassword(anonSnapshot(), member, GROUP, async () => {
      throw new Error('down');
    });
    expect(out.lobby?.lobbyPassword).toBeNull();
    spy.mockRestore();
  });

  it('does nothing with no lobby tonight', async () => {
    const read = vi.fn(async () => '4821');
    const idle = { ...anonSnapshot(), lobby: null };
    const member: ViewerState = { kind: 'linked', puuid: 'p', isAdmin: false, isMember: true };
    expect(await withLobbyPassword(idle, member, GROUP, read)).toBe(idle);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('loadLobbyPassword', () => {
  it('reads lobby_password for one lobby of one group with the client it is given', async () => {
    const calls: [string, unknown][] = [];
    const chain = {
      select: (columns: string) => {
        calls.push(['select', columns]);
        return chain;
      },
      eq: (column: string, value: unknown) => {
        calls.push([column, value]);
        return chain;
      },
      maybeSingle: async () => ({ data: { lobby_password: '4821' }, error: null }),
    };
    const client = { from: () => chain } as unknown as ServiceClient;
    expect(await loadLobbyPassword(client, 'lobby-1', GROUP)).toBe('4821');
    expect(calls).toEqual([
      ['select', 'lobby_password'],
      ['id', 'lobby-1'],
      ['group_id', GROUP],
    ]);
  });
});
