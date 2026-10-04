/**
 * Test-only child process: `tsx configWriter.ts <dir> <prefix> <count>` does `count` locked read-modify-writes
 * of the config, each adding one key, to stand in for the one-shot `--pair` process racing the engine.
 */

import { updateConfig } from '../config.js';

const [dir, prefix, count] = process.argv.slice(2);
if (!dir || !prefix || !count) process.exit(2);
for (let i = 0; i < Number(count); i += 1) {
  updateConfig(dir, (raw) => ({ ...raw, [`${prefix}${i}`]: true }));
}
