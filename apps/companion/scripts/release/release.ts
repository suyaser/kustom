/**
 * The pure half of the Kustom release workflow (M17.12, `.github/workflows/companion-release.yml`): the tag
 * check, the size gate, `latest.json`, the asset list and the publish guard. No I/O here; `cli.ts` reads the
 * files and the environment and calls these, so every rule the workflow enforces is unit-tested on this Mac.
 *
 * Windows only (decision row 2026-10-04): one platform, one installer.
 */

/** The public repo the releases go to (lead, 2026-09-09). Also `RELEASE_REPO` in `apps/web/lib/release.ts`. */
export const RELEASE_REPO = 'suyaser/kustom-releases';

/** The tag the user pushes in this repo: `companion-v1.0.0`. */
export const TAG_PREFIX = 'companion-v';

/** The installer's stable name on every Rust release (decision row 2026-10-04). */
export const INSTALLER_ASSET = 'Kustom-setup.exe';

/**
 * The installer again under the 0.3.x name, until M17.14, so the link pasted in every group chat keeps
 * downloading something that works (M17 "Assets and the web").
 */
export const LEGACY_ASSET = 'Kustom.exe';

export const LATEST_JSON_ASSET = 'latest.json';
export const README_ASSET = 'README.txt';

/**
 * The size gate (M17 "Size, measurable"; decision row 2026-10-04): installer 15 MB or less, installed exe
 * 20 MB or less. **Decimal megabytes** (1 MB = 1,000,000 bytes): the stricter reading, so a build that passes
 * here also passes if anyone reads "MB" as MiB, as Windows Explorer does.
 */
export const MB = 1_000_000;
export const INSTALLER_LIMIT_BYTES = 15 * MB;
export const INSTALLED_EXE_LIMIT_BYTES = 20 * MB;

/**
 * What `tauri.conf.json` carries until the user pastes the public key from `pnpm tauri signer generate`
 * (docs/runbooks/companion-release.md, step 3). A tag refuses to publish while it is still there.
 */
export const PUBKEY_PLACEHOLDER = 'REPLACE_WITH_THE_PUBLIC_KEY_FROM_TAURI_SIGNER_GENERATE';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

/** `companion-v1.0.0` -> `1.0.0`; anything else is an error naming what was expected. */
export function versionFromTag(tag: string): string {
  const name = tag.startsWith('refs/tags/') ? tag.slice('refs/tags/'.length) : tag;
  if (!name.startsWith(TAG_PREFIX)) {
    throw new Error(`tag ${JSON.stringify(name)} does not start with ${TAG_PREFIX}`);
  }
  const version = name.slice(TAG_PREFIX.length);
  if (!SEMVER.test(version)) {
    throw new Error(`tag ${JSON.stringify(name)} does not end in a semver version (want ${TAG_PREFIX}1.0.0)`);
  }
  return version;
}

/**
 * The tag, `tauri.conf.json`'s `version` and the app crate's `version` must agree: the updater compares the
 * installed app's version (the config's) with `latest.json`'s, so a mismatch would offer an update forever
 * or never.
 */
export function checkVersions(input: {
  tagVersion: string;
  tauriVersion: string;
  crateVersion: string;
}): string[] {
  const problems: string[] = [];
  if (input.tauriVersion !== input.tagVersion) {
    problems.push(
      `apps/companion/src-tauri/tauri.conf.json has version ${input.tauriVersion}, the tag says ${input.tagVersion}`,
    );
  }
  if (input.crateVersion !== input.tagVersion) {
    problems.push(
      `apps/companion/src-tauri/Cargo.toml has version ${input.crateVersion}, the tag says ${input.tagVersion}`,
    );
  }
  return problems;
}

/** The release on `kustom-releases` keeps the 0.x convention: tag `v<version>`. */
export function releaseTag(version: string): string {
  return `v${version}`;
}

/** A versioned download URL: never `latest`, so a newer publish cannot swap the file under a signature. */
export function assetUrl(version: string, asset: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/download/${releaseTag(version)}/${asset}`;
}

export interface SizeGateResult {
  readonly ok: boolean;
  /** Printed to the workflow log, pass or fail: the acceptance reads the two numbers there. */
  readonly lines: readonly string[];
}

function describeSize(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} bytes (${(bytes / MB).toFixed(2)} MB, ${(bytes / 1024 / 1024).toFixed(2)} MiB)`;
}

export function sizeGate(input: { installerBytes: number; installedExeBytes: number }): SizeGateResult {
  const rows = [
    { label: `Installer (${INSTALLER_ASSET})`, bytes: input.installerBytes, limit: INSTALLER_LIMIT_BYTES },
    { label: 'Installed Kustom exe', bytes: input.installedExeBytes, limit: INSTALLED_EXE_LIMIT_BYTES },
  ];
  const lines: string[] = [];
  let ok = true;
  for (const row of rows) {
    const pass = Number.isFinite(row.bytes) && row.bytes > 0 && row.bytes <= row.limit;
    ok &&= pass;
    lines.push(
      `${pass ? 'PASS' : 'FAIL'} ${row.label}: ${describeSize(row.bytes)}; limit ${row.limit / MB} MB (${row.limit.toLocaleString('en-US')} bytes)`,
    );
  }
  return { ok, lines };
}

export interface LatestJson {
  readonly version: string;
  readonly notes: string;
  readonly pub_date: string;
  readonly platforms: Readonly<Record<string, { readonly signature: string; readonly url: string }>>;
}

/**
 * The updater's static manifest (Tauri 2 updater plugin, "Static JSON File"). Both Windows keys point at the
 * same NSIS installer: the plugin looks for `windows-x86_64-nsis` first, then `windows-x86_64`. The signature
 * is the `.sig` file's content (a path or URL does not work), and it covers the installer's bytes, so the
 * asset can be renamed to `Kustom-setup.exe` without re-signing.
 */
export function latestJson(input: {
  version: string;
  signature: string;
  pubDate: Date;
  notes: string;
}): LatestJson {
  if (!SEMVER.test(input.version)) {
    throw new Error(`latest.json needs a semver version, got ${JSON.stringify(input.version)}`);
  }
  const signature = input.signature.trim();
  if (signature.length === 0) {
    throw new Error('latest.json needs the installer signature: the .sig file is empty');
  }
  const entry = { signature, url: assetUrl(input.version, INSTALLER_ASSET) };
  return {
    version: input.version,
    notes: input.notes,
    pub_date: input.pubDate.toISOString(),
    platforms: { 'windows-x86_64-nsis': entry, 'windows-x86_64': entry },
  };
}

/**
 * Reasons a tag must not publish yet, empty when it may. The build, the size gate and `latest.json` still
 * run (and upload as workflow artifacts), so the pipeline is exercised before the app is real.
 *
 * - The public key is still the placeholder: every installed app would reject every update.
 * - The app is still the M6 tray shell that spawns the TypeScript engine as a sidecar (`kustom-engine.exe`):
 *   M17.8 replaces it with the in-process Rust engine, and that change removes this reason by itself.
 */
export function publishBlockers(input: { pubkey: string | undefined; shellSource: string }): string[] {
  const blockers: string[] = [];
  const pubkey = input.pubkey?.trim() ?? '';
  if (pubkey.length === 0 || pubkey === PUBKEY_PLACEHOLDER) {
    blockers.push(
      'plugins.updater.pubkey in apps/companion/src-tauri/tauri.conf.json is still the placeholder: paste the public key from `pnpm tauri signer generate` (runbook step 3)',
    );
  }
  if (input.shellSource.includes('kustom-engine')) {
    blockers.push(
      'apps/companion/src-tauri/src is still the M6 sidecar shell (it names kustom-engine): the Rust app replaces it in M17.8',
    );
  }
  return blockers;
}

/** What goes on the release, in upload order: the installer twice, its signature, checksums, manifest, README. */
export function releaseAssets(): readonly string[] {
  return [
    INSTALLER_ASSET,
    `${INSTALLER_ASSET}.sig`,
    `${INSTALLER_ASSET}.sha256`,
    LEGACY_ASSET,
    `${LEGACY_ASSET}.sha256`,
    LATEST_JSON_ASSET,
    README_ASSET,
  ];
}

/** `apps/companion/README.md` above its first horizontal rule: the friend-facing part, shipped as README.txt. */
export function friendReadme(readme: string): string {
  const rule = readme.indexOf('\n---\n');
  if (rule < 0) {
    throw new Error(
      'apps/companion/README.md has no horizontal rule separating the friend copy from the build notes',
    );
  }
  return `${readme.slice(0, rule).trimEnd()}\n`;
}

/** `<sha256>  <file>`, the `sha256sum` line format the 0.x releases used. */
export function checksumLine(hexDigest: string, asset: string): string {
  if (!/^[0-9a-f]{64}$/.test(hexDigest)) {
    throw new Error(`not a sha256 hex digest: ${JSON.stringify(hexDigest)}`);
  }
  return `${hexDigest}  ${asset}\n`;
}
