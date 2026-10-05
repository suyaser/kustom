import { type ModeRow, nextRated } from '@customs/core';
import { ModeControls, type ModeControlsProps } from '@/app/_mode/ModeControls';
import { selectValue } from '@/lib/mode/cardView';
import { useModeSlice } from '@/lib/mode/clientStore';

/**
 * The Mode card's admin controls as the card feeds them (M19.13, M20.8), for the controls' own
 * tests: the select and the switch come from the client mode store over `server` (the render's
 * row), exactly as `ModeCardBody` computes them, so a tap, a route answer and a re-read (a new
 * `server`) move them the way they move on Tonight. Tests only.
 */
export type HarnessProps = Omit<ModeControlsProps, 'mode' | 'selected' | 'nextRated'> & {
  server: ModeRow;
  /** The render's `group_modes.updated_at` (the store's gate); null by default. */
  serverUpdatedAt?: string | null;
};

export function ModeControlsHarness({ server, serverUpdatedAt = null, ...props }: HarnessProps) {
  const merged = useModeSlice(props.groupId, { row: server, updatedAt: serverUpdatedAt, resetAt: null });
  return (
    <ModeControls
      {...props}
      mode={merged.row.standing}
      selected={selectValue(merged.row)}
      nextRated={nextRated(merged.row)}
    />
  );
}
