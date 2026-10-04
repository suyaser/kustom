import type { ModeRow, RowPatch } from '@customs/core';
import type { ModeStore, ModeWriter, StoredModeRow } from '../mode/state';
import { missingRow } from '../mode/state';

/**
 * Tests only: an in-memory {@link ModeStore} with the Supabase one's rule (M20.7): a write applies
 * exactly the patch's fields to the row as it is now, whatever was read before (last write wins).
 * `beforeNextWrite` runs once before the next write, so a test can land a second admin's write
 * between a read and a write. `updatedAt` moves on every write.
 */
export function memoryModeStore(initial: ModeRow | null) {
  let row: ModeRow | null = initial;
  let tick = 0;
  const writes: { patch: RowPatch; writer: ModeWriter }[] = [];
  let interleave: (() => void) | null = null;
  const stamp = () => new Date(Date.UTC(2026, 9, 5, 18, 0, 0, tick)).toISOString();

  const stored = (): StoredModeRow =>
    row === null ? { row: missingRow(), exists: false, updatedAt: null } : { row, exists: true, updatedAt: stamp() };

  const store: ModeStore = {
    async read() {
      return stored();
    },
    async write(_groupId, patch, writer) {
      if (interleave !== null) {
        const run = interleave;
        interleave = null;
        run();
      }
      row = { ...(row ?? missingRow()), ...patch };
      tick += 1;
      writes.push({ patch, writer });
      return stored();
    },
  };

  return {
    store,
    writes,
    row: () => row,
    set: (next: ModeRow) => {
      row = next;
      tick += 1;
    },
    beforeNextWrite: (run: () => void) => {
      interleave = run;
    },
  };
}
