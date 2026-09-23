import { readFile } from 'node:fs/promises';

/**
 * The cards' faces, static OFL TTFs committed beside this file (`fonts/OFL.txt`). Satori reads
 * neither a variable font's `wdth` axis nor `woff2`, and **nothing is fetched at render time**:
 * an unfurl bot that times out on a font request gets no card at all.
 */
export const OG_DISPLAY = 'Archivo Expanded';
export const OG_SANS = 'Archivo';
export const OG_MONO = 'IBM Plex Mono';

type Weight = 500 | 600 | 800;
type OgFont = { name: string; data: ArrayBuffer; weight: Weight; style: 'normal' };

let loaded: Promise<OgFont[]> | null = null;

export function ogFonts(): Promise<OgFont[]> {
  loaded ??= Promise.all([
    face(OG_DISPLAY, 800, new URL('./fonts/ArchivoExpanded-ExtraBold.ttf', import.meta.url)),
    face(OG_SANS, 600, new URL('./fonts/Archivo-SemiBold.ttf', import.meta.url)),
    face(OG_SANS, 500, new URL('./fonts/Archivo-Medium.ttf', import.meta.url)),
    face(OG_MONO, 500, new URL('./fonts/IBMPlexMono-Medium.ttf', import.meta.url)),
    face(OG_MONO, 600, new URL('./fonts/IBMPlexMono-SemiBold.ttf', import.meta.url)),
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
