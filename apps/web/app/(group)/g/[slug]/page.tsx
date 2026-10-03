import type { Metadata } from 'next';
import { loadTopPlayersOrNone } from '@/lib/board/load';
import { LEADERBOARD_WINDOW } from '@/lib/board/window';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { loadMysteryOrNone } from '@/lib/mystery/load';
import { groupHref } from '@/lib/nav';
import { shareMetadata, tonightImagePath } from '@/lib/og/meta';
import { createPublicClient } from '@/lib/publicClient';
import { getServiceClient } from '@/lib/supabase';
import { loadAdminNamesOrNone } from '@/lib/tonight/admins';
import { loadTonight } from '@/lib/tonight/load';
import { loadLobbyStartOrNone } from '@/lib/tonight/lobbyStart';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { currentViewerState } from '@/lib/viewer';
import { TonightLive } from '../../../_tonight/TonightLive';
import '../../../mystery.css';
import '../../../tonight.css';

/**
 * A group's tonight page (M3.4; under `/g/<slug>` since M13.9). The link somebody pastes in
 * WhatsApp at 21:40.
 *
 * Server-rendered with real content — the member list, the teams, the result, whichever the
 * newest non-`abandoned` lobby **of this group's** night is in — so the first paint answers "is
 * the night happening and am I in it" with no spinner and no login. `TonightLive` then attaches
 * the Realtime subscription, filtered to this group, and re-reads the same snapshot on every
 * change.
 *
 * **Everything here is the group's** (M13.9): the lobby, the tape, the fearless pool, the ratings
 * beside each name, the rail's board, the admins the strip names, tonight's `Start a lobby`
 * press, and who the viewer is an admin of. Another group's game never appears and never
 * re-reads this page.
 *
 * Reads go through the **anon key** and RLS (`lib/publicClient.ts`). What the session decides is
 * which controls are drawn — the reroll for an admin, `Start a lobby` for any linked player
 * (M4.13) — and the routes behind them re-check the session and the group server-side anyway.
 * Daily Mystery (M5.32) is the exception: creating today's challenge is a service-role write,
 * and a failure there logs and keeps the empty card so this page still answers "am I in".
 */
export const dynamic = 'force-dynamic';

interface TonightPageProps {
  params: Promise<{ slug: string }>;
}

/** The WhatsApp link's picture (M11.4): the group's strip as it was when the unfurl bot asked. */
export async function generateMetadata({ params }: TonightPageProps): Promise<Metadata> {
  const group = await requirePageGroup((await params).slug);
  return shareMetadata(tonightImagePath(group.slug), 'Kustom');
}

/** The rail's `Top of the board` (`05-design.md`, "Breakpoints and the desktop grid"). */
const RAIL_BOARD_ROWS = 5;

export default async function TonightPage({ params }: TonightPageProps) {
  const group = await requirePageGroup((await params).slug);
  const client = createPublicClient();
  const timeZone = nightTimeZone();
  /**
   * The daily pointer opens the group's daily page, and until M13.12 moves it only the original
   * group has one (`lib/nav.ts`). No page to open, no pointer -- and no service-role write to
   * create a challenge nobody can play.
   */
  const hasDailyPage = groupHref(group, { page: 'mystery' }) !== null;

  const [snapshot, viewer, topPlayers, mystery, admins] = await Promise.all([
    loadTonight(client, { nightStart: tonightStart(), timeZone, groupId: group.id }),
    currentViewerState(group.id),
    // The rail, read once with the page and never re-read on a Realtime event: it is the one
    // block on this screen that is allowed to be a few minutes old, because it is the only one
    // nobody is watching.
    //
    // **And the one whose failure may not take the page down.** `…OrNone` logs once and renders
    // an empty rail instead.
    //
    // **The rail follows the leaderboard's default**, `This week` (M5.12), and the group's
    // games and ratings only (M13.9).
    loadTopPlayersOrNone(client, {
      limit: RAIL_BOARD_ROWS,
      window: LEADERBOARD_WINDOW,
      timeZone,
      groupId: group.id,
    }),
    hasDailyPage ? loadMysteryOrNone(new Date(), group.id) : Promise.resolve(null),
    // Who can roll, named in the strip at ten or more (2026-10-03): this group's admins. Read
    // once, like the rail, and empty on any failure: the strip then says `an admin`.
    loadAdminNamesOrNone(group.id),
  ]);

  /**
   * Tonight's newest `create_lobby` **in this group**, for the `Start a lobby` control (M4.2).
   *
   * Read after the others, and only for a linked viewer (M4.13). `companion_commands` is
   * service-role only, so this is not part of the snapshot and cannot be: the snapshot is
   * re-read in the browser with the anon key. Never on the WhatsApp link's ordinary path — a
   * signed-out reader, who still costs this page nothing.
   */
  const lobbyStart =
    viewer.kind === 'linked'
      ? await loadLobbyStartOrNone(getServiceClient(), { timeZone, groupId: group.id })
      : null;

  return (
    <TonightLive
      groupId={group.id}
      initial={snapshot}
      viewer={viewer}
      topPlayers={topPlayers}
      lobbyStart={lobbyStart}
      mystery={mystery}
      admins={admins}
    />
  );
}
