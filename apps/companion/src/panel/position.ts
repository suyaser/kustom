/**
 * Overlay window position on disk (`overlay-position.json`). Shared by Host and Overlay modes.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const POSITION_FILE_NAME = 'overlay-position.json';

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional(),
});

export type OverlayPosition = z.infer<typeof positionSchema>;

export function positionPath(dir: string): string {
  return join(dir, POSITION_FILE_NAME);
}

export function loadPosition(dir: string): OverlayPosition | null {
  try {
    const raw = JSON.parse(readFileSync(positionPath(dir), 'utf8')) as unknown;
    const parsed = positionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function savePosition(dir: string, position: OverlayPosition): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(positionPath(dir), `${JSON.stringify(positionSchema.parse(position), null, 2)}\n`, {
    mode: 0o600,
  });
}
