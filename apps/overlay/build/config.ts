/**
 * Overlay release pins (M12). Mirrors apps/companion/build/config.ts for the Node SEA.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OVERLAY_DIR = fileURLToPath(new URL('..', import.meta.url));
export const REPO_ROOT = dirname(dirname(OVERLAY_DIR));
export const DIST_DIR = join(OVERLAY_DIR, 'dist');
export const CACHE_DIR = join(OVERLAY_DIR, 'build', 'cache');
export const BUNDLE_FILE = join(DIST_DIR, 'overlay.cjs');
export const UI_SRC_DIR = join(OVERLAY_DIR, 'src', 'ui');
export const UI_DIST_DIR = join(DIST_DIR, 'ui');
export const RIOT_ROOT_CA_FILE = join(REPO_ROOT, 'packages', 'lcu', 'certs', 'riotgames.pem');

export const NODE_RELEASE = '24.20.0';
export const NODE_SHA256: Readonly<Record<string, string>> = {
  'win-x64/node.exe': '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5',
  'node-v24.20.0-darwin-arm64.tar.gz': '40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8',
};
export const NODE_DIST_BASE = `https://nodejs.org/dist/v${NODE_RELEASE}`;

export const RELEASE_API_BASE = 'https://kustom-delta.vercel.app';

export function apiBaseForBuild(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CUSTOMS_NIGHT_API_BASE?.trim();
  return override && override.length > 0 ? override : RELEASE_API_BASE;
}

export function overlayVersion(): string {
  const pkg = JSON.parse(readFileSync(join(OVERLAY_DIR, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+/.test(pkg.version)) {
    throw new Error('apps/overlay/package.json has no semver "version"');
  }
  return pkg.version;
}

export const EXE_NAME = 'KustomOverlay.exe';
export const EXE_SHA256_NAME = `${EXE_NAME}.sha256`;
export const README_ASSET_NAME = 'OVERLAY-README.txt';
export const RELEASE_REPO = 'suyaser/kustom-releases';

export function releaseTag(version: string): string {
  return `v${version}`;
}
