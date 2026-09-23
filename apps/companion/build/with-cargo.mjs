/**
 * Tauri CLI shells out to `cargo`. rustup puts it in ~/.cargo/bin, which is
 * often missing from a fresh PowerShell / Cursor terminal PATH.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const cargoBin = join(homedir(), '.cargo', 'bin');
const path = process.env.PATH ?? '';
if (!path.split(delimiter).some((entry) => entry.toLowerCase() === cargoBin.toLowerCase())) {
  process.env.PATH = `${cargoBin}${delimiter}${path}`;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node build/with-cargo.mjs <command> [args…]');
  process.exit(2);
}

const child = spawn(args[0], args.slice(1), { stdio: 'inherit', shell: true, env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
