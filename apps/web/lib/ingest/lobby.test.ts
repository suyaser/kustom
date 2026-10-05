import { describe, expect, it } from 'vitest';
import { isLobbyMember, isRosterFrozen, lobbyFitsGame, memberRowMoved, RANK_STALE_MS } from './lobby';
import { isDisplayNameAutomatic } from './players';

describe('memberRowMoved (M19.8: a post writes only the rows that moved)', () => {
  const row = { lobby_id: 'l', player_id: 'p', side: 100 as const, is_spectator: false };

  it('is true for a row the lobby does not have yet', () => {
    expect(memberRowMoved(undefined, row)).toBe(true);
  });

  it('is false for the same side and flag', () => {
    expect(memberRowMoved({ side: 100, isSpectator: false }, row)).toBe(false);
  });

  it('is true for a side swap, a spectator flag, or a side going unknown', () => {
    expect(memberRowMoved({ side: 200, isSpectator: false }, row)).toBe(true);
    expect(memberRowMoved({ side: 100, isSpectator: true }, row)).toBe(true);
    expect(memberRowMoved({ side: 100, isSpectator: false }, { ...row, side: null })).toBe(true);
    expect(memberRowMoved({ side: null, isSpectator: false }, { ...row, side: null })).toBe(false);
  });
});

/**
 * The pure parts of lobby ingest: who may report a lobby (M1.8), when its roster stops
 * moving (M2.9), and when a display name is still following the Riot ID (M1.7). No database
 * here — the database halves are in `companion.integration.test.ts` and
 * `players.integration.test.ts`.
 */

describe('isLobbyMember', () => {
  const members = [
    { puuid: 'a', isSpectator: false },
    { puuid: 'b', isSpectator: false },
    { puuid: 'watcher', isSpectator: true },
  ];

  it('is true for everyone in the list, spectators included', () => {
    expect(isLobbyMember(members, 'a')).toBe(true);
    expect(isLobbyMember(members, 'b')).toBe(true);
    // A friend who sits out a round and watches is in the lobby (M1.8 brief, M2.8).
    expect(isLobbyMember(members, 'watcher')).toBe(true);
  });

  it('is false for anyone else, with no prefix or substring matching', () => {
    expect(isLobbyMember(members, 'c')).toBe(false);
    expect(isLobbyMember(members, 'a-extra')).toBe(false);
    expect(isLobbyMember(members, '')).toBe(false);
  });

  it('is false for every caller when the list is empty', () => {
    // The "everyone left" report cannot prove membership by itself; the route falls back to
    // `reported_by_player_id`.
    expect(isLobbyMember([], 'a')).toBe(false);
  });
});

describe('isRosterFrozen', () => {
  it('is false while the lobby is still filling or being balanced', () => {
    expect(isRosterFrozen('open')).toBe(false);
    expect(isRosterFrozen('balanced')).toBe(false);
  });

  it('is true from in_game on', () => {
    expect(isRosterFrozen('in_game')).toBe(true);
    expect(isRosterFrozen('finished')).toBe(true);
  });

  it('keeps the roster of a game whose result never arrived (M5.11)', () => {
    // `dropped` is the whole point of the status: the row leaves the party's live set so the
    // night can carry on, and the record of who played that game is kept exactly as frozen as
    // `in_game` left it.
    expect(isRosterFrozen('dropped')).toBe(true);
  });

  it('leaves an abandoned lobby on the normal replace semantics', () => {
    // M2.9 brief: a lobby that dissolves without ever starting is not history worth keeping.
    expect(isRosterFrozen('abandoned')).toBe(false);
  });
});

describe('isDisplayNameAutomatic', () => {
  it('is true while the display name still equals the stored game name', () => {
    expect(isDisplayNameAutomatic({ game_name: 'Alice', display_name: 'Alice' })).toBe(true);
  });

  it('is true when there is no display name at all', () => {
    // Both the never-named row and the row an admin just cleared with "".
    expect(isDisplayNameAutomatic({ game_name: null, display_name: null })).toBe(true);
    expect(isDisplayNameAutomatic({ game_name: 'Alice', display_name: null })).toBe(true);
  });

  it('is false once someone has overridden it', () => {
    expect(isDisplayNameAutomatic({ game_name: 'Alice', display_name: 'Bob' })).toBe(false);
    expect(isDisplayNameAutomatic({ game_name: null, display_name: 'Bob' })).toBe(false);
  });
});

describe('RANK_STALE_MS', () => {
  it('is exactly seven days, which is the whole of "once, then weekly" (M2.4)', () => {
    // The companion holds no staleness rule: it asks about the puuids `ranksNeeded` names,
    // and this number is the only schedule there is. The database half — a fresh rank is
    // absent from the list, an 8-day-old one is present — is in
    // `companion.integration.test.ts`.
    expect(RANK_STALE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(RANK_STALE_MS).toBe(604_800_000);
  });
});

describe('lobbyFitsGame (M21.11: a game matches only a lobby whose sided members played it)', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const sided = (puuids: readonly string[]) =>
    puuids.map((puuid, i) => ({ puuid, side: i < puuids.length / 2 ? 100 : 200, isSpectator: false }));
  const watching = (puuids: readonly string[]) =>
    puuids.map((puuid) => ({ puuid, side: null, isSpectator: true }));

  it('fits the ten who played, on any sides, with spectators who watched', () => {
    expect(lobbyFitsGame(sided(ten), ten)).toBe(true);
    expect(lobbyFitsGame(sided(ten), [...ten].reverse())).toBe(true);
    expect(lobbyFitsGame([...sided(ten), ...watching(['s1', 's2'])], ten)).toBe(true);
  });

  it('fits a spectator or an unsided member who took a seat, and a smaller game', () => {
    const nine = ten.slice(0, 9);
    const members = [...sided(nine), { puuid: 's1', side: null, isSpectator: true }];
    expect(lobbyFitsGame(members, [...nine, 's1'])).toBe(true);
    expect(lobbyFitsGame(sided(ten.slice(0, 6)), ten.slice(0, 6))).toBe(true);
  });

  it('refuses the 2026-10-02 roster: five sided members did not play, five watchers did', () => {
    const watchers = ['s0', 's1', 's2', 's3', 's4'];
    const members = [
      ...sided(ten),
      ...watching(watchers.slice(0, 3)),
      ...watchers.slice(3).map((puuid) => ({ puuid, side: null, isSpectator: false })),
    ];
    expect(lobbyFitsGame(members, [...ten.slice(0, 5), ...watchers])).toBe(false);
  });

  it('refuses one sided member missing, and a roster none of whom played', () => {
    expect(lobbyFitsGame(sided(ten), [...ten.slice(0, 9), 'x'])).toBe(false);
    expect(lobbyFitsGame(watching(['s1']), ten)).toBe(false);
    expect(lobbyFitsGame([], ten)).toBe(false);
  });
});
