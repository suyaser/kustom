import { describe, expect, it } from 'vitest';
import { gameListItemOf } from './list';

type Head = Parameters<typeof gameListItemOf>[0];

const head = (over: Partial<Head> = {}): Head => ({
  id: 'game-1',
  startedAt: '2026-10-03T19:00:00Z',
  durationS: 1_800,
  winningSide: 200,
  lobbyId: null,
  aram: false,
  rated: false,
  rule: null,
  voidReason: 'admin',
  ...over,
});

const item = (over: Partial<Head>) =>
  gameListItemOf(head(over), [], new Map(), [], {
    viewerPuuid: null,
    focusPuuid: null,
    timeZone: 'Europe/London',
  });

describe('gameListItemOf', () => {
  it('a remake (300 s or less) is marked and carries no note, voided or not (05-design.md 15.4)', () => {
    expect(item({ durationS: 300 })).toMatchObject({ remake: true, ruleNote: null });
    expect(item({ durationS: 301 })).toMatchObject({ remake: false, ruleNote: 'Not rated · voided' });
  });
});
