/**
 * Live status the Tauri tray / setup UI polls (`status.json` beside config).
 * Never includes the companion token.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const STATUS_FILE_NAME = 'status.json';

export const engineStatusSchema = z.object({
  mode: z.enum(['host', 'overlay']),
  state: z.enum(['starting', 'disconnected', 'waiting', 'watching', 'in_game', 'error']),
  phase: z.string().nullable(),
  playerName: z.string().nullable(),
  overlayUrl: z.string().nullable(),
  overlayVisible: z.boolean(),
  error: z.string().nullable(),
  updatedAt: z.string(),
});

export type EngineStatus = z.infer<typeof engineStatusSchema>;

export function statusPath(dir: string): string {
  return join(dir, STATUS_FILE_NAME);
}

export function writeStatus(dir: string, status: Omit<EngineStatus, 'updatedAt'>): void {
  const body: EngineStatus = engineStatusSchema.parse({
    ...status,
    updatedAt: new Date().toISOString(),
  });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(statusPath(dir), `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
}
