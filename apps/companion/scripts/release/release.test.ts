import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assetUrl,
  checksumLine,
  checkVersions,
  friendReadme,
  INSTALLED_EXE_LIMIT_BYTES,
  INSTALLER_LIMIT_BYTES,
  latestJson,
  PUBKEY_PLACEHOLDER,
  publishBlockers,
  releaseAssets,
  sizeGate,
  versionFromTag,
} from './release.js';

/** The M17.12 release workflow's rules (`.github/workflows/companion-release.yml`). */

describe('versionFromTag', () => {
  it('reads the version off a companion tag, bare or as a ref', () => {
    expect(versionFromTag('companion-v1.0.0')).toBe('1.0.0');
    expect(versionFromTag('refs/tags/companion-v1.2.3')).toBe('1.2.3');
    expect(versionFromTag('companion-v1.0.0-rc.1')).toBe('1.0.0-rc.1');
  });

  it('refuses a tag that is not a companion release', () => {
    expect(() => versionFromTag('v1.0.0')).toThrow(/companion-v/);
    expect(() => versionFromTag('companion-v1.0')).toThrow(/semver/);
    expect(() => versionFromTag('companion-vlatest')).toThrow(/semver/);
  });
});

describe('checkVersions', () => {
  it('passes when the tag, the Tauri config and the crate agree', () => {
    expect(checkVersions({ tagVersion: '1.0.0', tauriVersion: '1.0.0', crateVersion: '1.0.0' })).toEqual([]);
  });

  it('names every file that disagrees with the tag', () => {
    const problems = checkVersions({ tagVersion: '1.0.0', tauriVersion: '0.1.5', crateVersion: '0.1.5' });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/tauri\.conf\.json has version 0\.1\.5, the tag says 1\.0\.0/);
    expect(problems[1]).toMatch(/Cargo\.toml/);
  });
});

describe('sizeGate', () => {
  it('passes at exactly 15 MB and 20 MB, and prints both numbers', () => {
    const result = sizeGate({
      installerBytes: INSTALLER_LIMIT_BYTES,
      installedExeBytes: INSTALLED_EXE_LIMIT_BYTES,
    });
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatch(/^PASS Installer \(Kustom-setup\.exe\): 15,000,000 bytes \(15\.00 MB/);
    expect(result.lines[1]).toMatch(/^PASS Installed Kustom exe: 20,000,000 bytes/);
  });

  it('uses decimal megabytes, the stricter reading', () => {
    expect(INSTALLER_LIMIT_BYTES).toBe(15_000_000);
    expect(INSTALLED_EXE_LIMIT_BYTES).toBe(20_000_000);
  });

  it('fails one byte over either limit, and still prints both', () => {
    const fatInstaller = sizeGate({
      installerBytes: INSTALLER_LIMIT_BYTES + 1,
      installedExeBytes: 9_000_000,
    });
    expect(fatInstaller.ok).toBe(false);
    expect(fatInstaller.lines[0]).toMatch(/^FAIL/);
    expect(fatInstaller.lines[1]).toMatch(/^PASS/);

    const fatExe = sizeGate({ installerBytes: 6_000_000, installedExeBytes: INSTALLED_EXE_LIMIT_BYTES + 1 });
    expect(fatExe.ok).toBe(false);
    expect(fatExe.lines[1]).toMatch(/^FAIL/);
  });

  it('fails an empty or unmeasured file instead of calling it small', () => {
    expect(sizeGate({ installerBytes: 0, installedExeBytes: 1 }).ok).toBe(false);
    expect(sizeGate({ installerBytes: 1, installedExeBytes: Number.NaN }).ok).toBe(false);
  });
});

describe('latestJson', () => {
  const pubDate = new Date('2026-10-04T12:00:00.000Z');

  it('is the updater plugin static manifest, both Windows keys on the versioned installer URL', () => {
    expect(
      latestJson({ version: '1.0.0', signature: 'c2lnbmF0dXJl\n', pubDate, notes: 'Kustom 1.0.0' }),
    ).toEqual({
      version: '1.0.0',
      notes: 'Kustom 1.0.0',
      pub_date: '2026-10-04T12:00:00.000Z',
      platforms: {
        'windows-x86_64-nsis': {
          signature: 'c2lnbmF0dXJl',
          url: 'https://github.com/suyaser/kustom-releases/releases/download/v1.0.0/Kustom-setup.exe',
        },
        'windows-x86_64': {
          signature: 'c2lnbmF0dXJl',
          url: 'https://github.com/suyaser/kustom-releases/releases/download/v1.0.0/Kustom-setup.exe',
        },
      },
    });
  });

  it('never points the updater at releases/latest', () => {
    expect(assetUrl('1.0.0', 'Kustom-setup.exe')).not.toContain('/latest/');
  });

  it('refuses an empty signature or a bad version', () => {
    expect(() => latestJson({ version: '1.0.0', signature: ' \n', pubDate, notes: '' })).toThrow(/signature/);
    expect(() => latestJson({ version: 'v1', signature: 'x', pubDate, notes: '' })).toThrow(/semver/);
  });
});

describe('publishBlockers', () => {
  const rustApp = 'fn main() { engine::run(); }';

  it('blocks while the public key is the placeholder or missing', () => {
    expect(publishBlockers({ pubkey: PUBKEY_PLACEHOLDER, shellSource: rustApp })).toHaveLength(1);
    expect(publishBlockers({ pubkey: undefined, shellSource: rustApp })).toHaveLength(1);
    expect(publishBlockers({ pubkey: '  ', shellSource: rustApp })[0]).toMatch(/runbook step 3/);
  });

  it('blocks while the app is still the M6 sidecar shell', () => {
    const blockers = publishBlockers({
      pubkey: 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWdu',
      shellSource: 'dir.join("kustom-engine.exe")',
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/M17\.8/);
  });

  it('lets a real key on the Rust app publish', () => {
    expect(publishBlockers({ pubkey: 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWdu', shellSource: rustApp })).toEqual(
      [],
    );
  });

  it('blocks the shell in this repo today, until M17.8 and the user key land', () => {
    const conf = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', 'src-tauri', 'tauri.conf.json'), 'utf8'),
    ) as {
      plugins: { updater: { pubkey: string; endpoints: string[] } };
    };
    expect(conf.plugins.updater.endpoints).toEqual([
      'https://github.com/suyaser/kustom-releases/releases/latest/download/latest.json',
    ]);
    const lib = readFileSync(join(import.meta.dirname, '..', '..', 'src-tauri', 'src', 'lib.rs'), 'utf8');
    // Not asserting the count: either blocker alone is enough, and each disappears on its own schedule.
    expect(publishBlockers({ pubkey: conf.plugins.updater.pubkey, shellSource: lib }).length).toBeGreaterThan(
      0,
    );
  });
});

describe('the release assets', () => {
  it('carry the installer under both names, its signature, checksums, latest.json and the README', () => {
    expect(releaseAssets()).toEqual([
      'Kustom-setup.exe',
      'Kustom-setup.exe.sig',
      'Kustom-setup.exe.sha256',
      'Kustom.exe',
      'Kustom.exe.sha256',
      'latest.json',
      'README.txt',
    ]);
  });

  it('write checksums in the sha256sum format the 0.x releases used', () => {
    expect(checksumLine('a'.repeat(64), 'Kustom-setup.exe')).toBe(`${'a'.repeat(64)}  Kustom-setup.exe\n`);
    expect(() => checksumLine('nope', 'x')).toThrow();
  });

  it('ship the friend part of the companion README', () => {
    expect(friendReadme('# Hi\n\nfriend\n\n---\nbuild notes\n')).toBe('# Hi\n\nfriend\n');
    expect(() => friendReadme('no rule')).toThrow(/horizontal rule/);
  });
});
