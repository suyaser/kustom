import { createLobbyCommandPayloadSchema } from '@customs/db/schemas';
import { type NameableRow, playerLabel } from '../admin/playerName';
import { nightWindow } from '../commands';
import type { CreateLobbyProgress } from '../lobbyStart';
import { DEFAULT_NIGHT_TIME_ZONE } from '../night';
import type { ServiceClient } from '../supabase';

/**
 * Tonight's `create_lobby` command, as a page reads it (M4.2's control, M4.7's layout).
 *
 * The press itself is `POST /api/me/lobbies/start`; this is the other half — what the two
 * surfaces show **afterwards**, on a reload, on a second device, and for the linked player who
 * did not press it. One row, read once, turned into the sentence `startLobbySentence` already
 * owns, so the tonight page and `/admin` cannot end up saying two different things about one
 * command.
 *
 * **Service role, and only for a linked viewer** (M4.13; an admin only until then).
 * `companion_commands` has no RLS policy at all — it is service-role only (`0001_init.sql`) — so
 * this read cannot be made with the anon key the rest of the tonight page uses, and it is not in
 * the `supabase_realtime` publication either. Both facts point the same way: the page **polls**
 * this while a command is live rather than subscribing to it (`04-decisions.md`, 2026-09-10),
 * and the read happens on the server, for a viewer the session already matched to a player row,
 * exactly as `lib/viewer.ts` reads `players`.
 *
 * **A page never writes.** This is a read and nothing else; every mutation goes through
 * `app/api/me/lobbies/start`.
 */

/** What the two surfaces need to draw the state of one press. */
export interface LobbyStartView extends CreateLobbyProgress {
  /**
   * Whose client was picked, through the admin pages' own name chain — the same label the
   * route put in its answer, so the sentence does not change spelling on a reload.
   */
  hostName: string;
  /** `Customs 10 Sep #2`, from the command's payload. `/admin` prints it; the page does not. */
  lobbyName: string | null;
  /** The four digits, from the same payload. Not a secret: it is read out in voice. */
  lobbyPassword: string | null;
  /**
   * How many `invite` rows tonight's fan-out queued on that host — the number in
   * `Invited <n> friends — waiting for them to accept.`
   *
   * Counted from the queue rather than carried on the create, because the fan-out happens
   * later, off the ack (`lib/commands/invites.ts`), and a page that read it from the press
   * would always say zero.
   */
  invited: number;
}

export interface LoadLobbyStartOptions {
  now?: Date;
  timeZone?: string;
}

/**
 * The newest `create_lobby` of tonight, or `null` when nobody has pressed the button.
 *
 * Bounded by the night at both ends, the same way every other read of this queue is
 * (`04-decisions.md`, 2026-09-10): "tonight's press" is a statement about one night, and a
 * stuck row from three nights ago must not put a sentence on tonight's page.
 */
export async function loadLobbyStart(
  client: ServiceClient,
  options: LoadLobbyStartOptions = {},
): Promise<LobbyStartView | null> {
  const now = options.now ?? new Date();
  const window = nightWindow(now, options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE);

  const { data, error } = await client
    .from('companion_commands')
    .select(
      'target_player_id, status, error, payload, created_at, players!inner(puuid, display_name, game_name, tag_line)',
    )
    .eq('kind', 'create_lobby')
    .gte('created_at', window.start)
    .lte('created_at', window.until)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`loadLobbyStart: create_lobby: ${error.message}`);
  if (data === null) return null;

  const player: NameableRow = {
    puuid: data.players.puuid,
    displayName: data.players.display_name,
    gameName: data.players.game_name,
    tagLine: data.players.tag_line,
  };
  // The payload is `jsonb`, so it is parsed with the **same schema the writer used** rather
  // than picked at by hand: a row from an older deploy, or a hand-edited one, leaves both
  // fields null instead of putting `undefined` on a page (the reviewer, 2026-09-10).
  const payload = createLobbyCommandPayloadSchema.safeParse(data.payload);

  return {
    status: data.status,
    error: data.error,
    hostName: playerLabel(player),
    lobbyName: payload.success ? payload.data.lobbyName : null,
    lobbyPassword: payload.success ? payload.data.lobbyPassword : null,
    // Only asked once the lobby exists: a create that has not been acked has queued nothing,
    // and a create that failed queued nothing and never will (M4.2).
    invited:
      data.status === 'acked'
        ? await countInvites(client, data.target_player_id, data.created_at, window)
        : 0,
  };
}

/**
 * The same read, for a page that must render whatever happens: a queue lookup that times out
 * may not take down a screen whose subject is a lobby, ten names and a scoreboard.
 *
 * The control is still drawn — pressing it is how an admin finds out — and the sentence from
 * the last press is simply missing, which is what "a few seconds stale" looks like.
 */
export async function loadLobbyStartOrNone(
  client: ServiceClient,
  options: LoadLobbyStartOptions = {},
): Promise<LobbyStartView | null> {
  try {
    return await loadLobbyStart(client, options);
  } catch (error) {
    console.error('tonight: reading tonight’s create_lobby failed', error);
    return null;
  }
}

/**
 * The invites **this** create's fan-out queued on this host.
 *
 * Bounded below by the create's own `created_at`, not by the night's 06:00 (the reviewer,
 * 2026-09-10). The fan-out runs off the ack, so its rows are always younger than the create
 * they came from — and a night has more than one lobby in it. Counting the whole night would
 * make the second lobby's line claim the first lobby's popups, which is the one number on this
 * card a reader could check against their own client and find wrong.
 *
 * Still bounded above by the night, like every other read of this queue (`04-decisions.md`).
 */
async function countInvites(
  client: ServiceClient,
  hostPlayerId: string,
  createdAt: string,
  window: { start: string; until: string },
): Promise<number> {
  const { count, error } = await client
    .from('companion_commands')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'invite')
    .eq('target_player_id', hostPlayerId)
    .gte('created_at', createdAt)
    .lte('created_at', window.until);

  if (error) throw new Error(`loadLobbyStart: invites: ${error.message}`);
  return count ?? 0;
}
