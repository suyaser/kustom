/**
 * The durable queue on its own: files in a temp directory, no API, no client.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompanionGameEogPayloadInput } from '@customs/db/schemas';
import { type EogStatsBlock, EogStatsBlockSchema, mapEog, readFixture } from '@customs/lcu';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryLogger } from './log.js';
import { GameQueue, MAX_QUEUED_GAMES, queueDir, queueEntrySchema, queueFileStem } from './queue.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'companion-queue-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function block(): EogStatsBlock {
  const read = readFixture('16.17', 'eog-stats-block');
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return EogStatsBlockSchema.parse(read.envelope.body);
}

function payloadFor(gameId: number): CompanionGameEogPayloadInput {
  return mapEog({ ...block(), gameId }, { partyId: 'party-1' });
}

describe('queueFileStem', () => {
  it('accepts digits only', () => {
    expect(queueFileStem(4000969091)).toBe('4000969091');
    expect(queueFileStem('4000969091')).toBe('4000969091');
    expect(queueFileStem('../etc')).toBeNull();
    expect(queueFileStem('12a')).toBeNull();
    expect(queueFileStem(0)).toBeNull();
    expect(queueFileStem(-5)).toBeNull();
  });
});

describe('GameQueue', () => {
  it('writes <configDir>/queue/<gameId>.json with the exact payload, owner-only, and reads it back oldest first', () => {
    const dir = tempDir();
    const logger = createMemoryLogger();
    const queue = new GameQueue({ configDir: dir, logger });
    expect(queue.list()).toEqual([]);

    const second = queue.write(payloadFor(4000969092), '2026-09-08T17:00:00.000Z');
    const first = queue.write(payloadFor(4000969091), '2026-09-08T16:53:04.508Z');
    expect(first?.path).toBe(join(queueDir(dir), '4000969091.json'));
    expect(second?.path).toBe(join(queueDir(dir), '4000969092.json'));

    const onDisk = JSON.parse(readFileSync(first?.path ?? '', 'utf8')) as {
      version: number;
      queuedAt: string;
      payload: unknown;
    };
    expect(onDisk.version).toBe(1);
    expect(onDisk.queuedAt).toBe('2026-09-08T16:53:04.508Z');
    expect(onDisk.payload).toEqual(payloadFor(4000969091));
    expect(queueEntrySchema.safeParse(onDisk).success).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(first?.path ?? '').mode & 0o777).toBe(0o600);
      expect(statSync(queueDir(dir)).mode & 0o777).toBe(0o700);
    }
    expect(readdirSync(queueDir(dir)).some((name) => name.endsWith('.tmp'))).toBe(false);

    expect(queue.list().map((entry) => entry.gameId)).toEqual(['4000969091', '4000969092']);
    expect(queue.has(4000969091)).toBe(true);
    expect(queue.has('4000969093')).toBe(false);

    queue.delete('4000969091');
    queue.delete('4000969091');
    expect(queue.has(4000969091)).toBe(false);
    expect(queue.list().map((entry) => entry.gameId)).toEqual(['4000969092']);
  });

  it('refuses a payload that fails the wire schema and never writes a file for it', () => {
    const dir = tempDir();
    const logger = createMemoryLogger();
    const queue = new GameQueue({ configDir: dir, logger });
    const broken = { ...payloadFor(4000969091), participants: [] };
    expect(queue.write(broken, '2026-09-08T16:53:04.508Z')).toBeNull();
    expect(existsSync(queueDir(dir))).toBe(false);
    expect(logger.lines.some((line) => line.message.includes('does not pass the wire schema'))).toBe(true);
  });

  it('logs once and deletes a file that no longer parses, and removes a stray .tmp', () => {
    const dir = tempDir();
    const logger = createMemoryLogger();
    const queue = new GameQueue({ configDir: dir, logger });
    mkdirSync(queueDir(dir), { recursive: true });
    writeFileSync(join(queueDir(dir), '1.json'), 'not json');
    writeFileSync(join(queueDir(dir), '2.json'), JSON.stringify({ version: 1, queuedAt: 'x', payload: {} }));
    writeFileSync(join(queueDir(dir), '3.json.tmp'), '{');
    writeFileSync(join(queueDir(dir), 'notes.txt'), 'ignored');
    queue.write(payloadFor(4000969091), '2026-09-08T16:53:04.508Z');

    expect(queue.list().map((entry) => entry.gameId)).toEqual(['4000969091']);
    expect(readdirSync(queueDir(dir)).sort()).toEqual(['4000969091.json', 'notes.txt']);
    const warnings = logger.lines.filter((line) => line.message.includes('deleting it'));
    expect(warnings).toHaveLength(2);
    expect(warnings.map((line) => line.fields.gameId).sort()).toEqual(['1', '2']);
  });

  it('caps the directory at 50 files, deleting the oldest with a log line (check 12, the disk half)', () => {
    const dir = tempDir();
    const logger = createMemoryLogger();
    const queue = new GameQueue({ configDir: dir, logger });
    for (let i = 0; i < MAX_QUEUED_GAMES + 1; i += 1) {
      const minute = String(i).padStart(2, '0');
      queue.write(payloadFor(4000970000 + i), `2026-09-08T16:${minute}:00.000Z`);
    }
    const listed = queue.list();
    expect(listed).toHaveLength(MAX_QUEUED_GAMES);
    expect(listed[0]?.gameId).toBe('4000970001');
    expect(existsSync(join(queueDir(dir), '4000970000.json'))).toBe(false);
    const dropped = logger.lines.filter((line) => line.message.includes('over its cap'));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.fields.gameId).toBe('4000970000');
  });
});

describe('per-group state directories (M13.8)', () => {
  it("a block queued in one group's directory is invisible to another group's queue", () => {
    const root = tempDir();
    const groupA = join(root, 'groups', 'group-a');
    const groupB = join(root, 'groups', 'group-b');
    const a = new GameQueue({ configDir: groupA, logger: createMemoryLogger() });
    const b = new GameQueue({ configDir: groupB, logger: createMemoryLogger() });
    a.write(payloadFor(4000969091), new Date().toISOString());
    expect(a.list().map((entry) => entry.gameId)).toEqual(['4000969091']);
    expect(b.list()).toEqual([]);
    expect(b.has(4000969091)).toBe(false);
  });
});
