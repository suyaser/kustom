/**
 * The publish plan is pure, so it is pinned here: the tag, the title, the three assets, the stable link, and
 * the friend README extracted from above the rule in README.md. No `gh`, no network.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { friendReadme, README_FILE, RELEASE_LATEST_URL } from './config.js';
import { commandLine, publishPlan } from './publish.js';

describe('publishPlan', () => {
  it('names the tag, the title and the three assets the brief lists', () => {
    const plan = publishPlan('1.2.3');
    expect(plan.tag).toBe('v1.2.3');
    expect(plan.title).toBe('Kustom companion 1.2.3');
    expect(plan.assets.map((asset) => asset.split('/').pop())).toEqual([
      'Kustom.exe',
      'Kustom.exe.sha256',
      'README.txt',
    ]);
    expect(plan.command.slice(0, 7)).toEqual([
      'gh',
      'release',
      'create',
      'v1.2.3',
      '--repo',
      'suyaser/kustom-releases',
      '--title',
    ]);
    expect(plan.latestUrl).toBe(
      'https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe',
    );
    expect(plan.latestUrl).toBe(RELEASE_LATEST_URL);
    expect(plan.assetUrls[0]).toBe(
      'https://github.com/suyaser/kustom-releases/releases/download/v1.2.3/Kustom.exe',
    );
    expect(commandLine(plan)).toContain(`--title 'Kustom companion 1.2.3'`);
  });
});

describe('friendReadme', () => {
  it('is the top of README.md, ends at the rule, and reads like the brief', () => {
    const text = friendReadme();
    const whole = readFileSync(README_FILE, 'utf8');
    expect(whole.startsWith(text.trimEnd())).toBe(true);
    expect(text).toContain('# Kustom\n');
    expect(text).toContain('## 3. Leave it running');
    expect(text).toContain('## Updates');
    expect(text).toContain('More info');
    expect(text).toContain('%APPDATA%\\customs-night\\logs');
    // M17.12: the Rust app has no token to paste and no Overlay mode; this ships as README.txt and the
    // release notes.
    expect(text).not.toMatch(/token|paste|overlay/i);
    expect(text).not.toContain('---');
    expect(text).not.toContain('Building it');
    expect(text.endsWith('\n')).toBe(true);
  });
});
