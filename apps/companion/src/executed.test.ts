/**
 * The execute-once record (M4.1): written before the ack, read before every execution, capped and aged.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXECUTED_FILE, type ExecutedEntry, ExecutedStore, executedFilePath } from './executed.js';
import { createMemoryLogger } from './log.js';

const dirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'companion-executed-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const at = (offsetMs: number, base = Date.parse('2026-09-09T20:00:00.000Z')): string =>
  new Date(base + offsetMs).toISOString();

function entry(id: string, offsetMs = 0, outcome: ExecutedEntry['outcome'] = 'done'): ExecutedEntry {
  return outcome === 'done'
    ? {
        id,
        kind: 'switch_side',
        at: at(offsetMs),
        outcome,
        result: { side: 200 },
      }
    : { id, kind: 'switch_side', at: at(offsetMs), outcome, error: 'side_full: side 200 holds 5' };
}

describe('ExecutedStore', () => {
  it('starts empty, records with tmp-and-rename, and reads back across instances', () => {
    const dir = freshDir();
    const store = new ExecutedStore({ configDir: dir });
    expect(store.has('a')).toBe(false);
    expect(store.record(entry('a'))).toBe(true);
    expect(readdirSync(dir)).toEqual([EXECUTED_FILE]);
    const text = readFileSync(executedFilePath(dir), 'utf8');
    expect(JSON.parse(text)).toEqual({ version: 1, entries: [entry('a')] });

    const again = new ExecutedStore({ configDir: dir });
    expect(again.get('a')).toEqual(entry('a'));
    expect(again.has('missing')).toBe(false);
  });

  it('replaces an entry with the same id, keeps the newest 200 and drops entries older than 24 h', () => {
    const dir = freshDir();
    const base = Date.parse('2026-09-09T20:00:00.000Z');
    const clock = { now: base };
    const store = new ExecutedStore({ configDir: dir, now: () => clock.now });
    store.record(entry('old', -25 * 60 * 60 * 1000));
    store.record(entry('recent', -60 * 1000));
    store.record(entry('recent', -30 * 1000, 'failed'));
    expect(store.list().map((item) => item.id)).toEqual(['recent']);
    expect(store.get('recent')?.outcome).toBe('failed');

    for (let index = 0; index < 250; index += 1) {
      store.record(entry(`n${index}`, index));
    }
    expect(store.list()).toHaveLength(200);
    expect(store.get('n49')).toBeNull();
    expect(store.get('n50')).not.toBeNull();
    expect(store.get('n249')).not.toBeNull();
  });

  it('starts over on a file that does not parse, with one warning', () => {
    const dir = freshDir();
    writeFileSync(executedFilePath(dir), '{ not json');
    const logger = createMemoryLogger();
    const store = new ExecutedStore({ configDir: dir, logger });
    expect(store.has('a')).toBe(false);
    expect(logger.lines.filter((line) => line.level === 'warn')).toHaveLength(1);
    expect(store.record(entry('a'))).toBe(true);
    expect(JSON.parse(readFileSync(executedFilePath(dir), 'utf8')).entries).toHaveLength(1);

    writeFileSync(executedFilePath(dir), JSON.stringify({ version: 99, entries: [] }));
    const wrongVersion = new ExecutedStore({ configDir: dir, logger });
    expect(wrongVersion.list()).toEqual([]);
  });

  it('reports a failed write and leaves no tmp file behind', () => {
    const dir = freshDir();
    const logger = createMemoryLogger();
    // A directory where the file name is taken by a directory: the rename cannot succeed.
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, '');
    const store = new ExecutedStore({ configDir: join(blocked, 'inner'), logger });
    expect(store.record(entry('a'))).toBe(false);
    expect(logger.lines.some((line) => line.level === 'error')).toBe(true);
    expect(existsSync(`${store.path}.tmp`)).toBe(false);
  });
});
