/**
 * Step two of the release build: wrap `dist/kustom.cjs` in a Node single-executable application.
 *
 *   pnpm --filter overlay build:win     -> dist/KustomOverlay.exe (+ .sha256)   (Windows x64, from any host)
 *   pnpm --filter overlay build:host    -> dist/kustom-overlay-<version>-<platform>  (this machine; a check)
 *
 * How (docs: nodejs.org/api/single-executable-applications.html):
 *  1. Download the pinned Node release (`config.ts` `NODE_RELEASE`) twice if needed: a copy that runs on this
 *     host, to produce the blob, and the win-x64 `node.exe` the blob is injected into. The docs require the
 *     blob and the binary to be the same Node version, so neither is the `node` on PATH unless it matches.
 *     Downloads are verified against the release's SHASUMS256.txt and cached under `build/cache/`.
 *  2. `node --experimental-sea-config` writes the blob. `useCodeCache` and `useSnapshot` stay off: both are
 *     platform-specific and the docs say a cross-platform build must not use them.
 *  3. Copy the target binary, strip its Authenticode signature (the docs' `signtool remove /s`, done here by
 *     dropping the PE security directory so the result is simply unsigned rather than badly signed), and
 *     inject the blob with postject under the `NODE_SEA_BLOB` resource and the `NODE_SEA_FUSE_*` sentinel.
 *  4. On a macOS host build, ad-hoc `codesign` the result so it runs locally.
 *
 * The exe is not code-signed (out of scope: SmartScreen is a README sentence). Cross-building from macOS is
 * verified by this script's `--target host` mode plus a Windows run by a person; see the README's build
 * section.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { inject } from 'postject';
import { bundle } from './bundle.js';
import {
  BUNDLE_FILE,
  CACHE_DIR,
  DIST_DIR,
  EXE_NAME,
  EXE_SHA256_NAME,
  NODE_DIST_BASE,
  NODE_RELEASE,
  NODE_SHA256,
  overlayVersion,
} from './config.js';

export type SeaTarget = 'win-x64' | 'host';

export interface SeaOptions {
  readonly target?: SeaTarget;
  /** Reuse `dist/kustom.cjs` instead of bundling again. */
  readonly skipBundle?: boolean;
  readonly version?: string;
}

export interface SeaResult {
  readonly target: SeaTarget;
  readonly output: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly version: string;
  readonly nodeRelease: string;
}

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const SEA_RESOURCE = 'NODE_SEA_BLOB';
const SEA_MACHO_SEGMENT = 'NODE_SEA';

// --- downloads ----------------------------------------------------------------------------------------

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

let shasumsCache: Map<string, string> | undefined;

/** `SHASUMS256.txt` of the pinned release as `{ "win-x64/node.exe": "<hex>", ... }`. */
async function releaseShasums(): Promise<Map<string, string>> {
  if (shasumsCache) {
    return shasumsCache;
  }
  const cached = join(CACHE_DIR, `SHASUMS256-v${NODE_RELEASE}.txt`);
  let text: string;
  if (existsSync(cached)) {
    text = readFileSync(cached, 'utf8');
  } else {
    const response = await fetch(`${NODE_DIST_BASE}/SHASUMS256.txt`);
    if (!response.ok) {
      throw new Error(`could not fetch SHASUMS256.txt: HTTP ${response.status}`);
    }
    text = await response.text();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cached, text);
  }
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+(\S+)$/.exec(line.trim());
    if (match?.[1] && match[2]) {
      map.set(match[2], match[1]);
    }
  }
  shasumsCache = map;
  return map;
}

/** Downloads `<NODE_DIST_BASE>/<remote>` to the cache as `<local>`, verifying its SHA-256. Idempotent. */
async function downloadNodeArtifact(remote: string, local: string): Promise<string> {
  const path = join(CACHE_DIR, local);
  const shasums = await releaseShasums();
  const expected = shasums.get(remote);
  if (!expected) {
    throw new Error(`${remote} is not listed in SHASUMS256.txt for v${NODE_RELEASE}`);
  }
  const pinned = NODE_SHA256[remote];
  if (pinned && pinned !== expected) {
    throw new Error(`${remote}: SHASUMS256.txt (${expected}) disagrees with the pinned hash (${pinned})`);
  }
  if (existsSync(path) && sha256Of(path) === expected) {
    return path;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const url = `${NODE_DIST_BASE}/${remote}`;
  console.log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed: ${url} -> HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const partial = `${path}.part`;
  writeFileSync(partial, bytes);
  const actual = sha256Of(partial);
  if (actual !== expected) {
    throw new Error(`${remote}: SHA-256 ${actual} does not match ${expected}`);
  }
  renameSync(partial, path);
  return path;
}

/** The win-x64 `node.exe` of the pinned release. */
export async function windowsNode(): Promise<string> {
  return downloadNodeArtifact('win-x64/node.exe', `node-v${NODE_RELEASE}-win-x64.exe`);
}

/** A Node binary of the pinned release that runs on this machine, to produce the blob. */
export async function hostNode(): Promise<string> {
  if (process.version === `v${NODE_RELEASE}`) {
    return process.execPath;
  }
  if (process.platform === 'win32') {
    return windowsNode();
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const stem = `node-v${NODE_RELEASE}-${platform}-${arch}`;
  const binary = join(CACHE_DIR, stem, 'bin', 'node');
  if (existsSync(binary)) {
    return binary;
  }
  const archive = await downloadNodeArtifact(`${stem}.tar.gz`, `${stem}.tar.gz`);
  execFileSync('tar', ['-xzf', archive, '-C', CACHE_DIR, `${stem}/bin/node`], { stdio: 'inherit' });
  if (!existsSync(binary)) {
    throw new Error(`extracted ${archive} but ${binary} is missing`);
  }
  return binary;
}

// --- PE signature ------------------------------------------------------------------------------------

/**
 * Removes the Authenticode signature from a PE file in place, when the certificate table is the file's
 * trailing bytes (it is, for nodejs.org builds). Zeroes the security data directory and truncates. Returns
 * true when a signature was removed. Throws on anything that does not look like a PE32+ file.
 */
export function stripPeSignature(path: string): boolean {
  const fd = openSync(path, 'r+');
  try {
    const head = Buffer.alloc(4096);
    readSync(fd, head, 0, head.length, 0);
    if (head.toString('latin1', 0, 2) !== 'MZ') {
      throw new Error('not a PE file (no MZ header)');
    }
    const peOffset = head.readUInt32LE(0x3c);
    if (head.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') {
      throw new Error('not a PE file (no PE signature)');
    }
    const optionalHeader = peOffset + 24;
    const magic = head.readUInt16LE(optionalHeader);
    const directoriesOffset = magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1;
    if (directoriesOffset < 0) {
      throw new Error(`unknown optional header magic 0x${magic.toString(16)}`);
    }
    // IMAGE_DIRECTORY_ENTRY_SECURITY is directory 4: { fileOffset: u32, size: u32 }.
    const securityEntry = optionalHeader + directoriesOffset + 4 * 8;
    const certOffset = head.readUInt32LE(securityEntry);
    const certSize = head.readUInt32LE(securityEntry + 4);
    if (certSize === 0) {
      return false;
    }
    const fileSize = statSync(path).size;
    if (certOffset + certSize !== fileSize) {
      throw new Error('certificate table is not at the end of the file; refusing to strip it');
    }
    writeSync(fd, Buffer.alloc(8), 0, 8, securityEntry);
    ftruncateSync(fd, certOffset);
    return true;
  } finally {
    closeSync(fd);
  }
}

// --- the build ----------------------------------------------------------------------------------------

export async function buildSea(options: SeaOptions = {}): Promise<SeaResult> {
  const target = options.target ?? 'win-x64';
  const version = options.version ?? overlayVersion();
  mkdirSync(DIST_DIR, { recursive: true });

  if (!options.skipBundle || !existsSync(BUNDLE_FILE)) {
    const result = await bundle({ version });
    console.log(`bundled ${result.outfile} (${(result.bytes / 1024).toFixed(0)} KiB, api ${result.apiBase})`);
  }

  const blobFile = join(DIST_DIR, 'overlay.blob');
  const seaConfig = join(DIST_DIR, 'sea-config.json');
  writeFileSync(
    seaConfig,
    `${JSON.stringify(
      {
        main: BUNDLE_FILE,
        output: blobFile,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    )}\n`,
  );

  const host = await hostNode();
  const generated = spawnSync(host, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
  if (generated.status !== 0) {
    throw new Error(`blob generation failed (exit ${generated.status ?? 'signal'})`);
  }
  const blob = readFileSync(blobFile);

  let source: string;
  let output: string;
  if (target === 'win-x64') {
    source = await windowsNode();
    output = join(DIST_DIR, EXE_NAME);
  } else {
    source = host;
    output = join(DIST_DIR, `kustom-overlay-${version}-${process.platform}-${process.arch}`);
  }
  copyFileSync(source, output);
  if (target === 'win-x64') {
    const stripped = stripPeSignature(output);
    console.log(stripped ? 'stripped the Authenticode signature from node.exe' : 'node.exe was not signed');
  }
  await inject(output, SEA_RESOURCE, blob, { sentinelFuse: SEA_FUSE, machoSegmentName: SEA_MACHO_SEGMENT });
  if (target === 'host' && process.platform === 'darwin') {
    execFileSync('codesign', ['--sign', '-', '--force', output], { stdio: 'inherit' });
  }

  // `bundle()` already wrote `dist/ui/` beside the exe for the local HTTP server.

  const bytes = statSync(output).size;
  const sha256 = sha256Of(output);
  const fileName = output.split(/[\\/]/).pop() ?? EXE_NAME;
  writeFileSync(
    join(DIST_DIR, target === 'win-x64' ? EXE_SHA256_NAME : `${fileName}.sha256`),
    `${sha256}  ${fileName}\n`,
  );
  return { target, output, bytes, sha256, version, nodeRelease: NODE_RELEASE };
}

function isMain(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && /sea\.(ts|js|cjs|mjs)$/.test(entry);
}

if (isMain()) {
  const { values } = parseArgs({
    options: {
      target: { type: 'string', default: 'win-x64' },
      'skip-bundle': { type: 'boolean', default: false },
    },
  });
  const target = values.target;
  if (target !== 'win-x64' && target !== 'host') {
    console.error(`--target must be win-x64 or host, got ${target}`);
    process.exit(2);
  }
  buildSea({ target, skipBundle: values['skip-bundle'] }).then(
    (result) => {
      const mib = (result.bytes / (1024 * 1024)).toFixed(1);
      console.log(
        `built ${result.output} (${mib} MiB, Node ${result.nodeRelease}, version ${result.version})`,
      );
      console.log(`sha256 ${result.sha256}`);
      if (result.bytes > 120 * 1024 * 1024) {
        console.error('over the 120 MB budget (docs/02-milestones.md M2.6 acceptance 6)');
        process.exit(1);
      }
    },
    (error) => {
      console.error('build failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
