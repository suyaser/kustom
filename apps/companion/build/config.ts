/**
 * Everything the release build pins, in one place (M2.6).
 *
 * - The Node release the exe carries. Node's single-executable blob must be produced by the same Node version
 *   as the binary it is injected into, so the build downloads this exact release for both sides (the host
 *   copy for the blob, the win-x64 `node.exe` for the target) and never relies on whatever `node` is on PATH.
 * - The API origin baked into the exe (`DEFAULT_API_BASE` in `src/config.ts`), overridable per build with
 *   `CUSTOMS_NIGHT_API_BASE`. `pnpm --filter companion dev` never sees it and stays on localhost.
 * - Where the release is published: GitHub releases on the public repo `suyaser/kustom-releases` (lead,
 *   2026-09-09; the Supabase bucket could not take a 90 MB object on the Free plan). The link in the group
 *   chat is `RELEASE_LATEST_URL`; each version is a tag `v<version>` with three assets.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPANION_DIR = fileURLToPath(new URL('..', import.meta.url));
export const REPO_ROOT = dirname(dirname(COMPANION_DIR));
export const DIST_DIR = join(COMPANION_DIR, 'dist');
export const CACHE_DIR = join(COMPANION_DIR, 'build', 'cache');

/** The bundle the exe wraps. CommonJS: Node's SEA loads only CommonJS main scripts. */
export const BUNDLE_FILE = join(DIST_DIR, 'kustom.cjs');

export const RIOT_ROOT_CA_FILE = join(REPO_ROOT, 'packages', 'lcu', 'certs', 'riotgames.pem');

/**
 * `apps/companion/README.md`: the friend-facing copy from the M2.6 brief, verbatim, above a horizontal rule;
 * our build notes below it. `friendReadme()` returns the part above the rule, which ships as `README.txt`.
 */
export const README_FILE = join(COMPANION_DIR, 'README.md');
export const README_RULE = '\n---\n';

export function friendReadme(): string {
  const text = readFileSync(README_FILE, 'utf8');
  const rule = text.indexOf(README_RULE);
  if (rule < 0) {
    throw new Error(`${README_FILE} has no horizontal rule separating the friend copy from the build notes`);
  }
  return text.slice(0, rule).trimEnd().concat('\n');
}

/** Node release carried by the exe. LTS "Krypton". Change it here and nowhere else. */
export const NODE_RELEASE = '24.20.0';

/**
 * SHA-256 of the artifacts we download from nodejs.org, from `SHASUMS256.txt` of that release. The build
 * fetches the live list too and refuses a mismatch; these are the belt for the artifacts we have already
 * used, so a changed upstream file is noticed even if the list changed with it.
 */
export const NODE_SHA256: Readonly<Record<string, string>> = {
  'win-x64/node.exe': '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5',
  'node-v24.20.0-darwin-arm64.tar.gz': '40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8',
};

export const NODE_DIST_BASE = `https://nodejs.org/dist/v${NODE_RELEASE}`;

/** The deployed API. `CUSTOMS_NIGHT_API_BASE` overrides it for a build against another deployment. */
export const RELEASE_API_BASE = 'https://playkustom.com';

export function apiBaseForBuild(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CUSTOMS_NIGHT_API_BASE?.trim();
  return override && override.length > 0 ? override : RELEASE_API_BASE;
}

/** The version stamped into the exe and the release tag: `apps/companion/package.json` `version`. */
export function companionVersion(): string {
  const pkg = JSON.parse(readFileSync(join(COMPANION_DIR, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+/.test(pkg.version)) {
    throw new Error('apps/companion/package.json has no semver "version"');
  }
  return pkg.version;
}

/** The one file a friend downloads, named as the README names it. */
export const EXE_NAME = 'Kustom.exe';
export const EXE_SHA256_NAME = `${EXE_NAME}.sha256`;
export const README_ASSET_NAME = 'README.txt';

export const RELEASE_REPO = 'suyaser/kustom-releases';
export const RELEASE_LATEST_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/${EXE_NAME}`;

export function releaseTag(version: string): string {
  return `v${version}`;
}

export function releaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/download/${releaseTag(version)}/${asset}`;
}
