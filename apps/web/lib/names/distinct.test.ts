import { describe, expect, it } from 'vitest';
import { collidingNames, distinctNames, labelText, type NamedPlayer, printedName } from './distinct';

/** M14.69: two people with the same name are told apart, by tag or by first game. */

/** What a plain-text list prints for each player, in order. */
function printed(players: NamedPlayer[]): string[] {
  const labels = distinctNames(players);
  return players.map((player) => printedName(player.name, labels.get(player.puuid)));
}

describe('distinctNames', () => {
  it('labels nobody when nobody clashes', () => {
    const players = [
      { puuid: 'a', name: 'Ali', tag: 'EUW' },
      { puuid: 'b', name: 'Omar', tag: 'EUW' },
    ];
    expect(distinctNames(players).size).toBe(0);
    expect(printed(players)).toEqual(['Ali', 'Omar']);
    expect(collidingNames(players).size).toBe(0);
  });

  it('adds the tag when the tags tell them apart, as a separate muted half', () => {
    const players = [
      { puuid: 'a', name: 'Ali', tag: 'EUW' },
      { puuid: 'b', name: 'Ali', tag: 'TR1' },
      { puuid: 'c', name: 'Omar', tag: 'EUW' },
    ];
    expect(distinctNames(players).get('a')).toEqual({ base: 'Ali', suffix: '#EUW' });
    expect(printed(players)).toEqual(['Ali #EUW', 'Ali #TR1', 'Omar']);
  });

  it('numbers by first game when the tags collide too; the first keeps the plain name', () => {
    const players = [
      { puuid: 'a', name: 'Ali', tag: 'EUW', firstGameAt: '2026-09-10T20:00:00Z' },
      { puuid: 'b', name: 'Ali', tag: 'euw', firstGameAt: '2026-09-01T20:00:00Z' },
      { puuid: 'c', name: 'Ali', tag: 'EUW', firstGameAt: null },
    ];
    expect(distinctNames(players).has('b')).toBe(false);
    expect(distinctNames(players).get('a')).toEqual({ base: 'Ali', suffix: '(2)' });
    expect(printed(players)).toEqual(['Ali (2)', 'Ali', 'Ali (3)']);
  });

  it('numbers when a tag is missing', () => {
    expect(
      printed([
        { puuid: 'a', name: 'Ali', tag: 'EUW', firstGameAt: '2026-09-01T20:00:00Z' },
        { puuid: 'b', name: 'Ali', tag: null, firstGameAt: '2026-09-02T20:00:00Z' },
      ]),
    ).toEqual(['Ali', 'Ali (2)']);
  });

  it('treats a different case as the same printed name', () => {
    expect(
      printed([
        { puuid: 'a', name: 'ali', tag: 'EUW' },
        { puuid: 'b', name: 'Ali ', tag: 'NA1' },
      ]),
    ).toEqual(['ali #EUW', 'Ali #NA1']);
  });

  it('keeps the whole label inside 32 characters with the suffix intact', () => {
    const long = 'A'.repeat(31);
    const labels = distinctNames([
      { puuid: 'a', name: long, tag: 'EUW' },
      { puuid: 'b', name: long, tag: 'TR1' },
    ]);
    const first = labels.get('a');
    expect(first).toEqual({ base: `${'A'.repeat(26)}…`, suffix: '#EUW' });
    expect(labelText(first ?? { base: '', suffix: '' })).toHaveLength(32);
  });

  it('leaves nameless rows to their own fallback', () => {
    expect(
      distinctNames([
        { puuid: 'a', name: null },
        { puuid: 'b', name: '  ' },
      ]).size,
    ).toBe(0);
  });

  it('every printed name is unique across a busy list', () => {
    const players: NamedPlayer[] = [
      { puuid: 'a', name: 'Ali', tag: 'EUW', firstGameAt: '2026-09-01T20:00:00Z' },
      { puuid: 'b', name: 'Ali', tag: 'EUW', firstGameAt: '2026-09-02T20:00:00Z' },
      { puuid: 'c', name: 'Sara', tag: 'EUW' },
      { puuid: 'd', name: 'Sara', tag: 'NA1' },
      { puuid: 'e', name: 'Deniz', tag: null },
    ];
    expect(new Set(printed(players)).size).toBe(players.length);
  });
});
