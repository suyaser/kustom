/**
 * Local HTTP UI for the overlay panel. The browser (Edge --app) loads this;
 * state is pushed as Server-Sent Events.
 *
 * Packaged builds bake the three UI files in through esbuild defines so the exe
 * needs no `ui/` directory beside it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface OverlayUiState {
  waiting: boolean;
  visible: boolean;
  phase: string | null;
  connected: boolean;
  error: string | null;
  payload: unknown | null;
}

declare const __OVERLAY_UI_HTML__: string | undefined;
declare const __OVERLAY_UI_CSS__: string | undefined;
declare const __OVERLAY_UI_JS__: string | undefined;

function baked(name: 'index.html' | 'app.css' | 'app.js'): string | null {
  if (name === 'index.html' && typeof __OVERLAY_UI_HTML__ === 'string') return __OVERLAY_UI_HTML__;
  if (name === 'app.css' && typeof __OVERLAY_UI_CSS__ === 'string') return __OVERLAY_UI_CSS__;
  if (name === 'app.js' && typeof __OVERLAY_UI_JS__ === 'string') return __OVERLAY_UI_JS__;
  return null;
}

function resolveUiDir(): string {
  const besideExe = join(dirname(process.execPath), 'ui');
  if (existsSync(join(besideExe, 'index.html'))) return besideExe;
  return join(dirname(fileURLToPath(import.meta.url)), 'ui');
}

function readUi(name: 'index.html' | 'app.css' | 'app.js'): Buffer {
  const fromBake = baked(name);
  if (fromBake !== null) return Buffer.from(fromBake, 'utf8');
  return readFileSync(join(resolveUiDir(), name));
}

export class OverlayServer {
  private server: Server | null = null;
  private port = 0;
  private state: OverlayUiState = {
    waiting: true,
    visible: false,
    phase: null,
    connected: false,
    error: null,
    payload: null,
  };
  private readonly clients = new Set<ServerResponse>();

  async listen(preferredPort = 0): Promise<number> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(preferredPort, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('overlay server has no port');
    }
    this.port = address.port;
    return this.port;
  }

  url(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  setState(next: Partial<OverlayUiState>): void {
    this.state = { ...this.state, ...next };
    const body = `data: ${JSON.stringify(this.state)}\n\n`;
    for (const client of this.clients) {
      client.write(body);
    }
  }

  async close(): Promise<void> {
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    if (url === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(this.state)}\n\n`);
      this.clients.add(res);
      req.on('close', () => {
        this.clients.delete(res);
      });
      return;
    }
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readUi('index.html'));
      return;
    }
    if (url === '/app.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      res.end(readUi('app.css'));
      return;
    }
    if (url === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(readUi('app.js'));
      return;
    }
    if (url === '/position' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8');
      });
      req.on('end', () => {
        res.writeHead(204);
        res.end();
        try {
          const parsed = JSON.parse(raw) as { x?: number; y?: number };
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            this.onPosition?.({ x: parsed.x, y: parsed.y });
          }
        } catch {
          // ignore
        }
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }

  onPosition: ((position: { x: number; y: number }) => void) | null = null;
}
