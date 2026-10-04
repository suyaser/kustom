import { describe, expect, it } from 'vitest';
import { GAMES_COPY } from './games';
import * as home from './homeCopy';
import * as section from './sectionCopy';

/**
 * No developer string from the audit's list renders on an admin page (M14.23 acceptance 7), and no
 * admin page names a mode or fearless control (acceptance 10, M14.30 acceptance 13). Every friend-
 * facing string on these pages is one of these constants, so checking them checks the pages.
 */
const BANNED =
  /revoked_at|last_seen_at|pnpm|--filter|snowflake|guild id|channel id|token hash|\bpuuid\b|companion token|voice/i;

function strings(module: Record<string, unknown>): string[] {
  return Object.values(module).flatMap((value) => {
    if (typeof value === 'string') return [value];
    if (typeof value === 'function') {
      const out = (value as (...args: string[]) => unknown)('X', 'Y');
      return typeof out === 'string' ? [out] : [];
    }
    if (value !== null && typeof value === 'object')
      return Object.values(value).filter((v) => typeof v === 'string');
    return [];
  });
}

describe('admin copy', () => {
  it('has no developer words', () => {
    for (const text of [...strings(section), ...strings(home), ...Object.values(GAMES_COPY)]) {
      expect(text, text).not.toMatch(BANNED);
    }
  });

  it('names no mode or fearless control', () => {
    for (const text of [...strings(section), ...strings(home)]) {
      // The members confirm says admins "change the mode" on Tonight; that is a description, not a control.
      if (text === home.CONFIRM_MAKE_ADMIN_BODY) continue;
      expect(text, text).not.toMatch(/fearless|\bmode\b/i);
    }
  });
});
