import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SWITCH_SIDE_ENABLED } from '@/lib/commands/gate';
import { ROSTER_STABLE_MS } from '@/lib/lobbyState';
import { eogBody, lobbyBody } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { sideLine } from '@/lib/tonight/copy';

/**
 * The tonight page against the Supabase CLI local stack (M3.4).
 *
 * What it proves that a component test cannot: the page's first paint is assembled **with the
 * anon key**, through RLS, from rows a real companion post wrote — and that it follows the
 * lobby from filling to teams to the result without a second definition of any of it. The
 * Realtime subscription itself is exercised by hand against `pnpm --filter web dev`; what is
 * automated here is the state every event re-reads.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the tonight page against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';

  const { mintCompanionToken } = await import('@/lib/companionAuth');
  const { ensurePlayers } = await import('@/lib/ingest/players');
  const { promoteSplit } = await import('@/lib/admin/reroll');
  const { loadTonight } = await import('@/lib/tonight/load');
  const { tonightStart } = await import('@/lib/tonight/night');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { TonightView } = await import('./_tonight/TonightView');
  const { POST: postLobby } = await import('./api/companion/lobby/route');
  const { POST: postGame } = await import('./api/companion/game/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** The page's own client: the anon key and nothing else, exactly as a phone would read. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-tn${String(index).padStart(2, '0')}`);
  const partyId = `tn-${runId}`;
  const gameId = Number(`9${Date.now() % 1_000_000_000}`);

  let token = '';
  let lobbyId = '';
  /** The three who joined first, in the order the page put them in. */
  let firstThree: string[] = [];

  function companionRequest(path: string, json: unknown): Request {
    return new Request(`http://localhost/api/companion/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(json),
    });
  }

  /**
   * The first three are named against their puuid order on purpose: `tn00` is Zoe and `tn02`
   * is Ali, so a list ordered by `player_id` or by puuid comes out in a different order from
   * a list ordered by the name a reader sees.
   */
  const NAMES = ['Zoe', 'Mina', 'Ali', ...Array.from({ length: 7 }, (_, index) => `Player${index + 3}`)];

  function members(count: number) {
    return ten.slice(0, count).map((puuid, index) => ({
      puuid,
      gameName: NAMES[index] ?? `Player${index}`,
      tagLine: 'EUW',
      summonerId: 7_000 + index,
      side: (index < 5 ? 100 : 200) as 100 | 200,
    }));
  }

  /** What the page renders on the server for this snapshot: the first paint, as HTML. */
  async function firstPaint(): Promise<string> {
    const snapshot = await loadTonight(anon, { nightStart: tonightStart() });
    return renderToStaticMarkup(
      // The rail is empty here: this asserts the first paint of the night's own column, and
      // `Top of the board` is a second query the page makes beside this one (M3.19).
      createElement(TonightView, { snapshot, viewer: { kind: 'anonymous' }, topPlayers: [] }),
    );
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    const { token: raw, tokenHash } = mintCompanionToken();
    const { error } = await db
      .from('companion_tokens')
      .insert({ player_id: ids.get(ten[0] ?? '') ?? '', token_hash: tokenHash, label: `tn-${runId}` });
    if (error) throw new Error(error.message);
    token = raw;
  });

  /**
   * Hand the shared database back the way it was found (M3.27).
   *
   * This file used to leak its ten `it-<run>-tn*` players, their ratings, the lobby and the
   * game into the local stack on every run — 140 of them after a day of work, which is how the
   * stack crossed PostgREST's 1000-row cap and made `/admin/players` silently drop rows.
   *
   * Order matters. The game goes first, because `games.lobby_id` is `on delete set null` and
   * deleting the lobby would leave the row behind with nothing pointing at it. The lobby is
   * next (`lobby_members` and `splits` cascade off it), and the players last — `ratings`,
   * `game_players` and the companion token all cascade off them.
   */
  afterAll(async () => {
    const { error: gameError } = await db.from('games').delete().eq('lcu_game_id', gameId);
    if (gameError) throw new Error(`cleanup: deleting the test game failed: ${gameError.message}`);

    const { error: lobbyError } = await db.from('lobbies').delete().eq('lcu_party_id', partyId);
    if (lobbyError) throw new Error(`cleanup: deleting the test lobby failed: ${lobbyError.message}`);

    const { error: playerError } = await db.from('players').delete().in('puuid', ten);
    if (playerError) throw new Error(`cleanup: deleting the test players failed: ${playerError.message}`);

    // Asserted, not hoped for: a swallowed failure above is exactly how the rows piled up.
    const { data: left, error: leftError } = await db.from('players').select('puuid').in('puuid', ten);
    if (leftError) throw new Error(`cleanup: checking the test players failed: ${leftError.message}`);
    expect(left ?? []).toEqual([]);
  });

  describe('the tonight page, read with the anon key', () => {
    it('shows the lobby filling up, in join order, with a rating beside every name', async () => {
      const response = await postLobby(
        companionRequest('lobby', lobbyBody({ partyId, members: members(3) })),
      );
      expect(response.status).toBe(200);
      lobbyId = ((await response.json()) as { lobbyId: string }).lobbyId;

      const snapshot = await loadTonight(anon, { nightStart: tonightStart() });
      expect(snapshot.lobby?.id).toBe(lobbyId);
      expect(snapshot.lobby?.status).toBe('open');
      expect([...(snapshot.lobby?.members ?? [])].map((member) => member.name).sort()).toEqual([
        'Ali',
        'Mina',
        'Zoe',
      ]);
      for (const member of snapshot.lobby?.members ?? []) {
        expect(member.rating).toBeGreaterThan(0);
      }

      // Three members of one companion post share a `created_at` to the microsecond and have
      // no join order between them, so they are ordered by the name the reader sees — not by
      // `player_id`, which is a random uuid and reads as a shuffle on the first screen.
      expect(snapshot.lobby?.members.map((member) => member.name)).toEqual(['Ali', 'Mina', 'Zoe']);
      // …and that is not the puuid order, which is what the query returns them in.
      expect(snapshot.lobby?.members.map((member) => member.puuid)).toEqual([ten[2], ten[1], ten[0]]);

      const again = await loadTonight(anon, { nightStart: tonightStart() });
      expect(again.lobby?.members.map((member) => member.puuid)).toEqual(
        snapshot.lobby?.members.map((member) => member.puuid),
      );
      firstThree = snapshot.lobby?.members.map((member) => member.puuid) ?? [];

      // The first paint carries content, not a loading state.
      const html = await firstPaint();
      expect(html).toContain('3');
      expect(html).toContain('Zoe');
      expect(html).not.toContain('Loading');
    });

    it('follows the lobby to teams and carries the promoted split verbatim', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const first = await postLobby(
          companionRequest('lobby', lobbyBody({ partyId, members: members(10) })),
        );
        expect(first.status).toBe(200);
        const { data } = await db.from('lobbies').select('updated_at').eq('id', lobbyId).single();
        vi.setSystemTime(Date.parse(data?.updated_at ?? '') + ROSTER_STABLE_MS + 1_000);
        const second = await postLobby(
          companionRequest('lobby', lobbyBody({ partyId, members: members(10) })),
        );
        expect(await second.json()).toMatchObject({ status: 'balanced' });
      } finally {
        vi.useRealTimers();
      }

      const filled = await loadTonight(anon, { nightStart: tonightStart() });
      // Nothing above the newest row moved: the seven who joined later are appended.
      expect(filled.lobby?.members.slice(0, 3).map((member) => member.puuid)).toEqual(firstThree);

      const snapshot = filled;
      expect(snapshot.lobby?.status).toBe('balanced');
      expect(snapshot.lobby?.teams?.blue).toHaveLength(5);
      expect(snapshot.lobby?.teams?.red).toHaveLength(5);
      // The chosen split's own balance run, and only that run: three splits, ranked.
      expect(snapshot.lobby?.teams?.splits.map((split) => split.rank)).toEqual([1, 2, 3]);
      expect(snapshot.lobby?.teams?.splits.filter((split) => split.isChosen)).toHaveLength(1);

      const { data: stored } = await db
        .from('splits')
        .select('explanation')
        .eq('lobby_id', lobbyId)
        .eq('is_chosen', true)
        .single();
      // Verbatim: the page prints the stored sentence and never recomposes it.
      expect(snapshot.lobby?.teams?.explanation).toBe(stored?.explanation);
      expect(await firstPaint()).toContain(escapeHtml(stored?.explanation ?? ''));
    });

    it('follows a reroll: the page becomes the promoted split, sentence and seats (M3.7)', async () => {
      const before = await loadTonight(anon, { nightStart: tonightStart() });
      const second = before.lobby?.teams?.splits.find((split) => split.rank === 2);
      expect(second).toBeDefined();

      const promoted = await promoteSplit(db, { lobbyId, splitId: second?.id ?? '' });
      expect(promoted.ok).toBe(true);

      const after = await loadTonight(anon, { nightStart: tonightStart() });
      const { data: stored } = await db
        .from('splits')
        .select('explanation, blue')
        .eq('id', second?.id ?? '')
        .single();

      expect(after.lobby?.teams?.splitId).toBe(second?.id);
      expect(after.lobby?.teams?.explanation).toBe(stored?.explanation);
      expect(after.lobby?.teams?.explanation).not.toBe(before.lobby?.teams?.explanation);
      // The seats are that split's, not the old one's.
      const blue = (stored?.blue ?? []) as { puuid: string; role: string }[];
      expect(after.lobby?.teams?.blue.map((seat) => `${seat.puuid}:${seat.role}`)).toEqual(
        blue.map((seat) => `${seat.puuid}:${seat.role}`),
      );
    });

    it('keeps the teams up in the window where no split is chosen', async () => {
      // Both `balanceLobby` and `promoteSplit` clear `is_chosen` in one statement and set it
      // in the next — PostgREST has no transaction — so a read can land between them. Falling
      // through to the member list there would flash it under a reader looking at the teams.
      const before = await loadTonight(anon, { nightStart: tonightStart() });
      const chosenId = before.lobby?.teams?.splitId ?? '';

      const { error } = await db.from('splits').update({ is_chosen: false }).eq('id', chosenId);
      if (error) throw new Error(error.message);

      const during = await loadTonight(anon, { nightStart: tonightStart() });
      expect(during.lobby?.status).toBe('balanced');
      expect(during.lobby?.teams).not.toBeNull();
      // The newest run's rank 1: the best split of the balance the group is actually in.
      expect(during.lobby?.teams?.splits.find((split) => split.isChosen)?.rank).toBe(1);
      expect(during.lobby?.teams?.blue).toHaveLength(5);

      const { error: restore } = await db.from('splits').update({ is_chosen: true }).eq('id', chosenId);
      if (restore) throw new Error(restore.message);
    });

    /**
     * The side line goes when the sides are right (M4.11, M4.3's acceptance check 7).
     *
     * What only this file can prove: the loader really reads `lobby_members.side` through the
     * anon key and RLS, so the line on the page follows the column a companion post writes. The
     * component tests own where the line sits and what it says; this owns the wire.
     */
    it('drops the side line once every one of the ten sits where the split put them', async () => {
      const before = await loadTonight(anon, { nightStart: tonightStart() });
      const teams = before.lobby?.teams;
      expect(teams?.blue).toHaveLength(5);

      const sideOf = async (puuid: string, side: 100 | 200) => {
        const { data: player } = await db.from('players').select('id').eq('puuid', puuid).single();
        const { error } = await db
          .from('lobby_members')
          .update({ side })
          .eq('lobby_id', lobbyId)
          .eq('player_id', player?.id ?? '');
        if (error) throw new Error(error.message);
      };

      // What a companion post looks like once the ten have finished moving.
      for (const seat of teams?.blue ?? []) await sideOf(seat.puuid, 100);
      for (const seat of teams?.red ?? []) await sideOf(seat.puuid, 200);

      // As React prints it: `escapeHtml` is this file's `& < >` helper, and both of the
      // sentences carry a straight apostrophe, which the renderer writes as `&#x27;`. Pinned,
      // because the *absence* assertion below would pass on any string the page never contains.
      const printed = escapeHtml(sideLine(SWITCH_SIDE_ENABLED)).replace(/'/g, '&#x27;');

      const sorted = await loadTonight(anon, { nightStart: tonightStart() });
      expect(sorted.lobby?.teams?.blue.map((seat) => seat.liveSide)).toEqual([100, 100, 100, 100, 100]);
      expect(sorted.lobby?.teams?.red.map((seat) => seat.liveSide)).toEqual([200, 200, 200, 200, 200]);
      expect(await firstPaint()).not.toContain(printed);
      expect(await firstPaint()).not.toContain('cn-side-line');

      // One person drags themselves back across, which is one `lobby_members` update.
      const stray = teams?.blue[0]?.puuid ?? '';
      await sideOf(stray, 200);

      const strayed = await loadTonight(anon, { nightStart: tonightStart() });
      expect(strayed.lobby?.teams?.blue[0]?.liveSide).toBe(200);
      expect(await firstPaint()).toContain(printed);

      // Hand the lobby back the way the posts left it: the sides `members(10)` reported.
      for (const [index, puuid] of ten.entries()) await sideOf(puuid, index < 5 ? 100 : 200);
    });

    it('becomes the result when the game ends, with both mu values for the delta', async () => {
      const response = await postGame(
        companionRequest('game', eogBody({ gameId, puuids: ten, partyId, durationS: 2_052 })),
      );
      expect(response.status).toBe(200);

      const snapshot = await loadTonight(anon, { nightStart: tonightStart() });
      expect(snapshot.lobby?.status).toBe('finished');
      expect(snapshot.lobby?.result?.rated).toBe(true);
      expect(snapshot.lobby?.result?.blue).toHaveLength(5);
      // Lane order, both sides: "my row" is where it was in the teams block twenty minutes
      // ago, and `game_players` comes back in no order of its own.
      expect(snapshot.lobby?.result?.blue.map((seat) => seat.role)).toEqual([
        'top',
        'jungle',
        'mid',
        'adc',
        'support',
      ]);
      expect(snapshot.lobby?.result?.red.map((seat) => seat.role)).toEqual([
        'top',
        'jungle',
        'mid',
        'adc',
        'support',
      ]);
      for (const seat of snapshot.lobby?.result?.blue ?? []) {
        expect(typeof seat.muBefore).toBe('number');
        expect(typeof seat.muAfter).toBe('number');
      }

      const html = await firstPaint();
      // Floodlit's result headline: the display cut, upper case, in the winner's colour.
      expect(html).toMatch(/(BLUE|RED) WINS/);
      // The delta is rendered, and it is signed.
      expect(html).toMatch(/\((\+|−)\d+\)/);
    });

    it('names a player on the scoreboard who has no lobby_members row', async () => {
      // `game_players` and `lobby_members` are not the same ten: `findLobbyId`'s clock and
      // late-report fallbacks can attach a game to a lobby whose roster was frozen at
      // `in_game`. Reading the name off the member map printed `Someone` for that player —
      // and `Top damage: Someone` — while the result embed named them.
      const { data: player } = await db
        .from('players')
        .select('id, display_name')
        .eq('puuid', ten[9] ?? '')
        .single();
      const { error } = await db
        .from('lobby_members')
        .delete()
        .eq('lobby_id', lobbyId)
        .eq('player_id', player?.id ?? '');
      if (error) throw new Error(error.message);

      const snapshot = await loadTonight(anon, { nightStart: tonightStart() });
      const seat = [...(snapshot.lobby?.result?.blue ?? []), ...(snapshot.lobby?.result?.red ?? [])].find(
        (row) => row.puuid === ten[9],
      );

      expect(snapshot.lobby?.members.some((member) => member.puuid === ten[9])).toBe(false);
      expect(seat?.name).toBe(player?.display_name);
      expect(seat?.name).not.toBeNull();
      // The same row carries the top damage in this fixture: `Player9` deals the most.
      expect(snapshot.lobby?.result?.topDamage?.name).toBe(player?.display_name);
      expect(await firstPaint()).not.toContain('Someone');
    });

    it('never puts a Discord id on the wire, and the anon key cannot ask for one', async () => {
      expect(await firstPaint()).not.toContain('discord');

      const { error } = await anon.from('players').select('discord_id').limit(1);
      expect(error).not.toBeNull();
    });
  });
}

/** React escapes what it renders; the assertions compare against the same escaping. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
