import { describe, expect, it } from 'vitest';
import { decodeSegment, unmovedDestination } from './unmovedPath';

describe('decodeSegment', () => {
  it('decodes valid percent-encoding and refuses malformed sequences instead of throwing', () => {
    expect(decodeSegment('audit%2Dp10')).toBe('audit-p10');
    expect(decodeSegment('100%25')).toBe('100%');
    expect(decodeSegment('100%')).toBeNull();
    expect(decodeSegment('%E0%A4%A')).toBeNull();
  });
});

describe('unmovedDestination (M14.7)', () => {
  it('maps nothing now: every page lives under the group (M14.15 board, M14.16 games, M14.17 stats)', () => {
    expect(unmovedDestination(['1v1'])).toBeNull();
    expect(unmovedDestination(['stats'])).toBeNull();
    expect(unmovedDestination(['mystery'])).toBeNull();
    expect(unmovedDestination(['constructor'])).toBeNull();
    expect(unmovedDestination(['games', 'x', 'y'])).toBeNull();
  });

  it('no longer answers for the board or a player, which live under the group (M14.15)', () => {
    expect(unmovedDestination(['leaderboard'])).toBeNull();
    expect(unmovedDestination(['p', 'audit-p10'])).toBeNull();
  });
});
