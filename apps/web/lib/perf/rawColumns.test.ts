import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BARE_RAW } from '../testing/recordingClient';
import { lineOf, sourceFiles, walkNodes } from './sourceScan';

/**
 * `games.raw` is the whole end-of-game blob, 60 to 70 KB a game (app-perf, 2026-10-04: one `/you`
 * render read 8 MB of it for one field). A loader reads the fields it needs as JSON paths
 * (`mode:raw->>gameMode`), never the blob, except where it reads **one game** or is a writer.
 * Each exception is listed with how many bare-`raw` selects the file may hold, so a new one in an
 * allowed file fails too.
 */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'lib/games/detail.ts': { count: 1, why: 'One game: the scoreboard reads the client facts in the blob.' },
  'lib/mode/clientNames.ts': { count: 1, why: 'One game, only when a champion id has no name.' },
  'lib/fearless/load.ts': { count: 1, why: 'Only the games that locked an unnamed champion id.' },
  'lib/mystery/ensure.ts': { count: 1, why: "Writer: builds the day's challenge once." },
  'lib/mystery/service.ts': { count: 1, why: 'One game: the challenge being played.' },
  'lib/ai/facts.ts': { count: 1, why: 'Writer side: facts for one AI line.' },
  'lib/ingest/game.ts': { count: 1, why: 'Ingest: the one game being written.' },
  'lib/ingest/rating.ts': { count: 1, why: 'Ingest: the one game being rated.' },
  'lib/ingest/backfill.ts': { count: 1, why: 'Ingest: the backfill batch being compared.' },
  'lib/ingest/copyRawStats.ts': { count: 1, why: 'One-off repair script (M7.7).' },
  // stats-perf is removing this one (`loadWindowGames` with the game mode, 8 MB on `/you`). Delete
  // the entry when it merges.
  'lib/stats/load.ts': { count: 1, why: 'Pending stats-perf.' },
};

function bareRawSelects(): { file: string; line: number; select: string }[] {
  const found: { file: string; line: number; select: string }[] = [];
  for (const file of sourceFiles(['lib', 'app', 'components'])) {
    if (!file.text.includes('raw')) continue;
    for (const node of walkNodes(file.ast)) {
      if (!ts.isCallExpression(node)) continue;
      const callee = node.expression;
      if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'select') continue;
      const first = node.arguments[0];
      if (first === undefined) continue;
      if (
        !ts.isStringLiteral(first) &&
        !ts.isNoSubstitutionTemplateLiteral(first) &&
        !ts.isTemplateExpression(first)
      )
        continue;
      const select = first.getText(file.ast).slice(1, -1);
      if (BARE_RAW.test(select)) found.push({ file: file.path, line: lineOf(file, node), select });
    }
  }
  return found;
}

describe('no loader reads games.raw whole', () => {
  const found = bareRawSelects();

  it('only the listed one-game readers and writers select the blob', () => {
    const counts = new Map<string, number>();
    for (const hit of found) counts.set(hit.file, (counts.get(hit.file) ?? 0) + 1);
    const offenders = [...counts]
      .filter(([file, count]) => count > (ALLOWED[file]?.count ?? 0))
      .flatMap(([file]) =>
        found.filter((hit) => hit.file === file).map((hit) => `${hit.file}:${hit.line} '${hit.select}'`),
      );
    expect(offenders).toEqual([]);
  });

  it('sees the selects it polices', () => {
    expect(found.some((hit) => hit.file === 'lib/games/detail.ts')).toBe(true);
  });

  it('tells a JSON path from the blob', () => {
    expect(BARE_RAW.test('id, raw')).toBe(true);
    expect(BARE_RAW.test('raw')).toBe(true);
    expect(BARE_RAW.test('id, raw, rated')).toBe(true);
    expect(BARE_RAW.test('id, mode:raw->>gameMode')).toBe(false);
    expect(BARE_RAW.test('gameMode:raw->gameMode, lobbies(lcu_party_id)')).toBe(false);
    expect(BARE_RAW.test('id, raw_facts')).toBe(false);
  });
});
