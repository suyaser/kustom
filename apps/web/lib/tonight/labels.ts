import type { NameLabels } from '../names/roster';
import type { LobbyView, PlayerName, TonightSnapshot } from './types';

/**
 * Tonight's names with their same-name labels (M14.69, lead ruling): the lobby list, the team cards
 * and the finished seats print `Ali (2)` exactly as the board does. Pure: the page reads the labels
 * (`loadRosterLabels`) on the server and folds them in before it renders; every live event re-renders
 * the server page, so a new member is labelled on the next refresh.
 */
export function labelSnapshot(snapshot: TonightSnapshot, labels: NameLabels): TonightSnapshot {
  if (labels.size === 0 || snapshot.lobby === null) return snapshot;
  const lobby = snapshot.lobby;
  const labelled = labelLobby(lobby, labels);
  // M22.5: every live table is labelled; the selected one stays the same object as `lobby`.
  const lobbies = snapshot.lobbies?.map((table) => ({
    ...table,
    lobby: table.lobby === lobby ? labelled : labelLobby(table.lobby, labels),
  }));
  return { ...snapshot, lobby: labelled, ...(lobbies === undefined ? {} : { lobbies }) };
}

function label<T extends { puuid: string; name: PlayerName }>(row: T, labels: NameLabels): T {
  const found = labels.get(row.puuid);
  return found === undefined ? row : { ...row, name: found.base, nameSuffix: found.suffix };
}

function labelLobby(lobby: LobbyView, labels: NameLabels): LobbyView {
  const each = <T extends { puuid: string; name: PlayerName }>(rows: readonly T[]): T[] =>
    rows.map((row) => label(row, labels));
  return {
    ...lobby,
    members: each(lobby.members),
    teams:
      lobby.teams === null
        ? null
        : {
            ...lobby.teams,
            blue: each(lobby.teams.blue),
            red: each(lobby.teams.red),
            sitters: each(lobby.teams.sitters),
          },
    result:
      lobby.result === null
        ? null
        : { ...lobby.result, blue: each(lobby.result.blue), red: each(lobby.result.red) },
    // M21.5: the teams that started print the same labels as the split's cards.
    ...(lobby.kickoff == null
      ? {}
      : {
          kickoff: {
            ...lobby.kickoff,
            blue: each(lobby.kickoff.blue),
            red: each(lobby.kickoff.red),
            sitters: each(lobby.kickoff.sitters),
          },
        }),
  };
}

/**
 * Everybody tonight's lobby names, for `loadRosterLabels`' `extra` (a first-timer is not on the
 * roster yet): the drawn lobby's members, then every other live table's (M22.5), each puuid once.
 */
export function lobbyPeople(snapshot: TonightSnapshot): { puuid: string; name: PlayerName }[] {
  const seen = new Set<string>();
  const people: { puuid: string; name: PlayerName }[] = [];
  const lobbies = [snapshot.lobby, ...(snapshot.lobbies ?? []).map((table) => table.lobby)];
  for (const lobby of lobbies) {
    for (const member of lobby?.members ?? []) {
      if (seen.has(member.puuid)) continue;
      seen.add(member.puuid);
      people.push({ puuid: member.puuid, name: member.name });
    }
  }
  return people;
}
