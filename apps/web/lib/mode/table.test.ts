import { describe, expect, it } from 'vitest';
import { inPlay, type WatchingToken } from '../liveTables';
import { cardSourceOf, GROUP_TABLE, PICK_A_LOBBY, tableOf } from './table';

/** M22.4: which card a lobby's mode reads and writes (the database half is modeLobbies.integration.test.ts). */

const t = (partyId: string) => ({ partyId });
const token = (currentPartyId: string | null): WatchingToken => ({
  tokenId: `t-${currentPartyId}`,
  playerId: `p-${currentPartyId}`,
  currentPartyId,
  currentPartyAt: currentPartyId === null ? null : '2026-10-05T18:00:00Z',
});

describe('inPlay (lib/liveTables.ts, the one rule)', () => {
  it('a live table is in play only while a token of the group has it as its current party', () => {
    expect(inPlay(t('a'), [token('a')])).toBe(true);
    expect(inPlay(t('a'), [token('b'), token(null)])).toBe(false);
    expect(inPlay(t('a'), [])).toBe(false);
  });
});

describe('tableOf', () => {
  it('no lobby live: the group card, unfiltered (today)', () => {
    expect(tableOf([], new Set(), new Set(), null)).toEqual(GROUP_TABLE);
  });

  it('one lobby in play: its table, on group_modes unless it still has a row', () => {
    expect(tableOf([t('a')], new Set(['a']), new Set(), null)).toEqual({ partyId: 'a', forked: false });
    expect(tableOf([t('a')], new Set(['a']), new Set(['a']), null)).toEqual({ partyId: 'a', forked: true });
  });

  it('two in play and none named: pick a lobby; a named one gets its own card', () => {
    const live = [t('a'), t('b')];
    const playing = new Set(['a', 'b']);
    expect(tableOf(live, playing, new Set(['b']), null)).toBe(PICK_A_LOBBY);
    expect(tableOf(live, playing, new Set(['b']), 'b')).toEqual({ partyId: 'b', forked: true });
    expect(tableOf(live, playing, new Set(['b']), 'a')).toEqual({ partyId: 'a', forked: false });
  });

  it('a live lobby not in play does not count, but can still be named', () => {
    const live = [t('a'), t('b')];
    expect(tableOf(live, new Set(['b']), new Set(['b']), null)).toEqual({ partyId: 'b', forked: true });
    expect(tableOf(live, new Set(['b']), new Set(['b']), 'a')).toEqual({ partyId: 'a', forked: false });
  });

  it('a named lobby that is not live is as none named', () => {
    expect(tableOf([t('b')], new Set(['b']), new Set(), 'gone')).toEqual({ partyId: 'b', forked: false });
    expect(tableOf([t('a'), t('b')], new Set(['a', 'b']), new Set(), 'gone')).toBe(PICK_A_LOBBY);
  });
});

describe('cardSourceOf', () => {
  it('a lobby with a row shows it, every other lobby the group card', () => {
    expect(cardSourceOf([t('a'), t('b')], new Set(['b', 'stale']))).toEqual(
      new Map([
        ['a', 'group'],
        ['b', 'lobby'],
      ]),
    );
  });
});
