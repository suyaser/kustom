import type { ModeState } from '@customs/core';
import { type ModeStore, type ModeWriter, missingState, type StoredModeState } from '../mode/state';

/**
 * Tests only: an in-memory {@link ModeStore} with the same compare-and-set rule as the Supabase one
 * (a write lands only on the version it read, or on a missing row when the row was missing).
 * `interleave` runs once before the next write, so a test can land a second admin's write between
 * a read and a write.
 */
export function memoryModeStore(initial: ModeState | null) {
  let row: ModeState | null = initial;
  const writes: { next: ModeState; writer: ModeWriter }[] = [];
  let interleave: (() => void) | null = null;

  const store: ModeStore = {
    async read(): Promise<StoredModeState> {
      return row === null ? { state: missingState(), exists: false } : { state: row, exists: true };
    },
    async write(_groupId, expected, next, writer) {
      if (interleave !== null) {
        const run = interleave;
        interleave = null;
        run();
      }
      const matches = expected.exists ? row !== null && row.version === expected.state.version : row === null;
      if (!matches) return false;
      row = next;
      writes.push({ next, writer });
      return true;
    },
  };

  return {
    store,
    writes,
    row: () => row,
    set: (state: ModeState) => {
      row = state;
    },
    beforeNextWrite: (run: () => void) => {
      interleave = run;
    },
  };
}
