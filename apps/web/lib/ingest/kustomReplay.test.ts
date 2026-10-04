import { readFileSync } from 'node:fs';
import type { Role } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { type FoldRatedPlayer, foldGameKustom, type KustomState } from './fold';

/**
 * M18.5's acceptance: the M18.3 real-data replay (`redesign/research/rating-real.md`), rerun with
 * the implemented fold (`foldGameKustom`, so `rateGameKustom`, `winProbability` and the share ranks
 * of `@customs/core`) in place of the scratch `fold.ts`, must reproduce the report's numbers to
 * three decimals: online log loss 0.700, Spearman 0.938 against the current board over the players
 * with 10+ rated games and 0.925 over everyone.
 *
 *   KUSTOM_REPLAY_CSV=~/Downloads/kustom-export.csv pnpm --filter web exec vitest run lib/ingest/kustomReplay.test.ts
 *
 * **Skipped unless `KUSTOM_REPLAY_CSV` names the export.** The export is production data (hashed
 * player keys, research §9): it is read in place and never copied into the repo, and CI never has
 * it. The selection mirrors the report's `load.ts`: every game with exactly ten rows, five a side,
 * and every row folded by the stored fold (`mu_before` set), in `started_at` order (game id on a
 * tie). The current board is `round(last mu_after × 60)` per player, as the report's.
 */

const CSV = process.env.KUSTOM_REPLAY_CSV?.trim();

type Row = Record<string, string>;

function readRows(file: string): Row[] {
  const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const head = (lines[0] ?? '').split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    if (cells.length !== head.length) throw new Error('replay: a row with the wrong number of cells');
    return Object.fromEntries(head.map((name, index) => [name, cells[index] ?? '']));
  });
}

const num = (value: string | undefined): number | null =>
  value === undefined || value === '' || value === 'null' ? null : Number(value);

interface ReplayGame {
  id: string;
  t: number;
  winningSide: 100 | 200;
  players: (FoldRatedPlayer & { muAfter: number })[];
}

function loadGames(file: string): ReplayGame[] {
  const byGame = new Map<string, Row[]>();
  for (const row of readRows(file)) {
    const list = byGame.get(row.game_id as string) ?? [];
    list.push(row);
    byGame.set(row.game_id as string, list);
  }
  const games: ReplayGame[] = [];
  for (const [id, rows] of byGame) {
    if (rows.length !== 10) continue;
    if (rows.filter((row) => row.side === '100').length !== 5) continue;
    if (!rows.every((row) => num(row.mu_before) !== null)) continue;
    const first = rows[0] as Row;
    games.push({
      id,
      t: Date.parse((first.started_at as string).replace(' ', 'T').replace(/\+00$/, 'Z')),
      winningSide: first.winning_side === '100' ? 100 : 200,
      players: rows.map((row) => ({
        playerId: row.player_key as string,
        puuid: row.player_key as string,
        side: row.side === '100' ? 100 : 200,
        role: (row.role === 'null' || row.role === '' ? null : row.role) as Role | null,
        kills: num(row.kills),
        deaths: num(row.deaths),
        assists: num(row.assists),
        damageToChamps: num(row.damage_to_champs),
        gold: num(row.gold),
        cs: num(row.cs),
        visionScore: num(row.vision_score),
        damageSelfMitigated: num(row.damage_self_mitigated),
        damageToObjectives: num(row.damage_to_objectives),
        muAfter: num(row.mu_after) as number,
      })),
    });
  }
  return games.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
}

/** The report's Spearman: rank by value, highest first, ties in key order; 1 − 6Σd² / n(n² − 1). */
function spearman(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  keys: readonly string[],
): number {
  const rankBy = (values: ReadonlyMap<string, number>) =>
    new Map(
      [...keys]
        .sort((x, y) => (values.get(y) as number) - (values.get(x) as number))
        .map((key, index) => [key, index + 1]),
    );
  const ra = rankBy(a);
  const rb = rankBy(b);
  const n = keys.length;
  const d2 = keys.reduce((sum, key) => sum + ((ra.get(key) as number) - (rb.get(key) as number)) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

describe.skipIf(CSV === undefined || CSV === '')('the M18.3 replay with the implemented fold (M18.5)', () => {
  it('reproduces log loss 0.700 and Spearman 0.938 (10+) / 0.925 (all) to three decimals', () => {
    const games = loadGames(CSV as string);
    const allTime = new Map<string, KustomState>();
    const losses: number[] = [];
    const current = new Map<string, { mu: number; n: number }>();

    for (const game of games) {
      const blue = game.players.filter((player) => player.side === 100);
      const red = game.players.filter((player) => player.side === 200);
      // The all-time track only: the report folded no week. The weekly map is fresh each game and
      // its answer is not read.
      const outcomes = foldGameKustom(blue, red, { allTime, week: new Map() }, game.winningSide);
      const blueRow = outcomes.get((blue[0] as FoldRatedPlayer).playerId);
      const pBlue = blueRow?.allTime?.expected as number;
      const y = game.winningSide === 100 ? 1 : 0;
      const p = Math.min(1 - 1e-9, Math.max(1e-9, pBlue));
      losses.push(-(y * Math.log(p) + (1 - y) * Math.log(1 - p)));
      for (const player of game.players) {
        const outcome = outcomes.get(player.playerId);
        if (outcome?.allTime == null) throw new Error('replay: no all-time outcome');
        allTime.set(player.playerId, { r: outcome.allTime.rAfter, n: outcome.allTime.n + 1 });
        current.set(player.playerId, { mu: player.muAfter, n: (current.get(player.playerId)?.n ?? 0) + 1 });
      }
    }

    const logLoss = losses.reduce((sum, value) => sum + value, 0) / losses.length;
    const keys = [...current.keys()];
    const board = new Map(keys.map((key) => [key, Math.round((current.get(key)?.mu as number) * 60)]));
    const kustom = new Map(keys.map((key) => [key, Math.round(allTime.get(key)?.r as number)]));
    const settled = keys.filter((key) => (current.get(key)?.n ?? 0) >= 10);
    const rhoSettled = spearman(board, kustom, settled);
    const rhoAll = spearman(board, kustom, keys);

    console.info(
      `replay: ${games.length} games, ${keys.length} players (${settled.length} with 10+); log loss ${logLoss.toFixed(
        3,
      )}; Spearman ${rhoSettled.toFixed(3)} (10+) / ${rhoAll.toFixed(3)} (all)`,
    );
    expect(games.length).toBe(109);
    expect(keys.length).toBe(34);
    expect(settled.length).toBe(21);
    expect(logLoss.toFixed(3)).toBe('0.700');
    expect(rhoSettled.toFixed(3)).toBe('0.938');
    expect(rhoAll.toFixed(3)).toBe('0.925');
  });
});
