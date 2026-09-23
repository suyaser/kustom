/**
 * Publish KustomOverlay.exe to the same GitHub releases repo as the companion (M12).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIST_DIR,
  EXE_NAME,
  EXE_SHA256_NAME,
  overlayVersion,
  README_ASSET_NAME,
  RELEASE_REPO,
  releaseTag,
} from './config.js';

const NOTES = `Kustom Overlay

Optional panel for champ select: fearless bans and how you do with the people in this lobby.
No companion token. Leave it running beside League. Unsigned — built from the kustom repo.
`;

export async function publish(options: { version?: string; gh?: string } = {}): Promise<void> {
  const version = options.version ?? overlayVersion();
  const tag = releaseTag(version);
  const notesFile = join(DIST_DIR, README_ASSET_NAME);
  writeFileSync(notesFile, NOTES);
  const exe = join(DIST_DIR, EXE_NAME);
  const sha = join(DIST_DIR, EXE_SHA256_NAME);
  if (!existsSync(exe) || !existsSync(sha)) {
    throw new Error(`missing ${EXE_NAME} or its sha256; run build:win first`);
  }
  const gh = options.gh ?? 'gh';
  const result = spawnSync(
    gh,
    [
      'release',
      'create',
      tag,
      '--repo',
      RELEASE_REPO,
      '--title',
      `Kustom Overlay ${version}`,
      '--notes-file',
      notesFile,
      exe,
      sha,
      notesFile,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`gh release create failed. Run: gh auth login, then pnpm --filter overlay publish:gh`);
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && /publish\.(ts|js|cjs|mjs)$/.test(entry);
}

if (isMain()) {
  publish().catch((error) => {
    console.error('publish failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
