import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPANION_TOKEN_LENGTH,
  CONFIG_DIR_ENV,
  cleanTokenInput,
  configDir,
  configPath,
  DEFAULT_API_BASE,
  HiddenLineReader,
  loadConfig,
  logsDir,
  looksLikeCompanionToken,
  NO_TOKEN_MESSAGE,
  type PromptIo,
  promptFirstRun,
  saveConfig,
  stdioPrompt,
  TOKEN_SHAPE_MESSAGE,
} from './config.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'companion-config-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A token the way the admin page mints one: `apps/web/lib/companionAuth.ts` `mintCompanionToken`. */
function mintLikeTheServer(): string {
  return randomBytes(32).toString('base64url');
}

/** Fixed tokens so failures read well. Both are the server's shape. */
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const OTHER = 'zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJ';
const ESC = String.fromCharCode(0x1b);

/** A scripted person: answers in order, records what was said and asked. Hidden answers are never echoed. */
function scriptedIo(answers: readonly string[], hidden: readonly string[]) {
  const said: string[] = [];
  const asked: string[] = [];
  const plain = [...answers];
  const secret = [...hidden];
  const io: PromptIo = {
    say: (line) => {
      said.push(line);
    },
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(plain.shift() ?? '');
    },
    askHidden: (question) => {
      asked.push(question);
      return Promise.resolve(secret.shift() ?? '');
    },
  };
  return { io, said, asked };
}

describe('token shape', () => {
  it('matches what the server mints, every time', () => {
    for (let i = 0; i < 200; i += 1) {
      const token = mintLikeTheServer();
      expect(token).toHaveLength(COMPANION_TOKEN_LENGTH);
      expect(looksLikeCompanionToken(token)).toBe(true);
    }
    expect(looksLikeCompanionToken(TOKEN)).toBe(true);
  });

  it('rejects the wrong length, padding, and characters outside base64url', () => {
    expect(looksLikeCompanionToken(TOKEN.slice(1))).toBe(false);
    expect(looksLikeCompanionToken(`${TOKEN}A`)).toBe(false);
    expect(looksLikeCompanionToken(`${TOKEN.slice(0, 42)}=`)).toBe(false);
    expect(looksLikeCompanionToken(`${TOKEN.slice(0, 42)}+`)).toBe(false);
    expect(looksLikeCompanionToken(`[200~${TOKEN}[201~`)).toBe(false);
    expect(looksLikeCompanionToken('')).toBe(false);
  });
});

describe('cleanTokenInput', () => {
  it('strips bracketed-paste wrappers and other escape sequences', () => {
    expect(cleanTokenInput(`${ESC}[200~${TOKEN}${ESC}[201~`)).toBe(TOKEN);
    expect(cleanTokenInput(`${ESC}[200~${TOKEN}\r${ESC}[201~`)).toBe(TOKEN);
    expect(cleanTokenInput(`${ESC}OA${TOKEN}${ESC}[3;5~${ESC}x`)).toBe(TOKEN);
  });

  it('strips surrounding whitespace and quotes of either kind', () => {
    expect(cleanTokenInput(`  "${TOKEN}"  `)).toBe(TOKEN);
    expect(cleanTokenInput(`'${TOKEN}'\n`)).toBe(TOKEN);
    expect(cleanTokenInput(`\u201c${TOKEN}\u201d`)).toBe(TOKEN);
    expect(cleanTokenInput(`\t${TOKEN}\r\n`)).toBe(TOKEN);
  });

  it('drops control characters and a BOM but keeps the token itself intact', () => {
    expect(cleanTokenInput(`\uFEFF${TOKEN}\u0007`)).toBe(TOKEN);
    expect(cleanTokenInput(TOKEN)).toBe(TOKEN);
    expect(cleanTokenInput('')).toBe('');
  });
});

describe('HiddenLineReader', () => {
  it('yields the clean token from a bracketed paste', () => {
    const reader = new HiddenLineReader();
    expect(reader.feed(`${ESC}[200~${TOKEN}${ESC}[201~`)).toEqual({ kind: 'more' });
    expect(reader.feed('\r')).toEqual({ kind: 'line', line: TOKEN });
  });

  it('ends the line on a CR inside the paste and ignores the rest', () => {
    const reader = new HiddenLineReader();
    expect(reader.feed(`${ESC}[200~${TOKEN}\r${ESC}[201~`)).toEqual({ kind: 'line', line: TOKEN });
  });

  it('swallows an escape sequence split across chunks', () => {
    const reader = new HiddenLineReader();
    expect(reader.feed(ESC)).toEqual({ kind: 'more' });
    expect(reader.feed('[20')).toEqual({ kind: 'more' });
    expect(reader.feed(`0~${TOKEN.slice(0, 10)}`)).toEqual({ kind: 'more' });
    expect(reader.feed(`${TOKEN.slice(10)}${ESC}[`)).toEqual({ kind: 'more' });
    expect(reader.feed('201~\n')).toEqual({ kind: 'line', line: TOKEN });
  });

  it('handles keys typed one at a time: arrows are ignored, backspace erases, Ctrl-C interrupts', () => {
    const reader = new HiddenLineReader();
    for (const ch of 'abx') {
      expect(reader.feed(ch)).toEqual({ kind: 'more' });
    }
    expect(reader.feed(`${ESC}[D`)).toEqual({ kind: 'more' });
    expect(reader.feed(`${ESC}OA`)).toEqual({ kind: 'more' });
    expect(reader.feed(String.fromCharCode(0x7f))).toEqual({ kind: 'more' });
    expect(reader.feed('c\r')).toEqual({ kind: 'line', line: 'abc' });
    expect(reader.feed(String.fromCharCode(0x03))).toEqual({ kind: 'interrupt' });
  });
});

/** A stdin the prompt sees as a raw-mode TTY, fed by the test. */
function fakeTty() {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: (raw: boolean) => PassThrough;
  };
  input.isTTY = true;
  input.isRaw = false;
  const rawModes: boolean[] = [];
  input.setRawMode = (raw: boolean) => {
    rawModes.push(raw);
    input.isRaw = raw;
    return input;
  };
  const written: string[] = [];
  const output = new PassThrough();
  output.on('data', (chunk: Buffer) => {
    written.push(chunk.toString('utf8'));
  });
  return { input, output, written, rawModes };
}

describe('stdioPrompt.askHidden', () => {
  it('reads a bracketed paste through a raw TTY without echoing it', async () => {
    const { input, output, written, rawModes } = fakeTty();
    const io = stdioPrompt(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream);
    const answer = io.askHidden('Companion token (input hidden): ');
    input.write(`${ESC}[200~${TOKEN}`);
    input.write(`${ESC}[201~\r`);
    expect(await answer).toBe(TOKEN);
    expect(rawModes).toEqual([true, false]);
    expect(written.join('')).toBe('Companion token (input hidden): \n');
  });

  it('echoes through a plain line read with showToken, and reads a pipe the same way', async () => {
    const { input, output, written, rawModes } = fakeTty();
    const io = stdioPrompt(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream, {
      showToken: true,
    });
    const answer = io.askHidden('Companion token (input hidden): ');
    input.write(`${TOKEN}\n`);
    expect(await answer).toBe(TOKEN);
    expect(rawModes).toEqual([]);
    expect(written.join('')).toContain('(shown as you type)');

    const piped = new PassThrough();
    const pipedIo = stdioPrompt(
      piped as unknown as NodeJS.ReadStream,
      new PassThrough() as unknown as NodeJS.WriteStream,
    );
    const pipedAnswer = pipedIo.askHidden('token: ');
    piped.write(`"${TOKEN}"\n`);
    expect(await pipedAnswer).toBe(`"${TOKEN}"`);
  });
});

describe('configDir', () => {
  const home = '/home/friend';

  it('uses %APPDATA% on Windows', () => {
    expect(
      configDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\friend\\AppData\\Roaming' }, home }),
    ).toBe(join('C:\\Users\\friend\\AppData\\Roaming', 'customs-night'));
    expect(configDir({ platform: 'win32', env: {}, home })).toBe(
      join(home, 'AppData', 'Roaming', 'customs-night'),
    );
  });

  it('uses Application Support on macOS and XDG on Linux', () => {
    expect(configDir({ platform: 'darwin', env: {}, home })).toBe(
      join(home, 'Library', 'Application Support', 'customs-night'),
    );
    expect(configDir({ platform: 'linux', env: {}, home })).toBe(join(home, '.config', 'customs-night'));
    expect(configDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, home })).toBe(
      join('/xdg', 'customs-night'),
    );
  });

  it('honours the environment override on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(configDir({ platform, env: { [CONFIG_DIR_ENV]: '/custom/dir ' }, home })).toBe('/custom/dir');
    }
  });

  it('derives the config and logs paths', () => {
    expect(configPath('/d')).toBe(join('/d', 'config.json'));
    expect(logsDir('/d')).toBe(join('/d', 'logs'));
  });
});

describe('loadConfig / saveConfig', () => {
  it('reports missing when there is no file', () => {
    const dir = tempDir();
    expect(loadConfig(dir)).toEqual({
      status: 'missing',
      path: configPath(dir),
      partial: {},
      reason: 'no_file',
    });
  });

  it('round-trips a config with owner-only permissions and a trimmed apiBase', () => {
    const dir = join(tempDir(), 'nested', 'customs-night');
    const path = saveConfig(dir, { apiBase: 'https://customs.example/', companionToken: TOKEN });
    expect(path).toBe(configPath(dir));
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o077).toBe(0);
    }
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      mode: 'host',
      apiBase: 'https://customs.example',
      companionToken: TOKEN,
    });
    expect(loadConfig(dir)).toEqual({
      status: 'ok',
      path,
      config: { mode: 'host', apiBase: 'https://customs.example', companionToken: TOKEN },
    });
  });

  it('treats a file without a token as missing but keeps the usable fields', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ apiBase: 'http://localhost:3000', lockfilePath: 'D:\\lol\\lockfile' }),
    );
    expect(loadConfig(dir)).toEqual({
      status: 'missing',
      path: configPath(dir),
      partial: { apiBase: 'http://localhost:3000', lockfilePath: 'D:\\lol\\lockfile' },
      reason: 'no_token',
    });
  });

  it('treats the corrupted token 0.1.0 saved as missing with reason bad_token, so it is asked again', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ apiBase: 'https://kustom.example', companionToken: `[200~${TOKEN}[201~` }),
    );
    const result = loadConfig(dir);
    expect(result).toEqual({
      status: 'missing',
      path: configPath(dir),
      partial: { apiBase: 'https://kustom.example' },
      reason: 'bad_token',
    });
    // Neither the token nor its wrapper leaks through the result.
    expect(JSON.stringify(result)).not.toContain(TOKEN.slice(0, 8));
  });

  it('accepts a hand-quoted or padded token in the file by cleaning it', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ apiBase: 'http://localhost:3000', companionToken: `  '${TOKEN}'\n` }),
    );
    const result = loadConfig(dir);
    expect(result.status).toBe('ok');
    if (result.status === 'ok' && result.config.mode === 'host') {
      expect(result.config.companionToken).toBe(TOKEN);
    }
  });

  it('refuses a file that is not JSON rather than overwriting it, without quoting its contents', () => {
    const dir = tempDir();
    // A hand-edited file with the token pasted unquoted: the parse error must not echo it.
    const token = 'tok_pasted_unquoted_SECRET_9x8y7z';
    const body = `{ "apiBase": "http://localhost:3000", "companionToken": ${token} }`;
    writeFileSync(configPath(dir), body);
    const result = loadConfig(dir);
    expect(result.status).toBe('invalid');
    // main.ts logs exactly `path` and `reason` from this result; neither may carry any fragment of the file.
    const text = JSON.stringify(result);
    expect(text).not.toContain(token);
    expect(text).not.toContain('tok_');
    expect(text).not.toContain('apiBase');
    if (result.status === 'invalid') {
      expect(result.reason).toMatch(/^not JSON( \(at position \d+\))?$/);
      for (let i = 0; i + 4 <= body.length; i += 1) {
        expect(result.reason).not.toContain(body.slice(i, i + 4));
      }
    }
  });

  it('tightens a pre-existing world-readable config to 0600 when the token is written', () => {
    const dir = tempDir();
    const path = configPath(dir);
    writeFileSync(path, JSON.stringify({ apiBase: 'http://localhost:3000' }), { mode: 0o644 });
    chmodSync(path, 0o644);
    saveConfig(dir, { apiBase: 'http://localhost:3000', companionToken: TOKEN });
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    expect(loadConfig(dir).status).toBe('ok');
  });

  it('rejects an apiBase with a path', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ apiBase: 'https://x.example/api', companionToken: TOKEN }),
    );
    expect(loadConfig(dir).status).toBe('missing');
  });
  it('loads an explicit overlay config with no token', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ mode: 'overlay', apiBase: 'https://kustom.example' }),
    );
    expect(loadConfig(dir)).toEqual({
      status: 'ok',
      path: configPath(dir),
      config: { mode: 'overlay', apiBase: 'https://kustom.example' },
    });
  });

  it('infers host mode from a pre-M6 file that has a token and no mode', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ apiBase: 'https://kustom.example', companionToken: TOKEN }),
    );
    const result = loadConfig(dir);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.config).toEqual({
        mode: 'host',
        apiBase: 'https://kustom.example',
        companionToken: TOKEN,
      });
    }
  });
});

describe('promptFirstRun', () => {
  it('asks only for the token when the built-in apiBase answers, takes it hidden and writes the file', async () => {
    const dir = tempDir();
    const checked: string[] = [];
    const { io, said, asked } = scriptedIo([], [`  ${TOKEN}  `]);
    const config = await promptFirstRun({
      io,
      checkApiBase: async (apiBase) => {
        checked.push(apiBase);
        return null;
      },
    });
    expect(config).toEqual({ mode: 'host', apiBase: DEFAULT_API_BASE, companionToken: TOKEN });
    expect(checked).toEqual([DEFAULT_API_BASE]);
    // One question, and it is the hidden one.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('hidden');
    expect(said.some((line) => line.includes(`Using ${DEFAULT_API_BASE}`))).toBe(true);
    // The token is never printed back.
    expect(said.join('\n')).not.toContain(TOKEN);
    expect(asked.join('\n')).not.toContain(TOKEN);

    const path = saveConfig(dir, config);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(config);
  });

  it('cleans a bracketed paste, a CR-terminated paste and a quoted paste into the token', async () => {
    for (const raw of [
      `${ESC}[200~${TOKEN}${ESC}[201~`,
      `${TOKEN}\r`,
      `  "${TOKEN}"  `,
      `\u2018${TOKEN}\u2019`,
    ]) {
      const { io, said } = scriptedIo([], [raw]);
      const config = await promptFirstRun({ io, checkApiBase: async () => null });
      expect(config.companionToken).toBe(TOKEN);
      expect(said.some((line) => line.includes('does not look like'))).toBe(false);
    }
  });

  it('re-prompts on a wrong-shape paste with one plain sentence, then takes the good one', async () => {
    const { io, said, asked } = scriptedIo([], [`[200~${TOKEN}[201~`, 'not a token', OTHER]);
    const config = await promptFirstRun({ io, checkApiBase: async () => null });
    expect(config.companionToken).toBe(OTHER);
    expect(asked.filter((question) => question.includes('token'))).toHaveLength(3);
    const complaints = said.filter((line) => line.includes(TOKEN_SHAPE_MESSAGE));
    expect(complaints).toHaveLength(2);
    expect(TOKEN_SHAPE_MESSAGE).toBe(
      'That does not look like a token from the admin page (expected 43 characters, letters, digits, - and _). Try pasting it again.',
    );
    expect(said.join('\n')).not.toContain(TOKEN);
  });

  it('gives up after three pastes that cannot be a token', async () => {
    const { io, asked } = scriptedIo([], ['x', 'y', 'z', TOKEN]);
    await expect(promptFirstRun({ io, checkApiBase: async () => null })).rejects.toThrow(NO_TOKEN_MESSAGE);
    expect(asked.filter((question) => question.includes('token'))).toHaveLength(3);
  });

  it('words the first line for a saved token that was corrupted', async () => {
    const { io, said } = scriptedIo([''], [TOKEN]);
    await promptFirstRun({
      io,
      partial: { apiBase: 'https://kept.example' },
      reason: 'bad_token',
      checkApiBase: async () => null,
    });
    expect(said[0]).toContain('the saved token does not look like one from the admin page');
    expect(said[0]).not.toContain('first run');
  });

  it('opens both prompt variants with the product name, never the codename (M2.20)', async () => {
    const first = scriptedIo([''], [TOKEN]);
    await promptFirstRun({ io: first.io, checkApiBase: async () => null });
    expect(first.said[0]).toBe(
      'Kustom companion: first run. Paste the token from the admin page; it is stored locally only.',
    );
    const again = scriptedIo([''], [TOKEN]);
    await promptFirstRun({
      io: again.io,
      partial: { apiBase: 'https://kept.example' },
      reason: 'bad_token',
      checkApiBase: async () => null,
    });
    expect(again.said[0]?.startsWith('Kustom companion: ')).toBe(true);
    expect([...first.said, ...again.said].join('\n')).not.toMatch(/customs night/i);
  });

  it('falls back to the address question when the built-in apiBase does not answer', async () => {
    const { io, said, asked } = scriptedIo(['https://other.example'], [TOKEN]);
    const config = await promptFirstRun({
      io,
      checkApiBase: async (apiBase) => (apiBase === DEFAULT_API_BASE ? 'ECONNREFUSED' : null),
    });
    expect(config).toEqual({ mode: 'host', apiBase: 'https://other.example', companionToken: TOKEN });
    expect(asked[0]).toContain(`[${DEFAULT_API_BASE}]`);
    expect(said.some((line) => line.includes('ECONNREFUSED'))).toBe(true);
  });

  it('offers a partial apiBase as the default and confirms it rather than skipping the question', async () => {
    const checked: string[] = [];
    const { io, asked } = scriptedIo([''], [TOKEN]);
    const config = await promptFirstRun({
      io,
      partial: { apiBase: 'https://kept.example' },
      checkApiBase: async (apiBase) => {
        checked.push(apiBase);
        return null;
      },
    });
    expect(config.apiBase).toBe('https://kept.example');
    expect(asked[0]).toContain('[https://kept.example]');
    expect(checked).toEqual(['https://kept.example']);
  });

  it('re-asks on an unreachable apiBase unless the person keeps it', async () => {
    const { io, said } = scriptedIo(['https://typo.example', 'n', 'https://down.example/', 'y'], [TOKEN]);
    const config = await promptFirstRun({
      io,
      checkApiBase: async (apiBase) => (apiBase === 'https://typo.example' ? 'ENOTFOUND' : 'ECONNREFUSED'),
    });
    expect(config.apiBase).toBe('https://down.example');
    expect(said.some((line) => line.includes('ENOTFOUND'))).toBe(true);
  });

  it('rejects an invalid address and an empty token, and keeps a partial lockfilePath', async () => {
    const { io, said } = scriptedIo(['not a url', 'http://localhost:3000'], ['', TOKEN]);
    const config = await promptFirstRun({ io, partial: { lockfilePath: '/x/lockfile' } });
    expect(config).toEqual({
      mode: 'host',
      apiBase: 'http://localhost:3000',
      companionToken: TOKEN,
      lockfilePath: '/x/lockfile',
    });
    expect(said.some((line) => line.includes('origin'))).toBe(true);
    expect(said.some((line) => line.includes('token is required'))).toBe(true);
  });
});
