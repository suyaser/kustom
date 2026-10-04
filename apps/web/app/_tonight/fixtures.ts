import { type Mode, modeRatedDefault, type RuleOption } from '@customs/core';
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
import type { LastGame } from '@/lib/tonight/lastGame';
import type { Connection } from '@/lib/tonight/live';
import { chosenSplit } from '@/lib/tonight/screen';
import type { MemberView, PlayerName, TapeEntry, TonightSnapshot } from '@/lib/tonight/types';
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
  /** M15.5: a rule queued after Roll (`Next game: Mages only.`). */
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
  const raw = stateFixture(key, options.now ?? Date.parse('2026-09-08T20:30:00.000Z'));
  const finished = key === 'finished' || key === 'long-night';
  const standing = options.mode ?? 'fearless';
  const rule = ruleFromKey(options.rule);
  const queued = ruleFromKey(options.queued);
  const status = raw.snapshot.lobby?.status ?? null;
  const live = status === 'balanced' || status === 'in_game';
  const rated = options.rated ?? modeRatedDefault(rule?.id ?? standing);
  // Live: the lobby holds its lock (M15.5), a standing-mode game included, so a Rated-off Fearless
  // game reads not rated on the strip and the card alike.
  const lock = live
    ? {
        mode:
          rule === null
            ? ({ id: standing } as Mode)
            : options.noDraw && rule.id === 'region'
              ? ({ id: standing } as Mode)
              : lockedMode(rule),
        rated,
        version: 3,
      }
    : null;
  const modeState = {
    standing,
    // Finished: the rule game landed and the compare-and-clear took the rule.
    pending: finished ? null : queued !== null && live ? queued : rule,
    ratedOverride: finished || options.rated === undefined ? null : options.rated,
    version: queued !== null && live ? 4 : 3,
  };
  const lobby = raw.snapshot.lobby;
  const fixture: TonightStateFixture = {
    ...raw,
    snapshot: {
      ...raw.snapshot,
      modeState,
      lobby:
        lobby === null
          ? null
          : {
              ...lobby,
              lock,
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
        ? new Date((options.now ?? Date.now()) - 5 * 60_000).toISOString()
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
