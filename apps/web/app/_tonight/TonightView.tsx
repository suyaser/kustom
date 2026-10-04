import { type Calibration, displayRating, ruleOf } from '@customs/core';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FairnessReceipt, PreGameReceipt } from '@/components/receipt';
import type { BoardRow, EmptyWindowFallback } from '@/lib/board/types';
import { oddsGapSentence } from '@/lib/breakdown/copy';
import type { GameBreakdown } from '@/lib/breakdown/load';
import { fearlessWhatsOpen } from '@/lib/fearless/copy';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { noKustomRunningLine } from '@/lib/lobbyStartCopy';
import { modeCardView, selectValue, showsFearlessPool, tooFewOpen } from '@/lib/mode/card';
import { championTable } from '@/lib/mode/champions';
import { MODE_ANSWER_LINK_ID, modePanelHref } from '@/lib/mode/hrefs';
import { ruleLaneLabel } from '@/lib/mode/ruleCopy';
import type { ModeSpeech } from '@/lib/mode/speech';
import { bannedByGame, normalJustNow } from '@/lib/mode/view';
import type { MysteryPageState } from '@/lib/mystery/service';
import { groupHome, groupHref } from '@/lib/nav';
import { displayDelta } from '@/lib/ratingDisplay';
import {
  adminNames,
  MISSED_INVITE_END,
  MISSED_INVITE_LEAD,
  MISSED_INVITE_PASSWORD,
  NAMELESS_HINT,
  ROLL_HINT,
  rollAdminHint,
  rollerSubLine,
} from '@/lib/tonight/copy';
import type { LastGame } from '@/lib/tonight/lastGame';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';
import { tonightRoles } from '@/lib/tonight/roles';
import {
  announcement,
  chosenSplit,
  gameNumber,
  noMainCount,
  offRoleSeats,
  playedAsRolled,
  ratingsBefore,
  receiptNames,
  viewerSeat,
} from '@/lib/tonight/screen';
import {
  EMPTY_GROUP_MEMBER,
  FULL_SCOREBOARD,
  START_NEXT_LOBBY,
  stripDateLine,
  winsHeadline,
  wouldSitOutLine,
} from '@/lib/tonight/screenCopy';
import type { SitOutRule } from '@/lib/tonight/sitOut';
import {
  anySeatOnTheWrongSide,
  type HeaderView,
  hasNamelessRow,
  lobbyAround,
  rollStage,
  tonightHeader,
  tonightState,
} from '@/lib/tonight/state';
import type {
  LobbyView,
  MemberView,
  PlayerName,
  ResultView,
  TeamsView,
  TonightSnapshot,
  TonightState,
} from '@/lib/tonight/types';
import { type ViewerState, viewerIsAdmin, viewerPuuid } from '@/lib/tonight/viewer';
import type { YourNight as YourNightData } from '@/lib/tonight/yourNight';
import { VersusPitch } from '../_board/VersusPitch';
import { ModeCard, type ModeCardVariant } from '../_mode/ModeCard';
import { ruleLineOf } from '../_mode/RuleLine';
import { Announcer } from './Announcer';
import { AwardLine, DailyCard, EmptyGroup, LastGameCard, SitOutCard, TopFive } from './Cards';
import { Elapsed } from './Elapsed';
import { RerollControl } from './RerollControl';
import { RoleTonight } from './RoleTonight';
import { RollControl } from './RollControl';
import { Roster } from './Roster';
import { SideLine } from './SideLine';
import { StartLobby, StartLobbySignIn } from './StartLobby';
import { type AnswerBand, Strip } from './Strip';
import { Tape } from './Tape';
import { TeamCard, type TeamSeat } from './TeamCard';
import { YourNight } from './YourNight';

/**
 * The tonight page, Kustom 2.0 (M14.9; redesign/STRATEGY.md §6(a), docs/05-design.md 5.1 to 5.15).
 *
 * **A server component and a pure function of its props**: one snapshot, who is looking, and the
 * server-only reads beside it (the last game, the calibration, who would sit out). Every state is a
 * fixture test, and every Realtime event re-renders this on the server (`TonightLive`), so the
 * receipt, the poster, the tape and the rail never ship as client code. The client islands are the
 * controls (roll, reroll, start, role), the live tag, the timer and `joined just now`.
 *
 * One state headline (the h1), one primary block chosen from `lobbies.status` (`tonightState`),
 * then the secondary cards. Below 1024 one column; from 1024 a main column and a 340px rail.
 */
export interface TonightViewProps {
  snapshot: TonightSnapshot;
  viewer: ViewerState;
  group: PageGroup;
  /** This week's top five (the leaderboard's default window). */
  topPlayers: readonly BoardRow[];
  /** M14.70: where an empty `Top this week` points (`See last week` / `See all time`). */
  topFallback?: EmptyWindowFallback | null | undefined;
  lobbyStart?: LobbyStartView | null | undefined;
  mystery?: MysteryPageState | null | undefined;
  /** The admins' names, for `Waiting on … to roll the teams.` at ten or more. */
  admins?: readonly PlayerName[] | undefined;
  /** Idle only: the group's last game; `null` is "never played", `undefined` is "not known". */
  lastGame?: LastGame | null | undefined;
  /** `Fri 2 Oct`: the last game's day, formatted on the server. */
  lastGameDate?: string | undefined;
  /** The group's calibration (M14.4), for `How the bot decided`; absent leaves the line out. */
  calibration?: Calibration | null | undefined;
  /** Filling past ten: who the rotation would sit, first first (puuids). */
  wouldSitOut?: readonly string[] | null | undefined;
  /** Balanced and in game with somebody sitting: why (`loadSitOutRuleOrNone`, M14.41). */
  sitOutRule?: SitOutRule | null | undefined;
  /** The server's clock at render, for the in-game timer's first paint. */
  renderedAt?: number | undefined;
  /** M14.36: the linked viewer's night so far (`loadYourNightOrNone`), or absent. */
  yourNight?: YourNightData | null | undefined;
  /** A no-JS mode or reset post's outcome (`?notice=` / `?error=`), for the Mode card's admin foot. */
  modeNotice?: { notice: string | null; error: string | null } | undefined;
  /** M16.4: the finished game's AI recap (`components/ai/AiRecap`), under the result, above the receipt. */
  aiRecap?: ReactNode;
  /**
   * M14.58 / M14.59: the finished game's stored breakdown (`loadGameBreakdownOrNone`): each seat's
   * change opens why, and the receipt names the rating's odds when they differ. Absent: plain numbers.
   */
  breakdown?: GameBreakdown | null | undefined;
}

export function TonightView(props: TonightViewProps) {
  const { snapshot, viewer, group } = props;
  const state = tonightState(snapshot);
  const header = tonightHeader(state, props.admins ?? []);
  const puuid = viewerPuuid(viewer);
  const isAdmin = viewerIsAdmin(viewer);
  const linked = viewer.kind === 'linked';
  const emptyGroup = state.kind === 'idle' && props.lastGame === null && snapshot.tape.length === 0;
  const showDaily = state.kind === 'idle' || state.kind === 'result';
  const mode = snapshot.mode;
  const seat =
    state.kind === 'teams' && state.lobby.status !== 'finished' ? viewerSeat(state.teams, puuid) : null;
  const variant: ModeCardVariant =
    state.kind === 'filling'
      ? 'filling'
      : state.kind === 'teams'
        ? state.lobby.status === 'in_game'
          ? 'in-game'
          : state.lobby.status === 'balanced'
            ? 'balanced'
            : 'idle'
        : state.kind === 'result'
          ? 'finished'
          : 'idle';
  // M15.5: what the card is about (the lock after Roll, else the next game), one answer for the
  // card, the answer band, the strip's host line and the announcer.
  const modeState = snapshot.modeState ?? { standing: mode, pending: null, ratedOverride: null, version: 0 };
  const bans = snapshot.fearless.champions.map((champion) => champion.id);
  const table = championTable();
  const cardView = modeCardView({
    state: modeState,
    lobbyStatus: snapshot.lobby?.status ?? null,
    lock: snapshot.lobby?.lock ?? null,
    bans,
    table,
  });
  const speech: ModeSpeech = {
    standing: modeState.standing,
    pending: modeState.pending,
    nextRated: modeCardView({ state: modeState, lobbyStatus: null, lock: null, bans, table }).rated,
    lockedRule: cardView.locked ? ruleOf(cardView.shown) : null,
    lobbyStatus: snapshot.lobby?.status ?? null,
  };
  // Everyone, every state, empty group included (design ruling on §8.2, 2026-10-03).
  const modeCard = (
    <ModeCard
      group={group}
      mode={mode}
      fearless={snapshot.fearless}
      variant={variant}
      view={cardView}
      viewerLane={seat?.role ?? null}
      viewerSide={seat?.side ?? null}
      bannedNext={
        state.kind === 'result'
          ? {
              champions: bannedByGame(snapshot.fearless, state.result.gameId),
              gameNumber: gameNumber(snapshot, state),
              // M15.15: a Rift game played not rated banned nothing, and the card says so.
              notRated: state.result.stamp?.rift === true && !state.result.stamp.rated,
            }
          : null
      }
      normalJustNow={normalJustNow(snapshot)}
      controls={
        isAdmin
          ? {
              inGame: cardView.locked || variant === 'in-game',
              selected: selectValue(modeState),
              tooFew: tooFewOpen(modeState, bans, table),
              nextRated: speech.nextRated,
              redirectTo: groupHome(group),
              notice: props.modeNotice?.notice ?? null,
              error: props.modeNotice?.error ?? null,
            }
          : null
      }
    />
  );
  const answer = answerBand(state, puuid);
  const rolls = rollerOf(state, isAdmin);
  const action = stripAction(props, state, { isAdmin, linked, emptyGroup });
  const ruleJump =
    answer !== null && answer.kind === 'seated' && variant === 'balanced'
      ? showsFearlessPool(cardView)
        ? fearlessWhatsOpen(answer.role)
        : ruleLaneLabel(cardView.shown, answer.role, answer.side)
      : null;
  // M14.41 (gap 3): the ten by side on the first screen, for whoever has no seated answer band.
  const names =
    state.kind === 'teams' &&
    (state.lobby.status === 'balanced' || state.lobby.status === 'in_game') &&
    answer?.kind !== 'seated'
      ? { blue: state.teams.blue.map((seat) => seat.name), red: state.teams.red.map((seat) => seat.name) }
      : null;

  /*
   * The role card: while the lobby fills and while the teams are up (kept for next game); hidden in
   * game and after (STRATEGY §6(a)); and on idle for an unlinked friend. M14.65: when that friend
   * has a row to claim, the card moves straight under the strip as `Which one is you?`.
   */
  const showsRoleCard =
    state.kind === 'filling' ||
    (state.kind === 'teams' && state.lobby.status === 'balanced') ||
    (state.kind === 'idle' && viewer.kind === 'unlinked');
  const claimFirst =
    showsRoleCard &&
    viewer.kind === 'unlinked' &&
    (snapshot.lobby?.members ?? []).some((member) => viewer.claimable.includes(member.puuid));

  return (
    <div className="mx-auto w-full max-w-[1180px] px-(--gutter) pt-4 pb-8 lg:grid lg:grid-cols-[minmax(0,1fr)_var(--rail-w)] lg:items-start lg:gap-5 lg:pt-6">
      <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
        <Strip
          dateLine={stripDateLine(snapshot.nightLabel, gameNumber(snapshot, state))}
          headline={state.kind === 'result' ? winsHeadline(state.result.winningSide) : header.headline}
          count={header.count}
          sub={
            emptyGroup ? (
              EMPTY_GROUP_MEMBER
            ) : rolls !== null ? (
              // The viewer holds `Roll teams`: never `Waiting on <admins>…` (M14.41 design round 1).
              rollerSubLine(lobbyAround(rolls.lobby.members))
            ) : (
              <SubLine state={state} header={header} renderedAt={props.renderedAt ?? Date.now()} />
            )
          }
          lobbyLive={header.live}
          meter={state.kind === 'filling' ? Math.min(lobbyAround(state.lobby.members), 10) : null}
          names={names}
          action={action}
          // M15.5 (design round 2): the rule line lives inside the finished poster, under the headline.
          ruleLine={state.kind === 'result' ? ruleLineOf(state.result.stamp ?? null) : null}
          answer={
            // The jump link only while the teams are set (8.3): not in game. M15.5: the rule's label
            // (`Tanks for support`, `Ionia for support`); mirror and Normal have none.
            answer !== null && answer.kind === 'seated' && ruleJump !== null
              ? {
                  ...answer,
                  jump: {
                    href: modePanelHref(group, answer.role),
                    label: ruleJump,
                    id: MODE_ANSWER_LINK_ID,
                  },
                }
              : answer
          }
        />
        <Announcer text={announcement(state, header, puuid)} mode={mode} speech={speech} />

        {/* M14.65: an unlinked friend with a claimable row sees `Which one is you?` first. */}
        {claimFirst ? <RoleTonight lobby={snapshot.lobby} viewer={viewer} /> : null}

        {/* Your night (M14.36): at the top, under the strip, in idle and finished, linked only. */}
        {/* Idle: under the strip. Finished: inside the result, after the odds and the awards. */}
        {linked && props.yourNight != null && state.kind === 'idle' ? (
          <YourNight night={props.yourNight} />
        ) : null}

        {emptyGroup ? <EmptyGroup isAdmin={isAdmin} group={group} /> : null}
        {emptyGroup ? modeCard : null}
        {state.kind === 'idle' && !emptyGroup ? <Idle {...props} /> : null}
        {state.kind === 'filling' ? (
          <Filling
            lobby={state.lobby}
            viewerPuuid={puuid}
            linked={linked}
            lobbyStart={props.lobbyStart ?? null}
            wouldSitOut={props.wouldSitOut ?? null}
            rolls={rolls !== null}
          />
        ) : null}
        {state.kind === 'filling' ? modeCard : null}
        {state.kind === 'teams' ? (
          <Teams
            lobby={state.lobby}
            teams={state.teams}
            viewerPuuid={puuid}
            linked={linked}
            calibration={props.calibration}
            modeCard={modeCard}
            sitOutRule={props.sitOutRule ?? null}
            group={group}
          />
        ) : null}
        {state.kind === 'result' ? (
          <Result
            lobby={state.lobby}
            result={state.result}
            teams={state.teams}
            viewerPuuid={puuid}
            calibration={props.calibration}
            yourNight={linked && props.yourNight != null ? <YourNight night={props.yourNight} /> : null}
            group={group}
            aiRecap={props.aiRecap ?? null}
            breakdown={props.breakdown?.gameId === state.result.gameId ? props.breakdown : null}
          />
        ) : null}
        {state.kind === 'result' ? modeCard : null}
        {state.kind === 'result' ? (
          // M14.35 (Lane B's contract): under the result poster, the personal 1v1 pitch, once a night.
          <VersusPitch
            viewer={linked ? 'linked' : 'not-linked'}
            nightKey={snapshot.nightStart}
            here={groupHome(group)}
            you={groupHref(group, { page: 'you' }) ?? groupHome(group)}
          />
        ) : null}

        {hasNamelessRow(state, snapshot.tape) ? (
          <p className="text-sm text-muted-foreground">{NAMELESS_HINT}</p>
        ) : null}

        {/* The role card: while the lobby fills and while the teams are up (kept for next game).
            Hidden in game and after: no role or sign-in control then (STRATEGY §6(a)). */}
        {showsRoleCard && !claimFirst ? <RoleTonight lobby={snapshot.lobby} viewer={viewer} /> : null}
      </div>

      <aside aria-label="Around tonight" className="mt-4 flex min-w-0 flex-col gap-4 lg:mt-0 lg:gap-5">
        {showDaily ? <DailyCard mystery={props.mystery ?? null} group={group} /> : null}
        <Tape tape={snapshot.tape} group={group} after={state.kind !== 'idle'} />
        {emptyGroup ? null : (
          <TopFive
            rows={props.topPlayers}
            group={group}
            viewerPuuid={puuid}
            fallback={props.topFallback ?? null}
          />
        )}
        {state.kind === 'idle' && !emptyGroup ? modeCard : null}
      </aside>
    </div>
  );
}

function SubLine({
  state,
  header,
  renderedAt,
}: {
  state: TonightState;
  header: HeaderView;
  renderedAt: number;
}): ReactNode {
  if (state.kind === 'teams' && state.lobby.status === 'in_game' && state.lobby.startedAt !== null) {
    return (
      <>
        <Elapsed startedAt={state.lobby.startedAt} renderedAt={renderedAt} />
        {`. ${header.sentence}`}
      </>
    );
  }
  return header.sentence;
}

function answerBand(state: TonightState, puuid: string | null): AnswerBand {
  if (puuid === null) return null;
  if (state.kind === 'filling') {
    const member = state.lobby.members.find((one) => one.puuid === puuid);
    return member === undefined ? null : { kind: 'lobby', mainRole: tonightRoles(member).main };
  }
  if (state.kind === 'teams' && state.lobby.status !== 'finished') {
    const seat = viewerSeat(state.teams, puuid);
    return seat === null ? null : { kind: 'seated', side: seat.side, role: seat.role };
  }
  if (state.kind === 'result') {
    const row = [...state.result.blue, ...state.result.red].find((one) => one.puuid === puuid);
    if (row === undefined) return null;
    return {
      kind: 'result',
      side: row.side === 100 ? 'blue' : 'red',
      won: row.side === state.result.winningSide,
      delta: row.muBefore === null || row.muAfter === null ? null : displayDelta(row.muBefore, row.muAfter),
    };
  }
  return null;
}

function Idle(props: TonightViewProps) {
  const last = props.lastGame;
  if (last === null || last === undefined) return null;
  return <LastGameCard last={last} group={props.group} dateLabel={props.lastGameDate ?? ''} />;
}

/**
 * The strip's action row (M14.41, scene-walk gap 2): the night's one deliberate press, where the
 * viewer is already looking. Admins: `Roll teams` once the lobby can be rolled, `Reroll` while the
 * teams are up. Linked players: `Start a lobby` when nothing is open (idle, finished); a visitor
 * on an idle page gets the sign-in that leads to it. Nothing new for anybody: each control moved
 * up from under the roster, the cards or the poster, unchanged.
 */
function stripAction(
  props: TonightViewProps,
  state: TonightState,
  viewer: { isAdmin: boolean; linked: boolean; emptyGroup: boolean },
): ReactNode {
  if (state.kind === 'filling') {
    if (rollerOf(state, viewer.isAdmin) === null) return null;
    const around = lobbyAround(state.lobby.members);
    const stage = rollStage(state.lobby) === 'repair' ? 'repair' : 'ready';
    return (
      <RollControl
        lobbyId={state.lobby.id}
        members={state.lobby.members}
        hint={rollAdminHint(around, sitOutPreview(state.lobby, props.wouldSitOut ?? null), stage)}
      />
    );
  }
  if (state.kind === 'teams') {
    return viewer.isAdmin && state.lobby.status === 'balanced' ? (
      <RerollControl lobbyId={state.lobby.id} splits={state.teams.splits} />
    ) : null;
  }
  if (state.kind === 'result' || (state.kind === 'idle' && !viewer.emptyGroup)) {
    if (viewer.linked) {
      return (
        <StartLobby
          start={props.lobbyStart ?? null}
          press={true}
          around={0}
          // STRATEGY §6(a): after a result the press is the next game's (M14.41 design round 1).
          label={state.kind === 'result' ? START_NEXT_LOBBY : undefined}
          // M14.66: on idle with no host seen in ten minutes, who to ask, before anyone taps.
          noHostLine={
            state.kind === 'idle' && !props.snapshot.hostSeenRecently
              ? noKustomRunningLine(adminNames(props.snapshot.hostNames))
              : null
          }
        />
      );
    }
    if (state.kind === 'idle' && props.viewer.kind === 'anonymous') return <StartLobbySignIn />;
  }
  return null;
}

/** The filling lobby when this viewer holds `Roll teams` (an admin, rollable stage), else `null`. */
function rollerOf(state: TonightState, isAdmin: boolean): { lobby: LobbyView } | null {
  if (state.kind !== 'filling' || !isAdmin) return null;
  const stage = rollStage(state.lobby);
  return stage === 'ready' || stage === 'repair' ? { lobby: state.lobby } : null;
}

/** `If the teams rolled now, Chaos and then Mo would sit out.`, or `null` (not past ten, or unknown). */
function sitOutPreview(lobby: LobbyView, wouldSitOut: readonly string[] | null): string | null {
  if (wouldSitOut === null) return null;
  const byPuuid = new Map(lobby.members.map((member) => [member.puuid, member]));
  return wouldSitOutLine(wouldSitOut.map((one) => byPuuid.get(one)?.name ?? null));
}

function Filling({
  lobby,
  viewerPuuid,
  linked,
  lobbyStart,
  wouldSitOut,
  rolls,
}: {
  lobby: LobbyView;
  viewerPuuid: string | null;
  linked: boolean;
  lobbyStart: LobbyStartView | null;
  wouldSitOut: readonly string[] | null;
  /** The viewer holds `Roll teams`: the preview is the button's hint in the strip, not repeated here. */
  rolls: boolean;
}) {
  const stage = rollStage(lobby);
  const sitLine = rolls ? null : sitOutPreview(lobby, wouldSitOut);

  return (
    <>
      <Roster members={lobby.members} viewerPuuid={viewerPuuid} />
      {sitLine === null ? null : <p className="text-sm">{sitLine}</p>}
      {/* `Roll teams` is in the strip (M14.41); its hint stays here for whoever waits on it. */}
      {stage === 'waiting' ? <p className="text-sm text-muted-foreground">{ROLL_HINT}</p> : null}
      {stage === 'waiting' && linked ? (
        <StartLobby start={lobbyStart} press={false} around={lobbyAround(lobby.members)} />
      ) : null}
      <MissedInvite lobby={lobby} linked={linked} />
    </>
  );
}

function Teams({
  lobby,
  teams,
  viewerPuuid,
  linked,
  calibration,
  modeCard,
  sitOutRule,
  group,
}: {
  lobby: LobbyView;
  teams: TeamsView;
  viewerPuuid: string | null;
  linked: boolean;
  calibration: Calibration | null | undefined;
  /** M14.30: directly after the team cards (05-design.md 8.3). */
  modeCard: ReactNode;
  sitOutRule: SitOutRule | null;
  group: PageGroup;
}) {
  const viewerSits = viewerPuuid !== null && teams.sitters.some((member) => member.puuid === viewerPuuid);
  const names = receiptNames(lobby, lobby.result);
  const members = new Map(lobby.members.map((member) => [member.puuid, member]));
  const seat = viewerSeat(teams, viewerPuuid);
  const balanced = lobby.status === 'balanced';
  const inGame = lobby.status === 'in_game';
  const finishedWinner = lobby.status === 'finished' ? (lobby.result?.winningSide ?? null) : null;

  const receipt =
    finishedWinner !== null ? (
      <FairnessReceipt
        variant="finished"
        winner={finishedWinner}
        splits={teams.stored}
        names={names}
        noMain={noMainCount(teams, members)}
        calibration={calibration}
      />
    ) : (
      <FairnessReceipt
        variant={inGame ? 'in-game' : 'balanced'}
        splits={teams.stored}
        names={names}
        offRole={offRoleSeats(teams)}
        noMain={noMainCount(teams, members)}
        calibration={calibration}
      />
    );

  return (
    <>
      {/* M14.41 (gap 4): the first card after the strip, for everyone (STRATEGY §6(a)). Finished:
          after the team cards, past tense (05-design 5.15). */}
      {lobby.status === 'finished' ? null : (
        <SitOutCard sitters={teams.sitters} viewerSits={viewerSits} rule={sitOutRule} />
      )}
      {receipt}
      <div className="grid gap-4 md:grid-cols-2 md:gap-5">
        <TeamCard
          side="blue"
          seats={teams.blue.map((one) => teamSeat(one, members))}
          viewerPuuid={viewerPuuid}
          className={seat?.side === 'blue' ? 'order-first md:order-none' : undefined}
          group={group}
        />
        <TeamCard
          side="red"
          seats={teams.red.map((one) => teamSeat(one, members))}
          viewerPuuid={viewerPuuid}
          className={seat?.side === 'red' ? 'order-first md:order-none' : undefined}
          group={group}
        />
      </div>
      {lobby.status === 'finished' ? (
        <SitOutCard sitters={teams.sitters} viewerSits={viewerSits} finished />
      ) : null}
      {balanced && anySeatOnTheWrongSide(teams) ? <SideLine /> : null}
      {modeCard}
      {balanced ? <MissedInvite lobby={lobby} linked={linked} /> : null}
    </>
  );
}

function teamSeat(seat: TeamsView['blue'][number], members: ReadonlyMap<string, MemberView>): TeamSeat {
  return {
    puuid: seat.puuid,
    name: seat.name,
    nameSuffix: seat.nameSuffix ?? null,
    role: seat.role,
    rating: seat.rating,
    offRole: seat.offRole,
    ratedGames: members.get(seat.puuid)?.ratedGames ?? null,
  };
}

function Result({
  lobby,
  result,
  teams,
  viewerPuuid,
  calibration,
  yourNight,
  group,
  aiRecap,
  breakdown,
}: {
  lobby: LobbyView;
  result: ResultView;
  teams: TeamsView | null;
  viewerPuuid: string | null;
  calibration: Calibration | null | undefined;
  /** M14.36: after the odds box and the award line, before the team cards (design round 3). */
  yourNight: ReactNode;
  group: PageGroup;
  /** M16.4: the AI recap slot, before the receipt and never inside it. */
  aiRecap: ReactNode;
  /** M14.58 / M14.59: this game's stored breakdown, or `null`. */
  breakdown: GameBreakdown | null;
}) {
  const odds = breakdown?.odds ?? null;
  const names = receiptNames(lobby, result);
  const chosen = teams === null ? null : chosenSplit(teams.stored);
  const members = new Map(lobby.members.map((member) => [member.puuid, member]));
  const notRated = result.stamp?.rift === true && !result.stamp.rated;
  const seats = (side: ResultView['blue']): TeamSeat[] =>
    side.map((seat) => ({
      puuid: seat.puuid,
      name: seat.name,
      nameSuffix: seat.nameSuffix ?? null,
      role: seat.role,
      // M15.5: a game played not rated moved nobody: the seat keeps its Rating (the lobby's), no delta.
      rating:
        seat.muAfter !== null
          ? displayRating(seat.muAfter)
          : notRated
            ? (members.get(seat.puuid)?.rating ?? null)
            : null,
      offRole: false,
      ratedGames: members.get(seat.puuid)?.ratedGames ?? null,
      delta:
        seat.muBefore === null || seat.muAfter === null ? null : displayDelta(seat.muBefore, seat.muAfter),
      reason: breakdown?.reasons.get(seat.puuid) ?? null,
    }));

  const receipt =
    teams !== null && chosen !== null && playedAsRolled(result, chosen) ? (
      <FairnessReceipt
        variant="finished"
        winner={result.winningSide}
        // M14.45: the strip's `RED WINS` already names the winner; the poster says the odds only.
        winnerShown
        splits={teams.stored}
        names={names}
        // Lead ruling (M14.41 design round 1): Tonight's poster counts main roles the way the
        // balanced receipt did minutes earlier. The game page and history print the stored count.
        noMain={noMainCount(teams, members)}
        calibration={calibration}
        oddsGap={odds === null ? null : oddsGapSentence(odds, result.winningSide)}
      />
    ) : (
      <PreGameReceipt
        ratingsBefore={ratingsBefore(result)}
        ratingBlueWinProb={odds?.ratingBlueWinProb ?? null}
        reason={teams === null ? 'no-split' : 'teams-changed'}
        winner={result.winningSide}
        winnerShown
        rolled={teams === null ? undefined : { splits: teams.stored, names }}
        calibration={calibration}
      />
    );

  return (
    <>
      {aiRecap}
      {receipt}
      {result.award === null ? null : <AwardLine award={result.award} group={group} />}
      <FullScoreboardLink group={group} gameId={result.gameId} />
      {yourNight}
      <div className="grid gap-4 md:grid-cols-2 md:gap-5">
        <TeamCard
          side="blue"
          seats={seats(result.blue)}
          viewerPuuid={viewerPuuid}
          won={result.winningSide === 100}
          group={group}
        />
        <TeamCard
          side="red"
          seats={seats(result.red)}
          viewerPuuid={viewerPuuid}
          won={result.winningSide === 200}
          group={group}
        />
      </div>
      {teams === null ? null : (
        <SitOutCard
          sitters={teams.sitters}
          viewerSits={viewerPuuid !== null && teams.sitters.some((member) => member.puuid === viewerPuuid)}
          finished
        />
      )}
    </>
  );
}

/**
 * `Full scoreboard` (M14.41, scene-walk gap 5, [NEW COPY]): the finished poster's link to this
 * game's own page, where the scoreboard and the full receipt live. A standalone link, 44px tall.
 */
function FullScoreboardLink({ group, gameId }: { group: PageGroup; gameId: string }) {
  const href = groupHref(group, { page: 'game', gameId });
  if (href === null) return null;
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 w-fit items-center text-sm font-bold text-primary-text underline underline-offset-3"
    >
      {FULL_SCOREBOARD}
    </Link>
  );
}

/**
 * `Missed the invite? The lobby is Customs 09 Sep #1, password 4821.` (M4.10): for a signed-in
 * viewer matched to a player row only; the link gets forwarded, and a password handed to whoever
 * opens it invites a stranger in. Nothing at all for anyone else, and nothing with no lobby name.
 */
function MissedInvite({ lobby, linked }: { lobby: LobbyView; linked: boolean }) {
  if (!linked || lobby.lobbyName === null) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {MISSED_INVITE_LEAD}
      <span className="num font-semibold text-foreground [overflow-wrap:anywhere]">{lobby.lobbyName}</span>
      {lobby.lobbyPassword === null ? null : (
        <>
          {MISSED_INVITE_PASSWORD}
          <span className="num font-semibold text-foreground select-all">{lobby.lobbyPassword}</span>
        </>
      )}
      {MISSED_INVITE_END}
    </p>
  );
}
