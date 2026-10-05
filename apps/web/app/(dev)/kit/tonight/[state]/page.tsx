import { type Mode, regionPool } from '@customs/core';
import { notFound } from 'next/navigation';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import {
  TONIGHT_STATES,
  type TonightStateFixture,
  type TonightStateKey,
  tonightStateFixture,
  VIEWER_PUUID,
} from '@/app/_tonight/fixtures';
import { TonightView } from '@/app/_tonight/TonightView';
import { AiRecap } from '@/components/ai/AiRecap';
import { Shell } from '@/components/shell/Shell';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { championTable } from '@/lib/mode/champions';
import { displayDelta } from '@/lib/ratingDisplay';
import { seatedOnTheirSides } from '@/lib/testing/tonightFixtures';
import { KUSTOM_KIT_ROSTER, withWorkedRoster } from '@/lib/testing/workedExample';
import { tonightHeader, tonightState } from '@/lib/tonight/state';
import type { TapeEntry } from '@/lib/tonight/types';
import { KitLive } from './KitLive';
import { kitViewer } from './viewer';

const KIT_RECAP = {
  kind: 'line' as const,
  lineId: '10000000-0000-4000-8000-000000000001',
  text: 'Ayasofya-Kebab-Enjoyer went 9 and 0 on Lee Sin, and Red closed it out in 31 minutes with 31 kills.',
};

/**
 * Dev-only: every tonight state (M14.9) inside the real shell, from `app/_tonight/fixtures.ts`, for
 * the screenshots the local data cannot reach (an empty group, a lobby past ten, a long night, the
 * channel down). `?names=worked` keeps the worked example's short names (default: 05-design.md
 * 6.14's long test names); `?viewer=lead|member|anon|unlinked` changes who is looking (lead: an admin;
 * member: linked, not an admin, M14.78; unlinked: signed in with no player row, the `That's me` list, M14.42). A 404 in production.
 */
const TAPE_RULES: readonly { rule: Mode; rated: boolean }[] = [
  { rule: { id: 'class', tag: 'Tank' }, rated: false },
  { rule: { id: 'region', blue: 'ionia', red: 'noxus' }, rated: false },
  { rule: { id: 'mirror' }, rated: true },
];

/** A week on the Kustom scale for `Top this week`: distinct points and records, best first. */
const KIT_TOP_WEEK: readonly { points: number; wins: number; losses: number }[] = [
  { points: 41, wins: 5, losses: 1 },
  { points: 33, wins: 4, losses: 2 },
  { points: 24, wins: 4, losses: 3 },
  { points: 17, wins: 3, losses: 2 },
  { points: 9, wins: 3, losses: 3 },
];

/**
 * M18.7 (design review): the parts of a fixture the roster swap cannot reach. Your night is the
 * tape's two wins at K 16 (+8, +9) plus the viewer's change on the poster, and `Top this week` gets
 * distinct week points; every other number came from the Kustom-scale roster through core.
 */
function kustomScale(fixture: TonightStateFixture): TonightStateFixture {
  const seats = fixture.snapshot.lobby?.result;
  const viewerSeat =
    seats === null || seats === undefined
      ? undefined
      : [...seats.blue, ...seats.red].find((seat) => seat.puuid === VIEWER_PUUID);
  const posterDelta =
    viewerSeat === undefined || viewerSeat.rBefore === null || viewerSeat.rAfter === null
      ? null
      : displayDelta(viewerSeat.rBefore, viewerSeat.rAfter);
  return {
    ...fixture,
    topPlayers: fixture.topPlayers.map((row, index) => {
      const week = KIT_TOP_WEEK[index];
      return week === undefined ? row : { ...row, ...week, games: week.wins + week.losses };
    }),
    ...(fixture.yourNight === undefined || fixture.yourNight === null
      ? {}
      : {
          yourNight: {
            ...fixture.yourNight,
            ratingDelta: posterDelta === null ? 2 : 8 + 9 + posterDelta,
          },
        }),
  };
}

function withRules(entries: readonly TapeEntry[]): TapeEntry[] {
  return entries.map((entry, index) => {
    const stamp = TAPE_RULES[index % TAPE_RULES.length];
    return entry.result === null || stamp === undefined
      ? entry
      : { ...entry, result: { ...entry.result, rule: stamp.rule, rated: stamp.rated } };
  });
}

export default async function KitTonightPage({
  params,
  searchParams,
}: {
  params: Promise<{ state: string }>;
  searchParams: Promise<{
    names?: string;
    viewer?: string;
    mode?: string;
    pool?: string;
    just?: string;
    rule?: string;
    rated?: string;
    queued?: string;
    nodraw?: string;
    recap?: string;
    night?: string;
    gap?: string;
    tape?: string;
    host?: string;
    scale?: string;
    pair?: string;
    banregion?: string;
    sit?: string;
  }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { state } = await params;
  const {
    names,
    viewer,
    mode,
    pool,
    just,
    rule,
    rated,
    queued,
    nodraw,
    recap,
    night,
    gap,
    tape,
    host,
    scale,
    pair,
    banregion,
    sit,
  } = await searchParams;
  if (!(TONIGHT_STATES as readonly string[]).includes(state)) notFound();

  // `?mode=normal`, `?pool=empty`, `?just=1` (switched to Normal tonight): the Mode card's variants (M14.30).
  // M18.7: the Kustom scale by default (Ratings about 1150 to 1415, K 16 changes); `?scale=worked`
  // keeps the worked example's OpenSkill-era numbers.
  const build = () =>
    tonightStateFixture(state as TonightStateKey, {
      realNames: names !== 'worked',
      now: Date.now(),
      mode: mode === 'normal' ? 'normal' : 'fearless',
      pool: pool === 'empty' ? 'empty' : 'demo',
      normalJustNow: just === '1',
      // M15.5: `?rule=class:Tank|region|mirror`, `?rated=0|1`, `?queued=class:Mage`, `?nodraw=1`.
      rule,
      rated: rated === '1' ? true : rated === '0' ? false : undefined,
      queued,
      noDraw: nodraw === '1',
      // M14.59: `?gap=1`, the bot's odds and the rating's round differently (the poster names both).
      oddsGap: gap === '1',
    });
  const built = scale === 'worked' ? build() : kustomScale(withWorkedRoster(KUSTOM_KIT_ROSTER, build));
  // M15.19: `?tape=rules` names a rule on each earlier game (Tanks only and region wars not rated,
  // then a rated mirror match), as the tape draws them.
  const taped =
    tape === 'rules'
      ? { ...built, snapshot: { ...built.snapshot, tape: withRules(built.snapshot.tape) } }
      : built;
  // M14.66: `?host=away` (no host seen in ten minutes, two hosts by name) or `?host=many` (four, so
  // the line says `whoever hosts`): the no-host line under `Start a lobby` on idle.
  const fixture =
    host === 'away' || host === 'many'
      ? {
          ...taped,
          snapshot: {
            ...taped.snapshot,
            hostSeenRecently: false,
            hostNames: host === 'away' ? ['Yasser', 'Omar'] : ['Yasser', 'Omar', 'Hana', 'Rami'],
          },
        }
      : taped;
  // M20.10: `?pair=ixtal,noxus` is the next game's region pair (with `?rule=region`), and
  // `?banregion=ixtal` adds every champion of a region to the Fearless pool, so the pair can run short.
  // M21.13: `?sit=blue|red`, the side the client has the viewer on while balanced (`liveSide`);
  // the other side from the split gives `YOU on RED. Move to BLUE to play top.`.
  const paired = withViewerSitting(withPairAndBans(fixture, pair, banregion), sit);
  const shown = kitViewer(viewer, paired);
  const group = ORIGINAL_GROUP;
  const live = tonightHeader(tonightState(fixture.snapshot)).live;

  return (
    <PageGroupProvider group={group}>
      <Shell
        group={group}
        isAdmin={shown.kind === 'linked' && shown.isAdmin}
        account={shown.kind === 'anonymous' ? 'anonymous' : 'signed-in'}
      >
        <TonightView
          {...paired}
          // M15.5: `?night=notrated`, a night of not-rated Rift games only (Your night's not-rated line).
          {...(night === 'notrated'
            ? {
                yourNight: {
                  wins: 1,
                  losses: 1,
                  ratingDelta: null,
                  best: { champion: 'Malphite', kills: 3, deaths: 2, assists: 14 },
                  mvp: 0,
                  ace: 0,
                  notRated: true,
                },
              }
            : {})}
          viewer={shown}
          group={group}
          // M16.4: `?recap=1` draws a sample AI recap on the finished poster.
          aiRecap={recap === '1' ? <AiRecap recap={KIT_RECAP} groupId={group.id} /> : null}
        />
        <KitLive connection={fixture.connection} lobbyLive={live} />
      </Shell>
    </PageGroupProvider>
  );
}

/** The kit's `?sit=` (M21.13): every seat on its split side, the viewer on the one named. */
function withViewerSitting(fixture: TonightStateFixture, sit: string | undefined): TonightStateFixture {
  const lobby = fixture.snapshot.lobby;
  if ((sit !== 'blue' && sit !== 'red') || lobby === null || lobby.teams === null) return fixture;
  const teams = seatedOnTheirSides(lobby.teams, { [VIEWER_PUUID]: sit === 'blue' ? 100 : 200 });
  return { ...fixture, snapshot: { ...fixture.snapshot, lobby: { ...lobby, teams } } };
}

/** The kit's `?pair=` and `?banregion=` (M20.10): the next game's pair and a region all banned. */
function withPairAndBans(
  fixture: TonightStateFixture,
  pair: string | undefined,
  banregion: string | undefined,
): TonightStateFixture {
  const [blue, red] = (pair ?? '').split(',');
  const row = fixture.snapshot.modeRow;
  const modeRow =
    row !== undefined && row.pending?.id === 'region' && blue && red
      ? { ...row, pending: { id: 'region' as const, blue, red } }
      : row;
  const banned = banregion === undefined ? [] : regionPool(banregion, championTable());
  const fearless =
    banned.length === 0
      ? fixture.snapshot.fearless
      : {
          ...fixture.snapshot.fearless,
          champions: [
            ...fixture.snapshot.fearless.champions.filter((c) => !banned.includes(c.id)),
            ...banned.map((id) => ({ id, name: `Champion ${id}`, role: null })),
          ],
        };
  return { ...fixture, snapshot: { ...fixture.snapshot, modeRow, fearless } };
}
