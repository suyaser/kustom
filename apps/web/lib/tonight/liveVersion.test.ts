import { describe, expect, it } from 'vitest';
import { LIVE_RACE_MARGIN_MS, safeLiveVersion } from './liveVersion';

/** M19.10: the version a render hands its page is never newer than the data it drew. */
describe('safeLiveVersion', () => {
  const start = Date.parse('2026-10-04T20:00:00.000Z');
  const at = (ms: number) => new Date(start + ms).toISOString();

  it('hands down a settled version as it is', () => {
    expect(safeLiveVersion({ version: 7, changed_at: at(-60_000) }, start)).toBe(7);
  });

  it('hands down one lower when the bump may have raced the render, so the page re-reads once', () => {
    expect(safeLiveVersion({ version: 7, changed_at: at(100) }, start)).toBe(6);
    expect(safeLiveVersion({ version: 7, changed_at: at(-LIVE_RACE_MARGIN_MS + 1) }, start)).toBe(6);
  });

  it('is null with no row or a row it cannot read: the page re-reads on subscribe', () => {
    expect(safeLiveVersion(null, start)).toBeNull();
    expect(safeLiveVersion({ version: 7, changed_at: 'not a time' }, start)).toBeNull();
    expect(safeLiveVersion({ version: -1, changed_at: at(-60_000) }, start)).toBeNull();
  });
});
