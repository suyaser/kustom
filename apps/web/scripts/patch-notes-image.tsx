import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { ImageResponse } from 'next/og';
import { ogFonts } from '../app/_og/fonts.ts';
import { PatchNotesBoard } from './patch-notes/Board.tsx';
import { fitLines, PATCH_NOTES_SIZE } from './patch-notes/layout.ts';
import { PATCH_NOTES } from './patch-notes/notes.ts';

/**
 * Renders the one-time "Kustom 2.0 patch notes" picture to a PNG, 1920×1080.
 *
 *   pnpm --filter web patch-notes-image <out.png>
 *
 * The owner posts it once in Discord after the new rating ships. Dev only: no route serves it and
 * nothing in the app imports it. The words are `scripts/patch-notes/notes.ts`; the look is the
 * week notes picture's (`app/_og/WeekNotes.tsx`), drawn by the same `next/og` pipeline and fonts
 * the og routes use. Reads no environment and writes nothing but the file it is given.
 */

const USAGE = 'usage: pnpm --filter web patch-notes-image <out.png>';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const out = args[0];
  if (args.length !== 1 || out === undefined || !out.toLowerCase().endsWith('.png')) {
    console.error(USAGE);
    return 1;
  }
  const fit = fitLines(PATCH_NOTES.columns);
  if (!fit.fits) {
    console.error(`too many words: a column overflows even at ${fit.size} px. Shorten or drop a line.`);
    return 1;
  }
  const image = new ImageResponse(<PatchNotesBoard notes={PATCH_NOTES} size={fit.size} />, {
    ...PATCH_NOTES_SIZE,
    fonts: await ogFonts(),
  });
  // `pnpm --filter` runs in apps/web; a relative path means the caller's directory.
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), out);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, new Uint8Array(await image.arrayBuffer()));
  console.log(
    `wrote  ${path}  (${PATCH_NOTES_SIZE.width}x${PATCH_NOTES_SIZE.height}, lines at ${fit.size} px)`,
  );
  return 0;
}

process.exitCode = await main();
