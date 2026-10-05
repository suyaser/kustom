import {
  type Mode,
  type ModeLock,
  type ModeRow,
  modeRatedDefault,
  type PendingRule,
  type RuleOption,
} from '@customs/core';
import type { GroupMode, RuleCheck } from '@customs/db/schemas';
import { championLane } from '@/lib/champs/lanes';
import { listChampions } from '@/lib/champs/names';
import type { FearlessView } from '@/lib/fearless/types';
import { ruleFromKey } from '@/lib/mode/spinEvents';
import type { MysteryPageState } from '@/lib/mystery/service';
import { workedWindowRows } from '@/lib/testing/boardFixtures';
import { breakdownFromResult } from '@/lib/testing/breakdownFixtures';
import {
  extraMember,
  lobbyView,
  snapshot,
  tapeEntry,
  workedKickoff,
  workedMembers,
  workedResult,
  workedTeams,
} from '@/lib/testing/tonightFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import type { LobbyCard } from '@/lib/tonight/cards';
import type { LastGame } from '@/lib/tonight/lastGame';
import type { Connection } from '@/lib/tonight/live';
import { chosenSplit } from '@/lib/tonight/screen';
import type {
  LobbyView,
  MemberView,
  PlayerName,
  TableView,
  TapeEntry,
  TonightSnapshot,
} from '@/lib/tonight/types';
import type { ViewerState } from '@/lib/tonight/viewer';
import type { TonightViewProps } from './TonightView';

/**
 * Every state of the tonight page as props (M14.9), built from the worked example
 * (`lib/testing/tonightFixtures`): the component tests and the dev kit (`/kit/tonight/<state>`)
 * render the same objects. `realNames` swaps the worked names for 05-design.md 6.14's test names
 * (the longest real ones, a 16-character all-caps name), so a screenshot proves nothing clips.
 */

export const TONIGHT_STATES = [
  'empty',
  'empty-admin',
  'idle',
  'filling',
  'over-ten',
  'balanced',
  'reroll',
  'in-game',
  'in-game-rolled',
  'in-game-swapped',
  'in-game-custom',
  'in-game-unrolled',
  'finished',
  'long-night',
  'new-player',
  'no-main',
  'reconnecting',
] as const;

export type TonightStateKey = (typeof TONIGHT_STATES)[number];

export interface TonightStateFixture extends Omit<TonightViewProps, 'group'> {
  /** What the live tag should read in a screenshot (the kit sets the store). */
  connection: Connection;
}

/** 05-design.md 6.14's names, one per worked player. */
const REAL_NAMES: Readonly<Record<string, string>> = {
  Bilal: 'Ramzyinhović',
  Hana: 'H4RDC0R33',
  Iris: 'Jinxed Lad Who Wanders',
  Karim: 'knifiy',
  Lena: 'TheSHADOWREAPER',
  Nadia: 'Used2BeATahmMain',
  Omar: '1sec Reloading',
  Rami: 'MANOOOOOOOO',
  Theo: 'SYNDROMEAXESXXXX',
  Yuki: 'XETA',
  Deniz: 'Chaos',
  Mo: 'PRT Khokha',
};

const rename = (name: PlayerName): PlayerName => (name === null ? null : (REAL_NAMES[name] ?? name));

/** The viewer most states are seen by: Theo, a support on red in the worked split. */
export const VIEWER_PUUID = workedPuuid('Theo');
export const MEMBER_VIEWER: ViewerState = {
  kind: 'linked',
  puuid: VIEWER_PUUID,
  isAdmin: false,
  isMember: true,
};
export const ADMIN_VIEWER: ViewerState = {
  kind: 'linked',
  puuid: VIEWER_PUUID,
  isAdmin: true,
  isMember: true,
};
export const ANON_VIEWER: ViewerState = { kind: 'anonymous' };

/** A second extra, for twelve around. */
function secondExtra(): MemberView {
  return extraMember({ puuid: 'puuid-mo', name: 'Mo', mainRole: 'support', secondaryRole: 'mid' });
}

function tape(count: number): TapeEntry[] {
  const mvps = ['Lena', 'Bilal', 'Iris', 'Rami', 'Karim', 'Hana', 'Omar'];
  return Array.from({ length: count }, (_, index) => {
    const red = index % 2 === 0;
    return tapeEntry({
      lobbyId: `tape-${index + 1}`,
      blueWinProb: [0.53, 0.48, 0.51, 0.62, 0.45, 0.57, 0.5][index % 7] ?? 0.5,
      rank: index === 2 ? 2 : 1,
      result: {
        gameId: `tape-game-${index + 1}`,
        winningSide: red ? 200 : 100,
        durationS: 1_500 + index * 137,
        aram: false,
        rated: true,
        mvp: mvps[index % mvps.length] ?? null,
      },
    });
  });
}

/**
 * M14.36, finished: three games tonight (the tape's two and the poster's), won the first two
 * (+41, +44) and lost the poster's (−47): `2 wins, 1 loss, Rating +38`.
 */
export const YOUR_NIGHT = {
  wins: 2,
  losses: 1,
  ratingDelta: 38,
  best: { champion: "Kai'Sa", kills: 12, deaths: 2, assists: 8 },
  mvp: 1,
  ace: 1,
} as const;

/** M14.36, idle: two games tonight (the tape's), won the first and lost the last (the Last game card). */
export const YOUR_NIGHT_IDLE = {
  wins: 1,
  losses: 1,
  ratingDelta: -6,
  best: { champion: "Kai'Sa", kills: 12, deaths: 2, assists: 8 },
  mvp: 1,
  ace: 0,
} as const;

/** Idle's tape: game 1 as the tape draws it, game 2 the same game the Last game card shows. */
function idleTape(): TapeEntry[] {
  const [first, second] = tape(2);
  if (first === undefined || second === undefined) return [];
  return [
    first,
    {
      ...second,
      blueWinProb: 0.54,
      rank: 1,
      result: {
        gameId: 'last-game',
        winningSide: 200,
        durationS: 2_052,
        aram: false,
        rated: true,
        mvp: 'Lena',
      },
    },
  ];
}

function mystery(): MysteryPageState {
  return {
    kind: 'play',
    play: {
      kind: 'award',
      challengeNumber: 1,
      category: 'monster',
      hook: { kills: 6, deaths: 2, assists: 15 },
    },
  } as unknown as MysteryPageState;
}

/** The fixture game's MVP and ACE, with the puuids their names link to (M14.41). */
const AWARD = {
  mvp: 'Lena',
  ace: 'Iris',
  mvpPuuid: workedPuuid('Lena'),
  acePuuid: workedPuuid('Iris'),
};

function lastGame(): LastGame {
  return {
    gameId: 'last-game',
    // Tonight's last game (the fixture night is Tuesday 8 September from 06:00 Cairo).
    startedAt: '2026-09-08T19:00:00.000Z',
    aram: false,
    rank: 1,
    result: workedResult({ award: AWARD }),
  };
}

function stateFixture(key: TonightStateKey, now: number): TonightStateFixture {
  const base = {
    viewer: MEMBER_VIEWER,
    // This week's board (the weekly track, M7.2): its Rating is not the team cards' (M14.41 gap 1).
    topPlayers: workedWindowRows('this-week').slice(0, 5),
    connection: 'live' as Connection,
    renderedAt: now,
    admins: ['Lena', 'Bilal'],
  };
  switch (key) {
    case 'empty':
      return { ...base, viewer: ANON_VIEWER, snapshot: snapshot(null), lastGame: null, topPlayers: [] };
    case 'empty-admin':
      return { ...base, viewer: ADMIN_VIEWER, snapshot: snapshot(null), lastGame: null, topPlayers: [] };
    case 'idle':
      return {
        ...base,
        // Tonight's two games; the second is the Last game card's (red won at Blue 54%, 34 min).
        snapshot: snapshot(null, { tape: idleTape() }),
        lastGame: lastGame(),
        lastGameDate: 'Tuesday 8 Sep',
        mystery: mystery(),
        yourNight: YOUR_NIGHT_IDLE,
      };
    case 'filling': {
      const members = workedMembers(6).map((member, index) =>
        index === 5
          ? { ...member, puuid: VIEWER_PUUID, name: 'Theo', joinedAt: new Date(now).toISOString() }
          : member,
      );
      return { ...base, snapshot: snapshot(lobbyView({ status: 'open', members })) };
    }
    case 'over-ten': {
      const members = [...workedMembers(), extraMember(), secondExtra()];
      return {
        ...base,
        viewer: ADMIN_VIEWER,
        snapshot: snapshot(lobbyView({ status: 'open', members })),
        wouldSitOut: ['puuid-deniz', 'puuid-mo'],
      };
    }
    case 'balanced':
    case 'reroll':
    case 'new-player':
    case 'reconnecting': {
      const sitter = extraMember();
      const members = [...workedMembers(), sitter].map((member) =>
        key === 'new-player' && member.name === 'Theo'
          ? { ...member, ratedGames: 4 }
          : key === 'new-player' && member.name === 'Yuki'
            ? { ...member, ratedGames: 0 }
            : member,
      );
      const teams = workedTeams({ chosen: key === 'reroll' ? 1 : 0, sitters: [sitter], members });
      return {
        ...base,
        // Game 2 of the night: everyone has played one, and the sitter has gone longest without
        // sitting out (M14.41 gap 4's tie variant).
        sitOutRule: { kind: 'longest-since', games: 1, everyone: true },
        connection: key === 'reconnecting' ? 'reconnecting' : 'live',
        snapshot: snapshot(lobbyView({ status: 'balanced', members, teams }), { tape: tape(1) }),
      };
    }
    case 'no-main': {
      // M14.41 gap 6: four of the ten with no main role on record (new to the group), nobody
      // off-role: the receipt reads `Main roles 6/6 · 4 new` and core's all-on-main clause follows.
      const base10 = workedMembers();
      const teams0 = workedTeams({ members: base10 });
      const fresh = new Set(
        [...teams0.blue.slice(0, 2), ...teams0.red.slice(0, 2)].map((seat) => seat.puuid),
      );
      const members = base10.map((member) =>
        fresh.has(member.puuid) ? { ...member, mainRole: null, secondaryRole: null, ratedGames: 0 } : member,
      );
      const clear = (seats: typeof teams0.blue) =>
        seats.map((seat) => (fresh.has(seat.puuid) ? { ...seat, offRole: false } : seat));
      const teams = {
        ...teams0,
        blue: clear(teams0.blue),
        red: clear(teams0.red),
        stored: teams0.stored.map((split) => ({
          ...split,
          offRoleCount: 0,
          explanation: split.explanation.replace(
            /^((?:Blue|Red) favored \d+%\.|Even 50%\.) .*? Gap/,
            '$1 Everyone on a main role. Gap',
          ),
        })),
      };
      return {
        ...base,
        snapshot: snapshot(lobbyView({ status: 'balanced', members, teams }), { tape: tape(1) }),
      };
    }
    case 'in-game': {
      const members = workedMembers();
      return {
        ...base,
        snapshot: snapshot(
          lobbyView({
            status: 'in_game',
            members,
            teams: workedTeams({ members }),
            startedAt: new Date(now - 23 * 60_000).toISOString(),
          }),
          { tape: tape(2) },
        ),
      };
    }
    case 'in-game-rolled':
    case 'in-game-swapped':
    case 'in-game-custom':
    case 'in-game-unrolled': {
      // M21.5: a game with a kickoff record; custom and unrolled move the viewer (Theo) to blue.
      const kind =
        key === 'in-game-rolled'
          ? 'rolled'
          : key === 'in-game-swapped'
            ? 'swapped'
            : key === 'in-game-custom'
              ? 'custom'
              : 'unrolled';
      const { members, teams, kickoff } = workedKickoff(kind);
      return {
        ...base,
        snapshot: snapshot(
          lobbyView({
            status: 'in_game',
            members,
            teams,
            kickoff,
            startedAt: new Date(now - 23 * 60_000).toISOString(),
          }),
          { tape: tape(2) },
        ),
      };
    }
    case 'finished':
    case 'long-night': {
      const members = workedMembers();
      return {
        ...base,
        mystery: mystery(),
        yourNight: YOUR_NIGHT,
        snapshot: snapshot(
          lobbyView({
            status: 'finished',
            members,
            teams: workedTeams({ members }),
            result: workedResult({ award: AWARD }),
          }),
          { tape: tape(key === 'long-night' ? 7 : 2) },
        ),
      };
    }
  }
}

/**
 * A Fearless pool of 34 bans (every fifth roster champion, filed under its lane), and in the
 * finished state the ten the fixture's game (`game-1`) just added, two per lane (M14.30).
 */
export function demoPool(finished: boolean, perGameLane = 2): FearlessView {
  const roster = listChampions();
  const champions = roster
    .filter((_, index) => index % 5 === 0)
    .map((champion, index) => ({
      id: champion.id,
      name: champion.name,
      role: championLane(champion.id),
      gameId: `tape-game-${(index % 2) + 1}`,
    }));
  if (finished) {
    const taken = new Set(champions.map((c) => c.id));
    const perLane = new Map<string, number>();
    for (const champion of roster) {
      const role = championLane(champion.id);
      if (role === null || taken.has(champion.id) || (perLane.get(role) ?? 0) >= perGameLane) continue;
      perLane.set(role, (perLane.get(role) ?? 0) + 1);
      champions.push({ id: champion.id, name: champion.name, role, gameId: 'game-1' });
    }
  }
  return { champions, resetAt: '2026-10-01T16:00:00.000Z', games: finished ? 5 : 4 };
}

export interface TonightFixtureOptions {
  realNames?: boolean;
  now?: number;
  /** The group's mode (default Fearless). */
  mode?: GroupMode;
  /** `empty`: nothing banned yet. Default: the demo pool. */
  pool?: 'demo' | 'empty';
  /** The group switched to Normal tonight, before any game (the members' dashed note). */
  normalJustNow?: boolean;
  /**
   * M15.5: the next game's rule (`class:Tank`, `region`, `mirror`). Balanced and in game lock it
   * on the lobby (region wars as Ionia vs Noxus); finished stamps the poster's game with it and the
   * card is back on the standing mode.
   */
  rule?: string | undefined;
  /** M15.5: the Rated switch (`true` / `false`), else the mode's default. */
  rated?: boolean | undefined;
  /** M15.5: a rule queued after Roll (`Next game: Mages only.`); region wars as Shurima vs Zaun (M20.10). */
  queued?: string | undefined;
  /** M15.5: region wars could not be drawn at Roll; the lobby locked the standing mode. */
  noDraw?: boolean | undefined;
  /**
   * M14.59: finished only, the bot's odds 6 points off the rating's (a rank-seeded newcomer), so
   * the poster names both. Default: the two agree, as they do for the worked split.
   */
  oddsGap?: boolean | undefined;
}

/** A locked rule as the lobby holds it: region wars with the fixture's draw. */
function lockedMode(rule: RuleOption): Mode {
  return rule.id === 'region' ? { id: 'region', blue: 'ionia', red: 'noxus' } : rule;
}

/** The stored verdict the fixture's finished game carries, per rule (champion keys only). */
export function fixtureCheck(rule: RuleOption): RuleCheck {
  if (rule.id === 'mirror') {
    return {
      kind: 'lanes',
      kept: 4,
      lanes: [
        { lane: 'top', verdict: 'kept', blue: 86, red: 86 },
        { lane: 'jungle', verdict: 'kept', blue: 64, red: 64 },
        { lane: 'mid', verdict: 'broke', blue: 103, red: 134 },
        { lane: 'adc', verdict: 'kept', blue: 222, red: 222 },
        { lane: 'support', verdict: 'kept', blue: 412, red: 412 },
      ],
    };
  }
  return {
    kind: 'sides',
    blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
    // Class: Jinx is no tank. Region (Noxus for red): Garen is from Demacia.
    red: { side: 200, verdict: 'broke', broke: [rule.id === 'class' ? 222 : 86], unknown: [] },
  };
}

/** One state's props; `realNames` renames everybody to 05-design.md 6.14's test names. */
export function tonightStateFixture(
  key: TonightStateKey,
  options: TonightFixtureOptions = {},
): TonightStateFixture {
  const now = options.now ?? Date.parse('2026-09-08T20:30:00.000Z');
  const raw = stateFixture(key, now);
  const finished = key === 'finished' || key === 'long-night';
  const standing = options.mode ?? 'fearless';
  const rule = ruleFromKey(options.rule);
  const queued = ruleFromKey(options.queued);
  const status = raw.snapshot.lobby?.status ?? null;
  const live = status === 'balanced' || status === 'in_game';
  const rated = options.rated ?? modeRatedDefault(rule?.id ?? standing);
  // Live: the lobby holds its lock (M15.5), a standing-mode game included, so a Rated-off Fearless
  // game reads not rated on the strip and the card alike. M20.7: Roll moved the row's rule (with
  // its pair) and Rated onto the lock and emptied them; a region pair with no draw left (`noDraw`)
  // locks the standing mode with Rated moved and leaves the rule pending.
  const noDraw = options.noDraw === true && rule?.id === 'region';
  const lock: ModeLock | null = live
    ? {
        standing,
        mode: rule === null || noDraw ? ({ id: standing } as Mode) : lockedMode(rule),
        rated: options.rated ?? null,
      }
    : null;
  // The row (the next game): before Roll the chosen rule; after Roll what was chosen since (or the
  // rule a no-draw Roll left pending); finished, the rule game landed and nothing is pending.
  const pendingOf = (one: RuleOption | null) => (one === null ? null : (lockedMode(one) as PendingRule));
  const modeRow: ModeRow = {
    standing,
    pending: finished
      ? null
      : live
        ? queued !== null
          ? // M20.10: a region pair queued after Roll is its own draw, not this game's.
            queued.id === 'region'
            ? ({ id: 'region', blue: 'shurima', red: 'zaun' } as PendingRule)
            : pendingOf(queued)
          : noDraw
            ? pendingOf(rule)
            : null
        : pendingOf(rule),
    rated: finished || live ? null : (options.rated ?? null),
  };
  const lobby = raw.snapshot.lobby;
  const fixture: TonightStateFixture = {
    ...raw,
    snapshot: {
      ...raw.snapshot,
      modeRow,
      lobby:
        lobby === null
          ? null
          : {
              ...lobby,
              lock,
              // Roll took the lock two minutes before `now`.
              lockedAt: lock === null ? null : new Date(now - 2 * 60_000).toISOString(),
              result:
                lobby.result === null || (rule === null && rated)
                  ? lobby.result
                  : {
                      ...lobby.result,
                      // A not-rated game moved nobody: no Rating on any row, as ingest leaves it.
                      ...(rated
                        ? {}
                        : {
                            rated: false,
                            award: null,
                            blue: lobby.result.blue.map((seat) => ({
                              ...seat,
                              rBefore: null,
                              rAfter: null,
                            })),
                            red: lobby.result.red.map((seat) => ({ ...seat, rBefore: null, rAfter: null })),
                          }),
                      // A Normal or Fearless game switched to not rated has no rule and no check.
                      stamp:
                        rule === null
                          ? { rule: null, rated, rift: true, check: null }
                          : { rule: lockedMode(rule), rated, rift: true, check: fixtureCheck(rule) },
                    },
            },
      mode: options.mode ?? 'fearless',
      fearless:
        options.pool === 'empty'
          ? { champions: [], resetAt: null, games: 0 }
          : // A not-rated rule game adds nothing to the pool (R4).
            // A mirror game adds five: each lane's two seats locked the same champion (M15.14).
            demoPool(finished && rated, rule?.id === 'mirror' ? 1 : 2),
      modeSince: options.normalJustNow
        ? new Date(now - 5 * 60_000).toISOString()
        : // A choice queued after Roll wrote the row after the lock.
          live && queued !== null
          ? new Date(now - 60_000).toISOString()
          : null,
      nightStart: options.normalJustNow
        ? new Date((options.now ?? Date.now()) - 3 * 3_600_000).toISOString()
        : raw.snapshot.nightStart,
    },
  };
  // M14.58 / M14.59: the finished game's stored breakdown, as the fold would have written it.
  const finalResult = fixture.snapshot.lobby?.result ?? null;
  if (finished && finalResult !== null && fixture.snapshot.lobby !== null) {
    const ratedGames = new Map(
      fixture.snapshot.lobby.members.flatMap((member) =>
        member.ratedGames === null ? [] : [[member.puuid, member.ratedGames] as const],
      ),
    );
    const plain = breakdownFromResult(finalResult, { ratedGames });
    const ratingBlue = plain.odds?.ratingBlueWinProb ?? null;
    if (options.oddsGap === true && ratingBlue !== null) {
      // The bot's number 6 points under the rating's, written everywhere the bot's number lives
      // (the chosen stored split the receipt draws, the teams and the result), so the poster's bar,
      // its result line and the gap line all agree (design round 1).
      const botBlue = Math.min(1, Math.max(0, ratingBlue - 0.06));
      const lobby = fixture.snapshot.lobby;
      const teams = lobby.teams;
      fixture.snapshot = {
        ...fixture.snapshot,
        lobby: {
          ...lobby,
          teams:
            teams === null
              ? null
              : {
                  ...teams,
                  blueWinProb: botBlue,
                  stored: teams.stored.map((split) =>
                    split === chosenSplit(teams.stored) ? { ...split, blueWinProb: botBlue } : split,
                  ),
                },
          result: { ...finalResult, blueWinProb: botBlue },
        },
      };
      fixture.breakdown = breakdownFromResult(finalResult, { ratedGames, botBlueWinProb: botBlue });
    } else {
      fixture.breakdown = plain;
    }
  }
  if (!options.realNames) return fixture;
  return {
    ...fixture,
    admins: (fixture.admins ?? []).map(rename),
    topPlayers: fixture.topPlayers.map((row) => ({ ...row, name: rename(row.name) })),
    snapshot: renameSnapshot(fixture.snapshot),
    lastGame:
      fixture.lastGame === null || fixture.lastGame === undefined
        ? fixture.lastGame
        : { ...fixture.lastGame, result: renameResult(fixture.lastGame.result) },
  };
}

function renameResult<T extends { blue: { name: PlayerName }[]; red: { name: PlayerName }[] }>(result: T): T {
  const r = result as unknown as {
    award: { mvp: PlayerName; ace: PlayerName; mvpPuuid?: string; acePuuid?: string } | null;
    topDamage: { name: PlayerName; damage: number } | null;
  };
  return {
    ...result,
    blue: result.blue.map((seat) => ({ ...seat, name: rename(seat.name) })),
    red: result.red.map((seat) => ({ ...seat, name: rename(seat.name) })),
    ...(r.award === undefined
      ? {}
      : {
          award: r.award === null ? null : { ...r.award, mvp: rename(r.award.mvp), ace: rename(r.award.ace) },
        }),
    ...(r.topDamage === undefined || r.topDamage === null
      ? {}
      : { topDamage: { ...r.topDamage, name: rename(r.topDamage.name) } }),
  };
}

function renameSnapshot(snap: TonightSnapshot): TonightSnapshot {
  const lobby = snap.lobby;
  return {
    ...snap,
    tape: snap.tape.map((entry) => ({
      ...entry,
      sitters: entry.sitters.map(rename),
      result: entry.result === null ? null : { ...entry.result, mvp: rename(entry.result.mvp) },
    })),
    lobby:
      lobby === null
        ? null
        : {
            ...lobby,
            members: lobby.members.map((member) => ({ ...member, name: rename(member.name) })),
            teams:
              lobby.teams === null
                ? null
                : {
                    ...renameResult(lobby.teams),
                    sitters: lobby.teams.sitters.map((member) => ({ ...member, name: rename(member.name) })),
                  },
            result: lobby.result === null ? null : renameResult(lobby.result),
            ...(lobby.kickoff == null
              ? {}
              : {
                  kickoff: {
                    ...renameResult(lobby.kickoff),
                    sitters: lobby.kickoff.sitters.map((member) => ({
                      ...member,
                      name: rename(member.name),
                    })),
                  },
                }),
          },
  };
}

/** M22.6 (05-design.md 14.7): the other lobbies of a several-lobby frame. */
export interface LobbiesFixtureOptions {
  /** Live lobbies, 2 or 3. */
  count: 2 | 3;
  /** Which chip is selected (0 is the fixture's own lobby, the oldest). Default 0. */
  selected?: number;
  /** The second lobby's status. Default `open` (six in). */
  other?: 'open' | 'balanced' | 'in_game';
  /** The selected lobby has no Kustom watching it any more (14.8). */
  unwatched?: boolean;
  /** The frame's clock (ms), as `tonightStateFixture`'s `now`. Default the fixtures' 20:30. */
  now?: number;
  /**
   * Chaos's lobby finished a game five minutes ago that banned two champions, newer than the
   * selected lobby's last game: the Mode card's `2 more banned from a game in Chaos's lobby.` (14.5).
   */
  otherBans?: boolean;
}

/**
 * A fixture as a several-lobby night (M22.6): the fixture's lobby is the oldest table (the viewer is
 * on it), then Chaos's lobby (Tanks only on its own card) and, with three, Mo's. Every tape tile
 * names its lobby. Only for the 14.7 frames and the render tests.
 */
export function withLobbies(
  fixture: TonightStateFixture,
  options: LobbiesFixtureOptions,
): TonightStateFixture {
  const own = fixture.snapshot.lobby;
  if (own === null) return fixture;
  // The frame's own clock (the kit passes `Date.now()`), so `In game · 12 min` reads 12 minutes.
  const now = options.now ?? Date.parse('2026-09-08T20:30:00.000Z');
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const crowd = (names: readonly string[]): MemberView[] =>
    names.map((name, index) =>
      extraMember({
        puuid: `puuid-${name.toLowerCase().replace(/\W/g, '')}`,
        name,
        isSpectator: false,
        side: index % 2 === 0 ? 100 : 200,
      }),
    );
  const other = options.other ?? 'open';
  const lobbies: {
    id: string;
    party: string;
    host: PlayerName;
    opened: number;
    lobby: LobbyView;
    card: LobbyCard | null;
  }[] = [
    { id: own.id, party: 'party-a', host: own.members[0]?.name ?? null, lobby: own, opened: 100, card: null },
    {
      id: 'lobby-chaos',
      party: 'party-b',
      host: 'Chaos',
      opened: 60,
      lobby: {
        ...own,
        id: 'lobby-chaos',
        status: other,
        members: crowd(['Chaos', 'PRT Khokha', 'Ayasofya', 'Mirage', 'Sefa', 'Kaan']),
        teams: null,
        result: null,
        kickoff: null,
        lock: null,
        startedAt: other === 'in_game' ? at(12) : null,
      },
      card: { pending: { id: 'class', tag: 'Tank' }, rated: null, updatedAt: at(30) },
    },
    {
      id: 'lobby-mo',
      party: 'party-c',
      host: 'Mo',
      opened: 20,
      lobby: {
        ...own,
        id: 'lobby-mo',
        status: 'open',
        members: crowd(['Mo', 'Duman', 'Ece', 'Bora']),
        teams: null,
        result: null,
        kickoff: null,
        lock: null,
        startedAt: null,
      },
      card: { pending: null, rated: null, updatedAt: at(15) },
    },
  ];
  const live = lobbies.slice(0, options.count);
  const selected = live[options.selected ?? 0] ?? live[0];
  const chaosGame = options.otherBans === true ? 'game-chaos-1' : null;
  const tables: TableView[] = live.map((one) => ({
    id: one.id,
    partyId: one.party,
    rowIds: chaosGame !== null && one.id === 'lobby-chaos' ? ['lobby-chaos-0', one.id] : [one.id],
    openedAt: at(one.opened),
    changedAt: at(1),
    host: one.host === null ? null : { puuid: `host-${one.party}`, name: one.host },
    watched: !(options.unwatched === true && one === selected),
    lobby: one.lobby,
    tile: null,
    ...(one.card === null ? {} : { card: one.card }),
  }));
  const ownTape = fixture.snapshot.tape.map((entry, index) => ({
    ...entry,
    tableHost: index % 2 === 0 ? (own.members[0]?.name ?? null) : 'Chaos',
  }));
  const chaosTile: TapeEntry | null =
    chaosGame === null
      ? null
      : {
          lobbyId: 'lobby-chaos-0',
          createdAt: at(1),
          clock: '',
          status: 'finished',
          result: {
            gameId: chaosGame,
            winningSide: 200,
            durationS: 1_620,
            aram: false,
            rated: true,
            mvp: 'Chaos',
          },
          blueWinProb: 0.5,
          rank: 1,
          sitters: [],
          tableHost: 'Chaos',
        };
  const tape = chaosTile === null ? ownTape : [...ownTape, chaosTile];
  // Two of the pool's champions came from Chaos's game.
  const fearless =
    chaosGame === null
      ? fixture.snapshot.fearless
      : {
          ...fixture.snapshot.fearless,
          champions: fixture.snapshot.fearless.champions.map((champion, index) =>
            index < 2 ? { ...champion, gameId: chaosGame } : champion,
          ),
        };
  return {
    ...fixture,
    snapshot: {
      ...fixture.snapshot,
      lobby: selected?.lobby ?? own,
      lobbies: tables,
      selectedLobbyId: selected?.id ?? own.id,
      severalLobbiesTonight: true,
      tape,
      fearless,
    },
  };
}
