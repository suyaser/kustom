import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformMock = vi.fn<() => string>(() => 'win32');
vi.mock('node:os', () => ({ platform: () => platformMock() }));

const existsSyncMock = vi.fn<(path: string) => boolean>(() => false);
vi.mock('node:fs', () => ({ existsSync: (path: string) => existsSyncMock(path) }));

class FakeChild extends EventEmitter {
  pid = 4242;
  unref(): void {}
}

const spawnMock = vi.fn<(...args: unknown[]) => FakeChild>();
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const { openOverlayWindow } = await import('./window.js');

describe('openOverlayWindow', () => {
  beforeEach(() => {
    platformMock.mockReturnValue('win32');
    existsSyncMock.mockReturnValue(false);
    spawnMock.mockReset();
    execFileMock.mockReset();
    delete process.env.CUSTOMS_NIGHT_TAURI;
  });

  it('never calls spawn when no candidate path actually exists on disk (the ENOENT crash this guards)', () => {
    // The bug this guards: the old `.find((p) => p !== null)` returned the first *guessed*
    // path regardless of whether the file was there, so a fresh Windows machine with no Edge
    // at that exact path handed `spawn` a path that does not exist.
    const handle = openOverlayWindow('http://127.0.0.1:1/', null);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(() => handle.close()).not.toThrow();
  });

  it('spawns the first candidate that exists, never one that does not', () => {
    existsSyncMock.mockImplementation(
      (path) => path === 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    );
    spawnMock.mockReturnValue(new FakeChild());

    openOverlayWindow('http://127.0.0.1:1/', null);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[0]).toBe('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('a failed spawn never throws out of the process -- an unhandled child "error" event used to crash it', () => {
    existsSyncMock.mockReturnValue(true);
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    openOverlayWindow('http://127.0.0.1:1/', null);

    // This is exactly what a real ENOENT from a stale/missing browser path fires, asynchronously,
    // after openOverlayWindow has already returned. With no listener this is an uncaught
    // exception that kills the whole companion process, lobby automation included.
    expect(() =>
      child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
    ).not.toThrow();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('could not open'));

    info.mockRestore();
  });

  it('is a no-op on a non-Windows host, before findBrowser ever runs', () => {
    platformMock.mockReturnValue('darwin');
    const handle = openOverlayWindow('http://127.0.0.1:1/', null);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(existsSyncMock).not.toHaveBeenCalled();
    expect(() => handle.close()).not.toThrow();
  });

  it('is a no-op under Tauri, before any browser lookup', () => {
    process.env.CUSTOMS_NIGHT_TAURI = '1';
    const handle = openOverlayWindow('http://127.0.0.1:1/', null);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(existsSyncMock).not.toHaveBeenCalled();
    expect(() => handle.close()).not.toThrow();
  });
});
