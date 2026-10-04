import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The landing example game's committed squares (05-design 12.7): ten WebP files at Data Dragon's
 * native size (128 x 128 at 16.19.1; 12.7 assumed 120, and the rule is no resample), small enough to
 * load eagerly in the first screen. Re-cut only with `pnpm --filter web landing-champs`.
 */

const DIR = fileURLToPath(new URL('./champions/', import.meta.url));
const NATIVE = 128;
const MAX_FILE = 8 * 1024;
const MAX_TOTAL = 60 * 1024;

/** Width and height from a WebP's first chunk (lossy `VP8 `, lossless `VP8L`, or extended `VP8X`). */
function webpSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP');
  }
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

describe('the example game champion squares', () => {
  const files = readdirSync(DIR).sort();

  it('are ten WebP files and nothing else', () => {
    expect(files).toHaveLength(10);
    for (const file of files) expect(file).toMatch(/^[A-Za-z]+\.webp$/);
  });

  it('are the native square, each within 8 KB and all ten within 60 KB, with no metadata chunk', () => {
    let total = 0;
    for (const file of files) {
      const bytes = readFileSync(`${DIR}${file}`);
      expect(webpSize(bytes), file).toEqual({ width: NATIVE, height: NATIVE });
      expect(bytes.length, file).toBeLessThanOrEqual(MAX_FILE);
      for (const meta of ['EXIF', 'XMP ', 'ICCP'])
        expect(bytes.includes(Buffer.from(meta, 'ascii')), file).toBe(false);
      total += bytes.length;
    }
    expect(total).toBeLessThanOrEqual(MAX_TOTAL);
  });
});
