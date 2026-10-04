import { describe, expect, it } from 'vitest';
import { lobbyView, snapshot, workedMembers } from '@/lib/testing/tonightFixtures';
import { labelSnapshot, lobbyPeople } from './labels';

/** M14.69: Tonight's lobby list and seats take the roster-wide labels. */
describe('labelSnapshot', () => {
  it('labels the lobby members by puuid and leaves everyone else alone', () => {
    const members = workedMembers(3);
    const target = members[1]?.puuid ?? '';
    const base = snapshot(lobbyView({ members }));
    const labelled = labelSnapshot(base, new Map([[target, { base: 'Ali', suffix: '(2)' }]]));
    const out = labelled.lobby?.members ?? [];
    expect(out[1]).toMatchObject({ name: 'Ali', nameSuffix: '(2)' });
    expect(out[0]).toEqual(members[0]);
    expect(lobbyPeople(base).map((p) => p.puuid)).toEqual(members.map((m) => m.puuid));
  });

  it('no labels, no lobby: the same snapshot back', () => {
    const base = snapshot(null);
    expect(labelSnapshot(base, new Map([['x', { base: 'A', suffix: '(2)' }]]))).toBe(base);
    const withLobby = snapshot(lobbyView({ members: workedMembers(2) }));
    expect(labelSnapshot(withLobby, new Map())).toBe(withLobby);
  });
});
