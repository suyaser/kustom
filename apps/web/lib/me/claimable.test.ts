import { describe, expect, it } from 'vitest';
import { CLAIM_WINDOW_HOURS, claimableSeats, finishedInWindow, holdsAdminRole } from './claimable';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-04T09:00:00.000Z');
const WINDOW_START = NOW - CLAIM_WINDOW_HOURS * HOUR;

describe('finishedInWindow (M14.34)', () => {
  it("counts the game's own end, started_at + duration_s", () => {
    // Started 12h20m ago, ran 30 minutes: ended 11h50m ago, inside.
    expect(
      finishedInWindow(
        { started_at: new Date(NOW - 12 * HOUR - 20 * 60_000).toISOString(), duration_s: 1_800 },
        WINDOW_START,
      ),
    ).toBe(true);
    // Started 13h ago, ran 30 minutes: ended 12h30m ago, outside.
    expect(
      finishedInWindow(
        { started_at: new Date(NOW - 13 * HOUR).toISOString(), duration_s: 1_800 },
        WINDOW_START,
      ),
    ).toBe(false);
  });

  it('is twelve hours, edge included', () => {
    expect(CLAIM_WINDOW_HOURS).toBe(12);
    expect(
      finishedInWindow({ started_at: new Date(WINDOW_START).toISOString(), duration_s: 0 }, WINDOW_START),
    ).toBe(true);
    expect(
      finishedInWindow({ started_at: new Date(WINDOW_START - 1).toISOString(), duration_s: 0 }, WINDOW_START),
    ).toBe(false);
  });

  it('refuses a start it cannot read', () => {
    expect(finishedInWindow({ started_at: 'not a date', duration_s: 1_800 }, WINDOW_START)).toBe(false);
  });
});

describe('claimableSeats (M14.34, the game page contract)', () => {
  it("keeps the game's seat order and only the viewer's claimable PUUIDs", () => {
    expect(claimableSeats(['c', 'a', 'z'], ['a', 'b', 'c', 'd'])).toEqual(['a', 'c']);
  });

  it('offers nothing when nothing is claimable', () => {
    expect(claimableSeats([], ['a', 'b'])).toEqual([]);
  });
});

describe('holdsAdminRole (M14.26)', () => {
  it('is true for an owner or admin membership in any group', () => {
    expect(holdsAdminRole([{ role: 'owner' }])).toBe(true);
    expect(holdsAdminRole([{ role: 'admin' }])).toBe(true);
    expect(holdsAdminRole([{ role: 'member' }, { role: 'admin' }])).toBe(true);
  });

  it('is false for members only, or no membership', () => {
    expect(holdsAdminRole([{ role: 'member' }])).toBe(false);
    expect(holdsAdminRole([])).toBe(false);
    expect(holdsAdminRole(null)).toBe(false);
    expect(holdsAdminRole(undefined)).toBe(false);
  });

  it('fails closed on a role the schema does not know', () => {
    expect(holdsAdminRole([{ role: 'superuser' }])).toBe(true);
  });
});
