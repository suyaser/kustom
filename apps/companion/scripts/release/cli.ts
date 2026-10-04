/**
 * The file-reading half of the Kustom release workflow (M17.12). Every rule is in `release.ts`; this reads
 * files and the environment, calls it, prints, and exits non-zero on a broken rule. Run from
 * `apps/companion` by `.github/workflows/companion-release.yml`:
 *
 *   tsx scripts/release/cli.ts check-tag <ref>                         tag vs tauri.conf.json vs Cargo.toml
 *   tsx scripts/release/cli.ts size-gate <installer> <installed-exe>   the 15 MB / 20 MB gate, both printed
 *   tsx scripts/release/cli.ts assemble <version> <installer> <outdir> every release asset into one folder
 *   tsx scripts/release/cli.ts publish-blockers                        exit 1 while a tag must not publish
 *   tsx scripts/release/cli.ts pubkey-state                            prints `placeholder` or `set`
 *   tsx scripts/release/cli.ts dry-run-config <key.pub> <out.json>     a --config overlay with a throwaway pubkey
 *
 * Writes `version=<v>` to `$GITHUB_OUTPUT` for `check-tag` when the variable is set.
 */

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checksumLine,
  checkVersions,
  friendReadme,
  INSTALLER_ASSET,
  LATEST_JSON_ASSET,
  LEGACY_ASSET,
  latestJson,
  PUBKEY_PLACEHOLDER,
  publishBlockers,
  README_ASSET,
  releaseAssets,
  sizeGate,
  versionFromTag,
} from './release.js';

const COMPANION_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAURI_CONF = join(COMPANION_DIR, 'src-tauri', 'tauri.conf.json');
const APP_CRATE = join(COMPANION_DIR, 'src-tauri', 'Cargo.toml');
const APP_SRC = join(COMPANION_DIR, 'src-tauri', 'src');
const README = join(COMPANION_DIR, 'README.md');

interface TauriConf {
  version?: unknown;
  plugins?: { updater?: { pubkey?: unknown } };
}

function tauriConf(): TauriConf {
  return JSON.parse(readFileSync(TAURI_CONF, 'utf8')) as TauriConf;
}

/** The `[package]` table's `version` line; the app crate does not inherit it from the workspace. */
function crateVersion(): string {
  const toml = readFileSync(APP_CRATE, 'utf8');
  const pkg = toml.split(/^\[/m).find((table) => table.startsWith('package]'));
  const match = pkg?.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match?.[1]) throw new Error(`${APP_CRATE} has no [package] version`);
  return match[1];
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fail(lines: readonly string[]): never {
  for (const line of lines) console.error(`::error::${line}`);
  process.exit(1);
}

function checkTag(ref: string): void {
  const version = versionFromTag(ref);
  const conf = tauriConf();
  const problems = checkVersions({
    tagVersion: version,
    tauriVersion: String(conf.version),
    crateVersion: crateVersion(),
  });
  if (problems.length > 0) fail(problems);
  console.log(`version ${version}`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `version=${version}\n`);
}

function gate(installer: string, installedExe: string): void {
  const result = sizeGate({
    installerBytes: statSync(installer).size,
    installedExeBytes: statSync(installedExe).size,
  });
  for (const line of result.lines) console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary)
    appendFileSync(summary, `### Kustom size gate\n\n${result.lines.map((l) => `- ${l}`).join('\n')}\n`);
  if (!result.ok) fail(['size gate failed: see the two lines above']);
}

function assemble(version: string, installer: string, outDir: string): void {
  const sigPath = `${installer}.sig`;
  if (!existsSync(sigPath)) {
    fail([
      `${sigPath} is missing: the build ran without TAURI_SIGNING_PRIVATE_KEY or without createUpdaterArtifacts`,
    ]);
  }
  mkdirSync(outDir, { recursive: true });
  const setup = join(outDir, INSTALLER_ASSET);
  copyFileSync(installer, setup);
  copyFileSync(installer, join(outDir, LEGACY_ASSET));
  const signature = readFileSync(sigPath, 'utf8');
  writeFileSync(join(outDir, `${INSTALLER_ASSET}.sig`), signature);
  const digest = sha256(setup);
  writeFileSync(join(outDir, `${INSTALLER_ASSET}.sha256`), checksumLine(digest, INSTALLER_ASSET));
  writeFileSync(join(outDir, `${LEGACY_ASSET}.sha256`), checksumLine(digest, LEGACY_ASSET));
  const manifest = latestJson({ version, signature, pubDate: new Date(), notes: `Kustom ${version}` });
  writeFileSync(join(outDir, LATEST_JSON_ASSET), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(outDir, README_ASSET), friendReadme(readFileSync(README, 'utf8')));

  const missing = releaseAssets().filter((asset) => !existsSync(join(outDir, asset)));
  if (missing.length > 0) fail([`assets missing from ${outDir}: ${missing.join(', ')}`]);
  for (const asset of releaseAssets()) console.log(`${asset}  ${statSync(join(outDir, asset)).size} bytes`);
  console.log(`latest.json -> ${manifest.platforms['windows-x86_64']?.url}`);
}

function blockers(): void {
  const pubkey = configPubkey();
  const shellSource = readdirSync(APP_SRC)
    .filter((name) => name.endsWith('.rs'))
    .map((name) => readFileSync(join(APP_SRC, name), 'utf8'))
    .join('\n');
  const found = publishBlockers({ pubkey, shellSource });
  if (found.length > 0) fail(['this tag must not publish yet:', ...found]);
  console.log('nothing blocks a publish');
}

function configPubkey(): string | undefined {
  const pubkey = tauriConf().plugins?.updater?.pubkey;
  return typeof pubkey === 'string' ? pubkey : undefined;
}

/**
 * `tauri build` decodes `plugins.updater.pubkey` before it signs, so the placeholder cannot build a signed
 * installer. A dry run without the user's key signs with a throwaway pair and lays its public key over the
 * config with a second `--config` (JSON merge patch). Never used on a tag: the publish guard runs first.
 */
function dryRunConfig(pubFile: string, outFile: string): void {
  const pubkey = readFileSync(pubFile, 'utf8').trim();
  if (pubkey.length === 0) fail([`${pubFile} is empty`]);
  writeFileSync(outFile, `${JSON.stringify({ plugins: { updater: { pubkey } } })}\n`);
}

const [command, ...args] = process.argv.slice(2);
const need = (n: number): string[] => {
  if (args.length !== n)
    fail([`${command} takes ${n} argument(s); see the header of scripts/release/cli.ts`]);
  return args;
};

switch (command) {
  case 'check-tag': {
    const [ref] = need(1);
    checkTag(ref as string);
    break;
  }
  case 'size-gate': {
    const [installer, exe] = need(2);
    gate(installer as string, exe as string);
    break;
  }
  case 'assemble': {
    const [version, installer, outDir] = need(3);
    assemble(version as string, installer as string, outDir as string);
    break;
  }
  case 'publish-blockers':
    need(0);
    blockers();
    break;
  case 'pubkey-state': {
    need(0);
    const pubkey = configPubkey()?.trim() ?? '';
    console.log(pubkey.length === 0 || pubkey === PUBKEY_PLACEHOLDER ? 'placeholder' : 'set');
    break;
  }
  case 'dry-run-config': {
    const [pubFile, outFile] = need(2);
    dryRunConfig(pubFile as string, outFile as string);
    break;
  }
  default:
    fail([
      `unknown command ${JSON.stringify(command)}: check-tag | size-gate | assemble | publish-blockers | pubkey-state | dry-run-config`,
    ]);
}
