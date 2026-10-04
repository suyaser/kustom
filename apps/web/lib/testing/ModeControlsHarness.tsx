import type { ModeState } from '@customs/core';
import { nextGame } from '@customs/core';
import { ModeControls, type ModeControlsProps } from '@/app/_mode/ModeControls';
import { selectValue } from '@/lib/mode/cardView';
import { useModeSlice } from '@/lib/mode/clientStore';

/**
 * The Mode card's admin controls as the card feeds them (M19.13), for the controls' own tests:
 * the select and the switch come from the client mode store over `server` (the render's card
 * state), exactly as `ModeCardBody` computes them, so a tap, a route answer and a re-read (a new
 * `server`) move them the way they move on Tonight. Tests only.
 */
export type HarnessProps = Omit<ModeControlsProps, 'mode' | 'selected' | 'nextRated'> & { server: ModeState };

export function ModeControlsHarness({ server, ...props }: HarnessProps) {
  const merged = useModeSlice(props.groupId, { state: server, updatedAt: null, resetAt: null });
  return (
    <ModeControls
      {...props}
      mode={merged.state.standing}
      selected={selectValue(merged.state)}
      nextRated={nextGame(merged.state).rated}
    />
  );
}
