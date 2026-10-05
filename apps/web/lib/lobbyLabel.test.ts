import { describe, expect, it } from 'vitest';
import { renderName } from './discord/embeds';
import { formatLobbyLabel, lobbyLabels } from './lobbyLabel';

const plain = (name: string) => name;

describe('lobbyLabels (05-design 14.1)', () => {
  it("names each table after its host, `'s` after an s too, the name's own case", () => {
    const labels = lobbyLabels(
      [
        { key: 'b', hostName: 'Chaos', openedAt: '2026-10-05T19:10:00Z' },
        { key: 'a', hostName: 'knifiy', openedAt: '2026-10-05T19:00:00Z' },
      ],
      plain,
    );
    expect(formatLobbyLabel(labels.get('a') ?? { kind: 'numbered', n: 0 }, plain)).toBe("knifiy's lobby");
    expect(formatLobbyLabel(labels.get('b') ?? { kind: 'numbered', n: 0 }, plain)).toBe("Chaos's lobby");
  });

  it('the same host twice: the older keeps the plain label, the newer is numbered by opening', () => {
    const labels = lobbyLabels(
      [
        { key: 'new', hostName: 'Ana', openedAt: '2026-10-05T20:00:00Z' },
        { key: 'old', hostName: 'Ana ', openedAt: '2026-10-05T19:00:00Z' },
        { key: 'newest', hostName: 'Ana', openedAt: '2026-10-05T21:00:00Z' },
      ],
      plain,
    );
    const text = (key: string) => formatLobbyLabel(labels.get(key) ?? { kind: 'numbered', n: 0 }, plain);
    expect([text('old'), text('new'), text('newest')]).toEqual(["Ana's lobby", "Ana's lobby 2", "Ana's lobby 3"]);
  });

  it('no host name: `Lobby n`, n by when the table opened', () => {
    const labels = lobbyLabels(
      [
        { key: 'a', hostName: 'Ana', openedAt: '2026-10-05T19:00:00Z' },
        { key: 'b', hostName: null, openedAt: '2026-10-05T19:30:00Z' },
        { key: 'c', hostName: '  ', openedAt: '2026-10-05T19:20:00Z' },
      ],
      plain,
    );
    expect(labels.get('b')).toEqual({ kind: 'numbered', n: 3 });
    expect(formatLobbyLabel(labels.get('c') ?? { kind: 'numbered', n: 0 }, plain)).toBe('Lobby 2');
  });

  it('Discord: the name is cut and escaped by renderName, the suffix is never cut', () => {
    const name = '*'.repeat(40);
    const [label] = lobbyLabels([{ key: 'a', hostName: name, openedAt: '2026-10-05T19:00:00Z' }], renderName).values();
    expect(label).toBeDefined();
    const text = formatLobbyLabel(label ?? { kind: 'numbered', n: 0 }, renderName);
    expect(text).toBe(`${'\\*'.repeat(31)}…'s lobby`);
  });
});
