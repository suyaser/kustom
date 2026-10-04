import { afterEach, describe, expect, it } from 'vitest';
import { OverlayServer } from './server.js';

let server: OverlayServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function post(url: string, headers: Record<string, string>, body: string) {
  return fetch(`${url}group`, { method: 'POST', headers, body });
}

describe('POST /group (the picker)', () => {
  it('passes a JSON pick to the engine', async () => {
    server = new OverlayServer();
    const picks: string[] = [];
    server.onGroupPick = (id) => picks.push(id);
    await server.listen(0);
    const res = await post(
      server.url(),
      { 'content-type': 'application/json' },
      JSON.stringify({ groupId: 'g2' }),
    );
    expect(res.status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(picks).toEqual(['g2']);
  });

  it('refuses a body that is not JSON-typed, so a web page in the same browser cannot flip the group', async () => {
    server = new OverlayServer();
    const picks: string[] = [];
    server.onGroupPick = (id) => picks.push(id);
    await server.listen(0);
    const res = await post(server.url(), { 'content-type': 'text/plain' }, JSON.stringify({ groupId: 'g2' }));
    expect(res.status).toBe(415);
    expect(picks).toEqual([]);
  });

  it('drops a malformed pick without throwing', async () => {
    server = new OverlayServer();
    const picks: string[] = [];
    server.onGroupPick = (id) => picks.push(id);
    await server.listen(0);
    await post(server.url(), { 'content-type': 'application/json' }, '{"groupId":42}');
    await post(server.url(), { 'content-type': 'application/json' }, 'nope');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(picks).toEqual([]);
  });
});
