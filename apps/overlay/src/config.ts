/**
 * Overlay config: `%APPDATA%/customs-night/overlay.json` with the API base URL only (M12).
 * No companion token — this app cannot open lobbies or invite.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

export const CONFIG_DIR_ENV = 'CUSTOMS_NIGHT_CONFIG_DIR';
export const CONFIG_DIR_NAME = 'customs-night';
export const OVERLAY_FILE_NAME = 'overlay.json';
export const POSITION_FILE_NAME = 'overlay-position.json';

declare const __CUSTOMS_NIGHT_API_BASE__: string | undefined;

export const LOCAL_API_BASE = 'http://localhost:3000';

export const DEFAULT_API_BASE: string =
  typeof __CUSTOMS_NIGHT_API_BASE__ === 'string' && __CUSTOMS_NIGHT_API_BASE__.length > 0
    ? __CUSTOMS_NIGHT_API_BASE__
    : LOCAL_API_BASE;

export const apiBaseSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.replace(/\/+$/, ''))
  .refine((value) => /^https?:\/\/[^/\s]+$/.test(value), {
    message: 'apiBase must be an origin like https://customs.example (no path)',
  });

export const overlayConfigSchema = z.object({
  apiBase: apiBaseSchema,
  lockfilePath: z.string().trim().min(1).optional(),
});

export type OverlayConfig = z.infer<typeof overlayConfigSchema>;

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional(),
});

export type OverlayPosition = z.infer<typeof positionSchema>;

export interface ConfigEnv {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: string;
}

export function configDir(options: ConfigEnv = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const override = env[CONFIG_DIR_ENV];
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  switch (platform) {
    case 'win32':
      return join(
        env.APPDATA && env.APPDATA.length > 0 ? env.APPDATA : join(home, 'AppData', 'Roaming'),
        CONFIG_DIR_NAME,
      );
    case 'darwin':
      return join(home, 'Library', 'Application Support', CONFIG_DIR_NAME);
    default: {
      const xdg = env.XDG_CONFIG_HOME;
      return join(xdg && xdg.length > 0 ? xdg : join(home, '.config'), CONFIG_DIR_NAME);
    }
  }
}

export function overlayConfigPath(dir: string): string {
  return join(dir, OVERLAY_FILE_NAME);
}

export function positionPath(dir: string): string {
  return join(dir, POSITION_FILE_NAME);
}

export function loadOverlayConfig(dir: string): OverlayConfig {
  const path = overlayConfigPath(dir);
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const parsed = overlayConfigSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch {
    // first run: write defaults
  }
  const config: OverlayConfig = { apiBase: DEFAULT_API_BASE };
  saveOverlayConfig(dir, config);
  return config;
}

export function saveOverlayConfig(dir: string, config: OverlayConfig): string {
  const path = overlayConfigPath(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(overlayConfigSchema.parse(config), null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows
  }
  return path;
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
