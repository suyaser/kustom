import type { LobbyStatusValue } from '@customs/db';
import { describe, expect, it } from 'vitest';
import {
  assertLegalTransition,
  IDLE_ABANDON_MS,
  IllegalLobbyTransitionError,
  isLegalTransition,
  isTerminalLobbyStatus,
  LOBBY_TRANSITIONS,
  MIN_RATED_DURATION_S,
  PLAYERS_PER_GAME,
} from './lobbyState';

/**
 * The state machine's table and its numbers. No database: the compare-and-set halves are
 * exercised in `lobbyState.integration.test.ts` and `roll.integration.test.ts`.
 */

const STATUSES: LobbyStatusValue[] = ['open', 'balanced', 'in_game', 'dropped', 'finished', 'abandoned'];

describe('the transition table', () => {
  it('is the table in the M2.5 brief, plus M5.11, and nothing else', () => {
    expect(LOBBY_TRANSITIONS).toEqual({
      open: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
      balanced: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
      in_game: ['finished', 'dropped'],
      dropped: ['finished'],
      finished: [],
      abandoned: [],
    });
  });

  it('has a move for every status the database can hold', () => {
    // The table is keyed by `LobbyStatusValue`, so a new enum value that nobody wrote a row
    // for would be a `LOBBY_TRANSITIONS[status]` of `undefined` and a crash in
    // `isLegalTransition`, not a type error.
    for (const status of STATUSES) {
      expect(Array.isArray(LOBBY_TRANSITIONS[status])).toBe(true);
    }
  });

  it('lets a full lobby balance and a balanced one come apart again', () => {
    expect(isLegalTransition('open', 'balanced')).toBe(true);
    expect(isLegalTransition('balanced', 'open')).toBe(true);
  });

  it('lets an in_game lobby finish or be dropped, and never reopen', () => {
    // `abandoned` keeps the M2.9 replace semantics, so sweeping an `in_game` lobby into it
    // would unfreeze the record of who played; `dropped` (M5.11) is the door that keeps the
    // roster frozen and still takes the row out of the party's live set.
    expect(isLegalTransition('in_game', 'finished')).toBe(true);
    expect(isLegalTransition('in_game', 'dropped')).toBe(true);
    for (const to of ['open', 'balanced', 'abandoned', 'in_game'] as LobbyStatusValue[]) {
      expect(isLegalTransition('in_game', to)).toBe(false);
    }
  });

  it('lets a dropped lobby be finished by a late block, and nothing else', () => {
    // M5.11: a companion whose queue file drains a week later is still telling the truth
    // about that game, and the row then leaves M5.5's missed list by itself.
    expect(isLegalTransition('dropped', 'finished')).toBe(true);
    for (const to of ['open', 'balanced', 'in_game', 'dropped', 'abandoned'] as LobbyStatusValue[]) {
      expect(isLegalTransition('dropped', to)).toBe(false);
    }
  });

  it.each([['finished'], ['abandoned']] as [LobbyStatusValue][])('makes %s terminal', (from) => {
    for (const to of STATUSES) {
      expect(isLegalTransition(from, to)).toBe(false);
    }
  });

  it('knows which statuses are terminal, which is what the game route warns about', () => {
    expect(isTerminalLobbyStatus('finished')).toBe(true);
    expect(isTerminalLobbyStatus('abandoned')).toBe(true);
    // `dropped` is not terminal by this definition and must not be: the warning exists for a
    // game that cannot close its lobby, and a dropped lobby still can (M5.11).
    for (const status of ['open', 'balanced', 'in_game', 'dropped'] as LobbyStatusValue[]) {
      expect(isTerminalLobbyStatus(status)).toBe(false);
    }
  });

  it('throws for an illegal move rather than silently succeeding', () => {
    expect(() => assertLegalTransition('finished', 'open')).toThrow(IllegalLobbyTransitionError);
    expect(() => assertLegalTransition('finished', 'open')).toThrow('lobby cannot go from finished to open');
    expect(() => assertLegalTransition('open', 'balanced')).not.toThrow();
  });
});

describe('the numbers', () => {
  it('are two hours, five minutes and ten players', () => {
    expect(IDLE_ABANDON_MS).toBe(2 * 60 * 60 * 1000);
    expect(MIN_RATED_DURATION_S).toBe(300);
    expect(PLAYERS_PER_GAME).toBe(10);
  });
});
