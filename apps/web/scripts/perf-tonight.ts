import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { mintCompanionToken } from '../lib/companionAuth.ts';
import { deleteTestGroups } from '../lib/testing/groups.ts';
import { rollForTest } from '../lib/testing/roll.ts';

/**
 * Tonight's server cost, screen by screen (performance plan, phase 0). **Dev only, local stack
 * only**: it refuses any `NEXT_PUBLIC_SUPABASE_URL` that is not on this machine.
 *
 *   pnpm --filter web build
 *   pnpm --filter web perf-tonight [--delay 40] [--runs 3] [--port 3170] [--also customs] [--dev]
 *                            [--playwright <path>] [--keep]
 *
 * It makes a scratch group (`perf-<random>`, twelve players, two of them named `Ali` so the
 * same-name labels have work to do, a companion token), starts `next start` (or `next dev` with
 * `--dev`) with `scripts/perf/preload.mjs` and a simulated Supabase RTT, then walks the group
 * through a night with the real companion routes and the admin roll's library call: empty idle,
 * a filling lobby of 3 and of 10, teams, in game, the result, and the second game's result with
 * a tape. On each screen it asks for the Tonight page `--runs` times as a refresh does (`RSC: 1`)
 * and once as a first load (HTML), and prints per screen:
 *
 * - **queries**: Supabase round trips in one Tonight render (median);
 * - **rounds**: how many of them ran one after another (the RTT-independent number);
 * - **render ms**: the RSC request's wall time; **TTFB**: the HTML request's first byte;
 * - **pf links**: player and game links in the payload, and how many of them still prefetch;
 * - **refresh q** (with `--playwright <path to playwright's index.mjs>`): every Supabase call one
 *   refresh costs in a real phone-sized browser holding the page, Tonight's render and the
 *   prefetches it sets off together, and how many prefetch requests that was.
 *
 * `--also <slug>` measures an existing group's idle page too, read only (anonymous GETs). The
 * scratch group and its players are deleted at the end, also on failure.
 */

interface Args {
  delay: number;
  runs: number;
  port: number;
  also: string[];
  dev: boolean;
  keep: boolean;
  playwright: string | null;
  /** `--delete <slug>`: remove a scratch group a `--keep` run left behind, and its players, then stop. */
  remove: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    delay: 40,
    runs: 3,
    port: 3170,
    also: [],
    dev: false,
    keep: false,
    playwright: null,
    remove: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--delay' && value !== undefined) args.delay = Number(value);
    else if (arg === '--runs' && value !== undefined) args.runs = Number(value);
    else if (arg === '--port' && value !== undefined) args.port = Number(value);
    else if (arg === '--also' && value !== undefined) args.also.push(value);
    else if (arg === '--playwright' && value !== undefined) args.playwright = value;
    else if (arg === '--delete' && value !== undefined) args.remove = value;
    else if (arg === '--dev') {
      args.dev = true;
      continue;
    } else if (arg === '--keep') {
      args.keep = true;
      continue;
    } else throw new Error(`perf-tonight: unknown argument ${arg}`);
    index += 1;
  }
  return args;
}

interface ReqRow {
  k: 'req';
  rid: string;
  t0: number;
  ttfb: number | null;
  t1: number;
  status: number;
  url: string;
  rsc: string | null;
  prefetch: string | null;
}

interface SbRow {
  k: 'sb';
  rid: string | null;
  t0: number;
  t1: number;
  method: string;
  path: string;
}

type Row = ReqRow | SbRow;

function readLog(file: string): Row[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('[perf] '))
    .map((line) => JSON.parse(line.slice('[perf] '.length)) as Row);
}

/** Sequential rounds: a call is one round after the latest call that had finished before it began. */
export function rounds(calls: readonly { t0: number; t1: number }[]): number {
  const sorted = [...calls].sort((a, b) => a.t0 - b.t0);
  const wave: number[] = [];
  sorted.forEach((call, index) => {
    let depth = 1;
    for (let before = 0; before < index; before += 1) {
      const earlier = sorted[before];
      if (earlier !== undefined && earlier.t1 <= call.t0 + 0.5)
        depth = Math.max(depth, (wave[before] ?? 0) + 1);
    }
    wave.push(depth);
  });
  return Math.max(0, ...wave);
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

interface Tab {
  goto(url: string): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  close(): Promise<void>;
}

interface Browser {
  newPage(options: Record<string, unknown>): Promise<Tab>;
  close(): Promise<void>;
}

/** Playwright from wherever it is installed (it is not a dependency of this package). */
async function launch(path: string): Promise<Browser> {
  const module = (await import(pathToFileURL(resolve(path)).href)) as {
    chromium: { launch(): Promise<Browser> };
  };
  return module.chromium.launch();
}

/** `lib/tonight/live.ts`'s TONIGHT_REFRESH_EVENT (a client module: not importable under react-server). */
const TONIGHT_REFRESH_EVENT = 'kustom:tonight-refresh';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const host = url === '' ? '' : new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`perf-tonight: local stack only, refusing ${host || 'an unset URL'}`);
  }
  const db = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  if (args.remove !== null) {
    if (!/^perf-[0-9a-f]{6}$/.test(args.remove))
      throw new Error('perf-tonight: --delete takes a perf-<hex> slug');
    const { data } = await db.from('groups').select('id').eq('slug', args.remove).maybeSingle();
    if (data !== null) await deleteTestGroups(db, [data.id]);
    await db.from('players').delete().like('puuid', `${args.remove}-p%`);
    console.log(`perf-tonight: deleted ${args.remove}`);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'perf-tonight-'));
  const log = join(dir, 'perf.log');
  const base = `http://localhost:${args.port}`;
  const runId = randomBytes(3).toString('hex');
  const slug = `perf-${runId}`;
  const names = ['Ali', 'Ali', 'Mina', 'Zoe', 'Bo', 'Cy', 'Di', 'Ed', 'Fy', 'Gu', 'Hu', 'Io'];
  const puuids = names.map((_, index) => `${slug}-p${index}`);
  let groupId = '';
  let server: ChildProcess | null = null;
  const browser = args.playwright === null ? null : await launch(args.playwright);

  try {
    // The scratch group, its players and members (the first is the owner and the host).
    const group = await db
      .from('groups')
      .insert({ slug, name: `Perf ${runId}` })
      .select('id')
      .single();
    if (group.error) throw new Error(`group: ${group.error.message}`);
    groupId = group.data.id;
    const players = await db
      .from('players')
      .insert(puuids.map((puuid, index) => ({ puuid, game_name: names[index] ?? 'P', tag_line: 'EUW' })))
      .select('id, puuid');
    if (players.error) throw new Error(`players: ${players.error.message}`);
    const ids = new Map(players.data.map((row) => [row.puuid, row.id]));
    const ownerId = ids.get(puuids[0] ?? '') ?? '';
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

    // The server, with the preload and the simulated RTT.
    const preload = resolve(import.meta.dirname, 'perf/preload.mjs');
    const next = resolve(import.meta.dirname, '../node_modules/.bin/next');
    server = spawn(next, [args.dev ? 'dev' : 'start', '-p', String(args.port)], {
      cwd: resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        KUSTOM_PERF_LOG: '1',
        KUSTOM_PERF_LOG_FILE: log,
        PERF_SB_DELAY_MS: String(args.delay),
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${preload}`.trim(),
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    for (let tries = 0; ; tries += 1) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {}
      if (tries > 120) throw new Error('perf-tonight: the server did not come up');
      await sleep(500);
    }

    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${base}/api/companion/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    };
    const lobby = (party: string, count: number) =>
      post('lobby', {
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
      });
    const newestLobby = async () => {
      const { data, error } = await db
        .from('lobbies')
        .select('id')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (error) throw new Error(`lobby id: ${error.message}`);
      return data.id;
    };
    const roles = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
    const game = (party: string, gameId: number) => ({
      start: () =>
        post('game', {
          phase: 'in_progress',
          gameId: String(gameId),
          partyId: party,
          startedAt: new Date().toISOString(),
        }),
      end: () =>
        post('game', {
          phase: 'eog',
          gameId,
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
          raw: { gameId },
        }),
    });

    const table: string[][] = [];
    const measure = async (screen: string, path: string) => {
      await sleep(400);
      const renders: { queries: number; rounds: number; ms: number }[] = [];
      let payload = '';
      for (let run = 0; run < args.runs; run += 1) {
        const from = readLog(log).length;
        const response = await fetch(`${base}${path}`, { headers: { RSC: '1' } });
        payload = await response.text();
        await sleep(150);
        const rows = readLog(log).slice(from);
        const req = rows.find(
          (row): row is ReqRow => row.k === 'req' && row.rsc === '1' && row.status === 200,
        );
        const calls = rows.filter((row): row is SbRow => row.k === 'sb' && row.rid === req?.rid);
        renders.push({
          queries: calls.length,
          rounds: rounds(calls),
          ms: req ? req.t1 - req.t0 : Number.NaN,
        });
      }
      const from = readLog(log).length;
      await (await fetch(`${base}${path}`)).text();
      await sleep(150);
      const html = readLog(log)
        .slice(from)
        .find((row): row is ReqRow => row.k === 'req' && row.rsc === null && row.url.startsWith(path));

      // Links to player and game pages in the payload, and how many of them still prefetch.
      const links = [...payload.matchAll(/\{[^{}]*"href":"(\/g\/[^"]+\/(?:p|games)\/[^"]+)"[^{}]*\}/g)];
      const prefetching = links.filter((match) => !match[0].includes('"prefetch":false'));
      // One refresh in a real browser holding the page (needs `--playwright`): Tonight's own render
      // plus every prefetch the refresh sets off, as the server saw them.
      let refresh = '-';
      if (browser !== null) {
        const tab = await browser.newPage({
          viewport: { width: 375, height: 812 },
          isMobile: true,
          hasTouch: true,
        });
        await tab.goto(`${base}${path}`);
        await sleep(4000);
        const start = readLog(log).length;
        await tab.evaluate(`window.dispatchEvent(new Event('${TONIGHT_REFRESH_EVENT}'))`);
        await sleep(4000);
        await tab.close();
        const rows = readLog(log).slice(start);
        const reqs = rows.filter((row): row is ReqRow => row.k === 'req' && !row.url.startsWith('/_next/'));
        const ids = new Set(reqs.map((row) => row.rid));
        const queries = rows.filter((row) => row.k === 'sb' && row.rid !== null && ids.has(row.rid)).length;
        const prefetches = reqs.filter((row) => row.prefetch === '1').length;
        refresh = `${queries} (${prefetches} pf)`;
      }
      table.push([
        screen,
        String(median(renders.map((r) => r.queries))),
        String(median(renders.map((r) => r.rounds))),
        String(Math.round(median(renders.map((r) => r.ms)))),
        html?.ttfb ? String(Math.round(html.ttfb - html.t0)) : '-',
        `${links.length}/${prefetching.length}`,
        refresh,
      ]);
      console.error(`perf-tonight: ${screen} measured`);
    };

    const page = `/g/${slug}`;
    // Warm the routes once so the first measurement is not a cold compile or a cold cache.
    await (await fetch(`${base}${page}`)).text();
    await measure('idle, empty group', page);
    const partyA = `perf-${slug}-a`;
    await lobby(partyA, 3);
    await measure('filling, 3', page);
    await lobby(partyA, 10);
    await measure('filling, 10', page);
    await rollForTest(db, await newestLobby());
    await measure('teams', page);
    const gameA = game(partyA, Date.now() * 1000 + 7);
    await gameA.start();
    await measure('in game', page);
    await gameA.end();
    await sleep(1500);
    await measure('result', page);
    const partyB = `perf-${slug}-b`;
    await lobby(partyB, 10);
    await rollForTest(db, await newestLobby());
    const gameB = game(partyB, Date.now() * 1000 + 9);
    await gameB.start();
    await measure('in game, tape of 1', page);
    await gameB.end();
    await sleep(1500);
    await measure('result, tape of 1', page);
    for (const other of args.also) await measure(`idle, ${other} (read only)`, `/g/${other}`);

    const head = ['screen', 'queries', 'rounds', 'render ms', 'TTFB', 'pf links/on', 'refresh q'];
    const widths = head.map((title, column) =>
      Math.max(title.length, ...table.map((row) => row[column]?.length ?? 0)),
    );
    const line = (cells: readonly string[]) =>
      cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ');
    console.log(
      `delay ${args.delay} ms per Supabase call, ${args.runs} runs per screen, ${args.dev ? 'next dev' : 'next start'}`,
    );
    console.log(line(head));
    for (const row of table) console.log(line(row));
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
    if (!args.keep && groupId !== '') {
      await deleteTestGroups(db, [groupId]);
      await db.from('players').delete().in('puuid', puuids);
    }
    if (args.keep) console.error(`perf-tonight: kept ${slug} and the log at ${log}`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

await main();
