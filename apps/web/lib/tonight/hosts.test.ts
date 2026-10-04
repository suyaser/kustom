import { describe, expect, it } from 'vitest';
import { snapshot } from '../testing/tonightFixtures';
import { withHostPresence } from './hosts';

/** M14.66: the page puts the server's host facts on the anon snapshot, and keeps "unknown" on a failed read. */
describe('withHostPresence', () => {
  it('carries the names and the flag onto the snapshot', () => {
    const next = withHostPresence(snapshot(null), { hostNames: ['Yasser', 'Omar'], hostSeenRecently: false });
    expect(next.hostNames).toEqual(['Yasser', 'Omar']);
    expect(next.hostSeenRecently).toBe(false);
  });

  it('leaves the anon snapshot alone when the read failed: no names, and no line (seen = true)', () => {
    const base = snapshot(null);
    expect(withHostPresence(base, null)).toBe(base);
    expect(base.hostNames).toEqual([]);
    expect(base.hostSeenRecently).toBe(true);
  });
});
