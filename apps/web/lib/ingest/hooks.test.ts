import type { Split } from '@customs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLobbyHooks,
  emitGameFinished,
  emitLobbyBalanced,
  type GameFinishedEvent,
  type LobbyBalancedEvent,
  registerLobbyHook,
} from './hooks';
import type { PoolMember } from './selection';

/**
 * The seam M3.1 and M3.3 fill. The rule it has to keep is the one the M2.5 brief states as
 * "every acceptance check must pass with the webhook switched off": a listener that throws is
 * one log line, not a lobby that never got teams.
 */

function member(puuid: string): PoolMember {
  return {
    playerId: `id-${puuid}`,
    puuid,
    name: puuid,
    side: 100,
    isSpectator: false,
    mainRole: null,
    secondaryRole: null,
    roleOverride: null,
    r: 1200,
    n: 0,
    gamesTonight: 0,
    lastSitOutAt: null,
  };
}

const split: Split = {
  blue: [],
  red: [],
  gap: 0,
  blueWinProb: 0.5,
  score: 0,
  offRoleCount: 0,
};

const balanced: LobbyBalancedEvent = {
  lobbyId: 'lobby-1',
  groupId: 'group-1',
  splitId: 'split-1',
  rosterKey: 'a,b',
  split,
  explanation: 'Even 50%. Everyone on a main role. Gap 0.',
  lobbyName: 'customs night',
  lobbyPassword: null,
  sitters: [member('sitter')],
  seatMoves: [{ sitter: member('sitter'), mover: member('watcher') }],
  tiedOnGames: false,
  playing: [member('watcher')],
};

const finished: GameFinishedEvent = { gameId: 'game-1', lobbyId: 'lobby-1', groupId: 'group-1', rated: true };

describe('the lobby hook list', () => {
  afterEach(() => {
    clearLobbyHooks();
    vi.restoreAllMocks();
  });

  it('does nothing, loudly or otherwise, with no listener registered', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(emitLobbyBalanced(balanced)).resolves.toBeUndefined();
    await expect(emitGameFinished(finished)).resolves.toBeUndefined();

    expect(error).not.toHaveBeenCalled();
  });

  it('hands every listener the event, in registration order', async () => {
    const seen: string[] = [];
    registerLobbyHook({
      onBalanced: (event) => {
        seen.push(`first:${event.splitId}`);
      },
    });
    registerLobbyHook({
      onBalanced: (event) => {
        seen.push(`second:${event.explanation}`);
      },
    });

    await emitLobbyBalanced(balanced);

    expect(seen).toEqual(['first:split-1', 'second:Even 50%. Everyone on a main role. Gap 0.']);
  });

  it('logs a listener that throws and still runs the next one', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recorded: LobbyBalancedEvent[] = [];

    registerLobbyHook({
      onBalanced: () => {
        throw new Error('discord is down');
      },
    });
    registerLobbyHook({
      onBalanced: (event) => {
        recorded.push(event);
      },
    });

    // Resolves: the caller is a route handler that owes the companion a 200.
    await expect(emitLobbyBalanced(balanced)).resolves.toBeUndefined();

    expect(recorded).toEqual([balanced]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe('lobby hook onBalanced failed');
  });

  it('does the same for a rejected promise from onFinished', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recorded: GameFinishedEvent[] = [];

    registerLobbyHook({ onFinished: () => Promise.reject(new Error('webhook 500')) });
    registerLobbyHook({
      onFinished: (event) => {
        recorded.push(event);
      },
    });

    await expect(emitGameFinished(finished)).resolves.toBeUndefined();

    expect(recorded).toEqual([finished]);
    expect(error.mock.calls[0]?.[0]).toBe('lobby hook onFinished failed');
  });

  it('skips a listener that only cares about the other event', async () => {
    const seen: string[] = [];
    registerLobbyHook({
      onFinished: () => {
        seen.push('finished');
      },
    });

    await emitLobbyBalanced(balanced);
    expect(seen).toEqual([]);

    await emitGameFinished(finished);
    expect(seen).toEqual(['finished']);
  });

  it('registers one object once, however many times M3.1 imports it', async () => {
    let calls = 0;
    const hook = {
      onBalanced: () => {
        calls += 1;
      },
    };
    registerLobbyHook(hook);
    registerLobbyHook(hook);

    await emitLobbyBalanced(balanced);

    expect(calls).toBe(1);
  });

  it('forgets everything on clearLobbyHooks, which is what tests lean on', async () => {
    let calls = 0;
    registerLobbyHook({
      onBalanced: () => {
        calls += 1;
      },
    });

    clearLobbyHooks();
    await emitLobbyBalanced(balanced);

    expect(calls).toBe(0);
  });
});
