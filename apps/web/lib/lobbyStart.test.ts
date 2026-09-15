import { describe, expect, it } from 'vitest';
import {
  alreadyHasALobbyLine,
  chooseHost,
  decideStart,
  generateLobbyPassword,
  type HostCandidate,
  invitedLine,
  LOBBY_ALREADY_OPEN,
  LOBBY_ALREADY_OPENING,
  LOBBY_WRITES_UNVERIFIED,
  lobbyNameFor,
  NO_CLIENT_ANSWERED,
  NO_COMPANION_AROUND,
  openingOnPcLine,
  type StartLobbyState,
  startLobbySentence,
} from './lobbyStart';

/**
 * The press's rules, without a database (M4.2): the name, the password, who hosts, and the
 * order the three refusals are decided in.
 */

const NIGHT = new Date('2019-06-09T20:00:00.000Z');

function host(overrides: Partial<HostCandidate> & { playerId: string; lastSeenAt: Date }): HostCandidate {
  return {
    puuid: `puuid-${overrides.playerId}`,
    displayName: null,
    gameName: null,
    tagLine: null,
    ...overrides,
  };
}

function state(overrides: Partial<StartLobbyState> = {}): StartLobbyState {
  return { liveLobbyId: null, pendingCreateId: null, lobbiesTonight: 0, hosts: [], ...overrides };
}

describe('the lobby name', () => {
  it('is `Customs <dd Mon> #<n>`, with the day padded to two digits', () => {
    expect(lobbyNameFor(NIGHT, 1)).toBe('Customs 09 Jun #1');
    expect(lobbyNameFor(NIGHT, 2)).toBe('Customs 09 Jun #2');
    // The local date in `CUSTOMS_NIGHT_TZ`, not UTC's: 22:00Z on the 25th is 00:00 Cairo on
    // the 26th, and the client's lobby list shows the day the group is having.
    expect(lobbyNameFor(new Date('2019-12-25T20:00:00.000Z'), 3)).toBe('Customs 25 Dec #3');
    expect(lobbyNameFor(new Date('2019-12-25T22:00:00.000Z'), 3)).toBe('Customs 26 Dec #3');
  });

  it('matches the acceptance regex and fits the client', () => {
    for (const month of ['01', '06', '09', '12']) {
      const name = lobbyNameFor(new Date(`2019-${month}-14T20:00:00.000Z`), 11);
      expect(name).toMatch(/^Customs \d\d [A-Z][a-z]{2} #\d+$/);
      expect(name.length).toBeLessThanOrEqual(30);
    }
  });

  it('dates a 01:00 game by the night it belongs to, not by the calendar day', () => {
    // 03:00 Cairo on the 10th is still the night that started on the 9th; the name is the
    // instant's own date, which is what the client's lobby list shows beside it.
    expect(lobbyNameFor(new Date('2019-06-10T01:00:00.000Z'), 2)).toBe('Customs 10 Jun #2');
  });
});

describe('the password', () => {
  it('is four digits, zero padded', () => {
    expect(generateLobbyPassword(() => 7)).toBe('0007');
    expect(generateLobbyPassword(() => 4821)).toBe('4821');
    expect(generateLobbyPassword(() => 0)).toBe('0000');
    expect(generateLobbyPassword(() => 9999)).toBe('9999');
  });

  it('is four digits from the real source too', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(generateLobbyPassword()).toMatch(/^\d{4}$/);
    }
  });
});

describe('who hosts', () => {
  const older = host({ playerId: 'a', lastSeenAt: new Date('2019-06-09T19:50:00.000Z') });
  const newer = host({ playerId: 'b', lastSeenAt: new Date('2019-06-09T19:59:00.000Z') });

  it('prefers the presser when their own companion is up', () => {
    expect(chooseHost([older, newer], 'a')?.playerId).toBe('a');
  });

  it('takes the freshest client when the presser has none', () => {
    expect(chooseHost([older, newer], 'someone-with-no-exe')?.playerId).toBe('b');
    expect(chooseHost([older, newer], null)?.playerId).toBe('b');
  });

  it('breaks a tie on the player id, so the choice is the same twice', () => {
    const tied = [
      host({ playerId: 'z', lastSeenAt: new Date('2019-06-09T19:59:00.000Z') }),
      host({ playerId: 'c', lastSeenAt: new Date('2019-06-09T19:59:00.000Z') }),
    ];
    expect(chooseHost(tied, null)?.playerId).toBe('c');
    expect(chooseHost([...tied].reverse(), null)?.playerId).toBe('c');
  });

  it('is nobody when nobody has a client up', () => {
    expect(chooseHost([], 'a')).toBeNull();
  });
});

describe('the refusals, in the order they are decided', () => {
  const around = [host({ playerId: 'a', lastSeenAt: NIGHT })];

  it('refuses while a lobby of tonight is live, before anything else', () => {
    const result = decideStart(state({ liveLobbyId: 'lobby-1', pendingCreateId: 'cmd-1', hosts: [] }), {
      pressedByPlayerId: 'a',
      now: NIGHT,
    });

    expect(result).toEqual({ ok: false, status: 409, error: LOBBY_ALREADY_OPEN });
  });

  it('refuses a second press while a create is pending, even with nobody around', () => {
    // The pending row is the lock, and it outranks the host check: two taps two seconds apart
    // must say a lobby is being opened, not that nobody is running the companion.
    const result = decideStart(state({ pendingCreateId: 'cmd-1', hosts: [] }), {
      pressedByPlayerId: 'a',
      now: NIGHT,
    });

    expect(result).toEqual({ ok: false, status: 409, error: LOBBY_ALREADY_OPENING });
  });

  it('refuses when no companion has been up, and decides nothing else', () => {
    const result = decideStart(state({ lobbiesTonight: 3 }), { pressedByPlayerId: 'a', now: NIGHT });

    expect(result).toEqual({ ok: false, status: 409, error: NO_COMPANION_AROUND });
  });

  it("plans the night's next cycle when it may", () => {
    const result = decideStart(state({ hosts: around, lobbiesTonight: 1 }), {
      pressedByPlayerId: 'a',
      now: NIGHT,
      password: () => '4821',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        host: around[0],
        hostName: 'puuid-a',
        lobbyName: 'Customs 09 Jun #2',
        lobbyPassword: '4821',
        cycle: 2,
      },
    });
  });
});

describe('what the page says while the command runs', () => {
  it('names the host while it is pending, and says nothing once it is acked', () => {
    expect(startLobbySentence({ status: 'pending', error: null }, 'Hana')).toBe(
      "Opening a lobby on Hana's PC…",
    );
    expect(startLobbySentence({ status: 'sent', error: null }, 'Hana')).toBe("Opening a lobby on Hana's PC…");
    // The member list appearing is the answer; a toast on top of it is noise.
    expect(startLobbySentence({ status: 'acked', error: null }, 'Hana')).toBeNull();
    expect(startLobbySentence(null, 'Hana')).toBeNull();
  });

  it('sends the group to the lobby the host already had', () => {
    expect(startLobbySentence({ status: 'failed', error: 'already_in_lobby: partyId=abc' }, 'Hana')).toBe(
      'Hana already has a lobby open — everyone can join that one.',
    );
  });

  it('has one sentence for every other failure, including the expiry', () => {
    for (const error of ['expired', 'wrong_phase: ChampSelect', 'client_rejected: 500 INVALID_LOBBY', null]) {
      expect(startLobbySentence({ status: 'failed', error }, 'Hana')).toBe(
        "Nobody's client answered. Try again.",
      );
    }
  });
});

describe('the words', () => {
  it("are product's, verbatim", () => {
    expect(LOBBY_ALREADY_OPEN).toBe('There is already a lobby open.');
    expect(NO_COMPANION_AROUND).toBe('Nobody has the companion running right now. Start it and try again.');
    expect(LOBBY_ALREADY_OPENING).toBe('A lobby is already being opened.');
    expect(LOBBY_WRITES_UNVERIFIED).toBe("Opening lobbies isn't verified on this patch yet.");
    expect(openingOnPcLine('Hana')).toBe("Opening a lobby on Hana's PC…");
    expect(NO_CLIENT_ANSWERED).toBe("Nobody's client answered. Try again.");
    expect(alreadyHasALobbyLine('Hana')).toBe('Hana already has a lobby open — everyone can join that one.');
  });

  it('counts the invites in the singular and the plural', () => {
    expect(invitedLine(1)).toBe('Invited 1 friend — waiting for them to accept.');
    expect(invitedLine(7)).toBe('Invited 7 friends — waiting for them to accept.');
  });
});
