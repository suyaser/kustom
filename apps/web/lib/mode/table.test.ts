import { describe, expect, it } from 'vitest';
import { cardSourceOf, GROUP_TABLE, inPlay, type ModeLiveTable, PICK_A_LOBBY, tableOf } from './table';

/** M22.4: which card a lobby's mode reads and writes (the database half is modeLobbies.integration.test.ts). */

const watched = (partyId: string, status: ModeLiveTable['lobby']['status'] = 'open'): ModeLiveTable => ({
  partyId,
  lobby: { status },
  watchers: [{ tokenId: `t-${partyId}`, playerId: `p-${partyId}` }],
});
const unwatched = (
  partyId: string,
  status: ModeLiveTable['lobby']['status'] = 'finished',
): ModeLiveTable => ({
  partyId,
  lobby: { status },
  watchers: [],
});

describe('inPlay', () => {
  it('in game always; otherwise only while some Kustom is in it', () => {
    expect(inPlay(unwatched('a', 'in_game'))).toBe(true);
    expect(inPlay(watched('a', 'finished'))).toBe(true);
    expect(inPlay(unwatched('a', 'finished'))).toBe(false);
    expect(inPlay(unwatched('a', 'open'))).toBe(false);
  });
});

describe('tableOf', () => {
  it('no lobby live: the group card, unfiltered (today)', () => {
    expect(tableOf([], new Set(), null)).toEqual(GROUP_TABLE);
  });

  it('one lobby in play: its table, on group_modes unless it still has a row', () => {
    expect(tableOf([watched('a')], new Set(), null)).toEqual({ partyId: 'a', forked: false });
    expect(tableOf([watched('a')], new Set(['a']), null)).toEqual({ partyId: 'a', forked: true });
  });

  it('two in play and none named: pick a lobby; a named one gets its own card', () => {
    const live = [watched('a'), watched('b')];
    expect(tableOf(live, new Set(['b']), null)).toBe(PICK_A_LOBBY);
    expect(tableOf(live, new Set(['b']), 'b')).toEqual({ partyId: 'b', forked: true });
    expect(tableOf(live, new Set(['b']), 'a')).toEqual({ partyId: 'a', forked: false });
  });

  it('a finished lobby nobody is in any more does not count, but can still be named', () => {
    const live = [unwatched('a'), watched('b')];
    expect(tableOf(live, new Set(['b']), null)).toEqual({ partyId: 'b', forked: true });
    expect(tableOf(live, new Set(['b']), 'a')).toEqual({ partyId: 'a', forked: false });
  });

  it('a named lobby that is not live is as none named', () => {
    expect(tableOf([watched('b')], new Set(), 'gone')).toEqual({ partyId: 'b', forked: false });
    expect(tableOf([watched('a'), watched('b')], new Set(), 'gone')).toBe(PICK_A_LOBBY);
  });
});

describe('cardSourceOf', () => {
  it('a lobby with a row shows it, every other lobby the group card', () => {
    expect(cardSourceOf([watched('a'), watched('b')], new Set(['b', 'stale']))).toEqual(
      new Map([
        ['a', 'group'],
        ['b', 'lobby'],
      ]),
    );
  });
});
