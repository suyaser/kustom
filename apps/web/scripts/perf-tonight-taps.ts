import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import type { Database } from '@customs/db';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { mintCompanionToken } from '../lib/companionAuth.ts';
import { deleteTestGroups } from '../lib/testing/groups.ts';

/**
 * Tonight's live behaviour in a real browser (M19.3): server renders per event and per control
 * tap, whether each control stays pending until the screen it changed has changed, and INP.
 * **Dev only, local stack only**: it refuses any `NEXT_PUBLIC_SUPABASE_URL` not on this machine.
 *
 *   pnpm --filter web build
 *   pnpm --filter web perf-tonight-taps --playwright <path to playwright's index.mjs>
 *                                  [--delay 40] [--cpu 4] [--port 3171] [--web <app dir>] [--start yes]
 *
 * It makes a scratch group (`perf-<hex>`, twelve players) whose owner is a password user carrying
 * a made-up Discord identity (the session `currentSessionPlayer` reads), starts `next start` with
 * `scripts/perf/preload.mjs` and the simulated Supabase RTT, opens Tonight at 375 px with the CPU
 * throttled, and walks a night: a lobby of ten, Roll, Reroll, Set mode, Spin, Rated, game start,
 * game end, ten joins 400 ms apart, then `Make admin` on the members page (a ConfirmAction).
 *
 * Per tap it prints renders (Tonight RSC requests the server saw), when the control went pending
 * and came back, when the screen first and last changed, the **dead window** (pending off while the
 * screen was still to change; 0 means it held), and INP (the tap's longest Event Timing entry).
 * Realtime rows the page heard from other groups are counted per step as `foreign`. Since M19.11
 * (0044) every published table carries `group_id` and Tonight filters on it, so `foreign` should
 * always be 0; anything else is a leak to report, not noise to read around.
 *
 * `--web <dir>` serves another build (an older checkout, for a before/after). The scratch group,
 * its players and the auth user are deleted at the end, also on failure and on Ctrl-C.
 */

interface Args {
  delay: string;
  cpu: number;
  port: number;
  web: string;
  playwright: string | null;
  /** `--start yes`: press Start the next lobby on the result screen and watch the 75 s it stays pending. */
  start: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    delay: '40',
    cpu: 4,
    port: 3171,
    web: resolve(import.meta.dirname, '..'),
    playwright: null,
    start: false,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`perf-tonight-taps: ${arg} needs a value`);
    if (arg === '--delay') args.delay = value;
    else if (arg === '--cpu') args.cpu = Number(value);
    else if (arg === '--port') args.port = Number(value);
    else if (arg === '--web') args.web = resolve(value);
    else if (arg === '--playwright') args.playwright = value;
    else if (arg === '--start') args.start = value === 'yes';
    else throw new Error(`perf-tonight-taps: unknown argument ${arg}`);
  }
  return args;
}

interface ReqRow {
  k: 'req';
  t0: number;
  url: string;
  rsc: string | null;
  prefetch: string | null;
}

interface Tab {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  addInitScript(script: { content: string }): Promise<void>;
  locator(selector: string): {
    first(): { tap(): Promise<void>; click(): Promise<void>; selectOption(value: string): Promise<unknown> };
  };
  getByRole(role: string, options: Record<string, unknown>): { first(): { click(): Promise<void> } };
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
}

interface Context {
  addCookies(cookies: Record<string, unknown>[]): Promise<void>;
  newPage(): Promise<Tab>;
  newCDPSession(
    page: Tab,
  ): Promise<{ send(method: string, params: Record<string, unknown>): Promise<unknown> }>;
}

interface Browser {
  newContext(options: Record<string, unknown>): Promise<Context>;
  close(): Promise<void>;
}

/** Runs in the page (a string, so no bundler helper leaks into it): Event Timing, Realtime rows, a tap watcher. */
const PAGE_PROBE = `(function () {
  var w = window; var ev = []; var rt = []; w.__ev = ev; w.__rt = rt;
  new PerformanceObserver(function (list) {
    list.getEntries().forEach(function (e) { if (e.interactionId) ev.push(Math.round(e.duration)); });
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  var WS = window.WebSocket;
  var Probe = function (a, b) {
    var ws = b === undefined ? new WS(a) : new WS(a, b);
    ws.addEventListener('message', function (e) {
      try {
        var m = JSON.parse(e.data);
        var name = Array.isArray(m) ? m[3] : m.event;
        var payload = Array.isArray(m) ? m[4] : m.payload;
        if (name !== 'postgres_changes') return;
        var d = (payload && payload.data) || {}; var rec = d.record || {}; var old = d.old_record || {};
        rt.push({ t: Date.now(), g: rec.group_id || old.group_id || null });
      } catch (_) {}
    });
    return ws;
  };
  Probe.prototype = WS.prototype; Probe.CONNECTING = 0; Probe.OPEN = 1; Probe.CLOSING = 2; Probe.CLOSED = 3;
  window.WebSocket = Probe;
  // pending: the control's aria-disabled, or (dialog) the dialog being open.
  w.__watch = function (pendingSel, mode, excludeSel) {
    var snap = function () {
      var root = document.querySelector('main'); if (!root) return '';
      var copy = root.cloneNode(true);
      copy.querySelectorAll(excludeSel).forEach(function (el) { el.remove(); });
      return copy.textContent || '';
    };
    var base = snap(); var prev = base;
    var t = { start: performance.now(), pendOn: null, unpend: null, change: null, last: null, ev: ev.length };
    w.__tap = t;
    var loop = function () {
      var now = performance.now(); var el = document.querySelector(pendingSel);
      var pend = mode === 'present' ? !!el : !!el && el.getAttribute('aria-disabled') === 'true';
      if (pend && t.pendOn === null) t.pendOn = now;
      if (t.pendOn !== null && !pend && t.unpend === null) t.unpend = now;
      var cur = snap();
      if (t.change === null && cur !== base) t.change = now;
      if (cur !== prev) { t.last = now; prev = cur; }
      if (now - t.start < 9000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
})();`;

/** Live text that changes on its own (timers, live regions, the reveal, the controls' outcome line). */
const EXCLUDE =
  '[role=status], [aria-live], [data-slot="elapsed"], [data-slot="spin-reveal"], [data-slot="mode-outcome"], script, style, template';

/**
 * A dead window this short is the same render settling (a client island painting in the frames
 * right after the commit, about 30 to 45 ms at 4x CPU after Roll), not the old screen left up.
 */
const HELD_TOLERANCE_MS = 50;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.playwright === null)
    throw new Error('perf-tonight-taps: --playwright <path to index.mjs> is required');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const host = url === '' ? '' : new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`perf-tonight-taps: local stack only, refusing ${host || 'an unset URL'}`);
  }
  const { chromium } = (await import(pathToFileURL(resolve(args.playwright)).href)) as {
    chromium: { launch(): Promise<Browser> };
  };
  const db = createClient<Database>(url, service, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(
    readFileSync(resolve(import.meta.dirname, '../../../packages/db/supabase/config.toml'), 'utf8'),
  )?.[1];
  const psql = (sql: string): void => {
    execFileSync(
      'docker',
      ['exec', '-i', `supabase_db_${projectId}`, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
      {
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  };
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

  const runId = randomBytes(3).toString('hex');
  const slug = `perf-${runId}`;
  const names = ['Ali', 'Ali', 'Mina', 'Zoe', 'Bo', 'Cy', 'Di', 'Ed', 'Fy', 'Gu', 'Hu', 'Io'];
  const puuids = names.map((_, index) => `${slug}-p${index}`);
  const base = `http://localhost:${args.port}`;
  const dir = mkdtempSync(join(tmpdir(), 'perf-taps-'));
  const log = join(dir, 'perf.log');
  let groupId = '';
  let otherGroupId = '';
  let userId = '';
  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await browser?.close().catch(() => {});
    server?.kill('SIGTERM');
    if (groupId !== '' || otherGroupId !== '') await deleteTestGroups(db, [groupId, otherGroupId]);
    await db.from('players').delete().in('puuid', puuids);
    if (userId !== '') psql(`delete from auth.users where id = ${literal(userId)};`);
    rmSync(dir, { recursive: true, force: true });
  };
  process.once('SIGINT', () => {
    void cleanup().finally(() => process.exit(130));
  });

  const results: Record<string, unknown>[] = [];
  const windows: { row: Record<string, unknown>; from: number; to: number }[] = [];
  try {
    const group = await db
      .from('groups')
      .insert({ slug, name: `Perf ${runId}` })
      .select('id')
      .single();
    if (group.error) throw new Error(`group: ${group.error.message}`);
    groupId = group.data.id;
    const discordId = `9${Date.now()}`;
    const players = await db
      .from('players')
      .insert(
        puuids.map((puuid, index) => ({
          puuid,
          game_name: names[index] ?? 'P',
          tag_line: 'EUW',
          ...(index === 0 ? { discord_id: discordId } : {}),
        })),
      )
      .select('id, puuid');
    if (players.error) throw new Error(`players: ${players.error.message}`);
    const ownerId = players.data.find((row) => row.puuid === puuids[0])?.id ?? '';
    const members = await db.from('group_memberships').upsert(
      players.data.map((row) => ({
        group_id: groupId,
        player_id: row.id,
        role: row.id === ownerId ? ('owner' as const) : ('member' as const),
      })),
      { onConflict: 'group_id,player_id' },
    );
    if (members.error) throw new Error(`members: ${members.error.message}`);
    const { token, tokenHash } = mintCompanionToken();
    const tokenRow = await db
      .from('companion_tokens')
      .insert({ player_id: ownerId, token_hash: tokenHash, label: 'perf', group_id: groupId });
    if (tokenRow.error) throw new Error(`token: ${tokenRow.error.message}`);

    // The owner's session: a password user with a made-up Discord identity, scratch group only.
    userId = randomUUID();
    const email = `${slug}@perf.invalid`;
    const password = `pw-${randomBytes(12).toString('hex')}`;
    psql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
values (${literal(userId)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${literal(email)}, extensions.crypt(${literal(password)}, extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email","discord"]}', '{}', '', '', '', '');
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (${literal(discordId)}, ${literal(userId)}, jsonb_build_object('sub', ${literal(discordId)}, 'provider_id', ${literal(discordId)}, 'full_name', 'Perf'), 'discord', now(), now(), now());`);
    const jar = new Map<string, string>();
    const auth = createServerClient(url, anon, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const { name, value } of cookies) {
            if (value === '') jar.delete(name);
            else jar.set(name, value);
          }
        },
      },
    });
    const signIn = await auth.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`sign-in: ${signIn.error.message}`);

    server = spawn(resolve(args.web, 'node_modules/.bin/next'), ['start', '-p', String(args.port)], {
      cwd: args.web,
      env: {
        ...process.env,
        KUSTOM_PERF_LOG: '1',
        KUSTOM_PERF_LOG_FILE: log,
        PERF_SB_DELAY_MS: args.delay,
        NODE_OPTIONS: `--import ${resolve(args.web, 'scripts/perf/preload.mjs')}`,
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    for (let tries = 0; ; tries += 1) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {}
      if (tries > 120) throw new Error('perf-tonight-taps: the server did not come up');
      await sleep(500);
    }

    const post = async (path: string, body: unknown, bearer: string = token) => {
      const response = await fetch(`${base}/api/companion/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    };
    const lobby = (party: string, count: number, bearer: string = token) =>
      post(
        'lobby',
        {
          partyId: party,
          lobbyName: 'perf',
          lobbyPassword: '1234',
          members: puuids.slice(0, count).map((puuid, index) => ({
            puuid,
            gameName: names[index],
            tagLine: 'EUW',
            summonerId: 7000 + index,
            side: index < 5 ? 100 : 200,
            isSpectator: false,
          })),
        },
        bearer,
      );
    const reqs = (): ReqRow[] =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .filter((line) => line.startsWith('[perf] '))
            .map((line) => JSON.parse(line.slice('[perf] '.length)) as ReqRow)
            .filter((row) => row.k === 'req')
        : [];
    const renders = (path: string, from: number, to: number) =>
      reqs().filter(
        (row) =>
          row.t0 >= from &&
          row.t0 < to &&
          row.rsc !== null &&
          row.prefetch === null &&
          new URL(row.url, base).pathname === path,
      );

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await context.addCookies(
      [...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/', sameSite: 'Lax' })),
    );
    const page = await context.newPage();
    if (args.cpu > 1) {
      await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: args.cpu });
    }
    await page.addInitScript({ content: PAGE_PROBE });
    const tonight = `/g/${slug}`;

    const step = async (name: string, act: () => Promise<void>, wait = 5000) => {
      const from = Date.now();
      await act();
      await sleep(wait);
      const seen = renders(tonight, from, Date.now());
      const row: Record<string, unknown> = {
        step: name,
        renders: seen.length,
        at: seen.map((r) => Math.round(r.t0 - from)),
      };
      results.push(row);
      windows.push({ row, from, to: Date.now() });
    };
    const tap = async (
      name: string,
      selector: string,
      own: string,
      options: {
        pending?: string;
        mode?: 'aria' | 'present';
        path?: string;
        wait?: number;
        holds?: boolean;
      } = {},
    ) => {
      await sleep(2500);
      await page.evaluate(
        `window.__watch(${JSON.stringify(options.pending ?? selector)}, ${JSON.stringify(options.mode ?? 'aria')}, ${JSON.stringify(`${EXCLUDE}, ${own}`)})`,
      );
      const from = Date.now();
      await page.locator(selector).first().tap();
      await sleep(options.wait ?? 5000);
      const t = (await page.evaluate('window.__tap')) as Record<string, number | null>;
      const durations = ((await page.evaluate('window.__ev')) as number[]).slice(t.ev ?? 0);
      const at = (value: number | null | undefined) =>
        value === null || value === undefined ? null : Math.round(value - (t.start ?? 0));
      const dead = t.unpend != null && t.last != null ? Math.max(0, Math.round(t.last - t.unpend)) : null;
      const row: Record<string, unknown> = {
        step: `tap ${name}`,
        renders: renders(options.path ?? tonight, from, Date.now()).length,
        pendingAt: at(t.pendOn),
        freeAt: at(t.unpend),
        screenFirst: at(t.change),
        screenLast: at(t.last),
        deadWindow: dead,
        // Rated answers on its own (the switch is the route's answer) and is not held by design.
        held:
          options.holds === false
            ? 'not held by design'
            : dead === null
              ? '-'
              : dead <= HELD_TOLERANCE_MS
                ? 'yes'
                : 'NO',
        inp: Math.max(0, ...durations),
      };
      results.push(row);
      windows.push({ row, from, to: Date.now() });
    };

    const partyA = `perf-${slug}-1`;
    await step('open Tonight', async () => {
      await page.goto(`${base}${tonight}`, { waitUntil: 'load' });
    });
    await step('lobby to 10 (one post)', () => lobby(partyA, 10), 4000);
    await tap('Roll teams', 'form[action$="/roll"] button[type=submit]', 'form[action$="/roll"]');
    await tap('Reroll', 'form[action$="/reroll"] button[type=submit]', 'form[action$="/reroll"]');
    await page.locator('select[name="mode"]').first().selectOption('class:Tank');
    await tap(
      'Set mode',
      'form[action="/api/admin/mode"]:has(select) button[type=submit]:not([form])',
      'form[action="/api/admin/mode"]',
    );
    const modeForms = 'form[action="/api/admin/mode"], form[action="/api/admin/mode/spin"]';
    await tap('Spin', 'button[form$="-spin"]', modeForms, { wait: 6000 });
    await tap('Rated', 'button[role="switch"]', modeForms, { holds: false });
    const gameId = Date.now() * 1000 + 7;
    const roles = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
    await step('game in_progress post', () =>
      post('game', {
        phase: 'in_progress',
        gameId: String(gameId),
        partyId: partyA,
        startedAt: new Date().toISOString(),
      }),
    );
    const eog = (id: number, party: string) => ({
      phase: 'eog',
      gameId: id,
      partyId: party,
      gameType: 'CUSTOM_GAME',
      startedAt: new Date(Date.now() - 1_900_000).toISOString(),
      durationS: 1900,
      winningSide: 100,
      participants: puuids.slice(0, 10).map((puuid, index) => ({
        puuid,
        side: index < 5 ? 100 : 200,
        role: roles[index % 5],
        championId: 100 + index,
        kills: index,
        deaths: 10 - index,
        assists: index * 2,
        gold: 10_000 + index * 100,
        damageToChamps: 20_000 + index * 250,
        cs: 150 + index,
        win: index < 5,
        gameName: names[index],
        tagLine: 'EUW',
        summonerId: 7000 + index,
        visionScore: 10 + index,
        damageSelfMitigated: 5000 + index,
        damageToObjectives: 2000 + index,
      })),
      raw: { gameId: id },
    });
    await step('game end (eog post)', () => post('game', eog(gameId, partyA)), 7000);
    if (args.start) {
      // On the result screen (`Start the next lobby`). The scratch host is "at their PC" (M4.1's ten minutes), so the press queues a command
      // nobody runs: it stays pending until it expires at 60 s. M19.17: no page renders while it
      // waits, one when it settles.
      await db
        .from('companion_tokens')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('group_id', groupId);
      await sleep(2500);
      await step(
        'Start a lobby pending, 75 s',
        () => page.locator('form[action="/api/me/lobbies/start"] button[type=submit]').first().tap(),
        75_000,
      );
    }
    await step(
      '10 joins, 400 ms apart',
      async () => {
        for (let count = 1; count <= 10; count += 1) {
          await lobby(`perf-${slug}-2`, count);
          await sleep(400);
        }
      },
      4000,
    );

    // Another group's night while this page is open: three lobby posts, the game, its end.
    await step(
      "another group's 3 lobby posts and eog",
      async () => {
        const other = await db
          .from('groups')
          .insert({ slug: `${slug}-b`, name: `Perf ${runId} B` })
          .select('id')
          .single();
        if (other.error) throw new Error(`group B: ${other.error.message}`);
        otherGroupId = other.data.id;
        const joined = await db.from('group_memberships').upsert(
          players.data.map((row) => ({
            group_id: other.data.id,
            player_id: row.id,
            role: row.id === ownerId ? ('owner' as const) : ('member' as const),
          })),
          { onConflict: 'group_id,player_id' },
        );
        if (joined.error) throw new Error(`group B members: ${joined.error.message}`);
        const minted = mintCompanionToken();
        const row = await db.from('companion_tokens').insert({
          player_id: ownerId,
          token_hash: minted.tokenHash,
          label: 'perf-b',
          group_id: other.data.id,
        });
        if (row.error) throw new Error(`group B token: ${row.error.message}`);
        const partyB = `perf-${slug}-b`;
        for (const count of [3, 6, 10]) await lobby(partyB, count, minted.token);
        const otherGame = Date.now() * 1000 + 11;
        await post(
          'game',
          {
            phase: 'in_progress',
            gameId: String(otherGame),
            partyId: partyB,
            startedAt: new Date().toISOString(),
          },
          minted.token,
        );
        await post('game', eog(otherGame, partyB), minted.token);
      },
      5000,
    );

    // Realtime attribution for the Tonight steps, before leaving the page.
    const rows = (await page.evaluate('window.__rt')) as { t: number; g: string | null }[];
    for (const { row, from, to } of windows) {
      let own = 0;
      let foreign = 0;
      for (const r of rows) {
        if (r.t < from || r.t >= to) continue;
        if (r.g === groupId) own += 1;
        else foreign += 1;
      }
      row.ownRows = own;
      row.foreign = foreign;
    }

    // A ConfirmAction on the members page: the dialog stays open until the table has changed.
    const membersPath = `/g/${slug}/admin/members`;
    await page.goto(`${base}${membersPath}`, { waitUntil: 'load' });
    await sleep(2000);
    await page
      .getByRole('button', { name: /^Manage Mina/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Make admin' }).first().click();
    await page.waitForSelector('[role="alertdialog"]');
    await tap(
      'Make admin (ConfirmAction)',
      '[role="alertdialog"] button:has-text("Make admin")',
      '[role="alertdialog"]',
      {
        pending: '[role="alertdialog"]',
        mode: 'present',
        path: membersPath,
      },
    );
  } finally {
    await cleanup();
  }

  console.log(`delay ${args.delay} ms per Supabase call, CPU x${args.cpu}, 375 px, ${args.web}`);
  for (const row of results) console.log(JSON.stringify(row));
}

await main();
