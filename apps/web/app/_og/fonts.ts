import 'server-only';
import { readFile } from 'node:fs/promises';

/**
 * The cards' faces: 2.0's three (05-design.md section 4), as static OFL TTFs committed beside this
 * file (`fonts/OFL.txt`) and cut from the Google Fonts variable files at the site's own settings.
 * Satori reads neither a variable font's `wdth` axis nor `woff2`, and **nothing is fetched at render
 * time**: an unfurl bot that times out on a font request gets no card at all.
 *
 * - `OG_DISPLAY`: Archivo at `wdth` 62, `wght` 900, the condensed cut of the wordmark, the strip
 *   headline and the side names.
 * - `OG_TEXT`: Atkinson Hyperlegible Next 400 and 700, for names and sentences.
 * - `OG_MONO`: Martian Mono at `wdth` 85 (the win bar's `font-stretch`), 500 and 600, for numbers.
 */
export const OG_DISPLAY = 'Archivo Condensed';
export const OG_TEXT = 'Atkinson Hyperlegible Next';
export const OG_MONO = 'Martian Mono';

type Weight = 400 | 500 | 600 | 700 | 900;
type OgFont = { name: string; data: ArrayBuffer; weight: Weight; style: 'normal' };

let loaded: Promise<OgFont[]> | null = null;

export function ogFonts(): Promise<OgFont[]> {
  loaded ??= Promise.all([
    face(OG_DISPLAY, 900, new URL('./fonts/ArchivoCondensed62-Black.ttf', import.meta.url)),
    face(OG_TEXT, 400, new URL('./fonts/AtkinsonHyperlegibleNext-Regular.ttf', import.meta.url)),
    face(OG_TEXT, 700, new URL('./fonts/AtkinsonHyperlegibleNext-Bold.ttf', import.meta.url)),
    face(OG_MONO, 500, new URL('./fonts/MartianMono85-Medium.ttf', import.meta.url)),
    face(OG_MONO, 600, new URL('./fonts/MartianMono85-SemiBold.ttf', import.meta.url)),
  ]).catch((error: unknown) => {
    loaded = null;
    throw error;
  });
  return loaded;
}

async function face(name: string, weight: Weight, file: URL): Promise<OgFont> {
  const buffer = await readFile(file);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  return { name, data, weight, style: 'normal' };
}
