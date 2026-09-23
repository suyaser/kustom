/**
 * Opens the overlay UI in Edge/Chrome app mode and keeps it topmost on Windows (M12).
 * The native Tauri shell in `src-tauri/` replaces this when Rust is available.
 * When CUSTOMS_NIGHT_TAURI=1, this module is a no-op: Tauri manages the window.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';

export interface WindowHandle {
  close(): void;
}

function findBrowser(): string | null {
  if (platform() !== 'win32') return null;
  const candidates = [
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`
      : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.PROGRAMFILES
      ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`
      : null,
  ];
  return candidates.find((path) => path !== null) ?? null;
}

function pinTopmost(titleHint: string): void {
  if (platform() !== 'win32') return;
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OverlayWin {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_SHOWWINDOW = 0x0040;
}
"@
Start-Sleep -Milliseconds 800
$w = Get-Process | Where-Object { $_.MainWindowTitle -like '*${titleHint}*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($w) {
  [OverlayWin]::SetWindowPos($w.MainWindowHandle, [OverlayWin]::HWND_TOPMOST, 0, 0, 0, 0, [OverlayWin]::SWP_NOMOVE -bor [OverlayWin]::SWP_NOSIZE -bor [OverlayWin]::SWP_SHOWWINDOW) | Out-Null
}
`;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true },
    () => undefined,
  );
}

/**
 * Opens the local UI. Returns a handle that kills the browser process when closed.
 * On non-Windows, logs the URL and returns a no-op handle (dev still works in any browser).
 * When CUSTOMS_NIGHT_TAURI=1, this is a no-op: Tauri manages the window.
 */
export function openOverlayWindow(url: string, position: { x: number; y: number } | null): WindowHandle {
  // Tauri mode: no-op, window is managed by the Rust shell
  if (process.env.CUSTOMS_NIGHT_TAURI === '1') {
    console.info(`Tauri mode: Node sidecar ready at ${url}`);
    return { close: () => undefined };
  }

  const browser = findBrowser();
  if (browser === null) {
    console.info(`Kustom Overlay: open ${url} in a browser (no Edge/Chrome found).`);
    return { close: () => undefined };
  }

  const args = [
    `--app=${url}`,
    '--new-window',
    '--disable-features=TranslateUI',
    '--no-first-run',
  ];
  if (position !== null) {
    args.push(`--window-position=${Math.round(position.x)},${Math.round(position.y)}`);
  }
  args.push('--window-size=420,720');

  const child: ChildProcess = spawn(browser, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  pinTopmost('127.0.0.1');

  return {
    close: () => {
      try {
        if (child.pid !== undefined) {
          process.kill(child.pid);
        }
      } catch {
        // already gone
      }
    },
  };
}
