import { describe, expect, it } from 'vitest';
import { filterMembers, foldName, sortMembers } from './memberList';

/** M14.52: the Members list's order and its `Find someone` filter. */

const row = (name: string, role: 'owner' | 'admin' | 'member', lastPlayedAt: string | null) => ({
  name,
  role,
  lastPlayedAt,
});

describe('sortMembers', () => {
  it('owner, then admins, then members; newest last played first, never-played last, then by name', () => {
    const sorted = sortMembers([
      row('zed', 'member', null),
      row('Amy', 'member', null),
      row('Bo', 'member', '2026-10-01T20:00:00Z'),
      row('Cy', 'admin', '2026-09-01T20:00:00Z'),
      row('Di', 'member', '2026-10-03T20:00:00Z'),
      row('Ed', 'admin', '2026-10-02T20:00:00Z'),
      row('Hana', 'owner', null),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(['Hana', 'Ed', 'Cy', 'Di', 'Bo', 'Amy', 'zed']);
  });

  it('returns a new array and leaves the input alone', () => {
    const input = [row('b', 'member', null), row('a', 'owner', null)];
    const sorted = sortMembers(input);
    expect(sorted).not.toBe(input);
    expect(input.map((r) => r.name)).toEqual(['b', 'a']);
  });
});

describe('filterMembers', () => {
  const rows = [
    row('Ramzyinhović', 'member', null),
    row('TheSHADOWREAPER', 'admin', null),
    row('Hana', 'owner', null),
  ];

  it('matches any part of the name, ignoring case and accents', () => {
    expect(filterMembers(rows, 'shadow').map((r) => r.name)).toEqual(['TheSHADOWREAPER']);
    expect(filterMembers(rows, 'HOVIC').map((r) => r.name)).toEqual(['Ramzyinhović']);
    expect(filterMembers(rows, '  ha ').map((r) => r.name)).toEqual(['TheSHADOWREAPER', 'Hana']);
  });

  it('keeps everyone, in order, for a blank query, and nobody for no match', () => {
    expect(filterMembers(rows, '   ')).toEqual(rows);
    expect(filterMembers(rows, 'zzz')).toEqual([]);
  });

  it('folds names the same way', () => {
    expect(foldName(' Ŕamzý ')).toBe('ramzy');
  });
});
